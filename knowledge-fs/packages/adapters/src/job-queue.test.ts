import { describe, expect, it } from "vitest";

import { createInlineJobQueueAdapter } from "./job-queue";

describe("inline job queue adapter", () => {
  it("enqueues, dequeues, and completes jobs in FIFO order", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 2,
      maxQueuedJobs: 10,
      now: () => 1_000,
    });

    const first = await queue.enqueue({
      payload: { documentId: "doc-1" },
      type: "ingest.document",
    });
    const second = await queue.enqueue({
      payload: { documentId: "doc-2" },
      type: "ingest.document",
    });
    const dequeued = await queue.dequeue({ limit: 2, workerId: "worker-1" });

    expect(dequeued.map((job) => job.id)).toEqual([first.id, second.id]);
    expect(dequeued.map((job) => job.status)).toEqual(["running", "running"]);

    await queue.complete(first.id);

    await expect(queue.stats()).resolves.toMatchObject({
      completed: 1,
      failed: 0,
      queued: 0,
      running: 1,
    });
  });

  it("leases jobs with expiration and exposes status snapshots", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 2,
      maxQueuedJobs: 10,
      now: () => 1_000,
    });
    const job = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "ingest.document" });

    const [leased] = await queue.lease({
      leaseMs: 5_000,
      limit: 1,
      now: 2_000,
      workerId: "worker-1",
    });

    expect(leased).toMatchObject({
      attempts: 1,
      id: job.id,
      leaseExpiresAt: 7_000,
      status: "running",
      workerId: "worker-1",
    });

    const status = await queue.status(job.id);
    expect(status).toMatchObject({
      id: job.id,
      leaseExpiresAt: 7_000,
      status: "running",
    });

    if (status && typeof status.payload === "object" && status.payload !== null) {
      (status.payload as { documentId: string }).documentId = "mutated";
    }

    await expect(queue.status(job.id)).resolves.toMatchObject({
      payload: { documentId: "doc-1" },
    });
  });

  it("leases only requested job types without consuming unrelated work", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 3,
      maxQueuedJobs: 10,
      now: () => 1_000,
    });
    const research = await queue.enqueue({ payload: {}, type: "research.document" });
    const compilation = await queue.enqueue({ payload: {}, type: "compile.document" });
    const retention = await queue.enqueue({ payload: {}, type: "retention.cleanup" });

    await expect(
      queue.lease({
        leaseMs: 5_000,
        limit: 3,
        types: ["compile.document"],
        workerId: "compilation-worker",
      }),
    ).resolves.toMatchObject([
      {
        attempts: 1,
        id: compilation.id,
        status: "running",
        type: "compile.document",
      },
    ]);

    await expect(queue.status(research.id)).resolves.toMatchObject({
      attempts: 0,
      status: "queued",
    });
    await expect(queue.status(retention.id)).resolves.toMatchObject({
      attempts: 0,
      status: "queued",
    });
    await expect(
      queue.dequeue({ limit: 3, types: [], workerId: "empty-type-worker" }),
    ).resolves.toEqual([]);
  });

  it("rejects unbounded lease requests", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 2,
      maxLeaseMs: 10_000,
      maxQueuedJobs: 10,
    });

    await expect(queue.lease({ leaseMs: 0, limit: 1, workerId: "worker-1" })).rejects.toThrow(
      "Job leaseMs must be at least 1",
    );
    await expect(queue.lease({ leaseMs: 10_001, limit: 1, workerId: "worker-1" })).rejects.toThrow(
      "Job leaseMs exceeds maxLeaseMs=10000",
    );
    await expect(queue.lease({ leaseMs: 1_000, limit: 3, workerId: "worker-1" })).rejects.toThrow(
      "Job dequeue limit exceeds maxBatchSize=2",
    );
  });

  it("recovers expired leases without scanning terminal jobs", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      now: () => 1_000,
    });
    const job = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "ingest.document" });

    await queue.lease({ leaseMs: 1_000, limit: 1, now: 2_000, workerId: "worker-1" });
    await expect(
      queue.lease({ leaseMs: 1_000, limit: 1, now: 2_999, workerId: "worker-2" }),
    ).resolves.toEqual([]);

    const [recovered] = await queue.lease({
      leaseMs: 1_000,
      limit: 1,
      now: 3_000,
      workerId: "worker-2",
    });

    expect(recovered).toMatchObject({
      attempts: 2,
      id: job.id,
      leaseExpiresAt: 4_000,
      status: "running",
      workerId: "worker-2",
    });
  });

  it("heartbeats only the active worker lease", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 1,
      maxLeaseMs: 5_000,
      maxQueuedJobs: 10,
    });
    const job = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "ingest.document" });

    await queue.lease({ leaseMs: 1_000, limit: 1, now: 1_000, workerId: "worker-1" });

    await expect(
      queue.heartbeat({ jobId: job.id, leaseMs: 2_000, now: 1_500, workerId: "worker-2" }),
    ).rejects.toThrow(`Job ${job.id} is not leased by worker worker-2`);

    await expect(
      queue.heartbeat({ jobId: job.id, leaseMs: 5_001, now: 1_500, workerId: "worker-1" }),
    ).rejects.toThrow("Job leaseMs exceeds maxLeaseMs=5000");

    await expect(
      queue.heartbeat({ jobId: job.id, leaseMs: 2_000, now: 1_500, workerId: "worker-1" }),
    ).resolves.toMatchObject({
      heartbeatAt: 1_500,
      leaseExpiresAt: 3_500,
      status: "running",
    });
  });

  it("supports manual retry and cancellation with bounded terminal retention", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      maxRetainedJobs: 1,
      now: () => 1_000,
    });
    const first = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "ingest" });
    const second = await queue.enqueue({ payload: { documentId: "doc-2" }, type: "ingest" });

    await queue.lease({ leaseMs: 1_000, limit: 1, now: 1_000, workerId: "worker-1" });
    await queue.fail(first.id, "transient");
    await queue.retry(first.id, { runAfter: 2_000 });

    await expect(queue.status(first.id)).resolves.toMatchObject({
      error: "transient",
      runAfter: 2_000,
      status: "queued",
    });

    await queue.cancel(first.id, "superseded");
    await queue.lease({ leaseMs: 1_000, limit: 1, now: 1_000, workerId: "worker-1" });
    await queue.cancel(second.id, "superseded");

    await expect(queue.stats()).resolves.toEqual({
      canceled: 2,
      completed: 0,
      failed: 1,
      queued: 0,
      running: 0,
    });
    await expect(queue.status(first.id)).resolves.toBeNull();
    await expect(queue.status(second.id)).resolves.toMatchObject({
      canceledAt: 1_000,
      error: "superseded",
      status: "canceled",
    });
  });

  it("rejects unbounded or oversized dequeue requests", async () => {
    const queue = createInlineJobQueueAdapter({ maxBatchSize: 2, maxQueuedJobs: 10 });

    await expect(queue.dequeue({ limit: 0, workerId: "worker-1" })).rejects.toThrow(
      "Job dequeue limit must be at least 1",
    );
    await expect(queue.dequeue({ limit: 3, workerId: "worker-1" })).rejects.toThrow(
      "Job dequeue limit exceeds maxBatchSize=2",
    );
  });

  it("rejects enqueue when maxQueuedJobs would be exceeded", async () => {
    const queue = createInlineJobQueueAdapter({ maxBatchSize: 1, maxQueuedJobs: 1 });

    await queue.enqueue({ payload: { documentId: "doc-1" }, type: "ingest.document" });

    await expect(
      queue.enqueue({ payload: { documentId: "doc-2" }, type: "ingest.document" }),
    ).rejects.toThrow("Job queue maxQueuedJobs=1 exceeded");
  });

  it("deduplicates jobs by idempotency key", async () => {
    const queue = createInlineJobQueueAdapter({ maxBatchSize: 2, maxQueuedJobs: 10 });
    const input = {
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      type: "ingest.document",
    };

    const first = await queue.enqueue(input);
    const second = await queue.enqueue(input);

    expect(second).toEqual(first);
    await expect(queue.stats()).resolves.toMatchObject({ queued: 1 });
  });

  it("retains only a bounded number of terminal jobs without losing cumulative stats", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      maxRetainedJobs: 1,
      now: () => 1_000,
    });

    const first = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "ingest" });
    const second = await queue.enqueue({ payload: { documentId: "doc-2" }, type: "ingest" });

    await queue.dequeue({ limit: 1, workerId: "worker-1" });
    await queue.complete(first.id);
    await queue.dequeue({ limit: 1, workerId: "worker-1" });
    await queue.fail(second.id, "parser failed");

    await expect(queue.stats()).resolves.toEqual({
      canceled: 0,
      completed: 1,
      failed: 1,
      queued: 0,
      running: 0,
    });
    await expect(queue.complete(first.id)).rejects.toThrow(`Job ${first.id} not found`);
  });

  it("drops pruned idempotency keys so completed jobs do not block future work forever", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      maxRetainedJobs: 0,
      now: () => 1_000,
    });
    const input = {
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      type: "ingest.document",
    };

    const first = await queue.enqueue(input);
    await queue.dequeue({ limit: 1, workerId: "worker-1" });
    await queue.complete(first.id);
    const second = await queue.enqueue(input);

    expect(second.id).not.toBe(first.id);
    await expect(queue.stats()).resolves.toMatchObject({ completed: 1, queued: 1 });
  });

  it("does not dequeue jobs before runAfter", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 2,
      maxQueuedJobs: 10,
      now: () => 1_000,
    });

    await queue.enqueue({
      payload: { documentId: "doc-1" },
      runAfter: 2_000,
      type: "ingest.document",
    });

    await expect(queue.dequeue({ limit: 1, now: 1_999, workerId: "worker-1" })).resolves.toEqual(
      [],
    );
    await expect(
      queue.dequeue({ limit: 1, now: 2_000, workerId: "worker-1" }),
    ).resolves.toHaveLength(1);
  });

  it("requeues failed jobs for retry after the retry time", async () => {
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      now: () => 1_000,
    });
    const job = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "ingest.document" });

    await queue.dequeue({ limit: 1, workerId: "worker-1" });
    await queue.fail(job.id, "Parser unavailable", { retryAt: 2_000 });

    await expect(queue.dequeue({ limit: 1, now: 1_999, workerId: "worker-1" })).resolves.toEqual(
      [],
    );
    const retry = await queue.dequeue({ limit: 1, now: 2_000, workerId: "worker-1" });

    expect(retry).toMatchObject([
      {
        attempts: 2,
        error: "Parser unavailable",
        id: job.id,
        status: "running",
      },
    ]);
  });

  it("clones payloads so callers cannot mutate queued state", async () => {
    const queue = createInlineJobQueueAdapter({ maxBatchSize: 1, maxQueuedJobs: 10 });
    const payload = { document: { id: "doc-1", tags: ["original"] } };

    await queue.enqueue({ payload, type: "ingest.document" });
    payload.document.tags.push("mutated");

    const [job] = await queue.dequeue({ limit: 1, workerId: "worker-1" });

    expect(job?.payload).toEqual({ document: { id: "doc-1", tags: ["original"] } });

    if (job && typeof job.payload === "object" && job.payload !== null) {
      (job.payload as { document: { tags: string[] } }).document.tags.push("external");
    }

    if (!job) {
      throw new Error("Expected job to be dequeued");
    }

    await queue.fail(job.id, "retry", { retryAt: 1 });
    const [retry] = await queue.dequeue({ limit: 1, now: 1, workerId: "worker-2" });

    expect(retry?.payload).toEqual({ document: { id: "doc-1", tags: ["original"] } });
  });

  it("rejects invalid bounded queue configuration", () => {
    expect(() => createInlineJobQueueAdapter({ maxBatchSize: 0, maxQueuedJobs: 1 })).toThrow(
      "Inline job queue maxBatchSize must be at least 1",
    );
    expect(() => createInlineJobQueueAdapter({ maxBatchSize: 1, maxQueuedJobs: 0 })).toThrow(
      "Inline job queue maxQueuedJobs must be at least 1",
    );
    expect(() =>
      createInlineJobQueueAdapter({ maxBatchSize: 1, maxQueuedJobs: 1, maxRetainedJobs: -1 }),
    ).toThrow("Inline job queue maxRetainedJobs must be at least 0");
  });
});
