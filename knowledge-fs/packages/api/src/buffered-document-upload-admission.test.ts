import { describe, expect, it } from "vitest";

import {
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY,
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES,
  createBufferedDocumentUploadAdmission,
} from "./buffered-document-upload-admission";

describe("buffered document upload admission", () => {
  it("defaults to two requests and a conservative multipart retention budget", () => {
    expect(DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY).toBe(2);
    expect(DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES).toBe(192 * 1024 * 1024);
  });

  it("shares count and byte budgets across single and bulk multipart work", async () => {
    const admission = createBufferedDocumentUploadAdmission({
      maxConcurrency: 2,
      maxReservedBytes: 50,
    });
    const first = deferred<void>();
    const second = deferred<void>();
    const started: string[] = [];

    const firstRun = admission.run(
      async () => {
        started.push("bulk");
        await first.promise;
      },
      { reservedBytes: 40 },
    );
    const secondRun = admission.run(
      async () => {
        started.push("single");
        await second.promise;
      },
      { reservedBytes: 10 },
    );
    const queuedRun = admission.run(
      async () => {
        started.push("queued");
      },
      { reservedBytes: 1 },
    );

    await waitFor(() => started.length === 2);
    expect(started).toEqual(["bulk", "single"]);
    first.resolve();
    await firstRun;
    await waitFor(() => started.includes("queued"));
    second.resolve();
    await Promise.all([secondRun, queuedRun]);
    expect(started).toEqual(["bulk", "single", "queued"]);
  });

  it("cancels a queued request before its multipart parser can start", async () => {
    const admission = createBufferedDocumentUploadAdmission({
      maxConcurrency: 1,
      maxReservedBytes: 50,
    });
    const active = deferred<void>();
    const activeRun = admission.run(() => active.promise, { reservedBytes: 50 });
    const controller = new AbortController();
    let parserStarted = false;
    const cancelledRun = admission.run(
      async () => {
        parserStarted = true;
      },
      { reservedBytes: 1, signal: controller.signal },
    );

    controller.abort(new Error("client disconnected while queued"));
    await expect(cancelledRun).rejects.toThrow("client disconnected while queued");
    expect(parserStarted).toBe(false);
    active.resolve();
    await activeRun;
  });

  it("releases both budgets after route processing fails", async () => {
    const admission = createBufferedDocumentUploadAdmission({
      maxConcurrency: 1,
      maxReservedBytes: 50,
    });
    await expect(
      admission.run(
        async () => {
          throw new Error("object storage failed");
        },
        { reservedBytes: 50 },
      ),
    ).rejects.toThrow("object storage failed");
    await expect(admission.run(async () => "next", { reservedBytes: 50 })).resolves.toBe("next");
  });

  it("rejects unsafe limits and reservations without starting work", async () => {
    expect(() =>
      createBufferedDocumentUploadAdmission({ maxConcurrency: 0, maxReservedBytes: 50 }),
    ).toThrow("maxConcurrency must be a safe integer between 1 and 8");
    expect(() =>
      createBufferedDocumentUploadAdmission({ maxConcurrency: 1, maxReservedBytes: 0 }),
    ).toThrow("maxReservedBytes must be a positive safe integer");

    const admission = createBufferedDocumentUploadAdmission({
      maxConcurrency: 1,
      maxReservedBytes: 50,
    });
    let started = false;
    await expect(
      admission.run(
        async () => {
          started = true;
        },
        { reservedBytes: 51 },
      ),
    ).rejects.toThrow("reservedBytes=51 exceeds maxReservedBytes=50");
    expect(started).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for admission state");
}
