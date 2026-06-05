const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { test } = require('node:test');

const { ExternalFetchTimeoutError, fetchWithTimeout } = require('../src/http');
const { createIikoHttpClient } = require('../src/integrations/iiko/client');
const { TwilioClient } = require('../src/integrations/twilio');

test('fetchWithTimeout aborts slow external requests without leaking URL secrets', async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        'abort',
        () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true },
      );
    });

  try {
    await assert.rejects(
      () => fetchWithTimeout('https://example.test/api?access_token=secret-token', { timeoutMs: 5 }),
      (error) => {
        assert.ok(error instanceof ExternalFetchTimeoutError);
        assert.equal(error.status, 504);
        assert.equal(error.code, 'EXTERNAL_FETCH_TIMEOUT');
        assert.equal(error.message.includes('secret-token'), false);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('iiko client aborts provider requests with the shared timeout helper', async () => {
  const client = createIikoHttpClient(
    {
      apiBase: 'https://iiko.example.test',
      apiLogin: 'test-login',
    },
    {
      timeoutMs: 5,
      fetchImpl: (_url, options = {}) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('The operation was aborted.');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }),
    },
  );

  await assert.rejects(
    () => client.fetchOrganizations(),
    (error) => {
      assert.ok(error instanceof ExternalFetchTimeoutError);
      assert.equal(error.code, 'EXTERNAL_FETCH_TIMEOUT');
      assert.equal(error.message.includes('test-login'), false);
      return true;
    },
  );
});

test('Twilio client destroys hung HTTPS requests on timeout without leaking credentials', async () => {
  const originalRequest = https.request;
  https.request = () => {
    const req = new EventEmitter();
    req.setTimeout = (_timeoutMs, callback) => {
      setImmediate(callback);
      return req;
    };
    req.destroy = (error) => {
      setImmediate(() => req.emit('error', error));
      return req;
    };
    req.write = () => {};
    req.end = () => {};
    return req;
  };

  try {
    const client = new TwilioClient('sid-secret-value', 'auth-token-secret', '+10000000000', { timeoutMs: 5 });
    await assert.rejects(
      () => client.request('GET', '/Messages.json'),
      (error) => {
        assert.ok(error instanceof ExternalFetchTimeoutError);
        assert.equal(error.code, 'EXTERNAL_FETCH_TIMEOUT');
        assert.equal(error.message.includes('auth-token-secret'), false);
        return true;
      },
    );
  } finally {
    https.request = originalRequest;
  }
});
