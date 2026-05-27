const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const screensSource = fs.readFileSync(path.join(__dirname, 'sections', 'screens.tsx'), 'utf8');
const loginSource = fs.readFileSync(path.join(__dirname, 'LoginScreen.tsx'), 'utf8');
const guestAppSource = fs.readFileSync(path.join(__dirname, 'GuestApp.tsx'), 'utf8');

function fieldBlocksByLabel(source, label) {
  const blocks = [];
  let searchFrom = 0;
  while (true) {
    const labelIndex = source.indexOf(`label="${label}"`, searchFrom);
    if (labelIndex < 0) return blocks;
    const start = source.lastIndexOf('<Field', labelIndex);
    const end = source.indexOf('/>', labelIndex);
    assert.ok(start >= 0 && end > labelIndex, `Field block should exist for ${label}`);
    blocks.push(source.slice(start, end + 2));
    searchFrom = labelIndex + label.length;
  }
}

function assertPasswordField(block, label, autoComplete, textContentType) {
  assert.match(block, /secureTextEntry\b/, `${label} should use Field password visibility UX`);
  assert.match(block, new RegExp(`autoComplete="${autoComplete}"`), `${label} should set ${autoComplete} autocomplete`);
  assert.match(block, new RegExp(`textContentType="${textContentType}"`), `${label} should set ${textContentType} text content type`);
}

test('manager staff create and reset password fields request new-password UX', () => {
  const blocks = [
    ...fieldBlocksByLabel(screensSource, 'Временный пароль'),
    ...fieldBlocksByLabel(screensSource, 'Новый пароль'),
    ...fieldBlocksByLabel(screensSource, 'Повторите пароль'),
  ];

  assert.ok(blocks.length >= 5, 'staff and profile new password fields should be covered');
  for (const block of blocks) {
    assertPasswordField(block, 'new password field', 'new-password', 'newPassword');
  }
});

test('profile current password field requests current-password UX', () => {
  const blocks = fieldBlocksByLabel(screensSource, 'Текущий пароль');
  assert.equal(blocks.length, 1);
  assertPasswordField(blocks[0], 'current password field', 'current-password', 'password');
});

test('staff login/register password field switches password manager mode by form mode', () => {
  assert.match(loginSource, /secureTextEntry\b/);
  assert.match(loginSource, /autoComplete=\{mode === 'login' \? 'current-password' : 'new-password'\}/);
  assert.match(loginSource, /textContentType=\{mode === 'login' \? 'password' : 'newPassword'\}/);
});

test('guest staff-entry password modal switches password manager mode by form mode', () => {
  const start = guestAppSource.indexOf('function StaffLoginModal');
  const end = guestAppSource.indexOf('const styles = StyleSheet.create', start);
  assert.ok(start >= 0 && end > start, 'StaffLoginModal source should exist');
  const block = guestAppSource.slice(start, end);

  assert.match(block, /secureTextEntry:\s*true/);
  assert.match(block, /autoComplete:\s*mode === 'login' \? "current-password" : "new-password"/);
  assert.match(block, /textContentType:\s*mode === 'login' \? "password" : "newPassword"/);
});
