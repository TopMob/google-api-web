import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import fastify from "fastify";
import { registerRoutes } from "../src/routes.js";
import { isPrivateIpAddress, validateRemoteImageUrl, extractImagesFromMessages } from "../src/services/multimodal.js";
import { LocalStore, store } from "../src/db.js";
import { verifyApiKey } from "../src/services/auth.js";
import { CircuitBreaker } from "../src/utils/circuitBreaker.js";
import {
  googleContentsToMessages,
  formatGoogleGenerateResponse,
  parseGoogleModelAction
} from "../src/controllers/googleNativeController.js";
import { resolveModelConfig, guessMode, getModels } from "../src/utils/models.js";
import { buildGeminiRequest } from "../src/services/gemini.js";
import { discoverGoogleAccounts } from "../src/utils/cookie.js";
import { parseToolCalls, messagesToPrompt, applyRooCodeToolFallback } from "../src/utils/parsers.js";

describe("Multimodal SSRF & Input Validation", () => {
  it("should detect private, loopback, and link-local IPv4/IPv6 addresses", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("172.16.5.4")).toBe(true);
    expect(isPrivateIpAddress("192.168.1.10")).toBe(true);
    expect(isPrivateIpAddress("169.254.169.254")).toBe(true);
    expect(isPrivateIpAddress("0.0.0.0")).toBe(true);
    expect(isPrivateIpAddress("::1")).toBe(true);
    expect(isPrivateIpAddress("fe80::1")).toBe(true);
    expect(isPrivateIpAddress("fc00::1")).toBe(true);
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
    expect(isPrivateIpAddress("93.184.216.34")).toBe(false);
  });

  it("should reject non-http protocols and local/private image URLs", async () => {
    await expect(validateRemoteImageUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(validateRemoteImageUrl("http://localhost:8081/health")).rejects.toThrow();
    await expect(validateRemoteImageUrl("http://127.0.0.1:3000/secret.png")).rejects.toThrow();
    await expect(validateRemoteImageUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(validateRemoteImageUrl("http://192.168.0.1/router.png")).rejects.toThrow();
    await expect(validateRemoteImageUrl("https://printer.local/image.png")).rejects.toThrow();
  });

  it("should extract valid data URI images from both image_url and input_image parts", async () => {
    // 1x1 PNG header bytes
    const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString("base64");
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}` } }
        ]
      },
      {
        role: "user",
        content: [{ type: "input_image", image_url: `data:image/png;base64,${pngBase64}` }]
      }
    ];
    const extracted = await extractImagesFromMessages(messages);
    expect(extracted).toHaveLength(2);
    expect(extracted[0].mimeType).toBe("image/png");
    expect(extracted[1].mimeType).toBe("image/png");
  });

  it("should reject disallowed non-image data URIs", async () => {
    const htmlBase64 = Buffer.from("<script>alert(1)</script>").toString("base64");
    const messages = [
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: `data:text/html;base64,${htmlBase64}` } }]
      }
    ];
    await expect(extractImagesFromMessages(messages)).rejects.toThrow();
  });
});

describe("LocalStore Quotas, Deletion, and Rich Stats", () => {
  let tmpDir: string;
  let storeFile: string;
  let testStore: LocalStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-store-test-"));
    storeFile = path.join(tmpDir, "store.json");
    testStore = new LocalStore(storeFile);
  });

  afterEach(() => {
    testStore.flush();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should calculate daily usage per API key and rich stats", () => {
    const proj = testStore.createProject("Test App");
    const key = testStore.createApiKey({
      name: "Quota Key",
      project_id: proj.id,
      daily_requests_limit: 2,
      daily_tokens_limit: 500
    });

    testStore.addUsageLog({
      project_id: proj.id,
      api_key_id: key.id,
      model: "gemini-3.8-flash",
      prompt_tokens: 40,
      completion_tokens: 60,
      total_tokens: 100,
      duration_ms: 200,
      status_code: 200
    });

    testStore.addUsageLog({
      project_id: proj.id,
      api_key_id: key.id,
      model: "gemini-3.8-flash",
      prompt_tokens: 50,
      completion_tokens: 150,
      total_tokens: 200,
      duration_ms: 400,
      status_code: 200
    });

    const daily = testStore.getDailyUsageForKey(key.id);
    expect(daily.requests).toBe(2);
    expect(daily.tokens).toBe(300);

    const stats = testStore.getStats(10);
    expect(stats.totalRequests).toBe(2);
    expect(stats.totalPromptTokens).toBe(90);
    expect(stats.totalCompletionTokens).toBe(210);
    expect(stats.avgDurationMs).toBe(300);
  });

  it("should delete an API key by id", () => {
    const proj = testStore.createProject("Del App");
    const key = testStore.createApiKey({ name: "Temp Key", project_id: proj.id });
    expect(testStore.findApiKey(key.key)).not.toBeNull();

    const deleted = testStore.deleteApiKey(key.id);
    expect(deleted).toBe(true);
    expect(testStore.findApiKey(key.key)).toBeNull();
    expect(testStore.deleteApiKey("non-existent")).toBe(false);
  });
});

describe("CircuitBreaker Status", () => {
  it("should expose current state and failure count", async () => {
    const cb = new CircuitBreaker();
    expect(cb.getStatus()).toEqual({ state: "CLOSED", failures: 0 });
  });
});

describe("Google Native API Controller Helpers", () => {
  it("should parse model and action from v1beta path", () => {
    expect(parseGoogleModelAction("gemini-3.8-flash:generateContent")).toEqual({
      model: "gemini-3.8-flash",
      action: "generateContent"
    });
    expect(parseGoogleModelAction("models/gemini-3.1-pro:streamGenerateContent")).toEqual({
      model: "gemini-3.1-pro",
      action: "streamGenerateContent"
    });
    expect(parseGoogleModelAction("invalid-path")).toBeNull();
  });

  it("should convert Google contents and inlineData into ChatMessages", () => {
    const messages = googleContentsToMessages({
      systemInstruction: { parts: [{ text: "Be concise." }] },
      contents: [
        {
          role: "user",
          parts: [{ text: "Look at this" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }]
        },
        {
          role: "model",
          parts: [{ text: "Sure!" }]
        }
      ]
    });

    expect(messages[0]).toEqual({ role: "system", content: "Be concise." });
    expect(messages[1].role).toBe("user");
    expect(Array.isArray(messages[1].content)).toBe(true);
    expect(messages[2]).toEqual({ role: "assistant", content: "Sure!" });
  });

  it("should format Google GenerateContentResponse cleanly", () => {
    const resp = formatGoogleGenerateResponse("Hello world", "gemini-3.8-flash", 10, 5);
    expect(resp.candidates[0].content.parts[0].text).toBe("Hello world");
    expect(resp.candidates[0].content.role).toBe("model");
    expect(resp.candidates[0].finishReason).toBe("STOP");
    expect(resp.usageMetadata.totalTokenCount).toBe(15);
  });
});

describe("Auth Hardening & Daily Quotas", () => {
  const prevAdminKey = process.env.ADMIN_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevAdminKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = prevAdminKey;
    }
  });

  it("should reject hardcoded sk-personal-gw when ADMIN_API_KEY is overridden and store has no matching active key", async () => {
    process.env.ADMIN_API_KEY = "sk-custom-admin-secret";
    vi.spyOn(store, "findApiKey").mockReturnValue(null);

    const req = { headers: { authorization: "Bearer sk-personal-gw" } } as any;
    const result = await verifyApiKey(req, "gemini-3.8-flash");
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  it("should enforce daily_requests_limit and daily_tokens_limit on stored API keys", async () => {
    process.env.ADMIN_API_KEY = "sk-custom-admin-secret";
    vi.spyOn(store, "findApiKey").mockReturnValue({
      id: "key-1",
      key: "sk-test-quota",
      name: "Quota Test",
      project_id: "proj-1",
      active: true,
      allowed_models: null,
      daily_requests_limit: 5,
      daily_tokens_limit: 1000,
      rate_limit_rpm: 100,
      expires_at: null,
      created_at: new Date().toISOString()
    });
    vi.spyOn(store, "getDailyUsageForKey").mockReturnValue({ requests: 5, tokens: 100 });

    const req = { headers: { "x-goog-api-key": "sk-test-quota" } } as any;
    const reqLimited = await verifyApiKey(req, "gemini-3.8-flash");
    expect(reqLimited.valid).toBe(false);
    expect(reqLimited.statusCode).toBe(429);

    vi.spyOn(store, "getDailyUsageForKey").mockReturnValue({ requests: 2, tokens: 1000 });
    const tokLimited = await verifyApiKey(req, "gemini-3.8-flash");
    expect(tokLimited.valid).toBe(false);
    expect(tokLimited.statusCode).toBe(429);
  });
});

describe("Gateway HTTP Routes Integration", () => {
  it("should serve OpenAI and Google Native model listings and enforce auth/validation", async () => {
    const app = fastify();
    registerRoutes(app);

    const v1Models = await app.inject({ method: "GET", url: "/v1/models" });
    expect(v1Models.statusCode).toBe(200);
    const v1Body = v1Models.json();
    expect(v1Body.object).toBe("list");
    expect(Array.isArray(v1Body.data)).toBe(true);

    const v1BetaModels = await app.inject({ method: "GET", url: "/v1beta/models" });
    expect(v1BetaModels.statusCode).toBe(200);
    const v1BetaBody = v1BetaModels.json();
    expect(Array.isArray(v1BetaBody.models)).toBe(true);
    expect(v1BetaBody.models[0].name).toMatch(/^models\//);

    const badChat = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gemini-3.8-flash", messages: [] }
    });
    expect(badChat.statusCode).toBe(400);
    expect(badChat.json().error.code).toBe("invalid_body");

    vi.spyOn(store, "findApiKey").mockReturnValue(null);
    const prevKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "sk-test-only";
    try {
      const unauthChat = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "gemini-3.8-flash", messages: [{ role: "user", content: "hi" }] }
      });
      expect(unauthChat.statusCode).toBe(401);
    } finally {
      if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = prevKey;
      vi.restoreAllMocks();
    }

    const badGoogleAction = await app.inject({
      method: "POST",
      url: "/v1beta/models/gemini-3.8-flash:unknownAction",
      payload: {}
    });
    expect(badGoogleAction.statusCode).toBe(404);

    await app.close();
  });
});

describe("Gemini 4 Elemental Models (Carbon, Argon, Neon, Hydrogen)", () => {
  it("should include gemini-4-carbon, gemini-4-argon, gemini-4-neon, and gemini-4-hydrogen in model list", () => {
    const models = getModels();
    expect(models["gemini-4-carbon"]).toBeDefined();
    expect(models["gemini-4-argon"]).toBeDefined();
    expect(models["gemini-4-neon"]).toBeDefined();
    expect(models["gemini-4-hydrogen"]).toBeDefined();
  });

  it("should map elemental model modes and thinking defaults accurately", () => {
    expect(guessMode("gemini-4-carbon")).toBe(3);
    expect(guessMode("gemini-4-argon")).toBe(3);
    expect(guessMode("gemini-4-neon")).toBe(2);
    expect(guessMode("gemini-4-hydrogen")).toBe(1);

    const carbon = resolveModelConfig("gemini-4-carbon");
    expect(carbon.config.mode).toBe(3);
    expect(carbon.config.think).toBe(0);

    const hydrogenDeep = resolveModelConfig("gemini-4-hydrogen@think=0");
    expect(hydrogenDeep.cleanModelName).toBe("gemini-4-hydrogen");
    expect(hydrogenDeep.config.think).toBe(0);
  });
});

describe("Temporary Chats & Clear Usage Logs", () => {
  it("should default temporary_chats=true in LocalStore keys and clear logs on clearUsageLogs()", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-clear-test-"));
    const testStore = new LocalStore(path.join(tmpDir, "store.json"));
    try {
      const proj = testStore.createProject("TempProj");
      const key = testStore.createApiKey({ name: "TempKey", project_id: proj.id });
      expect(key.temporary_chats).toBe(true);

      testStore.addUsageLog({
        project_id: proj.id,
        api_key_id: key.id,
        model: "gemini-4-hydrogen",
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        duration_ms: 100,
        status_code: 200
      });
      expect(testStore.getStats().totalRequests).toBe(1);

      testStore.clearUsageLogs();
      expect(testStore.getStats().totalRequests).toBe(0);
      expect(testStore.getStats().recentLogs).toHaveLength(0);
    } finally {
      testStore.flush();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should set temporary chat persistence flags [41]=[1] and [45]=1 by default in Gemini payload", async () => {
    const reqTemp = await buildGeminiRequest("hi", 1, 4, "__Secure-1PSID=abc; SAPISID=xyz", undefined, true);
    const paramsTemp = new URLSearchParams(reqTemp.body);
    const innerTemp = JSON.parse(JSON.parse(paramsTemp.get("f.req")!)[1]);
    expect(innerTemp[41]).toEqual([1]);
    expect(innerTemp[45]).toBe(1);

    const reqPersist = await buildGeminiRequest("hi", 1, 4, "__Secure-1PSID=abc; SAPISID=xyz", undefined, false);
    const paramsPersist = new URLSearchParams(reqPersist.body);
    const innerPersist = JSON.parse(JSON.parse(paramsPersist.get("f.req")!)[1]);
    expect(innerPersist[41]).toEqual([2]);
    expect(innerPersist[45]).toBeNull();
  });
});

describe("Multi-Account AuthUser & Discovery", () => {
  it("should persist active auth_user in LocalStore and reload it", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-authuser-test-"));
    const storePath = path.join(tmpDir, "store.json");
    try {
      const s1 = new LocalStore(storePath);
      expect(s1.getAuthUser()).toBe("0");
      expect(s1.setAuthUser("2")).toBe("2");
      expect(s1.getAuthUser()).toBe("2");
      s1.flush();

      const s2 = new LocalStore(storePath);
      expect(s2.getAuthUser()).toBe("2");
      s2.flush();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should discover signed-in Google accounts and stop when SNlM0e is absent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/u/0/app")) {
        return new Response(
          `"SNlM0e":"token0","oPEP7c":"user0@example.com","https://lh3.googleusercontent.com/a/fake-avatar-0=s96-c"`,
          { status: 200 }
        );
      }
      if (url.includes("/u/1/app")) {
        return new Response(`"SNlM0e":"token1","oPEP7c":"user1@example.com"`, { status: 200 });
      }
      return new Response(`<html>not signed in</html>`, { status: 200 });
    });

    try {
      const accounts = await discoverGoogleAccounts("__Secure-1PSID=abc; SAPISID=xyz", true);
      expect(accounts).toHaveLength(2);
      expect(accounts[0]).toEqual({
        index: "0",
        email: "user0@example.com",
        avatarUrl: "https://lh3.googleusercontent.com/a/fake-avatar-0=s96-c"
      });
      expect(accounts[1]).toEqual({
        index: "1",
        email: "user1@example.com",
        avatarUrl: null
      });
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("Roo Code & IDE Tool Calling Adaptation", () => {
  it("should parse ```json fenced tool calls when Gemini uses json fence", () => {
    const raw = '```json\n{"name":"read_file","arguments":{"path":"README.md"}}\n```';
    const res = parseToolCalls(raw);
    expect(res.cleanText).toBe("");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].function.name).toBe("read_file");
    expect(JSON.parse(res.toolCalls![0].function.arguments)).toEqual({ path: "README.md" });
  });

  it("should parse ```tool_call with nested triple backticks inside JSON string without leaking tail", () => {
    const raw =
      '```tool_call\n{"name":"attempt_completion","arguments":{"result":"Here is diagram:\\n```mermaid\\nflowchart TD\\nA-->B\\n```\\nDone."}}\n```';
    const res = parseToolCalls(raw);
    expect(res.cleanText).toBe("");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].function.name).toBe("attempt_completion");
    expect(JSON.parse(res.toolCalls![0].function.arguments).result).toContain("```mermaid");
  });

  it("should place tool reminder at the end of messagesToPrompt and synthesize attempt_completion fallback", () => {
    const tools = [
      { type: "function", function: { name: "attempt_completion", description: "Finish task", parameters: {} } }
    ];
    const prompt = messagesToPrompt([{ role: "user", content: "привет" }], tools);
    expect(prompt).toContain("[System reminder]:");
    expect(prompt.indexOf("привет")).toBeLessThan(prompt.indexOf("[System reminder]:"));

    const fallback = applyRooCodeToolFallback("Привет! Вижу репозиторий.", null, tools);
    expect(fallback).toHaveLength(1);
    expect(fallback![0].function.name).toBe("attempt_completion");
    expect(JSON.parse(fallback![0].function.arguments)).toEqual({ result: "Привет! Вижу репозиторий." });

    const noFallback = applyRooCodeToolFallback("Hello", null, [
      { type: "function", function: { name: "search_web", description: "Search", parameters: {} } }
    ]);
    expect(noFallback).toBeNull();

    const jsonSchemaPrompt = messagesToPrompt(
      [
        { role: "tool", name: "read_file", tool_call_id: "call_1", content: "ok" },
        { role: "user", content: "next" }
      ],
      [{ type: "function", function: { name: "search_web", description: "Search", parameters: {} } }],
      { type: "json_schema", json_schema: { name: "out", schema: { type: "object" } } },
      "required"
    );
    expect(jsonSchemaPrompt).toContain("Schema:");
    expect(jsonSchemaPrompt).toContain("requires every response to end");
  });
});

function makeWrbLine(text: string, finished = true): string {
  const inner = [null, null, null, null, [["rc_1", [text], null, null, null, null, null, null, finished ? [2] : []]]];
  const outer = [["wrb.fr", null, JSON.stringify(inner)]];
  return `${JSON.stringify(outer)}\n`;
}

function makeStreamResponse(chunks: Array<string | Error>): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index++];
      if (chunk instanceof Error) {
        controller.error(chunk);
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    }
  });
  return new Response(stream, { status: 200 });
}

describe("Upstream Error, Empty Response & Rate-Limit Mapping", () => {
  let app: ReturnType<typeof fastify>;
  let addLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    app = fastify();
    registerRoutes(app);
    addLogSpy = vi.spyOn(store, "addUsageLog").mockImplementation(() => ({
      id: "log_test",
      project_id: "0",
      api_key_id: "1",
      model: "gemini-4-hydrogen",
      prompt_tokens: 1,
      completion_tokens: 0,
      total_tokens: 1,
      duration_ms: 1,
      status_code: 200,
      created_at: new Date().toISOString()
    }));
  });

  afterEach(async () => {
    addLogSpy.mockRestore();
    vi.restoreAllMocks();
    await app.close();
  });

  it("should return 502 and log 502 when non-streaming upstream returns empty content", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      return makeStreamResponse(['[["di",1]]\n']);
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: false,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("empty_upstream_response");
    expect(addLogSpy).toHaveBeenCalledWith(expect.objectContaining({ status_code: 502, completion_tokens: 0 }));
  });

  it("should return 502 and log 502 when streaming upstream returns empty content (with or without tools)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      return makeStreamResponse(['[["di",1]]\n']);
    });

    const resNoTools = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: true,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(resNoTools.statusCode).toBe(502);
    expect(resNoTools.json().error.code).toBe("empty_upstream_response");
    expect(addLogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status_code: 502 }));

    const resWithTools = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "attempt_completion", description: "Done", parameters: {} } }]
      }
    });

    expect(resWithTools.statusCode).toBe(502);
    expect(resWithTools.json().error.code).toBe("empty_upstream_response");
    expect(addLogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status_code: 502 }));
  });

  it("should log 502 (not 200) when stream is interrupted mid-flight", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      return makeStreamResponse([makeWrbLine("Partial response", false), new Error("VPN connection reset")]);
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: true,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Gateway Error");
    expect(addLogSpy).toHaveBeenCalledWith(expect.objectContaining({ status_code: 502, completion_tokens: 0 }));
  });

  it("should return 429 and log 429 when upstream returns rate-limit text in non-streaming or chunked streaming", async () => {
    const rateLimitText = "I couldn't do that because I'm getting a lot of requests right now. Please try again later.";
    const part1 = "I couldn't do that because ";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      return makeStreamResponse([makeWrbLine(part1, false), makeWrbLine(rateLimitText, true)]);
    });

    const resNonStream = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: false,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(resNonStream.statusCode).toBe(429);
    expect(resNonStream.json().error.type).toBe("rate_limit_error");
    expect(resNonStream.json().error.code).toBe("upstream_rate_limit");
    expect(addLogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status_code: 429 }));

    const resStream = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: true,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(resStream.statusCode).toBe(429);
    expect(resStream.json().error.type).toBe("rate_limit_error");
    expect(resStream.json().error.code).toBe("upstream_rate_limit");
    expect(addLogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status_code: 429 }));
  });

  it("should automatically retry and recover with 200 when upstream returns empty on first attempt", async () => {
    let streamAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      streamAttempts++;
      if (streamAttempts === 1) {
        return makeStreamResponse(['[["di",1]]\n']);
      }
      return makeStreamResponse([makeWrbLine("Recovered successfully", true)]);
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: true,
        messages: [{ role: "user", content: "hello" }]
      }
    });

    expect(streamAttempts).toBe(2);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Recovered successfully");
    expect(addLogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status_code: 200 }));
  });
});

describe("Coding Agents Stability (RooCode, OpenCode, Cursor, Gemini CLI)", () => {
  let app: ReturnType<typeof fastify>;
  let addLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    app = fastify({ bodyLimit: 50 * 1024 * 1024 });
    registerRoutes(app);
    addLogSpy = vi.spyOn(store, "addUsageLog").mockImplementation(() => ({
      id: "log_coding_test",
      project_id: "0",
      api_key_id: "1",
      model: "gemini-4-hydrogen",
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      duration_ms: 1,
      status_code: 200,
      created_at: new Date().toISOString()
    }));
  });

  afterEach(async () => {
    addLogSpy.mockRestore();
    vi.restoreAllMocks();
    await app.close();
  });

  it("should map tool_call_id to function name in multi-turn tool history and enforce specific tool_choice", () => {
    const tools = [
      { type: "function", function: { name: "read_file", description: "Read", parameters: {} } },
      { type: "function", function: { name: "write_to_file", description: "Write", parameters: {} } }
    ];
    const prompt = messagesToPrompt(
      [
        { role: "user", content: "check a.ts and b.ts" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_111", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
            { id: "call_222", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } }
          ]
        },
        { role: "tool", tool_call_id: "call_111", content: "content A" },
        { role: "tool", tool_call_id: "call_222", content: "content B" }
      ],
      tools,
      undefined,
      { type: "function", function: { name: "write_to_file" } }
    );

    expect(prompt).toContain('"id":"call_111"');
    expect(prompt).toContain("[Tool result for read_file (id: call_111)]: content A");
    expect(prompt).toContain("[Tool result for read_file (id: call_222)]: content B");
    expect(prompt).toContain('You MUST call the tool "write_to_file"');
  });

  it("should not hijack non-tool JSON examples when allowedTools are provided, and should extract inline raw tool calls", () => {
    const tools = [{ type: "function", function: { name: "read_file", description: "Read", parameters: {} } }];

    const codeExplanation = 'Example config:\n```json\n{"name": "my-app", "parameters": {"port": 3000}}\n```\nDone.';
    const resNoHijack = parseToolCalls(codeExplanation, tools);
    expect(resNoHijack.toolCalls).toBeNull();
    expect(resNoHijack.cleanText).toContain('"my-app"');

    const inlineCall = 'Let me check that file.\n{"name": "read_file", "arguments": {"path": "src/index.ts"}}';
    const resInline = parseToolCalls(inlineCall, tools);
    expect(resInline.toolCalls).toHaveLength(1);
    expect(resInline.toolCalls![0].function.name).toBe("read_file");
    expect(resInline.cleanText).toBe("Let me check that file.");
  });

  it("should buffer split ```tool_call fences without leaking partial backticks and emit OpenAI-compliant tool chunks", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      return makeStreamResponse([
        makeWrbLine("Checking file.\n```to", false),
        makeWrbLine('Checking file.\n```tool_call\n{"name":"read_file","arguments":{"path":"a.ts"}}\n```', true)
      ]);
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: true,
        messages: [{ role: "user", content: "read a.ts" }],
        tools: [{ type: "function", function: { name: "read_file", description: "Read", parameters: {} } }]
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("```to");
    expect(res.body).toContain('"role":"assistant"');
    expect(res.body).toContain('"tool_calls"');
    expect(res.body).toContain('"finish_reason":null');
    expect(res.body).toContain('"finish_reason":"tool_calls"');
  });

  it("should respect tool_choice='none' in streaming mode and not trigger attempt_completion fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      return makeStreamResponse([makeWrbLine("Just a plain text title", true)]);
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: true,
        tool_choice: "none",
        messages: [{ role: "user", content: "title" }],
        tools: [{ type: "function", function: { name: "attempt_completion", description: "Done", parameters: {} } }]
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Just a plain text title");
    expect(res.body).not.toContain("attempt_completion");
    expect(res.body).toContain('"finish_reason":"stop"');
  });

  it("should stream /v1/responses SSE events and preserve function_call items in input history", async () => {
    let capturedBody = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      capturedBody = String(init?.body || "");
      return makeStreamResponse([makeWrbLine("All done!", true)]);
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: true,
        input: [
          { role: "user", content: "check" },
          { type: "function_call", call_id: "call_r1", name: "read_file", arguments: '{"path":"x.ts"}' },
          { type: "function_call_output", call_id: "call_r1", output: "file ok" }
        ],
        tools: [{ type: "function", name: "read_file", description: "Read", parameters: {} }]
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: response.created");
    expect(res.body).toContain("event: response.output_text.delta");
    expect(res.body).toContain("event: response.completed");

    const fReq = new URLSearchParams(capturedBody).get("f.req") || "";
    expect(fReq).toContain("read_file");
    expect(fReq).toContain("file ok");
  });

  it("should support /v1beta :countTokens and tool calling for Gemini CLI", async () => {
    const countRes = await app.inject({
      method: "POST",
      url: "/v1beta/models/gemini-4-hydrogen:countTokens",
      headers: { "x-goog-api-key": "sk-personal-gw" },
      payload: { contents: [{ role: "user", parts: [{ text: "hello world" }] }] }
    });
    expect(countRes.statusCode).toBe(200);
    expect(countRes.json().totalTokens).toBeGreaterThan(0);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      return makeStreamResponse([makeWrbLine('```tool_call\n{"name":"list_dir","arguments":{"path":"."}}\n```', true)]);
    });

    const genRes = await app.inject({
      method: "POST",
      url: "/v1beta/models/gemini-4-hydrogen:generateContent",
      headers: { "x-goog-api-key": "sk-personal-gw" },
      payload: {
        contents: [{ role: "user", parts: [{ text: "list files" }] }],
        tools: [{ functionDeclarations: [{ name: "list_dir", description: "List", parameters: {} }] }]
      }
    });
    expect(genRes.statusCode).toBe(200);
    expect(genRes.json().candidates[0].content.parts[0].functionCall).toEqual({
      name: "list_dir",
      args: { path: "." }
    });
  });

  it("should not trip CircuitBreaker on 429 rate-limit errors", async () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 6; i++) {
      await expect(
        cb.execute(async () => {
          throw new Error("Upstream returned 429 Too Many Requests");
        })
      ).rejects.toThrow();
    }
    expect(cb.getStatus().state).toBe("CLOSED");
    expect(cb.getStatus().failures).toBe(0);
  });

  it("should accept request payloads larger than 1 MiB without 413 error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/app")) {
        return new Response('"SNlM0e":"test_sn"', { status: 200 });
      }
      return makeStreamResponse([makeWrbLine("Processed large context", true)]);
    });

    const largeText = "a".repeat(1.5 * 1024 * 1024);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-personal-gw" },
      payload: {
        model: "gemini-4-hydrogen",
        stream: false,
        messages: [{ role: "user", content: largeText }]
      }
    });
    expect(res.statusCode).toBe(200);
  });
});
