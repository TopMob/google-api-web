import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "./logger.js";
const DEFAULT_PROJECT = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Personal",
  created_at: new Date().toISOString()
};
const DEFAULT_API_KEY = {
  id: "00000000-0000-0000-0000-000000000001",
  key: "sk-personal-gw",
  name: "Default Key",
  project_id: "00000000-0000-0000-0000-000000000000",
  active: true,
  allowed_models: null,
  daily_requests_limit: null,
  daily_tokens_limit: null,
  rate_limit_rpm: null,
  expires_at: null,
  created_at: new Date().toISOString()
};
class LocalStore {
  data;
  filePath;
  saveTimer = null;
  SAVE_DEBOUNCE_MS = 2000;
  MAX_USAGE_LOGS = 500;
  constructor() {
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
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(content);
        // Ensure all arrays exist
        return {
          projects: parsed.projects || [DEFAULT_PROJECT],
          api_keys: parsed.api_keys || [DEFAULT_API_KEY],
          usage_logs: parsed.usage_logs || []
        };
      }
    } catch (e) {
      logger.error({ err: e }, "Failed to load store file, creating new one");
    }
    // Create default store
    const defaultData = {
      projects: [DEFAULT_PROJECT],
      api_keys: [DEFAULT_API_KEY],
      usage_logs: []
    };
    this.saveSync(defaultData);
    return defaultData;
  }
  saveSync(data) {
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
  scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveSync();
      this.saveTimer = null;
    }, this.SAVE_DEBOUNCE_MS);
  }
  // Projects
  getProjects() {
    return this.data.projects;
  }
  createProject(name) {
    const project = {
      id: crypto.randomUUID(),
      name,
      created_at: new Date().toISOString()
    };
    this.data.projects.push(project);
    this.scheduleSave();
    return project;
  }
  // API Keys
  getApiKeys() {
    return this.data.api_keys.map((key) => {
      const project = this.data.projects.find((p) => p.id === key.project_id);
      return {
        ...key,
        projects: project ? { name: project.name } : undefined
      };
    });
  }
  findApiKey(keyStr) {
    return this.data.api_keys.find((k) => k.key === keyStr && k.active) || null;
  }
  createApiKey(params) {
    const key = {
      id: crypto.randomUUID(),
      key: `sk-personal-gw-${crypto.randomBytes(24).toString("hex")}`,
      name: params.name,
      project_id: params.project_id,
      active: true,
      allowed_models: params.allowed_models || null,
      daily_requests_limit: params.daily_requests_limit || null,
      daily_tokens_limit: params.daily_tokens_limit || null,
      rate_limit_rpm: params.rate_limit_rpm || null,
      expires_at: params.expires_at || null,
      created_at: new Date().toISOString()
    };
    this.data.api_keys.push(key);
    this.scheduleSave();
    return key;
  }
  toggleApiKey(id, active) {
    const key = this.data.api_keys.find((k) => k.id === id);
    if (!key) return null;
    key.active = active;
    this.scheduleSave();
    return key;
  }
  // Usage Logs
  addUsageLog(log) {
    const entry = {
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
  getUsageLogs(limit = 50) {
    const logs = this.data.usage_logs.slice(-limit).reverse();
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
  getStats() {
    const logs = this.data.usage_logs;
    const totalRequests = logs.length;
    const totalTokens = logs.reduce((acc, curr) => acc + (curr.total_tokens || 0), 0);
    const successful = logs.filter((l) => l.status_code >= 200 && l.status_code < 300).length;
    const successRate = totalRequests > 0 ? Math.round((successful / totalRequests) * 100) : 100;
    return {
      totalRequests,
      totalTokens,
      successRate,
      recentLogs: this.getUsageLogs(10)
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
