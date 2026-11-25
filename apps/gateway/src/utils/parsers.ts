import { jsonrepair } from "jsonrepair";
import { logger } from "../logger.js";

export function cleanGeminiText(text: string): string {
  // Removes internal Gemini tags like ```python?code_reference=...``` or stdout
  return text.replace(/```[a-z]*\?code_(?:reference|stdout|execution)[^\n]*\n[\s\S]*?```\n?/gi, "");
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
  return cleanGeminiText(finalResult).trim();
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer" | "function";
  content?: string | Array<{ type: string; text?: string; input_text?: string } | any> | null;
  name?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string | Record<string, any>;
    };
  }>;
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, any>;
  };
  name?: string;
  description?: string;
  parameters?: Record<string, any>;
}

export function messagesToPrompt(
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  responseFormat?: { type: string; json_schema?: unknown },
  toolChoice?: string | Record<string, unknown>
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
  let requiresToolCall = toolChoice === "required" || (typeof toolChoice === "object" && toolChoice !== null);
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
  }
  for (const msg of messages) {
    const role = msg.role || "user";
    let content = msg.content || "";
    if (Array.isArray(content)) {
      content = content
        .filter((c: any) => c && (c.type === "text" || c.type === "input_text"))
        .map((c: any) => c.text || "")
        .join(" ");
    }
    if (role === "system" || role === "developer") {
      parts.push(`[System instruction]: ${content}`);
    } else if (role === "assistant") {
      if (msg.tool_calls) {
        const tcStrs = msg.tool_calls.map((tc: any) => {
          const fn = tc.function || {};
          let argsObj = fn.arguments || {};
          if (typeof argsObj === "string") {
            try {
              argsObj = JSON.parse(argsObj);
            } catch {}
          }
          return `\`\`\`tool_call\n${JSON.stringify({ name: fn.name, arguments: argsObj })}\n\`\`\``;
        });
        parts.push(`[Assistant]: ${content || ""}\n` + tcStrs.join("\n"));
      } else {
        parts.push(`[Assistant]: ${content}`);
      }
    } else if (role === "tool" || role === "function") {
      const toolName = msg.name || msg.tool_call_id || "";
      const toolResult = typeof content === "object" ? JSON.stringify(content) : content;
      parts.push(`[Tool result for ${toolName}]: ${toolResult}`);
    } else {
      parts.push(content ? String(content) : "");
    }
  }
  if (hasTools) {
    parts.push(
      "[System reminder]: Output tool calls strictly as:\n" +
        "```tool_call\n" +
        '{"name": "tool_name", "arguments": {...}}\n' +
        "```\n" +
        (requiresToolCall
          ? "IMPORTANT: The client requires every response to end with a ```tool_call block (e.g. attempt_completion or ask_followup_question if no other tool is needed). Do NOT reply with plain text alone."
          : "Only use tool_call blocks when calling one of the available tools.")
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

function extractBalancedJsonObject(str: string, fromIndex: number): { json: string; endIndex: number } | null {
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
        return { json: str.slice(start, i + 1), endIndex: i + 1 };
      }
    }
  }
  return null;
}

function tryParseToolCallJson(jsonStr: string): ToolCallResult | null {
  let candidate = jsonStr.trim();
  try {
    try {
      candidate = jsonrepair(candidate);
    } catch {}
    const data = JSON.parse(candidate);
    if (data && typeof data.name === "string" && data.name) {
      const args = data.arguments ?? data.parameters ?? {};
      return {
        id: `call_${Math.random().toString(36).substring(2, 10)}`,
        type: "function",
        function: {
          name: data.name,
          arguments: typeof args === "string" ? args : JSON.stringify(args)
        }
      };
    }
  } catch (e: unknown) {
    const errMessage = e instanceof Error ? e.message : String(e);
    logger.debug({ err: errMessage }, "Failed to parse tool call block");
  }
  return null;
}

function extractFencedToolCalls(
  text: string,
  fencePattern: RegExp,
  requireArgsKey: boolean
): { cleanText: string; toolCalls: ToolCallResult[] } {
  const toolCalls: ToolCallResult[] = [];
  const spansToRemove: Array<[number, number]> = [];
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const fenceStart = match.index;
    const afterFence = fenceStart + match[0].length;
    const balanced = extractBalancedJsonObject(text, afterFence);
    if (!balanced) continue;

    if (requireArgsKey && !balanced.json.includes('"arguments"') && !balanced.json.includes('"parameters"')) {
      continue;
    }

    const parsed = tryParseToolCallJson(balanced.json);
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

  if (spansToRemove.length === 0) {
    return { cleanText: text.trim(), toolCalls };
  }

  let clean = "";
  let cursor = 0;
  for (const [start, end] of spansToRemove) {
    clean += text.slice(cursor, start);
    cursor = end;
  }
  clean += text.slice(cursor);
  return { cleanText: clean.trim(), toolCalls };
}

export function parseToolCalls(text: string): { cleanText: string; toolCalls: ToolCallResult[] | null } {
  const primary = extractFencedToolCalls(text, /```tool_call\s*/gi, false);
  if (primary.toolCalls.length > 0) {
    return { cleanText: primary.cleanText, toolCalls: primary.toolCalls };
  }

  // Fallback: also accept ```json blocks containing {"name": ..., "arguments": ...}
  const jsonFenced = extractFencedToolCalls(text, /```json\s*/gi, true);
  if (jsonFenced.toolCalls.length > 0) {
    return { cleanText: jsonFenced.cleanText, toolCalls: jsonFenced.toolCalls };
  }

  // Fallback: If no tool_call backticks were used but the entire response is a pure JSON tool call with both name and arguments
  if (
    text.trim().startsWith("{") &&
    text.includes('"name"') &&
    (text.includes('"arguments"') || text.includes('"parameters"'))
  ) {
    const parsed = tryParseToolCallJson(text.trim());
    if (parsed) {
      return { cleanText: "", toolCalls: [parsed] };
    }
  }

  return { cleanText: text.trim(), toolCalls: null };
}

export function applyRooCodeToolFallback(
  cleanText: string,
  toolCalls: ToolCallResult[] | null,
  tools?: ToolDefinition[]
): ToolCallResult[] | null {
  if (toolCalls && toolCalls.length > 0) return toolCalls;
  if (!tools || tools.length === 0 || !cleanText.trim()) return null;

  const hasAttemptCompletion = tools.some((t) => {
    const name = t.type === "function" ? t.function?.name || t.name : t.name;
    return name === "attempt_completion";
  });

  if (!hasAttemptCompletion) return null;

  return [
    {
      id: `call_${Math.random().toString(36).substring(2, 10)}`,
      type: "function",
      function: {
        name: "attempt_completion",
        arguments: JSON.stringify({ result: cleanText.trim() })
      }
    }
  ];
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
