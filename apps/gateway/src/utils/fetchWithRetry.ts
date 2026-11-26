import { fetch as undiciFetch, Agent, ProxyAgent } from "undici";
import { logger } from "../logger.js";

// Google's gemini.google.com/app response headers (e.g. CSP) can exceed Node's 16 KB default limit.
const MAX_HTTP_HEADER_SIZE = 65536;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
const defaultDispatcher = proxyUrl
  ? new ProxyAgent({ uri: proxyUrl, maxHeaderSize: MAX_HTTP_HEADER_SIZE })
  : new Agent({ maxHeaderSize: MAX_HTTP_HEADER_SIZE });

if (proxyUrl) {
  logger.info(`Configured HTTP proxy dispatcher for Gemini upstream requests: ${proxyUrl}`);
}

interface FetchWithRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

const defaultGlobalFetch = globalThis.fetch;

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 5000,
    timeoutMs = 180000 // 180 seconds TTFB timeout so deep thinking models don't abort prematurely
  } = retryOptions;

  let lastErr: any = null;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
        fetchOpts.dispatcher = defaultDispatcher;
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
      lastErr = e;

      // Immediately propagate client-side abort without retrying
      if (options.signal?.aborted) {
        throw e;
      }

      // Do not retry 4xx errors (including 429 so clients handle backoff cleanly)
      const msg = e.message || "";
      if (/Upstream returned 4\d\d\b/.test(msg)) {
        throw e;
      }

      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
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
        logger.warn({ attempt, err: e.message }, "Fetch failed, retrying...");
      }
    }
  }

  throw lastErr;
}
