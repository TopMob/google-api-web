export function normalizeError(err) {
    const msg = err instanceof Error ? err.message : String(err);
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
                    message: "Bad request to Gemini. Possible causes: invalid payload format, invalid cookie, or Google Gemini internal changes.",
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
    if (msg.includes("Upstream returned 500") || msg.includes("Upstream returned 502") || msg.includes("Upstream returned 503")) {
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
