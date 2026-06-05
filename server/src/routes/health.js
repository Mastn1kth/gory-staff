function registerHealthRoutes(app, deps) {
  const {
    asyncHandler,
    authMiddleware,
    requirePermission,
    serverStatus,
    publicServerUrl,
    websocketUrlForApi,
    query,
    metricsSnapshot = () => ({ counters: {}, per_minute: {} }),
  } = deps;

  async function healthChecks() {
    const checks = {
      database: { ok: false },
      schema: { ok: false },
      iiko: {
        ok: process.env.IIKO_ENABLED !== 'true' || Boolean(process.env.IIKO_API_LOGIN && process.env.IIKO_ORGANIZATION_ID),
        enabled: process.env.IIKO_ENABLED === 'true',
        order_sync_enabled: process.env.IIKO_ORDER_SYNC_ENABLED !== 'false',
      },
      push: {
        ok: true,
        disabled: process.env.DISABLE_PUSH === '1',
        provider: 'expo',
        access_token_configured: Boolean(process.env.EXPO_PUSH_ACCESS_TOKEN),
        status:
          process.env.DISABLE_PUSH === '1'
            ? 'disabled'
            : process.env.EXPO_PUSH_ACCESS_TOKEN
              ? 'configured'
              : 'enabled_without_access_token',
      },
      public_endpoint: {
        ok: Boolean(publicServerUrl()),
        api_url: publicServerUrl(),
        websocket_url: websocketUrlForApi(),
      },
      oauth: {
        ok: true,
        yandex_configured: Boolean(process.env.YANDEX_CLIENT_ID && process.env.YANDEX_CLIENT_SECRET),
        vk_configured: Boolean(process.env.VK_CLIENT_ID && process.env.VK_CLIENT_SECRET),
        redirect_base_url: publicServerUrl(),
        yandex_redirect_uri: `${publicServerUrl()}/oauth/yandex/callback`,
        vk_redirect_uri: `${publicServerUrl()}/oauth/vk/callback`,
        mobile_schemes: [
          String(process.env.OAUTH_MOBILE_SCHEME ?? 'gory-staff').trim(),
          String(process.env.OAUTH_MOBILE_ALT_SCHEME ?? 'ru.gory.staff').trim(),
        ].filter(Boolean),
      },
    };

    try {
      await query('SELECT 1 AS ok');
      checks.database = { ok: true };
    } catch (error) {
      checks.database = { ok: false, error: error.message };
    }

    try {
      const result = await query(
        `SELECT COUNT(*)::int AS count
         FROM information_schema.tables
         WHERE table_name = ANY($1::text[])`,
        [['guest_users', 'social_posts', 'guest_bonus_transactions', 'guest_orders']],
      );
      checks.schema = { ok: Number(result.rows[0]?.count ?? 0) >= 4 };
    } catch (error) {
      checks.schema = { ok: false, error: error.message };
    }

    return checks;
  }

  function securityStatus() {
    const snapshot = metricsSnapshot();
    const counters = snapshot.counters ?? {};
    const sumCounters = (pattern) =>
      Object.entries(counters).reduce((sum, [key, value]) => (pattern.test(key) ? sum + Number(value ?? 0) : sum), 0);
    const rateLimitPaths = Object.entries(counters)
      .filter(([key]) => key.startsWith('rate_limits_total{'))
      .map(([key, value]) => ({
        path: key.match(/path=([^,}]+)/)?.[1] ?? 'unknown',
        count: Number(value ?? 0),
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10);

    return {
      totals: {
        unauthorized_401: sumCounters(/auth_denials_total\{.*status=401/),
        forbidden_403: sumCounters(/auth_denials_total\{.*status=403/),
        rate_limit_429: sumCounters(/http_requests_total\{.*status=429/),
        external_api_timeouts: sumCounters(/^external_api_timeouts_total/),
      },
      rate_limit_paths: rateLimitPaths,
      recent_events: snapshot.security_events ?? [],
    };
  }

  app.get('/', (_req, res) => {
    const status = serverStatus();
    res
      .type('html')
      .send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gory API</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f5efe4; color: #24211e; }
    main { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { font-size: 16px; line-height: 1.45; }
    a { color: #7a2638; font-weight: 700; }
    code { background: #fff9ef; padding: 3px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>Gory API is running</h1>
    <p>Server mode: <code>${status.mode}</code></p>
    <p>Open <a href="/health">/health</a> for the technical check.</p>
  </main>
</body>
</html>`);
  });

  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const checks = await healthChecks();
      res.json({
        ok: true,
        ready: Boolean(checks.database.ok && checks.schema.ok),
        ...serverStatus(),
        api_url: publicServerUrl(),
        websocket_url: websocketUrlForApi(),
        checks,
        time: new Date().toISOString(),
      });
    }),
  );

  app.get('/guest/restaurant-info', (_req, res) => {
    res.json({
      name: 'Горы',
      description:
        'Ресторан кавказской кухни в Иваново на Советской 36а. Тёплая атмосфера, банкеты, живая музыка и гостеприимство.',
      address: 'Иваново, Советская 36а',
      phone: '+7 900 100-10-00',
      working_hours: 'Ежедневно 12:00-00:00',
      yandex_maps_url: 'https://yandex.ru/maps/?text=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%D0%BE%2C%20%D0%A1%D0%BE%D0%B2%D0%B5%D1%82%D1%81%D0%BA%D0%B0%D1%8F%2036%D0%B0',
    });
  });

  app.get(
    '/system/status',
    authMiddleware,
    requirePermission('view:tech_admin'),
    asyncHandler(async (_req, res) => {
      const checks = await healthChecks();
      res.json({
        ok: true,
        ready: Boolean(checks.database.ok && checks.schema.ok),
        ...serverStatus(),
        api_url: publicServerUrl(),
        websocket_url: websocketUrlForApi(),
        push_provider: 'expo',
        push_disabled: process.env.DISABLE_PUSH === '1',
        checks,
        metrics: metricsSnapshot(),
        time: new Date().toISOString(),
      });
    }),
  );

  app.get(
    '/system/metrics',
    authMiddleware,
    requirePermission('view:tech_admin'),
    asyncHandler(async (_req, res) => {
      res.json({ ok: true, ...metricsSnapshot(), time: new Date().toISOString() });
    }),
  );

  app.get(
    '/system/security',
    authMiddleware,
    requirePermission('view:tech_admin'),
    asyncHandler(async (_req, res) => {
      res.json({ ok: true, security: securityStatus(), time: new Date().toISOString() });
    }),
  );
}

module.exports = { registerHealthRoutes };
