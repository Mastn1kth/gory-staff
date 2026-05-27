function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function keyboardAwareBottomPadding(basePadding, keyboardHeight, extraPadding) {
  const base = safeNumber(basePadding);
  const height = safeNumber(keyboardHeight);
  const extra = height > 0 ? safeNumber(extraPadding) : 0;
  return base + height + extra;
}

module.exports = {
  keyboardAwareBottomPadding,
};
