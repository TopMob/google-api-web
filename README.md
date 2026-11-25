# Gemini Web2API Gateway & Control Panel (Local)

Персональный OpenAI-compatible и Google Native AI Gateway на базе Gemini Web для локального использования.

---

## Архитектура и сервисы

Проект работает полностью локально на вашем компьютере:

1. **Панель управления (`apps/web`):** [http://localhost:3000](http://localhost:3000) (Next.js 16 + React 19 + Tailwind CSS v4)
   - **Чат:** диалог со стримингом, рендерингом Markdown и блоков `<think>`, прикреплением и вставкой изображений (`Ctrl+V`).
   - **Подключение:** единые эндпоинты, пресеты клиентов (Cursor, OpenCode, VS Code, Gemini CLI, Zed, JetBrains, OpenClaw, cURL, Python, `.env`), управление проектами и API-ключами (RPM и дневные лимиты), проверка и сохранение cookies.
   - **Логи:** метрики токенов (prompt/completion), успешность, средняя задержка и история запросов с фильтрацией.
2. **API-шлюз (`apps/gateway`):** [http://localhost:8081](http://localhost:8081) / [http://localhost:8081/v1](http://localhost:8081/v1) (Fastify + TypeScript)
3. **Общие контракты (`packages/shared`):** общие TypeScript-типы и конфигурация моделей.

---

## Запуск проекта

```bash
# 1. Установка зависимостей (при первом запуске)
npm install

# 2. Запуск локального dev-сервера (шлюз + веб-панель)
npm run dev
```

После запуска откройте в браузере:

- Панель управления: **http://localhost:3000**
- Healthcheck шлюза: **http://localhost:8081/health**

---

## Доступные модели

| Модель (ID)                 | Описание                                                                 |
| :-------------------------- | :----------------------------------------------------------------------- |
| `gemini-3.8-flash`          | Быстрая модель общего назначения (по умолчанию).                         |
| `gemini-3.8-flash-thinking` | Режим глубоких размышлений (Extended Thinking).                          |
| `gemini-3.1-pro`            | Pro-модель повышенной сложности (требуется кука с расширенным доступом). |
| `gemini-3.5-flash-lite`     | Облегченная быстрая модель.                                              |
| `gemini-auto`               | Автоматический выбор модели.                                             |

К любому идентификатору модели можно добавить суффикс `@think=N` (`0` — максимальная глубина, `4` — быстрый ответ).

---

## API Endpoints

### OpenAI-compatible (`/v1`)

- `GET /v1/models` — список доступных моделей.
- `POST /v1/chat/completions` — генерация текста и изображений (`stream`, `stream_options.include_usage`, `messages` с `image_url`, `tools`, `response_format`).
- `POST /v1/responses` — OpenAI Responses API (`input`, `input_image`, `tools`).

### Google Native (`/v1beta`) для Gemini CLI

- `GET /v1beta/models` и `GET /v1beta/models/:model`
- `POST /v1beta/models/{model}:generateContent`
- `POST /v1beta/models/{model}:streamGenerateContent`

### Служебные

- `GET /health` — статус шлюза, состояние cookie и Circuit Breaker.

---

## Использование API

### Пример подключения (Node.js / OpenAI SDK)

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "sk-personal-gw",
  baseURL: "http://localhost:8081/v1"
});

const response = await openai.chat.completions.create({
  model: "gemini-3.8-flash",
  messages: [{ role: "user", content: "Привет!" }]
});
console.log(response.choices[0].message.content);
```

### Пример для Gemini CLI

```bash
export GEMINI_API_KEY="sk-personal-gw"
export GOOGLE_GEMINI_BASE_URL="http://localhost:8081"
gemini
```

---

## Выбор Google-аккаунта (`AUTH_USER`)

Если в браузере выполнен вход в несколько аккаунтов Google, укажите индекс аккаунта в `config.json` (или переменной `AUTH_USER`):

```json
{
  "auth_user": "1"
}
```

(`"0"` или `""` — основной аккаунт, `"1"` — второй, `"2"` — третий).
