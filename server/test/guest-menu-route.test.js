const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { newDb } = require('pg-mem');

const { registerGuestRoutes } = require('../src/routes/guests');

async function createSchemaPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  const schema = await fs.readFile(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');
  await pool.query(schema);
  return pool;
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function startGuestRoutesServer() {
  const pool = await createSchemaPool();
  await pool.query("INSERT INTO menu_categories (id, name, sort_order) VALUES ('cat-1', 'Food', 1)");
  await pool.query(
    `INSERT INTO menu_items (id, name, category_id, price, composition, status, iiko_id)
     VALUES ('item-1', 'Khachapuri', 'cat-1', 590, '', 'available', 'iiko-product-1')`,
  );
  await pool.query(
    `INSERT INTO menu_item_modifier_groups
       (id, menu_item_id, name, iiko_modifier_group_id, required, min_amount, max_amount, sort_order)
     VALUES
       ('modifier-group-1', 'item-1', 'Sauce', 'iiko-modifier-group-1', TRUE, 1, 2, 1)`,
  );
  await pool.query(
    `INSERT INTO menu_item_modifiers
       (id, modifier_group_id, iiko_modifier_product_id, name, price, min_amount, max_amount, default_amount, sort_order)
     VALUES
       ('modifier-1', 'modifier-group-1', 'iiko-modifier-product-1', 'Adjika', 70, 0, 2, 0, 1)`,
  );

  const app = express();
  app.use(express.json());
  registerGuestRoutes(app, {
    pool,
    query: (text, params) => pool.query(text, params),
    asyncHandler,
    guestAuthMiddleware(_req, _res, next) {
      next();
    },
    randomUUID: () => 'generated-id',
    httpError(message, status = 500) {
      const error = new Error(message);
      error.status = status;
      return error;
    },
    normalizeGuestPhone: (value) => value,
    normalizeReferralCode: (value) => value,
    normalizeBirthday: (value) => value,
    generateUniqueReferralCode: async () => 'REF001',
    generateUniqueCardNumber: async () => 'CARD001',
    addGuestBonusTransaction: async () => {},
    createRoleNotifications: async () => {},
    createGuestNotification: async () => {},
    emitChange: () => {},
    issueGuestSession: async () => 'token',
    buildGuestPayload: async () => ({}),
    registerPushDevice: async () => ({}),
    publicServerUrl: () => 'http://127.0.0.1',
    websocketUrlForApi: () => 'ws://127.0.0.1',
    getCoordinationApi: () => null,
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
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

test('guest menu exposes active iiko modifier groups and modifiers', async (t) => {
  const server = await startGuestRoutesServer();
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/guest/menu`);
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.modifier_groups, [
    {
      id: 'modifier-group-1',
      menu_item_id: 'item-1',
      name: 'Sauce',
      iiko_modifier_group_id: 'iiko-modifier-group-1',
      required: true,
      min_amount: 1,
      max_amount: 2,
      sort_order: 1,
    },
  ]);
  assert.deepEqual(body.modifiers, [
    {
      id: 'modifier-1',
      modifier_group_id: 'modifier-group-1',
      iiko_modifier_product_id: 'iiko-modifier-product-1',
      name: 'Adjika',
      price: 70,
      min_amount: 0,
      max_amount: 2,
      default_amount: 0,
      sort_order: 1,
    },
  ]);
});
