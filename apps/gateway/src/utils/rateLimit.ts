import { redis } from "../db.js";
import { logger } from "../logger.js";

const memoryRateLimits = new Map<string, { window: number; count: number }>();

export function checkInMemoryRateLimit(key: string, limitRpm: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = Math.floor(now / 60);

  const current = memoryRateLimits.get(key);
  if (!current || current.window !== minuteWindow) {
    memoryRateLimits.set(key, { window: minuteWindow, count: 1 });
    if (memoryRateLimits.size > 10000) {
      for (const [k, v] of memoryRateLimits.entries()) {
        if (v.window !== minuteWindow) memoryRateLimits.delete(k);
      }
    }
    return true;
  }

  current.count += 1;
  return current.count <= limitRpm;
}

export async function checkRateLimit(key: string, limitRpm: number): Promise<boolean> {
  if (!limitRpm || limitRpm <= 0) return true;
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = Math.floor(now / 60);
  const redisKey = `rate:${key}:${minuteWindow}`;

  if (redis) {
    try {
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, 60);
      }
      return count <= limitRpm;
    } catch (e) {
      logger.error({ err: e }, "Redis rate limiter error, falling back to memory rate limiter");
      return checkInMemoryRateLimit(key, limitRpm);
    }
  } else {
    return checkInMemoryRateLimit(key, limitRpm);
  }
}
