const assert = require('node:assert/strict');
const test = require('node:test');

const {
  iikoOrderStatusSyncIntervalMs,
  startIikoOrderStatusSyncScheduler,
} = require('../src/integrations/iiko/scheduler');

function enabledEnv(overrides = {}) {
  return {
    IIKO_ENABLED: 'true',
    IIKO_API_LOGIN: 'test-api-login',
    IIKO_ORGANIZATION_ID: 'org-1',
    IIKO_ORDER_SYNC_ENABLED: 'true',
    ...overrides,
  };
}

test('iiko order status scheduler interval is enabled by default when iiko order sync is configured', () => {
  assert.equal(iikoOrderStatusSyncIntervalMs(enabledEnv()), 60000);
  assert.equal(iikoOrderStatusSyncIntervalMs(enabledEnv({ IIKO_ORDER_STATUS_SYNC_INTERVAL_SECONDS: '120' })), 120000);
  assert.equal(iikoOrderStatusSyncIntervalMs(enabledEnv({ IIKO_ORDER_STATUS_SYNC_INTERVAL_SECONDS: '5' })), 30000);
});

test('iiko order status scheduler interval is disabled when iiko or order sync is disabled', () => {
  assert.equal(iikoOrderStatusSyncIntervalMs(enabledEnv({ IIKO_ENABLED: 'false' })), 0);
  assert.equal(iikoOrderStatusSyncIntervalMs(enabledEnv({ IIKO_ORDER_SYNC_ENABLED: 'false' })), 0);
  assert.equal(iikoOrderStatusSyncIntervalMs(enabledEnv({ IIKO_ORDER_STATUS_SYNC_ENABLED: 'false' })), 0);
  assert.equal(iikoOrderStatusSyncIntervalMs(enabledEnv({ IIKO_API_LOGIN: '' })), 0);
});

test('iiko order status scheduler starts an unref interval and skips overlapping runs', async () => {
  const intervalCalls = [];
  const cleared = [];
  const syncCalls = [];
  let intervalHandler = null;
  let releaseRun;
  const firstRun = new Promise((resolve) => {
    releaseRun = resolve;
  });

  const scheduler = startIikoOrderStatusSyncScheduler({
    db: { query: async () => ({ rows: [] }) },
    env: enabledEnv({ IIKO_ORDER_STATUS_SYNC_INTERVAL_SECONDS: '30' }),
    randomUUID: () => 'generated-id',
    logger: { warn: () => {} },
    syncOpenIikoOrderStatuses: async (options) => {
      syncCalls.push(options.env.IIKO_ORGANIZATION_ID);
      await firstRun;
      return { status: 'completed' };
    },
    setIntervalFn(handler, intervalMs) {
      intervalHandler = handler;
      intervalCalls.push(intervalMs);
      return { unrefCalled: false, unref() { this.unrefCalled = true; } };
    },
    clearIntervalFn(timer) {
      cleared.push(timer);
    },
  });

  assert.equal(scheduler.enabled, true);
  assert.equal(scheduler.intervalMs, 30000);
  assert.equal(intervalCalls[0], 30000);
  assert.equal(scheduler.timer.unrefCalled, true);

  const firstTick = intervalHandler();
  await intervalHandler();
  assert.deepEqual(syncCalls, ['org-1']);

  releaseRun();
  await firstTick;
  await scheduler.runNow();
  assert.deepEqual(syncCalls, ['org-1', 'org-1']);

  scheduler.stop();
  assert.equal(cleared.length, 1);
});
