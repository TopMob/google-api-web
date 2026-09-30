# Gemini Web2API Gateway & Control Panel (Local)

Персональный OpenAI-compatible AI Gateway на базе Gemini Web для локального использования.

---

## Архитектура и сервисы

Проект работает полностью локально на вашем компьютере:

1. **Панель управления (`apps/web`):** [http://localhost:3000](http://localhost:3000) (Next.js)
2. **API-шлюз (`apps/gateway`):** [http://localhost:8081](http://localhost:8081) / [http://localhost:8081/v1](http://localhost:8081/v1) (Fastify)
3. **Общие пакеты (`packages/shared`):** Контракты, типы и список поддерживаемых моделей.

---

## Запуск проекта

Для одновременного запуска шлюза и панели управления достаточно одной команды:

```bash
# 1. Установка зависимостей (при первом запуске)
npm install

# 2. Запуск локального dev-сервера
npm run dev
```

После этого откройте в браузере:
- Панель управления: **http://localhost:3000**
- Healthcheck шлюза: **http://localhost:8081/health**

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

Все запросы направляются к локальному шлюзу: `http://localhost:8081/v1`

### 1. `GET /v1/models`
Получение списка всех доступных моделей.

### 2. `POST /v1/chat/completions`
OpenAI-compatible эндпоинт генерации текста. Поддерживает стандартные параметры (`stream`, `messages`, `tools`).

### 3. `POST /v1/responses`
OpenAI-compatible Responses API.

### 4. `GET /health`
Служебный эндпоинт для проверки статуса работы шлюза.

---

## Использование API

### Пример подключения (Node.js / OpenAI SDK)

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "sk-personal-gw", // Ваш API-ключ из панели управления
  baseURL: "http://localhost:8081/v1"
});

const response = await openai.chat.completions.create({
  model: "gemini-3.5-flash",
  messages: [{ role: "user", content: "Привет!" }]
});
console.log(response.choices[0].message.content);
```

### Пример через cURL

```bash
curl -X POST "http://localhost:8081/v1/chat/completions" \
  -H "Authorization: Bearer sk-personal-gw" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Привет!"}],
    "stream": false
  }'
```

---

## Выбор Google-аккаунта (`AUTH_USER`)

Если в браузере выполнен вход в несколько аккаунтов Google, вы можете выбрать, какой аккаунт использовать:
- В файле `config.json` укажите индекс аккаунта:
  ```json
  {
    "auth_user": "1"
  }
  ```
  (`"0"` или `""` — основной аккаунт, `"1"` — второй, `"2"` — третий).

---

## TODO

- [ ] Доделать подключение провайдеров (VS Code, Codex, Codex CLI, OpenClaw, Cursor, JetBrains, Zed)
