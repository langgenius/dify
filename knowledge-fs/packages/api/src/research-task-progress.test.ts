import type { JobPayload } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createInMemoryResearchTaskJobRepository,
  createResearchTaskJobStateMachine,
} from "./research-task-job";
import {
  createInMemoryResearchTaskProgressRepository,
  createResearchTaskProgressPublisher,
} from "./research-task-progress";

describe("research task progress", () => {
  it("publishes bounded progress events from research task lifecycle changes", async () => {
    const dispatched: string[] = [];
    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 10,
      maxListLimit: 10,
      maxSubscribers: 2,
      now: () => "2026-05-12T20:00:00.000Z",
    });
    const publisher = createResearchTaskProgressPublisher({
      repository: progress,
      webhook: {
        dispatch: async (event) => {
          dispatched.push(`${event.type}:${event.stage}:${event.sequence}`);
        },
      },
    });
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-progress-1",
      jobs: new FakeJobQueue(),
      now: () => 20_000,
      progress: publisher,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });

    const job = await machine.start({
      knowledgeSpaceId: "space-1",
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        revision: 1,
      },
      query: "Track research progress",
      subjectId: "subject-1",
      tenantId: "tenant-1",
    });
    await machine.advance(job.id, "planning");
    await machine.pause(job.id, { reason: "Backpressure" });
    await machine.resume(job.id);
    await machine.fail(job.id, "Provider failed");

    const listed = await progress.list({
      limit: 10,
      researchTaskJobId: job.id,
      tenantId: "tenant-1",
    });

    expect(listed).toMatchObject({
      items: [
        { sequence: 1, stage: "queued", type: "research_task.started" },
        { sequence: 2, stage: "planning", type: "research_task.stage_changed" },
        { sequence: 3, stage: "paused", type: "research_task.paused" },
        { sequence: 4, stage: "planning", type: "research_task.resumed" },
        { sequence: 5, stage: "failed", type: "research_task.failed" },
      ],
    });
    await expect(
      progress.list({
        limit: 1,
        researchTaskJobId: job.id,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [{ sequence: 1 }],
      nextCursor: "1",
    });
    expect(dispatched).toEqual([
      "research_task.started:queued:1",
      "research_task.stage_changed:planning:2",
      "research_task.paused:paused:3",
      "research_task.resumed:planning:4",
      "research_task.failed:failed:5",
    ]);
  });

  it("does not block or fail a committed lifecycle mutation on webhook delivery", async () => {
    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 10,
      maxListLimit: 10,
      maxSubscribers: 2,
    });
    const neverDelivered = new Promise<void>(() => undefined);
    const machine = createResearchTaskJobStateMachine({
      generateId: () => "research-task-webhook-best-effort",
      jobs: new FakeJobQueue(),
      now: () => 20_000,
      progress: createResearchTaskProgressPublisher({
        repository: progress,
        webhook: { dispatch: () => neverDelivered },
      }),
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });

    const started = await Promise.race([
      machine.start({
        knowledgeSpaceId: "space-1",
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
          revision: 1,
        },
        query: "Do not wait for webhook",
        subjectId: "subject-1",
        tenantId: "tenant-1",
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 25)),
    ]);
    expect(started).not.toBeNull();
    if (!started) throw new Error("Lifecycle mutation waited for webhook delivery");

    const rejectingPublisher = createResearchTaskProgressPublisher({
      repository: progress,
      webhook: {
        dispatch: () => {
          throw new Error("webhook unavailable");
        },
      },
    });
    await expect(
      rejectingPublisher.publish(started, "research_task.stage_changed", {
        delivery: "best-effort",
      }),
    ).resolves.toMatchObject({ type: "research_task.stage_changed" });
  });

  it("streams live progress events to subscribers without leaking cross-tenant events", async () => {
    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 10,
      maxListLimit: 10,
      maxSubscribers: 2,
    });
    const subscription = progress.subscribe({
      researchTaskJobId: "research-task-progress-1",
      tenantId: "tenant-1",
    });
    const iterator = subscription[Symbol.asyncIterator]();

    await progress.append({
      knowledgeSpaceId: "space-1",
      payload: {},
      researchTaskJobId: "research-task-progress-1",
      stage: "planning",
      tenantId: "other-tenant",
      type: "research_task.stage_changed",
    });
    await progress.append({
      knowledgeSpaceId: "space-1",
      payload: { current: "retrieving" },
      researchTaskJobId: "research-task-progress-1",
      stage: "retrieving",
      tenantId: "tenant-1",
      type: "research_task.stage_changed",
    });

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        payload: { current: "retrieving" },
        sequence: 1,
        tenantId: "tenant-1",
      },
    });
    await iterator.return?.();

    const idleIterator = progress
      .subscribe({
        researchTaskJobId: "research-task-progress-idle",
        tenantId: "tenant-1",
      })
      [Symbol.asyncIterator]();
    const pending = idleIterator.next();
    await expect(idleIterator.return?.()).resolves.toMatchObject({ done: true });
    await expect(pending).resolves.toMatchObject({ done: true });
  });

  it("rejects unbounded progress storage, reads, and subscribers", async () => {
    expect(() =>
      createInMemoryResearchTaskProgressRepository({
        maxEvents: 0,
        maxListLimit: 10,
        maxSubscribers: 1,
      }),
    ).toThrow("Research task progress repository maxEvents must be at least 1");

    const validatingProgress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 2,
      maxListLimit: 1,
      maxSubscribers: 1,
    });
    await expect(
      validatingProgress.append({
        knowledgeSpaceId: " ",
        payload: {},
        researchTaskJobId: "research-task-progress-2",
        stage: "queued",
        tenantId: "tenant-1",
        type: "research_task.started",
      }),
    ).rejects.toThrow("Research task progress knowledgeSpaceId is required");

    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 1,
      maxListLimit: 1,
      maxSubscribers: 1,
    });
    await progress.append({
      knowledgeSpaceId: "space-1",
      payload: {},
      researchTaskJobId: "research-task-progress-1",
      stage: "queued",
      tenantId: "tenant-1",
      type: "research_task.started",
    });
    await expect(
      progress.append({
        knowledgeSpaceId: "space-1",
        payload: {},
        researchTaskJobId: "research-task-progress-1",
        stage: "planning",
        tenantId: "tenant-1",
        type: "research_task.stage_changed",
      }),
    ).rejects.toThrow("Research task progress repository maxEvents=1 exceeded");
    await expect(
      progress.list({
        cursor: "bad",
        limit: 1,
        researchTaskJobId: "research-task-progress-1",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Research task progress cursor is invalid");
    await expect(
      progress.list({
        limit: 2,
        researchTaskJobId: "research-task-progress-1",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Research task progress list limit exceeds maxListLimit=1");

    const first = progress.subscribe({
      researchTaskJobId: "research-task-progress-1",
      tenantId: "tenant-1",
    });
    expect(() =>
      progress.subscribe({
        researchTaskJobId: "research-task-progress-1",
        tenantId: "tenant-1",
      }),
    ).toThrow("Research task progress subscribers exceed maxSubscribers=1");
    await first[Symbol.asyncIterator]().return?.();
  });

  it("deduplicates publisher replay and subscribes from the last durable cursor", async () => {
    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 10,
      maxListLimit: 10,
      maxSubscribers: 2,
    });
    const input = {
      idempotencyKey: "task-1:revision-1:started",
      knowledgeSpaceId: "space-1",
      payload: {},
      researchTaskJobId: "task-1",
      stage: "queued" as const,
      tenantId: "tenant-1",
      type: "research_task.started" as const,
    };
    const first = await progress.append(input);
    await expect(progress.append(input)).resolves.toEqual(first);
    await expect(progress.append({ ...input, payload: { changed: true } })).rejects.toThrow(
      /reused with different event data/u,
    );

    const subscription = progress
      .subscribe({
        cursor: String(first.sequence),
        researchTaskJobId: "task-1",
        tenantId: "tenant-1",
      })
      [Symbol.asyncIterator]();
    await progress.append({
      knowledgeSpaceId: "space-1",
      researchTaskJobId: "task-1",
      stage: "planning",
      tenantId: "tenant-1",
      type: "research_task.stage_changed",
    });
    await expect(subscription.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 2, stage: "planning" },
    });
    await subscription.return?.();
  });
});

class FakeJobQueue {
  async cancel() {}
  async enqueue(input: { payload: JobPayload; type: string }) {
    return {
      attempts: 0,
      createdAt: 20_000,
      id: "queue-job-1",
      payload: input.payload,
      status: "queued" as const,
      type: input.type,
    };
  }
  async fail() {}
}
