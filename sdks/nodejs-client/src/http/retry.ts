import { RateLimitError, NetworkError, TimeoutError } from "../errors/dify-error";

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const getRetryDelayMs = (
  attempt: number,
  retryDelaySeconds: number,
  retryAfterSeconds?: number
): number => {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  const base = retryDelaySeconds * 1000;
  const exponential = base * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.random() * base;
  return exponential + jitter;
};

export const shouldRetry = (
  error: unknown,
  attempt: number,
  maxRetries: number
): boolean => {
  if (attempt >= maxRetries) {
    return false;
  }
  if (error instanceof TimeoutError) {
    return true;
  }
  if (error instanceof NetworkError) {
    return true;
  }
  if (error instanceof RateLimitError) {
    return true;
  }
  return false;
};
