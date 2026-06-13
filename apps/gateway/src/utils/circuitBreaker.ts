import { logger } from "../logger.js";

export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF-OPEN" = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;
  private successThreshold = 2;
  private failureThreshold = 5;
  private cooldownMs = 30000;
  private consecutiveSuccesses = 0;

  public async execute<T>(action: () => Promise<T>): Promise<T> {
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
      if (this.state === "HALF-OPEN") {
        this.consecutiveSuccesses++;
        if (this.consecutiveSuccesses >= this.successThreshold) {
          this.state = "CLOSED";
          this.failures = 0;
          logger.info("Circuit breaker entered CLOSED state");
        }
      }
      return result;
    } catch (err: any) {
      const msg = err.message || "";
      const isClientError =
        msg.includes("returned 400") ||
        msg.includes("returned 401") ||
        msg.includes("returned 403") ||
        msg.includes("returned 404");

      if (!isClientError) {
        this.failures++;
        this.lastFailureTime = Date.now();
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
