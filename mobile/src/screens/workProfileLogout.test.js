const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
const appShellSource = fs.readFileSync(path.join(__dirname, 'AppShell.tsx'), 'utf8');
const screensSource = fs.readFileSync(path.join(__dirname, 'sections', 'screens.tsx'), 'utf8');

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `${startText} block should exist`);
  return source.slice(start, end);
}

test('work zone keeps Profile only in the top actions', () => {
  assert.match(appShellSource, /onSectionChange\('profile'\)/);
  assert.match(appShellSource, /!\['profile', 'about'\]\.includes\(section\.key\)/);
  assert.doesNotMatch(appShellSource, /!\['about'\]\.includes\(section\.key\)/);
});

test('work profile has an explicit account logout button', () => {
  const profileBlock = sourceBlock(screensSource, 'export function ProfileScreen', 'export function LegacyProfileScreen');

  assert.match(profileBlock, /title="Выйти из аккаунта"/);
  assert.match(profileBlock, /onPress=\{onLogout\}/);
});

test('work profile logout clears the saved staff account', () => {
  const logoutBlock = sourceBlock(appSource, 'const handleLogout = useCallback(async () => {', '  const handleSectionChange');

  assert.match(appSource, /logout/);
  assert.match(logoutBlock, /await logout\(\);/);
  assert.doesNotMatch(logoutBlock, /await leaveStaffMode\(\);/);
});
