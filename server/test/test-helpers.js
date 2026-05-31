const { spawn } = require('node:child_process');
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
  const port = 6100 + Math.floor(Math.random() * 500);
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const health = await api(baseUrl, '/health');
      if (health.ok) {
        const close = () => child.kill('SIGTERM');
        return {
          baseUrl,
          close,
          stop: close,
        };
      }
    } catch {
      await delay(250);
    }
  }

  child.kill('SIGTERM');
  throw new Error(`Server did not start.\nSTDOUT:\n${stdout.join('')}\nSTDERR:\n${stderr.join('')}`);
}

module.exports = {
  api,
  readJson,
  startTestServer,
};
