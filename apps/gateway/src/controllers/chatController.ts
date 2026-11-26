import { FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import { resolveModelConfig } from "../utils/models.js";
import { verifyApiKey, logUsage } from "../services/auth.js";
import { geminiStreamGenerate } from "../services/gemini.js";
import {
  extractResponseText,
  parseToolCalls,
  applyRooCodeToolFallback,
  applyStopSequences,
  messagesToPrompt,
  cleanJsonResponse
} from "../utils/parsers.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import {
  normalizeError,
  isUpstreamRateLimitMessage,
  UpstreamEmptyResponseError,
  UpstreamRateLimitError,
  ClientAbortedError
} from "../utils/errors.js";
import { chatCompletionSchema } from "../utils/schemas.js";
import { handleChatStream, handleChatStreamWithTools } from "../services/streamService.js";
import { countTokens } from "../utils/tokens.js";
import { extractImagesFromMessages, uploadAllImages } from "../services/multimodal.js";
import { logger } from "../logger.js";

export async function chatCompletionController(request: FastifyRequest, reply: FastifyReply) {
  const parseResult = chatCompletionSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      error: {
        message:
          "Invalid request body: " +
          parseResult.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join(", "),
        type: "invalid_request_error",
        param: null,
        code: "invalid_body"
      }
    });
  }
  const req = parseResult.data;
  const rawModelName = req.model;
  const { config: cfg, cleanModelName: modelName } = resolveModelConfig(rawModelName, req.reasoning_effort);

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

  const prompt = messagesToPrompt(req.messages, req.tools, req.response_format, req.tool_choice);
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
  const cid = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").substring(0, 12)}`;
  const startTime = Date.now();
  const customCookie = auth.customCookie;

  const abortController = new AbortController();
  request.raw.on("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });

  let fileRefs: string[] | undefined;
  try {
    const imageInputs = await extractImagesFromMessages(req.messages);
    if (imageInputs.length > 0) {
      fileRefs = await uploadAllImages(imageInputs, customCookie);
    }
  } catch (imgErr) {
    const durationMs = Date.now() - startTime;
    const normalized = normalizeError(imgErr);
    await logUsage(auth.projectId!, auth.apiKeyId!, modelName, countTokens(prompt), 0, durationMs, normalized.status);
    return reply.status(normalized.status).send(normalized.body);
  }

  const includeUsage = req.stream_options?.include_usage === true;
  const hasActiveTools = Boolean(req.tools && req.tools.length > 0 && req.tool_choice !== "none");

  if (stream) {
    if (!hasActiveTools) {
      await handleChatStream(
        prompt,
        modelName,
        cfg,
        auth,
        reply,
        cid,
        startTime,
        abortController.signal,
        fileRefs,
        includeUsage,
        req.stop
      );
    } else {
      await handleChatStreamWithTools(
        prompt,
        modelName,
        cfg,
        auth,
        reply,
        cid,
        startTime,
        abortController.signal,
        fileRefs,
        includeUsage,
        req.tools!,
        req.tool_choice,
        req.stop
      );
    }
    return reply;
  }

  try {
    const raw = await geminiCircuitBreaker.execute(() =>
      geminiStreamGenerate(
        prompt,
        cfg.mode,
        cfg.think,
        customCookie,
        abortController.signal,
        fileRefs,
        auth.temporaryChats
      )
    );
    if (abortController.signal.aborted) {
      throw new ClientAbortedError();
    }
    const text = extractResponseText(raw);
    if (isUpstreamRateLimitMessage(text)) {
      throw new UpstreamRateLimitError();
    }

    let cleanText = text;
    let toolCalls: any = null;

    if (hasActiveTools) {
      const parsed = parseToolCalls(text, req.tools);
      cleanText = parsed.cleanText;
      if (!parsed.toolCalls && req.stop) {
        cleanText = applyStopSequences(cleanText, req.stop).text;
      }
      toolCalls = applyRooCodeToolFallback(cleanText, parsed.toolCalls, req.tools, req.tool_choice);
      if (!parsed.toolCalls && toolCalls) {
        cleanText = "";
      }
    } else if (req.stop) {
      cleanText = applyStopSequences(cleanText, req.stop).text;
    }

    let contentText = cleanText;
    if ((req.response_format?.type === "json_object" || req.response_format?.type === "json_schema") && contentText) {
      contentText = cleanJsonResponse(contentText);
    }

    if (isUpstreamRateLimitMessage(contentText)) {
      throw new UpstreamRateLimitError();
    }

    const hasAssistantContent = Boolean(contentText && contentText.trim());
    const hasToolCalls = Boolean(toolCalls && toolCalls.length > 0);
    if (!hasAssistantContent && !hasToolCalls) {
      throw new UpstreamEmptyResponseError();
    }

    const msg: any = { role: "assistant", content: contentText || null };
    if (toolCalls) {
      msg.tool_calls = toolCalls;
    }
    const finish = toolCalls ? "tool_calls" : "stop";

    const promptTokens = countTokens(prompt);
    const completionTokens = countTokens(cleanText || "");
    const durationMs = Date.now() - startTime;
    await logUsage(auth.projectId!, auth.apiKeyId!, modelName, promptTokens, completionTokens, durationMs, 200);

    return {
      id: cid,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{ index: 0, message: msg, finish_reason: finish }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    };
  } catch (e) {
    const durationMs = Date.now() - startTime;
    const normalized = normalizeError(e);
    logger.warn(
      { status: normalized.status, model: modelName, durationMs, code: normalized.body?.error?.code, err: e },
      "Chat completion request failed"
    );
    await logUsage(auth.projectId!, auth.apiKeyId!, modelName, countTokens(prompt), 0, durationMs, normalized.status);
    return reply.status(normalized.status).send(normalized.body);
  }
}
