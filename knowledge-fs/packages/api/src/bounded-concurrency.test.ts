import { describe, expect, it } from "vitest";

import { createConcurrencyGate, mapWithConcurrency } from "./bounded-concurrency";

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
});
