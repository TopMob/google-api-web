export interface ModelConfig {
  mode: number;
  think: number;
  desc: string;
}

export const MODELS: Record<string, ModelConfig> = {
  // ── Gemini 3.7 Series (Latest Generation) ─────────────────────────
  "gemini-3.7-flash": {
    mode: 1,
    think: 4,
    desc: "Gemini 3.7 Flash — High performance hybrid reasoning model"
  },
  "gemini-3.7-flash-thinking": {
    mode: 2,
    think: 0,
    desc: "Gemini 3.7 Flash Thinking — Dynamic reasoning with extended depth"
  },
  "gemini-3.7-pro": {
    mode: 3,
    think: 4,
    desc: "Gemini 3.7 Pro — Flagship professional intelligence"
  },

  // ── Gemini 3.5 Series ────────────────────────────────────────────
  "gemini-3.5-flash": {
    mode: 1,
    think: 4,
    desc: "Gemini 3.5 Flash — Fast general-purpose conversational model"
  },
  "gemini-3.5-flash-thinking": {
    mode: 2,
    think: 0,
    desc: "Gemini 3.5 Flash Thinking — Deep thinking mode (~20k output tokens)"
  },
  "gemini-3.5-flash-thinking-lite": {
    mode: 5,
    think: 0,
    desc: "Gemini 3.5 Flash Thinking Lite — Adaptive depth thinking"
  },

  // ── Gemini 3.1 & Pro Series ──────────────────────────────────────
  "gemini-3.1-pro": {
    mode: 3,
    think: 4,
    desc: "Gemini 3.1 Pro — High complexity reasoning"
  },
  "gemini-deep-research": {
    mode: 3,
    think: 0,
    desc: "Gemini Deep Research — Autonomous multi-step analysis"
  },

  // ── Auto & Utilities ─────────────────────────────────────────────
  "gemini-auto": {
    mode: 4,
    think: 4,
    desc: "Gemini Auto — Automatic intelligent routing"
  },
  "gemini-flash-lite": {
    mode: 6,
    think: 4,
    desc: "Gemini Flash Lite — Instant response latency"
  }
};
