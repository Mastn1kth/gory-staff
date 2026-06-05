/**
 * OAuth интеграция для входа гостей через Яндекс и ВКонтакте
 */

const crypto = require('crypto');
const { fetchWithTimeout, timeoutFromEnv } = require('../http');

function oauthFetchTimeoutMs() {
  return timeoutFromEnv('OAUTH_FETCH_TIMEOUT_MS');
}

/**
 * Получить URL для авторизации через Яндекс
 */
function getYandexAuthUrl(redirectUri, state) {
  const clientId = process.env.YANDEX_CLIENT_ID;
  if (!clientId) {
    throw new Error('YANDEX_CLIENT_ID не настроен в .env');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: state,
    display: 'popup',
  });

  return `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

/**
 * Получить URL для авторизации через ВКонтакте
 */
function getVkAuthUrl(redirectUri, state) {
  const clientId = process.env.VK_CLIENT_ID;
  if (!clientId) {
    throw new Error('VK_CLIENT_ID не настроен в .env');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    display: 'mobile',
    scope: 'email',
    response_type: 'code',
    state: state,
    v: '5.131',
  });

  return `https://oauth.vk.com/authorize?${params.toString()}`;
}

/**
 * Обменять код на токен Яндекс
 */
async function exchangeYandexCode(code, redirectUri) {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YANDEX_CLIENT_ID или YANDEX_CLIENT_SECRET не настроены');
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetchWithTimeout('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    timeoutMs: oauthFetchTimeoutMs(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Яндекс OAuth ошибка: ${error}`);
  }

  return await response.json();
}

/**
 * Получить информацию о пользователе Яндекс
 */
async function getYandexUserInfo(accessToken) {
  const response = await fetchWithTimeout('https://login.yandex.ru/info?format=json', {
    headers: {
      Authorization: `OAuth ${accessToken}`,
    },
    timeoutMs: oauthFetchTimeoutMs(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Яндекс API ошибка: ${error}`);
  }

  const data = await response.json();

  return {
    id: data.id,
    email: data.default_email || data.emails?.[0] || null,
    name: data.display_name || data.real_name || data.login,
    firstName: data.first_name,
    lastName: data.last_name,
    avatarUrl: data.default_avatar_id ? `https://avatars.yandex.net/get-yapic/${data.default_avatar_id}/islands-200` : null,
    phone: data.default_phone?.number || null,
  };
}

/**
 * Обменять код на токен ВКонтакте
 */
async function exchangeVkCode(code, redirectUri) {
  const clientId = process.env.VK_CLIENT_ID;
  const clientSecret = process.env.VK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('VK_CLIENT_ID или VK_CLIENT_SECRET не настроены');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: code,
  });

  const response = await fetchWithTimeout(`https://oauth.vk.com/access_token?${params.toString()}`, {
    timeoutMs: oauthFetchTimeoutMs(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ВК OAuth ошибка: ${error}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`ВК OAuth ошибка: ${data.error_description || data.error}`);
  }

  return data;
}

/**
 * Получить информацию о пользователе ВКонтакте
 */
async function getVkUserInfo(accessToken, userId) {
  const params = new URLSearchParams({
    user_ids: userId,
    fields: 'photo_200,screen_name,first_name,last_name',
    access_token: accessToken,
    v: '5.131',
  });

  const response = await fetchWithTimeout(`https://api.vk.com/method/users.get?${params.toString()}`, {
    timeoutMs: oauthFetchTimeoutMs(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ВК API ошибка: ${error}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`ВК API ошибка: ${data.error.error_msg}`);
  }

  const user = data.response?.[0];
  if (!user) {
    throw new Error('ВК: пользователь не найден');
  }

  return {
    id: user.id.toString(),
    name: `${user.first_name} ${user.last_name}`.trim(),
    firstName: user.first_name,
    lastName: user.last_name,
    avatarUrl: user.photo_200 || null,
    email: null, // Email приходит в токене, если был запрошен scope
  };
}

/**
 * Генерировать случайный state для защиты от CSRF
 */
function generateOAuthState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Проверить state для защиты от CSRF
 */
function verifyOAuthState(receivedState, expectedState) {
  if (!receivedState || !expectedState) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(receivedState),
    Buffer.from(expectedState)
  );
}

/**
 * Нормализовать телефон из OAuth
 */
function normalizeOAuthPhone(phone) {
  if (!phone) return null;

  // Убираем все кроме цифр
  const digits = phone.replace(/\D/g, '');

  // Если начинается с 8, заменяем на 7
  if (digits.startsWith('8') && digits.length === 11) {
    return `+7${digits.slice(1)}`;
  }

  // Если начинается с 7, добавляем +
  if (digits.startsWith('7') && digits.length === 11) {
    return `+${digits}`;
  }

  // Если 10 цифр, добавляем +7
  if (digits.length === 10) {
    return `+7${digits}`;
  }

  return null;
}

module.exports = {
  getYandexAuthUrl,
  getVkAuthUrl,
  exchangeYandexCode,
  getYandexUserInfo,
  exchangeVkCode,
  getVkUserInfo,
  generateOAuthState,
  verifyOAuthState,
  normalizeOAuthPhone,
};
