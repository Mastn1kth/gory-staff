# Настройка OAuth для входа гостей

Дата: 2026-05-30

## Обзор

Гости могут входить в приложение "Горы" через:
- ✅ **Яндекс** (Yandex ID)
- ✅ **ВКонтакте** (VK ID)
- ❌ Google (не реализовано)

## 🎯 Преимущества OAuth

- **Быстрая регистрация** - один клик вместо формы
- **Нет необходимости запоминать пароль**
- **Автоматическое заполнение** имени и аватара
- **Безопасность** - не храним пароли гостей
- **Удобство** - вход через знакомые сервисы

---

## 📋 Настройка Яндекс OAuth

### Шаг 1: Создать приложение

1. Перейдите на https://oauth.yandex.ru/
2. Нажмите "Зарегистрировать новое приложение"
3. Заполните форму:
   - **Название**: Горы - Ресторан
   - **Платформы**: Выберите "Веб-сервисы"
   - **Redirect URI**:
     - `https://app.gory-staff.ru/oauth/yandex/callback`
     - `http://localhost:4000/oauth/yandex/callback` (для разработки)
     - `urn:ietf:wg:oauth:2.0:oob` (для мобильного)

### Шаг 2: Настроить права доступа

Выберите необходимые права:
- ✅ **Доступ к логину, имени и фамилии, полу** (login:info)
- ✅ **Доступ к аватару пользователя** (login:avatar)
- ✅ **Доступ к адресу электронной почты** (login:email)
- ⚠️ **Доступ к номеру телефона** (login:phone) - опционально

### Шаг 3: Получить ключи

После создания приложения вы получите:
- **Client ID** (ID приложения)
- **Client Secret** (Пароль приложения)

### Шаг 4: Добавить в .env

```bash
YANDEX_CLIENT_ID=ваш_client_id
YANDEX_CLIENT_SECRET=ваш_client_secret
```

---

## 📋 Настройка ВКонтакте OAuth

### Шаг 1: Создать приложение

1. Перейдите на https://vk.com/apps?act=manage
2. Нажмите "Создать приложение"
3. Заполните форму:
   - **Название**: Горы
   - **Платформа**: Standalone-приложение
   - **Категория**: Еда и рестораны

### Шаг 2: Настроить приложение

1. Перейдите в **Настройки**
2. Заполните:
   - **Адрес сайта**: `https://app.gory-staff.ru`
   - **Базовый домен**: `app.gory-staff.ru`
   - **Доверенный redirect URI**:
     - `https://app.gory-staff.ru/oauth/vk/callback`
     - `http://localhost:4000/oauth/vk/callback`
     - `https://oauth.vk.com/blank.html` (для мобильного)

### Шаг 3: Получить ключи

В разделе **Настройки** найдите:
- **ID приложения** (Client ID)
- **Защищённый ключ** (Client Secret)

### Шаг 4: Добавить в .env

```bash
VK_CLIENT_ID=ваш_app_id
VK_CLIENT_SECRET=ваш_secure_key
```

---

## 🔧 API Endpoints

### Для веб-версии

#### Получить URL авторизации

```http
GET /oauth/yandex/url?referral_code=ABC123
GET /oauth/vk/url?referral_code=ABC123
```

**Ответ:**
```json
{
  "url": "https://oauth.yandex.ru/authorize?...",
  "state": "random_state_string"
}
```

#### Callback (автоматический)

```http
GET /oauth/yandex/callback?code=xxx&state=yyy
GET /oauth/vk/callback?code=xxx&state=yyy
```

Возвращает HTML с автозакрытием окна и передачей данных через `postMessage`.

---

### Для мобильного приложения

#### Яндекс

```http
POST /oauth/mobile/yandex
Content-Type: application/json

{
  "code": "authorization_code",
  "referral_code": "ABC123",
  "device_id": "device_uuid",
  "platform": "android",
  "app_version": "1.0.0"
}
```

#### ВКонтакте

```http
POST /oauth/mobile/vk
Content-Type: application/json

{
  "code": "authorization_code",
  "referral_code": "ABC123",
  "device_id": "device_uuid",
  "platform": "android",
  "app_version": "1.0.0"
}
```

**Ответ (оба):**
```json
{
  "token": "guest_jwt_token",
  "guest": {
    "id": "uuid",
    "name": "Иван Иванов",
    "phone": "+79001234567",
    "oauth_provider": "yandex",
    "oauth_avatar_url": "https://...",
    "bonus_balance": 300,
    ...
  },
  ...
}
```

---

## 🔄 Логика работы

### Новый пользователь

1. Пользователь нажимает "Войти через Яндекс/ВК"
2. Открывается OAuth окно провайдера
3. Пользователь разрешает доступ
4. Сервер получает данные пользователя
5. **Создается новый аккаунт гостя**:
   - Имя из OAuth
   - Аватар из OAuth
   - Email из OAuth (если есть)
   - Телефон из OAuth (если есть) или генерируется
   - Начисляется **300 бонусов** за регистрацию
   - Если есть реферальный код - начисляются бонусы

### Существующий пользователь

#### Сценарий 1: Вход по OAuth ID
- Пользователь уже входил через этот OAuth
- Находим по `yandex_id` или `vk_id`
- Обновляем аватар и email
- Выдаем токен

#### Сценарий 2: Привязка по email
- Пользователь регистрировался по телефону
- Но email совпадает с OAuth
- Привязываем OAuth ID к существующему аккаунту
- Выдаем токен

#### Сценарий 3: Привязка по телефону
- Пользователь регистрировался по телефону
- Телефон совпадает с OAuth
- Привязываем OAuth ID к существующему аккаунту
- Выдаем токен

---

## 🗄️ Структура БД

### Новые поля в `guest_users`

```sql
yandex_id TEXT              -- ID в Яндекс
vk_id TEXT                  -- ID ВКонтакте
oauth_provider TEXT         -- 'yandex' или 'vk'
oauth_email TEXT            -- Email из OAuth
oauth_avatar_url TEXT       -- URL аватара из OAuth
```

### Новая таблица `guest_oauth_tokens`

```sql
CREATE TABLE guest_oauth_tokens (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

*(Пока не используется, для будущих интеграций)*

---

## 📱 Интеграция в мобильное приложение

### ✅ Реализовано в Expo React Native

Мобильное приложение полностью поддерживает OAuth вход через Яндекс и ВКонтакте.

#### Компоненты

1. **`OAuthButtons.tsx`** - UI компонент с кнопками входа
2. **`guestOAuthLogin()`** в `api.ts` - функция для OAuth авторизации
3. **`GuestAuthModal`** - модальное окно с интегрированными OAuth кнопками

#### Как это работает

```typescript
// 1. Пользователь нажимает кнопку "Войти через Яндекс/ВК"
// 2. Открывается браузер с OAuth страницей провайдера
const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

// 3. После авторизации получаем code
const code = new URL(result.url).searchParams.get('code');

// 4. Обмениваем code на сессию через наш API
const session = await guestOAuthLogin(apiUrl, provider, code, referralCode);

// 5. Сохраняем сессию и обновляем UI
setGuestSession(session);
setGuestProfile(session.profile);
```

#### Использование

OAuth кнопки автоматически появляются в модальном окне входа/регистрации:

```typescript
<OAuthButtons
  apiUrl={getFixedApiUrl()}
  referralCode={form.referralCode}
  onSuccess={(session) => {
    // Сессия сохранена автоматически
    setGuestSession(session);
    setGuestProfile(session.profile);
  }}
  onError={(error) => setMessage(error)}
/>
```

#### Особенности мобильной версии

- **Redirect URI**: `urn:ietf:wg:oauth:2.0:oob` (Яндекс) и `https://oauth.vk.com/blank.html` (ВК)
- **WebBrowser**: Использует `expo-web-browser` для безопасного OAuth flow
- **Автосохранение**: Сессия автоматически сохраняется в AsyncStorage
- **Реферальные коды**: Поддерживаются при OAuth регистрации
- **Offline режим**: Работает с кешированием как обычный вход

---

### Пример кода (для справки)

#### React Native (Expo) - Полная реализация

```typescript
import * as WebBrowser from 'expo-web-browser';
import { guestOAuthLogin } from '../data/api';

WebBrowser.maybeCompleteAuthSession();

const loginWithYandex = async () => {
  try {
    // 1. Получаем URL авторизации
    const response = await fetch(`${API_URL}/oauth/yandex/url?referral_code=ABC123`);
    const { url } = await response.json();

    // 2. Открываем браузер
    const result = await WebBrowser.openAuthSessionAsync(
      url,
      `${API_URL}/oauth/yandex/callback`
    );

    if (result.type === 'success' && result.url) {
      // 3. Парсим code
      const code = new URL(result.url).searchParams.get('code');

      if (!code) {
        throw new Error('Не получен код авторизации');
      }

      // 4. Обмениваем на сессию (автоматически сохраняется)
      const session = await guestOAuthLogin(API_URL, 'yandex', code, 'ABC123');

      // 5. Обновляем UI
      console.log('Вход выполнен:', session.profile.guest.name);
    }
  } catch (error) {
    console.error('OAuth error:', error);
  }
};

// ВКонтакте - аналогично, заменить 'yandex' на 'vk'
```

---

## 🧪 Тестирование

### Локальная разработка

1. Добавьте в `.env`:
```bash
YANDEX_CLIENT_ID=test_id
YANDEX_CLIENT_SECRET=test_secret
VK_CLIENT_ID=test_id
VK_CLIENT_SECRET=test_secret
```

2. Используйте `http://localhost:4000` как redirect URI

3. Тестовые аккаунты:
   - Яндекс: создайте тестовый аккаунт на yandex.ru
   - ВК: используйте свой аккаунт

### Проверка endpoints

```bash
# Получить URL
curl http://localhost:4000/oauth/yandex/url

# Проверить callback (после авторизации)
# Откройте URL в браузере и посмотрите результат
```

---

## ⚠️ Важные замечания

### Безопасность

1. **State parameter** - защита от CSRF атак
   - Генерируется случайно для каждого запроса
   - Проверяется в callback
   - Хранится временно (10 минут)

2. **Client Secret** - никогда не передавайте на клиент
   - Храните только на сервере
   - Не коммитьте в Git
   - Используйте переменные окружения

3. **HTTPS обязателен** в production
   - OAuth провайдеры требуют HTTPS
   - Используйте `https://app.gory-staff.ru`

### Телефоны

- Если OAuth не предоставляет телефон, генерируется случайный
- Формат: `+7900XXXXXXX`
- Гость может обновить телефон в профиле

### Реферальные коды

- Передаются через query параметр `referral_code`
- Работают при первой регистрации
- Начисляются бонусы рефереру и приглашенному

---

## 🐛 Troubleshooting

### "OAuth ошибка: invalid_client"

**Проблема:** Неверный Client ID или Secret

**Решение:**
1. Проверьте `.env` файл
2. Убедитесь что ключи скопированы правильно
3. Перезапустите сервер

### "Redirect URI mismatch"

**Проблема:** Redirect URI не совпадает с настройками приложения

**Решение:**
1. Проверьте настройки приложения в Яндекс/ВК
2. Добавьте все нужные URI
3. Убедитесь что используете правильный домен

### "State не найден"

**Проблема:** State истек или был использован

**Решение:**
1. Попробуйте снова
2. Проверьте что не прошло >10 минут
3. В production используйте Redis вместо Map

### Пользователь не создается

**Проблема:** Ошибка при создании гостя

**Решение:**
1. Проверьте логи сервера
2. Убедитесь что схема OAuth применена
3. Проверьте что есть все необходимые поля

---

## 📚 Дополнительные ресурсы

- [Яндекс OAuth документация](https://yandex.ru/dev/id/doc/ru/)
- [ВКонтакте OAuth документация](https://dev.vk.com/ru/api/access-token/authcode-flow-user)
- [OAuth 2.0 спецификация](https://oauth.net/2/)

---

## 🔄 Миграция существующих пользователей

Существующие гости могут привязать OAuth:

1. Войти по телефону
2. Войти через OAuth с тем же email/телефоном
3. Аккаунты автоматически объединятся

Или в будущем добавить в профиль:
- "Привязать Яндекс"
- "Привязать ВКонтакте"

---

**Дата:** 2026-05-30
**Версия:** 1.0
