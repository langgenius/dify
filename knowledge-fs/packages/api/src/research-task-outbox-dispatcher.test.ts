import { describe, expect, it } from "vitest";

import type { ResearchTaskOutboxEvent } from "./research-task-durable-repository";
import { createResearchTaskOutboxDispatcher } from "./research-task-outbox-dispatcher";

describe("research task outbox dispatcher", () => {
  it("dispatches an idempotent jobId-only envelope and binds the queue delivery", async () => {
    const event = outboxEvent();
    const enqueued: unknown[] = [];
    const marked: unknown[] = [];
    const dispatcher = createResearchTaskOutboxDispatcher({
      generateLockToken: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
      intervalMs: 1_000,
      jobs: {
        enqueue: async (input) => {
          enqueued.push(input);
          return {
            attempts: 0,
            createdAt: 1_000,
            id: "queue-1",
            payload: input.payload,
            status: "queued",
            type: input.type,
          };
        },
      },
      lockMs: 30_000,
      maxBatchSize: 10,
      maxDispatchAttempts: 5,
      now: () => 1_000,
      repository: {
        claimOutbox: async () => [event],
        markOutboxDispatched: async (input) => {
          marked.push(input);
          return { ...event, queueJobId: input.queueJobId, status: "dispatched" };
        },
        releaseOutbox: async () => {
          throw new Error("Unexpected outbox release");
        },
      },
      workerId: "research-dispatcher-1",
    });

    await expect(dispatcher.tick()).resolves.toEqual({ dispatched: 1, failed: 0, leased: 1 });
    expect(enqueued).toEqual([
      {
        idempotencyKey: event.idempotencyKey,
        payload: { researchTaskJobId: event.researchTaskJobId },
        type: "research.task",
      },
    ]);
    expect(marked).toEqual([
      {
        deliveredAt: 1_000,
        lockToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
        now: 1_000,
        outboxId: event.id,
        queueJobId: "queue-1",
      },
    ]);
  });

  it("releases a failed delivery with bounded backoff", async () => {
    const event = { ...outboxEvent(), dispatchAttempts: 2 };
    const released: unknown[] = [];
    const dispatcher = createResearchTaskOutboxDispatcher({
      generateLockToken: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
      initialRetryDelayMs: 100,
      intervalMs: 1_000,
      jobs: { enqueue: async () => Promise.reject(new Error("broker unavailable")) },
      lockMs: 30_000,
      maxBatchSize: 10,
      maxDispatchAttempts: 5,
      maxRetryDelayMs: 1_000,
      now: () => 1_000,
      repository: {
        claimOutbox: async () => [event],
        markOutboxDispatched: async () => null,
        releaseOutbox: async (input) => {
          released.push(input);
          return { ...event, status: "pending" };
        },
      },
      workerId: "research-dispatcher-1",
    });

    await expect(dispatcher.tick()).resolves.toEqual({ dispatched: 0, failed: 1, leased: 1 });
    expect(released).toEqual([
      {
        availableAt: 1_200,
        deadLetter: false,
        error: "broker unavailable",
        lockToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
        now: 1_000,
        outboxId: event.id,
      },
    ]);
  });
});

function outboxEvent(): ResearchTaskOutboxEvent {
  return {
    availableAt: 1_000,
    createdAt: 1_000,
    deliveryRevision: 1,
    dispatchAttempts: 1,
    eventType: "research.task",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
    idempotencyKey: "research.task:tenant-1:space-1:job-1:1",
    lockedBy: "research-dispatcher-1",
    lockedUntil: 31_000,
    lockToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
    payload: { researchTaskJobId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02" },
    researchTaskJobId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
    schemaVersion: 1,
    status: "dispatching",
    updatedAt: 1_000,
  };
}
