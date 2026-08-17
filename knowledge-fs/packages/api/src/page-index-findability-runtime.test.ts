import { describe, expect, it, vi } from "vitest";

import {
  PageIndexFindabilityJobType,
  createPageIndexFindabilityRuntime,
} from "./page-index-findability-runtime";

const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const fingerprint = `projection-set-sha256:${"a".repeat(64)}`;

describe("PageIndex findability async runtime", () => {
  it("admits a low-priority idempotent receipt without evaluating inline", async () => {
    const enqueue = vi.fn(async () => ({ id: "job-1" }));
    const evaluatePublished = vi.fn();
    const { admission } = createPageIndexFindabilityRuntime({
      attempts: { get: vi.fn() },
      evaluator: { evaluatePublished },
      intervalMs: 1_000,
      jobs: {
        complete: vi.fn(),
        enqueue: enqueue as never,
        fail: vi.fn(),
        heartbeat: vi.fn(),
        lease: vi.fn(async () => []),
      },
      leaseMs: 9_000,
      maxAttempts: 3,
      maxBatchSize: 5,
      retryBaseMs: 1_000,
      retryMaxMs: 10_000,
      workerId: "findability-worker",
    });

    await admission.enqueue({
      compilationAttemptId: attemptId,
      publicationFingerprint: fingerprint,
    });

    expect(enqueue).toHaveBeenCalledWith({
      idempotencyKey: `page-index-findability:${attemptId}:${fingerprint}`,
      payload: { compilationAttemptId: attemptId, publicationFingerprint: fingerprint },
      priority: "low",
      type: PageIndexFindabilityJobType,
    });
    expect(evaluatePublished).not.toHaveBeenCalled();
  });

  it("opens the breaker after a dependency failure and resumes after the reset window", async () => {
    let timestamp = 1_000;
    const lease = vi
      .fn()
      .mockResolvedValueOnce([
        {
          attempts: 1,
          id: "job-1",
          payload: { compilationAttemptId: attemptId, publicationFingerprint: fingerprint },
        },
      ])
      .mockResolvedValue([]);
    const fail = vi.fn(async () => undefined);
    const { runtime } = createPageIndexFindabilityRuntime({
      attempts: { get: vi.fn(async () => ({ id: attemptId })) as never },
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 5_000,
      evaluator: { evaluatePublished: vi.fn().mockRejectedValue(new Error("provider down")) },
      intervalMs: 1_000,
      jobs: {
        complete: vi.fn(),
        enqueue: vi.fn(),
        fail: fail as never,
        heartbeat: vi.fn(async () => ({})) as never,
        lease: lease as never,
      },
      leaseMs: 9_000,
      maxAttempts: 3,
      maxBatchSize: 5,
      now: () => timestamp,
      retryBaseMs: 1_000,
      retryMaxMs: 10_000,
      workerId: "findability-worker",
    });

    await expect(runtime.tick()).resolves.toEqual({
      claimed: 1,
      failed: 0,
      retried: 1,
      succeeded: 0,
    });
    await expect(runtime.tick()).resolves.toEqual({
      claimed: 0,
      failed: 0,
      retried: 0,
      succeeded: 0,
    });
    expect(lease).toHaveBeenCalledTimes(1);
    timestamp = 6_000;
    await runtime.tick();
    expect(lease).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenCalledWith("job-1", "provider down", { retryAt: 2_000 });
  });
});
