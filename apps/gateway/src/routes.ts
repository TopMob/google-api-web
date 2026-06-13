import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { MODELS } from "./utils/models.js";
import { isCookieValidCached, loadCookie } from "./utils/cookie.js";
import { chatCompletionController } from "./controllers/chatController.js";
import { responsesApiController } from "./controllers/responsesController.js";

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

  server.get("/v1/models", async () => {
    return {
      object: "list",
      data: Object.entries(MODELS).map(([id, cfg]) => ({
        id,
        object: "model",
        created: 1700000000,
        owned_by: "google",
        description: cfg.desc
      }))
    };
  });

  server.post("/v1/chat/completions", chatCompletionController);
  server.post("/v1/responses", responsesApiController);
}
