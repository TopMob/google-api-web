# google-api-web

Локальный веб-интерфейс и API-шлюз с OpenAI-совместимым API для экспериментов с Gemini Web.

> Проект предназначен для локального использования и экспериментов. Он может зависеть от текущего поведения стороннего веб-интерфейса Gemini и перестать работать после его изменений.

## Архитектура

- `apps/web` — локальная панель управления;
- `apps/gateway` — Fastify-шлюз;
- `packages/shared` — общие типы и контракты.

По умолчанию используются:

- панель: `http://localhost:3000`;
- API: `http://localhost:8081`;
- OpenAI-compatible API: `http://localhost:8081/v1`.

## Запуск

```bash
git clone https://github.com/TopMob/google-api-web.git
cd google-api-web
npm install
npm run dev
```

Проверка шлюза:

```bash
curl http://localhost:8081/health
```

## API

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /health`

Пример с OpenAI SDK:

```ts
const client = new OpenAI({
  apiKey: process.env.GATEWAY_API_KEY,
  baseURL: "http://localhost:8081/v1",
});
```

## Безопасность

Не публикуйте cookies, токены Google, ключи шлюза и содержимое `config.json`. Не запускайте шлюз с доступом из интернета без отдельной аутентификации и сетевого ограничения.

## Статус

Экспериментальный локальный проект. Поддерживаемые модели и способы авторизации могут меняться.
