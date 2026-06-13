import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config, AUTH_USER, GEMINI_COOKIE, COOKIE_FILE } from "../config.js";
import { logger } from "../logger.js";

let cachedCookie: { cookieStr: string; sapisid: string | null; timestamp: number } | null = null;
const COOKIE_FILE_TTL_MS = 60 * 1000;

export function loadCookie(): { cookieStr: string; sapisid: string | null } {
  if (GEMINI_COOKIE) {
    const cookieStr = GEMINI_COOKIE.trim();
    const match = cookieStr.match(/SAPISID=([^;]+)/);
    return { cookieStr, sapisid: match ? match[1] : null };
  }

  const now = Date.now();
  if (cachedCookie && now - cachedCookie.timestamp < COOKIE_FILE_TTL_MS) {
    return { cookieStr: cachedCookie.cookieStr, sapisid: cachedCookie.sapisid };
  }

  const paths: string[] = [];
  if (COOKIE_FILE) {
    paths.push(path.resolve(process.cwd(), COOKIE_FILE), path.resolve(process.cwd(), "apps/gateway", COOKIE_FILE));
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

export function makeSapisidHash(sapisid: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h = crypto.createHash("sha1").update(`${ts} ${sapisid} https://gemini.google.com`).digest("hex");
  return `SAPISIDHASH ${ts}_${h}`;
}

export interface GeminiCookieData {
  cookieStr: string;
  sapisid: string | null;
  cookiesObj: Record<string, string>;
}

export function parseAndValidateCookie(key: string): { valid: boolean; data?: GeminiCookieData; error?: string } {
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

export async function testGeminiConnection(cookieStr: string, sapisid: string | null): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "/u/0";
    const url = `https://gemini.google.com${prefix}/app`;
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Cookie: cookieStr
    };
    if (sapisid) {
      headers["Authorization"] = makeSapisidHash(sapisid);
    }
    const res = await fetch(url, {
      method: "GET",
      headers,
      keepalive: true,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.status >= 400) {
      return false;
    }

    if (res.url.includes("accounts.google.com") || res.url.includes("ServiceLogin")) {
      return false;
    }

    const text = await res.text();
    return text.includes("SNlM0e");
  } catch (e) {
    clearTimeout(timeoutId);
    logger.error({ err: e }, "Failed to test Gemini connection");
    return false;
  }
}

const cookieValidationCache = new Map<string, { isValid: boolean; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function isCookieValidCached(cookieStr: string, sapisid: string | null): Promise<boolean> {
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
    cookieValidationCache.set(cacheKey, { isValid, timestamp: now - CACHE_TTL_MS + 10000 });
  }
  return isValid;
}
