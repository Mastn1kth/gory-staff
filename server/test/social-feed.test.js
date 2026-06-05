const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { api, delay, startTestServer: startSharedTestServer } = require('./test-helpers');

const serverRoot = path.resolve(__dirname, '..');

async function expectApiError(request) {
  try {
    await request();
  } catch (error) {
    return error;
  }
  throw new Error('Expected API request to fail.');
}

async function startTestServer(extraEnv = {}) {
  return startSharedTestServer({
    INSTAGRAM_ACCESS_TOKEN: '',
    INSTAGRAM_BUSINESS_ACCOUNT_ID: '',
    VK_ACCESS_TOKEN: '',
    VK_GROUP_ID: '',
    VK_SEARCH_QUERY: '',
    ...extraEnv,
  });
}

async function loginOwner(server) {
  return api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });
}

async function createPublishedNewsPost(server, token, title = 'Rate limit news') {
  return api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title,
      body: 'Published social post for guest interaction checks.',
      status: 'published',
    }),
  });
}

async function registerGuest(server, phone = '+7 900 301-00-01') {
  return api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Rate Limit Guest',
      phone,
      personal_data_consent: true,
    }),
  });
}

test('smm manager publishes guest news with media and guests can like and comment after login', async (t) => {
  const server = await startTestServer();
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });

  await api(server.baseUrl, '/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      name: 'SMM Manager',
      phone: '+7 900 100-99-01',
      login: 'smm',
      password: 'SmmManager-2026!',
      role: 'smm_manager',
      position: 'SMM менеджер',
      status: 'on_shift',
    }),
  });

  const smm = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'smm', password: 'SmmManager-2026!' }),
  });
  assert.equal(smm.user.role, 'smm_manager');

  const smmSync = await api(server.baseUrl, '/sync', {
    headers: { Authorization: `Bearer ${smm.token}` },
  });
  assert.ok(smmSync.sections.includes('smm'));

  const post = await api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${smm.token}` },
    body: JSON.stringify({
      title: 'Новое меню',
      body: 'Показываем гостям новый пост с фото и видео.',
      status: 'published',
      media: [
        { media_type: 'image', url: 'https://example.test/dish.jpg' },
        { media_type: 'video', url: 'https://example.test/dish.mp4', thumbnail_url: 'https://example.test/dish-thumb.jpg' },
      ],
    }),
  });
  assert.equal(post.status, 'published');
  assert.equal(post.media.length, 2);

  const publicFeed = await api(server.baseUrl, '/guest/news');
  assert.equal(publicFeed.items[0].id, post.id);
  assert.equal(publicFeed.items[0].like_count, 0);
  assert.equal(publicFeed.items[0].comment_count, 0);
  assert.equal(publicFeed.pagination.limit, 10);
  assert.equal(publicFeed.pagination.has_more, false);

  await api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${smm.token}` },
    body: JSON.stringify({
      title: 'Р’С‚РѕСЂР°СЏ РЅРѕРІРѕСЃС‚СЊ',
      body: 'РџСЂРѕРІРµСЂСЏРµРј РїРµСЂРІСѓСЋ СЃС‚СЂР°РЅРёС†Сѓ Р»РµРЅС‚С‹.',
      status: 'published',
    }),
  });
  await api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${smm.token}` },
    body: JSON.stringify({
      title: 'РўСЂРµС‚СЊСЏ РЅРѕРІРѕСЃС‚СЊ',
      body: 'РџСЂРѕРІРµСЂСЏРµРј РІС‚РѕСЂСѓСЋ СЃС‚СЂР°РЅРёС†Сѓ Р»РµРЅС‚С‹.',
      status: 'published',
    }),
  });
  const firstPage = await api(server.baseUrl, '/guest/news?limit=2&offset=0');
  assert.equal(firstPage.items.length, 2);
  assert.equal(firstPage.pagination.limit, 2);
  assert.equal(firstPage.pagination.offset, 0);
  assert.equal(firstPage.pagination.next_offset, 2);
  assert.equal(firstPage.pagination.has_more, true);
  const secondPage = await api(server.baseUrl, '/guest/news?limit=2&offset=2');
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.items[0].id, post.id);
  assert.equal(secondPage.pagination.has_more, false);

  const guest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'News Guest',
      phone: '+7 900 300-44-55',
      personal_data_consent: true,
    }),
  });

  const anonLike = await expectApiError(() =>
    api(server.baseUrl, `/guest/news/${post.id}/like`, {
      method: 'POST',
    }),
  );
  assert.equal(anonLike.status, 401);

  const like = await api(server.baseUrl, `/guest/news/${post.id}/like`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
  });
  assert.equal(like.liked, true);

  const comment = await api(server.baseUrl, `/guest/news/${post.id}/comments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}` },
    body: JSON.stringify({ text: 'Красиво, хочу попробовать.' }),
  });
  assert.equal(comment.status, 'visible');
  assert.equal(comment.text, 'Красиво, хочу попробовать.');

  const secondGuest = await api(server.baseUrl, '/guest/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Second News Guest',
      phone: '+7 900 300-44-56',
      personal_data_consent: true,
    }),
  });
  const secondComment = await api(server.baseUrl, `/guest/news/${post.id}/comments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secondGuest.token}` },
    body: JSON.stringify({ text: 'Second visible comment for pagination.' }),
  });
  assert.equal(secondComment.status, 'visible');

  const commentsFirstPage = await api(server.baseUrl, `/guest/news/${post.id}/comments?limit=1&offset=0`);
  assert.equal(commentsFirstPage.items.length, 1);
  assert.equal(commentsFirstPage.items[0].guest_name, 'News Guest');
  assert.equal(commentsFirstPage.pagination.limit, 1);
  assert.equal(commentsFirstPage.pagination.offset, 0);
  assert.equal(commentsFirstPage.pagination.total, 2);
  assert.equal(commentsFirstPage.pagination.next_offset, 1);
  assert.equal(commentsFirstPage.pagination.has_more, true);
  const commentsSecondPage = await api(server.baseUrl, `/guest/news/${post.id}/comments?limit=1&offset=1`);
  assert.equal(commentsSecondPage.items.length, 1);
  assert.equal(commentsSecondPage.items[0].id, secondComment.id);
  assert.equal(commentsSecondPage.pagination.has_more, false);

  const badComment = await expectApiError(() =>
    api(server.baseUrl, `/guest/news/${post.id}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest.token}` },
      body: JSON.stringify({ text: 'дурак' }),
    }),
  );
  assert.equal(badComment.status, 400);

  const guestFeed = await api(server.baseUrl, '/guest/news', {
    headers: { Authorization: `Bearer ${guest.token}` },
  });
  const guestFeedPost = guestFeed.items.find((item) => item.id === post.id);
  assert.equal(guestFeedPost.liked_by_me, true);
  assert.equal(guestFeedPost.like_count, 1);
  assert.equal(guestFeedPost.comment_count, 2);
  assert.equal(guestFeedPost.comments[0].guest_name, 'News Guest');
});

test('social import-style posts update duplicates by source url and normalized text', async (t) => {
  const server = await startTestServer();
  t.after(server.stop);

  const manager = await loginOwner(server);
  const first = await api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      title: 'VK event',
      body: 'Live music this Friday',
      source: 'vk',
      source_url: 'https://vk.example/wall-1_1',
      status: 'published',
      media: [{ media_type: 'image', url: 'https://example.test/old.jpg' }],
    }),
  });

  const updatedByUrl = await api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      title: 'VK event updated',
      body: 'Live music this Friday. Updated photo.',
      source: 'vk',
      source_url: 'https://vk.example/wall-1_1',
      status: 'published',
      media: [{ media_type: 'image', url: 'https://example.test/new.jpg' }],
    }),
  });
  assert.equal(updatedByUrl.id, first.id);
  assert.equal(updatedByUrl.body, 'Live music this Friday. Updated photo.');
  assert.equal(updatedByUrl.media.length, 1);
  assert.equal(updatedByUrl.media[0].url, 'https://example.test/new.jpg');

  const instagramFirst = await api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      title: 'Weekend banquet',
      body: 'Book the mountain hall for a weekend banquet',
      source: 'instagram',
      source_url: 'https://instagram.example/p/one',
      status: 'published',
    }),
  });
  const updatedByText = await api(server.baseUrl, '/social/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({
      title: 'Weekend banquet',
      body: 'Book the mountain hall for a weekend banquet',
      source: 'instagram',
      source_url: 'https://instagram.example/p/two',
      status: 'published',
    }),
  });
  assert.equal(updatedByText.id, instagramFirst.id);

  const posts = await api(server.baseUrl, '/social/posts', {
    headers: { Authorization: `Bearer ${manager.token}` },
  });
  assert.equal(posts.items.filter((item) => item.id === first.id).length, 1);
  assert.equal(posts.items.filter((item) => item.id === instagramFirst.id).length, 1);
});

test('guest social comments and likes have dedicated rate limits', async (t) => {
  const server = await startTestServer({
    GUEST_SOCIAL_COMMENT_RATE_LIMIT_MAX: '1',
    GUEST_SOCIAL_COMMENT_RATE_LIMIT_WINDOW_MS: '60000',
    GUEST_SOCIAL_LIKE_RATE_LIMIT_MAX: '2',
    GUEST_SOCIAL_LIKE_RATE_LIMIT_WINDOW_MS: '60000',
  });
  t.after(server.stop);

  const manager = await loginOwner(server);
  const post = await createPublishedNewsPost(server, manager.token);
  const guest = await registerGuest(server, '+7 900 301-00-02');
  const guestHeaders = { Authorization: `Bearer ${guest.token}` };

  const firstComment = await api(server.baseUrl, `/guest/news/${post.id}/comments`, {
    method: 'POST',
    headers: guestHeaders,
    body: JSON.stringify({ text: 'First normal comment' }),
  });
  assert.equal(firstComment.status, 'visible');

  const secondComment = await expectApiError(() =>
    api(server.baseUrl, `/guest/news/${post.id}/comments`, {
      method: 'POST',
      headers: guestHeaders,
      body: JSON.stringify({ text: 'Second normal comment' }),
    }),
  );
  assert.equal(secondComment.status, 429);

  await api(server.baseUrl, `/guest/news/${post.id}/like`, {
    method: 'POST',
    headers: guestHeaders,
  });
  await api(server.baseUrl, `/guest/news/${post.id}/like`, {
    method: 'DELETE',
    headers: guestHeaders,
  });
  const tooManyLikes = await expectApiError(() =>
    api(server.baseUrl, `/guest/news/${post.id}/like`, {
      method: 'POST',
      headers: guestHeaders,
    }),
  );
  assert.equal(tooManyLikes.status, 429);
});

test('guest social comment moderation catches obfuscated blocked words', async (t) => {
  const server = await startTestServer();
  t.after(server.stop);

  const manager = await loginOwner(server);
  const post = await createPublishedNewsPost(server, manager.token, 'Moderation news');
  const guest = await registerGuest(server, '+7 900 301-00-03');

  const badComment = await expectApiError(() =>
    api(server.baseUrl, `/guest/news/${post.id}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest.token}` },
      body: JSON.stringify({ text: 'b.a.d w0rd' }),
    }),
  );
  assert.equal(badComment.status, 400);

  const rejected = await api(server.baseUrl, '/social/comments?status=rejected', {
    headers: { Authorization: `Bearer ${manager.token}` },
  });
  assert.equal(rejected.items.length, 1);
  assert.equal(rejected.items[0].status, 'rejected');

  const restored = await api(server.baseUrl, `/social/comments/${rejected.items[0].id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ status: 'visible' }),
  });
  assert.equal(restored.status, 'visible');

  const blockedWord = await api(server.baseUrl, '/social/comment-blocklist', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ word: 'zapretword' }),
  });
  assert.equal(blockedWord.status, 'active');

  const secondGuest = await registerGuest(server, '+7 900 301-00-04');
  const customBadComment = await expectApiError(() =>
    api(server.baseUrl, `/guest/news/${post.id}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secondGuest.token}` },
      body: JSON.stringify({ text: 'zapretword прямо тут' }),
    }),
  );
  assert.equal(customBadComment.status, 400);
});

test('social import endpoint enqueues a job and records missing Instagram and VK credentials', async (t) => {
  const server = await startTestServer();
  t.after(server.stop);

  const manager = await api(server.baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: 'owner@example.test', password: 'OwnerTestPass-2026!' }),
  });

  const result = await api(server.baseUrl, '/social/import/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify({ sources: ['instagram', 'vk'] }),
  });

  assert.equal(result.job.status, 'queued');
  assert.deepEqual(result.job.sources, ['instagram', 'vk']);

  let job = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await api(server.baseUrl, `/social/import/jobs/${result.job.id}`, {
      headers: { Authorization: `Bearer ${manager.token}` },
    });
    job = status.job;
    if (['succeeded', 'failed'].includes(job.status)) break;
    await delay(50);
  }

  assert.equal(job.status, 'succeeded');
  assert.deepEqual(job.result.sources.map((item) => item.source), ['instagram', 'vk']);
  assert.ok(job.result.sources.every((item) => item.status === 'disabled'));
});

test('social import credentials are documented in env example', () => {
  const envExample = fs.readFileSync(path.join(serverRoot, '.env.example'), 'utf8');
  assert.match(envExample, /INSTAGRAM_ACCESS_TOKEN=/);
  assert.match(envExample, /INSTAGRAM_BUSINESS_ACCOUNT_ID=/);
  assert.match(envExample, /VK_ACCESS_TOKEN=/);
  assert.match(envExample, /VK_GROUP_ID=/);
  assert.match(envExample, /VK_SEARCH_QUERY=/);
});
