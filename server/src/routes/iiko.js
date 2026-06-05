const { timingSafeEqual } = require('crypto');
const {
  getIikoStatus,
  getIikoStaffSyncStatus,
  processIikoOrderEvent,
  processIikoPaymentEvent,
  syncGuestOrderToIiko: defaultSyncGuestOrderToIiko,
  syncIikoOrderStatus: defaultSyncIikoOrderStatus,
  syncOpenIikoOrderStatuses: defaultSyncOpenIikoOrderStatuses,
  syncIikoMenu,
  syncIikoStaff: defaultSyncIikoStaff,
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
    can: canPermission = () => true,
    logEvent = () => {},
    recordMetric = () => {},
  } = deps;
  const syncGuestOrderToIiko = deps.syncGuestOrderToIiko || defaultSyncGuestOrderToIiko;
  const syncIikoOrderStatus = deps.syncIikoOrderStatus || defaultSyncIikoOrderStatus;
  const syncOpenIikoOrderStatuses = deps.syncOpenIikoOrderStatuses || defaultSyncOpenIikoOrderStatuses;
  const syncIikoStaff = deps.syncIikoStaff || defaultSyncIikoStaff;
  const getIikoStaffScheduler = deps.iikoStaffScheduler || (() => null);
  const activeIikoJobs = new Set();
  const scheduledIikoJobs = new Map();

  function requireIikoJobAccess(req, res, next) {
    if (canPermission(req.user.role, 'manage:menu') || canPermission(req.user.role, 'manage:staff')) {
      next();
      return;
    }
    res.status(403).json({ error: 'Недостаточно прав для просмотра задач iiko.' });
  }

  function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function iikoJobRetryDelaysMs(env = process.env) {
    const configured = String(env.IIKO_JOB_RETRY_DELAYS_MS ?? '')
      .split(',')
      .map((value) => positiveInteger(value.trim(), 0))
      .filter((value) => value > 0);
    return configured.length ? configured : [30_000, 120_000, 600_000];
  }

  function iikoJobRetryDelayMs(attemptNumber, env = process.env) {
    const delays = iikoJobRetryDelaysMs(env);
    const index = Math.max(0, Math.min(delays.length - 1, Number(attemptNumber) - 1));
    return delays[index];
  }

  function iikoJobMaxAttempts(env = process.env) {
    return positiveInteger(env.IIKO_JOB_MAX_ATTEMPTS, 3);
  }

  function parseJsonField(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return typeof value === 'object' ? value : fallback;
  }

  function iikoJobPayload(row) {
    if (!row) return null;
    return {
      ...row,
      params: parseJsonField(row.params_json, {}),
      result: parseJsonField(row.result_json, {}),
    };
  }

  async function loadIikoJob(client, id) {
    const result = await client.query('SELECT * FROM iiko_sync_jobs WHERE id = $1', [id]);
    return iikoJobPayload(result.rows[0] ?? null);
  }

  async function createIikoJob(client, jobType, params, userId, env = process.env) {
    const result = await client.query(
      `INSERT INTO iiko_sync_jobs
         (id, job_type, status, params_json, result_json, attempt_count, max_attempts, created_by, created_at, updated_at)
       VALUES ($1,$2,'queued',$3::jsonb,$4::jsonb,0,$5,$6,NOW(),NOW())
       RETURNING *`,
      [randomUUID(), jobType, JSON.stringify(params ?? {}), JSON.stringify({}), iikoJobMaxAttempts(env), userId],
    );
    return iikoJobPayload(result.rows[0]);
  }

  function resultFailed(result) {
    return result?.status === 'failed';
  }

  async function executeIikoJob(job, envSnapshot) {
    const common = {
      db: pool,
      env: envSnapshot ?? process.env,
      randomUUID,
      logger: console,
    };

    if (job.job_type === 'staff_sync') {
      return await syncIikoStaff({ ...common, triggerType: 'manual_job' });
    }
    if (job.job_type === 'menu_sync') {
      return await syncIikoMenu(common);
    }
    if (job.job_type === 'open_order_statuses') {
      return await syncOpenIikoOrderStatuses(common);
    }
    if (job.job_type === 'order_sync') {
      return await syncGuestOrderToIiko({ ...common, orderId: job.params?.order_id });
    }
    if (job.job_type === 'order_status') {
      return await syncIikoOrderStatus({ ...common, orderId: job.params?.order_id });
    }
    return { status: 'failed', error: `Unknown iiko job type: ${job.job_type}` };
  }

  function emitIikoJobResult(job, result) {
    if (result?.status !== 'completed') return;
    if (job.job_type === 'staff_sync') {
      emitChange('users', 'updated', { iiko_staff_sync: result.staff });
      return;
    }
    if (job.job_type === 'menu_sync') {
      emitChange('menu_categories', 'updated', result.categories);
      emitChange('menu_items', 'updated', result.items);
      return;
    }
    if (job.job_type === 'open_order_statuses') {
      emitChange('guest_orders', 'updated', { iiko_status_sync: result.orders });
      if (result.orders?.closed > 0) {
        emitChange('table_guest_sessions', 'updated', { iiko_status_sync: result.orders });
      }
      return;
    }
    if (job.job_type === 'order_sync') {
      emitChange('guest_orders', 'updated', { id: job.params?.order_id, iiko_order_id: result.iikoOrderId });
      emitChange('guest_order_items', 'updated', { order_id: job.params?.order_id, iiko_sync: result.items });
      return;
    }
    if (job.job_type === 'order_status') {
      emitChange('guest_orders', 'updated', {
        id: job.params?.order_id,
        iiko_order_id: result.iikoOrderId,
        iiko_order_status: result.iikoOrderStatus,
        status: result.localOrderStatus,
      });
      if (result.localOrderStatus === 'closed') {
        emitChange('table_guest_sessions', 'updated', { order_id: job.params?.order_id, status: 'ended' });
      }
    }
  }

  async function runIikoJob(jobId, envSnapshot = null) {
    if (activeIikoJobs.has(jobId)) return;
    activeIikoJobs.add(jobId);
    scheduledIikoJobs.delete(jobId);

    const client = await pool.connect();
    let job = null;
    let attemptNumber = 0;
    let maxAttempts = 3;
    try {
      job = await loadIikoJob(client, jobId);
      if (!job || job.status !== 'queued') return;
      const nextRunAt = job.next_run_at ? new Date(job.next_run_at).getTime() : 0;
      if (Number.isFinite(nextRunAt) && nextRunAt > Date.now()) {
        enqueueIikoJob(jobId, nextRunAt - Date.now(), envSnapshot);
        return;
      }

      attemptNumber = Number(job.attempt_count ?? 0) + 1;
      maxAttempts = Math.max(1, Number(job.max_attempts ?? 3));
      const running = (
        await client.query(
          `UPDATE iiko_sync_jobs
           SET status = 'running',
               attempt_count = $2,
               started_at = NOW(),
               finished_at = NULL,
               next_run_at = NULL,
               last_error = NULL,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [jobId, attemptNumber],
        )
      ).rows[0];
      emitChange('iiko_sync_jobs', 'updated', iikoJobPayload(running));

      const result = await executeIikoJob(job, envSnapshot);
      const finalStatus = resultFailed(result) ? 'failed' : 'succeeded';
      const errorMessage = result?.error ?? result?.disabled_reason ?? null;

      if (finalStatus === 'failed' && attemptNumber < maxAttempts) {
        const delayMs = iikoJobRetryDelayMs(attemptNumber, envSnapshot ?? process.env);
        const nextRunAtIso = new Date(Date.now() + delayMs).toISOString();
        const updated = (
          await client.query(
            `UPDATE iiko_sync_jobs
             SET status = 'queued',
                 result_json = $2::jsonb,
                 message = $3,
                 next_run_at = $4,
                 last_error = $5,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
              jobId,
              JSON.stringify(result ?? {}),
              `Retry ${attemptNumber + 1}/${maxAttempts} scheduled after iiko failure.`,
              nextRunAtIso,
              errorMessage,
            ],
          )
        ).rows[0];
        recordMetric('iiko_sync_job_retries_total', { job_type: job.job_type });
        logEvent('warn', 'iiko_sync_job_retry_scheduled', {
          job_id: jobId,
          job_type: job.job_type,
          attempt: attemptNumber,
          next_attempt: attemptNumber + 1,
          max_attempts: maxAttempts,
          next_run_at: nextRunAtIso,
          error: errorMessage,
        });
        emitChange('iiko_sync_jobs', 'updated', iikoJobPayload(updated));
        enqueueIikoJob(jobId, delayMs, envSnapshot);
        return;
      }

      const updated = (
        await client.query(
          `UPDATE iiko_sync_jobs
           SET status = $2,
               result_json = $3::jsonb,
               message = $4,
               next_run_at = NULL,
               last_error = $5,
               finished_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [jobId, finalStatus, JSON.stringify(result ?? {}), errorMessage, finalStatus === 'failed' ? errorMessage : null],
        )
      ).rows[0];
      emitIikoJobResult(job, result);
      recordMetric('iiko_sync_jobs_total', { job_type: job.job_type, status: finalStatus });
      emitChange('iiko_sync_jobs', 'updated', iikoJobPayload(updated));
    } catch (error) {
      if (attemptNumber > 0 && attemptNumber < maxAttempts) {
        const delayMs = iikoJobRetryDelayMs(attemptNumber, envSnapshot ?? process.env);
        const nextRunAtIso = new Date(Date.now() + delayMs).toISOString();
        const updated = (
          await client.query(
            `UPDATE iiko_sync_jobs
             SET status = 'queued',
                 result_json = $2::jsonb,
                 message = $3,
                 next_run_at = $4,
                 last_error = $5,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
              jobId,
              JSON.stringify({ status: 'failed', error: error.message }),
              `Retry ${attemptNumber + 1}/${maxAttempts} scheduled after iiko exception.`,
              nextRunAtIso,
              error.message,
            ],
          )
        ).rows[0];
        recordMetric('iiko_sync_job_retries_total', { job_type: job?.job_type ?? 'unknown' });
        logEvent('warn', 'iiko_sync_job_retry_scheduled', {
          job_id: jobId,
          job_type: job?.job_type,
          attempt: attemptNumber,
          next_attempt: attemptNumber + 1,
          max_attempts: maxAttempts,
          next_run_at: nextRunAtIso,
          error: error.message,
        });
        emitChange('iiko_sync_jobs', 'updated', iikoJobPayload(updated));
        enqueueIikoJob(jobId, delayMs, envSnapshot);
        return;
      }

      const updated = (
        await client.query(
          `UPDATE iiko_sync_jobs
           SET status = 'failed',
               result_json = $2::jsonb,
               message = $3,
               next_run_at = NULL,
               last_error = $3,
               finished_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [jobId, JSON.stringify({ status: 'failed', error: error.message }), error.message],
        )
      ).rows[0];
      recordMetric('iiko_sync_jobs_total', { job_type: job?.job_type ?? 'unknown', status: 'failed' });
      logEvent('error', 'iiko_sync_job_failed', { job_id: jobId, job_type: job?.job_type, error: error.message });
      emitChange('iiko_sync_jobs', 'updated', iikoJobPayload(updated));
    } finally {
      activeIikoJobs.delete(jobId);
      client.release();
    }
  }

  function enqueueIikoJob(jobId, delayMs = 0, envSnapshot = null) {
    const existingTimer = scheduledIikoJobs.get(jobId);
    if (existingTimer) clearTimeout(existingTimer);

    const run = () => {
      scheduledIikoJobs.delete(jobId);
      void runIikoJob(jobId, envSnapshot);
    };

    if (delayMs > 0) {
      const timer = setTimeout(run, delayMs);
      timer.unref?.();
      scheduledIikoJobs.set(jobId, timer);
      return;
    }
    setImmediate(run);
  }

  function resumeQueuedIikoJobs() {
    const timer = setTimeout(async () => {
      try {
        const result = await pool.query(
          `SELECT id, next_run_at
           FROM iiko_sync_jobs
           WHERE status = 'queued'
           ORDER BY COALESCE(next_run_at, created_at) ASC
           LIMIT 20`,
        );
        for (const job of result.rows) {
          const nextRunAt = job.next_run_at ? new Date(job.next_run_at).getTime() : 0;
          const delayMs = Number.isFinite(nextRunAt) && nextRunAt > Date.now() ? nextRunAt - Date.now() : 0;
          enqueueIikoJob(job.id, delayMs);
        }
      } catch (error) {
        logEvent('warn', 'iiko_sync_jobs_resume_failed', { error: error.message });
      }
    }, 1000);
    timer.unref?.();
  }

  async function enqueueIikoSyncJob(req, res, jobType, params = {}) {
    const client = await pool.connect();
    try {
      const envSnapshot = { ...process.env };
      const job = await createIikoJob(client, jobType, params, req.user.id, envSnapshot);
      emitChange('iiko_sync_jobs', 'created', job);
      enqueueIikoJob(job.id, 0, envSnapshot);
      res.status(202).json({ job });
    } finally {
      client.release();
    }
  }

  resumeQueuedIikoJobs();

  app.get(
    '/iiko/status',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (_req, res) => {
      const scheduler = typeof getIikoStaffScheduler === 'function' ? getIikoStaffScheduler() : null;
      const [menuStatus, staffStatus] = await Promise.all([
        getIikoStatus(pool, process.env),
        getIikoStaffSyncStatus(pool, process.env, scheduler),
      ]);
      res.json({
        ...menuStatus,
        staffSync: staffStatus,
      });
    }),
  );

  app.post(
    '/iiko/sync/staff',
    authMiddleware,
    requirePermission('manage:staff'),
    asyncHandler(async (req, res) => {
      await enqueueIikoSyncJob(req, res, 'staff_sync');
    }),
  );

  app.post(
    '/iiko/sync/menu',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      await enqueueIikoSyncJob(req, res, 'menu_sync');
    }),
  );

  app.post(
    '/iiko/sync/orders/statuses',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      await enqueueIikoSyncJob(req, res, 'open_order_statuses');
    }),
  );

  app.post(
    '/iiko/sync/orders/:orderId',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      await enqueueIikoSyncJob(req, res, 'order_sync', { order_id: req.params.orderId });
    }),
  );

  app.post(
    '/iiko/sync/orders/:orderId/status',
    authMiddleware,
    requirePermission('manage:menu'),
    asyncHandler(async (req, res) => {
      await enqueueIikoSyncJob(req, res, 'order_status', { order_id: req.params.orderId });
    }),
  );

  app.get(
    '/iiko/jobs',
    authMiddleware,
    requireIikoJobAccess,
    asyncHandler(async (_req, res) => {
      const result = await pool.query(
        `SELECT *
         FROM iiko_sync_jobs
         ORDER BY created_at DESC
         LIMIT 50`,
      );
      res.json({ items: result.rows.map(iikoJobPayload) });
    }),
  );

  app.get(
    '/iiko/jobs/:id',
    authMiddleware,
    requireIikoJobAccess,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const job = await loadIikoJob(client, req.params.id);
        if (!job) {
          res.status(404).json({ error: 'Задача iiko не найдена.' });
          return;
        }
        res.json({ job });
      } finally {
        client.release();
      }
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
