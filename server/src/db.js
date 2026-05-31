
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const { backfillConfiguredPasswords, seedDatabase, seedRestaurantSourceData, seedRoles } = require('./seed');

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://gory:gory@localhost:5432/gory_staff';
const isMemoryDatabase = process.env.USE_PGMEM === '1' || connectionString === 'memory';

function createPool() {
  if (isMemoryDatabase) {
    const { newDb } = require('pg-mem');
    const db = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = db.adapters.createPg();
    return new adapter.Pool();
  }

  const { Pool } = require('pg');
  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 20),
    min: Number(process.env.PG_POOL_MIN ?? 2),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5000),
    allowExitOnIdle: false,
  });
}

const pool = createPool();

async function initDatabase() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');

  // Загружаем дополнительную схему для напоминаний о бронях
  const reminderSchemaPath = path.join(__dirname, 'schema-reservation-reminders.sql');
  const reminderSchema = await fs.readFile(reminderSchemaPath, 'utf8');

  // Загружаем схему OAuth
  const oauthSchemaPath = path.join(__dirname, 'schema-oauth.sql');
  const oauthSchema = await fs.readFile(oauthSchemaPath, 'utf8').catch(() => '');

  // Загружаем оптимизации производительности
  const perfOptPath = path.join(__dirname, 'performance-optimizations.sql');
  const perfOptSchema = await fs.readFile(perfOptPath, 'utf8').catch(() => '');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(schema);
    await client.query(reminderSchema);
    if (oauthSchema) {
      await client.query(oauthSchema);
    }
    if (perfOptSchema && !isMemoryDatabase) {
      await client.query(perfOptSchema);
    }
    await seedRoles(client);

    const seedMode = String(process.env.SEED_DEMO_DATA ?? 'if-empty').toLowerCase();
    const users = await client.query('SELECT COUNT(*)::int AS count FROM users');
    const userCount = users.rows[0]?.count ?? 0;
    const shouldSeedDemo =
      seedMode === '1' ||
      seedMode === 'true' ||
      seedMode === 'always' ||
      (seedMode === 'if-empty' && userCount === 0);

    if (shouldSeedDemo) {
      await seedDatabase(client);
    }
    await backfillConfiguredPasswords(client);
    await seedRestaurantSourceData(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

module.exports = {
  pool,
  query,
  initDatabase,
};
