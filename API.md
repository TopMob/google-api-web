

Вот максимально полная выжимка — **всё, что нужно другому ИИ-агенту, чтобы переписать твой API-агрегатор под нормальный формат**. Я не даю готового решения, а даю ** 폭발ную информацию по форматам, эндпоинтам, полям, настройкам клиентов и подводным камням**.

***

# 1. OpenAI-Compatible API — что именно нужно поддерживать

## 1.1. Ключевые эндпоинты

| Эндпоинт | Метод | Зачем нужен | Обязателен для |
| :-- | :-- | :-- | :-- |
| `/v1/chat/completions` | POST | Основной чат-интерфейс | Любого OpenAI-клиента, OpenCode, LangChain, LlamaIndex, AutoGen, Vercel AI SDK [^1][^2] |
| `/v1/models` | GET | Список доступных моделей | Клиенты, которые показывают выбор моделей (Cherry Studio, ChatBox, OpenCode) [^1] |
| `/v1/responses` | POST | Responses API (новый формат OpenAI) | OpenAI Codex CLI, OpenCode (опционально) [^1] |
| `/v1beta/models` | GET | Google-native API | Gemini CLI [^1] |
| `/v1beta/models/{model}:generateContent` | POST | Google-native generateContent | Gemini CLI, не-OpenAI клиенты [^1] |
| `/v1beta/models/{model}:streamGenerateContent` | POST | Google-native streaming | Gemini CLI streaming [^1] |

**Минимум для OpenCode:** `/v1/chat/completions` + `/v1/models`[^2][^1]

**Для максимально широкой совместимости:** добавить `/v1/responses` + Google-native endpoints[^1]

***

## 1.2. Формат запроса `/v1/chat/completions`

### Обязательные поля запроса

```json
{
  "model": "gemini-3.5-flash-thinking",           // строка, обязательно
  "messages": [                                    // массив, обязательно
    {
      "role": "system",                            // "system" | "user" | "assistant" | "tool"
      "content": "You are a helpful assistant."    // строка или массив content parts
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ]
}
```


### Опциональные поля запроса (важные для агентов)

| Поле | Тип | Описание | Важно для |
| :-- | :-- | :-- | :-- |
| `stream` | boolean | `true` = SSE streaming | Все современные клиенты [^1][^3] |
| `temperature` | float (0–2) | Температура генерации | Качество/случайность ответа |
| `max_tokens` | integer | Макс. токенов ответа | Ограничение длины |
| `top_p` | float (0–1) | Nucleus sampling | Альтернатива temperature |
| `frequency_penalty` | float (-2 to 2) | Штраф за повторения | Снижение повторений |
| `presence_penalty` | float (-2 to 2) | Штраф за наличие токена | Разнообразие |
| `stop` | string[] | Секвенции остановки | Контроль окончания |
| `tools` | object[] | Массив функций для tool calling | Агенты, OpenCode [^1][^4] |
| `tool_choice` | string/object | `"auto"` | `"none"` |
| `response_format` | object | `{"type": "json_object"}` или `{"type": "json_schema", ...}` | JSON mode, structured outputs [^6][^4] |
| `seed` | integer | Seed для детерминизма | Воспроизводимость |
| `user` | string | ID пользователя | Abuse detection, трекинг |

### Формат `messages`

Каждое сообщение:

```json
{
  "role": "user",  // или "system", "assistant", "tool"
  "content": "Текст сообщения"
}
```

**Для мультимодальности (твое решение не поддерживает изображения — limitation ):**[^1]

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "Что на этой картинке?"},
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
  ]
}
```

**Ты не поддерживаешь image input** — это ограничение Gemini Web протокола.[^1]

### Формат `tools` (tool calling / function calling)

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a city",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "The city name"
            }
          },
          "required": ["city"],
          "additionalProperties": false
        },
        "strict": true  // JSON mode в action [web:37]
      }
    }
  ]
}
```

**Твой прокси заявляет full function calling support** — это критично для агентов.[^1]

***

## 1.3. Формат ответа `/v1/chat/completions` (не streaming)

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677858242,
  "model": "gemini-3.5-flash-thinking",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?",
        "tool_calls": [  // если вышли tool calls
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"city\": \"Tokyo\"}"
            }
          }
        ]
      },
      "finish_reason": "stop"  // или "length", "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  },
  "system_fingerprint": "fp_abc123"
}
```

**Критичные поля:**

- `choices[^0].message.content` — текст ответа[^1]
- `choices[^0].message.tool_calls` — если вышли функции[^5]
- `finish_reason` — почему остановилось[^5]
- `usage` — токены (многие клиенты это показывают)[^5]

***

## 1.4. Формат streaming (SSE)

**Content-Type:** `text/event-stream`

Каждый чанк:

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677858242,"model":"gemini-3.5-flash","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677858242,"model":"gemini-3.5-flash","choices":[{"index":0,"delta":{"content":" "},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677858242,"model":"gemini-3.5-flash","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}

data: [DONE]
```

**Формат `delta`:**

```json
{
  "delta": {
    "content": "Часть текста",
    "role": "assistant"  // обычно только в первом чанке
  }
}
```

**Твой прокси заявляет SSE streaming support** — это критично для UX.[^1]

***

## 1.5. Формат `/v1/models`

```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-3.5-flash-thinking",
      "object": "model",
      "created": 1714521600,
      "owned_by": "gemini-web2api",
      "permission": [...],
      "root": "gemini-3.5-flash-thinking",
      "parent": null
    },
    {
      "id": "gemini-3.5-flash",
      "object": "model",
      ...
    }
  ]
}
```

**Модели, которые заявлены в README:**


| Model ID | Описание | Выход |
| :-- | :-- | :-- |
| `gemini-3.5-flash` | Fast general-purpose | ~12k chars [^1] |
| `gemini-3.5-flash-thinking` | Deep thinking, longest output | **~20k chars** [^1] |
| `gemini-3.5-flash-thinking-lite` | Adaptive thinking depth | ~15k chars [^1] |
| `gemini-3.1-pro` | Pro (нужен cookie для реального роутинга) | ~12k chars [^1] |
| `gemini-auto` | Auto model selection | varies [^1] |
| `gemini-flash-lite` | Lightweight fast | ~10k chars [^1] |

**Thinking depth:** добавь `@think=N` к названию модели:

- `gemini-3.5-flash-thinking@think=0` — deepest (default)[^1]
- `gemini-3.5-flash-thinking@think=2` — medium[^1]
- `gemini-3.5-flash-thinking@think=4` — shallowest[^1]

***

# 2. Подключение OpenCode (npx opencode-ai)

## 2.1. Что такое OpenCode

OpenCode — это **терминальный AI coding agent** (как Claude Code или Gemini CLI), который поддерживает **75+ LLM провайдеров** через AI SDK и Models.dev.[^7][^8]

## 2.2. Как добавить кастомный OpenAI-compatible провайдер

### Шаг 1: `/connect` в TUI

1. Запусти `npx opencode-ai`
2. Введи `/connect` в TUI
3. Прокрути вниз до **Other**
4. Введи уникальный ID провайдера (например, `gemini-web2api`)
5. Введи API ключ (любой, если у тебя `api_keys` не пустой в config.json)[^9][^10]

### Шаг 2: Добавь провайдер в `opencode.json`

**Глобальный конфиг:** `~/.config/opencode/opencode.json`

**Проектный конфиг:** `opencode.json` в корне проекта (перебивает глобальный)[^11]

```json
{
  "provider": {
    "gemini-web2api": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Gemini Web2API",
      "options": {
        "baseURL": "http://localhost:8081/v1",
        "apiKey": "sk-your-key"
      },
      "models": {
        "gemini-3.5-flash-thinking": {
          "name": "Gemini 3.5 Flash Thinking (~20k chars)"
        },
        "gemini-3.5-flash": {
          "name": "Gemini 3.5 Flash (~12k chars)"
        },
        "gemini-3.5-flash-thinking-lite": {
          "name": "Gemini 3.5 Flash Thinking Lite (~15k chars)"
        },
        "gemini-3.1-pro": {
          "name": "Gemini 3.1 Pro (needs cookie)"
        }
      }
    }
  }
}
```

**Ключевые поля:**

- `npm`: `@ai-sdk/openai-compatible` для `/v1/chat/completions`[^9]
- `baseURL`: `http://localhost:8081/v1`[^9][^1]
- `apiKey`: `sk-your-key` (из `config.json` твоего прокси)[^9][^1]
- `models`: маппинг model ID → display name[^9]


### Шаг 3: Проверь подключение

```bash
opencode auth list  # увидишь ли твой провайдер [web:18]
opencode models     # увидишь ли модели [web:18]
```


***

## 2.3. Environment variables (альтернатива config)

OpenCode автоматически подхватывает:

```bash
export OPENAI_API_KEY="sk-your-key"
# OpenCode использует это для apiKey, если не указан в config [web:20]
```

Для кастомного baseURL всё равно нужен config.[^12]

***

## 2.4. Примеры других клиентов (для проверки)

### curl

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```


### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8081/v1",
    api_key="sk-your-key"
)

resp = client.chat.completions.create(
    model="gemini-3.5-flash-thinking",
    messages=[{"role": "user", "content": "Explain quantum computing"}]
)

print(resp.choices[^0].message.content)
```


### OpenAI JavaScript/TypeScript SDK

```typescript
import OpenAI from "openai"

const openai = new OpenAI({
  baseURL: "http://localhost:8081/v1",
  apiKey: "sk-your-key"
})

const completion = await openai.chat.completions.create({
  model: "gemini-3.5-flash",
  messages: [{ role: "user", content: "Why is the sky blue?" }]
})

console.log(completion.choices[^0].message.content)
```


### Cherry Studio / ChatBox / любой OpenAI клиент

| Field | Value |
| :-- | :-- |
| Base URL | `http://localhost:8081/v1` [^1] |
| API Key | любой `api_keys` из `config.json`; любой, если не настроен [^1] |
| Model | `gemini-3.5-flash-thinking` [^1] |


***

# 3. Конфигурация твоего proxy-server (gemini-web2api)

## 3.1. `config.json`

```json
{
  "port": 8081,
  "host": "0.0.0.0",
  "retry_attempts": 3,
  "retry_delay_sec": 2,
  "request_timeout_sec": 180,
  "gemini_bl": "boq_assistant-bard-web-server_20260525.09_p0",
  "auth_user": null,
  "xsrf_token": null,
  "api_keys": ["sk-your-key"],
  "cookie_file": null,
  "proxy": null,
  "log_requests": true
}
```

**Ключевые моменты:**


| Поле | Значение | Поведение |
| :-- | :-- | :-- |
| `api_keys` | `[]` | Auth отключён, любой ключ проходит [^1] |
| `api_keys` | `["sk-..."]` | Требуется `Authorization: Bearer <key>` или `x-api-key: <key>` [^1] |
| `cookie_file` | `null` | Anonymous access, все модели работают [^1] |
| `cookie_file` | `"cookie.txt"` | Реальный `gemini-3.1-pro` (без cookie роутится на Flash) [^1] |
| `proxy` | `null` | Прямой доступ к gemini.google.com [^1] |
| `proxy` | `"http://127.0.0.1:7890"` | Clash/V2Ray/Shadowsocks [^1] |


***

## 3.2. Как получить cookies (для Pro)

1. Chrome → `gemini.google.com` → залогинься[^1]
2. DevTools (F12) → Application → Cookies → `https://gemini.google.com`[^1]
3. Скопируй: `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-1PSID`[^1]
4. Создай `cookie.txt`:
```
SID=your_sid_value; HSID=your_hsid_value; SSID=your_ssid_value; APISID=your_apisid_value; SAPISID=your_sapisid_value; __Secure-1PSID=your_1psid_value
```

**Или JSON формат:**

```json
{"cookie": "SID=xxx; HSID=xxx; SSID=xxx; APISID=xxx; SAPISID=xxx; __Secure-1PSID=xxx", "sapisid": "your_sapisid_value"}
```

**Альтернатива:** расширение "Export Cookies" → Netscape format → конвертируй в single-line[^1]

***

## 3.3. Auth user + XSRF token

Если URL содержит `/u/1/` (или другой индекс):

```
https://gemini.google.com/u/1/app/...
```

→ `auth_user: "1"`[^1]

XSRF token из source кода страницы (находится как `SNlM0e`):

```json
{
  "cookie_file": "/app/cookie.txt",
  "auth_user": "1",
  "xsrf_token": "AOOh0P...",
  "gemini_bl": "boq_assistant-bard-web-server_YYYYMMDD.xx_p0"
}
```

Если получаешь HTTP 400 с `xsrf` error → обнови Gemini Web, обнови `xsrf_token`[^1]

***

# 4. Ограничения твоего решения (критично для агентов)

| Ограничение | Описание | Влияние |
| :-- | :-- | :-- |
| **No image/multimodal input** | Gemini image upload требует proprietary RPC (WIZ/ProcessFile), невозможно в HTTP proxy [^1] | Изображения в сообщениях будут игнорироваться с уведомлением [^1] |
| **Not real Pro/Ultra** | Без платного cookie `gemini-3.1-pro` роутится на Flash [^1] | Label "Pro" — это UI preference, не backend switch [^1] |
| **Single-turn only** | Каждый запрос независим, мульти-тёрн симулируется включением предыдущих сообщений в prompt [^1] | Многошаговые диалоги не работают "из коробки", клиент сам собирает историю |
| **Rate limits** | Google может throttle-ить частые запросы, сервер автоматически ретраит, но sustained heavy use может заблокировать [^1] | Низкий throughput для агентов с частыми запросами |


***

# 5. Docker / Docker Compose

## 5.1. Docker

```bash
cp config.example.json config.json
docker build -t gemini-web2api .
docker run -d --name gemini-web2api \
  -p 8081:8081 \
  -v ./config.json:/app/config.json \
  gemini-web2api
```

С cookie файлом:

```bash
docker run -d --name gemini-web2api \
  -p 8081:8081 \
  -v ./config.json:/app/config.json \
  -v ./cookie.txt:/app/cookie.txt \
  gemini-web2api
```

В `config.json`: `"cookie_file": "/app/cookie.txt"`[^1]

***

## 5.2. Docker Compose

```bash
cp config.example.json config.json
docker compose up -d
```


***

# 6. Google-native API (для Gemini CLI)

Если хочешь поддержку **Gemini CLI** (Google native CLI):

```bash
export GEMINI_API_KEY=none
export GOOGLE_GEMINI_BASE_URL=http://localhost:8081
gemini
```

**Эндпоинты:**


| Эндпоинт | Метод | Описание |
| :-- | :-- | :-- |
| `/v1beta/models` | GET | List models [^1] |
| `/v1beta/models/{model}:generateContent` | POST | Non-streaming [^1] |
| `/v1beta/models/{model}:streamGenerateContent` | POST | Streaming (SSE) [^1] |


***

# 7. Как работает твой прокси (внутреннее устройство)

Твой прокси **reverse-engineers Google Gemini's web StreamGenerate protocol**:

- Отправляет запросы на тот же endpoint, что и Gemini web app[^1]
- Конвертирует между OpenAI API format и Gemini internal protobuf-like format[^1]
- **Model selection** контролируется полем `[^79]` в request payload, маппится из `MODE_CATEGORY` enum из frontend JavaScript[^1]

**Pure Python, stdlib only, без внешних зависимостей**[^1]

***

# 8. SDK и библиотеки, которые будут работать

## 8.1. Python

| Библиотека | Поддержка | Пример |
| :-- | :-- | :-- |
| `openai` (official) | ✅ Полная | `base_url="http://localhost:8081/v1"` [^1] |
| `langchain` | ✅ OpenAI香奈义 | `OpenAIChat(base_url=...)` |
| `LlamaIndex` | ✅ OpenAI-compatible | `OpenAI(base_url=...)` |
| `AutoGen` | ✅ Config list | `{"base_url": "...", "api_key": "..."}` [^2] |

## 8.2. JavaScript/TypeScript

| Библиотека | Поддержка | Пример |
| :-- | :-- | :-- |
| `openai` (official) | ✅ Полная | `baseURL: "http://localhost:8081/v1"` [^2] |
| `@ai-sdk/openai` | ✅ Vercel AI SDK | `baseURL: "..."` [^9] |
| `@ai-sdk/openai-compatible` | ✅ Для кастомных провайдеров | `baseURL: "..."` [^9] |

## 8.3. CLI-инструменты

| Инструмент | Поддержка | Настройка |
| :-- | :-- | :-- |
| OpenCode | ✅ | `baseURL` + `apiKey` + `models` [^9] |
| Gemini CLI | ✅ (Google-native) | `GOOGLE_GEMINI_BASE_URL` [^1] |
| Codex CLI | ✅ (Responses API) | `/v1/responses` [^1] |


***

# 9. Что нужно проверить перед тем, как отдавать код другому ИИ-агенту

## 9.1. Обязательные тесты

1. **`/v1/models`** возвращает список моделей в OpenAI формате[^1]
2. **`/v1/chat/completions`** с минимальным запросом (`model`, `messages`) работает[^1]
3. **Streaming** (`stream: true`) возвращает SSE в формате `data: {...}`[^13][^1]
4. **Tool calling** (`tools: [...]`) возвращает `tool_calls` в ответе[^4][^1]
5. **API key auth** работает, если `api_keys` не пустой[^1]

## 9.2. Опциональные тесты

6. **`/v1/responses`** работает (для Codex CLI)[^1]
7. **Google-native endpoints** (`/v1beta/models`) работают (для Gemini CLI)[^1]
8. **Thinking depth** (`@think=N`) работает[^1]

***

# 10. Что делать дальше (инструкция для другого ИИ-агента)

1. **Изучить текущий код** `gemini_web2api.py`[^1]
2. **Проверить, что все обязательные эндпоинты работают** (пункт 9.1)
3. **Если не работает streaming** — реализовать SSE с форматом `data: {...}\n\n`[^13]
4. **Если не работает tool calling** — добавить конвертацию OpenAI `tools` → Gemini internal format и обратно[^4][^1]
5. **Если не работает `/v1/models`** — добавить endpoint, возвращающий список моделей в OpenAI формате[^1]
6. **Добавить `/v1/responses`** (если хочешь Codex CLI support)[^1]
7. **Добавить Google-native endpoints** (если хочешь Gemini CLI support)[^1]
8. **Написать тесты** для всех эндпоинтов
9. **Оптимизировать retry логику** (сейчас 3 ретрая с 2 секундами задержки)[^1]
10. **Добавить логирование** (сейчас `log_requests: true`)[^1]

***

# 11. Критичные риски

| Риск | Описание | Митигация |
| :-- | :-- | :-- |
| **Google ломает веб-протокол** | Gemini Web может изменить Internal API в любой момент [^1] | Хранить cookie, следить за обновлениями repo [^1] |
| **Rate limiting** | Google throttle-ит частые запросы [^1] | Добавить rate limiter на клиенте |
| **Cookie expiry** | Cookies могут истечь | Обновлять cookie вручную или автоматом |
| **No official API** | Это reverse-engineered solution, не поддерживается Google [^1] | Быть готовым к постоянным багфиксам |


***

# 12. Вместо API ключа — что реально использовать

У тебя **не будет настоящего API ключа Google**, потому что:

1. Это **веб-прокси**, а не официальный API[^1]
2. Авторизация идёт через **cookie**, а не через OAuth/API key[^1]
3. Твой `api_keys` в `config.json` — это **твоя собственная система auth** для клиентов, а не Google API key[^1]

**Что писать в клиентах:**


| Поле | Что писать |
| :-- | :-- |
| `base_url` | `http://localhost:8081/v1` [^1] |
| `api_key` | Любой из `api_keys` в `config.json` (или любой, если `api_keys` пуст) [^1] |
| `model` | `gemini-3.5-flash-thinking` и другие из списка [^1] |


***

**Всё. Это вся информация, которая нужна другому ИИ-агенту, чтобы полностью переписать твой API-агрегатор под нормальный формат.**

информация не точная: `'я не вижу весь код твоего форка, поэтому часть деталей реализации (например, точные поля в request payload ``) — это интерпретация README, а не проверка кода'` []
<span style="display:none">[^14][^15][^16][^17][^18][^19][^20][^21][^22][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32]</span>

<div align="center">⁂</div>

[^1]: https://github.com/Sophomoresty/gemini-web2api/blob/main/pyproject.toml

[^2]: https://ollama.com/blog/openai-compatibility

[^3]: https://stackoverflow.com/questions/78660088/how-does-streaming-work-in-openais-apis

[^4]: https://help.openai.com/en/articles/8555517-function-calling-in-the-openai-api

[^5]: https://developers.openai.com/cookbook/examples/how_to_format_inputs_to_chatgpt_models

[^6]: https://platform.openai.com/docs/guides/text-generation/chat-completions-response-format

[^7]: https://opencode.ai/docs/providers/

[^8]: https://opencode.ai/docs/

[^9]: https://github.com/anomalyco/opencode/issues/5674

[^10]: https://github.com/googleapis

[^11]: https://opencode.ai/docs/config/

[^12]: https://docs.llmhub.t-systems.net/plugins/opencode/

[^13]: https://docs.megallm.io/en/dev-docs/openai/streaming

[^14]: https://milvus.io/ai-quick-reference/how-to-set-up-opencode-with-api-key

[^15]: https://www.nxcode.io/resources/news/opencode-install-guide-step-by-step-2026

[^16]: https://www.reddit.com/r/LocalLLaMA/comments/1lv9yhq/opencode_like_claude_code_or_gemini_cli_but_works/

[^17]: https://www.eurouter.ai/integrations/openai-sdk

[^18]: https://ai.sulat.com/the-definitive-guide-to-opencode-from-first-install-to-production-workflows-aae1e95855fb

[^19]: https://github.com/opencode-ai/opencode/issues/183

[^20]: https://github.com/anomalyco/opencode/issues/2901

[^21]: https://docs.near.ai/cloud/guides/openai-compatibility

[^22]: https://aiberm.com/docs/en/opencode/

[^23]: https://platform.openai.com/docs/api-reference/chat

[^24]: https://community.openai.com/t/official-documentation-for-supported-schemas-for-response-format-parameter-in-calls-to-client-beta-chats-completions-parse/932422

[^25]: https://developers.openai.com/api/docs/guides/migrate-to-responses

[^26]: https://madhub081011.medium.com/understanding-openais-new-responses-api-streaming-model-a6d932e481e8

[^27]: https://learn.microsoft.com/en-us/dotnet/api/azure.ai.openai.chatcompletionsresponseformat?view=azure-dotnet-preview

[^28]: https://community.openai.com/t/difference-between-structured-outputs-and-function-calling-required/937697

[^29]: https://developers.openai.com/api/reference/resources/chat/

[^30]: https://github.com/thivy/azure-openai-js-stream/blob/master/README.md

[^31]: https://developers.openai.com/api/docs/guides/function-calling

[^32]: https://platform.openai.com/docs/guides/migrate-to-responses

