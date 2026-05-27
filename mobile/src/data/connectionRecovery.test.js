const assert = require('node:assert/strict');
const test = require('node:test');

let connectionRecovery = {};
try {
  connectionRecovery = require('./connectionRecovery');
} catch {
  connectionRecovery = {};
}

test('recovers by resolving another API URL when the saved target is offline', async () => {
  assert.equal(typeof connectionRecovery.resolveReachableConnection, 'function');

  const calls = [];
  const result = await connectionRecovery.resolveReachableConnection(
    'http://192.168.0.44:4000',
    async (url, timeoutMs) => {
      calls.push(['ping', url, timeoutMs]);
      return false;
    },
    async (preferredUrl) => {
      calls.push(['resolve', preferredUrl]);
      return 'https://app.gory-staff.ru';
    },
  );

  assert.deepEqual(result, {
    online: true,
    apiUrl: 'https://app.gory-staff.ru',
  });
  assert.deepEqual(calls, [
    ['ping', 'http://192.168.0.44:4000', 5000],
    ['resolve', 'http://192.168.0.44:4000'],
  ]);
});

test('keeps the saved API URL when it is already reachable', async () => {
  assert.equal(typeof connectionRecovery.resolveReachableConnection, 'function');

  let resolverCalled = false;
  const result = await connectionRecovery.resolveReachableConnection(
    'https://app.gory-staff.ru/',
    async () => true,
    async () => {
      resolverCalled = true;
      return 'http://192.168.0.7:4000';
    },
  );

  assert.deepEqual(result, {
    online: true,
    apiUrl: 'https://app.gory-staff.ru',
  });
  assert.equal(resolverCalled, false);
});
