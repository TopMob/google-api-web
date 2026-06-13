import fastify from "fastify";
import { PORT, HOST } from "./config.js";
import { logger } from "./logger.js";
import { registerRoutes } from "./routes.js";
import { closeDatabaseConnections } from "./db.js";
import { normalizeError } from "./utils/errors.js";

const server = fastify({ logger: logger as any });

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
    await server.listen({ port: PORT, host: HOST });
    logger.info(`Gateway listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
for (const signal of signals) {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
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
