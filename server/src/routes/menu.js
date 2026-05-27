const { requireExpectedVersion, sendVersionConflict } = require('../concurrency');

function canManageStopListItem(role, item) {
  if (['technician', 'manager', 'chef'].includes(role)) return true;
  if (role === 'bar') {
    const type = String(item?.item_type ?? '').toLowerCase();
    const text = `${item?.name ?? ''} ${item?.category_name ?? ''} ${item?.description ?? ''}`.toLowerCase();
    return ['bar', 'drink', 'alcohol'].includes(type) || /бар|напит|вино|алког|коктей|пиво|лимонад|чай|кофе|сок/.test(text);
  }
  if (role === 'cook') return Boolean(item?.is_kitchen);
  return false;
}

async function stopListMenuItem(client, id) {
  const result = await client.query(
    `SELECT mi.id, mi.name, mi.description, mi.item_type, mi.is_bar, mi.is_kitchen, mc.name AS category_name
     FROM menu_items mi
     JOIN menu_categories mc ON mc.id = mi.category_id
     WHERE mi.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

function denyStopListItemAccess(res) {
  res.status(403).json({ error: 'Нет прав менять стоп-лист для этой позиции меню.' });
}

function sendMissingMenuItem(res) {
  res.status(404).json({ error: 'Позиция меню не найдена.' });
}

function registerMenuRoutes(app, deps) {
  const {
    pool,
    query,
    asyncHandler,
    authMiddleware,
    requirePermission,
    randomUUID,
    emitChange,
    logActivity,
    notifyStopListChange,
    createRoleNotifications,
    rowById,
    canUseSupplyRequests,
    canManageRestaurant,
    targetGroupsForRole,
    getCoordinationApi,
  } = deps;

  app.post(
    '/stop-list',
    authMiddleware,
    requirePermission('manage:stoplist'),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const menuItem = await stopListMenuItem(client, req.body.menu_item_id);
        if (!menuItem) {
          sendMissingMenuItem(res);
          await client.query('ROLLBACK');
          return;
        }
        if (!canManageStopListItem(req.user.role, menuItem)) {
          denyStopListItemAccess(res);
          await client.query('ROLLBACK');
          return;
        }
        const duplicate = await client.query(
          `SELECT id
           FROM stop_list
           WHERE menu_item_id = $1
             AND status <> 'available'
           LIMIT 1`,
          [req.body.menu_item_id],
        );
        if (duplicate.rows[0]) {
          res.status(409).json({ error: 'Эта позиция уже есть в стоп-листе.' });
          await client.query('ROLLBACK');
          return;
        }
        const id = randomUUID();
        const result = await client.query(
          `INSERT INTO stop_list (id, menu_item_id, reason, status, added_by, created_at, expected_return_at, comment)
           VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7)
           RETURNING *`,
          [
            id,
            req.body.menu_item_id,
            req.body.reason ?? 'Нет причины',
            req.body.status ?? 'out',
            req.user.id,
            req.body.expected_return_at ?? null,
            req.body.comment ?? '',
          ],
        );
        await client.query('UPDATE menu_items SET status = $2, updated_at = NOW(), updated_by = $3, version = version + 1 WHERE id = $1', [
          req.body.menu_item_id,
          req.body.status === 'soon_out' ? 'soon_out' : 'stop',
          req.user.id,
        ]);
        await logActivity(client, req.user.id, 'stop_list.added', 'stop_list', id, null, result.rows[0]);
        await notifyStopListChange(client, result.rows[0], {
          title: 'Позиция добавлена в стоп-лист',
          type: 'stop_list',
        });
        await client.query('COMMIT');
        emitChange('stop_list', 'created', result.rows[0]);
        res.status(201).json(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.patch(
    '/stop-list/:id',
    authMiddleware,
    requirePermission('manage:stoplist'),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRow = await rowById(client, 'stop_list', req.params.id);
        if (!oldRow) {
          res.status(404).json({ error: 'Запись стоп-листа не найдена.' });
          await client.query('ROLLBACK');
          return;
        }
        const menuItem = await stopListMenuItem(client, oldRow.menu_item_id);
        if (!menuItem) {
          sendMissingMenuItem(res);
          await client.query('ROLLBACK');
          return;
        }
        if (!canManageStopListItem(req.user.role, menuItem)) {
          denyStopListItemAccess(res);
          await client.query('ROLLBACK');
          return;
        }
        const expectedVersion = requireExpectedVersion(req, res, oldRow);
        if (!expectedVersion) {
          await client.query('ROLLBACK');
          return;
        }
        const updated = await client.query(
          `UPDATE stop_list
           SET status = COALESCE($2, status),
               reason = COALESCE($3, reason),
               expected_return_at = COALESCE($4, expected_return_at),
               comment = COALESCE($5, comment),
               version = version + 1,
               updated_at = NOW()
           WHERE id = $1 AND version = $6
           RETURNING *`,
          [req.params.id, req.body.status ?? null, req.body.reason ?? null, req.body.expected_return_at ?? null, req.body.comment ?? null, expectedVersion],
        );
        if (!updated.rows[0]) {
          sendVersionConflict(res, await rowById(client, 'stop_list', req.params.id));
          await client.query('ROLLBACK');
          return;
        }

        if (req.body.status === 'available') {
          await client.query('UPDATE menu_items SET status = $2, updated_at = NOW(), updated_by = $3, version = version + 1 WHERE id = $1', [
            oldRow.menu_item_id,
            'available',
            req.user.id,
          ]);
        }

        await logActivity(client, req.user.id, 'stop_list.updated', 'stop_list', req.params.id, oldRow, updated.rows[0]);
        const coordinationApi = getCoordinationApi();
        const stopNotify = coordinationApi?.enhanceStopListChange ?? notifyStopListChange;
        await stopNotify(client, updated.rows[0], {
          title: req.body.status === 'available' ? 'Позиция снова доступна' : 'Стоп-лист обновлен',
          type: req.body.status === 'available' ? 'menu_restored' : 'stop_list',
          status: req.body.status,
        });
        await client.query('COMMIT');
        emitChange('stop_list', 'updated', updated.rows[0]);
        res.json(updated.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/supply-requests',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (!canUseSupplyRequests(req.user.role)) {
        res.status(403).json({ error: 'Раздел доступен кухне, бару и управляющему.' });
        return;
      }

      const result = await query(
        `INSERT INTO supply_requests
         (id, title, category, quantity, target_role, status, requested_by, comment, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         RETURNING *`,
        [
          randomUUID(),
          req.body.title,
          req.body.category ?? 'прочее',
          req.body.quantity ?? '',
          req.body.target_role ?? (req.user.role === 'bar' ? 'bar' : 'kitchen'),
          req.body.status ?? 'new',
          req.user.id,
          req.body.comment ?? '',
        ],
      );
      await createRoleNotifications(pool, [result.rows[0].target_role, 'management'], {
        title: 'Новая заявка',
        text: `${result.rows[0].title} - ${result.rows[0].quantity || 'количество уточняется'}`,
        type: 'supply_request',
        data: { supply_request_id: result.rows[0].id },
      });
      emitChange('supply_requests', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.patch(
    '/supply-requests/:id',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const oldResult = await query('SELECT * FROM supply_requests WHERE id = $1', [req.params.id]);
      const oldRow = oldResult.rows[0];
      if (!oldRow) {
        res.status(404).json({ error: 'Запись не найдена.' });
        return;
      }

      const groups = targetGroupsForRole(req.user.role);
      const canUpdate =
        canManageRestaurant(req.user.role) ||
        req.user.role === 'administrator' ||
        oldRow.requested_by === req.user.id ||
        groups.includes(oldRow.target_role);
      if (!canUpdate) {
        res.status(403).json({ error: 'Нет прав изменить эту запись.' });
        return;
      }

      const allowed = ['title', 'category', 'quantity', 'target_role', 'status', 'comment'];
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления записи.' });
        return;
      }

      const setSql = entries.map(([key], index) => `"${key}" = $${index + 2}`).join(', ');
      const values = [req.params.id, ...entries.map(([, value]) => value)];
      const result = await query(`UPDATE supply_requests SET ${setSql}, updated_at = NOW(), version = version + 1 WHERE id = $1 RETURNING *`, values);
      if (req.body?.status || req.body?.comment) {
        await createRoleNotifications(pool, [result.rows[0].target_role, 'management'], {
          title: 'Заявка обновлена',
          text: `${result.rows[0].title}: ${result.rows[0].status}`,
          type: 'supply_request_update',
          data: { supply_request_id: result.rows[0].id },
        });
      }
      emitChange('supply_requests', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.post(
    '/menu-items',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      const result = await query(
        `INSERT INTO menu_items
         (id, name, category_id, price, photo_url, composition, weight, cooking_time, allergens, calories, description, waiter_hint, recommendation, item_type, cost_price, cost_percent, is_bar, is_kitchen, spice_level, popularity, status, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),$22)
         RETURNING *`,
        [
          randomUUID(),
          req.body.name,
          req.body.category_id,
          Number(req.body.price ?? 0),
          req.body.photo_url ?? null,
          req.body.composition ?? '',
          req.body.weight ?? '',
          req.body.cooking_time ?? '',
          req.body.allergens ?? '',
          req.body.calories ?? '',
          req.body.description ?? '',
          req.body.waiter_hint ?? '',
          req.body.recommendation ?? '',
          req.body.item_type ?? 'food',
          req.body.cost_price ?? null,
          req.body.cost_percent ?? null,
          Boolean(req.body.is_bar),
          req.body.is_kitchen === undefined ? true : Boolean(req.body.is_kitchen),
          Number(req.body.spice_level ?? 0),
          Number(req.body.popularity ?? 0),
          req.body.status ?? 'available',
          req.user.id,
        ],
      );
      emitChange('menu_items', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.patch(
    '/menu-items/:id',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      const allowed = [
        'name',
        'category_id',
        'price',
        'photo_url',
        'composition',
        'weight',
        'cooking_time',
        'allergens',
        'calories',
        'description',
        'waiter_hint',
        'recommendation',
        'item_type',
        'cost_price',
        'cost_percent',
        'is_bar',
        'is_kitchen',
        'spice_level',
        'popularity',
        'status',
      ];
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления позиции.' });
        return;
      }
      const setSql = entries.map(([key], index) => `"${key}" = $${index + 2}`).join(', ');
      const values = [req.params.id, ...entries.map(([, value]) => value), req.user.id];
      const result = await query(
        `UPDATE menu_items
         SET ${setSql}, updated_at = NOW(), updated_by = $${values.length}, version = version + 1
         WHERE id = $1
         RETURNING *`,
        values,
      );
      emitChange('menu_items', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );
}

module.exports = { registerMenuRoutes };
