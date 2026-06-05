const DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS = 10000;

class ExternalFetchTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`External request timed out after ${timeoutMs}ms.`);
    this.name = 'ExternalFetchTimeoutError';
    this.code = 'EXTERNAL_FETCH_TIMEOUT';
    this.status = 504;
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function timeoutFromEnv(name, fallback = DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS) {
  return positiveInteger(process.env[name], fallback);
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

async function fetchWithTimeout(url, options = {}) {
  const {
    timeoutMs = timeoutFromEnv('EXTERNAL_FETCH_TIMEOUT_MS'),
    fetchImpl = global.fetch,
    signal: callerSignal,
    ...fetchOptions
  } = options;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime.');
  }
  const effectiveTimeoutMs = positiveInteger(timeoutMs, DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal) {
    if (callerSignal.aborted) {
      abortFromCaller();
    } else {
      callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);
  timeout.unref?.();

  try {
    return await fetchImpl(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error) && timedOut) throw new ExternalFetchTimeoutError(effectiveTimeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener?.('abort', abortFromCaller);
  }
}

module.exports = {
  DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS,
  ExternalFetchTimeoutError,
  fetchWithTimeout,
  timeoutFromEnv,
};
