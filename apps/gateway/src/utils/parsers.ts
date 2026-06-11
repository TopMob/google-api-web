export function cleanGeminiText(text: string): string {
  return text.replace(/```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g, "");
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
      const innerStr = JSON.parse(line)[0][2];
      if (!innerStr || innerStr.length < 50) continue;
      const inner = JSON.parse(innerStr);
      if (Array.isArray(inner) && inner[4]) {
        let text = "";
        for (const part of inner[4]) {
          if (Array.isArray(part) && part[1] && Array.isArray(part[1])) {
            text += part[1].filter((t: any) => typeof t === "string").join("");
          }
        }
        if (text.trim()) finalResult = text;
      }
    } catch {}
  }
  return cleanGeminiText(finalResult).trim();
}

export function messagesToPrompt(messages: any[], tools?: any[]): string {
  const parts: string[] = [];
  if (tools && tools.length > 0) {
    const toolDefs = tools.map((tool) => {
      const fn = tool.type === "function" ? tool.function : tool;
      return {
        name: fn.name || tool.name || "",
        description: fn.description || tool.description || "",
        parameters: fn.parameters || tool.parameters || {}
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
          return `\`\`\`tool_call\n${JSON.stringify({ name: fn.name, arguments: fn.arguments })}\n\`\`\``;
        });
        parts.push(`[Assistant]: ${content || ""}\n` + tcStrs.join("\n"));
      } else {
        parts.push(`[Assistant]: ${content}`);
      }
    } else if (role === "tool") {
      parts.push(`[Tool result for ${msg.name || ""}]: ${content}`);
    } else {
      parts.push(content ? String(content) : "");
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

export function parseToolCalls(text: string): { cleanText: string; toolCalls: any[] | null } {
  const toolCalls: any[] = [];
  const regex = /```tool_call\s*\n([\s\S]*?)\n```/g;
  for (const match of text.matchAll(regex)) {
    try {
      const data = JSON.parse(match[1].trim());
      toolCalls.push({
        id: `call_${Math.random().toString(36).substring(2, 10)}`,
        type: "function",
        function: { name: data.name, arguments: JSON.stringify(data.arguments || {}) }
      });
    } catch {}
  }
  const cleanText = text.replace(regex, "").trim();
  return { cleanText, toolCalls: toolCalls.length > 0 ? toolCalls : null };
}
