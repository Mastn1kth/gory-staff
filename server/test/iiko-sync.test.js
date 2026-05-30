const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { newDb } = require('pg-mem');

const { seedRoles } = require('../src/seed');
const { syncIikoMenu } = require('../src/integrations/iiko');

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

function fakeIikoClient(nomenclature, stopLists = { terminalGroupStopLists: [] }) {
  return {
    async fetchNomenclature() {
      return nomenclature;
    },
    async fetchStopLists() {
      return stopLists;
    },
  };
}

function nomenclature({ groups, products, productCategories = [] }) {
  return {
    revision: 1,
    groups,
    productCategories,
    products,
    sizes: [],
  };
}

function group(id, name, order = 0) {
  return {
    id,
    name,
    order,
    isIncludedInMenu: true,
    isGroupModifier: false,
    isDeleted: false,
  };
}

function product(id, name, parentGroup, price = 100) {
  return {
    id,
    name,
    parentGroup,
    type: 'dish',
    order: 0,
    isDeleted: false,
    description: `${name} from iiko`,
    weight: 250,
    imageLinks: [`https://cdn.example.test/${id}.jpg`],
    sizePrices: [
      {
        sizeId: null,
        price: {
          currentPrice: price,
          isIncludedInMenu: true,
          nextIncludedInMenu: true,
        },
      },
    ],
  };
}

function modifierProduct(id, name, parentGroup, price = 50) {
  return {
    ...product(id, name, parentGroup, price),
    type: 'modifier',
    weight: 0,
    description: `${name} modifier from iiko`,
  };
}

function productWithModifierGroup(id, name, parentGroup, modifierGroupId, modifierProductId) {
  return {
    ...product(id, name, parentGroup, 700),
    modifierSchemaId: 'schema-1',
    groupModifiers: [
      {
        id: modifierGroupId,
        name: 'Sauces',
        required: true,
        minAmount: 1,
        maxAmount: 2,
        childModifiers: [
          {
            productId: modifierProductId,
            minAmount: 0,
            maxAmount: 2,
            defaultAmount: 1,
            freeOfChargeAmount: 1,
            hideIfDefaultAmount: false,
          },
        ],
      },
    ],
  };
}

test('iiko sync does not call iiko when env is disabled or missing login', async () => {
  const client = await createSchemaClient();
  let called = false;
  try {
    const result = await syncIikoMenu({
      db: client,
      env: iikoEnv({ IIKO_ENABLED: 'false', IIKO_API_LOGIN: '' }),
      iikoClient: {
        async fetchNomenclature() {
          called = true;
          throw new Error('should not be called');
        },
        async fetchStopLists() {
          called = true;
          throw new Error('should not be called');
        },
      },
      randomUUID: createIdFactory(),
    });

    assert.equal(result.status, 'disabled');
    assert.equal(called, false);
  } finally {
    await client.end();
  }
});

test('iiko sync maps visible iiko groups to menu categories', async () => {
  const client = await createSchemaClient();
  try {
    const result = await syncIikoMenu({
      db: client,
      env: iikoEnv(),
      iikoClient: fakeIikoClient(
        nomenclature({
          groups: [
            group('iiko-group-hot', 'Hot dishes', 20),
            { ...group('iiko-group-hidden', 'Hidden', 30), isIncludedInMenu: false },
            { ...group('iiko-group-mods', 'Modifiers', 40), isGroupModifier: true },
          ],
          products: [product('iiko-product-kebab', 'Kebab', 'iiko-group-hot', 650)],
        }),
      ),
      randomUUID: createIdFactory(),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.categories, { created: 1, updated: 0 });

    const categories = await client.query('SELECT id, name, sort_order, iiko_id FROM menu_categories ORDER BY sort_order ASC');
    assert.equal(categories.rows.length, 1);
    assert.equal(categories.rows[0].name, 'Hot dishes');
    assert.equal(categories.rows[0].sort_order, 20);
    assert.equal(categories.rows[0].iiko_id, 'iiko-group-hot');
  } finally {
    await client.end();
  }
});

test('iiko sync is idempotent and preserves local-only menu fields', async () => {
  const client = await createSchemaClient();
  const data = nomenclature({
    groups: [group('iiko-group-hot', 'Hot dishes', 20)],
    products: [product('iiko-product-kebab', 'Kebab', 'iiko-group-hot', 650)],
  });
  try {
    await syncIikoMenu({
      db: client,
      env: iikoEnv(),
      iikoClient: fakeIikoClient(data),
      randomUUID: createIdFactory(),
    });
    await client.query(
      `UPDATE menu_items
       SET waiter_hint = 'local waiter hint', recommendation = 'local recommendation'
       WHERE iiko_id = $1`,
      ['iiko-product-kebab'],
    );

    const second = await syncIikoMenu({
      db: client,
      env: iikoEnv(),
      iikoClient: fakeIikoClient(data),
      randomUUID: createIdFactory(),
    });

    assert.deepEqual(second.categories, { created: 0, updated: 1 });
    assert.deepEqual(second.items, { created: 0, updated: 1, archived: 0 });

    const categoryCount = await client.query("SELECT COUNT(*)::int AS count FROM menu_categories WHERE iiko_id = 'iiko-group-hot'");
    const itemCount = await client.query("SELECT COUNT(*)::int AS count FROM menu_items WHERE iiko_id = 'iiko-product-kebab'");
    assert.equal(categoryCount.rows[0].count, 1);
    assert.equal(itemCount.rows[0].count, 1);

    const row = await client.query('SELECT price, waiter_hint, recommendation FROM menu_items WHERE iiko_id = $1', ['iiko-product-kebab']);
    assert.equal(row.rows[0].price, 650);
    assert.equal(row.rows[0].waiter_hint, 'local waiter hint');
    assert.equal(row.rows[0].recommendation, 'local recommendation');
  } finally {
    await client.end();
  }
});

test('iiko sync archives disappeared iiko items instead of deleting them', async () => {
  const client = await createSchemaClient();
  try {
    await syncIikoMenu({
      db: client,
      env: iikoEnv(),
      iikoClient: fakeIikoClient(
        nomenclature({
          groups: [group('iiko-group-hot', 'Hot dishes', 20)],
          products: [
            product('iiko-product-kebab', 'Kebab', 'iiko-group-hot', 650),
            product('iiko-product-soup', 'Soup', 'iiko-group-hot', 450),
          ],
        }),
      ),
      randomUUID: createIdFactory(),
    });

    const second = await syncIikoMenu({
      db: client,
      env: iikoEnv(),
      iikoClient: fakeIikoClient(
        nomenclature({
          groups: [group('iiko-group-hot', 'Hot dishes', 20)],
          products: [product('iiko-product-kebab', 'Kebab', 'iiko-group-hot', 650)],
        }),
      ),
      randomUUID: createIdFactory(),
    });

    assert.deepEqual(second.items, { created: 0, updated: 1, archived: 1 });

    const rows = await client.query('SELECT iiko_id, status FROM menu_items ORDER BY iiko_id ASC');
    assert.deepEqual(rows.rows, [
      { iiko_id: 'iiko-product-kebab', status: 'available' },
      { iiko_id: 'iiko-product-soup', status: 'archived' },
    ]);
  } finally {
    await client.end();
  }
});

test('iiko sync stores modifier groups and modifier items without adding modifiers to the visible menu', async () => {
  const client = await createSchemaClient();
  try {
    const result = await syncIikoMenu({
      db: client,
      env: iikoEnv(),
      iikoClient: fakeIikoClient(
        nomenclature({
          groups: [
            group('iiko-group-hot', 'Hot dishes', 20),
            { ...group('iiko-group-sauces', 'Sauces', 90), isGroupModifier: true },
          ],
          products: [
            productWithModifierGroup('iiko-product-kebab', 'Kebab', 'iiko-group-hot', 'iiko-group-sauces', 'iiko-mod-sauce'),
            modifierProduct('iiko-mod-sauce', 'Adjika', 'iiko-group-sauces', 70),
          ],
        }),
      ),
      randomUUID: createIdFactory(),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.modifiers, {
      groups: { created: 1, updated: 0, archived: 0 },
      items: { created: 1, updated: 0, archived: 0 },
    });

    const menuItems = await client.query('SELECT iiko_id, name FROM menu_items ORDER BY iiko_id');
    assert.deepEqual(menuItems.rows, [{ iiko_id: 'iiko-product-kebab', name: 'Kebab' }]);

    const groups = await client.query(
      `SELECT mig.name, mig.iiko_modifier_group_id, mig.iiko_modifier_schema_id,
              mig.required, mig.min_amount, mig.max_amount, mig.status, mi.iiko_id AS menu_item_iiko_id
       FROM menu_item_modifier_groups mig
       JOIN menu_items mi ON mi.id = mig.menu_item_id`,
    );
    assert.deepEqual(groups.rows, [
      {
        name: 'Sauces',
        iiko_modifier_group_id: 'iiko-group-sauces',
        iiko_modifier_schema_id: 'schema-1',
        required: true,
        min_amount: 1,
        max_amount: 2,
        status: 'active',
        menu_item_iiko_id: 'iiko-product-kebab',
      },
    ]);

    const modifiers = await client.query(
      `SELECT mim.name, mim.iiko_modifier_product_id, mim.price, mim.default_amount,
              mim.free_of_charge_amount, mim.status
       FROM menu_item_modifiers mim`,
    );
    assert.deepEqual(modifiers.rows, [
      {
        name: 'Adjika',
        iiko_modifier_product_id: 'iiko-mod-sauce',
        price: 70,
        default_amount: 1,
        free_of_charge_amount: 1,
        status: 'active',
      },
    ]);
  } finally {
    await client.end();
  }
});

test('iiko sync archives modifier links that disappear from nomenclature', async () => {
  const client = await createSchemaClient();
  try {
    await syncIikoMenu({
      db: client,
      env: iikoEnv(),
      iikoClient: fakeIikoClient(
        nomenclature({
          groups: [
            group('iiko-group-hot', 'Hot dishes', 20),
            { ...group('iiko-group-sauces', 'Sauces', 90), isGroupModifier: true },
          ],
          products: [
            productWithModifierGroup('iiko-product-kebab', 'Kebab', 'iiko-group-hot', 'iiko-group-sauces', 'iiko-mod-sauce'),
            modifierProduct('iiko-mod-sauce', 'Adjika', 'iiko-group-sauces', 70),
          ],
        }),
      ),
      randomUUID: createIdFactory(),
    });

    const second = await syncIikoMenu({
      db: client,
      env: iikoEnv(),
      iikoClient: fakeIikoClient(
        nomenclature({
          groups: [group('iiko-group-hot', 'Hot dishes', 20)],
          products: [product('iiko-product-kebab', 'Kebab', 'iiko-group-hot', 700)],
        }),
      ),
      randomUUID: createIdFactory(),
    });

    assert.deepEqual(second.modifiers, {
      groups: { created: 0, updated: 0, archived: 1 },
      items: { created: 0, updated: 0, archived: 1 },
    });

    const groups = await client.query('SELECT status FROM menu_item_modifier_groups');
    const modifiers = await client.query('SELECT status FROM menu_item_modifiers');
    assert.deepEqual(groups.rows, [{ status: 'archived' }]);
    assert.deepEqual(modifiers.rows, [{ status: 'archived' }]);
  } finally {
    await client.end();
  }
});
