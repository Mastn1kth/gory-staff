const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { newDb } = require('pg-mem');

const { registerCoordinationRoutes } = require('../src/coordination');
const { seedRoles } = require('../src/seed');

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
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

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function createSchemaPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  const schema = await fs.readFile(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await seedRoles(pool);
  return pool;
}

async function seedGuestOrderData(pool) {
  await pool.query("INSERT INTO floors (id, name, sort_order) VALUES ('floor-1', 'Main', 1)");
  await pool.query(
    `INSERT INTO "tables" (id, floor_id, number, seats, x_position, y_position, shape, status)
     VALUES ('table-1', 'floor-1', '7', 4, 10, 10, 'square', 'occupied')`,
  );
  await pool.query(
    `INSERT INTO guest_users (id, name, phone, referral_code, status, personal_data_consent)
     VALUES ('guest-1', 'Route Guest', '+79990003344', 'REFROUTE', 'active', TRUE)`,
  );
  await pool.query(
    `INSERT INTO table_guest_sessions (id, table_id, guest_id, status, checked_in_at)
     VALUES ('session-1', 'table-1', 'guest-1', 'active', NOW())`,
  );
  await pool.query("INSERT INTO menu_categories (id, name, sort_order) VALUES ('cat-1', 'Food', 1)");
  await pool.query(
    `INSERT INTO menu_items (id, name, category_id, price, composition, status, iiko_id)
     VALUES ('item-1', 'Khachapuri', 'cat-1', 590, '', 'available', 'iiko-product-1')`,
  );
  await pool.query(
    `INSERT INTO menu_item_modifier_groups
       (id, menu_item_id, name, iiko_modifier_group_id, required, min_amount, max_amount, sort_order)
     VALUES
       ('modifier-group-1', 'item-1', 'Sauce', 'iiko-modifier-group-1', FALSE, 0, 2, 1)`,
  );
  await pool.query(
    `INSERT INTO menu_item_modifiers
       (id, modifier_group_id, iiko_modifier_product_id, name, price, min_amount, max_amount, default_amount, sort_order)
     VALUES
       ('modifier-1', 'modifier-group-1', 'iiko-modifier-product-1', 'Adjika', 70, 0, 2, 0, 1)`,
  );
}

async function startCoordinationRouteServer(syncGuestOrderToIiko) {
  const pool = await createSchemaPool();
  await seedGuestOrderData(pool);
  const app = express();
  app.use(express.json());
  registerCoordinationRoutes(app, {
    pool,
    query: (text, params) => pool.query(text, params),
    asyncHandler,
    authMiddleware(_req, _res, next) {
      next();
    },
    guestAuthMiddleware(req, _res, next) {
      req.guest = { id: 'guest-1', name: 'Route Guest', phone: '+79990003344' };
      next();
    },
    requirePermission() {
      return (_req, _res, next) => next();
    },
    requireManager(_req, _res, next) {
      next();
    },
    can: () => true,
    randomUUID: (() => {
      let index = 0;
      return () => {
        index += 1;
        return `generated-${index}`;
      };
    })(),
    emitChange: () => {},
    logActivity: async () => {},
    createRoleNotifications: async () => {},
    createNotification: async () => {},
    createGuestNotification: async () => null,
    notifyStopListChange: async () => {},
    addGuestBonusTransaction: async () => {},
    httpError(message, status = 500) {
      const error = new Error(message);
      error.status = status;
      return error;
    },
    rowById: async () => null,
    getReservationConflict: async () => null,
    reservationPushText: () => '',
    normalizeBirthday: (value) => value,
    loyaltyLevelLabels: {},
    publicGuest: (guest) => guest,
    buildGuestPayload: async () => null,
    isBarMenuItem: () => false,
    serverDate: () => '2026-05-29',
    syncGuestOrderToIiko,
  });
  app.use((error, _req, res, _next) => {
    res.status(Number(error.status ?? 500)).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    pool,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

test('guest order item creation triggers iiko order sync for the local order', async (t) => {
  const calls = [];
  const server = await startCoordinationRouteServer(async (options) => {
    calls.push({
      orderId: options.orderId,
      envEnabled: options.env.IIKO_ENABLED,
    });
    return {
      status: 'completed',
      operation: 'create',
      orderId: options.orderId,
      iikoOrderId: 'iiko-order-route-1',
      items: { synced: 1 },
    };
  });
  t.after(server.stop);

  const response = await api(server.baseUrl, '/guest/orders/items', {
    method: 'POST',
    body: JSON.stringify({ menu_item_id: 'item-1', quantity: 2 }),
  });

  assert.equal(response.item.status, 'ordered');
  assert.equal(response.iiko_sync.status, 'completed');
  assert.equal(response.iiko_sync.iikoOrderId, 'iiko-order-route-1');
  assert.deepEqual(calls, [{ orderId: response.order.id, envEnabled: undefined }]);
});

test('guest order item creation stores selected modifiers before iiko order sync runs', async (t) => {
  const syncRows = [];
  const server = await startCoordinationRouteServer(async (options) => {
    const result = await options.db.query(
      `SELECT order_item_id, iiko_modifier_product_id, iiko_modifier_group_id, name, amount, price
       FROM guest_order_item_modifiers
       ORDER BY id ASC`,
    );
    syncRows.push(...result.rows);
    return {
      status: 'completed',
      operation: 'create',
      orderId: options.orderId,
      iikoOrderId: 'iiko-order-route-1',
      items: { synced: 1 },
    };
  });
  t.after(server.stop);

  const response = await api(server.baseUrl, '/guest/orders/items', {
    method: 'POST',
    body: JSON.stringify({
      menu_item_id: 'item-1',
      quantity: 1,
      modifiers: [{ modifier_id: 'modifier-1', amount: 2 }],
    }),
  });

  assert.equal(response.modifiers.length, 1);
  assert.deepEqual(
    {
      order_item_id: response.item.id,
      iiko_modifier_product_id: response.modifiers[0].iiko_modifier_product_id,
      iiko_modifier_group_id: response.modifiers[0].iiko_modifier_group_id,
      name: response.modifiers[0].name,
      amount: response.modifiers[0].amount,
      price: response.modifiers[0].price,
    },
    {
      order_item_id: response.item.id,
      iiko_modifier_product_id: 'iiko-modifier-product-1',
      iiko_modifier_group_id: 'iiko-modifier-group-1',
      name: 'Adjika',
      amount: 2,
      price: 70,
    },
  );
  assert.deepEqual(syncRows, [
    {
      order_item_id: response.item.id,
      iiko_modifier_product_id: 'iiko-modifier-product-1',
      iiko_modifier_group_id: 'iiko-modifier-group-1',
      name: 'Adjika',
      amount: 2,
      price: 70,
    },
  ]);
});
