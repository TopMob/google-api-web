import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getModels } from "./utils/models.js";
import { isCookieValidCached, loadCookie } from "./utils/cookie.js";
import { chatCompletionController } from "./controllers/chatController.js";
import { responsesApiController } from "./controllers/responsesController.js";
import { store } from "./db.js";
import { saveCookieFile, getCookieStatus } from "./utils/cookieManager.js";

export function registerRoutes(server: FastifyInstance) {
  server.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
    const loaded = loadCookie();
    if (loaded.cookieStr) {
      const isValid = await isCookieValidCached(loaded.cookieStr, loaded.sapisid);
      if (!isValid) {
        return reply.status(200).send({
          status: "warning",
          message: "Gemini session cookie has expired or is invalid. Please refresh the cookie file."
        });
      }
    }
    return { status: "ok" };
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
    if (!name) {
      return reply.status(400).send({ error: "Project name is required" });
    }
    return store.createProject(name);
  });

  // API Keys
  server.get("/api/keys", async () => {
    return store.getApiKeys();
  });

  server.post("/api/keys", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const { name, project_id, allowed_models, daily_requests_limit, daily_tokens_limit, rate_limit_rpm, expires_at } =
      body || {};
    if (!name || !project_id) {
      return reply.status(400).send({ error: "Name and project_id are required" });
    }
    return store.createApiKey({
      name,
      project_id,
      allowed_models: allowed_models || null,
      daily_requests_limit: daily_requests_limit ? parseInt(daily_requests_limit, 10) : null,
      daily_tokens_limit: daily_tokens_limit ? parseInt(daily_tokens_limit, 10) : null,
      rate_limit_rpm: rate_limit_rpm ? parseInt(rate_limit_rpm, 10) : null,
      expires_at: expires_at || null
    });
  });

  server.patch("/api/keys", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const { id, active } = body || {};
    if (!id || typeof active !== "boolean") {
      return reply.status(400).send({ error: "id and active state are required" });
    }
    const result = store.toggleApiKey(id, active);
    if (!result) {
      return reply.status(404).send({ error: "API key not found" });
    }
    return result;
  });

  // Stats / Usage
  server.get("/api/stats", async () => {
    return store.getStats();
  });

  // Cookie Management
  server.post("/api/cookies/save", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const cookieStr = body?.cookie;
    if (!cookieStr || typeof cookieStr !== "string") {
      return reply.status(400).send({ error: "Cookie string is required" });
    }
    return await saveCookieFile(cookieStr.trim());
  });

  server.get("/api/cookies/status", async () => {
    return await getCookieStatus();
  });
}
