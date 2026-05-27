const assert = require('node:assert/strict');
const test = require('node:test');

let keyboardAvoidance = {};
try {
  keyboardAvoidance = require('./keyboardAvoidance');
} catch {
  keyboardAvoidance = {};
}

test('adds keyboard height and breathing room to the base form padding', () => {
  assert.equal(typeof keyboardAvoidance.keyboardAwareBottomPadding, 'function');
  assert.equal(keyboardAvoidance.keyboardAwareBottomPadding(28, 260, 24), 312);
});

test('keeps the original form padding when the keyboard is hidden', () => {
  assert.equal(typeof keyboardAvoidance.keyboardAwareBottomPadding, 'function');
  assert.equal(keyboardAvoidance.keyboardAwareBottomPadding(80, 0, 24), 80);
});
