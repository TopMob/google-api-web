import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config, GEMINI_COOKIE, COOKIE_FILE } from "../config.js";
import { store } from "../db.js";
import { logger } from "../logger.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

let cachedCookie: {
  cookieStr: string;
  sapisid: string | null;
  timestamp: number;
  filePath?: string;
  mtimeMs?: number;
} | null = null;
const COOKIE_FILE_TTL_MS = 30 * 1000;

export interface SessionInfo {
  bl: string;
  sn: string;
  email: string | null;
  avatarUrl: string | null;
  timestamp: number;
}

export interface GoogleAccountInfo {
  index: string;
  email: string | null;
  avatarUrl: string | null;
}

let cachedSessionInfo: Map<string, SessionInfo> = new Map();
const SESSION_INFO_TTL_MS = 20 * 60 * 1000; // 20 minutes
const cachedAccounts: Map<string, { accounts: GoogleAccountInfo[]; timestamp: number }> = new Map();
const ACCOUNTS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function buildCookieResult(cookiesObj: Record<string, string>) {
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

function extractCookiesFromHar(data: any): Record<string, string> {
  const cookiesObj: Record<string, string> = {};
  const entries = data?.log?.entries;
  if (!Array.isArray(entries)) return cookiesObj;

  const collectFromEntry = (entry: any) => {
    const reqCookies = entry?.request?.cookies;
    if (Array.isArray(reqCookies)) {
      for (const c of reqCookies) {
        if (c?.name && c?.value) {
          cookiesObj[String(c.name)] = String(c.value);
        }
      }
    }

    const reqHeaders = entry?.request?.headers;
    if (Array.isArray(reqHeaders)) {
      for (const h of reqHeaders) {
        if (typeof h?.name === "string" && h.name.toLowerCase() === "cookie" && typeof h.value === "string") {
          for (const part of h.value.split(";")) {
            const eqIdx = part.indexOf("=");
            if (eqIdx > 0) {
              const name = part.slice(0, eqIdx).trim();
              const val = part.slice(eqIdx + 1).trim();
              if (name && val) cookiesObj[name] = val;
            }
          }
        }
      }
    }

    const resCookies = entry?.response?.cookies;
    if (Array.isArray(resCookies)) {
      for (const c of resCookies) {
        if (c?.name && c?.value && c.value !== "deleted") {
          cookiesObj[String(c.name)] = String(c.value);
        }
      }
    }

    const resHeaders = entry?.response?.headers;
    if (Array.isArray(resHeaders)) {
      for (const h of resHeaders) {
        if (typeof h?.name === "string" && h.name.toLowerCase() === "set-cookie" && typeof h.value === "string") {
          const firstPart = h.value.split(";")[0];
          const eqIdx = firstPart.indexOf("=");
          if (eqIdx > 0) {
            const name = firstPart.slice(0, eqIdx).trim();
            const val = firstPart.slice(eqIdx + 1).trim();
            if (name && val && val !== "deleted") {
              cookiesObj[name] = val;
            }
          }
        }
      }
    }
  };

  const getHost = (entry: any): string => {
    const url = entry?.request?.url;
    if (typeof url !== "string") return "";
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  };

  const googleEntries = entries.filter((e) => {
    const host = getHost(e);
    return host === "google.com" || host.endsWith(".google.com");
  });

  if (googleEntries.length > 0) {
    // Apply general *.google.com entries first, then gemini.google.com entries so Gemini session cookies win.
    for (const e of googleEntries) {
      if (getHost(e) !== "gemini.google.com") collectFromEntry(e);
    }
    for (const e of googleEntries) {
      if (getHost(e) === "gemini.google.com") collectFromEntry(e);
    }
  } else {
    for (const e of entries) {
      collectFromEntry(e);
    }
  }

  return cookiesObj;
}

export function parseRawCookieString(content: string): {
  cookieStr: string;
  sapisid: string | null;
  cookiesObj: Record<string, string>;
} {
  const cookiesObj: Record<string, string> = {};
  const trimmed = content.trim();

  // Try JSON format (HAR archives, JSON objects, and Cookie-Editor exported JSON arrays)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && typeof item === "object" && item.name && item.value) {
            cookiesObj[item.name] = item.value;
          }
        }
        if (Object.keys(cookiesObj).length > 0) {
          return buildCookieResult(cookiesObj);
        }
      } else if (typeof data === "object" && data !== null) {
        if (data.log && Array.isArray(data.log.entries)) {
          const harCookies = extractCookiesFromHar(data);
          if (Object.keys(harCookies).length > 0) {
            return buildCookieResult(harCookies);
          }
        }
        if (data.cookie) {
          return parseRawCookieString(data.cookie);
        }
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === "string") cookiesObj[k] = v;
        }
        if (Object.keys(cookiesObj).length > 0) {
          return buildCookieResult(cookiesObj);
        }
      }
    } catch {}
  }

  // If content contains semicolons (standard HTTP Cookie header format), split by semicolons
  if (trimmed.includes(";")) {
    const parts = trimmed.split(";");
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      const eqIdx = p.indexOf("=");
      if (eqIdx > 0) {
        const key = p
          .substring(0, eqIdx)
          .trim()
          .replace(/^.*[\r\n]+/, "");
        const val = p.substring(eqIdx + 1).trim();
        if (key && val) {
          cookiesObj[key] = val;
        }
      }
    }
  }

  // If still empty or no standard key/value pairs found, parse lines (Netscape format, "KEY VALUE", "KEY=VALUE")
  if (Object.keys(cookiesObj).length === 0) {
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines) {
      const l = line.trim();
      if (!l || l.startsWith("#")) continue;

      // Check for tab-separated formats
      if (l.includes("\t")) {
        const parts = l.split("\t");
        // 1. Netscape cookie format (tab-separated: domain, flag, path, secure, expiration, name, value)
        if (parts.length >= 7 && (parts[1] === "TRUE" || parts[1] === "FALSE")) {
          const name = parts[5]?.trim();
          const value = parts[6]?.trim();
          if (name && value) {
            cookiesObj[name] = value;
            continue;
          }
        }

        // 2. DevTools Table Copy format (Name, Value, Domain, Path, ...)
        if (parts.length >= 2) {
          const name = parts[0]?.trim();
          const value = parts[1]?.trim();
          if (name && value && /^[a-zA-Z0-9_.-]+$/.test(name) && !name.includes(".")) {
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
  }

  return buildCookieResult(cookiesObj);
}

export function loadCookie(): { cookieStr: string; sapisid: string | null } {
  if (GEMINI_COOKIE) {
    const parsed = parseRawCookieString(GEMINI_COOKIE);
    return { cookieStr: parsed.cookieStr, sapisid: parsed.sapisid };
  }

  const now = Date.now();
  const seen = new Set<string>();
  const candidates: Array<{ filePath: string; mtimeMs: number; priority: number }> = [];

  const addCandidate = (p: string, priority: number) => {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    try {
      if (!fs.existsSync(resolved)) return;
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        candidates.push({ filePath: resolved, mtimeMs: stat.mtimeMs, priority });
      }
    } catch {}
  };

  if (COOKIE_FILE) {
    addCandidate(path.resolve(process.cwd(), COOKIE_FILE), 1);
    addCandidate(path.resolve(process.cwd(), "apps/gateway", COOKIE_FILE), 1);
  }

  // Check all common cookie file names and any dropped .har/.txt/.json files in cookies/
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
      addCandidate(path.join(d, f), 0);
    }
    if (path.basename(d) === "cookies" && fs.existsSync(d)) {
      try {
        for (const entry of fs.readdirSync(d)) {
          if (entry === ".gitkeep" || (entry.startsWith(".") && entry !== ".cookie")) continue;
          if (/\.(har|txt|json)$/i.test(entry)) {
            addCandidate(path.join(d, entry), 0);
          }
        }
      } catch {}
    }
  }

  candidates.sort((a, b) => b.priority - a.priority || b.mtimeMs - a.mtimeMs);

  if (
    cachedCookie &&
    candidates.length > 0 &&
    cachedCookie.filePath === candidates[0].filePath &&
    cachedCookie.mtimeMs === candidates[0].mtimeMs &&
    now - cachedCookie.timestamp < COOKIE_FILE_TTL_MS
  ) {
    return { cookieStr: cachedCookie.cookieStr, sapisid: cachedCookie.sapisid };
  }

  for (const candidate of candidates) {
    try {
      const content = fs.readFileSync(candidate.filePath, "utf-8");
      const parsed = parseRawCookieString(content);
      if (parsed.cookieStr && (parsed.cookiesObj["__Secure-1PSID"] || parsed.cookiesObj["SID"])) {
        cachedCookie = {
          cookieStr: parsed.cookieStr,
          sapisid: parsed.sapisid,
          timestamp: now,
          filePath: candidate.filePath,
          mtimeMs: candidate.mtimeMs
        };
        return { cookieStr: parsed.cookieStr, sapisid: parsed.sapisid };
      }
    } catch (e) {
      logger.error({ err: e }, `Failed to read cookie file at ${candidate.filePath}`);
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
  const parsed = parseRawCookieString(key);
  const { cookieStr, sapisid, cookiesObj } = parsed;

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

export function invalidateGeminiSessionCache() {
  cachedSessionInfo.clear();
}

/**
 * Fetch dynamic session info (BL build identifier, SNlM0e auth token, email, avatar) from Gemini app page.
 */
export async function getGeminiSessionInfo(
  cookieStr: string,
  sapisid: string | null,
  authUser?: string
): Promise<{ bl: string; sn: string; email: string | null; avatarUrl: string | null }> {
  const effectiveAuthUser = authUser ?? store.getAuthUser();
  const cacheKey = `${crypto.createHash("sha256").update(cookieStr).digest("hex")}:${effectiveAuthUser}`;
  const cached = cachedSessionInfo.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < SESSION_INFO_TTL_MS) {
    return { bl: cached.bl, sn: cached.sn, email: cached.email, avatarUrl: cached.avatarUrl };
  }

  const fallbackBl = "boq_assistant-bard-web-server_20260827.05_p0";
  const prefix = effectiveAuthUser ? `/u/${effectiveAuthUser}` : "";
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Cookie: cookieStr
  };

  if (sapisid) {
    headers["Authorization"] = makeSapisidHash(sapisid);
  }

  try {
    const res = await fetchWithRetry(
      `https://gemini.google.com${prefix}/app`,
      { method: "GET", headers },
      { maxRetries: 2, timeoutMs: 12000 }
    );
    const html = await res.text();
    const blMatch = html.match(/"cfb2h":"([^"]+)"/);
    const snMatch = html.match(/"SNlM0e":"([^"]+)"/);
    const emailMatch = html.match(/"oPEP7c":"([^"]+)"/);
    const avatarMatch = html.match(/https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9_\/=-]+/);

    const bl = blMatch ? blMatch[1] : fallbackBl;
    const sn = snMatch ? snMatch[1] : "";
    const email = emailMatch ? emailMatch[1] : null;
    const avatarUrl = avatarMatch ? avatarMatch[0] : null;

    if (sn) {
      cachedSessionInfo.set(cacheKey, { bl, sn, email, avatarUrl, timestamp: now });
    }
    return { bl, sn, email, avatarUrl };
  } catch (e) {
    logger.error({ err: e }, "Failed to fetch Gemini session info");
    return { bl: fallbackBl, sn: "", email: null, avatarUrl: null };
  }
}

export async function discoverGoogleAccounts(
  cookieStr: string,
  sapisidOrForce: string | null | boolean = null,
  forceRefresh = false
): Promise<GoogleAccountInfo[]> {
  if (!cookieStr) return [];

  const force = typeof sapisidOrForce === "boolean" ? sapisidOrForce : forceRefresh;
  const sapisid =
    typeof sapisidOrForce === "boolean"
      ? parseRawCookieString(cookieStr).sapisid
      : (sapisidOrForce ?? parseRawCookieString(cookieStr).sapisid);

  const cookieHash = crypto.createHash("sha256").update(cookieStr).digest("hex");
  const now = Date.now();

  if (!force) {
    const cached = cachedAccounts.get(cookieHash);
    if (cached && now - cached.timestamp < ACCOUNTS_TTL_MS) {
      return cached.accounts;
    }
  } else {
    for (let i = 0; i < 6; i++) {
      cachedSessionInfo.delete(`${cookieHash}:${i}`);
    }
  }

  const accounts: GoogleAccountInfo[] = [];
  const maxAccounts = 6;

  for (let i = 0; i < maxAccounts; i++) {
    const idx = String(i);
    const info = await getGeminiSessionInfo(cookieStr, sapisid, idx);
    if (!info.sn || info.sn.length <= 5) {
      break;
    }
    accounts.push({
      index: idx,
      email: info.email,
      avatarUrl: info.avatarUrl
    });
  }

  cachedAccounts.set(cookieHash, { accounts, timestamp: now });
  return accounts;
}

export function clearCookieDiscoveryCache(): void {
  cachedCookie = null;
  cachedSessionInfo.clear();
  cachedAccounts.clear();
  cookieValidationCache.clear();
}

export async function testGeminiConnection(cookieStr: string, sapisid: string | null): Promise<boolean> {
  const sessionInfo = await getGeminiSessionInfo(cookieStr, sapisid);
  return !!(sessionInfo.sn && sessionInfo.sn.length > 5);
}

const cookieValidationCache = new Map<string, { isValid: boolean; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function isCookieValidCached(cookieStr: string, sapisid: string | null): Promise<boolean> {
  const cacheKey = `${crypto.createHash("sha256").update(cookieStr).digest("hex")}:${store.getAuthUser()}`;
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
