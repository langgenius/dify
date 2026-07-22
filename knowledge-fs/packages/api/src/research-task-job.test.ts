import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryResearchTaskJobRepository,
  createInMemoryResearchTaskPartialResultRepository,
  createResearchTaskJobStateMachine,
} from "./research-task-job";

describe("research task job state machine", () => {
  it("persists only a grant locator for new Capability admissions", async () => {
    const queue = new FakeJobQueue();
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: queue,
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const {
      permissionSnapshot: _permissionSnapshot,
      subjectId: _subjectId,
      ...base
    } = baseStartInput();

    const job = await machine.start({
      ...base,
      capabilityGrantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e10",
    });

    expect(job).toMatchObject({
      capabilityGrantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e10",
      id: "research-task-job-1",
    });
    expect(job).not.toHaveProperty("permissionSnapshot");
    expect(job).not.toHaveProperty("subjectId");
    expect(queue.enqueued[0]).toMatchObject({
      payload: { researchTaskJobId: "research-task-job-1" },
    });
    expect(JSON.stringify(queue.enqueued[0])).not.toContain("grant");
  });

  it("rejects mixed or missing durable authorization bindings", async () => {
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: new FakeJobQueue(),
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const capabilityGrantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e10";

    await expect(machine.start({ ...baseStartInput(), capabilityGrantId })).rejects.toThrow(
      "exactly one durable authorization binding",
    );
    const {
      permissionSnapshot: _permissionSnapshot,
      subjectId: _subjectId,
      ...missing
    } = baseStartInput();
    await expect(machine.start(missing)).rejects.toThrow(
      "exactly one durable authorization binding",
    );
  });

  it("starts a research task and enqueues bounded durable work", async () => {
    const queue = new FakeJobQueue();
    const record = vi.fn();
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: queue,
      metrics: { record },
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });

    const job = await machine.start({
      ...baseStartInput(),
      knowledgeSpaceId: "space-1",
      query: "Compare the latest reliability signals",
    });

    expect(job).toMatchObject({
      createdAt: 1_000,
      id: "research-task-job-1",
      knowledgeSpaceId: "space-1",
      queueJobId: "queue-1",
      query: "Compare the latest reliability signals",
      stage: "queued",
      subjectId: "subject-1",
      tenantId: "tenant-1",
      updatedAt: 1_000,
    });
    expect(queue.enqueued).toEqual([
      {
        idempotencyKey: "research.task:tenant-1:space-1:research-task-job-1",
        payload: { researchTaskJobId: "research-task-job-1" },
        type: "research.task",
      },
    ]);
    expect(record).toHaveBeenCalledWith({ lifecycle: "queued", taskKind: "research" });
  });

  it("persists retrieval mode and topK while queue payloads contain only the job locator", async () => {
    const queue = new FakeJobQueue();
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: queue,
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });

    const job = await machine.start({
      ...baseStartInput(),
      mode: "deep",
      topK: 7,
    });

    expect(job).toMatchObject({ mode: "deep", topK: 7 });
    expect(queue.enqueued[0]).toMatchObject({
      payload: { researchTaskJobId: "research-task-job-1" },
    });

    const resumed = await machine.resume(job.id);

    expect(resumed).toMatchObject({ mode: "deep", topK: 7 });
    expect(queue.enqueued[1]).toMatchObject({
      payload: { researchTaskJobId: "research-task-job-1" },
    });
  });

  it("advances only through the agent research stage order", async () => {
    let timestamp = 1_000;
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: new FakeJobQueue(),
      now: () => timestamp,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const job = await machine.start(baseStartInput());

    timestamp = 2_000;
    await expect(machine.advance(job.id, "retrieving")).rejects.toThrow(
      "Research task job cannot advance from queued to retrieving",
    );

    const planning = await machine.advance(job.id, "planning");
    timestamp = 3_000;
    const retrieving = await machine.advance(job.id, "retrieving");
    timestamp = 4_000;
    const analyzing = await machine.advance(job.id, "analyzing");
    timestamp = 5_000;
    const generating = await machine.advance(job.id, "generating");
    timestamp = 6_000;
    const completed = await machine.advance(job.id, "completed");

    expect(planning.stage).toBe("planning");
    expect(retrieving.stage).toBe("retrieving");
    expect(analyzing.stage).toBe("analyzing");
    expect(generating.stage).toBe("generating");
    expect(completed).toMatchObject({
      completedAt: 6_000,
      stage: "completed",
      updatedAt: 6_000,
    });
  });

  it("fails and cancels through the queue without allowing terminal mutation", async () => {
    const queue = new FakeJobQueue();
    const machine = createResearchTaskJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `research-task-job-${next++}`;
      })(),
      jobs: queue,
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const failedJob = await machine.start(baseStartInput());

    await machine.fail(failedJob.id, "retriever unavailable", { retryAt: 2_000 });
    await expect(machine.get(failedJob.id)).resolves.toMatchObject({
      error: "retriever unavailable",
      stage: "failed",
    });
    expect(queue.failed).toEqual([
      { error: "retriever unavailable", jobId: "queue-1", retryAt: 2_000 },
    ]);
    await expect(machine.advance(failedJob.id, "planning")).rejects.toThrow(
      "Research task job failed is terminal",
    );

    const canceledJob = await machine.start({
      ...baseStartInput(),
      query: "A second bounded research task",
    });
    await machine.cancel(canceledJob.id, "user canceled");

    expect(queue.canceled).toEqual([{ jobId: "queue-2", reason: "user canceled" }]);
    await expect(machine.get(canceledJob.id)).resolves.toMatchObject({
      error: "user canceled",
      stage: "canceled",
    });
  });

  it("bounds repository capacity and returns clone-isolated records", async () => {
    const repository = createInMemoryResearchTaskJobRepository({ maxJobs: 1 });
    const machine = createResearchTaskJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `research-task-job-${next++}`;
      })(),
      jobs: new FakeJobQueue(),
      now: () => 1_000,
      repository,
    });
    const job = await machine.start({
      ...baseStartInput(),
      metadata: { filters: { topic: "ops" } },
    });
    const clone = await machine.get(job.id);

    if (!clone) {
      throw new Error("Expected research task job");
    }

    clone.stage = "completed";
    clone.metadata.filters = { topic: "mutated" };
    (clone.permissionSnapshot as { id: string }).id = "mutated";

    await expect(machine.get(job.id)).resolves.toMatchObject({
      metadata: { filters: { topic: "ops" } },
      permissionSnapshot: basePermissionSnapshot,
      stage: "queued",
    });
    await expect(
      machine.start({
        ...baseStartInput(),
        query: "Another bounded research task",
      }),
    ).rejects.toThrow("Research task job repository maxJobs=1 exceeded");
  });

  it("returns unique batch reads and validates inputs", async () => {
    const repository = createInMemoryResearchTaskJobRepository({ maxJobs: 10 });
    const machine = createResearchTaskJobStateMachine({
      generateId: (() => {
        let next = 1;
        return () => `research-task-job-${next++}`;
      })(),
      jobs: new FakeJobQueue(),
      maxQueryBytes: 64,
      now: () => 1_000,
      repository,
    });

    expect(() => createInMemoryResearchTaskJobRepository({ maxJobs: 0 })).toThrow(
      "Research task job repository maxJobs must be at least 1",
    );
    await expect(machine.get("missing")).resolves.toBeNull();
    await expect(machine.advance("missing", "planning")).rejects.toThrow(
      "Research task job missing not found",
    );
    await expect(machine.start({ ...baseStartInput(), tenantId: " " })).rejects.toThrow(
      "Research task job tenantId is required",
    );
    await expect(machine.start({ ...baseStartInput(), query: " " })).rejects.toThrow(
      "Research task job query is required",
    );
    await expect(
      machine.start({
        ...baseStartInput(),
        query: "x".repeat(65),
      }),
    ).rejects.toThrow("Research task job query exceeds maxQueryBytes=64");

    const first = await machine.start(baseStartInput());
    const second = await machine.start({
      ...baseStartInput(),
      query: "Second research task",
    });

    await expect(machine.getMany([first.id, second.id, first.id, "missing"])).resolves.toEqual([
      first,
      second,
    ]);
    await expect(machine.advance(first.id, "failed")).rejects.toThrow(
      "Research task job cannot advance to failed",
    );
    await expect(machine.advance(first.id, "canceled")).rejects.toThrow(
      "Research task job cannot advance to canceled",
    );
  });

  it("filters tenant, space, and capability grant before bounded cursor pagination", async () => {
    let timestamp = 1_000;
    let nextId = 0;
    const machine = createResearchTaskJobStateMachine({
      generateId: () => `research-task-list-${++nextId}`,
      jobs: new FakeJobQueue(),
      now: () => timestamp,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const grantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e10";
    const otherGrantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e11";
    const start = async (overrides: Partial<ReturnType<typeof capabilityStartInput>> = {}) => {
      const job = await machine.start({ ...capabilityStartInput(grantId), ...overrides });
      timestamp += 1_000;
      return job;
    };

    const oldest = await start({ query: "oldest matching" });
    const middle = await start({ query: "middle matching" });
    const newest = await start({ query: "newest matching" });
    await start({ capabilityGrantId: otherGrantId, query: "newer but other grant" });
    await start({ query: "newer but other tenant", tenantId: "tenant-2" });

    const firstPage = await machine.listBySpace({
      capabilityRequester: {
        callerKind: "interactive",
        grantId,
        subjectId: "subject-1",
      },
      knowledgeSpaceId: "space-1",
      limit: 2,
      tenantId: "tenant-1",
    });
    expect(firstPage.items.map((item) => item.id)).toEqual([newest.id, middle.id]);
    expect(firstPage.nextCursor).toEqual({ createdAt: middle.createdAt, id: middle.id });

    const secondPage = await machine.listBySpace({
      capabilityRequester: {
        callerKind: "interactive",
        grantId,
        subjectId: "subject-1",
      },
      cursor: firstPage.nextCursor,
      knowledgeSpaceId: "space-1",
      limit: 2,
      tenantId: "tenant-1",
    });
    expect(secondPage.items.map((item) => item.id)).toEqual([oldest.id]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("records step costs and cancels when the research budget is exhausted", async () => {
    const queue = new FakeJobQueue();
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: queue,
      now: (() => {
        let timestamp = 1_000;
        return () => timestamp++;
      })(),
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const job = await machine.start({
      ...baseStartInput(),
      budgetUsd: 0.02,
    });

    const planned = await machine.recordCost(job.id, {
      costUsd: 0.01,
      provider: "retrieval",
      step: "planning",
      usage: { documentsScanned: 3 },
    });
    expect(planned).toMatchObject({
      cost: {
        budgetUsd: 0.02,
        entries: [
          {
            costUsd: 0.01,
            provider: "retrieval",
            step: "planning",
            usage: { documentsScanned: 3 },
          },
        ],
        totalUsd: 0.01,
      },
      stage: "queued",
    });

    const canceled = await machine.recordCost(job.id, {
      costUsd: 0.02,
      provider: "llm",
      step: "generating",
      usage: { completionTokens: 20, promptTokens: 100 },
    });
    expect(canceled).toMatchObject({
      completedAt: 1_002,
      cost: {
        budgetExceeded: true,
        totalUsd: 0.03,
      },
      error: "Research task budget exhausted",
      stage: "canceled",
    });
    expect(queue.canceled).toEqual([
      { jobId: "queue-1", reason: "Research task budget exhausted" },
    ]);
    await expect(machine.advance(job.id, "planning")).rejects.toThrow(
      "Research task job canceled is terminal",
    );
  });

  it("rejects unsafe cost records and cost mutations after terminal states", async () => {
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: new FakeJobQueue(),
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const job = await machine.start(baseStartInput());

    await expect(
      machine.recordCost(job.id, { costUsd: -0.01, provider: "llm", step: "planning" }),
    ).rejects.toThrow("Research task costUsd must be a non-negative finite number");
    await expect(
      machine.recordCost(job.id, { costUsd: 0.01, provider: " ", step: "planning" }),
    ).rejects.toThrow("Research task cost provider is required");
    await expect(
      machine.recordCost(job.id, { costUsd: 0.01, provider: "llm", step: " " }),
    ).rejects.toThrow("Research task cost step is required");

    await machine.fail(job.id, "retriever failed");
    await expect(
      machine.recordCost(job.id, { costUsd: 0.01, provider: "llm", step: "planning" }),
    ).rejects.toThrow("Research task job failed is terminal");
  });

  it("resumes from the last persisted stage without resetting to queued", async () => {
    const queue = new FakeJobQueue();
    let timestamp = 1_000;
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: queue,
      now: () => timestamp,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const job = await machine.start(baseStartInput());

    timestamp = 2_000;
    await machine.advance(job.id, "planning");
    timestamp = 3_000;
    await machine.advance(job.id, "retrieving");
    timestamp = 4_000;
    const analyzing = await machine.advance(job.id, "analyzing");
    timestamp = 5_000;

    const resumed = await machine.resume(job.id);

    expect(resumed).toMatchObject({
      id: job.id,
      queueJobId: "queue-2",
      stage: "analyzing",
      updatedAt: 5_000,
    });
    expect(queue.enqueued).toEqual([
      expect.objectContaining({
        idempotencyKey: "research.task:tenant-1:space-1:research-task-job-1",
      }),
      {
        idempotencyKey: "research.task.resume:tenant-1:space-1:research-task-job-1:analyzing",
        payload: { researchTaskJobId: "research-task-job-1" },
        type: "research.task",
      },
    ]);
    expect(analyzing.stage).toBe("analyzing");

    await machine.advance(job.id, "generating");
    await machine.advance(job.id, "completed");
    await expect(machine.resume(job.id)).rejects.toThrow("Research task job completed is terminal");
  });

  it("pauses under backpressure and resumes from the paused stage", async () => {
    const queue = new FakeJobQueue();
    let timestamp = 1_000;
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: queue,
      now: () => timestamp,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const job = await machine.start(baseStartInput());

    timestamp = 2_000;
    await machine.advance(job.id, "planning");
    timestamp = 3_000;
    await machine.advance(job.id, "retrieving");

    timestamp = 4_000;
    const paused = await machine.pause(job.id, {
      reason: "Backpressure: high-latency",
      resumeAfter: 34_000,
    });

    expect(paused).toMatchObject({
      error: "Backpressure: high-latency",
      pausedAt: 4_000,
      pausedFromStage: "retrieving",
      resumeAfter: 34_000,
      stage: "paused",
      updatedAt: 4_000,
    });
    expect(queue.canceled).toEqual([{ jobId: "queue-1", reason: "Backpressure: high-latency" }]);
    await expect(machine.advance(job.id, "analyzing")).rejects.toThrow(
      "Research task job cannot advance from paused to analyzing",
    );

    timestamp = 5_000;
    const resumed = await machine.resume(job.id);
    expect(resumed).toMatchObject({
      id: job.id,
      queueJobId: "queue-2",
      stage: "retrieving",
      updatedAt: 5_000,
    });
    expect(resumed.pausedAt).toBeUndefined();
    expect(resumed.pausedFromStage).toBeUndefined();
    expect(resumed.resumeAfter).toBeUndefined();
    expect(queue.enqueued.at(-1)).toEqual({
      idempotencyKey: "research.task.resume:tenant-1:space-1:research-task-job-1:retrieving",
      payload: { researchTaskJobId: "research-task-job-1" },
      type: "research.task",
    });

    await machine.advance(job.id, "analyzing");
    await machine.fail(job.id, "retriever failed");
    await expect(machine.pause(job.id, { reason: "too late" })).rejects.toThrow(
      "Research task job failed is terminal",
    );
  });

  it("bounds cost entry count and usage payload size", async () => {
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-1",
      jobs: new FakeJobQueue(),
      maxCostEntries: 1,
      maxCostUsageBytes: 24,
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const job = await machine.start(baseStartInput());

    await machine.recordCost(job.id, {
      costUsd: 0.01,
      provider: "retrieval",
      step: "planning",
      usage: { hits: 1 },
    });

    await expect(
      machine.recordCost(job.id, {
        costUsd: 0.01,
        provider: "llm",
        step: "generating",
      }),
    ).rejects.toThrow("Research task cost entries exceed maxCostEntries=1");

    const secondJob = await createResearchTaskJobStateMachine({
      generateId: () => "research-task-job-2",
      jobs: new FakeJobQueue(),
      maxCostUsageBytes: 16,
      now: () => 1_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    }).start(baseStartInput());
    const boundedMachine = createResearchTaskJobStateMachine({
      generateId: () => "unused",
      jobs: new FakeJobQueue(),
      maxCostUsageBytes: 16,
      now: () => 1_000,
      repository: {
        create: async (input) => input,
        get: async () => secondJob,
        getMany: async () => [secondJob],
        update: async (input) => input,
      },
    });

    await expect(
      boundedMachine.recordCost(secondJob.id, {
        costUsd: 0.01,
        provider: "llm",
        step: "generating",
        usage: { prompt: "x".repeat(32) },
      }),
    ).rejects.toThrow("Research task cost usage exceeds maxCostUsageBytes=16");
  });
});

describe("research task partial result repository", () => {
  it("appends and lists bounded evidence bundles by research task", async () => {
    const repository = createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 2,
      maxResults: 3,
    });

    const first = await repository.append({
      evidenceBundle: evidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a01", "first evidence"),
      knowledgeSpaceId: "space-1",
      researchTaskJobId: "research-task-job-1",
      tenantId: "tenant-1",
    });
    await repository.append({
      evidenceBundle: evidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a02", "second evidence"),
      knowledgeSpaceId: "space-1",
      researchTaskJobId: "research-task-job-1",
      tenantId: "tenant-1",
    });
    await repository.append({
      evidenceBundle: evidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a03", "other task"),
      knowledgeSpaceId: "space-1",
      researchTaskJobId: "research-task-job-2",
      tenantId: "tenant-1",
    });

    const firstPage = await repository.list({
      limit: 1,
      researchTaskJobId: "research-task-job-1",
      tenantId: "tenant-1",
    });
    expect(firstPage).toMatchObject({
      items: [
        {
          evidenceBundle: { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a01" },
          sequence: 1,
        },
      ],
      nextCursor: "1",
    });

    const secondPage = await repository.list({
      cursor: firstPage.nextCursor,
      limit: 2,
      researchTaskJobId: "research-task-job-1",
      tenantId: "tenant-1",
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.evidenceBundle.id).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f6a02");
    expect(secondPage.nextCursor).toBeUndefined();

    const firstEvidenceItem = first.evidenceBundle.items[0];

    if (!firstEvidenceItem) {
      throw new Error("Expected partial result evidence item");
    }

    firstEvidenceItem.text = "mutated evidence";
    await expect(
      repository.list({
        limit: 2,
        researchTaskJobId: "research-task-job-1",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          evidenceBundle: expect.objectContaining({
            items: expect.arrayContaining([expect.objectContaining({ text: "first evidence" })]),
          }),
        }),
      ]),
    });
  });

  it("rejects unbounded partial result storage and reads", async () => {
    expect(() =>
      createInMemoryResearchTaskPartialResultRepository({ maxListLimit: 1, maxResults: 0 }),
    ).toThrow("Research task partial result repository maxResults must be at least 1");
    expect(() =>
      createInMemoryResearchTaskPartialResultRepository({ maxListLimit: 0, maxResults: 1 }),
    ).toThrow("Research task partial result repository maxListLimit must be at least 1");

    const repository = createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 1,
      maxResults: 1,
    });
    await repository.append({
      evidenceBundle: evidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a04", "one evidence"),
      knowledgeSpaceId: "space-1",
      researchTaskJobId: "research-task-job-1",
      tenantId: "tenant-1",
    });

    await expect(
      repository.append({
        evidenceBundle: evidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a05", "two evidence"),
        knowledgeSpaceId: "space-1",
        researchTaskJobId: "research-task-job-1",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Research task partial result repository maxResults=1 exceeded");
    await expect(
      repository.list({
        limit: 2,
        researchTaskJobId: "research-task-job-1",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Research task partial result list limit exceeds maxListLimit=1");
    await expect(
      repository.list({
        cursor: "not-a-number",
        limit: 1,
        researchTaskJobId: "research-task-job-1",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Research task partial result cursor is invalid");
  });
});

function baseStartInput() {
  return {
    knowledgeSpaceId: "space-1",
    permissionSnapshot: basePermissionSnapshot,
    query: "Research the current support posture",
    subjectId: "subject-1",
    tenantId: "tenant-1",
  };
}

function capabilityStartInput(capabilityGrantId: string) {
  return {
    capabilityGrantId,
    knowledgeSpaceId: "space-1",
    query: "Capability-scoped research task",
    tenantId: "tenant-1",
  };
}

const basePermissionSnapshot = {
  accessChannel: "interactive" as const,
  id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
  revision: 1,
};

class FakeJobQueue {
  readonly canceled: { jobId: string; reason?: string }[] = [];
  readonly enqueued: unknown[] = [];
  readonly failed: { error: string; jobId: string; retryAt?: number }[] = [];

  async enqueue(input: unknown) {
    this.enqueued.push(input);

    return {
      attempts: 0,
      createdAt: 1_000,
      id: `queue-${this.enqueued.length}`,
      payload: null,
      status: "queued" as const,
      type: "research.task",
    };
  }

  async fail(jobId: string, error: string, options?: { readonly retryAt?: number }) {
    this.failed.push({ error, jobId, ...(options?.retryAt ? { retryAt: options.retryAt } : {}) });
  }

  async cancel(jobId: string, reason?: string) {
    this.canceled.push({ jobId, ...(reason ? { reason } : {}) });
  }
}

function evidenceBundle(id: string, text: string) {
  return {
    createdAt: "2026-05-12T15:00:00.000Z",
    id,
    items: [
      {
        citations: [
          {
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
            documentVersion: 1,
            sectionPath: [],
            startOffset: 0,
          },
        ],
        conflicts: [],
        freshness: { status: "fresh" as const },
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c01",
        score: 0.9,
        scores: { final: 0.9, retrieval: 0.9 },
        text,
      },
    ],
    missingEvidence: [],
    query: "research partials",
    state: "partial" as const,
  };
}
