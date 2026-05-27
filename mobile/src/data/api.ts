import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { io } from 'socket.io-client';

import { BUILD_API_URL } from './buildConfig';
import { resolveReachableConnection } from './connectionRecovery';
import { createRealtimeSyncScheduler, runExclusiveSnapshot } from './syncCoordinator';
import type { ApiSession, DataSnapshot, GuestProfilePayload } from '../types';

const SESSION_KEY = 'gory_staff_session';
const GUEST_SESSION_KEY = 'gory_guest_session';
const GUEST_PROFILE_CACHE_KEY = 'gory_guest_profile_cache';
const GUEST_MENU_CACHE_KEY = 'gory_guest_menu_cache';
const STAFF_SYNC_KEY = 'gory_staff_last_sync_at';
const GUEST_PROFILE_SYNC_KEY = 'gory_guest_profile_last_sync_at';
const GUEST_MENU_SYNC_KEY = 'gory_guest_menu_last_sync_at';
const LAST_CONNECTION_KEY = 'gory_last_successful_connection_at';
const LAST_ACTIVE_MODE_KEY = 'gory_last_active_mode';
const DEVICE_ID_KEY = 'gory_device_id';
const PUSH_STATUS_KEY = 'gory_push_status';
const API_URL_KEY = 'gory_staff_api_url';
const OFFLINE_QUEUE_KEY = 'gory_staff_offline_queue';
const REQUEST_TIMEOUT_MS = 30000;
const DISCOVERY_TIMEOUT_MS = 900;
const PRIORITY_DISCOVERY_TIMEOUT_MS = 10000;
const NETWORK_RETRY_COUNT = 3;
const PUBLIC_API_URL = 'https://app.gory-staff.ru';
const ANDROID_EMULATOR_API_URL = 'http://10.0.2.2:4000';
const DEFAULT_API_URL = PUBLIC_API_URL;
const CONFIGURED_API_URL = process.env.EXPO_PUBLIC_API_URL?.trim() || BUILD_API_URL.trim();
const CONFIGURED_FALLBACK_API_URLS = String(process.env.EXPO_PUBLIC_FALLBACK_API_URLS ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const EXPO_PROJECT_ID = '2b8e0320-5b79-46fc-be0a-5dcea8d90e8f';

export type OfflineQueueItem = {
  id: string;
  action_type: string;
  user_type: 'staff';
  user_id: string;
  method: string;
  path: string;
  body?: unknown;
  payload?: unknown;
  created_at: string;
  createdAt: string;
  retry_count: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'cancelled';
  last_error: string | null;
  server_result?: unknown;
  object_id: string | null;
  object_type: string | null;
  previous_updated_at: string | null;
  base_version: number | null;
  priority: number;
};

export type OfflineQueueStatus = {
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  conflict: number;
  lastError: string | null;
  items: OfflineQueueItem[];
};

export type PushPermissionSnapshot = {
  permission: string;
  canAskAgain?: boolean;
  token: string | null;
  deviceId: string | null;
  deviceName: string | null;
  networkType: string;
  isInternetReachable: boolean | null;
  error: string | null;
};

export type GuestSession = {
  apiUrl: string;
  token: string;
  profile?: GuestProfilePayload;
};

export type GuestMenuPayload = {
  categories: Array<{ id: string; name: string; sort_order?: number }>;
  items: Array<{
    id: string;
    name: string;
    category_id: string;
    category_name: string;
    price: number;
    photo_url?: string | null;
    composition?: string | null;
    description?: string | null;
    popularity?: number | null;
    is_available?: boolean;
    guest_status_text?: string | null;
  }>;
};

export type ServerConnectionStatus = {
  online: boolean;
  apiUrl: string;
  websocketUrl: string;
  checkedAt: string;
  networkType: string;
  isInternetReachable: boolean | null;
  error: string | null;
};

export type CacheInfo = {
  staffLastSyncAt: string | null;
  guestProfileLastSyncAt: string | null;
  guestMenuLastSyncAt: string | null;
  lastSuccessfulConnectionAt: string | null;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function actionTypeForMutation(method: string, path: string) {
  const normalizedMethod = method.toUpperCase();
  if (path.startsWith('/tables/')) return 'table_status';
  if (path.startsWith('/reservations')) return normalizedMethod === 'POST' ? 'reservation_create' : 'reservation_update';
  if (path.startsWith('/stop-list')) return normalizedMethod === 'POST' ? 'stop_list_add' : 'stop_list_update';
  if (path.startsWith('/tasks/')) return 'task_update';
  if (path.startsWith('/notebook')) return normalizedMethod === 'POST' ? 'notebook_create' : 'notebook_update';
  if (path.startsWith('/waitlist')) return normalizedMethod === 'POST' ? 'waitlist_create' : 'waitlist_update';
  return `${normalizedMethod.toLowerCase()}_${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`;
}

function objectInfoForMutation(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return { object_type: parts[0] ?? null, object_id: null };
  return { object_type: parts[0], object_id: parts[1] };
}

function versionedMutationTarget(method: string, path: string): { collection: keyof DataSnapshot; id: string } | null {
  const normalizedMethod = method.toUpperCase();
  const match = (pattern: RegExp) => path.match(pattern)?.[1] ?? null;
  if (normalizedMethod === 'PATCH') {
    const tableId = match(/^\/tables\/([^/]+)$/);
    if (tableId) return { collection: 'tables', id: tableId };
    const reservationId = match(/^\/reservations\/([^/]+)$/);
    if (reservationId) return { collection: 'reservations', id: reservationId };
    const stopListId = match(/^\/stop-list\/([^/]+)$/);
    if (stopListId) return { collection: 'stop_list', id: stopListId };
    const taskId = match(/^\/tasks\/([^/]+)$/);
    if (taskId) return { collection: 'tasks', id: taskId };
    const noteId = match(/^\/notebook\/([^/]+)$/);
    if (noteId) return { collection: 'notebook_notes', id: noteId };
    const waitlistId = match(/^\/waitlist\/([^/]+)$/);
    if (waitlistId) return { collection: 'waitlist_entries', id: waitlistId };
    const hallSignalId = match(/^\/hall-signals\/([^/]+)\/acknowledge$/);
    if (hallSignalId) return { collection: 'hall_signals', id: hallSignalId };
    const orderItemId = match(/^\/guest-order-items\/([^/]+)$/);
    if (orderItemId) return { collection: 'guest_order_items', id: orderItemId };
    const checklistId = match(/^\/shift-checklist\/([^/]+)$/);
    if (checklistId) return { collection: 'shift_checklist', id: checklistId };
  }
  if (normalizedMethod === 'POST') {
    const reservationStatusId = match(/^\/reservations\/([^/]+)\/status$/);
    if (reservationStatusId) return { collection: 'reservations', id: reservationStatusId };
  }
  return null;
}

function bodyExpectedVersion(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const value = record.expected_version ?? record.expectedVersion ?? record.base_version ?? record.baseVersion ?? record.version;
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function withExpectedVersionBody(body: unknown, version: number) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { expected_version: version };
  }
  return { ...(body as Record<string, unknown>), expected_version: version };
}

function isOfflineMutationAllowed(method: string, path: string) {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'DELETE') return false;
  if (normalizedMethod === 'PATCH' && /^\/guest-order-items\/[^/]+$/.test(path)) return true;
  if (path.startsWith('/auth') || path.startsWith('/guest/') || path.startsWith('/admin')) return false;
  if (path.startsWith('/users') || path.startsWith('/roles') || path.startsWith('/push') || path.startsWith('/devices')) return false;
  if (path.startsWith('/me') || path.startsWith('/menu-items')) return false;
  if (normalizedMethod === 'PATCH' && /^\/tables\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && path === '/reservations') return true;
  if (normalizedMethod === 'PATCH' && /^\/reservations\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && /^\/reservations\/[^/]+\/status$/.test(path)) return true;
  if (normalizedMethod === 'POST' && path === '/stop-list') return true;
  if (normalizedMethod === 'PATCH' && /^\/stop-list\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'PATCH' && /^\/tasks\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && path === '/notebook') return true;
  if (normalizedMethod === 'PATCH' && /^\/notebook\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && path === '/waitlist') return true;
  if (normalizedMethod === 'PATCH' && /^\/waitlist\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && path === '/hall-signals') return true;
  if (normalizedMethod === 'PATCH' && /^\/hall-signals\/[^/]+\/acknowledge$/.test(path)) return true;
  if (normalizedMethod === 'PATCH' && /^\/shift-checklist\/[^/]+$/.test(path)) return true;
  if (normalizedMethod === 'POST' && path === '/menu-restored-alerts/acknowledge') return true;
  return false;
}

function normalizeQueueItem(item: Record<string, unknown>, session?: ApiSession | null): OfflineQueueItem | null {
  if (!item.path || !item.method) return null;
  const method = String(item.method).toUpperCase();
  const createdAt = String(item.created_at ?? item.createdAt ?? nowIso());
  const { object_type, object_id } = objectInfoForMutation(String(item.path));
  return {
    id: String(item.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    action_type: String(item.action_type ?? actionTypeForMutation(method, String(item.path))),
    user_type: 'staff',
    user_id: String(item.user_id || session?.user.id || ''),
    method,
    path: String(item.path),
    body: item.body ?? item.payload,
    payload: item.payload ?? item.body,
    created_at: createdAt,
    createdAt,
    retry_count: Number(item.retry_count ?? 0),
    status: (item.status as OfflineQueueItem['status']) ?? 'pending',
    last_error: (item.last_error as string | null) ?? null,
    server_result: item.server_result,
    object_id: (item.object_id as string | null) ?? object_id,
    object_type: (item.object_type as string | null) ?? object_type,
    previous_updated_at: (item.previous_updated_at as string | null) ?? null,
    base_version: bodyExpectedVersion(item.body ?? item.payload) ?? (Number.isInteger(Number(item.base_version)) ? Number(item.base_version) : null),
    priority: Number(item.priority ?? 0),
  };
}

class ApiError extends Error {
  status?: number;
  body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function normalizeApiUrl(apiUrl: string) {
  return apiUrl.trim().replace(/\/$/, '');
}

function normalizeGuestPhoneInput(value: string) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  throw new ApiError('Введите корректный номер телефона');
}

function nowIso() {
  return new Date().toISOString();
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? 'Неизвестная ошибка');
}

async function isNetworkClearlyOffline() {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === false;
  } catch {
    return false;
  }
}

export function getFixedApiUrl() {
  return normalizeApiUrl(CONFIGURED_API_URL || DEFAULT_API_URL);
}

export function getRealtimeUrl(apiUrl?: string) {
  return normalizeApiUrl(apiUrl || getFixedApiUrl())
    .replace(/^https:/i, 'wss:')
    .replace(/^http:/i, 'ws:');
}

function uniqueUrls(urls: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    const normalized = normalizeApiUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function hostFromApiUrl(apiUrl: string) {
  const match = normalizeApiUrl(apiUrl).match(/^https?:\/\/([^/:]+)/i);
  return match?.[1] ?? '';
}

function subnetFromApiUrl(apiUrl: string) {
  const host = hostFromApiUrl(apiUrl);
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  return parts.slice(0, 3).join('.');
}

function buildDiscoveryUrls(priorityUrls: string[]) {
  const subnets = uniqueUrls([
    ...priorityUrls.map(subnetFromApiUrl),
    '192.168.0',
    '192.168.1',
    '192.168.31',
    '192.168.43',
    '192.168.100',
    '192.168.137',
    '10.0.0',
    '172.20.10',
  ]);
  const scanUrls: string[] = [];
  const commonHosts = [
    ...Array.from({ length: 79 }, (_item, index) => index + 2),
    100,
    101,
    102,
    103,
    104,
    105,
    137,
    200,
    254,
  ];
  for (const subnet of subnets) {
    for (const host of commonHosts) {
      scanUrls.push(`http://${subnet}.${host}:4000`);
    }
  }
  return uniqueUrls([...priorityUrls, ...scanUrls]);
}

async function safeJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      fetch(url, {
        ...options,
        signal: controller.signal,
      }),
      new Promise<Response>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new ApiError('Сервер не отвечает. Проверьте подключение к рабочему серверу.'));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Сервер не отвечает. Проверьте подключение к рабочему серверу.');
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchWithRetries(url: string, options: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (await isNetworkClearlyOffline()) {
    throw new ApiError('Нет подключения к интернету.');
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < NETWORK_RETRY_COUNT; attempt += 1) {
    try {
      return await fetchWithTimeout(url, { ...options, cache: 'no-store' }, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === NETWORK_RETRY_COUNT - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function pingServer(apiUrl: string, timeoutMs = DISCOVERY_TIMEOUT_MS) {
  try {
    const response = await fetchWithRetries(`${normalizeApiUrl(apiUrl)}/health`, { method: 'GET' }, timeoutMs);
    const data = await safeJson(response);
    return Boolean(response.ok && data && typeof data === 'object' && (data as { service?: string }).service === 'gory-staff-server');
  } catch {
    return false;
  }
}

async function firstReachableUrl(urls: string[]) {
  for (const url of urls.slice(0, 4)) {
    if (await pingServer(url, PRIORITY_DISCOVERY_TIMEOUT_MS)) return url;
  }

  const rest = urls.slice(4);
  const batchSize = 32;
  for (let index = 0; index < rest.length; index += batchSize) {
    const batch = rest.slice(index, index + batchSize);
    const results = await Promise.all(batch.map(async (url) => ((await pingServer(url)) ? url : null)));
    const found = results.find(Boolean);
    if (found) return found;
  }
  return null;
}

async function resolveApiUrl(preferredUrl?: string) {
  if (await isNetworkClearlyOffline()) {
    throw new ApiError('Нет подключения к интернету.');
  }
  const savedUrl = await AsyncStorage.getItem(API_URL_KEY);
  const priorityUrls = uniqueUrls([
    CONFIGURED_API_URL,
    DEFAULT_API_URL,
    preferredUrl,
    savedUrl,
    ...CONFIGURED_FALLBACK_API_URLS,
    ANDROID_EMULATOR_API_URL,
    'http://192.168.0.2:4000',
    'http://192.168.0.3:4000',
    'http://192.168.0.4:4000',
    'http://192.168.1.2:4000',
  ]);
  const foundUrl = await firstReachableUrl(buildDiscoveryUrls(priorityUrls));
  if (!foundUrl) {
    throw new ApiError(
      'Не удалось найти рабочий сервер. Запустите START_GORY_STAFF.bat на компьютере, подключите телефон к той же Wi-Fi сети или используйте внешний адрес сервера.',
    );
  }
  await AsyncStorage.setItem(API_URL_KEY, foundUrl);
  return foundUrl;
}

async function fetchJson<T>(sessionOrUrl: ApiSession | string | GuestSession, path: string, options: RequestInit = {}): Promise<T> {
  const apiUrl =
    typeof sessionOrUrl === 'string' ? normalizeApiUrl(sessionOrUrl) : normalizeApiUrl(sessionOrUrl.apiUrl);
  const token = typeof sessionOrUrl === 'string' ? null : sessionOrUrl.token;
  const response = await fetchWithRetries(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Gory-App': 'mobile',
      'X-Pinggy-No-Screen': 'true',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const data = await safeJson(response);
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data ? String((data as { error?: unknown }).error) : 'Сервер вернул ошибку.';
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}

function snapshotCacheKey(userId: string) {
  return `gory_staff_snapshot_${userId}`;
}

async function findCachedRecordVersion(
  session: ApiSession,
  target: { collection: keyof DataSnapshot; id: string },
): Promise<{ version: number; updated_at: string | null } | null> {
  const raw = await AsyncStorage.getItem(snapshotCacheKey(session.user.id));
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as DataSnapshot;
    const collection = snapshot[target.collection];
    if (!Array.isArray(collection)) return null;
    const row = (collection as Array<{ id?: string; version?: number; updated_at?: string | null }>).find(
      (item) => item.id === target.id,
    );
    const version = Number(row?.version);
    if (!Number.isInteger(version) || version < 1) return null;
    return { version, updated_at: row?.updated_at ?? null };
  } catch {
    return null;
  }
}

async function prepareVersionedMutation(session: ApiSession, method: string, path: string, body: unknown) {
  const target = versionedMutationTarget(method, path);
  const explicitVersion = bodyExpectedVersion(body);
  if (!target) {
    return { body, base_version: explicitVersion, previous_updated_at: null, missing_version: false };
  }
  if (explicitVersion) {
    return {
      body: withExpectedVersionBody(body, explicitVersion),
      base_version: explicitVersion,
      previous_updated_at: null,
      missing_version: false,
    };
  }

  const cached = await findCachedRecordVersion(session, target);
  if (!cached) {
    return { body, base_version: null, previous_updated_at: null, missing_version: true };
  }
  return {
    body: withExpectedVersionBody(body, cached.version),
    base_version: cached.version,
    previous_updated_at: cached.updated_at,
    missing_version: false,
  };
}

function queuedBodyWithExpectedVersion(item: OfflineQueueItem): { ok: true; body: unknown } | { ok: false; body: unknown } {
  const target = versionedMutationTarget(item.method, item.path);
  if (!target) return { ok: true, body: item.body };
  const version = bodyExpectedVersion(item.body) ?? item.base_version;
  if (!version) return { ok: false, body: item.body };
  return { ok: true, body: withExpectedVersionBody(item.body, version) };
}

async function readQueue(): Promise<OfflineQueueItem[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    return parsed.map((item) => normalizeQueueItem(item)).filter((item): item is OfflineQueueItem => Boolean(item));
  } catch {
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
    return [];
  }
}

async function writeQueue(queue: OfflineQueueItem[]) {
  const active = queue.filter((item) => item.status !== 'synced' && item.status !== 'cancelled');
  const synced = queue.filter((item) => item.status === 'synced').slice(-20);
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([...active, ...synced]));
}

export async function getOfflineQueueStatus(userId?: string): Promise<OfflineQueueStatus> {
  const allItems = await readQueue();
  const items = userId ? allItems.filter((item) => !item.user_id || item.user_id === userId) : allItems;
  const count = (status: OfflineQueueItem['status']) => items.filter((item) => item.status === status).length;
  const lastError = [...items].reverse().find((item) => item.last_error)?.last_error ?? null;
  return {
    total: items.length,
    pending: count('pending'),
    syncing: count('syncing'),
    synced: count('synced'),
    failed: count('failed'),
    conflict: count('conflict'),
    lastError,
    items,
  };
}

export async function getCacheInfo(): Promise<CacheInfo> {
  const pairs = await AsyncStorage.multiGet([
    STAFF_SYNC_KEY,
    GUEST_PROFILE_SYNC_KEY,
    GUEST_MENU_SYNC_KEY,
    LAST_CONNECTION_KEY,
  ]);
  return {
    staffLastSyncAt: pairs[0]?.[1] ?? null,
    guestProfileLastSyncAt: pairs[1]?.[1] ?? null,
    guestMenuLastSyncAt: pairs[2]?.[1] ?? null,
    lastSuccessfulConnectionAt: pairs[3]?.[1] ?? null,
  };
}

export async function checkServerConnection(apiUrl?: string): Promise<ServerConnectionStatus> {
  const checkedAt = nowIso();
  const network = await Network.getNetworkStateAsync().catch(() => null);
  const networkType = network?.type ? String(network.type) : 'unknown';
  const isInternetReachable = network?.isInternetReachable ?? null;
  const target = normalizeApiUrl(apiUrl || (await getStoredApiUrl()));
  if (network?.isConnected === false) {
    return {
      online: false,
      apiUrl: target,
      websocketUrl: getRealtimeUrl(target),
      checkedAt,
      networkType,
      isInternetReachable,
      error: 'Нет подключения к интернету.',
    };
  }
  const connection = await resolveReachableConnection(target, pingServer, resolveApiUrl);
  const online = connection.online;
  const activeApiUrl = connection.apiUrl;
  if (online) {
    await AsyncStorage.multiSet([
      [API_URL_KEY, activeApiUrl],
      [LAST_CONNECTION_KEY, checkedAt],
    ]);
  }
  return {
    online,
    apiUrl: activeApiUrl,
    websocketUrl: getRealtimeUrl(activeApiUrl),
    checkedAt,
    networkType,
    isInternetReachable,
    error: online ? null : 'Сервер недоступен.',
  };
}

async function getDeviceId() {
  const saved = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const next = `${Platform.OS}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

async function buildDeviceInfo(pushToken: string) {
  return {
    push_token: pushToken,
    token: pushToken,
    platform: Platform.OS,
    device_id: await getDeviceId(),
    device_name: Device.deviceName ?? Device.modelName ?? `${Platform.OS} device`,
    app_version: '0.1.4',
  };
}

export async function getPushDiagnostics(): Promise<PushPermissionSnapshot> {
  const [permissions, network] = await Promise.all([
    Notifications.getPermissionsAsync(),
    Network.getNetworkStateAsync().catch(() => null),
  ]);
  const raw = await AsyncStorage.getItem(PUSH_STATUS_KEY);
  const cached = raw ? (JSON.parse(raw) as PushPermissionSnapshot) : null;
  return {
    permission: permissions.status,
    canAskAgain: permissions.canAskAgain,
    token: cached?.token ?? null,
    deviceId: cached?.deviceId ?? (await AsyncStorage.getItem(DEVICE_ID_KEY)),
    deviceName: Device.deviceName ?? Device.modelName ?? null,
    networkType: network?.type ? String(network.type) : 'unknown',
    isInternetReachable: network?.isInternetReachable ?? null,
    error: cached?.error ?? null,
  };
}

async function requestExpoPushToken(): Promise<PushPermissionSnapshot> {
  const network = await Network.getNetworkStateAsync().catch(() => null);
  const deviceId = await getDeviceId();
  if (!Device.isDevice) {
    const status: PushPermissionSnapshot = {
      permission: 'device_required',
      token: null,
      deviceId,
      deviceName: Device.deviceName ?? Device.modelName ?? null,
      networkType: network?.type ? String(network.type) : 'unknown',
      isInternetReachable: network?.isInternetReachable ?? null,
      error: 'Push token получается только на реальном телефоне.',
    };
    await AsyncStorage.setItem(PUSH_STATUS_KEY, JSON.stringify(status));
    return status;
  }
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  let canAskAgain = current.canAskAgain;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
    canAskAgain = requested.canAskAgain;
  }
  if (status !== 'granted') {
    const snapshot: PushPermissionSnapshot = {
      permission: status,
      canAskAgain,
      token: null,
      deviceId,
      deviceName: Device.deviceName ?? Device.modelName ?? null,
      networkType: network?.type ? String(network.type) : 'unknown',
      isInternetReachable: network?.isInternetReachable ?? null,
      error: 'Уведомления не разрешены на телефоне.',
    };
    await AsyncStorage.setItem(PUSH_STATUS_KEY, JSON.stringify(snapshot));
    return snapshot;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Горы',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#D7A94B',
    });
  }
  const token = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID });
  const snapshot: PushPermissionSnapshot = {
    permission: status,
    canAskAgain,
    token: token.data,
    deviceId,
    deviceName: Device.deviceName ?? Device.modelName ?? null,
    networkType: network?.type ? String(network.type) : 'unknown',
    isInternetReachable: network?.isInternetReachable ?? null,
    error: null,
  };
  await AsyncStorage.setItem(PUSH_STATUS_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function getStoredApiUrl() {
  const savedUrl = await AsyncStorage.getItem(API_URL_KEY);
  return savedUrl || getFixedApiUrl();
}

export async function getStoredSession(): Promise<ApiSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as ApiSession;
  try {
    const apiUrl = await resolveApiUrl(session.apiUrl);
    return { ...session, apiUrl };
  } catch {
    const savedUrl = await AsyncStorage.getItem(API_URL_KEY);
    const apiUrl = normalizeApiUrl(session.apiUrl || savedUrl || getFixedApiUrl());
    return { ...session, apiUrl };
  }
}

export async function saveSession(session: ApiSession) {
  const apiUrl = normalizeApiUrl(session.apiUrl || getFixedApiUrl());
  const fixedSession = { ...session, apiUrl };
  await AsyncStorage.multiSet([
    [SESSION_KEY, JSON.stringify(fixedSession)],
    [API_URL_KEY, fixedSession.apiUrl],
    [LAST_CONNECTION_KEY, nowIso()],
    [LAST_ACTIVE_MODE_KEY, 'staff'],
  ]);
}

export async function leaveStaffMode() {
  await AsyncStorage.setItem(LAST_ACTIVE_MODE_KEY, 'guest');
}

export async function logout() {
  await AsyncStorage.removeItem(SESSION_KEY);
  await AsyncStorage.setItem(LAST_ACTIVE_MODE_KEY, 'guest');
}

export async function getLastActiveMode(): Promise<'guest' | 'staff' | null> {
  const mode = await AsyncStorage.getItem(LAST_ACTIVE_MODE_KEY);
  return mode === 'guest' || mode === 'staff' ? mode : null;
}

async function saveGuestPayload(apiUrl: string, payload: GuestProfilePayload) {
  if (!payload.token) throw new ApiError('Сервер не вернул гостевую сессию.');
  const session: GuestSession = {
    apiUrl: normalizeApiUrl(apiUrl),
    token: payload.token,
    profile: payload,
  };
  await AsyncStorage.multiSet([
    [GUEST_SESSION_KEY, JSON.stringify(session)],
    [GUEST_PROFILE_CACHE_KEY, JSON.stringify(payload)],
    [API_URL_KEY, session.apiUrl],
    [GUEST_PROFILE_SYNC_KEY, nowIso()],
    [LAST_CONNECTION_KEY, nowIso()],
    [LAST_ACTIVE_MODE_KEY, 'guest'],
  ]);
  void registerGuestPushToken(session).catch(() => undefined);
  return session;
}

export async function getStoredGuestSession(): Promise<GuestSession | null> {
  const raw = await AsyncStorage.getItem(GUEST_SESSION_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as GuestSession;
  try {
    const apiUrl = await resolveApiUrl(session.apiUrl);
    return { ...session, apiUrl };
  } catch {
    return { ...session, apiUrl: normalizeApiUrl(session.apiUrl || getFixedApiUrl()) };
  }
}

export async function logoutGuest() {
  await AsyncStorage.removeItem(GUEST_SESSION_KEY);
  await AsyncStorage.setItem(LAST_ACTIVE_MODE_KEY, 'guest');
}

export async function guestLogin(apiUrl: string, phone: string) {
  const normalizedUrl = await resolveApiUrl(apiUrl || getFixedApiUrl());
  const normalizedPhone = normalizeGuestPhoneInput(phone);
  const payload = await fetchJson<GuestProfilePayload>(normalizedUrl, '/guest/login', {
    method: 'POST',
    body: JSON.stringify({ phone: normalizedPhone, platform: Platform.OS }),
  });
  return saveGuestPayload(normalizedUrl, payload);
}

export async function guestRegister(
  apiUrl: string,
  input: {
    name: string;
    phone: string;
    birthday?: string;
    referral_code?: string;
    marketing_consent?: boolean;
    personal_data_consent?: boolean;
  },
) {
  const normalizedUrl = await resolveApiUrl(apiUrl || getFixedApiUrl());
  const normalizedPhone = normalizeGuestPhoneInput(input.phone);
  const payload = await fetchJson<GuestProfilePayload>(normalizedUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      phone: normalizedPhone,
      platform: Platform.OS,
      personal_data_consent: input.personal_data_consent ?? true,
    }),
  });
  return saveGuestPayload(normalizedUrl, payload);
}

export async function loadGuestProfile(session: GuestSession) {
  try {
    const profile = await fetchJson<GuestProfilePayload>(session, '/guest/profile');
    const nextSession = { ...session, profile };
    await AsyncStorage.multiSet([
      [GUEST_SESSION_KEY, JSON.stringify(nextSession)],
      [GUEST_PROFILE_CACHE_KEY, JSON.stringify(profile)],
      [GUEST_PROFILE_SYNC_KEY, nowIso()],
      [LAST_CONNECTION_KEY, nowIso()],
    ]);
    return { profile, offline: false };
  } catch (error) {
    const authBlocked =
      error instanceof ApiError &&
      (error.status === 401 || (error.status === 403 && /blocked|fired|заблок|увол/i.test(error.message)));
    if (authBlocked) {
      await logoutGuest();
      throw error;
    }
    const cached = await AsyncStorage.getItem(GUEST_PROFILE_CACHE_KEY);
    if (!cached) throw error;
    return { profile: JSON.parse(cached) as GuestProfilePayload, offline: true };
  }
}

export async function updateGuestProfile(
  session: GuestSession,
  input: Partial<{ name: string; phone: string; birthday: string }>,
) {
  if (!session) throw new ApiError('Сначала войдите в гостевой профиль.');
  const body = { ...input };
  if (body.phone) body.phone = normalizeGuestPhoneInput(body.phone);
  const profile = await fetchJson<GuestProfilePayload>(session, '/guest/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  const nextSession = { ...session, profile };
  await AsyncStorage.multiSet([
    [GUEST_SESSION_KEY, JSON.stringify(nextSession)],
    [GUEST_PROFILE_CACHE_KEY, JSON.stringify(profile)],
    [GUEST_PROFILE_SYNC_KEY, nowIso()],
    [LAST_CONNECTION_KEY, nowIso()],
  ]);
  return profile;
}

export async function loadGuestMenu(preferredUrl?: string) {
  try {
    const apiUrl = await resolveApiUrl(preferredUrl || getFixedApiUrl());
    const menu = await fetchJson<GuestMenuPayload>(apiUrl, '/guest/menu');
    await AsyncStorage.multiSet([
      [GUEST_MENU_CACHE_KEY, JSON.stringify(menu)],
      [API_URL_KEY, apiUrl],
      [GUEST_MENU_SYNC_KEY, nowIso()],
      [LAST_CONNECTION_KEY, nowIso()],
    ]);
    return { menu, apiUrl, offline: false };
  } catch (error) {
    const cached = await AsyncStorage.getItem(GUEST_MENU_CACHE_KEY);
    if (!cached) throw error;
    return {
      menu: JSON.parse(cached) as GuestMenuPayload,
      apiUrl: preferredUrl || getFixedApiUrl(),
      offline: true,
    };
  }
}

export async function signIn(apiUrl: string, login: string, password: string): Promise<ApiSession> {
  const normalizedUrl = await resolveApiUrl(apiUrl || getFixedApiUrl());
  const result = await fetchJson<Omit<ApiSession, 'apiUrl'>>(normalizedUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  });
  return {
    ...result,
    apiUrl: normalizedUrl,
  };
}

export async function registerProfile(apiUrl: string, name: string, phone: string, login: string, password: string): Promise<ApiSession> {
  const normalizedUrl = await resolveApiUrl(apiUrl || getFixedApiUrl());
  const result = await fetchJson<Omit<ApiSession, 'apiUrl'>>(normalizedUrl, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, phone, login, password }),
  });
  return {
    ...result,
    apiUrl: normalizedUrl,
  };
}

export async function loadSnapshot(session: ApiSession): Promise<{ snapshot: DataSnapshot; offline: boolean }> {
  return runExclusiveSnapshot(async () => {
    try {
      const snapshot = await fetchJson<DataSnapshot>(session, '/sync?mobile=1');
      await AsyncStorage.multiSet([
        [snapshotCacheKey(session.user.id), JSON.stringify(snapshot)],
        [STAFF_SYNC_KEY, nowIso()],
        [LAST_CONNECTION_KEY, nowIso()],
      ]);
      void processOfflineQueue(session).catch(() => undefined);
      return { snapshot, offline: false };
    } catch (error) {
      const authBlocked =
        error instanceof ApiError &&
        (error.status === 401 || (error.status === 403 && /blocked|fired|заблок|увол/i.test(error.message)));
      if (authBlocked) {
        await logout();
        throw error;
      }
      const cached = await AsyncStorage.getItem(snapshotCacheKey(session.user.id));
      if (!cached) throw error;
      return { snapshot: JSON.parse(cached) as DataSnapshot, offline: true };
    }
  });
}

export async function performMutation(session: ApiSession, method: string, path: string, body?: unknown) {
  const normalizedMethod = method.toUpperCase();
  const prepared = await prepareVersionedMutation(session, normalizedMethod, path, body);
  try {
    return await fetchJson(session, path, {
      method: normalizedMethod,
      body: prepared.body === undefined ? undefined : JSON.stringify(prepared.body),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status && error.status < 500) {
      throw error;
    }
    if (!isOfflineMutationAllowed(normalizedMethod, path)) {
      throw new Error('Это действие доступно только при подключении к интернету.');
    }
    if (prepared.missing_version) {
      throw new Error('Действие не сохранено: нужна свежая версия записи. Обновите данные после подключения и повторите.');
    }
    const queue = await readQueue();
    const { object_type, object_id } = objectInfoForMutation(path);
    const queued = normalizeQueueItem(
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        action_type: actionTypeForMutation(normalizedMethod, path),
        user_type: 'staff',
        user_id: session.user.id,
        method: normalizedMethod,
        path,
        body: prepared.body,
        payload: prepared.body,
        created_at: nowIso(),
        createdAt: nowIso(),
        retry_count: 0,
        status: 'pending',
        last_error: friendlyError(error),
        object_id,
        object_type,
        previous_updated_at:
          prepared.previous_updated_at ??
          (prepared.body && typeof prepared.body === 'object' && 'updated_at' in prepared.body
            ? String((prepared.body as { updated_at?: string }).updated_at ?? '')
            : null),
        base_version: prepared.base_version,
        priority: normalizedMethod === 'POST' ? 1 : 0,
      },
      session,
    );
    if (queued) queue.push(queued);
    await writeQueue(queue);
    throw new Error('Связь слабая: действие сохранено и отправится после восстановления интернета.');
  }
}

export async function processOfflineQueue(session: ApiSession) {
  const queue = (await readQueue()).map((item) => normalizeQueueItem(item, session)).filter((item): item is OfflineQueueItem => Boolean(item));
  const activeQueue = queue.filter((item) => item.user_id === session.user.id && ['pending', 'syncing'].includes(item.status));
  if (activeQueue.length === 0) return;

  for (const item of activeQueue) {
    item.status = 'syncing';
    item.retry_count += 1;
    item.last_error = null;
    await writeQueue(queue);
    const queuedBody = queuedBodyWithExpectedVersion(item);
    if (!queuedBody.ok) {
      item.status = 'conflict';
      item.last_error = 'Старое офлайн-действие создано без версии записи. Обновите данные и повторите действие вручную.';
      await writeQueue(queue);
      continue;
    }
    try {
      const result = await fetchJson(session, item.path, {
        method: item.method,
        body: queuedBody.body === undefined ? undefined : JSON.stringify(queuedBody.body),
      });
      item.status = 'synced';
      item.server_result = result;
      item.last_error = null;
    } catch (error) {
      item.last_error = friendlyError(error);
      if (error instanceof ApiError && error.status === 409) {
        item.status = 'conflict';
        item.server_result = error.body;
        await writeQueue(queue);
        continue;
      }
      if (error instanceof ApiError && error.status && error.status < 500) {
        item.status = 'failed';
        await writeQueue(queue);
        continue;
      }
      item.status = 'pending';
      await writeQueue(queue);
      break;
    } finally {
      if (item.status === 'synced') {
        await writeQueue(queue);
      }
    }
  }
}

export async function clearOfflineQueueForCurrentUser(session: ApiSession) {
  const queue = await readQueue();
  await writeQueue(queue.filter((item) => item.user_id !== session.user.id));
}

export function connectRealtime(
  session: ApiSession,
  handlers: {
    onChange?: () => void;
    onMessage?: () => void;
    onStatus?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  },
) {
  const socket = io(normalizeApiUrl(session.apiUrl), {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 12000,
    auth: { token: session.token },
  });

  const scheduler = createRealtimeSyncScheduler(() => {
    handlers.onChange?.();
    handlers.onMessage?.();
  });

  handlers.onStatus?.('connecting');
  socket.on('connect', () => handlers.onStatus?.('connected'));
  socket.on('disconnect', () => handlers.onStatus?.('disconnected'));
  socket.on('connect_error', () => handlers.onStatus?.('error'));
  socket.on('sync:changed', () => scheduler.push());
  socket.on('chat:message', () => scheduler.push());

  return () => {
    scheduler.cancel();
    socket.off('connect');
    socket.off('disconnect');
    socket.off('connect_error');
    socket.off('sync:changed');
    socket.off('chat:message');
    socket.disconnect();
  };
}

export async function registerPushToken(session: ApiSession) {
  try {
    const status = await requestExpoPushToken();
    if (!status.token) return status;
    await fetchJson(session, '/push/devices/register', {
      method: 'POST',
      body: JSON.stringify(await buildDeviceInfo(status.token)),
    });
    return status;
  } catch {
    return getPushDiagnostics();
  }
}

export async function registerGuestPushToken(session: GuestSession) {
  try {
    const status = await requestExpoPushToken();
    if (!status.token) return status;
    await fetchJson(session, '/guest/push/register', {
      method: 'POST',
      body: JSON.stringify(await buildDeviceInfo(status.token)),
    });
    return status;
  } catch {
    return getPushDiagnostics();
  }
}

export async function sendStaffTestPush(session: ApiSession) {
  return fetchJson(session, '/push/test', { method: 'POST' });
}

export async function sendGuestTestPush(session: GuestSession) {
  return fetchJson(session, '/guest/push/test', { method: 'POST' });
}
