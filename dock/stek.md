# Технологический стек и спецификация API для персонального AI Gateway на базе Gemini Web

Персональный AI Gateway — это не просто сайт с чатом, а единый OpenAI-compatible шлюз для собственных AI-проектов: заметок, чатов, сортировщиков, агентов и внутренних инструментов. Он скрывает сложность Gemini Web-интеграции, дает единый endpoint, API-ключи, лимиты, логи и статистику, а снаружи выглядит как обычный OpenAI-compatible API. [developers.openai](https://developers.openai.com/api/docs/guides/migrate-to-responses)

---

## 1. Назначение продукта

Продукт представляет собой персональный OpenAI-compatible AI gateway-агрегатор для собственных приложений. Его задача — превратить нестабильный и неофициальный доступ к Gemini Web в управляемый, безопасный и предсказуемый сервис с единым контрактом интеграции. [docs.railway](https://docs.railway.com/services)

Ключевая идея продукта — не “чатик поверх Gemini”, а личный слой AI-инфраструктуры с веб-панелью управления. Все внешние проекты подключаются не напрямую к конкретному провайдеру, а к единому API-слою через base URL, API key и имя модели. [developers.openai](https://developers.openai.com/api/docs/guides/migrate-to-responses)

---

## 2. Итоговый стек

### Web layer

- Next.js 16 App Router. Next.js 16 является актуальной Active LTS-веткой, а Next.js 15 находится в Maintenance LTS, поэтому для нового проекта стартовать нужно с 16-й версии. [nextjs](https://nextjs.org/support-policy)
- React 19.
- TypeScript strict.
- Tailwind CSS v4.
- shadcn/ui поверх Radix UI.
- Vercel AI SDK для test chat, внутренней консоли и UI для стриминга.
- Lucide React для иконок.
- React Hook Form + Zod для форм и валидации.
- Zustand для локального UI-state.

### Gateway layer

- Node.js + TypeScript.
- Fastify как основной API runtime для OpenAI-compatible gateway.
- SSE streaming.
- Retry/backoff.
- Circuit breaker и upstream error normalization.
- Railway как persistent service, потому что Railway поддерживает always-running persistent services для backend API и web apps. [docs.railway](https://docs.railway.com/services)

### Data layer

- Supabase Postgres для проектов, API keys, usage logs, статистики и лимитов.
- `@supabase/ssr` для серверной интеграции с Next.js. [supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client)

### Infra layer

- Redis / Upstash Redis для rate limiting и быстрых счетчиков.
- Vercel env для web-приложения.
- Railway env/secrets для gateway.
- Structured logging через Pino.

---

## 3. Архитектура проекта

Рекомендуемая структура — monorepo:

```text
apps/
  web/         # Next.js сайт, админка, test chat, документация
  gateway/     # Node.js API gateway на Railway
packages/
  shared/      # общие типы, схемы, model aliases, ошибки, utils
```

### `apps/web`

Назначение:

- Личный кабинет.
- Генерация и отзыв API keys.
- Управление проектами.
- Статистика и usage logs.
- Test chat.
- Документация по API.
- Просмотр доступных моделей.

### `apps/gateway`

Назначение:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /health`
- Нормализация запросов под Gemini Web.
- SSE streaming.
- API key auth.
- Rate limiting.
- Usage logging.
- Retry/backoff.

### `packages/shared`

Назначение:

- Общие TypeScript types.
- Zod-схемы запросов и ответов.
- Model aliases.
- Формат ошибок.
- Утилиты для нормализации payloads.

---

## 4. Основной API v1

Для первого релиза в API входят только базовые endpoint’ы, достаточные для реального использования в собственных проектах.

### `GET /v1/models`

Возвращает список доступных моделей для использования клиентами. Этот endpoint нужен для совместимости с OpenAI-compatible клиентами и для UI-выбора модели. [platform.openai](https://platform.openai.com/docs/api-reference/chat)

Пример ответа:

```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-flash",
      "object": "model",
      "owned_by": "personal-gateway"
    },
    {
      "id": "gemini-pro",
      "object": "model",
      "owned_by": "personal-gateway"
    }
  ]
}
```

### `POST /v1/chat/completions`

Основной рабочий endpoint для большинства интеграций. Используется для chat-style запросов в формате OpenAI Chat Completions. [platform.openai](https://platform.openai.com/docs/api-reference/chat)

Пример запроса:

```json
{
  "model": "gemini-flash",
  "messages": [{ "role": "user", "content": "Отсортируй мои заметки по темам" }],
  "stream": false
}
```

### `POST /v1/responses`

Дополнительный endpoint для совместимости с направлением развития OpenAI API, где Responses API рассматривается как приоритетный слой для новых интеграций. [developers.openai](https://developers.openai.com/api/docs/assistants/migration)

На v1 допускается реализовать `responses` как совместимый слой поверх `chat/completions`, если полная нативная реализация не нужна на старте. [developers.openai](https://developers.openai.com/api/docs/guides/migrate-to-responses)

### `GET /health`

Служебный endpoint для проверки доступности gateway и диагностики инфраструктуры. Railway и другие production deployment-практики обычно используют health-check endpoint для мониторинга и валидации сервиса. [docs.phase](https://docs.phase.dev/self-hosting/railway)

Пример ответа:

```json
{
  "status": "ok"
}
```

---

## 5. Что входит в MVP кроме endpoint’ов

Первый релиз должен включать не только API, но и минимальный control plane.

### Обязательные функции MVP

- Создание проекта.
- Генерация API key.
- Отзыв или деактивация API key.
- Привязка ключа к проекту.
- Ограничение списка разрешенных моделей для ключа.
- Учет каждого запроса.
- Просмотр статистики по запросам и моделям.
- Дневные лимиты.
- Test chat для ручной проверки моделей и ключей.

### Что не входит в MVP

- Публичная регистрация.
- Мультипользовательская SaaS-модель.
- Баланс и платежи.
- Команды и роли.
- Публичный marketplace моделей.
- Embeddings, images, audio и прочие дополнительные endpoint’ы.

---

## 6. Сущности системы

Минимальный набор сущностей:

- **User** — администратор системы.
- **Project** — отдельный проект или приложение, использующее gateway.
- **ApiKey** — ключ доступа, связанный с проектом.
- **ModelAlias** — публичное имя модели, доступное через `/v1/models`.
- **RequestLog** — лог конкретного запроса.
- **UsageCounter** — агрегированные счетчики по дню, проекту, ключу, модели.
- **LimitPolicy** — правила лимитов и квот.

---

## 7. Политики v1

Для первого релиза нужны только базовые политики, без избыточной enterprise-сложности.

### Обязательные политики

- Лимит запросов в день на API key.
- Лимит токенов в день на API key или проект.
- Список разрешенных моделей на API key.
- Возможность быстро деактивировать ключ.
- Возврат `429` при превышении лимита.
- Отдельное логирование upstream ошибок.
- Хранение истории использования по ключам и моделям.

Это соответствует практикам современных AI gateway-решений, где бюджеты, rate limits и usage controls считаются базовым уровнем управления. [agentgateway](https://agentgateway.dev/docs/kubernetes/main/llm/budget-limits/)

---

## 8. Как подключать API к своим проектам

Подключение должно быть максимально простым и таким же, как у любого OpenAI-compatible сервиса: нужно только подставить свой `baseURL`, свой `apiKey` и имя модели. [developers.openai](https://developers.openai.com/api/docs/guides/migrate-to-responses)

### Общая схема

1. Создать проект в панели управления.
2. Сгенерировать API key.
3. Получить base URL gateway, например:
   `https://api.yourdomain.com/v1`
4. Выбрать модель из `/v1/models`.
5. Подставить `baseURL`, `apiKey` и `model` в проект.

### Пример на JavaScript

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.MY_GATEWAY_API_KEY,
  baseURL: "https://api.yourdomain.com/v1"
});

const res = await client.chat.completions.create({
  model: "gemini-flash",
  messages: [
    {
      role: "user",
      content: "Привет, помоги отсортировать заметки по темам"
    }
  ]
});
```

Смысл OpenAI-compatible подхода в том, что интеграция внешнего проекта не требует знания о внутреннем устройстве gateway или о том, что внутри используется Gemini Web. Клиентский код меняет только `baseURL`, `apiKey` и имя модели. [developers.openai](https://developers.openai.com/api/docs/guides/migrate-to-responses)

---

## 9. Логика использования API key

API key предназначен для подключения внешнего проекта к gateway. Ключ не вставляется “в Gemini”, а вставляется в OpenAI-compatible клиент или в HTTP-запрос к своему gateway.

### Что требуется внешнему проекту

- `baseURL` — адрес шлюза.
- `apiKey` — ключ, выданный в панели.
- `model` — имя модели из `/v1/models`.

### Что происходит дальше

- Внешний проект отправляет запрос в gateway.
- Gateway аутентифицирует API key.
- Gateway проверяет лимиты и разрешенные модели.
- Gateway логирует запрос.
- Gateway маршрутизирует его во внутренний Gemini Web adapter.
- Gateway нормализует ответ в OpenAI-compatible формат.
- Внешний проект получает стандартный ответ и работает как с обычным AI API.

---

## 10. Статистика и учет

Статистика обязательна уже в первом релизе, потому что без нее невозможно контролировать нагрузку, лимиты и качество работы.

### Что фиксируется по каждому запросу

- Время запроса.
- Проект.
- API key.
- Модель.
- Endpoint.
- Длительность.
- Статус.
- Ошибка, если была.
- Usage metadata, если доступна.

### Что выводится в панели

- Запросы за сегодня.
- Запросы за вчера.
- Запросы за 7 дней.
- Разбивка по моделям.
- Разбивка по ключам.
- Успешные и неуспешные запросы.
- Близость к дневным лимитам.

---

## 11. Деплой

### Web

- Деплой на Vercel.
- Хостит сайт, админку, test chat и документацию.

### Gateway

- Деплой на Railway как persistent service. Railway описывает persistent services как always-running сервисы для web apps, backend APIs, очередей и других долгоживущих сервисов. [docs.railway](https://docs.railway.com/services)

### Data

- Supabase Postgres отдельно.
- Redis / Upstash Redis отдельно.

---

## 12. Базовый список пакетов

### `apps/web`

```bash
npm install next react react-dom typescript
npm install tailwindcss @tailwindcss/postcss
npm install ai zod react-hook-form @hookform/resolvers
npm install @supabase/supabase-js @supabase/ssr
npm install lucide-react zustand clsx tailwind-merge next-themes
```

### `apps/gateway`

```bash
npm install fastify zod pino dotenv ioredis eventsource-parser
```

При использовании Node.js 20+ можно опираться на встроенный `fetch`, а Next.js 16 требует минимум Node.js 20.9.0 и TypeScript 5.1.0+. [nextjs](https://nextjs.org/blog/next-16)

---

## 13. Итоговая формулировка проекта

Персональный AI Gateway — это OpenAI-compatible API-слой для собственных приложений, который превращает доступ к Gemini Web в единый, безопасный и управляемый сервис. Он предоставляет совместимые endpoint’ы `/v1/models`, `/v1/chat/completions`, `/v1/responses`, проектные API-ключи, дневные лимиты, логи, статистику и простое подключение через стандартный OpenAI-compatible клиент. [docs.railway](https://docs.railway.com/services)

информация не точная "' React 19, Fastify вместо Hono, Zustand, Upstash Redis, точные названия моделей вроде gemini-flash, часть package list и некоторые детали внутренней реализации gateway — это инженерная рекомендация, а не полностью подтвержденная официальная спецификация именно твоего будущего проекта "'
