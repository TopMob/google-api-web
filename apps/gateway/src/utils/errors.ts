export class UpstreamEmptyResponseError extends Error {
  constructor(message = "Upstream returned an empty response (no assistant content or tool calls).") {
    super(message);
    this.name = "UpstreamEmptyResponseError";
  }
}

export class UpstreamRateLimitError extends Error {
  constructor(message = "Upstream rate limit exceeded. Please try again later.") {
    super(message);
    this.name = "UpstreamRateLimitError";
  }
}

export class ClientAbortedError extends Error {
  constructor(message = "Client closed request before completion.") {
    super(message);
    this.name = "ClientAbortedError";
  }
}

const UPSTREAM_RATE_LIMIT_PHRASE =
  "i couldn't do that because i'm getting a lot of requests right now. please try again later.";

function normalizeWhitespaceLower(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isUpstreamRateLimitMessage(text: string): boolean {
  if (!text) return false;
  const normalized = normalizeWhitespaceLower(text);
  if (normalized.length === 0 || normalized.length > 300) return false;
  return /getting a lot of requests right now\.?\s*please try again later\.?/i.test(normalized);
}

export function isPotentialRateLimitPrefix(text: string): boolean {
  if (!text) return false;
  const normalized = normalizeWhitespaceLower(text);
  if (normalized.length === 0 || normalized.length > UPSTREAM_RATE_LIMIT_PHRASE.length) return false;
  return UPSTREAM_RATE_LIMIT_PHRASE.startsWith(normalized);
}

export function normalizeError(err: any): { status: number; body: any } {
  const msg = err instanceof Error ? err.message : String(err);

  if (err instanceof UpstreamRateLimitError || (err instanceof Error && err.name === "UpstreamRateLimitError")) {
    return {
      status: 429,
      body: {
        error: {
          message: msg,
          type: "rate_limit_error",
          param: null,
          code: "upstream_rate_limit"
        }
      }
    };
  }

  if (
    err instanceof UpstreamEmptyResponseError ||
    (err instanceof Error && err.name === "UpstreamEmptyResponseError")
  ) {
    return {
      status: 502,
      body: {
        error: {
          message: msg,
          type: "api_error",
          param: null,
          code: "empty_upstream_response"
        }
      }
    };
  }

  if (err instanceof ClientAbortedError || (err instanceof Error && err.name === "ClientAbortedError")) {
    return {
      status: 499,
      body: {
        error: {
          message: msg,
          type: "api_error",
          param: null,
          code: "client_aborted"
        }
      }
    };
  }

  if (err instanceof Error && err.name === "ImageValidationError") {
    return {
      status: 400,
      body: {
        error: {
          message: msg,
          type: "invalid_request_error",
          param: "messages",
          code: "invalid_image_input"
        }
      }
    };
  }

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
          message:
            "Bad request to Gemini. Possible causes: invalid payload format, invalid cookie, or Google Gemini internal changes.",
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

  if (
    msg.includes("Upstream returned 500") ||
    msg.includes("Upstream returned 502") ||
    msg.includes("Upstream returned 503")
  ) {
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
