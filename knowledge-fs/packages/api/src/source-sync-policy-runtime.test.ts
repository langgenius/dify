import { afterEach, describe, expect, it, vi } from "vitest";

import { createSourceSyncPolicyRuntime } from "./source-sync-policy-runtime";

describe("createSourceSyncPolicyRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("enqueues due policies with the configured scheduler values", async () => {
    const enqueueDueSyncRuns = vi.fn().mockResolvedValue([]);
    const runtime = createSourceSyncPolicyRuntime({
      maxDuePerTick: 7,
      maxExecutionAttempts: 3,
      now: () => "2026-07-28T00:00:00.000Z",
      repository: { enqueueDueSyncRuns },
    });

    await expect(runtime.tick()).resolves.toEqual([]);
    expect(enqueueDueSyncRuns).toHaveBeenCalledWith({
      limit: 7,
      maxExecutionAttempts: 3,
      now: "2026-07-28T00:00:00.000Z",
    });
  });

  it("uses safe defaults when scheduler options are omitted", async () => {
    const enqueueDueSyncRuns = vi.fn().mockResolvedValue([]);
    const runtime = createSourceSyncPolicyRuntime({
      repository: { enqueueDueSyncRuns },
    });

    await runtime.tick();

    expect(enqueueDueSyncRuns).toHaveBeenCalledWith({
      limit: 25,
      maxExecutionAttempts: 5,
      now: expect.any(String),
    });
  });

  it.each([
    [{ intervalMs: 99 }, "Source sync scheduler interval must be at least 100ms"],
    [{ intervalMs: 100.5 }, "Source sync scheduler interval must be at least 100ms"],
    [{ maxDuePerTick: 0 }, "Source sync scheduler batch size must be 1-1000"],
    [{ maxDuePerTick: 1_001 }, "Source sync scheduler batch size must be 1-1000"],
    [{ maxDuePerTick: 1.5 }, "Source sync scheduler batch size must be 1-1000"],
  ])("rejects invalid scheduler options", (options, message) => {
    expect(() =>
      createSourceSyncPolicyRuntime({
        ...options,
        repository: { enqueueDueSyncRuns: vi.fn() },
      }),
    ).toThrow(message);
  });

  it("starts once, serializes timer ticks, and can be stopped repeatedly", async () => {
    vi.useFakeTimers();
    const enqueueDueSyncRuns = vi.fn().mockResolvedValue([]);
    const runtime = createSourceSyncPolicyRuntime({
      intervalMs: 100,
      now: () => "2026-07-28T00:00:00.000Z",
      repository: { enqueueDueSyncRuns },
    });

    const stop = runtime.start();
    const duplicateStop = runtime.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(enqueueDueSyncRuns).toHaveBeenCalledTimes(1);

    await duplicateStop();
    await vi.advanceTimersByTimeAsync(100);
    expect(enqueueDueSyncRuns).toHaveBeenCalledTimes(1);
    await stop();
    await runtime.stop();
  });

  it("keeps later timer ticks alive after an enqueue failure", async () => {
    vi.useFakeTimers();
    const enqueueDueSyncRuns = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue([]);
    const runtime = createSourceSyncPolicyRuntime({
      intervalMs: 100,
      repository: { enqueueDueSyncRuns },
    });

    const stop = runtime.start();
    await vi.advanceTimersByTimeAsync(200);
    await stop();

    expect(enqueueDueSyncRuns).toHaveBeenCalledTimes(2);
  });

  it("supports interval handles without an unref method", async () => {
    const intervalHandle = 1 as unknown as ReturnType<typeof setInterval>;
    vi.spyOn(globalThis, "setInterval").mockReturnValue(intervalHandle);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    const runtime = createSourceSyncPolicyRuntime({
      repository: { enqueueDueSyncRuns: vi.fn() },
    });

    const stop = runtime.start();
    await stop();

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
  });
});
