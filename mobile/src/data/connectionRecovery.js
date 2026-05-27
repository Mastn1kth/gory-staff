function normalizeApiUrl(apiUrl) {
  return String(apiUrl ?? '').trim().replace(/\/$/, '');
}

async function resolveReachableConnection(targetUrl, pingServer, resolveApiUrl) {
  const target = normalizeApiUrl(targetUrl);
  if (await pingServer(target, 5000)) {
    return { online: true, apiUrl: target };
  }

  try {
    const resolvedUrl = normalizeApiUrl(await resolveApiUrl(target));
    return { online: true, apiUrl: resolvedUrl };
  } catch {
    return { online: false, apiUrl: target };
  }
}

module.exports = {
  resolveReachableConnection,
};
