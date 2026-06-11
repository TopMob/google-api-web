import { describe, it, expect } from "vitest";
import { cleanGeminiText, extractResponseText, parseToolCalls, messagesToPrompt } from "../src/utils/parsers.js";
import { parseAndValidateCookie } from "../src/utils/cookie.js";

describe("Parser Utilities", () => {
  it("should clean gemini python/js code execution blocks", () => {
    const raw = "Here is the result:\n```python?code_reference&code_event_index=1\nprint('hello')\n```\nDone!";
    const cleaned = cleanGeminiText(raw);
    expect(cleaned).toBe("Here is the result:\nDone!");
  });

  it("should extract response text from raw wrb.fr payload", () => {
    const rawPayload = '[["wrb.fr", null, "[[\\"text 1\\",\\"text 2\\"],null,null,null,[[null,[\\"extracted text\\"]]]]" ]]' + " ".repeat(150) + '\n456';
    const text = extractResponseText(rawPayload);
    expect(text).toBe("extracted text");
  });

  it("should parse tool calls and clean text", () => {
    const input = "Normal response\n```tool_call\n{\"name\": \"get_weather\", \"arguments\": {\"location\": \"London\"}}\n```\nEnding response";
    const result = parseToolCalls(input);
    expect(result.cleanText).toBe("Normal response\n\nEnding response");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].function.name).toBe("get_weather");
    expect(JSON.parse(result.toolCalls![0].function.arguments).location).toBe("London");
  });

  it("should convert OpenAI messages to Gemini text prompt format", () => {
    const messages = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" }
    ];
    const prompt = messagesToPrompt(messages);
    expect(prompt).toContain("[System instruction]: You are helpful");
    expect(prompt).toContain("Hello");
    expect(prompt).toContain("[Assistant]: Hi there!");
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
