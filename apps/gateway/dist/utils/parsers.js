export function cleanGeminiText(text) {
    return text.replace(/```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g, "");
}
export function extractResponseText(raw) {
    let finalResult = "";
    let pos = 0;
    while (pos < raw.length) {
        let nextNL = raw.indexOf("\n", pos);
        if (nextNL === -1)
            nextNL = raw.length;
        const line = raw.substring(pos, nextNL);
        pos = nextNL + 1;
        if (line.length < 200 || !line.includes('"wrb.fr"'))
            continue;
        try {
            const innerStr = JSON.parse(line)[0][2];
            if (!innerStr || innerStr.length < 50)
                continue;
            const inner = JSON.parse(innerStr);
            if (Array.isArray(inner) && inner[4]) {
                let text = "";
                for (const part of inner[4]) {
                    if (Array.isArray(part) && part[1] && Array.isArray(part[1])) {
                        text += part[1].filter((t) => typeof t === "string").join("");
                    }
                }
                if (text.trim())
                    finalResult = text;
            }
        }
        catch { }
    }
    return cleanGeminiText(finalResult).trim();
}
export function messagesToPrompt(messages, tools, responseFormat) {
    const parts = [];
    if (responseFormat?.type === "json_object") {
        parts.push("[System instruction]: You MUST respond with a valid JSON object. Do not include markdown code block formatting.");
    }
    if (tools && tools.length > 0) {
        const toolDefs = tools.map((tool) => {
            const fn = tool.type === "function" ? tool.function : tool;
            return {
                name: fn.name || tool.name || "",
                description: fn.description || tool.description || "",
                parameters: fn.parameters || tool.parameters || {}
            };
        });
        parts.push("[System instruction]: You have access to tools. To call a tool, respond with:\n" +
            "```tool_call\n" +
            '{"name": "func_name", "arguments": {...}}\n' +
            "```\n" +
            "Only use tool_call blocks when needed.\n\n" +
            `Available tools:\n${JSON.stringify(toolDefs, null, 2)}`);
    }
    for (const msg of messages) {
        const role = msg.role || "user";
        let content = msg.content || "";
        if (Array.isArray(content)) {
            content = content
                .filter((c) => c.type === "text" || c.type === "input_text")
                .map((c) => c.text || "")
                .join(" ");
        }
        if (role === "system") {
            parts.push(`[System instruction]: ${content}`);
        }
        else if (role === "assistant") {
            if (msg.tool_calls) {
                const tcStrs = msg.tool_calls.map((tc) => {
                    const fn = tc.function || {};
                    let argsObj = fn.arguments || {};
                    if (typeof argsObj === "string") {
                        try {
                            argsObj = JSON.parse(argsObj);
                        }
                        catch { }
                    }
                    return `\`\`\`tool_call\n${JSON.stringify({ name: fn.name, arguments: argsObj })}\n\`\`\``;
                });
                parts.push(`[Assistant]: ${content || ""}\n` + tcStrs.join("\n"));
            }
            else {
                parts.push(`[Assistant]: ${content}`);
            }
        }
        else if (role === "tool") {
            const toolName = msg.name || msg.tool_call_id || "";
            const toolResult = typeof content === "object" ? JSON.stringify(content) : content;
            parts.push(`[Tool result for ${toolName}]: ${toolResult}`);
        }
        else {
            parts.push(content ? String(content) : "");
        }
    }
    return parts.filter(Boolean).join("\n\n");
}
export function parseToolCalls(text) {
    const toolCalls = [];
    const regex = /```tool_call\s*([\s\S]*?)\s*```/g;
    for (const match of text.matchAll(regex)) {
        try {
            const data = JSON.parse(match[1].trim());
            const args = data.arguments || {};
            const argumentsStr = typeof args === "string" ? args : JSON.stringify(args);
            toolCalls.push({
                id: `call_${Math.random().toString(36).substring(2, 10)}`,
                type: "function",
                function: { name: data.name, arguments: argumentsStr }
            });
        }
        catch { }
    }
    const cleanText = text.replace(regex, "").trim();
    return { cleanText, toolCalls: toolCalls.length > 0 ? toolCalls : null };
}
export function cleanJsonResponse(text) {
    let clean = text.trim();
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    clean = clean.replace(/```json/gi, "").replace(/```/g, "").trim();
    const firstBrace = clean.indexOf("{");
    const firstBracket = clean.indexOf("[");
    let startIdx = -1;
    let isObject = false;
    if (firstBrace !== -1 && firstBracket !== -1) {
        if (firstBrace < firstBracket) {
            startIdx = firstBrace;
            isObject = true;
        }
        else {
            startIdx = firstBracket;
            isObject = false;
        }
    }
    else if (firstBrace !== -1) {
        startIdx = firstBrace;
        isObject = true;
    }
    else if (firstBracket !== -1) {
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
