import { buildGeminiRequest } from "./gemini.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import { fetchWithRetry } from "../utils/fetchWithRetry.js";
import { logUsage } from "./auth.js";
import { countTokens } from "../utils/tokens.js";
import { cleanGeminiText, parseToolCalls } from "../utils/parsers.js";
import { logger } from "../logger.js";
import { normalizeError } from "../utils/errors.js";
export async function handleChatStream(prompt, modelName, cfg, auth, reply, cid, startTime, signal) {
  const customCookie = auth.customCookie;
  let responseText = "";
  try {
    const { url, headers, body } = await buildGeminiRequest(prompt, cfg.mode, cfg.think, customCookie);
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
    let isCompleted = false;
    while (!isCompleted) {
      if (signal?.aborted || reply.raw.writableEnded || !reply.raw.writable) {
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
                      fullText += part[1].filter((t) => typeof t === "string").join("");
                    }
                    const statusArr = part[8];
                    if (Array.isArray(statusArr) && statusArr.includes(2)) {
                      candidateFinished = true;
                    }
                  }
                }
                if (fullText.trim()) {
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
                    if (reply.raw.writable && !reply.raw.writableEnded) {
                      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    }
                    prevCleanedText = cleanedText;
                  }
                  if (candidateFinished) {
                    isCompleted = true;
                  }
                  break;
                }
              }
            }
          }
        } catch {}
        if (isCompleted) break;
      }
    }
    try {
      reader.cancel();
    } catch {}
    if (reply.raw.writable && !reply.raw.writableEnded) {
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
    }
    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId,
      auth.apiKeyId,
      modelName,
      countTokens(prompt),
      countTokens(responseText),
      durationMs,
      200
    );
  } catch (e) {
    logger.error({ err: e }, "Streaming error");
    const normalized = normalizeError(e);
    if (reply.raw.writable && !reply.raw.writableEnded) {
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
    }
    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId,
      auth.apiKeyId,
      modelName,
      Math.floor(prompt.length / 4),
      0,
      durationMs,
      normalized.status
    );
  }
}
export async function handleChatStreamWithTools(prompt, modelName, cfg, auth, reply, cid, startTime, signal) {
  const customCookie = auth.customCookie;
  let responseText = "";
  let streamedLength = 0;
  let toolSuspended = false;
  try {
    const { url, headers, body } = await buildGeminiRequest(prompt, cfg.mode, cfg.think, customCookie);
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
    let isCompleted = false;
    while (!isCompleted) {
      if (signal?.aborted || reply.raw.writableEnded || !reply.raw.writable) {
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
                      fullText += part[1].filter((t) => typeof t === "string").join("");
                    }
                    const statusArr = part[8];
                    if (Array.isArray(statusArr) && statusArr.includes(2)) {
                      candidateFinished = true;
                    }
                  }
                }
                if (fullText.trim()) {
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
                      if (delta && reply.raw.writable && !reply.raw.writableEnded) {
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
                  if (candidateFinished) {
                    isCompleted = true;
                  }
                  break;
                }
              }
            }
          }
        } catch {}
        if (isCompleted) break;
      }
    }
    try {
      reader.cancel();
    } catch {}
    const { cleanText, toolCalls } = parseToolCalls(responseText);
    if (reply.raw.writable && !reply.raw.writableEnded) {
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
                tool_calls: toolCalls.map((tc, idx) => ({
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
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } else {
        const chunk = {
          id: cid,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        };
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    }
    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId,
      auth.apiKeyId,
      modelName,
      countTokens(prompt),
      countTokens(cleanText),
      durationMs,
      200
    );
  } catch (e) {
    logger.error({ err: e }, "Streaming with tools error");
    const normalized = normalizeError(e);
    if (reply.raw.writable && !reply.raw.writableEnded) {
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
    }
    const durationMs = Date.now() - startTime;
    await logUsage(
      auth.projectId,
      auth.apiKeyId,
      modelName,
      Math.floor(prompt.length / 4),
      0,
      durationMs,
      normalized.status
    );
  }
}
