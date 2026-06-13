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

    if (line.length < 200 || !line.includes('"wrb.fr"')) continue;

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
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string; input_text?: string } | any>;
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
  responseFormat?: { type: string }
): string {
  const parts: string[] = [];
  if (responseFormat?.type === "json_object") {
    parts.push(
      "[System instruction]: You MUST respond with a valid JSON object. Do not include markdown code block formatting."
    );
  }
  if (tools && tools.length > 0) {
    const toolDefs = tools.map((tool) => {
      const fn = tool.type === "function" ? tool.function : tool;
      return {
        name: fn?.name || tool.name || "",
        description: fn?.description || tool.description || "",
        parameters: fn?.parameters || tool.parameters || {}
      };
    });
    parts.push(
      "[System instruction]: You have access to tools. To call a tool, respond with:\n" +
        "```tool_call\n" +
        '{"name": "func_name", "arguments": {...}}\n' +
        "```\n" +
        "Only use tool_call blocks when needed.\n\n" +
        `Available tools:\n${JSON.stringify(toolDefs, null, 2)}`
    );
  }
  for (const msg of messages) {
    const role = msg.role || "user";
    let content = msg.content || "";
    if (Array.isArray(content)) {
      content = content
        .filter((c: any) => c.type === "text" || c.type === "input_text")
        .map((c: any) => c.text || "")
        .join(" ");
    }
    if (role === "system") {
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
    } else if (role === "tool") {
      const toolName = msg.name || msg.tool_call_id || "";
      const toolResult = typeof content === "object" ? JSON.stringify(content) : content;
      parts.push(`[Tool result for ${toolName}]: ${toolResult}`);
    } else {
      parts.push(content ? String(content) : "");
    }
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

export function parseToolCalls(text: string): { cleanText: string; toolCalls: ToolCallResult[] | null } {
  const toolCalls: ToolCallResult[] = [];
  const regex = /```(?:tool_call|json)?\s*([\s\S]*?)\s*```/g;

  const matches = [...text.matchAll(regex)];

  for (const match of matches) {
    let jsonStr = match[1].trim();
    if (!jsonStr.includes('"name"')) continue; // likely just a regular code block

    try {
      try {
        jsonStr = jsonrepair(jsonStr);
      } catch (e) {} // ignore jsonrepair failure, try original

      const data = JSON.parse(jsonStr);
      if (data.name) {
        const args = data.arguments || {};
        const argumentsStr = typeof args === "string" ? args : JSON.stringify(args);
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 10)}`,
          type: "function",
          function: { name: data.name, arguments: argumentsStr }
        });
      }
    } catch (e: unknown) {
      const errMessage = e instanceof Error ? e.message : String(e);
      logger.debug({ err: errMessage, jsonStr }, "Failed to parse tool call block");
    }
  }

  // Fallback: If no backticks were used but the response is pure JSON tool call
  if (toolCalls.length === 0 && text.trim().startsWith("{") && text.includes('"name"')) {
    try {
      const jsonStr = jsonrepair(text.trim());
      const data = JSON.parse(jsonStr);
      if (data.name) {
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 10)}`,
          type: "function",
          function: {
            name: data.name,
            arguments: typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments || {})
          }
        });
        return { cleanText: "", toolCalls };
      }
    } catch (e) {}
  }

  const cleanText = text.replace(regex, "").trim();
  return { cleanText, toolCalls: toolCalls.length > 0 ? toolCalls : null };
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
