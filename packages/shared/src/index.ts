export interface ModelConfig {
  mode: number;
  think: number;
  desc: string;
}

export const MODELS: Record<string, ModelConfig> = {
  "gemini-3.5-flash": {
    mode: 1,
    think: 4,
    desc: "Fast general-purpose model"
  },
  "gemini-3.5-flash-thinking": {
    mode: 2,
    think: 0,
    desc: "Deep thinking mode, longest output (~20k chars)"
  },
  "gemini-3.1-pro": {
    mode: 3,
    think: 4,
    desc: "Pro model (requires cookie for real routing)"
  },
  "gemini-auto": {
    mode: 4,
    think: 4,
    desc: "Auto model selection"
  },
  "gemini-3.5-flash-thinking-lite": {
    mode: 5,
    think: 0,
    desc: "Dynamic thinking with adaptive depth"
  },
  "gemini-flash-lite": {
    mode: 6,
    think: 4,
    desc: "Lightweight fast model"
  }
};
