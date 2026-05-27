const MISSING_VERSION_ERROR = 'Нужна актуальная версия записи. Обновите данные и повторите действие.';
const VERSION_CONFLICT_ERROR = 'Запись уже изменена на сервере. Обновите данные и решите конфликт.';

function expectedVersionFromBody(body) {
  const value = body?.expected_version ?? body?.expectedVersion ?? body?.base_version ?? body?.baseVersion ?? body?.version;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return null;
  return number;
}

function sendVersionConflict(res, current, missing = false) {
  res.status(409).json({
    error: missing ? MISSING_VERSION_ERROR : VERSION_CONFLICT_ERROR,
    conflict: true,
    current: current ?? null,
  });
}

function requireExpectedVersion(req, res, current) {
  const expectedVersion = expectedVersionFromBody(req.body ?? {});
  if (!expectedVersion) {
    sendVersionConflict(res, current, true);
    return null;
  }
  return expectedVersion;
}

module.exports = {
  MISSING_VERSION_ERROR,
  VERSION_CONFLICT_ERROR,
  expectedVersionFromBody,
  sendVersionConflict,
  requireExpectedVersion,
};
