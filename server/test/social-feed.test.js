const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const serverRoot = path.resolve(__dirname, '..');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
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

async function expectApiError(request) {
  try {
    await request();
  } catch (error) {
    return error;
  }
  throw new Error('Expected API request to fail.');
}

async function startTestServer(extraEnv = {}) {
  const port = 5600 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      USE_PGMEM: '1',
      DATABASE_URL: 'memory',
      SEED_DEMO_DATA: 'always',
      DISABLE_PUSH: '1',
      JWT_SECRET: 'test-jwt-secret-for-gory-staff-social-feed-2026',
      GUEST_JWT_SECRET: 'test-guest-secret-for-gory-staff-social-feed-2026',
      INITIAL_MANAGER_LOGIN: 'owner@example.test',
      INITIAL_MANAGER_PASSWORD: 'OwnerTestPass-2026!',
      DEMO_STAFF_PASSWORD: 'StaffTestPass-2026!',
      INSTAGRAM_ACCESS_TOKEN: '',
      INSTAGRAM_BUSINESS_ACCOUNT_ID: '',
      VK_ACCESS_TOKEN: '',
      VK_GROUP_ID: '',
      VK_SEARCH_QUERY: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const health = await api(baseUrl, '/health');
      if (health.ok) {
        return {
          baseUrl,
          stop: () => child.kill('SIGTERM'),
        };
      }
    } catch {
      await delay(250);
    }
  }

  child.kill('SIGTERM');
  throw new Error(`Server did not start.\nSTDOUT:\n${stdout.join('')}\nSTDERR:\n${stderr.join('')}`);
}

test('smm manager publishes guest news with media and guests can like and comment after login', async (t) => {
  const server = await startTestServer();
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });

  await api(server.baseUrl, '/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      name: 'SMM Manager',
      phone: '+7 900 100-99-01',
      login: 'smm',
      password: 'SmmManager-2026!',
      role: 'smm_manager',
      position: 'SMM менеджер',
      status: 'on_shift',
    }),
  });

  const smm = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'smm', password: 'SmmManager-2026!' }),
  });
  assert.equal(smm.user.role, 'smm_manager');

  const smmSync = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${smm.token}` },
  });
  assert.ok(smmSync.sections.includes('smm'));

  const post = await api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${smm.token}` },
    body: JSON.stringify({
      title: 'Новое меню',
      body: 'Показываем гостям новый пост с фото и видео.',
      status: 'published',
      media: [
        { media_type: 'image', url: 'https://example.test/dish.jpg' },
        { media_type: 'video', url: 'https://example.test/dish.mp4', thumbnail_url: 'https://example.test/dish-thumb.jpg' },
      ],
    }),
  });
  assert.equal(post.status, 'published');
  assert.equal(post.media.length, 2);

  const publicFeed = await api(server.baseUrl, '/guest/news');
  assert.equal(publicFeed.items[0].id, post.id);
  assert.equal(publicFeed.items[0].like_count, 0);
  assert.equal(publicFeed.items[0].comment_count, 0);

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'News Guest',
      phone: '+7 900 300-44-55',
      personal_data_consent: true,
    }),
  });

  const anonLike = await expectApiError(() =>
    api(server.baseUrl, `/guest/news/${post.id}/like`, {
      method: 'POST',
    }),
  );
  assert.equal(anonLike.status, 401);

  const like = await api(server.baseUrl, `/guest/news/${post.id}/like`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
  });
  assert.equal(like.liked, true);

  const comment = await api(server.baseUrl, `/guest/news/${post.id}/comments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ text: 'Красиво, хочу попробовать.' }),
  });
  assert.equal(comment.status, 'visible');
  assert.equal(comment.text, 'Красиво, хочу попробовать.');

  const badComment = await expectApiError(() =>
    api(server.baseUrl, `/guest/news/${post.id}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest.token}` },
      body: JSON.stringify({ text: 'дурак' }),
    }),
  );
  assert.equal(badComment.status, 400);

  const guestFeed = await api(server.baseUrl, '/guest/news', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });
  assert.equal(guestFeed.items[0].liked_by_me, true);
  assert.equal(guestFeed.items[0].like_count, 1);
  assert.equal(guestFeed.items[0].comment_count, 1);
  assert.equal(guestFeed.items[0].comments[0].guest_name, 'News Guest');
});

test('social import endpoint is wired and reports missing Instagram and VK credentials', async (t) => {
  const server = await startTestServer();
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });

  const result = await api(server.baseUrl, '/social/import/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ sources: ['instagram', 'vk'] }),
  });

  assert.deepEqual(result.sources.map((item) => item.source), ['instagram', 'vk']);
  assert.ok(result.sources.every((item) => item.status === 'disabled'));
});

test('social import credentials are documented in env example', () => {
  const envExample = fs.readFileSync(path.join(serverRoot, '.env.example'), 'utf8');
  assert.match(envExample, /INSTAGRAM_ACCESS_TOKEN=/);
  assert.match(envExample, /INSTAGRAM_BUSINESS_ACCOUNT_ID=/);
  assert.match(envExample, /VK_ACCESS_TOKEN=/);
  assert.match(envExample, /VK_GROUP_ID=/);
  assert.match(envExample, /VK_SEARCH_QUERY=/);
});
