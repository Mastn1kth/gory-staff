function registerAdminRoutes(app, deps) {
  const {
    query,
    pool,
    asyncHandler,
    authMiddleware,
    requirePermission,
    randomUUID,
    httpError,
    publicGuest,
    canManageGuestClients,
    buildGuestPayload,
    addGuestBonusTransaction,
    logActivity,
    createRoleNotifications,
    emitChange,
    buildPeakHours,
    normalizeAnalyticsCounters,
    serverStatus,
    publicServerUrl,
    websocketUrlForApi,
  } = deps;

  function redemptionOrderAmount(body) {
    const value = Number(body?.order_amount ?? body?.orderAmount ?? body?.order_sum ?? body?.orderSum ?? body?.payment_amount ?? body?.paymentAmount ?? 0);
    if (!Number.isFinite(value) || value <= 0) throw httpError('Передайте сумму заказа для расчета лимита списания.', 400);
    return Math.round(value);
  }

  function maxRedemptionAmount(orderAmount) {
    return Math.floor(Number(orderAmount) * 0.2);
  }

  function validateRedemptionLimit(amount, orderAmount) {
    const maxAmount = maxRedemptionAmount(orderAmount);
    if (maxAmount <= 0) throw httpError('Для этого заказа нельзя списать бонусы.', 400);
    if (amount > maxAmount) throw httpError('Можно списать не больше 20% от суммы заказа. 1 балл = 1 рубль.', 400);
    return maxAmount;
  }

  app.get(
    '/admin/guests',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (!canManageGuestClients(req.user.role)) throw httpError('Клиентская база доступна только управляющему и администратору.', 403);
      const search = String(req.query.search ?? '').trim();
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
      const offset = Math.max(Number(req.query.offset ?? 0), 0);
      const params = [];
      let where = 'WHERE deleted_at IS NULL';
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where += ` AND (LOWER(name) LIKE $${params.length} OR phone LIKE $${params.length} OR LOWER(referral_code) LIKE $${params.length})`;
      }
      params.push(limit, offset);
      const result = await query(
        `SELECT
           id, name, phone, birthday, bonus_balance, lifetime_bonus_earned, lifetime_bonus_spent,
           loyalty_level, referral_code, referred_by, visits_count, total_spent, average_check,
           last_visit_at, favorite_category, status, marketing_consent, personal_data_consent,
           created_at, updated_at
         FROM guest_users
         ${where}
         ORDER BY updated_at DESC, created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      res.json({ items: result.rows.map(publicGuest), limit, offset });
    }),
  );

  app.get(
    '/admin/guests/:id',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (!canManageGuestClients(req.user.role)) throw httpError('Клиентская база доступна только управляющему и администратору.', 403);
      const client = await pool.connect();
      try {
        const payload = await buildGuestPayload(client, req.params.id);
        if (!payload.guest) throw httpError('Гость не найден.', 404);
        const notes = await client.query('SELECT * FROM guest_notes WHERE guest_id = $1 ORDER BY updated_at DESC LIMIT 30', [req.params.id]);
        res.json({ ...payload, notes: notes.rows });
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/admin/guests/:id/bonus',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (!canManageGuestClients(req.user.role)) throw httpError('Клиентская база доступна только управляющему и администратору.', 403);
      const operation = String(req.body?.operation ?? req.body?.type ?? 'manual_add');
      const rawAmount = Math.abs(Number(req.body?.amount ?? 0));
      if (!rawAmount || !Number.isFinite(rawAmount)) throw httpError('Введите сумму бонусов.', 400);
      const amount = operation === 'manual_remove' || operation === 'spend' ? -rawAmount : rawAmount;
      const type = amount < 0 ? 'manual_remove' : 'manual_add';
      const reason = String(req.body?.reason ?? (amount < 0 ? 'Ручное списание' : 'Ручное начисление')).trim();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const transaction = await addGuestBonusTransaction(client, {
          guestId: req.params.id,
          type,
          amount,
          reason,
          source: 'staff_admin',
          createdBy: req.user.id,
        });
        await logActivity(client, req.user.id, type, 'guest_user', req.params.id, null, { amount, reason });
        await createRoleNotifications(client, ['management'], {
          title: amount < 0 ? 'Ручное списание бонусов' : 'Ручное начисление бонусов',
          text: `${Math.abs(amount)} бонусов · ${reason}`,
          type: 'guest_bonus_manual',
          data: { guest_id: req.params.id, transaction_id: transaction.id, amount },
        });
        const payload = await buildGuestPayload(client, req.params.id);
        await client.query('COMMIT');
        emitChange('guest_users', 'updated', payload.guest);
        res.json({ transaction, ...payload });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/admin/guests/:id/bonus-redemptions',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (!canManageGuestClients(req.user.role)) throw httpError('Клиентская база доступна только управляющему и администратору.', 403);
      const amount = Math.round(Number(req.body?.amount ?? 0));
      if (!Number.isFinite(amount) || amount <= 0) throw httpError('Введите сумму бонусов для списания.', 400);
      const orderAmount = redemptionOrderAmount(req.body ?? {});
      const maxBonusAmount = validateRedemptionLimit(amount, orderAmount);
      const iikoOrderId = String(req.body?.iiko_order_id ?? req.body?.iikoOrderId ?? '').trim() || null;
      const localOrderId = String(req.body?.local_order_id ?? req.body?.localOrderId ?? '').trim() || null;
      if (!iikoOrderId && !localOrderId) {
        throw httpError('Передайте iiko_order_id или local_order_id для связи списания с оплачиваемым заказом.', 400);
      }
      const requestedSessionId = String(req.body?.table_session_id ?? req.body?.tableSessionId ?? '').trim() || null;
      const reason = String(req.body?.reason ?? 'Списание бонусов к заказу iiko').trim();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const guest = (
          await client.query('SELECT * FROM guest_users WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [req.params.id])
        ).rows[0];
        if (!guest) throw httpError('Гость не найден.', 404);

        const session = requestedSessionId
          ? (
              await client.query(
                `SELECT *
                 FROM table_guest_sessions
                 WHERE id = $1 AND guest_id = $2
                 LIMIT 1`,
                [requestedSessionId, req.params.id],
              )
            ).rows[0]
          : (
              await client.query(
                `SELECT *
                 FROM table_guest_sessions
                 WHERE guest_id = $1 AND status = 'active'
                 ORDER BY checked_in_at DESC
                 LIMIT 1`,
                [req.params.id],
              )
            ).rows[0];
        if (!session) throw httpError('Активный визит гостя не найден.', 400);

        if (localOrderId) {
          const order = (
            await client.query(
              `SELECT id
               FROM guest_orders
               WHERE id = $1
                 AND guest_id = $2
                 AND (table_session_id = $3 OR table_session_id IS NULL)
               LIMIT 1`,
              [localOrderId, req.params.id, session.id],
            )
          ).rows[0];
          if (!order) throw httpError('Заказ не найден для текущего гостя.', 404);
        }

        const transaction = await addGuestBonusTransaction(client, {
          guestId: req.params.id,
          type: 'iiko_bonus_redeem',
          amount: -amount,
          reason,
          source: 'staff_iiko_payment',
          relatedVisitId: session.id,
          createdBy: req.user.id,
          iikoOrderId,
          localOrderId,
          tableSessionId: session.id,
        });
        const redemption = (
          await client.query(
            `INSERT INTO guest_bonus_redemptions
               (id, guest_id, table_session_id, local_order_id, iiko_order_id,
                bonus_transaction_id, amount, order_amount, max_bonus_amount, bonus_to_ruble_rate,
                status, reason, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'reserved',$10,NOW(),NOW())
             RETURNING *`,
            [
              randomUUID(),
              req.params.id,
              session.id,
              localOrderId,
              iikoOrderId,
              transaction.id,
              amount,
              orderAmount,
              maxBonusAmount,
              reason,
            ],
          )
        ).rows[0];
        await logActivity(client, req.user.id, 'iiko_bonus_redeem', 'guest_user', req.params.id, null, {
          amount,
          order_amount: orderAmount,
          max_bonus_amount: maxBonusAmount,
          iiko_order_id: iikoOrderId,
          redemption_id: redemption.id,
        });
        await createRoleNotifications(client, ['management'], {
          title: 'Списание бонусов к iiko-заказу',
          text: `${amount} бонусов · лимит ${maxBonusAmount} · ${reason}`,
          type: 'iiko_bonus_redeem',
          data: { guest_id: req.params.id, transaction_id: transaction.id, redemption_id: redemption.id, iiko_order_id: iikoOrderId },
        });
        const payload = await buildGuestPayload(client, req.params.id);
        await client.query('COMMIT');
        emitChange('guest_users', 'updated', payload.guest);
        emitChange('guest_bonus_redemptions', 'created', redemption);
        res.status(201).json({ redemption, transaction, guest: payload.guest });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.patch(
    '/admin/guests/:id/status',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (!canManageGuestClients(req.user.role)) throw httpError('Клиентская база доступна только управляющему и администратору.', 403);
      const status = String(req.body?.status ?? '');
      if (!['active', 'blocked', 'inactive'].includes(status)) throw httpError('Некорректный статус гостя.', 400);
      const oldValue = await query('SELECT * FROM guest_users WHERE id = $1', [req.params.id]);
      const result = await query('UPDATE guest_users SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *', [req.params.id, status]);
      if (!result.rows[0]) throw httpError('Гость не найден.', 404);
      await logActivity(pool, req.user.id, 'guest.status_changed', 'guest_user', req.params.id, oldValue.rows[0] ?? null, result.rows[0]);
      emitChange('guest_users', 'updated', publicGuest(result.rows[0]));
      res.json(publicGuest(result.rows[0]));
    }),
  );

  app.post(
    '/admin/guests/:id/notes',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (!canManageGuestClients(req.user.role)) throw httpError('Клиентская база доступна только управляющему и администратору.', 403);
      const guest = await query('SELECT * FROM guest_users WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
      if (!guest.rows[0]) throw httpError('Гость не найден.', 404);
      const note = String(req.body?.note ?? '').trim();
      if (!note) throw httpError('Введите заметку.', 400);
      const result = await query(
        `INSERT INTO guest_notes (id, guest_id, guest_name, guest_phone, preferences, allergens, note, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         RETURNING *`,
        [
          randomUUID(),
          req.params.id,
          guest.rows[0].name,
          guest.rows[0].phone,
          req.body?.preferences ?? '',
          req.body?.allergens ?? '',
          note,
          req.user.id,
        ],
      );
      emitChange('guest_notes', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.get(
    '/analytics',
    authMiddleware,
    requirePermission('view:analytics'),
    asyncHandler(async (_req, res) => {
      const result = await query(
        `SELECT
          (SELECT COUNT(*)::int FROM reservations WHERE date = CURRENT_DATE) AS reservations_today,
          (SELECT COUNT(*)::int FROM reservations WHERE date >= CURRENT_DATE AND date < CURRENT_DATE + INTERVAL '7 days') AS reservations_week,
          (SELECT COALESCE(SUM(guests_count), 0)::int FROM reservations WHERE date = CURRENT_DATE AND status NOT IN ('cancelled', 'no_show')) AS guests_today,
          (SELECT COUNT(*)::int FROM reservations WHERE status = 'cancelled' AND date >= CURRENT_DATE - INTERVAL '7 days') AS cancelled_week,
          (SELECT COUNT(*)::int FROM reservations WHERE status = 'no_show' AND date >= CURRENT_DATE - INTERVAL '7 days') AS no_show_week,
          (SELECT COUNT(*)::int FROM "tables" WHERE status = 'free') AS free_tables,
          (SELECT COUNT(*)::int FROM "tables" WHERE status IN ('occupied', 'banquet')) AS busy_tables,
          (SELECT COUNT(*)::int FROM stop_list WHERE status <> 'available') AS stop_list_count,
          (SELECT COUNT(*)::int FROM tasks WHERE status = 'done') AS completed_tasks,
          (SELECT COUNT(*)::int FROM tasks) AS total_tasks`,
      );

      const reservationTimes = await query(
        `SELECT time
         FROM reservations
         WHERE date >= CURRENT_DATE - INTERVAL '14 days'`,
      );

      const stopListItems = await query(
        `SELECT mi.name, COUNT(*)::int AS count
         FROM stop_list sl
         JOIN menu_items mi ON mi.id = sl.menu_item_id
         GROUP BY mi.name
         ORDER BY count DESC
         LIMIT 5`,
      );

      const chatActivity = await query(
        `SELECT u.name, COUNT(m.id)::int AS messages
         FROM users u
         LEFT JOIN chat_messages m ON m.sender_id = u.id AND m.created_at >= NOW() - INTERVAL '7 days'
         GROUP BY u.id, u.name
         ORDER BY messages DESC
         LIMIT 7`,
      );

      res.json({
        ...normalizeAnalyticsCounters(result.rows[0] ?? {}),
        peak_hours: buildPeakHours(reservationTimes.rows),
        stop_list_items: stopListItems.rows,
        chat_activity: chatActivity.rows,
      });
    }),
  );
}

module.exports = { registerAdminRoutes };
