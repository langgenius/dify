import { describe, expect, it } from "vitest";

import { createSmallFileFallbackAdmission } from "./upload-session-fallback-admission";

describe("small-file fallback admission", () => {
  it("enforces both the concurrent-request and aggregate reserved-byte budgets", async () => {
    const admission = createSmallFileFallbackAdmission({
      maxConcurrency: 2,
      maxReservedBytes: 10,
    });
    const first = deferred<void>();
    const second = deferred<void>();
    const byteBlocked = deferred<void>();
    const started: string[] = [];

    const firstRun = admission.run(
      async () => {
        started.push("first");
        await first.promise;
      },
      { reservedBytes: 6 },
    );
    const secondRun = admission.run(
      async () => {
        started.push("second");
        await second.promise;
      },
      { reservedBytes: 4 },
    );
    const byteBlockedRun = admission.run(
      async () => {
        started.push("byte-blocked");
        await byteBlocked.promise;
      },
      { reservedBytes: 1 },
    );
    const countBlockedRun = admission.run(
      async () => {
        started.push("count-blocked");
      },
      { reservedBytes: 1 },
    );

    await waitFor(() => started.length === 2);
    expect(started).toEqual(["first", "second"]);

    first.resolve();
    await firstRun;
    await waitFor(() => started.includes("byte-blocked"));
    expect(started).toEqual(["first", "second", "byte-blocked"]);

    second.resolve();
    await secondRun;
    byteBlocked.resolve();
    await Promise.all([byteBlockedRun, countBlockedRun]);
    expect(started).toEqual(["first", "second", "byte-blocked", "count-blocked"]);
  });

  it("removes a cancelled waiter before its upload body allocation starts", async () => {
    const admission = createSmallFileFallbackAdmission({
      maxConcurrency: 1,
      maxReservedBytes: 10,
    });
    const active = deferred<void>();
    let cancelledWorkStarted = false;
    const firstRun = admission.run(() => active.promise, { reservedBytes: 10 });
    const controller = new AbortController();
    const cancelledRun = admission.run(
      async () => {
        cancelledWorkStarted = true;
      },
      { reservedBytes: 1, signal: controller.signal },
    );

    controller.abort(new Error("client disconnected while queued"));

    await expect(cancelledRun).rejects.toThrow("client disconnected while queued");
    expect(cancelledWorkStarted).toBe(false);
    active.resolve();
    await firstRun;
    await expect(admission.run(async () => "available", { reservedBytes: 10 })).resolves.toBe(
      "available",
    );
  });

  it("rejects an already-cancelled request without acquiring either budget", async () => {
    const admission = createSmallFileFallbackAdmission({
      maxConcurrency: 1,
      maxReservedBytes: 10,
    });
    const controller = new AbortController();
    controller.abort(new Error("client disconnected before admission"));
    let workStarted = false;

    await expect(
      admission.run(
        async () => {
          workStarted = true;
        },
        { reservedBytes: 10, signal: controller.signal },
      ),
    ).rejects.toThrow("client disconnected before admission");
    expect(workStarted).toBe(false);
    await expect(admission.run(async () => "available", { reservedBytes: 10 })).resolves.toBe(
      "available",
    );
  });

  it("releases both budgets when admitted upload work fails", async () => {
    const admission = createSmallFileFallbackAdmission({
      maxConcurrency: 1,
      maxReservedBytes: 10,
    });

    await expect(
      admission.run(
        async () => {
          throw new Error("object storage failed");
        },
        { reservedBytes: 10 },
      ),
    ).rejects.toThrow("object storage failed");
    await expect(admission.run(async () => "next upload", { reservedBytes: 10 })).resolves.toBe(
      "next upload",
    );
  });

  it("rejects unsafe limits and reservations before queueing", async () => {
    expect(() =>
      createSmallFileFallbackAdmission({ maxConcurrency: 0, maxReservedBytes: 10 }),
    ).toThrow("maxConcurrency must be a safe integer between 1 and 8");
    expect(() =>
      createSmallFileFallbackAdmission({ maxConcurrency: 1, maxReservedBytes: 0 }),
    ).toThrow("maxReservedBytes must be a positive safe integer");
    expect(() =>
      createSmallFileFallbackAdmission({
        maxConcurrency: 1,
        maxReservedBytes: 100 * 1024 * 1024 + 1,
      }),
    ).toThrow("maxReservedBytes must not exceed 104857600");

    const admission = createSmallFileFallbackAdmission({
      maxConcurrency: 1,
      maxReservedBytes: 10,
    });
    await expect(admission.run(async () => undefined, { reservedBytes: 0 })).rejects.toThrow(
      "reservedBytes must be a positive safe integer",
    );
    await expect(admission.run(async () => undefined, { reservedBytes: 11 })).rejects.toThrow(
      "reservedBytes=11 exceeds maxReservedBytes=10",
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for admission state");
}
