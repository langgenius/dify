import { describe, expect, it } from "vitest";

import {
  type PersistPageIndexFindabilityEvaluationInput,
  createInMemoryPageIndexFindabilityRepository,
} from "./page-index-findability-repository";

describe("PageIndex findability repository", () => {
  it("returns only the exact published generation route", async () => {
    const repository = createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 });
    await repository.persist(evaluation({ generationId: generation(1), status: "failed" }));

    const routes = await repository.getManyRoutes({
      documents: [
        { documentAssetId: uuid(3), generationId: generation(1) },
        { documentAssetId: uuid(3), generationId: generation(2) },
      ],
      knowledgeSpaceId: uuid(2),
      limit: 2,
      tenantId: "tenant-1",
    });

    expect(routes).toEqual([
      {
        documentAssetId: uuid(3),
        generationId: generation(1),
        recommendedRoute: "hybrid",
        status: "failed",
      },
    ]);
  });

  it("queues at most one summary repair for a document version across evaluation generations", async () => {
    const repository = createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 10 });
    const first = await repository.persist(
      evaluation({ generationId: generation(1), requestSummaryRepair: true, status: "failed" }),
    );
    const second = await repository.persist(
      evaluation({ generationId: generation(2), requestSummaryRepair: true, status: "failed" }),
    );

    expect(first.summaryRepairState).toBe("queued");
    expect(second.summaryRepairState).toBe("not-requested");

    const [claimed] = await repository.claimSummaryRepairs({
      leaseExpiresAt: "2026-08-06T00:01:00.000Z",
      limit: 10,
      now: "2026-08-06T00:00:00.000Z",
      workerId: "worker-1",
    });
    expect(claimed).toMatchObject({
      documentAssetId: uuid(3),
      lockToken: expect.any(String),
      summaryRepairAttempts: 1,
      summaryRepairState: "leased",
    });
    if (!claimed?.lockToken) throw new Error("expected repair claim");
    await repository.completeSummaryRepair({
      id: claimed.id,
      lockToken: claimed.lockToken,
      now: "2026-08-06T00:00:01.000Z",
    });
    const replayed = await repository.persist(
      evaluation({ generationId: generation(1), requestSummaryRepair: true, status: "failed" }),
    );
    expect(replayed.evaluation.summaryRepairRequested).toBe(true);
    expect(replayed.summaryRepairState).toBe("dispatched");
    expect(
      await repository.claimSummaryRepairs({
        leaseExpiresAt: "2026-08-06T00:02:00.000Z",
        limit: 10,
        now: "2026-08-06T00:01:00.000Z",
        workerId: "worker-2",
      }),
    ).toEqual([]);
  });

  it("requeues, reclaims expired leases, rejects stale owners, and terminates repair", async () => {
    let lock = 20;
    const repository = createInMemoryPageIndexFindabilityRepository({
      generateLockToken: () => uuid(lock++),
      maxEvaluations: 10,
    });
    const persisted = await repository.persist(
      evaluation({ generationId: generation(1), requestSummaryRepair: true, status: "failed" }),
    );
    const [first] = await repository.claimSummaryRepairs({
      leaseExpiresAt: "2026-08-06T00:01:00.000Z",
      limit: 1,
      now: "2026-08-06T00:00:00.000Z",
      workerId: "worker-1",
    });
    if (!first?.lockToken) throw new Error("expected first lease");
    await expect(
      repository.completeSummaryRepair({
        id: uuid(99),
        lockToken: first.lockToken,
        now: first.updatedAt,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.completeSummaryRepair({ id: first.id, lockToken: uuid(98), now: first.updatedAt }),
    ).resolves.toBeNull();

    const [reclaimed] = await repository.claimSummaryRepairs({
      leaseExpiresAt: "2026-08-06T00:03:00.000Z",
      limit: 1,
      now: "2026-08-06T00:02:00.000Z",
      workerId: "worker-2",
    });
    expect(reclaimed).toMatchObject({ id: persisted.id, summaryRepairAttempts: 2 });
    if (!reclaimed?.lockToken) throw new Error("expected reclaimed lease");

    const retried = await repository.failSummaryRepair({
      error: "temporary failure",
      id: reclaimed.id,
      lockToken: reclaimed.lockToken,
      now: "2026-08-06T00:02:01.000Z",
      retryAt: "2026-08-06T00:04:00.000Z",
    });
    expect(retried).toMatchObject({
      availableAt: "2026-08-06T00:04:00.000Z",
      summaryRepairState: "queued",
    });
    await expect(
      repository.claimSummaryRepairs({
        leaseExpiresAt: "2026-08-06T00:04:00.000Z",
        limit: 1,
        now: "2026-08-06T00:03:00.000Z",
        workerId: "worker-3",
      }),
    ).resolves.toEqual([]);
    const [third] = await repository.claimSummaryRepairs({
      leaseExpiresAt: "2026-08-06T00:05:00.000Z",
      limit: 1,
      now: "2026-08-06T00:04:00.000Z",
      workerId: "worker-3",
    });
    if (!third?.lockToken) throw new Error("expected third lease");
    await expect(
      repository.failSummaryRepair({
        error: "terminal failure",
        id: third.id,
        lockToken: third.lockToken,
        now: "2026-08-06T00:04:01.000Z",
      }),
    ).resolves.toMatchObject({ summaryRepairState: "failed" });
    await expect(
      repository.failSummaryRepair({
        error: "stale",
        id: third.id,
        lockToken: third.lockToken,
        now: "2026-08-06T00:04:02.000Z",
      }),
    ).resolves.toBeNull();

    const replayed = await repository.persist(
      evaluation({ generationId: generation(1), requestSummaryRepair: true, status: "failed" }),
    );
    expect(replayed).toMatchObject({
      summaryRepairAttempts: 3,
      summaryRepairError: "terminal failure",
      summaryRepairState: "failed",
    });
  });

  it("validates limits, lease bounds, routing scope, and repository capacity", async () => {
    expect(() => createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 0 })).toThrow(
      "maxEvaluations must be a positive integer",
    );
    const repository = createInMemoryPageIndexFindabilityRepository({ maxEvaluations: 1 });
    await repository.persist(evaluation({ generationId: generation(1), status: "passed" }));
    await expect(
      repository.persist(evaluation({ generationId: generation(2), status: "passed" })),
    ).rejects.toThrow("maxEvaluations=1 exceeded");
    await expect(
      repository.getManyRoutes({
        documents: [
          { documentAssetId: uuid(3), generationId: generation(1) },
          { documentAssetId: uuid(3), generationId: generation(2) },
        ],
        knowledgeSpaceId: uuid(2),
        limit: 1,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("route input exceeds limit=1");
    await expect(
      repository.getManyRoutes({
        documents: [{ documentAssetId: uuid(3), generationId: generation(1) }],
        knowledgeSpaceId: uuid(2),
        limit: 1,
        tenantId: "other-tenant",
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.getManyRoutes({
        documents: [{ documentAssetId: uuid(3), generationId: generation(1) }],
        knowledgeSpaceId: uuid(99),
        limit: 1,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.claimSummaryRepairs({
        leaseExpiresAt: "2026-08-06T00:00:00.000Z",
        limit: 1,
        now: "2026-08-06T00:00:00.000Z",
        workerId: "worker",
      }),
    ).rejects.toThrow("lease must expire after now");
  });
});

function evaluation(
  input: Partial<PersistPageIndexFindabilityEvaluationInput> & {
    readonly generationId: string;
    readonly status: "failed" | "not-evaluated" | "passed";
  },
): PersistPageIndexFindabilityEvaluationInput {
  return {
    compilationAttemptId: uuid(6),
    documentAssetId: uuid(3),
    documentVersion: 1,
    evaluatedAt: "2026-08-06T00:00:00.000Z",
    evaluation: {
      abstentionRate: input.status === "failed" ? 1 : 0,
      evaluatorVersion: "findability-v1",
      meanReciprocalRank: input.status === "passed" ? 1 : 0,
      model: { model: "reasoner-v1", pluginId: "plugin-1", provider: "provider-1" },
      pathRecallAtK: input.status === "passed" ? 1 : 0,
      promptVersion: "pageindex-layered-tree-search-v1",
      recallAtK: input.status === "passed" ? 1 : 0,
      recommendedRoute:
        input.status === "passed" ? "layered" : input.status === "failed" ? "hybrid" : "unchanged",
      sampleCount: input.status === "not-evaluated" ? 0 : 2,
      status: input.status,
      summaryRepairRequested: input.requestSummaryRepair ?? false,
      topK: 3,
    },
    generationId: input.generationId,
    knowledgeSpaceId: uuid(2),
    outlineId: uuid(4),
    publicationFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    requestSummaryRepair: input.requestSummaryRepair ?? false,
    tenantId: "tenant-1",
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function generation(value: number): string {
  return `10000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}
