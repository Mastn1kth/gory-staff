/**
 * OAuth роуты для входа гостей через Яндекс и ВКонтакте
 */

const {
  getYandexAuthUrl,
  getVkAuthUrl,
  exchangeYandexCode,
  getYandexUserInfo,
  exchangeVkCode,
  getVkUserInfo,
  generateOAuthState,
  verifyOAuthState,
  normalizeOAuthPhone,
} = require('../integrations/oauth');

function registerOAuthRoutes(app, deps) {
  const {
    pool,
    asyncHandler,
    httpError,
    randomUUID,
    generateUniqueReferralCode,
    generateUniqueCardNumber,
    issueGuestSession,
    buildGuestPayload,
    addGuestBonusTransaction,
    createGuestNotification,
    publicServerUrl,
  } = deps;

  // Временное хранилище state (в production использовать Redis)
  const stateStore = new Map();

  /**
   * Получить redirect URI для OAuth
   */
  function getRedirectUri(provider) {
    const baseUrl = publicServerUrl();
    return `${baseUrl}/oauth/${provider}/callback`;
  }

  function normalizeMobileRedirectUri(provider, value) {
    const redirectUri = String(value ?? '').trim();
    if (!redirectUri) return null;

    const allowedSchemes = [
      String(process.env.OAUTH_MOBILE_SCHEME ?? 'gory-staff').trim(),
      String(process.env.OAUTH_MOBILE_ALT_SCHEME ?? 'ru.gory.staff').trim(),
    ].filter(Boolean);
    const allowedUris = allowedSchemes.map((scheme) => `${scheme}://oauth/${provider}`);

    if (!allowedUris.includes(redirectUri)) {
      throw httpError('Недопустимый mobile redirect_uri для OAuth.', 400);
    }

    return redirectUri;
  }

  /**
   * Сохранить state
   */
  function saveState(state, data) {
    stateStore.set(state, {
      ...data,
      createdAt: Date.now(),
    });

    // Очистить старые state (старше 10 минут)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of stateStore.entries()) {
      if (value.createdAt < tenMinutesAgo) {
        stateStore.delete(key);
      }
    }
  }

  /**
   * Получить и удалить state
   */
  function consumeState(state) {
    const data = stateStore.get(state);
    if (data) {
      stateStore.delete(state);
    }
    return data;
  }

  /**
   * Найти или создать гостя по OAuth данным
   */
  async function findOrCreateGuestByOAuth(client, provider, oauthUser, referralCode = null) {
    const providerIdField = provider === 'yandex' ? 'yandex_id' : 'vk_id';
    const providerId = oauthUser.id;

    // Ищем существующего гостя по OAuth ID
    let guest = (
      await client.query(
        `SELECT * FROM guest_users WHERE ${providerIdField} = $1 AND deleted_at IS NULL LIMIT 1`,
        [providerId]
      )
    ).rows[0];

    if (guest) {
      // Обновляем аватар и email если изменились
      await client.query(
        `UPDATE guest_users
         SET oauth_avatar_url = COALESCE($2, oauth_avatar_url),
             oauth_email = COALESCE($3, oauth_email),
             updated_at = NOW()
         WHERE id = $1`,
        [guest.id, oauthUser.avatarUrl, oauthUser.email]
      );
      return guest;
    }

    // Ищем по email если есть
    if (oauthUser.email) {
      guest = (
        await client.query(
          `SELECT * FROM guest_users WHERE oauth_email = $1 AND deleted_at IS NULL LIMIT 1`,
          [oauthUser.email]
        )
      ).rows[0];

      if (guest) {
        // Привязываем OAuth ID к существующему аккаунту
        await client.query(
          `UPDATE guest_users
           SET ${providerIdField} = $2,
               oauth_provider = $3,
               oauth_avatar_url = COALESCE($4, oauth_avatar_url),
               updated_at = NOW()
           WHERE id = $1`,
          [guest.id, providerId, provider, oauthUser.avatarUrl]
        );
        return guest;
      }
    }

    // Ищем по телефону если есть
    const normalizedPhone = normalizeOAuthPhone(oauthUser.phone);
    if (normalizedPhone) {
      guest = (
        await client.query(
          `SELECT * FROM guest_users WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
          [normalizedPhone]
        )
      ).rows[0];

      if (guest) {
        // Привязываем OAuth ID к существующему аккаунту
        await client.query(
          `UPDATE guest_users
           SET ${providerIdField} = $2,
               oauth_provider = $3,
               oauth_email = COALESCE($4, oauth_email),
               oauth_avatar_url = COALESCE($5, oauth_avatar_url),
               updated_at = NOW()
           WHERE id = $1`,
          [guest.id, providerId, provider, oauthUser.email, oauthUser.avatarUrl]
        );
        return guest;
      }
    }

    // Создаем нового гостя
    const guestId = randomUUID();
    const newReferralCode = await generateUniqueReferralCode(client);
    const cardNumber = await generateUniqueCardNumber(client);

    // Проверяем реферальный код
    let referrer = null;
    if (referralCode) {
      const referrerResult = await client.query(
        'SELECT * FROM guest_users WHERE referral_code = $1 AND deleted_at IS NULL AND status = $2 LIMIT 1',
        [referralCode, 'active']
      );
      referrer = referrerResult.rows[0] ?? null;
    }

    // Генерируем телефон-заглушку если нет реального
    const phone = normalizedPhone || `+7900${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`;

    const guestResult = await client.query(
      `INSERT INTO guest_users
        (id, name, phone, ${providerIdField}, oauth_provider, oauth_email, oauth_avatar_url,
         bonus_balance, loyalty_level, referral_code, referred_by, status,
         marketing_consent, personal_data_consent, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,'bronze',$8,$9,'active',true,true,NOW(),NOW())
       RETURNING *`,
      [
        guestId,
        oauthUser.name,
        phone,
        providerId,
        provider,
        oauthUser.email,
        oauthUser.avatarUrl,
        newReferralCode,
        referrer?.id ?? null,
      ]
    );

    guest = guestResult.rows[0];

    // Создаем карту
    await client.query(
      `INSERT INTO guest_cards (id, guest_id, card_number, level, issued_at, status, created_at, updated_at)
       VALUES ($1,$2,$3,'bronze',NOW(),'active',NOW(),NOW())`,
      [randomUUID(), guestId, cardNumber]
    );

    // Согласия
    await client.query(
      `INSERT INTO guest_consents (id, guest_id, consent_type, accepted, accepted_at)
       VALUES ($1,$2,'personal_data',true,NOW()), ($3,$4,'marketing',true,NOW())`,
      [randomUUID(), guestId, randomUUID(), guestId]
    );

    // Регистрационный бонус
    await addGuestBonusTransaction(client, {
      guestId,
      type: 'registration_bonus',
      amount: 300,
      reason: `Регистрация через ${provider === 'yandex' ? 'Яндекс' : 'ВКонтакте'}`,
      source: `oauth_${provider}`,
    });

    // Реферальный бонус
    if (referrer) {
      await client.query(
        `INSERT INTO guest_referrals (id, referrer_guest_id, referred_guest_id, referral_code, status, bonus_given_to_referrer, bonus_given_to_referred, created_at, completed_at)
         VALUES ($1,$2,$3,$4,'completed',false,false,NOW(),NOW())`,
        [randomUUID(), referrer.id, guestId, referralCode]
      );

      await addGuestBonusTransaction(client, {
        guestId,
        type: 'referral_bonus_referred',
        amount: 200,
        reason: 'Бонус за регистрацию по реферальной ссылке',
        source: `oauth_${provider}`,
        relatedGuestId: referrer.id,
      });

      await addGuestBonusTransaction(client, {
        guestId: referrer.id,
        type: 'referral_bonus_referrer',
        amount: 500,
        reason: `Привели друга: ${guest.name}`,
        source: `oauth_${provider}`,
        relatedGuestId: guestId,
      });

      await client.query(
        `UPDATE guest_referrals
         SET bonus_given_to_referrer = true, bonus_given_to_referred = true
         WHERE referrer_guest_id = $1 AND referred_guest_id = $2`,
        [referrer.id, guestId]
      );

      await createGuestNotification(client, {
        guestId: referrer.id,
        title: 'Реферальный бонус',
        text: `Ваш друг ${guest.name} зарегистрировался! Вы получили 500 бонусов.`,
        type: 'referral_bonus',
        data: { referred_guest_id: guestId, amount: 500 },
      });
    }

    // Уведомление о регистрации
    await createGuestNotification(client, {
      guestId,
      title: 'Добро пожаловать!',
      text: `Вы получили 300 бонусов за регистрацию через ${provider === 'yandex' ? 'Яндекс' : 'ВКонтакте'}`,
      type: 'registration',
      data: { amount: 300, provider },
    });

    return guest;
  }

  /**
   * GET /oauth/yandex/url - Получить URL для авторизации через Яндекс
   */
  app.get(
    '/oauth/yandex/url',
    asyncHandler(async (req, res) => {
      const state = generateOAuthState();
      const mobileRedirectUri = normalizeMobileRedirectUri('yandex', req.query.mobile_redirect_uri);
      const redirectUri = mobileRedirectUri ?? getRedirectUri('yandex');
      const referralCode = req.query.referral_code || null;

      saveState(state, {
        provider: 'yandex',
        referralCode,
        mobileRedirectUri,
      });

      const authUrl = getYandexAuthUrl(redirectUri, state);
      res.json({ url: authUrl, state });
    })
  );

  /**
   * GET /oauth/vk/url - Получить URL для авторизации через ВКонтакте
   */
  app.get(
    '/oauth/vk/url',
    asyncHandler(async (req, res) => {
      const state = generateOAuthState();
      const mobileRedirectUri = normalizeMobileRedirectUri('vk', req.query.mobile_redirect_uri);
      const redirectUri = mobileRedirectUri ?? getRedirectUri('vk');
      const referralCode = req.query.referral_code || null;

      saveState(state, {
        provider: 'vk',
        referralCode,
        mobileRedirectUri,
      });

      const authUrl = getVkAuthUrl(redirectUri, state);
      res.json({ url: authUrl, state });
    })
  );

  /**
   * GET /oauth/yandex/callback - Callback для Яндекс OAuth
   */
  app.get(
    '/oauth/yandex/callback',
    asyncHandler(async (req, res) => {
      const { code, state, error, error_description } = req.query;

      if (error) {
        res.status(400).json({
          error: 'oauth_error',
          message: error_description || error,
        });
        return;
      }

      if (!code || !state) {
        res.status(400).json({ error: 'Отсутствует code или state' });
        return;
      }

      const stateData = consumeState(state);
      if (!stateData) {
        res.status(400).json({ error: 'Неверный или истекший state' });
        return;
      }

      const redirectUri = getRedirectUri('yandex');
      const tokenData = await exchangeYandexCode(code, redirectUri);
      const userInfo = await getYandexUserInfo(tokenData.access_token);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const guest = await findOrCreateGuestByOAuth(client, 'yandex', userInfo, stateData.referralCode);
        const token = await issueGuestSession(client, guest, {});
        const payload = await buildGuestPayload(client, guest.id, token);
        await client.query('COMMIT');

        // Возвращаем HTML с автозакрытием и передачей данных в приложение
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Вход через Яндекс</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth_success',
                provider: 'yandex',
                data: ${JSON.stringify(payload)}
              }, '*');
              window.close();
            </script>
            <p>Вход выполнен успешно. Окно закроется автоматически...</p>
          </body>
          </html>
        `);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );

  /**
   * GET /oauth/vk/callback - Callback для ВКонтакте OAuth
   */
  app.get(
    '/oauth/vk/callback',
    asyncHandler(async (req, res) => {
      const { code, state, error, error_description } = req.query;

      if (error) {
        res.status(400).json({
          error: 'oauth_error',
          message: error_description || error,
        });
        return;
      }

      if (!code || !state) {
        res.status(400).json({ error: 'Отсутствует code или state' });
        return;
      }

      const stateData = consumeState(state);
      if (!stateData) {
        res.status(400).json({ error: 'Неверный или истекший state' });
        return;
      }

      const redirectUri = getRedirectUri('vk');
      const tokenData = await exchangeVkCode(code, redirectUri);
      const userInfo = await getVkUserInfo(tokenData.access_token, tokenData.user_id);

      // Email может прийти в токене
      if (tokenData.email) {
        userInfo.email = tokenData.email;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const guest = await findOrCreateGuestByOAuth(client, 'vk', userInfo, stateData.referralCode);
        const token = await issueGuestSession(client, guest, {});
        const payload = await buildGuestPayload(client, guest.id, token);
        await client.query('COMMIT');

        // Возвращаем HTML с автозакрытием и передачей данных в приложение
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Вход через ВКонтакте</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth_success',
                provider: 'vk',
                data: ${JSON.stringify(payload)}
              }, '*');
              window.close();
            </script>
            <p>Вход выполнен успешно. Окно закроется автоматически...</p>
          </body>
          </html>
        `);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );

  /**
   * POST /oauth/mobile/yandex - Вход через Яндекс для мобильного приложения
   */
  app.post(
    '/oauth/mobile/yandex',
    asyncHandler(async (req, res) => {
      const { code } = req.body;
      const referralCode = req.body.referral_code || null;
      const mobileRedirectUri = normalizeMobileRedirectUri('yandex', req.body.redirect_uri);

      if (!code) {
        throw httpError('Отсутствует authorization code', 400);
      }

      const redirectUri = mobileRedirectUri ?? 'urn:ietf:wg:oauth:2.0:oob';
      const tokenData = await exchangeYandexCode(code, redirectUri);
      const userInfo = await getYandexUserInfo(tokenData.access_token);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const guest = await findOrCreateGuestByOAuth(client, 'yandex', userInfo, referralCode);
        const token = await issueGuestSession(client, guest, req.body);
        const payload = await buildGuestPayload(client, guest.id, token);
        await client.query('COMMIT');
        res.json(payload);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );

  /**
   * POST /oauth/mobile/vk - Вход через ВКонтакте для мобильного приложения
   */
  app.post(
    '/oauth/mobile/vk',
    asyncHandler(async (req, res) => {
      const { code } = req.body;
      const referralCode = req.body.referral_code || null;
      const mobileRedirectUri = normalizeMobileRedirectUri('vk', req.body.redirect_uri);

      if (!code) {
        throw httpError('Отсутствует authorization code', 400);
      }

      const redirectUri = mobileRedirectUri ?? 'https://oauth.vk.com/blank.html';
      const tokenData = await exchangeVkCode(code, redirectUri);
      const userInfo = await getVkUserInfo(tokenData.access_token, tokenData.user_id);

      if (tokenData.email) {
        userInfo.email = tokenData.email;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const guest = await findOrCreateGuestByOAuth(client, 'vk', userInfo, referralCode);
        const token = await issueGuestSession(client, guest, req.body);
        const payload = await buildGuestPayload(client, guest.id, token);
        await client.query('COMMIT');
        res.json(payload);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  );
}

module.exports = { registerOAuthRoutes };
