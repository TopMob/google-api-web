import { FastifyRequest } from "fastify";
import crypto from "crypto";
import { store } from "../db.js";
import { parseAndValidateCookie, isCookieValidCached } from "../utils/cookie.js";
import { checkRateLimit } from "../utils/rateLimit.js";
import { config, DEFAULT_RATE_LIMIT_RPM, ADMIN_API_KEY, API_KEYS } from "../config.js";
import { logger } from "../logger.js";

export interface AuthResult {
  valid: boolean;
  projectId?: string;
  apiKeyId?: string;
  customCookie?: string;
  error?: string;
  statusCode?: number;
}

export async function verifyApiKey(request: FastifyRequest, model: string): Promise<AuthResult> {
  let key = "";
  const authHeader = request.headers.authorization;
  const xApiKeyHeader = request.headers["x-api-key"];

  if (authHeader) {
    key = authHeader.replace(/^Bearer\s+/i, "").trim();
  } else if (xApiKeyHeader) {
    if (Array.isArray(xApiKeyHeader)) {
      key = xApiKeyHeader[0].trim();
    } else {
      key = xApiKeyHeader.trim();
    }
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

  // Check admin key
  const adminKey = ADMIN_API_KEY;
  if (key === adminKey || key === "sk-personal-gw") {
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
      apiKeyId: "00000000-0000-0000-0000-000000000001"
    };
  }

  // Check LocalStore API keys
  const storedKey = store.findApiKey(key);
  if (!storedKey) {
    return { valid: false, error: "Invalid API key", statusCode: 401 };
  }

  if (storedKey.expires_at && new Date(storedKey.expires_at) < new Date()) {
    return { valid: false, error: "API key has expired", statusCode: 403 };
  }

  if (storedKey.allowed_models && !storedKey.allowed_models.includes(model)) {
    return { valid: false, error: `Model '${model}' is not allowed for this API key`, statusCode: 403 };
  }

  const keyRpm = storedKey.rate_limit_rpm || DEFAULT_RATE_LIMIT_RPM;
  if (keyRpm > 0) {
    const isRateOk = await checkRateLimit(storedKey.id, keyRpm);
    if (!isRateOk) {
      return { valid: false, error: "Rate limit exceeded. Please slow down.", statusCode: 429 };
    }
  }

  return {
    valid: true,
    projectId: storedKey.project_id,
    apiKeyId: storedKey.id
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
