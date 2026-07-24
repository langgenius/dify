import { describe, expect, it } from "vitest";
import { getRetryDelayMs, shouldRetry } from "./retry";
import { NetworkError, RateLimitError, TimeoutError } from "../errors/dify-error";

const withMockedRandom = (value, fn) => {
  const original = Math.random;
  Math.random = () => value;
  try {
    fn();
  } finally {
    Math.random = original;
  }
};

describe("retry helpers", () => {
  it("getRetryDelayMs honors retry-after header", () => {
    expect(getRetryDelayMs(1, 1, 3)).toBe(3000);
  });

  it("getRetryDelayMs uses exponential backoff with jitter", () => {
    withMockedRandom(0, () => {
      expect(getRetryDelayMs(1, 1)).toBe(1000);
      expect(getRetryDelayMs(2, 1)).toBe(2000);
      expect(getRetryDelayMs(3, 1)).toBe(4000);
    });
  });

  it("shouldRetry respects max retries", () => {
    expect(shouldRetry(new TimeoutError("timeout"), 3, 3)).toBe(false);
  });

  it("shouldRetry retries on network, timeout, and rate limit", () => {
    expect(shouldRetry(new TimeoutError("timeout"), 0, 3)).toBe(true);
    expect(shouldRetry(new NetworkError("network"), 0, 3)).toBe(true);
    expect(shouldRetry(new RateLimitError("limit"), 0, 3)).toBe(true);
    expect(shouldRetry(new Error("other"), 0, 3)).toBe(false);
  });
});
