import { describe, it, expect, vi } from "vitest";
import { fetchWithRetry } from "../src/utils/fetchWithRetry.js";
import {
  cleanGeminiText,
  extractResponseText,
  parseToolCalls,
  messagesToPrompt,
  cleanJsonResponse
} from "../src/utils/parsers.js";
import { parseAndValidateCookie } from "../src/utils/cookie.js";
import { chatCompletionSchema } from "../src/utils/schemas.js";

describe("Schema Utilities", () => {
  it("should accept developer role and null content in chat completions schema", () => {
    const payload = {
      model: "gemini-3.5-flash",
      messages: [
        { role: "developer", content: "system prompt" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function" }] },
        { role: "tool", content: "result" }
      ]
    };
    const result = chatCompletionSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

describe("Parser Utilities", () => {
  it("should clean gemini python/js code execution blocks", () => {
    const raw = "Here is the result:\n```python?code_reference&code_event_index=1\nprint('hello')\n```\nDone!";
    const cleaned = cleanGeminiText(raw);
    expect(cleaned).toBe("Here is the result:\nDone!");
  });

  it("should extract response text from raw wrb.fr payload", () => {
    const rawPayload =
      '[["wrb.fr", null, "[[\\"text 1\\",\\"text 2\\"],null,null,null,[[null,[\\"extracted text\\"]]]]" ]]' +
      " ".repeat(150) +
      "\n456";
    const text = extractResponseText(rawPayload);
    expect(text).toBe("extracted text");
  });

  it("should parse tool calls and clean text", () => {
    const input =
      'Normal response\n```tool_call\n{"name": "get_weather", "arguments": {"location": "London"}}\n```\nEnding response';
    const result = parseToolCalls(input);
    expect(result.cleanText).toBe("Normal response\n\nEnding response");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].function.name).toBe("get_weather");
    expect(JSON.parse(result.toolCalls![0].function.arguments).location).toBe("London");
  });

  it("should not falsely treat normal markdown json blocks as tool calls", () => {
    const input = 'Here is the data:\n```json\n{"name": "Alice", "role": "admin"}\n```\nDone!';
    const result = parseToolCalls(input);
    expect(result.toolCalls).toBeNull();
    expect(result.cleanText).toContain('{"name": "Alice", "role": "admin"}');
  });

  it("should convert OpenAI messages to Gemini text prompt format including developer and function roles", () => {
    const messages: any[] = [
      { role: "developer", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "function", name: "get_weather", content: "sunny" }
    ];
    const prompt = messagesToPrompt(messages);
    expect(prompt).toContain("[System instruction]: You are helpful");
    expect(prompt).toContain("Hello");
    expect(prompt).toContain("[Assistant]: Hi there!");
    expect(prompt).toContain("[Tool result for get_weather]: sunny");
  });

  it("should clean json responses from markdown and think blocks", () => {
    const raw = '<think>reasoning</think>\n```json\n{"answer": "ok"}\n```';
    expect(cleanJsonResponse(raw)).toBe('{"answer": "ok"}');
  });
});

describe("Cookie Utilities", () => {
  it("should validate and parse valid cookies", () => {
    const cookieStr = "__Secure-1PSID=xyz123; SAPISID=sapisid123;";
    const result = parseAndValidateCookie(cookieStr);
    expect(result.valid).toBe(true);
    expect(result.data?.sapisid).toBe("sapisid123");
  });

  it("should reject invalid cookies", () => {
    const cookieStr = "random_cookie=abc;";
    const result = parseAndValidateCookie(cookieStr);
    expect(result.valid).toBe(false);
  });
});

describe("Network Utilities", () => {
  it("should propagate AbortSignal and reject immediately in fetchWithRetry", async () => {
    const originalFetch = global.fetch;
    let fetchCallCount = 0;

    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      fetchCallCount++;
      await new Promise((resolve, reject) => {
        if (init?.signal) {
          if (init.signal.aborted) {
            reject(new DOMException("The user aborted a request.", "AbortError"));
          } else {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The user aborted a request.", "AbortError"));
            });
          }
        }
      });
      return new Response("ok");
    });

    const controller = new AbortController();
    const fetchPromise = fetchWithRetry(
      "http://localhost/test",
      { signal: controller.signal },
      { maxRetries: 3, initialDelayMs: 10 }
    );

    setTimeout(() => {
      controller.abort();
    }, 15);

    await expect(fetchPromise).rejects.toThrow();
    expect(fetchCallCount).toBe(1); // Should abort immediately and not retry

    global.fetch = originalFetch;
  });
});
