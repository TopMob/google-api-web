import https from "https";
import { loadCookie, makeSapisidHash } from "./cookie.js";
import { AUTH_USER } from "../config.js";
import { logger } from "../logger.js";
// Real, currently active Gemini models lineup
const FALLBACK_MODELS = {
  "gemini-2.5-flash": {
    mode: 1,
    think: 4,
    desc: "Gemini 2.5 Flash — Fast, high-efficiency hybrid reasoning model (Recommended)"
  },
  "gemini-2.5-flash-thinking": {
    mode: 2,
    think: 0,
    desc: "Gemini 2.5 Flash Thinking — Dynamic reasoning with extended depth"
  },
  "gemini-2.5-pro": {
    mode: 3,
    think: 4,
    desc: "Gemini 2.5 Pro — Flagship advanced reasoning & coding intelligence"
  },
  "gemini-2.0-flash": {
    mode: 1,
    think: 4,
    desc: "Gemini 2.0 Flash — High-speed general conversational model"
  },
  "gemini-auto": {
    mode: 4,
    think: 4,
    desc: "Gemini Auto — Automatic intelligent routing based on task complexity"
  },
  // Convenient aliases
  "gemini-flash": {
    mode: 1,
    think: 4,
    desc: "Gemini Flash — Alias for latest flash model"
  },
  "gemini-pro": {
    mode: 3,
    think: 4,
    desc: "Gemini Pro — Alias for latest pro model"
  },
  "gemini-thinking": {
    mode: 2,
    think: 0,
    desc: "Gemini Thinking — Alias for latest reasoning model"
  }
};
// Known model name → mode mappings from Gemini's internal IDs
const KNOWN_MODE_MAP = {
  // Mode 1 = Flash models
  "gemini-2.5-flash": 1,
  "gemini-2.0-flash": 1,
  "gemini-3-flash-preview": 1,
  "gemini-flash": 1,
  // Mode 2 = Flash Thinking models (deep thinking)
  "gemini-2.5-flash-thinking": 2,
  "gemini-2.0-flash-thinking": 2,
  "gemini-flash-thinking": 2,
  "gemini-thinking": 2,
  // Mode 3 = Pro models (advanced reasoning)
  "gemini-2.5-pro": 3,
  "gemini-2.0-pro": 3,
  "gemini-3-pro-preview": 3,
  "gemini-advanced": 3,
  "gemini-pro": 3,
  // Mode 4 = Auto selection
  "gemini-auto": 4
};
// Thinking mode: 0 = extended thinking enabled, 4 = normal (no thinking)
const THINKING_MODE_MAP = {
  "gemini-2.5-flash-thinking": 0,
  "gemini-2.0-flash-thinking": 0,
  "gemini-flash-thinking": 0,
  "gemini-thinking": 0
};
let cachedModels = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let refreshTimer = null;
/**
 * Fetch available models directly from live Gemini page.
 */
async function fetchModelsFromGemini(cookieStr, sapisid) {
  return new Promise((resolve) => {
    try {
      const prefix = AUTH_USER ? `/u/${AUTH_USER}` : "";
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Cookie: cookieStr,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      };
      if (sapisid) {
        headers["Authorization"] = makeSapisidHash(sapisid);
      }
      const req = https.request(
        {
          hostname: "gemini.google.com",
          port: 443,
          path: `${prefix}/app`,
          method: "GET",
          headers,
          maxHeaderSize: 65536,
          timeout: 8000
        },
        (res) => {
          let html = "";
          res.on("data", (chunk) => (html += chunk));
          res.on("end", () => {
            const parsed = parseModelsFromHtml(html);
            if (parsed && Object.keys(parsed).length > 0) {
              const liveModels = { ...parsed };
              if (!liveModels["gemini-flash"]) {
                liveModels["gemini-flash"] = { mode: 1, think: 4, desc: "Gemini Flash (Latest)" };
              }
              if (!liveModels["gemini-pro"]) {
                liveModels["gemini-pro"] = { mode: 3, think: 4, desc: "Gemini Pro (Latest)" };
              }
              if (!liveModels["gemini-thinking"]) {
                liveModels["gemini-thinking"] = { mode: 2, think: 0, desc: "Gemini Thinking (Latest)" };
              }
              if (!liveModels["gemini-auto"]) {
                liveModels["gemini-auto"] = { mode: 4, think: 4, desc: "Gemini Auto Routing" };
              }
              resolve(liveModels);
            } else {
              resolve(null);
            }
          });
        }
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => {
        resolve(null);
      });
      req.end();
    } catch {
      resolve(null);
    }
  });
}
function parseModelsFromHtml(html) {
  const models = {};
  try {
    const modelNameRegex = /["'](?:models\/)?(gemini-[\w.-]+)["']/gi;
    const foundModelNames = new Set();
    let match;
    while ((match = modelNameRegex.exec(html)) !== null) {
      const name = match[1].toLowerCase();
      // Skip non-conversational components and UI assets
      if (
        name.includes("embedding") ||
        name.includes("test") ||
        name.includes("internal") ||
        name.includes("vision") ||
        name.includes("imagen") ||
        name.includes("grounding") ||
        name.includes("mac-panel") ||
        name.includes("while-signed-out") ||
        name.includes("progress-banner") ||
        name.includes("lesson-tile") ||
        name.includes("top-priority") ||
        name.includes("-tts") ||
        name.includes("-image")
      ) {
        continue;
      }
      // Match legitimate LLM model naming patterns
      if (/gemini-(?:[0-9]+(?:\.[0-9]+)?-(?:flash|pro)|[0-9]+-(?:flash|pro)|flash|pro|auto|advanced)/i.test(name)) {
        foundModelNames.add(name);
      }
    }
    if (foundModelNames.size === 0) {
      return null;
    }
    for (const name of foundModelNames) {
      const mode = KNOWN_MODE_MAP[name] || guessMode(name);
      const think = THINKING_MODE_MAP[name] ?? (name.includes("thinking") ? 0 : 4);
      const desc = generateDescription(name);
      models[name] = { mode, think, desc };
      // Add thinking variant for reasoning models
      if (!name.includes("thinking") && (name.includes("flash") || name.includes("pro"))) {
        const thinkingName = `${name}-thinking`;
        models[thinkingName] = {
          mode: 2,
          think: 0,
          desc: `${desc} (Extended Thinking)`
        };
      }
    }
    return Object.keys(models).length > 0 ? models : null;
  } catch {
    return null;
  }
}
export function guessMode(name) {
  const lower = name.toLowerCase();
  if (lower.includes("pro") || lower.includes("advanced") || lower.includes("research")) return 3;
  if (lower.includes("thinking-lite")) return 5;
  if (lower.includes("thinking")) return 2;
  if (lower.includes("flash-lite") || lower.includes("lite")) return 6;
  if (lower.includes("auto")) return 4;
  return 1;
}
function generateDescription(name) {
  const lower = name.toLowerCase();
  if (lower.includes("3.7")) {
    if (lower.includes("thinking")) return "Gemini 3.7 Flash Thinking — Dynamic hybrid reasoning";
    if (lower.includes("pro")) return "Gemini 3.7 Pro — Flagship professional intelligence";
    return "Gemini 3.7 Flash — High performance hybrid reasoning";
  }
  if (lower.includes("thinking")) return "Gemini Thinking model with deep chain-of-thought";
  if (lower.includes("pro")) return "Gemini Pro flagship reasoning model";
  if (lower.includes("flash-lite")) return "Gemini lightweight fast model";
  if (lower.includes("auto")) return "Gemini auto intelligent model selection";
  if (lower.includes("flash")) return "Gemini fast model";
  return "Google Gemini Model";
}
export function resolveModelConfig(rawModelName) {
  let modelName = rawModelName.trim();
  let thinkOverride = null;
  if (modelName.includes("@think=")) {
    const parts = modelName.split("@think=");
    modelName = parts[0];
    const val = parseInt(parts[1], 10);
    if (!isNaN(val)) {
      thinkOverride = val;
    }
  }
  const allModels = getModels();
  let baseConfig = allModels[modelName];
  if (!baseConfig) {
    const mode = KNOWN_MODE_MAP[modelName] || guessMode(modelName);
    const think = THINKING_MODE_MAP[modelName] ?? (modelName.includes("thinking") ? 0 : 4);
    baseConfig = {
      mode,
      think,
      desc: generateDescription(modelName)
    };
  }
  const finalConfig = {
    ...baseConfig,
    think: thinkOverride !== null ? thinkOverride : baseConfig.think
  };
  return { config: finalConfig, cleanModelName: modelName };
}
export async function refreshModels() {
  const { cookieStr, sapisid } = loadCookie();
  if (!cookieStr) {
    cachedModels = { ...FALLBACK_MODELS };
    cacheTimestamp = Date.now();
    return;
  }
  const fetched = await fetchModelsFromGemini(cookieStr, sapisid);
  if (fetched) {
    cachedModels = fetched;
    cacheTimestamp = Date.now();
    logger.info(`Loaded ${Object.keys(fetched).length} models from live session: ${Object.keys(fetched).join(", ")}`);
  } else {
    if (!cachedModels) {
      cachedModels = { ...FALLBACK_MODELS };
    }
    cacheTimestamp = Date.now();
  }
}
export function getModels() {
  if (!cachedModels) {
    return { ...FALLBACK_MODELS };
  }
  if (Date.now() - cacheTimestamp > CACHE_TTL_MS) {
    refreshModels().catch(() => {});
  }
  return cachedModels;
}
export function startModelRefreshTimer() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    refreshModels().catch(() => {});
  }, CACHE_TTL_MS);
}
export function stopModelRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
export const MODELS = FALLBACK_MODELS;
