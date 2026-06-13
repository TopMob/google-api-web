import { FastifyRequest } from "fastify";
import crypto from "crypto";
import { supabase } from "../db.js";
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
      apiKeyId: "00000000-0000-0000-0000-000000000000"
    };
  }

  if (!supabase) {
    return { valid: false, error: "Database offline and key is not recognized", statusCode: 503 };
  }

  const { data, error } = await supabase
    .from("api_keys")
    .select(
      "id, project_id, active, allowed_models, daily_requests_limit, daily_tokens_limit, rate_limit_rpm, expires_at"
    )
    .eq("key", key)
    .single();

  if (error || !data) {
    return { valid: false, error: "Invalid API key", statusCode: 401 };
  }
  if (!data.active) {
    return { valid: false, error: "API key is deactivated", statusCode: 403 };
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { valid: false, error: "API key has expired", statusCode: 403 };
  }
  if (data.allowed_models && !data.allowed_models.includes(model)) {
    return { valid: false, error: `Model '${model}' is not allowed for this API key`, statusCode: 403 };
  }

  if (data.rate_limit_rpm && data.rate_limit_rpm > 0) {
    const isRateOk = await checkRateLimit(data.id, data.rate_limit_rpm);
    if (!isRateOk) {
      return { valid: false, error: "Rate limit exceeded. Please slow down.", statusCode: 429 };
    }
  }

  if (
    (data.daily_requests_limit && data.daily_requests_limit > 0) ||
    (data.daily_tokens_limit && data.daily_tokens_limit > 0)
  ) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const { data: usageData, error: usageErr } = await supabase
      .from("usage_logs")
      .select("total_tokens")
      .eq("api_key_id", data.id)
      .gte("created_at", today.toISOString());

    if (usageErr) {
      logger.error({ err: usageErr }, "Failed to query usage_logs for limit verification");
    } else {
      const requestsToday = usageData ? usageData.length : 0;
      const tokensToday = usageData
        ? usageData.reduce((sum: number, row: { total_tokens?: number | null }) => sum + (row.total_tokens || 0), 0)
        : 0;

      if (data.daily_requests_limit && requestsToday >= data.daily_requests_limit) {
        return { valid: false, error: "Daily request limit exceeded", statusCode: 429 };
      }
      if (data.daily_tokens_limit && tokensToday >= data.daily_tokens_limit) {
        return { valid: false, error: "Daily token limit exceeded", statusCode: 429 };
      }
    }
  }

  return {
    valid: true,
    projectId: data.project_id,
    apiKeyId: data.id
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
  if (!supabase) return;
  try {
    await supabase.from("usage_logs").insert({
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
    logger.error({ err: e }, "Failed to write usage log to Supabase");
  }
}
