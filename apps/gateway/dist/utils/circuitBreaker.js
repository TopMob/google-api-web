import { logger } from "../logger.js";
export class CircuitBreaker {
  state = "CLOSED";
  failures = 0;
  lastFailureTime = 0;
  successThreshold = 2;
  failureThreshold = 5;
  cooldownMs = 30000;
  consecutiveSuccesses = 0;
  async execute(action) {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = "HALF-OPEN";
        this.consecutiveSuccesses = 0;
        logger.info("Circuit breaker entered HALF-OPEN state");
      } else {
        throw new Error("Circuit breaker is OPEN. Upstream service is temporarily unavailable.");
      }
    }
    try {
      const result = await action();
      if (this.state === "CLOSED") {
        if (this.failures > 0) {
          this.failures = 0;
        }
      } else if (this.state === "HALF-OPEN") {
        this.consecutiveSuccesses++;
        if (this.consecutiveSuccesses >= this.successThreshold) {
          this.state = "CLOSED";
          this.failures = 0;
          logger.info("Circuit breaker entered CLOSED state");
        }
      }
      return result;
    } catch (err) {
      const msg = err.message || "";
      const isClientError =
        msg.includes("returned 400") ||
        msg.includes("returned 401") ||
        msg.includes("returned 403") ||
        msg.includes("returned 404");
      if (!isClientError) {
        const now = Date.now();
        // If last failure was more than 2 minutes ago, reset failure counter
        if (now - this.lastFailureTime > 120000) {
          this.failures = 1;
        } else {
          this.failures++;
        }
        this.lastFailureTime = now;
        logger.warn(
          { failures: this.failures, state: this.state },
          "Upstream call failed, incrementing circuit breaker failure count"
        );
        if (this.state === "CLOSED" && this.failures >= this.failureThreshold) {
          this.state = "OPEN";
          logger.error("Circuit breaker tripped to OPEN state");
        } else if (this.state === "HALF-OPEN") {
          this.state = "OPEN";
          logger.error("Circuit breaker tripped back to OPEN state from HALF-OPEN");
        }
      }
      throw err;
    }
  }
}
export const geminiCircuitBreaker = new CircuitBreaker();
