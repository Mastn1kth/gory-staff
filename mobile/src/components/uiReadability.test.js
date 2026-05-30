const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const uiSource = fs.readFileSync(path.join(__dirname, 'ui.tsx'), 'utf8');

function styleBlock(name) {
  const match = uiSource.match(new RegExp(`${name}: \\{([\\s\\S]*?)\\n  \\},`));
  assert.ok(match, `${name} style should exist`);
  return match[1];
}

test('section titles used inside light cards are readable', () => {
  assert.match(styleBlock('sectionTitle'), /color:\s*palette\.ink/);
  assert.match(styleBlock('sectionSubtitle'), /color:\s*palette\.inkMuted/);
});
