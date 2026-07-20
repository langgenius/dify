import { describe, expect, it, vi } from "vitest";

import {
  createDatabasePollingDurableDeletionWakeSink,
  createDurableDeletionOutboxDispatcher,
} from "./durable-deletion-outbox-dispatcher";
import type {
  DurableDeletionOutboxEvent,
  DurableDeletionRepository,
} from "./durable-deletion-repository";

describe("durable deletion outbox dispatcher", () => {
  it("uses a stable DB-poll wake id and atomically queues the DB job without an external queue", async () => {
    const event = outboxEvent();
    const wakeSink = createDatabasePollingDurableDeletionWakeSink();
    const repository = repositoryFixture({
      claimOutbox: vi.fn(async () => [event]),
      markOutboxDispatched: vi.fn(async () => ({
        ...event,
        queueJobId: `db-poll:${event.id}:${event.deliveryRevision}`,
        status: "dispatched" as const,
      })),
    });
    const dispatcher = dispatcherFor(repository, wakeSink);

    await expect(dispatcher.tick()).resolves.toEqual({ dispatched: 1, failed: 0, leased: 1 });
    expect(repository.markOutboxDispatched).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxId: event.id,
        queueJobId: `db-poll:${event.id}:${event.deliveryRevision}`,
      }),
    );
    expect(repository.releaseOutbox).not.toHaveBeenCalled();
  });

  it("dead-letters the outbox and linked request after the final dispatch attempt", async () => {
    const event = outboxEvent({ dispatchAttempts: 3 });
    const repository = repositoryFixture({
      claimOutbox: vi.fn(async () => [event]),
      releaseOutbox: vi.fn(async () => ({ ...event, status: "dead" as const })),
    });
    const onError = vi.fn();
    const dispatcher = createDurableDeletionOutboxDispatcher({
      generateLockToken: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d09",
      initialRetryDelayMs: 100,
      intervalMs: 1_000,
      lockMs: 10_000,
      maxBatchSize: 5,
      maxDispatchAttempts: 3,
      now: () => Date.parse("2026-07-14T12:00:00.000Z"),
      onError,
      repository,
      wakeSink: {
        notify: vi.fn(async () => {
          throw new Error("wake failed");
        }),
      },
      workerId: "outbox-worker-a",
    });

    await expect(dispatcher.tick()).resolves.toEqual({ dispatched: 0, failed: 1, leased: 1 });
    expect(repository.releaseOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ deadLetter: true, error: "wake failed", outboxId: event.id }),
    );
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ outbox: event }));
  });

  it("releases the lease if the transactional dispatch fence is lost", async () => {
    const event = outboxEvent();
    const repository = repositoryFixture({
      claimOutbox: vi.fn(async () => [event]),
      markOutboxDispatched: vi.fn(async () => null),
      releaseOutbox: vi.fn(async () => event),
    });

    const result = await dispatcherFor(
      repository,
      createDatabasePollingDurableDeletionWakeSink(),
    ).tick();

    expect(result).toEqual({ dispatched: 0, failed: 1, leased: 1 });
    expect(repository.releaseOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ deadLetter: false, outboxId: event.id }),
    );
  });
});

function dispatcherFor(
  repository: Pick<
    DurableDeletionRepository,
    "claimOutbox" | "markOutboxDispatched" | "releaseOutbox"
  >,
  wakeSink: ReturnType<typeof createDatabasePollingDurableDeletionWakeSink>,
) {
  return createDurableDeletionOutboxDispatcher({
    generateLockToken: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d09",
    initialRetryDelayMs: 100,
    intervalMs: 1_000,
    lockMs: 10_000,
    maxBatchSize: 5,
    maxDispatchAttempts: 3,
    now: () => Date.parse("2026-07-14T12:00:00.000Z"),
    repository,
    wakeSink,
    workerId: "outbox-worker-a",
  });
}

function repositoryFixture(
  overrides: Partial<
    Pick<DurableDeletionRepository, "claimOutbox" | "markOutboxDispatched" | "releaseOutbox">
  > = {},
) {
  return {
    claimOutbox: vi.fn(async () => []),
    markOutboxDispatched: vi.fn(async () => null),
    releaseOutbox: vi.fn(async () => null),
    ...overrides,
  };
}

function outboxEvent(
  overrides: Partial<DurableDeletionOutboxEvent> = {},
): DurableDeletionOutboxEvent {
  return {
    availableAt: "2026-07-14T12:00:00.000Z",
    createdAt: "2026-07-14T12:00:00.000Z",
    deletionJobId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    deliveryRevision: 2,
    dispatchAttempts: 1,
    eventType: "deletion.job",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d08",
    idempotencyKey: "deletion:job-a:2",
    lockedBy: "outbox-worker-a",
    lockedUntil: "2026-07-14T12:05:00.000Z",
    lockToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d09",
    payload: { deletionJobId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45" },
    requestFingerprint: "a".repeat(64),
    requestIdempotencyKey: "delete-a",
    schemaVersion: 1,
    status: "dispatching",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}
