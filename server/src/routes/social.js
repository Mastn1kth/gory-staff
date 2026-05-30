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
  } = deps;

  const publishedStatuses = new Set(['published']);
  const allowedStatuses = new Set(['draft', 'published', 'hidden']);
  const allowedMediaTypes = new Set(['image', 'video']);
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
    'РґСѓСЂР°Рє',
  ];

  function normalizeStatus(value) {
    const status = String(value ?? 'draft').trim().toLowerCase();
    return allowedStatuses.has(status) ? status : 'draft';
  }

  function normalizeSource(value) {
    const source = String(value ?? 'manual').trim().toLowerCase();
    return ['manual', 'instagram', 'vk'].includes(source) ? source : 'manual';
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

  function containsBlockedWords(value) {
    const text = String(value ?? '').toLowerCase();
    return commentBlocklist.some((word) => text.includes(word));
  }

  async function attachPostRelations(client, posts, guestId = null, { includeComments = true } = {}) {
    if (!posts.length) return [];
    const postIds = posts.map((post) => post.id);
    const singlePostId = postIds.length === 1 ? postIds[0] : null;
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
             WHERE post_id = ANY($1::text[])
             ORDER BY post_id ASC, sort_order ASC, created_at ASC`,
            [postIds],
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
             WHERE post_id = ANY($1::text[])
             GROUP BY post_id`,
            [postIds],
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
             WHERE post_id = ANY($1::text[]) AND status = 'visible'
             GROUP BY post_id`,
            [postIds],
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
               WHERE post_id = ANY($1::text[]) AND guest_id = $2`,
              [postIds, guestId],
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
               WHERE c.post_id = ANY($1::text[]) AND c.status = 'visible'
               ORDER BY c.created_at ASC`,
              [postIds],
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
    const existing =
      sourceExternalId
        ? (
            await client.query(
              'SELECT * FROM social_posts WHERE source = $1 AND source_external_id = $2 LIMIT 1',
              [source, sourceExternalId],
            )
          ).rows[0]
        : null;
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
      if (body?.source_external_id) await client.query('DELETE FROM social_post_media WHERE post_id = $1', [post.id]);
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
    const response = await fetch(url);
    if (!response.ok) {
      return { source: 'instagram', status: 'failed', imported_count: 0, error: `Instagram API ${response.status}` };
    }
    const payload = await response.json();
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
    const response = await fetch(url);
    if (!response.ok) return { source: 'vk', status: 'failed', imported_count: 0, error: `VK API ${response.status}` };
    const payload = await response.json();
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

  app.get(
    '/guest/news',
    optionalGuestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const result = await query(
        `SELECT *
         FROM social_posts
         WHERE status = 'published'
         ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC
         LIMIT 40`,
      );
      const client = await pool.connect();
      try {
        res.json({ items: await attachPostRelations(client, result.rows, req.guest?.id ?? null) });
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/guest/news/:id/like',
    guestAuthMiddleware,
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
    asyncHandler(async (req, res) => {
      await query('DELETE FROM social_post_likes WHERE post_id = $1 AND guest_id = $2', [req.params.id, req.guest.id]);
      const count = await query('SELECT COUNT(*)::int AS count FROM social_post_likes WHERE post_id = $1', [req.params.id]);
      res.json({ liked: false, like_count: Number(count.rows[0]?.count ?? 0) });
    }),
  );

  app.post(
    '/guest/news/:id/comments',
    guestAuthMiddleware,
    asyncHandler(async (req, res) => {
      const post = (await query('SELECT * FROM social_posts WHERE id = $1', [req.params.id])).rows[0];
      if (!post || !publishedStatuses.has(post.status)) throw httpError('Новость не найдена.', 404);
      const text = String(req.body?.text ?? '').replace(/\s+/g, ' ').trim();
      if (text.length < 2) throw httpError('Введите комментарий.', 400);
      if (text.length > 600) throw httpError('Комментарий слишком длинный.', 400);
      if (containsBlockedWords(text)) throw httpError('Комментарий не прошел базовую проверку.', 400);

      const result = await query(
        `INSERT INTO social_post_comments (id, post_id, guest_id, text, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'visible',NOW(),NOW())
         RETURNING *`,
        [randomUUID(), req.params.id, req.guest.id, text],
      );
      emitChange('social_post_comments', 'created', result.rows[0]);
      res.status(201).json({ ...result.rows[0], guest_name: req.guest.name });
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

  app.post(
    '/social/import/run',
    authMiddleware,
    requirePermission('manage:social_feed'),
    asyncHandler(async (req, res) => {
      const requested = Array.isArray(req.body?.sources) && req.body.sources.length ? req.body.sources : ['instagram', 'vk'];
      const sources = requested
        .map((source) => String(source).trim().toLowerCase())
        .filter((source) => ['instagram', 'vk'].includes(source));
      const client = await pool.connect();
      try {
        const results = [];
        for (const source of sources) {
          const result = source === 'instagram' ? await importInstagram(client, req.user) : await importVk(client, req.user);
          await client.query(
            `INSERT INTO social_import_runs (id, source, status, imported_count, message, payload_json, created_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
            [
              randomUUID(),
              result.source,
              result.status,
              result.imported_count ?? 0,
              result.error ?? (result.missing?.length ? `Missing: ${result.missing.join(', ')}` : null),
              result,
              req.user.id,
            ],
          );
          results.push(result);
        }
        emitChange('social_import_runs', 'created', { sources: results });
        res.json({ sources: results });
      } finally {
        client.release();
      }
    }),
  );
}

module.exports = { registerSocialRoutes };
