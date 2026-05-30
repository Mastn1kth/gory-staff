const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = DAY_MS;
const DEFAULT_LIMIT = 500;
const DEFAULT_START_DELAY_MS = 60 * 1000;
const CAMPAIGN_ID = 'meat_to_mountains';
const CAMPAIGN_ENTITY_TYPE = 'guest_marketing_campaign';
const CAMPAIGN_ACTION = 'push.guest_marketing';
const NOTIFICATION_TYPE = 'guest_marketing_digest';

const GUEST_MARKETING_MESSAGES = [
  {
    title: 'Мясо зовёт в Горы',
    text: 'Шашлык, хинкали и горячее к ужину. Если хочется мяса - приходите сегодня.',
  },
  {
    title: 'Вечер для горячего',
    text: 'Мясо с огня, лепёшки, зелень и тёплый зал. Горы рядом, стол найдём.',
  },
  {
    title: 'Пора в Горы',
    text: 'Для тех, кто любит мясо и кавказскую кухню: ждём на плотный ужин без лишних слов.',
  },
  {
    title: 'Горы зовут к столу',
    text: 'Хочется шашлыка, хинкали или горячего? Приходите сегодня, будет по-настоящему сытно.',
  },
];

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function guestMarketingPushConfig(env = process.env) {
  const intervalMs = positiveInteger(env.GUEST_MARKETING_PUSH_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  const limit = Math.max(1, positiveInteger(env.GUEST_MARKETING_PUSH_LIMIT, DEFAULT_LIMIT));
  const startDelayMs = positiveInteger(env.GUEST_MARKETING_PUSH_START_DELAY_MS, DEFAULT_START_DELAY_MS);
  return {
    enabled: intervalMs > 0 && env.DISABLE_PUSH !== '1' && env.DISABLE_GUEST_MARKETING_PUSH !== '1',
    intervalMs,
    limit,
    startDelayMs,
  };
}

function selectGuestMarketingMessage(now = new Date()) {
  const index = Math.abs(Math.floor(now.getTime() / DAY_MS)) % GUEST_MARKETING_MESSAGES.length;
  return {
    ...GUEST_MARKETING_MESSAGES[index],
    campaignId: CAMPAIGN_ID,
    variant: index,
  };
}

function isRecentRun(row, now, intervalMs) {
  if (!row?.created_at) return false;
  const createdAt = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return now.getTime() - createdAt < intervalMs;
}

async function writeCampaignLog(client, { logActivity, payload }) {
  if (typeof logActivity === 'function') {
    await logActivity(client, null, CAMPAIGN_ACTION, CAMPAIGN_ENTITY_TYPE, CAMPAIGN_ID, null, payload);
    return;
  }

  await client.query(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
     VALUES ($1, NULL, $2, $3, $4, NULL, $5, NOW())`,
    [`${CAMPAIGN_ID}-${Date.now()}`, CAMPAIGN_ACTION, CAMPAIGN_ENTITY_TYPE, CAMPAIGN_ID, payload],
  );
}

async function sendGuestMarketingNotifications({
  pool,
  createGuestNotification,
  logActivity,
  env = process.env,
  logger = console,
  now = () => new Date(),
}) {
  const config = guestMarketingPushConfig(env);
  if (!config.enabled) {
    return { ok: true, skipped: true, reason: 'disabled', intervalMs: config.intervalMs };
  }

  const client = await pool.connect();
  try {
    const currentTime = now();
    const lastRun = await client.query(
      `SELECT id, created_at
       FROM activity_log
       WHERE action = $1 AND entity_type = $2 AND entity_id = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [CAMPAIGN_ACTION, CAMPAIGN_ENTITY_TYPE, CAMPAIGN_ID],
    );

    if (isRecentRun(lastRun.rows[0], currentTime, config.intervalMs)) {
      return {
        ok: true,
        skipped: true,
        reason: 'recent',
        intervalMs: config.intervalMs,
        lastRunAt: lastRun.rows[0].created_at,
      };
    }

    const message = selectGuestMarketingMessage(currentTime);
    const guests = await client.query(
      `SELECT id
       FROM guest_users
       WHERE deleted_at IS NULL
         AND status = 'active'
         AND marketing_consent = TRUE
       ORDER BY COALESCE(last_visit_at, created_at) ASC, updated_at DESC
       LIMIT $1`,
      [config.limit],
    );

    let notified = 0;
    let failed = 0;
    for (const guest of guests.rows) {
      try {
        const notificationId = await createGuestNotification(client, {
          guestId: guest.id,
          title: message.title,
          text: message.text,
          type: NOTIFICATION_TYPE,
          data: {
            campaign_id: CAMPAIGN_ID,
            variant: message.variant,
            source: 'scheduled_marketing',
          },
          push: true,
          respectMarketing: true,
        });
        if (notificationId) notified += 1;
      } catch (error) {
        failed += 1;
        logger.warn?.('Guest marketing notification failed:', error.message);
      }
    }

    const payload = {
      campaign_id: CAMPAIGN_ID,
      type: NOTIFICATION_TYPE,
      title: message.title,
      text: message.text,
      variant: message.variant,
      guests: guests.rows.length,
      notified,
      failed,
    };
    await writeCampaignLog(client, { logActivity, payload });

    return { ok: true, skipped: false, ...payload };
  } catch (error) {
    logger.warn?.('Guest marketing push check failed:', error.message);
    return { ok: false, error: error.message };
  } finally {
    client.release();
  }
}

function startGuestMarketingPushScheduler(options) {
  const config = guestMarketingPushConfig(options.env);
  const runOnce = () => sendGuestMarketingNotifications(options);
  if (!config.enabled) {
    return {
      enabled: false,
      intervalMs: config.intervalMs,
      startDelayMs: config.startDelayMs,
      runOnce,
      stop() {},
    };
  }

  let stopped = false;
  const run = () => {
    if (stopped) return;
    void runOnce();
  };
  const startTimer = setTimeout(run, config.startDelayMs);
  const intervalTimer = setInterval(run, config.intervalMs);
  startTimer.unref?.();
  intervalTimer.unref?.();

  return {
    enabled: true,
    intervalMs: config.intervalMs,
    startDelayMs: config.startDelayMs,
    runOnce,
    stop() {
      stopped = true;
      clearTimeout(startTimer);
      clearInterval(intervalTimer);
    },
  };
}

module.exports = {
  CAMPAIGN_ID,
  NOTIFICATION_TYPE,
  GUEST_MARKETING_MESSAGES,
  guestMarketingPushConfig,
  selectGuestMarketingMessage,
  sendGuestMarketingNotifications,
  startGuestMarketingPushScheduler,
};
