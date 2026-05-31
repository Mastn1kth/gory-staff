const assert = require('node:assert');
const { test } = require('node:test');
const { startTestServer, api } = require('./test-helpers.js');

test('guest can get temporary bonus redemption token', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'StrongPass123!',
    DEMO_STAFF_PASSWORD: 'DemoPass123!',
  });

  t.after(() => server.close());

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Token Test Guest',
      phone: '+7 900 555-77-88',
      personal_data_consent: true,
    }),
  });

  assert.ok(guest.token);
  assert.ok(guest.guest);

  const token = await api(server.baseUrl, '/guest/bonus/redemption-token', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  assert.ok(token.short_code);
  assert.equal(token.short_code.length, 6);
  assert.ok(/^\d{6}$/.test(token.short_code));
  assert.ok(token.expires_at);
  assert.ok(token.created_at);

  const expiresAt = new Date(token.expires_at);
  const createdAt = new Date(token.created_at);
  const diffMinutes = (expiresAt - createdAt) / 1000 / 60;
  assert.ok(diffMinutes >= 4.9 && diffMinutes <= 5.1, 'Token should expire in 5 minutes');
});

test('guest can refresh bonus redemption token', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'StrongPass123!',
    DEMO_STAFF_PASSWORD: 'DemoPass123!',
  });

  t.after(() => server.close());

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Refresh Token Guest',
      phone: '+7 900 555-77-99',
      personal_data_consent: true,
    }),
  });

  const token1 = await api(server.baseUrl, '/guest/bonus/redemption-token', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  const token2 = await api(server.baseUrl, '/guest/bonus/redemption-token/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  assert.notEqual(token1.short_code, token2.short_code);
  assert.ok(token2.short_code);
  assert.equal(token2.short_code.length, 6);
});

test('staff can verify valid bonus redemption code', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'StrongPass123!',
    DEMO_STAFF_PASSWORD: 'DemoPass123!',
  });

  t.after(() => server.close());

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      login: 'owner@example.test',
      password: 'StrongPass123!',
    }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Verify Code Guest',
      phone: '+7 900 555-88-00',
      personal_data_consent: true,
    }),
  });

  const token = await api(server.baseUrl, '/guest/bonus/redemption-token', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  const verification = await api(server.baseUrl, '/admin/bonus/verify-code', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ code: token.short_code }),
  });

  assert.equal(verification.valid, true);
  assert.equal(verification.guest.name, 'Verify Code Guest');
  assert.equal(verification.guest.phone, '+79005558800');
  assert.ok(verification.guest.bonus_balance >= 0);
  assert.equal(verification.token.short_code, token.short_code);
});

test('staff cannot verify invalid bonus redemption code', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'StrongPass123!',
    DEMO_STAFF_PASSWORD: 'DemoPass123!',
  });

  t.after(() => server.close());

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      login: 'owner@example.test',
      password: 'StrongPass123!',
    }),
  });

  try {
    await api(server.baseUrl, '/admin/bonus/verify-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${manager.token}` },
      body: JSON.stringify({ code: '999999' }),
    });
    assert.fail('Should have thrown error for invalid code');
  } catch (error) {
    assert.ok(error.message.includes('недействителен') || error.message.includes('истёк'));
  }
});

test('staff can redeem bonuses by valid code', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'StrongPass123!',
    DEMO_STAFF_PASSWORD: 'DemoPass123!',
  });

  t.after(() => server.close());

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      login: 'owner@example.test',
      password: 'StrongPass123!',
    }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Redeem Code Guest',
      phone: '+7 900 555-88-11',
      personal_data_consent: true,
    }),
  });

  const token = await api(server.baseUrl, '/guest/bonus/redemption-token', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  const initialBalance = guest.guest.bonus_balance;

  const redemption = await api(server.baseUrl, '/admin/bonus/redeem-by-code', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      code: token.short_code,
      amount: 100,
      order_amount: 1000,
      reason: 'Тестовое списание',
    }),
  });

  assert.equal(redemption.success, true);
  assert.equal(redemption.redeemed_amount, 100);
  assert.equal(redemption.order_amount, 1000);
  assert.equal(redemption.new_balance, initialBalance - 100);
  assert.ok(redemption.transaction);
  assert.equal(redemption.transaction.amount, -100);
});

test('staff cannot redeem bonuses exceeding 20% limit', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'StrongPass123!',
    DEMO_STAFF_PASSWORD: 'DemoPass123!',
  });

  t.after(() => server.close());

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      login: 'owner@example.test',
      password: 'StrongPass123!',
    }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Limit Test Guest',
      phone: '+7 900 555-88-22',
      personal_data_consent: true,
    }),
  });

  const token = await api(server.baseUrl, '/guest/bonus/redemption-token', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  try {
    await api(server.baseUrl, '/admin/bonus/redeem-by-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${manager.token}` },
      body: JSON.stringify({
        code: token.short_code,
        amount: 300,
        order_amount: 1000,
        reason: 'Превышение лимита',
      }),
    });
    assert.fail('Should have thrown error for exceeding 20% limit');
  } catch (error) {
    assert.ok(error.message.includes('20%') || error.message.includes('200'));
  }
});

test('used code cannot be reused', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'StrongPass123!',
    DEMO_STAFF_PASSWORD: 'DemoPass123!',
  });

  t.after(() => server.close());

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      login: 'owner@example.test',
      password: 'StrongPass123!',
    }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Reuse Test Guest',
      phone: '+7 900 555-88-33',
      personal_data_consent: true,
    }),
  });

  const token = await api(server.baseUrl, '/guest/bonus/redemption-token', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  await api(server.baseUrl, '/admin/bonus/redeem-by-code', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      code: token.short_code,
      amount: 50,
      order_amount: 500,
    }),
  });

  try {
    await api(server.baseUrl, '/admin/bonus/redeem-by-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${manager.token}` },
      body: JSON.stringify({
        code: token.short_code,
        amount: 50,
        order_amount: 500,
      }),
    });
    assert.fail('Should have thrown error for reusing code');
  } catch (error) {
    assert.ok(error.message.includes('недействителен') || error.message.includes('истёк'));
  }
});

test('guest gets same active token on repeated requests', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'StrongPass123!',
    DEMO_STAFF_PASSWORD: 'DemoPass123!',
  });

  t.after(() => server.close());

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Same Token Guest',
      phone: '+7 900 555-88-44',
      personal_data_consent: true,
    }),
  });

  const token1 = await api(server.baseUrl, '/guest/bonus/redemption-token', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  const token2 = await api(server.baseUrl, '/guest/bonus/redemption-token', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });

  assert.equal(token1.short_code, token2.short_code);
  assert.equal(token1.created_at, token2.created_at);
  assert.equal(token1.expires_at, token2.expires_at);
});
