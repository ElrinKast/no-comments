# Kolink

Аналог Discord в разработке: открытая регистрация, вход, серверы, каналы, чат, профили, звонки и демонстрация экрана.

## Запуск

```bash
pnpm install
pnpm start
```

Откройте `http://localhost:3000`.

## Desktop-приложение

Запуск в режиме приложения:

```bash
pnpm desktop
```

Сборка установщика и portable-версии для Windows:

```bash
pnpm dist:win
```

Готовые файлы появятся в папке `release`.

Если сервер уже размещен отдельно, desktop-клиент можно направить на него:

```bash
$env:SERVER_URL="https://your-domain.example"; pnpm desktop
```

В собранном приложении без `SERVER_URL` откроется экран подключения. Друзья смогут вставить адрес вашего домашнего сервера один раз, приложение запомнит его.

## Домашний сервер

Для друзей из интернета поднимите сервер на домашней машине или мини-ПК:

```bash
docker compose up -d
```

Минимально нужно открыть наружу порт `3000` или поставить reverse proxy с HTTPS. Для камеры, микрофона и демонстрации экрана лучше использовать HTTPS-домен.

Для более стабильных звонков через NAT добавлен сервис `turn` на coturn. Задайте `TURN_USER`, `TURN_PASSWORD` и `TURN_REALM` в окружении сервера, затем добавьте TURN-адрес в WebRTC-конфиг клиента.

Пример переменных для TURN:

```bash
TURN_URL=turn:your-domain.example:3478
TURN_USER=kolink
TURN_PASSWORD=strong-password
TURN_REALM=your-domain.example
```

## Email-коды

Сейчас подтверждение почты отключено. Чтобы снова включить регистрацию через код, настройте SMTP в `.env` и поставьте `EMAIL_VERIFICATION_ENABLED=true`:

```bash
EMAIL_VERIFICATION_ENABLED=true
EMAIL_CODE_SECRET=random-secret
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@example.com
SMTP_PASSWORD=app-password
SMTP_FROM=Kolink <noreply@example.com>
```

## Что уже есть

- открытая регистрация и вход по email/паролю;
- сессии через токены;
- JSON-хранилище в `data/db.json`;
- базовая модель серверов и каналов;
- чат с постоянной историей сообщений;
- список участников онлайн;
- профиль: отображаемое имя, статус, цвет, аватар;
- звонок через WebRTC;
- демонстрация экрана;
- desktop-клиент на Electron с экраном подключения к серверу.

## Следующие крупные шаги

- создание серверов и каналов из интерфейса;
- роли и права доступа;
- личные сообщения;
- вложения и изображения;
- полноценная база данных PostgreSQL вместо JSON-файла;
- админ-панель и модерация.

## Важно для доступа друзьям

Камера, микрофон и демонстрация экрана нормально работают на `localhost` или через HTTPS. Для друзей из интернета лучше запускать за HTTPS-доменом или туннелем вроде Cloudflare Tunnel.
