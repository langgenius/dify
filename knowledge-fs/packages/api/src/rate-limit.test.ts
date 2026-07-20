import { describe, expect, it } from "vitest";

import {
  InMemoryRateLimitCapacityExceededError,
  createInMemoryRateLimiter,
  createNoopRateLimiter,
} from "./rate-limit";

describe("rate limiters", () => {
  it("allows all checks for the noop limiter", async () => {
    const decision = await createNoopRateLimiter().check({
      subjectId: "subject-1",
      tenantId: "tenant-1",
      tool: "queries.stream",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("bounds per tenant/subject/tool windows and prunes expired keys", async () => {
    let now = 1_000;
    const limiter = createInMemoryRateLimiter({
      defaultLimit: 1,
      maxKeys: 1,
      now: () => now,
      windowMs: 1_000,
    });

    const first = await limiter.check({ subjectId: "s", tenantId: "t", tool: "tool" });
    const second = await limiter.check({ subjectId: "s", tenantId: "t", tool: "tool" });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);

    now = 2_000;
    const third = await limiter.check({ subjectId: "s2", tenantId: "t", tool: "tool" });

    expect(third.allowed).toBe(true);
  });

  it("rejects unbounded key growth", async () => {
    const limiter = createInMemoryRateLimiter({
      defaultLimit: 1,
      maxKeys: 1,
      windowMs: 1_000,
    });

    await limiter.check({ subjectId: "s1", tenantId: "t", tool: "tool" });

    await expect(limiter.check({ subjectId: "s2", tenantId: "t", tool: "tool" })).rejects.toThrow(
      InMemoryRateLimitCapacityExceededError,
    );
  });
});
