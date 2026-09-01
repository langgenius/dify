import { describe, expect, it, vi } from "vitest";

import {
  type ConcurrencyGateEvent,
  createConcurrencyGate,
  mapWithConcurrency,
  runWithAbortSignal,
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

  it("isolates rejected asynchronous concurrency telemetry", async () => {
    const gate = createConcurrencyGate(1, {
      onEvent: vi.fn(async () => {
        throw new Error("collector unavailable");
      }),
    });

    await expect(gate.run(async () => "ok")).resolves.toBe("ok");
  });

  it("rejects invalid concurrency limits", () => {
    expect(() => createConcurrencyGate(0)).toThrow("Concurrency gate limit must be at least 1");
    expect(() => createConcurrencyGate(1.5)).toThrow("Concurrency gate limit must be at least 1");
  });

  it("does not acquire a slot for an already aborted caller", async () => {
    const gate = createConcurrencyGate(1);
    const controller = new AbortController();
    controller.abort(new Error("compilation cancelled before admission"));
    let workStarted = false;

    await expect(
      gate.run(
        async () => {
          workStarted = true;
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow("compilation cancelled before admission");
    expect(workStarted).toBe(false);
    await expect(gate.run(async () => "still available")).resolves.toBe("still available");
  });

  it("removes abort listeners when a signaled waiter is admitted normally", async () => {
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const gate = createConcurrencyGate(1);
    const controller = new AbortController();

    const first = gate.run(async () => {
      firstStarted?.();
      await blocked;
    });
    await started;
    const second = gate.run(async () => "admitted", { signal: controller.signal });
    releaseFirst?.();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe("admitted");
  });

  it("removes aborted waiters without starting their work", async () => {
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const gate = createConcurrencyGate(1);
    const controller = new AbortController();
    let abortedWorkStarted = false;

    const first = gate.run(async () => {
      firstStarted?.();
      await blocked;
    });
    await started;
    const aborted = gate.run(
      async () => {
        abortedWorkStarted = true;
      },
      { signal: controller.signal },
    );
    controller.abort(new Error("compilation cancelled"));

    await expect(aborted).rejects.toThrow("compilation cancelled");
    expect(abortedWorkStarted).toBe(false);
    releaseFirst?.();
    await expect(first).resolves.toBeUndefined();
    await expect(gate.run(async () => "after cancellation")).resolves.toBe("after cancellation");
  });

  it("releases a slot after work fails", async () => {
    const gate = createConcurrencyGate(1);

    await expect(
      gate.run(async () => {
        throw new Error("materialization failed");
      }),
    ).rejects.toThrow("materialization failed");

    await expect(gate.run(async () => "next document")).resolves.toBe("next document");
  });

  it("stops awaiting an in-flight adapter that does not implement cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("owner cancelled");
    let started = false;
    const operation = runWithAbortSignal(async () => {
      started = true;
      return new Promise<never>(() => undefined);
    }, controller.signal);
    await vi.waitFor(() => expect(started).toBe(true));

    controller.abort(cancellation);

    await expect(operation).rejects.toBe(cancellation);
  });

  it("stops a concurrent map when active work ignores cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("retrieval deadline reached");
    let started = false;
    const pending = mapWithConcurrency(
      [1],
      1,
      async () => {
        started = true;
        return new Promise<never>(() => undefined);
      },
      controller.signal,
    );
    await vi.waitFor(() => expect(started).toBe(true));

    controller.abort(cancellation);

    await expect(pending).rejects.toBe(cancellation);
  });

  it("stops awaiting sibling work after the first mapper failure", async () => {
    const failure = new Error("range open failed");
    const owner = new AbortController();
    let siblingStarted = false;
    const pending = mapWithConcurrency(
      ["failed", "stalled"],
      2,
      async (item) => {
        if (item === "failed") {
          await vi.waitFor(() => expect(siblingStarted).toBe(true));
          throw failure;
        }
        siblingStarted = true;
        return new Promise<never>(() => undefined);
      },
      owner.signal,
    );

    await expect(pending).rejects.toBe(failure);
  });
});
