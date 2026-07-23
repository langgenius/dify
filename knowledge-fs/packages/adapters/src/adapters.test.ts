import { describe, expect, it, vi } from "vitest";

import { createCloudflareJobQueueAdapter } from "./cloudflare-job-queue";
import { createNodePlatformAdapter } from "./node";
import { createPgBossJobQueueAdapter } from "./pg-boss-job-queue";
import {
  type PostgresPoolLike,
  checkPostgresHealth,
  createPostgresDatabaseExecutor,
} from "./postgres";

describe("platform adapter skeletons", () => {
  it("creates a Dify-dependent Node adapter", async () => {
    const difyStorageFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    const adapter = createNodePlatformAdapter({ difyStorageFetch, env: {} });

    await expect(adapter.health()).resolves.toMatchObject({
      ok: true,
      runtime: "node-docker",
    });
    expect(adapter.objectStorage.kind).toBe("dify");
    expect(difyStorageFetch.mock.calls[0]?.[0].toString()).toBe(
      "http://localhost:5001/inner/api/knowledge-fs/storage/health",
    );
  });

  it("uses Dify unified storage regardless of rollout mode and ignores MinIO env", async () => {
    const difyStorageFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    const adapter = createNodePlatformAdapter({
      difyStorageFetch,
      env: {
        DIFY_INNER_API_KEY: "inner-key",
        DIFY_INNER_API_URL: "http://api:5001",
        KNOWLEDGE_INTEGRATED_MODE_ENABLED: "false",
        MINIO_BUCKET: "must-not-be-used",
        MINIO_ENDPOINT: "http://minio:9000",
      },
    });

    expect(adapter.objectStorage.kind).toBe("dify");
    await expect(adapter.objectStorage.health()).resolves.toBe(true);
    expect(difyStorageFetch).toHaveBeenCalledOnce();
    expect(difyStorageFetch.mock.calls[0]?.[0].toString()).toBe(
      "http://api:5001/inner/api/knowledge-fs/storage/health",
    );
    expect(new Headers(difyStorageFetch.mock.calls[0]?.[1]?.headers).get("X-Inner-Api-Key")).toBe(
      "inner-key",
    );
  });

  it("sends Cloudflare queue messages and stores durable job state", async () => {
    const queueBinding = new FakeCloudflareQueueBinding();
    const stateStore = new FakeCloudflareJobStateStore();
    const queue = createCloudflareJobQueueAdapter({
      maxBatchSize: 2,
      maxQueuedJobs: 10,
      now: () => 1_000,
      queue: queueBinding,
      state: stateStore,
    });

    const job = await queue.enqueue({
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      runAfter: 6_500,
      type: "compile.document",
    });

    expect(queue.kind).toBe("cloudflare-queues");
    expect(queueBinding.messages).toEqual([
      {
        body: {
          attempts: 0,
          id: job.id,
          idempotencyKey: "tenant-1:doc-1:v1",
          type: "compile.document",
        },
        options: { delaySeconds: 6 },
      },
    ]);
    expect(stateStore.records.get(job.id)).toMatchObject({
      id: job.id,
      status: "queued",
      type: "compile.document",
    });
  });

  it("updates Cloudflare durable state across lease heartbeat completion and cancellation", async () => {
    const stateStore = new FakeCloudflareJobStateStore();
    const queue = createCloudflareJobQueueAdapter({
      maxBatchSize: 1,
      maxLeaseMs: 5_000,
      maxQueuedJobs: 10,
      now: () => 1_000,
      state: stateStore,
    });
    const first = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "compile" });
    const second = await queue.enqueue({ payload: { documentId: "doc-2" }, type: "compile" });

    await queue.lease({ leaseMs: 1_000, limit: 1, now: 2_000, workerId: "worker-1" });
    await queue.heartbeat({
      jobId: first.id,
      leaseMs: 2_000,
      now: 2_500,
      workerId: "worker-1",
    });
    await queue.complete(first.id);
    await queue.lease({ leaseMs: 1_000, limit: 1, now: 3_000, workerId: "worker-1" });
    await queue.cancel(second.id, "superseded");

    expect(stateStore.records.get(first.id)).toMatchObject({
      completedAt: 1_000,
      id: first.id,
      status: "completed",
    });
    expect(stateStore.records.get(second.id)).toMatchObject({
      canceledAt: 1_000,
      error: "superseded",
      id: second.id,
      status: "canceled",
    });
  });

  it("forwards typed Cloudflare leases without persisting unrelated jobs as running", async () => {
    const stateStore = new FakeCloudflareJobStateStore();
    const queue = createCloudflareJobQueueAdapter({
      maxBatchSize: 3,
      maxQueuedJobs: 10,
      now: () => 1_000,
      state: stateStore,
    });
    const research = await queue.enqueue({ payload: {}, type: "research.document" });
    const compilation = await queue.enqueue({ payload: {}, type: "compile.document" });
    const retention = await queue.enqueue({ payload: {}, type: "retention.cleanup" });

    await expect(
      queue.lease({
        leaseMs: 1_000,
        limit: 3,
        types: ["compile.document"],
        workerId: "compilation-worker",
      }),
    ).resolves.toMatchObject([{ id: compilation.id, type: "compile.document" }]);

    expect(stateStore.records.get(research.id)).toMatchObject({ attempts: 0, status: "queued" });
    expect(stateStore.records.get(retention.id)).toMatchObject({ attempts: 0, status: "queued" });
  });

  it("deduplicates Cloudflare queue delivery and persists retry transitions", async () => {
    const queueBinding = new FakeCloudflareQueueBinding();
    const stateStore = new FakeCloudflareJobStateStore();
    const queue = createCloudflareJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      now: () => 0,
      queue: queueBinding,
      state: stateStore,
    });
    const input = {
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      type: "compile.document",
    };

    const first = await queue.enqueue(input);
    const second = await queue.enqueue(input);

    expect(second.id).toBe(first.id);
    expect(queueBinding.messages).toHaveLength(1);

    await queue.lease({ leaseMs: 1_000, limit: 1, workerId: "worker-1" });
    await queue.fail(first.id, "transient parser failure");
    await expect(queue.status(first.id)).resolves.toMatchObject({ status: "failed" });
    await queue.retry(first.id, { runAfter: 2_000 });

    expect(stateStore.records.get(first.id)).toMatchObject({
      error: "transient parser failure",
      runAfter: 2_000,
      status: "queued",
    });
    expect(queueBinding.messages).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ attempts: 0, id: first.id }),
      }),
      {
        body: {
          attempts: 1,
          id: first.id,
          idempotencyKey: "tenant-1:doc-1:v1",
          type: "compile.document",
        },
        options: { delaySeconds: 2 },
      },
    ]);
  });

  it("clears Cloudflare idempotency keys after terminal completion", async () => {
    const queueBinding = new FakeCloudflareQueueBinding();
    const queue = createCloudflareJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      queue: queueBinding,
    });
    const input = {
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      type: "compile.document",
    };

    const first = await queue.enqueue(input);
    await queue.lease({ leaseMs: 1_000, limit: 1, workerId: "worker-1" });
    await queue.complete(first.id);
    const second = await queue.enqueue(input);

    expect(second.id).not.toBe(first.id);
    expect(queueBinding.messages).toHaveLength(2);
  });

  it("marks Cloudflare jobs canceled when queue delivery fails", async () => {
    const queueBinding = new FailingCloudflareQueueBinding();
    const stateStore = new FakeCloudflareJobStateStore();
    const queue = createCloudflareJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      queue: queueBinding,
      state: stateStore,
    });

    await expect(
      queue.enqueue({ payload: { documentId: "doc-1" }, type: "compile.document" }),
    ).rejects.toThrow("queue unavailable");

    const [record] = [...stateStore.records.values()];
    expect(record).toMatchObject({
      error: "Cloudflare queue delivery failed",
      status: "canceled",
    });
    await expect(queue.stats()).resolves.toMatchObject({
      canceled: 1,
      queued: 0,
    });
  });

  it("supports no-op Cloudflare bindings for local skeleton health", async () => {
    const queue = createCloudflareJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
    });

    const job = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "compile" });

    await expect(queue.health()).resolves.toBe(true);
    await expect(queue.status(job.id)).resolves.toMatchObject({ status: "queued" });
  });

  it("sends pg-boss jobs and stores durable job status", async () => {
    const boss = new FakePgBossClient();
    const queue = createPgBossJobQueueAdapter({
      boss,
      maxBatchSize: 2,
      maxQueuedJobs: 10,
      now: () => 1_000,
    });

    const job = await queue.enqueue({
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      runAfter: 6_500,
      type: "compile.document",
    });

    expect(queue.kind).toBe("pg-boss");
    expect(boss.sent).toEqual([
      {
        data: {
          attempts: 0,
          id: job.id,
          idempotencyKey: "tenant-1:doc-1:v1",
          type: "compile.document",
        },
        name: "compile.document",
        options: {
          singletonKey: "tenant-1:doc-1:v1",
          startAfter: new Date(6_500),
        },
      },
    ]);
    await expect(queue.status(job.id)).resolves.toMatchObject({
      externalJobId: "boss-1",
      status: "queued",
    });
  });

  it("forwards pg-boss lifecycle calls and redelivers retries", async () => {
    const boss = new FakePgBossClient();
    const queue = createPgBossJobQueueAdapter({
      boss,
      maxBatchSize: 1,
      maxQueuedJobs: 10,
      now: () => 0,
    });
    const job = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "compile" });

    await queue.lease({ leaseMs: 1_000, limit: 1, workerId: "worker-1" });
    await queue.fail(job.id, "parser unavailable");
    await queue.retry(job.id, { runAfter: 2_000 });
    await queue.lease({ leaseMs: 1_000, limit: 1, now: 2_000, workerId: "worker-1" });
    await queue.complete(job.id);
    await queue.cancel(job.id, "not needed");

    expect(boss.failed).toEqual([{ bossJobId: "boss-1", error: "parser unavailable" }]);
    expect(boss.sent).toHaveLength(2);
    expect(boss.sent[1]).toMatchObject({
      data: { attempts: 1, id: job.id, type: "compile" },
      name: "compile",
      options: { startAfter: new Date(2_000) },
    });
    expect(boss.completed).toEqual(["boss-2"]);
    expect(boss.canceled).toEqual(["boss-2"]);
  });

  it("forwards typed pg-boss leases without consuming unrelated jobs", async () => {
    const queue = createPgBossJobQueueAdapter({
      maxBatchSize: 3,
      maxQueuedJobs: 10,
      now: () => 1_000,
    });
    const research = await queue.enqueue({ payload: {}, type: "research.document" });
    const compilation = await queue.enqueue({ payload: {}, type: "compile.document" });
    const retention = await queue.enqueue({ payload: {}, type: "retention.cleanup" });

    await expect(
      queue.lease({
        leaseMs: 1_000,
        limit: 3,
        types: ["compile.document"],
        workerId: "compilation-worker",
      }),
    ).resolves.toMatchObject([{ id: compilation.id, type: "compile.document" }]);

    await expect(queue.status(research.id)).resolves.toMatchObject({
      attempts: 0,
      status: "queued",
    });
    await expect(queue.status(retention.id)).resolves.toMatchObject({
      attempts: 0,
      status: "queued",
    });
  });

  it("deduplicates pg-boss delivery and preserves external ids on dequeue heartbeat", async () => {
    const boss = new FakePgBossClient();
    const queue = createPgBossJobQueueAdapter({
      boss,
      maxBatchSize: 1,
      maxQueuedJobs: 10,
    });
    const input = {
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      type: "compile",
    };

    const first = await queue.enqueue(input);
    const second = await queue.enqueue(input);
    const [dequeued] = await queue.dequeue({ limit: 1, workerId: "worker-1" });
    const heartbeat = await queue.heartbeat({
      jobId: first.id,
      leaseMs: 1_000,
      workerId: "worker-1",
    });

    expect(second.id).toBe(first.id);
    expect(boss.sent).toHaveLength(1);
    expect(dequeued).toMatchObject({ externalJobId: "boss-1", id: first.id });
    expect(heartbeat).toMatchObject({ externalJobId: "boss-1", id: first.id });
  });

  it("clears pg-boss idempotency keys after terminal completion", async () => {
    const boss = new FakePgBossClient();
    const queue = createPgBossJobQueueAdapter({
      boss,
      maxBatchSize: 1,
      maxQueuedJobs: 10,
    });
    const input = {
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      type: "compile",
    };

    const first = await queue.enqueue(input);
    await queue.lease({ leaseMs: 1_000, limit: 1, workerId: "worker-1" });
    await queue.complete(first.id);
    const second = await queue.enqueue(input);

    expect(second.id).not.toBe(first.id);
    expect(boss.sent).toHaveLength(2);
  });

  it("marks pg-boss jobs canceled when initial delivery fails", async () => {
    const boss = new FailingPgBossClient();
    const queue = createPgBossJobQueueAdapter({
      boss,
      maxBatchSize: 1,
      maxQueuedJobs: 10,
    });

    await expect(
      queue.enqueue({
        idempotencyKey: "tenant-1:doc-1:v1",
        payload: { documentId: "doc-1" },
        type: "compile",
      }),
    ).rejects.toThrow("pg-boss unavailable");

    await expect(queue.stats()).resolves.toMatchObject({
      canceled: 1,
      queued: 0,
    });
  });

  it("fails pg-boss retry delivery closed instead of leaving queued work", async () => {
    const boss = new FailingRetryPgBossClient();
    const queue = createPgBossJobQueueAdapter({
      boss,
      maxBatchSize: 1,
      maxQueuedJobs: 10,
    });
    const job = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "compile" });

    await queue.lease({ leaseMs: 1_000, limit: 1, workerId: "worker-1" });
    await queue.fail(job.id, "transient");
    await expect(queue.retry(job.id, { runAfter: 2_000 })).rejects.toThrow("pg-boss unavailable");

    await expect(queue.status(job.id)).resolves.toMatchObject({
      error: "pg-boss retry delivery failed",
      status: "failed",
    });
  });

  it("supports no-op pg-boss bindings for local skeleton health", async () => {
    const queue = createPgBossJobQueueAdapter({
      maxBatchSize: 1,
      maxQueuedJobs: 10,
    });

    const job = await queue.enqueue({ payload: { documentId: "doc-1" }, type: "compile" });

    await expect(queue.health()).resolves.toBe(true);
    await expect(queue.status(job.id)).resolves.toMatchObject({
      externalJobId: "pg-boss-local-1",
      status: "queued",
    });
  });

  it("wires injected pg-boss client through the Node platform factory", async () => {
    const boss = new FakePgBossClient();
    const adapter = createNodePlatformAdapter({ env: {}, jobBoss: boss });

    const job = await adapter.jobs.enqueue({
      payload: { documentId: "doc-1" },
      type: "compile.document",
    });

    expect(adapter.jobs.kind).toBe("pg-boss");
    expect(boss.sent).toHaveLength(1);
    await expect(adapter.jobs.status(job.id)).resolves.toMatchObject({
      externalJobId: "boss-1",
      status: "queued",
    });
  });

  it("covers Node database and object-storage construction fallbacks", async () => {
    const poolWithoutClose: PostgresPoolLike = {
      query: async () => ({ rowCount: 0, rows: [] }),
    };
    const adapterWithoutClose = createNodePlatformAdapter({
      databasePool: poolWithoutClose,
      env: {},
    });

    expect(adapterWithoutClose.database.close).toBeUndefined();

    const poolWithSynchronousClose: PostgresPoolLike = {
      end: (() => undefined) as unknown as () => Promise<void>,
      query: async () => ({ rowCount: 0, rows: [] }),
    };
    const adapterWithSynchronousClose = createNodePlatformAdapter({
      databasePool: poolWithSynchronousClose,
      env: {},
    });

    await expect(adapterWithSynchronousClose.database.close?.()).resolves.toBeUndefined();

    const configuredAdapter = createNodePlatformAdapter({
      env: {
        DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs",
        POSTGRES_IDLE_TIMEOUT_MS: "0",
        POSTGRES_POOL_MAX: "2",
      },
    });

    await expect(configuredAdapter.database.close?.()).resolves.toBeUndefined();

    const difyAdapter = createNodePlatformAdapter({
      env: {
        MINIO_BUCKET: "knowledge-fs",
        MINIO_ENDPOINT: "http://minio:9000",
      },
    });

    expect(difyAdapter.objectStorage.kind).toBe("dify");
  });

  it("covers PostgreSQL result, rollback, release, and health fallbacks", async () => {
    const executor = createPostgresDatabaseExecutor({
      pool: {
        query: async () => ({ rowCount: null }),
      },
    });

    await expect(
      executor.execute({
        maxRows: 1,
        operation: "select",
        params: [],
        sql: "SELECT 1;",
        tableName: "schema_migrations",
      }),
    ).resolves.toEqual({ rows: [], rowsAffected: 0 });

    const transactionCalls: string[] = [];
    const transactionExecutor = createPostgresDatabaseExecutor({
      pool: {
        connect: async () => ({
          query: async ({ text }) => {
            transactionCalls.push(text);
            if (text === "ROLLBACK") {
              throw "rollback failed";
            }

            return { rowCount: 0, rows: [] };
          },
        }),
        query: async () => ({ rowCount: 0, rows: [] }),
      },
    });
    const operationError = new Error("operation failed");

    await expect(
      transactionExecutor.transaction(async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);
    expect(transactionCalls).toEqual(["BEGIN", "ROLLBACK"]);
    await expect(
      checkPostgresHealth({
        query: async () => {
          throw new Error("database unavailable");
        },
      }),
    ).resolves.toBe(false);
  });

  it("covers pg-boss bounded options, object ids, delayed failures, and missing status", async () => {
    const sent: Array<{ name: string; options: unknown }> = [];
    const queue = createPgBossJobQueueAdapter({
      boss: {
        send: async (name, _data, options) => {
          sent.push({ name, options });
          return { id: `object-id-${sent.length}` };
        },
      },
      maxBatchSize: 1,
      maxLeaseMs: 5_000,
      maxQueuedJobs: 10,
      maxRetainedJobs: 0,
      now: () => 1_000,
    });
    const job = await queue.enqueue({
      idempotencyKey: "tenant-1:doc-1:v1",
      payload: { documentId: "doc-1" },
      type: "compile",
    });

    await queue.lease({ leaseMs: 1_000, limit: 1, workerId: "worker-1" });
    await queue.fail(job.id, "retry later", { retryAt: 2_000 });
    await queue.retry(job.id);

    expect(sent).toEqual([
      {
        name: "compile",
        options: { singletonKey: "tenant-1:doc-1:v1" },
      },
      {
        name: "compile",
        options: { singletonKey: "tenant-1:doc-1:v1" },
      },
    ]);
    await expect(queue.status("missing-job")).resolves.toBeNull();

    const queueWithoutExternalId = createPgBossJobQueueAdapter({
      boss: { send: async () => ({ id: "" }) },
      maxBatchSize: 1,
      maxQueuedJobs: 1,
    });
    const jobWithoutExternalId = await queueWithoutExternalId.enqueue({
      payload: {},
      type: "compile",
    });

    expect(jobWithoutExternalId).not.toHaveProperty("externalJobId");
  });
});

class FakeCloudflareQueueBinding {
  readonly messages: { body: unknown; options: unknown }[] = [];

  async send(body: unknown, options?: unknown) {
    this.messages.push({ body, options });
  }
}

class FailingCloudflareQueueBinding {
  async send() {
    throw new Error("queue unavailable");
  }
}

class FakeCloudflareJobStateStore {
  readonly records = new Map<string, unknown>();

  async put(jobId: string, record: unknown) {
    this.records.set(jobId, record);
  }
}

class FakePgBossClient {
  readonly canceled: string[] = [];
  readonly completed: string[] = [];
  readonly failed: { bossJobId: string; error: string }[] = [];
  readonly sent: { data: unknown; name: string; options: unknown }[] = [];

  async send(name: string, data: unknown, options?: unknown) {
    const bossJobId = `boss-${this.sent.length + 1}`;
    this.sent.push({ data, name, options });
    return bossJobId;
  }

  async complete(bossJobId: string) {
    this.completed.push(bossJobId);
  }

  async fail(bossJobId: string, error: string) {
    this.failed.push({ bossJobId, error });
  }

  async cancel(bossJobId: string) {
    this.canceled.push(bossJobId);
  }
}

class FailingPgBossClient extends FakePgBossClient {
  override async send(): Promise<string> {
    throw new Error("pg-boss unavailable");
  }
}

class FailingRetryPgBossClient extends FakePgBossClient {
  override async send(name: string, data: unknown, options?: unknown) {
    if (this.sent.length > 0) {
      throw new Error("pg-boss unavailable");
    }

    return super.send(name, data, options);
  }
}
