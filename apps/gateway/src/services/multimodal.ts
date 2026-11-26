import dns from "dns/promises";
import net from "net";
import { logger } from "../logger.js";
import { loadCookie, makeSapisidHash, parseRawCookieString } from "../utils/cookie.js";
import { fetchWithRetry } from "../utils/fetchWithRetry.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB cap per image
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp"]);

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

interface PageTokens {
  pushId: string;
  pctx: string;
}

let cachedPageTokens: PageTokens | null = null;
let tokensTimestamp = 0;
const TOKENS_TTL_MS = 10 * 60 * 1000;

/**
 * Check whether an IPv4 or IPv6 literal falls into loopback, private, link-local, or unspecified ranges.
 */
export function isPrivateIpAddress(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "").toLowerCase();

  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("::ffff:")) {
      return isPrivateIpAddress(normalized.slice(7));
    }
    if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Validate a remote image URL against SSRF rules (allow only http/https public hosts).
 */
export async function validateRemoteImageUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ImageValidationError("Invalid image URL format");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImageValidationError(`Unsupported image URL protocol: ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new ImageValidationError("Local or internal image URLs are not allowed");
  }

  const unbracketed = host.replace(/^\[|\]$/g, "");
  if (net.isIP(unbracketed)) {
    if (isPrivateIpAddress(unbracketed)) {
      throw new ImageValidationError("Private or loopback IP image URLs are not allowed");
    }
    return parsed;
  }

  try {
    const resolved = await dns.lookup(host, { all: true });
    if (!resolved || resolved.length === 0) {
      throw new ImageValidationError("Could not resolve image hostname");
    }
    for (const entry of resolved) {
      if (isPrivateIpAddress(entry.address)) {
        throw new ImageValidationError("Image hostname resolves to a private or loopback IP");
      }
    }
  } catch (err) {
    if (err instanceof ImageValidationError) throw err;
    throw new ImageValidationError("Failed to validate image hostname");
  }

  return parsed;
}

/**
 * Fetch WIZ_global_data page tokens (Push-ID and X-Client-Pctx) from Gemini web page.
 */
async function getPageTokens(cookieStr?: string, sapisid?: string | null): Promise<PageTokens> {
  const now = Date.now();
  if (cachedPageTokens && now - tokensTimestamp < TOKENS_TTL_MS) {
    return cachedPageTokens;
  }

  const defaultTokens: PageTokens = {
    pushId: "feeds/mcudyrk2a4khkz",
    pctx: "CgcSBWjK7pYx"
  };

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };
    if (cookieStr) headers["Cookie"] = cookieStr;
    if (sapisid) headers["Authorization"] = makeSapisidHash(sapisid);

    const res = await fetchWithRetry(
      "https://gemini.google.com/app",
      { method: "GET", headers },
      { maxRetries: 1, timeoutMs: 8000 }
    );
    const html = await res.text();
    const pushMatch = html.match(/"qKIAYe":"([^"]+)"/);
    const pctxMatch = html.match(/"Ylro7b":"([^"]+)"/);

    const tokens: PageTokens = {
      pushId: pushMatch ? pushMatch[1] : defaultTokens.pushId,
      pctx: pctxMatch ? pctxMatch[1] : defaultTokens.pctx
    };

    cachedPageTokens = tokens;
    tokensTimestamp = now;
    return tokens;
  } catch (err) {
    logger.debug({ err }, "Failed to fetch page tokens from Gemini, using fallbacks");
  }

  return defaultTokens;
}

/**
 * Infer common image MIME type from image bytes header.
 */
export function detectImageMime(buffer: Buffer, fallback = "image/png"): string {
  if (!buffer || buffer.length < 4) return fallback;

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }

  return fallback;
}

export interface ImageInput {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

function getPartImageUrl(part: any): string | null {
  if (!part || typeof part !== "object") return null;
  if (part.type === "image_url") {
    if (typeof part.image_url === "string") return part.image_url;
    if (typeof part.image_url?.url === "string") return part.image_url.url;
  }
  if (part.type === "input_image") {
    if (typeof part.image_url === "string") return part.image_url;
    if (typeof part.image_url?.url === "string") return part.image_url.url;
  }
  return null;
}

/**
 * Extract and validate images from OpenAI Chat/Responses messages array.
 */
export async function extractImagesFromMessages(messages: any[]): Promise<ImageInput[]> {
  const images: ImageInput[] = [];

  for (const msg of messages) {
    if (!msg || !Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      const rawUrl = getPartImageUrl(part);
      if (!rawUrl) continue;

      if (rawUrl.startsWith("data:")) {
        const match = rawUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (!match) {
          throw new ImageValidationError("Malformed data URI for image input");
        }

        const declaredMime = match[1].toLowerCase().trim();
        if (!ALLOWED_IMAGE_MIMES.has(declaredMime)) {
          throw new ImageValidationError(`Unsupported image MIME type: ${declaredMime}`);
        }

        const base64Data = match[2].replace(/\s+/g, "");
        const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
        if (estimatedBytes > MAX_IMAGE_BYTES) {
          throw new ImageValidationError("Image exceeds maximum allowed size of 10MB");
        }

        const buffer = Buffer.from(base64Data, "base64");
        if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
          throw new ImageValidationError("Image payload empty or exceeds 10MB limit");
        }

        const mimeType = detectImageMime(buffer, declaredMime === "image/jpg" ? "image/jpeg" : declaredMime);
        images.push({ buffer, mimeType, filename: "image.png" });
      } else {
        const validatedUrl = await validateRemoteImageUrl(rawUrl);
        const res = await fetchWithRetry(
          validatedUrl.toString(),
          {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0" },
            redirect: "error"
          },
          { maxRetries: 2, timeoutMs: 15000 }
        );

        const contentLen = Number(res.headers.get("content-length") || 0);
        if (contentLen > MAX_IMAGE_BYTES) {
          throw new ImageValidationError("Remote image exceeds maximum allowed size of 10MB");
        }

        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
          throw new ImageValidationError("Remote image empty or exceeds 10MB limit");
        }

        const buffer = Buffer.from(arrayBuffer);
        const headerMime = (res.headers.get("content-type") || "image/png").split(";")[0].toLowerCase().trim();
        const detectedMime = detectImageMime(buffer, headerMime);
        if (!ALLOWED_IMAGE_MIMES.has(detectedMime)) {
          throw new ImageValidationError(`Unsupported remote image type: ${detectedMime}`);
        }
        images.push({ buffer, mimeType: detectedMime, filename: "image.png" });
      }
    }
  }

  return images;
}

/**
 * Upload an image using Google Scotty Resumable Upload protocol.
 * Returns the file reference string (e.g. `/contrib_file/...`) to pass to Gemini Web.
 */
export async function uploadImageToGemini(image: ImageInput, customCookie?: string): Promise<string> {
  let cookieStr = "";
  let sapisid: string | null = null;

  if (customCookie) {
    const parsed = parseRawCookieString(customCookie);
    cookieStr = parsed.cookieStr;
    sapisid = parsed.sapisid;
  } else {
    const loaded = loadCookie();
    cookieStr = loaded.cookieStr;
    sapisid = loaded.sapisid;
  }

  const tokens = await getPageTokens(cookieStr, sapisid);

  const startHeaders: Record<string, string> = {
    "Push-ID": tokens.pushId,
    "X-Tenant-Id": "bard-storage",
    "X-Client-Pctx": tokens.pctx,
    "X-Goog-Upload-Header-Content-Length": image.buffer.length.toString(),
    "X-Goog-Upload-Header-Content-Type": image.mimeType,
    "X-Goog-Upload-Protocol": "resumable",
    "X-Goog-Upload-Command": "start",
    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  if (cookieStr) startHeaders["Cookie"] = cookieStr;
  if (sapisid) startHeaders["Authorization"] = makeSapisidHash(sapisid);

  const startRes = await fetchWithRetry(
    "https://content-push.googleapis.com/upload/",
    {
      method: "POST",
      headers: startHeaders,
      body: ""
    },
    { maxRetries: 2, timeoutMs: 20000 }
  );

  const uploadUrl = startRes.headers.get("X-Goog-Upload-URL") || startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error(`Failed to initiate Scotty upload. Missing upload URL (status ${startRes.status})`);
  }

  const uploadHeaders: Record<string, string> = {
    "X-Goog-Upload-Command": "upload, finalize",
    "X-Goog-Upload-Offset": "0",
    "Content-Type": "application/octet-stream",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  const uploadRes = await fetchWithRetry(
    uploadUrl,
    {
      method: "POST",
      headers: uploadHeaders,
      body: image.buffer as unknown as BodyInit
    },
    { maxRetries: 2, timeoutMs: 30000 }
  );

  const fileRef = (await uploadRes.text()).trim();
  if (!fileRef || !fileRef.startsWith("/")) {
    throw new Error(`Invalid file reference from upload: ${fileRef.slice(0, 100)}`);
  }

  logger.info({ fileRef: fileRef.slice(0, 40) }, "Successfully uploaded image to Gemini Web");
  return fileRef;
}

/**
 * Upload all extracted images and return array of file reference paths.
 */
export async function uploadAllImages(images: ImageInput[], customCookie?: string): Promise<string[]> {
  const refs: string[] = [];
  for (const img of images) {
    const ref = await uploadImageToGemini(img, customCookie);
    refs.push(ref);
  }
  return refs;
}
