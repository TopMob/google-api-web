import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "./logger.js";
import { AUTH_USER } from "./config.js";

export interface StoredProject {
  id: string;
  name: string;
  created_at: string;
}

export interface StoredApiKey {
  id: string;
  key: string;
  name: string;
  project_id: string;
  active: boolean;
  allowed_models: string[] | null;
  daily_requests_limit: number | null;
  daily_tokens_limit: number | null;
  rate_limit_rpm: number | null;
  temporary_chats?: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface StoredUsageLog {
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
}

interface StoreData {
  projects: StoredProject[];
  api_keys: StoredApiKey[];
  usage_logs: StoredUsageLog[];
  auth_user?: string;
}

const DEFAULT_PROJECT: StoredProject = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Personal",
  created_at: new Date().toISOString()
};

const DEFAULT_API_KEY: StoredApiKey = {
  id: "00000000-0000-0000-0000-000000000001",
  key: "sk-personal-gw",
  name: "Default Key",
  project_id: "00000000-0000-0000-0000-000000000000",
  active: true,
  allowed_models: null,
  daily_requests_limit: null,
  daily_tokens_limit: null,
  rate_limit_rpm: null,
  temporary_chats: true,
  expires_at: null,
  created_at: new Date().toISOString()
};

export class LocalStore {
  private data: StoreData;
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 2000;
  private readonly MAX_USAGE_LOGS = 500;

  constructor(customFilePath?: string) {
    if (customFilePath) {
      this.filePath = path.resolve(customFilePath);
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.data = this.load();
      return;
    }

    const storePaths = [
      path.resolve(process.cwd(), "data/store.json"),
      path.resolve(process.cwd(), "apps/gateway/data/store.json"),
      path.resolve(process.cwd(), "../../data/store.json")
    ];

    // Try to find existing store
    let found = false;
    this.filePath = storePaths[0];
    for (const p of storePaths) {
      if (fs.existsSync(p)) {
        this.filePath = p;
        found = true;
        break;
      }
    }

    // If not found, use first path that we can create
    if (!found) {
      for (const p of storePaths) {
        try {
          const dir = path.dirname(p);
          fs.mkdirSync(dir, { recursive: true });
          this.filePath = p;
          break;
        } catch {}
      }
    }

    this.data = this.load();
    logger.info(`LocalStore initialized at ${this.filePath}`);
  }

  private load(): StoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(content) as StoreData;
        // Ensure all arrays exist
        return {
          projects: parsed.projects || [DEFAULT_PROJECT],
          api_keys: parsed.api_keys || [DEFAULT_API_KEY],
          usage_logs: parsed.usage_logs || [],
          auth_user: typeof parsed.auth_user === "string" ? parsed.auth_user : undefined
        };
      }
    } catch (e) {
      logger.error({ err: e }, "Failed to load store file, creating new one");
    }

    // Create default store
    const defaultData: StoreData = {
      projects: [DEFAULT_PROJECT],
      api_keys: [DEFAULT_API_KEY],
      usage_logs: []
    };
    this.saveSync(defaultData);
    return defaultData;
  }

  private saveSync(data?: StoreData) {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data || this.data, null, 2), "utf-8");
    } catch (e) {
      logger.error({ err: e }, "Failed to save store file");
    }
  }

  private scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveSync();
      this.saveTimer = null;
    }, this.SAVE_DEBOUNCE_MS);
  }

  // Projects
  getProjects(): StoredProject[] {
    return this.data.projects;
  }

  createProject(name: string): StoredProject {
    const project: StoredProject = {
      id: crypto.randomUUID(),
      name,
      created_at: new Date().toISOString()
    };
    this.data.projects.push(project);
    this.scheduleSave();
    return project;
  }

  // API Keys
  getApiKeys(): (StoredApiKey & { projects?: { name: string } })[] {
    return this.data.api_keys.map((key) => {
      const project = this.data.projects.find((p) => p.id === key.project_id);
      return {
        ...key,
        temporary_chats: key.temporary_chats ?? true,
        projects: project ? { name: project.name } : undefined
      };
    });
  }

  findApiKey(keyStr: string): StoredApiKey | null {
    return this.data.api_keys.find((k) => k.key === keyStr && k.active) || null;
  }

  createApiKey(params: {
    name: string;
    project_id: string;
    allowed_models?: string[] | null;
    daily_requests_limit?: number | null;
    daily_tokens_limit?: number | null;
    rate_limit_rpm?: number | null;
    temporary_chats?: boolean;
    expires_at?: string | null;
  }): StoredApiKey {
    const key: StoredApiKey = {
      id: crypto.randomUUID(),
      key: `sk-personal-gw-${crypto.randomBytes(24).toString("hex")}`,
      name: params.name,
      project_id: params.project_id,
      active: true,
      allowed_models: params.allowed_models || null,
      daily_requests_limit: params.daily_requests_limit || null,
      daily_tokens_limit: params.daily_tokens_limit || null,
      rate_limit_rpm: params.rate_limit_rpm || null,
      temporary_chats: params.temporary_chats ?? true,
      expires_at: params.expires_at || null,
      created_at: new Date().toISOString()
    };
    this.data.api_keys.push(key);
    this.scheduleSave();
    return key;
  }

  toggleApiKey(id: string, active: boolean): StoredApiKey | null {
    const key = this.data.api_keys.find((k) => k.id === id);
    if (!key) return null;
    key.active = active;
    this.scheduleSave();
    return key;
  }

  updateApiKey(id: string, updates: { active?: boolean; temporary_chats?: boolean }): StoredApiKey | null {
    const key = this.data.api_keys.find((k) => k.id === id);
    if (!key) return null;
    if (typeof updates.active === "boolean") key.active = updates.active;
    if (typeof updates.temporary_chats === "boolean") key.temporary_chats = updates.temporary_chats;
    this.scheduleSave();
    return key;
  }

  clearUsageLogs(): void {
    this.data.usage_logs = [];
    this.scheduleSave();
  }

  getAuthUser(): string {
    return this.data.auth_user || AUTH_USER || "0";
  }

  setAuthUser(idx: string): string {
    const normalized = String(idx).trim();
    this.data.auth_user = normalized;
    this.scheduleSave();
    return normalized;
  }

  deleteApiKey(id: string): boolean {
    const idx = this.data.api_keys.findIndex((k) => k.id === id);
    if (idx === -1) return false;
    this.data.api_keys.splice(idx, 1);
    this.scheduleSave();
    return true;
  }

  getDailyUsageForKey(apiKeyId: string): { requests: number; tokens: number } {
    const todayPrefix = new Date().toISOString().slice(0, 10);
    let requests = 0;
    let tokens = 0;
    for (const log of this.data.usage_logs) {
      if (log.api_key_id === apiKeyId && log.created_at.startsWith(todayPrefix)) {
        requests += 1;
        tokens += log.total_tokens || 0;
      }
    }
    return { requests, tokens };
  }

  // Usage Logs
  addUsageLog(log: Omit<StoredUsageLog, "id" | "created_at">): StoredUsageLog {
    const entry: StoredUsageLog = {
      ...log,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString()
    };
    this.data.usage_logs.push(entry);

    // Trim old logs to prevent unbounded growth
    if (this.data.usage_logs.length > this.MAX_USAGE_LOGS) {
      this.data.usage_logs = this.data.usage_logs.slice(-this.MAX_USAGE_LOGS);
    }

    this.scheduleSave();
    return entry;
  }

  getUsageLogs(limit = 50): (StoredUsageLog & { projects?: { name: string }; api_keys?: { name: string } })[] {
    const boundedLimit = Math.min(Math.max(1, limit), this.MAX_USAGE_LOGS);
    const logs = this.data.usage_logs.slice(-boundedLimit).reverse();
    return logs.map((log) => {
      const project = this.data.projects.find((p) => p.id === log.project_id);
      const apiKey = this.data.api_keys.find((k) => k.id === log.api_key_id);
      return {
        ...log,
        projects: project ? { name: project.name } : undefined,
        api_keys: apiKey ? { name: apiKey.name } : undefined
      };
    });
  }

  getStats(limit = 50) {
    const logs = this.data.usage_logs;
    const totalRequests = logs.length;
    const totalPromptTokens = logs.reduce((acc, curr) => acc + (curr.prompt_tokens || 0), 0);
    const totalCompletionTokens = logs.reduce((acc, curr) => acc + (curr.completion_tokens || 0), 0);
    const totalTokens = logs.reduce((acc, curr) => acc + (curr.total_tokens || 0), 0);
    const totalDuration = logs.reduce((acc, curr) => acc + (curr.duration_ms || 0), 0);
    const avgDurationMs = totalRequests > 0 ? Math.round(totalDuration / totalRequests) : 0;
    const successful = logs.filter((l) => l.status_code >= 200 && l.status_code < 300).length;
    const successRate = totalRequests > 0 ? Math.round((successful / totalRequests) * 100) : 100;

    return {
      totalRequests,
      totalTokens,
      totalPromptTokens,
      totalCompletionTokens,
      avgDurationMs,
      successRate,
      recentLogs: this.getUsageLogs(limit)
    };
  }

  // Graceful shutdown
  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveSync();
  }
}

export const store = new LocalStore();

export async function closeDatabaseConnections() {
  store.flush();
  logger.info("LocalStore flushed to disk");
}
