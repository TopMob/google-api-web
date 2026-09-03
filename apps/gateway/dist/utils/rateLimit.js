const memoryRateLimits = new Map();
export function checkInMemoryRateLimit(key, limitRpm) {
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
export async function checkRateLimit(key, limitRpm) {
  if (!limitRpm || limitRpm <= 0) return true;
  return checkInMemoryRateLimit(key, limitRpm);
}
