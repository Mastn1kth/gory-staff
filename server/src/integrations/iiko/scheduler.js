const { getIikoConfig } = require('./sync');
const { syncOpenIikoOrderStatuses } = require('./orderSync');

function falseEnv(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'false' || text === '0' || text === 'no';
}

function orderSyncEnabled(env, config) {
  if (!config.enabled) return false;
  return !falseEnv(env.IIKO_ORDER_SYNC_ENABLED);
}

function iikoOrderStatusSyncIntervalMs(env = process.env) {
  const config = getIikoConfig(env);
  if (!orderSyncEnabled(env, config)) return 0;
  if (!config.organizationId) return 0;
  if (falseEnv(env.IIKO_ORDER_STATUS_SYNC_ENABLED)) return 0;

  const seconds = Number(env.IIKO_ORDER_STATUS_SYNC_INTERVAL_SECONDS ?? 60);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(30, Math.round(seconds)) * 1000;
}

function startIikoOrderStatusSyncScheduler(options = {}) {
  const env = options.env ?? process.env;
  const intervalMs = iikoOrderStatusSyncIntervalMs(env);
  if (intervalMs <= 0) {
    return {
      enabled: false,
      intervalMs: 0,
      timer: null,
      runNow: async () => ({ status: 'disabled' }),
      stop: () => {},
    };
  }

  const syncFn = options.syncOpenIikoOrderStatuses || syncOpenIikoOrderStatuses;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  let running = false;

  async function runNow() {
    if (running) {
      options.logger?.warn?.('iiko order status sync skipped because previous run is still active.');
      return { status: 'skipped', reason: 'already_running' };
    }
    running = true;
    try {
      return await syncFn({
        db: options.db,
        env,
        randomUUID: options.randomUUID,
        logger: options.logger,
      });
    } catch (error) {
      options.logger?.warn?.('iiko order status scheduler failed:', error.message);
      return { status: 'failed', error: error.message };
    } finally {
      running = false;
    }
  }

  const timer = setIntervalFn(() => runNow(), intervalMs);
  timer.unref?.();

  return {
    enabled: true,
    intervalMs,
    timer,
    runNow,
    stop() {
      clearIntervalFn(timer);
    },
  };
}

module.exports = {
  iikoOrderStatusSyncIntervalMs,
  startIikoOrderStatusSyncScheduler,
};
