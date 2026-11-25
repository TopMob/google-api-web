import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getModels, refreshModels } from "./utils/models.js";
import { isCookieValidCached, loadCookie, discoverGoogleAccounts, clearCookieDiscoveryCache } from "./utils/cookie.js";
import { chatCompletionController } from "./controllers/chatController.js";
import { responsesApiController } from "./controllers/responsesController.js";
import {
  googleGetModelsController,
  googleGetModelDetailController,
  googleGenerateContentController
} from "./controllers/googleNativeController.js";
import { store } from "./db.js";
import { saveCookieFile, getCookieStatus } from "./utils/cookieManager.js";
import { geminiCircuitBreaker } from "./utils/circuitBreaker.js";

export function registerRoutes(server: FastifyInstance) {
  server.get("/health", async (_request: FastifyRequest, reply: FastifyReply) => {
    const loaded = loadCookie();
    const cbStatus = geminiCircuitBreaker.getStatus();
    let cookieValid: boolean | null = null;

    if (loaded.cookieStr) {
      cookieValid = await isCookieValidCached(loaded.cookieStr, loaded.sapisid);
      if (!cookieValid) {
        return reply.status(200).send({
          status: "warning",
          cookieValid: false,
          circuitBreaker: cbStatus,
          message: "Gemini session cookie has expired or is invalid. Please refresh the cookie file."
        });
      }
    }
    return { status: "ok", cookieValid, circuitBreaker: cbStatus };
  });

  server.get("/", async () => {
    return { status: "ok" };
  });

  const getModelsHandler = async () => {
    const models = getModels();
    return {
      object: "list",
      data: Object.entries(models).map(([id, cfg]) => ({
        id,
        object: "model",
        created: 1700000000,
        owned_by: "google",
        description: cfg.desc
      }))
    };
  };

  server.get("/v1/models", getModelsHandler);
  server.get("/models", getModelsHandler);

  // Google Native Gemini CLI compatibility
  server.get("/v1beta/models", googleGetModelsController);
  server.get("/v1beta/models/:model", googleGetModelDetailController);
  server.post("/v1beta/models/*", googleGenerateContentController);

  server.post("/v1/chat/completions", chatCompletionController);
  server.post("/chat/completions", chatCompletionController);

  server.post("/v1/responses", responsesApiController);
  server.post("/responses", responsesApiController);

  // ── Management API ──────────────────────────────────────────────

  // Projects
  server.get("/api/projects", async () => {
    return store.getProjects();
  });

  server.post("/api/projects", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const name = body?.name;
    if (!name || typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "Project name is required" });
    }
    return store.createProject(name.trim());
  });

  // API Keys
  server.get("/api/keys", async () => {
    return store.getApiKeys();
  });

  server.post("/api/keys", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const {
      name,
      project_id,
      allowed_models,
      daily_requests_limit,
      daily_tokens_limit,
      rate_limit_rpm,
      temporary_chats,
      expires_at
    } = body || {};
    if (!name || !project_id) {
      return reply.status(400).send({ error: "Name and project_id are required" });
    }
    return store.createApiKey({
      name: String(name).trim(),
      project_id,
      allowed_models: Array.isArray(allowed_models) && allowed_models.length > 0 ? allowed_models : null,
      daily_requests_limit: daily_requests_limit ? parseInt(daily_requests_limit, 10) : null,
      daily_tokens_limit: daily_tokens_limit ? parseInt(daily_tokens_limit, 10) : null,
      rate_limit_rpm: rate_limit_rpm ? parseInt(rate_limit_rpm, 10) : null,
      temporary_chats: typeof temporary_chats === "boolean" ? temporary_chats : true,
      expires_at: expires_at || null
    });
  });

  server.patch("/api/keys", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const { id, active, temporary_chats } = body || {};
    if (!id || (typeof active !== "boolean" && typeof temporary_chats !== "boolean")) {
      return reply.status(400).send({ error: "id and at least one field (active, temporary_chats) are required" });
    }
    const result = store.updateApiKey(id, { active, temporary_chats });
    if (!result) {
      return reply.status(404).send({ error: "API key not found" });
    }
    return result;
  });

  server.delete("/api/keys", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { id?: string };
    const body = (request.body as { id?: string } | undefined) || {};
    const id = query?.id || body?.id;
    if (!id) {
      return reply.status(400).send({ error: "id is required" });
    }
    const ok = store.deleteApiKey(id);
    if (!ok) {
      return reply.status(404).send({ error: "API key not found" });
    }
    return { deleted: true, id };
  });

  server.delete("/api/keys/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const ok = store.deleteApiKey(params.id);
    if (!ok) {
      return reply.status(404).send({ error: "API key not found" });
    }
    return { deleted: true, id: params.id };
  });

  // Stats / Usage
  server.get("/api/stats", async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const parsedLimit = query?.limit ? parseInt(query.limit, 10) : 50;
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(1, parsedLimit), 500) : 50;
    return store.getStats(safeLimit);
  });

  server.delete("/api/stats", async () => {
    store.clearUsageLogs();
    return { cleared: true };
  });

  // Cookie Management
  server.post(
    "/api/cookies/save",
    { bodyLimit: 25 * 1024 * 1024 },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as any;
      const cookieStr = body?.cookie;
      if (!cookieStr || typeof cookieStr !== "string") {
        return reply.status(400).send({ error: "Cookie string is required" });
      }
      const saved = await saveCookieFile(cookieStr.trim());
      clearCookieDiscoveryCache();
      return saved;
    }
  );

  server.get("/api/cookies/status", async () => {
    return await getCookieStatus();
  });

  // Google Multi-Account Discovery & Switching
  server.get("/api/accounts", async (request: FastifyRequest) => {
    const query = request.query as { refresh?: string };
    const forceRefresh = query?.refresh === "true" || query?.refresh === "1";
    const loaded = loadCookie();
    const activeAuthUser = store.getAuthUser();
    if (!loaded.cookieStr) {
      return { activeAuthUser, accounts: [] };
    }
    const accounts = await discoverGoogleAccounts(loaded.cookieStr, loaded.sapisid, forceRefresh);
    return { activeAuthUser, accounts };
  });

  server.post("/api/accounts/select", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { authUser?: unknown } | undefined;
    const rawAuthUser = body?.authUser;
    if (typeof rawAuthUser !== "string" || !/^[0-9]$/.test(rawAuthUser.trim())) {
      return reply.status(400).send({ error: "authUser must be a single digit index (0-9)" });
    }
    const activeAuthUser = store.setAuthUser(rawAuthUser.trim());
    await refreshModels();
    return { ok: true, activeAuthUser };
  });
}
