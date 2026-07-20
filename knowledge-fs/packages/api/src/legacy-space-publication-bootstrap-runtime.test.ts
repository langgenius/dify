import { describe, expect, it } from "vitest";

import type {
  DocumentCompilationJob,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import type {
  LegacySpacePublicationBootstrap,
  LegacySpacePublicationBootstrapItem,
  LegacySpacePublicationBootstrapRepository,
} from "./legacy-space-publication-bootstrap";
import { createLegacySpacePublicationBootstrapRuntime } from "./legacy-space-publication-bootstrap-runtime";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const bootstrapId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const documentIds = [
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
] as const;
const attemptIds = [
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
] as const;

describe("legacy space publication bootstrap runtime", () => {
  it("rebuilds a frozen corpus sequentially and opens readiness only after final verification", async () => {
    let now = Date.parse("2026-07-14T12:00:00.000Z");
    const fixture = bootstrapRepositoryFixture();
    const compilation = compilationFixture(now);
    const runtime = createLegacySpacePublicationBootstrapRuntime({
      compilationJobs: compilation.stateMachine,
      generateLeaseToken: () => leaseToken,
      intervalMs: 1_000,
      leaseMs: 60_000,
      maxBatchSize: 1,
      now: () => {
        now += 1_000;
        return now;
      },
      repository: fixture.repository,
      workerId: "bootstrap-worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ claimed: 1, released: 1 });
    expect(fixture.isQueryReady()).toBe(false);
    expect(fixture.items()).toHaveLength(2);

    await expect(runtime.tick()).resolves.toMatchObject({
      claimed: 1,
      startedDocuments: 1,
    });
    expect(compilation.starts).toEqual([
      expect.objectContaining({
        bootstrapJobId: bootstrapId,
        documentAssetId: documentIds[0],
        version: 1,
      }),
    ]);

    compilation.publish(attemptIds[0]);
    // A per-document child has published an intermediate head, but the space latch remains shut.
    expect(compilation.hasPublishedChild()).toBe(true);
    expect(fixture.isQueryReady()).toBe(false);
    await runtime.tick();

    await runtime.tick();
    expect(compilation.starts.map((start) => start.documentAssetId)).toEqual(documentIds);
    expect(fixture.isQueryReady()).toBe(false);

    compilation.publish(attemptIds[1]);
    await runtime.tick();
    expect(fixture.snapshot().completedDocuments).toBe(2);
    expect(fixture.isQueryReady()).toBe(false);

    await expect(runtime.tick()).resolves.toMatchObject({ claimed: 1, completed: 1 });
    expect(fixture.snapshot()).toMatchObject({
      checkpoint: "published",
      completedDocuments: 2,
      runState: "succeeded",
      totalDocuments: 2,
    });
    expect(fixture.isQueryReady()).toBe(true);
    expect(fixture.items().map((item) => item.documentAssetId)).toEqual(documentIds);
    expect(fixture.items().every((item) => item.status === "succeeded")).toBe(true);
  });
});

function bootstrapRepositoryFixture() {
  let job: LegacySpacePublicationBootstrap = {
    checkpoint: "pending_snapshot",
    completedDocuments: 0,
    createdAt: "2026-07-14T12:00:00.000Z",
    id: bootstrapId,
    idempotencyKey: "legacy-space-publication-bootstrap-v1",
    knowledgeSpaceId,
    rowVersion: 0,
    runState: "queued",
    snapshotMetadata: { source: "migration-marker" },
    tenantId,
    totalDocuments: 0,
    updatedAt: "2026-07-14T12:00:00.000Z",
  };
  let items: LegacySpacePublicationBootstrapItem[] = [];

  const fenced = (input: { expectedRowVersion: number; jobId: string; leaseToken: string }) => {
    expect(input).toMatchObject({
      expectedRowVersion: job.rowVersion,
      jobId: job.id,
      leaseToken: job.leaseToken,
    });
  };
  const update = (
    patch: Partial<LegacySpacePublicationBootstrap>,
  ): LegacySpacePublicationBootstrap => {
    job = { ...job, ...patch };
    return structuredClone(job);
  };

  const repository = {
    beginVerification: async (input) => {
      fenced(input);
      expect(items.every((item) => item.status === "succeeded")).toBe(true);
      return update({ checkpoint: "verifying", rowVersion: job.rowVersion + 1 });
    },
    bindAttempt: async (input) => {
      fenced(input);
      items = items.map((item) =>
        item.documentAssetId === input.documentAssetId
          ? {
              ...item,
              compilationAttemptId: input.compilationAttemptId,
              status: "running" as const,
            }
          : item,
      );
      return update({ checkpoint: "rebuilding", rowVersion: job.rowVersion + 1 });
    },
    captureSnapshot: async (input) => {
      fenced(input);
      items = documentIds.map((documentAssetId, ordinal) => ({
        bootstrapId,
        createdAt: input.now,
        documentAssetId,
        documentSha256: String(ordinal + 1).repeat(64),
        documentVersion: 1,
        ordinal,
        status: "pending" as const,
        updatedAt: input.now,
      }));
      return update({
        checkpoint: "snapshot_captured",
        rowVersion: job.rowVersion + 1,
        totalDocuments: items.length,
      });
    },
    claim: async (input) => {
      if (job.runState !== "queued") {
        return [];
      }
      return [
        update({
          heartbeatAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
          leaseToken: input.leaseToken,
          rowVersion: job.rowVersion + 1,
          runState: "running",
          workerId: input.workerId,
        }),
      ];
    },
    complete: async (input) => {
      fenced(input);
      expect(job.checkpoint).toBe("verifying");
      expect(items.map((item) => item.documentAssetId)).toEqual(documentIds);
      return update({
        checkpoint: "published",
        completedAt: input.now,
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        rowVersion: job.rowVersion + 1,
        runState: "succeeded",
        workerId: undefined,
      });
    },
    fail: async () => null,
    getNextItem: async (input) => {
      fenced(input);
      return structuredClone(items.find((item) => item.status !== "succeeded") ?? null);
    },
    heartbeat: async (input) => {
      fenced(input);
      return update({
        heartbeatAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        rowVersion: job.rowVersion + 1,
      });
    },
    markItemSucceeded: async (input) => {
      fenced(input);
      items = items.map((item) =>
        item.documentAssetId === input.documentAssetId
          ? { ...item, status: "succeeded" as const }
          : item,
      );
      return update({
        completedDocuments: job.completedDocuments + 1,
        rowVersion: job.rowVersion + 1,
      });
    },
    release: async (input) => {
      fenced(input);
      return update({
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        rowVersion: job.rowVersion + 1,
        runState: "queued",
        workerId: undefined,
      });
    },
  } satisfies Pick<
    LegacySpacePublicationBootstrapRepository,
    | "beginVerification"
    | "bindAttempt"
    | "captureSnapshot"
    | "claim"
    | "complete"
    | "fail"
    | "getNextItem"
    | "heartbeat"
    | "markItemSucceeded"
    | "release"
  >;

  return {
    isQueryReady: () => job.runState === "succeeded",
    items: () => structuredClone(items),
    repository,
    snapshot: () => structuredClone(job),
  };
}

function compilationFixture(timestamp: number) {
  const jobs = new Map<string, DocumentCompilationJob>();
  const starts: Parameters<DocumentCompilationJobStateMachine["start"]>[0][] = [];
  const stateMachine = {
    get: async (id) => structuredClone(jobs.get(id) ?? null),
    start: async (input) => {
      starts.push(structuredClone(input));
      const id = attemptIds[starts.length - 1];
      if (!id) {
        throw new Error("Unexpected compilation start");
      }
      const job: DocumentCompilationJob = {
        createdAt: timestamp,
        documentAssetId: input.documentAssetId,
        id,
        knowledgeSpaceId: input.knowledgeSpaceId,
        runState: "dispatch_pending",
        stage: "queued",
        tenantId: input.tenantId,
        updatedAt: timestamp,
        version: input.version,
      };
      jobs.set(id, job);
      return structuredClone(job);
    },
  } as DocumentCompilationJobStateMachine;

  return {
    hasPublishedChild: () => [...jobs.values()].some((job) => job.stage === "published"),
    publish: (id: string) => {
      const current = jobs.get(id);
      if (!current) {
        throw new Error(`Unknown compilation attempt ${id}`);
      }
      jobs.set(id, { ...current, runState: "succeeded", stage: "published" });
    },
    starts,
    stateMachine,
  };
}
