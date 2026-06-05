const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function api(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await readJson(response);
  if (!response.ok) {
    const error = new Error(body?.error || response.statusText);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function getFreePort(host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref?.();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function probeHealth(baseUrl, timeoutMs = 1000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    const body = await readJson(response);
    return { ok: response.ok && Boolean(body?.ok), body };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForServerHealth({ baseUrl, child, stdout, stderr, timeoutMs = 25000 }) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) break;
    try {
      const health = await probeHealth(baseUrl);
      if (health.ok) return health.body;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }

  child.kill('SIGTERM');
  const details = lastError ? `\nLAST ERROR:\n${lastError.message}` : '';
  throw new Error(`Server did not start.${details}\nSTDOUT:\n${stdout.join('')}\nSTDERR:\n${stderr.join('')}`);
}

function serverEnv(port, extraEnv = {}) {
  return {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    USE_PGMEM: '1',
    DATABASE_URL: 'memory',
    SEED_DEMO_DATA: 'always',
    DISABLE_PUSH: '1',
    JWT_SECRET: 'test-jwt-secret-for-gory-staff-shared-helper-2026',
    GUEST_JWT_SECRET: 'test-guest-secret-for-gory-staff-shared-helper-2026',
    INITIAL_MANAGER_LOGIN: 'owner@example.test',
    INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
    DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
    ...extraEnv,
  };
}

async function startTestServer(extraEnv = {}) {
  const port = await getFreePort();
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: serverEnv(port, extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServerHealth({ baseUrl, child, stdout, stderr });
  const close = () => child.kill('SIGTERM');
  return {
    baseUrl,
    close,
    stop: close,
  };
}

module.exports = {
  api,
  delay,
  getFreePort,
  readJson,
  serverEnv,
  startTestServer,
  waitForServerHealth,
};
