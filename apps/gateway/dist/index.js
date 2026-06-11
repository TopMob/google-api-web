import fastify from "fastify";
import { PORT, HOST } from "./config.js";
import { logger } from "./logger.js";
import { registerRoutes } from "./routes.js";
const server = fastify({ logger: logger });
server.register(import("@fastify/cors"), {
    origin: "*"
});
registerRoutes(server);
async function main() {
    try {
        await server.listen({ port: PORT, host: HOST });
        logger.info(`Gateway listening on http://${HOST}:${PORT}`);
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
}
main();
