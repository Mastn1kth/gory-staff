const { timingSafeEqual } = require('crypto');
const {
  getIikoStatus,
  processIikoOrderEvent,
  processIikoPaymentEvent,
  syncGuestOrderToIiko: defaultSyncGuestOrderToIiko,
  syncIikoOrderStatus: defaultSyncIikoOrderStatus,
  syncOpenIikoOrderStatuses: defaultSyncOpenIikoOrderStatuses,
  syncIikoMenu,
} = require('../integrations/iiko');

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''));
  const rightBuffer = Buffer.from(String(right ?? ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function iikoWebhookSecret(req) {
  const authHeader = String(req.get('authorization') ?? '');
  if (authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7).trim();
  return (
    req.get('x-gory-iiko-secret') ||
    req.get('x-iiko-webhook-secret') ||
    req.get('x-webhook-secret') ||
    ''
  );
}

function requireIikoWebhookSecret(req, res) {
  const configured = String(process.env.IIKO_WEBHOOK_SECRET ?? '').trim();
  if (!configured) {
    res.status(503).json({ error: 'IIKO_WEBHOOK_SECRET is not configured.' });
    return false;
  }
  if (!safeEqualText(iikoWebhookSecret(req), configured)) {
    res.status(401).json({ error: 'Invalid iiko webhook secret.' });
    return false;
  }
  return true;
}

function registerIikoRoutes(app, deps) {
  const {
    pool,
    asyncHandler,
    authMiddleware,
    requirePermission,
    randomUUID,
    emitChange,
  } = deps;
  const syncGuestOrderToIiko = deps.syncGuestOrderToIiko || defaultSyncGuestOrderToIiko;
  const syncIikoOrderStatus = deps.syncIikoOrderStatus || defaultSyncIikoOrderStatus;
  const syncOpenIikoOrderStatuses = deps.syncOpenIikoOrderStatuses || defaultSyncOpenIikoOrderStatuses;

  app.get(
    '/iiko/status',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (_req, res) => {
      res.json(await getIikoStatus(pool, process.env));
    }),
  );

  app.post(
    '/iiko/sync/menu',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (_req, res) => {
      const result = await syncIikoMenu({
        db: pool,
        env: process.env,
        randomUUID,
        logger: console,
      });

      if (result.status === 'completed') {
        emitChange('menu_categories', 'updated', result.categories);
        emitChange('menu_items', 'updated', result.items);
      }

      res.status(result.status === 'failed' ? 502 : 200).json(result);
    }),
  );

  app.post(
    '/iiko/sync/orders/statuses',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      const result = await syncOpenIikoOrderStatuses({
        db: pool,
        env: process.env,
        randomUUID,
        logger: console,
      });

      if (result.status === 'completed') {
        emitChange('guest_orders', 'updated', { iiko_status_sync: result.orders });
        if (result.orders?.closed > 0) {
          emitChange('table_guest_sessions', 'updated', { iiko_status_sync: result.orders });
        }
      }

      res.status(result.status === 'failed' ? 502 : 200).json(result);
    }),
  );

  app.post(
    '/iiko/sync/orders/:orderId',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      const result = await syncGuestOrderToIiko({
        db: pool,
        orderId: req.params.orderId,
        env: process.env,
        randomUUID,
        logger: console,
      });

      if (result.status === 'completed') {
        emitChange('guest_orders', 'updated', { id: req.params.orderId, iiko_order_id: result.iikoOrderId });
        emitChange('guest_order_items', 'updated', { order_id: req.params.orderId, iiko_sync: result.items });
      }

      res.status(result.status === 'failed' ? 502 : 200).json(result);
    }),
  );

  app.post(
    '/iiko/sync/orders/:orderId/status',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      const result = await syncIikoOrderStatus({
        db: pool,
        orderId: req.params.orderId,
        env: process.env,
        randomUUID,
        logger: console,
      });

      if (result.status === 'completed') {
        emitChange('guest_orders', 'updated', {
          id: req.params.orderId,
          iiko_order_id: result.iikoOrderId,
          iiko_order_status: result.iikoOrderStatus,
          status: result.localOrderStatus,
        });
        if (result.localOrderStatus === 'closed') {
          emitChange('table_guest_sessions', 'updated', { order_id: req.params.orderId, status: 'ended' });
        }
      }

      res.status(result.status === 'failed' ? 502 : 200).json(result);
    }),
  );

  app.post(
    '/iiko/events/payment-paid',
    asyncHandler(async (req, res) => {
      if (!requireIikoWebhookSecret(req, res)) return;

      const result = await processIikoPaymentEvent({
        db: pool,
        body: req.body ?? {},
        randomUUID,
        addGuestBonusTransaction: deps.addGuestBonusTransaction,
        createGuestNotification: deps.createGuestNotification,
        emitChange,
        logger: console,
      });

      res.status(result.duplicate ? 200 : result.status === 'ignored' ? 202 : 201).json(result);
    }),
  );

  app.post(
    '/iiko/events/order-updated',
    asyncHandler(async (req, res) => {
      if (!requireIikoWebhookSecret(req, res)) return;

      const result = await processIikoOrderEvent({
        db: pool,
        body: req.body ?? {},
        randomUUID,
        emitChange,
        logger: console,
      });

      res.status(201).json(result);
    }),
  );

  app.post(
    '/iiko/webhooks/order-updated',
    asyncHandler(async (req, res) => {
      if (!requireIikoWebhookSecret(req, res)) return;

      const result = await processIikoOrderEvent({
        db: pool,
        body: req.body ?? {},
        randomUUID,
        emitChange,
        logger: console,
      });

      res.status(201).json(result);
    }),
  );

  app.post(
    '/iiko/webhooks/payment-paid',
    asyncHandler(async (req, res) => {
      if (!requireIikoWebhookSecret(req, res)) return;

      const result = await processIikoPaymentEvent({
        db: pool,
        body: req.body ?? {},
        randomUUID,
        addGuestBonusTransaction: deps.addGuestBonusTransaction,
        createGuestNotification: deps.createGuestNotification,
        emitChange,
        logger: console,
      });

      res.status(result.duplicate ? 200 : result.status === 'ignored' ? 202 : 201).json(result);
    }),
  );
}

module.exports = { registerIikoRoutes };
