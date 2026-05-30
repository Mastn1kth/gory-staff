const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const PUBLIC_URL = 'https://app.gory-staff.ru';
const OLD_TAILSCALE_URL = 'https://win-llm6olkrhem.taile5d173.ts.net';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('desktop control panel checks the configured public domain', () => {
  const control = read('gory-control/GoryControl.ps1');

  assert.match(control, new RegExp(`\\$publicUrl = '${PUBLIC_URL.replaceAll('.', '\\.')}'`));
  assert.match(control, /gory-edge-connector/i);
  assert.match(control, /Проверить домен/i);
  assert.doesNotMatch(control, new RegExp(OLD_TAILSCALE_URL.replaceAll('.', '\\.')));
});

test('start and stop scripts manage the public HTTPS relay for the public domain', () => {
  const start = read('tools/bat/START_GORY_STAFF.bat');
  const stop = read('tools/bat/STOP_GORY_STAFF.bat');

  assert.match(start, /START_PUBLIC_RELAY\.bat/i);
  assert.match(start, /edge-connector\.log/i);
  assert.match(start, /Public relay started/i);
  assert.match(start, new RegExp(PUBLIC_URL.replaceAll('.', '\\.')));

  assert.match(stop, /gory-edge-connector\\?\.js/i);
  assert.match(stop, /Stopping public mobile relay/i);
});

test('desktop start script keeps the local server and public relay alive', () => {
  const start = read('tools/bat/START_GORY_STAFF.bat');
  const stop = read('tools/bat/STOP_GORY_STAFF.bat');
  const watchdog = read('tools/Watch-GoryStaff.ps1');

  assert.match(start, /Watch-GoryStaff\.ps1/i);
  assert.match(start, /gory-watchdog\.pid/i);
  assert.match(start, /watchdog/i);
  assert.doesNotMatch(start, /Server stopped or port 4000 is not answering[\s\S]*exit \/b 1/i);

  assert.match(stop, /gory-watchdog\.pid/i);
  assert.match(stop, /Watch-GoryStaff\.ps1/i);

  assert.match(watchdog, /Ensure-GoryApi/i);
  assert.match(watchdog, /Ensure-PublicRelay/i);
  assert.match(watchdog, /gory-edge-connector\.js/i);
  assert.match(watchdog, /server-live\.out\.log/i);
  assert.match(watchdog, /http:\/\/127\.0\.0\.1:4000\/health/i);
  assert.match(watchdog, /pg_isready/i);
});

test('main start and stop scripts manage the iiko event connector with the stack', () => {
  const start = read('tools/bat/START_GORY_STAFF.bat');
  const stop = read('tools/bat/STOP_GORY_STAFF.bat');
  const control = read('gory-control/GoryControl.ps1');
  const watchdog = read('tools/Watch-GoryStaff.ps1');

  assert.match(start, /START_IIKO_EVENT_CONNECTOR\.bat/i);
  assert.match(start, /iiko-event-connector/i);
  assert.match(start, /IIKO_WEBHOOK_SECRET/i);
  assert.match(start, /coreKeys/i);

  assert.match(stop, /iiko-event-connector\\?\.js/i);
  assert.match(stop, /Stopping iiko event connector/i);

  assert.match(control, /iiko-event-connector\\?\.js/i);
  assert.match(control, /iiko connector/i);

  assert.match(watchdog, /Ensure-IikoEventConnector/i);
  assert.match(watchdog, /iiko-event-connector\.js/i);
});

test('public relay carries HTTP and WebSocket traffic through Cloudflare Durable Object', () => {
  const worker = read('cloudflare/https-relay/worker.js');
  const connector = read('tools/gory-edge-connector.js');
  const launcher = read('tools/bat/START_PUBLIC_RELAY.bat');

  assert.match(worker, /_gory_relay\/pull/i);
  assert.match(worker, /_gory_relay\/push/i);
  assert.match(worker, /durable|RelayHub/i);
  assert.match(worker, /acceptWebSocket/i);
  assert.match(worker, /ReadableStream/i);
  assert.match(worker, /proxiedResponse/i);
  assert.match(worker, /http_response_chunk/i);
  assert.match(connector, /HTTPS relay poller/i);
  assert.match(connector, /ws:\/\/127\.0\.0\.1/i);
  assert.match(connector, /RETRYABLE_PUSH_TYPES[\s\S]*http_response/i);
  assert.match(connector, /Push recovered for/i);
  assert.match(connector, /HTTP_RESPONSE_CHUNK_BYTES/i);
  assert.match(connector, /http_response_chunk/i);
  assert.match(connector, /zlib/i);
  assert.match(connector, /content-encoding/i);
  assert.match(connector, /gzip/i);
  assert.match(connector, /content-length/i);
  assert.match(connector, /HOP_BY_HOP_RESPONSE_HEADERS/i);
  assert.match(connector, /PUSH_REQUEST_TIMEOUT_MS/i);
  assert.match(launcher, /gory-edge-connector\.js/i);
});

test('mobile build tolerates slower public relay responses over mobile internet', () => {
  const api = read('mobile/src/data/api.ts');

  assert.match(api, /REQUEST_TIMEOUT_MS = 30000/i);
  assert.match(api, /PRIORITY_DISCOVERY_TIMEOUT_MS = 10000/i);
});

test('mobile staff sync uses a compact payload for public mobile internet', () => {
  const syncRoute = read('server/src/routes/sync.js');
  const server = read('server/src/index.js');
  const api = read('mobile/src/data/api.ts');

  assert.match(syncRoute, /isMobileSyncRequest/i);
  assert.match(syncRoute, /getSnapshot\(req\.user,\s*\{\s*mobile:/i);
  assert.match(syncRoute, /no-transform/i);
  assert.match(server, /function compactMobileSnapshot/i);
  assert.match(server, /MOBILE_SYNC_NOTIFICATION_LIMIT/i);
  assert.match(server, /MOBILE_SYNC_ACTIVITY_LOG_LIMIT/i);
  assert.match(server, /compactMobileMenuItem/i);
  assert.match(api, /'\/sync\?mobile=1'/i);
});

test('cloudflare helper scripts manage service and diagnostics explicitly', () => {
  const startHelper = read('tools/Start-GoryCloudflareTunnel.ps1');
  const serviceHelper = read('tools/Configure-GoryCloudflareService.ps1');
  const serviceBat = read('tools/bat/CONFIGURE_CLOUDFLARE_SERVICE.bat');

  assert.match(startHelper, /cloudflared\.pid/i);
  assert.match(startHelper, /cloudflared-tunnel\.log/i);
  assert.match(startHelper, /--edge-ip-version/i);
  assert.doesNotMatch(startHelper, /\$EdgeRegion = 'us'/i);
  assert.match(startHelper, /Cloudflare Edge region: automatic/i);
  assert.match(startHelper, /PublicCheckSuccesses/i);
  assert.match(startHelper, /consecutive public health checks/i);
  assert.match(startHelper, /cloudflared_tunnel_ha_connections/i);

  assert.match(serviceHelper, /WindowsPrincipal/i);
  assert.match(serviceHelper, /sc\.exe/i);
  assert.match(serviceHelper, /Cloudflared/i);
  assert.doesNotMatch(serviceHelper, /\$EdgeRegion = 'us'/i);
  assert.match(serviceHelper, /Cloudflare Edge region: automatic/i);
  assert.match(serviceHelper, /cleanup gory-staff-local/i);
  assert.match(serviceHelper, /New-Service[\s\S]*-Name Cloudflared[\s\S]*-BinaryPathName \$binPath/i);
  assert.doesNotMatch(serviceHelper, /sc\.exe create Cloudflared/i);
  assert.match(serviceHelper, new RegExp(PUBLIC_URL.replaceAll('.', '\\.')));

  assert.match(serviceBat, /Configure-GoryCloudflareService\.ps1/i);
});

test('operator docs point APK and health checks at the public domain', () => {
  const docs = [
    read('README.md'),
    read('docs/SERVER_DEPLOYMENT.md'),
    read('docs/APK_BUILD_NOTE.md'),
    read('docs/PROJECT_FULL_STATUS.md'),
  ].join('\n');

  assert.match(docs, new RegExp(PUBLIC_URL.replaceAll('.', '\\.')));
  assert.doesNotMatch(docs, new RegExp(OLD_TAILSCALE_URL.replaceAll('.', '\\.')));
});
