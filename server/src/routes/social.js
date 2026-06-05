const { fetchWithTimeout, timeoutFromEnv } = require('../http');

function registerSocialRoutes(app, deps) {
  const {
    pool,
    query,
    asyncHandler,
    authMiddleware,
    guestAuthMiddleware,
    optionalGuestAuthMiddleware,
    requirePermission,
    randomUUID,
    emitChange,
    createRoleNotifications,
    httpError,
    socialLikeRateLimiter = (_req, _res, next) => next(),
    socialCommentRateLimiter = (_req, _res, next) => next(),
    recordMetric = () => {},
    recordRecentEvent = () => {},
    logEvent = () => {},
  } = deps;

  const publishedStatuses = new Set(['published']);
  const allowedStatuses = new Set(['draft', 'published', 'hidden']);
  const allowedCommentStatuses = new Set(['visible', 'hidden', 'rejected']);
  const allowedImportSources = new Set(['instagram', 'vk']);
  const activeImportJobs = new Set();
  const scheduledImportJobs = new Map();
  const importSourceCircuits = new Map();
  const allowedMediaTypes = new Set(['image', 'video']);
  const commentModerationBlocklist = [
    'badword',
    'suka',
    'blyad',
    'bljad',
    'huy',
    'hui',
    'pizd',
    'eba',
    '\u0434\u0443\u0440\u0430\u043a',
    '\u043b\u043e\u0445',
    '\u0442\u0432\u0430\u0440\u044c',
    '\u0441\u0443\u043a\u0430',
    '\u0431\u043b\u044f\u0434',
    '\u0431\u043b\u044f',
    '\u0445\u0443\u0439',
    '\u0445\u0443\u0435',
    '\u043f\u0438\u0437\u0434',
    '\u0435\u0431\u0430',
    '\u0451\u0431\u0430',
  ];
  const commentModerationCharMap = new Map([
    ['0', 'o'],
    ['1', 'i'],
    ['3', 'e'],
    ['4', 'a'],
    ['5', 's'],
    ['7', 't'],
    ['@', 'a'],
    ['$', 's'],
  ]);
  const commentBlocklist = [
    'дурак',
    'лох',
    'тварь',
    'сука',
    'бляд',
    'хуй',
    'пизд',
    'еба',
    'badword',
    'дурак',
  ];

  function normalizeStatus(value) {
    const status = String(value ?? 'draft').trim().toLowerCase();
    return allowedStatuses.has(status) ? status : 'draft';
  }

  function normalizeSource(value) {
    const source = String(value ?? 'manual').trim().toLowerCase();
    return ['manual', 'instagram', 'vk'].includes(source) ? source : 'manual';
  }

  function normalizeImportSources(value) {
    const requested = Array.isArray(value) && value.length ? value : ['instagram', 'vk'];
    return [...new Set(requested.map((source) => String(source).trim().toLowerCase()).filter((source) => allowedImportSources.has(source)))];
  }

  function postFingerprint(title, body) {
    return `${title ?? ''} ${body ?? ''}`
      .normalize('NFKC')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  async function findExistingImportedPost(client, { source, sourceExternalId, sourceUrl, title, text }) {
    if (sourceExternalId) {
      const existingById = (
        await client.query('SELECT * FROM social_posts WHERE source = $1 AND source_external_id = $2 LIMIT 1', [source, sourceExternalId])
      ).rows[0];
      if (existingById) return existingById;
    }

    if (sourceUrl) {
      const existingByUrl = (
        await client.query('SELECT * FROM social_posts WHERE source = $1 AND source_url = $2 LIMIT 1', [source, sourceUrl])
      ).rows[0];
      if (existingByUrl) return existingByUrl;
    }

    if (source === 'manual') return null;
    const fingerprint = postFingerprint(title, text);
    if (fingerprint.length < 20) return null;

    const recentPosts = await client.query(
      `SELECT *
       FROM social_posts
       WHERE source = $1
       ORDER BY COALESCE(published_at, created_at) DESC
       LIMIT 200`,
      [source],
    );
    return recentPosts.rows.find((post) => postFingerprint(post.title, post.body) === fingerprint) ?? null;
  }

  function normalizeMedia(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item, index) => {
        const url = String(item?.url ?? '').trim();
        if (!url) return null;
        const mediaType = allowedMediaTypes.has(String(item?.media_type ?? item?.type).toLowerCase())
          ? String(item?.media_type ?? item?.type).toLowerCase()
          : 'image';
        return {
          id: randomUUID(),
          media_type: mediaType,
          url,
          thumbnail_url: String(item?.thumbnail_url ?? item?.thumbnailUrl ?? '').trim() || null,
          sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
          source_external_id: String(item?.source_external_id ?? '').trim() || null,
          metadata_json: item?.metadata_json && typeof item.metadata_json === 'object' ? item.metadata_json : {},
        };
      })
      .filter(Boolean);
  }

  function normalizeCommentText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactCommentForModeration(value) {
    const text = normalizeCommentText(value).toLowerCase().replace(/\u0451/g, '\u0435');
    return [...text]
      .map((char) => commentModerationCharMap.get(char) ?? char)
      .join('')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function containsAnyBlockedWord(value, extraWords = []) {
    const compactText = compactCommentForModeration(value);
    const blockedWords = commentModerationBlocklist.concat(commentBlocklist, extraWords);
    return blockedWords.some((word) => compactText.includes(compactCommentForModeration(word)));
  }

  function containsExternalLink(value) {
    return /\b(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|vk\.com\/|instagram\.com\/)/i.test(String(value ?? ''));
  }

  function canGuestPostLinks(guest) {
    const level = String(guest?.loyalty_level ?? '').toLowerCase();
    return ['gold', 'platinum'].includes(level) || Number(guest?.visits_count ?? 0) >= 3;
  }

  async function loadActiveCommentBlocklist(client) {
    const result = await client.query(
      `SELECT word
       FROM social_comment_blocklist
       WHERE status = 'active'
       ORDER BY created_at DESC
       LIMIT 500`,
    );
    return result.rows.map((row) => row.word);
  }

  async function rejectedCommentCount(client, guestId) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM social_post_comments
       WHERE guest_id = $1
         AND status = 'rejected'
         AND created_at >= NOW() - INTERVAL '5 minutes'`,
      [guestId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async function commentPolicyViolation(client, guest, postId, text) {
    if ((await rejectedCommentCount(client, guest.id)) >= 10) {
      return { status: 429, message: 'Слишком много отклонённых комментариев. Попробуйте позже.', reason: 'temporary_block' };
    }

    const extraWords = await loadActiveCommentBlocklist(client);
    if (containsAnyBlockedWord(text, extraWords)) {
      return { status: 400, message: 'Комментарий не прошёл проверку.', reason: 'blocked_word' };
    }
    if (containsExternalLink(text) && !canGuestPostLinks(guest)) {
      return { status: 400, message: 'Комментарий не прошёл проверку.', reason: 'guest_link_blocked' };
    }

    const recent = await client.query(
      `SELECT text, created_at
       FROM social_post_comments
       WHERE guest_id = $1 AND post_id = $2
       ORDER BY created_at DESC
       LIMIT 5`,
      [guest.id, postId],
    );
    const normalizedText = normalizeCommentText(text).toLowerCase();
    const newest = recent.rows[0];
    if (newest && Date.now() - new Date(newest.created_at).getTime() < 10_000) {
      return { status: 429, message: 'Слишком много комментариев, попробуйте позже.', reason: 'post_cooldown' };
    }
    if (recent.rows.some((row) => normalizeCommentText(row.text).toLowerCase() === normalizedText)) {
      return { status: 400, message: 'Комментарий не прошёл проверку.', reason: 'duplicate_comment' };
    }
    return null;
  }

  async function insertRejectedComment(client, postId, guest, text, reason) {
    const result = await client.query(
      `INSERT INTO social_post_comments (id, post_id, guest_id, text, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'rejected',NOW(),NOW())
       RETURNING *`,
      [randomUUID(), postId, guest.id, text],
    );
    recordMetric('social_comments_rejected_total', { reason });
    recordRecentEvent('social_comment_rejected');
    emitChange('social_post_comments', 'created', result.rows[0]);
    return result.rows[0];
  }

  function socialImportTimeoutMs() {
    return timeoutFromEnv('SOCIAL_IMPORT_FETCH_TIMEOUT_MS');
  }

  function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function socialImportRetryDelaysMs() {
    const configured = String(process.env.SOCIAL_IMPORT_RETRY_DELAYS_MS ?? '')
      .split(',')
      .map((value) => positiveInteger(value.trim(), 0))
      .filter((value) => value > 0);
    return configured.length ? configured : [30_000, 120_000, 600_000];
  }

  function socialImportRetryDelayMs(attemptNumber) {
    const delays = socialImportRetryDelaysMs();
    const index = Math.max(0, Math.min(delays.length - 1, Number(attemptNumber) - 1));
    return delays[index];
  }

  function socialImportCircuitOpenMs() {
    return positiveInteger(process.env.SOCIAL_IMPORT_CIRCUIT_OPEN_MS, 5 * 60 * 1000);
  }

  function importCircuitOpenResult(source) {
    const circuit = importSourceCircuits.get(source);
    if (!circuit?.opened_until || circuit.opened_until <= Date.now()) return null;
    return {
      source,
      status: 'failed',
      imported_count: 0,
      error: `${source} import temporarily paused after provider failures.`,
      retry_after_ms: Math.max(0, circuit.opened_until - Date.now()),
      circuit_open: true,
    };
  }

  function recordImportCircuitResult(result) {
    const source = result?.source;
    if (!source || !allowedImportSources.has(source)) return;
    const previous = importSourceCircuits.get(source) ?? { failures: 0, opened_until: 0 };
    if (result.status !== 'failed' || result.circuit_open) {
      importSourceCircuits.set(source, { failures: 0, opened_until: 0 });
      return;
    }

    const failures = previous.failures + 1;
    const openedUntil = failures >= 5 ? Date.now() + socialImportCircuitOpenMs() : previous.opened_until;
    importSourceCircuits.set(source, { failures, opened_until: openedUntil });
    if (openedUntil > Date.now()) {
      recordMetric('social_import_circuit_open_total', { source });
      logEvent('warn', 'social_import_circuit_open', { source, failures, opened_until: new Date(openedUntil).toISOString() });
    }
  }

  async function fetchSocialImportJson(source, url) {
    const response = await fetchWithTimeout(url, { timeoutMs: socialImportTimeoutMs() });
    if (!response.ok) {
      return { ok: false, error: `${source} API ${response.status}` };
    }
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: `${source} API returned invalid JSON` };
    }
    return { ok: true, payload };
  }

  function socialImportRequestError(source, error) {
    const isTimeout = error?.code === 'EXTERNAL_FETCH_TIMEOUT';
    recordMetric(isTimeout ? 'external_api_timeouts_total' : 'external_api_failures_total', { provider: source.toLowerCase() });
    recordRecentEvent(isTimeout ? 'external_api_timeout' : 'external_api_failure');
    logEvent('warn', isTimeout ? 'external_api_timeout' : 'external_api_provider_fail', {
      provider: source.toLowerCase(),
      source: 'social_import',
      message: error?.message,
    });
    return {
      source: source.toLowerCase(),
      status: 'failed',
      imported_count: 0,
      error: isTimeout ? `${source} API timeout` : `${source} API request failed`,
    };
  }

  async function attachPostRelations(client, posts, guestId = null, { includeComments = true } = {}) {
    if (!posts.length) return [];
    const postIds = posts.map((post) => post.id);
    const singlePostId = postIds.length === 1 ? postIds[0] : null;
    const postIdPlaceholders = postIds.map((_, index) => `$${index + 1}`).join(',');
    const guestIdParam = `$${postIds.length + 1}`;
    const [mediaResult, likesResult, commentsCountResult, likedResult, commentsResult] = await Promise.all([
      singlePostId
        ? client.query(
            `SELECT *
             FROM social_post_media
             WHERE post_id = $1
             ORDER BY post_id ASC, sort_order ASC, created_at ASC`,
            [singlePostId],
          )
        : client.query(
            `SELECT *
             FROM social_post_media
             WHERE post_id IN (${postIdPlaceholders})
             ORDER BY post_id ASC, sort_order ASC, created_at ASC`,
            postIds,
          ),
      singlePostId
        ? client.query(
            `SELECT post_id, COUNT(*)::int AS like_count
             FROM social_post_likes
             WHERE post_id = $1
             GROUP BY post_id`,
            [singlePostId],
          )
        : client.query(
            `SELECT post_id, COUNT(*)::int AS like_count
             FROM social_post_likes
             WHERE post_id IN (${postIdPlaceholders})
             GROUP BY post_id`,
            postIds,
          ),
      singlePostId
        ? client.query(
            `SELECT post_id, COUNT(*)::int AS comment_count
             FROM social_post_comments
             WHERE post_id = $1 AND status = 'visible'
             GROUP BY post_id`,
            [singlePostId],
          )
        : client.query(
            `SELECT post_id, COUNT(*)::int AS comment_count
             FROM social_post_comments
             WHERE post_id IN (${postIdPlaceholders}) AND status = 'visible'
             GROUP BY post_id`,
            postIds,
          ),
      guestId
        ? singlePostId
          ? client.query(
              `SELECT post_id
               FROM social_post_likes
               WHERE post_id = $1 AND guest_id = $2`,
              [singlePostId, guestId],
            )
          : client.query(
              `SELECT post_id
               FROM social_post_likes
               WHERE post_id IN (${postIdPlaceholders}) AND guest_id = ${guestIdParam}`,
              [...postIds, guestId],
            )
        : Promise.resolve({ rows: [] }),
      includeComments
        ? singlePostId
          ? client.query(
              `SELECT c.*, gu.name AS guest_name
               FROM social_post_comments c
               JOIN guest_users gu ON gu.id = c.guest_id
               WHERE c.post_id = $1 AND c.status = 'visible'
               ORDER BY c.created_at ASC`,
              [singlePostId],
            )
          : client.query(
              `SELECT c.*, gu.name AS guest_name
               FROM social_post_comments c
               JOIN guest_users gu ON gu.id = c.guest_id
               WHERE c.post_id IN (${postIdPlaceholders}) AND c.status = 'visible'
               ORDER BY c.created_at ASC`,
              postIds,
            )
        : Promise.resolve({ rows: [] }),
    ]);

    const mediaByPost = new Map();
    for (const row of mediaResult.rows) {
      const items = mediaByPost.get(row.post_id) ?? [];
      items.push(row);
      mediaByPost.set(row.post_id, items);
    }
    const likesByPost = new Map(likesResult.rows.map((row) => [row.post_id, Number(row.like_count ?? 0)]));
    const commentsCountByPost = new Map(commentsCountResult.rows.map((row) => [row.post_id, Number(row.comment_count ?? 0)]));
    const likedByMe = new Set(likedResult.rows.map((row) => row.post_id));
    const commentsByPost = new Map();
    for (const row of commentsResult.rows) {
      const items = commentsByPost.get(row.post_id) ?? [];
      items.push(row);
      commentsByPost.set(row.post_id, items);
    }

    return posts.map((post) => ({
      ...post,
      media: mediaByPost.get(post.id) ?? [],
      like_count: likesByPost.get(post.id) ?? 0,
      comment_count: commentsCountByPost.get(post.id) ?? 0,
      liked_by_me: likedByMe.has(post.id),
      comments: (commentsByPost.get(post.id) ?? []).slice(-20),
    }));
  }

  async function loadPost(client, id, guestId = null) {
    const result = await client.query('SELECT * FROM social_posts WHERE id = $1', [id]);
    const post = result.rows[0];
    if (!post) throw httpError('Новость не найдена.', 404);
    const [enriched] = await attachPostRelations(client, [post], guestId);
    return enriched;
  }

  async function insertPost(client, body, author) {
    const title = String(body?.title ?? '').trim();
    const text = String(body?.body ?? body?.text ?? '').trim();
    if (title.length < 2) throw httpError('Введите заголовок новости.', 400);
    if (text.length < 2) throw httpError('Введите текст новости.', 400);

    const status = normalizeStatus(body?.status);
    const source = normalizeSource(body?.source);
    const publishedAt =
      status === 'published'
        ? String(body?.published_at ?? '').trim() || new Date().toISOString()
        : body?.published_at || null;
    const postId = randomUUID();
    const sourceExternalId = String(body?.source_external_id ?? '').trim() || null;
    const sourceUrl = String(body?.source_url ?? '').trim() || null;
    const authorName = author?.name ?? (String(body?.author_name ?? '').trim() || null);
    const importPayload =
      body?.import_payload_json && typeof body.import_payload_json === 'object' ? body.import_payload_json : {};
    let postResult = { rows: [] };
    const existing = await findExistingImportedPost(client, { source, sourceExternalId, sourceUrl, title, text });
    if (existing) {
      postResult = await client.query(
        `UPDATE social_posts
         SET title = $2,
             body = $3,
             source_url = $4,
             author_id = COALESCE($5, author_id),
             author_name = COALESCE($6, author_name),
             status = $7,
             published_at = $8,
             import_payload_json = $9,
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1
         RETURNING *`,
        [existing.id, title, text, sourceUrl, author?.id ?? null, authorName, status, publishedAt, importPayload],
      );
    } else {
      postResult = await client.query(
        `INSERT INTO social_posts
          (id, title, body, source, source_external_id, source_url, author_id, author_name, status, published_at, import_payload_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
         RETURNING *`,
        [
          postId,
          title,
          text,
          source,
          sourceExternalId,
          sourceUrl,
          author?.id ?? null,
          authorName,
          status,
          publishedAt,
          importPayload,
        ],
      );
    }
    const post = postResult.rows[0];

    const media = normalizeMedia(body?.media);
    if (media.length) {
      if (existing) await client.query('DELETE FROM social_post_media WHERE post_id = $1', [post.id]);
      for (const item of media) {
        await client.query(
          `INSERT INTO social_post_media
            (id, post_id, media_type, url, thumbnail_url, sort_order, source_external_id, metadata_json, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [
            item.id,
            post.id,
            item.media_type,
            item.url,
            item.thumbnail_url,
            item.sort_order,
            item.source_external_id,
            item.metadata_json,
          ],
        );
      }
    }
    return loadPost(client, post.id);
  }

  function instagramConfig() {
    const missing = [];
    if (!process.env.INSTAGRAM_ACCESS_TOKEN) missing.push('INSTAGRAM_ACCESS_TOKEN');
    if (!process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID) missing.push('INSTAGRAM_BUSINESS_ACCOUNT_ID');
    return { missing };
  }

  function vkConfig() {
    const missing = [];
    if (!process.env.VK_ACCESS_TOKEN) missing.push('VK_ACCESS_TOKEN');
    if (!process.env.VK_GROUP_ID && !process.env.VK_SEARCH_QUERY) missing.push('VK_GROUP_ID or VK_SEARCH_QUERY');
    return { missing };
  }

  async function importInstagram(client, user) {
    const config = instagramConfig();
    if (config.missing.length) {
      return { source: 'instagram', status: 'disabled', missing: config.missing, imported_count: 0 };
    }
    const accountId = encodeURIComponent(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID);
    const token = encodeURIComponent(process.env.INSTAGRAM_ACCESS_TOKEN);
    const url = `https://graph.facebook.com/v20.0/${accountId}/tags?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&access_token=${token}`;
    let payload;
    try {
      const importResponse = await fetchSocialImportJson('Instagram', url);
      if (!importResponse.ok) {
        return { source: 'instagram', status: 'failed', imported_count: 0, error: importResponse.error };
      }
      payload = importResponse.payload;
    } catch (error) {
      return socialImportRequestError('Instagram', error);
    }
    let imported = 0;
    for (const item of Array.isArray(payload?.data) ? payload.data : []) {
      const caption = String(item.caption ?? '').trim();
      await insertPost(
        client,
        {
          title: caption.split('\n')[0]?.slice(0, 90) || 'Instagram',
          body: caption || String(item.permalink ?? ''),
          status: 'published',
          source: 'instagram',
          source_external_id: String(item.id),
          source_url: item.permalink,
          published_at: item.timestamp,
          import_payload_json: item,
          media: [
            {
              media_type: String(item.media_type ?? '').toLowerCase().includes('video') ? 'video' : 'image',
              url: item.media_url,
              thumbnail_url: item.thumbnail_url,
            },
          ],
        },
        user,
      );
      imported += 1;
    }
    return { source: 'instagram', status: 'ok', imported_count: imported };
  }

  async function importVk(client, user) {
    const config = vkConfig();
    if (config.missing.length) {
      return { source: 'vk', status: 'disabled', missing: config.missing, imported_count: 0 };
    }
    const token = encodeURIComponent(process.env.VK_ACCESS_TOKEN);
    const queryText = encodeURIComponent(process.env.VK_SEARCH_QUERY || process.env.VK_GROUP_ID || 'Горы ресторан');
    const url = `https://api.vk.com/method/newsfeed.search?q=${queryText}&count=20&extended=1&access_token=${token}&v=5.199`;
    let payload;
    try {
      const importResponse = await fetchSocialImportJson('VK', url);
      if (!importResponse.ok) return { source: 'vk', status: 'failed', imported_count: 0, error: importResponse.error };
      payload = importResponse.payload;
    } catch (error) {
      return socialImportRequestError('VK', error);
    }
    if (payload?.error) {
      return { source: 'vk', status: 'failed', imported_count: 0, error: payload.error.error_msg ?? 'VK API error' };
    }
    let imported = 0;
    for (const item of Array.isArray(payload?.response?.items) ? payload.response.items : []) {
      const attachments = Array.isArray(item.attachments) ? item.attachments : [];
      const media = attachments
        .map((attachment) => {
          if (attachment.type === 'photo') {
            const sizes = Array.isArray(attachment.photo?.sizes) ? attachment.photo.sizes : [];
            const best = sizes[sizes.length - 1];
            return best?.url ? { media_type: 'image', url: best.url } : null;
          }
          if (attachment.type === 'video') {
            const image = Array.isArray(attachment.video?.image) ? attachment.video.image.slice(-1)[0] : null;
            return image?.url
              ? {
                  media_type: 'video',
                  url: String(attachment.video?.player ?? item?.copy_history?.[0]?.url ?? item?.url ?? ''),
                  thumbnail_url: image.url,
                }
              : null;
          }
          return null;
        })
        .filter((item) => item?.url);
      const body = String(item.text ?? '').trim() || 'VK';
      await insertPost(
        client,
        {
          title: body.split('\n')[0]?.slice(0, 90) || 'VK',
          body,
          status: 'published',
          source: 'vk',
          source_external_id: `${item.owner_id}_${item.id}`,
          source_url: item.url,
          published_at: item.date ? new Date(Number(item.date) * 1000).toISOString() : new Date().toISOString(),
          import_payload_json: item,
          media,
        },
        user,
      );
      imported += 1;
    }
    return { source: 'vk', status: 'ok', imported_count: imported };
  }

  function importJobPayload(row) {
    if (!row) return null;
    const sources = typeof row.sources_json === 'string' ? JSON.parse(row.sources_json) : row.sources_json;
    const result = typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json;
    return {
      ...row,
      sources: Array.isArray(sources) ? sources : [],
      result: result && typeof result === 'object' ? result : {},
    };
  }

  async function loadImportJob(client, id) {
    const result = await client.query('SELECT * FROM social_import_jobs WHERE id = $1', [id]);
    return importJobPayload(result.rows[0] ?? null);
  }

  async function createImportJob(client, sources, userId) {
    const result = await client.query(
      `INSERT INTO social_import_jobs
         (id, status, sources_json, result_json, attempt_count, max_attempts, created_by, created_at, updated_at)
       VALUES ($1,'queued',$2::jsonb,$3::jsonb,0,$4,$5,NOW(),NOW())
       RETURNING *`,
      [
        randomUUID(),
        JSON.stringify(sources),
        JSON.stringify({ sources: [] }),
        positiveInteger(process.env.SOCIAL_IMPORT_MAX_ATTEMPTS, 3),
        userId,
      ],
    );
    return importJobPayload(result.rows[0]);
  }

  async function writeImportRun(client, result, userId, jobId) {
    await client.query(
      `INSERT INTO social_import_runs (id, source, status, imported_count, message, payload_json, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,NOW())`,
      [
        randomUUID(),
        result.source,
        result.status,
        result.imported_count ?? 0,
        result.error ?? (result.missing?.length ? `Missing: ${result.missing.join(', ')}` : null),
        JSON.stringify({ ...result, job_id: jobId }),
        userId,
      ],
    );
  }

  async function runImportJob(jobId) {
    if (activeImportJobs.has(jobId)) return;
    activeImportJobs.add(jobId);
    scheduledImportJobs.delete(jobId);
    const client = await pool.connect();
    let job = null;
    let attemptNumber = 0;
    let maxAttempts = 3;
    try {
      job = await loadImportJob(client, jobId);
      if (!job || job.status !== 'queued') return;
      const nextRunAt = job.next_run_at ? new Date(job.next_run_at).getTime() : 0;
      if (Number.isFinite(nextRunAt) && nextRunAt > Date.now()) {
        enqueueImportJob(jobId, nextRunAt - Date.now());
        return;
      }
      attemptNumber = Number(job.attempt_count ?? 0) + 1;
      maxAttempts = Math.max(1, Number(job.max_attempts ?? 3));
      await client.query(
        `UPDATE social_import_jobs
         SET status = 'running',
             attempt_count = $2,
             started_at = NOW(),
             finished_at = NULL,
             next_run_at = NULL,
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [jobId, attemptNumber],
      );
      emitChange('social_import_jobs', 'updated', { id: jobId, status: 'running', attempt_count: attemptNumber });

      const results = [];
      for (const source of job.sources) {
        const circuitResult = importCircuitOpenResult(source);
        const result =
          circuitResult ??
          (source === 'instagram'
            ? await importInstagram(client, { id: job.created_by })
            : await importVk(client, { id: job.created_by }));
        recordImportCircuitResult(result);
        if (result.status === 'ok') {
          recordMetric('social_import_success_total', { source: result.source }, result.imported_count ?? 0);
          recordRecentEvent('social_import_success');
        } else if (result.status === 'failed') {
          recordMetric('social_import_failed_total', { source: result.source });
          recordRecentEvent('social_import_failed');
          logEvent('warn', 'social_import_failed', {
            source: result.source,
            job_id: jobId,
            error: result.error,
          });
        }
        await writeImportRun(client, result, job.created_by, jobId);
        results.push(result);
      }

      const finalStatus = results.some((result) => result.status === 'failed') ? 'failed' : 'succeeded';
      const failedMessage = results.find((result) => result.status === 'failed')?.error ?? 'Social import failed.';
      if (finalStatus === 'failed' && attemptNumber < maxAttempts) {
        const delayMs = socialImportRetryDelayMs(attemptNumber);
        const nextRunAt = new Date(Date.now() + delayMs).toISOString();
        const updated = (
          await client.query(
            `UPDATE social_import_jobs
             SET status = 'queued',
                 result_json = $2::jsonb,
                 message = $3,
                 next_run_at = $4,
                 last_error = $5,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
              jobId,
              JSON.stringify({ sources: results, retry: { next_run_at: nextRunAt, attempt: attemptNumber + 1, max_attempts: maxAttempts } }),
              `Retry ${attemptNumber + 1}/${maxAttempts} scheduled after provider failure.`,
              nextRunAt,
              failedMessage,
            ],
          )
        ).rows[0];
        recordMetric('social_import_retries_total', { source: 'job' });
        logEvent('warn', 'social_import_retry_scheduled', {
          job_id: jobId,
          attempt: attemptNumber,
          next_attempt: attemptNumber + 1,
          max_attempts: maxAttempts,
          next_run_at: nextRunAt,
          error: failedMessage,
        });
        emitChange('social_import_jobs', 'updated', importJobPayload(updated));
        enqueueImportJob(jobId, delayMs);
        return;
      }

      const updated = (
        await client.query(
          `UPDATE social_import_jobs
           SET status = $2,
               result_json = $3::jsonb,
               message = $4,
               next_run_at = NULL,
               last_error = $5,
               finished_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            jobId,
            finalStatus,
            JSON.stringify({ sources: results }),
            results
              .map((result) =>
                result.status === 'disabled'
                  ? `${result.source}: disabled`
                  : `${result.source}: ${result.status}, ${result.imported_count ?? 0} imported`,
              )
              .join('; '),
            finalStatus === 'failed' ? failedMessage : null,
          ],
        )
      ).rows[0];
      emitChange('social_import_jobs', 'updated', importJobPayload(updated));
    } catch (error) {
      if (attemptNumber > 0 && attemptNumber < maxAttempts) {
        const delayMs = socialImportRetryDelayMs(attemptNumber);
        const nextRunAt = new Date(Date.now() + delayMs).toISOString();
        await client.query(
          `UPDATE social_import_jobs
           SET status = 'queued',
               result_json = $2::jsonb,
               message = $3,
               next_run_at = $4,
               last_error = $5,
               updated_at = NOW()
           WHERE id = $1`,
          [
            jobId,
            JSON.stringify({ error: error.message, retry: { next_run_at: nextRunAt, attempt: attemptNumber + 1, max_attempts: maxAttempts } }),
            `Retry ${attemptNumber + 1}/${maxAttempts} scheduled after import error.`,
            nextRunAt,
            error.message,
          ],
        );
        recordMetric('social_import_retries_total', { source: 'job' });
        logEvent('warn', 'social_import_retry_scheduled', {
          job_id: jobId,
          attempt: attemptNumber,
          next_attempt: attemptNumber + 1,
          max_attempts: maxAttempts,
          next_run_at: nextRunAt,
          error: error.message,
        });
        emitChange('social_import_jobs', 'updated', { id: jobId, status: 'queued', attempt_count: attemptNumber, next_run_at: nextRunAt });
        enqueueImportJob(jobId, delayMs);
        return;
      }
      await client.query(
        `UPDATE social_import_jobs
         SET status = 'failed',
             result_json = $2::jsonb,
             message = $3,
             next_run_at = NULL,
             last_error = $3,
             finished_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [jobId, JSON.stringify({ error: error.message }), error.message],
      );
      recordMetric('social_import_failed_total', { source: 'job' });
      recordRecentEvent('social_import_failed');
      logEvent('error', 'social_import_job_failed', { job_id: jobId, message: error.message });
      emitChange('social_import_jobs', 'updated', { id: jobId, status: 'failed' });
    } finally {
      activeImportJobs.delete(jobId);
      client.release();
    }
  }

  function enqueueImportJob(jobId, delayMs = 0) {
    const existingTimer = scheduledImportJobs.get(jobId);
    if (existingTimer) clearTimeout(existingTimer);

    const run = () => {
      scheduledImportJobs.delete(jobId);
      void runImportJob(jobId);
    };
    if (delayMs > 0) {
      const timer = setTimeout(run, delayMs);
      timer.unref?.();
      scheduledImportJobs.set(jobId, timer);
      return;
    }
    setImmediate(run);
  }

  function resumeQueuedImportJobs() {
    const timer = setTimeout(async () => {
      try {
        const result = await query(
          `SELECT id, next_run_at
           FROM social_import_jobs
           WHERE status = 'queued'
           ORDER BY COALESCE(next_run_at, created_at) ASC
           LIMIT 20`,
        );
        for (const job of result.rows) {
          const nextRunAt = job.next_run_at ? new Date(job.next_run_at).getTime() : 0;
          const delayMs = Number.isFinite(nextRunAt) && nextRunAt > Date.now() ? nextRunAt - Date.now() : 0;
          enqueueImportJob(job.id, delayMs);
        }
      } catch (error) {
        logEvent('warn', 'social_import_resume_failed', { message: error.message });
      }
    }, 1000);
    timer.unref?.();
  }

  resumeQueuedImportJobs();

  app.get(
    '/guest/news',
    optionalGuestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const requestedLimit = Number(req.query.limit ?? 10);
      const requestedOffset = Number(req.query.offset ?? 0);
      const limit = Math.min(20, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10));
      const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);
      const result = await query(
        `SELECT *
         FROM social_posts
         WHERE status = 'published'
         ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const countResult = await query("SELECT COUNT(*)::int AS count FROM social_posts WHERE status = 'published'");
      const total = Number(countResult.rows[0]?.count ?? 0);
      const nextOffset = offset + result.rows.length;
      const hasMore = nextOffset < total;
      const client = await pool.connect();
      try {
        res.json({
          items: await attachPostRelations(client, result.rows, req.guest?.id ?? null),
          pagination: {
            limit,
            offset,
            total,
            next_offset: hasMore ? nextOffset : null,
            has_more: hasMore,
          },
        });
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/guest/news/:id/like',
    guestAuthMiddleware,
    socialLikeRateLimiter,
    asyncHandler(async (req, res) => {
      const post = (await query('SELECT * FROM social_posts WHERE id = $1', [req.params.id])).rows[0];
      if (!post || !publishedStatuses.has(post.status)) throw httpError('Новость не найдена.', 404);
      await query(
        `INSERT INTO social_post_likes (post_id, guest_id, created_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (post_id, guest_id) DO NOTHING`,
        [req.params.id, req.guest.id],
      );
      const count = await query('SELECT COUNT(*)::int AS count FROM social_post_likes WHERE post_id = $1', [req.params.id]);
      res.json({ liked: true, like_count: Number(count.rows[0]?.count ?? 0) });
    }),
  );

  app.delete(
    '/guest/news/:id/like',
    guestAuthMiddleware,
    socialLikeRateLimiter,
    asyncHandler(async (req, res) => {
      await query('DELETE FROM social_post_likes WHERE post_id = $1 AND guest_id = $2', [req.params.id, req.guest.id]);
      const count = await query('SELECT COUNT(*)::int AS count FROM social_post_likes WHERE post_id = $1', [req.params.id]);
      res.json({ liked: false, like_count: Number(count.rows[0]?.count ?? 0) });
    }),
  );

  app.get(
    '/guest/news/:id/comments',
    optionalGuestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const requestedLimit = Number(req.query.limit ?? 20);
      const requestedOffset = Number(req.query.offset ?? 0);
      const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20));
      const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);
      const post = (await query('SELECT * FROM social_posts WHERE id = $1', [req.params.id])).rows[0];
      if (!post || !publishedStatuses.has(post.status)) throw httpError('РќРѕРІРѕСЃС‚СЊ РЅРµ РЅР°Р№РґРµРЅР°.', 404);
      const result = await query(
        `SELECT c.*, gu.name AS guest_name
         FROM social_post_comments c
         JOIN guest_users gu ON gu.id = c.guest_id
         WHERE c.post_id = $1 AND c.status = 'visible'
         ORDER BY c.created_at ASC, c.id ASC
         LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset],
      );
      const count = await query(
        `SELECT COUNT(*)::int AS count
         FROM social_post_comments
         WHERE post_id = $1 AND status = 'visible'`,
        [req.params.id],
      );
      const total = Number(count.rows[0]?.count ?? 0);
      const nextOffset = offset + result.rows.length;
      const hasMore = nextOffset < total;
      res.json({
        items: result.rows,
        pagination: {
          limit,
          offset,
          total,
          next_offset: hasMore ? nextOffset : null,
          has_more: hasMore,
        },
      });
    }),
  );

  app.post(
    '/guest/news/:id/comments',
    guestAuthMiddleware,
    socialCommentRateLimiter,
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const post = (await client.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id])).rows[0];
        if (!post || !publishedStatuses.has(post.status)) throw httpError('Новость не найдена.', 404);
        const text = normalizeCommentText(req.body?.text);
        if (text.length < 2) throw httpError('Введите комментарий.', 400);
        if (text.length > 600) throw httpError('Комментарий слишком длинный.', 400);

        const violation = await commentPolicyViolation(client, req.guest, req.params.id, text);
        if (violation) {
          if (violation.status !== 429) await insertRejectedComment(client, req.params.id, req.guest, text, violation.reason);
          throw httpError(violation.message, violation.status);
        }

        const result = await client.query(
          `INSERT INTO social_post_comments (id, post_id, guest_id, text, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'visible',NOW(),NOW())
           RETURNING *`,
          [randomUUID(), req.params.id, req.guest.id, text],
        );
        emitChange('social_post_comments', 'created', result.rows[0]);
        res.status(201).json({ ...result.rows[0], guest_name: req.guest.name });
      } finally {
        client.release();
      }
    }),
  );

  app.get(
    '/social/posts',
    authMiddleware,
    requirePermission('view:smm'),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        const result = await client.query('SELECT * FROM social_posts ORDER BY COALESCE(published_at, created_at) DESC LIMIT 100');
        res.json({ items: await attachPostRelations(client, result.rows, null) });
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/social/posts',
    authMiddleware,
    requirePermission('manage:social_feed'),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const post = await insertPost(client, req.body ?? {}, req.user);
        if (post.status === 'published') {
          await createRoleNotifications(client, ['management'], {
            title: 'Опубликована новость для гостей',
            text: post.title,
            type: 'social_post',
            data: { post_id: post.id },
          });
        }
        await client.query('COMMIT');
        emitChange('social_posts', 'created', post);
        res.status(201).json(post);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.patch(
    '/social/posts/:id',
    authMiddleware,
    requirePermission('manage:social_feed'),
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const updates = [];
      const values = [req.params.id];
      if (body.title !== undefined) {
        values.push(String(body.title).trim());
        updates.push(`title = $${values.length}`);
      }
      if (body.body !== undefined || body.text !== undefined) {
        values.push(String(body.body ?? body.text ?? '').trim());
        updates.push(`body = $${values.length}`);
      }
      if (body.status !== undefined) {
        values.push(normalizeStatus(body.status));
        updates.push(`status = $${values.length}`);
        updates.push(`published_at = CASE WHEN $${values.length} = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END`);
      }
      if (!updates.length) throw httpError('Нет изменений.', 400);
      const result = await query(
        `UPDATE social_posts
         SET ${updates.join(', ')}, updated_at = NOW(), version = version + 1
         WHERE id = $1
         RETURNING *`,
        values,
      );
      if (!result.rows[0]) throw httpError('Новость не найдена.', 404);
      emitChange('social_posts', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.get(
    '/social/comments',
    authMiddleware,
    requirePermission('view:smm'),
    asyncHandler(async (req, res) => {
      const status = String(req.query.status ?? 'all').trim().toLowerCase();
      const where = allowedCommentStatuses.has(status) ? 'WHERE c.status = $1' : '';
      const params = allowedCommentStatuses.has(status) ? [status] : [];
      const result = await query(
        `SELECT c.*, gu.name AS guest_name, sp.title AS post_title
         FROM social_post_comments c
         JOIN guest_users gu ON gu.id = c.guest_id
         JOIN social_posts sp ON sp.id = c.post_id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT 300`,
        params,
      );
      res.json({ items: result.rows });
    }),
  );

  app.patch(
    '/social/comments/:id',
    authMiddleware,
    requirePermission('manage:social_feed'),
    asyncHandler(async (req, res) => {
      const status = String(req.body?.status ?? '').trim().toLowerCase();
      if (!allowedCommentStatuses.has(status)) throw httpError('Передайте корректный статус комментария.', 400);
      const result = await query(
        `UPDATE social_post_comments
         SET status = $2, updated_at = NOW(), version = version + 1
         WHERE id = $1
         RETURNING *`,
        [req.params.id, status],
      );
      if (!result.rows[0]) throw httpError('Комментарий не найден.', 404);
      emitChange('social_post_comments', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.get(
    '/social/comment-blocklist',
    authMiddleware,
    requirePermission('view:smm'),
    asyncHandler(async (_req, res) => {
      const result = await query(
        `SELECT *
         FROM social_comment_blocklist
         ORDER BY status ASC, created_at DESC
         LIMIT 500`,
      );
      res.json({ items: result.rows });
    }),
  );

  app.post(
    '/social/comment-blocklist',
    authMiddleware,
    requirePermission('manage:social_feed'),
    asyncHandler(async (req, res) => {
      const word = normalizeCommentText(req.body?.word);
      const normalizedWord = compactCommentForModeration(word);
      if (normalizedWord.length < 2) throw httpError('Передайте слово для стоп-листа.', 400);
      const result = await query(
        `INSERT INTO social_comment_blocklist (id, word, normalized_word, status, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,'active',$4,NOW(),NOW())
         ON CONFLICT (normalized_word)
         DO UPDATE SET word = EXCLUDED.word, status = 'active', updated_at = NOW()
         RETURNING *`,
        [randomUUID(), word, normalizedWord, req.user.id],
      );
      emitChange('social_comment_blocklist', 'updated', result.rows[0]);
      res.status(201).json(result.rows[0]);
    }),
  );

  app.patch(
    '/social/comment-blocklist/:id',
    authMiddleware,
    requirePermission('manage:social_feed'),
    asyncHandler(async (req, res) => {
      const status = String(req.body?.status ?? '').trim().toLowerCase();
      if (!['active', 'inactive'].includes(status)) throw httpError('Передайте active или inactive.', 400);
      const result = await query(
        `UPDATE social_comment_blocklist
         SET status = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [req.params.id, status],
      );
      if (!result.rows[0]) throw httpError('Слово не найдено.', 404);
      emitChange('social_comment_blocklist', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.get(
    '/social/import/jobs',
    authMiddleware,
    requirePermission('view:smm'),
    asyncHandler(async (_req, res) => {
      const result = await query(
        `SELECT *
         FROM social_import_jobs
         ORDER BY created_at DESC
         LIMIT 50`,
      );
      res.json({ items: result.rows.map(importJobPayload) });
    }),
  );

  app.get(
    '/social/import/jobs/:id',
    authMiddleware,
    requirePermission('view:smm'),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const job = await loadImportJob(client, req.params.id);
        if (!job) throw httpError('Задача импорта не найдена.', 404);
        res.json({ job });
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/social/import/run',
    authMiddleware,
    requirePermission('manage:social_feed'),
    asyncHandler(async (req, res) => {
      const sources = normalizeImportSources(req.body?.sources);
      if (!sources.length) throw httpError('Передайте источники импорта: instagram или vk.', 400);
      const client = await pool.connect();
      try {
        const job = await createImportJob(client, sources, req.user.id);
        emitChange('social_import_jobs', 'created', job);
        enqueueImportJob(job.id);
        res.status(202).json({ job });
      } finally {
        client.release();
      }
    }),
  );
}

module.exports = { registerSocialRoutes };
