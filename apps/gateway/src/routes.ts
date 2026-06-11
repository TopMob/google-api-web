import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { MODELS } from "@gateway/shared";
import { verifyApiKey, logUsage } from "./services/auth.js";
import { buildGeminiRequest, geminiStreamGenerate } from "./services/gemini.js";
import { extractResponseText, parseToolCalls, messagesToPrompt, cleanGeminiText } from "./utils/parsers.js";
import { geminiCircuitBreaker } from "./utils/circuitBreaker.js";
import { normalizeError } from "./utils/errors.js";
import { isCookieValidCached, loadCookie } from "./utils/cookie.js";
import { chatCompletionSchema, responsesApiSchema } from "./utils/schemas.js";
import { logger } from "./logger.js";

export function registerRoutes(server: any) {
  server.get("/health", async (request: any, reply: any) => {
    const loaded = loadCookie();
    if (loaded.cookieStr) {
      const isValid = await isCookieValidCached(loaded.cookieStr, loaded.sapisid);
      if (!isValid) {
        return reply.status(200).send({
          status: "warning",
          message: "Gemini session cookie has expired or is invalid. Please refresh the cookie file."
        });
      }
    }
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

  server.post("/v1/chat/completions", async (request: any, reply: any) => {
    const parseResult = chatCompletionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          message: "Invalid request body: " + parseResult.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join(", "),
          type: "invalid_request_error",
          param: null,
          code: "invalid_body"
        }
      });
    }
    const req = parseResult.data;
    const modelName = req.model;
    const cfg = MODELS[modelName];
    if (!cfg) {
      return reply.status(400).send({
        error: {
          message: `Unknown model: ${modelName}`,
          type: "invalid_request_error",
          param: "model",
          code: "unknown_model"
        }
      });
    }

    const auth = await verifyApiKey(request, modelName);
    if (!auth.valid) {
      return reply.status(auth.statusCode || 401).send({
        error: {
          message: auth.error,
          type: "invalid_request_error",
          param: null,
          code: "invalid_api_key"
        }
      });
    }

    const prompt = messagesToPrompt(req.messages, req.tools);
    if (!prompt.trim()) {
      return reply.status(400).send({
        error: {
          message: "Empty prompt or messages",
          type: "invalid_request_error",
          param: "messages",
          code: "empty_prompt"
        }
      });
    }

    const stream = req.stream === true;
    const cid = `chatcmpl-${uuidv4().replace(/-/g, "").substring(0, 12)}`;
    const startTime = Date.now();
    const customCookie = auth.customCookie;

    if (stream) {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });

      if (!req.tools) {
        let responseText = "";

        try {
          const { url, headers, body } = buildGeminiRequest(prompt, cfg.mode, cfg.think, customCookie);

          const response = await geminiCircuitBreaker.execute(async () => {
            const res = await fetch(url, {
              method: "POST",
              headers,
              body,
              keepalive: true
            });
            if (!res.ok) {
              throw new Error(`Upstream returned ${res.status}`);
            }
            return res;
          });

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body stream");
          }

          const decoder = new TextDecoder();
          let buffer = "";
          let prevCleanedText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.includes('"wrb.fr"') || line.length < 200) continue;
              try {
                const innerStr = JSON.parse(line)[0][2];
                if (!innerStr || innerStr.length < 50) continue;
                const inner2 = JSON.parse(innerStr);
                if (Array.isArray(inner2) && inner2[4]) {
                  let fullText = "";
                  for (const part of inner2[4]) {
                    if (Array.isArray(part) && part[1] && Array.isArray(part[1])) {
                      fullText += part[1].filter((t: any) => typeof t === "string").join("");
                    }
                  }
                  const cleanedText = cleanGeminiText(fullText);
                  if (cleanedText.length > prevCleanedText.length) {
                    const delta = cleanedText.substring(prevCleanedText.length);
                    responseText += delta;
                    const chunk = {
                      id: cid,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: modelName,
                      choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                    };
                    reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    prevCleanedText = cleanedText;
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
          const normalized = normalizeError(e);
          const errChunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: { content: `[Gateway Error: ${normalized.body.error.message}]` }, finish_reason: "stop" }]
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
            normalized.status
          );
        }
        return reply;
      } else {
        try {
          const raw = await geminiCircuitBreaker.execute(() => geminiStreamGenerate(prompt, cfg.mode, cfg.think, customCookie));
          const text = extractResponseText(raw);
          const { cleanText, toolCalls } = parseToolCalls(text);

          if (cleanText) {
            const chunk = {
              id: cid,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelName,
              choices: [{ index: 0, delta: { content: cleanText }, finish_reason: null }]
            };
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }

          if (toolCalls) {
            const chunk = {
              id: cid,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelName,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: toolCalls.map((tc: any, idx: number) => ({
                    index: idx,
                    id: tc.id,
                    type: "function",
                    function: {
                      name: tc.function.name,
                      arguments: tc.function.arguments
                    }
                  }))
                },
                finish_reason: null
              }]
            };
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }

          const finish = toolCalls ? "tool_calls" : "stop";
          const finalChunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: finish }]
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
            Math.floor((cleanText || "").length / 4),
            durationMs,
            200
          );
        } catch (e) {
          logger.error({ err: e }, "Streaming error with tools");
          const normalized = normalizeError(e);
          const errChunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: { content: `[Gateway Error: ${normalized.body.error.message}]` }, finish_reason: "stop" }]
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
            normalized.status
          );
        }
        return reply;
      }
    }

    try {
      const raw = await geminiCircuitBreaker.execute(() => geminiStreamGenerate(prompt, cfg.mode, cfg.think, customCookie));
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
      const normalized = normalizeError(e);
      await logUsage(
        auth.projectId!,
        auth.apiKeyId!,
        modelName,
        Math.floor(prompt.length / 4),
        0,
        durationMs,
        normalized.status
      );
      return reply.status(normalized.status).send(normalized.body);
    }
  });

  server.post("/v1/responses", async (request: any, reply: any) => {
    const parseResult = responsesApiSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          message: "Invalid request body: " + parseResult.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join(", "),
          type: "invalid_request_error",
          param: null,
          code: "invalid_body"
        }
      });
    }
    const req = parseResult.data;
    const modelName = req.model;
    const cfg = MODELS[modelName];
    if (!cfg) {
      return reply.status(400).send({
        error: {
          message: `Unknown model: ${modelName}`,
          type: "invalid_request_error",
          param: "model",
          code: "unknown_model"
        }
      });
    }

    const auth = await verifyApiKey(request, modelName);
    if (!auth.valid) {
      return reply.status(auth.statusCode || 401).send({
        error: {
          message: auth.error,
          type: "invalid_request_error",
          param: null,
          code: "invalid_api_key"
        }
      });
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
      return reply.status(400).send({
        error: {
          message: "Empty input or instructions",
          type: "invalid_request_error",
          param: "input",
          code: "empty_input"
        }
      });
    }

    const startTime = Date.now();
    const customCookie = auth.customCookie;

    try {
      const raw = await geminiCircuitBreaker.execute(() => geminiStreamGenerate(prompt, cfg.mode, cfg.think, customCookie));
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
      const normalized = normalizeError(e);
      await logUsage(
        auth.projectId!,
        auth.apiKeyId!,
        modelName,
        Math.floor(prompt.length / 4),
        0,
        durationMs,
        normalized.status
      );
      return reply.status(normalized.status).send(normalized.body);
    }
  });
}
