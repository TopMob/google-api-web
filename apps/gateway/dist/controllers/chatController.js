import { v4 as uuidv4 } from "uuid";
import { MODELS } from "@gateway/shared";
import { verifyApiKey, logUsage } from "../services/auth.js";
import { geminiStreamGenerate } from "../services/gemini.js";
import { extractResponseText, parseToolCalls, messagesToPrompt, cleanJsonResponse } from "../utils/parsers.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import { normalizeError } from "../utils/errors.js";
import { chatCompletionSchema } from "../utils/schemas.js";
import { handleChatStream, handleChatStreamWithTools } from "../services/streamService.js";
import { countTokens } from "../utils/tokens.js";
export async function chatCompletionController(request, reply) {
  const parseResult = chatCompletionSchema.safeParse(request.body);
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
  const prompt = messagesToPrompt(req.messages, req.tools, req.response_format);
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
  const abortController = new AbortController();
  request.raw.on("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });
  if (stream) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    if (!req.tools) {
      await handleChatStream(prompt, modelName, cfg, auth, reply, cid, startTime, abortController.signal);
    } else {
      await handleChatStreamWithTools(prompt, modelName, cfg, auth, reply, cid, startTime, abortController.signal);
    }
    return reply;
  }
  try {
    const raw = await geminiCircuitBreaker.execute(() =>
      geminiStreamGenerate(prompt, cfg.mode, cfg.think, customCookie, abortController.signal)
    );
    const text = extractResponseText(raw);
    const { cleanText, toolCalls } = parseToolCalls(text);
    let contentText = cleanText;
    if (req.response_format?.type === "json_object" && contentText) {
      contentText = cleanJsonResponse(contentText);
    }
    const msg = { role: "assistant", content: contentText || null };
    if (toolCalls) {
      msg.tool_calls = toolCalls;
    }
    const finish = toolCalls ? "tool_calls" : "stop";
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
      id: cid,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{ index: 0, message: msg, finish_reason: finish }],
      usage: {
        prompt_tokens: countTokens(prompt),
        completion_tokens: countTokens(cleanText || ""),
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
