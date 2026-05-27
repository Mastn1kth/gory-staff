const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
const guestAppSource = fs.readFileSync(path.join(__dirname, 'GuestApp.tsx'), 'utf8');

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `${startText} block should exist`);
  return source.slice(start, end);
}

test('guest staff entry exposes new employee registration', () => {
  const modalBlock = sourceBlock(guestAppSource, 'function StaffLoginModal', 'const styles = StyleSheet.create');

  assert.match(guestAppSource, /onStaffRegister/);
  assert.match(modalBlock, /mode/);
  assert.match(modalBlock, /setMode/);
  assert.match(modalBlock, /onRegister/);
  assert.match(modalBlock, /new-password/);
});

test('app wires staff registration through existing auth API', () => {
  assert.match(appSource, /registerProfile/);
  assert.match(appSource, /handleRegister/);
  assert.match(appSource, /onStaffRegister=\{handleRegister\}/);
});
