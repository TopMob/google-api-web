# google-api-web

Персональный OpenAI-compatible и Google Native AI Gateway на базе Gemini Web для локального использования.

> Проект предназначен для локального использования и экспериментов. Он может зависеть от текущего поведения стороннего веб-интерфейса Gemini и перестать работать после его изменений.

## Архитектура

- `apps/web` — локальная панель управления;
- `apps/gateway` — Fastify-шлюз.

1. **Панель управления (`apps/web`):** [http://localhost:3000](http://localhost:3000) (Next.js 16 + React 19 + Tailwind CSS v4)
   - **Чат:** диалог со стримингом, рендерингом Markdown и блоков `<think>`, прикреплением и вставкой изображений (`Ctrl+V`).
   - **Подключение:** единые эндпоинты, пресеты клиентов (Cursor, OpenCode, VS Code, Gemini CLI, Zed, JetBrains, OpenClaw, cURL, Python, `.env`), управление проектами и API-ключами (RPM и дневные лимиты), проверка и сохранение cookies.
   - **Логи:** метрики токенов (prompt/completion), успешность, средняя задержка и история запросов с фильтрацией.
2. **API-шлюз (`apps/gateway`):** [http://localhost:8081](http://localhost:8081) / [http://localhost:8081/v1](http://localhost:8081/v1) (Fastify + TypeScript)

- панель: `http://localhost:3000`;
- API: `http://localhost:8081`;
- OpenAI-compatible API: `http://localhost:8081/v1`.

## Запуск проекта

```bash
git clone https://github.com/TopMob/google-api-web.git
cd google-api-web
npm install

# 2. Запуск локального dev-сервера (шлюз + веб-панель)
npm run dev
```

После запуска откройте в браузере:

- Панель управления: **http://localhost:3000**
- Healthcheck шлюза: **http://localhost:8081/health**

### Быстрый запуск на Windows (`start.bat`) и доступ извне (`ngrok`)

В корне проекта есть [start.bat](start.bat) с выбором режима:

- **`[1] Local`** — запускает только локально (`:3000` и `:8081`).
- **`[2] Online`** — запускает `npm run dev` и туннель `ngrok http 8081` в отдельном окне (веб-панель `:3000` остаётся только локальной).

#### Первичная настройка `ngrok` (делается 1 раз на машине):

1. Зарегистрируйтесь бесплатно (через GitHub или Google, карта не нужна) на **[https://ngrok.com](https://ngrok.com)** и скопируйте свой **Authtoken** из раздела **Your Authtoken** в [dashboard.ngrok.com](https://dashboard.ngrok.com).
2. Установите, обновите и привяжите токен в PowerShell:
   ```powershell
   winget install Ngrok.Ngrok
   ngrok update
   ngrok config add-authtoken ВАШ_ТОКЕН
   ```
3. _(Опционально — для постоянного адреса)_ В панели ngrok перейдите в **Domains** → создайте бесплатный статический домен и перед запуском `start.bat` задайте переменную окружения:
   ```powershell
   set NGROK_DOMAIN=ваш-домен.ngrok-free.app
   ```
4. Перед открытием наружу зайдите на **http://localhost:3000** → **Подключение**, создайте свой API-ключ и отключите дефолтный `sk-personal-gw`.
5. В клиенте (OpenCode / Roo Code) укажите:
   - **Base URL:** `https://<ваш-адрес>.ngrok-free.dev/v1` (или `.ngrok-free.app/v1`)
   - **API Key:** ваш созданный ключ

---

## Доступные модели

| Модель (ID)         | Описание                                                       |
| :------------------ | :------------------------------------------------------------- |
| `gemini-4-hydrogen` | Быстрая модель Gemini 4 для повседневных задач (по умолчанию). |
| `gemini-4-neon`     | Глубокий анализ и рассуждения.                                 |
| `gemini-4-argon`    | Сбалансированная frontier-модель Gemini 4.                     |
| `gemini-4-carbon`   | Флагманская модель Gemini 4 для кода и сложных задач.          |
| `gemini-auto`       | Автоматический выбор модели.                                   |

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

## API

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /health`

Если в браузере выполнен вход в несколько аккаунтов Google, укажите индекс аккаунта в `config.json` (или переменной `AUTH_USER`):

```json
{
  "auth_user": "1"
}
```

(`"0"` или `""` — основной аккаунт, `"1"` — второй, `"2"` — третий).
