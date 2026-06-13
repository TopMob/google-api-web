import { createClient } from "@supabase/supabase-js";
import { Redis } from "ioredis";
import { logger } from "./logger.js";
import { SUPABASE_URL, SUPABASE_KEY, REDIS_URL } from "./config.js";
export const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
export const redis = REDIS_URL ? new Redis(REDIS_URL) : null;
if (redis) {
  logger.info("Redis client connected");
}
export async function closeDatabaseConnections() {
  if (redis) {
    try {
      await redis.quit();
      logger.info("Redis client disconnected gracefully");
    } catch (e) {
      logger.error({ err: e }, "Failed to disconnect Redis client");
    }
  }
}
