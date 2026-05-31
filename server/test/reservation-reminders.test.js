const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

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
