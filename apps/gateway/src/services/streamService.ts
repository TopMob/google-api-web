import { FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { buildGeminiRequest } from "./gemini.js";
import { parseToolCalls, cleanGeminiText, ToolCallResult } from "../utils/parsers.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import { logUsage, AuthResult } from "./auth.js";
import { normalizeError } from "../utils/errors.js";
import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/fetchWithRetry.js";
import { countTokens } from "../utils/tokens.js";
import { ModelConfig } from "../utils/models.js";

export async function handleChatStream(
  prompt: string,
  modelName: string,
  cfg: ModelConfig,
  auth: AuthResult,
  reply: FastifyReply,
  cid: string,
  startTime: number,
  signal?: AbortSignal
) {
  const customCookie = auth.customCookie;
  let responseText = "";

  try {
    const { url, headers, body } = buildGeminiRequest(prompt, cfg.mode, cfg.think, customCookie);

    const response = await geminiCircuitBreaker.execute(async () => {
      return await fetchWithRetry(url, {
        method: "POST",
        headers,
        body,
        keepalive: true,
        signal
      });
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
          const inner = JSON.parse(innerStr);
          if (Array.isArray(inner)) {
            const candidates = [inner[4], inner[0]].filter(Boolean);
            let textFound = false;
            for (const candidate of candidates) {
              if (Array.isArray(candidate)) {
                let fullText = "";
                for (const part of candidate) {
                  if (Array.isArray(part) && Array.isArray(part[1])) {
                    fullText += part[1].filter((t: unknown) => typeof t === "string").join("");
                  }
                }
                if (fullText.trim()) {
                  textFound = true;
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
                  break;
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
      countTokens(prompt),
      countTokens(responseText),
      durationMs,
      200
    );
  } catch (e: unknown) {
    logger.error({ err: e }, "Streaming error");
    const normalized = normalizeError(e);
    const errChunk = {
      id: cid,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [
        { index: 0, delta: { content: `[Gateway Error: ${normalized.body.error.message}]` }, finish_reason: "stop" }
      ]
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
}

export async function handleChatStreamWithTools(
  prompt: string,
  modelName: string,
  cfg: ModelConfig,
  auth: AuthResult,
  reply: FastifyReply,
  cid: string,
  startTime: number,
  signal?: AbortSignal
) {
  const customCookie = auth.customCookie;
  let responseText = "";
  let streamedLength = 0;
  let toolSuspended = false;

  try {
    const { url, headers, body } = buildGeminiRequest(prompt, cfg.mode, cfg.think, customCookie);
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body,
      keepalive: true,
      signal
    });

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body stream");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.includes('"wrb.fr"') || line.length < 200) continue;
        try {
          const parsedLine = JSON.parse(line);
          const innerStr = parsedLine?.[0]?.[2];
          if (!innerStr || typeof innerStr !== "string") continue;

          const inner = JSON.parse(innerStr);
          if (Array.isArray(inner)) {
            const candidates = [inner[4], inner[0]].filter(Boolean);
            let textFound = false;
            for (const candidate of candidates) {
              if (Array.isArray(candidate)) {
                let fullText = "";
                for (const part of candidate) {
                  if (Array.isArray(part) && Array.isArray(part[1])) {
                    fullText += part[1].filter((t: unknown) => typeof t === "string").join("");
                  }
                }

                if (fullText.trim()) {
                  textFound = true;
                  const cleanedText = cleanGeminiText(fullText);
                  if (cleanedText.length > responseText.length) {
                    responseText = cleanedText;

                    if (!toolSuspended) {
                      if (
                        responseText.includes("```tool") ||
                        responseText.includes("```json") ||
                        responseText.includes("```javascript")
                      ) {
                        toolSuspended = true;
                      } else if (responseText.trim().startsWith("{") && responseText.trim().length < 150) {
                        toolSuspended = true;
                      }
                    }

                    if (!toolSuspended) {
                      const delta = responseText.substring(streamedLength);
                      if (delta) {
                        const chunk = {
                          id: cid,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: modelName,
                          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                        };
                        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        streamedLength = responseText.length;
                      }
                    }
                  }
                  break;
                }
              }
            }
          }
        } catch {}
      }
    }

    const { cleanText, toolCalls } = parseToolCalls(responseText);

    if (cleanText.length > streamedLength) {
      const delta = cleanText.substring(streamedLength);
      const chunk = {
        id: cid,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
      };
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    if (toolCalls) {
      const chunk = {
        id: cid,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: toolCalls.map((tc: ToolCallResult, idx: number) => ({
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
          }
        ]
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
      countTokens(prompt),
      countTokens(cleanText || ""),
      durationMs,
      200
    );
  } catch (e: unknown) {
    const errMessage = e instanceof Error ? e.message : String(e);
    logger.error({ err: errMessage }, "Streaming error with tools");
    const normalized = normalizeError(e);
    const errChunk = {
      id: cid,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [
        { index: 0, delta: { content: `[Gateway Error: ${normalized.body.error.message}]` }, finish_reason: "stop" }
      ]
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
}
