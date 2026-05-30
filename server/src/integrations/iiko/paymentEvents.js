const { createHash } = require('crypto');

const PAID_STATUSES = new Set([
  'paid',
  'closed',
  'completed',
  'complete',
  'success',
  'succeeded',
  'processed',
  'payment_succeeded',
  'order_paid',
  'order_closed',
]);

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

function normalizeStatus(body, payment) {
  const status = firstText(
    body.status,
    body.payment_status,
    body.paymentStatus,
    body.event_type,
    body.eventType,
    payment.status,
  );
  if (!status && (body.is_paid === true || body.paid === true)) return 'paid';
  return String(status || 'paid').trim().toLowerCase();
}

function normalizePaymentEvent(body = {}) {
  const payload = asObject(body);
  const order = asObject(payload.order);
  const payment = asObject(payload.payment ?? (Array.isArray(payload.payments) ? payload.payments[0] : null));
  const customer = asObject(payload.customer ?? payload.client ?? order.customer ?? order.client);
  const table = asObject(payload.table ?? order.table);
  const status = normalizeStatus(payload, payment);
  const iikoOrderId = firstText(
    payload.iiko_order_id,
    payload.iikoOrderId,
    payload.order_id,
    payload.orderId,
    order.id,
    order.order_id,
    order.orderId,
  );
  const iikoPaymentId = firstText(
    payload.iiko_payment_id,
    payload.iikoPaymentId,
    payload.payment_id,
    payload.paymentId,
    payload.transaction_id,
    payment.id,
    payment.payment_id,
    payment.paymentId,
  );
  const eventId = firstText(payload.event_id, payload.eventId, payload.id);
  const explicitDedupKey = firstText(payload.dedup_key, payload.dedupKey);
  const naturalDedupKey = [
    eventId ? `event:${eventId}` : null,
    iikoPaymentId ? `payment:${iikoPaymentId}` : null,
    iikoOrderId ? `order:${iikoOrderId}` : null,
  ]
    .filter(Boolean)
    .join('|');
  const fallbackDedupKey = `payload:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;

  return {
    dedupKey: explicitDedupKey || naturalDedupKey || fallbackDedupKey,
    paid: PAID_STATUSES.has(status) || payload.is_paid === true || payload.paid === true,
    status,
    iikoOrderId,
    iikoPaymentId,
    iikoTerminalGroupId: firstText(payload.iiko_terminal_group_id, payload.terminal_group_id, payload.terminalGroupId, order.terminalGroupId),
    iikoOrganizationId: firstText(payload.iiko_organization_id, payload.organization_id, payload.organizationId, order.organizationId),
    localOrderId: firstText(payload.local_order_id, payload.localOrderId, payload.guest_order_id, payload.guestOrderId),
    tableSessionId: firstText(payload.table_session_id, payload.tableSessionId),
    tableId: firstText(payload.table_id, payload.tableId, table.id),
    tableNumber: firstText(payload.table_number, payload.tableNumber, table.number),
    guestId: firstText(payload.guest_id, payload.guestId),
    guestPhone: firstText(payload.guest_phone, payload.guestPhone, payload.phone, customer.phone, order.phone),
    amount: moneyValue(payload.amount ?? payload.sum ?? payload.total_sum ?? payload.totalSum ?? payment.amount ?? payment.sum ?? order.sum ?? order.total),
    currency: firstText(payload.currency, payment.currency) || 'RUB',
    payload,
  };
}

async function findGuestByPhone(client, phone) {
  const last10 = phoneLast10(phone);
  if (!last10) return null;
  const result = await client.query('SELECT id, phone FROM guest_users WHERE deleted_at IS NULL');
  return result.rows.find((guest) => phoneLast10(guest.phone) === last10) ?? null;
}

async function resolvePaymentGuest(client, event) {
  if (event.guestId) {
    const guest = (await client.query('SELECT id FROM guest_users WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [event.guestId])).rows[0];
    if (guest) return { guestId: guest.id, localOrderId: event.localOrderId, tableSessionId: event.tableSessionId };
  }

  if (event.localOrderId) {
    const order = (
      await client.query('SELECT id, guest_id, table_session_id FROM guest_orders WHERE id = $1 LIMIT 1', [event.localOrderId])
    ).rows[0];
    if (order) return { guestId: order.guest_id, localOrderId: order.id, tableSessionId: order.table_session_id ?? event.tableSessionId };
  }

  if (event.iikoOrderId) {
    const order = (
      await client.query('SELECT id, guest_id, table_session_id FROM guest_orders WHERE iiko_order_id = $1 LIMIT 1', [event.iikoOrderId])
    ).rows[0];
    if (order) return { guestId: order.guest_id, localOrderId: order.id, tableSessionId: order.table_session_id ?? event.tableSessionId };

    const externalOrder = (
      await client.query(
        `SELECT guest_id, table_session_id
         FROM iiko_external_orders
         WHERE iiko_order_id = $1
         LIMIT 1`,
        [event.iikoOrderId],
      )
    ).rows[0];
    if (externalOrder?.guest_id) {
      return {
        guestId: externalOrder.guest_id,
        localOrderId: event.localOrderId,
        tableSessionId: externalOrder.table_session_id ?? event.tableSessionId,
      };
    }
  }

  if (event.tableSessionId) {
    const session = (
      await client.query('SELECT id, guest_id FROM table_guest_sessions WHERE id = $1 LIMIT 1', [event.tableSessionId])
    ).rows[0];
    if (session) return { guestId: session.guest_id, localOrderId: event.localOrderId, tableSessionId: session.id };
  }

  const guestByPhone = await findGuestByPhone(client, event.guestPhone);
  if (guestByPhone) return { guestId: guestByPhone.id, localOrderId: event.localOrderId, tableSessionId: event.tableSessionId };

  if (event.tableId || event.tableNumber) {
    const params = [];
    const where = [];
    if (event.tableId) {
      params.push(event.tableId);
      where.push(`s.table_id = $${params.length}`);
    }
    if (event.tableNumber) {
      params.push(event.tableNumber);
      where.push(`t.number = $${params.length}`);
    }
    const session = (
      await client.query(
        `SELECT s.id, s.guest_id
         FROM table_guest_sessions s
         JOIN "tables" t ON t.id = s.table_id
         WHERE s.status = 'active' AND (${where.join(' OR ')})
         ORDER BY s.checked_in_at DESC
         LIMIT 1`,
        params,
      )
    ).rows[0];
    if (session) return { guestId: session.guest_id, localOrderId: event.localOrderId, tableSessionId: session.id };
  }

  return { guestId: null, localOrderId: event.localOrderId, tableSessionId: event.tableSessionId };
}

async function updateGuestVisitStats(client, guestId, amount) {
  const current = (await client.query('SELECT visits_count, total_spent FROM guest_users WHERE id = $1', [guestId])).rows[0];
  if (!current) return;
  const visits = Number(current.visits_count ?? 0) + 1;
  const totalSpent = Number(current.total_spent ?? 0) + Math.max(0, Number(amount ?? 0));
  const averageCheck = visits > 0 ? Math.round(totalSpent / visits) : 0;
  await client.query(
    `UPDATE guest_users
     SET visits_count = $2,
         total_spent = $3,
         average_check = $4,
         last_visit_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1`,
    [guestId, visits, totalSpent, averageCheck],
  );
}

function publicPaymentEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    iiko_order_id: row.iiko_order_id,
    iiko_payment_id: row.iiko_payment_id,
    local_order_id: row.local_order_id,
    table_session_id: row.table_session_id,
    guest_id: row.guest_id,
    guest_phone: row.guest_phone,
    amount: Number(row.amount ?? 0),
    currency: row.currency,
    status: row.status,
    notification_id: row.notification_id,
    processed_at: row.processed_at,
  };
}

function publicBonusRedemption(row) {
  if (!row) return null;
  return {
    id: row.id,
    guest_id: row.guest_id,
    table_session_id: row.table_session_id,
    local_order_id: row.local_order_id,
    iiko_order_id: row.iiko_order_id,
    iiko_payment_event_id: row.iiko_payment_event_id,
    bonus_transaction_id: row.bonus_transaction_id,
    amount: Number(row.amount ?? 0),
    order_amount: Number(row.order_amount ?? 0),
    max_bonus_amount: Number(row.max_bonus_amount ?? 0),
    bonus_to_ruble_rate: Number(row.bonus_to_ruble_rate ?? 1),
    status: row.status,
    reason: row.reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    applied_at: row.applied_at,
    cancelled_at: row.cancelled_at,
  };
}

function redemptionMatchesPayment(row, event, match) {
  if (event.iikoOrderId && row.iiko_order_id === event.iikoOrderId) return true;
  if (match.localOrderId && row.local_order_id === match.localOrderId) return true;
  if (match.tableSessionId && row.table_session_id === match.tableSessionId) {
    const sameIikoOrder = !row.iiko_order_id || !event.iikoOrderId || row.iiko_order_id === event.iikoOrderId;
    const sameLocalOrder = !row.local_order_id || !match.localOrderId || row.local_order_id === match.localOrderId;
    return sameIikoOrder && sameLocalOrder;
  }
  return false;
}

async function loadPaymentBonusRedemptions(client, paymentEventId) {
  const result = await client.query(
    `SELECT *
     FROM guest_bonus_redemptions
     WHERE iiko_payment_event_id = $1
     ORDER BY applied_at ASC, created_at ASC`,
    [paymentEventId],
  );
  return result.rows.map(publicBonusRedemption);
}

function maxBonusForPaymentAmount(amount) {
  return Math.floor(Math.max(0, Number(amount ?? 0)) * 0.2);
}

async function refundRedemptionExcess(client, redemption, refundAmount, event, match, options) {
  if (refundAmount <= 0) return null;
  if (typeof options.addGuestBonusTransaction !== 'function') {
    throw new Error('addGuestBonusTransaction is required to refund an over-limit bonus redemption.');
  }
  return await options.addGuestBonusTransaction(client, {
    guestId: redemption.guest_id,
    type: 'iiko_bonus_redeem_refund',
    amount: refundAmount,
    reason: 'Возврат бонусов сверх лимита 20% от оплаченного iiko-заказа.',
    source: 'iiko_payment',
    relatedVisitId: match.tableSessionId || redemption.table_session_id || null,
    iikoOrderId: event.iikoOrderId || redemption.iiko_order_id || null,
    iikoPaymentEventId: event.paymentEventId || null,
    localOrderId: match.localOrderId || redemption.local_order_id || null,
    tableSessionId: match.tableSessionId || redemption.table_session_id || null,
  });
}

async function applyReservedBonusRedemptions(client, event, match, paymentEventId, options = {}) {
  if (!match.guestId) return [];
  const candidates = await client.query(
    `SELECT *
     FROM guest_bonus_redemptions
     WHERE guest_id = $1
       AND status = 'reserved'
     ORDER BY created_at ASC`,
    [match.guestId],
  );
  const applied = [];
  for (const redemption of candidates.rows.filter((row) => redemptionMatchesPayment(row, event, match))) {
    const actualMaxBonusAmount = maxBonusForPaymentAmount(event.amount);
    const requestedAmount = Number(redemption.amount ?? 0);
    const appliedAmount = Math.min(requestedAmount, actualMaxBonusAmount);
    const refundAmount = requestedAmount - appliedAmount;
    if (refundAmount > 0) {
      await refundRedemptionExcess(client, redemption, refundAmount, { ...event, paymentEventId }, match, options);
    }
    if (appliedAmount <= 0) {
      const cancelled = (
        await client.query(
          `UPDATE guest_bonus_redemptions
           SET status = 'cancelled',
               iiko_payment_event_id = $2,
               iiko_order_id = COALESCE(iiko_order_id, $3),
               local_order_id = COALESCE(local_order_id, $4),
               order_amount = CASE WHEN $5 > 0 THEN $5 ELSE order_amount END,
               max_bonus_amount = $6,
               cancelled_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [redemption.id, paymentEventId, event.iikoOrderId, match.localOrderId || null, event.amount, actualMaxBonusAmount],
        )
      ).rows[0];
      applied.push(publicBonusRedemption(cancelled));
      continue;
    }

    const updated = (
      await client.query(
         `UPDATE guest_bonus_redemptions
         SET status = $5,
             iiko_payment_event_id = $2,
             iiko_order_id = COALESCE(iiko_order_id, $3),
             local_order_id = COALESCE(local_order_id, $4),
             amount = $6,
             order_amount = CASE WHEN $7 > 0 THEN $7 ELSE order_amount END,
             max_bonus_amount = $8,
             applied_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          redemption.id,
          paymentEventId,
          event.iikoOrderId,
          match.localOrderId || null,
          refundAmount > 0 ? 'applied_adjusted' : 'applied',
          appliedAmount,
          event.amount,
          actualMaxBonusAmount,
        ],
      )
    ).rows[0];
    if (redemption.bonus_transaction_id) {
      await client.query(
        `UPDATE guest_bonus_transactions
         SET iiko_order_id = COALESCE(iiko_order_id, $2),
             iiko_payment_event_id = $3,
             local_order_id = COALESCE(local_order_id, $4),
             table_session_id = COALESCE(table_session_id, $5),
             related_visit_id = COALESCE(related_visit_id, $5)
         WHERE id = $1`,
        [
          redemption.bonus_transaction_id,
          event.iikoOrderId,
          paymentEventId,
          match.localOrderId || null,
          match.tableSessionId || null,
        ],
      );
    }
    applied.push(publicBonusRedemption(updated));
  }
  return applied;
}

async function processIikoPaymentEvent(options = {}) {
  const db = options.db;
  const randomUUID = options.randomUUID;
  if (!db) throw new Error('db is required for iiko payment event processing.');
  if (typeof randomUUID !== 'function') throw new Error('randomUUID is required for iiko payment event processing.');

  const event = normalizePaymentEvent(options.body ?? {});
  if (!event.paid) {
    return {
      ok: true,
      status: 'ignored',
      reason: 'event_status_is_not_paid',
      payment_status: event.status,
    };
  }

  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const shouldRelease = typeof db.connect === 'function';
  try {
    await client.query('BEGIN');
    const existing = (await client.query('SELECT * FROM iiko_payment_events WHERE dedup_key = $1 LIMIT 1', [event.dedupKey])).rows[0];
    if (existing) {
      const feedback = (
        await client.query('SELECT * FROM guest_feedback_requests WHERE iiko_payment_event_id = $1 LIMIT 1', [existing.id])
      ).rows[0] ?? null;
      const bonusRedemptions = await loadPaymentBonusRedemptions(client, existing.id);
      await client.query('COMMIT');
      return {
        ok: true,
        status: 'duplicate',
        duplicate: true,
        matched: Boolean(existing.guest_id),
        payment_event: publicPaymentEvent(existing),
        feedback_request: feedback,
        bonus_redemptions: bonusRedemptions,
      };
    }

    const match = await resolvePaymentGuest(client, event);
    const paymentEventId = randomUUID();
    const insertedEvent = (
      await client.query(
        `INSERT INTO iiko_payment_events
           (id, dedup_key, iiko_order_id, iiko_payment_id, iiko_terminal_group_id, iiko_organization_id,
            local_order_id, table_session_id, guest_id, guest_phone, amount, currency, status, payload_json, processed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         RETURNING *`,
        [
          paymentEventId,
          event.dedupKey,
          event.iikoOrderId,
          event.iikoPaymentId,
          event.iikoTerminalGroupId,
          event.iikoOrganizationId,
          match.localOrderId || null,
          match.tableSessionId || null,
          match.guestId || null,
          event.guestPhone,
          event.amount,
          event.currency,
          event.status,
          event.payload,
        ],
      )
    ).rows[0];

    if (event.iikoOrderId) {
      await client.query(
        `UPDATE iiko_external_orders
         SET status = $2,
             amount = CASE WHEN $3 > 0 THEN $3 ELSE amount END,
             guest_id = COALESCE(guest_id, $4),
             table_session_id = COALESCE(table_session_id, $5),
             updated_at = NOW(),
             closed_at = COALESCE(closed_at, NOW())
         WHERE iiko_order_id = $1`,
        [event.iikoOrderId, event.status || 'paid', event.amount, match.guestId || null, match.tableSessionId || null],
      );
    }

    let feedbackRequest = null;
    let notificationId = null;
    let bonusRedemptions = [];
    if (match.guestId) {
      bonusRedemptions = await applyReservedBonusRedemptions(client, event, match, paymentEventId, options);
      await updateGuestVisitStats(client, match.guestId, event.amount);
      if (match.localOrderId) {
        await client.query(
          `UPDATE guest_orders
           SET status = 'closed',
               updated_at = NOW(),
               version = version + 1
           WHERE id = $1 AND status <> 'closed'`,
          [match.localOrderId],
        );
      }
      if (match.tableSessionId) {
        await client.query(
          `UPDATE table_guest_sessions
           SET status = 'ended',
               ended_at = COALESCE(ended_at, NOW()),
               updated_at = NOW(),
               version = version + 1
           WHERE id = $1 AND status = 'active'`,
          [match.tableSessionId],
        );
      }

      const feedbackId = randomUUID();
      feedbackRequest = (
        await client.query(
          `INSERT INTO guest_feedback_requests
             (id, guest_id, iiko_payment_event_id, table_session_id, local_order_id, status, requested_at)
           VALUES ($1,$2,$3,$4,$5,'requested',NOW())
           RETURNING *`,
          [feedbackId, match.guestId, paymentEventId, match.tableSessionId || null, match.localOrderId || null],
        )
      ).rows[0];

      if (typeof options.createGuestNotification === 'function') {
        notificationId = await options.createGuestNotification(client, {
          guestId: match.guestId,
          title: 'Оцените визит',
          text: 'Спасибо за оплату. Расскажите, как все прошло в ресторане.',
          type: 'visit_feedback_request',
          data: {
            feedback_request_id: feedbackId,
            iiko_payment_event_id: paymentEventId,
            amount: event.amount,
            action: 'rate_visit',
          },
          push: true,
        });
        if (notificationId) {
          await client.query('UPDATE iiko_payment_events SET notification_id = $2 WHERE id = $1', [paymentEventId, notificationId]);
          await client.query('UPDATE guest_feedback_requests SET notification_id = $2 WHERE id = $1', [feedbackId, notificationId]);
          insertedEvent.notification_id = notificationId;
          feedbackRequest.notification_id = notificationId;
        }
      }
    }

    await client.query('COMMIT');
    options.emitChange?.('iiko_payment_events', 'created', { id: paymentEventId, guest_id: match.guestId });
    if (feedbackRequest) options.emitChange?.('guest_feedback_requests', 'created', feedbackRequest);
    if (bonusRedemptions.length > 0) options.emitChange?.('guest_bonus_redemptions', 'updated', bonusRedemptions);

    return {
      ok: true,
      status: match.guestId ? 'processed' : 'unmatched',
      duplicate: false,
      matched: Boolean(match.guestId),
      payment_event: publicPaymentEvent(insertedEvent),
      feedback_request: feedbackRequest,
      bonus_redemptions: bonusRedemptions,
      notification_id: notificationId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    options.logger?.warn?.('iiko payment event failed:', error.message);
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

module.exports = {
  normalizePaymentEvent,
  processIikoPaymentEvent,
};
