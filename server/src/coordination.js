const { randomUUID } = require('crypto');
const { requireExpectedVersion, sendVersionConflict } = require('./concurrency');

const HALL_SIGNAL_LABELS = {
  hall_help: 'Нужна помощь зала',
  dessert_ready: 'Готовность к десерту',
  bill_soon: 'Счёт скоро',
};

function registerCoordinationRoutes(app, deps) {
  const {
    pool,
    query,
    asyncHandler,
    authMiddleware,
    guestAuthMiddleware,
    guestOrderRateLimiter = (_req, _res, next) => next(),
    requirePermission,
    requireManager,
    can,
    randomUUID: uuid,
    emitChange,
    logActivity,
    createRoleNotifications,
    createNotification,
    createGuestNotification,
    notifyStopListChange,
    addGuestBonusTransaction,
    httpError,
    rowById,
    getReservationConflict,
    reservationPushText,
    normalizeBirthday,
    loyaltyLevelLabels,
    publicGuest,
    buildGuestPayload,
    isBarMenuItem,
    serverDate,
    syncGuestOrderToIiko,
  } = deps;

  const orderStatuses = new Set(['ordered', 'accepted', 'in_progress', 'done', 'served', 'cancelled']);

  async function loadOrderItemForUpdate(client, id) {
    const result = await client.query(
      `SELECT
         oi.*,
         go.table_id,
         go.guest_id,
         gu.name AS guest_name,
         t.number AS table_number,
         t.current_waiter_id,
         mi.name AS menu_item_name,
         mi.description,
         mi.composition,
         mi.item_type,
         mi.is_bar,
         mi.is_kitchen,
         mc.name AS category_name
       FROM guest_order_items oi
       JOIN guest_orders go ON go.id = oi.order_id
       JOIN guest_users gu ON gu.id = go.guest_id
       JOIN "tables" t ON t.id = go.table_id
       JOIN menu_items mi ON mi.id = oi.menu_item_id
       JOIN menu_categories mc ON mc.id = mi.category_id
       WHERE oi.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  function canUpdateOrderItem(user, item, body) {
    if (['technician', 'manager', 'administrator'].includes(user.role)) return true;
    const nextStatus = body.status ? String(body.status) : null;
    if (user.role === 'waiter') {
      return item.current_waiter_id === user.id && (!nextStatus || ['accepted', 'served', 'cancelled'].includes(nextStatus));
    }
    if (user.role === 'chef') {
      return Boolean(item.is_kitchen);
    }
    if (user.role === 'cook') {
      return Boolean(item.is_kitchen) && (!item.assigned_to || item.assigned_to === user.id) && (!nextStatus || ['in_progress', 'done'].includes(nextStatus));
    }
    if (user.role === 'bar') {
      return Boolean(isBarMenuItem?.(item, { name: item.category_name })) && (!nextStatus || ['accepted', 'in_progress', 'done', 'cancelled'].includes(nextStatus));
    }
    return false;
  }

  async function systemActorId(client) {
    const result = await client.query(
      `SELECT id FROM users WHERE role IN ('manager', 'administrator') AND status NOT IN ('blocked', 'fired', 'inactive') ORDER BY CASE role WHEN 'administrator' THEN 0 ELSE 1 END LIMIT 1`,
    );
    return result.rows[0]?.id ?? null;
  }

  async function findGuestByPhone(client, phone) {
    const normalized = String(phone ?? '').replace(/\D/g, '');
    if (!normalized) return null;
    const result = await client.query(
      `SELECT * FROM guest_users WHERE regexp_replace(phone, '\\D', '', 'g') = $1 AND deleted_at IS NULL LIMIT 1`,
      [normalized],
    );
    return result.rows[0] ?? null;
  }

  async function notifyGuestByPhone(client, phone, payload) {
    const guest = await findGuestByPhone(client, phone);
    if (!guest) return null;
    return createGuestNotification(client, { guestId: guest.id, ...payload });
  }

  async function maybeBirthdayBonus(client, guest) {
    if (!guest?.birthday) return;
    const today = serverDate();
    const birthday = String(guest.birthday).slice(5, 10);
    const current = today.slice(5, 10);
    if (birthday !== current) return;
    const year = today.slice(0, 4);
    const existing = await client.query(
      `SELECT id FROM guest_bonus_transactions WHERE guest_id = $1 AND type = 'birthday_bonus' AND created_at >= $2::date LIMIT 1`,
      [guest.id, `${year}-01-01`],
    );
    if (existing.rows[0]) return;
    await deps.addGuestBonusTransaction(client, {
      guestId: guest.id,
      type: 'birthday_bonus',
      amount: 500,
      reason: 'Бонус ко дню рождения',
      source: 'guest_app',
    });
    await createGuestNotification(client, {
      guestId: guest.id,
      title: 'С днём рождения!',
      text: 'Мы начислили праздничные бонусы на вашу карту.',
      type: 'birthday',
      push: true,
    });
  }

  async function loadHallSignals(client) {
    const result = await client.query(
      `SELECT hs.*, t.number AS table_number, u.name AS created_by_name
       FROM hall_signals hs
       JOIN "tables" t ON t.id = hs.table_id
       JOIN users u ON u.id = hs.created_by
       ORDER BY CASE hs.status WHEN 'open' THEN 0 ELSE 1 END, hs.created_at DESC
       LIMIT 120`,
    );
    return result.rows.map((row) => ({
      ...row,
      signal_label: HALL_SIGNAL_LABELS[row.signal_type] ?? row.signal_type,
    }));
  }

  async function loadTableGuestSessions(client) {
    const result = await client.query(
      `SELECT s.*, g.name AS guest_name, g.phone AS guest_phone, g.bonus_balance, g.loyalty_level, t.number AS table_number
       FROM table_guest_sessions s
       JOIN guest_users g ON g.id = s.guest_id
       JOIN "tables" t ON t.id = s.table_id
       WHERE s.status = 'active'
       ORDER BY s.checked_in_at DESC`,
    );
    return result.rows;
  }

  async function loadMenuRestoredAlerts(client, userId) {
    const result = await client.query(
      `SELECT a.*
       FROM menu_restored_alerts a
       LEFT JOIN menu_restored_alert_reads r
         ON r.alert_id = a.id AND r.user_id = $1
       WHERE r.alert_id IS NULL
       ORDER BY a.created_at DESC
       LIMIT 30`,
      [userId],
    );
    return result.rows;
  }

  function modifierInputsFromBody(body) {
    const raw = body?.modifiers ?? body?.modifier_selections ?? body?.modifierSelections ?? [];
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw httpError('Некорректный список модификаторов.', 400);
    return raw;
  }

  function modifierSelectionId(input) {
    return String(
      input?.menu_item_modifier_id ??
        input?.menuItemModifierId ??
        input?.modifier_id ??
        input?.modifierId ??
        input?.id ??
        input?.iiko_modifier_product_id ??
        input?.iikoModifierProductId ??
        '',
    ).trim();
  }

  function modifierAmount(input) {
    const amount = Number(input?.amount ?? input?.quantity ?? 1);
    if (!Number.isFinite(amount) || amount <= 0) throw httpError('Количество модификатора должно быть больше нуля.', 400);
    return Math.min(99, Math.round(amount * 1000) / 1000);
  }

  async function resolveOrderItemModifiers(client, menuItemId, body) {
    const inputs = modifierInputsFromBody(body);
    if (inputs.length === 0) return [];

    const available = await client.query(
      `SELECT
         mim.id AS menu_item_modifier_id,
         mim.iiko_modifier_product_id,
         mim.name,
         mim.price,
         mim.min_amount,
         mim.max_amount,
         mig.id AS group_id,
         mig.iiko_modifier_group_id,
         mig.min_amount AS group_min_amount,
         mig.max_amount AS group_max_amount
       FROM menu_item_modifiers mim
       JOIN menu_item_modifier_groups mig ON mig.id = mim.modifier_group_id
       WHERE mig.menu_item_id = $1
         AND mig.status = 'active'
         AND mim.status = 'active'`,
      [menuItemId],
    );
    const byId = new Map();
    const byIikoProductId = new Map();
    for (const row of available.rows) {
      byId.set(row.menu_item_modifier_id, row);
      byIikoProductId.set(row.iiko_modifier_product_id, row);
    }

    const selectedByModifierId = new Map();
    for (const input of inputs) {
      const id = modifierSelectionId(input);
      const modifier = byId.get(id) ?? byIikoProductId.get(id);
      if (!modifier) throw httpError('Модификатор не найден для этого блюда.', 400);
      const amount = modifierAmount(input);
      const existing = selectedByModifierId.get(modifier.menu_item_modifier_id);
      selectedByModifierId.set(modifier.menu_item_modifier_id, {
        ...modifier,
        amount: (existing?.amount ?? 0) + amount,
      });
    }

    const groupAmounts = new Map();
    const selected = [...selectedByModifierId.values()];
    for (const modifier of selected) {
      if (modifier.max_amount != null && modifier.amount > Number(modifier.max_amount)) {
        throw httpError('Превышено количество модификатора.', 400);
      }
      if (modifier.min_amount != null && Number(modifier.min_amount) > 0 && modifier.amount < Number(modifier.min_amount)) {
        throw httpError('Недостаточное количество модификатора.', 400);
      }
      groupAmounts.set(modifier.group_id, (groupAmounts.get(modifier.group_id) ?? 0) + modifier.amount);
    }
    for (const modifier of selected) {
      const groupAmount = groupAmounts.get(modifier.group_id) ?? 0;
      if (modifier.group_max_amount != null && groupAmount > Number(modifier.group_max_amount)) {
        throw httpError('Превышено количество модификаторов в группе.', 400);
      }
      if (modifier.group_min_amount != null && Number(modifier.group_min_amount) > 0 && groupAmount < Number(modifier.group_min_amount)) {
        throw httpError('Выберите обязательный модификатор.', 400);
      }
    }

    return selected;
  }

  async function insertOrderItemModifiers(client, orderItemId, modifiers) {
    const rows = [];
    for (const modifier of modifiers) {
      const row = (
        await client.query(
          `INSERT INTO guest_order_item_modifiers
             (id, order_item_id, menu_item_modifier_id, modifier_group_id,
              iiko_modifier_product_id, iiko_modifier_group_id, name, amount, price,
              created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
           RETURNING *`,
          [
            uuid(),
            orderItemId,
            modifier.menu_item_modifier_id,
            modifier.group_id,
            modifier.iiko_modifier_product_id,
            modifier.iiko_modifier_group_id,
            modifier.name,
            modifier.amount,
            modifier.price ?? 0,
          ],
        )
      ).rows[0];
      rows.push(row);
    }
    return rows;
  }

  async function resolveSegmentGuests(client, segment) {
    const rules = segment.rules_json ?? {};
    const conditions = [];
    const params = [];
    if (rules.loyalty_level) {
      params.push(rules.loyalty_level);
      conditions.push(`gu.loyalty_level = $${params.length}`);
    }
    if (rules.min_bonus) {
      params.push(Number(rules.min_bonus));
      conditions.push(`gu.bonus_balance >= $${params.length}`);
    }
    if (rules.inactive_days) {
      params.push(Number(rules.inactive_days));
      conditions.push(
        `(gu.last_visit_at IS NULL AND gu.created_at < NOW() - ($${params.length}::text || ' days')::interval OR gu.last_visit_at < NOW() - ($${params.length}::text || ' days')::interval)`,
      );
    }
    if (rules.min_visits) {
      params.push(Number(rules.min_visits));
      conditions.push(`gu.visits_count >= $${params.length}`);
    }
    if (rules.max_visits !== undefined) {
      params.push(Number(rules.max_visits));
      conditions.push(`gu.visits_count <= $${params.length}`);
    }
    const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';
    const result = await client.query(
      `SELECT gu.*
       FROM guest_users gu
       WHERE gu.deleted_at IS NULL AND gu.status = 'active'
       ${where}
       ORDER BY gu.updated_at DESC
       LIMIT 500`,
      params,
    );
    return result.rows;
  }

  app.post(
    '/hall-signals',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const { table_id: tableId, signal_type: signalType } = req.body ?? {};
      if (!tableId || !signalType || !HALL_SIGNAL_LABELS[signalType]) {
        res.status(400).json({ error: 'Укажите стол и тип сигнала.' });
        return;
      }
      if (req.user.role !== 'waiter' && !can(req.user.role, 'manage:floor')) {
        res.status(403).json({ error: 'Сигналы зала доступны официанту, хостес и администрации.' });
        return;
      }
      const id = uuid();
      const result = await query(
        `INSERT INTO hall_signals (id, table_id, signal_type, created_by, created_at)
         VALUES ($1,$2,$3,$4,NOW())
         RETURNING *`,
        [id, tableId, signalType, req.user.id],
      );
      const table = (await query('SELECT number FROM "tables" WHERE id = $1', [tableId])).rows[0];
      const label = HALL_SIGNAL_LABELS[signalType];
      const client = await pool.connect();
      try {
        await createRoleNotifications(client, ['hostess', 'management', 'waiter'], {
          title: label,
          text: `Стол ${table?.number ?? '?'} · ${req.user.name}`,
          type: 'hall_signal',
          data: { hall_signal_id: id, table_id: tableId, signal_type: signalType },
        });
      } finally {
        client.release();
      }
      emitChange('hall_signals', 'created', result.rows[0]);
      res.status(201).json({ ...result.rows[0], signal_label: label, table_number: table?.number });
    }),
  );

  app.patch(
    '/hall-signals/:id/acknowledge',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (req.user.role !== 'waiter' && !can(req.user.role, 'manage:floor')) {
        res.status(403).json({ error: 'Недостаточно прав.' });
        return;
      }
      const current = (await query('SELECT * FROM hall_signals WHERE id = $1', [req.params.id])).rows[0];
      if (!current) {
        res.status(404).json({ error: 'Сигнал не найден или уже принят.' });
        return;
      }
      const expectedVersion = requireExpectedVersion(req, res, current);
      if (!expectedVersion) return;
      const updated = await query(
        `UPDATE hall_signals
         SET status = 'acknowledged',
             acknowledged_by = $2,
             acknowledged_at = NOW(),
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1 AND status = 'open' AND version = $3
         RETURNING *`,
        [req.params.id, req.user.id, expectedVersion],
      );
      if (!updated.rows[0]) {
        sendVersionConflict(res, (await query('SELECT * FROM hall_signals WHERE id = $1', [req.params.id])).rows[0]);
        return;
      }
      emitChange('hall_signals', 'updated', updated.rows[0]);
      res.json(updated.rows[0]);
    }),
  );

  app.post(
    '/menu-restored-alerts/acknowledge',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const alerts = await query('SELECT id FROM menu_restored_alerts ORDER BY created_at DESC LIMIT 50');
      for (const alert of alerts.rows) {
        await query(
          `INSERT INTO menu_restored_alert_reads (user_id, alert_id, read_at)
           VALUES ($1,$2,NOW())
           ON CONFLICT (user_id, alert_id) DO NOTHING`,
          [req.user.id, alert.id],
        );
      }
      res.json({ ok: true });
    }),
  );

  app.post(
    '/guest/reservations',
    guestAuthMiddleware,
    guestOrderRateLimiter,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const actorId = await systemActorId(client);
        if (!actorId) throw httpError('Сервер не настроен для гостевых броней.', 503);
        const date = String(req.body?.date ?? '').slice(0, 10);
        const time = String(req.body?.time ?? '19:00').slice(0, 5);
        const guestsCount = Number(req.body?.guests_count ?? 2);
        if (!date) throw httpError('Укажите дату брони.', 400);
        const id = uuid();
        const result = await client.query(
          `INSERT INTO reservations
             (id, guest_name, guest_phone, date, time, guests_count, table_id, occasion, status, source, comment, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,'new','guest_app',$8,$9,NOW())
           RETURNING *`,
          [id, req.guest.name, req.guest.phone, date, time, guestsCount, req.body?.occasion ?? 'regular', req.body?.comment ?? '', actorId],
        );
        await createRoleNotifications(client, ['hostess', 'management'], {
          title: 'Заявка на бронь из приложения',
          text: `${req.guest.name}, ${guestsCount} гостей, ${date} ${time}`,
          type: 'guest_reservation',
          data: { reservation_id: id },
        });
        await client.query('COMMIT');
        emitChange('reservations', 'created', result.rows[0]);
        res.status(201).json(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/guest/check-in',
    guestAuthMiddleware,
    guestOrderRateLimiter,
    asyncHandler(async (req, res) => {
      const token = String(req.body?.token ?? req.body?.table_token ?? '').trim().toUpperCase();
      if (!token) {
        res.status(400).json({ error: 'Введите код со стола или отсканируйте QR.' });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let table = (
          await client.query(`SELECT * FROM "tables" WHERE UPPER(checkin_token) = $1`, [token])
        ).rows[0];
        if (!table && token.includes('token=')) {
          const match = token.match(/token=([A-Za-z0-9]+)/i);
          if (match) {
            table = (await client.query(`SELECT * FROM "tables" WHERE UPPER(checkin_token) = $1`, [match[1].toUpperCase()])).rows[0];
          }
        }
        if (!table) {
          res.status(404).json({ error: 'Стол не найден. Проверьте код на наклейке.' });
          await client.query('ROLLBACK');
          return;
        }
        await client.query(
          `UPDATE table_guest_sessions SET status = 'ended', ended_at = NOW() WHERE table_id = $1 AND status = 'active'`,
          [table.id],
        );
        const sessionId = uuid();
        const session = (
          await client.query(
            `INSERT INTO table_guest_sessions (id, table_id, guest_id, status, checked_in_at)
             VALUES ($1,$2,$3,'active',NOW())
             RETURNING *`,
            [sessionId, table.id, req.guest.id],
          )
        ).rows[0];
        const updatedTable = (
          await client.query(
            `UPDATE "tables"
             SET status = 'occupied',
                 version = version + 1,
                 updated_at = NOW()
             WHERE id = $1 AND status IN ('free', 'reserved', 'expected', 'soon_reserved')
             RETURNING *`,
            [table.id],
          )
        ).rows[0] ?? table;
        if (table.current_waiter_id) {
          await createNotification(client, {
            userId: table.current_waiter_id,
            targetRole: 'waiter',
            title: 'Гость в приложении',
            text: `${req.guest.name} за столом ${table.number}`,
            type: 'guest_checkin',
            data: { table_id: table.id, guest_id: req.guest.id },
          });
        } else {
          await createRoleNotifications(client, ['hostess', 'waiter', 'management'], {
            title: 'Гость в приложении',
            text: `${req.guest.name} за столом ${table.number}`,
            type: 'guest_checkin',
            data: { table_id: table.id, guest_id: req.guest.id },
          });
        }
        const profile = buildGuestPayload ? await buildGuestPayload(client, req.guest.id) : null;
        await client.query('COMMIT');
        emitChange('table_guest_sessions', 'created', session);
        emitChange('tables', 'updated', updatedTable);
        res.json({
          session,
          table: { id: updatedTable.id, number: updatedTable.number },
          guest: publicGuest(req.guest),
          profile,
          offers: [
            { id: 'welcome', title: 'Добро пожаловать', text: 'Покажите официанту бонусную карту в приложении.' },
            { id: 'menu', title: 'Меню дня', text: 'Смотрите актуальные блюда и акции во вкладке «Меню».' },
          ],
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/guest/orders/items',
    guestAuthMiddleware,
    guestOrderRateLimiter,
    asyncHandler(async (req, res) => {
      const menuItemId = String(req.body?.menu_item_id ?? req.body?.menuItemId ?? '').trim();
      const quantity = Math.max(1, Math.min(99, Number(req.body?.quantity ?? 1)));
      if (!menuItemId) throw httpError('Выберите позицию меню.', 400);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const session = (
          await client.query(
            `SELECT s.*, t.number AS table_number, t.current_waiter_id
             FROM table_guest_sessions s
             JOIN "tables" t ON t.id = s.table_id
             WHERE s.guest_id = $1 AND s.status = 'active'
             ORDER BY s.checked_in_at DESC
             LIMIT 1`,
            [req.guest.id],
          )
        ).rows[0];
        if (!session) throw httpError('Сначала привяжитесь к столу в меню.', 400);

        const menuItem = (
          await client.query(
            `SELECT mi.*, mc.name AS category_name
             FROM menu_items mi
             JOIN menu_categories mc ON mc.id = mi.category_id
             WHERE mi.id = $1`,
            [menuItemId],
          )
        ).rows[0];
        if (!menuItem) throw httpError('Позиция меню не найдена.', 404);
        if (menuItem.status === 'stop') throw httpError('Эта позиция сейчас в стоп-листе.', 409);
        const selectedModifiers = await resolveOrderItemModifiers(client, menuItemId, req.body ?? {});

        let order = (
          await client.query(
            `SELECT *
             FROM guest_orders
             WHERE table_session_id = $1 AND status = 'open'
             ORDER BY created_at DESC
             LIMIT 1`,
            [session.id],
          )
        ).rows[0];
        if (!order) {
          order = (
            await client.query(
              `INSERT INTO guest_orders (id, table_session_id, table_id, guest_id, status, created_at, updated_at)
               VALUES ($1,$2,$3,$4,'open',NOW(),NOW())
               RETURNING *`,
              [uuid(), session.id, session.table_id, req.guest.id],
            )
          ).rows[0];
        }

        const item = (
          await client.query(
            `INSERT INTO guest_order_items (id, order_id, menu_item_id, quantity, status, comment, created_at, updated_at)
             VALUES ($1,$2,$3,$4,'ordered',$5,NOW(),NOW())
             RETURNING *`,
            [uuid(), order.id, menuItemId, quantity, req.body?.comment ?? ''],
          )
        ).rows[0];
        const modifiers = await insertOrderItemModifiers(client, item.id, selectedModifiers);
        await client.query('UPDATE guest_orders SET updated_at = NOW(), version = version + 1 WHERE id = $1', [order.id]);
        const targetRoles = menuItem.is_kitchen ? ['kitchen'] : isBarMenuItem?.(menuItem, { name: menuItem.category_name }) ? ['bar'] : ['waiter'];
        await createRoleNotifications(client, [...targetRoles, 'management'], {
          title: 'Новая позиция в заказе',
          text: `${menuItem.name} x${quantity} · стол ${session.table_number}`,
          type: 'guest_order_item',
          data: { order_id: order.id, order_item_id: item.id, table_id: session.table_id },
        });
        if (session.current_waiter_id) {
          await createNotification(client, {
            userId: session.current_waiter_id,
            title: 'Гость добавил позицию',
            text: `${menuItem.name} x${quantity} · стол ${session.table_number}`,
            type: 'guest_order_item',
            data: { order_id: order.id, order_item_id: item.id, table_id: session.table_id },
          });
        }
        await client.query('COMMIT');
        let iikoSync = null;
        if (typeof syncGuestOrderToIiko === 'function') {
          try {
            iikoSync = await syncGuestOrderToIiko({
              db: pool,
              orderId: order.id,
              env: process.env,
              randomUUID: uuid,
              logger: console,
            });
          } catch (error) {
            iikoSync = {
              status: 'failed',
              operation: 'create',
              orderId: order.id,
              error: error.message,
            };
            console.warn('iiko order sync trigger failed:', error.message);
          }
        }
        emitChange('guest_orders', 'updated', order);
        emitChange('guest_order_items', 'created', item);
        if (modifiers.length > 0) emitChange('guest_order_item_modifiers', 'created', { order_item_id: item.id, items: modifiers });
        res.status(201).json({ order, item, modifiers, iiko_sync: iikoSync });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.patch(
    '/guest-order-items/:id',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRow = await loadOrderItemForUpdate(client, req.params.id);
        if (!oldRow) throw httpError('Позиция заказа не найдена.', 404);
        if (!canUpdateOrderItem(req.user, oldRow, req.body ?? {})) throw httpError('Нет прав менять эту позицию заказа.', 403);

        const entries = [];
        if (req.body?.status !== undefined) {
          const status = String(req.body.status);
          if (!orderStatuses.has(status)) throw httpError('Некорректный статус позиции заказа.', 400);
          entries.push(['status', status]);
        }
        if (req.body?.assigned_to !== undefined) {
          if (!['technician', 'manager', 'administrator', 'chef'].includes(req.user.role)) throw httpError('Назначать повара может шеф или управляющий.', 403);
          const assignee = req.body.assigned_to || null;
          if (assignee) {
            const cook = (await client.query(`SELECT id FROM users WHERE id = $1 AND role = 'cook' AND status <> 'fired'`, [assignee])).rows[0];
            if (!cook) throw httpError('Повар не найден.', 404);
          }
          entries.push(['assigned_to', assignee]);
        }
        if (req.body?.comment !== undefined) entries.push(['comment', String(req.body.comment ?? '')]);
        if (entries.length === 0) throw httpError('Нет полей для обновления позиции заказа.', 400);
        const expectedVersion = requireExpectedVersion(req, res, oldRow);
        if (!expectedVersion) {
          await client.query('ROLLBACK');
          return;
        }

        const setSql = entries.map(([key], index) => `"${key}" = $${index + 3}`).join(', ');
        const values = [req.params.id, expectedVersion, ...entries.map(([, value]) => value)];
        const updated = (
          await client.query(
            `UPDATE guest_order_items
             SET ${setSql}, updated_at = NOW(), version = version + 1
             WHERE id = $1 AND version = $2
             RETURNING *`,
            values,
          )
        ).rows[0];
        if (!updated) {
          const current = (await client.query('SELECT * FROM guest_order_items WHERE id = $1', [req.params.id])).rows[0];
          sendVersionConflict(res, current);
          await client.query('ROLLBACK');
          return;
        }
        await client.query('UPDATE guest_orders SET updated_at = NOW(), version = version + 1 WHERE id = $1', [oldRow.order_id]);
        await client.query('COMMIT');
        emitChange('guest_order_items', 'updated', updated);
        res.json(updated);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.get(
    '/guest/timeline',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const phone = req.guest.phone;
      const [reservations, sessions, bonuses] = await Promise.all([
        query(
          `SELECT id, guest_name, guest_phone, date, time, guests_count, status, source, comment, created_at
           FROM reservations
           WHERE regexp_replace(guest_phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
           ORDER BY date DESC, time DESC
           LIMIT 40`,
          [phone],
        ),
        query(
          `SELECT s.id, s.table_id, s.checked_in_at, s.ended_at, s.status, t.number AS table_number
           FROM table_guest_sessions s
           JOIN "tables" t ON t.id = s.table_id
           WHERE s.guest_id = $1
           ORDER BY s.checked_in_at DESC
           LIMIT 40`,
          [req.guest.id],
        ),
        query(
          `SELECT id, type, amount, reason, created_at, balance_after
           FROM guest_bonus_transactions
           WHERE guest_id = $1
           ORDER BY created_at DESC
           LIMIT 40`,
          [req.guest.id],
        ),
      ]);
      const items = [
        ...reservations.rows.map((row) => ({
          id: `reservation-${row.id}`,
          kind: 'reservation',
          title: `Бронь ${row.date} ${String(row.time).slice(0, 5)}`,
          text: `${row.guests_count} гостей · ${row.status}${row.source === 'guest_app' ? ' · из приложения' : ''}`,
          at: row.created_at,
          status: row.status,
        })),
        ...sessions.rows.map((row) => ({
          id: `visit-${row.id}`,
          kind: 'visit',
          title: `Визит · стол ${row.table_number}`,
          text: row.status === 'active' ? 'Сейчас в ресторане' : 'Завершён',
          at: row.checked_in_at,
          status: row.status,
        })),
        ...bonuses.rows.map((row) => ({
          id: `bonus-${row.id}`,
          kind: 'bonus',
          title: row.reason || row.type,
          text: `${row.amount > 0 ? '+' : ''}${row.amount} бонусов · баланс ${row.balance_after}`,
          at: row.created_at,
          status: row.type,
        })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
      res.json({ items });
    }),
  );

  app.get(
    '/guest-segments',
    authMiddleware,
    requireManager,
    asyncHandler(async (_req, res) => {
      const segments = await query('SELECT * FROM guest_segments ORDER BY created_at DESC');
      const enriched = [];
      for (const segment of segments.rows) {
        const guests = await resolveSegmentGuests(query, segment);
        enriched.push({ ...segment, member_count: guests.length });
      }
      res.json(enriched);
    }),
  );

  app.post(
    '/guest-segments/:id/announcements',
    authMiddleware,
    requireManager,
    asyncHandler(async (req, res) => {
      const segment = (await query('SELECT * FROM guest_segments WHERE id = $1', [req.params.id])).rows[0];
      if (!segment) {
        res.status(404).json({ error: 'Сегмент не найден.' });
        return;
      }
      const title = String(req.body?.title ?? '').trim();
      const text = String(req.body?.text ?? '').trim();
      if (!title || !text) {
        res.status(400).json({ error: 'Укажите заголовок и текст новости.' });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const announcementId = uuid();
        await client.query(
          `INSERT INTO announcements (id, title, text, author_id, target_role, importance, guest_segment_id, created_at)
           VALUES ($1,$2,$3,$4,'guest',$5,$6,NOW())`,
          [announcementId, title, text, req.user.id, req.body?.importance ?? 'normal', segment.id],
        );
        const guests = await resolveSegmentGuests(client, segment);
        let notified = 0;
        for (const guest of guests) {
          const created = await createGuestNotification(client, {
            guestId: guest.id,
            title,
            text,
            type: 'segment_offer',
            data: { segment_id: segment.id, announcement_id: announcementId },
            push: true,
            respectMarketing: true,
          });
          if (created) notified += 1;
        }
        await client.query('COMMIT');
        emitChange('announcements', 'created', { id: announcementId, guest_segment_id: segment.id });
        res.status(201).json({ announcement_id: announcementId, guests: guests.length, notified });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  return {
    loadHallSignals,
    loadTableGuestSessions,
    loadMenuRestoredAlerts,
    notifyGuestByPhone,
    maybeBirthdayBonus,
    HALL_SIGNAL_LABELS,
    enhanceStopListNotify: async (client, row, options) => {
      if (options?.status === 'available') {
        const menuItem = (
          await client.query('SELECT id, name FROM menu_items WHERE id = $1', [row.menu_item_id])
        ).rows[0];
        if (menuItem) {
          await client.query(
            `INSERT INTO menu_restored_alerts (id, menu_item_id, menu_item_name, created_at)
             VALUES ($1,$2,$3,NOW())`,
            [uuid(), menuItem.id, menuItem.name],
          );
          await createRoleNotifications(client, ['waiter', 'hostess'], {
            title: 'Снова в меню',
            text: `${menuItem.name} снова доступно официантам`,
            type: 'menu_restored',
            data: { menu_item_id: menuItem.id },
          });
        }
      }
      return notifyStopListChange(client, row, options);
    },
    notifyGuestReservationStatus: async (client, reservation, status) => {
      if (!reservation || reservation.source !== 'guest_app') return;
      if (status === 'confirmed') {
        await notifyGuestByPhone(client, reservation.guest_phone, {
          title: 'Бронь подтверждена',
          text: `${reservation.date} в ${String(reservation.time).slice(0, 5)}, ${reservation.guests_count} гостей.`,
          type: 'reservation_confirmed',
          data: { reservation_id: reservation.id },
          push: true,
        });
      }
      if (status === 'waiting' || status === 'guests_arrived') {
        await notifyGuestByPhone(client, reservation.guest_phone, {
          title: 'Стол готов',
          text: 'Мы ждём вас в ресторане «Горы».',
          type: 'table_ready',
          data: { reservation_id: reservation.id },
          push: true,
        });
      }
    },
  };
}

module.exports = { registerCoordinationRoutes, HALL_SIGNAL_LABELS };
