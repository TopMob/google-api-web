import { logger } from "../logger.js";

export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF-OPEN" = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;
  private successThreshold = 2;
  private failureThreshold = 5;
  private cooldownMs = 30000;
  private consecutiveSuccesses = 0;

  public getStatus(): { state: "CLOSED" | "OPEN" | "HALF-OPEN"; failures: number } {
    return { state: this.state, failures: this.failures };
  }

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
      this.recordSuccess();
      return result;
    } catch (err: any) {
      this.recordFailure(err);
      throw err;
    }
  }

  public recordSuccess(): void {
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
  }

  public recordFailure(err: any): void {
    const msg = err?.message || "";
    const errName = err?.name || "";
    const isNonInfrastructureError =
      errName === "ClientAbortedError" ||
      errName === "UpstreamRateLimitError" ||
      errName === "UpstreamRejectedError" ||
      errName === "ImageValidationError" ||
      /Upstream returned 4\d\d\b/.test(msg) ||
      msg.includes("Too Many Requests") ||
      msg.includes("BardErrorInfo") ||
      msg.includes("Aborted");

    if (!isNonInfrastructureError) {
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
  }
}

export const geminiCircuitBreaker = new CircuitBreaker();
