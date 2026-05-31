const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { newDb } = require('pg-mem');
const {
  iikoStaffSyncIntervalMs,
  startIikoStaffSyncScheduler,
} = require('../src/integrations/iiko/staffScheduler');
const { mapIikoRoleToLocal, syncIikoStaff } = require('../src/integrations/iiko/staffSync');
const { seedRoles } = require('../src/seed');

function enabledEnv(overrides = {}) {
  return {
    IIKO_ENABLED: 'true',
    IIKO_API_LOGIN: 'test-login',
    IIKO_ORGANIZATION_ID: 'test-org-id',
    IIKO_STAFF_SYNC_ENABLED: 'true',
    ...overrides,
  };
}

test('staff sync interval is enabled by default when iiko is configured', () => {
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv()), 3600000); // 1 час
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv({ IIKO_STAFF_SYNC_INTERVAL_SECONDS: '7200' })), 7200000); // 2 часа
});

test('staff sync maps iiko kitchen roles to existing local roles', () => {
  assert.equal(mapIikoRoleToLocal('kitchen'), 'chef');
  assert.equal(mapIikoRoleToLocal('кухня'), 'chef');
  assert.equal(mapIikoRoleToLocal('повар'), 'cook');
});

test('staff sync interval enforces minimum of 30 minutes', () => {
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv({ IIKO_STAFF_SYNC_INTERVAL_SECONDS: '1200' })), 1800000); // 30 минут
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv({ IIKO_STAFF_SYNC_INTERVAL_SECONDS: '600' })), 1800000); // 30 минут
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv({ IIKO_STAFF_SYNC_INTERVAL_SECONDS: '1800' })), 1800000); // 30 минут
});

test('staff sync interval is disabled when iiko or staff sync is disabled', () => {
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv({ IIKO_ENABLED: 'false' })), 0);
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv({ IIKO_STAFF_SYNC_ENABLED: 'false' })), 0);
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv({ IIKO_ORGANIZATION_ID: '' })), 0);
  assert.equal(iikoStaffSyncIntervalMs(enabledEnv({ IIKO_API_LOGIN: '' })), 0);
});

test('staff sync scheduler starts an unref interval and skips overlapping runs', async () => {
  const intervalCalls = [];
  const cleared = [];
  let intervalHandler = null;
  let releaseRun = null;
  const syncCalls = [];

  const scheduler = startIikoStaffSyncScheduler({
    db: { query: async () => ({ rows: [] }) },
    env: enabledEnv({ IIKO_STAFF_SYNC_INTERVAL_SECONDS: '3600' }),
    randomUUID: () => 'test-uuid',
    logger: console,
    syncIikoStaff: async (options) => {
      syncCalls.push(options.triggerType);
      await new Promise((resolve) => { releaseRun = resolve; });
      return { status: 'completed', staff: { created: 0, updated: 0, archived: 0 } };
    },
    setIntervalFn(handler, intervalMs) {
      intervalHandler = handler;
      intervalCalls.push(intervalMs);
      return {
        unrefCalled: false,
        unref() { this.unrefCalled = true; },
      };
    },
    clearIntervalFn(timer) {
      cleared.push(timer);
    },
  });

  assert.equal(scheduler.enabled, true);
  assert.equal(scheduler.intervalMs, 3600000);
  assert.equal(intervalCalls[0], 3600000);
  assert.equal(scheduler.timer.unrefCalled, true);

  // Первый запуск
  const firstTick = intervalHandler();

  // Второй запуск (должен быть пропущен)
  const secondTick = intervalHandler();
  const secondResult = await secondTick;
  assert.equal(secondResult.status, 'skipped');
  assert.equal(secondResult.reason, 'already_running');

  // Завершаем первый запуск
  releaseRun();
  await firstTick;

  // Проверяем, что синхронизация была вызвана один раз с правильным triggerType
  assert.deepEqual(syncCalls, ['scheduled']);

  scheduler.stop();
  assert.equal(cleared.length, 1);
});

test('staff sync scheduler returns disabled object when interval is 0', () => {
  const scheduler = startIikoStaffSyncScheduler({
    db: { query: async () => ({ rows: [] }) },
    env: enabledEnv({ IIKO_STAFF_SYNC_ENABLED: 'false' }),
    randomUUID: () => 'test-uuid',
    logger: console,
  });

  assert.equal(scheduler.enabled, false);
  assert.equal(scheduler.intervalMs, 0);
  assert.equal(scheduler.timer, null);
  assert.equal(typeof scheduler.runNow, 'function');
  assert.equal(typeof scheduler.stop, 'function');
});

test('staff sync scheduler runNow can be called manually', async () => {
  const syncCalls = [];

  const scheduler = startIikoStaffSyncScheduler({
    db: { query: async () => ({ rows: [] }) },
    env: enabledEnv({ IIKO_STAFF_SYNC_INTERVAL_SECONDS: '3600' }),
    randomUUID: () => 'test-uuid',
    logger: console,
    syncIikoStaff: async (options) => {
      syncCalls.push(options.triggerType);
      return { status: 'completed', staff: { created: 1, updated: 2, archived: 0 } };
    },
    setIntervalFn() {
      return { unref() {} };
    },
    clearIntervalFn() {},
  });

  const result = await scheduler.runNow();

  assert.equal(result.status, 'completed');
  assert.equal(result.staff.created, 1);
  assert.equal(result.staff.updated, 2);
  assert.deepEqual(syncCalls, ['scheduled']);

  scheduler.stop();
});

test('staff sync creates unique logins for iiko employees with the same generated login', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  const schema = await fs.readFile(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');
  const client = await pool.connect();
  await client.query(schema);
  await seedRoles(client);
  client.release();

  const result = await syncIikoStaff({
    db: pool,
    env: enabledEnv(),
    randomUUID: (() => {
      let index = 0;
      return () => `uuid-${++index}`;
    })(),
    logger: { info() {}, error() {} },
    iikoClient: {
      fetchEmployees: async () => ({
        employees: [
          { id: 'iiko-1', name: 'Same Person', role: 'waiter' },
          { id: 'iiko-2', name: 'Same Person', role: 'waiter' },
        ],
      }),
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.staff.created, 2);

  const users = await pool.query('SELECT login FROM users WHERE iiko_id IS NOT NULL ORDER BY iiko_id');
  assert.equal(users.rows.length, 2);
  assert.notEqual(users.rows[0].login, users.rows[1].login);
  await pool.end();
});
