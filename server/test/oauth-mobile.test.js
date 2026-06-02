const assert = require('node:assert/strict');
const { test } = require('node:test');

const { readJson, startTestServer } = require('./test-helpers.js');

async function getJson(url) {
  const response = await fetch(url);
  return {
    response,
    body: await readJson(response),
  };
}

test('yandex mobile OAuth auth URL uses the app deep link redirect', async (t) => {
  const server = await startTestServer({
    YANDEX_CLIENT_ID: 'test-yandex-client-id',
  });
  t.after(() => server.close());

  const mobileRedirectUri = 'gory-staff://oauth/yandex';
  const { response, body } = await getJson(
    `${server.baseUrl}/oauth/yandex/url?mobile_redirect_uri=${encodeURIComponent(mobileRedirectUri)}`,
  );

  assert.equal(response.status, 200);
  const authUrl = new URL(body.url);
  assert.equal(authUrl.searchParams.get('redirect_uri'), mobileRedirectUri);
  assert.ok(body.state);
});

test('vk mobile OAuth auth URL uses the app deep link redirect', async (t) => {
  const server = await startTestServer({
    VK_CLIENT_ID: '123456',
  });
  t.after(() => server.close());

  const mobileRedirectUri = 'gory-staff://oauth/vk';
  const { response, body } = await getJson(
    `${server.baseUrl}/oauth/vk/url?mobile_redirect_uri=${encodeURIComponent(mobileRedirectUri)}`,
  );

  assert.equal(response.status, 200);
  const authUrl = new URL(body.url);
  assert.equal(authUrl.searchParams.get('redirect_uri'), mobileRedirectUri);
  assert.ok(body.state);
});

test('mobile OAuth URL rejects an unregistered deep link redirect', async (t) => {
  const server = await startTestServer({
    YANDEX_CLIENT_ID: 'test-yandex-client-id',
  });
  t.after(() => server.close());

  const { response, body } = await getJson(
    `${server.baseUrl}/oauth/yandex/url?mobile_redirect_uri=${encodeURIComponent('evil://oauth/yandex')}`,
  );

  assert.equal(response.status, 400);
  assert.match(body.error, /redirect_uri/i);
});
