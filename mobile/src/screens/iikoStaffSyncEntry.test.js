const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const screensSource = fs.readFileSync(path.join(__dirname, 'sections', 'screens.tsx'), 'utf8');

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `${startText} block should exist`);
  return source.slice(start, end);
}

test('staff screen exposes manual iiko staff sync with one-time credentials result', () => {
  const staffBlock = sourceBlock(screensSource, 'export function StaffScreen', 'export function LegacyStaffScreen');

  assert.match(staffBlock, /\/iiko\/sync\/staff/);
  assert.match(staffBlock, /Синхронизировать из iiko/);
  assert.match(staffBlock, /returnErrorBody/);
  assert.match(staffBlock, /new_credentials/);
  assert.match(staffBlock, /onRefresh\(\)/);
  assert.match(staffBlock, /Показываются только в этом результате запуска/);
});
