# Настройка импорта Instagram/VK

Этот импорт нужен для вкладки `Новости` в гостевом режиме. Внутренние посты SMM работают без внешних ключей. Instagram/VK начнут подтягиваться только после настройки токенов на сервере.

## Что сейчас импортирует код

- Instagram: отмеченные публикации через Graph API endpoint `/{instagram-business-account-id}/tags`.
- VK: публичные записи через `newsfeed.search` по строке `VK_SEARCH_QUERY`.
- Импорт запускается вручную из раздела `SMM` или POST-запросом на `/social/import/run`.
- Если ключей нет, endpoint возвращает `status: "disabled"` и список недостающих переменных.

## Переменные окружения

Добавить в серверный `.env`:

```env
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
VK_ACCESS_TOKEN=
VK_GROUP_ID=
VK_SEARCH_QUERY=
```

После изменения `.env` сервер надо перезапустить.

## Instagram

1. Нужен профессиональный Instagram аккаунт: Business или Creator.
2. Нужен Meta Developer app с доступом к Instagram Graph API.
3. Аккаунт Instagram должен быть доступен токену, которым сервер будет читать отмеченные публикации.
4. Получить `INSTAGRAM_BUSINESS_ACCOUNT_ID`.
   Рабочий способ через Graph API Explorer:
   ```text
   GET /me/accounts?fields=name,instagram_business_account{id,username}
   ```
   В ответе взять `instagram_business_account.id`.
5. Получить долгоживущий access token для server-side работы и положить его в `INSTAGRAM_ACCESS_TOKEN`.
6. Проверить импорт:
   ```powershell
   $token = "<staff-manager-jwt>"
   Invoke-RestMethod `
     -Uri "http://127.0.0.1:4000/social/import/run" `
     -Method Post `
     -Headers @{ Authorization = "Bearer $token" } `
     -ContentType "application/json" `
     -Body '{"sources":["instagram"]}'
   ```

Важно: текущий код забирает именно публикации, где ресторан отмечен как аккаунт. Просто текстовое упоминание без отметки может не попасть в этот endpoint.

## VK

1. Нужен VK access token, которому разрешен вызов VK API.
2. В `VK_SEARCH_QUERY` указать строку поиска, по которой надо искать упоминания ресторана.
   Примеры:
   ```env
   VK_SEARCH_QUERY="Горы Иваново"
   VK_SEARCH_QUERY="ресторан Горы"
   VK_SEARCH_QUERY="@your_vk_group_domain"
   ```
3. `VK_GROUP_ID` можно заполнить для явной привязки настройки, но текущий импорт ищет по строке. Главная переменная для качества поиска - `VK_SEARCH_QUERY`.
4. Проверить импорт:
   ```powershell
   $token = "<staff-manager-jwt>"
   Invoke-RestMethod `
     -Uri "http://127.0.0.1:4000/social/import/run" `
     -Method Post `
     -Headers @{ Authorization = "Bearer $token" } `
     -ContentType "application/json" `
     -Body '{"sources":["vk"]}'
   ```

## Проверка результата

После успешного импорта:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4000/guest/news"
```

В ответе должны появиться элементы в `items`. В приложении они отображаются во вкладке `Новости`.

## Если не работает

- `disabled`: не заполнены переменные окружения.
- `failed Instagram API 4xx/5xx`: токен не имеет доступа к Instagram аккаунту, истек или приложение Meta не прошло нужные разрешения.
- `failed VK API`: неверный токен, нет доступа к методу или ошибка в поисковом запросе.
- `items` пустой: API работает, но по текущей отметке/строке поиска нет публикаций.

## Официальные страницы

- Meta Instagram Platform / Graph API: https://developers.facebook.com/docs/instagram-platform/
- Instagram Graph API reference: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/
- VK API methods: https://dev.vk.com/ru/method
- VK `newsfeed.search`: https://dev.vk.com/ru/method/newsfeed.search
- VK access token: https://dev.vk.com/ru/api/access-token/getting-started
