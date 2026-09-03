import { fetch as undiciFetch, ProxyAgent } from "undici";
import { logger } from "../logger.js";
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
if (proxyAgent) {
  logger.info(`Configured HTTP proxy dispatcher for Gemini upstream requests: ${proxyUrl}`);
}
const defaultGlobalFetch = globalThis.fetch;
export async function fetchWithRetry(url, options, retryOptions = {}) {
  const {
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 5000,
    timeoutMs = 60000 // Default 60 seconds timeout per request
  } = retryOptions;
  let lastErr = null;
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
      const fetchOpts = {
        ...options,
        signal: controller.signal
      };
      if (proxyAgent) {
        fetchOpts.dispatcher = proxyAgent;
      }
      const isMocked = globalThis.fetch && globalThis.fetch !== defaultGlobalFetch;
      const fetchFn = proxyAgent && !isMocked ? undiciFetch : globalThis.fetch || undiciFetch;
      const response = await fetchFn(url, fetchOpts);
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      if (!response.ok) {
        const err = new Error(`Upstream returned ${response.status} ${response.statusText}`);
        // Do not retry 4xx client/auth errors (e.g. invalid cookie, bad prompt, forbidden)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw err;
        }
        throw err;
      }
      return response;
    } catch (e) {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      lastErr = e;
      // Immediately propagate client-side abort without retrying
      if (options.signal?.aborted) {
        throw e;
      }
      // Do not retry 4xx errors
      const msg = e.message || "";
      if (
        msg.includes("returned 400") ||
        msg.includes("returned 401") ||
        msg.includes("returned 403") ||
        msg.includes("returned 404")
      ) {
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
