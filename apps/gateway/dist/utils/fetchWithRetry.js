import { logger } from "../logger.js";
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
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      if (!response.ok) {
        throw new Error(`Upstream returned ${response.status} ${response.statusText}`);
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
      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const jitter = Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        delay = Math.min(delay * 2, maxDelayMs);
        logger.warn({ attempt, err: e.message }, "Fetch failed, retrying...");
      }
    }
  }
  throw lastErr;
}
