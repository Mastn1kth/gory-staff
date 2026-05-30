const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { newDb } = require('pg-mem');

const { seedRoles } = require('../src/seed');
const { syncGuestOrderToIiko, syncIikoOrderStatus, syncOpenIikoOrderStatuses } = require('../src/integrations/iiko');

async function createSchemaClient() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const client = new adapter.Client();
  await client.connect();
  const schema = await fs.readFile(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');
  await client.query(schema);
  await seedRoles(client);
  return client;
}

function iikoEnv(overrides = {}) {
  return {
    IIKO_ENABLED: 'true',
    IIKO_API_BASE: 'https://api-ru.iiko.services',
    IIKO_API_LOGIN: 'test-api-login',
    IIKO_ORGANIZATION_ID: 'org-1',
    IIKO_TERMINAL_GROUP_ID: 'terminal-1',
    IIKO_SOURCE_KEY: 'gory-staff-test',
    ...overrides,
  };
}

function createIdFactory() {
  let index = 0;
  return () => {
    index += 1;
    return `generated-${index}`;
  };
}

async function insertLocalOrder(client, { orderId = 'order-1', iikoOrderId = null, extraItem = false, missingIikoId = false } = {}) {
  await client.query("INSERT INTO floors (id, name, sort_order) VALUES ('floor-1', 'Main', 1)");
  await client.query(
    `INSERT INTO "tables" (id, floor_id, number, seats, x_position, y_position, shape, status, iiko_table_id)
     VALUES ('table-1', 'floor-1', '7', 4, 10, 10, 'square', 'occupied', 'iiko-table-7')`,
  );
  await client.query(
    `INSERT INTO guest_users (id, name, phone, referral_code, status, personal_data_consent)
     VALUES ('guest-1', 'Ivan Guest', '+79990001122', 'REF001', 'active', TRUE)`,
  );
  await client.query("INSERT INTO menu_categories (id, name, sort_order, iiko_id) VALUES ('cat-1', 'Food', 1, 'iiko-cat-1')");
  await client.query(
    `INSERT INTO menu_items
       (id, name, category_id, price, composition, status, iiko_id, iiko_size_id)
     VALUES
       ('item-1', 'Khinkali', 'cat-1', 320, '', 'available', $1, NULL),
       ('item-2', 'Soup', 'cat-1', 450, '', 'available', 'iiko-product-2', 'iiko-size-2')`,
    [missingIikoId ? null : 'iiko-product-1'],
  );
  await client.query(
    `INSERT INTO table_guest_sessions (id, table_id, guest_id, status, checked_in_at)
     VALUES ('session-1', 'table-1', 'guest-1', 'active', NOW())`,
  );
  await client.query(
    `INSERT INTO guest_orders (id, table_session_id, table_id, guest_id, status, iiko_order_id, created_at, updated_at)
     VALUES ($1, 'session-1', 'table-1', 'guest-1', 'open', $2, NOW(), NOW())`,
    [orderId, iikoOrderId],
  );
  await client.query(
    `INSERT INTO guest_order_items (id, order_id, menu_item_id, quantity, status, comment, created_at, updated_at)
     VALUES ('order-item-1', $1, 'item-1', 2, 'ordered', 'no onion', NOW(), NOW())`,
    [orderId],
  );
  if (extraItem) {
    await client.query(
      `INSERT INTO guest_order_items (id, order_id, menu_item_id, quantity, status, comment, created_at, updated_at)
       VALUES ('order-item-2', $1, 'item-2', 1, 'ordered', '', NOW(), NOW())`,
      [orderId],
    );
  }
}

async function insertSelectedModifier(client) {
  await client.query(
    `INSERT INTO menu_item_modifier_groups
       (id, menu_item_id, name, iiko_modifier_group_id, required, min_amount, max_amount, sort_order)
     VALUES
       ('modifier-group-1', 'item-1', 'Sauce', 'iiko-modifier-group-1', TRUE, 1, 2, 1)`,
  );
  await client.query(
    `INSERT INTO menu_item_modifiers
       (id, modifier_group_id, iiko_modifier_product_id, name, price, min_amount, max_amount, default_amount, sort_order)
     VALUES
       ('modifier-1', 'modifier-group-1', 'iiko-modifier-product-1', 'Adjika', 70, 0, 2, 0, 1)`,
  );
  await client.query(
    `INSERT INTO guest_order_item_modifiers
       (id, order_item_id, menu_item_modifier_id, modifier_group_id,
        iiko_modifier_product_id, iiko_modifier_group_id, name, amount, price)
     VALUES
       ('selected-modifier-1', 'order-item-1', 'modifier-1', 'modifier-group-1',
        'iiko-modifier-product-1', 'iiko-modifier-group-1', 'Adjika', 2, 70)`,
  );
}

async function insertSelectedModifierForExtraItem(client) {
  await client.query(
    `INSERT INTO menu_item_modifier_groups
       (id, menu_item_id, name, iiko_modifier_group_id, required, min_amount, max_amount, sort_order)
     VALUES
       ('modifier-group-2', 'item-2', 'Bread', 'iiko-modifier-group-2', FALSE, 0, 1, 1)`,
  );
  await client.query(
    `INSERT INTO menu_item_modifiers
       (id, modifier_group_id, iiko_modifier_product_id, name, price, min_amount, max_amount, default_amount, sort_order)
     VALUES
       ('modifier-2', 'modifier-group-2', 'iiko-modifier-product-2', 'Lavash', 50, 0, 1, 0, 1)`,
  );
  await client.query(
    `INSERT INTO guest_order_item_modifiers
       (id, order_item_id, menu_item_modifier_id, modifier_group_id,
        iiko_modifier_product_id, iiko_modifier_group_id, name, amount, price)
     VALUES
       ('selected-modifier-2', 'order-item-2', 'modifier-2', 'modifier-group-2',
        'iiko-modifier-product-2', 'iiko-modifier-group-2', 'Lavash', 1, 50)`,
  );
}

async function insertSecondLocalOrder(client) {
  await client.query(
    `INSERT INTO "tables" (id, floor_id, number, seats, x_position, y_position, shape, status, iiko_table_id)
     VALUES ('table-2', 'floor-1', '8', 4, 20, 10, 'square', 'occupied', 'iiko-table-8')`,
  );
  await client.query(
    `INSERT INTO guest_users (id, name, phone, referral_code, status, personal_data_consent)
     VALUES ('guest-2', 'Nino Guest', '+79990001123', 'REF002', 'active', TRUE)`,
  );
  await client.query(
    `INSERT INTO table_guest_sessions (id, table_id, guest_id, status, checked_in_at)
     VALUES ('session-2', 'table-2', 'guest-2', 'active', NOW())`,
  );
  await client.query(
    `INSERT INTO guest_orders (id, table_session_id, table_id, guest_id, status, iiko_order_id, created_at, updated_at)
     VALUES ('order-2', 'session-2', 'table-2', 'guest-2', 'open', 'iiko-order-2', NOW(), NOW())`,
  );
  await client.query(
    `INSERT INTO guest_order_items (id, order_id, menu_item_id, quantity, status, created_at, updated_at)
     VALUES ('order-item-2', 'order-2', 'item-2', 1, 'ordered', NOW(), NOW())`,
  );
}

test('iiko order sync creates a table order and marks local items as synced', async () => {
  const client = await createSchemaClient();
  const createCalls = [];
  try {
    await insertLocalOrder(client);

    const result = await syncGuestOrderToIiko({
      db: client,
      orderId: 'order-1',
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async createTableOrder(payload) {
          createCalls.push(payload);
          return {
            correlationId: 'corr-1',
            orderInfo: {
              id: 'iiko-order-1',
              creationStatus: 'Success',
            },
          };
        },
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.operation, 'create');
    assert.equal(result.iikoOrderId, 'iiko-order-1');
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].organizationId, 'org-1');
    assert.equal(createCalls[0].terminalGroupId, 'terminal-1');
    assert.deepEqual(createCalls[0].order.tableIds, ['iiko-table-7']);
    assert.deepEqual(createCalls[0].order.customer, { type: 'one-time', name: 'Ivan Guest' });
    assert.equal(createCalls[0].order.phone, '+79990001122');
    assert.equal(createCalls[0].order.sourceKey, 'gory-staff-test');
    assert.deepEqual(createCalls[0].order.items, [
      {
        type: 'Product',
        productId: 'iiko-product-1',
        productSizeId: null,
        amount: 2,
        price: 320,
        positionId: 'generated-1',
        comment: 'no onion',
      },
    ]);

    const order = await client.query(
      `SELECT iiko_order_id, iiko_correlation_id, iiko_creation_status, iiko_sync_status, iiko_sync_error
       FROM guest_orders
       WHERE id = 'order-1'`,
    );
    assert.deepEqual(order.rows[0], {
      iiko_order_id: 'iiko-order-1',
      iiko_correlation_id: 'corr-1',
      iiko_creation_status: 'Success',
      iiko_sync_status: 'synced',
      iiko_sync_error: null,
    });

    const item = await client.query(
      `SELECT iiko_position_id, iiko_sync_status, iiko_sync_error
       FROM guest_order_items
       WHERE id = 'order-item-1'`,
    );
    assert.deepEqual(item.rows[0], {
      iiko_position_id: 'generated-1',
      iiko_sync_status: 'synced',
      iiko_sync_error: null,
    });
  } finally {
    await client.end();
  }
});

test('iiko order sync sends selected item modifiers in create payload', async () => {
  const client = await createSchemaClient();
  const createCalls = [];
  try {
    await insertLocalOrder(client);
    await insertSelectedModifier(client);

    const result = await syncGuestOrderToIiko({
      db: client,
      orderId: 'order-1',
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async createTableOrder(payload) {
          createCalls.push(payload);
          return {
            correlationId: 'corr-1',
            orderInfo: {
              id: 'iiko-order-1',
              creationStatus: 'Success',
            },
          };
        },
      },
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(createCalls[0].order.items[0].modifiers, [
      {
        type: 'Product',
        productId: 'iiko-modifier-product-1',
        productGroupId: 'iiko-modifier-group-1',
        amount: 2,
        price: 70,
        positionId: 'generated-2',
      },
    ]);

    const modifier = await client.query(
      `SELECT iiko_position_id
       FROM guest_order_item_modifiers
       WHERE id = 'selected-modifier-1'`,
    );
    assert.equal(modifier.rows[0].iiko_position_id, 'generated-2');
  } finally {
    await client.end();
  }
});

test('iiko order sync adds only unsynced items to an existing iiko order', async () => {
  const client = await createSchemaClient();
  const addCalls = [];
  try {
    await insertLocalOrder(client, { iikoOrderId: 'iiko-order-1', extraItem: true });
    await client.query(
      `UPDATE guest_order_items
       SET iiko_position_id = 'already-synced-position',
           iiko_sync_status = 'synced',
           iiko_synced_at = NOW()
       WHERE id = 'order-item-1'`,
    );

    const result = await syncGuestOrderToIiko({
      db: client,
      orderId: 'order-1',
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async addOrderItems(payload) {
          addCalls.push(payload);
          return {
            correlationId: 'corr-add-1',
          };
        },
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.operation, 'add_items');
    assert.equal(result.items.synced, 1);
    assert.equal(addCalls.length, 1);
    assert.equal(addCalls[0].orderId, 'iiko-order-1');
    assert.deepEqual(addCalls[0].items, [
      {
        type: 'Product',
        productId: 'iiko-product-2',
        productSizeId: 'iiko-size-2',
        amount: 1,
        price: 450,
        positionId: 'generated-1',
        comment: null,
      },
    ]);

    const items = await client.query(
      `SELECT id, iiko_position_id, iiko_sync_status
       FROM guest_order_items
       ORDER BY id ASC`,
    );
    assert.deepEqual(items.rows, [
      { id: 'order-item-1', iiko_position_id: 'already-synced-position', iiko_sync_status: 'synced' },
      { id: 'order-item-2', iiko_position_id: 'generated-1', iiko_sync_status: 'synced' },
    ]);
  } finally {
    await client.end();
  }
});

test('iiko order sync sends selected item modifiers in add items payload', async () => {
  const client = await createSchemaClient();
  const addCalls = [];
  try {
    await insertLocalOrder(client, { iikoOrderId: 'iiko-order-1', extraItem: true });
    await insertSelectedModifierForExtraItem(client);
    await client.query(
      `UPDATE guest_order_items
       SET iiko_position_id = 'already-synced-position',
           iiko_sync_status = 'synced',
           iiko_synced_at = NOW()
       WHERE id = 'order-item-1'`,
    );

    const result = await syncGuestOrderToIiko({
      db: client,
      orderId: 'order-1',
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async addOrderItems(payload) {
          addCalls.push(payload);
          return {
            correlationId: 'corr-add-1',
          };
        },
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.operation, 'add_items');
    assert.deepEqual(addCalls[0].items[0].modifiers, [
      {
        type: 'Product',
        productId: 'iiko-modifier-product-2',
        productGroupId: 'iiko-modifier-group-2',
        amount: 1,
        price: 50,
        positionId: 'generated-2',
      },
    ]);

    const modifier = await client.query(
      `SELECT iiko_position_id
       FROM guest_order_item_modifiers
       WHERE id = 'selected-modifier-2'`,
    );
    assert.equal(modifier.rows[0].iiko_position_id, 'generated-2');
  } finally {
    await client.end();
  }
});

test('iiko order sync fails safely when a local item has no iiko product id', async () => {
  const client = await createSchemaClient();
  let called = false;
  try {
    await insertLocalOrder(client, { missingIikoId: true });

    const result = await syncGuestOrderToIiko({
      db: client,
      orderId: 'order-1',
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async createTableOrder() {
          called = true;
          throw new Error('should not be called');
        },
      },
    });

    assert.equal(result.status, 'failed');
    assert.equal(called, false);
    assert.match(result.error, /iiko product id/i);

    const order = await client.query(
      `SELECT iiko_order_id, iiko_sync_status, iiko_sync_error
       FROM guest_orders
       WHERE id = 'order-1'`,
    );
    assert.equal(order.rows[0].iiko_order_id, null);
    assert.equal(order.rows[0].iiko_sync_status, 'failed');
    assert.match(order.rows[0].iiko_sync_error, /iiko product id/i);

    const log = await client.query('SELECT status, operation, error_message FROM iiko_order_sync_log ORDER BY finished_at DESC LIMIT 1');
    assert.equal(log.rows[0].status, 'failed');
    assert.equal(log.rows[0].operation, 'create');
    assert.match(log.rows[0].error_message, /iiko product id/i);
  } finally {
    await client.end();
  }
});

test('iiko order sync returns a failed diagnostic for a missing local order', async () => {
  const client = await createSchemaClient();
  try {
    const result = await syncGuestOrderToIiko({
      db: client,
      orderId: 'missing-order',
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async createTableOrder() {
          throw new Error('should not be called');
        },
      },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.orderId, 'missing-order');
    assert.match(result.error, /was not found/i);

    const log = await client.query('SELECT order_id, status, operation, error_message FROM iiko_order_sync_log ORDER BY finished_at DESC LIMIT 1');
    assert.equal(log.rows[0].order_id, 'missing-order');
    assert.equal(log.rows[0].status, 'failed');
    assert.equal(log.rows[0].operation, 'create');
    assert.match(log.rows[0].error_message, /was not found/i);
  } finally {
    await client.end();
  }
});

test('iiko order status sync closes a local order when iiko reports Closed', async () => {
  const client = await createSchemaClient();
  const fetchCalls = [];
  try {
    await insertLocalOrder(client, { iikoOrderId: 'iiko-order-1' });

    const result = await syncIikoOrderStatus({
      db: client,
      orderId: 'order-1',
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async fetchOrderById(payload) {
          fetchCalls.push(payload);
          return {
            orders: [
              {
                id: 'iiko-order-1',
                organizationId: 'org-1',
                creationStatus: 'Success',
                order: {
                  id: 'iiko-order-1',
                  status: 'Closed',
                  number: 42,
                  sum: 1090,
                  whenClosed: '2026-05-29T12:30:00.000Z',
                  items: [],
                  payments: [{ paymentType: { id: 'cash' }, sum: 1090 }],
                },
              },
            ],
          };
        },
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.operation, 'pull_status');
    assert.equal(result.iikoOrderId, 'iiko-order-1');
    assert.equal(result.iikoOrderStatus, 'Closed');
    assert.equal(result.localOrderStatus, 'closed');
    assert.deepEqual(fetchCalls, [
      {
        organizationIds: ['org-1'],
        orderIds: ['iiko-order-1'],
      },
    ]);

    const order = await client.query(
      `SELECT status, iiko_creation_status, iiko_order_status, iiko_order_number,
              iiko_order_sum, iiko_order_payload_json, iiko_sync_status, iiko_sync_error
       FROM guest_orders
       WHERE id = 'order-1'`,
    );
    assert.equal(order.rows[0].status, 'closed');
    assert.equal(order.rows[0].iiko_creation_status, 'Success');
    assert.equal(order.rows[0].iiko_order_status, 'Closed');
    assert.equal(order.rows[0].iiko_order_number, 42);
    assert.equal(order.rows[0].iiko_order_sum, 1090);
    assert.equal(order.rows[0].iiko_order_payload_json.order.status, 'Closed');
    assert.equal(order.rows[0].iiko_sync_status, 'synced');
    assert.equal(order.rows[0].iiko_sync_error, null);

    const session = await client.query(
      `SELECT status, ended_at IS NOT NULL AS ended
       FROM table_guest_sessions
       WHERE id = 'session-1'`,
    );
    assert.deepEqual(session.rows[0], { status: 'ended', ended: true });

    const log = await client.query('SELECT status, operation, iiko_order_id, error_message FROM iiko_order_sync_log ORDER BY finished_at DESC LIMIT 1');
    assert.deepEqual(log.rows[0], {
      status: 'completed',
      operation: 'pull_status',
      iiko_order_id: 'iiko-order-1',
      error_message: null,
    });
  } finally {
    await client.end();
  }
});

test('iiko order status sync fails safely when local order has no iiko order id', async () => {
  const client = await createSchemaClient();
  let called = false;
  try {
    await insertLocalOrder(client);

    const result = await syncIikoOrderStatus({
      db: client,
      orderId: 'order-1',
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async fetchOrderById() {
          called = true;
          throw new Error('should not be called');
        },
      },
    });

    assert.equal(result.status, 'failed');
    assert.equal(called, false);
    assert.match(result.error, /has no iiko order id/i);

    const order = await client.query(
      `SELECT iiko_sync_status, iiko_sync_error
       FROM guest_orders
       WHERE id = 'order-1'`,
    );
    assert.equal(order.rows[0].iiko_sync_status, 'failed');
    assert.match(order.rows[0].iiko_sync_error, /has no iiko order id/i);

    const log = await client.query('SELECT order_id, status, operation, error_message FROM iiko_order_sync_log ORDER BY finished_at DESC LIMIT 1');
    assert.equal(log.rows[0].order_id, 'order-1');
    assert.equal(log.rows[0].status, 'failed');
    assert.equal(log.rows[0].operation, 'pull_status');
    assert.match(log.rows[0].error_message, /has no iiko order id/i);
  } finally {
    await client.end();
  }
});

test('iiko open order status sync pulls every open local iiko order in one batch', async () => {
  const client = await createSchemaClient();
  const fetchCalls = [];
  try {
    await insertLocalOrder(client, { iikoOrderId: 'iiko-order-1' });
    await insertSecondLocalOrder(client);
    await client.query(
      `INSERT INTO guest_orders (id, table_session_id, table_id, guest_id, status, iiko_order_id, created_at, updated_at)
       VALUES ('closed-order', 'session-1', 'table-1', 'guest-1', 'closed', 'iiko-closed-order', NOW(), NOW())`,
    );

    const result = await syncOpenIikoOrderStatuses({
      db: client,
      env: iikoEnv(),
      randomUUID: createIdFactory(),
      iikoClient: {
        async fetchOrderById(payload) {
          fetchCalls.push(payload);
          return {
            orders: [
              {
                id: 'iiko-order-1',
                creationStatus: 'Success',
                order: {
                  id: 'iiko-order-1',
                  status: 'Closed',
                  number: 11,
                  sum: 640,
                  whenClosed: '2026-05-29T13:00:00.000Z',
                },
              },
              {
                id: 'iiko-order-2',
                creationStatus: 'Success',
                order: {
                  id: 'iiko-order-2',
                  status: 'New',
                  number: 12,
                  sum: 450,
                },
              },
            ],
          };
        },
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.operation, 'pull_open_statuses');
    assert.deepEqual(result.orders, {
      scanned: 2,
      synced: 2,
      failed: 0,
      closed: 1,
      cancelled: 0,
    });
    assert.deepEqual(fetchCalls, [
      {
        organizationIds: ['org-1'],
        orderIds: ['iiko-order-1', 'iiko-order-2'],
      },
    ]);

    const orders = await client.query(
      `SELECT id, status, iiko_order_status, iiko_order_number, iiko_order_sum
       FROM guest_orders
       WHERE id IN ('order-1', 'order-2', 'closed-order')
       ORDER BY id`,
    );
    assert.deepEqual(orders.rows, [
      { id: 'closed-order', status: 'closed', iiko_order_status: null, iiko_order_number: null, iiko_order_sum: null },
      { id: 'order-1', status: 'closed', iiko_order_status: 'Closed', iiko_order_number: 11, iiko_order_sum: 640 },
      { id: 'order-2', status: 'open', iiko_order_status: 'New', iiko_order_number: 12, iiko_order_sum: 450 },
    ]);

    const session = await client.query(
      `SELECT status, ended_at IS NOT NULL AS ended
       FROM table_guest_sessions
       WHERE id = 'session-1'`,
    );
    assert.deepEqual(session.rows[0], { status: 'ended', ended: true });

    const logs = await client.query(
      `SELECT order_id, status, operation, iiko_order_id, error_message
       FROM iiko_order_sync_log
       ORDER BY order_id`,
    );
    assert.deepEqual(logs.rows, [
      { order_id: 'order-1', status: 'completed', operation: 'pull_status', iiko_order_id: 'iiko-order-1', error_message: null },
      { order_id: 'order-2', status: 'completed', operation: 'pull_status', iiko_order_id: 'iiko-order-2', error_message: null },
    ]);
  } finally {
    await client.end();
  }
});
