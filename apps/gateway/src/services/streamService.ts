import { FastifyReply } from "fastify";
import { AuthResult } from "./auth.js";
import { ModelConfig } from "../utils/models.js";
import { buildGeminiRequest } from "./gemini.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import { fetchWithRetry } from "../utils/fetchWithRetry.js";
import { logUsage } from "./auth.js";
import { countTokens } from "../utils/tokens.js";
import {
  cleanGeminiText,
  parseToolCalls,
  applyRooCodeToolFallback,
  ToolCallResult,
  ToolDefinition
} from "../utils/parsers.js";
import { logger } from "../logger.js";
import { invalidateGeminiSessionCache } from "../utils/cookie.js";
import {
  normalizeError,
  isUpstreamRateLimitMessage,
  isPotentialRateLimitPrefix,
  UpstreamEmptyResponseError,
  UpstreamRateLimitError,
  ClientAbortedError
} from "../utils/errors.js";

function ensureSseHeaders(reply: FastifyReply) {
  if (!reply.raw.headersSent && reply.raw.writable && !reply.raw.writableEnded) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
  }
}

function writeSseChunk(reply: FastifyReply, payload: unknown) {
  if (reply.raw.writable && !reply.raw.writableEnded) {
    ensureSseHeaders(reply);
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

async function handleStreamError(
  e: unknown,
  reply: FastifyReply,
  cid: string,
  modelName: string,
  prompt: string,
  auth: AuthResult,
  startTime: number,
  contextLabel: string
) {
  const normalized = normalizeError(e);
  const durationMs = Date.now() - startTime;
  logger.warn(
    { status: normalized.status, model: modelName, durationMs, code: normalized.body?.error?.code, err: e },
    contextLabel
  );

  if (reply.raw.writable && !reply.raw.writableEnded) {
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(normalized.status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      reply.raw.end(JSON.stringify(normalized.body));
    } else {
      if (normalized.status !== 499) {
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
      }
      reply.raw.end();
    }
  }

  await logUsage(auth.projectId!, auth.apiKeyId!, modelName, countTokens(prompt), 0, durationMs, normalized.status);
}

const MAX_EMPTY_STREAM_RETRIES = 2;

async function retryOnEmptyUpstream(
  modelName: string,
  reply: FastifyReply,
  signal: AbortSignal | undefined,
  fn: () => Promise<void>
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_EMPTY_STREAM_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (e: unknown) {
      const isEmpty = e instanceof UpstreamEmptyResponseError;
      const canRetry =
        isEmpty &&
        attempt < MAX_EMPTY_STREAM_RETRIES &&
        !reply.raw.headersSent &&
        !signal?.aborted &&
        reply.raw.writable &&
        !reply.raw.writableEnded;

      if (!canRetry) {
        throw e;
      }

      invalidateGeminiSessionCache();
      logger.warn(
        { attempt: attempt + 1, maxRetries: MAX_EMPTY_STREAM_RETRIES, model: modelName },
        "Upstream stream returned empty response, invalidating session cache and retrying..."
      );
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

export async function handleChatStream(
  prompt: string,
  modelName: string,
  cfg: ModelConfig,
  auth: AuthResult,
  reply: FastifyReply,
  cid: string,
  startTime: number,
  signal?: AbortSignal,
  fileRefs?: string[],
  includeUsage = false
) {
  const customCookie = auth.customCookie;

  try {
    await retryOnEmptyUpstream(modelName, reply, signal, async () => {
      let responseText = "";
      const { url, headers, body } = await buildGeminiRequest(
        prompt,
        cfg.mode,
        cfg.think,
        customCookie,
        fileRefs,
        auth.temporaryChats
      );

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
      let streamedLength = 0;
      let isCompleted = false;

      while (!isCompleted) {
        if (signal?.aborted) {
          throw new ClientAbortedError();
        }
        if (reply.raw.writableEnded || !reply.raw.writable) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          // Check for Google End-Of-Stream markers
          if (line.includes('["di",') || line.includes('["e",') || line.includes('"af.httprm"')) {
            isCompleted = true;
            break;
          }

          if (!line.includes('"wrb.fr"') || line.length < 50) continue;
          try {
            const innerStr = JSON.parse(line)[0][2];
            if (!innerStr || innerStr.length < 20) continue;
            const inner = JSON.parse(innerStr);
            if (Array.isArray(inner)) {
              const candidates = [inner[4], inner[0]].filter(Boolean);
              for (const candidate of candidates) {
                if (Array.isArray(candidate)) {
                  let fullText = "";
                  let candidateFinished = false;

                  for (const part of candidate) {
                    if (Array.isArray(part)) {
                      if (Array.isArray(part[1])) {
                        fullText += part[1].filter((t: unknown) => typeof t === "string").join("");
                      }
                      const statusArr = part[8];
                      if (Array.isArray(statusArr) && statusArr.includes(2)) {
                        candidateFinished = true;
                      }
                    }
                  }

                  if (fullText.trim()) {
                    const cleanedText = cleanGeminiText(fullText);
                    if (isUpstreamRateLimitMessage(cleanedText)) {
                      throw new UpstreamRateLimitError();
                    }

                    if (cleanedText.length > prevCleanedText.length) {
                      responseText = cleanedText;
                      prevCleanedText = cleanedText;

                      if (!isPotentialRateLimitPrefix(cleanedText)) {
                        const delta = cleanedText.substring(streamedLength);
                        if (delta) {
                          const chunk = {
                            id: cid,
                            object: "chat.completion.chunk",
                            created: Math.floor(Date.now() / 1000),
                            model: modelName,
                            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                          };
                          writeSseChunk(reply, chunk);
                          streamedLength = cleanedText.length;
                        }
                      }
                    }

                    if (candidateFinished) {
                      isCompleted = true;
                    }
                    break;
                  }
                }
              }
            }
          } catch (parseErr) {
            if (parseErr instanceof UpstreamRateLimitError) {
              throw parseErr;
            }
          }

          if (isCompleted) break;
        }
      }

      try {
        reader.cancel();
      } catch {}

      if (signal?.aborted) {
        throw new ClientAbortedError();
      }
      if (isUpstreamRateLimitMessage(responseText)) {
        throw new UpstreamRateLimitError();
      }
      if (!responseText.trim()) {
        throw new UpstreamEmptyResponseError();
      }

      const promptTokens = countTokens(prompt);
      const completionTokens = countTokens(responseText);

      if (reply.raw.writable && !reply.raw.writableEnded) {
        if (responseText.length > streamedLength) {
          const delta = responseText.substring(streamedLength);
          const chunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
          };
          writeSseChunk(reply, chunk);
        }

        const finalChunk = {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        };
        writeSseChunk(reply, finalChunk);

        if (includeUsage) {
          const usageChunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens
            }
          };
          writeSseChunk(reply, usageChunk);
        }

        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
      }

      const durationMs = Date.now() - startTime;
      await logUsage(auth.projectId!, auth.apiKeyId!, modelName, promptTokens, completionTokens, durationMs, 200);
    });
  } catch (e: unknown) {
    await handleStreamError(e, reply, cid, modelName, prompt, auth, startTime, "Streaming error");
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
  signal?: AbortSignal,
  fileRefs?: string[],
  includeUsage = false,
  tools?: ToolDefinition[]
) {
  const customCookie = auth.customCookie;
  const hasAttemptCompletion = Boolean(
    tools?.some((t) => {
      const name = t.type === "function" ? t.function?.name || t.name : t.name;
      return name === "attempt_completion";
    })
  );

  try {
    await retryOnEmptyUpstream(modelName, reply, signal, async () => {
      let responseText = "";
      let streamedLength = 0;
      let toolSuspended = false;
      const { url, headers, body } = await buildGeminiRequest(
        prompt,
        cfg.mode,
        cfg.think,
        customCookie,
        fileRefs,
        auth.temporaryChats
      );
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
      let isCompleted = false;

      while (!isCompleted) {
        if (signal?.aborted) {
          throw new ClientAbortedError();
        }
        if (reply.raw.writableEnded || !reply.raw.writable) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.includes('["di",') || line.includes('["e",') || line.includes('"af.httprm"')) {
            isCompleted = true;
            break;
          }

          if (!line.includes('"wrb.fr"') || line.length < 50) continue;
          try {
            const parsedLine = JSON.parse(line);
            const innerStr = parsedLine?.[0]?.[2];
            if (!innerStr || typeof innerStr !== "string") continue;

            const inner = JSON.parse(innerStr);
            if (Array.isArray(inner)) {
              const candidates = [inner[4], inner[0]].filter(Boolean);
              for (const candidate of candidates) {
                if (Array.isArray(candidate)) {
                  let fullText = "";
                  let candidateFinished = false;

                  for (const part of candidate) {
                    if (Array.isArray(part)) {
                      if (Array.isArray(part[1])) {
                        fullText += part[1].filter((t: unknown) => typeof t === "string").join("");
                      }
                      const statusArr = part[8];
                      if (Array.isArray(statusArr) && statusArr.includes(2)) {
                        candidateFinished = true;
                      }
                    }
                  }

                  if (fullText.trim()) {
                    const cleanedText = cleanGeminiText(fullText);
                    if (isUpstreamRateLimitMessage(cleanedText)) {
                      throw new UpstreamRateLimitError();
                    }

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

                      if (!toolSuspended && !hasAttemptCompletion && !isPotentialRateLimitPrefix(responseText)) {
                        const delta = responseText.substring(streamedLength);
                        if (delta) {
                          const chunk = {
                            id: cid,
                            object: "chat.completion.chunk",
                            created: Math.floor(Date.now() / 1000),
                            model: modelName,
                            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                          };
                          writeSseChunk(reply, chunk);
                          streamedLength = responseText.length;
                        }
                      }
                    }

                    if (candidateFinished) {
                      isCompleted = true;
                    }
                    break;
                  }
                }
              }
            }
          } catch (parseErr) {
            if (parseErr instanceof UpstreamRateLimitError) {
              throw parseErr;
            }
          }

          if (isCompleted) break;
        }
      }

      try {
        reader.cancel();
      } catch {}

      if (signal?.aborted) {
        throw new ClientAbortedError();
      }
      if (isUpstreamRateLimitMessage(responseText)) {
        throw new UpstreamRateLimitError();
      }

      const parsed = parseToolCalls(responseText);
      const cleanText = parsed.cleanText;
      const toolCalls = applyRooCodeToolFallback(cleanText, parsed.toolCalls, tools);
      const fallbackUsed = !parsed.toolCalls && Boolean(toolCalls);

      if (isUpstreamRateLimitMessage(cleanText)) {
        throw new UpstreamRateLimitError();
      }
      if (!cleanText.trim() && (!toolCalls || toolCalls.length === 0)) {
        throw new UpstreamEmptyResponseError();
      }

      const promptTokens = countTokens(prompt);
      const completionTokens = countTokens(cleanText);

      if (reply.raw.writable && !reply.raw.writableEnded) {
        if (!fallbackUsed && cleanText.length > streamedLength) {
          const delta = cleanText.substring(streamedLength);
          const chunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
          };
          writeSseChunk(reply, chunk);
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
                finish_reason: "tool_calls"
              }
            ]
          };
          writeSseChunk(reply, chunk);
        } else {
          const chunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
          };
          writeSseChunk(reply, chunk);
        }

        if (includeUsage) {
          const usageChunk = {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens
            }
          };
          writeSseChunk(reply, usageChunk);
        }

        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
      }

      const durationMs = Date.now() - startTime;
      await logUsage(auth.projectId!, auth.apiKeyId!, modelName, promptTokens, completionTokens, durationMs, 200);
    });
  } catch (e: unknown) {
    await handleStreamError(e, reply, cid, modelName, prompt, auth, startTime, "Streaming with tools error");
  }
}
