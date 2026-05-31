const { createIikoHttpClient, normalizeApiBase } = require('./client');
const bcrypt = require('bcryptjs');
const { randomInt } = require('crypto');

const REQUIRED_IIKO_ENV = ['IIKO_ENABLED', 'IIKO_API_LOGIN', 'IIKO_ORGANIZATION_ID'];

function getIikoConfig(env = process.env) {
  const apiLogin = String(env.IIKO_API_LOGIN ?? '').trim();
  const enabledFlag = String(env.IIKO_ENABLED ?? '').trim().toLowerCase();
  const enabled = enabledFlag === 'true' && Boolean(apiLogin);
  const disabledReason =
    enabledFlag !== 'true'
      ? 'IIKO_ENABLED is not true.'
      : !apiLogin
        ? 'IIKO_API_LOGIN is not configured.'
        : null;

  return {
    enabled,
    enabledFlag,
    disabledReason,
    apiBase: normalizeApiBase(env.IIKO_API_BASE),
    apiLogin,
    organizationId: String(env.IIKO_ORGANIZATION_ID ?? '').trim(),
    apiLoginConfigured: Boolean(apiLogin),
  };
}

function compactText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizePhone(value) {
  const text = String(value ?? '').replace(/\D/g, '');
  if (!text) return null;
  if (text.length === 10) return `+7${text}`;
  if (text.length === 11 && text.startsWith('7')) return `+${text}`;
  if (text.length === 11 && text.startsWith('8')) return `+7${text.slice(1)}`;
  return `+${text}`;
}

function mapIikoRoleToLocal(iikoRole) {
  const role = String(iikoRole ?? '').toLowerCase().trim();

  if (role.includes('manager') || role.includes('менеджер') || role.includes('управляющ')) {
    return 'manager';
  }
  if (role.includes('host') || role.includes('хостес')) {
    return 'hostess';
  }
  if (role.includes('waiter') || role.includes('официант')) {
    return 'waiter';
  }
  if (role.includes('kitchen') || role.includes('кухня')) {
    return 'chef';
  }
  if (role.includes('cook') || role.includes('повар')) {
    return 'cook';
  }
  if (role.includes('bar') || role.includes('бар') || role.includes('бармен')) {
    return 'bar';
  }

  // По умолчанию - официант
  return 'waiter';
}

function generateLogin(name, phone) {
  const cleanName = String(name ?? '').toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  const phoneDigits = String(phone ?? '').replace(/\D/g, '').slice(-4);
  return `${cleanName}${phoneDigits}` || `user${phoneDigits}`;
}

async function generateUniqueLogin(client, baseLogin) {
  const normalizedBase = compactText(baseLogin)?.toLowerCase() || `user${randomInt(1000, 10000)}`;
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? normalizedBase : `${normalizedBase}${suffix + 1}`;
    const existing = await client.query('SELECT id FROM users WHERE login = $1 LIMIT 1', [candidate]);
    if (!existing.rows[0]) return candidate;
  }
  return `${normalizedBase}${Date.now()}`;
}

function generateDefaultPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%';
  let password = '';
  for (let index = 0; index < 12; index += 1) {
    password += alphabet[randomInt(0, alphabet.length)];
  }
  return password;
}

async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

async function withClient(db, callback) {
  if (typeof db.connect === 'function') {
    const client = await db.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
  return await callback(db);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function publicSyncStatus(status) {
  if (!status) return null;
  if (status === 'completed' || status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'disabled') return 'disabled';
  return status;
}

function emptyLastSyncStatus(config) {
  return config.enabled ? null : 'disabled';
}

function numericLogValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatLastStaffSync(row, config) {
  if (!row) {
    return {
      status: emptyLastSyncStatus(config),
      rawStatus: null,
      triggerType: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      staffCreated: null,
      staffUpdated: null,
      staffArchived: null,
      error: null,
    };
  }

  return {
    status: publicSyncStatus(row.status),
    rawStatus: row.status ?? null,
    triggerType: row.trigger_type ?? null,
    startedAt: isoTimestamp(row.started_at),
    finishedAt: isoTimestamp(row.finished_at),
    durationMs: row.duration_ms == null ? null : numericLogValue(row.duration_ms),
    staffCreated: numericLogValue(row.staff_created),
    staffUpdated: numericLogValue(row.staff_updated),
    staffArchived: numericLogValue(row.staff_archived),
    error: row.error_message ?? null,
  };
}

async function upsertStaffMember(client, payload, randomUUID, now) {
  // Проверяем существование по iiko_id
  const existing = await client.query(
    'SELECT id, login FROM users WHERE iiko_id = $1 LIMIT 1',
    [payload.iikoId]
  );

  if (existing.rows[0]) {
    // Обновляем существующего сотрудника
    await client.query(
      `UPDATE users
       SET name = $2,
           phone = $3,
           role = $4,
           position = $5,
           status = $6,
           iiko_is_deleted = $7,
           iiko_last_seen_at = $8,
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1`,
      [
        existing.rows[0].id,
        payload.name,
        payload.phone,
        payload.role,
        payload.position,
        payload.status,
        payload.iikoIsDeleted,
        now,
      ]
    );
    return { id: existing.rows[0].id, created: false, login: existing.rows[0].login };
  }

  // Создаем нового сотрудника
  const id = randomUUID();
  const login = await generateUniqueLogin(client, payload.login);
  const password = payload.password;
  const passwordHash = await hashPassword(password);

  await client.query(
    `INSERT INTO users
       (id, name, phone, login, password_hash, password_plain, role, position, status,
        iiko_id, iiko_code, iiko_is_deleted, iiko_last_seen_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
    [
      id,
      payload.name,
      payload.phone,
      login,
      passwordHash,
      null,
      payload.role,
      payload.position,
      payload.status,
      payload.iikoId,
      payload.iikoCode,
      payload.iikoIsDeleted,
      now,
    ]
  );

  return { id, created: true, login, password };
}

async function archiveMissingStaff(client, seenIikoIds, now) {
  if (seenIikoIds.length === 0) {
    // Если нет ни одного сотрудника из iiko, не архивируем всех
    return 0;
  }

  const placeholders = seenIikoIds.map((_, index) => `$${index + 2}`).join(', ');
  const result = await client.query(
    `UPDATE users
     SET status = 'archived',
         iiko_is_deleted = TRUE,
         updated_at = NOW(),
         version = version + 1
     WHERE iiko_id IS NOT NULL
       AND status <> 'archived'
       AND iiko_id NOT IN (${placeholders})
       AND iiko_last_seen_at < $1`,
    [now, ...seenIikoIds]
  );

  return result.rowCount ?? 0;
}

async function insertStaffSyncLog(client, result, randomUUID, triggerType = 'manual') {
  await client.query(
    `INSERT INTO iiko_staff_sync_log
       (id, status, started_at, finished_at, duration_ms,
        staff_created, staff_updated, staff_archived, error_message, trigger_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      randomUUID(),
      result.status,
      result.started_at,
      result.finished_at,
      result.duration_ms,
      result.staff.created,
      result.staff.updated,
      result.staff.archived,
      result.error ?? null,
      triggerType,
    ]
  );
}

function buildResult(status, startedAt, data = {}) {
  const finishedAt = new Date();
  return {
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    staff: {
      created: 0,
      updated: 0,
      archived: 0,
      ...(data.staff ?? {}),
    },
    new_credentials: data.new_credentials ?? [],
    ...(data.error ? { error: data.error } : {}),
    ...(data.disabled_reason ? { disabled_reason: data.disabled_reason } : {}),
  };
}

async function syncIikoStaff(options = {}) {
  const startedAt = new Date();
  const env = options.env ?? process.env;
  const config = getIikoConfig(env);
  const randomUUID = options.randomUUID;
  const logger = options.logger ?? console;
  const triggerType = options.triggerType ?? 'manual';

  if (typeof randomUUID !== 'function') {
    throw new Error('randomUUID is required for iiko staff sync.');
  }

  if (!config.enabled) {
    return buildResult('disabled', startedAt, { disabled_reason: config.disabledReason });
  }

  if (!config.organizationId) {
    const result = buildResult('failed', startedAt, {
      error: 'IIKO_ORGANIZATION_ID is not configured.',
    });
    if (options.db) {
      await withClient(options.db, (client) => insertStaffSyncLog(client, result, randomUUID, triggerType));
    }
    return result;
  }

  const iikoClient = options.iikoClient || createIikoHttpClient(config, options);

  try {
    // Получаем список сотрудников из iiko
    const employees = await iikoClient.fetchEmployees(config.organizationId);

    if (!employees || !Array.isArray(employees.employees)) {
      throw new Error('Invalid response from iiko employees API');
    }

    return await withClient(options.db, async (client) => {
      await client.query('BEGIN');

      try {
        const now = startedAt;
        const counts = {
          staff: { created: 0, updated: 0, archived: 0 },
        };
        const seenIikoIds = [];
        const newCredentials = [];

        for (const employee of employees.employees) {
          if (!employee?.id || !employee?.name) continue;

          // Пропускаем удаленных сотрудников из iiko
          if (employee.deleted === true || employee.isDeleted === true) continue;

          const iikoId = String(employee.id);
          const name = compactText(employee.name) || compactText(employee.displayName) || 'iiko employee';
          const phone = normalizePhone(employee.phone || employee.cellPhone || employee.mobilePhone) || '+70000000000';
          const iikoCode = compactText(employee.code || employee.personnelNumber);
          const position = compactText(employee.position || employee.role) || 'staff';
          const role = mapIikoRoleToLocal(employee.role || employee.position);

          // Генерируем логин и пароль для новых сотрудников
          const login = generateLogin(name, phone);
          const password = generateDefaultPassword();

          const payload = {
            iikoId,
            iikoCode,
            name,
            phone,
            login,
            password,
            role,
            position,
            status: 'off_shift',
            iikoIsDeleted: false,
          };

          const saved = await upsertStaffMember(client, payload, randomUUID, now);
          seenIikoIds.push(iikoId);
          counts.staff[saved.created ? 'created' : 'updated'] += 1;

          if (saved.created) {
            newCredentials.push({
              id: saved.id,
              name,
              login: saved.login,
              password: saved.password,
              role,
            });
            logger.info(`Created new staff member from iiko: ${name} (${saved.login})`);
          }
        }

        // Архивируем сотрудников, которых больше нет в iiko
        const archived = await archiveMissingStaff(client, seenIikoIds, now);
        counts.staff.archived = archived;

        const result = buildResult('completed', startedAt, {
          staff: counts.staff,
          new_credentials: newCredentials,
        });

        await insertStaffSyncLog(client, result, randomUUID, triggerType);
        await client.query('COMMIT');

        logger.info(
          `iiko staff sync completed: ${counts.staff.created} created, ${counts.staff.updated} updated, ${counts.staff.archived} archived`
        );

        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } catch (error) {
    logger.error('iiko staff sync failed:', error);
    const result = buildResult('failed', startedAt, {
      error: error.message || String(error),
    });
    if (options.db) {
      try {
        await withClient(options.db, (client) => insertStaffSyncLog(client, result, randomUUID, triggerType));
      } catch (logError) {
        logger.error('Failed to write staff sync log:', logError);
      }
    }
    return result;
  }
}

async function getIikoStaffSyncStatus(db, env = process.env, scheduler = null) {
  const config = getIikoConfig(env);

  const lastSync = await withClient(db, async (client) => {
    const result = await client.query(
      `SELECT * FROM iiko_staff_sync_log
       ORDER BY finished_at DESC
       LIMIT 1`
    );
    return result.rows[0] || null;
  });

  const response = {
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    lastSync: formatLastStaffSync(lastSync, config),
  };

  // Добавляем информацию о планировщике
  if (scheduler && scheduler.enabled) {
    response.scheduler = {
      enabled: true,
      intervalMs: scheduler.intervalMs,
    };
  } else {
    response.scheduler = {
      enabled: false,
      intervalMs: 0,
    };
  }

  return response;
}

module.exports = {
  getIikoConfig,
  mapIikoRoleToLocal,
  syncIikoStaff,
  getIikoStaffSyncStatus,
  formatLastStaffSync,
};
