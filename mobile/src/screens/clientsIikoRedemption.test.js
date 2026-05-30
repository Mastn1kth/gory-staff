const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientsSource = fs.readFileSync(path.join(__dirname, 'sections', 'clients.tsx'), 'utf8');

test('clients screen sends staff iiko bonus redemptions instead of manual bonus removal', () => {
  assert.match(clientsSource, /iiko_redeem/);
  assert.match(clientsSource, /\/admin\/guests\/\$\{selected\.id\}\/bonus-redemptions/);
  assert.match(clientsSource, /order_amount/);
  assert.match(clientsSource, /iiko_order_id/);
  assert.match(clientsSource, /table_session_id/);
  assert.match(clientsSource, /maxIikoBonusAmount/);
});

test('clients screen keeps manual bonus operations separate from iiko redemption', () => {
  assert.match(clientsSource, /operation === 'iiko_redeem'/);
  assert.match(clientsSource, /operation === 'manual_add'/);
  assert.match(clientsSource, /\/admin\/guests\/\$\{selected\.id\}\/bonus`/);
});

test('clients screen can prefill redemption from imported iiko pos orders', () => {
  assert.match(clientsSource, /iiko_external_orders/);
  assert.match(clientsSource, /openIikoExternalOrder/);
  assert.match(clientsSource, /selectedIikoExternalOrder/);
  assert.match(clientsSource, /selectedIikoExternalOrder\?\.iiko_order_id/);
  assert.match(clientsSource, /selectedIikoExternalOrder\?\.amount/);
});
