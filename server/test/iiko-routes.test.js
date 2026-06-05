const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { newDb } = require('pg-mem');
const { api, delay, startTestServer: startSharedTestServer } = require('./test-helpers');

const { registerIikoRoutes } = require('../src/routes/iiko');

const serverRoot = path.resolve(__dirname, '..');
const iikoEnvKeys = [
  'IIKO_ENABLED',
  'IIKO_API_BASE',
  'IIKO_API_LOGIN',
  'IIKO_ORGANIZATION_ID',
  'IIKO_TERMINAL_GROUP_ID',
  'IIKO_WEBHOOK_SECRET',
  'IIKO_JOB_MAX_ATTEMPTS',
  'IIKO_JOB_RETRY_DELAYS_MS',
];

async function expectApiError(request) {
  try {
    await request();
  } catch (error) {
    return error;
  }
  throw new Error('Expected API request to fail.');
}

async function createSchemaPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  const schema = await fs.readFile(path.join(serverRoot, 'src', 'schema.sql'), 'utf8');
  await pool.query(schema);
  return pool;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function withIikoEnv(env, callback) {
  const previous = new Map(iikoEnvKeys.map((key) => [key, process.env[key]]));
  for (const key of iikoEnvKeys) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      process.env[key] = env[key];
    } else {
      delete process.env[key];
    }
  }

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

async function startIikoRouteServer(env, setupDb = async () => {}, routeDeps = {}) {
  const pool = await createSchemaPool();
  await pool.query("INSERT INTO roles (id, name, permissions) VALUES ('role-manager', 'manager', '[]'::jsonb) ON CONFLICT (name) DO NOTHING");
  await pool.query(
    `INSERT INTO users (id, name, phone, login, password_hash, role, position, status)
     VALUES ('test-manager', 'Test Manager', '+10000000000', 'test-manager', 'hash', 'manager', 'Manager', 'off_shift')
     ON CONFLICT (id) DO NOTHING`,
  );
  await setupDb(pool);

  const app = express();
  app.use(express.json());
  registerIikoRoutes(app, {
    pool,
    asyncHandler,
    authMiddleware(req, _res, next) {
      req.user = { id: 'test-manager', role: 'manager' };
      next();
    },
    requirePermission() {
      return (_req, _res, next) => next();
    },
    randomUUID: () => 'test-generated-id',
    emitChange: () => {},
    ...routeDeps,
  });
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
    async request(route, options = {}) {
      return await withIikoEnv(env, () => api(`http://127.0.0.1:${address.port}`, route, options));
    },
  };
}

async function startTestServer() {
  return startSharedTestServer({
    IIKO_ENABLED: 'false',
    IIKO_API_LOGIN: '',
    IIKO_ORGANIZATION_ID: '',
    IIKO_TERMINAL_GROUP_ID: '',
  });
}

async function waitForIikoJob(server, id, headers = {}) {
  let job = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const payload = server.request
      ? await server.request(`/iiko/jobs/${id}`, { headers })
      : await api(server.baseUrl, `/iiko/jobs/${id}`, { headers });
    job = payload.job;
    if (['succeeded', 'failed'].includes(job.status)) return job;
    await delay(50);
  }
  throw new Error(`iiko job ${id} did not finish. Last status: ${job?.status ?? 'unknown'}`);
}

test('iiko admin endpoints require menu management permission and do not call iiko when disabled', async (t) => {
  const server = await startTestServer();
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });
  const waiter = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'waiter', password: 'StaffTestPass-2026!' }),
  });

  const status = await api(server.baseUrl, '/iiko/status', {
    headers: { Authorization: `Bearer ${manager.token}` },
  });
  assert.equal(status.enabled, false);
  assert.equal(status.api_login_configured, false);
  assert.equal(status.endpoints.nomenclature, '/api/1/nomenclature');

  const sync = await api(server.baseUrl, '/iiko/sync/menu', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
  });
  assert.equal(sync.job.status, 'queued');
  const syncJob = await waitForIikoJob({ baseUrl: server.baseUrl }, sync.job.id, { Authorization: `Bearer ${manager.token}` });
  assert.equal(syncJob.status, 'succeeded');
  assert.equal(syncJob.result.status, 'disabled');

  const forbidden = await expectApiError(() =>
    api(server.baseUrl, '/iiko/status', {
      headers: { Authorization: `Bearer ${waiter.token}` },
    }),
  );
  assert.equal(forbidden.status, 403);
});

test('iiko status reports disabled integration, missing env, and empty sync log', async (t) => {
  const server = await startIikoRouteServer({
    IIKO_ENABLED: '',
    IIKO_API_LOGIN: '',
    IIKO_ORGANIZATION_ID: '',
    IIKO_TERMINAL_GROUP_ID: '',
  });
  t.after(server.stop);

  const status = await server.request('/iiko/status');

  assert.equal(status.enabled, false);
  assert.equal(status.env.ok, false);
  assert.deepEqual(status.env.missing.sort(), ['IIKO_API_LOGIN', 'IIKO_ENABLED', 'IIKO_ORGANIZATION_ID']);
  assert.equal(status.env.apiLoginMasked, null);
  assert.equal(status.lastSync.status, 'disabled');
  assert.equal(status.lastSync.startedAt, null);
  assert.equal(status.lastSync.finishedAt, null);
  assert.equal(status.lastSync.error, null);
});

test('iiko status reports enabled integration with masked api login and no sync logs', async (t) => {
  const apiLogin = 'test-api-login';
  const server = await startIikoRouteServer({
    IIKO_ENABLED: 'true',
    IIKO_API_LOGIN: apiLogin,
    IIKO_ORGANIZATION_ID: 'org-1',
    IIKO_TERMINAL_GROUP_ID: 'terminal-1',
  });
  t.after(server.stop);

  const status = await server.request('/iiko/status');
  const serialized = JSON.stringify(status);

  assert.equal(status.enabled, true);
  assert.equal(status.env.ok, true);
  assert.deepEqual(status.env.missing, []);
  assert.equal(status.env.organizationId, 'org-1');
  assert.equal(status.env.terminalGroupId, 'terminal-1');
  assert.equal(status.env.apiLoginMasked, 'te***in');
  assert.equal(serialized.includes(apiLogin), false);
  assert.equal(status.lastSync.status, null);
  assert.equal(status.lastSync.startedAt, null);
  assert.equal(status.lastSync.finishedAt, null);
});

test('iiko status exposes latest successful sync diagnostics', async (t) => {
  const server = await startIikoRouteServer(
    {
      IIKO_ENABLED: 'true',
      IIKO_API_LOGIN: 'test-api-login',
      IIKO_ORGANIZATION_ID: 'org-1',
      IIKO_TERMINAL_GROUP_ID: 'terminal-1',
    },
    async (pool) => {
      await pool.query(
        `INSERT INTO iiko_sync_log
           (id, status, started_at, finished_at, duration_ms,
            categories_created, categories_updated, items_created, items_updated, items_archived,
            stop_list_items, error_message)
         VALUES
           ('old-log', 'failed', '2026-05-28T09:00:00Z', '2026-05-28T09:00:03Z', 3000,
            0, 0, 0, 0, 0, 0, 'older failure'),
           ('new-log', 'completed', '2026-05-28T10:00:00Z', '2026-05-28T10:00:05Z', 5000,
            5, 7, 100, 40, 8, 3, NULL)`,
      );
    },
  );
  t.after(server.stop);

  const status = await server.request('/iiko/status');

  assert.equal(status.lastSync.status, 'success');
  assert.equal(status.lastSync.startedAt, '2026-05-28T10:00:00.000Z');
  assert.equal(status.lastSync.finishedAt, '2026-05-28T10:00:05.000Z');
  assert.equal(status.lastSync.categoriesProcessed, 12);
  assert.equal(status.lastSync.itemsProcessed, 148);
  assert.equal(status.lastSync.stopListItems, 3);
  assert.equal(status.lastSync.error, null);
});

test('iiko status exposes latest failed sync diagnostics with error text', async (t) => {
  const server = await startIikoRouteServer(
    {
      IIKO_ENABLED: 'true',
      IIKO_API_LOGIN: 'test-api-login',
      IIKO_ORGANIZATION_ID: 'org-1',
      IIKO_TERMINAL_GROUP_ID: 'terminal-1',
    },
    async (pool) => {
      await pool.query(
        `INSERT INTO iiko_sync_log
           (id, status, started_at, finished_at, duration_ms,
            categories_created, categories_updated, items_created, items_updated, items_archived,
            stop_list_items, error_message)
         VALUES
           ('failed-log', 'failed', '2026-05-28T11:00:00Z', '2026-05-28T11:00:02Z', 2000,
            0, 0, 0, 0, 0, 0, 'nomenclature request failed')`,
      );
    },
  );
  t.after(server.stop);

  const status = await server.request('/iiko/status');

  assert.equal(status.lastSync.status, 'failed');
  assert.equal(status.lastSync.startedAt, '2026-05-28T11:00:00.000Z');
  assert.equal(status.lastSync.finishedAt, '2026-05-28T11:00:02.000Z');
  assert.equal(status.lastSync.categoriesProcessed, 0);
  assert.equal(status.lastSync.itemsProcessed, 0);
  assert.equal(status.lastSync.error, 'nomenclature request failed');
});

test('iiko status exposes latest order sync diagnostics', async (t) => {
  const server = await startIikoRouteServer(
    {
      IIKO_ENABLED: 'true',
      IIKO_API_LOGIN: 'test-api-login',
      IIKO_ORGANIZATION_ID: 'org-1',
      IIKO_TERMINAL_GROUP_ID: 'terminal-1',
    },
    async (pool) => {
      await pool.query(
        `INSERT INTO iiko_order_sync_log
           (id, order_id, operation, status, started_at, finished_at, duration_ms,
            items_synced, iiko_order_id, correlation_id, error_message)
         VALUES
           ('old-order-log', NULL, 'create', 'failed', '2026-05-28T10:00:00Z', '2026-05-28T10:00:04Z', 4000,
            0, NULL, NULL, 'older order failure'),
           ('new-order-log', NULL, 'add_items', 'completed', '2026-05-28T11:00:00Z', '2026-05-28T11:00:02Z', 2000,
            2, 'iiko-order-1', 'corr-order-1', NULL)`,
      );
    },
  );
  t.after(server.stop);

  const status = await server.request('/iiko/status');

  assert.equal(status.orderSync.lastSync.status, 'success');
  assert.equal(status.orderSync.lastSync.operation, 'add_items');
  assert.equal(status.orderSync.lastSync.itemsSynced, 2);
  assert.equal(status.orderSync.lastSync.iikoOrderId, 'iiko-order-1');
  assert.equal(status.orderSync.lastSync.correlationId, 'corr-order-1');
  assert.equal(status.orderSync.lastSync.error, null);
  assert.equal(status.endpoints.order_create, '/api/1/order/create');
  assert.equal(status.endpoints.order_add_items, '/api/1/order/add_items');
  assert.equal(status.endpoints.local_order_status_sync, '/iiko/sync/orders/:orderId/status');
  assert.equal(status.endpoints.local_open_order_status_sync, '/iiko/sync/orders/statuses');
});

test('iiko order sync endpoint delegates a local order sync and returns diagnostics', async (t) => {
  const calls = [];
  const server = await startIikoRouteServer(
    {
      IIKO_ENABLED: 'true',
      IIKO_API_LOGIN: 'test-api-login',
      IIKO_ORGANIZATION_ID: 'org-1',
      IIKO_TERMINAL_GROUP_ID: 'terminal-1',
    },
    async () => {},
    {
      syncGuestOrderToIiko: async (options) => {
        calls.push({
          orderId: options.orderId,
          envOrganizationId: options.env.IIKO_ORGANIZATION_ID,
        });
        return {
          status: 'completed',
          operation: 'create',
          orderId: options.orderId,
          iikoOrderId: 'iiko-order-1',
          items: { synced: 2 },
        };
      },
    },
  );
  t.after(server.stop);

  const queued = await server.request('/iiko/sync/orders/order-1', { method: 'POST' });
  const job = await waitForIikoJob(server, queued.job.id);
  const result = job.result;

  assert.equal(queued.job.status, 'queued');
  assert.equal(job.status, 'succeeded');
  assert.equal(result.status, 'completed');
  assert.equal(result.operation, 'create');
  assert.equal(result.iikoOrderId, 'iiko-order-1');
  assert.deepEqual(calls, [{ orderId: 'order-1', envOrganizationId: 'org-1' }]);
});

test('iiko order status endpoint delegates a local status pull and returns diagnostics', async (t) => {
  const calls = [];
  const server = await startIikoRouteServer(
    {
      IIKO_ENABLED: 'true',
      IIKO_API_LOGIN: 'test-api-login',
      IIKO_ORGANIZATION_ID: 'org-1',
      IIKO_TERMINAL_GROUP_ID: 'terminal-1',
    },
    async () => {},
    {
      syncIikoOrderStatus: async (options) => {
        calls.push({
          orderId: options.orderId,
          envOrganizationId: options.env.IIKO_ORGANIZATION_ID,
        });
        return {
          status: 'completed',
          operation: 'pull_status',
          orderId: options.orderId,
          iikoOrderId: 'iiko-order-1',
          iikoOrderStatus: 'Closed',
          localOrderStatus: 'closed',
        };
      },
    },
  );
  t.after(server.stop);

  const queued = await server.request('/iiko/sync/orders/order-1/status', { method: 'POST' });
  const job = await waitForIikoJob(server, queued.job.id);
  const result = job.result;

  assert.equal(job.status, 'succeeded');
  assert.equal(result.status, 'completed');
  assert.equal(result.operation, 'pull_status');
  assert.equal(result.iikoOrderStatus, 'Closed');
  assert.equal(result.localOrderStatus, 'closed');
  assert.deepEqual(calls, [{ orderId: 'order-1', envOrganizationId: 'org-1' }]);
});

test('iiko open order status endpoint delegates a batch status pull and returns diagnostics', async (t) => {
  const calls = [];
  const server = await startIikoRouteServer(
    {
      IIKO_ENABLED: 'true',
      IIKO_API_LOGIN: 'test-api-login',
      IIKO_ORGANIZATION_ID: 'org-1',
      IIKO_TERMINAL_GROUP_ID: 'terminal-1',
    },
    async () => {},
    {
      syncOpenIikoOrderStatuses: async (options) => {
        calls.push({
          envOrganizationId: options.env.IIKO_ORGANIZATION_ID,
        });
        return {
          status: 'completed',
          operation: 'pull_open_statuses',
          orders: { scanned: 2, synced: 2, failed: 0, closed: 1, cancelled: 0 },
        };
      },
    },
  );
  t.after(server.stop);

  const queued = await server.request('/iiko/sync/orders/statuses', { method: 'POST' });
  const job = await waitForIikoJob(server, queued.job.id);
  const result = job.result;

  assert.equal(job.status, 'succeeded');
  assert.equal(result.status, 'completed');
  assert.equal(result.operation, 'pull_open_statuses');
  assert.deepEqual(result.orders, { scanned: 2, synced: 2, failed: 0, closed: 1, cancelled: 0 });
  assert.deepEqual(calls, [{ envOrganizationId: 'org-1' }]);
});

test('iiko staff sync endpoint delegates manual sync, emits users change, and returns new credentials', async (t) => {
  const calls = [];
  const emitted = [];
  const permissions = [];
  const server = await startIikoRouteServer(
    {
      IIKO_ENABLED: 'true',
      IIKO_API_LOGIN: 'test-api-login',
      IIKO_ORGANIZATION_ID: 'org-1',
      IIKO_TERMINAL_GROUP_ID: 'terminal-1',
      IIKO_JOB_MAX_ATTEMPTS: '1',
    },
    async () => {},
    {
      requirePermission(permission) {
        permissions.push(permission);
        return (_req, _res, next) => next();
      },
      emitChange: (...args) => emitted.push(args),
      syncIikoStaff: async (options) => {
        calls.push({
          envOrganizationId: options.env.IIKO_ORGANIZATION_ID,
          triggerType: options.triggerType,
          generatedId: options.randomUUID(),
          hasDb: Boolean(options.db),
        });
        return {
          status: 'completed',
          staff: { created: 1, updated: 2, archived: 0 },
          new_credentials: [
            {
              id: 'staff-1',
              name: 'Иван iiko',
              login: 'ivaniiko0000',
              password: 'TempPass123!',
              role: 'waiter',
            },
          ],
        };
      },
    },
  );
  t.after(server.stop);

  const queued = await server.request('/iiko/sync/staff', { method: 'POST' });
  const job = await waitForIikoJob(server, queued.job.id);
  const result = job.result;

  assert.equal(queued.job.status, 'queued');
  assert.equal(job.status, 'succeeded');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.staff, { created: 1, updated: 2, archived: 0 });
  assert.equal(result.new_credentials[0].login, 'ivaniiko0000');
  assert.deepEqual(calls, [
    {
      envOrganizationId: 'org-1',
      triggerType: 'manual_job',
      generatedId: 'test-generated-id',
      hasDb: true,
    },
  ]);
  assert.ok(permissions.includes('manage:staff'));
  assert.deepEqual(
    emitted.filter(([channel]) => channel === 'users'),
    [['users', 'updated', { iiko_staff_sync: { created: 1, updated: 2, archived: 0 } }]],
  );
});

test('iiko staff sync endpoint returns failed diagnostics as 502 json body', async (t) => {
  const emitted = [];
  const server = await startIikoRouteServer(
    {
      IIKO_ENABLED: 'true',
      IIKO_API_LOGIN: 'test-api-login',
      IIKO_ORGANIZATION_ID: 'org-1',
      IIKO_TERMINAL_GROUP_ID: 'terminal-1',
      IIKO_JOB_MAX_ATTEMPTS: '1',
    },
    async () => {},
    {
      emitChange: (...args) => emitted.push(args),
      syncIikoStaff: async () => ({
        status: 'failed',
        staff: { created: 0, updated: 0, archived: 0 },
        new_credentials: [],
        error: 'iiko employees request failed',
      }),
    },
  );
  t.after(server.stop);

  const queued = await server.request('/iiko/sync/staff', { method: 'POST' });
  const job = await waitForIikoJob(server, queued.job.id);

  assert.equal(queued.job.status, 'queued');
  assert.equal(job.status, 'failed');
  assert.equal(job.result.status, 'failed');
  assert.equal(job.result.error, 'iiko employees request failed');
  assert.deepEqual(emitted.filter(([channel]) => channel === 'users'), []);
});
