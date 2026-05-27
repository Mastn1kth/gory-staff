function registerPushRoutes(app, deps) {
  const {
    pool,
    query,
    asyncHandler,
    authMiddleware,
    randomUUID,
    registerPushDevice,
    activePushDevicesForUsers,
    sendPushToDevices,
    publicServerUrl,
    websocketUrlForApi,
    emitChange,
  } = deps;

  app.post(
    '/devices/register',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const { token, push_token, platform, device_id, app_version, device_name } = req.body ?? {};
      const pushToken = push_token ?? token;
      if (!pushToken) {
        res.status(400).json({ error: 'Не передан токен устройства.' });
        return;
      }

      const device = await registerPushDevice(pool, {
        userType: 'staff',
        userId: req.user.id,
        pushToken,
        platform,
        deviceId: device_id,
        appVersion: app_version,
        deviceName: device_name,
      });

      res.json({ ok: true, device });
    }),
  );

  app.post(
    '/push/devices/register',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const { token, push_token, platform, device_id, app_version, device_name } = req.body ?? {};
      const pushToken = push_token ?? token;
      if (!pushToken) {
        res.status(400).json({ error: 'Не передан push token устройства.' });
        return;
      }
      const device = await registerPushDevice(pool, {
        userType: 'staff',
        userId: req.user.id,
        pushToken,
        platform,
        deviceId: device_id,
        appVersion: app_version,
        deviceName: device_name,
      });
      res.json({ ok: true, device });
    }),
  );

  app.get(
    '/push/status',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const devices = await query(
        `SELECT id, platform, app_version, device_name, is_active, last_seen_at, created_at, updated_at, revoked_at
         FROM push_devices
         WHERE user_type = 'staff' AND user_id = $1
         ORDER BY updated_at DESC`,
        [req.user.id],
      );
      res.json({
        ok: true,
        user_type: 'staff',
        devices: devices.rows,
        api_url: publicServerUrl(),
        websocket_url: websocketUrlForApi(),
        provider: 'expo',
        push_disabled: process.env.DISABLE_PUSH === '1',
      });
    }),
  );

  app.post(
    '/push/test',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const notificationId = randomUUID();
        await client.query(
          `INSERT INTO notifications
             (id, user_type, user_id, guest_id, target_role, title, text, body, type, data_json, status, is_read, created_at)
           VALUES ($1,'staff',$2,NULL,'direct','Горы','Тестовое уведомление получено','Тестовое уведомление получено','test_push',$3,'created',FALSE,NOW())`,
          [notificationId, req.user.id, { test: true }],
        );
        const devices = await activePushDevicesForUsers(client, 'staff', [req.user.id]);
        const result = await sendPushToDevices(client, devices, {
          notificationId,
          title: 'Горы',
          text: 'Тестовое уведомление получено',
          type: 'test_push',
          data: { test: true },
        });
        await client.query(
          `UPDATE notifications
           SET status = $2,
               sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
               error_message = $3
           WHERE id = $1`,
          [notificationId, result.sent > 0 ? 'sent' : result.no_devices ? 'no_devices' : 'created', result.no_devices ? 'Нет активных устройств для push.' : null],
        );
        await client.query('COMMIT');
        emitChange('notifications', 'created', { id: notificationId, type: 'test_push' });
        res.json({ ok: true, notification_id: notificationId, ...result });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );
}

module.exports = { registerPushRoutes };
