const { requireExpectedVersion, sendVersionConflict } = require('../concurrency');

function registerFloorRoutes(app, deps) {
  const {
    pool,
    query,
    asyncHandler,
    authMiddleware,
    requirePermission,
    randomUUID,
    emitChange,
    logActivity,
    createRoleNotifications,
    createNotification,
    rowById,
    getReservationConflict,
    reservationPushText,
    getCoordinationApi,
    canManageFloorLayout,
    can,
  } = deps;

  app.patch(
    '/tables/:id',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const allowed = ['status', 'comment', 'current_waiter_id', 'x_position', 'y_position', 'width', 'height', 'shape', 'seats', 'floor_id'];
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);

      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления столика.' });
        return;
      }

      const layoutFields = new Set(['x_position', 'y_position', 'width', 'height', 'shape', 'seats', 'floor_id']);
      if (entries.some(([key]) => layoutFields.has(key)) && !canManageFloorLayout(req.user.role)) {
        res.status(403).json({ error: 'План зала может менять только управляющий или техник.' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRow = await rowById(client, 'tables', req.params.id);
        if (!oldRow) {
          res.status(404).json({ error: 'Столик не найден.' });
          await client.query('ROLLBACK');
          return;
        }

        const statusOnly = entries.length === 1 && entries[0][0] === 'status';
        const waiterMarksReady =
          req.user.role === 'waiter' &&
          statusOnly &&
          oldRow.current_waiter_id === req.user.id &&
          oldRow.status === 'cleaning' &&
          req.body.status === 'free';
        if (!can(req.user.role, 'manage:floor') && !waiterMarksReady) {
          res.status(403).json({ error: 'Нет прав менять этот стол.' });
          await client.query('ROLLBACK');
          return;
        }

        const expectedVersion = requireExpectedVersion(req, res, oldRow);
        if (!expectedVersion) {
          await client.query('ROLLBACK');
          return;
        }

        const setSql = entries.map(([key], index) => `"${key}" = $${index + 3}`).join(', ');
        const values = [req.params.id, expectedVersion, ...entries.map(([, value]) => value)];
        const updated = await client.query(
          `UPDATE "tables"
           SET ${setSql}, version = version + 1, updated_at = NOW()
           WHERE id = $1 AND version = $2
           RETURNING *`,
          values,
        );
        if (!updated.rows[0]) {
          sendVersionConflict(res, await rowById(client, 'tables', req.params.id));
          await client.query('ROLLBACK');
          return;
        }

        await logActivity(client, req.user.id, 'table.updated', 'table', req.params.id, oldRow, updated.rows[0]);
        if (oldRow.status !== updated.rows[0].status) {
          await createRoleNotifications(client, ['hostess', 'management'], {
            title: `Стол ${updated.rows[0].number}: обновлён статус`,
            text: `Новый статус: ${updated.rows[0].status}`,
            type: 'table',
            data: { table_id: req.params.id },
          });
          if (updated.rows[0].current_waiter_id) {
            await createNotification(client, {
              userId: updated.rows[0].current_waiter_id,
              title: `Стол ${updated.rows[0].number}: новый статус`,
              text: `Статус: ${updated.rows[0].status}`,
              type: 'table_status',
              data: { table_id: req.params.id },
            });
          }
        }
        if (updated.rows[0].current_waiter_id && oldRow.current_waiter_id !== updated.rows[0].current_waiter_id) {
          await createNotification(client, {
            userId: updated.rows[0].current_waiter_id,
            title: `Вам назначен стол ${updated.rows[0].number}`,
            text: `${updated.rows[0].seats} мест · статус ${updated.rows[0].status}`,
            type: 'table_assigned',
            data: { table_id: req.params.id },
          });
        }
        await client.query('COMMIT');
        emitChange('tables', 'updated', updated.rows[0]);
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
    '/tables',
    authMiddleware,
    asyncHandler(async (req, res) => {
      if (!canManageFloorLayout(req.user.role)) {
        res.status(403).json({ error: 'План зала может менять только управляющий или техник.' });
        return;
      }
      const row = {
        id: randomUUID(),
        floor_id: req.body.floor_id,
        number: req.body.number,
        seats: Number(req.body.seats ?? 2),
        x_position: Number(req.body.x_position ?? 10),
        y_position: Number(req.body.y_position ?? 10),
        width: Number(req.body.width ?? 14),
        height: Number(req.body.height ?? 14),
        shape: req.body.shape ?? 'square',
        status: req.body.status ?? 'free',
        current_waiter_id: req.body.current_waiter_id ?? null,
        comment: req.body.comment ?? '',
      };

      const result = await query(
        `INSERT INTO "tables" (id, floor_id, number, seats, x_position, y_position, width, height, shape, status, current_waiter_id, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        Object.values(row),
      );
      emitChange('tables', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.post(
    '/reservations',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const conflict = await getReservationConflict(client, req.body);
        if (conflict) {
          res.status(409).json({ error: `Столик забронирован на это время: ${conflict.guest_name} в ${conflict.time}.` });
          await client.query('ROLLBACK');
          return;
        }

        const id = randomUUID();
        const result = await client.query(
          `INSERT INTO reservations
           (id, guest_name, guest_phone, date, time, guests_count, table_id, occasion, status, source, comment, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
           RETURNING *`,
          [
            id,
            req.body.guest_name,
            req.body.guest_phone,
            req.body.date,
            req.body.time,
            Number(req.body.guests_count ?? 1),
            req.body.table_id ?? null,
            req.body.occasion ?? 'regular',
            req.body.status ?? 'new',
            req.body.source ?? 'app',
            req.body.comment ?? '',
            req.user.id,
          ],
        );

        if (result.rows[0].table_id && ['new', 'confirmed', 'waiting'].includes(result.rows[0].status)) {
          await client.query(
            `UPDATE "tables"
             SET status = CASE WHEN $2 = 'waiting' THEN 'expected' ELSE 'reserved' END,
                 version = version + 1,
                 updated_at = NOW()
             WHERE id = $1 AND status IN ('free', 'reserved', 'expected', 'soon_reserved')`,
            [result.rows[0].table_id, result.rows[0].status],
          );
        }

        await logActivity(client, req.user.id, 'reservation.created', 'reservation', id, null, result.rows[0]);
        await createRoleNotifications(client, ['hostess', 'management'], {
          title: 'Новая бронь',
          text: reservationPushText(result.rows[0]),
          type: 'reservation',
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

  app.patch(
    '/reservations/:id',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const allowed = ['guest_name', 'guest_phone', 'date', 'time', 'guests_count', 'table_id', 'occasion', 'status', 'source', 'comment', 'call_status', 'call_comment'];
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления брони.' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRow = await rowById(client, 'reservations', req.params.id);
        if (!oldRow) {
          res.status(404).json({ error: 'Бронь не найдена.' });
          await client.query('ROLLBACK');
          return;
        }
        const nextCandidate = { ...oldRow, ...req.body, excludeId: req.params.id };
        const conflict = await getReservationConflict(client, nextCandidate);
        if (conflict) {
          res.status(409).json({ error: `Конфликт бронирования: ${conflict.guest_name} в ${conflict.time}.` });
          await client.query('ROLLBACK');
          return;
        }

        const expectedVersion = requireExpectedVersion(req, res, oldRow);
        if (!expectedVersion) {
          await client.query('ROLLBACK');
          return;
        }

        const setSql = entries.map(([key], index) => `"${key}" = $${index + 3}`).join(', ');
        const values = [req.params.id, expectedVersion, ...entries.map(([, value]) => value)];
        const updated = await client.query(
          `UPDATE reservations
           SET ${setSql}, version = version + 1, updated_at = NOW()
           WHERE id = $1 AND version = $2
           RETURNING *`,
          values,
        );
        if (!updated.rows[0]) {
          sendVersionConflict(res, await rowById(client, 'reservations', req.params.id));
          await client.query('ROLLBACK');
          return;
        }
        await logActivity(client, req.user.id, 'reservation.updated', 'reservation', req.params.id, oldRow, updated.rows[0]);
        await createRoleNotifications(client, ['hostess', 'management'], {
          title: 'Бронь обновлена',
          text: reservationPushText(updated.rows[0]),
          type: 'reservation_update',
          data: { reservation_id: req.params.id },
        });
        await client.query('COMMIT');
        emitChange('reservations', 'updated', updated.rows[0]);
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
    '/reservations/:id/status',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const { status } = req.body ?? {};
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRow = await rowById(client, 'reservations', req.params.id);
        if (!oldRow) {
          res.status(404).json({ error: 'Бронь не найдена.' });
          await client.query('ROLLBACK');
          return;
        }
        if (!['new', 'confirmed', 'waiting', 'guests_arrived', 'seated', 'guests_left', 'cancelled', 'no_show'].includes(status)) {
          res.status(400).json({ error: 'Некорректный статус брони.' });
          await client.query('ROLLBACK');
          return;
        }

        const expectedVersion = requireExpectedVersion(req, res, oldRow);
        if (!expectedVersion) {
          await client.query('ROLLBACK');
          return;
        }

        const updated = await client.query(
          `UPDATE reservations
           SET status = $3, version = version + 1, updated_at = NOW()
           WHERE id = $1 AND version = $2
           RETURNING *`,
          [req.params.id, expectedVersion, status],
        );
        if (!updated.rows[0]) {
          sendVersionConflict(res, await rowById(client, 'reservations', req.params.id));
          await client.query('ROLLBACK');
          return;
        }

        const tableStatusByReservation = {
          new: 'reserved',
          confirmed: 'reserved',
          waiting: 'expected',
          guests_arrived: 'occupied',
          seated: 'occupied',
          guests_left: 'cleaning',
          cancelled: 'free',
          no_show: 'free',
        };
        const tableStatus = tableStatusByReservation[status];
        if (oldRow.table_id && tableStatus) {
          await client.query('UPDATE "tables" SET status = $2, version = version + 1, updated_at = NOW() WHERE id = $1', [oldRow.table_id, tableStatus]);
        }

        await logActivity(client, req.user.id, 'reservation.status_changed', 'reservation', req.params.id, oldRow, updated.rows[0]);
        await createRoleNotifications(client, ['hostess', 'management'], {
          title: 'Статус брони изменён',
          text: `${updated.rows[0].guest_name}: ${updated.rows[0].status}`,
          type: 'reservation_status',
          data: { reservation_id: req.params.id },
        });
        const coordinationApi = getCoordinationApi();
        if (coordinationApi) {
          await coordinationApi.notifyGuestReservationStatus(client, updated.rows[0], status);
        }
        await client.query('COMMIT');
        emitChange('reservations', 'status_changed', updated.rows[0]);
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
    '/waitlist',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const result = await query(
        `INSERT INTO waitlist_entries
         (id, guest_name, guest_phone, guests_count, desired_time, status, comment, call_status, call_comment, seated_table_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         RETURNING *`,
        [
          randomUUID(),
          req.body.guest_name,
          req.body.guest_phone ?? '',
          Number(req.body.guests_count ?? 1),
          req.body.desired_time ?? '19:00',
          req.body.status ?? 'waiting',
          req.body.comment ?? '',
          req.body.call_status ?? 'not_called',
          req.body.call_comment ?? '',
          req.body.seated_table_id ?? null,
          req.user.id,
        ],
      );
      await createRoleNotifications(pool, ['hostess', 'management'], {
        title: 'Гость в листе ожидания',
        text: `${result.rows[0].guest_name}, ${result.rows[0].guests_count} гостей`,
        type: 'waitlist',
        data: { waitlist_id: result.rows[0].id },
      });
      emitChange('waitlist_entries', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.patch(
    '/waitlist/:id',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const allowed = ['guest_name', 'guest_phone', 'guests_count', 'desired_time', 'status', 'comment', 'call_status', 'call_comment', 'seated_table_id'];
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления листа ожидания.' });
        return;
      }

      const oldRow = await query('SELECT * FROM waitlist_entries WHERE id = $1', [req.params.id]);
      if (!oldRow.rows[0]) {
        res.status(404).json({ error: 'Гость в листе ожидания не найден.' });
        return;
      }
      const expectedVersion = requireExpectedVersion(req, res, oldRow.rows[0]);
      if (!expectedVersion) return;

      const setSql = entries.map(([key], index) => `"${key}" = $${index + 3}`).join(', ');
      const values = [req.params.id, expectedVersion, ...entries.map(([, value]) => value)];
      const result = await query(
        `UPDATE waitlist_entries
         SET ${setSql}, version = version + 1, updated_at = NOW()
         WHERE id = $1 AND version = $2
         RETURNING *`,
        values,
      );
      if (!result.rows[0]) {
        sendVersionConflict(res, (await query('SELECT * FROM waitlist_entries WHERE id = $1', [req.params.id])).rows[0]);
        return;
      }
      if (req.body?.status || req.body?.seated_table_id) {
        await createRoleNotifications(pool, ['hostess', 'management'], {
          title: 'Лист ожидания обновлён',
          text: `${result.rows[0].guest_name}: ${result.rows[0].status}`,
          type: 'waitlist_update',
          data: { waitlist_id: result.rows[0].id },
        });
      }
      emitChange('waitlist_entries', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.post(
    '/guest-notes',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const result = await query(
        `INSERT INTO guest_notes
         (id, guest_name, guest_phone, preferences, allergens, note, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
         RETURNING *`,
        [
          randomUUID(),
          req.body.guest_name,
          req.body.guest_phone ?? '',
          req.body.preferences ?? '',
          req.body.allergens ?? '',
          req.body.note ?? '',
          req.user.id,
        ],
      );
      emitChange('guest_notes', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.patch(
    '/guest-notes/:id',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const allowed = ['guest_name', 'guest_phone', 'preferences', 'allergens', 'note'];
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления VIP-гостя.' });
        return;
      }

      const setSql = entries.map(([key], index) => `"${key}" = $${index + 2}`).join(', ');
      const values = [req.params.id, ...entries.map(([, value]) => value)];
      const result = await query(`UPDATE guest_notes SET ${setSql}, updated_at = NOW() WHERE id = $1 RETURNING *`, values);
      if (!result.rows[0]) {
        res.status(404).json({ error: 'Карточка гостя не найдена.' });
        return;
      }
      emitChange('guest_notes', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );
}

module.exports = { registerFloorRoutes };
