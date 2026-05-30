const assert = require('node:assert/strict');
const test = require('node:test');

const phoneFormat = require('./phoneFormat');

test('formats russian phone digits in visible groups', () => {
  assert.equal(phoneFormat.formatRussianPhoneInput('89605092331'), '8 960 509 23 31');
  assert.equal(phoneFormat.formatRussianPhoneInput('+7 960 509-23-31'), '8 960 509 23 31');
});

test('normalizes formatted russian phone for api requests', () => {
  assert.equal(phoneFormat.normalizeRussianPhoneInput('8 960 509 23 31'), '+79605092331');
});
