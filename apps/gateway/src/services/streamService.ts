import { FastifyReply } from "fastify";
import { AuthResult, logUsage } from "./auth.js";
import { ModelConfig } from "../utils/models.js";
import { buildGeminiRequest, readChunkWithTimeout } from "./gemini.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import { fetchWithRetry } from "../utils/fetchWithRetry.js";
import { countTokens } from "../utils/tokens.js";
import {
  cleanGeminiText,
  detectBardErrorInfo,
  parseToolCalls,
  applyRooCodeToolFallback,
  applyStopSequences,
  ToolCallResult,
  ToolDefinition
} from "../utils/parsers.js";
import { logger } from "../logger.js";
import { recordResponseSetCookies } from "../utils/cookie.js";
import {
  normalizeError,
  isUpstreamRateLimitMessage,
  isPotentialRateLimitPrefix,
  UpstreamEmptyResponseError,
  UpstreamRateLimitError,
  UpstreamRejectedError,
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
  geminiCircuitBreaker.recordFailure(e);
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
        const errPayload = {
          error: {
            message: `Gateway Error: ${normalized.body.error.message}`,
            type: normalized.body.error.type,
            param: null,
            code: normalized.body.error.code
          }
        };
        reply.raw.write(`data: ${JSON.stringify(errPayload)}\n\n`);
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
  fn: (attempt: number) => Promise<void>
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_EMPTY_STREAM_RETRIES; attempt++) {
    try {
      await fn(attempt);
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

      logger.warn(
        { attempt: attempt + 1, maxRetries: MAX_EMPTY_STREAM_RETRIES, model: modelName },
        "Upstream stream returned empty response, retrying..."
      );
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

function getSafeFlushLimit(text: string, alreadySentLength: number, tools?: ToolDefinition[] | null): number {
  const tail = text.slice(alreadySentLength);
  if (!tail) return alreadySentLength;

  // Check for any ``` code fences in the unsent tail (or an unclosed fence starting earlier)
  let fenceIdx = text.indexOf("```", Math.max(0, alreadySentLength - 3));
  while (fenceIdx !== -1) {
    const afterTicks = text.slice(fenceIdx + 3);
    const newlineIdx = afterTicks.indexOf("\n");

    // Header line of fence hasn't finished yet — hold back from fenceIdx
    if (newlineIdx === -1) {
      return Math.min(text.length, fenceIdx);
    }

    const langTag = afterTicks.slice(0, newlineIdx).trim().toLowerCase();
    const isToolCandidateLang =
      langTag === "tool_call" ||
      langTag === "tool" ||
      langTag === "json" ||
      langTag === "jsonc" ||
      langTag === "javascript" ||
      langTag === "js" ||
      langTag === "typescript" ||
      langTag === "ts" ||
      langTag === "";

    if (isToolCandidateLang) {
      const bodyStart = fenceIdx + 3 + newlineIdx + 1;
      const closeFenceIdx = text.indexOf("```", bodyStart);
      if (closeFenceIdx === -1) {
        // Fence is still open: if it's ```tool_call, always hold; otherwise hold only if body starts like a JSON object
        const trimmedBody = text.slice(bodyStart).trimStart();
        if (langTag.startsWith("tool") || trimmedBody.length === 0 || trimmedBody.startsWith("{")) {
          return Math.min(text.length, fenceIdx);
        }
        // Normal non-tool code block (e.g. ```javascript\nconst x = 1;) -> safe to stream!
        return text.length;
      }

      // Fence is closed: verify whether it actually parses as a declared tool call
      const fullFence = text.slice(fenceIdx, closeFenceIdx + 3);
      const parsed = parseToolCalls(fullFence, tools);
      if (parsed.toolCalls && parsed.toolCalls.length > 0) {
        // Hold back from fenceIdx until end of generation so parseToolCalls strips it cleanly
        return Math.min(text.length, fenceIdx);
      }

      // Not a tool call (e.g. a normal JSON example in explanation) -> advance past this fence
      fenceIdx = text.indexOf("```", closeFenceIdx + 3);
      continue;
    }

    // Other language fence (e.g. ```python, ```bash, ```tsx) -> find closing fence if any and continue
    const closeIdx = text.indexOf("```", fenceIdx + 3 + newlineIdx + 1);
    if (closeIdx === -1) {
      break;
    }
    fenceIdx = text.indexOf("```", closeIdx + 3);
  }

  // Also hold back raw JSON object at the start of response or right after a newline if it could be a tool call
  const trimmedTail = tail.trimStart();
  if (trimmedTail.startsWith("{") && trimmedTail.length < 250) {
    const bracePos = text.indexOf("{", alreadySentLength);
    if (bracePos !== -1) {
      return Math.min(text.length, bracePos);
    }
  }

  // Hold back 1-2 trailing backticks so a split ``` fence doesn't leak
  if (text.endsWith("``")) return Math.max(alreadySentLength, text.length - 2);
  if (text.endsWith("`")) return Math.max(alreadySentLength, text.length - 1);

  return text.length;
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
  includeUsage = false,
  stop?: string | string[] | null
) {
  const customCookie = auth.customCookie;

  try {
    await retryOnEmptyUpstream(modelName, reply, signal, async (attempt) => {
      let responseText = "";
      const { url, headers, body } = await buildGeminiRequest(
        prompt,
        cfg.mode,
        cfg.think,
        customCookie,
        fileRefs,
        auth.temporaryChats,
        attempt === 1
      );

      const response = await geminiCircuitBreaker.execute(async () => {
        return await fetchWithRetry(
          url,
          {
            method: "POST",
            headers,
            body,
            signal
          },
          { timeoutMs: 60000 }
        );
      });
      recordResponseSetCookies(response);

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body stream");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let prevCleanedText = "";
      let sentText = "";
      let sentRole = false;
      let stoppedBySequence = false;
      let isCompleted = false;

      const emitDelta = (delta: string) => {
        if (!delta) return;
        if (!sentRole) {
          writeSseChunk(reply, {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
          });
          sentRole = true;
        }
        writeSseChunk(reply, {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
        });
      };

      const processLine = (line: string) => {
        const bardCode = detectBardErrorInfo(line);
        if (bardCode) {
          throw new UpstreamRejectedError(`Gemini upstream rejected request: BardErrorInfo [${bardCode}]`, bardCode);
        }
        if (line.includes('["di",') || line.includes('["e",') || line.includes('"af.httprm"')) {
          isCompleted = true;
          return;
        }

        if (!line.includes('"wrb.fr"') || line.length < 50) return;
        try {
          const innerStr = JSON.parse(line)[0][2];
          if (!innerStr || innerStr.length < 20) return;
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
                  const rawCleaned = cleanGeminiText(fullText);
                  const stopApplied = applyStopSequences(rawCleaned, stop);
                  const cleanedText = stopApplied.text;
                  if (stopApplied.stopped) {
                    stoppedBySequence = true;
                    candidateFinished = true;
                  }

                  if (isUpstreamRateLimitMessage(cleanedText)) {
                    throw new UpstreamRateLimitError();
                  }

                  if (cleanedText.length > prevCleanedText.length || stoppedBySequence) {
                    responseText = cleanedText;
                    prevCleanedText = cleanedText;

                    if (!isPotentialRateLimitPrefix(cleanedText)) {
                      const delta = cleanedText.startsWith(sentText)
                        ? cleanedText.slice(sentText.length)
                        : cleanedText.length > sentText.length
                          ? cleanedText.slice(sentText.length)
                          : "";
                      if (delta) {
                        emitDelta(delta);
                        sentText = cleanedText;
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
          if (parseErr instanceof UpstreamRateLimitError || parseErr instanceof UpstreamRejectedError) {
            throw parseErr;
          }
        }
      };

      try {
        while (!isCompleted) {
          if (signal?.aborted) {
            throw new ClientAbortedError();
          }
          if (reply.raw.writableEnded || !reply.raw.writable) {
            break;
          }

          const { done, value } = await readChunkWithTimeout(reader, undefined, signal);
          if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) {
              for (const tailLine of buffer.split("\n")) {
                processLine(tailLine);
                if (isCompleted) break;
              }
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            processLine(line);
            if (isCompleted) break;
          }
        }
      } finally {
        try {
          reader.cancel().catch(() => {});
        } catch {}
      }

      if (signal?.aborted) {
        throw new ClientAbortedError();
      }
      if (isUpstreamRateLimitMessage(responseText)) {
        throw new UpstreamRateLimitError();
      }
      if (!responseText.trim()) {
        throw new UpstreamEmptyResponseError();
      }

      geminiCircuitBreaker.recordSuccess();

      const promptTokens = countTokens(prompt);
      const completionTokens = countTokens(responseText);

      if (reply.raw.writable && !reply.raw.writableEnded) {
        if (responseText.length > sentText.length) {
          const delta = responseText.startsWith(sentText)
            ? responseText.slice(sentText.length)
            : responseText.slice(sentText.length);
          emitDelta(delta);
        }

        writeSseChunk(reply, {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        });

        if (includeUsage) {
          writeSseChunk(reply, {
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
          });
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
  tools?: ToolDefinition[],
  toolChoice?: string | Record<string, unknown> | null,
  stop?: string | string[] | null
) {
  const customCookie = auth.customCookie;
  const hasAttemptCompletion = Boolean(
    tools?.some((t) => {
      const name = t.type === "function" ? t.function?.name || t.name : t.name;
      return name === "attempt_completion";
    })
  );

  try {
    await retryOnEmptyUpstream(modelName, reply, signal, async (attempt) => {
      let responseText = "";
      let sentText = "";
      let sentRole = false;

      const { url, headers, body } = await buildGeminiRequest(
        prompt,
        cfg.mode,
        cfg.think,
        customCookie,
        fileRefs,
        auth.temporaryChats,
        attempt === 1
      );
      const response = await geminiCircuitBreaker.execute(async () => {
        return await fetchWithRetry(
          url,
          {
            method: "POST",
            headers,
            body,
            signal
          },
          { timeoutMs: 60000 }
        );
      });
      recordResponseSetCookies(response);

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body stream");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let isCompleted = false;

      const emitContentDelta = (delta: string) => {
        if (!delta) return;
        if (!sentRole) {
          writeSseChunk(reply, {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
          });
          sentRole = true;
        }
        writeSseChunk(reply, {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
        });
      };

      const processToolLine = (line: string) => {
        const bardCode = detectBardErrorInfo(line);
        if (bardCode) {
          throw new UpstreamRejectedError(`Gemini upstream rejected request: BardErrorInfo [${bardCode}]`, bardCode);
        }
        if (line.includes('["di",') || line.includes('["e",') || line.includes('"af.httprm"')) {
          isCompleted = true;
          return;
        }

        if (!line.includes('"wrb.fr"') || line.length < 50) return;
        try {
          const parsedLine = JSON.parse(line);
          const innerStr = parsedLine?.[0]?.[2];
          if (!innerStr || typeof innerStr !== "string") return;

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

                    if (!hasAttemptCompletion && !isPotentialRateLimitPrefix(responseText)) {
                      const flushLimit = getSafeFlushLimit(responseText, sentText.length, tools);
                      if (flushLimit > sentText.length) {
                        const targetSlice = responseText.slice(0, flushLimit);
                        const delta = targetSlice.startsWith(sentText)
                          ? targetSlice.slice(sentText.length)
                          : targetSlice.slice(sentText.length);
                        if (delta) {
                          emitContentDelta(delta);
                          sentText = targetSlice;
                        }
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
          if (parseErr instanceof UpstreamRateLimitError || parseErr instanceof UpstreamRejectedError) {
            throw parseErr;
          }
        }
      };

      try {
        while (!isCompleted) {
          if (signal?.aborted) {
            throw new ClientAbortedError();
          }
          if (reply.raw.writableEnded || !reply.raw.writable) {
            break;
          }

          const { done, value } = await readChunkWithTimeout(reader, undefined, signal);
          if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) {
              for (const tailLine of buffer.split("\n")) {
                processToolLine(tailLine);
                if (isCompleted) break;
              }
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            processToolLine(line);
            if (isCompleted) break;
          }
        }
      } finally {
        try {
          reader.cancel().catch(() => {});
        } catch {}
      }

      if (signal?.aborted) {
        throw new ClientAbortedError();
      }
      if (isUpstreamRateLimitMessage(responseText)) {
        throw new UpstreamRateLimitError();
      }

      const parsed = parseToolCalls(responseText, tools);
      let cleanText = parsed.cleanText;
      if (!parsed.toolCalls && stop) {
        cleanText = applyStopSequences(cleanText, stop).text;
      }
      const toolCalls = applyRooCodeToolFallback(cleanText, parsed.toolCalls, tools, toolChoice);
      const fallbackUsed = !parsed.toolCalls && Boolean(toolCalls);

      if (isUpstreamRateLimitMessage(cleanText)) {
        throw new UpstreamRateLimitError();
      }
      if (!cleanText.trim() && (!toolCalls || toolCalls.length === 0)) {
        throw new UpstreamEmptyResponseError();
      }

      geminiCircuitBreaker.recordSuccess();

      const promptTokens = countTokens(prompt);
      const completionTokens = countTokens(cleanText);

      if (reply.raw.writable && !reply.raw.writableEnded) {
        if (!fallbackUsed && cleanText.length > sentText.length) {
          const delta = cleanText.startsWith(sentText)
            ? cleanText.slice(sentText.length)
            : cleanText.slice(sentText.length);
          emitContentDelta(delta);
        }

        if (toolCalls) {
          if (!sentRole) {
            writeSseChunk(reply, {
              id: cid,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelName,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
            });
            sentRole = true;
          }

          writeSseChunk(reply, {
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
          });

          writeSseChunk(reply, {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
          });
        } else {
          writeSseChunk(reply, {
            id: cid,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
          });
        }

        if (includeUsage) {
          writeSseChunk(reply, {
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
          });
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
