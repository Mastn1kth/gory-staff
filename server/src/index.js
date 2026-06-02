require('dotenv').config();

const bcrypt = require('bcryptjs');
const compression = require('compression');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const http = require('http');
const jwt = require('jsonwebtoken');
const { createHash, randomUUID } = require('crypto');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
const { initDatabase, pool, query } = require('./db');
const { cache, invalidateCache, cacheInvalidationMiddleware } = require('./cache');
const {
  startIikoOrderStatusSyncScheduler,
  startIikoStaffSyncScheduler,
  syncGuestOrderToIiko,
  syncOpenIikoOrderStatuses,
} = require('./integrations/iiko');
const { startGuestMarketingPushScheduler } = require('./guestMarketingPush');
const { ReservationReminderService } = require('./services/reservation-reminders');
const { createTwilioClient } = require('./integrations/twilio');
const {
  can,
  permissionsFor,
  roleDefinitions,
  sectionsForRole,
  canManageStaff,
  canManageRestaurant,
  canManageGuestClients,
  canUseSupplyRequests,
  canManageAllTasks,
  canSeeAllSchedule,
  canViewActivityLog,
  canManageFloorLayout,
  targetGroupsForRole,
  chatIdsForRole,
} = require('./permissions');
const { registerCoordinationRoutes } = require('./coordination');
const { registerAllRoutes } = require('./routes');

let coordinationApi = null;

const app = express();
const server = http.createServer(app);

function trustProxyValue() {
  const raw = String(process.env.TRUST_PROXY ?? 'loopback').trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw.toLowerCase() === 'true') return true;
  if (raw.toLowerCase() === 'false') return false;
  return raw || 'loopback';
}

function normalizeIpAddress(value) {
  return String(value ?? '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/i, '');
}

function trustedProxyAddresses() {
  return new Set(
    String(process.env.TRUSTED_PROXY_IPS ?? '')
      .split(',')
      .map(normalizeIpAddress)
      .filter(Boolean),
  );
}

function isLoopbackAddress(address) {
  const normalized = normalizeIpAddress(address);
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function isTrustedImmediateProxy(req) {
  const remoteAddress = normalizeIpAddress(req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? '');
  return isLoopbackAddress(remoteAddress) || trustedProxyAddresses().has(remoteAddress);
}

function realClientIp(req) {
  const cloudflareIp = normalizeIpAddress(req.get('cf-connecting-ip'));
  if (cloudflareIp && isTrustedImmediateProxy(req)) return cloudflareIp;
  return normalizeIpAddress(req.ip || req.socket?.remoteAddress || 'unknown') || 'unknown';
}

function requiredSecret(name) {
  const value = String(process.env[name] ?? '').trim();
  if (value.length < 32 || value === 'dev-secret-change-me') {
    throw new Error(`${name} must be set to a strong secret before starting the server.`);
  }
  return value;
}

function configuredOrigins() {
  const raw = [
    process.env.CORS_ORIGINS,
    process.env.PUBLIC_SERVER_URL,
    process.env.EXPO_PUBLIC_API_URL,
  ]
    .filter(Boolean)
    .join(',');
  return [...new Set(raw.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean))];
}

const allowedOrigins = configuredOrigins();
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin is not allowed.'));
  },
};
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
  },
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';
const jwtSecret = requiredSecret('JWT_SECRET');
const guestJwtSecret = requiredSecret('GUEST_JWT_SECRET');
if (guestJwtSecret === jwtSecret) {
  throw new Error('GUEST_JWT_SECRET must be different from JWT_SECRET.');
}
const serverStartedAt = new Date();
const pushReminderIntervalMs = Number(process.env.PUSH_REMINDER_INTERVAL_MS ?? 300000);
const pushRequestTimeoutMs = Number(process.env.PUSH_REQUEST_TIMEOUT_MS ?? 5000);
const MOBILE_SYNC_NOTIFICATION_LIMIT = Number(process.env.MOBILE_SYNC_NOTIFICATION_LIMIT ?? 30);
const MOBILE_SYNC_ACTIVITY_LOG_LIMIT = Number(process.env.MOBILE_SYNC_ACTIVITY_LOG_LIMIT ?? 20);
const MOBILE_SYNC_CHAT_MESSAGE_LIMIT = Number(process.env.MOBILE_SYNC_CHAT_MESSAGE_LIMIT ?? 80);
const MOBILE_SYNC_GUEST_TRANSACTION_LIMIT = Number(process.env.MOBILE_SYNC_GUEST_TRANSACTION_LIMIT ?? 80);
const MOBILE_SYNC_MAX_BYTES = Number(process.env.MOBILE_SYNC_MAX_BYTES ?? 23000);
const LOGIN_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 5 * 60 * 1000));
const LOGIN_RATE_LIMIT_MAX = Math.max(1, Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 20));
const loginRateLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(realClientIp(req)),
  message: { error: 'Слишком много попыток входа. Подождите несколько минут.' },
});

const BAR_TEXT_PATTERNS = ['бар', 'напит', 'вино', 'алког', 'коктей', 'пиво', 'лимонад', 'чай', 'кофе', 'сок', 'виски', 'водка', 'коньяк'];
const BAR_ITEM_TYPES = new Set(['bar', 'drink', 'alcohol']);

function textMatchesBar(value) {
  const text = String(value ?? '').toLowerCase();
  return BAR_TEXT_PATTERNS.some((pattern) => text.includes(pattern));
}

function isBarMenuItem(item, category = null) {
  if (!item) return false;
  if (BAR_ITEM_TYPES.has(String(item.item_type ?? '').toLowerCase())) return true;
  if (textMatchesBar(category?.name) || textMatchesBar(item.name) || textMatchesBar(item.description)) return true;
  return Boolean(item.is_bar && !item.is_kitchen && (textMatchesBar(item.composition) || textMatchesBar(item.waiter_hint)));
}

function barMenuSqlCondition(itemAlias = 'mi', categoryAlias = 'mc') {
  const textChecks = BAR_TEXT_PATTERNS.flatMap((pattern) => [
    `LOWER(${categoryAlias}.name) LIKE '%${pattern}%'`,
    `LOWER(${itemAlias}.name) LIKE '%${pattern}%'`,
    `LOWER(COALESCE(${itemAlias}.description, '')) LIKE '%${pattern}%'`,
  ]);
  return `(${itemAlias}.item_type IN ('bar', 'drink', 'alcohol') OR ${textChecks.join(' OR ')} OR (${itemAlias}.is_bar = TRUE AND ${itemAlias}.is_kitchen = FALSE AND (${itemAlias}.item_type <> 'food' OR ${textChecks.join(' OR ')})))`;
}

app.disable('x-powered-by');
app.set('trust proxy', trustProxyValue());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6, // Баланс между скоростью и степенью сжатия
  threshold: 1024, // Сжимать только ответы больше 1KB
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, password_plain, ...safeUser } = user;
  return safeUser;
}

function isLoginBlocked(user) {
  return ['inactive', 'blocked', 'fired'].includes(String(user?.status ?? ''));
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Требуется вход в приложение.' });
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const result = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ error: 'Пользователь не найден.' });
      return;
    }
    if (isLoginBlocked(user)) {
      res.status(403).json({ error: 'Вход в приложение закрыт. Обратитесь к администратору.' });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Сессия истекла, войдите снова.' });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!can(req.user.role, permission)) {
      res.status(403).json({ error: 'Недостаточно прав для этого действия.' });
      return;
    }
    next();
  };
}

function requireStaffManagement(req, res, next) {
  if (!canManageStaff(req.user.role)) {
    res.status(403).json({ error: 'Действие доступно только владельцу, управляющему или технику.' });
    return;
  }
  next();
}

async function logActivity(client, userId, action, entityType, entityId, oldValue, newValue) {
  await client.query(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [randomUUID(), userId, action, entityType, entityId, oldValue, newValue],
  );
}

function compactText(value, maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function isExpoPushToken(token) {
  return typeof token === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

async function postExpoPushBatch(messages) {
  if (process.env.DISABLE_PUSH === '1' || messages.length === 0) return;
  if (typeof fetch !== 'function') {
    console.warn('Expo push skipped: fetch is not available in this Node.js runtime.');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), pushRequestTimeoutMs);
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (process.env.EXPO_PUSH_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`;
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn('Expo push failed:', response.status, payload ?? response.statusText);
      return;
    }
    const errors = Array.isArray(payload?.data) ? payload.data.filter((ticket) => ticket.status === 'error') : [];
    if (errors.length > 0) {
      console.warn('Expo push ticket errors:', errors.slice(0, 3));
    }
  } catch (error) {
    console.warn('Expo push request failed:', error.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function sendExpoPushMessages(messages) {
  const unique = new Map();
  for (const message of messages) {
    if (!isExpoPushToken(message.to)) continue;
    unique.set(message.to, message);
  }

  const validMessages = [...unique.values()];
  for (let index = 0; index < validMessages.length; index += 100) {
    await postExpoPushBatch(validMessages.slice(index, index + 100));
  }
}

function publicServerUrl() {
  return String(process.env.PUBLIC_SERVER_URL || process.env.EXPO_PUBLIC_API_URL || 'https://app.gory-staff.ru').replace(/\/$/, '');
}

function websocketUrlForApi(apiUrl = publicServerUrl()) {
  return apiUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

function notificationRecipientColumns(userType, userId) {
  if (userType === 'guest') {
    return { staffUserId: null, guestId: userId };
  }
  return { staffUserId: userId, guestId: null };
}

async function registerPushDevice(client, { userType, userId, pushToken, platform = null, deviceId = null, appVersion = null, deviceName = null }) {
  if (!pushToken) throw httpError('Не передан push token устройства.', 400);
  if (!['guest', 'staff'].includes(userType)) throw httpError('Некорректный тип пользователя для push.', 400);

  const result = await client.query(
    `INSERT INTO push_devices
       (id, user_type, user_id, device_id, platform, push_token, app_version, device_name, is_active, last_seen_at, created_at, updated_at, revoked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW(),NOW(),NOW(),NULL)
     ON CONFLICT (user_type, user_id, push_token)
     DO UPDATE SET
       device_id = COALESCE(EXCLUDED.device_id, push_devices.device_id),
       platform = EXCLUDED.platform,
       app_version = EXCLUDED.app_version,
       device_name = EXCLUDED.device_name,
       is_active = TRUE,
       last_seen_at = NOW(),
       updated_at = NOW(),
       revoked_at = NULL
     RETURNING id, user_type, user_id, platform, app_version, device_name, is_active, last_seen_at, created_at, updated_at`,
    [randomUUID(), userType, userId, deviceId, platform, pushToken, appVersion, deviceName],
  );

  if (userType === 'staff') {
    await client.query(
      `INSERT INTO device_tokens (id, user_id, token, platform, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, token)
       DO UPDATE SET platform = EXCLUDED.platform`,
      [randomUUID(), userId, pushToken, platform],
    );
  }

  return result.rows[0];
}

async function activePushDevicesForUsers(client, userType, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const result = await client.query(
    `SELECT *
     FROM push_devices
     WHERE user_type = $1
       AND user_id = ANY($2::text[])
       AND is_active = TRUE
       AND revoked_at IS NULL`,
    [userType, userIds],
  );
  return result.rows;
}

async function notificationSettingEnabled(client, userType, userId, type, channel) {
  const result = await client.query(
    `SELECT *
     FROM notification_settings
     WHERE user_type = $1
       AND user_id = $2
       AND type = $3
     LIMIT 1`,
    [userType, userId, type],
  );
  const setting = result.rows[0];
  if (!setting) return true;
  if (!setting.enabled) return false;
  return channel === 'push' ? Boolean(setting.push_enabled) : Boolean(setting.in_app_enabled);
}

async function sendPushToDevices(client, devices, { notificationId = null, title, text, type, data = {}, priority = 'high' }) {
  if (!Array.isArray(devices) || devices.length === 0) {
    if (notificationId) {
      await client.query(
        `INSERT INTO notification_delivery_log (id, notification_id, push_device_id, status, error_message, created_at)
         VALUES ($1,$2,NULL,'no_devices','Нет активных устройств для push.',NOW())`,
        [randomUUID(), notificationId],
      );
    }
    return { sent: 0, failed: 0, no_devices: true };
  }

  const validDevices = devices.filter((device) => isExpoPushToken(device.push_token));
  const invalidDevices = devices.filter((device) => !isExpoPushToken(device.push_token));
  for (const device of invalidDevices) {
    await client.query('UPDATE push_devices SET is_active = FALSE, revoked_at = NOW(), updated_at = NOW() WHERE id = $1', [device.id]);
    if (notificationId) {
      await client.query(
        `INSERT INTO notification_delivery_log (id, notification_id, push_device_id, status, error_message, created_at)
         VALUES ($1,$2,$3,'invalid_token','Push token не похож на Expo token.',NOW())`,
        [randomUUID(), notificationId, device.id],
      );
    }
  }

  if (process.env.DISABLE_PUSH === '1' || validDevices.length === 0) {
    return { sent: 0, failed: invalidDevices.length, disabled: process.env.DISABLE_PUSH === '1' };
  }

  const messages = validDevices.map((device) => ({
    to: device.push_token,
    sound: 'default',
    channelId: 'default',
    priority,
    title: compactText(title, 70),
    body: compactText(text, 160),
    data: {
      type,
      notification_id: notificationId,
      ...data,
    },
  }));

  let sent = 0;
  let failed = invalidDevices.length;
  for (let index = 0; index < messages.length; index += 100) {
    const batch = messages.slice(index, index + 100);
    const batchDevices = validDevices.slice(index, index + 100);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), pushRequestTimeoutMs);
    try {
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (process.env.EXPO_PUSH_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`;
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(batch),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      const tickets = Array.isArray(payload?.data) ? payload.data : [];
      for (let itemIndex = 0; itemIndex < batchDevices.length; itemIndex += 1) {
        const device = batchDevices[itemIndex];
        const ticket = tickets[itemIndex] ?? null;
        const ok = response.ok && (!ticket || ticket.status !== 'error');
        if (ok) sent += 1;
        else failed += 1;
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          await client.query('UPDATE push_devices SET is_active = FALSE, revoked_at = NOW(), updated_at = NOW() WHERE id = $1', [device.id]);
        }
        if (notificationId) {
          await client.query(
            `INSERT INTO notification_delivery_log (id, notification_id, push_device_id, status, provider_response, error_message, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
            [
              randomUUID(),
              notificationId,
              device.id,
              ok ? 'success' : ticket?.details?.error === 'DeviceNotRegistered' ? 'invalid_token' : 'provider_error',
              ticket ?? payload ?? null,
              ok ? null : ticket?.message ?? response.statusText ?? 'Push provider error',
            ],
          );
        }
      }
    } catch (error) {
      failed += batchDevices.length;
      for (const device of batchDevices) {
        if (notificationId) {
          await client.query(
            `INSERT INTO notification_delivery_log (id, notification_id, push_device_id, status, error_message, created_at)
             VALUES ($1,$2,$3,'failed',$4,NOW())`,
            [randomUUID(), notificationId, device.id, error.message],
          );
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return { sent, failed, no_devices: false };
}

async function userIdsForNotificationTarget(client, { userId = null, targetRole = 'all', excludeUserId = null }) {
  if (userId) return userId === excludeUserId ? [] : [userId];

  const result = await client.query('SELECT id, role, status FROM users');
  return result.rows
    .filter((user) => user.id !== excludeUserId)
    .filter((user) => user.role !== 'pending')
    .filter((user) => !['blocked', 'fired', 'inactive'].includes(user.status))
    .filter((user) => targetRole === 'all' || targetGroupsForRole(user.role).includes(targetRole))
    .map((user) => user.id);
}

async function sendPushToUsers(client, userIds, { title, text, type, data = {}, notificationId = null }) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  const devices = await activePushDevicesForUsers(client, 'staff', userIds);
  const allowedDevices = [];
  for (const device of devices) {
    if (await notificationSettingEnabled(client, 'staff', device.user_id, type, 'push')) allowedDevices.push(device);
  }
  return sendPushToDevices(client, allowedDevices, { notificationId, title, text, type, data });
}

async function sendPushToNotificationTarget(client, { userId = null, targetRole = 'all', title, text, type, data = {}, excludeUserId = null }) {
  const userIds = await userIdsForNotificationTarget(client, { userId, targetRole, excludeUserId });
  await sendPushToUsers(client, userIds, { title, text, type, data });
}

async function createNotification(client, { userId = null, targetRole = 'all', title, text, type, data = {}, push = true }) {
  const notificationId = randomUUID();
  await client.query(
    `INSERT INTO notifications
       (id, user_type, user_id, guest_id, target_role, title, text, body, type, data_json, status, is_read, created_at)
     VALUES ($1,'staff',$2,NULL,$3,$4,$5,$5,$6,$7,'created',FALSE,NOW())`,
    [notificationId, userId, targetRole, title, text, type, data],
  );

  if (!push) return notificationId;
  try {
    const userIds = await userIdsForNotificationTarget(client, { userId, targetRole });
    const result = await sendPushToUsers(client, userIds, { title, text, type, data, notificationId });
    await client.query(
      `UPDATE notifications
       SET status = $2,
           sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
           error_message = $3
       WHERE id = $1`,
      [notificationId, result?.sent > 0 ? 'sent' : result?.no_devices ? 'no_devices' : 'created', result?.no_devices ? 'Нет активных устройств для push.' : null],
    );
  } catch (error) {
    console.warn('Push notification skipped:', error.message);
    await client.query('UPDATE notifications SET status = $2, error_message = $3 WHERE id = $1', [notificationId, 'failed', error.message]);
  }
  return notificationId;
}

async function createRoleNotifications(client, targetRoles, notification) {
  const roles = [...new Set((targetRoles ?? []).filter(Boolean))];
  for (const targetRole of roles) {
    await createNotification(client, {
      ...notification,
      targetRole,
    });
  }
}

function reservationPushText(row) {
  return `${row.guest_name}, ${row.guests_count} гостей, ${row.time}`;
}

async function notifyStopListChange(client, row, { title, type = 'stop_list' }) {
  const menuItem = (
    await client.query('SELECT id, name, is_bar, is_kitchen, item_type FROM menu_items WHERE id = $1', [row.menu_item_id])
  ).rows[0];
  const roles = ['waiter', 'hostess', 'management'];
  if (menuItem?.is_bar || ['bar', 'drink', 'alcohol'].includes(menuItem?.item_type)) roles.push('bar');
  if (menuItem?.is_kitchen || menuItem?.item_type === 'food') roles.push('kitchen');

  await createRoleNotifications(client, roles, {
    title,
    text: `${menuItem?.name ?? 'Позиция'}: ${row.reason ?? 'обновлён стоп-лист'}`,
    type,
    data: { stop_list_id: row.id, menu_item_id: row.menu_item_id },
  });
}

async function createGuestNotification(client, { guestId, title, text, type, data = {}, push = true, respectMarketing = false }) {
  const guest = (await client.query('SELECT * FROM guest_users WHERE id = $1 AND deleted_at IS NULL', [guestId])).rows[0];
  if (!guest || guest.status === 'blocked') return null;
  if (respectMarketing && !guest.marketing_consent) return null;
  if (!(await notificationSettingEnabled(client, 'guest', guestId, type, 'in_app'))) return null;

  const notificationId = randomUUID();
  await client.query(
    `INSERT INTO notifications
       (id, user_type, user_id, guest_id, target_role, title, text, body, type, data_json, status, is_read, created_at)
     VALUES ($1,'guest',NULL,$2,'guest',$3,$4,$4,$5,$6,'created',FALSE,NOW())`,
    [notificationId, guestId, title, text, type, data],
  );

  if (!push || !(await notificationSettingEnabled(client, 'guest', guestId, type, 'push'))) return notificationId;
  try {
    const devices = await activePushDevicesForUsers(client, 'guest', [guestId]);
    const result = await sendPushToDevices(client, devices, { notificationId, title, text, type, data });
    await client.query(
      `UPDATE notifications
       SET status = $2,
           sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
           error_message = $3
       WHERE id = $1`,
      [notificationId, result.sent > 0 ? 'sent' : result.no_devices ? 'no_devices' : 'created', result.no_devices ? 'Нет активных устройств для push.' : null],
    );
  } catch (error) {
    await client.query('UPDATE notifications SET status = $2, error_message = $3 WHERE id = $1', [notificationId, 'failed', error.message]);
  }
  return notificationId;
}

async function sendChatPush(chatId, sender, message) {
  const [members, chat] = await Promise.all([
    query(
      `SELECT user_id
       FROM chat_members
       WHERE chat_id = $1 AND user_id <> $2`,
      [chatId, sender.id],
    ),
    query('SELECT name FROM chats WHERE id = $1', [chatId]),
  ]);

  const chatName = chat.rows[0]?.name ?? 'Чат';
  await sendPushToUsers(
    pool,
    members.rows.map((row) => row.user_id),
    {
      title: `${chatName}: ${sender.name}`,
      text: message.message_text || 'Новое сообщение',
      type: 'chat',
      data: {
        chat_id: chatId,
        message_id: message.id,
      },
    },
  );
}

function emitChange(entity, action, payload = {}) {
  // Инвалидируем кэш при изменении данных
  invalidateCache(entity);

  io.emit('sync:changed', {
    entity,
    action,
    payload,
    at: new Date().toISOString(),
  });
}

async function addUserToRoleChats(client, userId, role) {
  const chatIds = chatIdsForRole(role);
  for (const chatId of chatIds) {
    await client.query(
      `INSERT INTO chat_members (id, chat_id, user_id, role_in_chat, joined_at)
       VALUES ($1, $2, $3, 'member', NOW())
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [randomUUID(), chatId, userId],
    );
  }
}

async function rowById(client, table, id) {
  const tableSql = table === 'tables' ? '"tables"' : `"${table}"`;
  const result = await client.query(`SELECT * FROM ${tableSql} WHERE id = $1`, [id]);
  return result.rows[0];
}

function serverDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function currentShiftForUser(client, userId) {
  const result = await client.query(
    `SELECT *
     FROM shifts
     WHERE user_id = $1 AND date = $2
     ORDER BY start_time DESC
     LIMIT 1`,
    [userId, serverDate()],
  );
  return result.rows[0] ?? null;
}

async function buildShiftCloseSummary(client, user) {
  const shift = await currentShiftForUser(client, user.id);
  const shiftId = shift?.id ?? null;
  const today = serverDate();
  const tomorrow = serverDate(1);
  const params = shiftId ? [user.id, shiftId] : [user.id, today, tomorrow];
  const noteSql = shiftId
    ? 'SELECT COUNT(*)::int AS count FROM notebook_notes WHERE user_id = $1 AND shift_id = $2'
    : `SELECT COUNT(*)::int AS count
       FROM notebook_notes
       WHERE user_id = $1
         AND created_at >= $2
         AND created_at < $3`;
  const [notes, messages, tasks, tables, reservations] = await Promise.all([
    client.query(noteSql, params),
    client.query(
      `SELECT COUNT(*)::int AS count
       FROM chat_messages
       WHERE sender_id = $1
         AND created_at >= $2
         AND created_at < $3
         AND deleted_at IS NULL`,
      [user.id, today, tomorrow],
    ),
    client.query(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0)::int AS done
       FROM tasks
       WHERE assigned_to = $1
         AND due_date >= $2
         AND due_date < $3`,
      [user.id, today, tomorrow],
    ),
    client.query('SELECT COUNT(*)::int AS count FROM "tables" WHERE current_waiter_id = $1', [user.id]),
    client.query(
      `SELECT COUNT(*)::int AS count
       FROM reservations r
       JOIN "tables" t ON t.id = r.table_id
       WHERE t.current_waiter_id = $1 AND r.date = $2`,
      [user.id, today],
    ),
  ]);

  const shiftTime = shift ? `${String(shift.start_time).slice(0, 5)}-${String(shift.end_time).slice(0, 5)}` : 'смена не начата';
  return [
    `${user.name} завершил смену (${shiftTime}).`,
    `Заметки: ${notes.rows[0]?.count ?? 0}.`,
    `Задачи: ${tasks.rows[0]?.done ?? 0}/${tasks.rows[0]?.total ?? 0}.`,
    `Сообщения: ${messages.rows[0]?.count ?? 0}.`,
    `Столы: ${tables.rows[0]?.count ?? 0}.`,
    `Брони на эту смену: ${reservations.rows[0]?.count ?? 0}.`,
  ].join(' ');
}

function timeToMinutes(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes();
  }

  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function hourLabel(value) {
  const minutes = timeToMinutes(value);
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:00`;
}

function buildPeakHours(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const hour = hourLabel(row.time);
    if (!hour) return;
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  });

  return [...counts.entries()]
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => b.count - a.count || a.hour.localeCompare(b.hour))
    .slice(0, 5);
}

function numericCell(value) {
  const cell = Array.isArray(value) ? value[0] : value;
  const number = Number(cell ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeAnalyticsCounters(row) {
  return {
    reservations_today: numericCell(row.reservations_today),
    reservations_week: numericCell(row.reservations_week),
    guests_today: numericCell(row.guests_today),
    cancelled_week: numericCell(row.cancelled_week),
    no_show_week: numericCell(row.no_show_week),
    free_tables: numericCell(row.free_tables),
    busy_tables: numericCell(row.busy_tables),
    stop_list_count: numericCell(row.stop_list_count),
    completed_tasks: numericCell(row.completed_tasks),
    total_tasks: numericCell(row.total_tasks),
  };
}

function rowDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function rowTime(value) {
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  return String(value ?? '').slice(0, 5);
}

function buildOperationalSummary({ user, users, tables, reservations, events, tasks, stopList, notifications }) {
  const today = serverDate();
  const activeStopList = stopList.filter((item) => item.status !== 'available');
  const openTasks = tasks.filter((task) => task.status !== 'done');
  const unreadNotifications = notifications.filter((item) => !item.is_read);
  const pendingStaff = users.filter((item) => item.role === 'pending').length;
  const onShift = users.filter((item) => item.status === 'on_shift').length;
  const freeTables = tables.filter((table) => table.status === 'free').length;
  const occupiedTables = tables.filter((table) => ['occupied', 'banquet'].includes(table.status)).length;
  const nextReservation = reservations.find((reservation) => rowDate(reservation.date) >= today && !['cancelled', 'no_show', 'guests_left'].includes(reservation.status));
  const nextEvent = events.find((event) => rowDate(event.date) >= today && !['cancelled', 'done', 'completed'].includes(event.status));

  const items = [];
  if (pendingStaff > 0 && canManageStaff(user.role)) {
    items.push(`${pendingStaff} новых сотрудников ждут подтверждения роли.`);
  }
  if (openTasks.length > 0) {
    items.push(`${openTasks.length} задач по смене ещё не закрыты.`);
  }
  if (activeStopList.length > 0) {
    items.push(`${activeStopList.length} позиций сейчас в стоп-листе.`);
  }
  if (unreadNotifications.length > 0) {
    items.push(`${unreadNotifications.length} непрочитанных новостей.`);
  }
  if (nextReservation) {
    items.push(`Ближайшая бронь: ${rowTime(nextReservation.time)}, ${nextReservation.guest_name}, ${nextReservation.guests_count} гостей.`);
  }
  if (nextEvent) {
    items.push(`Ближайший банкет: ${rowDate(nextEvent.date)} ${rowTime(nextEvent.time)}, ${nextEvent.title}.`);
  }
  if (items.length === 0) {
    items.push('Критичных событий нет, смена проходит спокойно.');
  }

  const status =
    unreadNotifications.some((item) => ['urgent', 'shift_summary'].includes(item.type)) || activeStopList.length >= 4
      ? 'critical'
      : openTasks.length > 0 || activeStopList.length > 0 || unreadNotifications.length > 0
        ? 'attention'
        : 'calm';

  return {
    status,
    title: status === 'critical' ? 'Есть срочные события' : status === 'attention' ? 'Смена требует внимания' : 'Смена под контролем',
    items,
    on_shift: onShift,
    free_tables: freeTables,
    occupied_tables: occupiedTables,
    open_tasks: openTasks.length,
    active_stop_list: activeStopList.length,
    unread_notifications: unreadNotifications.length,
    next_reservation_id: nextReservation?.id ?? null,
    next_event_id: nextEvent?.id ?? null,
  };
}

function serverStatus() {
  return {
    service: 'gory-staff-server',
    mode: process.env.USE_PGMEM === '1' ? 'demo-memory' : 'postgres',
    started_at: serverStartedAt.toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    api_version: '0.1.0',
  };
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeGuestPhone(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

function normalizeReferralCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeBirthday(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function loyaltyLevelForBonus(balance) {
  const value = Number(balance ?? 0);
  if (value >= 25000) return 'platinum';
  if (value >= 10000) return 'gold';
  if (value >= 3000) return 'silver';
  return 'bronze';
}

const loyaltyLevelLabels = {
  bronze: 'Бронза',
  silver: 'Серебро',
  gold: 'Золото',
  platinum: 'Платина',
};

function publicGuest(guest) {
  if (!guest) return null;
  return {
    id: guest.id,
    name: guest.name,
    phone: guest.phone,
    birthday: guest.birthday,
    gender: guest.gender,
    email: guest.email,
    avatar_url: guest.avatar_url,
    bonus_balance: Number(guest.bonus_balance ?? 0),
    lifetime_bonus_earned: Number(guest.lifetime_bonus_earned ?? 0),
    lifetime_bonus_spent: Number(guest.lifetime_bonus_spent ?? 0),
    loyalty_level: guest.loyalty_level,
    loyalty_level_label: loyaltyLevelLabels[guest.loyalty_level] ?? guest.loyalty_level,
    referral_code: guest.referral_code,
    card_number: guest.card_number,
    referrer_name: guest.referrer_name,
    invited_count: Number(guest.invited_count ?? 0),
    referred_by: guest.referred_by,
    visits_count: Number(guest.visits_count ?? 0),
    total_spent: Number(guest.total_spent ?? 0),
    average_check: Number(guest.average_check ?? 0),
    last_visit_at: guest.last_visit_at,
    favorite_category: guest.favorite_category,
    status: guest.status,
    marketing_consent: Boolean(guest.marketing_consent),
    personal_data_consent: Boolean(guest.personal_data_consent),
    created_at: guest.created_at,
    updated_at: guest.updated_at,
    version: guest.version,
  };
}

async function generateUniqueReferralCode(client) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `GOR${Math.floor(10000 + Math.random() * 90000)}`;
    const existing = await client.query('SELECT id FROM guest_users WHERE referral_code = $1', [code]);
    if (!existing.rows[0]) return code;
  }
  return `GOR${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
}

async function generateUniqueCardNumber(client) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `GOR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await client.query('SELECT id FROM guest_cards WHERE card_number = $1', [code]);
    if (!existing.rows[0]) return code;
  }
  return `GOR-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function addGuestBonusTransaction(
  client,
  {
    guestId,
    type,
    amount,
    reason,
    source = 'guest_app',
    relatedGuestId = null,
    relatedVisitId = null,
    createdBy = null,
    allowNegative = false,
    iikoOrderId = null,
    iikoPaymentEventId = null,
    localOrderId = null,
    tableSessionId = null,
  },
) {
  const numericAmount = Number(amount ?? 0);
  if (!Number.isFinite(numericAmount) || numericAmount === 0) {
    throw httpError('Сумма операции должна быть больше нуля.', 400);
  }

  if (type === 'registration_bonus') {
    const existing = await client.query('SELECT id FROM guest_bonus_transactions WHERE guest_id = $1 AND type = $2 LIMIT 1', [guestId, type]);
    if (existing.rows[0]) throw httpError('Бонус за регистрацию уже начислен.', 409);
  }

  if (type === 'referral_bonus' && relatedGuestId) {
    const existing = await client.query(
      'SELECT id FROM guest_bonus_transactions WHERE guest_id = $1 AND type = $2 AND related_guest_id = $3 LIMIT 1',
      [guestId, type, relatedGuestId],
    );
    if (existing.rows[0]) throw httpError('Бонус за это приглашение уже начислен.', 409);
  }

  const guestResult = await client.query('SELECT * FROM guest_users WHERE id = $1 AND deleted_at IS NULL', [guestId]);
  const guest = guestResult.rows[0];
  if (!guest) throw httpError('Гость не найден.', 404);

  const balanceBefore = Number(guest.bonus_balance ?? 0);
  const balanceAfter = balanceBefore + numericAmount;
  if (balanceAfter < 0 && !allowNegative) {
    throw httpError('Недостаточно бонусов для списания.', 400);
  }

  const nextLevel = loyaltyLevelForBonus(balanceAfter);
  const earnedDelta = numericAmount > 0 ? numericAmount : 0;
  const spentDelta = numericAmount < 0 ? Math.abs(numericAmount) : 0;
  const transactionId = randomUUID();

  await client.query(
    `UPDATE guest_users
     SET bonus_balance = $2,
         lifetime_bonus_earned = lifetime_bonus_earned + $3,
         lifetime_bonus_spent = lifetime_bonus_spent + $4,
         loyalty_level = $5,
         updated_at = NOW()
     WHERE id = $1`,
    [guestId, balanceAfter, earnedDelta, spentDelta, nextLevel],
  );
  await client.query('UPDATE guest_cards SET level = $2, updated_at = NOW() WHERE guest_id = $1 AND status = $3', [guestId, nextLevel, 'active']);
  const inserted = await client.query(
    `INSERT INTO guest_bonus_transactions
       (id, guest_id, type, amount, balance_before, balance_after, reason, source,
        related_guest_id, related_visit_id, created_by, iiko_order_id, iiko_payment_event_id,
        local_order_id, table_session_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
     RETURNING *`,
    [
      transactionId,
      guestId,
      type,
      numericAmount,
      balanceBefore,
      balanceAfter,
      reason,
      source,
      relatedGuestId,
      relatedVisitId,
      createdBy,
      iikoOrderId,
      iikoPaymentEventId,
      localOrderId,
      tableSessionId,
    ],
  );
  let pushTitle = numericAmount > 0 ? 'Бонусы начислены' : 'Бонусы списаны';
  let pushText = numericAmount > 0 ? `На вашу карту начислено ${numericAmount} бонусов.` : `С вашей карты списано ${Math.abs(numericAmount)} бонусов.`;
  if (type === 'registration_bonus') {
    pushTitle = 'Добро пожаловать в Горы';
    pushText = `Мы начислили вам ${numericAmount} бонусов.`;
  }
  if (type === 'referral_bonus') {
    pushTitle = 'Друг зарегистрировался';
    pushText = `Вам начислено ${numericAmount} бонусов за приглашение.`;
  }
  await createGuestNotification(client, {
    guestId,
    title: pushTitle,
    text: pushText,
    type,
    data: { transaction_id: transactionId, amount: numericAmount, balance_after: balanceAfter },
    push: true,
  });
  if (guest.loyalty_level !== nextLevel) {
    await createGuestNotification(client, {
      guestId,
      title: 'Новый уровень',
      text: `Вы перешли на уровень ${loyaltyLevelLabels[nextLevel] ?? nextLevel}.`,
      type: 'loyalty_level_changed',
      data: { level: nextLevel },
      push: true,
    });
  }
  return inserted.rows[0];
}

async function issueGuestSession(client, guest, body = {}) {
  const token = jwt.sign({ sub: guest.id, type: 'guest' }, guestJwtSecret, { expiresIn: '30d', jwtid: randomUUID() });
  const hash = tokenHash(token);
  await client.query(
    `INSERT INTO guest_sessions (id, guest_id, token_hash, device_id, device_name, created_at, expires_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW() + INTERVAL '30 days',NOW())`,
    [randomUUID(), guest.id, hash, body.device_id ?? null, body.device_name ?? null],
  );

  if (body.device_id) {
    await client.query(
      `INSERT INTO guest_devices (id, guest_id, device_id, platform, app_version, push_token, last_seen_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       ON CONFLICT (guest_id, device_id)
       DO UPDATE SET platform = EXCLUDED.platform, app_version = EXCLUDED.app_version, push_token = EXCLUDED.push_token, last_seen_at = NOW()`,
      [randomUUID(), guest.id, body.device_id, body.platform ?? null, body.app_version ?? null, body.push_token ?? null],
    );
  }

  return token;
}

async function loadOrderItemModifiers(client, orderItemIds) {
  if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) return { rows: [] };
  const placeholders = orderItemIds.map((_, index) => `$${index + 1}`).join(',');
  return client.query(
    `SELECT *
     FROM guest_order_item_modifiers
     WHERE order_item_id IN (${placeholders})
     ORDER BY created_at ASC, id ASC`,
    orderItemIds,
  );
}

function attachOrderItemModifiers(orderItems, modifiers) {
  const byOrderItemId = new Map();
  for (const modifier of modifiers) {
    const rows = byOrderItemId.get(modifier.order_item_id) ?? [];
    rows.push(modifier);
    byOrderItemId.set(modifier.order_item_id, rows);
  }
  return orderItems.map((item) => ({
    ...item,
    modifiers: byOrderItemId.get(item.id) ?? [],
  }));
}

async function buildGuestPayload(client, guestId, token = null) {
  const [
    guestResult,
    cardResult,
    transactionsResult,
    referralsResult,
    notificationsResult,
    activeSessionResult,
    orderItemsResult,
    feedbackRequestsResult,
    bonusRedemptionsResult,
  ] = await Promise.all([
    client.query('SELECT * FROM guest_users WHERE id = $1', [guestId]),
    client.query('SELECT * FROM guest_cards WHERE guest_id = $1 AND status = $2 ORDER BY issued_at DESC LIMIT 1', [guestId, 'active']),
    client.query('SELECT * FROM guest_bonus_transactions WHERE guest_id = $1 ORDER BY created_at DESC LIMIT 30', [guestId]),
    client.query(
      `SELECT
         COUNT(*)::int AS invited_count,
         COALESCE(SUM(CASE WHEN bonus_given_to_referrer THEN 500 ELSE 0 END), 0)::int AS bonuses_earned
       FROM guest_referrals
       WHERE referrer_guest_id = $1`,
      [guestId],
    ),
    client.query(
      `SELECT id, title, text, body, type, data_json, status, is_read, created_at, sent_at, read_at
       FROM notifications
       WHERE user_type = 'guest' AND guest_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [guestId],
    ),
    client.query(
      `SELECT s.*, t.number AS table_number
       FROM table_guest_sessions s
       JOIN "tables" t ON t.id = s.table_id
       WHERE s.guest_id = $1 AND s.status = 'active'
       ORDER BY s.checked_in_at DESC
       LIMIT 1`,
      [guestId],
    ),
    client.query(
      `SELECT
         oi.*,
         go.table_id,
         t.number AS table_number,
         mi.name AS menu_item_name,
         mi.category_id,
         mi.item_type,
         mi.is_bar,
         mi.is_kitchen,
         mi.price
       FROM guest_order_items oi
       JOIN guest_orders go ON go.id = oi.order_id
       JOIN "tables" t ON t.id = go.table_id
       JOIN menu_items mi ON mi.id = oi.menu_item_id
       WHERE go.guest_id = $1 AND go.status <> 'closed'
       ORDER BY oi.created_at DESC
       LIMIT 50`,
      [guestId],
    ),
    client.query(
      `SELECT *
       FROM guest_feedback_requests
       WHERE guest_id = $1
       ORDER BY requested_at DESC
       LIMIT 20`,
      [guestId],
    ),
    client.query(
      `SELECT *
       FROM guest_bonus_redemptions
       WHERE guest_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [guestId],
    ),
  ]);

  const guest = guestResult.rows[0];
  const orderItemModifiers = await loadOrderItemModifiers(client, orderItemsResult.rows.map((item) => item.id));
  return {
    ...(token ? { token } : {}),
    guest: publicGuest(guest),
    card: cardResult.rows[0] ?? null,
    transactions: transactionsResult.rows,
    referral: {
      code: guest?.referral_code ?? '',
      invited_count: referralsResult.rows[0]?.invited_count ?? 0,
      bonuses_earned: referralsResult.rows[0]?.bonuses_earned ?? 0,
    },
    notifications: notificationsResult.rows,
    current_table_session: activeSessionResult.rows[0] ?? null,
    current_order_items: attachOrderItemModifiers(orderItemsResult.rows, orderItemModifiers.rows),
    feedback_requests: feedbackRequestsResult.rows,
    bonus_redemptions: bonusRedemptionsResult.rows,
    offers: [
      { id: 'welcome', title: 'Персональное предложение', text: 'После регистрации на вашу карту начислены стартовые бонусы.' },
      { id: 'birthday', title: 'День рождения', text: 'Укажите день рождения, чтобы получать личные предложения.' },
    ],
  };
}

async function guestAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Войдите в гостевой профиль.' });
    return;
  }

  try {
    const payload = jwt.verify(token, guestJwtSecret);
    if (payload.type !== 'guest') {
      res.status(401).json({ error: 'Некорректный тип сессии.' });
      return;
    }
    const hash = tokenHash(token);
    const session = await query(
      `SELECT *
       FROM guest_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [hash],
    );
    if (!session.rows[0]) {
      res.status(401).json({ error: 'Сессия истекла, войдите снова.' });
      return;
    }
    const result = await query('SELECT * FROM guest_users WHERE id = $1 AND deleted_at IS NULL', [payload.sub]);
    const guest = result.rows[0];
    if (!guest) {
      res.status(404).json({ error: 'Гость не найден.' });
      return;
    }
    if (guest.status === 'blocked') {
      res.status(403).json({ error: 'Профиль временно недоступен. Обратитесь в ресторан.' });
      return;
    }
    await query('UPDATE guest_sessions SET last_seen_at = NOW() WHERE token_hash = $1', [hash]);
    req.guest = guest;
    req.guestToken = token;
    next();
  } catch (_error) {
    res.status(401).json({ error: 'Сессия истекла, войдите снова.' });
  }
}

async function optionalGuestAuthMiddleware(req, _res, next) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, guestJwtSecret);
    if (payload.type !== 'guest') {
      next();
      return;
    }
    const hash = tokenHash(token);
    const session = await query(
      `SELECT *
       FROM guest_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [hash],
    );
    if (!session.rows[0]) {
      next();
      return;
    }
    const result = await query('SELECT * FROM guest_users WHERE id = $1 AND deleted_at IS NULL', [payload.sub]);
    const guest = result.rows[0];
    if (guest && guest.status !== 'blocked') {
      await query('UPDATE guest_sessions SET last_seen_at = NOW() WHERE token_hash = $1', [hash]);
      req.guest = guest;
      req.guestToken = token;
    }
  } catch (_error) {
    // Public guest endpoints should still work when the optional token is stale.
  }
  next();
}

async function getReservationConflict(client, { table_id, date, time, excludeId }) {
  if (!table_id || !date || !time) return null;
  const result = await client.query(
    `SELECT id, guest_name, time, status
     FROM reservations
     WHERE table_id = $1
       AND date = $2
       AND status NOT IN ('cancelled', 'no_show', 'guests_left')`,
    [table_id, date],
  );

  const requestedMinutes = timeToMinutes(time);
  if (requestedMinutes === null) return null;

  return (
    result.rows.find((reservation) => {
      if (excludeId && reservation.id === excludeId) return false;
      const reservationMinutes = timeToMinutes(reservation.time);
      return reservationMinutes !== null && Math.abs(reservationMinutes - requestedMinutes) < 120;
    }) ?? null
  );
}

function compactMobileMenuItem(item) {
  return {
    id: item.id,
    name: item.name,
    category_id: item.category_id,
    price: item.price,
    composition: item.composition ?? '',
    description: item.description ?? '',
    weight: item.weight ?? '',
    cooking_time: item.cooking_time ?? '',
    item_type: item.item_type,
    is_bar: item.is_bar,
    is_kitchen: item.is_kitchen,
    spice_level: item.spice_level,
    popularity: item.popularity,
    status: item.status,
  };
}

function compactMobileNotification(item) {
  return {
    id: item.id,
    target_role: item.target_role,
    title: item.title,
    text: item.text,
    type: item.type,
    is_read: item.is_read,
    created_at: item.created_at,
    read_at: item.read_at,
  };
}

function compactMobileActivityLog(item) {
  return {
    id: item.id,
    user_id: item.user_id,
    action: item.action,
    entity_type: item.entity_type,
    entity_id: item.entity_id,
    created_at: item.created_at,
  };
}

function compactMobileUser(item) {
  return {
    id: item.id,
    name: item.name,
    role: item.role,
    position: item.position,
    status: item.status,
  };
}

function compactMobileStopListItem(item) {
  return {
    id: item.id,
    menu_item_id: item.menu_item_id,
    reason: item.reason,
    status: item.status,
    created_at: item.created_at,
    updated_at: item.updated_at,
    expected_return_at: item.expected_return_at,
    version: item.version,
  };
}

function compactMobileGuestClient(item) {
  return {
    id: item.id,
    name: item.name,
    phone: item.phone,
    birthday: item.birthday,
    bonus_balance: item.bonus_balance,
    loyalty_level: item.loyalty_level,
    referral_code: item.referral_code,
    visits_count: item.visits_count,
    status: item.status,
    created_at: item.created_at,
    updated_at: item.updated_at,
    version: item.version,
  };
}

function compactMobileTable(item) {
  return {
    id: item.id,
    floor_id: item.floor_id,
    number: item.number,
    seats: item.seats,
    x_position: item.x_position,
    y_position: item.y_position,
    width: item.width,
    height: item.height,
    shape: item.shape,
    status: item.status,
    current_waiter_id: item.current_waiter_id,
    updated_at: item.updated_at,
    version: item.version,
  };
}

function compactMobileOrderItem(item) {
  return {
    id: item.id,
    order_id: item.order_id,
    table_id: item.table_id,
    table_number: item.table_number,
    guest_id: item.guest_id,
    guest_name: item.guest_name,
    menu_item_id: item.menu_item_id,
    quantity: item.quantity,
    status: item.status,
    assigned_to: item.assigned_to,
    created_at: item.created_at,
    updated_at: item.updated_at,
    version: item.version,
  };
}

function compactMobileOrderItemModifier(item) {
  return {
    id: item.id,
    order_item_id: item.order_item_id,
    menu_item_modifier_id: item.menu_item_modifier_id,
    modifier_group_id: item.modifier_group_id,
    name: item.name,
    amount: item.amount,
    price: item.price,
  };
}

function compactMobileReservation(item) {
  return {
    id: item.id,
    guest_name: item.guest_name,
    date: item.date,
    time: item.time,
    guests_count: item.guests_count,
    table_id: item.table_id,
    status: item.status,
    updated_at: item.updated_at,
    version: item.version,
  };
}

function compactMobileWaitlistEntry(item) {
  return {
    id: item.id,
    guest_name: item.guest_name,
    guest_phone: item.guest_phone,
    guests_count: item.guests_count,
    desired_time: item.desired_time,
    status: item.status,
    comment: item.comment,
    call_status: item.call_status,
    call_comment: item.call_comment,
    seated_table_id: item.seated_table_id,
    created_by: item.created_by,
    created_at: item.created_at,
    updated_at: item.updated_at,
    version: item.version,
  };
}

function mobileSnapshotBytes(snapshot) {
  return Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
}

function trimMobileSnapshotToLimit(snapshot) {
  const candidates = [
    snapshot,
    { ...snapshot, chat_members: [], chats: [], chat_messages: [], message_reads: [] },
    { ...snapshot, floors: [], tables: [], reservations: [], waitlist_entries: [] },
    { ...snapshot, floors: [], tables: [], reservations: [], waitlist_entries: [], events: [], tasks: [], announcements: [], rules: [] },
    { ...snapshot, floors: [], tables: [], reservations: [], waitlist_entries: [], events: [], tasks: [], announcements: [], rules: [], users: [snapshot.current_user], stop_list: [] },
    { ...snapshot, floors: [], tables: [], reservations: [], waitlist_entries: [], events: [], tasks: [], announcements: [], rules: [], users: [snapshot.current_user], stop_list: [], menu_items: snapshot.menu_items.slice(0, 80) },
    { ...snapshot, floors: [], tables: [], reservations: [], waitlist_entries: [], events: [], tasks: [], announcements: [], rules: [], users: [snapshot.current_user], stop_list: [], menu_items: snapshot.menu_items.slice(0, 40), menu_item_modifiers: [] },
    { ...snapshot, floors: [], tables: [], reservations: [], waitlist_entries: [], events: [], tasks: [], announcements: [], rules: [], users: [snapshot.current_user], stop_list: [], menu_items: snapshot.menu_items.slice(0, 20), menu_item_modifier_groups: [], menu_item_modifiers: [] },
    { ...snapshot, floors: [], tables: [], reservations: [], waitlist_entries: [], events: [], tasks: [], announcements: [], rules: [], users: [snapshot.current_user], stop_list: [], menu_items: snapshot.menu_items.slice(0, 10), menu_item_modifier_groups: [], menu_item_modifiers: [], guest_order_item_modifiers: [], notifications: snapshot.notifications.slice(0, 10) },
    { ...snapshot, floors: [], tables: [], reservations: [], waitlist_entries: [], events: [], tasks: [], announcements: [], rules: [], users: [snapshot.current_user], stop_list: [], menu_items: snapshot.menu_items.slice(0, 5), menu_item_modifier_groups: [], menu_item_modifiers: [], guest_order_item_modifiers: [], notifications: snapshot.notifications.slice(0, 5) },
  ];
  return candidates.find((candidate) => mobileSnapshotBytes(candidate) <= MOBILE_SYNC_MAX_BYTES) ?? candidates[candidates.length - 1];
}

function compactMobileSnapshot(snapshot) {
  const chatMessages = Array.isArray(snapshot.chat_messages) ? snapshot.chat_messages.slice(-MOBILE_SYNC_CHAT_MESSAGE_LIMIT) : [];
  const chatMessageIds = new Set(chatMessages.map((message) => message.id));

  return trimMobileSnapshotToLimit({
    server_time: snapshot.server_time,
    server_status: snapshot.server_status,
    connection: snapshot.connection,
    push_status: snapshot.push_status ? { active_devices: snapshot.push_status.active_devices, devices: [] } : undefined,
    shift_brief: snapshot.shift_brief,
    restaurant: snapshot.restaurant,
    current_user: snapshot.current_user,
    permissions: snapshot.permissions,
    sections: snapshot.sections,
    roles: [],
    users: Array.isArray(snapshot.users) ? snapshot.users.map(compactMobileUser) : [],
    shifts: [],
    menu_categories: snapshot.menu_categories,
    menu_items: Array.isArray(snapshot.menu_items)
      ? snapshot.menu_items.map(compactMobileMenuItem)
      : [],
    menu_item_modifier_groups: snapshot.menu_item_modifier_groups ?? [],
    menu_item_modifiers: snapshot.menu_item_modifiers ?? [],
    notebook_notes: snapshot.notebook_notes,
    stop_list: Array.isArray(snapshot.stop_list) ? snapshot.stop_list.map(compactMobileStopListItem) : [],
    floors: snapshot.floors,
    tables: Array.isArray(snapshot.tables) ? snapshot.tables.map(compactMobileTable) : [],
    reservations: Array.isArray(snapshot.reservations) ? snapshot.reservations.slice(0, 20).map(compactMobileReservation) : [],
    events: Array.isArray(snapshot.events) ? snapshot.events.slice(0, 10) : [],
    announcements: Array.isArray(snapshot.announcements) ? snapshot.announcements.slice(0, 10) : [],
    rules: [],
    tasks: Array.isArray(snapshot.tasks) ? snapshot.tasks.slice(0, 10) : [],
    chats: Array.isArray(snapshot.chats) ? snapshot.chats.slice(0, 10) : [],
    chat_members: snapshot.chat_members,
    chat_messages: chatMessages,
    message_reads: Array.isArray(snapshot.message_reads)
      ? snapshot.message_reads.filter((read) => chatMessageIds.has(read.message_id))
      : [],
    notifications: Array.isArray(snapshot.notifications)
      ? snapshot.notifications.slice(0, MOBILE_SYNC_NOTIFICATION_LIMIT).map(compactMobileNotification)
      : [],
    activity_log: Array.isArray(snapshot.activity_log)
      ? snapshot.activity_log.slice(0, MOBILE_SYNC_ACTIVITY_LOG_LIMIT).map(compactMobileActivityLog)
      : [],
    waitlist_entries: Array.isArray(snapshot.waitlist_entries) ? snapshot.waitlist_entries.slice(0, 20).map(compactMobileWaitlistEntry) : [],
    guest_notes: [],
    guest_clients: Array.isArray(snapshot.guest_clients) ? snapshot.guest_clients.slice(0, 40).map(compactMobileGuestClient) : [],
    guest_client_transactions: Array.isArray(snapshot.guest_client_transactions)
      ? snapshot.guest_client_transactions.slice(0, MOBILE_SYNC_GUEST_TRANSACTION_LIMIT)
      : [],
    guest_bonus_redemptions: Array.isArray(snapshot.guest_bonus_redemptions)
      ? snapshot.guest_bonus_redemptions.slice(0, MOBILE_SYNC_GUEST_TRANSACTION_LIMIT)
      : [],
    iiko_external_orders: Array.isArray(snapshot.iiko_external_orders)
      ? snapshot.iiko_external_orders.slice(0, MOBILE_SYNC_GUEST_TRANSACTION_LIMIT)
      : [],
    shift_checklist: snapshot.shift_checklist,
    supply_requests: snapshot.supply_requests,
    guest_orders: Array.isArray(snapshot.guest_orders) ? snapshot.guest_orders.slice(0, 40) : [],
    guest_order_items: Array.isArray(snapshot.guest_order_items) ? snapshot.guest_order_items.slice(0, 80).map(compactMobileOrderItem) : [],
    guest_order_item_modifiers: Array.isArray(snapshot.guest_order_item_modifiers)
      ? snapshot.guest_order_item_modifiers.slice(0, 160).map(compactMobileOrderItemModifier)
      : [],
    social_posts: Array.isArray(snapshot.social_posts) ? snapshot.social_posts.slice(0, 30) : [],
    social_post_media: Array.isArray(snapshot.social_post_media) ? snapshot.social_post_media.slice(0, 80) : [],
    social_post_comments: Array.isArray(snapshot.social_post_comments) ? snapshot.social_post_comments.slice(0, 80) : [],
    hall_signals: snapshot.hall_signals ?? [],
    table_guest_sessions: snapshot.table_guest_sessions ?? [],
    menu_restored_alerts: snapshot.menu_restored_alerts ?? [],
    guest_segments: [],
  });
}

async function getSnapshot(user, options = {}) {
  const client = await pool.connect();
  try {
    const groups = targetGroupsForRole(user.role);
    const chatResult = await client.query(
      `SELECT DISTINCT c.*
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = $1
       ORDER BY c.created_at ASC`,
      [user.id],
    );
    const chatIds = chatResult.rows.map((chat) => chat.id);
    const chatMessages =
      chatIds.length > 0
        ? (
            await client.query(
              `SELECT *
               FROM chat_messages
               WHERE chat_id = ANY($1::text[])
                 AND deleted_at IS NULL
               ORDER BY created_at DESC
               LIMIT 120`,
              [chatIds],
            )
          ).rows.reverse()
        : [];

    const canSeeSchedule = canSeeAllSchedule(user.role);
    const canSeeMenu = can(user.role, 'view:menu');
    const canSeeStopList = can(user.role, 'view:stoplist');
    const canSeeMenuItems = canSeeMenu || canSeeStopList;
    const canSeeEvents = can(user.role, 'view:events');
    const canSeeTasks = can(user.role, 'view:tasks');
    const barCondition = barMenuSqlCondition('mi', 'mc');
    const menuCategoriesQuery =
      !canSeeMenuItems
        ? Promise.resolve({ rows: [] })
        : user.role === 'bar'
          ? client.query(
              `SELECT DISTINCT mc.*
               FROM menu_categories mc
               JOIN menu_items mi ON mi.category_id = mc.id
               WHERE ${barCondition}
               ORDER BY mc.sort_order ASC`,
            )
          : client.query('SELECT * FROM menu_categories ORDER BY sort_order ASC');
    const menuItemsQuery =
      !canSeeMenuItems
        ? Promise.resolve({ rows: [] })
        : user.role === 'bar'
          ? client.query(
              `SELECT mi.*
               FROM menu_items mi
               JOIN menu_categories mc ON mc.id = mi.category_id
               WHERE ${barCondition}
               ORDER BY mi.popularity DESC, mi.name ASC`,
            )
          : client.query('SELECT * FROM menu_items ORDER BY popularity DESC, name ASC');
    const stopListQuery =
      !canSeeStopList
        ? Promise.resolve({ rows: [] })
        : user.role === 'bar'
          ? client.query(
              `SELECT sl.*
               FROM stop_list sl
               JOIN menu_items mi ON mi.id = sl.menu_item_id
               JOIN menu_categories mc ON mc.id = mi.category_id
               WHERE ${barCondition}
               ORDER BY sl.created_at DESC`,
            )
          : user.role === 'cook'
            ? client.query(
                `SELECT sl.*
                 FROM stop_list sl
                 JOIN menu_items mi ON mi.id = sl.menu_item_id
                 WHERE mi.is_kitchen = TRUE
                 ORDER BY sl.created_at DESC`,
              )
            : client.query('SELECT * FROM stop_list ORDER BY created_at DESC');
    const shifts = canSeeSchedule
      ? (await client.query('SELECT * FROM shifts ORDER BY date ASC, start_time ASC')).rows
      : (
          await client.query(
            `SELECT *
             FROM shifts
             WHERE user_id = $1 OR date = CURRENT_DATE
             ORDER BY date ASC, start_time ASC`,
            [user.id],
          )
        ).rows;

    const tables = can(user.role, 'view:floor')
      ? (await client.query('SELECT * FROM "tables" ORDER BY floor_id, number::int ASC')).rows
      : can(user.role, 'view:my_tables')
        ? (await client.query('SELECT * FROM "tables" WHERE current_waiter_id = $1 ORDER BY number::int ASC', [user.id])).rows
        : [];

    const reservations = can(user.role, 'view:reservations')
      ? (
          await client.query(
            `SELECT * FROM reservations
             WHERE date >= CURRENT_DATE - INTERVAL '120 days'
             ORDER BY date ASC, time ASC`,
          )
        ).rows
      : can(user.role, 'view:my_tables')
        ? (
            await client.query(
              `SELECT r.*
               FROM reservations r
               JOIN "tables" t ON t.id = r.table_id
               WHERE t.current_waiter_id = $1
               ORDER BY r.date ASC, r.time ASC`,
              [user.id],
            )
          ).rows
        : [];

    const tasks = canManageAllTasks(user.role)
      ? (await client.query('SELECT * FROM tasks ORDER BY due_date ASC')).rows
      : canSeeTasks
        ? (
          await client.query(
            `SELECT *
             FROM tasks
             WHERE assigned_to = $1 OR assigned_to IS NULL
             ORDER BY due_date ASC`,
            [user.id],
          )
        ).rows
        : [];

    const [
      roles,
      users,
      menuCategories,
      menuItems,
      notebookNotes,
      stopList,
      floors,
      events,
      announcements,
      rules,
      chatMembers,
      messageReads,
      activityLog,
      notifications,
      waitlistEntries,
      guestNotes,
      shiftChecklist,
      supplyRequests,
    ] = await Promise.all([
      canManageStaff(user.role) ? client.query('SELECT * FROM roles ORDER BY name ASC') : Promise.resolve({ rows: [] }),
      user.role === 'pending'
        ? client.query(
            `SELECT id, name, phone, login, role, position, status, photo_url, comment, created_at, updated_at, version
             FROM users
             WHERE id = $1`,
            [user.id],
          )
        : client.query(
            `SELECT id, name, phone, login, role, position, status, photo_url, comment, created_at, updated_at, version
             FROM users
             ORDER BY position ASC, name ASC`,
          ),
      menuCategoriesQuery,
      menuItemsQuery,
      client.query('SELECT * FROM notebook_notes WHERE user_id = $1 ORDER BY updated_at DESC', [user.id]),
      stopListQuery,
      client.query('SELECT * FROM floors ORDER BY sort_order ASC'),
      canSeeEvents ? client.query('SELECT * FROM events ORDER BY date ASC, time ASC') : Promise.resolve({ rows: [] }),
      client.query(
        `SELECT *
         FROM announcements
         WHERE target_role = ANY($1::text[])
         ORDER BY created_at DESC`,
        [groups],
      ),
      client.query('SELECT * FROM rules ORDER BY category ASC, title ASC'),
      chatIds.length > 0
        ? client.query('SELECT * FROM chat_members WHERE chat_id = ANY($1::text[])', [chatIds])
        : Promise.resolve({ rows: [] }),
      chatMessages.length > 0
        ? client.query('SELECT * FROM message_reads WHERE message_id = ANY($1::text[])', [chatMessages.map((message) => message.id)])
        : Promise.resolve({ rows: [] }),
      canViewActivityLog(user.role)
        ? client.query('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 80')
        : client.query('SELECT * FROM activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [user.id]),
      client.query(
        `SELECT *
         FROM notifications
         WHERE user_id = $1 OR target_role = ANY($2::text[])
         ORDER BY created_at DESC
         LIMIT 80`,
        [user.id, groups],
      ),
      can(user.role, 'view:reservations')
        ? client.query('SELECT * FROM waitlist_entries ORDER BY created_at DESC LIMIT 80')
        : Promise.resolve({ rows: [] }),
      user.role === 'pending' || (!can(user.role, 'view:reservations') && !canManageGuestClients(user.role))
        ? Promise.resolve({ rows: [] })
        : client.query('SELECT * FROM guest_notes ORDER BY updated_at DESC LIMIT 80'),
      client.query(
        `SELECT *
         FROM shift_checklist_items
         WHERE date = $2
           AND target_role = ANY($1::text[])
         ORDER BY sort_order ASC, created_at ASC`,
        [groups, serverDate()],
      ),
      !canUseSupplyRequests(user.role)
        ? Promise.resolve({ rows: [] })
        : client.query(
            `SELECT *
             FROM supply_requests
             WHERE requested_by = $1 OR target_role = ANY($2::text[])
             ORDER BY
               CASE status WHEN 'new' THEN 0 WHEN 'ordered' THEN 1 WHEN 'received' THEN 2 ELSE 3 END,
               created_at DESC
             LIMIT 80`,
            [user.id, groups],
      ),
    ]);

    const [guestClients, guestClientTransactions, guestBonusRedemptions, iikoExternalOrders] = canManageGuestClients(user.role)
      ? await Promise.all([
           client.query(
             `SELECT
                gu.id, gu.name, gu.phone, gu.birthday, gu.bonus_balance, gu.lifetime_bonus_earned, gu.lifetime_bonus_spent,
                gu.loyalty_level, gu.referral_code, gu.referred_by, gu.visits_count, gu.total_spent, gu.average_check,
                gu.last_visit_at, gu.favorite_category, gu.status, gu.marketing_consent, gu.personal_data_consent,
                gu.created_at, gu.updated_at, gu.version,
                gc.card_number,
                ref.name AS referrer_name,
                COALESCE(invited.invited_count, 0)::int AS invited_count
              FROM guest_users gu
              LEFT JOIN guest_cards gc ON gc.guest_id = gu.id AND gc.status = 'active'
              LEFT JOIN guest_users ref ON ref.id = gu.referred_by
              LEFT JOIN (
                SELECT referrer_guest_id, COUNT(*)::int AS invited_count
                FROM guest_referrals
                GROUP BY referrer_guest_id
              ) invited ON invited.referrer_guest_id = gu.id
              WHERE gu.deleted_at IS NULL
              ORDER BY gu.updated_at DESC, gu.created_at DESC
              LIMIT 100`,
          ),
          client.query('SELECT * FROM guest_bonus_transactions ORDER BY created_at DESC LIMIT 200'),
          client.query('SELECT * FROM guest_bonus_redemptions ORDER BY created_at DESC LIMIT 200'),
          client.query('SELECT * FROM iiko_external_orders ORDER BY updated_at DESC LIMIT 200'),
        ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];

    const menuItemIds = menuItems.rows.map((item) => item.id);
    const menuModifierGroups = menuItemIds.length > 0
      ? await client.query(
          `SELECT *
           FROM menu_item_modifier_groups
           WHERE menu_item_id = ANY($1::text[])
           ORDER BY menu_item_id, sort_order ASC, name ASC`,
          [menuItemIds],
        )
      : { rows: [] };
    const menuModifierGroupIds = menuModifierGroups.rows.map((group) => group.id);
    const menuModifiers = menuModifierGroupIds.length > 0
      ? await client.query(
          `SELECT *
           FROM menu_item_modifiers
           WHERE modifier_group_id = ANY($1::text[])
           ORDER BY modifier_group_id, sort_order ASC, name ASC`,
          [menuModifierGroupIds],
        )
      : { rows: [] };

    const canSeeGuestOrders = ['technician', 'manager', 'administrator', 'waiter', 'chef', 'cook', 'bar'].includes(user.role);
    const orderItemWhere = [];
    const orderItemParams = [];
    if (user.role === 'waiter') {
      orderItemParams.push(user.id);
      orderItemWhere.push(`t.current_waiter_id = $${orderItemParams.length}`);
    } else if (user.role === 'chef') {
      orderItemWhere.push('mi.is_kitchen = TRUE');
    } else if (user.role === 'cook') {
      orderItemParams.push(user.id);
      orderItemWhere.push(`mi.is_kitchen = TRUE AND (oi.assigned_to IS NULL OR oi.assigned_to = $${orderItemParams.length})`);
    } else if (user.role === 'bar') {
      orderItemWhere.push(barMenuSqlCondition('mi', 'mc'));
    }
    const orderItems = canSeeGuestOrders
      ? await client.query(
          `SELECT
             oi.*,
             go.table_id,
             t.number AS table_number,
             go.guest_id,
             gu.name AS guest_name,
             mi.name AS menu_item_name,
             mi.category_id,
             mi.item_type,
             mi.is_bar,
             mi.is_kitchen
           FROM guest_order_items oi
           JOIN guest_orders go ON go.id = oi.order_id
           JOIN "tables" t ON t.id = go.table_id
           JOIN guest_users gu ON gu.id = go.guest_id
           JOIN menu_items mi ON mi.id = oi.menu_item_id
           JOIN menu_categories mc ON mc.id = mi.category_id
           ${orderItemWhere.length ? `WHERE ${orderItemWhere.join(' AND ')}` : ''}
           ORDER BY
             CASE oi.status WHEN 'ordered' THEN 0 WHEN 'accepted' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'done' THEN 3 WHEN 'served' THEN 4 ELSE 5 END,
             oi.created_at ASC
           LIMIT 120`,
          orderItemParams,
        )
      : { rows: [] };
    const guestOrders = canSeeGuestOrders
      ? await client.query(
          `SELECT go.*, t.number AS table_number, gu.name AS guest_name
           FROM guest_orders go
           JOIN "tables" t ON t.id = go.table_id
           JOIN guest_users gu ON gu.id = go.guest_id
           WHERE go.id = ANY($1::text[])
           ORDER BY go.created_at DESC`,
          [[...new Set(orderItems.rows.map((item) => item.order_id))]],
      )
      : { rows: [] };
    const guestOrderItemModifiers = canSeeGuestOrders
      ? await loadOrderItemModifiers(client, orderItems.rows.map((item) => item.id))
      : { rows: [] };

    const canSeeSmm = can(user.role, 'view:smm');
    const [socialPosts, socialPostMedia, socialPostComments] = canSeeSmm
      ? await Promise.all([
          client.query('SELECT * FROM social_posts ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC LIMIT 100'),
          client.query(
            `SELECT spm.*
             FROM social_post_media spm
             JOIN social_posts sp ON sp.id = spm.post_id
             ORDER BY COALESCE(sp.published_at, sp.created_at) DESC, spm.sort_order ASC
             LIMIT 200`,
          ),
          client.query(
            `SELECT c.*, gu.name AS guest_name
             FROM social_post_comments c
             JOIN guest_users gu ON gu.id = c.guest_id
             ORDER BY c.created_at DESC
             LIMIT 200`,
          ),
        ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }];

    const pushDevices = await client.query(
      `SELECT id, platform, app_version, device_name, is_active, last_seen_at, created_at, updated_at, revoked_at
       FROM push_devices
       WHERE user_type = 'staff' AND user_id = $1
       ORDER BY updated_at DESC`,
      [user.id],
    );

    const shiftBrief = buildOperationalSummary({
      user,
      users: users.rows,
      tables,
      reservations,
      events: events.rows,
      tasks,
      stopList: stopList.rows,
      notifications: notifications.rows,
    });

    const snapshot = {
      server_time: new Date().toISOString(),
      server_status: serverStatus(),
      connection: {
        api_url: publicServerUrl(),
        websocket_url: websocketUrlForApi(),
        push_provider: 'expo',
        push_disabled: process.env.DISABLE_PUSH === '1',
      },
      push_status: {
        devices: pushDevices.rows,
        active_devices: pushDevices.rows.filter((device) => device.is_active && !device.revoked_at).length,
      },
      shift_brief: shiftBrief,
      restaurant: {
        name: 'Горы',
        app_name: 'Горы',
        concept:
          'Кавказская кухня в тёплой атмосфере, живая музыка, банкеты и семейные вечера.',
        address: 'Иваново, Советская 36а',
        hours: 'Ежедневно 12:00-00:00, пятница и суббота до 02:00',
        seats: 150,
        features: ['2 этажа', 'Живая музыка', 'Банкеты', 'Кавказская кухня', 'Тёплая атмосфера'],
        contacts: ['Телефон: +7 900 100-10-01', 'Бронирование: +7 900 100-10-02', 'Кухня: внутр. 21', 'Бар: внутр. 31'],
      },
      current_user: sanitizeUser(user),
      permissions: permissionsFor(user.role),
      sections: sectionsForRole(user.role),
      roles: roles.rows,
      users: users.rows,
      shifts,
      menu_categories: menuCategories.rows,
      menu_items: menuItems.rows,
      menu_item_modifier_groups: menuModifierGroups.rows,
      menu_item_modifiers: menuModifiers.rows,
      notebook_notes: notebookNotes.rows,
      stop_list: stopList.rows,
      floors: floors.rows,
      tables,
      reservations,
      events: events.rows,
      announcements: announcements.rows,
      rules: rules.rows,
      tasks,
      chats: chatResult.rows,
      chat_members: chatMembers.rows,
      chat_messages: chatMessages,
      message_reads: messageReads.rows,
      activity_log: activityLog.rows,
      notifications: notifications.rows,
      waitlist_entries: waitlistEntries.rows,
      guest_notes: guestNotes.rows,
      guest_clients: guestClients.rows.map(publicGuest),
      guest_client_transactions: guestClientTransactions.rows,
      guest_bonus_redemptions: guestBonusRedemptions.rows,
      iiko_external_orders: iikoExternalOrders.rows,
      shift_checklist: shiftChecklist.rows,
      supply_requests: supplyRequests.rows,
      guest_orders: guestOrders.rows,
      guest_order_items: attachOrderItemModifiers(orderItems.rows, guestOrderItemModifiers.rows),
      guest_order_item_modifiers: guestOrderItemModifiers.rows,
      social_posts: socialPosts.rows,
      social_post_media: socialPostMedia.rows,
      social_post_comments: socialPostComments.rows,
      hall_signals: coordinationApi ? await coordinationApi.loadHallSignals(client) : [],
      table_guest_sessions: coordinationApi ? await coordinationApi.loadTableGuestSessions(client) : [],
      menu_restored_alerts: coordinationApi ? await coordinationApi.loadMenuRestoredAlerts(client, user.id) : [],
      guest_segments: canManageGuestClients(user.role)
        ? (await client.query('SELECT * FROM guest_segments ORDER BY created_at DESC')).rows
        : [],
    };
    return options.mobile ? compactMobileSnapshot(snapshot) : snapshot;
  } finally {
    client.release();
  }
}

const routeDeps = {
  pool,
  query,
  cache,
  asyncHandler,
  authMiddleware,
  guestAuthMiddleware,
  optionalGuestAuthMiddleware,
  requirePermission,
  requireManager: requireStaffManagement,
  randomUUID,
  emitChange,
  logActivity,
  createRoleNotifications,
  createNotification,
  createGuestNotification,
  notifyStopListChange,
  addGuestBonusTransaction,
  httpError,
  rowById,
  getReservationConflict,
  reservationPushText,
  normalizeBirthday,
  loyaltyLevelLabels,
  publicGuest,
  isBarMenuItem,
  barMenuSqlCondition,
  serverDate,
  bcrypt,
  jwt,
  jwtSecret,
  loginRateLimiter,
  realClientIp,
  sanitizeUser,
  isLoginBlocked,
  permissionsFor,
  sectionsForRole,
  roleDefinitions,
  targetGroupsForRole,
  can,
  canManageStaff,
  canManageRestaurant,
  canManageGuestClients,
  canManageAllTasks,
  canSeeAllSchedule,
  canViewActivityLog,
  canManageFloorLayout,
  normalizeGuestPhone,
  normalizeReferralCode,
  generateUniqueReferralCode,
  generateUniqueCardNumber,
  issueGuestSession,
  buildGuestPayload,
  registerPushDevice,
  activePushDevicesForUsers,
  sendPushToDevices,
  publicServerUrl,
  websocketUrlForApi,
  serverStatus,
  getSnapshot,
  buildShiftCloseSummary,
  currentShiftForUser,
  canUseSupplyRequests,
  buildPeakHours,
  normalizeAnalyticsCounters,
  addUserToRoleChats,
  sendChatPush,
  io,
  getCoordinationApi: () => coordinationApi,
  iikoStaffScheduler: () => app.locals.iikoStaffScheduler,
  syncGuestOrderToIiko,
  syncOpenIikoOrderStatuses,
  createTwilioClient,
};

coordinationApi = registerCoordinationRoutes(app, routeDeps);
registerAllRoutes(app, routeDeps);

function eventStartDate(event) {
  const date = rowDate(event.date);
  const time = rowTime(event.time) || '00:00';
  return new Date(`${date}T${time}:00+03:00`);
}

async function sendUpcomingEventNotifications() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT *
       FROM events
       WHERE date >= CURRENT_DATE
         AND date < CURRENT_DATE + INTERVAL '2 days'
         AND status NOT IN ('completed', 'cancelled', 'done', 'finished')`,
    );

    const now = new Date();
    const horizon = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    for (const event of result.rows) {
      const startsAt = eventStartDate(event);
      if (startsAt <= now || startsAt > horizon) continue;

      const alreadySent = await client.query(
        `SELECT id
         FROM activity_log
         WHERE action = $1 AND entity_type = $2 AND entity_id = $3
         LIMIT 1`,
        ['push.event_soon', 'event', event.id],
      );
      if (alreadySent.rows[0]) continue;

      await createRoleNotifications(client, ['hostess', 'waiter', 'kitchen', 'bar', 'management'], {
        title: 'Скоро банкет / мероприятие',
        text: `${event.title}, ${event.guests_count} гостей, ${rowTime(event.time)}`,
        type: 'event_soon',
        data: { event_id: event.id },
      });
      await logActivity(client, null, 'push.event_soon', 'event', event.id, null, { starts_at: startsAt.toISOString() });
    }
  } catch (error) {
    console.warn('Upcoming event push check failed:', error.message);
  } finally {
    client.release();
  }
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      next(new Error('Auth required'));
      return;
    }
    const payload = jwt.verify(token, jwtSecret);
    const result = await query('SELECT id, role FROM users WHERE id = $1', [payload.sub]);
    const user = result.rows[0];
    if (!user) {
      next(new Error('User not found'));
      return;
    }
    socket.user = user;
    next();
  } catch (error) {
    next(error);
  }
});

io.on('connection', async (socket) => {
  socket.join(`user:${socket.user.id}`);
  const chats = await query('SELECT chat_id FROM chat_members WHERE user_id = $1', [socket.user.id]);
  chats.rows.forEach((row) => socket.join(row.chat_id));
});

app.use((error, _req, res, _next) => {
  const status = Number(error.status ?? 500);
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: status >= 500 ? 'Ошибка сервера во время выполнения запроса.' : error.message,
    detail: status >= 500 && process.env.NODE_ENV !== 'production' ? error.message : undefined,
  });
});

async function bootstrap() {
  await initDatabase();
  const tablesWithoutQr = await query('SELECT id, number FROM "tables" WHERE checkin_token IS NULL OR checkin_token = \'\'');
  for (const table of tablesWithoutQr.rows) {
    const tokenNumber = /^\d+$/.test(String(table.number)) ? String(table.number).padStart(2, '0') : String(table.number).toUpperCase();
    await query('UPDATE "tables" SET checkin_token = $2 WHERE id = $1', [table.id, `GORY${tokenNumber}`]);
  }

  if (process.argv.includes('--init-only')) {
    console.log('Database initialized and seeded.');
    await pool.end();
    return;
  }

  server.listen(port, host, () => {
    console.log(`Горы API is running on http://${host}:${port}`);
    const iikoOrderStatusScheduler = startIikoOrderStatusSyncScheduler({
      db: pool,
      env: process.env,
      randomUUID,
      logger: console,
    });
    if (iikoOrderStatusScheduler.enabled) {
      console.log(`iiko order status sync runs every ${Math.round(iikoOrderStatusScheduler.intervalMs / 1000)} seconds.`);
    }

    // Запуск планировщика синхронизации персонала
    const iikoStaffScheduler = startIikoStaffSyncScheduler({
      db: pool,
      env: process.env,
      randomUUID,
      logger: console,
    });
    if (iikoStaffScheduler.enabled) {
      console.log(`iiko staff sync runs every ${Math.round(iikoStaffScheduler.intervalMs / 1000)} seconds.`);

      // Опционально: синхронизация при старте
      const syncOnStartup = String(process.env.IIKO_STAFF_SYNC_ON_STARTUP ?? 'true').toLowerCase() === 'true';
      if (syncOnStartup) {
        // Запускаем через 5 секунд после старта сервера
        setTimeout(() => {
          iikoStaffScheduler.runNow({ triggerType: 'startup' }).catch((error) => {
            console.error('iiko staff sync on startup failed:', error);
          });
        }, 5000);
      }
    }

    // Сохраняем ссылку на планировщик для использования в роутах
    app.locals.iikoStaffScheduler = iikoStaffScheduler;

    const guestMarketingPushScheduler = startGuestMarketingPushScheduler({
      pool,
      createGuestNotification,
      logActivity,
      env: process.env,
      logger: console,
    });
    if (guestMarketingPushScheduler.enabled) {
      console.log(`guest marketing push runs every ${Math.round(guestMarketingPushScheduler.intervalMs / 1000)} seconds.`);
    }

    // Запускаем сервис автоматических напоминаний о бронях
    const reservationReminderService = new ReservationReminderService(pool, randomUUID);
    const reminderIntervalMs = Number(process.env.RESERVATION_REMINDER_CHECK_INTERVAL_MS ?? 60000);
    reservationReminderService.start(reminderIntervalMs);
    console.log(`Reservation reminder service runs every ${Math.round(reminderIntervalMs / 1000)} seconds.`);

    void sendUpcomingEventNotifications();
    if (pushReminderIntervalMs > 0) {
      const reminderTimer = setInterval(() => {
        void sendUpcomingEventNotifications();
      }, pushReminderIntervalMs);
      reminderTimer.unref?.();
    }
  });
}

bootstrap().catch(async (error) => {
  console.error('Failed to start Горы API');
  console.error(error);
  await pool.end();
  process.exit(1);
});
