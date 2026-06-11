import { v4 as uuidv4 } from "uuid";
import { GEMINI_BL, AUTH_USER, RETRY_ATTEMPTS, RETRY_DELAY_SEC } from "../config.js";
import { loadCookie, makeSapisidHash } from "../utils/cookie.js";
export function buildGeminiRequest(prompt, modelId, thinkMode, customCookie) {
    const inner = new Array(80).fill(null);
    inner[0] = [prompt, 0, null, null, null, null, 0];
    inner[1] = ["en"];
    inner[2] = ["", "", "", null, null, null, null, null, null, ""];
    inner[6] = [0];
    inner[7] = 1;
    inner[10] = 1;
    inner[11] = 0;
    inner[17] = [[thinkMode]];
    inner[18] = 0;
    inner[27] = 1;
    inner[30] = [4];
    inner[41] = [2];
    inner[53] = 0;
    inner[59] = uuidv4();
    inner[61] = [];
    inner[68] = 1;
    inner[79] = modelId;
    const outer = [null, JSON.stringify(inner)];
    const bodyParams = new URLSearchParams();
    bodyParams.append("f.req", JSON.stringify(outer));
    const reqid = Math.floor(Date.now() / 1000) % 1000000;
    const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "";
    const url = `https://gemini.google.com${prefix}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${GEMINI_BL}&hl=en&_reqid=${reqid}&rt=c`;
    const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://gemini.google.com",
        "Referer": `https://gemini.google.com${prefix}/app`,
        "X-Same-Domain": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };
    if (AUTH_USER) {
        headers["X-Goog-AuthUser"] = String(AUTH_USER);
    }
    let cookieStr = "";
    let sapisid = null;
    if (customCookie) {
        const trimmed = customCookie.trim();
        if (trimmed.startsWith("{")) {
            try {
                const data = JSON.parse(trimmed);
                cookieStr = data.cookie || "";
                sapisid = data.sapisid || cookieStr.match(/SAPISID=([^;]+)/)?.[1] || null;
            }
            catch {
                cookieStr = trimmed;
                sapisid = trimmed.match(/SAPISID=([^;]+)/)?.[1] || null;
            }
        }
        else {
            cookieStr = trimmed;
            sapisid = trimmed.match(/SAPISID=([^;]+)/)?.[1] || null;
        }
    }
    else {
        const loaded = loadCookie();
        cookieStr = loaded.cookieStr;
        sapisid = loaded.sapisid;
    }
    if (cookieStr) {
        headers["Cookie"] = cookieStr;
    }
    if (sapisid) {
        headers["Authorization"] = makeSapisidHash(sapisid);
    }
    return { url, headers, body: bodyParams.toString() };
}
export async function geminiStreamGenerate(prompt, modelId, thinkMode, customCookie) {
    const { url, headers, body } = buildGeminiRequest(prompt, modelId, thinkMode, customCookie);
    let lastErr = null;
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers,
                body,
                keepalive: true
            });
            if (!response.ok) {
                throw new Error(`Upstream returned ${response.status}`);
            }
            return await response.text();
        }
        catch (e) {
            lastErr = e;
            if (attempt < RETRY_ATTEMPTS - 1) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_SEC * 1000));
            }
        }
    }
    throw lastErr;
}
