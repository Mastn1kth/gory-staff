const { requireExpectedVersion, sendVersionConflict } = require('../concurrency');

function registerStaffRoutes(app, deps) {
  const {
    pool,
    query,
    asyncHandler,
    authMiddleware,
    requirePermission,
    requireManager,
    bcrypt,
    randomUUID,
    emitChange,
    logActivity,
    createNotification,
    createRoleNotifications,
    addUserToRoleChats,
    serverDate,
    targetGroupsForRole,
    can,
    canManageAllTasks,
    canManageRestaurant,
    currentShiftForUser,
    sendChatPush,
    io,
  } = deps;

  app.post(
    '/notebook',
    authMiddleware,
    requirePermission('view:notebook'),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const shift = req.body?.shift_id ? { id: req.body.shift_id } : await currentShiftForUser(client, req.user.id);
        const result = await client.query(
          `INSERT INTO notebook_notes (id, user_id, shift_id, title, body, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
           RETURNING *`,
          [
            randomUUID(),
            req.user.id,
            shift?.id ?? null,
            String(req.body?.title ?? '').trim() || 'Заметка',
            String(req.body?.body ?? '').trim(),
          ],
        );
        emitChange('notebook_notes', 'created', result.rows[0]);
        res.status(201).json(result.rows[0]);
      } finally {
        client.release();
      }
    }),
  );

  app.patch(
    '/notebook/:id',
    authMiddleware,
    requirePermission('view:notebook'),
    asyncHandler(async (req, res) => {
      const oldResult = await query('SELECT * FROM notebook_notes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      if (!oldResult.rows[0]) {
        res.status(404).json({ error: 'Запись не найдена.' });
        return;
      }
      const expectedVersion = requireExpectedVersion(req, res, oldResult.rows[0]);
      if (!expectedVersion) return;

      const result = await query(
        `UPDATE notebook_notes
         SET title = COALESCE($3, title),
             body = COALESCE($4, body),
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1 AND user_id = $2 AND version = $5
         RETURNING *`,
        [req.params.id, req.user.id, req.body?.title ?? null, req.body?.body ?? null, expectedVersion],
      );
      if (!result.rows[0]) {
        const current = await query('SELECT * FROM notebook_notes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        sendVersionConflict(res, current.rows[0]);
        return;
      }
      emitChange('notebook_notes', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.delete(
    '/notebook/:id',
    authMiddleware,
    requirePermission('view:notebook'),
    asyncHandler(async (req, res) => {
      const result = await query('DELETE FROM notebook_notes WHERE id = $1 AND user_id = $2 RETURNING *', [req.params.id, req.user.id]);
      if (!result.rows[0]) {
        res.status(404).json({ error: 'Запись не найдена.' });
        return;
      }
      emitChange('notebook_notes', 'deleted', result.rows[0]);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/chat/messages',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const { chat_id, message_text, message_type = 'text', file_url = null } = req.body ?? {};
      const member = await query('SELECT * FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chat_id, req.user.id]);
      if (!member.rows[0] && !canManageRestaurant(req.user.role)) {
        res.status(403).json({ error: 'Вы не состоите в этом чате.' });
        return;
      }
      const result = await query(
        `INSERT INTO chat_messages (id, chat_id, sender_id, message_text, message_type, file_url, is_pinned, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE,NOW())
         RETURNING *`,
        [randomUUID(), chat_id, req.user.id, message_text, message_type, file_url],
      );
      emitChange('chat_messages', 'created', result.rows[0]);
      io.to(chat_id).emit('chat:message', result.rows[0]);
      void sendChatPush(chat_id, req.user, result.rows[0]).catch((error) => {
        console.warn('Chat push skipped:', error.message);
      });
      res.status(201).json(result.rows[0]);
    }),
  );

  app.patch(
    '/chat/messages/:id/pin',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const oldResult = await query('SELECT * FROM chat_messages WHERE id = $1', [req.params.id]);
      const oldRow = oldResult.rows[0];
      if (!oldRow) {
        res.status(404).json({ error: 'Чат не найден.' });
        return;
      }

      const chat = await query('SELECT * FROM chats WHERE id = $1', [oldRow.chat_id]);
      const canPin = can(req.user.role, 'chat:pin_shift') && chat.rows[0]?.type === 'shift';
      if (!canPin) {
        res.status(403).json({ error: 'Нет прав закреплять сообщения в этом чате.' });
        return;
      }

      const result = await query('UPDATE chat_messages SET is_pinned = $2 WHERE id = $1 RETURNING *', [req.params.id, Boolean(req.body.is_pinned)]);
      emitChange('chat_messages', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.post(
    '/announcements',
    authMiddleware,
    requirePermission('manage:announcements'),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO announcements (id, title, text, author_id, target_role, importance, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           RETURNING *`,
          [
            randomUUID(),
            req.body.title,
            req.body.text,
            req.user.id,
            req.body.target_role ?? 'all',
            req.body.importance ?? 'normal',
          ],
        );
        await createNotification(client, {
          title: req.body.title,
          text: req.body.text,
          type: req.body.importance === 'urgent' ? 'urgent_news' : 'news',
          targetRole: req.body.target_role ?? 'all',
        });
        await client.query('COMMIT');
        emitChange('announcements', 'created', result.rows[0]);
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
    '/notifications/:id/read',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const groups = targetGroupsForRole(req.user.role);
      const result = await query(
        `UPDATE notifications
         SET is_read = TRUE,
             read_at = NOW()
         WHERE id = $1
           AND (user_id = $2 OR target_role = ANY($3::text[]))
         RETURNING *`,
        [req.params.id, req.user.id, groups],
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: 'Запись не найдена.' });
        return;
      }
      emitChange('notifications', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.post(
    '/tasks',
    authMiddleware,
    requirePermission('manage:tasks'),
    asyncHandler(async (req, res) => {
      const result = await query(
        `INSERT INTO tasks (id, title, description, assigned_to, due_date, status, comment, created_by, photo_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          randomUUID(),
          req.body.title,
          req.body.description ?? '',
          req.body.assigned_to ?? null,
          req.body.due_date ?? new Date().toISOString(),
          req.body.status ?? 'new',
          req.body.comment ?? '',
          req.user.id,
          Boolean(req.body.photo_required),
        ],
      );
      await createNotification(pool, {
        userId: result.rows[0].assigned_to ?? null,
        targetRole: result.rows[0].assigned_to ? 'all' : 'management',
        title: 'Новая задача',
        text: result.rows[0].title,
        type: 'task',
        data: { task_id: result.rows[0].id },
      });
      emitChange('tasks', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.patch(
    '/tasks/:id',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const oldResult = await query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
      const oldRow = oldResult.rows[0];
      if (!oldRow) {
        res.status(404).json({ error: 'Сотрудник не найден.' });
        return;
      }
      if (!canManageAllTasks(req.user.role) && oldRow.assigned_to !== req.user.id) {
        res.status(403).json({ error: 'Можно менять только свою задачу.' });
        return;
      }
      const expectedVersion = requireExpectedVersion(req, res, oldRow);
      if (!expectedVersion) return;

      const result = await query(
        `UPDATE tasks
         SET status = COALESCE($2, status),
             comment = COALESCE($3, comment),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND version = $4
         RETURNING *`,
        [req.params.id, req.body.status ?? null, req.body.comment ?? null, expectedVersion],
      );
      if (!result.rows[0]) {
        const current = await query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
        sendVersionConflict(res, current.rows[0]);
        return;
      }
      if (result.rows[0].assigned_to && (req.body.status || req.body.comment)) {
        await createNotification(pool, {
          userId: result.rows[0].assigned_to,
          title: req.body.status === 'done' ? 'Задача закрыта' : 'Задача обновлена',
          text: result.rows[0].title,
          type: 'task_update',
          data: { task_id: result.rows[0].id, status: result.rows[0].status },
        });
      }
      if (req.body.status === 'done') {
        await createRoleNotifications(pool, ['management'], {
          title: 'Задача выполнена',
          text: result.rows[0].title,
          type: 'task_done',
          data: { task_id: result.rows[0].id, user_id: result.rows[0].assigned_to },
        });
      }
      emitChange('tasks', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.post(
    '/users',
    authMiddleware,
    requireManager,
    asyncHandler(async (req, res) => {
      const password = String(req.body.password ?? '').trim();
      if (password.length < 8) {
        res.status(400).json({ error: 'Временный пароль сотрудника должен быть не короче 8 символов.' });
        return;
      }
      const passwordHash = bcrypt.hashSync(password, 10);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const role = req.body.role ?? 'waiter';
        const result = await client.query(
          `INSERT INTO users (id, name, phone, login, password_hash, password_plain, role, position, status, photo_url, comment, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
           RETURNING id, name, phone, login, role, position, status, photo_url, comment, created_at, updated_at, version`,
          [
            randomUUID(),
            req.body.name,
            req.body.phone ?? '',
            req.body.login,
            passwordHash,
            password,
            role,
            req.body.position ?? 'Сотрудник',
            req.body.status ?? 'off_shift',
            req.body.photo_url ?? null,
            req.body.comment ?? '',
          ],
        );
        await addUserToRoleChats(client, result.rows[0].id, role);
        await client.query('COMMIT');
        emitChange('users', 'created', result.rows[0]);
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
    '/users/:id/password',
    authMiddleware,
    requireManager,
    asyncHandler(async (req, res) => {
      const password = String(req.body?.password ?? req.body?.new_password ?? req.body?.newPassword ?? '').trim();
      if (password.length < 8) {
        res.status(400).json({ error: 'Новый пароль сотрудника должен быть не короче 8 символов.' });
        return;
      }

      const passwordHash = bcrypt.hashSync(password, 10);
      const result = await query(
        `UPDATE users
         SET password_hash = $2,
             password_plain = $3,
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1
         RETURNING id, name, phone, login, role, position, status, photo_url, comment, created_at, updated_at, version`,
        [req.params.id, passwordHash, password],
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: 'Сотрудник не найден.' });
        return;
      }

      await logActivity(pool, req.user.id, 'user.password_reset', 'user', req.params.id, null, { reset_by: req.user.id });
      emitChange('users', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.patch(
    '/users/:id',
    authMiddleware,
    requireManager,
    asyncHandler(async (req, res) => {
      const allowed = ['name', 'phone', 'role', 'position', 'status', 'photo_url', 'comment'];
      const isSelfUpdate = req.params.id === req.user.id;
      const dangerousSelfStatuses = new Set(['inactive', 'blocked', 'fired']);
      if (isSelfUpdate && dangerousSelfStatuses.has(String(req.body?.status ?? ''))) {
        res.status(400).json({ error: 'Нельзя заблокировать или уволить самого себя. Попросите другого управляющего.' });
        return;
      }
      if (isSelfUpdate && req.body?.role && req.body.role !== req.user.role) {
        res.status(400).json({ error: 'Нельзя менять собственную роль. Попросите другого управляющего.' });
        return;
      }
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления сотрудника.' });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const setSql = entries.map(([key], index) => `"${key}" = $${index + 2}`).join(', ');
        const values = [req.params.id, ...entries.map(([, value]) => value)];
        const result = await client.query(
          `UPDATE users SET ${setSql}, updated_at = NOW(), version = version + 1 WHERE id = $1
           RETURNING id, name, phone, login, role, position, status, photo_url, comment, created_at, updated_at, version`,
          values,
        );
        if (!result.rows[0]) {
          res.status(404).json({ error: 'Сотрудник не найден.' });
          await client.query('ROLLBACK');
          return;
        }
        if (req.body.role) {
          await addUserToRoleChats(client, req.params.id, req.body.role);
        }
        if (req.body.status === 'on_shift' || req.body.status === 'off_shift') {
          await client.query(
            `UPDATE shifts
             SET status = CASE WHEN $2 = 'on_shift' THEN 'active' ELSE 'done' END,
                 updated_at = NOW(),
                 version = version + 1
             WHERE user_id = $1 AND date = $3`,
            [req.params.id, req.body.status, serverDate()],
          );
        }
        await client.query('COMMIT');
        emitChange('users', 'updated', result.rows[0]);
        res.json(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/shifts',
    authMiddleware,
    requireManager,
    asyncHandler(async (req, res) => {
      const result = await query(
        `INSERT INTO shifts (id, user_id, date, start_time, end_time, position, zone, status, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          randomUUID(),
          req.body.user_id,
          req.body.date,
          req.body.start_time,
          req.body.end_time,
          req.body.position,
          req.body.zone ?? '',
          req.body.status ?? 'planned',
          req.body.comment ?? '',
        ],
      );
      emitChange('shifts', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.post(
    '/events',
    authMiddleware,
    requirePermission('manage:events'),
    asyncHandler(async (req, res) => {
      const result = await query(
        `INSERT INTO events
         (id, title, type, date, time, guests_count, customer_name, customer_phone, floor_id, table_ids, banquet_menu, comment, kitchen_comment, waiter_comment, responsible_user_id, deposit_amount, prepayment_status, call_status, status, alcohol_required, alcohol_available, alcohol_actual, alcohol_comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING *`,
        [
          randomUUID(),
          req.body.title,
          req.body.type ?? 'birthday',
          req.body.date,
          req.body.time,
          Number(req.body.guests_count ?? 1),
          req.body.customer_name,
          req.body.customer_phone,
          req.body.floor_id ?? null,
          JSON.stringify(req.body.table_ids ?? []),
          JSON.stringify(req.body.banquet_menu ?? []),
          req.body.comment ?? '',
          req.body.kitchen_comment ?? '',
          req.body.waiter_comment ?? '',
          req.body.responsible_user_id ?? req.user.id,
          Number(req.body.deposit_amount ?? 0),
          req.body.prepayment_status ?? 'not_required',
          req.body.call_status ?? 'not_called',
          req.body.status ?? 'new',
          Number(req.body.alcohol_required ?? 0),
          Number(req.body.alcohol_available ?? 0),
          Number(req.body.alcohol_actual ?? 0),
          req.body.alcohol_comment ?? '',
        ],
      );
      await createRoleNotifications(pool, ['hostess', 'waiter', 'kitchen', 'bar', 'management'], {
        title: 'Новое мероприятие',
        text: `${result.rows[0].title}, ${result.rows[0].guests_count} гостей, ${result.rows[0].time}`,
        type: 'event',
        data: { event_id: result.rows[0].id },
      });
      emitChange('events', 'created', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.patch(
    '/events/:id',
    authMiddleware,
    requirePermission('manage:events'),
    asyncHandler(async (req, res) => {
      const allowed = [
        'title',
        'type',
        'date',
        'time',
        'guests_count',
        'customer_name',
        'customer_phone',
        'floor_id',
        'table_ids',
        'banquet_menu',
        'comment',
        'kitchen_comment',
        'waiter_comment',
        'responsible_user_id',
        'deposit_amount',
        'prepayment_status',
        'call_status',
        'alcohol_required',
        'alcohol_available',
        'alcohol_actual',
        'alcohol_comment',
        'status',
      ];
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления записи.' });
        return;
      }

      const normalizedEntries = entries.map(([key, value]) => [
        key,
        key === 'table_ids' || key === 'banquet_menu'
          ? JSON.stringify(value ?? [])
          : ['guests_count', 'deposit_amount', 'alcohol_required', 'alcohol_available', 'alcohol_actual'].includes(key)
            ? Number(value ?? 0)
            : value,
      ]);
      const setSql = normalizedEntries.map(([key], index) => `"${key}" = $${index + 2}`).join(', ');
      const values = [req.params.id, ...normalizedEntries.map(([, value]) => value)];
      const result = await query(`UPDATE events SET ${setSql} WHERE id = $1 RETURNING *`, values);
      if (!result.rows[0]) {
        res.status(404).json({ error: 'Запись не найдена.' });
        return;
      }
      if (req.body?.status || req.body?.time || req.body?.date || req.body?.kitchen_comment || req.body?.waiter_comment) {
        await createRoleNotifications(pool, ['hostess', 'waiter', 'kitchen', 'bar', 'management'], {
          title: 'Мероприятие обновлено',
          text: `${result.rows[0].title}, ${result.rows[0].guests_count} гостей, ${result.rows[0].time}`,
          type: 'event_update',
          data: { event_id: result.rows[0].id },
        });
      }
      emitChange('events', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );
}

module.exports = { registerStaffRoutes };
