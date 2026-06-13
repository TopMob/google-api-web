import { v4 as uuidv4 } from "uuid";
import { GEMINI_BL, AUTH_USER, RETRY_ATTEMPTS } from "../config.js";
import { loadCookie, makeSapisidHash } from "../utils/cookie.js";
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
    // Pad to ensure at least 80 elements, as Google's backend often expects a specific length
    while (this.payload.length < 80) {
      this.payload.push(null);
    }
    return JSON.stringify([null, JSON.stringify(this.payload)]);
  }
}
export function buildGeminiRequest(prompt, modelId, thinkMode, customCookie) {
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
  const reqid = Math.floor(Date.now() / 1000) % 1000000;
  const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "";
  const url = `https://gemini.google.com${prefix}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${GEMINI_BL}&hl=en&_reqid=${reqid}&rt=c`;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: "https://gemini.google.com",
    Referer: `https://gemini.google.com${prefix}/app`,
    "X-Same-Domain": "1",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
      } catch {
        cookieStr = trimmed;
        sapisid = trimmed.match(/SAPISID=([^;]+)/)?.[1] || null;
      }
    } else {
      cookieStr = trimmed;
      sapisid = trimmed.match(/SAPISID=([^;]+)/)?.[1] || null;
    }
  } else {
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
import { fetchWithRetry } from "../utils/fetchWithRetry.js";
export async function geminiStreamGenerate(prompt, modelId, thinkMode, customCookie, signal) {
  const { url, headers, body } = buildGeminiRequest(prompt, modelId, thinkMode, customCookie);
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
  return await response.text();
}
