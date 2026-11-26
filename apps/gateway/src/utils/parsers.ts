import { jsonrepair } from "jsonrepair";
import { logger } from "../logger.js";
import { UpstreamRejectedError } from "./errors.js";

export function cleanGeminiText(text: string): string {
  // Removes internal Gemini tags like ```python?code_reference=...``` or stdout and card_content URLs
  return text
    .replace(/```[a-z]*\?code_(?:reference|stdout|execution)[^\n]*\n[\s\S]*?```\n?/gi, "")
    .replace(/https?:\/\/googleusercontent\.com\/card_content\/\d+\n?/gi, "");
}

export function detectBardErrorInfo(raw: string): string | null {
  const match = raw.match(/BardErrorInfo\s*\[(\d+)\]/i);
  return match ? match[1] : null;
}

function extractTextGeneric(obj: unknown): string {
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) {
    let res = "";
    for (const item of obj) {
      if (typeof item === "string") res += item;
      else if (typeof item === "object") res += extractTextGeneric(item);
    }
    return res;
  }
  return "";
}

export function extractResponseText(raw: string): string {
  let finalResult = "";
  let pos = 0;
  while (pos < raw.length) {
    let nextNL = raw.indexOf("\n", pos);
    if (nextNL === -1) nextNL = raw.length;
    const line = raw.substring(pos, nextNL);
    pos = nextNL + 1;

    if (line.length < 50 || !line.includes('"wrb.fr"')) continue;

    try {
      const parsedLine = JSON.parse(line);
      const innerStr = parsedLine?.[0]?.[2];
      if (!innerStr || typeof innerStr !== "string") continue;

      const inner = JSON.parse(innerStr);
      if (Array.isArray(inner)) {
        // Known structure: main text is at inner[4] or inner[0]
        const candidates = [inner[4], inner[0]].filter(Boolean);
        let textFound = false;

        for (const candidate of candidates) {
          if (Array.isArray(candidate)) {
            let text = "";
            for (const part of candidate) {
              if (Array.isArray(part) && Array.isArray(part[1])) {
                text += part[1].filter((t: unknown) => typeof t === "string").join("");
              }
            }
            if (text.trim()) {
              finalResult = text;
              textFound = true;
              break;
            }
          }
        }

        // Fallback if structure changes
        if (!textFound) {
          const fallbackText = extractTextGeneric(inner);
          if (fallbackText.trim() && fallbackText.length > finalResult.length) {
            finalResult = fallbackText;
          }
        }
      }
    } catch (e: unknown) {
      const errMessage = e instanceof Error ? e.message : String(e);
      logger.debug({ err: errMessage }, "Failed to parse chunk line in extractResponseText");
    }
  }

  const cleaned = cleanGeminiText(finalResult).trim();
  if (!cleaned) {
    const bardCode = detectBardErrorInfo(raw);
    if (bardCode) {
      throw new UpstreamRejectedError(`Gemini upstream rejected request: BardErrorInfo [${bardCode}]`, bardCode);
    }
  }
  return cleaned;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer" | "function";
  content?: string | Array<{ type: string; text?: string; input_text?: string } | any> | null;
  name?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string | Record<string, any>;
    };
  }> | null;
  tool_call_id?: string | null;
}

export interface ToolDefinition {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, any>;
  };
  name?: string;
  description?: string;
  parameters?: Record<string, any>;
}

function getToolName(tool: ToolDefinition): string {
  const fn = tool.type === "function" ? tool.function : tool;
  return fn?.name || tool.name || "";
}

function getAllowedToolNames(tools?: ToolDefinition[] | null): Set<string> {
  const names = new Set<string>();
  if (!tools) return names;
  for (const t of tools) {
    const name = getToolName(t);
    if (name) names.add(name);
  }
  return names;
}

function extractTextFromContentPart(part: any): string {
  if (!part) return "";
  if (typeof part === "string") return part;
  if (typeof part !== "object") return "";
  if (part.type === "text" || part.type === "input_text" || part.type === "output_text") {
    if (typeof part.text === "string") return part.text;
    if (part.text && typeof part.text.value === "string") return part.text.value;
    if (typeof part.input_text === "string") return part.input_text;
    return "";
  }
  if (part.type === "image_url" || part.type === "input_image" || part.type === "image") {
    return "[Image attached]";
  }
  return "";
}

function extractForcedToolName(toolChoice?: string | Record<string, unknown> | null): string {
  if (!toolChoice || typeof toolChoice !== "object") return "";
  const fn = (toolChoice as any).function;
  if (fn && typeof fn.name === "string" && fn.name) return fn.name;
  if (typeof (toolChoice as any).name === "string" && (toolChoice as any).name) {
    return (toolChoice as any).name;
  }
  return "";
}

export function messagesToPrompt(
  messages: ChatMessage[],
  tools?: ToolDefinition[] | null,
  responseFormat?: { type: string; json_schema?: unknown } | null,
  toolChoice?: string | Record<string, unknown> | null
): string {
  const parts: string[] = [];
  if (responseFormat?.type === "json_object") {
    parts.push(
      "[System instruction]: You MUST respond with a valid JSON object. Do not include markdown code block formatting."
    );
  } else if (responseFormat?.type === "json_schema") {
    const schemaStr = responseFormat.json_schema ? ` Schema: ${JSON.stringify(responseFormat.json_schema)}` : "";
    parts.push(
      `[System instruction]: You MUST respond strictly with valid JSON matching the requested schema (no markdown code fences).${schemaStr}`
    );
  }

  let hasTools = false;
  const forcedToolName = extractForcedToolName(toolChoice);
  let requiresToolCall =
    toolChoice === "required" || Boolean(forcedToolName) || (typeof toolChoice === "object" && toolChoice !== null);

  if (tools && tools.length > 0 && toolChoice !== "none") {
    hasTools = true;
    const toolDefs = tools.map((tool) => {
      const fn = tool.type === "function" ? tool.function : tool;
      const name = fn?.name || tool.name || "";
      if (name === "attempt_completion" || name === "ask_followup_question") {
        requiresToolCall = true;
      }
      return {
        name,
        description: fn?.description || tool.description || "",
        parameters: fn?.parameters || tool.parameters || {}
      };
    });
    parts.push(
      "[System instruction]: The external IDE/client provides the following client-side tools (executed by the client, NOT inside Gemini). Never claim you lack file-reading or follow-up tools — invoke them using ```tool_call blocks.\n" +
        `Available tools: ${JSON.stringify(toolDefs)}`
    );
  } else if (toolChoice === "none" && tools && tools.length > 0) {
    parts.push("[System instruction]: Do NOT call any tools. Respond with plain text only.");
  }

  const toolCallNameById = new Map<string, string>();

  for (const msg of messages) {
    const role = msg.role || "user";
    let content: any = msg.content ?? "";
    if (Array.isArray(content)) {
      content = content
        .map((c: any) => extractTextFromContentPart(c))
        .filter(Boolean)
        .join("\n");
    }

    if (role === "system" || role === "developer") {
      if (String(content).trim()) {
        parts.push(`[System instruction]: ${content}`);
      }
    } else if (role === "assistant") {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const tcStrs = msg.tool_calls.map((tc: any) => {
          const fn = tc.function || {};
          const fnName = fn.name || "";
          if (tc.id && fnName) {
            toolCallNameById.set(String(tc.id), String(fnName));
          }
          let argsObj = fn.arguments ?? {};
          if (typeof argsObj === "string") {
            try {
              argsObj = JSON.parse(argsObj);
            } catch {
              try {
                argsObj = JSON.parse(jsonrepair(argsObj));
              } catch {}
            }
          }
          const serialized: Record<string, unknown> = {
            ...(tc.id ? { id: tc.id } : {}),
            name: fnName,
            arguments: argsObj
          };
          return `\`\`\`tool_call\n${JSON.stringify(serialized)}\n\`\`\``;
        });
        parts.push(`[Assistant]: ${content || ""}\n` + tcStrs.join("\n"));
      } else {
        parts.push(`[Assistant]: ${content}`);
      }
    } else if (role === "tool" || role === "function") {
      const callId = msg.tool_call_id || "";
      const mappedName = callId ? toolCallNameById.get(callId) : undefined;
      const toolName = msg.name || mappedName || callId || "tool";
      const idSuffix = callId && toolName !== callId ? ` (id: ${callId})` : "";
      const toolResult = typeof content === "object" ? JSON.stringify(content) : content;
      parts.push(`[Tool result for ${toolName}${idSuffix}]: ${toolResult}`);
    } else {
      parts.push(content ? String(content) : "");
    }
  }

  if (hasTools) {
    let toolConstraint = "Only use tool_call blocks when calling one of the available tools.";
    if (forcedToolName) {
      toolConstraint = `IMPORTANT: You MUST call the tool "${forcedToolName}" using a \`\`\`tool_call block. Do NOT call other tools and do NOT reply with plain text alone.`;
    } else if (requiresToolCall) {
      toolConstraint =
        "IMPORTANT: The client requires every response to end with a ```tool_call block (e.g. attempt_completion or ask_followup_question if no other tool is needed). Do NOT reply with plain text alone.";
    }

    parts.push(
      "[System reminder]: Output tool calls strictly as:\n" +
        "```tool_call\n" +
        '{"name": "tool_name", "arguments": {...}}\n' +
        "```\n" +
        toolConstraint
    );
  }

  return parts.filter(Boolean).join("\n\n");
}

export interface ToolCallResult {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

function extractBalancedJsonObject(
  str: string,
  fromIndex: number
): { json: string; startIndex: number; endIndex: number } | null {
  const start = str.indexOf("{", fromIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { json: str.slice(start, i + 1), startIndex: start, endIndex: i + 1 };
      }
    }
  }
  return null;
}

function normalizeToolArguments(args: unknown): string {
  if (args === undefined || args === null) {
    return "{}";
  }
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) return "{}";
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        return JSON.stringify(parsed);
      }
      return JSON.stringify({ value: parsed });
    } catch {
      try {
        const repaired = jsonrepair(trimmed);
        const parsed = JSON.parse(repaired);
        if (typeof parsed === "object" && parsed !== null) {
          return JSON.stringify(parsed);
        }
        return JSON.stringify({ value: parsed });
      } catch {
        return JSON.stringify({ raw: args });
      }
    }
  }
  if (typeof args === "object") {
    return JSON.stringify(args);
  }
  return JSON.stringify({ value: args });
}

function tryParseToolCallJson(jsonStr: string, allowedToolNames?: Set<string>): ToolCallResult | null {
  let candidate = jsonStr.trim();
  try {
    try {
      candidate = jsonrepair(candidate);
    } catch {}
    const data = JSON.parse(candidate);
    if (data && typeof data.name === "string" && data.name) {
      if (allowedToolNames && allowedToolNames.size > 0 && !allowedToolNames.has(data.name)) {
        return null;
      }
      const args = data.arguments ?? data.parameters ?? data.args ?? {};
      return {
        id: `call_${Math.random().toString(36).substring(2, 10)}`,
        type: "function",
        function: {
          name: data.name,
          arguments: normalizeToolArguments(args)
        }
      };
    }
  } catch (e: unknown) {
    const errMessage = e instanceof Error ? e.message : String(e);
    logger.debug({ err: errMessage }, "Failed to parse tool call block");
  }
  return null;
}

function removeSpans(text: string, spans: Array<[number, number]>): string {
  if (spans.length === 0) return text.trim();
  let clean = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    clean += text.slice(cursor, start);
    cursor = end;
  }
  clean += text.slice(cursor);
  return clean.trim();
}

function extractFencedToolCalls(
  text: string,
  fencePattern: RegExp,
  requireArgsKey: boolean,
  allowedToolNames?: Set<string>
): { cleanText: string; toolCalls: ToolCallResult[] } {
  const toolCalls: ToolCallResult[] = [];
  const spansToRemove: Array<[number, number]> = [];
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const fenceStart = match.index;
    const afterFence = fenceStart + match[0].length;
    const balanced = extractBalancedJsonObject(text, afterFence);
    if (!balanced) continue;

    // Ensure there isn't a closing fence between afterFence and the JSON object start
    const between = text.slice(afterFence, balanced.startIndex);
    if (between.includes("```")) {
      continue;
    }

    if (
      requireArgsKey &&
      !balanced.json.includes('"arguments"') &&
      !balanced.json.includes('"parameters"') &&
      !balanced.json.includes('"args"')
    ) {
      continue;
    }

    const parsed = tryParseToolCallJson(balanced.json, allowedToolNames);
    if (!parsed) continue;

    toolCalls.push(parsed);

    let removeEnd = balanced.endIndex;
    const trailing = text.slice(removeEnd);
    const closeMatch = trailing.match(/^\s*```/);
    if (closeMatch) {
      removeEnd += closeMatch[0].length;
    }
    spansToRemove.push([fenceStart, removeEnd]);
    fencePattern.lastIndex = removeEnd;
  }

  return { cleanText: removeSpans(text, spansToRemove), toolCalls };
}

function extractInlineRawToolCalls(
  text: string,
  allowedToolNames: Set<string>
): { cleanText: string; toolCalls: ToolCallResult[] } {
  if (allowedToolNames.size === 0) {
    return { cleanText: text.trim(), toolCalls: [] };
  }

  const toolCalls: ToolCallResult[] = [];
  const spansToRemove: Array<[number, number]> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const balanced = extractBalancedJsonObject(text, cursor);
    if (!balanced) break;

    const json = balanced.json;
    const hasKeys =
      json.includes('"name"') &&
      (json.includes('"arguments"') || json.includes('"parameters"') || json.includes('"args"'));

    if (hasKeys) {
      const parsed = tryParseToolCallJson(json, allowedToolNames);
      if (parsed) {
        toolCalls.push(parsed);
        spansToRemove.push([balanced.startIndex, balanced.endIndex]);
        cursor = balanced.endIndex;
        continue;
      }
    }
    cursor = balanced.startIndex + 1;
  }

  return { cleanText: removeSpans(text, spansToRemove), toolCalls };
}

export function parseToolCalls(
  text: string,
  allowedTools?: ToolDefinition[] | null
): { cleanText: string; toolCalls: ToolCallResult[] | null } {
  const allowedNames = getAllowedToolNames(allowedTools);

  const primary = extractFencedToolCalls(text, /```tool_call\s*/gi, false, allowedNames);
  if (primary.toolCalls.length > 0) {
    return { cleanText: primary.cleanText, toolCalls: primary.toolCalls };
  }

  // Fallback: also accept ```json / ```jsonc blocks containing {"name": ..., "arguments": ...}
  const jsonFenced = extractFencedToolCalls(text, /```jsonc?\s*/gi, true, allowedNames);
  if (jsonFenced.toolCalls.length > 0) {
    return { cleanText: jsonFenced.cleanText, toolCalls: jsonFenced.toolCalls };
  }

  // Fallback for declared tools: bare ``` or ```javascript/typescript fences containing a valid tool JSON
  if (allowedNames.size > 0) {
    const genericFenced = extractFencedToolCalls(
      text,
      /```(?:javascript|js|typescript|ts)?[ \t]*\r?\n/gi,
      true,
      allowedNames
    );
    if (genericFenced.toolCalls.length > 0) {
      return { cleanText: genericFenced.cleanText, toolCalls: genericFenced.toolCalls };
    }
  }

  // Fallback: If no tool_call backticks were used but the entire response is a pure JSON tool call with both name and arguments
  const trimmed = text.trim();
  if (
    trimmed.startsWith("{") &&
    trimmed.includes('"name"') &&
    (trimmed.includes('"arguments"') || trimmed.includes('"parameters"') || trimmed.includes('"args"'))
  ) {
    const parsed = tryParseToolCallJson(trimmed, allowedNames);
    if (parsed) {
      return { cleanText: "", toolCalls: [parsed] };
    }
  }

  // Fallback: Raw JSON tool call(s) preceded by explanatory text when allowedTools are known
  if (allowedNames.size > 0) {
    const inline = extractInlineRawToolCalls(text, allowedNames);
    if (inline.toolCalls.length > 0) {
      return { cleanText: inline.cleanText, toolCalls: inline.toolCalls };
    }
  }

  return { cleanText: trimmed, toolCalls: null };
}

export function applyRooCodeToolFallback(
  cleanText: string,
  toolCalls: ToolCallResult[] | null,
  tools?: ToolDefinition[] | null,
  toolChoice?: string | Record<string, unknown> | null
): ToolCallResult[] | null {
  if (toolCalls && toolCalls.length > 0) return toolCalls;
  if (toolChoice === "none") return null;

  const nonThinkText = cleanText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!tools || tools.length === 0 || !nonThinkText) return null;

  const hasAttemptCompletion = tools.some((t) => getToolName(t) === "attempt_completion");
  if (!hasAttemptCompletion) return null;

  return [
    {
      id: `call_${Math.random().toString(36).substring(2, 10)}`,
      type: "function",
      function: {
        name: "attempt_completion",
        arguments: JSON.stringify({ result: nonThinkText })
      }
    }
  ];
}

export function applyStopSequences(text: string, stop?: string | string[] | null): { text: string; stopped: boolean } {
  if (!text || !stop) return { text, stopped: false };
  const sequences = (Array.isArray(stop) ? stop : [stop]).filter((s) => typeof s === "string" && s.length > 0);
  if (sequences.length === 0) return { text, stopped: false };

  let earliestIdx = -1;
  for (const seq of sequences) {
    const idx = text.indexOf(seq);
    if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
      earliestIdx = idx;
    }
  }

  if (earliestIdx !== -1) {
    return { text: text.slice(0, earliestIdx), stopped: true };
  }
  return { text, stopped: false };
}

export function cleanJsonResponse(text: string): string {
  let clean = text.trim();
  clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  clean = clean
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    clean = jsonrepair(clean);
  } catch (e) {}

  const firstBrace = clean.indexOf("{");
  const firstBracket = clean.indexOf("[");
  let startIdx = -1;
  let isObject = false;

  if (firstBrace !== -1 && firstBracket !== -1) {
    if (firstBrace < firstBracket) {
      startIdx = firstBrace;
      isObject = true;
    } else {
      startIdx = firstBracket;
      isObject = false;
    }
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    isObject = false;
  }

  let endIdx = -1;
  if (startIdx !== -1) {
    endIdx = isObject ? clean.lastIndexOf("}") : clean.lastIndexOf("]");
  }
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    clean = clean.substring(startIdx, endIdx + 1);
  }
  return clean.trim();
}
