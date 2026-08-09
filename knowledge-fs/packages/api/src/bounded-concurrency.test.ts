import { describe, expect, it, vi } from "vitest";

import {
  type ConcurrencyGateEvent,
  createConcurrencyGate,
  mapWithConcurrency,
} from "./bounded-concurrency";

describe("bounded concurrency", () => {
  it("shares a concurrency gate across independent callers", async () => {
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let startedFour: (() => void) | undefined;
    const fourStarted = new Promise<void>((resolve) => {
      startedFour = resolve;
    });
    const gate = createConcurrencyGate(4);

    const calls = Array.from({ length: 8 }, () =>
      gate.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (active === 4) {
          startedFour?.();
        }
        await blocked;
        active -= 1;
      }),
    );

    await fourStarted;
    release?.();
    await Promise.all(calls);

    expect(maxActive).toBe(4);
  });

  it("stops scheduling and waits for active work after the first failure", async () => {
    const started: number[] = [];
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let rejected = false;

    const observed = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value) => {
      started.push(value);
      if (value === 0) {
        throw new Error("boom");
      }
      await blocked;
      return value;
    }).then(
      () => undefined,
      (error: unknown) => {
        rejected = true;
        return error;
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(rejected).toBe(false);
    expect(started).toEqual([0, 1]);

    release?.();
    await expect(observed).resolves.toMatchObject({ message: "boom" });
    expect(started).toEqual([0, 1]);
  });

  it("reports bounded active load and FIFO queue wait without affecting callers", async () => {
    let clock = 100;
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const events: ConcurrencyGateEvent[] = [];
    const gate = createConcurrencyGate(1, {
      now: () => clock,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const first = gate.run(async () => {
      firstStarted?.();
      await blocked;
    });
    await started;
    const second = gate.run(async () => undefined);
    await Promise.resolve();
    clock = 125;
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(events.filter((event) => event.lifecycle === "acquired")).toEqual([
      expect.objectContaining({ activeRequests: 1, queueWaitMs: 0 }),
      expect.objectContaining({ activeRequests: 1, queueWaitMs: 25 }),
    ]);
    expect(events.every((event) => event.activeRequests <= event.limit)).toBe(true);
  });

  it("isolates concurrency telemetry failures", async () => {
    const gate = createConcurrencyGate(1, {
      onEvent: vi.fn(() => {
        throw new Error("collector unavailable");
      }),
    });
    await expect(gate.run(async () => "ok")).resolves.toBe("ok");
  });
});
