const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NOTIFICATION_TYPE,
  guestMarketingPushConfig,
  selectGuestMarketingMessage,
  sendGuestMarketingNotifications,
} = require('../src/guestMarketingPush');

function fakePool({ guests = [], lastRunAt = null } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('FROM activity_log')) {
        return { rows: lastRunAt ? [{ id: 'last-run', created_at: lastRunAt }] : [] };
      }
      if (sql.includes('FROM guest_users')) {
        return { rows: guests };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      released = true;
    },
  };

  return {
    pool: {
      async connect() {
        return client;
      },
    },
    queries,
    isReleased: () => released,
  };
}

test('guest marketing push config is enabled by default and can be disabled', () => {
  assert.equal(guestMarketingPushConfig({}).enabled, true);
  assert.equal(guestMarketingPushConfig({ DISABLE_PUSH: '1' }).enabled, false);
  assert.equal(guestMarketingPushConfig({ DISABLE_GUEST_MARKETING_PUSH: '1' }).enabled, false);
  assert.equal(guestMarketingPushConfig({ GUEST_MARKETING_PUSH_INTERVAL_MS: '0' }).enabled, false);
});

test('sendGuestMarketingNotifications sends branded campaign only to marketing audience query', async () => {
  const now = new Date('2026-05-30T12:00:00.000Z');
  const store = fakePool({
    guests: [{ id: 'guest-1' }, { id: 'guest-2' }],
  });
  const notifications = [];
  const logs = [];

  const result = await sendGuestMarketingNotifications({
    pool: store.pool,
    env: {
      GUEST_MARKETING_PUSH_INTERVAL_MS: String(24 * 60 * 60 * 1000),
      GUEST_MARKETING_PUSH_LIMIT: '2',
    },
    now: () => now,
    logger: { warn() {} },
    createGuestNotification: async (_client, payload) => {
      notifications.push(payload);
      return `notification-${payload.guestId}`;
    },
    logActivity: async (_client, userId, action, entityType, entityId, oldValue, newValue) => {
      logs.push({ userId, action, entityType, entityId, oldValue, newValue });
    },
  });

  const expectedMessage = selectGuestMarketingMessage(now);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.notified, 2);
  assert.equal(result.title, expectedMessage.title);
  assert.equal(result.text, expectedMessage.text);

  assert.deepEqual(
    notifications.map((item) => item.guestId),
    ['guest-1', 'guest-2'],
  );
  for (const notification of notifications) {
    assert.equal(notification.type, NOTIFICATION_TYPE);
    assert.equal(notification.push, true);
    assert.equal(notification.respectMarketing, true);
    assert.equal(notification.data.campaign_id, 'meat_to_mountains');
    assert.equal(notification.data.source, 'scheduled_marketing');
  }

  const guestQuery = store.queries.find((query) => query.sql.includes('FROM guest_users'));
  assert.ok(guestQuery);
  assert.match(guestQuery.sql, /marketing_consent = TRUE/);
  assert.match(guestQuery.sql, /status = 'active'/);
  assert.deepEqual(guestQuery.params, [2]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'push.guest_marketing');
  assert.equal(logs[0].entityType, 'guest_marketing_campaign');
  assert.equal(logs[0].newValue.type, NOTIFICATION_TYPE);
  assert.equal(logs[0].newValue.notified, 2);
  assert.equal(store.isReleased(), true);
});

test('sendGuestMarketingNotifications skips when last campaign run is still recent', async () => {
  const now = new Date('2026-05-30T12:00:00.000Z');
  const store = fakePool({
    guests: [{ id: 'guest-1' }],
    lastRunAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
  });
  const notifications = [];
  const logs = [];

  const result = await sendGuestMarketingNotifications({
    pool: store.pool,
    env: { GUEST_MARKETING_PUSH_INTERVAL_MS: String(60 * 60 * 1000) },
    now: () => now,
    logger: { warn() {} },
    createGuestNotification: async (_client, payload) => {
      notifications.push(payload);
      return `notification-${payload.guestId}`;
    },
    logActivity: async (_client, userId, action, entityType, entityId, oldValue, newValue) => {
      logs.push({ userId, action, entityType, entityId, oldValue, newValue });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'recent');
  assert.equal(notifications.length, 0);
  assert.equal(logs.length, 0);
  assert.equal(store.queries.some((query) => query.sql.includes('FROM guest_users')), false);
  assert.equal(store.isReleased(), true);
});

test('sendGuestMarketingNotifications does not connect to database when disabled', async () => {
  let connected = false;
  const result = await sendGuestMarketingNotifications({
    pool: {
      async connect() {
        connected = true;
        throw new Error('should not connect');
      },
    },
    env: { DISABLE_PUSH: '1' },
    createGuestNotification: async () => {
      throw new Error('should not send');
    },
    logger: { warn() {} },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(connected, false);
});
