const CLOSED_STATUSES = new Set(['closed', 'paid', 'completed', 'complete', 'order_paid', 'order_closed', 'cancelled', 'canceled']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function firstText(...values) {
  for (const value of values) {
    const text = compactText(value);
    if (text) return text;
  }
  return null;
}

function moneyValue(value) {
  if (value && typeof value === 'object') {
    return moneyValue(value.amount ?? value.value ?? value.sum ?? value.total);
  }
  const number =
    typeof value === 'string'
      ? Number(value.replace(/\s+/g, '').replace(',', '.'))
      : Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number);
}

function phoneDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function phoneLast10(value) {
  const digits = phoneDigits(value);
  return digits ? digits.slice(-10) : null;
}

function httpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeIikoOrderEvent(body = {}) {
  const payload = asObject(body);
  const order = asObject(payload.order);
  const table = asObject(payload.table ?? order.table);
  const customer = asObject(payload.customer ?? payload.client ?? order.customer ?? order.client);
  const status = String(firstText(payload.status, payload.order_status, payload.orderStatus, order.status) || 'open').toLowerCase();
  const iikoOrderId = firstText(
    payload.iiko_order_id,
    payload.iikoOrderId,
    payload.order_id,
    payload.orderId,
    order.id,
    order.order_id,
    order.orderId,
  );
  if (!iikoOrderId) throw httpError('Передайте order_id iiko-заказа.', 400);

  return {
    iikoOrderId,
    iikoOrderNumber: firstText(payload.iiko_order_number, payload.order_number, payload.orderNumber, order.number),
    iikoTerminalGroupId: firstText(payload.iiko_terminal_group_id, payload.terminal_group_id, payload.terminalGroupId, order.terminalGroupId),
    iikoOrganizationId: firstText(payload.iiko_organization_id, payload.organization_id, payload.organizationId, order.organizationId),
    iikoTableId: firstText(payload.iiko_table_id, payload.iikoTableId, table.iiko_table_id, table.iikoTableId, table.iikoId),
    tableId: firstText(payload.local_table_id, payload.localTableId, payload.table_id, payload.tableId, table.id),
    tableNumber: firstText(payload.table_number, payload.tableNumber, table.number),
    tableSessionId: firstText(payload.table_session_id, payload.tableSessionId),
    guestId: firstText(payload.guest_id, payload.guestId),
    guestPhone: firstText(payload.guest_phone, payload.guestPhone, payload.phone, customer.phone, order.phone),
    amount: moneyValue(payload.amount ?? payload.sum ?? payload.total_sum ?? payload.totalSum ?? order.sum ?? order.total),
    status,
    payload,
  };
}

async function findGuestByPhone(client, phone) {
  const last10 = phoneLast10(phone);
  if (!last10) return null;
  const result = await client.query('SELECT id, phone FROM guest_users WHERE deleted_at IS NULL');
  return result.rows.find((guest) => phoneLast10(guest.phone) === last10) ?? null;
}

async function resolveTable(client, event) {
  const params = [];
  const where = [];
  if (event.tableId) {
    params.push(event.tableId);
    where.push(`(id = $${params.length} OR iiko_table_id = $${params.length})`);
  }
  if (event.iikoTableId) {
    params.push(event.iikoTableId);
    where.push(`iiko_table_id = $${params.length}`);
  }
  if (event.tableNumber) {
    params.push(event.tableNumber);
    where.push(`number = $${params.length}`);
  }
  if (where.length === 0) return null;
  return (
    await client.query(
      `SELECT id, number, iiko_table_id
       FROM "tables"
       WHERE ${where.join(' OR ')}
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      params,
    )
  ).rows[0] ?? null;
}

async function resolveOrderMatch(client, event) {
  if (event.tableSessionId) {
    const session = (
      await client.query(
        `SELECT s.id, s.guest_id, s.table_id, t.number AS table_number
         FROM table_guest_sessions s
         JOIN "tables" t ON t.id = s.table_id
         WHERE s.id = $1
         LIMIT 1`,
        [event.tableSessionId],
      )
    ).rows[0];
    if (session) {
      return {
        guestId: event.guestId || session.guest_id,
        tableSessionId: session.id,
        tableId: session.table_id,
        tableNumber: session.table_number,
      };
    }
  }

  const table = await resolveTable(client, event);
  let guestId = null;
  if (event.guestId) {
    const guest = (await client.query('SELECT id FROM guest_users WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [event.guestId])).rows[0];
    if (guest) guestId = guest.id;
  }
  if (!guestId) {
    const guestByPhone = await findGuestByPhone(client, event.guestPhone);
    if (guestByPhone) guestId = guestByPhone.id;
  }

  const sessionParams = [];
  const sessionWhere = [`s.status = 'active'`];
  if (table?.id) {
    sessionParams.push(table.id);
    sessionWhere.push(`s.table_id = $${sessionParams.length}`);
  }
  if (guestId) {
    sessionParams.push(guestId);
    sessionWhere.push(`s.guest_id = $${sessionParams.length}`);
  }

  const session = sessionParams.length > 0
    ? (
        await client.query(
          `SELECT s.id, s.guest_id, s.table_id, t.number AS table_number
           FROM table_guest_sessions s
           JOIN "tables" t ON t.id = s.table_id
           WHERE ${sessionWhere.join(' AND ')}
           ORDER BY s.checked_in_at DESC
           LIMIT 1`,
          sessionParams,
        )
      ).rows[0]
    : null;

  return {
    guestId: guestId || session?.guest_id || null,
    tableSessionId: session?.id || event.tableSessionId || null,
    tableId: table?.id || session?.table_id || null,
    tableNumber: table?.number || session?.table_number || event.tableNumber || null,
  };
}

function publicIikoExternalOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    iiko_order_id: row.iiko_order_id,
    iiko_order_number: row.iiko_order_number,
    iiko_terminal_group_id: row.iiko_terminal_group_id,
    iiko_organization_id: row.iiko_organization_id,
    iiko_table_id: row.iiko_table_id,
    table_id: row.table_id,
    table_number: row.table_number,
    table_session_id: row.table_session_id,
    guest_id: row.guest_id,
    guest_phone: row.guest_phone,
    amount: Number(row.amount ?? 0),
    status: row.status,
    first_seen_at: row.first_seen_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
  };
}

async function processIikoOrderEvent(options = {}) {
  const db = options.db;
  const randomUUID = options.randomUUID;
  if (!db) throw new Error('db is required for iiko order event processing.');
  if (typeof randomUUID !== 'function') throw new Error('randomUUID is required for iiko order event processing.');

  const event = normalizeIikoOrderEvent(options.body ?? {});
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const shouldRelease = typeof db.connect === 'function';
  try {
    await client.query('BEGIN');
    const match = await resolveOrderMatch(client, event);
    const closed = CLOSED_STATUSES.has(event.status);
    const inserted = (
      await client.query(
        `INSERT INTO iiko_external_orders
           (id, iiko_order_id, iiko_order_number, iiko_terminal_group_id, iiko_organization_id,
            iiko_table_id, table_id, table_number, table_session_id, guest_id, guest_phone,
            amount, status, payload_json, first_seen_at, updated_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW(),CASE WHEN $15 THEN NOW() ELSE NULL END)
         ON CONFLICT (iiko_order_id) DO UPDATE
         SET iiko_order_number = COALESCE(EXCLUDED.iiko_order_number, iiko_external_orders.iiko_order_number),
             iiko_terminal_group_id = COALESCE(EXCLUDED.iiko_terminal_group_id, iiko_external_orders.iiko_terminal_group_id),
             iiko_organization_id = COALESCE(EXCLUDED.iiko_organization_id, iiko_external_orders.iiko_organization_id),
             iiko_table_id = COALESCE(EXCLUDED.iiko_table_id, iiko_external_orders.iiko_table_id),
             table_id = COALESCE(EXCLUDED.table_id, iiko_external_orders.table_id),
             table_number = COALESCE(EXCLUDED.table_number, iiko_external_orders.table_number),
             table_session_id = COALESCE(EXCLUDED.table_session_id, iiko_external_orders.table_session_id),
             guest_id = COALESCE(EXCLUDED.guest_id, iiko_external_orders.guest_id),
             guest_phone = COALESCE(EXCLUDED.guest_phone, iiko_external_orders.guest_phone),
             amount = CASE WHEN EXCLUDED.amount > 0 THEN EXCLUDED.amount ELSE iiko_external_orders.amount END,
             status = EXCLUDED.status,
             payload_json = EXCLUDED.payload_json,
             updated_at = NOW(),
             closed_at = CASE WHEN $15 THEN COALESCE(iiko_external_orders.closed_at, NOW()) ELSE NULL END
         RETURNING *`,
        [
          randomUUID(),
          event.iikoOrderId,
          event.iikoOrderNumber,
          event.iikoTerminalGroupId,
          event.iikoOrganizationId,
          event.iikoTableId,
          match.tableId || null,
          match.tableNumber || event.tableNumber || null,
          match.tableSessionId || null,
          match.guestId || null,
          event.guestPhone,
          event.amount,
          event.status,
          event.payload,
          closed,
        ],
      )
    ).rows[0];
    await client.query('COMMIT');
    const order = publicIikoExternalOrder(inserted);
    options.emitChange?.('iiko_external_orders', 'updated', order);
    return {
      ok: true,
      status: match.guestId ? 'processed' : 'unmatched',
      matched: Boolean(match.guestId),
      order,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    options.logger?.warn?.('iiko order event failed:', error.message);
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

module.exports = {
  normalizeIikoOrderEvent,
  processIikoOrderEvent,
  publicIikoExternalOrder,
};
