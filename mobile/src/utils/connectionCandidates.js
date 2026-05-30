function normalizeApiUrl(apiUrl) {
  return String(apiUrl ?? '').trim().replace(/\/$/, '');
}

function hostFromApiUrl(apiUrl) {
  const match = normalizeApiUrl(apiUrl).match(/^https?:\/\/([^/:]+)/i);
  return (match?.[1] ?? '').toLowerCase();
}

function isPrivateNetworkApiUrl(apiUrl) {
  const host = hostFromApiUrl(apiUrl);
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;

  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function uniqueUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    const normalized = normalizeApiUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function orderApiPriorityUrls({
  configuredUrl,
  defaultUrl,
  preferredUrl,
  savedUrl,
  fallbackUrls = [],
  emulatorUrl,
  localProbeUrls = [],
}) {
  const publicCandidates = [configuredUrl, defaultUrl, preferredUrl, savedUrl, ...fallbackUrls].filter(
    (url) => url && !isPrivateNetworkApiUrl(url),
  );
  const localCandidates = [configuredUrl, preferredUrl, savedUrl, ...fallbackUrls, emulatorUrl, ...localProbeUrls].filter(
    (url) => url && isPrivateNetworkApiUrl(url),
  );
  return uniqueUrls([...publicCandidates, ...localCandidates]);
}

module.exports = {
  isPrivateNetworkApiUrl,
  orderApiPriorityUrls,
};
