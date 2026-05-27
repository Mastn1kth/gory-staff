const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'GuestBookingPanel.tsx'), 'utf8');

test('guest booking uses day and month picker instead of manual date typing', () => {
  assert.match(source, /function BookingDatePickerField/);
  assert.match(source, /<BookingDateColumn title="День"/);
  assert.match(source, /<BookingDateColumn title="Месяц"/);
  assert.doesNotMatch(source, /<BookingDateColumn title="Год"/);
  assert.doesNotMatch(source, /placeholder="ГГГГ-ММ-ДД"/);
});

test('guest booking still sends full iso date to the reservation api', () => {
  assert.match(source, /function dateFromDayMonth/);
  assert.match(source, /return `\$\{bookingYear\}-\$\{month\}-\$\{safeDay\}`;/);
  assert.match(source, /date,\s*time,\s*guests_count/s);
});
