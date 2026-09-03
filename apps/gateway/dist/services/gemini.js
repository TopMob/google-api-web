import { v4 as uuidv4 } from "uuid";
import { GEMINI_BL, AUTH_USER, RETRY_ATTEMPTS } from "../config.js";
import { loadCookie, makeSapisidHash, parseRawCookieString, getGeminiSessionInfo } from "../utils/cookie.js";
import { fetchWithRetry } from "../utils/fetchWithRetry.js";
class GeminiPayloadBuilder {
  payload = [];
  set(index, value) {
    while (this.payload.length <= index) {
      this.payload.push(null);
    }
    this.payload[index] = value;
    return this;
  }
  setPrompt(prompt) {
    return this.set(0, [prompt, 0, null, null, null, null, 0]);
  }
  setLanguage(lang) {
    return this.set(1, [lang]);
  }
  setContextOptions() {
    return this.set(2, ["", "", "", null, null, null, null, null, null, ""]);
  }
  setThinkMode(mode) {
    return this.set(17, [[mode]]);
  }
  setSessionId(id) {
    return this.set(59, id);
  }
  setModelId(id) {
    return this.set(79, id);
  }
  setStaticFlags() {
    return this.set(6, [0])
      .set(7, 1)
      .set(10, 1)
      .set(11, 0)
      .set(18, 0)
      .set(27, 1)
      .set(30, [4])
      .set(41, [2])
      .set(53, 0)
      .set(61, [])
      .set(68, 1);
  }
  build() {
    while (this.payload.length < 80) {
      this.payload.push(null);
    }
    return JSON.stringify([null, JSON.stringify(this.payload)]);
  }
}
export async function buildGeminiRequest(prompt, modelId, thinkMode, customCookie) {
  let cookieStr = "";
  let sapisid = null;
  if (customCookie) {
    const parsed = parseRawCookieString(customCookie);
    cookieStr = parsed.cookieStr;
    sapisid = parsed.sapisid;
  } else {
    const loaded = loadCookie();
    cookieStr = loaded.cookieStr;
    sapisid = loaded.sapisid;
  }
  // Get dynamic build label and SNlM0e token
  const sessionInfo = await getGeminiSessionInfo(cookieStr, sapisid);
  const bl = sessionInfo.bl || GEMINI_BL;
  const sn = sessionInfo.sn;
  const payloadStr = new GeminiPayloadBuilder()
    .setPrompt(prompt)
    .setLanguage("en")
    .setContextOptions()
    .setThinkMode(thinkMode)
    .setSessionId(uuidv4())
    .setModelId(modelId)
    .setStaticFlags()
    .build();
  const bodyParams = new URLSearchParams();
  bodyParams.append("f.req", payloadStr);
  if (sn) {
    bodyParams.append("at", sn);
  }
  const reqid = Math.floor(Date.now() / 1000) % 1000000;
  const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "";
  const url = `https://gemini.google.com${prefix}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${bl}&hl=en&_reqid=${reqid}&rt=c`;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    Origin: "https://gemini.google.com",
    Referer: `https://gemini.google.com${prefix}/app`,
    "X-Same-Domain": "1",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };
  if (AUTH_USER) {
    headers["X-Goog-AuthUser"] = String(AUTH_USER);
  }
  if (cookieStr) {
    headers["Cookie"] = cookieStr;
  }
  if (sapisid) {
    headers["Authorization"] = makeSapisidHash(sapisid);
  }
  return { url, headers, body: bodyParams.toString() };
}
export async function geminiStreamGenerate(prompt, modelId, thinkMode, customCookie, signal) {
  const { url, headers, body } = await buildGeminiRequest(prompt, modelId, thinkMode, customCookie);
  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers,
      body,
      keepalive: true,
      signal
    },
    { maxRetries: RETRY_ATTEMPTS }
  );
  const reader = response.body?.getReader();
  if (!reader) {
    return await response.text();
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let fullOutput = "";
  let isCompleted = false;
  while (!isCompleted) {
    const { done, value } = await reader.read();
    if (done) break;
    const textChunk = decoder.decode(value, { stream: true });
    fullOutput += textChunk;
    buffer += textChunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.includes('["di",') || line.includes('["e",') || line.includes('"af.httprm"')) {
        isCompleted = true;
        break;
      }
      if (line.includes('"wrb.fr"') && line.length > 50) {
        try {
          const innerStr = JSON.parse(line)[0][2];
          if (innerStr) {
            const inner = JSON.parse(innerStr);
            const candidates = [inner[4], inner[0]].filter(Boolean);
            for (const candidate of candidates) {
              if (Array.isArray(candidate)) {
                for (const part of candidate) {
                  if (Array.isArray(part) && Array.isArray(part[8]) && part[8].includes(2)) {
                    isCompleted = true;
                    break;
                  }
                }
              }
              if (isCompleted) break;
            }
          }
        } catch {}
      }
      if (isCompleted) break;
    }
  }
  try {
    reader.cancel();
  } catch {}
  return fullOutput;
}
