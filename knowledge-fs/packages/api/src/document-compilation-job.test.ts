import {
  type JobPayload,
  type JobRecord,
  PUBLICATION_GENERATION_ID_SENTINEL,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDocumentCompilationCleanupWorker,
  createDocumentCompilationJobStateMachine,
  createInMemoryDocumentCompilationJobRepository,
} from "./document-compilation-job";

describe("document compilation job state machine", () => {
  it("starts a compilation job and enqueues bounded durable work", async () => {
    const queue = new FakeJobQueue();
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => "11111111-1111-4111-8111-111111111111",
      generatePublicationGenerationId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      jobs: queue,
      now: () => 1_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });

    const job = await machine.start({
      documentAssetId: "22222222-2222-4222-8222-222222222222",
      knowledgeSpaceId: "33333333-3333-4333-8333-333333333333",
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "44444444-4444-4444-8444-444444444444",
        revision: 1,
      },
      requestedBySubjectId: "editor-1",
      tenantId: "tenant-1",
      version: 1,
    });

    expect(job).toMatchObject({
      createdAt: 1_000,
      documentAssetId: "22222222-2222-4222-8222-222222222222",
      id: "11111111-1111-4111-8111-111111111111",
      queueJobId: "queue-1",
      stage: "queued",
      publicationGenerationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "44444444-4444-4444-8444-444444444444",
        revision: 1,
      },
      requestedBySubjectId: "editor-1",
    });
    expect(queue.enqueued).toEqual([
      {
        idempotencyKey:
          "tenant-1:33333333-3333-4333-8333-333333333333:22222222-2222-4222-8222-222222222222:1",
        payload: {
          documentAssetId: "22222222-2222-4222-8222-222222222222",
          documentCompilationJobId: "11111111-1111-4111-8111-111111111111",
          knowledgeSpaceId: "33333333-3333-4333-8333-333333333333",
          publicationGenerationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          tenantId: "tenant-1",
          version: 1,
        },
        type: "document.compile",
      },
    ]);
  });

  it("keeps the legacy payload unchanged until generation mode is explicitly enabled", async () => {
    const queue = new FakeJobQueue();
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => "11111111-1111-4111-8111-111111111111",
      jobs: queue,
      now: () => 1_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });

    const job = await machine.start(baseStartInput());
    const queued = queue.enqueued[0] as { readonly payload: Record<string, unknown> };

    expect(job.publicationGenerationId).toBeUndefined();
    expect(queued.payload.publicationGenerationId).toBeUndefined();
  });

  it("rejects the reserved legacy sentinel before enqueueing generation work", async () => {
    const queue = new FakeJobQueue();
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => "11111111-1111-4111-8111-111111111111",
      generatePublicationGenerationId: () => PUBLICATION_GENERATION_ID_SENTINEL,
      jobs: queue,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });

    await expect(machine.start(baseStartInput())).rejects.toThrow(
      "Publication generation ID must be a non-zero UUID",
    );
    expect(queue.enqueued).toEqual([]);
  });

  it("advances only through the durable ingestion stage order", async () => {
    let timestamp = 1_000;
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => "11111111-1111-4111-8111-111111111111",
      jobs: new FakeJobQueue(),
      now: () => timestamp,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const job = await machine.start(baseStartInput());

    timestamp = 2_000;
    await expect(machine.advance(job.id, "nodes_generated")).rejects.toThrow(
      "Document compilation job cannot advance from queued to nodes_generated",
    );

    const parsed = await machine.advance(job.id, "parsed");
    timestamp = 3_000;
    const outline = await machine.advance(job.id, "outline_built");
    timestamp = 4_000;
    const nodes = await machine.advance(job.id, "nodes_generated");
    const redeliveredParsed = await machine.advance(job.id, "parsed");
    timestamp = 5_000;
    const projection = await machine.advance(job.id, "projection_built");
    timestamp = 6_000;
    const smoke = await machine.advance(job.id, "smoke_eval_passed");
    timestamp = 7_000;
    const published = await machine.advance(job.id, "published");

    expect(parsed.stage).toBe("parsed");
    expect(outline.stage).toBe("outline_built");
    expect(nodes.stage).toBe("nodes_generated");
    expect(redeliveredParsed.stage).toBe("nodes_generated");
    expect(projection.stage).toBe("projection_built");
    expect(smoke.stage).toBe("smoke_eval_passed");
    expect(published).toMatchObject({
      completedAt: 7_000,
      stage: "published",
      updatedAt: 7_000,
    });
  });

  it("reuses the queued compilation id when an idempotent enqueue returns existing work", async () => {
    const repository = createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 });
    let queued: JobRecord | undefined;
    let nextId = 1;
    let nextGeneration = 1;
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => `11111111-1111-4111-8111-11111111111${nextId++}`,
      generatePublicationGenerationId: () =>
        `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${nextGeneration++}`,
      jobs: {
        cancel: async () => undefined,
        enqueue: async (input) => {
          queued ??= {
            attempts: 0,
            createdAt: 1_000,
            id: "queue-idempotent",
            payload: input.payload,
            status: "queued",
            type: input.type,
          };
          return queued;
        },
        fail: async () => undefined,
      },
      now: () => 1_000,
      repository,
    });

    const first = await machine.start(baseStartInput());
    const second = await machine.start(baseStartInput());

    expect(second.id).toBe(first.id);
    expect(second.publicationGenerationId).toBe(first.publicationGenerationId);
    await expect(repository.getMany([first.id, second.id])).resolves.toHaveLength(1);
  });

  it("fails closed when a new queue record does not retain its generation", async () => {
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => "11111111-1111-4111-8111-111111111111",
      generatePublicationGenerationId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      jobs: {
        cancel: async () => undefined,
        enqueue: async (input) => {
          const payload = JSON.parse(JSON.stringify(input.payload)) as Record<string, unknown>;
          payload.documentCompilationJobId = "different-document-compilation-job";
          payload.publicationGenerationId = undefined;

          return {
            attempts: 0,
            createdAt: 1_000,
            id: "queue-without-generation",
            payload: payload as JobPayload,
            status: "queued",
            type: input.type,
          };
        },
        fail: async () => undefined,
      },
      now: () => 1_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });

    await expect(machine.start(baseStartInput())).rejects.toThrow(
      "Document compilation queue omitted publicationGenerationId",
    );
  });

  it("does not silently reuse legacy queued work after generation mode is enabled", async () => {
    const repository = createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 });
    const persistedId = "11111111-1111-4111-8111-111111111111";
    await repository.create({
      createdAt: 1_000,
      documentAssetId: baseStartInput().documentAssetId,
      id: persistedId,
      knowledgeSpaceId: baseStartInput().knowledgeSpaceId,
      queueJobId: "queue-existing",
      stage: "queued",
      tenantId: baseStartInput().tenantId,
      updatedAt: 1_000,
      version: 1,
    });
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => "22222222-2222-4222-8222-222222222222",
      generatePublicationGenerationId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      jobs: {
        cancel: async () => undefined,
        enqueue: async (input) => {
          const { publicationGenerationId: _publicationGenerationId, ...legacyPayload } =
            input.payload as Record<string, JobPayload>;

          return {
            attempts: 0,
            createdAt: 1_000,
            id: "queue-existing",
            payload: {
              ...legacyPayload,
              documentCompilationJobId: persistedId,
            },
            status: "queued",
            type: input.type,
          };
        },
        fail: async () => undefined,
      },
      repository,
    });

    await expect(machine.start(baseStartInput())).rejects.toThrow(
      "Document compilation queue omitted publicationGenerationId",
    );
  });

  it("rejects a queue generation that disagrees with the persisted job", async () => {
    const repository = createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 });
    const persistedId = "11111111-1111-4111-8111-111111111111";
    await repository.create({
      createdAt: 1_000,
      documentAssetId: baseStartInput().documentAssetId,
      id: persistedId,
      knowledgeSpaceId: baseStartInput().knowledgeSpaceId,
      publicationGenerationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      queueJobId: "queue-existing",
      stage: "queued",
      tenantId: baseStartInput().tenantId,
      updatedAt: 1_000,
      version: 1,
    });
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => "22222222-2222-4222-8222-222222222222",
      generatePublicationGenerationId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      jobs: {
        cancel: async () => undefined,
        enqueue: async (input) => ({
          attempts: 0,
          createdAt: 1_000,
          id: "queue-existing",
          payload: {
            ...(input.payload as Record<string, JobPayload>),
            documentCompilationJobId: persistedId,
            publicationGenerationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
          status: "queued",
          type: input.type,
        }),
        fail: async () => undefined,
      },
      now: () => 1_000,
      repository,
    });

    await expect(machine.start(baseStartInput())).rejects.toThrow(
      "Document compilation queue generation does not match the persisted job",
    );
  });

  it("keeps retryable failures non-terminal and terminal failures irreversible", async () => {
    const queue = new FakeJobQueue();
    let nextId = 1;
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => `11111111-1111-4111-8111-11111111111${nextId++}`,
      jobs: queue,
      now: () => 1_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const failedJob = await machine.start(baseStartInput());

    await machine.fail(failedJob.id, "parser unavailable", { retryAt: 2_000 });
    await expect(machine.get(failedJob.id)).resolves.toMatchObject({
      error: "parser unavailable",
      retryAt: 2_000,
      runState: "retry_wait",
      stage: "queued",
    });
    expect(queue.failed).toEqual([
      { error: "parser unavailable", jobId: "queue-1", retryAt: 2_000 },
    ]);
    await expect(machine.advance(failedJob.id, "parsed")).resolves.toMatchObject({
      runState: "running",
      stage: "parsed",
    });

    const terminalJob = await machine.start({
      ...baseStartInput(),
      documentAssetId: "44444444-4444-4444-8444-444444444443",
    });
    await machine.fail(terminalJob.id, "invalid payload");
    await expect(machine.get(terminalJob.id)).resolves.toMatchObject({
      completedAt: 1_000,
      error: "invalid payload",
      runState: "failed",
      stage: "failed",
    });
    await expect(machine.advance(terminalJob.id, "parsed")).rejects.toThrow(
      "Document compilation job failed is terminal",
    );

    const canceledJob = await machine.start({
      ...baseStartInput(),
      documentAssetId: "44444444-4444-4444-8444-444444444444",
    });
    await machine.cancel(canceledJob.id, "superseded");

    expect(queue.canceled).toEqual([{ jobId: "queue-3", reason: "superseded" }]);
    await expect(machine.get(canceledJob.id)).resolves.toMatchObject({
      error: "superseded",
      stage: "canceled",
    });
  });

  it("bounds repository capacity and returns clone-isolated records", async () => {
    const repository = createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 });
    let nextId = 1;
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => `11111111-1111-4111-8111-11111111111${nextId++}`,
      jobs: new FakeJobQueue(),
      now: () => 1_000,
      repository,
    });
    const job = await machine.start(baseStartInput());
    const clone = await machine.get(job.id);

    if (!clone) {
      throw new Error("Expected job");
    }

    clone.stage = "published";

    await expect(machine.get(job.id)).resolves.toMatchObject({ stage: "queued" });
    await expect(
      machine.start({
        ...baseStartInput(),
        documentAssetId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toThrow("Document compilation job repository maxJobs=1 exceeded");
  });

  it("rejects invalid state machine inputs and missing jobs", async () => {
    const machine = createDocumentCompilationJobStateMachine({
      generateId: () => "11111111-1111-4111-8111-111111111111",
      jobs: new FakeJobQueue(),
      now: () => 1_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });

    expect(() => createInMemoryDocumentCompilationJobRepository({ maxJobs: 0 })).toThrow(
      "Document compilation job repository maxJobs must be at least 1",
    );
    await expect(machine.get("missing")).resolves.toBeNull();
    await expect(machine.advance("missing", "parsed")).rejects.toThrow(
      "Document compilation job missing not found",
    );
    await expect(machine.start({ ...baseStartInput(), tenantId: " " })).rejects.toThrow(
      "Document compilation job tenantId is required",
    );
    await expect(machine.start({ ...baseStartInput(), version: 0 })).rejects.toThrow(
      "Document compilation job version must be a positive integer",
    );

    const invalidGenerationMachine = createDocumentCompilationJobStateMachine({
      generateId: () => "11111111-1111-4111-8111-111111111112",
      generatePublicationGenerationId: () => "not-a-uuid",
      jobs: new FakeJobQueue(),
      now: () => 1_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    await expect(invalidGenerationMachine.start(baseStartInput())).rejects.toThrow();

    const job = await machine.start(baseStartInput());

    await expect(machine.advance(job.id, "failed")).rejects.toThrow(
      "Document compilation job cannot advance to failed",
    );
    await expect(machine.advance(job.id, "canceled")).rejects.toThrow(
      "Document compilation job cannot advance to canceled",
    );
  });

  it("enqueues and processes bounded terminal document compilation cleanup jobs", async () => {
    const queue = new FakeJobQueue();
    const repository = createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 });
    const cleanup = createDocumentCompilationCleanupWorker({
      jobs: queue,
      maxCleanupJobs: 2,
      now: () => 10_000,
      repository,
    });

    await repository.create({
      completedAt: 1_000,
      createdAt: 500,
      documentAssetId: "22222222-2222-4222-8222-222222222221",
      id: "cleanup-old-published",
      knowledgeSpaceId: "33333333-3333-4333-8333-333333333333",
      queueJobId: "queue-old-published",
      stage: "published",
      tenantId: "tenant-1",
      updatedAt: 1_000,
      version: 1,
    });
    await repository.create({
      completedAt: 9_000,
      createdAt: 8_000,
      documentAssetId: "22222222-2222-4222-8222-222222222222",
      id: "cleanup-recent-failed",
      knowledgeSpaceId: "33333333-3333-4333-8333-333333333333",
      queueJobId: "queue-recent-failed",
      stage: "failed",
      tenantId: "tenant-1",
      updatedAt: 9_000,
      version: 1,
    });
    await repository.create({
      createdAt: 100,
      documentAssetId: "22222222-2222-4222-8222-222222222223",
      id: "cleanup-old-queued",
      knowledgeSpaceId: "33333333-3333-4333-8333-333333333333",
      queueJobId: "queue-old-queued",
      stage: "queued",
      tenantId: "tenant-1",
      updatedAt: 100,
      version: 1,
    });
    await repository.create({
      completedAt: 1_000,
      createdAt: 500,
      documentAssetId: "22222222-2222-4222-8222-222222222224",
      id: "cleanup-other-tenant",
      knowledgeSpaceId: "33333333-3333-4333-8333-333333333334",
      queueJobId: "queue-other-tenant",
      stage: "canceled",
      tenantId: "tenant-2",
      updatedAt: 1_000,
      version: 1,
    });

    const queued = await cleanup.enqueue({
      olderThan: 5_000,
      tenantId: "tenant-1",
    });

    expect(queued.id).toBe("queue-1");
    expect(queue.enqueued).toEqual([
      {
        idempotencyKey: "retention.cleanup.document-compilation:tenant-1:5000",
        payload: {
          maxJobs: 2,
          olderThan: 5_000,
          requestedAt: 10_000,
          tenantId: "tenant-1",
        },
        type: "retention.cleanup.document-compilation",
      },
    ]);

    await expect(
      cleanup.process({
        maxJobs: 2,
        olderThan: 5_000,
        requestedAt: 10_000,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({
      deleted: 1,
      olderThan: 5_000,
      tenantId: "tenant-1",
    });
    await expect(repository.get("cleanup-old-published")).resolves.toBeNull();
    await expect(repository.get("cleanup-recent-failed")).resolves.toMatchObject({
      stage: "failed",
    });
    await expect(repository.get("cleanup-old-queued")).resolves.toMatchObject({
      stage: "queued",
    });
    await expect(repository.get("cleanup-other-tenant")).resolves.toMatchObject({
      tenantId: "tenant-2",
    });
    await expect(
      cleanup.process({
        maxJobs: 0,
        olderThan: 5_000,
        requestedAt: 10_000,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document compilation cleanup maxJobs must be at least 1");
    await expect(cleanup.process(null as never)).rejects.toThrow(
      "Document compilation cleanup payload is invalid",
    );
    await expect(
      cleanup.process({
        maxJobs: 3,
        olderThan: 5_000,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document compilation cleanup maxJobs exceeds maxCleanupJobs=2");
    await expect(
      cleanup.process({
        maxJobs: 1,
        olderThan: 5_000,
        tenantId: 42,
      } as never),
    ).rejects.toThrow("Document compilation cleanup payload is invalid");
    await expect(cleanup.enqueue({ olderThan: 5_000, tenantId: " " })).rejects.toThrow(
      "Document compilation cleanup tenantId is required",
    );
    await expect(cleanup.enqueue({ olderThan: -1, tenantId: "tenant-1" })).rejects.toThrow(
      "Document compilation cleanup olderThan must be a non-negative integer",
    );
    expect(() =>
      createDocumentCompilationCleanupWorker({
        jobs: queue,
        maxCleanupJobs: 0,
        repository,
      }),
    ).toThrow("Document compilation cleanup maxCleanupJobs must be at least 1");
  });
});

function baseStartInput() {
  return {
    documentAssetId: "22222222-2222-4222-8222-222222222222",
    knowledgeSpaceId: "33333333-3333-4333-8333-333333333333",
    tenantId: "tenant-1",
    version: 1,
  };
}

class FakeJobQueue {
  readonly canceled: { jobId: string; reason?: string }[] = [];
  readonly enqueued: unknown[] = [];
  readonly failed: { error: string; jobId: string; retryAt?: number }[] = [];

  async enqueue(input: unknown) {
    this.enqueued.push(input);
    const queued = input as { readonly payload: JobPayload; readonly type: string };

    return {
      attempts: 0,
      createdAt: 1_000,
      id: `queue-${this.enqueued.length}`,
      payload: queued.payload,
      status: "queued" as const,
      type: queued.type,
    };
  }

  async fail(jobId: string, error: string, options?: { readonly retryAt?: number }) {
    this.failed.push({ error, jobId, ...(options?.retryAt ? { retryAt: options.retryAt } : {}) });
  }

  async cancel(jobId: string, reason?: string) {
    this.canceled.push({ jobId, ...(reason ? { reason } : {}) });
  }
}
