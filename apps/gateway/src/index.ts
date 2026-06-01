import fastify from "fastify";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import pino from "pino";
import { MODELS } from "@gateway/shared";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const logger = pino({
  level: process.env.LOG_LEVEL || "info"
});

const server = fastify({ logger });

const PORT = parseInt(process.env.PORT || "8081", 10);
const HOST = process.env.HOST || "0.0.0.0";
const GEMINI_BL = process.env.GEMINI_BL || "boq_assistant-bard-web-server_20260525.09_p0";
const AUTH_USER = process.env.AUTH_USER || "";
const RETRY_ATTEMPTS = parseInt(process.env.RETRY_ATTEMPTS || "3", 10);
const RETRY_DELAY_SEC = parseInt(process.env.RETRY_DELAY_SEC || "2", 10);

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function loadCookie(): { cookieStr: string; sapisid: string | null } {
  if (process.env.GEMINI_COOKIE) {
    const cookieStr = process.env.GEMINI_COOKIE.trim();
    const match = cookieStr.match(/SAPISID=([^;]+)/);
    return { cookieStr, sapisid: match ? match[1] : null };
  }

  const paths = [
    path.resolve(process.cwd(), "cookies/cookie.txt"),
    path.resolve(process.cwd(), "../cookies/cookie.txt"),
    path.resolve(process.cwd(), "../../cookies/cookie.txt"),
    path.resolve(process.cwd(), "cookie.txt")
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf-8").trim();
        if (content.startsWith("{")) {
          const data = JSON.parse(content);
          return { cookieStr: data.cookie || "", sapisid: data.sapisid || null };
        } else {
          const match = content.match(/SAPISID=([^;]+)/);
          return { cookieStr: content, sapisid: match ? match[1] : null };
        }
      } catch (e) {
        logger.error({ err: e }, "Failed to read cookie file");
      }
    }
  }

  return { cookieStr: "", sapisid: null };
}

function makeSapisidHash(sapisid: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h = crypto.createHash("sha1").update(`${ts} ${sapisid} https://gemini.google.com`).digest("hex");
  return `SAPISIDHASH ${ts}_${h}`;
}

function cleanGeminiText(text: string): string {
  return text.replace(/```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g, "");
}

function extractResponseText(raw: string): string {
  const texts: string[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.includes('"wrb.fr"') || line.length < 200) {
      continue;
    }
    try {
      const arr = JSON.parse(line);
      const innerStr = arr[0][2];
      if (!innerStr || innerStr.length < 50) continue;
      const inner = JSON.parse(innerStr);
      if (Array.isArray(inner) && inner[4]) {
        for (const part of inner[4]) {
          if (Array.isArray(part) && part[1] && Array.isArray(part[1])) {
            for (const t of part[1]) {
              if (typeof t === "string" && t.length > 0) {
                texts.push(t);
              }
            }
          }
        }
      }
    } catch {}
  }
  let text = "";
  for (let i = texts.length - 1; i >= 0; i--) {
    if (texts[i].trim()) {
      text = texts[i];
      break;
    }
  }
  return cleanGeminiText(text).trim();
}

function messagesToPrompt(messages: any[], tools?: any[]): string {
  const parts: string[] = [];
  if (tools && tools.length > 0) {
    const toolDefs = tools.map((tool) => {
      const fn = tool.type === "function" ? tool.function : tool;
      return {
        name: fn.name || tool.name || "",
        description: fn.description || tool.description || "",
        parameters: fn.parameters || tool.parameters || {}
      };
    });
    parts.push(
      "[System instruction]: You have access to tools. To call a tool, respond with:\n" +
      "```tool_call\n" +
      '{"name": "func_name", "arguments": {...}}\n' +
      "```\n" +
      "Only use tool_call blocks when needed.\n\n" +
      `Available tools:\n${JSON.stringify(toolDefs, null, 2)}`
    );
  }
  for (const msg of messages) {
    const role = msg.role || "user";
    let content = msg.content || "";
    if (Array.isArray(content)) {
      content = content
        .filter((c: any) => c.type === "text" || c.type === "input_text")
        .map((c: any) => c.text || "")
        .join(" ");
    }
    if (role === "system") {
      parts.push(`[System instruction]: ${content}`);
    } else if (role === "assistant") {
      if (msg.tool_calls) {
        const tcStrs = msg.tool_calls.map((tc: any) => {
          const fn = tc.function || {};
          return `\`\`\`tool_call\n${JSON.stringify({ name: fn.name, arguments: fn.arguments })}\n\`\`\``;
        });
        parts.push(`[Assistant]: ${content || ""}\n` + tcStrs.join("\n"));
      } else {
        parts.push(`[Assistant]: ${content}`);
      }
    } else if (role === "tool") {
      parts.push(`[Tool result for ${msg.name || ""}]: ${content}`);
    } else {
      parts.push(content ? String(content) : "");
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

function parseToolCalls(text: string): { cleanText: string; toolCalls: any[] | null } {
  const toolCalls: any[] = [];
  const regex = /```tool_call\s*\n([\s\S]*?)\n```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      toolCalls.push({
        id: `call_${Math.random().toString(36).substring(2, 10)}`,
        type: "function",
        function: {
          name: data.name,
          arguments: JSON.stringify(data.arguments || {})
        }
      });
    } catch {}
  }
  const cleanText = text.replace(regex, "").trim();
  return { cleanText, toolCalls: toolCalls.length > 0 ? toolCalls : null };
}

async function verifyApiKey(authHeader: string | undefined, model: string): Promise<{
  valid: boolean;
  projectId?: string;
  apiKeyId?: string;
  error?: string;
}> {
  if (!authHeader) {
    return { valid: false, error: "Missing Authorization header" };
  }
  const key = authHeader.replace("Bearer ", "").trim();
  if (!key) {
    return { valid: false, error: "Invalid Authorization header format" };
  }
  if (!supabase) {
    if (key === "sk-personal-gw") {
      return {
        valid: true,
        projectId: "00000000-0000-0000-0000-000000000000",
        apiKeyId: "00000000-0000-0000-0000-000000000000"
      };
    }
    return { valid: false, error: "Database offline and key not default" };
  }
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, project_id, active, allowed_models")
    .eq("key", key)
    .single();
  if (error || !data) {
    return { valid: false, error: "Invalid API key" };
  }
  if (!data.active) {
    return { valid: false, error: "API key is deactivated" };
  }
  if (data.allowed_models && !data.allowed_models.includes(model)) {
    return { valid: false, error: `Model '${model}' is not allowed for this API key` };
  }
  return {
    valid: true,
    projectId: data.project_id,
    apiKeyId: data.id
  };
}

async function logUsage(
  projectId: string,
  apiKeyId: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  durationMs: number,
  statusCode: number
) {
  if (!supabase) return;
  try {
    await supabase.from("usage_logs").insert({
      project_id: projectId,
      api_key_id: apiKeyId,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      duration_ms: durationMs,
      status_code: statusCode
    });
  } catch (e) {
    logger.error({ err: e }, "Failed to write usage log to Supabase");
  }
}

async function geminiStreamGenerate(prompt: string, modelId: number, thinkMode: number): Promise<string> {
  const inner = new Array(80).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ["en"];
  inner[2] = ["", "", "", null, null, null, null, null, null, ""];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[thinkMode]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [2];
  inner[53] = 0;
  inner[59] = uuidv4();
  inner[61] = [];
  inner[68] = 1;
  inner[79] = modelId;

  const outer = [null, JSON.stringify(inner)];
  const bodyParams = new URLSearchParams();
  bodyParams.append("f.req", JSON.stringify(outer));

  const reqid = Math.floor(Date.now() / 1000) % 1000000;
  const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "";
  const url = `https://gemini.google.com${prefix}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${GEMINI_BL}&hl=en&_reqid=${reqid}&rt=c`;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://gemini.google.com",
    "Referer": `https://gemini.google.com${prefix}/app`,
    "X-Same-Domain": "1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  if (AUTH_USER) {
    headers["X-Goog-AuthUser"] = String(AUTH_USER);
  }

  const { cookieStr, sapisid } = loadCookie();
  if (cookieStr) {
    headers["Cookie"] = cookieStr;
  }
  if (sapisid) {
    headers["Authorization"] = makeSapisidHash(sapisid);
  }

  let lastErr: any = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyParams.toString()
      });
      if (!response.ok) {
        throw new Error(`Upstream returned ${response.status}`);
      }
      return await response.text();
    } catch (e) {
      lastErr = e;
      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_SEC * 1000));
      }
    }
  }
  throw lastErr;
}

server.register(import("@fastify/cors"), {
  origin: "*"
});

server.get("/health", async () => {
  return { status: "ok" };
});

server.get("/", async () => {
  return { status: "ok" };
});

server.get("/v1/models", async () => {
  return {
    object: "list",
    data: Object.entries(MODELS).map(([id, cfg]) => ({
      id,
      object: "model",
      created: 1700000000,
      owned_by: "google",
      description: cfg.desc
    }))
  };
});

server.post("/v1/chat/completions", async (request, reply) => {
  const req: any = request.body || {};
  const modelName = req.model || "gemini-3.5-flash";
  const cfg = MODELS[modelName];
  if (!cfg) {
    return reply.status(400).send({ error: { message: `Unknown model: ${modelName}` } });
  }

  const authHeader = request.headers.authorization;
  const auth = await verifyApiKey(authHeader, modelName);
  if (!auth.valid) {
    return reply.status(401).send({ error: { message: auth.error } });
  }

  const prompt = messagesToPrompt(req.messages || [], req.tools);
  if (!prompt.trim()) {
    return reply.status(400).send({ error: { message: "empty prompt" } });
  }

  const stream = req.stream === true;
  const cid = `chatcmpl-${uuidv4().replace(/-/g, "").substring(0, 12)}`;
  const startTime = Date.now();

  if (stream && !req.tools) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    let responseText = "";

    try {
      const inner = new Array(80).fill(null);
      inner[0] = [prompt, 0, null, null, null, null, 0];
      inner[1] = ["en"];
      inner[2] = ["", "", "", null, null, null, null, null, null, ""];
      inner[6] = [0];
      inner[7] = 1;
      inner[10] = 1;
      inner[11] = 0;
      inner[17] = [[cfg.think]];
      inner[18] = 0;
      inner[27] = 1;
      inner[30] = [4];
      inner[41] = [2];
      inner[53] = 0;
      inner[59] = uuidv4();
      inner[61] = [];
      inner[68] = 1;
      inner[79] = cfg.mode;

      const outer = [null, JSON.stringify(inner)];
      const bodyParams = new URLSearchParams();
      bodyParams.append("f.req", JSON.stringify(outer));

      const reqid = Math.floor(Date.now() / 1000) % 1000000;
      const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "";
      const url = `https://gemini.google.com${prefix}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${GEMINI_BL}&hl=en&_reqid=${reqid}&rt=c`;

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://gemini.google.com",
        "Referer": `https://gemini.google.com${prefix}/app`,
        "X-Same-Domain": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      };

      if (AUTH_USER) {
        headers["X-Goog-AuthUser"] = String(AUTH_USER);
      }

      const { cookieStr, sapisid } = loadCookie();
      if (cookieStr) {
        headers["Cookie"] = cookieStr;
      }
      if (sapisid) {
        headers["Authorization"] = makeSapisidHash(sapisid);
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyParams.toString()
      });

      if (!response.ok) {
        throw new Error(`Upstream returned ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body stream");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let prevText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.includes('"wrb.fr"') || line.length < 200) {
            continue;
          }
          try {
            const arr = JSON.parse(line);
            const innerStr = arr[0][2];
            if (!innerStr || innerStr.length < 50) continue;
            const inner2 = JSON.parse(innerStr);
            if (Array.isArray(inner2) && inner2[4]) {
              for (const part of inner2[4]) {
                if (Array.isArray(part) && part[1] && Array.isArray(part[1])) {
                  for (const t of part[1]) {
                    if (typeof t === "string" && t.length > prevText.length) {
                      let delta = t.substring(prevText.length);
                      delta = cleanGeminiText(delta);
                      if (delta) {
                        responseText += delta;
                        const chunk = {
                          id: cid,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: modelName,
                          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                        };
                        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
                      }
                      prevText = t;
                    }
                  }
                }
              }
            }
          } catch {}
        }
      }

      const finalChunk = {
        id: cid,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
      };
      reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();

      const durationMs = Date.now() - startTime;
      await logUsage(
        auth.projectId!,
        auth.apiKeyId!,
        modelName,
        Math.floor(prompt.length / 4),
        Math.floor(responseText.length / 4),
        durationMs,
        200
      );
    } catch (e) {
      logger.error({ err: e }, "Streaming error");
      const errChunk = {
        id: cid,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{ index: 0, delta: { content: `[Gateway Error: ${e instanceof Error ? e.message : String(e)}]` }, finish_reason: "stop" }]
      };
      reply.raw.write(`data: ${JSON.stringify(errChunk)}\n\n`);
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();

      const durationMs = Date.now() - startTime;
      await logUsage(
        auth.projectId!,
        auth.apiKeyId!,
        modelName,
        Math.floor(prompt.length / 4),
        0,
        durationMs,
        500
      );
    }
    return reply;
  }

  try {
    const raw = await geminiStreamGenerate(prompt, cfg.mode, cfg.think);
    const text = extractResponseText(raw);
    const { cleanText, toolCalls } = parseToolCalls(text);

    const msg: any = { role: "assistant", content: cleanText || null };
    if (toolCalls) {
      msg.tool_calls = toolCalls;
    }
    const finish = toolCalls ? "tool_calls" : "stop";

    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId!,
      auth.apiKeyId!,
      modelName,
      Math.floor(prompt.length / 4),
      Math.floor((cleanText || "").length / 4),
      durationMs,
      200
    );

    return {
      id: cid,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{ index: 0, message: msg, finish_reason: finish }],
      usage: {
        prompt_tokens: Math.floor(prompt.length / 4),
        completion_tokens: Math.floor((cleanText || "").length / 4),
        total_tokens: Math.floor((prompt.length + (cleanText || "").length) / 4)
      }
    };
  } catch (e) {
    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId!,
      auth.apiKeyId!,
      modelName,
      Math.floor(prompt.length / 4),
      0,
      durationMs,
      502
    );
    return reply.status(502).send({ error: { message: `Upstream error: ${e instanceof Error ? e.message : String(e)}` } });
  }
});

server.post("/v1/responses", async (request, reply) => {
  const req: any = request.body || {};
  const modelName = req.model || "gemini-3.5-flash";
  const cfg = MODELS[modelName];
  if (!cfg) {
    return reply.status(400).send({ error: { message: `Unknown model: ${modelName}` } });
  }

  const authHeader = request.headers.authorization;
  const auth = await verifyApiKey(authHeader, modelName);
  if (!auth.valid) {
    return reply.status(401).send({ error: { message: auth.error } });
  }

  const inputItems = req.input || [];
  const tools = req.tools;
  const messages: any[] = [];

  if (req.instructions) {
    messages.push({ role: "system", content: req.instructions });
  }

  if (typeof inputItems === "string") {
    messages.push({ role: "user", content: inputItems });
  } else if (Array.isArray(inputItems)) {
    for (const item of inputItems) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
      } else if (typeof item === "object" && item !== null) {
        if (item.type === "function_call_output") {
          messages.push({ role: "tool", tool_call_id: item.call_id || "", name: item.name || "", content: item.output || "" });
        } else if (item.role === "assistant" || (item.type === "message" && item.role === "assistant")) {
          const cp = item.content || [];
          let textAcc = "";
          const tcList: any[] = [];
          if (Array.isArray(cp)) {
            for (const c of cp) {
              if (typeof c === "object" && c !== null) {
                if (c.type === "output_text") textAcc += c.text || "";
                else if (c.type === "function_call") tcList.push(c);
              }
            }
          } else if (typeof cp === "string") {
            textAcc = cp;
          }
          const m: any = { role: "assistant", content: textAcc || null };
          if (tcList.length > 0) {
            m.tool_calls = tcList.map((tc, idx) => ({
              id: tc.call_id || `call_${idx}`,
              type: "function",
              function: { name: tc.name || "", arguments: tc.arguments || "{}" }
            }));
          }
          messages.push(m);
        } else {
          const role = item.role || "user";
          let content = item.content || "";
          if (Array.isArray(content)) {
            content = content
              .filter((c: any) => c.type === "text" || c.type === "input_text")
              .map((c: any) => c.text || "")
              .join(" ");
          }
          messages.push({ role, content });
        }
      }
    }
  }

  const prompt = messagesToPrompt(messages, tools);
  if (!prompt.trim()) {
    return reply.status(400).send({ error: { message: "empty input" } });
  }

  const startTime = Date.now();

  try {
    const raw = await geminiStreamGenerate(prompt, cfg.mode, cfg.think);
    const text = extractResponseText(raw);
    const { cleanText, toolCalls } = parseToolCalls(text);

    const rid = `resp_${crypto.randomBytes(8).toString("hex")}`;
    const mid = `msg_${crypto.randomBytes(6).toString("hex")}`;
    const output: any[] = [];

    if (toolCalls) {
      for (const tc of toolCalls) {
        output.push({
          type: "function_call",
          id: tc.id,
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: "completed"
        });
      }
    }

    if (cleanText || !toolCalls) {
      output.push({
        type: "message",
        id: mid,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: cleanText || "", annotations: [] }]
      });
    }

    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId!,
      auth.apiKeyId!,
      modelName,
      Math.floor(prompt.length / 4),
      Math.floor((cleanText || "").length / 4),
      durationMs,
      200
    );

    return {
      id: rid,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: modelName,
      output,
      usage: {
        input_tokens: Math.floor(prompt.length / 4),
        output_tokens: Math.floor((cleanText || "").length / 4),
        total_tokens: Math.floor((prompt.length + (cleanText || "").length) / 4)
      }
    };
  } catch (e) {
    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId!,
      auth.apiKeyId!,
      modelName,
      Math.floor(prompt.length / 4),
      0,
      durationMs,
      502
    );
    return reply.status(502).send({ error: { message: `Upstream error: ${e instanceof Error ? e.message : String(e)}` } });
  }
});

async function main() {
  try {
    await server.listen({ port: PORT, host: HOST });
    logger.info(`Gateway listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
