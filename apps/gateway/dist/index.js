import fastify from "fastify";
import { PORT, HOST } from "./config.js";
import { logger } from "./logger.js";
import { registerRoutes } from "./routes.js";
import { closeDatabaseConnections } from "./db.js";
import { normalizeError } from "./utils/errors.js";
import { refreshModels, startModelRefreshTimer, stopModelRefreshTimer } from "./utils/models.js";
const server = fastify({
  logger: logger,
  disableRequestLogging: true
});
server.register(import("@fastify/helmet"), {
  contentSecurityPolicy: false
});
server.register(import("@fastify/cors"), {
  origin: "*"
});
server.setErrorHandler((error, request, reply) => {
  const normalized = normalizeError(error);
  request.log.error({ err: error }, `Unhandled error on ${request.method} ${request.url}`);
  return reply.status(normalized.status).send(normalized.body);
});
registerRoutes(server);
async function main() {
  try {
    // Fetch available models with safety timeout so server start is never blocked
    try {
      await Promise.race([
        refreshModels(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
      ]);
    } catch {
      logger.warn("Initial model refresh timed out or failed, using fallback models");
    }
    startModelRefreshTimer();
    await server.listen({ port: PORT, host: HOST });
    logger.info(`Gateway listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
const signals = ["SIGTERM", "SIGINT"];
for (const signal of signals) {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    stopModelRefreshTimer();
    try {
      await server.close();
      logger.info("Fastify server closed.");
    } catch (err) {
      logger.error({ err }, "Error closing Fastify server");
    }
    try {
      await closeDatabaseConnections();
    } catch (err) {
      logger.error({ err }, "Error closing database connections");
    }
    logger.info("Graceful shutdown complete.");
    process.exit(0);
  });
}
main();
