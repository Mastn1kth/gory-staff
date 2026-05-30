const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const serverRoot = path.resolve(__dirname, '..');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function api(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await readJson(response);
  if (!response.ok) {
    const error = new Error(body?.error || response.statusText);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function expectApiError(request) {
  try {
    await request();
  } catch (error) {
    return error;
  }
  throw new Error('Expected API request to fail.');
}

function serverEnv(port, extraEnv = {}) {
  return {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    USE_PGMEM: '1',
    DATABASE_URL: 'memory',
    SEED_DEMO_DATA: 'always',
    DISABLE_PUSH: '1',
    JWT_SECRET: 'test-jwt-secret-for-gory-staff-integration-2026',
    GUEST_JWT_SECRET: 'test-guest-secret-for-gory-staff-integration-2026',
    ...extraEnv,
  };
}

async function startTestServer(extraEnv = {}) {
  const port = 4600 + Math.floor(Math.random() * 500);
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: serverEnv(port, extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const health = await api(baseUrl, '/health');
      if (health.ok) {
        return {
          baseUrl,
          stop: () => child.kill('SIGTERM'),
        };
      }
    } catch {
      await delay(250);
    }
  }

  child.kill('SIGTERM');
  throw new Error(`Server did not start.\nSTDOUT:\n${stdout.join('')}\nSTDERR:\n${stderr.join('')}`);
}

async function waitForExit(child, timeoutMs = 1500) {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

test('seeded owner uses configured email credentials and core API flow works', async (t) => {
  const ownerLogin = 'owner@example.test';
  const ownerPassword = 'OwnerTestPass-2026!';
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: ownerLogin,
    INITIAL_MANAGER_PASSWORD: ownerPassword,
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
  });
  t.after(server.stop);

  await assert.rejects(
    () =>
      api(server.baseUrl, '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login: 'admin', password: '1234' }),
      }),
    (error) => error.status === 401 && error.body?.error === 'Логин или пароль неверный.',
  );

  const login = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: ownerLogin, password: ownerPassword }),
  });
  assert.equal(login.user.login, ownerLogin);
  assert.equal(login.user.role, 'manager');
  assert.equal('password_hash' in login.user, false);
  assert.equal('password_plain' in login.user, false);

  const sync = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert.ok(sync.users.length > 0);
  assert.ok(sync.menu_items.length > 0);
  assert.ok(sync.tables.length > 0);
  assert.ok(Array.isArray(sync.guest_clients));

  const mobileSyncResponse = await fetch(`${server.baseUrl}/sync`, {
    headers: { Authorization: `Bearer ${login.token}`, 'X-Gory-App': 'mobile' },
  });
  assert.equal(mobileSyncResponse.ok, true);
  const mobileSyncText = await mobileSyncResponse.text();
  assert.ok(Buffer.byteLength(mobileSyncText, 'utf8') < 23000);
  const mobileSync = JSON.parse(mobileSyncText);
  assert.ok(mobileSync.menu_items.length > 0);
  assert.equal('waiter_hint' in mobileSync.menu_items[0], false);

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Тестовый Гость',
      phone: '+7 900 111-22-33',
      personal_data_consent: true,
    }),
  });
  assert.ok(guest.token);
  assert.equal(guest.guest.phone, '+79001112233');

  const mobileSyncAfterGuest = await api(server.baseUrl, '/sync?mobile=1', {
    headers: { Authorization: `Bearer ${login.token}`, 'X-Gory-App': 'mobile' },
  });
  assert.ok(
    mobileSyncAfterGuest.guest_clients.some((client) => client.phone === '+79001112233'),
    'new guest should appear in mobile clients sync for roles that can view clients',
  );
});

test('staff auth enforces password policy, lockout, and password changes', async (t) => {
  const ownerLogin = 'owner@example.test';
  const ownerPassword = 'OwnerTestPass-2026!';
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: ownerLogin,
    INITIAL_MANAGER_PASSWORD: ownerPassword,
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
    LOGIN_LOCK_WINDOW_MS: '60000',
  });
  t.after(server.stop);

  await assert.rejects(
    () =>
      api(server.baseUrl, '/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Short Pass', login: 'short-pass', password: '1234567' }),
      }),
    (error) => error.status === 400,
  );

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () =>
        api(server.baseUrl, '/auth/login', {
          method: 'POST',
          body: JSON.stringify({ login: 'waiter', password: `wrong-${attempt}` }),
        }),
      (error) => error.status === 401,
    );
  }

  await assert.rejects(
    () =>
      api(server.baseUrl, '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login: 'waiter', password: 'wrong-5' }),
      }),
    (error) => error.status === 429,
  );
  await assert.rejects(
    () =>
      api(server.baseUrl, '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login: 'waiter', password: 'StaffTestPass-2026!' }),
      }),
    (error) => error.status === 429,
  );

  const login = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: ownerLogin, password: ownerPassword }),
  });
  await api(server.baseUrl, '/me/password', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ current_password: ownerPassword, new_password: 'OwnerChangedPass-2026!' }),
  });

  await assert.rejects(
    () =>
      api(server.baseUrl, '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login: ownerLogin, password: ownerPassword }),
      }),
    (error) => error.status === 401,
  );
  const changedLogin = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: ownerLogin, password: 'OwnerChangedPass-2026!' }),
  });
  assert.equal(changedLogin.user.login, ownerLogin);
});

test('staff auth does not reveal whether login exists', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
  });
  t.after(server.stop);

  const missing = await expectApiError(() =>
    api(server.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: '', password: '' }),
    }),
  );
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'Введите логин и пароль.');

  const unknownUser = await expectApiError(() =>
    api(server.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'missing-user', password: 'StaffTestPass-2026!' }),
    }),
  );
  assert.equal(unknownUser.status, 401);
  assert.equal(unknownUser.body.error, 'Логин или пароль неверный.');

  const wrongPassword = await expectApiError(() =>
    api(server.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'waiter', password: 'wrong-password' }),
    }),
  );
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.error, 'Логин или пароль неверный.');
});

test('guest auth and phone changes work without confirmation code', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
  });
  t.after(server.stop);

  const phone = '8 960 509 23 31';
  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Phone Guest',
      phone,
      personal_data_consent: true,
    }),
  });
  assert.ok(guest.token);
  assert.equal(guest.guest.phone, '+79605092331');

  const login = await api(server.baseUrl, '/guest/login', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
  assert.ok(login.token);

  const newPhone = '8 960 555 44 44';
  const changed = await api(server.baseUrl, '/guest/profile', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ phone: newPhone }),
  });
  assert.equal(changed.guest.phone, '+79605554444');
});

test('staff login rate limit uses trusted Cloudflare client IP and security headers are enabled', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
    LOGIN_ATTEMPT_LIMIT: '20',
    LOGIN_RATE_LIMIT_MAX: '2',
    LOGIN_RATE_LIMIT_WINDOW_MS: '60000',
  });
  t.after(server.stop);

  const health = await fetch(`${server.baseUrl}/health`);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'SAMEORIGIN');

  async function failedLoginFrom(ip) {
    return expectApiError(() =>
      api(server.baseUrl, '/auth/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
        body: JSON.stringify({ login: 'missing-user', password: 'wrong-password' }),
      }),
    );
  }

  assert.equal((await failedLoginFrom('203.0.113.10')).status, 401);
  assert.equal((await failedLoginFrom('203.0.113.10')).status, 401);
  const blocked = await failedLoginFrom('203.0.113.10');
  assert.equal(blocked.status, 429);

  const otherIp = await failedLoginFrom('203.0.113.20');
  assert.equal(otherIp.status, 401);
});

test('table updates use optimistic concurrency and return current row on conflict', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
  });
  t.after(server.stop);

  const login = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });
  const sync = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const table = sync.tables[0];
  assert.equal(typeof table.version, 'number');
  assert.ok(table.updated_at);

  const updated = await api(server.baseUrl, `/tables/${table.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ status: 'cleaning', expected_version: table.version }),
  });
  assert.equal(updated.status, 'cleaning');
  assert.equal(updated.version, table.version + 1);
  assert.ok(updated.updated_at);

  const conflict = await expectApiError(() =>
    api(server.baseUrl, `/tables/${table.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ status: 'free', expected_version: table.version }),
    }),
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.current.id, table.id);
  assert.equal(conflict.body.current.version, updated.version);
  assert.equal(conflict.body.current.status, 'cleaning');

  const missingVersion = await expectApiError(() =>
    api(server.baseUrl, `/tables/${table.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ status: 'free' }),
    }),
  );
  assert.equal(missingVersion.status, 409);
  assert.equal(missingVersion.body.current.id, table.id);
});

test('assigned waiter can mark bill waiting and transfer own table', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
  });
  t.after(server.stop);

  async function loginAs(login) {
    const response = await api(server.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password: login === 'owner@example.test' ? 'OwnerTestPass-2026!' : 'StaffTestPass-2026!' }),
    });
    const sync = await api(server.baseUrl, '/sync', {
      headers: { Authorization: `Bearer ${response.token}` },
    });
    return { token: response.token, sync };
  }

  const manager = await loginAs('owner@example.test');
  const waiter = await loginAs('waiter');
  const nextWaiter = await loginAs('nino');

  const table = manager.sync.tables[0];
  const assigned = await api(server.baseUrl, `/tables/${table.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ current_waiter_id: waiter.sync.current_user.id, status: 'occupied', expected_version: table.version }),
  });

  const billWaiting = await api(server.baseUrl, `/tables/${table.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${waiter.token}` },
    body: JSON.stringify({ status: 'bill_waiting', expected_version: assigned.version }),
  });
  assert.equal(billWaiting.status, 'bill_waiting');
  assert.equal(billWaiting.current_waiter_id, waiter.sync.current_user.id);

  const transferred = await api(server.baseUrl, `/tables/${table.id}/transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${waiter.token}` },
    body: JSON.stringify({ target_waiter_id: nextWaiter.sync.current_user.id, expected_version: billWaiting.version }),
  });
  assert.equal(transferred.current_waiter_id, nextWaiter.sync.current_user.id);
  assert.equal(transferred.status, 'bill_waiting');

  const notOwnedTable = manager.sync.tables.find((item) => item.id !== table.id);
  assert.ok(notOwnedTable);
  const assignedToOther = await api(server.baseUrl, `/tables/${notOwnedTable.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ current_waiter_id: nextWaiter.sync.current_user.id, status: 'occupied', expected_version: notOwnedTable.version }),
  });
  await assert.rejects(
    () =>
      api(server.baseUrl, `/tables/${notOwnedTable.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${waiter.token}` },
        body: JSON.stringify({ status: 'bill_waiting', expected_version: assignedToOther.version }),
      }),
    (error) => error.status === 403,
  );
});

test('guest table order flows through waiter and kitchen statuses', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
  });
  t.after(server.stop);

  async function loginAs(login) {
    const response = await api(server.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password: login === 'owner@example.test' ? 'OwnerTestPass-2026!' : 'StaffTestPass-2026!' }),
    });
    const sync = await api(server.baseUrl, '/sync', {
      headers: { Authorization: `Bearer ${response.token}` },
    });
    return { token: response.token, sync };
  }

  const manager = await loginAs('owner@example.test');
  const waiter = await loginAs('waiter');
  const chef = await loginAs('kitchen');
  const cook = await loginAs('tamara');

  const table = manager.sync.tables.find((item) => item.checkin_token) ?? manager.sync.tables[0];
  assert.ok(table?.checkin_token);
  await api(server.baseUrl, `/tables/${table.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ current_waiter_id: waiter.sync.current_user.id, status: 'free', expected_version: table.version }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Гость за столом',
      phone: '+7 900 222-33-44',
      personal_data_consent: true,
    }),
  });
  const checkIn = await api(server.baseUrl, '/guest/check-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ token: table.checkin_token }),
  });
  assert.equal(checkIn.table.id, table.id);
  assert.equal(checkIn.profile.current_table_session.table_id, table.id);

  const kitchenDish = chef.sync.menu_items.find((item) => item.is_kitchen && item.status === 'available');
  assert.ok(kitchenDish);
  const order = await api(server.baseUrl, '/guest/orders/items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ menu_item_id: kitchenDish.id, quantity: 2 }),
  });
  assert.equal(order.item.status, 'ordered');

  const waiterAfterOrder = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${waiter.token}` },
  });
  assert.ok(waiterAfterOrder.guest_order_items.some((item) => item.id === order.item.id));
  const accepted = await api(server.baseUrl, `/guest-order-items/${order.item.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${waiter.token}` },
    body: JSON.stringify({ status: 'accepted', expected_version: order.item.version }),
  });

  const chefAfterOrder = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${chef.token}` },
  });
  assert.ok(chefAfterOrder.guest_order_items.some((item) => item.id === order.item.id));
  const assigned = await api(server.baseUrl, `/guest-order-items/${order.item.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${chef.token}` },
    body: JSON.stringify({ assigned_to: cook.sync.current_user.id, expected_version: accepted.version }),
  });
  const inProgress = await api(server.baseUrl, `/guest-order-items/${order.item.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${cook.token}` },
    body: JSON.stringify({ status: 'in_progress', expected_version: assigned.version }),
  });
  const done = await api(server.baseUrl, `/guest-order-items/${order.item.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${cook.token}` },
    body: JSON.stringify({ status: 'done', expected_version: inProgress.version }),
  });
  await api(server.baseUrl, `/guest-order-items/${order.item.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${waiter.token}` },
    body: JSON.stringify({ status: 'served', expected_version: done.version }),
  });

  const guestProfile = await api(server.baseUrl, '/guest/profile', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });
  assert.equal(guestProfile.current_order_items.find((item) => item.id === order.item.id)?.status, 'served');
});

test('iiko paid payment event closes guest visit and creates feedback request', async (t) => {
  const webhookSecret = 'test-iiko-webhook-secret-2026';
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
    IIKO_WEBHOOK_SECRET: webhookSecret,
  });
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });
  const sync = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${manager.token}` },
  });
  const table = sync.tables.find((item) => item.checkin_token) ?? sync.tables[0];
  assert.ok(table?.checkin_token);
  await api(server.baseUrl, `/tables/${table.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ status: 'free', expected_version: table.version }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Payment Feedback Guest',
      phone: '+7 900 444-55-66',
      personal_data_consent: true,
    }),
  });
  const checkIn = await api(server.baseUrl, '/guest/check-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ token: table.checkin_token }),
  });
  assert.equal(checkIn.profile.current_table_session.table_id, table.id);

  const dish = sync.menu_items.find((item) => item.status === 'available');
  assert.ok(dish);
  const order = await api(server.baseUrl, '/guest/orders/items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ menu_item_id: dish.id, quantity: 1 }),
  });

  const noSecret = await expectApiError(() =>
    api(server.baseUrl, '/iiko/events/payment-paid', {
      method: 'POST',
      body: JSON.stringify({ local_order_id: order.order.id, amount: 1900 }),
    }),
  );
  assert.equal(noSecret.status, 401);

  const paid = await api(server.baseUrl, '/iiko/events/payment-paid', {
    method: 'POST',
    headers: { 'X-Gory-Iiko-Secret': webhookSecret },
    body: JSON.stringify({
      order_id: 'iiko-order-feedback-1',
      payment_id: 'iiko-payment-feedback-1',
      local_order_id: order.order.id,
      table_session_id: checkIn.session.id,
      guest_phone: '+7 900 444-55-66',
      amount: 1900,
      status: 'paid',
    }),
  });
  assert.equal(paid.status, 'processed');
  assert.equal(paid.matched, true);
  assert.equal(paid.feedback_request.status, 'requested');
  assert.ok(paid.notification_id);

  const duplicate = await api(server.baseUrl, '/iiko/events/payment-paid', {
    method: 'POST',
    headers: { 'X-Gory-Iiko-Secret': webhookSecret },
    body: JSON.stringify({
      order_id: 'iiko-order-feedback-1',
      payment_id: 'iiko-payment-feedback-1',
      local_order_id: order.order.id,
      table_session_id: checkIn.session.id,
      guest_phone: '+7 900 444-55-66',
      amount: 1900,
      status: 'paid',
    }),
  });
  assert.equal(duplicate.duplicate, true);

  const profile = await api(server.baseUrl, '/guest/profile', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });
  assert.equal(profile.guest.visits_count, 1);
  assert.equal(profile.guest.total_spent, 1900);
  assert.equal(profile.guest.average_check, 1900);
  assert.equal(profile.current_table_session, null);
  assert.equal(profile.current_order_items.length, 0);
  assert.equal(profile.feedback_requests[0].id, paid.feedback_request.id);
  assert.equal(profile.notifications[0].type, 'visit_feedback_request');

  const submitted = await api(server.baseUrl, `/guest/feedback/${paid.feedback_request.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ rating: 5, comment: 'Everything was good' }),
  });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.rating, 5);
});

test('guest bonus redemption is tied to the paid iiko order', async (t) => {
  const webhookSecret = 'test-iiko-webhook-secret-redemption-2026';
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
    IIKO_WEBHOOK_SECRET: webhookSecret,
  });
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });
  const sync = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${manager.token}` },
  });
  const table = sync.tables.find((item) => item.checkin_token) ?? sync.tables[0];
  assert.ok(table?.checkin_token);
  await api(server.baseUrl, `/tables/${table.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ status: 'free', expected_version: table.version }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Bonus Redemption Guest',
      phone: '+7 900 555-66-77',
      personal_data_consent: true,
    }),
  });
  assert.equal(guest.guest.bonus_balance, 300);
  const checkIn = await api(server.baseUrl, '/guest/check-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ token: table.checkin_token }),
  });

  const overLimit = await expectApiError(() =>
    api(server.baseUrl, '/guest/bonus/redemptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest.token}` },
      body: JSON.stringify({
        amount: 250,
        order_amount: 1000,
        iiko_order_id: 'iiko-order-bonus-too-high',
      }),
    }),
  );
  assert.equal(overLimit.status, 400);

  const redemption = await api(server.baseUrl, '/guest/bonus/redemptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({
      amount: 120,
      order_amount: 1500,
      iiko_order_id: 'iiko-order-bonus-1',
    }),
  });
  assert.equal(redemption.redemption.status, 'reserved');
  assert.equal(redemption.redemption.amount, 120);
  assert.equal(redemption.redemption.order_amount, 1500);
  assert.equal(redemption.redemption.max_bonus_amount, 300);
  assert.equal(redemption.redemption.iiko_order_id, 'iiko-order-bonus-1');
  assert.equal(redemption.redemption.table_session_id, checkIn.session.id);
  assert.equal(redemption.transaction.amount, -120);
  assert.equal(redemption.guest.bonus_balance, 180);

  const paid = await api(server.baseUrl, '/iiko/events/payment-paid', {
    method: 'POST',
    headers: { 'X-Gory-Iiko-Secret': webhookSecret },
    body: JSON.stringify({
      order_id: 'iiko-order-bonus-1',
      payment_id: 'iiko-payment-bonus-1',
      table_session_id: checkIn.session.id,
      guest_phone: '+7 900 555-66-77',
      amount: 1500,
      status: 'paid',
    }),
  });
  assert.equal(paid.status, 'processed');
  assert.equal(paid.bonus_redemptions.length, 1);
  assert.equal(paid.bonus_redemptions[0].id, redemption.redemption.id);
  assert.equal(paid.bonus_redemptions[0].status, 'applied');
  assert.equal(paid.bonus_redemptions[0].iiko_payment_event_id, paid.payment_event.id);

  const transactions = await api(server.baseUrl, '/guest/bonus-transactions', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });
  const spend = transactions.items.find((item) => item.id === redemption.transaction.id);
  assert.equal(spend.iiko_order_id, 'iiko-order-bonus-1');
  assert.equal(spend.iiko_payment_event_id, paid.payment_event.id);
});

test('staff can redeem guest bonuses for an iiko order before payment is received', async (t) => {
  const webhookSecret = 'test-iiko-webhook-secret-staff-redemption-2026';
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
    IIKO_WEBHOOK_SECRET: webhookSecret,
  });
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });
  const sync = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${manager.token}` },
  });
  const table = sync.tables.find((item) => item.checkin_token) ?? sync.tables[0];
  assert.ok(table?.checkin_token);
  await api(server.baseUrl, `/tables/${table.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ status: 'free', expected_version: table.version }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Staff Redemption Guest',
      phone: '+7 900 555-66-88',
      personal_data_consent: true,
    }),
  });
  const checkIn = await api(server.baseUrl, '/guest/check-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ token: table.checkin_token }),
  });

  const missingOrderLink = await expectApiError(() =>
    api(server.baseUrl, `/admin/guests/${guest.guest.id}/bonus-redemptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${manager.token}` },
      body: JSON.stringify({
        amount: 20,
        order_amount: 400,
        table_session_id: checkIn.session.id,
      }),
    }),
  );
  assert.equal(missingOrderLink.status, 400);

  const redemption = await api(server.baseUrl, `/admin/guests/${guest.guest.id}/bonus-redemptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      amount: 90,
      order_amount: 1600,
      table_session_id: checkIn.session.id,
      iiko_order_id: 'iiko-order-staff-bonus-1',
    }),
  });
  assert.equal(redemption.redemption.status, 'reserved');
  assert.equal(redemption.redemption.amount, 90);
  assert.equal(redemption.redemption.order_amount, 1600);
  assert.equal(redemption.redemption.max_bonus_amount, 320);
  assert.equal(redemption.transaction.created_by, manager.user.id);
  assert.equal(redemption.transaction.source, 'staff_iiko_payment');
  assert.equal(redemption.guest.bonus_balance, 210);

  const staffSync = await api(server.baseUrl, '/sync?mobile=1', {
    headers: { Authorization: `Bearer ${manager.token}`, 'X-Gory-App': 'mobile' },
  });
  assert.ok(Array.isArray(staffSync.guest_bonus_redemptions));
  const syncedRedemption = staffSync.guest_bonus_redemptions.find((item) => item.id === redemption.redemption.id);
  assert.equal(syncedRedemption.iiko_order_id, 'iiko-order-staff-bonus-1');
  assert.equal(syncedRedemption.table_session_id, checkIn.session.id);
  assert.equal(syncedRedemption.status, 'reserved');
  assert.equal(syncedRedemption.order_amount, 1600);
  assert.equal(syncedRedemption.max_bonus_amount, 320);

  const paid = await api(server.baseUrl, '/iiko/events/payment-paid', {
    method: 'POST',
    headers: { 'X-Gory-Iiko-Secret': webhookSecret },
    body: JSON.stringify({
      order_id: 'iiko-order-staff-bonus-1',
      payment_id: 'iiko-payment-staff-bonus-1',
      table_session_id: checkIn.session.id,
      guest_phone: '+7 900 555-66-88',
      amount: 1600,
      status: 'paid',
    }),
  });
  assert.equal(paid.bonus_redemptions.length, 1);
  assert.equal(paid.bonus_redemptions[0].id, redemption.redemption.id);
  assert.equal(paid.bonus_redemptions[0].status, 'applied');
});

test('imported iiko pos order links bonus redemption to payment by order id only', async (t) => {
  const webhookSecret = 'test-iiko-webhook-secret-imported-order-2026';
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
    IIKO_WEBHOOK_SECRET: webhookSecret,
  });
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });
  const sync = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${manager.token}` },
  });
  const table = sync.tables.find((item) => item.checkin_token) ?? sync.tables[0];
  assert.ok(table?.checkin_token);
  await api(server.baseUrl, `/tables/${table.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ status: 'free', expected_version: table.version }),
  });

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Imported Iiko Order Guest',
      phone: '+7 900 555-66-99',
      personal_data_consent: true,
    }),
  });
  const checkIn = await api(server.baseUrl, '/guest/check-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ token: table.checkin_token }),
  });

  const imported = await api(server.baseUrl, '/iiko/events/order-updated', {
    method: 'POST',
    headers: { 'X-Gory-Iiko-Secret': webhookSecret },
    body: JSON.stringify({
      order_id: 'iiko-pos-order-1',
      order_number: 'POS-77',
      table_number: table.number,
      amount: 2200,
      status: 'open',
    }),
  });
  assert.equal(imported.status, 'processed');
  assert.equal(imported.matched, true);
  assert.equal(imported.order.iiko_order_id, 'iiko-pos-order-1');
  assert.equal(imported.order.guest_id, guest.guest.id);
  assert.equal(imported.order.table_session_id, checkIn.session.id);
  assert.equal(imported.order.amount, 2200);

  const staffSync = await api(server.baseUrl, '/sync?mobile=1', {
    headers: { Authorization: `Bearer ${manager.token}`, 'X-Gory-App': 'mobile' },
  });
  assert.ok(Array.isArray(staffSync.iiko_external_orders));
  const syncedOrder = staffSync.iiko_external_orders.find((item) => item.iiko_order_id === 'iiko-pos-order-1');
  assert.equal(syncedOrder.guest_id, guest.guest.id);
  assert.equal(syncedOrder.table_session_id, checkIn.session.id);
  assert.equal(syncedOrder.amount, 2200);

  const redemption = await api(server.baseUrl, `/admin/guests/${guest.guest.id}/bonus-redemptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      amount: 200,
      order_amount: 2200,
      table_session_id: checkIn.session.id,
      iiko_order_id: 'iiko-pos-order-1',
    }),
  });
  assert.equal(redemption.redemption.status, 'reserved');

  const paid = await api(server.baseUrl, '/iiko/events/payment-paid', {
    method: 'POST',
    headers: { 'X-Gory-Iiko-Secret': webhookSecret },
    body: JSON.stringify({
      order_id: 'iiko-pos-order-1',
      payment_id: 'iiko-pos-payment-1',
      amount: 2200,
      status: 'paid',
    }),
  });
  assert.equal(paid.status, 'processed');
  assert.equal(paid.matched, true);
  assert.equal(paid.payment_event.guest_id, guest.guest.id);
  assert.equal(paid.payment_event.table_session_id, checkIn.session.id);
  assert.equal(paid.bonus_redemptions.length, 1);
  assert.equal(paid.bonus_redemptions[0].id, redemption.redemption.id);
  assert.equal(paid.bonus_redemptions[0].status, 'applied');
});

test('server refuses to start without separate guest jwt secret', async () => {
  const port = 5200 + Math.floor(Math.random() * 500);
  const env = serverEnv(port, {
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
  });
  env.GUEST_JWT_SECRET = '';

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitCode = await waitForExit(child);
  if (exitCode === null) {
    child.kill('SIGTERM');
  }
  assert.notEqual(exitCode, null);
  assert.notEqual(exitCode, 0);
});

test('role access matrix protects manager-only and role-specific routes', async (t) => {
  const server = await startTestServer({
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
  });
  t.after(server.stop);

  async function loginAs(login) {
    const response = await api(server.baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password: login === 'owner@example.test' ? 'OwnerTestPass-2026!' : 'StaffTestPass-2026!' }),
    });
    const sync = await api(server.baseUrl, '/sync', {
      headers: { Authorization: `Bearer ${response.token}` },
    });
    return { token: response.token, sync };
  }

  const manager = await loginAs('owner@example.test');
  const owner = await loginAs('owner');
  const technician = await loginAs('technician');
  const administrator = await loginAs('alenam');
  const hostess = await loginAs('hostess');
  const waiter = await loginAs('waiter');
  const chef = await loginAs('kitchen');
  const cook = await loginAs('tamara');
  const bar = await loginAs('bar');

  assert.equal(manager.sync.current_user.role, 'manager');
  assert.ok(!manager.sync.sections.includes('admin'));
  assert.ok(manager.sync.sections.includes('menu'));
  assert.ok(manager.sync.sections.includes('clients'));
  assert.equal(manager.sync.sections[0], 'home');

  assert.equal(owner.sync.current_user.role, 'owner');
  assert.deepEqual(owner.sync.sections.slice(0, 5), ['analytics', 'clients', 'staff', 'schedule', 'home']);
  assert.ok(!owner.sync.sections.includes('menu'));
  assert.ok(!owner.sync.sections.includes('stoplist'));
  assert.equal(owner.sync.menu_items.length, 0);
  assert.equal(owner.sync.stop_list.length, 0);

  assert.equal(technician.sync.current_user.role, 'technician');
  assert.equal(technician.sync.sections[0], 'admin');
  assert.ok(technician.sync.sections.includes('menu'));
  assert.ok(technician.sync.sections.includes('clients'));

  assert.deepEqual(waiter.sync.sections.slice(0, 5), ['notebook', 'menu', 'myTables', 'notifications', 'profile']);
  assert.deepEqual(cook.sync.sections.slice(0, 5), ['stoplist', 'tasks', 'events', 'notifications', 'profile']);

  await api(server.baseUrl, '/system/status', { headers: { Authorization: `Bearer ${technician.token}` } });
  await assert.rejects(() => api(server.baseUrl, '/system/status', { headers: { Authorization: `Bearer ${manager.token}` } }), (error) => error.status === 403);
  await assert.rejects(() => api(server.baseUrl, '/system/status', { headers: { Authorization: `Bearer ${owner.token}` } }), (error) => error.status === 403);
  await assert.rejects(() => api(server.baseUrl, '/system/status', { headers: { Authorization: `Bearer ${administrator.token}` } }), (error) => error.status === 403);
  await assert.rejects(() => api(server.baseUrl, '/system/status', { headers: { Authorization: `Bearer ${hostess.token}` } }), (error) => error.status === 403);
  await assert.rejects(() => api(server.baseUrl, '/system/status', { headers: { Authorization: `Bearer ${waiter.token}` } }), (error) => error.status === 403);

  const tableId = hostess.sync.tables[0].id;
  const assignedTable = await api(server.baseUrl, `/tables/${tableId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${hostess.token}` },
    body: JSON.stringify({
      current_waiter_id: waiter.sync.current_user.id,
      status: 'cleaning',
      expected_version: hostess.sync.tables[0].version,
    }),
  });
  const readyTable = await api(server.baseUrl, `/tables/${tableId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${waiter.token}` },
    body: JSON.stringify({ status: 'free', expected_version: assignedTable.version }),
  });
  assert.equal(readyTable.status, 'free');
  const otherTableId = hostess.sync.tables.find((table) => table.id !== tableId)?.id;
  assert.ok(otherTableId);
  const otherTable = hostess.sync.tables.find((table) => table.id === otherTableId);
  assert.ok(otherTable);
  await api(server.baseUrl, `/tables/${otherTableId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${hostess.token}` },
    body: JSON.stringify({ current_waiter_id: hostess.sync.current_user.id, status: 'cleaning', expected_version: otherTable.version }),
  });
  await assert.rejects(
    () =>
      api(server.baseUrl, `/tables/${otherTableId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${waiter.token}` },
        body: JSON.stringify({ status: 'free' }),
      }),
    (error) => error.status === 403,
  );

  const editableMenuItemId = chef.sync.menu_items.find((item) => item.status === 'available')?.id;
  assert.ok(editableMenuItemId);
  await api(server.baseUrl, `/menu-items/${editableMenuItemId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${chef.token}` },
    body: JSON.stringify({ waiter_hint: 'role check chef edit' }),
  });
  await assert.rejects(
    () =>
      api(server.baseUrl, `/menu-items/${editableMenuItemId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${cook.token}` },
        body: JSON.stringify({ waiter_hint: 'role check cook edit' }),
      }),
    (error) => error.status === 403,
  );

  const menuCategoryId = chef.sync.menu_categories[0]?.id;
  assert.ok(menuCategoryId);
  const kitchenStopListItem = await api(server.baseUrl, '/menu-items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chef.token}` },
    body: JSON.stringify({
      name: 'Role check kitchen stop-list',
      category_id: menuCategoryId,
      price: 1,
      is_bar: false,
      is_kitchen: true,
      status: 'available',
    }),
  });
  const barStopListItem = await api(server.baseUrl, '/menu-items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chef.token}` },
    body: JSON.stringify({
      name: 'Role check bar stop-list',
      category_id: menuCategoryId,
      price: 1,
      item_type: 'alcohol',
      is_bar: true,
      is_kitchen: false,
      status: 'available',
    }),
  });

  const barSyncAfterMenuChanges = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${bar.token}` },
  });
  assert.ok(!barSyncAfterMenuChanges.menu_items.some((item) => item.id === kitchenStopListItem.id));
  assert.ok(barSyncAfterMenuChanges.menu_items.some((item) => item.id === barStopListItem.id));

  await assert.rejects(
    () =>
      api(server.baseUrl, '/stop-list', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bar.token}` },
        body: JSON.stringify({ menu_item_id: kitchenStopListItem.id, reason: 'role check', status: 'out' }),
      }),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () =>
      api(server.baseUrl, '/stop-list', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cook.token}` },
        body: JSON.stringify({ menu_item_id: barStopListItem.id, reason: 'role check', status: 'out' }),
      }),
    (error) => error.status === 403,
  );
  await api(server.baseUrl, '/stop-list', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cook.token}` },
    body: JSON.stringify({ menu_item_id: kitchenStopListItem.id, reason: 'role check', status: 'out' }),
  });
  await api(server.baseUrl, '/stop-list', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bar.token}` },
    body: JSON.stringify({ menu_item_id: barStopListItem.id, reason: 'role check', status: 'out' }),
  });
  await assert.rejects(
    () =>
      api(server.baseUrl, '/stop-list', {
        method: 'POST',
        headers: { Authorization: `Bearer ${waiter.token}` },
        body: JSON.stringify({ menu_item_id: waiter.sync.menu_items[0].id, reason: 'role check', status: 'out' }),
      }),
    (error) => error.status === 403,
  );

  await assert.rejects(
    () =>
      api(server.baseUrl, '/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${administrator.token}` },
        body: JSON.stringify({ name: 'No Manager', login: 'no-manager', password: 'NoManager-2026!', role: 'waiter' }),
      }),
    (error) => error.status === 403,
  );

  await api(server.baseUrl, '/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ name: 'Owner Staff', login: 'owner-staff', password: 'OwnerStaff-2026!', role: 'waiter' }),
  });
});
