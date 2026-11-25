import { FastifyRequest, FastifyReply } from "fastify";
import { resolveModelConfig, getModels } from "../utils/models.js";
import { verifyApiKey, logUsage } from "../services/auth.js";
import { geminiStreamGenerate } from "../services/gemini.js";
import { ChatMessage, extractResponseText, messagesToPrompt } from "../utils/parsers.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import {
  normalizeError,
  isUpstreamRateLimitMessage,
  UpstreamEmptyResponseError,
  UpstreamRateLimitError,
  ClientAbortedError
} from "../utils/errors.js";
import { countTokens } from "../utils/tokens.js";
import { extractImagesFromMessages, uploadAllImages } from "../services/multimodal.js";

export function parseGoogleModelAction(
  rawSegment: string
): { model: string; action: "generateContent" | "streamGenerateContent" } | null {
  const cleaned = rawSegment.replace(/^models\//, "");
  const colonIdx = cleaned.lastIndexOf(":");
  if (colonIdx <= 0) return null;

  const model = cleaned.slice(0, colonIdx);
  const action = cleaned.slice(colonIdx + 1);
  if (action !== "generateContent" && action !== "streamGenerateContent") {
    return null;
  }
  return { model, action };
}

function partsToContent(parts: any[]): string | Array<any> {
  if (!Array.isArray(parts)) return "";
  const hasImage = parts.some((p) => p && typeof p === "object" && p.inlineData?.data);
  if (!hasImage) {
    return parts
      .filter((p) => p && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }

  const contentParts: Array<any> = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (typeof part.text === "string") {
      contentParts.push({ type: "text", text: part.text });
    } else if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${part.inlineData.data}` }
      });
    }
  }
  return contentParts;
}

export function googleContentsToMessages(body: any): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (!body || typeof body !== "object") return messages;

  if (body.systemInstruction?.parts) {
    const sysText = partsToContent(body.systemInstruction.parts);
    if (typeof sysText === "string" && sysText.trim()) {
      messages.push({ role: "system", content: sysText });
    }
  }

  if (Array.isArray(body.contents)) {
    for (const item of body.contents) {
      if (!item || typeof item !== "object") continue;
      const role = item.role === "model" ? "assistant" : "user";
      const content = partsToContent(item.parts || []);
      messages.push({ role, content });
    }
  }

  return messages;
}

export function formatGoogleGenerateResponse(
  text: string,
  modelName: string,
  promptTokens: number,
  completionTokens: number
) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: "model"
        },
        finishReason: "STOP",
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: completionTokens,
      totalTokenCount: promptTokens + completionTokens
    },
    modelVersion: modelName
  };
}

export async function googleGetModelsController() {
  const models = getModels();
  return {
    models: Object.entries(models).map(([id, cfg]) => ({
      name: `models/${id}`,
      version: "0.0.1",
      displayName: id,
      description: cfg.desc,
      inputTokenLimit: 1048576,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"]
    }))
  };
}

export async function googleGetModelDetailController(request: FastifyRequest, reply: FastifyReply) {
  const params = request.params as { model?: string };
  const rawModel = (params.model || "").replace(/^models\//, "");
  const models = getModels();
  const cfg = models[rawModel];
  if (!cfg) {
    return reply.status(404).send({
      error: {
        code: 404,
        message: `Model '${rawModel}' not found`,
        status: "NOT_FOUND"
      }
    });
  }
  return {
    name: `models/${rawModel}`,
    version: "0.0.1",
    displayName: rawModel,
    description: cfg.desc,
    inputTokenLimit: 1048576,
    outputTokenLimit: 8192,
    supportedGenerationMethods: ["generateContent", "streamGenerateContent", "countTokens"]
  };
}

export async function googleGenerateContentController(request: FastifyRequest, reply: FastifyReply) {
  const params = request.params as { "*": string };
  const parsed = parseGoogleModelAction(params["*"] || "");
  if (!parsed) {
    return reply.status(404).send({
      error: {
        code: 404,
        message: "Unsupported Google Generative Language action",
        status: "NOT_FOUND"
      }
    });
  }

  const { config: cfg, cleanModelName: modelName } = resolveModelConfig(parsed.model);
  const auth = await verifyApiKey(request, modelName);
  if (!auth.valid) {
    return reply.status(auth.statusCode || 401).send({
      error: {
        code: auth.statusCode || 401,
        message: auth.error,
        status: auth.statusCode === 429 ? "RESOURCE_EXHAUSTED" : "UNAUTHENTICATED"
      }
    });
  }

  const messages = googleContentsToMessages(request.body);
  const prompt = messagesToPrompt(messages);
  if (!prompt.trim()) {
    return reply.status(400).send({
      error: {
        code: 400,
        message: "Empty contents in generateContent request",
        status: "INVALID_ARGUMENT"
      }
    });
  }

  const startTime = Date.now();
  const abortController = new AbortController();
  request.raw.on("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const imageInputs = await extractImagesFromMessages(messages);
    const fileRefs = imageInputs.length > 0 ? await uploadAllImages(imageInputs, auth.customCookie) : undefined;

    const raw = await geminiCircuitBreaker.execute(() =>
      geminiStreamGenerate(
        prompt,
        cfg.mode,
        cfg.think,
        auth.customCookie,
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
    if (!text.trim()) {
      throw new UpstreamEmptyResponseError();
    }
    const promptTokens = countTokens(prompt);
    const completionTokens = countTokens(text);
    const payload = formatGoogleGenerateResponse(text, modelName, promptTokens, completionTokens);
    const durationMs = Date.now() - startTime;

    await logUsage(auth.projectId!, auth.apiKeyId!, modelName, promptTokens, completionTokens, durationMs, 200);

    if (parsed.action === "streamGenerateContent") {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      reply.raw.end();
      return reply;
    }

    return payload;
  } catch (e) {
    const durationMs = Date.now() - startTime;
    const normalized = normalizeError(e);
    await logUsage(auth.projectId!, auth.apiKeyId!, modelName, countTokens(prompt), 0, durationMs, normalized.status);
    const googleStatus =
      normalized.status === 429
        ? "RESOURCE_EXHAUSTED"
        : normalized.status === 401
          ? "UNAUTHENTICATED"
          : normalized.status === 403
            ? "PERMISSION_DENIED"
            : normalized.status === 400
              ? "INVALID_ARGUMENT"
              : "INTERNAL";
    return reply.status(normalized.status).send({
      error: {
        code: normalized.status,
        message: normalized.body?.error?.message || "Gateway error",
        status: googleStatus
      }
    });
  }
}
