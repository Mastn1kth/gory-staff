function registerAuthRoutes(app, deps) {
  const {
    query,
    pool,
    asyncHandler,
    authMiddleware,
    bcrypt,
    jwt,
    jwtSecret,
    loginRateLimiter,
    realClientIp,
    randomUUID,
    sanitizeUser,
    isLoginBlocked,
    permissionsFor,
    sectionsForRole,
    roleDefinitions,
    emitChange,
    logActivity,
    createNotification,
    buildShiftCloseSummary,
    serverDate,
    targetGroupsForRole,
  } = deps;

  const loginAttempts = new Map();
  const invalidLoginError = 'Логин или пароль неверный.';
  const dummyPasswordHash = bcrypt.hashSync('gory-staff-invalid-login-dummy', 10);
  const loginAttemptLimit = Math.max(1, Number(process.env.LOGIN_ATTEMPT_LIMIT ?? 5));
  const loginLockWindowMs = Math.max(1000, Number(process.env.LOGIN_LOCK_WINDOW_MS ?? 5 * 60 * 1000));

  function loginAttemptKey(req, login) {
    const ip = typeof realClientIp === 'function' ? realClientIp(req) : req.ip || req.socket?.remoteAddress || 'unknown';
    return `${String(login ?? '').trim().toLowerCase()}|${ip}`;
  }

  function isAttemptLocked(key) {
    const attempt = loginAttempts.get(key);
    if (!attempt) return false;
    const now = Date.now();
    if (attempt.blockedUntil && attempt.blockedUntil > now) return true;
    if (attempt.expiresAt <= now) loginAttempts.delete(key);
    return false;
  }

  function recordFailedAttempt(key) {
    const now = Date.now();
    const current = loginAttempts.get(key);
    const next =
      current && current.expiresAt > now
        ? { ...current, count: current.count + 1 }
        : { count: 1, expiresAt: now + loginLockWindowMs, blockedUntil: 0 };
    if (next.count >= loginAttemptLimit) {
      next.blockedUntil = now + loginLockWindowMs;
      next.expiresAt = next.blockedUntil;
    }
    loginAttempts.set(key, next);
    return next.blockedUntil > now;
  }

  function sendLoginLocked(res) {
    res.status(429).json({ error: 'Слишком много неверных попыток входа. Подождите несколько минут.' });
  }

  function sendInvalidLogin(res) {
    res.status(401).json({ error: invalidLoginError });
  }

  app.post(
    '/auth/login',
    loginRateLimiter,
    asyncHandler(async (req, res) => {
      const { login, password } = req.body ?? {};
      const normalizedLogin = String(login ?? '').trim();
      const rawPassword = String(password ?? '');
      if (!normalizedLogin || !rawPassword.trim()) {
        res.status(400).json({ error: 'Введите логин и пароль.' });
        return;
      }

      const attemptKey = loginAttemptKey(req, normalizedLogin);
      if (isAttemptLocked(attemptKey)) {
        sendLoginLocked(res);
        return;
      }

      const result = await query('SELECT * FROM users WHERE login = $1', [normalizedLogin]);
      const user = result.rows[0];
      const passwordMatches = await bcrypt.compare(rawPassword, user?.password_hash ?? dummyPasswordHash);

      if (!user) {
        if (recordFailedAttempt(attemptKey)) {
          sendLoginLocked(res);
          return;
        }
        sendInvalidLogin(res);
        return;
      }

      if (!passwordMatches) {
        if (recordFailedAttempt(attemptKey)) {
          sendLoginLocked(res);
          return;
        }
        sendInvalidLogin(res);
        return;
      }
      if (isLoginBlocked(user)) {
        res.status(403).json({ error: 'Вход в приложение закрыт. Обратитесь к администратору.' });
        return;
      }

      loginAttempts.delete(attemptKey);
      const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '14d' });
      res.json({
        token,
        user: sanitizeUser(user),
        permissions: permissionsFor(user.role),
        sections: sectionsForRole(user.role),
        role: roleDefinitions[user.role],
      });
    }),
  );

  app.post(
    '/auth/register',
    asyncHandler(async (req, res) => {
      const name = String(req.body?.name ?? '').trim();
      const phone = String(req.body?.phone ?? '').trim();
      const login = String(req.body?.login ?? '').trim();
      const password = String(req.body?.password ?? '').trim();

      if (!name || !login || password.length < 8) {
        res.status(400).json({ error: 'Введите имя, логин и пароль не короче 8 символов.' });
        return;
      }

      const existing = await query('SELECT id FROM users WHERE login = $1', [login]);
      if (existing.rows[0]) {
        res.status(409).json({ error: 'Такой логин уже занят.' });
        return;
      }

      const id = randomUUID();
      const passwordHash = bcrypt.hashSync(password, 10);
      const result = await query(
        `INSERT INTO users (id, name, phone, login, password_hash, password_plain, role, position, status, photo_url, comment, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending','Новый сотрудник','off_shift',NULL,'Ожидает назначения роли управляющим.',NOW())
         RETURNING *`,
        [id, name, phone, login, passwordHash, password],
      );
      const user = result.rows[0];
      const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '14d' });

      emitChange('users', 'created', sanitizeUser(user));
      res.status(201).json({
        token,
        user: sanitizeUser(user),
        permissions: permissionsFor(user.role),
        sections: sectionsForRole(user.role),
        role: roleDefinitions[user.role],
      });
    }),
  );

  app.get(
    '/auth/me',
    authMiddleware,
    asyncHandler(async (req, res) => {
      res.json({
        user: sanitizeUser(req.user),
        permissions: permissionsFor(req.user.role),
        sections: sectionsForRole(req.user.role),
      });
    }),
  );

  app.patch(
    '/me',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const allowed = ['name', 'phone', 'position', 'photo_url'];
      const entries = Object.entries(req.body ?? {}).filter(([key, value]) => allowed.includes(key) && value !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для изменения профиля.' });
        return;
      }

      const setSql = entries.map(([key], index) => `"${key}" = $${index + 2}`).join(', ');
      const values = [req.user.id, ...entries.map(([, value]) => value)];
      const result = await query(
        `UPDATE users SET ${setSql}, updated_at = NOW(), version = version + 1 WHERE id = $1
         RETURNING id, name, phone, login, role, position, status, photo_url, comment, created_at, updated_at, version`,
        values,
      );
      emitChange('users', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.patch(
    '/me/password',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const currentPassword = String(req.body?.current_password ?? req.body?.currentPassword ?? '');
      const newPassword = String(req.body?.new_password ?? req.body?.newPassword ?? '').trim();
      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Новый пароль должен быть не короче 8 символов.' });
        return;
      }
      if (!(await bcrypt.compare(currentPassword, req.user.password_hash))) {
        res.status(403).json({ error: 'Текущий пароль указан неверно.' });
        return;
      }

      const passwordHash = bcrypt.hashSync(newPassword, 10);
      await query('UPDATE users SET password_hash = $2, password_plain = $3, updated_at = NOW(), version = version + 1 WHERE id = $1', [req.user.id, passwordHash, newPassword]);
      await logActivity(pool, req.user.id, 'user.password_changed', 'user', req.user.id, null, { self: true });
      res.json({ ok: true });
    }),
  );

  app.patch(
    '/me/status',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const allowed = new Set(['on_shift', 'off_shift', 'sick', 'vacation']);
      const status = String(req.body?.status ?? '');
      if (!allowed.has(status)) {
        res.status(400).json({ error: 'Некорректный статус смены.' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE users
           SET status = $2,
               updated_at = NOW(),
               version = version + 1
           WHERE id = $1
           RETURNING id, name, phone, login, role, position, status, photo_url, comment, created_at, updated_at, version`,
          [req.user.id, status],
        );
        if (status === 'on_shift' || status === 'off_shift') {
          await client.query(
            `UPDATE shifts
             SET status = CASE WHEN $2 = 'on_shift' THEN 'active' ELSE 'done' END,
                 updated_at = NOW(),
                 version = version + 1
             WHERE user_id = $1 AND date = $3`,
            [req.user.id, status, serverDate()],
          );
          const closeSummary = status === 'off_shift' ? await buildShiftCloseSummary(client, req.user) : null;
          await createNotification(client, {
            title: status === 'on_shift' ? 'Началась новая смена' : 'Смена завершена',
            text: closeSummary ?? `${req.user.name} - ${req.user.position}`,
            type: status === 'off_shift' ? 'shift_summary' : 'shift_status',
            targetRole: 'management',
          });
        }
        await client.query('COMMIT');
        emitChange('users', 'status_changed', result.rows[0]);
        emitChange('shifts', 'status_changed', { user_id: req.user.id, status });
        res.json(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );
}

module.exports = { registerAuthRoutes };
