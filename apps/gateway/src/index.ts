import fastify from "fastify";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import { MODELS } from "@gateway/shared";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { Redis } from "ioredis";

dotenv.config();

interface Config {
  port?: number;
  host?: string;
  retry_attempts?: number;
  retry_delay_sec?: number;
  request_timeout_sec?: number;
  gemini_bl?: string;
  auth_user?: string | null;
  xsrf_token?: string | null;
  api_keys?: string[];
  cookie_file?: string | null;
  proxy?: string | null;
  log_requests?: boolean;
}

function loadConfig(): Config {
  const paths = [
    path.resolve(process.cwd(), "config.json"),
    path.resolve(process.cwd(), "../config.json"),
    path.resolve(process.cwd(), "../../config.json"),
    path.resolve(process.cwd(), "apps/gateway/config.json")
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf-8");
        return JSON.parse(content);
      } catch (e) {
        console.error(`Failed to parse config file at ${p}:`, e);
      }
    }
  }
  return {};
}

const config = loadConfig();

const logger = pino({
  level: process.env.LOG_LEVEL || "info"
});

const server = fastify({ logger });

const PORT = config.port ?? parseInt(process.env.PORT ?? "8081", 10);
const HOST = config.host ?? (process.env.HOST || "0.0.0.0");
const GEMINI_BL = config.gemini_bl ?? (process.env.GEMINI_BL || "boq_assistant-bard-web-server_20260525.09_p0");
const AUTH_USER = config.auth_user !== undefined ? (config.auth_user ?? "") : (process.env.AUTH_USER || "");
const RETRY_ATTEMPTS = config.retry_attempts ?? parseInt(process.env.RETRY_ATTEMPTS ?? "3", 10);
const RETRY_DELAY_SEC = config.retry_delay_sec ?? parseInt(process.env.RETRY_DELAY_SEC ?? "2", 10);

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Initialize Redis if REDIS_URL is provided
const redisUrl = process.env.REDIS_URL || "";
const redis = redisUrl ? new Redis(redisUrl) : null;
if (redis) {
  logger.info("Redis client connected");
}

let cachedCookie: { cookieStr: string; sapisid: string | null; timestamp: number } | null = null;
const COOKIE_FILE_TTL_MS = 60 * 1000;

function loadCookie(): { cookieStr: string; sapisid: string | null } {
  if (process.env.GEMINI_COOKIE) {
    const cookieStr = process.env.GEMINI_COOKIE.trim();
    const match = cookieStr.match(/SAPISID=([^;]+)/);
    return { cookieStr, sapisid: match ? match[1] : null };
  }

  const now = Date.now();
  if (cachedCookie && now - cachedCookie.timestamp < COOKIE_FILE_TTL_MS) {
    return { cookieStr: cachedCookie.cookieStr, sapisid: cachedCookie.sapisid };
  }

  const paths: string[] = [];
  if (config.cookie_file) {
    paths.push(
      path.resolve(process.cwd(), config.cookie_file),
      path.resolve(process.cwd(), "apps/gateway", config.cookie_file)
    );
  }
  paths.push(
    path.resolve(process.cwd(), "cookies/cookie.txt"),
    path.resolve(process.cwd(), "../cookies/cookie.txt"),
    path.resolve(process.cwd(), "../../cookies/cookie.txt"),
    path.resolve(process.cwd(), "cookie.txt")
  );

  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf-8").trim();
        let result = { cookieStr: "", sapisid: null as string | null };
        if (content.startsWith("{")) {
          const data = JSON.parse(content);
          result = { cookieStr: data.cookie || "", sapisid: data.sapisid || null };
        } else {
          const match = content.match(/SAPISID=([^;]+)/);
          result = { cookieStr: content, sapisid: match ? match[1] : null };
        }
        cachedCookie = { ...result, timestamp: now };
        return result;
      } catch (e) {
        logger.error({ err: e }, "Failed to read cookie file");
      }
    }
  }

  return { cookieStr: "", sapisid: null };
}

function makeSapisidHash(sapisid: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h = crypto.createHash("sha1").update(`${ts} ${sapisid} https://gemini.google.com`).digest("hex");
  return `SAPISIDHASH ${ts}_${h}`;
}

interface GeminiCookieData {
  cookieStr: string;
  sapisid: string | null;
  cookiesObj: Record<string, string>;
}

function parseAndValidateCookie(key: string): { valid: boolean; data?: GeminiCookieData; error?: string } {
  let cookieStr = key.trim();
  let sapisid: string | null = null;
  let cookiesObj: Record<string, string> = {};

  if (cookieStr.startsWith("{")) {
    try {
      const data = JSON.parse(cookieStr);
      cookieStr = data.cookie || "";
      sapisid = data.sapisid || null;
    } catch (e) {
      return { valid: false, error: "Invalid JSON format for cookie" };
    }
  }

  // Parse the cookies
  cookieStr.split(";").forEach((part) => {
    const [name, ...valueParts] = part.trim().split("=");
    if (name && valueParts.length > 0) {
      cookiesObj[name] = valueParts.join("=");
    }
  });

  if (!sapisid && cookiesObj.SAPISID) {
    sapisid = cookiesObj.SAPISID;
  }

  const hasSecureCookie = !!cookiesObj["__Secure-1PSID"];
  const hasClassicCookies = !!(cookiesObj.SID && sapisid);

  if (!hasSecureCookie && !hasClassicCookies) {
    return {
      valid: false,
      error: "Invalid cookie format. Required: __Secure-1PSID or (SID + SAPISID)"
    };
  }

  return {
    valid: true,
    data: {
      cookieStr,
      sapisid,
      cookiesObj
    }
  };
}

async function testGeminiConnection(cookieStr: string, sapisid: string | null): Promise<boolean> {
  try {
    const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "/u/0";
    const url = `https://gemini.google.com${prefix}/app`;
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Cookie": cookieStr
    };
    if (sapisid) {
      headers["Authorization"] = makeSapisidHash(sapisid);
    }
    const res = await fetch(url, {
      method: "GET",
      headers
    });
    
    if (res.status >= 400) {
      return false;
    }
    
    if (res.url.includes("accounts.google.com") || res.url.includes("ServiceLogin")) {
      return false;
    }

    const text = await res.text();
    return text.includes("SNlM0e");
  } catch (e) {
    logger.error({ err: e }, "Failed to test Gemini connection");
    return false;
  }
}

const cookieValidationCache = new Map<string, { isValid: boolean; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function isCookieValidCached(cookieStr: string, sapisid: string | null): Promise<boolean> {
  const cacheKey = crypto.createHash("sha256").update(cookieStr).digest("hex");
  const cached = cookieValidationCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.isValid;
  }

  const isValid = await testGeminiConnection(cookieStr, sapisid);
  if (isValid) {
    cookieValidationCache.set(cacheKey, { isValid, timestamp: now });
  } else {
    // Cache failures for only 10 seconds to prevent spam, but allow quick recovery
    cookieValidationCache.set(cacheKey, { isValid, timestamp: now - CACHE_TTL_MS + 10000 });
  }
  return isValid;
}

function cleanGeminiText(text: string): string {
  return text.replace(/```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g, "");
}

function extractResponseText(raw: string): string {
  let finalResult = "";
  for (const line of raw.split("\n")) {
    if (!line.includes('"wrb.fr"') || line.length < 200) continue;
    try {
      const innerStr = JSON.parse(line)[0][2];
      if (!innerStr || innerStr.length < 50) continue;
      const inner = JSON.parse(innerStr);
      if (Array.isArray(inner) && inner[4]) {
        let text = "";
        for (const part of inner[4]) {
          if (Array.isArray(part) && part[1] && Array.isArray(part[1])) {
            text += part[1].filter((t: any) => typeof t === "string").join("");
          }
        }
        if (text.trim()) finalResult = text;
      }
    } catch {}
  }
  return cleanGeminiText(finalResult).trim();
}

function messagesToPrompt(messages: any[], tools?: any[]): string {
  const parts: string[] = [];
  if (tools && tools.length > 0) {
    const toolDefs = tools.map((tool) => {
      const fn = tool.type === "function" ? tool.function : tool;
      return {
        name: fn.name || tool.name || "",
        description: fn.description || tool.description || "",
        parameters: fn.parameters || tool.parameters || {}
      };
    });
    parts.push(
      "[System instruction]: You have access to tools. To call a tool, respond with:\n" +
      "```tool_call\n" +
      '{"name": "func_name", "arguments": {...}}\n' +
      "```\n" +
      "Only use tool_call blocks when needed.\n\n" +
      `Available tools:\n${JSON.stringify(toolDefs, null, 2)}`
    );
  }
  for (const msg of messages) {
    const role = msg.role || "user";
    let content = msg.content || "";
    if (Array.isArray(content)) {
      content = content
        .filter((c: any) => c.type === "text" || c.type === "input_text")
        .map((c: any) => c.text || "")
        .join(" ");
    }
    if (role === "system") {
      parts.push(`[System instruction]: ${content}`);
    } else if (role === "assistant") {
      if (msg.tool_calls) {
        const tcStrs = msg.tool_calls.map((tc: any) => {
          const fn = tc.function || {};
          return `\`\`\`tool_call\n${JSON.stringify({ name: fn.name, arguments: fn.arguments })}\n\`\`\``;
        });
        parts.push(`[Assistant]: ${content || ""}\n` + tcStrs.join("\n"));
      } else {
        parts.push(`[Assistant]: ${content}`);
      }
    } else if (role === "tool") {
      parts.push(`[Tool result for ${msg.name || ""}]: ${content}`);
    } else {
      parts.push(content ? String(content) : "");
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

function parseToolCalls(text: string): { cleanText: string; toolCalls: any[] | null } {
  const toolCalls: any[] = [];
  const regex = /```tool_call\s*\n([\s\S]*?)\n```/g;
  for (const match of text.matchAll(regex)) {
    try {
      const data = JSON.parse(match[1].trim());
      toolCalls.push({
        id: `call_${Math.random().toString(36).substring(2, 10)}`,
        type: "function",
        function: { name: data.name, arguments: JSON.stringify(data.arguments || {}) }
      });
    } catch {}
  }
  const cleanText = text.replace(regex, "").trim();
  return { cleanText, toolCalls: toolCalls.length > 0 ? toolCalls : null };
}

const chatCompletionSchema = z.object({
  model: z.string().optional().default("gemini-3.5-flash"),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.union([z.string(), z.array(z.any())]).optional().default(""),
      name: z.string().optional(),
      tool_calls: z.array(z.any()).optional()
    })
  ).min(1, "messages list must contain at least 1 message"),
  stream: z.boolean().optional().default(false),
  tools: z.array(z.any()).optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional()
});

const responsesApiSchema = z.object({
  model: z.string().optional().default("gemini-3.5-flash"),
  input: z.union([z.string(), z.array(z.any())]).optional().default(""),
  instructions: z.string().optional(),
  tools: z.array(z.any()).optional(),
  stream: z.boolean().optional().default(false)
});

class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF-OPEN" = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;
  private successThreshold = 2; // successes needed in HALF-OPEN to close
  private failureThreshold = 5; // failures in CLOSED to open
  private cooldownMs = 30000; // time in OPEN before HALF-OPEN
  private consecutiveSuccesses = 0;

  public async execute<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = "HALF-OPEN";
        this.consecutiveSuccesses = 0;
        logger.info("Circuit breaker entered HALF-OPEN state");
      } else {
        throw new Error("Circuit breaker is OPEN. Upstream service is temporarily unavailable.");
      }
    }

    try {
      const result = await action();
      if (this.state === "HALF-OPEN") {
        this.consecutiveSuccesses++;
        if (this.consecutiveSuccesses >= this.successThreshold) {
          this.state = "CLOSED";
          this.failures = 0;
          logger.info("Circuit breaker entered CLOSED state");
        }
      }
      return result;
    } catch (err: any) {
      const msg = err.message || "";
      const isClientError = msg.includes("returned 400") || msg.includes("returned 401") || msg.includes("returned 403") || msg.includes("returned 404");
      
      if (!isClientError) {
        this.failures++;
        this.lastFailureTime = Date.now();
        logger.warn({ failures: this.failures, state: this.state }, "Upstream call failed, incrementing circuit breaker failure count");
        if (this.state === "CLOSED" && this.failures >= this.failureThreshold) {
          this.state = "OPEN";
          logger.error("Circuit breaker tripped to OPEN state");
        } else if (this.state === "HALF-OPEN") {
          this.state = "OPEN";
          logger.error("Circuit breaker tripped back to OPEN state from HALF-OPEN");
        }
      }
      throw err;
    }
  }
}

const geminiCircuitBreaker = new CircuitBreaker();

function normalizeError(err: any): { status: number; body: any } {
  const msg = err instanceof Error ? err.message : String(err);
  
  if (msg.includes("Circuit breaker is OPEN")) {
    return {
      status: 503,
      body: {
        error: {
          message: msg,
          type: "service_unavailable",
          param: null,
          code: "circuit_breaker_open"
        }
      }
    };
  }

  if (msg.includes("Upstream returned 401") || msg.includes("unauthorized") || msg.includes("SAPISID")) {
    return {
      status: 401,
      body: {
        error: {
          message: "Upstream authentication failed. Please check your Gemini cookies.",
          type: "authentication_error",
          param: null,
          code: "invalid_cookie"
        }
      }
    };
  }

  if (msg.includes("Upstream returned 400")) {
    return {
      status: 400,
      body: {
        error: {
          message: "Bad request to Gemini. Possible causes: invalid payload format, invalid cookie, or Google Gemini internal changes.",
          type: "invalid_request_error",
          param: null,
          code: "bad_request"
        }
      }
    };
  }

  if (msg.includes("Upstream returned 403")) {
    return {
      status: 403,
      body: {
        error: {
          message: "Access forbidden. Your Gemini cookie is invalid, expired, or blocked.",
          type: "authentication_error",
          param: null,
          code: "forbidden"
        }
      }
    };
  }

  if (msg.includes("Upstream returned 429") || msg.includes("Too Many Requests")) {
    return {
      status: 429,
      body: {
        error: {
          message: "Upstream rate limit exceeded. Please try again later.",
          type: "rate_limit_error",
          param: null,
          code: "upstream_rate_limit"
        }
      }
    };
  }

  if (msg.includes("Upstream returned 500") || msg.includes("Upstream returned 502") || msg.includes("Upstream returned 503")) {
    return {
      status: 502,
      body: {
        error: {
          message: "Google Gemini server error or service is temporarily unavailable.",
          type: "api_error",
          param: null,
          code: "upstream_server_error"
        }
      }
    };
  }

  return {
    status: 502,
    body: {
      error: {
        message: msg,
        type: "api_error",
        param: null,
        code: "bad_gateway"
      }
    }
  };
}

const memoryRateLimits = new Map<string, { window: number; count: number }>();

function checkInMemoryRateLimit(key: string, limitRpm: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = Math.floor(now / 60);
  
  const current = memoryRateLimits.get(key);
  if (!current || current.window !== minuteWindow) {
    memoryRateLimits.set(key, { window: minuteWindow, count: 1 });
    if (memoryRateLimits.size > 10000) {
      for (const [k, v] of memoryRateLimits.entries()) {
        if (v.window !== minuteWindow) memoryRateLimits.delete(k);
      }
    }
    return true;
  }
  
  current.count += 1;
  return current.count <= limitRpm;
}

async function checkRateLimit(key: string, limitRpm: number): Promise<boolean> {
  if (!limitRpm || limitRpm <= 0) return true;
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = Math.floor(now / 60);
  const redisKey = `rate:${key}:${minuteWindow}`;

  if (redis) {
    try {
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, 60);
      }
      return count <= limitRpm;
    } catch (e) {
      logger.error({ err: e }, "Redis rate limiter error, falling back to memory rate limiter");
      return checkInMemoryRateLimit(key, limitRpm);
    }
  } else {
    return checkInMemoryRateLimit(key, limitRpm);
  }
}

async function verifyApiKey(request: any, model: string): Promise<{
  valid: boolean;
  projectId?: string;
  apiKeyId?: string;
  customCookie?: string;
  error?: string;
  statusCode?: number;
}> {
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

  // Rate Limiting helper variables
  let rateLimitKey = "";
  let rateLimitRpm = 0;

  // We check if key is a cookie first because it can be passed regardless of DB / Config
  const isCookieStr = key.includes("SID=") || key.includes("__Secure-1PSID") || (key.includes(";") && key.includes("="));
  
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

    // Set rate limit key for this cookie using its sha256 hash
    rateLimitKey = `cookie:${crypto.createHash("sha256").update(cookieStr).digest("hex")}`;
    rateLimitRpm = parseInt(process.env.DEFAULT_RATE_LIMIT_RPM || "15", 10);

    // Rate Limit Check
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

  // 1. Check config.json api_keys
  const configApiKeys = config.api_keys;
  if (configApiKeys && Array.isArray(configApiKeys)) {
    // If api_keys array is defined and empty, authentication is disabled (any request is valid)
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

    // Check if key matches config api_keys
    if (configApiKeys.includes(key)) {
      rateLimitKey = `static:${key}`;
      rateLimitRpm = parseInt(process.env.DEFAULT_RATE_LIMIT_RPM || "15", 10);

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

  // 2. Fallback to normal validation
  if (!key) {
    return { valid: false, error: "Missing API key / Authorization header", statusCode: 401 };
  }

  // Pre-check for admin bypass keys (both custom env key and default sk-personal-gw)
  const adminKey = process.env.ADMIN_API_KEY || "sk-personal-gw";
  if (key === adminKey || key === "sk-personal-gw") {
    rateLimitKey = `static:${key}`;
    rateLimitRpm = parseInt(process.env.DEFAULT_RATE_LIMIT_RPM || "15", 10);

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

  // Database lookup
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, project_id, active, allowed_models, daily_requests_limit, daily_tokens_limit, rate_limit_rpm, expires_at")
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

  // 1. Rate Limiting Check
  if (data.rate_limit_rpm && data.rate_limit_rpm > 0) {
    const isRateOk = await checkRateLimit(data.id, data.rate_limit_rpm);
    if (!isRateOk) {
      return { valid: false, error: "Rate limit exceeded. Please slow down.", statusCode: 429 };
    }
  }

  // 2. Daily Limits Check
  if ((data.daily_requests_limit && data.daily_requests_limit > 0) || (data.daily_tokens_limit && data.daily_tokens_limit > 0)) {
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
      const tokensToday = usageData ? usageData.reduce((sum, row) => sum + (row.total_tokens || 0), 0) : 0;

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

async function logUsage(
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

function buildGeminiRequest(
  prompt: string,
  modelId: number,
  thinkMode: number,
  customCookie?: string
): { url: string; headers: Record<string, string>; body: string } {
  const inner = new Array(80).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ["en"];
  inner[2] = ["", "", "", null, null, null, null, null, null, ""];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[thinkMode]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [2];
  inner[53] = 0;
  inner[59] = uuidv4();
  inner[61] = [];
  inner[68] = 1;
  inner[79] = modelId;

  const outer = [null, JSON.stringify(inner)];
  const bodyParams = new URLSearchParams();
  bodyParams.append("f.req", JSON.stringify(outer));

  const reqid = Math.floor(Date.now() / 1000) % 1000000;
  const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "";
  const url = `https://gemini.google.com${prefix}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${GEMINI_BL}&hl=en&_reqid=${reqid}&rt=c`;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://gemini.google.com",
    "Referer": `https://gemini.google.com${prefix}/app`,
    "X-Same-Domain": "1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  if (AUTH_USER) {
    headers["X-Goog-AuthUser"] = String(AUTH_USER);
  }

  let cookieStr = "";
  let sapisid: string | null = null;

  if (customCookie) {
    const trimmed = customCookie.trim();
    if (trimmed.startsWith("{")) {
      try {
        const data = JSON.parse(trimmed);
        cookieStr = data.cookie || "";
        sapisid = data.sapisid || cookieStr.match(/SAPISID=([^;]+)/)?.[1] || null;
      } catch {
        cookieStr = trimmed;
        sapisid = trimmed.match(/SAPISID=([^;]+)/)?.[1] || null;
      }
    } else {
      cookieStr = trimmed;
      sapisid = trimmed.match(/SAPISID=([^;]+)/)?.[1] || null;
    }
  } else {
    const loaded = loadCookie();
    cookieStr = loaded.cookieStr;
    sapisid = loaded.sapisid;
  }

  if (cookieStr) {
    headers["Cookie"] = cookieStr;
  }
  if (sapisid) {
    headers["Authorization"] = makeSapisidHash(sapisid);
  }

  return { url, headers, body: bodyParams.toString() };
}

async function geminiStreamGenerate(
  prompt: string,
  modelId: number,
  thinkMode: number,
  customCookie?: string
): Promise<string> {
  const { url, headers, body } = buildGeminiRequest(prompt, modelId, thinkMode, customCookie);

  let lastErr: any = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body
      });
      if (!response.ok) {
        throw new Error(`Upstream returned ${response.status}`);
      }
      return await response.text();
    } catch (e) {
      lastErr = e;
      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_SEC * 1000));
      }
    }
  }
  throw lastErr;
}

server.register(import("@fastify/cors"), {
  origin: "*"
});

server.get("/health", async (request, reply) => {
  const loaded = loadCookie();
  if (loaded.cookieStr) {
    const isValid = await isCookieValidCached(loaded.cookieStr, loaded.sapisid);
    if (!isValid) {
      return reply.status(200).send({
        status: "warning",
        message: "Gemini session cookie has expired or is invalid. Please refresh the cookie file."
      });
    }
  }
  return { status: "ok" };
});

server.get("/", async () => {
  return { status: "ok" };
});

server.get("/v1/models", async () => {
  return {
    object: "list",
    data: Object.entries(MODELS).map(([id, cfg]) => ({
      id,
      object: "model",
      created: 1700000000,
      owned_by: "google",
      description: cfg.desc
    }))
  };
});

server.post("/v1/chat/completions", async (request, reply) => {
  const parseResult = chatCompletionSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      error: {
        message: "Invalid request body: " + parseResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", "),
        type: "invalid_request_error",
        param: null,
        code: "invalid_body"
      }
    });
  }
  const req = parseResult.data;
  const modelName = req.model;
  const cfg = MODELS[modelName];
  if (!cfg) {
    return reply.status(400).send({
      error: {
        message: `Unknown model: ${modelName}`,
        type: "invalid_request_error",
        param: "model",
        code: "unknown_model"
      }
    });
  }

  const auth = await verifyApiKey(request, modelName);
  if (!auth.valid) {
    return reply.status(auth.statusCode || 401).send({
      error: {
        message: auth.error,
        type: "invalid_request_error",
        param: null,
        code: "invalid_api_key"
      }
    });
  }

  const prompt = messagesToPrompt(req.messages, req.tools);
  if (!prompt.trim()) {
    return reply.status(400).send({
      error: {
        message: "Empty prompt or messages",
        type: "invalid_request_error",
        param: "messages",
        code: "empty_prompt"
      }
    });
  }

  const stream = req.stream === true;
  const cid = `chatcmpl-${uuidv4().replace(/-/g, "").substring(0, 12)}`;
  const startTime = Date.now();
  const customCookie = auth.customCookie;

  if (stream) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    if (!req.tools) {
      let responseText = "";

      try {
        const { url, headers, body } = buildGeminiRequest(prompt, cfg.mode, cfg.think, customCookie);

        // Execute fetch call inside Circuit Breaker
        const response = await geminiCircuitBreaker.execute(async () => {
          const res = await fetch(url, {
            method: "POST",
            headers,
            body
          });
          if (!res.ok) {
            throw new Error(`Upstream returned ${res.status}`);
          }
          return res;
        });

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body stream");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let prevCleanedText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.includes('"wrb.fr"') || line.length < 200) continue;
            try {
              const innerStr = JSON.parse(line)[0][2];
              if (!innerStr || innerStr.length < 50) continue;
              const inner2 = JSON.parse(innerStr);
              if (Array.isArray(inner2) && inner2[4]) {
                let fullText = "";
                for (const part of inner2[4]) {
                  if (Array.isArray(part) && part[1] && Array.isArray(part[1])) {
                    fullText += part[1].filter((t: any) => typeof t === "string").join("");
                  }
                }
                const cleanedText = cleanGeminiText(fullText);
                if (cleanedText.length > prevCleanedText.length) {
                  const delta = cleanedText.substring(prevCleanedText.length);
                  responseText += delta;
                  const chunk = {
                    id: cid,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: modelName,
                    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                  };
                  reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
                  prevCleanedText = cleanedText;
                }
              }
            } catch {}
          }
        }

        const finalChunk = {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        };
        reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();

        const durationMs = Date.now() - startTime;
        await logUsage(
          auth.projectId!,
          auth.apiKeyId!,
          modelName,
          Math.floor(prompt.length / 4),
          Math.floor(responseText.length / 4),
          durationMs,
          200
        );
      } catch (e) {
        logger.error({ err: e }, "Streaming error");
        const normalized = normalizeError(e);
        const errChunk = {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: { content: `[Gateway Error: ${normalized.body.error.message}]` }, finish_reason: "stop" }]
        };
        reply.raw.write(`data: ${JSON.stringify(errChunk)}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();

        const durationMs = Date.now() - startTime;
        await logUsage(
          auth.projectId!,
          auth.apiKeyId!,
          modelName,
          Math.floor(prompt.length / 4),
          0,
          durationMs,
          normalized.status
        );
      }
      return reply;
    } else {
      try {
        // Execute stream generate inside Circuit Breaker
        const raw = await geminiCircuitBreaker.execute(() => geminiStreamGenerate(prompt, cfg.mode, cfg.think, customCookie));
        const text = extractResponseText(raw);
        const { cleanText, toolCalls } = parseToolCalls(text);

        if (cleanText) {
          const chunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: { content: cleanText }, finish_reason: null }]
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (toolCalls) {
          const chunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{
              index: 0,
              delta: {
                tool_calls: toolCalls.map((tc, idx) => ({
                  index: idx,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }))
              },
              finish_reason: null
            }]
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        const finish = toolCalls ? "tool_calls" : "stop";
        const finalChunk = {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: {}, finish_reason: finish }]
        };
        reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();

        const durationMs = Date.now() - startTime;
        await logUsage(
          auth.projectId!,
          auth.apiKeyId!,
          modelName,
          Math.floor(prompt.length / 4),
          Math.floor((cleanText || "").length / 4),
          durationMs,
          200
        );
      } catch (e) {
        logger.error({ err: e }, "Streaming error with tools");
        const normalized = normalizeError(e);
        const errChunk = {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: { content: `[Gateway Error: ${normalized.body.error.message}]` }, finish_reason: "stop" }]
        };
        reply.raw.write(`data: ${JSON.stringify(errChunk)}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();

        const durationMs = Date.now() - startTime;
        await logUsage(
          auth.projectId!,
          auth.apiKeyId!,
          modelName,
          Math.floor(prompt.length / 4),
          0,
          durationMs,
          normalized.status
        );
      }
      return reply;
    }
  }

  try {
    const raw = await geminiCircuitBreaker.execute(() => geminiStreamGenerate(prompt, cfg.mode, cfg.think, customCookie));
    const text = extractResponseText(raw);
    const { cleanText, toolCalls } = parseToolCalls(text);

    const msg: any = { role: "assistant", content: cleanText || null };
    if (toolCalls) {
      msg.tool_calls = toolCalls;
    }
    const finish = toolCalls ? "tool_calls" : "stop";

    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId!,
      auth.apiKeyId!,
      modelName,
      Math.floor(prompt.length / 4),
      Math.floor((cleanText || "").length / 4),
      durationMs,
      200
    );

    return {
      id: cid,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{ index: 0, message: msg, finish_reason: finish }],
      usage: {
        prompt_tokens: Math.floor(prompt.length / 4),
        completion_tokens: Math.floor((cleanText || "").length / 4),
        total_tokens: Math.floor((prompt.length + (cleanText || "").length) / 4)
      }
    };
  } catch (e) {
    const durationMs = Date.now() - startTime;
    const normalized = normalizeError(e);
    await logUsage(
      auth.projectId!,
      auth.apiKeyId!,
      modelName,
      Math.floor(prompt.length / 4),
      0,
      durationMs,
      normalized.status
    );
    return reply.status(normalized.status).send(normalized.body);
  }
});

server.post("/v1/responses", async (request, reply) => {
  const parseResult = responsesApiSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      error: {
        message: "Invalid request body: " + parseResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", "),
        type: "invalid_request_error",
        param: null,
        code: "invalid_body"
      }
    });
  }
  const req = parseResult.data;
  const modelName = req.model;
  const cfg = MODELS[modelName];
  if (!cfg) {
    return reply.status(400).send({
      error: {
        message: `Unknown model: ${modelName}`,
        type: "invalid_request_error",
        param: "model",
        code: "unknown_model"
      }
    });
  }

  const auth = await verifyApiKey(request, modelName);
  if (!auth.valid) {
    return reply.status(auth.statusCode || 401).send({
      error: {
        message: auth.error,
        type: "invalid_request_error",
        param: null,
        code: "invalid_api_key"
      }
    });
  }

  const inputItems = req.input || [];
  const tools = req.tools;
  const messages: any[] = [];

  if (req.instructions) {
    messages.push({ role: "system", content: req.instructions });
  }

  if (typeof inputItems === "string") {
    messages.push({ role: "user", content: inputItems });
  } else if (Array.isArray(inputItems)) {
    for (const item of inputItems) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
      } else if (typeof item === "object" && item !== null) {
        if (item.type === "function_call_output") {
          messages.push({ role: "tool", tool_call_id: item.call_id || "", name: item.name || "", content: item.output || "" });
        } else if (item.role === "assistant" || (item.type === "message" && item.role === "assistant")) {
          const cp = item.content || [];
          let textAcc = "";
          const tcList: any[] = [];
          if (Array.isArray(cp)) {
            for (const c of cp) {
              if (typeof c === "object" && c !== null) {
                if (c.type === "output_text") textAcc += c.text || "";
                else if (c.type === "function_call") tcList.push(c);
              }
            }
          } else if (typeof cp === "string") {
            textAcc = cp;
          }
          const m: any = { role: "assistant", content: textAcc || null };
          if (tcList.length > 0) {
            m.tool_calls = tcList.map((tc, idx) => ({
              id: tc.call_id || `call_${idx}`,
              type: "function",
              function: { name: tc.name || "", arguments: tc.arguments || "{}" }
            }));
          }
          messages.push(m);
        } else {
          const role = item.role || "user";
          let content = item.content || "";
          if (Array.isArray(content)) {
            content = content
              .filter((c: any) => c.type === "text" || c.type === "input_text")
              .map((c: any) => c.text || "")
              .join(" ");
          }
          messages.push({ role, content });
        }
      }
    }
  }

  const prompt = messagesToPrompt(messages, tools);
  if (!prompt.trim()) {
    return reply.status(400).send({
      error: {
        message: "Empty input or instructions",
        type: "invalid_request_error",
        param: "input",
        code: "empty_input"
      }
    });
  }

  const startTime = Date.now();
  const customCookie = auth.customCookie;

  try {
    const raw = await geminiCircuitBreaker.execute(() => geminiStreamGenerate(prompt, cfg.mode, cfg.think, customCookie));
    const text = extractResponseText(raw);
    const { cleanText, toolCalls } = parseToolCalls(text);

    const rid = `resp_${crypto.randomBytes(8).toString("hex")}`;
    const mid = `msg_${crypto.randomBytes(6).toString("hex")}`;
    const output: any[] = [];

    if (toolCalls) {
      for (const tc of toolCalls) {
        output.push({
          type: "function_call",
          id: tc.id,
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: "completed"
        });
      }
    }

    if (cleanText || !toolCalls) {
      output.push({
        type: "message",
        id: mid,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: cleanText || "", annotations: [] }]
      });
    }

    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId!,
      auth.apiKeyId!,
      modelName,
      Math.floor(prompt.length / 4),
      Math.floor((cleanText || "").length / 4),
      durationMs,
      200
    );

    return {
      id: rid,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: modelName,
      output,
      usage: {
        input_tokens: Math.floor(prompt.length / 4),
        output_tokens: Math.floor((cleanText || "").length / 4),
        total_tokens: Math.floor((prompt.length + (cleanText || "").length) / 4)
      }
    };
  } catch (e) {
    const durationMs = Date.now() - startTime;
    const normalized = normalizeError(e);
    await logUsage(
      auth.projectId!,
      auth.apiKeyId!,
      modelName,
      Math.floor(prompt.length / 4),
      0,
      durationMs,
      normalized.status
    );
    return reply.status(normalized.status).send(normalized.body);
  }
});

async function main() {
  try {
    await server.listen({ port: PORT, host: HOST });
    logger.info(`Gateway listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
