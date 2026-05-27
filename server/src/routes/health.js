function registerHealthRoutes(app, deps) {
  const { asyncHandler, authMiddleware, requirePermission, serverStatus, publicServerUrl, websocketUrlForApi } = deps;

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

  app.get('/health', (_req, res) => {
    res.json({ ok: true, ...serverStatus(), api_url: publicServerUrl(), websocket_url: websocketUrlForApi(), time: new Date().toISOString() });
  });

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
      res.json({
        ok: true,
        ...serverStatus(),
        api_url: publicServerUrl(),
        websocket_url: websocketUrlForApi(),
        push_provider: 'expo',
        push_disabled: process.env.DISABLE_PUSH === '1',
        time: new Date().toISOString(),
      });
    }),
  );
}

module.exports = { registerHealthRoutes };
