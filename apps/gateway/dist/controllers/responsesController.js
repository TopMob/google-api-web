import crypto from "crypto";
import { MODELS } from "@gateway/shared";
import { verifyApiKey, logUsage } from "../services/auth.js";
import { geminiStreamGenerate } from "../services/gemini.js";
import { extractResponseText, parseToolCalls, messagesToPrompt } from "../utils/parsers.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import { normalizeError } from "../utils/errors.js";
import { responsesApiSchema } from "../utils/schemas.js";
import { countTokens } from "../utils/tokens.js";
export async function responsesApiController(request, reply) {
  const parseResult = responsesApiSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      error: {
        message:
          "Invalid request body: " +
          parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
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
  const messages = [];
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
          messages.push({
            role: "tool",
            tool_call_id: item.call_id || "",
            name: item.name || "",
            content: item.output || ""
          });
        } else if (item.role === "assistant" || (item.type === "message" && item.role === "assistant")) {
          const cp = item.content || [];
          let textAcc = "";
          const tcList = [];
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
          const m = { role: "assistant", content: textAcc || null };
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
              .filter((c) => c.type === "text" || c.type === "input_text")
              .map((c) => c.text || "")
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
  const abortController = new AbortController();
  request.raw.on("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });
  try {
    const raw = await geminiCircuitBreaker.execute(() =>
      geminiStreamGenerate(prompt, cfg.mode, cfg.think, customCookie, abortController.signal)
    );
    const text = extractResponseText(raw);
    const { cleanText, toolCalls } = parseToolCalls(text);
    const rid = `resp_${crypto.randomBytes(8).toString("hex")}`;
    const mid = `msg_${crypto.randomBytes(6).toString("hex")}`;
    const output = [];
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
      auth.projectId,
      auth.apiKeyId,
      modelName,
      countTokens(prompt),
      countTokens(cleanText || ""),
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
        input_tokens: countTokens(prompt),
        output_tokens: countTokens(cleanText || ""),
        total_tokens: countTokens(prompt) + countTokens(cleanText || "")
      }
    };
  } catch (e) {
    const durationMs = Date.now() - startTime;
    const normalized = normalizeError(e);
    await logUsage(auth.projectId, auth.apiKeyId, modelName, countTokens(prompt), 0, durationMs, normalized.status);
    return reply.status(normalized.status).send(normalized.body);
  }
}
