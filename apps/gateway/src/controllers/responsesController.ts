import { FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import { resolveModelConfig } from "../utils/models.js";
import { verifyApiKey, logUsage } from "../services/auth.js";
import { geminiStreamGenerate } from "../services/gemini.js";
import { extractResponseText, parseToolCalls, messagesToPrompt, cleanJsonResponse } from "../utils/parsers.js";
import { geminiCircuitBreaker } from "../utils/circuitBreaker.js";
import {
  normalizeError,
  isUpstreamRateLimitMessage,
  UpstreamEmptyResponseError,
  UpstreamRateLimitError,
  ClientAbortedError
} from "../utils/errors.js";
import { responsesApiSchema } from "../utils/schemas.js";
import { countTokens } from "../utils/tokens.js";
import { extractImagesFromMessages, uploadAllImages } from "../services/multimodal.js";

function writeResponsesSseEvent(reply: FastifyReply, eventName: string, data: unknown) {
  if (reply.raw.writable && !reply.raw.writableEnded) {
    reply.raw.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

export async function responsesApiController(request: FastifyRequest, reply: FastifyReply) {
  const parseResult = responsesApiSchema.safeParse(request.body);
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
  const reasoningEffort = req.reasoning && typeof req.reasoning.effort === "string" ? req.reasoning.effort : undefined;
  const { config: cfg, cleanModelName: modelName } = resolveModelConfig(rawModelName, reasoningEffort);

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
  const tools = req.tools ?? undefined;
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
        if (item.type === "function_call") {
          const tc = {
            id: item.call_id || item.id || `call_${crypto.randomBytes(4).toString("hex")}`,
            type: "function",
            function: {
              name: item.name || "",
              arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {})
            }
          };
          const prev = messages[messages.length - 1];
          if (prev && prev.role === "assistant" && Array.isArray(prev.tool_calls)) {
            prev.tool_calls.push(tc);
          } else {
            messages.push({ role: "assistant", content: null, tool_calls: [tc] });
          }
        } else if (item.type === "function_call_output") {
          messages.push({
            role: "tool",
            tool_call_id: item.call_id || "",
            name: item.name || undefined,
            content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "")
          });
        } else if (item.role === "assistant" || (item.type === "message" && item.role === "assistant")) {
          const cp = item.content || [];
          let textAcc = "";
          const tcList: any[] = [];
          if (Array.isArray(cp)) {
            for (const c of cp) {
              if (typeof c === "object" && c !== null) {
                if (c.type === "output_text" || c.type === "text" || c.type === "input_text") {
                  textAcc += c.text || "";
                } else if (c.type === "function_call") {
                  tcList.push(c);
                }
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
          let content: any = item.content ?? "";
          if (Array.isArray(content)) {
            const hasImage = content.some((c: any) => c && (c.type === "image_url" || c.type === "input_image"));
            if (!hasImage) {
              content = content
                .filter((c: any) => c && (c.type === "text" || c.type === "input_text" || c.type === "output_text"))
                .map((c: any) => c.text || "")
                .join("\n");
            }
          }
          messages.push({ role, content });
        }
      }
    }
  }

  const responseFormat = req.text?.format
    ? { type: req.text.format.type, json_schema: req.text.format.schema }
    : undefined;

  const prompt = messagesToPrompt(messages, tools, responseFormat, req.tool_choice);
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
    const imageInputs = await extractImagesFromMessages(messages);
    const fileRefs = imageInputs.length > 0 ? await uploadAllImages(imageInputs, customCookie) : undefined;

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

    if (tools && tools.length > 0 && req.tool_choice !== "none") {
      const parsed = parseToolCalls(text, tools);
      cleanText = parsed.cleanText;
      toolCalls = parsed.toolCalls;
    }

    if ((responseFormat?.type === "json_object" || responseFormat?.type === "json_schema") && cleanText) {
      cleanText = cleanJsonResponse(cleanText);
    }

    if (isUpstreamRateLimitMessage(cleanText)) {
      throw new UpstreamRateLimitError();
    }
    if (!cleanText.trim() && (!toolCalls || toolCalls.length === 0)) {
      throw new UpstreamEmptyResponseError();
    }

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

    const promptTokens = countTokens(prompt);
    const completionTokens = countTokens(cleanText || "");
    const durationMs = Date.now() - startTime;
    await logUsage(auth.projectId!, auth.apiKeyId!, modelName, promptTokens, completionTokens, durationMs, 200);

    const responseObj = {
      id: rid,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: modelName,
      output,
      usage: {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    };

    if (req.stream === true) {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });

      writeResponsesSseEvent(reply, "response.created", {
        type: "response.created",
        response: { ...responseObj, status: "in_progress", output: [] }
      });

      let outputIndex = 0;
      for (const item of output) {
        if (item.type === "function_call") {
          writeResponsesSseEvent(reply, "response.output_item.added", {
            type: "response.output_item.added",
            output_index: outputIndex,
            item: { ...item, arguments: "", status: "in_progress" }
          });
          writeResponsesSseEvent(reply, "response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta",
            item_id: item.id,
            output_index: outputIndex,
            delta: item.arguments
          });
          writeResponsesSseEvent(reply, "response.function_call_arguments.done", {
            type: "response.function_call_arguments.done",
            item_id: item.id,
            output_index: outputIndex,
            arguments: item.arguments
          });
          writeResponsesSseEvent(reply, "response.output_item.done", {
            type: "response.output_item.done",
            output_index: outputIndex,
            item
          });
        } else if (item.type === "message") {
          const textVal = item.content?.[0]?.text || "";
          writeResponsesSseEvent(reply, "response.output_item.added", {
            type: "response.output_item.added",
            output_index: outputIndex,
            item: { ...item, status: "in_progress", content: [] }
          });
          writeResponsesSseEvent(reply, "response.content_part.added", {
            type: "response.content_part.added",
            item_id: item.id,
            output_index: outputIndex,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] }
          });
          if (textVal) {
            writeResponsesSseEvent(reply, "response.output_text.delta", {
              type: "response.output_text.delta",
              item_id: item.id,
              output_index: outputIndex,
              content_index: 0,
              delta: textVal
            });
          }
          writeResponsesSseEvent(reply, "response.output_text.done", {
            type: "response.output_text.done",
            item_id: item.id,
            output_index: outputIndex,
            content_index: 0,
            text: textVal
          });
          writeResponsesSseEvent(reply, "response.content_part.done", {
            type: "response.content_part.done",
            item_id: item.id,
            output_index: outputIndex,
            content_index: 0,
            part: { type: "output_text", text: textVal, annotations: [] }
          });
          writeResponsesSseEvent(reply, "response.output_item.done", {
            type: "response.output_item.done",
            output_index: outputIndex,
            item
          });
        }
        outputIndex++;
      }

      writeResponsesSseEvent(reply, "response.completed", {
        type: "response.completed",
        response: responseObj
      });
      reply.raw.end();
      return reply;
    }

    return responseObj;
  } catch (e) {
    const durationMs = Date.now() - startTime;
    const normalized = normalizeError(e);
    await logUsage(auth.projectId!, auth.apiKeyId!, modelName, countTokens(prompt), 0, durationMs, normalized.status);
    return reply.status(normalized.status).send(normalized.body);
  }
}
