const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  classifyIikoConnectorEvent,
  parseArgs,
  parseConnectorEnvFile,
  readConnectorEventsFromText,
  runIikoEventConnector,
  runIikoEventConnectorWatch,
  sendIikoConnectorEvent,
} = require('./iiko-event-connector');

test('classifies order updates and paid payments for the server webhooks', () => {
  assert.equal(classifyIikoConnectorEvent({ type: 'order_updated', order_id: 'order-1' }), 'order-updated');
  assert.equal(classifyIikoConnectorEvent({ event_type: 'order_changed', order_id: 'order-2' }), 'order-updated');
  assert.equal(classifyIikoConnectorEvent({ type: 'payment_paid', order_id: 'order-3', payment_id: 'pay-1' }), 'payment-paid');
  assert.equal(classifyIikoConnectorEvent({ status: 'paid', order_id: 'order-4', payment: { id: 'pay-2' } }), 'payment-paid');
  assert.equal(classifyIikoConnectorEvent({ order_id: 'order-5', payment_id: 'pay-draft' }), 'order-updated');
  assert.equal(classifyIikoConnectorEvent({ type: 'menu_updated' }), null);
});

test('reads connector events from one JSON object, JSON array, or JSON lines', () => {
  assert.deepEqual(readConnectorEventsFromText('{"order_id":"order-1"}'), [{ order_id: 'order-1' }]);
  assert.deepEqual(readConnectorEventsFromText('[{"order_id":"order-1"},{"order_id":"order-2"}]'), [
    { order_id: 'order-1' },
    { order_id: 'order-2' },
  ]);
  assert.deepEqual(readConnectorEventsFromText('\n{"order_id":"order-1"}\n{"order_id":"order-2"}\n'), [
    { order_id: 'order-1' },
    { order_id: 'order-2' },
  ]);
});

test('sends connector events to the matching iiko webhook with the shared secret', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 201,
      text: async () => '{"ok":true}',
    };
  };

  const result = await sendIikoConnectorEvent({
    event: { type: 'payment_paid', order_id: 'order-1', payment_id: 'pay-1', amount: 1250 },
    serverUrl: 'http://127.0.0.1:4000/',
    secret: 'test-secret',
    fetchImpl,
  });

  assert.equal(result.status, 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:4000/iiko/events/payment-paid');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(calls[0].options.headers['x-gory-iiko-secret'], 'test-secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    type: 'payment_paid',
    order_id: 'order-1',
    payment_id: 'pay-1',
    amount: 1250,
  });
});

test('run connector sends new file events once and records a state file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gory-iiko-connector-'));
  const eventsPath = path.join(tempDir, 'events.jsonl');
  const statePath = path.join(tempDir, 'state.json');
  await fs.writeFile(
    eventsPath,
    [
      JSON.stringify({ event_id: 'evt-1', type: 'order_updated', order_id: 'order-1', amount: 1000 }),
      JSON.stringify({ event_id: 'evt-2', type: 'payment_paid', order_id: 'order-1', payment_id: 'pay-1', amount: 1000 }),
    ].join('\n'),
    'utf8',
  );

  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 201,
      text: async () => '{"ok":true}',
    };
  };

  const first = await runIikoEventConnector({
    file: eventsPath,
    stateFile: statePath,
    serverUrl: 'http://127.0.0.1:4000',
    secret: 'test-secret',
    fetchImpl,
  });
  const second = await runIikoEventConnector({
    file: eventsPath,
    stateFile: statePath,
    serverUrl: 'http://127.0.0.1:4000',
    secret: 'test-secret',
    fetchImpl,
  });

  assert.deepEqual(first, { read: 2, sent: 2, skipped: 0, failed: 0 });
  assert.deepEqual(second, { read: 2, sent: 0, skipped: 2, failed: 0 });
  assert.deepEqual(urls, [
    'http://127.0.0.1:4000/iiko/events/order-updated',
    'http://127.0.0.1:4000/iiko/events/payment-paid',
  ]);
  assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')).sentEventKeys.sort(), ['event:evt-1', 'event:evt-2']);
});

test('run connector counts failed sends and leaves failed events retryable', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gory-iiko-failure-'));
  const eventsPath = path.join(tempDir, 'events.jsonl');
  const statePath = path.join(tempDir, 'state.json');
  await fs.writeFile(
    eventsPath,
    JSON.stringify({ event_id: 'evt-fail', type: 'payment_paid', order_id: 'order-1', amount: 1000 }),
    'utf8',
  );

  const result = await runIikoEventConnector({
    file: eventsPath,
    stateFile: statePath,
    serverUrl: 'http://127.0.0.1:4000',
    secret: 'test-secret',
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '{"error":"server_down"}',
    }),
  });

  assert.deepEqual(result, { read: 1, sent: 0, skipped: 0, failed: 1 });
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.deepEqual(state.sentEventKeys, []);
});

test('parses connector env files without leaking quoted secrets into code', () => {
  assert.deepEqual(
    parseConnectorEnvFile(`
      # local server config
      GORY_SERVER_URL=http://127.0.0.1:4100
      IIKO_WEBHOOK_SECRET="secret with spaces"
      EMPTY=
    `),
    {
      GORY_SERVER_URL: 'http://127.0.0.1:4100',
      IIKO_WEBHOOK_SECRET: 'secret with spaces',
      EMPTY: '',
    },
  );
});

test('watch connector keeps polling a directory and sends events that appear later', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gory-iiko-watch-'));
  const eventsDir = path.join(tempDir, 'events');
  const statePath = path.join(tempDir, 'state.json');
  await fs.mkdir(eventsDir);

  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 201,
      text: async () => '{"ok":true}',
    };
  };

  let delayCount = 0;
  const summary = await runIikoEventConnectorWatch({
    dir: eventsDir,
    stateFile: statePath,
    serverUrl: 'http://127.0.0.1:4000',
    secret: 'test-secret',
    watchIterations: 2,
    watchIntervalMs: 1,
    fetchImpl,
    delayImpl: async () => {
      delayCount += 1;
      await fs.writeFile(
        path.join(eventsDir, 'payment.jsonl'),
        JSON.stringify({ event_id: 'evt-paid-later', type: 'payment_paid', order_id: 'order-1', amount: 900 }),
        'utf8',
      );
    },
  });

  assert.deepEqual(summary, { iterations: 2, read: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(delayCount, 1);
  assert.deepEqual(urls, ['http://127.0.0.1:4000/iiko/events/payment-paid']);
});

test('cli parser supports watch mode, env file, and polling interval', () => {
  assert.deepEqual(parseArgs(['--dir', 'runtime/iiko/events', '--watch', '--interval-ms', '750', '--env-file', 'server/.env']), {
    dir: 'runtime/iiko/events',
    watch: true,
    watchIntervalMs: 750,
    envFile: 'server/.env',
  });
});

test('windows launcher starts the iiko connector in watch mode with runtime logs', async () => {
  const launcher = await fs.readFile(path.join(__dirname, 'bat', 'START_IIKO_EVENT_CONNECTOR.bat'), 'utf8');
  assert.match(launcher, /iiko-event-connector\.js/);
  assert.match(launcher, /--watch/);
  assert.match(launcher, /runtime\\iiko\\events/);
  assert.match(launcher, /iiko-event-connector\.out\.log/);
  assert.match(launcher, /iiko-event-connector\.pid/);
});
