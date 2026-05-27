import type { ApiSession } from '../types';

type GuestSession = {
  apiUrl: string;
  token: string;
};

async function fetchJson<T>(base: string, path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Не удалось выполнить запрос.');
  }
  return payload as T;
}

export type HallSignalType = 'hall_help' | 'dessert_ready' | 'bill_soon';

export type HallSignal = {
  id: string;
  table_id: string;
  table_number?: string;
  signal_type: HallSignalType;
  signal_label?: string;
  status: 'open' | 'acknowledged';
  created_by: string;
  created_by_name?: string;
  created_at: string;
};

export type GuestTimelineItem = {
  id: string;
  kind: 'reservation' | 'visit' | 'bonus';
  title: string;
  text: string;
  at: string;
  status?: string;
};

export type GuestSegment = {
  id: string;
  name: string;
  description?: string | null;
  rules_json?: Record<string, unknown>;
  member_count?: number;
};

export async function createHallSignal(session: ApiSession, tableId: string, signalType: HallSignalType) {
  return fetchJson<HallSignal>(session.apiUrl, '/hall-signals', {
    method: 'POST',
    token: session.token,
    body: JSON.stringify({ table_id: tableId, signal_type: signalType }),
  });
}

export async function acknowledgeHallSignal(session: ApiSession, signalId: string) {
  return fetchJson(session.apiUrl, `/hall-signals/${signalId}/acknowledge`, {
    method: 'PATCH',
    token: session.token,
  });
}

export async function acknowledgeMenuRestoredAlerts(session: ApiSession) {
  return fetchJson<{ ok: boolean }>(session.apiUrl, '/menu-restored-alerts/acknowledge', {
    method: 'POST',
    token: session.token,
  });
}

export async function createGuestReservation(
  session: GuestSession,
  body: { date: string; time: string; guests_count: number; comment?: string; occasion?: string },
) {
  return fetchJson(session.apiUrl, '/guest/reservations', {
    method: 'POST',
    token: session.token,
    body: JSON.stringify(body),
  });
}

export async function guestCheckIn(session: GuestSession, token: string) {
  return fetchJson<{
    table: { id: string; number: string };
    profile?: unknown;
    offers: { id: string; title: string; text: string }[];
  }>(session.apiUrl, '/guest/check-in', {
    method: 'POST',
    token: session.token,
    body: JSON.stringify({ token }),
  });
}

export async function createGuestOrderItem(session: GuestSession, menuItemId: string, quantity = 1) {
  return fetchJson<{ order: unknown; item: unknown }>(session.apiUrl, '/guest/orders/items', {
    method: 'POST',
    token: session.token,
    body: JSON.stringify({ menu_item_id: menuItemId, quantity }),
  });
}

export async function loadGuestTimeline(session: GuestSession) {
  return fetchJson<{ items: GuestTimelineItem[] }>(session.apiUrl, '/guest/timeline', {
    token: session.token,
  });
}

export async function loadGuestSegments(session: ApiSession) {
  return fetchJson<GuestSegment[]>(session.apiUrl, '/guest-segments', { token: session.token });
}

export async function createSegmentAnnouncement(
  session: ApiSession,
  segmentId: string,
  body: { title: string; text: string; importance?: string },
) {
  return fetchJson<{ announcement_id: string; guests: number; notified: number }>(
    session.apiUrl,
    `/guest-segments/${segmentId}/announcements`,
    {
      method: 'POST',
      token: session.token,
      body: JSON.stringify(body),
    },
  );
}

export const hallSignalOptions: { type: HallSignalType; label: string }[] = [
  { type: 'hall_help', label: 'Нужна помощь зала' },
  { type: 'dessert_ready', label: 'Готовность к десерту' },
  { type: 'bill_soon', label: 'Счёт скоро' },
];
