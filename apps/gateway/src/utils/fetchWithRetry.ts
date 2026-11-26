import { execSync } from "child_process";
import { fetch as undiciFetch, Agent, ProxyAgent, Dispatcher } from "undici";
import { logger } from "../logger.js";

const MAX_HTTP_HEADER_SIZE = 65536;

function detectWindowsSystemProxy(): string | undefined {
  if (process.platform !== "win32" || process.env.VITEST) return undefined;
  try {
    const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"', {
      encoding: "utf-8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const enableMatch = out.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i);
    if (!enableMatch || parseInt(enableMatch[1], 16) !== 1) return undefined;
    const serverMatch = out.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
    if (!serverMatch) return undefined;
    let raw = serverMatch[1].trim();
    if (raw.includes("=")) {
      const httpsPart = raw.split(";").find((p) => p.toLowerCase().startsWith("https="));
      const httpPart = raw.split(";").find((p) => p.toLowerCase().startsWith("http="));
      const chosen = httpsPart || httpPart;
      if (!chosen) return undefined;
      raw = chosen.split("=")[1]?.trim() || "";
    }
    if (!raw) return undefined;
    return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  } catch {
    return undefined;
  }
}

const envProxyUrl =
  process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
const windowsProxyUrl = envProxyUrl ? undefined : detectWindowsSystemProxy();
const proxyUrl = envProxyUrl || windowsProxyUrl;
const isAutoDetectedProxy = Boolean(!envProxyUrl && windowsProxyUrl);

const directDispatcher = new Agent({ maxHeaderSize: MAX_HTTP_HEADER_SIZE, connect: { timeout: 5000 } });
const proxyDispatcher = proxyUrl
  ? new ProxyAgent({ uri: proxyUrl, maxHeaderSize: MAX_HTTP_HEADER_SIZE, connect: { timeout: 5000 } })
  : null;

let activeDispatcher: Dispatcher = proxyDispatcher || directDispatcher;

if (proxyUrl) {
  logger.info(
    `Configured HTTP proxy dispatcher (${isAutoDetectedProxy ? "Windows system proxy" : "env"}) for Gemini upstream requests: ${proxyUrl}`
  );
}

interface FetchWithRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

const defaultGlobalFetch = globalThis.fetch;

function formatFetchError(err: any, timedOut: boolean, timeoutMs: number): Error {
  if (timedOut) {
    return new Error(`Upstream request timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
  if (err instanceof Error && err.cause && typeof err.cause === "object") {
    const cause = err.cause as { code?: string; message?: string };
    const details = [cause.code, cause.message].filter(Boolean).join(": ");
    if (details && !err.message.includes(details)) {
      return new Error(`${err.message} (${details})`);
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: FetchWithRetryOptions = {}
): Promise<Response> {
  const { maxRetries = 3, initialDelayMs = 500, maxDelayMs = 5000, timeoutMs = 60000 } = retryOptions;

  let lastErr: any = null;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onAbort = () => {
      controller.abort();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeoutId);
        throw options.signal.reason || new Error("Aborted");
      }
      options.signal.addEventListener("abort", onAbort);
    }

    try {
      const isMocked = globalThis.fetch && globalThis.fetch !== defaultGlobalFetch;
      const fetchOpts: any = {
        ...options,
        signal: controller.signal
      };
      if (!isMocked) {
        fetchOpts.dispatcher = activeDispatcher;
      }

      const fetchFn: typeof fetch = !isMocked ? (undiciFetch as unknown as typeof fetch) : globalThis.fetch;
      const response = await fetchFn(url, fetchOpts);

      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }

      if (!response.ok) {
        let bodySnippet = "";
        try {
          const text = await response.text();
          if (text) {
            bodySnippet = text.replace(/\s+/g, " ").trim().slice(0, 240);
          }
        } catch {}
        const detail = bodySnippet ? ` - ${bodySnippet}` : "";
        const err = new Error(`Upstream returned ${response.status} ${response.statusText}${detail}`);
        throw err;
      }

      return response;
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }

      if (options.signal?.aborted) {
        throw e;
      }

      const formattedErr = formatFetchError(e, timedOut, timeoutMs);
      lastErr = formattedErr;

      if (
        isAutoDetectedProxy &&
        activeDispatcher !== directDispatcher &&
        /ECONNREFUSED|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|proxy/i.test(formattedErr.message)
      ) {
        logger.warn({ err: formattedErr.message }, "Local Windows proxy failed, falling back to direct connection");
        activeDispatcher = directDispatcher;
      }

      const msg = formattedErr.message || "";
      if (/Upstream returned 4\d\d\b/.test(msg)) {
        throw formattedErr;
      }

      if (attempt < maxRetries - 1) {
        const jitter = Math.random() * 200;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay + jitter);
          if (options.signal) {
            options.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve(null);
              },
              { once: true }
            );
          }
        });
        if (options.signal?.aborted) {
          throw options.signal.reason || new Error("Aborted");
        }
        delay = Math.min(delay * 2, maxDelayMs);
        logger.warn({ attempt, err: formattedErr.message }, "Fetch failed, retrying...");
      }
    }
  }

  throw lastErr;
}
