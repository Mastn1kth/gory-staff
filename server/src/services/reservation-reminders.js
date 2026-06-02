/**
 * Сервис автоматических напоминаний о бронях
 */

const { createTwilioClient } = require('../integrations/twilio');

class ReservationReminderService {
  constructor(pool, uuid) {
    this.pool = pool;
    this.uuid = uuid;
    this.twilioClient = createTwilioClient();
    this.isRunning = false;
    this.intervalId = null;
  }

  /**
   * Запустить фоновый процесс проверки напоминаний
   */
  start(intervalMs = 60000) {
    if (this.isRunning) {
      console.log('[ReservationReminders] Уже запущен');
      return;
    }

    console.log('[ReservationReminders] Запуск фонового процесса...');
    this.isRunning = true;

    // Первая проверка сразу
    this.checkAndSendReminders().catch((error) => {
      console.error('[ReservationReminders] Ошибка при первой проверке:', error);
    });

    // Периодическая проверка
    this.intervalId = setInterval(() => {
      this.checkAndSendReminders().catch((error) => {
        console.error('[ReservationReminders] Ошибка при проверке:', error);
      });
    }, intervalMs);

    console.log(`[ReservationReminders] Запущен с интервалом ${intervalMs / 1000}с`);
  }

  /**
   * Остановить фоновый процесс
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('[ReservationReminders] Остановка...');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[ReservationReminders] Остановлен');
  }

  /**
   * Проверить и отправить напоминания
   */
  async checkAndSendReminders() {
    const client = await this.pool.connect();
    try {
      // Получаем настройки
      const settingsResult = await client.query(
        `SELECT * FROM reservation_reminder_settings WHERE id = 'default' LIMIT 1`
      );
      const settings = settingsResult.rows[0];

      if (!settings || !settings.enabled) {
        return;
      }

      // Создаём напоминания для новых броней
      await this.createRemindersForNewReservations(client, settings);

      // Отправляем готовые напоминания
      await this.sendPendingReminders(client, settings);

      // Повторяем неудачные попытки
      await this.retryFailedReminders(client, settings);
    } finally {
      client.release();
    }
  }

  /**
   * Создать напоминания для новых броней
   */
  async createRemindersForNewReservations(client, settings) {
    if (!settings.day_before_enabled) {
      return;
    }

    // Находим брони, для которых ещё нет напоминаний
    const result = await client.query(
      `SELECT r.*
       FROM reservations r
       LEFT JOIN reservation_reminders rr
         ON rr.reservation_id = r.id
        AND rr.reminder_type = 'day_before'
        AND rr.status != 'cancelled'
       WHERE r.status IN ('new', 'confirmed')
         AND r.date >= CURRENT_DATE
         AND r.date <= CURRENT_DATE + INTERVAL '7 days'
         AND rr.id IS NULL`
    );

    for (const reservation of result.rows) {
      await this.createDayBeforeReminder(client, reservation, settings);
    }
  }

  /**
   * Создать напоминание за день до брони
   */
  async createDayBeforeReminder(client, reservation, settings) {
    // Вычисляем время отправки: за день до брони в указанное время
    const reservationDate = new Date(reservation.date);
    const dayBefore = new Date(reservationDate);
    dayBefore.setDate(dayBefore.getDate() - 1);

    const [hours, minutes] = settings.day_before_time.split(':');
    dayBefore.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    // Если время уже прошло, не создаём напоминание
    if (dayBefore < new Date()) {
      return;
    }

    const voiceScript = this.formatTemplate(settings.voice_script_template, reservation);
    const smsText = this.formatTemplate(settings.sms_template, reservation);

    // Создаём напоминание для голосового звонка
    if (settings.voice_enabled) {
      await client.query(
        `INSERT INTO reservation_reminders
         (id, reservation_id, reminder_type, scheduled_at, status, channel, phone_number, voice_script, provider, created_at)
         VALUES ($1, $2, 'day_before', $3, 'pending', 'voice', $4, $5, 'twilio', NOW())`,
        [this.uuid(), reservation.id, dayBefore, reservation.guest_phone, voiceScript]
      );
    }

    // Создаём напоминание для SMS
    if (settings.sms_enabled) {
      await client.query(
        `INSERT INTO reservation_reminders
         (id, reservation_id, reminder_type, scheduled_at, status, channel, phone_number, message_text, provider, created_at)
         VALUES ($1, $2, 'day_before', $3, 'pending', 'sms', $4, $5, 'twilio', NOW())`,
        [this.uuid(), reservation.id, dayBefore, reservation.guest_phone, smsText]
      );
    }

    console.log(`[ReservationReminders] Создано напоминание для брони ${reservation.id} на ${dayBefore.toISOString()}`);
  }

  /**
   * Отправить готовые напоминания
   */
  async sendPendingReminders(client, settings) {
    const result = await client.query(
      `SELECT rr.*, r.guest_name, r.date, r.time, r.guests_count
       FROM reservation_reminders rr
       JOIN reservations r ON r.id = rr.reservation_id
       WHERE rr.status = 'pending'
         AND rr.scheduled_at <= NOW()
         AND r.status IN ('new', 'confirmed')
       ORDER BY rr.scheduled_at ASC
       LIMIT 10`
    );

    for (const reminder of result.rows) {
      await this.sendReminder(client, reminder);
    }
  }

  /**
   * Отправить одно напоминание
   */
  async sendReminder(client, reminder) {
    try {
      console.log(`[ReservationReminders] Отправка напоминания ${reminder.id} (${reminder.channel}) на ${reminder.phone_number}`);

      let response;
      if (reminder.channel === 'voice') {
        response = await this.twilioClient.makeCall(
          reminder.phone_number,
          reminder.voice_script,
          process.env.TWILIO_STATUS_CALLBACK_URL
        );

        await client.query(
          `UPDATE reservation_reminders
           SET status = 'sent',
               sent_at = NOW(),
               provider_call_sid = $2,
               provider_status = $3,
               provider_response_json = $4,
               updated_at = NOW()
           WHERE id = $1`,
          [reminder.id, response.callSid, response.status, JSON.stringify(response)]
        );
      } else if (reminder.channel === 'sms') {
        response = await this.twilioClient.sendSMS(
          reminder.phone_number,
          reminder.message_text,
          process.env.TWILIO_STATUS_CALLBACK_URL
        );

        await client.query(
          `UPDATE reservation_reminders
           SET status = 'sent',
               sent_at = NOW(),
               provider_message_sid = $2,
               provider_status = $3,
               provider_response_json = $4,
               updated_at = NOW()
           WHERE id = $1`,
          [reminder.id, response.messageSid, response.status, JSON.stringify(response)]
        );
      }

      console.log(`[ReservationReminders] Напоминание ${reminder.id} отправлено успешно`);
    } catch (error) {
      console.error(`[ReservationReminders] Ошибка отправки напоминания ${reminder.id}:`, error.message);

      await client.query(
        `UPDATE reservation_reminders
         SET status = 'failed',
             failed_at = NOW(),
             error_message = $2,
             retry_count = retry_count + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [reminder.id, error.message]
      );
    }
  }

  /**
   * Повторить неудачные попытки
   */
  async retryFailedReminders(client, settings) {
    const result = await client.query(
      `SELECT rr.*, r.guest_name, r.date, r.time, r.guests_count
       FROM reservation_reminders rr
       JOIN reservations r ON r.id = rr.reservation_id
       WHERE rr.status = 'failed'
         AND rr.retry_count < rr.max_retries
         AND rr.failed_at < NOW() - INTERVAL '10 minutes'
         AND r.status IN ('new', 'confirmed')
       ORDER BY rr.failed_at ASC
       LIMIT 5`
    );

    for (const reminder of result.rows) {
      // Сбрасываем статус на pending для повторной попытки
      await client.query(
        `UPDATE reservation_reminders
         SET status = 'pending',
             updated_at = NOW()
         WHERE id = $1`,
        [reminder.id]
      );

      await this.sendReminder(client, reminder);
    }
  }

  /**
   * Форматировать шаблон сообщения
   */
  formatTemplate(template, reservation) {
    const date = new Date(reservation.date).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
    });

    return template
      .replace('{guest_name}', reservation.guest_name)
      .replace('{date}', date)
      .replace('{time}', reservation.time)
      .replace('{guests_count}', reservation.guests_count);
  }

  /**
   * Получить статистику напоминаний
   */
  async getStats() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending') AS pending,
           COUNT(*) FILTER (WHERE status = 'sent') AS sent,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed,
           COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
           COUNT(*) FILTER (WHERE channel = 'voice' AND status = 'sent') AS voice_sent,
           COUNT(*) FILTER (WHERE channel = 'sms' AND status = 'sent') AS sms_sent
         FROM reservation_reminders
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      );

      return result.rows[0];
    } finally {
      client.release();
    }
  }
}

module.exports = { ReservationReminderService };
