const { randomInt } = require('crypto');

function registerGuestRoutes(app, deps) {
  const {
    pool,
    query,
    asyncHandler,
    guestAuthMiddleware,
    randomUUID,
    httpError,
    normalizeGuestPhone,
    normalizeReferralCode,
    normalizeBirthday,
    generateUniqueReferralCode,
    generateUniqueCardNumber,
    addGuestBonusTransaction,
    createRoleNotifications,
    createGuestNotification,
    emitChange,
    issueGuestSession,
    buildGuestPayload,
    registerPushDevice,
    publicServerUrl,
    websocketUrlForApi,
    getCoordinationApi,
  } = deps;
  const routeCache = deps.cache ?? {
    get: () => null,
    set: () => {},
  };

  function redemptionOrderAmount(body) {
    const value = Number(body?.order_amount ?? body?.orderAmount ?? body?.order_sum ?? body?.orderSum ?? body?.payment_amount ?? body?.paymentAmount ?? 0);
    if (!Number.isFinite(value) || value <= 0) throw httpError('Передайте сумму заказа для расчета лимита списания.', 400);
    return Math.round(value);
  }

  function maxRedemptionAmount(orderAmount) {
    return Math.floor(Number(orderAmount) * 0.2);
  }

  function validateRedemptionLimit(amount, orderAmount) {
    const maxAmount = maxRedemptionAmount(orderAmount);
    if (maxAmount <= 0) throw httpError('Для этого заказа нельзя списать бонусы.', 400);
    if (amount > maxAmount) throw httpError('Можно списать не больше 20% от суммы заказа. 1 балл = 1 рубль.', 400);
    return maxAmount;
  }

  app.get(
    '/guest/menu',
    asyncHandler(async (_req, res) => {
      // Пробуем получить из кэша
      const cached = routeCache.get('menu:guest:full');
      if (cached) {
        res.json(cached);
        return;
      }

      const [categories, items, modifierGroups, modifiers] = await Promise.all([
        query('SELECT id, name, sort_order FROM menu_categories ORDER BY sort_order ASC, name ASC'),
        query(
          `SELECT
             mi.id,
             mi.name,
             mi.category_id,
             mc.name AS category_name,
             mi.price,
             mi.photo_url,
             mi.composition,
             mi.weight,
             mi.description,
             mi.item_type,
             mi.is_bar,
             mi.spice_level,
             mi.popularity,
             mi.status,
             mi.updated_at
           FROM menu_items mi
           JOIN menu_categories mc ON mc.id = mi.category_id
           ORDER BY mc.sort_order ASC, mi.popularity DESC, mi.name ASC`,
        ),
        query(
          `SELECT
             mig.id,
             mig.menu_item_id,
             mig.name,
             mig.iiko_modifier_group_id,
             mig.required,
             mig.min_amount,
             mig.max_amount,
             mig.sort_order
           FROM menu_item_modifier_groups mig
           JOIN menu_items mi ON mi.id = mig.menu_item_id
           WHERE mig.status = 'active'
           ORDER BY mig.menu_item_id, mig.sort_order ASC, mig.name ASC`,
        ),
        query(
          `SELECT
             mim.id,
             mim.modifier_group_id,
             mim.iiko_modifier_product_id,
             mim.name,
             mim.price,
             mim.min_amount,
             mim.max_amount,
             mim.default_amount,
             mim.sort_order
           FROM menu_item_modifiers mim
           JOIN menu_item_modifier_groups mig ON mig.id = mim.modifier_group_id
           WHERE mim.status = 'active'
             AND mig.status = 'active'
           ORDER BY mim.modifier_group_id, mim.sort_order ASC, mim.name ASC`,
        ),
      ]);

      const result = {
        categories: categories.rows,
        items: items.rows.map((item) => ({
          ...item,
          is_available: item.status === 'available',
          guest_status_text: item.status === 'available' ? null : 'Временно недоступно',
        })),
        modifier_groups: modifierGroups.rows,
        modifiers: modifiers.rows,
      };

      // Кэшируем на 5 минут
      routeCache.set('menu:guest:full', result, 300);

      res.json(result);
    }),
  );

  app.post(
    '/guest/register',
    asyncHandler(async (req, res) => {
      const name = String(req.body?.name ?? '').trim();
      const phone = normalizeGuestPhone(req.body?.phone);
      const birthday = normalizeBirthday(req.body?.birthday);
      const referralCode = normalizeReferralCode(req.body?.referral_code ?? req.body?.referralCode);

      if (name.length < 2) throw httpError('Введите имя гостя.', 400);
      if (!phone) throw httpError('Введите корректный номер телефона', 400);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT id FROM guest_users WHERE phone = $1 AND deleted_at IS NULL LIMIT 1', [phone]);
        if (existing.rows[0]) throw httpError('Гость с таким телефоном уже зарегистрирован. Войдите по телефону.', 409);

        let referrer = null;
        if (referralCode) {
          const referrerResult = await client.query(
            'SELECT * FROM guest_users WHERE referral_code = $1 AND deleted_at IS NULL AND status = $2 LIMIT 1',
            [referralCode, 'active'],
          );
          referrer = referrerResult.rows[0] ?? null;
          if (!referrer) throw httpError('Реферальный код не найден.', 400);
          if (referrer.phone === phone) throw httpError('Нельзя использовать свой реферальный код.', 400);
        }

        const guestId = randomUUID();
        const newReferralCode = await generateUniqueReferralCode(client);
        const cardNumber = await generateUniqueCardNumber(client);
        const guestResult = await client.query(
          `INSERT INTO guest_users
            (id, name, phone, birthday, bonus_balance, loyalty_level, referral_code, referred_by, status, marketing_consent, personal_data_consent, created_at, updated_at)
           VALUES ($1,$2,$3,$4,0,'bronze',$5,$6,'active',$7,$8,NOW(),NOW())
           RETURNING *`,
          [
            guestId,
            name,
            phone,
            birthday,
            newReferralCode,
            referrer?.id ?? null,
            Boolean(req.body?.marketing_consent),
            Boolean(req.body?.personal_data_consent ?? true),
          ],
        );
        await client.query(
          `INSERT INTO guest_cards (id, guest_id, card_number, level, issued_at, status, created_at, updated_at)
           VALUES ($1,$2,$3,'bronze',NOW(),'active',NOW(),NOW())`,
          [randomUUID(), guestId, cardNumber],
        );
        await client.query(
          `INSERT INTO guest_consents (id, guest_id, consent_type, accepted, accepted_at)
           VALUES ($1,$2,'personal_data',$3,CASE WHEN $3 THEN NOW() ELSE NULL END)
           ON CONFLICT (guest_id, consent_type)
           DO UPDATE SET accepted = EXCLUDED.accepted, accepted_at = EXCLUDED.accepted_at, revoked_at = NULL`,
          [randomUUID(), guestId, Boolean(req.body?.personal_data_consent ?? true)],
        );
        await client.query(
          `INSERT INTO guest_consents (id, guest_id, consent_type, accepted, accepted_at)
           VALUES ($1,$2,'marketing',$3,CASE WHEN $3 THEN NOW() ELSE NULL END)
           ON CONFLICT (guest_id, consent_type)
           DO UPDATE SET accepted = EXCLUDED.accepted, accepted_at = EXCLUDED.accepted_at, revoked_at = NULL`,
          [randomUUID(), guestId, Boolean(req.body?.marketing_consent)],
        );

        await addGuestBonusTransaction(client, {
          guestId,
          type: 'registration_bonus',
          amount: 300,
          reason: 'Бонус за регистрацию',
          source: 'guest_registration',
        });
        if (birthday) {
          await addGuestBonusTransaction(client, {
            guestId,
            type: 'birthday_bonus',
            amount: 1000,
            reason: 'Бонус ко дню рождения',
            source: 'guest_registration',
          });
        }
        if (referrer) {
          await client.query(
            `INSERT INTO guest_referrals
              (id, referrer_guest_id, referred_guest_id, referral_code, status, bonus_given_to_referrer, bonus_given_to_referred, created_at, completed_at)
             VALUES ($1,$2,$3,$4,'completed',FALSE,FALSE,NOW(),NOW())`,
            [randomUUID(), referrer.id, guestId, referralCode],
          );
          await addGuestBonusTransaction(client, {
            guestId: referrer.id,
            type: 'referral_bonus',
            amount: 500,
            reason: `Бонус за приглашение ${name}`,
            source: 'guest_referral',
            relatedGuestId: guestId,
          });
          await client.query('UPDATE guest_referrals SET bonus_given_to_referrer = TRUE WHERE referred_guest_id = $1', [guestId]);
        }
        await createRoleNotifications(client, ['management'], {
          title: 'Новый гость зарегистрировался',
          text: `${name}, ${phone}`,
          type: 'guest_registered',
          data: { guest_id: guestId },
        });

        const freshGuest = (await client.query('SELECT * FROM guest_users WHERE id = $1', [guestId])).rows[0] ?? guestResult.rows[0];
        const token = await issueGuestSession(client, freshGuest, req.body ?? {});
        const payload = await buildGuestPayload(client, guestId, token);
        await client.query('COMMIT');
        emitChange('guest_users', 'created', payload.guest);
        res.status(201).json(payload);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/guest/login',
    asyncHandler(async (req, res) => {
      const phone = normalizeGuestPhone(req.body?.phone);
      if (!phone) throw httpError('Введите корректный номер телефона', 400);

      const client = await pool.connect();
      try {
        const result = await client.query('SELECT * FROM guest_users WHERE phone = $1 AND deleted_at IS NULL LIMIT 1', [phone]);
        const guest = result.rows[0];
        if (!guest) throw httpError('Гость с таким телефоном не найден. Зарегистрируйтесь.', 404);
        if (guest.status === 'blocked') throw httpError('Профиль временно недоступен. Обратитесь в ресторан.', 403);

        const token = await issueGuestSession(client, guest, req.body ?? {});
        const payload = await buildGuestPayload(client, guest.id, token);
        res.json(payload);
      } finally {
        client.release();
      }
    }),
  );

  app.get(
    '/guest/profile',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const coordinationApi = getCoordinationApi();
        if (coordinationApi) await coordinationApi.maybeBirthdayBonus(client, req.guest);
        res.json(await buildGuestPayload(client, req.guest.id));
      } finally {
        client.release();
      }
    }),
  );

  app.patch(
    '/guest/profile',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const updates = [];
        const values = [req.guest.id];
        const body = req.body ?? {};

        if (body.name !== undefined) {
          const name = String(body.name ?? '').trim();
          if (name.length < 2) throw httpError('Введите имя гостя.', 400);
          values.push(name);
          updates.push(`name = $${values.length}`);
        }

        if (body.phone !== undefined) {
          const phone = normalizeGuestPhone(body.phone);
          if (!phone) throw httpError('Введите корректный номер телефона', 400);
          const duplicate = await client.query(
            'SELECT id FROM guest_users WHERE phone = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1',
            [phone, req.guest.id],
          );
          if (duplicate.rows[0]) throw httpError('Гость с таким телефоном уже существует.', 409);
          values.push(phone);
          updates.push(`phone = $${values.length}`);
        }

        if (body.birthday !== undefined) {
          const birthday = body.birthday ? normalizeBirthday(body.birthday) : null;
          if (body.birthday && !birthday) throw httpError('Дата рождения должна быть в формате ГГГГ-ММ-ДД.', 400);
          values.push(birthday);
          updates.push(`birthday = $${values.length}`);
        }

        if (body.email !== undefined) {
          const email = String(body.email ?? '').trim() || null;
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError('Введите корректный email.', 400);
          values.push(email);
          updates.push(`email = $${values.length}`);
        }

        if (body.marketing_consent !== undefined) {
          values.push(Boolean(body.marketing_consent));
          updates.push(`marketing_consent = $${values.length}`);
        }

        if (updates.length) {
          updates.push('updated_at = NOW()');
          await client.query(`UPDATE guest_users SET ${updates.join(', ')} WHERE id = $1`, values);
        }

        res.json(await buildGuestPayload(client, req.guest.id));
      } finally {
        client.release();
      }
    }),
  );

  app.get(
    '/guest/bonus-card',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const payload = await buildGuestPayload(pool, req.guest.id);
      res.json({ guest: payload.guest, card: payload.card, referral: payload.referral });
    }),
  );

  app.get(
    '/guest/bonus-transactions',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 30), 1), 100);
      const offset = Math.max(Number(req.query.offset ?? 0), 0);
      const result = await query(
        'SELECT * FROM guest_bonus_transactions WHERE guest_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [req.guest.id, limit, offset],
      );
      res.json({ items: result.rows, limit, offset });
    }),
  );

  app.get(
    '/guest/bonus/redemption-token',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        // Проверяем активный токен
        const existing = await client.query(
          `SELECT id, short_code, created_at, expires_at, status
           FROM guest_bonus_redemption_tokens
           WHERE guest_id = $1 AND status = 'active' AND expires_at > NOW()
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.guest.id],
        );

        if (existing.rows[0]) {
          const token = existing.rows[0];
          res.json({
            short_code: token.short_code,
            expires_at: token.expires_at,
            created_at: token.created_at,
          });
          return;
        }

        // Создаём новый токен
        const crypto = require('crypto');
        const tokenId = randomUUID();
        const rawToken = `${tokenId}-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        // Генерируем уникальный короткий код (6 цифр)
        let shortCode = null;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const candidate = String(randomInt(100000, 1000000));
          const check = await client.query(
            'SELECT id FROM guest_bonus_redemption_tokens WHERE short_code = $1 AND status = $2',
            [candidate, 'active'],
          );
          if (!check.rows[0]) {
            shortCode = candidate;
            break;
          }
        }

        if (!shortCode) throw httpError('Не удалось сгенерировать уникальный код. Попробуйте ещё раз.', 500);

        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 минут

        const result = await client.query(
          `INSERT INTO guest_bonus_redemption_tokens
             (id, guest_id, token_hash, short_code, created_at, expires_at, status)
           VALUES ($1, $2, $3, $4, NOW(), $5, 'active')
           RETURNING id, short_code, created_at, expires_at, status`,
          [tokenId, req.guest.id, tokenHash, shortCode, expiresAt],
        );

        const token = result.rows[0];
        res.json({
          short_code: token.short_code,
          expires_at: token.expires_at,
          created_at: token.created_at,
        });
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/guest/bonus/redemption-token/refresh',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Деактивируем старые токены
        await client.query(
          `UPDATE guest_bonus_redemption_tokens
           SET status = 'expired'
           WHERE guest_id = $1 AND status = 'active'`,
          [req.guest.id],
        );

        // Создаём новый токен
        const crypto = require('crypto');
        const tokenId = randomUUID();
        const rawToken = `${tokenId}-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        let shortCode = null;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const candidate = String(randomInt(100000, 1000000));
          const check = await client.query(
            'SELECT id FROM guest_bonus_redemption_tokens WHERE short_code = $1 AND status = $2',
            [candidate, 'active'],
          );
          if (!check.rows[0]) {
            shortCode = candidate;
            break;
          }
        }

        if (!shortCode) throw httpError('Не удалось сгенерировать уникальный код. Попробуйте ещё раз.', 500);

        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const result = await client.query(
          `INSERT INTO guest_bonus_redemption_tokens
             (id, guest_id, token_hash, short_code, created_at, expires_at, status)
           VALUES ($1, $2, $3, $4, NOW(), $5, 'active')
           RETURNING id, short_code, created_at, expires_at, status`,
          [tokenId, req.guest.id, tokenHash, shortCode, expiresAt],
        );

        await client.query('COMMIT');

        const token = result.rows[0];
        res.json({
          short_code: token.short_code,
          expires_at: token.expires_at,
          created_at: token.created_at,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/guest/bonus/redemptions',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const amount = Math.round(Number(req.body?.amount ?? 0));
      if (!Number.isFinite(amount) || amount <= 0) throw httpError('Введите сумму бонусов для списания.', 400);
      const orderAmount = redemptionOrderAmount(req.body ?? {});
      const maxBonusAmount = validateRedemptionLimit(amount, orderAmount);

      const iikoOrderId = String(req.body?.iiko_order_id ?? req.body?.iikoOrderId ?? '').trim() || null;
      const localOrderId = String(req.body?.local_order_id ?? req.body?.localOrderId ?? '').trim() || null;
      if (!iikoOrderId && !localOrderId) {
        throw httpError('Передайте iiko_order_id или local_order_id для связи списания с оплачиваемым заказом.', 400);
      }
      const reason = String(req.body?.reason ?? 'Списание бонусов к заказу iiko').trim();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const session = (
          await client.query(
            `SELECT *
             FROM table_guest_sessions
             WHERE guest_id = $1 AND status = 'active'
             ORDER BY checked_in_at DESC
             LIMIT 1`,
            [req.guest.id],
          )
        ).rows[0];
        if (!session) throw httpError('Сначала привяжитесь к столу.', 400);

        if (localOrderId) {
          const order = (
            await client.query(
              `SELECT id
               FROM guest_orders
               WHERE id = $1
                 AND guest_id = $2
                 AND (table_session_id = $3 OR table_session_id IS NULL)
               LIMIT 1`,
              [localOrderId, req.guest.id, session.id],
            )
          ).rows[0];
          if (!order) throw httpError('Заказ не найден для текущего гостя.', 404);
        }

        const transaction = await addGuestBonusTransaction(client, {
          guestId: req.guest.id,
          type: 'iiko_bonus_redeem',
          amount: -amount,
          reason,
          source: 'iiko_payment',
          relatedVisitId: session.id,
          iikoOrderId,
          localOrderId,
          tableSessionId: session.id,
        });

        const redemption = (
          await client.query(
            `INSERT INTO guest_bonus_redemptions
               (id, guest_id, table_session_id, local_order_id, iiko_order_id,
                bonus_transaction_id, amount, order_amount, max_bonus_amount, bonus_to_ruble_rate,
                status, reason, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'reserved',$10,NOW(),NOW())
             RETURNING *`,
            [
              randomUUID(),
              req.guest.id,
              session.id,
              localOrderId,
              iikoOrderId,
              transaction.id,
              amount,
              orderAmount,
              maxBonusAmount,
              reason,
            ],
          )
        ).rows[0];
        const payload = await buildGuestPayload(client, req.guest.id);
        await client.query('COMMIT');
        emitChange('guest_users', 'updated', payload.guest);
        emitChange('guest_bonus_redemptions', 'created', redemption);
        res.status(201).json({ redemption, transaction, guest: payload.guest });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.get(
    '/guest/referral',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const payload = await buildGuestPayload(pool, req.guest.id);
      res.json(payload.referral);
    }),
  );

  app.post(
    '/guest/push/register',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const { token, push_token, platform, device_id, app_version, device_name } = req.body ?? {};
      const pushToken = push_token ?? token;
      if (!pushToken) throw httpError('Не передан push token устройства.', 400);
      const device = await registerPushDevice(pool, {
        userType: 'guest',
        userId: req.guest.id,
        pushToken,
        platform,
        deviceId: device_id,
        appVersion: app_version,
        deviceName: device_name,
      });
      res.json({ ok: true, device });
    }),
  );

  app.get(
    '/guest/push/status',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const devices = await query(
        `SELECT id, platform, app_version, device_name, is_active, last_seen_at, created_at, updated_at, revoked_at
         FROM push_devices
         WHERE user_type = 'guest' AND user_id = $1
         ORDER BY updated_at DESC`,
        [req.guest.id],
      );
      res.json({
        ok: true,
        user_type: 'guest',
        devices: devices.rows,
        api_url: publicServerUrl(),
        websocket_url: websocketUrlForApi(),
        provider: 'expo',
        push_disabled: process.env.DISABLE_PUSH === '1',
      });
    }),
  );

  app.post(
    '/guest/push/test',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const notificationId = await createGuestNotification(client, {
          guestId: req.guest.id,
          title: 'Горы',
          text: 'Тестовое уведомление получено',
          type: 'test_push',
          data: { test: true },
          push: true,
        });
        await client.query('COMMIT');
        res.json({ ok: true, notification_id: notificationId });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.patch(
    '/guest/notifications/:id/read',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const result = await query(
        `UPDATE notifications
         SET is_read = TRUE,
             read_at = NOW()
         WHERE id = $1
           AND user_type = 'guest'
           AND guest_id = $2
         RETURNING id, title, text, body, type, data_json, status, is_read, created_at, sent_at, read_at`,
        [req.params.id, req.guest.id],
      );
      if (!result.rows[0]) throw httpError('Гость не найден.', 404);
      res.json(result.rows[0]);
    }),
  );

  app.post(
    '/guest/feedback/:id',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const rating = Number(req.body?.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw httpError('Оценка должна быть числом от 1 до 5.', 400);
      }
      const comment = String(req.body?.comment ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = (
          await client.query(
            `SELECT *
             FROM guest_feedback_requests
             WHERE id = $1 AND guest_id = $2
             LIMIT 1`,
            [req.params.id, req.guest.id],
          )
        ).rows[0];
        if (!current) throw httpError('Запрос оценки не найден.', 404);
        if (current.status === 'submitted') throw httpError('Оценка уже отправлена.', 409);

        const updated = (
          await client.query(
            `UPDATE guest_feedback_requests
             SET rating = $3,
                 comment = $4,
                 status = 'submitted',
                 responded_at = NOW()
             WHERE id = $1 AND guest_id = $2
             RETURNING *`,
            [req.params.id, req.guest.id, rating, comment || null],
          )
        ).rows[0];

        if (rating <= 3) {
          await createRoleNotifications(client, ['management'], {
            title: 'Низкая оценка визита',
            text: `${req.guest.name}: ${rating}/5${comment ? ` - ${comment}` : ''}`,
            type: 'guest_feedback_low',
            data: { feedback_request_id: updated.id, guest_id: req.guest.id, rating },
          });
        }

        await client.query('COMMIT');
        emitChange('guest_feedback_requests', 'updated', updated);
        res.json(updated);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );
}

module.exports = { registerGuestRoutes };
