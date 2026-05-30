const assert = require('node:assert/strict');
const test = require('node:test');

const { isPrivateNetworkApiUrl, orderApiPriorityUrls } = require('./connectionCandidates');

test('detects private and local API URLs', () => {
  assert.equal(isPrivateNetworkApiUrl('http://192.168.1.20:4000'), true);
  assert.equal(isPrivateNetworkApiUrl('http://10.0.2.2:4000'), true);
  assert.equal(isPrivateNetworkApiUrl('http://172.20.10.2:4000'), true);
  assert.equal(isPrivateNetworkApiUrl('http://localhost:4000'), true);
  assert.equal(isPrivateNetworkApiUrl('https://app.gory-staff.ru'), false);
});

test('tries public API URLs before stale local Wi-Fi URLs', () => {
  const urls = orderApiPriorityUrls({
    configuredUrl: 'http://192.168.0.44:4000',
    defaultUrl: 'https://app.gory-staff.ru',
    preferredUrl: 'http://192.168.1.10:4000',
    savedUrl: 'http://10.0.0.7:4000',
    fallbackUrls: ['https://backup.gory-staff.ru', 'http://172.20.10.4:4000'],
    emulatorUrl: 'http://10.0.2.2:4000',
    localProbeUrls: ['http://192.168.0.2:4000'],
  });

  assert.deepEqual(urls.slice(0, 2), ['https://app.gory-staff.ru', 'https://backup.gory-staff.ru']);
  assert.ok(urls.indexOf('https://app.gory-staff.ru') < urls.indexOf('http://192.168.0.44:4000'));
  assert.ok(urls.indexOf('https://app.gory-staff.ru') < urls.indexOf('http://192.168.1.10:4000'));
});
