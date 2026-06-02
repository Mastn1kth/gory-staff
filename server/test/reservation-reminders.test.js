const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { newDb } = require('pg-mem');

const { ReservationReminderService } = require('../src/services/reservation-reminders.js');
const { startTestServer, readJson } = require('./test-helpers.js');

function twilioSignature(url, params, authToken) {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => `${acc}${key}${params[key]}`, url);
  return crypto.createHmac('sha1', authToken).update(payload).digest('base64');
}

async function postTwilioCallback(baseUrl, params, signature) {
  const body = new URLSearchParams(params);
  return fetch(`${baseUrl}/reservation-reminders/twilio/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(signature ? { 'X-Twilio-Signature': signature } : {}),
    },
    body,
  });
}

test('reservation reminder scan works in demo memory database', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  let nextId = 0;

  try {
    await pool.query(`
      CREATE TABLE reservations (
        id TEXT PRIMARY KEY,
        guest_name TEXT NOT NULL,
        guest_phone TEXT NOT NULL,
        date DATE NOT NULL,
        time TIME NOT NULL,
        guests_count INTEGER NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE reservation_reminders (
        id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        reminder_type TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        channel TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        message_text TEXT,
        voice_script TEXT,
        provider TEXT,
        failed_at TIMESTAMPTZ,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 2,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE reservation_reminder_settings (
        id TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL,
        day_before_enabled BOOLEAN NOT NULL,
        day_before_time TEXT NOT NULL,
        voice_enabled BOOLEAN NOT NULL,
        sms_enabled BOOLEAN NOT NULL,
        voice_script_template TEXT NOT NULL,
        sms_template TEXT NOT NULL
      );
    `);
    await pool.query(`
      INSERT INTO reservation_reminder_settings
        (id, enabled, day_before_enabled, day_before_time, voice_enabled, sms_enabled, voice_script_template, sms_template)
      VALUES
        ('default', true, true, '10:00:00', true, true, 'Call {guest_name}', 'SMS {guest_name}');

      INSERT INTO reservations
        (id, guest_name, guest_phone, date, time, guests_count, status)
      VALUES
        ('reservation-1', 'Guest', '+79990000000', CURRENT_DATE + INTERVAL '3 days', '19:00:00', 2, 'new');
    `);

    const service = new ReservationReminderService(pool, () => `reminder-${++nextId}`);
    await service.checkAndSendReminders();

    const reminders = await pool.query(
      `SELECT reservation_id, reminder_type, status, channel
       FROM reservation_reminders
       ORDER BY channel`
    );
    assert.deepEqual(reminders.rows, [
      { reservation_id: 'reservation-1', reminder_type: 'day_before', status: 'pending', channel: 'sms' },
      { reservation_id: 'reservation-1', reminder_type: 'day_before', status: 'pending', channel: 'voice' },
    ]);
  } finally {
    await pool.end();
  }
});

test('twilio reservation callback rejects unsigned requests when auth token is configured', async (t) => {
  const server = await startTestServer({
    TWILIO_AUTH_TOKEN: 'twilio-test-token',
  });
  t.after(() => server.close());

  const response = await postTwilioCallback(server.baseUrl, {
    MessageSid: 'SMunsigned',
    MessageStatus: 'delivered',
  });
  const body = await readJson(response);

  assert.equal(response.status, 403);
  assert.match(body.error, /Twilio/i);
});

test('twilio reservation callback accepts a valid Twilio signature', async (t) => {
  const authToken = 'twilio-test-token';
  const server = await startTestServer({
    TWILIO_AUTH_TOKEN: authToken,
  });
  t.after(() => server.close());

  const params = {
    MessageSid: 'SMsigned',
    MessageStatus: 'delivered',
  };
  const callbackUrl = `${server.baseUrl}/reservation-reminders/twilio/callback`;
  const response = await postTwilioCallback(server.baseUrl, params, twilioSignature(callbackUrl, params, authToken));
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.raw, 'OK');
});

test('twilio reservation callback accepts a signature generated for the public callback url', async (t) => {
  const authToken = 'twilio-public-callback-test-token';
  const publicCallbackUrl = 'https://app.gory-staff.ru/reservation-reminders/twilio/callback';
  const server = await startTestServer({
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_STATUS_CALLBACK_URL: publicCallbackUrl,
  });
  t.after(() => server.close());

  const params = {
    MessageSid: 'SMpublic',
    MessageStatus: 'delivered',
  };
  const response = await postTwilioCallback(server.baseUrl, params, twilioSignature(publicCallbackUrl, params, authToken));
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.raw, 'OK');
});
