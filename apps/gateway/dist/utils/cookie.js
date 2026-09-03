import crypto from "crypto";
import fs from "fs";
import path from "path";
import https from "https";
import { AUTH_USER, GEMINI_COOKIE, COOKIE_FILE } from "../config.js";
import { logger } from "../logger.js";
let cachedCookie = null;
const COOKIE_FILE_TTL_MS = 30 * 1000;
let cachedSessionInfo = new Map();
const SESSION_INFO_TTL_MS = 20 * 60 * 1000; // 20 minutes
export function parseRawCookieString(content) {
  const cookiesObj = {};
  const trimmed = content.trim();
  // Try JSON format
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      if (data.cookie) {
        return parseRawCookieString(data.cookie);
      }
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") cookiesObj[k] = v;
      }
    } catch {}
  }
  // Parse lines (handles "KEY VALUE", "KEY\tVALUE", "KEY=VALUE", Netscape format)
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    // Check for Netscape cookie format (tab-separated with 7 fields)
    if (l.includes("\t")) {
      const parts = l.split("\t");
      if (parts.length >= 7) {
        const name = parts[5].trim();
        const value = parts[6].trim();
        if (name && value) {
          cookiesObj[name] = value;
          continue;
        }
      }
    }
    // Check "KEY VALUE", "KEY=VALUE", "KEY: VALUE"
    const match = l.match(/^([a-zA-Z0-9_.-]+)[=\s:	]+(.+)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/;$/, "");
      if (key && val) {
        cookiesObj[key] = val;
      }
    }
  }
  // Fallback to semicolon format if no lines parsed
  if (Object.keys(cookiesObj).length === 0) {
    trimmed.split(";").forEach((part) => {
      const [name, ...valueParts] = part.trim().split("=");
      if (name && valueParts.length > 0) {
        cookiesObj[name] = valueParts.join("=");
      }
    });
  }
  const cookieStr = Object.entries(cookiesObj)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const sapisid =
    cookiesObj["SAPISID"] ||
    cookiesObj["__Secure-3PAPISID"] ||
    cookiesObj["__Secure-1PAPISID"] ||
    cookiesObj["APISID"] ||
    null;
  return { cookieStr, sapisid, cookiesObj };
}
export function loadCookie() {
  if (GEMINI_COOKIE) {
    const parsed = parseRawCookieString(GEMINI_COOKIE);
    return { cookieStr: parsed.cookieStr, sapisid: parsed.sapisid };
  }
  const now = Date.now();
  if (cachedCookie && now - cachedCookie.timestamp < COOKIE_FILE_TTL_MS) {
    return { cookieStr: cachedCookie.cookieStr, sapisid: cachedCookie.sapisid };
  }
  const paths = [];
  if (COOKIE_FILE) {
    paths.push(path.resolve(process.cwd(), COOKIE_FILE), path.resolve(process.cwd(), "apps/gateway", COOKIE_FILE));
  }
  // Check all common cookie file names in cookies/ and root
  const checkDirs = [
    process.cwd(),
    path.resolve(process.cwd(), "cookies"),
    path.resolve(process.cwd(), "../cookies"),
    path.resolve(process.cwd(), "../../cookies"),
    path.resolve(process.cwd(), "apps/gateway/cookies")
  ];
  const fileNames = ["кука", "cookie.txt", "cookies.txt", "cookie", "cookies", "gemini_cookie.txt", ".cookie"];
  for (const d of checkDirs) {
    for (const f of fileNames) {
      paths.push(path.join(d, f));
    }
  }
  for (const p of paths) {
    if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) {
      try {
        const content = fs.readFileSync(p, "utf-8");
        const parsed = parseRawCookieString(content);
        if (parsed.cookieStr && (parsed.cookiesObj["__Secure-1PSID"] || parsed.cookiesObj["SID"])) {
          cachedCookie = { cookieStr: parsed.cookieStr, sapisid: parsed.sapisid, timestamp: now };
          return { cookieStr: parsed.cookieStr, sapisid: parsed.sapisid };
        }
      } catch (e) {
        logger.error({ err: e }, `Failed to read cookie file at ${p}`);
      }
    }
  }
  return { cookieStr: "", sapisid: null };
}
export function makeSapisidHash(sapisid) {
  const ts = Math.floor(Date.now() / 1000);
  const h = crypto.createHash("sha1").update(`${ts} ${sapisid} https://gemini.google.com`).digest("hex");
  return `SAPISIDHASH ${ts}_${h}`;
}
export function parseAndValidateCookie(key) {
  const parsed = parseRawCookieString(key);
  const { cookieStr, sapisid, cookiesObj } = parsed;
  const hasSecureCookie = !!cookiesObj["__Secure-1PSID"];
  const hasClassicCookies = !!(cookiesObj.SID && sapisid);
  if (!hasSecureCookie && !hasClassicCookies && Object.keys(cookiesObj).length === 0) {
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
/**
 * Fetch dynamic session info (BL build identifier and SNlM0e auth token) from Gemini app page.
 */
export async function getGeminiSessionInfo(cookieStr, sapisid) {
  const cacheKey = crypto.createHash("sha256").update(cookieStr).digest("hex");
  const cached = cachedSessionInfo.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < SESSION_INFO_TTL_MS) {
    return { bl: cached.bl, sn: cached.sn };
  }
  return new Promise((resolve) => {
    const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "";
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Cookie: cookieStr,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    };
    if (sapisid) {
      headers["Authorization"] = makeSapisidHash(sapisid);
    }
    const req = https.request(
      {
        hostname: "gemini.google.com",
        port: 443,
        path: `${prefix}/app`,
        method: "GET",
        headers,
        maxHeaderSize: 65536
      },
      (res) => {
        let html = "";
        res.on("data", (chunk) => (html += chunk));
        res.on("end", () => {
          const blMatch = html.match(/"cfb2h":"([^"]+)"/);
          const snMatch = html.match(/"SNlM0e":"([^"]+)"/);
          const bl = blMatch ? blMatch[1] : "boq_assistant-bard-web-server_20260827.05_p0";
          const sn = snMatch ? snMatch[1] : "";
          cachedSessionInfo.set(cacheKey, { bl, sn, timestamp: now });
          resolve({ bl, sn });
        });
      }
    );
    req.on("error", (e) => {
      logger.error({ err: e }, "Failed to fetch Gemini session info");
      resolve({ bl: "boq_assistant-bard-web-server_20260827.05_p0", sn: "" });
    });
    req.end();
  });
}
export async function testGeminiConnection(cookieStr, sapisid) {
  const sessionInfo = await getGeminiSessionInfo(cookieStr, sapisid);
  return !!(sessionInfo.sn && sessionInfo.sn.length > 5);
}
const cookieValidationCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
export async function isCookieValidCached(cookieStr, sapisid) {
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
