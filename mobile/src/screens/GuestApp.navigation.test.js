const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const guestAppSource = fs.readFileSync(path.join(__dirname, 'GuestApp.tsx'), 'utf8');

function extractGuestTabOrder(source) {
  const tabsMatch = source.match(/const guestTabOrder = \[([\s\S]*?)\];/);
  assert.ok(tabsMatch, 'guestTabOrder definition should exist');
  return [...tabsMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('guest bottom navigation starts with news, restaurant, menu, bonus card and profile', () => {
  assert.deepEqual(extractGuestTabOrder(guestAppSource), ['news', 'restaurant', 'menu', 'bonus', 'profile']);
  assert.equal(guestAppSource.includes('guestTabsInDisplayOrder.map'), true);
});

test('guest mode does not use horizontal pager swipe navigation', () => {
  assert.equal(guestAppSource.includes('pagingEnabled: true'), false);
  assert.equal(guestAppSource.includes('onMomentumScrollEnd'), false);
  assert.equal(guestAppSource.includes('scrollEnabled: false'), true);
  assert.equal(guestAppSource.includes('disableScrollViewPanResponder: true'), true);
});

test('guest menu category tabs stay horizontally scrollable inside the menu page', () => {
  const styleIndex = guestAppSource.indexOf('contentContainerStyle: styles.categoryStrip');
  assert.ok(styleIndex >= 0, 'category strip ScrollView should exist');
  const blockStart = guestAppSource.lastIndexOf('ScrollView', styleIndex);
  const blockEnd = guestAppSource.indexOf('children:', styleIndex);
  assert.ok(blockStart >= 0 && blockEnd > styleIndex, 'category strip ScrollView props should be readable');
  const block = guestAppSource.slice(blockStart, blockEnd);

  assert.match(block, /horizontal:\s*true/);
  assert.match(block, /nestedScrollEnabled:\s*true/);
  assert.match(block, /keyboardShouldPersistTaps:\s*"handled"/);
});

test('guest registration uses birthday picker controls instead of manual date typing', () => {
  assert.match(guestAppSource, /function BirthdayPickerField/);
  assert.match(guestAppSource, /title: "Выбрать"/);
  assert.doesNotMatch(guestAppSource, /label: "\\u0414\\u0430\\u0442\\u0430 \\u0440\\u043E\\u0436\\u0434\\u0435\\u043D\\u0438\\u044F"[\s\S]{0,260}placeholder: "\\u0413\\u0413\\u0413\\u0413-\\u041C\\u041C-\\u0414\\u0414"/);
});

test('guest auth formats phone without confirmation code', () => {
  assert.match(guestAppSource, /formatRussianPhoneInput/);
  assert.doesNotMatch(guestAppSource, /Verification/);
  assert.doesNotMatch(guestAppSource, /confirmationCode/);
});

test('guest phone changes do not request confirmation code', () => {
  const start = guestAppSource.indexOf('function GuestEditProfileModal');
  const end = guestAppSource.indexOf('function StaffLoginModal', start);
  const editModal = guestAppSource.slice(start, end);
  assert.match(editModal, /formatRussianPhoneInput/);
  assert.doesNotMatch(editModal, /Verification/);
  assert.doesNotMatch(editModal, /confirmationCode/);
});

test('guest profile does not wire push notification controls', () => {
  assert.doesNotMatch(guestAppSource, /pushDiagnostics/);
  assert.doesNotMatch(guestAppSource, /onEnablePush/);
  assert.doesNotMatch(guestAppSource, /onTestPush/);
  assert.doesNotMatch(guestAppSource, /registerGuestPushToken/);
  assert.doesNotMatch(guestAppSource, /sendGuestTestPush/);
});

test('guest profile does not render visit and booking history panel', () => {
  assert.doesNotMatch(guestAppSource, /GuestTimelinePanel/);
});

test('guest menu exposes loading and refresh states for slow network changes', () => {
  assert.match(guestAppSource, /guestMenuLoading/);
  assert.ok(
    guestAppSource.includes('Загружаем меню') ||
      guestAppSource.includes('\\u0417\\u0430\\u0433\\u0440\\u0443\\u0436\\u0430\\u0435\\u043C \\u043C\\u0435\\u043D\\u044E'),
  );
  assert.ok(
    guestAppSource.includes('Обновить меню') ||
      guestAppSource.includes('\\u041E\\u0431\\u043D\\u043E\\u0432\\u0438\\u0442\\u044C \\u043C\\u0435\\u043D\\u044E'),
  );
});

test('guest menu opens dish details and no longer creates table orders', () => {
  assert.match(guestAppSource, /selectedDish/);
  assert.match(guestAppSource, /DishDetailModal/);
  assert.doesNotMatch(guestAppSource, /createGuestOrderItem/);
  assert.doesNotMatch(guestAppSource, /GuestCheckInPanel/);
});

test('guest news renders real video media instead of a static play badge only', () => {
  assert.match(guestAppSource, /expo-video/);
  assert.match(guestAppSource, /VideoView/);
  assert.match(guestAppSource, /useVideoPlayer/);
});
