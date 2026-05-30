const { createIikoHttpClient } = require('./client');
const { getIikoConfig } = require('./sync');

function compactText(value, maxLength = 255) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= maxLength ? text : text.slice(0, maxLength).trim();
}

function numericAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 1;
  return Math.min(999.999, amount);
}

function numericPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round(price * 100) / 100;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function positiveInteger(value, defaultValue, maxValue = 200) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return defaultValue;
  return Math.min(maxValue, Math.max(1, Math.round(number)));
}

function isoTimestampOrNull(value) {
  const text = compactText(value, 80);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sourceKey(env) {
  return compactText(env.IIKO_SOURCE_KEY, 80) || 'gory-staff';
}

function boolEnv(env, name, defaultValue) {
  const raw = String(env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function orderSyncEnabled(env, config) {
  if (!config.enabled) return false;
  const raw = String(env.IIKO_ORDER_SYNC_ENABLED ?? '').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function safeErrorMessage(error) {
  return compactText(error?.message ?? error, 1000) || 'Unknown iiko order sync error.';
}

function publicStatus(status) {
  if (status === 'completed') return 'completed';
  if (status === 'disabled') return 'disabled';
  return 'failed';
}

async function withClient(db, callback) {
  if (!db) throw new Error('db is required for iiko order sync.');
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

async function loadOrder(client, orderId) {
  const result = await client.query(
    `SELECT
       go.*,
       gu.name AS guest_name,
       gu.phone AS guest_phone,
       t.number AS table_number,
       t.iiko_table_id
     FROM guest_orders go
     JOIN guest_users gu ON gu.id = go.guest_id
     JOIN "tables" t ON t.id = go.table_id
     WHERE go.id = $1
     LIMIT 1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

async function loadOpenIikoOrders(client, limit) {
  const result = await client.query(
    `SELECT
       go.*,
       gu.name AS guest_name,
       gu.phone AS guest_phone,
       t.number AS table_number,
       t.iiko_table_id
     FROM guest_orders go
     JOIN guest_users gu ON gu.id = go.guest_id
     JOIN "tables" t ON t.id = go.table_id
     WHERE go.status = 'open'
       AND go.iiko_order_id IS NOT NULL
     ORDER BY go.updated_at ASC, go.id ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

async function loadOrderItems(client, orderId, includeSynced) {
  const syncFilter = includeSynced
    ? ''
    : `AND (oi.iiko_sync_status IS NULL OR oi.iiko_sync_status <> 'synced' OR oi.iiko_position_id IS NULL)`;
  const result = await client.query(
    `SELECT
       oi.*,
       mi.name AS menu_item_name,
       mi.price,
       mi.iiko_id,
       mi.iiko_size_id
     FROM guest_order_items oi
     JOIN menu_items mi ON mi.id = oi.menu_item_id
     WHERE oi.order_id = $1
       AND oi.status <> 'cancelled'
       ${syncFilter}
     ORDER BY oi.created_at ASC, oi.id ASC`,
    [orderId],
  );
  return result.rows;
}

async function loadOrderItemModifiers(client, itemRows) {
  if (itemRows.length === 0) return new Map();
  const placeholders = itemRows.map((_, index) => `$${index + 1}`).join(',');
  const result = await client.query(
    `SELECT *
     FROM guest_order_item_modifiers
     WHERE order_item_id IN (${placeholders})
     ORDER BY created_at ASC, id ASC`,
    itemRows.map((row) => row.id),
  );
  const byItemId = new Map();
  for (const row of result.rows) {
    const rows = byItemId.get(row.order_item_id) ?? [];
    rows.push(row);
    byItemId.set(row.order_item_id, rows);
  }
  return byItemId;
}

function iikoOrderIdFromResponse(payload) {
  return (
    compactText(payload?.orderInfo?.id, 80) ||
    compactText(payload?.orderInfo?.order?.id, 80) ||
    compactText(payload?.orderId, 80) ||
    compactText(payload?.id, 80)
  );
}

function iikoCreationStatusFromResponse(payload) {
  return (
    compactText(payload?.orderInfo?.creationStatus, 80) ||
    compactText(payload?.creationStatus, 80) ||
    compactText(payload?.state, 80)
  );
}

function correlationIdFromResponse(payload) {
  return compactText(payload?.correlationId, 80) || compactText(payload?.operationId, 80);
}

function iikoOrderIdFromOrderInfo(info) {
  return compactText(info?.id, 80) || compactText(info?.order?.id, 80);
}

function firstIikoOrderInfo(payload, iikoOrderId) {
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  return (
    orders.find((info) => iikoOrderIdFromOrderInfo(info) === iikoOrderId) ||
    orders.find((info) => compactText(info?.order?.id, 80) === iikoOrderId) ||
    null
  );
}

function iikoOrderInfoMap(payload) {
  const map = new Map();
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  for (const info of orders) {
    const id = iikoOrderIdFromOrderInfo(info);
    if (id) map.set(id, info);
  }
  return map;
}

function iikoOrderStatusFromInfo(info) {
  return compactText(info?.order?.status, 80) || compactText(info?.status, 80);
}

function localStatusFromIikoOrderStatus(iikoStatus, currentStatus) {
  const status = String(iikoStatus ?? '').trim().toLowerCase();
  if (status === 'closed') return 'closed';
  if (status === 'deleted') return 'cancelled';
  if (currentStatus === 'closed' || currentStatus === 'cancelled') return currentStatus;
  return 'open';
}

function iikoOrderNumberFromInfo(info) {
  return integerOrNull(info?.order?.number ?? info?.number);
}

function iikoOrderSumFromInfo(info) {
  return integerOrNull(info?.order?.sum ?? info?.sum);
}

function iikoOrderClosedAtFromInfo(info) {
  return isoTimestampOrNull(info?.order?.whenClosed ?? info?.whenClosed);
}

function buildIikoModifier(row, positionId) {
  if (!row.iiko_modifier_product_id) {
    throw new Error(`Order item modifier "${row.name || row.id}" has no iiko product id.`);
  }
  const productGroupId = compactText(row.iiko_modifier_group_id, 80);
  return {
    type: 'Product',
    productId: row.iiko_modifier_product_id,
    ...(productGroupId ? { productGroupId } : {}),
    amount: numericAmount(row.amount),
    price: numericPrice(row.price),
    positionId,
  };
}

function buildIikoItem(row, positionId, modifiers = []) {
  if (!row.iiko_id) {
    throw new Error(`Menu item "${row.menu_item_name || row.menu_item_id}" has no iiko product id.`);
  }
  return {
    type: 'Product',
    productId: row.iiko_id,
    productSizeId: row.iiko_size_id || null,
    amount: numericAmount(row.quantity),
    price: numericPrice(row.price),
    positionId,
    comment: compactText(row.comment),
    ...(modifiers.length > 0 ? { modifiers } : {}),
  };
}

function createOrderPayload(order, items, env, config) {
  const tableIds = compactText(order.iiko_table_id, 80) ? [compactText(order.iiko_table_id, 80)] : undefined;
  return {
    organizationId: config.organizationId,
    terminalGroupId: config.terminalGroupId,
    order: {
      externalNumber: compactText(order.id, 50),
      ...(tableIds ? { tableIds } : {}),
      customer: {
        type: 'one-time',
        name: compactText(order.guest_name, 60) || 'Guest',
      },
      phone: compactText(order.guest_phone, 40),
      guests: {
        count: 1,
      },
      tabName: compactText(`Table ${order.table_number}`, 60),
      sourceKey: sourceKey(env),
      items: items.map((item) => item.payload),
      externalData: [
        { key: 'gory_order_id', value: order.id, isPublic: false },
        { key: 'gory_table_number', value: String(order.table_number ?? ''), isPublic: true },
      ],
    },
    createOrderSettings: {
      servicePrint: boolEnv(env, 'IIKO_SERVICE_PRINT', true),
      checkStopList: boolEnv(env, 'IIKO_CHECK_STOP_LIST', true),
      transportToFrontTimeout: Math.max(1, Number(env.IIKO_TRANSPORT_TIMEOUT_SECONDS ?? 15)),
    },
  };
}

function addItemsPayload(order, items, env, config) {
  return {
    orderId: order.iiko_order_id,
    organizationId: config.organizationId,
    items: items.map((item) => item.payload),
    addOrderItemsSettings: {
      servicePrint: boolEnv(env, 'IIKO_SERVICE_PRINT', true),
    },
  };
}

async function updateOrderSuccess(client, orderId, { iikoOrderId, correlationId, creationStatus }) {
  await client.query(
    `UPDATE guest_orders
     SET iiko_order_id = COALESCE($2, iiko_order_id),
         iiko_correlation_id = COALESCE($3, iiko_correlation_id),
         iiko_creation_status = COALESCE($4, iiko_creation_status),
         iiko_sync_status = 'synced',
         iiko_sync_error = NULL,
         iiko_synced_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1`,
    [orderId, iikoOrderId, correlationId, creationStatus],
  );
}

async function updateItemsSuccess(client, items) {
  for (const item of items) {
    await client.query(
      `UPDATE guest_order_items
       SET iiko_position_id = $2,
           iiko_sync_status = 'synced',
           iiko_sync_error = NULL,
           iiko_synced_at = NOW(),
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1`,
      [item.row.id, item.positionId],
    );
    for (const modifier of item.modifiers) {
      await client.query(
        `UPDATE guest_order_item_modifiers
         SET iiko_position_id = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [modifier.row.id, modifier.positionId],
      );
    }
  }
}

async function updateFailure(client, orderId, itemRows, message) {
  await client.query(
    `UPDATE guest_orders
     SET iiko_sync_status = 'failed',
         iiko_sync_error = $2,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1`,
    [orderId, message],
  );
  if (itemRows.length > 0) {
    await client.query(
      `UPDATE guest_order_items
       SET iiko_sync_status = 'failed',
           iiko_sync_error = $2,
           updated_at = NOW(),
           version = version + 1
       WHERE id = ANY($1::text[])`,
      [itemRows.map((row) => row.id), message],
    );
  }
}

async function updatePulledOrderStatus(client, order, info, localStatus) {
  await client.query(
    `UPDATE guest_orders
     SET status = $2,
         iiko_creation_status = COALESCE($3, iiko_creation_status),
         iiko_order_status = COALESCE($4, iiko_order_status),
         iiko_order_number = COALESCE($5, iiko_order_number),
         iiko_order_sum = COALESCE($6, iiko_order_sum),
         iiko_order_closed_at = COALESCE($7::timestamptz, iiko_order_closed_at),
         iiko_order_payload_json = $8::jsonb,
         iiko_sync_status = 'synced',
         iiko_sync_error = NULL,
         iiko_synced_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1`,
    [
      order.id,
      localStatus,
      compactText(info?.creationStatus, 80),
      iikoOrderStatusFromInfo(info),
      iikoOrderNumberFromInfo(info),
      iikoOrderSumFromInfo(info),
      iikoOrderClosedAtFromInfo(info),
      JSON.stringify(info ?? {}),
    ],
  );
}

async function endSessionForClosedOrder(client, order, localStatus) {
  if (localStatus !== 'closed' || !order.table_session_id) return;
  await client.query(
    `UPDATE table_guest_sessions
     SET status = 'ended',
         ended_at = COALESCE(ended_at, NOW()),
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1 AND status = 'active'`,
    [order.table_session_id],
  );
}

async function applyPulledOrderStatus(client, order, info) {
  const iikoOrderStatus = iikoOrderStatusFromInfo(info);
  const localOrderStatus = localStatusFromIikoOrderStatus(iikoOrderStatus, order.status);
  await updatePulledOrderStatus(client, order, info, localOrderStatus);
  await endSessionForClosedOrder(client, order, localOrderStatus);
  return {
    iikoOrderStatus,
    localOrderStatus,
    creationStatus: compactText(info?.creationStatus, 80),
    orderNumber: iikoOrderNumberFromInfo(info),
    orderSum: iikoOrderSumFromInfo(info),
  };
}

async function insertOrderSyncLog(client, result, randomUUID) {
  await client.query(
    `INSERT INTO iiko_order_sync_log
       (id, order_id, operation, status, started_at, finished_at, duration_ms,
        items_synced, iiko_order_id, correlation_id, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      result.orderId ?? null,
      result.operation,
      result.status,
      result.startedAt,
      result.finishedAt,
      result.durationMs,
      result.items?.synced ?? 0,
      result.iikoOrderId ?? null,
      result.correlationId ?? null,
      result.error ?? null,
    ],
  );
}

function buildBulkResult(startedAt, data) {
  const finishedAt = new Date();
  return {
    status: publicStatus(data.status),
    operation: 'pull_open_statuses',
    orders: {
      scanned: 0,
      synced: 0,
      failed: 0,
      closed: 0,
      cancelled: 0,
      ...(data.orders ?? {}),
    },
    error: data.error ?? null,
    disabled_reason: data.disabled_reason ?? null,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
  };
}

function buildResult(startedAt, data) {
  const finishedAt = new Date();
  return {
    status: publicStatus(data.status),
    operation: data.operation,
    orderId: data.orderId ?? null,
    iikoOrderId: data.iikoOrderId ?? null,
    correlationId: data.correlationId ?? null,
    creationStatus: data.creationStatus ?? null,
    iikoOrderStatus: data.iikoOrderStatus ?? null,
    localOrderStatus: data.localOrderStatus ?? null,
    orderNumber: data.orderNumber ?? null,
    orderSum: data.orderSum ?? null,
    items: { synced: 0, ...(data.items ?? {}) },
    error: data.error ?? null,
    disabled_reason: data.disabled_reason ?? null,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
  };
}

function markPreparedItems(rows, modifierRowsByItemId, randomUUID) {
  return rows.map((row) => {
    const positionId = row.iiko_position_id || randomUUID();
    const modifiers = (modifierRowsByItemId.get(row.id) ?? []).map((modifierRow) => {
      const modifierPositionId = modifierRow.iiko_position_id || randomUUID();
      return {
        row: modifierRow,
        positionId: modifierPositionId,
        payload: buildIikoModifier(modifierRow, modifierPositionId),
      };
    });
    return {
      row,
      positionId,
      modifiers,
      payload: buildIikoItem(
        row,
        positionId,
        modifiers.map((modifier) => modifier.payload),
      ),
    };
  });
}

async function syncGuestOrderToIiko(options = {}) {
  const startedAt = new Date();
  const env = options.env ?? process.env;
  const config = getIikoConfig(env);
  const randomUUID = options.randomUUID;
  if (typeof randomUUID !== 'function') throw new Error('randomUUID is required for iiko order sync.');
  const orderId = compactText(options.orderId, 120);
  if (!orderId) throw new Error('orderId is required for iiko order sync.');

  if (!orderSyncEnabled(env, config)) {
    return buildResult(startedAt, {
      status: 'disabled',
      operation: 'create',
      orderId,
      disabled_reason: config.disabledReason || 'IIKO_ORDER_SYNC_ENABLED is false.',
    });
  }

  const missing = [];
  if (!config.organizationId) missing.push('IIKO_ORGANIZATION_ID');
  if (!config.terminalGroupId) missing.push('IIKO_TERMINAL_GROUP_ID');
  if (missing.length > 0) {
    const error = `${missing.join(', ')} must be configured for iiko order sync.`;
    return await withClient(options.db, async (client) => {
      const result = buildResult(startedAt, { status: 'failed', operation: 'create', orderId, error });
      await updateFailure(client, orderId, [], error);
      await insertOrderSyncLog(client, result, randomUUID);
      return result;
    });
  }

  return await withClient(options.db, async (client) => {
    let operation = 'create';
    let itemRows = [];
    try {
      const order = await loadOrder(client, orderId);
      if (!order) throw new Error(`Local order "${orderId}" was not found.`);
      operation = order.iiko_order_id ? 'add_items' : 'create';
      itemRows = await loadOrderItems(client, orderId, !order.iiko_order_id);
      if (itemRows.length === 0) {
        const result = buildResult(startedAt, {
          status: 'completed',
          operation: 'noop',
          orderId,
          iikoOrderId: order.iiko_order_id,
          items: { synced: 0 },
        });
        await updateOrderSuccess(client, orderId, {
          iikoOrderId: order.iiko_order_id,
          correlationId: null,
          creationStatus: null,
        });
        await insertOrderSyncLog(client, result, randomUUID);
        return result;
      }

      const modifierRowsByItemId = await loadOrderItemModifiers(client, itemRows);
      const preparedItems = markPreparedItems(itemRows, modifierRowsByItemId, randomUUID);
      const iikoClient = options.iikoClient || createIikoHttpClient(config, options);
      const response =
        operation === 'create'
          ? await iikoClient.createTableOrder(createOrderPayload(order, preparedItems, env, config))
          : await iikoClient.addOrderItems(addItemsPayload(order, preparedItems, env, config));

      const iikoOrderId = operation === 'create' ? iikoOrderIdFromResponse(response) : order.iiko_order_id;
      if (!iikoOrderId) throw new Error('iiko order create response did not contain order id.');
      const correlationId = correlationIdFromResponse(response);
      const creationStatus = iikoCreationStatusFromResponse(response);

      await updateItemsSuccess(client, preparedItems);
      await updateOrderSuccess(client, orderId, { iikoOrderId, correlationId, creationStatus });
      const result = buildResult(startedAt, {
        status: 'completed',
        operation,
        orderId,
        iikoOrderId,
        correlationId,
        creationStatus,
        items: { synced: preparedItems.length },
      });
      await insertOrderSyncLog(client, result, randomUUID);
      return result;
    } catch (error) {
      const message = safeErrorMessage(error);
      await updateFailure(client, orderId, itemRows, message);
      const result = buildResult(startedAt, {
        status: 'failed',
        operation,
        orderId,
        error: message,
      });
      await insertOrderSyncLog(client, result, randomUUID);
      options.logger?.warn?.('iiko order sync failed:', message);
      return result;
    }
  });
}

async function syncIikoOrderStatus(options = {}) {
  const startedAt = new Date();
  const env = options.env ?? process.env;
  const config = getIikoConfig(env);
  const randomUUID = options.randomUUID;
  if (typeof randomUUID !== 'function') throw new Error('randomUUID is required for iiko order status sync.');
  const orderId = compactText(options.orderId, 120);
  if (!orderId) throw new Error('orderId is required for iiko order status sync.');

  if (!orderSyncEnabled(env, config)) {
    return buildResult(startedAt, {
      status: 'disabled',
      operation: 'pull_status',
      orderId,
      disabled_reason: config.disabledReason || 'IIKO_ORDER_SYNC_ENABLED is false.',
    });
  }

  if (!config.organizationId) {
    const error = 'IIKO_ORGANIZATION_ID must be configured for iiko order status sync.';
    return await withClient(options.db, async (client) => {
      const result = buildResult(startedAt, { status: 'failed', operation: 'pull_status', orderId, error });
      await updateFailure(client, orderId, [], error);
      await insertOrderSyncLog(client, result, randomUUID);
      return result;
    });
  }

  return await withClient(options.db, async (client) => {
    let iikoOrderId = null;
    try {
      const order = await loadOrder(client, orderId);
      if (!order) throw new Error(`Local order "${orderId}" was not found.`);
      iikoOrderId = compactText(order.iiko_order_id, 80);
      if (!iikoOrderId) throw new Error(`Local order "${orderId}" has no iiko order id.`);

      const iikoClient = options.iikoClient || createIikoHttpClient(config, options);
      const response = await iikoClient.fetchOrderById({
        organizationIds: [config.organizationId],
        orderIds: [iikoOrderId],
      });
      const info = firstIikoOrderInfo(response, iikoOrderId);
      if (!info) throw new Error(`iiko order "${iikoOrderId}" was not found by order/by_id.`);

      const pulled = await applyPulledOrderStatus(client, order, info);

      const result = buildResult(startedAt, {
        status: 'completed',
        operation: 'pull_status',
        orderId,
        iikoOrderId,
        ...pulled,
      });
      await insertOrderSyncLog(client, result, randomUUID);
      return result;
    } catch (error) {
      const message = safeErrorMessage(error);
      await updateFailure(client, orderId, [], message);
      const result = buildResult(startedAt, {
        status: 'failed',
        operation: 'pull_status',
        orderId,
        iikoOrderId,
        error: message,
      });
      await insertOrderSyncLog(client, result, randomUUID);
      options.logger?.warn?.('iiko order status sync failed:', message);
      return result;
    }
  });
}

async function syncOpenIikoOrderStatuses(options = {}) {
  const startedAt = new Date();
  const env = options.env ?? process.env;
  const config = getIikoConfig(env);
  const randomUUID = options.randomUUID;
  if (typeof randomUUID !== 'function') throw new Error('randomUUID is required for iiko open order status sync.');

  if (!orderSyncEnabled(env, config)) {
    return buildBulkResult(startedAt, {
      status: 'disabled',
      disabled_reason: config.disabledReason || 'IIKO_ORDER_SYNC_ENABLED is false.',
    });
  }

  if (!config.organizationId) {
    return buildBulkResult(startedAt, {
      status: 'failed',
      error: 'IIKO_ORGANIZATION_ID must be configured for iiko open order status sync.',
    });
  }

  const limit = positiveInteger(options.limit ?? env.IIKO_ORDER_STATUS_SYNC_LIMIT, 50);
  return await withClient(options.db, async (client) => {
    const orders = await loadOpenIikoOrders(client, limit);
    const counts = { scanned: orders.length, synced: 0, failed: 0, closed: 0, cancelled: 0 };
    if (orders.length === 0) {
      return buildBulkResult(startedAt, { status: 'completed', orders: counts });
    }

    const orderIds = orders.map((order) => compactText(order.iiko_order_id, 80)).filter(Boolean);
    let infoByIikoOrderId;
    try {
      const iikoClient = options.iikoClient || createIikoHttpClient(config, options);
      const response = await iikoClient.fetchOrderById({
        organizationIds: [config.organizationId],
        orderIds,
      });
      infoByIikoOrderId = iikoOrderInfoMap(response);
    } catch (error) {
      const message = safeErrorMessage(error);
      for (const order of orders) {
        await updateFailure(client, order.id, [], message);
        await insertOrderSyncLog(
          client,
          buildResult(startedAt, {
            status: 'failed',
            operation: 'pull_status',
            orderId: order.id,
            iikoOrderId: order.iiko_order_id,
            error: message,
          }),
          randomUUID,
        );
      }
      options.logger?.warn?.('iiko open order status sync failed:', message);
      return buildBulkResult(startedAt, { status: 'failed', orders: { ...counts, failed: orders.length }, error: message });
    }

    for (const order of orders) {
      const iikoOrderId = compactText(order.iiko_order_id, 80);
      const info = infoByIikoOrderId.get(iikoOrderId);
      if (!info) {
        const message = `iiko order "${iikoOrderId}" was not found by order/by_id.`;
        await updateFailure(client, order.id, [], message);
        await insertOrderSyncLog(
          client,
          buildResult(startedAt, {
            status: 'failed',
            operation: 'pull_status',
            orderId: order.id,
            iikoOrderId,
            error: message,
          }),
          randomUUID,
        );
        counts.failed += 1;
        continue;
      }

      const pulled = await applyPulledOrderStatus(client, order, info);
      if (pulled.localOrderStatus === 'closed') counts.closed += 1;
      if (pulled.localOrderStatus === 'cancelled') counts.cancelled += 1;
      counts.synced += 1;
      await insertOrderSyncLog(
        client,
        buildResult(startedAt, {
          status: 'completed',
          operation: 'pull_status',
          orderId: order.id,
          iikoOrderId,
          ...pulled,
        }),
        randomUUID,
      );
    }

    return buildBulkResult(startedAt, {
      status: counts.failed > 0 ? 'failed' : 'completed',
      orders: counts,
      error: counts.failed > 0 ? `${counts.failed} iiko order status sync item(s) failed.` : null,
    });
  });
}

module.exports = {
  syncOpenIikoOrderStatuses,
  syncIikoOrderStatus,
  syncGuestOrderToIiko,
};
