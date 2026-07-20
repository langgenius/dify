import type { AuthSubject } from "@knowledge/core";
import type { MiddlewareHandler } from "hono";

import { getRateLimitTool } from "./route-classification";

export interface RateLimitCheckInput {
  readonly subjectId: string;
  readonly tenantId: string;
  readonly tool: string;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: string;
  readonly retryAfterSeconds: number;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly tool: string;
  readonly windowMs: number;
}

export interface RateLimiter {
  check(input: RateLimitCheckInput): Promise<RateLimitDecision>;
}

export interface InMemoryRateLimiterOptions {
  readonly defaultLimit: number;
  readonly maxKeys: number;
  readonly now?: (() => number) | undefined;
  readonly toolLimits?: Readonly<Record<string, number>> | undefined;
  readonly windowMs: number;
}

export class InMemoryRateLimitCapacityExceededError extends Error {
  constructor(maxKeys: number) {
    super(`Rate limiter key capacity exceeded: maxKeys=${maxKeys}`);
    this.name = "InMemoryRateLimitCapacityExceededError";
  }
}

export function createNoopRateLimiter(): RateLimiter {
  return {
    check: async (input) => ({
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER,
      remaining: Number.MAX_SAFE_INTEGER,
      resetAt: new Date(8_640_000_000_000_000).toISOString(),
      retryAfterSeconds: 0,
      subjectId: input.subjectId,
      tenantId: input.tenantId,
      tool: input.tool,
      windowMs: Number.MAX_SAFE_INTEGER,
    }),
  };
}

export function createInMemoryRateLimiter({
  defaultLimit,
  maxKeys,
  now = Date.now,
  toolLimits = {},
  windowMs,
}: InMemoryRateLimiterOptions): RateLimiter {
  if (defaultLimit < 1) {
    throw new Error("Rate limiter defaultLimit must be at least 1");
  }

  if (maxKeys < 1) {
    throw new Error("Rate limiter maxKeys must be at least 1");
  }

  if (windowMs < 1) {
    throw new Error("Rate limiter windowMs must be at least 1");
  }

  for (const [tool, limit] of Object.entries(toolLimits)) {
    if (!tool.trim()) {
      throw new Error("Rate limiter tool limit key is required");
    }

    if (limit < 1) {
      throw new Error(`Rate limiter limit for ${tool} must be at least 1`);
    }
  }

  const windows = new Map<string, { count: number; resetAtMs: number }>();

  return {
    check: async (input) => {
      const currentTimeMs = now();
      const tool = input.tool.trim();

      if (!tool) {
        throw new Error("Rate limiter tool is required");
      }

      pruneExpiredRateLimitWindows(windows, currentTimeMs);

      const key = `${input.tenantId}\u0000${input.subjectId}\u0000${tool}`;
      let window = windows.get(key);

      if (!window) {
        if (windows.size >= maxKeys) {
          throw new InMemoryRateLimitCapacityExceededError(maxKeys);
        }

        window = {
          count: 0,
          resetAtMs: currentTimeMs + windowMs,
        };
        windows.set(key, window);
      }

      const limit = toolLimits[tool] ?? defaultLimit;

      if (window.count >= limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetAt: new Date(window.resetAtMs).toISOString(),
          retryAfterSeconds: Math.max(1, Math.ceil((window.resetAtMs - currentTimeMs) / 1_000)),
          subjectId: input.subjectId,
          tenantId: input.tenantId,
          tool,
          windowMs,
        };
      }

      window.count += 1;

      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - window.count),
        resetAt: new Date(window.resetAtMs).toISOString(),
        retryAfterSeconds: 0,
        subjectId: input.subjectId,
        tenantId: input.tenantId,
        tool,
        windowMs,
      };
    },
  };
}

export function createRateLimitMiddleware<
  E extends { Variables: { rateLimitChecked: boolean; subject: AuthSubject } },
>(rateLimiter: RateLimiter): MiddlewareHandler<E> {
  return async (context, next) => {
    if (context.get("rateLimitChecked")) {
      await next();
      return;
    }

    context.set("rateLimitChecked", true);

    const subject = context.get("subject");
    const decision = await rateLimiter.check({
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      tool: getRateLimitTool(context.req.method, context.req.path),
    });

    if (!decision.allowed) {
      context.header("retry-after", String(decision.retryAfterSeconds));
      return context.json(
        {
          error: "Rate limit exceeded",
          limit: decision.limit,
          remaining: decision.remaining,
          resetAt: decision.resetAt,
          retryAfterSeconds: decision.retryAfterSeconds,
          tool: decision.tool,
          windowMs: decision.windowMs,
        },
        429,
      );
    }

    await next();
  };
}

function pruneExpiredRateLimitWindows(
  windows: Map<string, { count: number; resetAtMs: number }>,
  nowMs: number,
) {
  for (const [key, window] of windows) {
    if (window.resetAtMs <= nowMs) {
      windows.delete(key);
    }
  }
}
