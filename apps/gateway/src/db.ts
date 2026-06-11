import { createClient } from "@supabase/supabase-js";
import { Redis } from "ioredis";
import { logger } from "./logger.js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const redisUrl = process.env.REDIS_URL || "";
export const redis = redisUrl ? new Redis(redisUrl) : null;

if (redis) {
  logger.info("Redis client connected");
}
