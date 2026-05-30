function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function russianDisplayDigits(value) {
  const digits = digitsOnly(value);
  if (!digits) return '';
  if (digits[0] === '8') return digits.slice(0, 11);
  if (digits[0] === '7') return `8${digits.slice(1)}`.slice(0, 11);
  if (digits.length <= 10) return `8${digits}`.slice(0, 11);
  return digits.slice(0, 11);
}

function formatRussianPhoneInput(value) {
  const digits = russianDisplayDigits(value);
  const groups = [digits.slice(0, 1), digits.slice(1, 4), digits.slice(4, 7), digits.slice(7, 9), digits.slice(9, 11)];
  return groups.filter(Boolean).join(' ');
}

function normalizeRussianPhoneInput(value) {
  const digits = digitsOnly(value);
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (String(value ?? '').trim().startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  throw new Error('Введите корректный номер телефона');
}

module.exports = {
  formatRussianPhoneInput,
  normalizeRussianPhoneInput,
};
