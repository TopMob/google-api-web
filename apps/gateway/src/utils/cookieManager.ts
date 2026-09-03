import fs from "fs";
import path from "path";
import { loadCookie, testGeminiConnection, parseAndValidateCookie } from "./cookie.js";
import { logger } from "../logger.js";

/**
 * All cookies needed for Gemini API access.
 */
export const REQUIRED_COOKIES = [
  { name: "__Secure-1PSID", required: true, desc: "Primary session token — essential for authentication" },
  { name: "__Secure-1PSIDTS", required: true, desc: "Session timestamp — needed for auth validation" },
  { name: "__Secure-1PSIDCC", required: true, desc: "Cookie consent control — checked by server" },
  { name: "SAPISID", required: true, desc: "Used to generate SAPISIDHASH authorization header" },
  { name: "__Secure-3PSID", required: false, desc: "Alternative SID for third-party context" },
  { name: "__Secure-3PSIDTS", required: false, desc: "Third-party session timestamp" },
  { name: "__Secure-3PSIDCC", required: false, desc: "Third-party cookie consent" },
  { name: "SID", required: false, desc: "Legacy session ID (fallback)" },
  { name: "HSID", required: false, desc: "HTTP-only session ID" },
  { name: "SSID", required: false, desc: "Secure session ID" },
  { name: "APISID", required: false, desc: "API session (HTTP-only analog of SAPISID)" },
  { name: "__Secure-1PAPISID", required: false, desc: "Secure API session ID" },
  { name: "NID", required: false, desc: "Preferences — may affect language/region" },
  { name: "1P_JAR", required: false, desc: "Google ad-related, sometimes checked" }
];

/**
 * Find the cookie file path (write target).
 */
function getCookieFilePath(): string {
  const candidates = [
    path.resolve(process.cwd(), "cookies/cookie.txt"),
    path.resolve(process.cwd(), "../cookies/cookie.txt"),
    path.resolve(process.cwd(), "../../cookies/cookie.txt")
  ];

  for (const p of candidates) {
    const dir = path.dirname(p);
    if (fs.existsSync(dir)) {
      return p;
    }
  }

  // Create the first option
  const target = candidates[0];
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

/**
 * Save cookie string to file and validate it.
 */
export async function saveCookieFile(
  cookieStr: string
): Promise<{ success: boolean; message: string; cookies?: Record<string, boolean> }> {
  // Parse and validate format
  const parsed = parseAndValidateCookie(cookieStr);
  if (!parsed.valid) {
    return { success: false, message: parsed.error || "Invalid cookie format" };
  }

  const { cookieStr: normalizedCookie, sapisid, cookiesObj } = parsed.data!;

  // Check which required cookies are present
  const cookiePresence: Record<string, boolean> = {};
  for (const c of REQUIRED_COOKIES) {
    cookiePresence[c.name] = !!cookiesObj[c.name];
  }

  // Test connection
  const isValid = await testGeminiConnection(normalizedCookie, sapisid);

  // Save to file regardless — user might fix issues later
  const filePath = getCookieFilePath();
  try {
    fs.writeFileSync(filePath, cookieStr, "utf-8");
    logger.info(`Cookie saved to ${filePath}`);
  } catch (e) {
    logger.error({ err: e }, "Failed to save cookie file");
    return { success: false, message: "Failed to write cookie file" };
  }

  if (isValid) {
    return {
      success: true,
      message: "Cookie saved and validated! Gemini connection confirmed.",
      cookies: cookiePresence
    };
  } else {
    return {
      success: false,
      message:
        "Cookie saved but validation failed. The cookie might be expired or missing required fields. Check the cookie status below.",
      cookies: cookiePresence
    };
  }
}

/**
 * Get the current cookie status.
 */
export async function getCookieStatus(): Promise<{
  hasFile: boolean;
  isValid: boolean | null;
  cookies: Record<string, boolean>;
  requiredCookies: typeof REQUIRED_COOKIES;
  bookmarklet: string;
}> {
  const loaded = loadCookie();
  const cookiePresence: Record<string, boolean> = {};

  if (loaded.cookieStr) {
    const parsed = parseAndValidateCookie(loaded.cookieStr);
    if (parsed.valid && parsed.data) {
      for (const c of REQUIRED_COOKIES) {
        cookiePresence[c.name] = !!parsed.data.cookiesObj[c.name];
      }
    }
  }

  let isValid: boolean | null = null;
  if (loaded.cookieStr) {
    isValid = await testGeminiConnection(loaded.cookieStr, loaded.sapisid);
  }

  // Generate bookmarklet for extracting cookies from browser
  const bookmarklet = generateBookmarklet();

  return {
    hasFile: !!loaded.cookieStr,
    isValid,
    cookies: cookiePresence,
    requiredCookies: REQUIRED_COOKIES,
    bookmarklet
  };
}

/**
 * Generate a JavaScript bookmarklet that extracts all needed cookies
 * when run on gemini.google.com.
 */
function generateBookmarklet(): string {
  const code = `javascript:void(function(){
    var all=document.cookie;
    var parts=all.split(";").map(function(s){return s.trim()});
    var found=parts.filter(function(p){return /^(SAPISID|APISID|__Secure-1PAPISID|NID|1P_JAR)/i.test(p)});
    var result=found.join("; ");
    alert("Notice: Google sets __Secure-1PSID and SID as HttpOnly, so they cannot be extracted via JavaScript.\\n\\nPlease export cookies using DevTools (F12 -> Application -> Cookies) or the Cookie-Editor extension.");
    if(result){navigator.clipboard.writeText(result);}
  })()`;
  return code.replace(/\n\s*/g, "");
}
