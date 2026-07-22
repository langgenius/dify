import type { DatabaseExecutor } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type {
  DurableDeletionJob,
  DurableDeletionJobItem,
  DurableDeletionRepository,
} from "./durable-deletion-repository";
import { DurableDeletionPrimaryResidueDirtyError } from "./durable-deletion-repository";
import {
  type DurableDeletionTargetCapabilities,
  createDurableDeletionTargetProcessors,
} from "./durable-deletion-target-processors";

describe("durable deletion target processors", () => {
  it("does not inventory until scoped work is actually drained", async () => {
    const target = capabilities({
      quiesce: vi.fn(async () => ({ drained: false })),
    });
    const repository = repositoryFixture();
    const processor = processorFor(target, repository);

    const result = await processor.process({
      job: job({ checkpoint: "quiescing" }),
      signal: new AbortController().signal,
    });

    expect(result.disposition).toBe("waiting");
    expect(target.inventory).not.toHaveBeenCalled();
    expect(repository.appendInventory).not.toHaveBeenCalled();
  });

  it("atomically discards scan items and restarts when the final drain probe finds a late writer", async () => {
    const target = capabilities({
      quiesce: vi
        .fn<DurableDeletionTargetCapabilities["quiesce"]>()
        .mockResolvedValueOnce({ drained: true })
        .mockResolvedValueOnce({ drained: false }),
    });
    const original = job({ checkpoint: "quiescing", inventoryComplete: true });
    const reset = job({
      checkpoint: "quiescing",
      inventoryComplete: false,
      rowVersion: original.rowVersion + 1,
      scanPhase: "restart-after-late-writer",
    });
    const repository = repositoryFixture({
      appendInventory: vi.fn(async () => reset),
    });
    const processor = processorFor(target, repository);

    const result = await processor.process({
      job: original,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ disposition: "waiting", job: reset });
    expect(repository.appendInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        inventoryComplete: false,
        items: [],
        resetExistingInventory: true,
        scanPhase: "restart-after-late-writer",
      }),
    );
    expect(target.excludeTargetFromPublishedHead).not.toHaveBeenCalled();
  });

  it("runs primary deletion through the repository completion transaction and exact lease fence", async () => {
    const transaction: DatabaseExecutor = { execute: vi.fn() };
    const target = capabilities();
    const running = job({ checkpoint: "deleting_primary_data", rowVersion: 17 });
    const completed = job({
      checkpoint: "completed",
      completedAt: "2026-07-14T12:01:00.000Z",
      inventoryComplete: true,
      leaseExpiresAt: undefined,
      leaseToken: undefined,
      rowVersion: 18,
      runState: "succeeded",
    });
    const completeJob = vi.fn(
      async (input: Parameters<DurableDeletionRepository["completeJob"]>[0]) => {
        const proof = await input.deleteAndProbePrimaryData({ job: running, transaction });
        expect(proof).toEqual({ clean: true });
        return completed;
      },
    );
    const repository = repositoryFixture({ completeJob });
    const processor = processorFor(target, repository);

    await expect(
      processor.process({ job: running, signal: new AbortController().signal }),
    ).resolves.toEqual({ disposition: "completed", job: completed });
    expect(target.deletePrimaryData).toHaveBeenCalledWith(
      expect.objectContaining({
        job: running,
        leaseFence: {
          deletionJobId: running.id,
          expectedRowVersion: 17,
          leaseToken: running.leaseToken,
        },
        transaction,
      }),
    );
  });

  it("rewinds a dirty final proof to quiescing so late-writer residue converges", async () => {
    const running = job({ checkpoint: "deleting_primary_data", rowVersion: 17 });
    const reconciled = job({
      checkpoint: "quiescing",
      inventoryComplete: false,
      rowVersion: 18,
      scanPhase: "reconcile-after-dirty-primary",
    });
    const reconcileDirtyPrimary = vi.fn(async () => reconciled);
    const repository = repositoryFixture({
      completeJob: vi.fn(async () => {
        throw new DurableDeletionPrimaryResidueDirtyError();
      }),
      reconcileDirtyPrimary,
    });
    const result = await processorFor(capabilities(), repository).process({
      job: running,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ disposition: "progressed", job: reconciled });
    expect(reconcileDirtyPrimary).toHaveBeenCalledWith({
      deletionJobId: running.id,
      expectedRowVersion: 17,
      leaseToken: running.leaseToken,
      now: "2026-07-14T12:00:00.000Z",
    });
  });

  it("does not ask the runtime to fail a job that an item dead-letter already failed atomically", async () => {
    const item = deletionItem({ attempts: 2, maxAttempts: 3 });
    const target = capabilities({
      executeExternalItem: vi.fn(async () => {
        throw new Error("object store denied deletion");
      }),
    });
    const scheduleItemRetry = vi.fn(async () => ({
      ...item,
      attempts: 3,
      completedAt: "2026-07-14T12:00:01.000Z",
      rowVersion: 2,
      status: "dead" as const,
    }));
    const repository = repositoryFixture({
      claimItems: vi.fn(async () => [item]),
      scheduleItemRetry,
    });
    const processor = createDurableDeletionTargetProcessors({
      classifyItemError: () => ({
        code: "OBJECT_DELETE_DENIED",
        message: "denied",
        retryable: true,
      }),
      documentAsset: target,
      inventoryPageSize: 10,
      itemBatchSize: 5,
      knowledgeSpace: target,
      now: () => Date.parse("2026-07-14T12:00:00.000Z"),
      repository,
      source: target,
    });

    const result = await processor.process({
      job: job({ checkpoint: "deleting_objects" }),
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      disposition: "failed_persisted",
      error: { code: "OBJECT_DELETE_DENIED" },
    });
    expect(scheduleItemRetry).toHaveBeenCalledWith(expect.objectContaining({ deadLetter: true }));
  });

  it("validates numeric options and required target capability methods", () => {
    for (const field of [
      { initialRetryDelayMs: 0 },
      { inventoryPageSize: 0 },
      { itemBatchSize: 0 },
      { maxRetryDelayMs: 0 },
    ]) {
      expect(() =>
        createDurableDeletionTargetProcessors({
          documentAsset: capabilities(),
          inventoryPageSize: 10,
          itemBatchSize: 5,
          knowledgeSpace: capabilities(),
          repository: repositoryFixture(),
          source: capabilities(),
          ...field,
        }),
      ).toThrow("must be a positive integer");
    }
    expect(() =>
      createDurableDeletionTargetProcessors({
        documentAsset: {} as never,
        inventoryPageSize: 10,
        itemBatchSize: 5,
        knowledgeSpace: capabilities(),
        repository: repositoryFixture(),
        source: capabilities(),
      }),
    ).toThrow("documentAsset.deleteDerivedDataPage is required");
    expect(() =>
      createDurableDeletionTargetProcessors({
        documentAsset: capabilities(),
        inventoryPageSize: 10,
        itemBatchSize: 5,
        knowledgeSpace: capabilities(),
        logicalDocument: capabilities(),
        repository: repositoryFixture(),
        source: capabilities(),
      }),
    ).not.toThrow();
  });

  it("advances requested and fully quiesced jobs and accepts completed jobs", async () => {
    const target = capabilities();
    const advanced = job({ checkpoint: "quiescing", rowVersion: 9 });
    const advanceCheckpoint = vi
      .fn<DurableDeletionRepository["advanceCheckpoint"]>()
      .mockResolvedValue(advanced);
    const repository = repositoryFixture({
      advanceCheckpoint,
    });
    const processor = processorFor(target, repository);
    await expect(
      processor.process({
        job: job({ checkpoint: "requested" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ disposition: "progressed", job: advanced });

    const deleting = job({
      checkpoint: "deleting_objects",
      inventoryComplete: true,
      rowVersion: 10,
    });
    advanceCheckpoint.mockResolvedValueOnce(deleting);
    await expect(
      processor.process({
        job: job({ checkpoint: "quiescing", inventoryComplete: true }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ disposition: "progressed", job: deleting });

    const completed = job({ checkpoint: "completed" });
    await expect(
      processor.process({ job: completed, signal: new AbortController().signal }),
    ).resolves.toEqual({ disposition: "completed", job: completed });
  });

  it("persists cursor-bearing inventory pages and validates their global ordinals", async () => {
    const current = job({
      checkpoint: "quiescing",
      inventoryComplete: false,
      rowVersion: 9,
      scanCursor: "next",
      scanPhase: "objects",
    });
    const target = capabilities({
      inventory: vi.fn(async () => ({
        complete: false,
        items: [
          {
            idempotencyKey: "object-2",
            kind: "object" as const,
            maxAttempts: 3,
            objectKey: "key",
            ordinal: 2,
          },
        ],
        nextCursor: "next",
        scanPhase: "objects",
      })),
    });
    const appendInventory = vi.fn(async () => current);
    const processor = processorFor(target, repositoryFixture({ appendInventory }));
    await expect(
      processor.process({
        job: job({ checkpoint: "quiescing", scanCursor: "cursor", scanPhase: "objects" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ disposition: "progressed", job: current });
    expect(target.inventory).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor", scanPhase: "objects" }),
    );
    expect(appendInventory).toHaveBeenCalledWith(expect.objectContaining({ scanCursor: "next" }));

    for (const items of [
      [
        {
          idempotencyKey: "zero",
          kind: "object" as const,
          maxAttempts: 3,
          objectKey: "key",
          ordinal: 0,
        },
      ],
      [
        {
          idempotencyKey: "a",
          kind: "object" as const,
          maxAttempts: 3,
          objectKey: "a",
          ordinal: 1,
        },
        {
          idempotencyKey: "b",
          kind: "object" as const,
          maxAttempts: 3,
          objectKey: "b",
          ordinal: 1,
        },
      ],
    ]) {
      const invalid = processorFor(
        capabilities({
          inventory: vi.fn(async () => ({ complete: false, items, scanPhase: "objects" })),
        }),
        repositoryFixture(),
      );
      await expect(
        invalid.process({
          job: job({ checkpoint: "quiescing" }),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("ordinal");
    }
  });

  it("completes object items, advances empty batches, and schedules cooperative retry", async () => {
    const item = deletionItem();
    const completedItem = { ...item, status: "completed" as const };
    const repository = repositoryFixture({
      claimItems: vi.fn(async () => [item]),
      completeItem: vi.fn(async () => completedItem),
    });
    await expect(
      processorFor(capabilities(), repository).process({
        job: job({ checkpoint: "deleting_objects" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ disposition: "progressed" });

    const derived = job({ checkpoint: "deleting_derived_data", rowVersion: 9 });
    await expect(
      processorFor(
        capabilities(),
        repositoryFixture({ advanceCheckpoint: vi.fn(async () => derived) }),
      ).process({
        job: job({ checkpoint: "deleting_objects" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ disposition: "progressed", job: derived });

    const retryRepository = repositoryFixture({
      claimItems: vi.fn(async () => [item]),
      scheduleItemRetry: vi.fn(async () => ({ ...item, attempts: 1, rowVersion: 2 })),
    });
    await expect(
      processorFor(
        capabilities({
          executeExternalItem: vi.fn(async () => {
            throw new Error("temporary");
          }),
        }),
        retryRepository,
      ).process({
        job: job({ checkpoint: "deleting_objects" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ attemptBudget: "failure", disposition: "waiting" });
  });

  it("handles all derived-page outcomes and propagates unexpected primary errors", async () => {
    const primary = job({ checkpoint: "deleting_primary_data", rowVersion: 9 });
    await expect(
      processorFor(
        capabilities({
          deleteDerivedDataPage: vi.fn(async () => ({ complete: true, deleted: 1 })),
        }),
        repositoryFixture({ advanceCheckpoint: vi.fn(async () => primary) }),
      ).process({
        job: job({ checkpoint: "deleting_derived_data" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ disposition: "progressed", job: primary });
    await expect(
      processorFor(
        capabilities({
          deleteDerivedDataPage: vi.fn(async () => ({ complete: false, deleted: 1 })),
        }),
        repositoryFixture(),
      ).process({
        job: job({ checkpoint: "deleting_derived_data" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ disposition: "progressed" });
    await expect(
      processorFor(
        capabilities({
          deleteDerivedDataPage: vi.fn(async () => ({ complete: false, deleted: 0 })),
        }),
        repositoryFixture(),
      ).process({
        job: job({ checkpoint: "deleting_derived_data" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ attemptBudget: "cooperative", disposition: "waiting" });

    const failure = new Error("database failed");
    await expect(
      processorFor(
        capabilities(),
        repositoryFixture({
          completeJob: vi.fn(async () => {
            throw failure;
          }),
        }),
      ).process({
        job: job({ checkpoint: "deleting_primary_data" }),
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(failure);
  });

  it("rejects stale running jobs and lease losses from repository CAS calls", async () => {
    const stale = { ...job(), leaseToken: undefined } as never;
    await expect(
      processorFor(capabilities(), repositoryFixture()).process({
        job: stale,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: "DurableDeletionProcessorLeaseLostError" });
    await expect(
      processorFor(capabilities(), repositoryFixture()).process({
        job: job({ checkpoint: "requested" }),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: "DurableDeletionProcessorLeaseLostError" });
  });
});

function processorFor(
  target: DurableDeletionTargetCapabilities,
  repository: ReturnType<typeof repositoryFixture>,
) {
  return createDurableDeletionTargetProcessors({
    documentAsset: target,
    initialRetryDelayMs: 100,
    inventoryPageSize: 10,
    itemBatchSize: 5,
    knowledgeSpace: target,
    now: () => Date.parse("2026-07-14T12:00:00.000Z"),
    repository,
    source: target,
  });
}

function capabilities(
  overrides: Partial<DurableDeletionTargetCapabilities> = {},
): DurableDeletionTargetCapabilities {
  return {
    deleteDerivedDataPage: vi.fn(async () => ({ complete: true, deleted: 0 })),
    deletePrimaryData: vi.fn(async () => ({ clean: true })),
    excludeTargetFromPublishedHead: vi.fn(async () => undefined),
    executeExternalItem: vi.fn(async () => undefined),
    inventory: vi.fn(async () => ({
      complete: true,
      items: [],
      scanPhase: "complete",
    })),
    quiesce: vi.fn(async () => ({ drained: true })),
    ...overrides,
  };
}

function repositoryFixture(
  overrides: Partial<
    Pick<
      DurableDeletionRepository,
      | "advanceCheckpoint"
      | "appendInventory"
      | "claimItems"
      | "completeItem"
      | "completeJob"
      | "reconcileDirtyPrimary"
      | "scheduleItemRetry"
    >
  > = {},
) {
  return {
    advanceCheckpoint: vi.fn(async () => null),
    appendInventory: vi.fn(async () => null),
    claimItems: vi.fn(async () => []),
    completeItem: vi.fn(async () => null),
    completeJob: vi.fn(async () => null),
    reconcileDirtyPrimary: vi.fn(async () => null),
    scheduleItemRetry: vi.fn(async () => null),
    ...overrides,
  };
}

function job(overrides: Partial<DurableDeletionJob> = {}): DurableDeletionJob {
  return {
    accessChannel: "interactive",
    checkpoint: "quiescing",
    createdAt: "2026-07-14T12:00:00.000Z",
    deleteMode: "cascade",
    executionAttempts: 1,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    idempotencyKey: "delete-a",
    inventoryComplete: false,
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    leaseExpiresAt: "2026-07-14T12:05:00.000Z",
    leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d00",
    maxExecutionAttempts: 10,
    permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
    permissionSnapshotRevision: 1,
    requestFingerprint: "a".repeat(64),
    requestedBySubjectId: "user-a",
    rowVersion: 8,
    runState: "running",
    targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
    targetRevision: 3,
    targetType: "document_asset",
    tenantId: "tenant-a",
    updatedAt: "2026-07-14T12:00:00.000Z",
    workerId: "worker-a",
    ...overrides,
  };
}

function deletionItem(overrides: Partial<DurableDeletionJobItem> = {}): DurableDeletionJobItem {
  return {
    attempts: 0,
    createdAt: "2026-07-14T12:00:00.000Z",
    deletionJobId: job().id,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03",
    idempotencyKey: "object-a",
    kind: "object",
    maxAttempts: 3,
    objectKey: "tenant-a/space-a/object-a",
    ordinal: 1,
    payloadDigest: "b".repeat(64),
    rowVersion: 1,
    status: "pending",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}
