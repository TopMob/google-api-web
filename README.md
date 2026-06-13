# Gemini Web2API Gateway & Control Panel

Репозиторий персонального OpenAI-compatible AI Gateway на базе Gemini Web.

## Ссылки проекта

- **GitHub:** [TopMob/google-api-web](https://github.com/TopMob/google-api-web)
- **Панель управления (Vercel):** [google-api-web.vercel.app](https://google-api-web.vercel.app/)
- **Проект на Vercel:** [topmobs-projects/google-api-web](https://vercel.com/topmobs-projects/google-api-web)
- **API Gateway (Railway):** [gatewayapi-production-22ba.up.railway.app](https://gatewayapi-production-22ba.up.railway.app)

---

## Архитектура

Проект представляет собой монорепозиторий:

1. `apps/web` — Панель управления на Next.js (деплой на **Vercel**).
2. `apps/gateway` — Высокопроизводительный OpenAI-compatible API-шлюз на Fastify (деплой на **Railway**).
3. `packages/shared` — Общие контракты, типы и конфигурации моделей.

---

## Доступные модели

При вызове API вы можете использовать следующие идентификаторы моделей:

| Модель (ID)                      | Описание                                                                        |
| :------------------------------- | :------------------------------------------------------------------------------ |
| `gemini-3.5-flash`               | Быстрая модель общего назначения.                                               |
| `gemini-3.5-flash-thinking`      | Режим глубоких размышлений (Deep Thinking), сверхдлинный вывод (~20k символов). |
| `gemini-3.1-pro`                 | Pro-модель повышенной сложности (требуется кука с расширенным доступом).        |
| `gemini-3.5-flash-thinking-lite` | Динамические размышления с адаптивной глубиной.                                 |
| `gemini-flash-lite`              | Облегченная быстрая модель.                                                     |
| `gemini-auto`                    | Автоматический выбор наиболее подходящей модели.                                |

---

## API Endpoints

Все запросы должны направляться к шлюзу на Railway: `https://gatewayapi-production-22ba.up.railway.app/v1`

### 1. `GET /v1/models`

Получение списка всех доступных моделей.

### 2. `POST /v1/chat/completions`

OpenAI-compatible эндпоинт генерации текста. Поддерживает стандартные параметры (`stream`, `messages`, `tools`).

### 3. `POST /v1/responses`

OpenAI-compatible Responses API (упрощенный оберточный эндпоинт).

### 4. `GET /health`

Служебный эндпоинт для проверки статуса работы шлюза.

---

## Использование API

### Пример подключения (Node.js / OpenAI SDK)

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "sk-personal-gw", // Ваш API-ключ из панели управления
  baseURL: "https://gatewayapi-production-22ba.up.railway.app/v1"
});

const response = await openai.chat.completions.create({
  model: "gemini-3.5-flash",
  messages: [{ role: "user", content: "Привет!" }]
});
console.log(response.choices[0].message.content);
```

### Пример через cURL

```bash
curl -X POST "https://gatewayapi-production-22ba.up.railway.app/v1/chat/completions" \
  -H "Authorization: Bearer sk-personal-gw" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Привет!"}],
    "stream": false
  }'
```

---

## Локальная разработка

1. Установите dependencies в корне:

```bash
npm install
```

2. Запуск локального dev-сервера (Next.js на :3000 + Fastify на :8081):

```bash
npm run dev
```

## TODO

- [ ] Доделать подключение провайдеров (VS Code, Codex, Codex CLI, OpenClaw, Cursor, JetBrains, Zed)
