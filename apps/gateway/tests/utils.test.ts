import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fetchWithRetry } from "../src/utils/fetchWithRetry.js";
import {
  cleanGeminiText,
  extractResponseText,
  parseToolCalls,
  messagesToPrompt,
  cleanJsonResponse
} from "../src/utils/parsers.js";
import {
  parseAndValidateCookie,
  loadCookie,
  clearCookieDiscoveryCache,
  recordResponseSetCookies,
  isCookieValidCached
} from "../src/utils/cookie.js";
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

  it("should accept null optional fields sent by OpenAI/LiteLLM/Vercel AI SDK clients", () => {
    const payload = {
      model: "gemini-4-carbon",
      messages: [{ role: "user", content: "hello", name: null, tool_call_id: null }],
      tool_choice: null,
      stop: null,
      tools: null,
      temperature: null,
      max_tokens: null,
      max_completion_tokens: 4096,
      reasoning_effort: "high",
      parallel_tool_calls: null,
      response_format: null,
      stream_options: null
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

  it("should automatically extract cookies from HAR JSON exports with Set-Cookie updates", () => {
    const har = {
      log: {
        version: "1.2",
        entries: [
          {
            request: {
              url: "https://gemini.google.com/app",
              headers: [
                { name: "Cookie", value: "__Secure-1PSID=psid_har; SAPISID=sapisid_har; __Secure-1PSIDCC=old" }
              ],
              cookies: [{ name: "SID", value: "sid_har" }]
            },
            response: {
              headers: [{ name: "Set-Cookie", value: "__Secure-1PSIDCC=rotated_cc; Path=/; Secure" }],
              cookies: [{ name: "__Secure-1PSIDTS", value: "ts_har" }]
            }
          },
          {
            request: {
              url: "https://accounts.google.com/ServiceLogin",
              headers: [{ name: "Cookie", value: "SAPISID=other_domain_sapisid" }]
            }
          }
        ]
      }
    };

    const result = parseAndValidateCookie(JSON.stringify(har));
    expect(result.valid).toBe(true);
    expect(result.data?.cookiesObj["__Secure-1PSID"]).toBe("psid_har");
    expect(result.data?.cookiesObj["SID"]).toBe("sid_har");
    expect(result.data?.cookiesObj["__Secure-1PSIDTS"]).toBe("ts_har");
    expect(result.data?.cookiesObj["__Secure-1PSIDCC"]).toBe("rotated_cc");
    expect(result.data?.sapisid).toBe("sapisid_har");
  });

  it("should auto-load the newest HAR or txt cookie file dropped into cookies/", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-cookie-scan-"));
    const cookiesDir = path.join(tmpDir, "cookies");
    fs.mkdirSync(cookiesDir, { recursive: true });
    const prevCwd = process.cwd();

    try {
      const olderFile = path.join(cookiesDir, "cookie.txt");
      fs.writeFileSync(olderFile, "__Secure-1PSID=old_psid; SAPISID=old_sapisid;", "utf-8");
      const oldTime = new Date(Date.now() - 60_000);
      fs.utimesSync(olderFile, oldTime, oldTime);

      const newerHar = path.join(cookiesDir, "export-123.har");
      fs.writeFileSync(
        newerHar,
        JSON.stringify({
          log: {
            entries: [
              {
                request: {
                  url: "https://gemini.google.com/app",
                  cookies: [
                    { name: "__Secure-1PSID", value: "new_har_psid" },
                    { name: "SAPISID", value: "new_har_sapisid" }
                  ]
                }
              }
            ]
          }
        }),
        "utf-8"
      );

      process.chdir(tmpDir);
      clearCookieDiscoveryCache();
      const loaded = loadCookie();
      expect(loaded.sapisid).toBe("new_har_sapisid");
      expect(loaded.cookieStr).toContain("__Secure-1PSID=new_har_psid");
    } finally {
      process.chdir(prevCwd);
      clearCookieDiscoveryCache();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should apply and persist rotated Set-Cookie updates into cookie.txt and loadCookie()", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-cookie-rotate-"));
    const cookiesDir = path.join(tmpDir, "cookies");
    fs.mkdirSync(cookiesDir, { recursive: true });
    const prevCwd = process.cwd();

    try {
      const cookieFile = path.join(cookiesDir, "cookie.txt");
      fs.writeFileSync(cookieFile, "__Secure-1PSID=psid_1; __Secure-1PSIDTS=old_ts; SAPISID=sap_1", "utf-8");

      process.chdir(tmpDir);
      clearCookieDiscoveryCache();
      expect(loadCookie().cookieStr).toContain("__Secure-1PSIDTS=old_ts");

      const fakeRes = {
        headers: {
          getSetCookie: () => ["__Secure-1PSIDTS=new_ts; Path=/; Secure; HttpOnly"]
        }
      } as unknown as Response;

      recordResponseSetCookies(fakeRes);

      const reloaded = loadCookie();
      expect(reloaded.cookieStr).toContain("__Secure-1PSIDTS=new_ts");
      expect(fs.readFileSync(cookieFile, "utf-8")).toContain("__Secure-1PSIDTS=new_ts");
    } finally {
      process.chdir(prevCwd);
      clearCookieDiscoveryCache();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should keep session and validation cache across routine cookie rotation", async () => {
    clearCookieDiscoveryCache();
    let fetchCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCalls++;
      return new Response('"SNlM0e":"stable_sn"', { status: 200 });
    });

    try {
      const c1 = "__Secure-1PSID=psid_rot_test; __Secure-1PSIDCC=cc_1; NID=nid_1; SAPISID=sap_1";
      const c2 = "__Secure-1PSID=psid_rot_test; __Secure-1PSIDCC=cc_2; NID=nid_2; SAPISID=sap_1";
      expect(await isCookieValidCached(c1, "sap_1")).toBe(true);
      expect(await isCookieValidCached(c2, "sap_1")).toBe(true);
      expect(fetchCalls).toBe(1);
    } finally {
      fetchMock.mockRestore();
      clearCookieDiscoveryCache();
    }
  });

  it("should keep cookie valid on transient network errors after an earlier valid check", async () => {
    clearCookieDiscoveryCache();
    let callCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('"SNlM0e":"valid_sn_token"', { status: 200 });
      }
      throw new Error("Transient timeout");
    });

    try {
      const cookieStr = "__Secure-1PSID=psid_transient_test; SAPISID=sap_1";
      expect(await isCookieValidCached(cookieStr, "sap_1")).toBe(true);

      // Force TTL expiration by shifting Date.now forward 6 minutes
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60 * 1000);
      try {
        expect(await isCookieValidCached(cookieStr, "sap_1")).toBe(true);
      } finally {
        nowSpy.mockRestore();
      }
    } finally {
      fetchMock.mockRestore();
      clearCookieDiscoveryCache();
    }
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
