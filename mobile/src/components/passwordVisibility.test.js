const assert = require('node:assert/strict');
const test = require('node:test');

let passwordVisibility = {};
try {
  passwordVisibility = require('./passwordVisibility');
} catch {
  passwordVisibility = {};
}

test('password fields start readable when visibility is enabled', () => {
  assert.equal(typeof passwordVisibility.passwordSecureTextEntry, 'function');
  assert.equal(passwordVisibility.passwordSecureTextEntry(true, true), false);
});

test('password fields can be hidden after pressing the visibility button', () => {
  assert.equal(typeof passwordVisibility.nextPasswordVisible, 'function');
  assert.equal(passwordVisibility.nextPasswordVisible(true), false);
  assert.equal(passwordVisibility.passwordSecureTextEntry(true, false), true);
});
