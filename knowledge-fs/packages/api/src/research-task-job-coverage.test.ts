import { describe, expect, it } from "vitest";

import {
  type ResearchTaskJob,
  createInMemoryResearchTaskJobRepository,
  createInMemoryResearchTaskPartialResultRepository,
  createResearchTaskJobStateMachine,
} from "./research-task-job";
import {
  createInMemoryResearchTaskProgressRepository,
  createResearchTaskProgressPublisher,
} from "./research-task-progress";

const startInput = {
  knowledgeSpaceId: "space-1",
  permissionSnapshot: {
    accessChannel: "interactive" as const,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
    revision: 1,
  },
  query: "Track supplier risk posture",
  subjectId: "subject-1",
  tenantId: "tenant-1",
};

function createProgress() {
  const repository = createInMemoryResearchTaskProgressRepository({
    maxEvents: 100,
    maxListLimit: 100,
    maxSubscribers: 10,
  });

  return {
    listEvents: (researchTaskJobId: string) =>
      repository.list({ limit: 100, researchTaskJobId, tenantId: "tenant-1" }),
    progress: createResearchTaskProgressPublisher({ repository }),
  };
}

describe("research task job state machine coverage", () => {
  it("rejects non-positive state machine bounds", () => {
    const base = {
      generateId: () => "job-1",
      jobs: new FakeJobQueue(),
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 1 }),
    };

    expect(() => createResearchTaskJobStateMachine({ ...base, maxQueryBytes: 0 })).toThrow(
      "Research task job maxQueryBytes must be at least 1",
    );
    expect(() => createResearchTaskJobStateMachine({ ...base, maxCostEntries: 0 })).toThrow(
      "Research task job maxCostEntries must be at least 1",
    );
    expect(() => createResearchTaskJobStateMachine({ ...base, maxCostUsageBytes: 0 })).toThrow(
      "Research task job maxCostUsageBytes must be at least 1",
    );
  });

  it("cancels without a reason and publishes progress without an error field", async () => {
    const queue = new FakeJobQueue();
    const { listEvents, progress } = createProgress();
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "job-cancel",
      jobs: queue,
      now: () => 1_000,
      progress,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 5 }),
    });
    const job = await machine.start(startInput);

    const canceled = await machine.cancel(job.id);

    expect(canceled.stage).toBe("canceled");
    expect(canceled.error).toBeUndefined();
    expect(queue.canceled).toEqual([{ jobId: job.queueJobId }]);
    const events = await listEvents(job.id);
    expect(events.items.map((event) => [event.type, event.payload])).toEqual([
      ["research_task.started", {}],
      ["research_task.canceled", {}],
    ]);
  });

  it("cancels with a reason and includes the reason in the progress payload", async () => {
    const { listEvents, progress } = createProgress();
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "job-cancel-reason",
      jobs: new FakeJobQueue(),
      now: () => 1_000,
      progress,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 5 }),
    });
    const job = await machine.start(startInput);

    const canceled = await machine.cancel(job.id, "operator canceled");

    expect(canceled.error).toBe("operator canceled");
    const events = await listEvents(job.id);
    expect(events.items.at(-1)).toMatchObject({
      payload: { reason: "operator canceled" },
      type: "research_task.canceled",
    });
  });

  it("publishes cancellation progress when a recorded cost exhausts the budget", async () => {
    const queue = new FakeJobQueue();
    const { listEvents, progress } = createProgress();
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "job-budget",
      jobs: queue,
      now: () => 2_000,
      progress,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 5 }),
    });
    const job = await machine.start({ ...startInput, budgetUsd: 0.25 });

    const updated = await machine.recordCost(job.id, {
      costUsd: 0.5,
      provider: "llm",
      step: "planning",
    });

    expect(updated).toMatchObject({
      cost: { budgetExceeded: true, budgetUsd: 0.25, totalUsd: 0.5 },
      error: "Research task budget exhausted",
      stage: "canceled",
    });
    expect(updated.cost.entries[0]?.usage).toEqual({});
    const events = await listEvents(job.id);
    expect(events.items.at(-1)).toMatchObject({
      payload: { reason: "Research task budget exhausted" },
      type: "research_task.canceled",
    });
  });

  it("returns the paused job unchanged when pause is repeated and rejects blank reasons", async () => {
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "job-pause",
      jobs: new FakeJobQueue(),
      now: () => 3_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 5 }),
    });
    const job = await machine.start(startInput);

    await expect(machine.pause(job.id, { reason: "   " })).rejects.toThrow(
      "Research task job pause reason is required",
    );

    const paused = await machine.pause(job.id, { reason: "backpressure" });
    const pausedAgain = await machine.pause(job.id, { reason: "backpressure again" });

    expect(paused.stage).toBe("paused");
    expect(pausedAgain).toEqual(paused);
  });

  it("resumes a paused job without a recorded pause stage from queued", async () => {
    const queue = new FakeJobQueue();
    const repository = createInMemoryResearchTaskJobRepository({ maxJobs: 5 });
    await repository.create(pausedJobWithoutPauseStage());
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "unused",
      jobs: queue,
      now: () => 4_000,
      repository,
    });

    const resumed = await machine.resume("job-paused");

    expect(resumed.stage).toBe("queued");
    expect(resumed.pausedAt).toBeUndefined();
    expect(queue.enqueued[0]).toMatchObject({
      payload: { researchTaskJobId: "job-paused" },
    });
  });

  it("rejects repository updates for unknown jobs", async () => {
    const repository = createInMemoryResearchTaskJobRepository({ maxJobs: 5 });

    await expect(repository.update(pausedJobWithoutPauseStage())).rejects.toThrow(
      "Research task job job-paused not found",
    );
  });

  it("validates start input scope, budget, and limits", async () => {
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "job-start",
      jobs: new FakeJobQueue(),
      now: () => 5_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 5 }),
    });

    await expect(machine.start({ ...startInput, knowledgeSpaceId: " " })).rejects.toThrow(
      "Research task job knowledgeSpaceId is required",
    );
    await expect(machine.start({ ...startInput, subjectId: " " })).rejects.toThrow(
      "Research task job subjectId is required",
    );
    await expect(machine.start({ ...startInput, budgetUsd: -1 })).rejects.toThrow(
      "Research task budgetUsd must be a non-negative finite number",
    );
    await expect(machine.start({ ...startInput, mode: "invalid" as "research" })).rejects.toThrow(
      "Research task mode is invalid",
    );
    await expect(machine.start({ ...startInput, topK: 0 })).rejects.toThrow(
      "Research task topK must be at least 1",
    );
    await expect(machine.start({ ...startInput, limits: { maxToolCalls: 0 } })).rejects.toThrow(
      "Research task limit maxToolCalls must be at least 1",
    );

    const emptyLimits = await machine.start({ ...startInput, limits: {} });
    expect(emptyLimits.limits).toBeUndefined();

    const boundedLimits = await machine.start({
      ...startInput,
      limits: { maxToolCalls: 3 },
      query: "A second bounded task",
    });
    expect(boundedLimits.limits).toEqual({ maxToolCalls: 3 });
  });
});

describe("research task partial result repository coverage", () => {
  it("requires non-blank scope fields on append", async () => {
    const repository = createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 10,
      maxResults: 10,
    });

    await expect(
      repository.append({
        evidenceBundle: evidenceBundle("018f0d60-7a49-7cc2-9c1b-5b36f18f6a01"),
        knowledgeSpaceId: "space-1",
        researchTaskJobId: "job-1",
        tenantId: "   ",
      }),
    ).rejects.toThrow("Research task partial result tenantId is required");
  });

  it("validates list limit and scope identifiers", async () => {
    const repository = createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 10,
      maxResults: 10,
    });

    await expect(
      repository.list({ limit: 0, researchTaskJobId: "job-1", tenantId: "tenant-1" }),
    ).rejects.toThrow("Research task partial result list limit must be at least 1");
    await expect(
      repository.list({ limit: 1, researchTaskJobId: "  ", tenantId: "tenant-1" }),
    ).rejects.toThrow("Research task partial result researchTaskJobId is required");
    await expect(
      repository.list({ limit: 1, researchTaskJobId: "job-1", tenantId: "  " }),
    ).rejects.toThrow("Research task partial result tenantId is required");
  });
});

function pausedJobWithoutPauseStage(): ResearchTaskJob {
  return {
    cost: { entries: [], totalUsd: 0 },
    createdAt: 1_000,
    executionAttempts: 0,
    id: "job-paused",
    knowledgeSpaceId: "space-1",
    metadata: {},
    pausedAt: 900,
    maxExecutionAttempts: 5,
    permissionSnapshot: startInput.permissionSnapshot,
    query: "resume me",
    queueJobId: "queue-0",
    rowVersion: 1,
    stage: "paused",
    subjectId: "subject-1",
    tenantId: "tenant-1",
    updatedAt: 1_000,
  };
}

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

function evidenceBundle(id: string) {
  return {
    createdAt: "2026-05-12T15:00:00.000Z",
    id,
    items: [],
    missingEvidence: [],
    query: "research partials",
    state: "partial" as const,
  };
}
