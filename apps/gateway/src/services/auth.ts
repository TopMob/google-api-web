import { FastifyRequest } from "fastify";
import crypto from "crypto";
import { store } from "../db.js";
import { parseAndValidateCookie, isCookieValidCached } from "../utils/cookie.js";
import { checkRateLimit } from "../utils/rateLimit.js";
import { config, DEFAULT_RATE_LIMIT_RPM, ADMIN_API_KEY, API_KEYS, TEMPORARY_CHATS } from "../config.js";
import { logger } from "../logger.js";

export interface AuthResult {
  valid: boolean;
  projectId?: string;
  apiKeyId?: string;
  customCookie?: string;
  temporaryChats?: boolean;
  error?: string;
  statusCode?: number;
}

export async function verifyApiKey(request: FastifyRequest, model: string): Promise<AuthResult> {
  let key = "";
  const authHeader = request.headers.authorization;
  const xApiKeyHeader = request.headers["x-api-key"];
  const xGoogApiKeyHeader = request.headers["x-goog-api-key"];

  if (authHeader) {
    key = authHeader.replace(/^Bearer\s+/i, "").trim();
  } else if (xApiKeyHeader) {
    key = Array.isArray(xApiKeyHeader) ? xApiKeyHeader[0].trim() : xApiKeyHeader.trim();
  } else if (xGoogApiKeyHeader) {
    key = Array.isArray(xGoogApiKeyHeader) ? xGoogApiKeyHeader[0].trim() : xGoogApiKeyHeader.trim();
  }

  let rateLimitKey = "";
  let rateLimitRpm = 0;

  const isCookieStr =
    key.includes("SID=") || key.includes("__Secure-1PSID") || (key.includes(";") && key.includes("="));

  if (key && isCookieStr) {
    const parseResult = parseAndValidateCookie(key);
    if (!parseResult.valid) {
      return { valid: false, error: parseResult.error || "Invalid cookie format", statusCode: 401 };
    }

    const { cookieStr, sapisid } = parseResult.data!;
    const isConnOk = await isCookieValidCached(cookieStr, sapisid);
    if (!isConnOk) {
      return { valid: false, error: "Cookie expired or invalid. Please refresh your Gemini cookie.", statusCode: 401 };
    }

    rateLimitKey = `cookie:${crypto.createHash("sha256").update(cookieStr).digest("hex")}`;
    rateLimitRpm = DEFAULT_RATE_LIMIT_RPM;

    if (rateLimitRpm > 0) {
      const isRateOk = await checkRateLimit(rateLimitKey, rateLimitRpm);
      if (!isRateOk) {
        return { valid: false, error: "Rate limit exceeded. Please slow down.", statusCode: 429 };
      }
    }

    return {
      valid: true,
      projectId: "00000000-0000-0000-0000-000000000000",
      apiKeyId: "00000000-0000-0000-0000-000000000000",
      customCookie: cookieStr
    };
  }

  // Check config-file static API keys
  const configApiKeys = API_KEYS;
  if (configApiKeys && Array.isArray(configApiKeys)) {
    if (configApiKeys.length === 0) {
      return {
        valid: true,
        projectId: "00000000-0000-0000-0000-000000000000",
        apiKeyId: "00000000-0000-0000-0000-000000000000"
      };
    }

    if (!key) {
      return { valid: false, error: "Missing API key / Authorization header", statusCode: 401 };
    }

    if (configApiKeys.includes(key)) {
      rateLimitKey = `static:${key}`;
      rateLimitRpm = DEFAULT_RATE_LIMIT_RPM;

      if (rateLimitRpm > 0) {
        const isRateOk = await checkRateLimit(rateLimitKey, rateLimitRpm);
        if (!isRateOk) {
          return { valid: false, error: "Rate limit exceeded. Please slow down.", statusCode: 429 };
        }
      }

      return {
        valid: true,
        projectId: "00000000-0000-0000-0000-000000000000",
        apiKeyId: "00000000-0000-0000-0000-000000000000"
      };
    }

    return { valid: false, error: "Invalid API key", statusCode: 401 };
  }

  if (!key) {
    return { valid: false, error: "Missing API key / Authorization header", statusCode: 401 };
  }

  // Check admin key (configured via ADMIN_API_KEY env; no rate limits as documented)
  const envAdminKey = process.env.ADMIN_API_KEY;
  const adminKey = envAdminKey || ADMIN_API_KEY;
  if (adminKey && key === adminKey) {
    // If using the built-in default sk-personal-gw (not explicitly overridden in env),
    // respect disabling/deleting the default key in the Web UI store.
    const isUsingBuiltInDefault = !envAdminKey && adminKey === "sk-personal-gw";
    let defaultKeyDisabledInStore = false;
    let defaultEntry: ReturnType<typeof store.getApiKeys>[number] | undefined;
    if (isUsingBuiltInDefault) {
      const allKeys = store.getApiKeys();
      defaultEntry = allKeys.find((k) => k.id === "00000000-0000-0000-0000-000000000001");
      if (defaultEntry && !defaultEntry.active) {
        defaultKeyDisabledInStore = true;
      } else if (!defaultEntry && allKeys.length > 0) {
        defaultKeyDisabledInStore = true;
      }
    }

    if (!defaultKeyDisabledInStore) {
      return {
        valid: true,
        projectId: "00000000-0000-0000-0000-000000000000",
        apiKeyId: "00000000-0000-0000-0000-000000000001",
        temporaryChats: defaultEntry?.temporary_chats ?? TEMPORARY_CHATS
      };
    }
  }

  // Check LocalStore API keys
  const storedKey = store.findApiKey(key);
  if (!storedKey) {
    return { valid: false, error: "Invalid API key", statusCode: 401 };
  }

  if (storedKey.expires_at && new Date(storedKey.expires_at) < new Date()) {
    return { valid: false, error: "API key has expired", statusCode: 403 };
  }

  if (storedKey.allowed_models && storedKey.allowed_models.length > 0 && !storedKey.allowed_models.includes(model)) {
    return { valid: false, error: `Model '${model}' is not allowed for this API key`, statusCode: 403 };
  }

  const keyRpm = storedKey.rate_limit_rpm ?? DEFAULT_RATE_LIMIT_RPM;
  if (keyRpm > 0) {
    const isRateOk = await checkRateLimit(storedKey.id, keyRpm);
    if (!isRateOk) {
      return { valid: false, error: "Rate limit exceeded. Please slow down.", statusCode: 429 };
    }
  }

  if (
    (storedKey.daily_requests_limit && storedKey.daily_requests_limit > 0) ||
    (storedKey.daily_tokens_limit && storedKey.daily_tokens_limit > 0)
  ) {
    const daily = store.getDailyUsageForKey(storedKey.id);
    if (
      storedKey.daily_requests_limit &&
      storedKey.daily_requests_limit > 0 &&
      daily.requests >= storedKey.daily_requests_limit
    ) {
      return { valid: false, error: "Daily request limit exceeded for this API key.", statusCode: 429 };
    }
    if (
      storedKey.daily_tokens_limit &&
      storedKey.daily_tokens_limit > 0 &&
      daily.tokens >= storedKey.daily_tokens_limit
    ) {
      return { valid: false, error: "Daily token limit exceeded for this API key.", statusCode: 429 };
    }
  }

  return {
    valid: true,
    projectId: storedKey.project_id,
    apiKeyId: storedKey.id,
    temporaryChats: storedKey.temporary_chats ?? TEMPORARY_CHATS
  };
}

export async function logUsage(
  projectId: string,
  apiKeyId: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  durationMs: number,
  statusCode: number
) {
  try {
    store.addUsageLog({
      project_id: projectId,
      api_key_id: apiKeyId,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      duration_ms: durationMs,
      status_code: statusCode
    });
  } catch (e) {
    logger.error({ err: e }, "Failed to write usage log");
  }
}
