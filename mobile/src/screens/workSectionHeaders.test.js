const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sectionsSource = fs.readFileSync(path.join(__dirname, 'sections', 'screens.tsx'), 'utf8');
const clientsSource = fs.readFileSync(path.join(__dirname, 'sections', 'clients.tsx'), 'utf8');
const hallSignalsSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'HallSignalsFeed.tsx'), 'utf8');
const segmentBroadcastSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'SegmentBroadcastPanel.tsx'), 'utf8');

test('work sections start with useful content instead of repeated page headers', () => {
  assert.doesNotMatch(sectionsSource, /<SectionTitle\b/);
  assert.doesNotMatch(sectionsSource, /\bSectionTitle\b/);
  assert.doesNotMatch(clientsSource, /<SectionTitle\b/);
  assert.doesNotMatch(clientsSource, /\bSectionTitle\b/);
  assert.doesNotMatch(hallSignalsSource, /<SectionTitle\b/);
  assert.doesNotMatch(hallSignalsSource, /\bSectionTitle\b/);
  assert.doesNotMatch(segmentBroadcastSource, /<SectionTitle\b/);
  assert.doesNotMatch(segmentBroadcastSource, /\bSectionTitle\b/);
});
