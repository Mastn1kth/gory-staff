/**
 * API для управления автоматическими напоминаниями о бронях
 */

const { validateTwilioRequest } = require('../integrations/twilio');

function registerReservationReminderRoutes(app, deps) {
  const { pool, query, asyncHandler, authMiddleware, requirePermission, randomUUID, createTwilioClient } = deps;

  /**
   * Получить настройки напоминаний
   */
  app.get(
    '/reservation-reminders/settings',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const result = await query(
        `SELECT * FROM reservation_reminder_settings WHERE id = 'default' LIMIT 1`
      );
      res.json(result.rows[0] || {});
    })
  );

  /**
   * Обновить настройки напоминаний
   */
  app.patch(
    '/reservation-reminders/settings',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const allowed = [
        'enabled',
        'day_before_enabled',
        'day_before_time',
        'hour_before_enabled',
        'hour_before_minutes',
        'voice_enabled',
        'sms_enabled',
        'voice_script_template',
        'sms_template',
        'auto_confirm_on_answer',
      ];

      const entries = Object.entries(req.body ?? {}).filter(
        ([key, value]) => allowed.includes(key) && value !== undefined
      );

      if (entries.length === 0) {
        res.status(400).json({ error: 'Нет полей для обновления' });
        return;
      }

      const setSql = entries.map(([key], index) => `"${key}" = $${index + 1}`).join(', ');
      const values = entries.map(([, value]) => value);

      const result = await query(
        `UPDATE reservation_reminder_settings
         SET ${setSql}, updated_at = NOW()
         WHERE id = 'default'
         RETURNING *`,
        values
      );

      res.json(result.rows[0]);
    })
  );

  /**
   * Получить список напоминаний
   */
  app.get(
    '/reservation-reminders',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const { status, reservation_id, limit = 50 } = req.query;

      let sql = `
        SELECT rr.*, r.guest_name, r.date, r.time, r.guests_count, r.status AS reservation_status
        FROM reservation_reminders rr
        JOIN reservations r ON r.id = rr.reservation_id
        WHERE 1=1
      `;
      const params = [];

      if (status) {
        params.push(status);
        sql += ` AND rr.status = $${params.length}`;
      }

      if (reservation_id) {
        params.push(reservation_id);
        sql += ` AND rr.reservation_id = $${params.length}`;
      }

      params.push(parseInt(limit, 10));
      sql += ` ORDER BY rr.scheduled_at DESC LIMIT $${params.length}`;

      const result = await query(sql, params);
      res.json(result.rows);
    })
  );

  /**
   * Создать ручное напоминание
   */
  app.post(
    '/reservation-reminders',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const { reservation_id, channel, scheduled_at, message_text, voice_script } = req.body;

      if (!reservation_id || !channel) {
        res.status(400).json({ error: 'Укажите reservation_id и channel' });
        return;
      }

      // Проверяем, что бронь существует
      const reservation = await query(
        `SELECT * FROM reservations WHERE id = $1 LIMIT 1`,
        [reservation_id]
      );

      if (!reservation.rows[0]) {
        res.status(404).json({ error: 'Бронь не найдена' });
        return;
      }

      const id = randomUUID();
      const result = await query(
        `INSERT INTO reservation_reminders
         (id, reservation_id, reminder_type, scheduled_at, status, channel, phone_number, message_text, voice_script, provider, created_by, created_at)
         VALUES ($1, $2, 'manual', $3, 'pending', $4, $5, $6, $7, 'twilio', $8, NOW())
         RETURNING *`,
        [
          id,
          reservation_id,
          scheduled_at || new Date(),
          channel,
          reservation.rows[0].guest_phone,
          message_text || null,
          voice_script || null,
          req.user.id,
        ]
      );

      res.status(201).json(result.rows[0]);
    })
  );

  /**
   * Отменить напоминание
   */
  app.delete(
    '/reservation-reminders/:id',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const result = await query(
        `UPDATE reservation_reminders
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [req.params.id]
      );

      if (!result.rows[0]) {
        res.status(404).json({ error: 'Напоминание не найдено или уже отправлено' });
        return;
      }

      res.json(result.rows[0]);
    })
  );

  /**
   * Получить статус Twilio
   */
  app.get(
    '/reservation-reminders/twilio/status',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const twilioClient = createTwilioClient();
      res.json(twilioClient.getStatus());
    })
  );

  /**
   * Webhook для статусов Twilio
   */
  app.post(
    '/reservation-reminders/twilio/callback',
    asyncHandler(async (req, res) => {
      const callbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const signature = req.get('X-Twilio-Signature');
      if (!validateTwilioRequest({
        url: callbackUrl,
        params: req.body ?? {},
        signature,
        authToken: process.env.TWILIO_AUTH_TOKEN,
      })) {
        res.status(403).json({ error: 'Invalid Twilio signature.' });
        return;
      }

      const { CallSid, MessageSid, CallStatus, MessageStatus, CallDuration, AnsweredBy } = req.body;

      if (CallSid) {
        // Обновляем статус звонка
        await query(
          `UPDATE reservation_reminders
           SET provider_status = $2,
               call_duration_seconds = $3,
               call_answered = $4,
               delivered_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE delivered_at END,
               updated_at = NOW()
           WHERE provider_call_sid = $1`,
          [CallSid, CallStatus, CallDuration ? parseInt(CallDuration, 10) : null, AnsweredBy === 'human']
        );
      }

      if (MessageSid) {
        // Обновляем статус SMS
        await query(
          `UPDATE reservation_reminders
           SET provider_status = $2,
               delivered_at = CASE WHEN $2 IN ('delivered', 'sent') THEN NOW() ELSE delivered_at END,
               failed_at = CASE WHEN $2 IN ('failed', 'undelivered') THEN NOW() ELSE failed_at END,
               updated_at = NOW()
           WHERE provider_message_sid = $1`,
          [MessageSid, MessageStatus]
        );
      }

      res.status(200).send('OK');
    })
  );

  /**
   * Получить статистику напоминаний
   */
  app.get(
    '/reservation-reminders/stats',
    authMiddleware,
    requirePermission('manage:reservations'),
    asyncHandler(async (req, res) => {
      const result = await query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending') AS pending,
           COUNT(*) FILTER (WHERE status = 'sent') AS sent,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed,
           COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
           COUNT(*) FILTER (WHERE channel = 'voice' AND status = 'sent') AS voice_sent,
           COUNT(*) FILTER (WHERE channel = 'sms' AND status = 'sent') AS sms_sent,
           COUNT(*) FILTER (WHERE call_answered = true) AS calls_answered,
           AVG(call_duration_seconds) FILTER (WHERE call_duration_seconds IS NOT NULL) AS avg_call_duration
         FROM reservation_reminders
         WHERE created_at >= NOW() - INTERVAL '30 days'`
      );

      res.json(result.rows[0]);
    })
  );
}

module.exports = { registerReservationReminderRoutes };
