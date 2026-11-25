export interface ModelConfig {
  mode: number;
  think: number;
  desc: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  created_at: string;
}

export interface ApiKeyDto {
  id: string;
  key: string;
  name: string;
  project_id: string;
  active: boolean;
  projects?: { name: string };
  allowed_models: string[] | null;
  daily_requests_limit: number | null;
  daily_tokens_limit: number | null;
  rate_limit_rpm: number | null;
  expires_at: string | null;
  created_at: string;
}

export interface UsageLogDto {
  id: string;
  project_id: string;
  api_key_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  duration_ms: number;
  status_code: number;
  created_at: string;
  projects?: { name: string };
  api_keys?: { name: string };
}

export interface GatewayStatsDto {
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  avgDurationMs: number;
  successRate: number;
  recentLogs: UsageLogDto[];
}

export interface RequiredCookieInfo {
  name: string;
  required: boolean;
  desc: string;
}

export interface CookieStatusDto {
  hasFile: boolean;
  isValid: boolean | null;
  cookies: Record<string, boolean>;
  requiredCookies: RequiredCookieInfo[];
  bookmarklet?: string;
}

export interface HealthStatusDto {
  status: "online" | "offline" | "warning" | "checking";
  gatewayUrl: string;
  cookieValid?: boolean | null;
  circuitBreaker?: { state: string; failures: number };
  message?: string;
}

export const MODELS: Record<string, ModelConfig> = {
  "gemini-4-hydrogen": {
    mode: 1,
    think: 4,
    desc: "Gemini 4 Hydrogen — High-speed execution model"
  },
  "gemini-4-neon": {
    mode: 2,
    think: 0,
    desc: "Gemini 4 Neon — Mid-tier coding and deep reasoning model"
  },
  "gemini-4-argon": {
    mode: 3,
    think: 4,
    desc: "Gemini 4 Argon — Balanced heavy-duty frontier model"
  },
  "gemini-4-carbon": {
    mode: 3,
    think: 0,
    desc: "Gemini 4 Carbon — Flagship frontier reasoning model"
  },
  "gemini-auto": {
    mode: 4,
    think: 4,
    desc: "Gemini Auto — Automatic intelligent routing"
  }
};
