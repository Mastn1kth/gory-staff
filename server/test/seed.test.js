const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { newDb } = require('pg-mem');

const { loadRestaurantSourceData, seedRestaurantSourceData, seedRoles } = require('../src/seed');

function withRestaurantSourceDataPath(sourcePath, fn) {
  const previous = process.env.RESTAURANT_SOURCE_DATA_PATH;
  process.env.RESTAURANT_SOURCE_DATA_PATH = sourcePath;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete process.env.RESTAURANT_SOURCE_DATA_PATH;
      } else {
        process.env.RESTAURANT_SOURCE_DATA_PATH = previous;
      }
    });
}

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

test('restaurant source data is optional for public repository builds', async () => {
  await withRestaurantSourceDataPath(path.join(os.tmpdir(), 'missing-gory-source-data.json'), async () => {
    const sourceData = loadRestaurantSourceData();
    assert.deepEqual(sourceData, { categories: [], menuItems: [], floors: [], tables: [] });

    const client = await createSchemaClient();
    try {
      await seedRestaurantSourceData(client);
      const tables = await client.query('SELECT COUNT(*)::int AS count FROM "tables"');
      assert.equal(tables.rows[0].count, 0);
    } finally {
      await client.end();
    }
  });
});

test('restaurant source data clears missing waiter references when provided locally', async () => {
  const sourcePath = path.join(os.tmpdir(), `gory-source-data-${Date.now()}.json`);
  await fs.writeFile(
    sourcePath,
    JSON.stringify({
      categories: [{ id: 'cat-test', name: 'Test', sort_order: 1 }],
      menuItems: [],
      floors: [{ id: 'floor-test', name: 'Floor', sort_order: 1 }],
      tables: [
        {
          id: 't-1',
          floor_id: 'floor-test',
          number: '1',
          seats: 2,
          x_position: 0,
          y_position: 0,
          width: 1,
          height: 1,
          shape: 'square',
          status: 'free',
          current_waiter_id: 'missing-waiter',
        },
      ],
    }),
  );

  await withRestaurantSourceDataPath(sourcePath, async () => {
    const client = await createSchemaClient();
    try {
      await client.query(
        `INSERT INTO users (id, name, phone, login, password_hash, role, position, status)
         VALUES ('u-admin', 'Tech Admin', '+7 900 000-00-00', 'tech@example.test', 'hash', 'technician', 'Tech', 'off_shift')`,
      );

      await seedRestaurantSourceData(client);

      const table = await client.query('SELECT current_waiter_id FROM "tables" WHERE id = $1', ['t-1']);
      assert.equal(table.rows[0].current_waiter_id, null);
    } finally {
      await client.end();
    }
  });
});
