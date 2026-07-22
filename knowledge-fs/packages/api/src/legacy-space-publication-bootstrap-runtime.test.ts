import { describe, expect, it, vi } from "vitest";

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

  it("validates runtime bounds and coalesces concurrent ticks", async () => {
    for (const options of [
      { intervalMs: 0, leaseMs: 1, maxBatchSize: 1, workerId: "worker" },
      { intervalMs: 1, leaseMs: 0, maxBatchSize: 1, workerId: "worker" },
      { intervalMs: 1, leaseMs: 1, maxBatchSize: 0, workerId: "worker" },
      { intervalMs: 1, leaseMs: 1, maxBatchSize: 1, workerId: " " },
    ]) {
      expect(() =>
        createLegacySpacePublicationBootstrapRuntime({
          compilationJobs: {} as never,
          ...options,
          repository: {} as never,
        }),
      ).toThrow();
    }

    let resolveClaim: (() => void) | undefined;
    const claimGate = new Promise<void>((resolve) => {
      resolveClaim = resolve;
    });
    const claim = vi.fn(async () => {
      await claimGate;
      return [];
    });
    const runtime = scenarioRuntime({ repository: { claim } });
    const first = runtime.tick();
    const second = runtime.tick();
    await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
    resolveClaim?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ claimed: 0 }),
      expect.objectContaining({ claimed: 0 }),
    ]);
    expect(claim).toHaveBeenCalledOnce();
  });

  it("fails closed when each repository transition loses its fence", async () => {
    const cases = [
      { checkpoint: "pending_snapshot", method: "captureSnapshot" },
      { checkpoint: "pending_snapshot", method: "release" },
      { checkpoint: "rebuilding", item: null, method: "beginVerification" },
      { checkpoint: "rebuilding", item: null, method: "complete" },
      { checkpoint: "rebuilding", item: scenarioItem({ status: "pending" }), method: "heartbeat" },
      {
        checkpoint: "rebuilding",
        item: scenarioItem({ status: "pending" }),
        method: "bindAttempt",
      },
      {
        checkpoint: "rebuilding",
        compilationJob: scenarioCompilationJob({ runState: "succeeded", stage: "published" }),
        item: scenarioItem({ compilationAttemptId: attemptIds[0], status: "running" }),
        method: "markItemSucceeded",
      },
    ] as const;
    for (const scenario of cases) {
      const onError = vi.fn();
      const runtime = scenarioRuntime({
        ...("compilationJob" in scenario ? { compilationJob: scenario.compilationJob } : {}),
        ...("item" in scenario ? { item: scenario.item } : {}),
        job: scenarioJob({ checkpoint: scenario.checkpoint }),
        nullMethod: scenario.method,
        onError,
      });
      await expect(runtime.tick()).resolves.toMatchObject({ claimed: 1, failed: 1 });
      expect(onError).toHaveBeenCalled();
    }
  });

  it("covers retained pending attempts, deferred dispatch, and invalid running items", async () => {
    const pendingAttempt = scenarioItem({
      compilationAttemptId: attemptIds[0],
      status: "pending",
    });
    await expect(
      scenarioRuntime({ compilationJob: null, item: pendingAttempt }).tick(),
    ).resolves.toMatchObject({ failed: 1 });
    await expect(
      scenarioRuntime({
        compilationJob: scenarioCompilationJob({ runState: "failed" }),
        item: pendingAttempt,
      }).tick(),
    ).resolves.toMatchObject({ failed: 1 });
    const retry = vi.fn(async () => scenarioCompilationJob());
    await expect(
      scenarioRuntime({
        compilationJob: scenarioCompilationJob({ runState: "failed" }),
        compilationJobs: { retry },
        item: pendingAttempt,
      }).tick(),
    ).resolves.toMatchObject({ startedDocuments: 1 });
    expect(retry).toHaveBeenCalledOnce();

    const releaseDispatch = vi.fn(async () => scenarioCompilationJob());
    await expect(
      scenarioRuntime({
        compilationJobs: { releaseDispatch },
        item: scenarioItem({ status: "pending" }),
      }).tick(),
    ).resolves.toMatchObject({ startedDocuments: 1 });
    expect(releaseDispatch).toHaveBeenCalledOnce();

    for (const item of [
      scenarioItem({ status: "succeeded" }),
      scenarioItem({ compilationAttemptId: undefined, status: "running" }),
    ]) {
      await expect(scenarioRuntime({ item }).tick()).resolves.toMatchObject({ failed: 1 });
    }
    await expect(
      scenarioRuntime({
        compilationJob: null,
        item: scenarioItem({ compilationAttemptId: attemptIds[0], status: "running" }),
      }).tick(),
    ).resolves.toMatchObject({ failed: 1 });
  });

  it("handles canceled, superseded, and still-running compilation outcomes", async () => {
    const item = scenarioItem({ compilationAttemptId: attemptIds[0], status: "running" });
    for (const runState of ["canceled", "superseded"] as const) {
      await expect(
        scenarioRuntime({ compilationJob: scenarioCompilationJob({ runState }), item }).tick(),
      ).resolves.toMatchObject({ failed: 1 });
    }
    await expect(
      scenarioRuntime({
        compilationJob: scenarioCompilationJob({ runState: "running" }),
        item,
      }).tick(),
    ).resolves.toMatchObject({ waitingDocuments: 1 });
  });
});

function scenarioRuntime({
  compilationJob = scenarioCompilationJob(),
  compilationJobs: compilationOverrides = {},
  item = scenarioItem({ status: "pending" }),
  job = scenarioJob(),
  nullMethod,
  onError,
  repository: repositoryOverrides = {},
}: {
  readonly compilationJob?: DocumentCompilationJob | null;
  readonly compilationJobs?: Partial<DocumentCompilationJobStateMachine>;
  readonly item?: LegacySpacePublicationBootstrapItem | null;
  readonly job?: LegacySpacePublicationBootstrap;
  readonly nullMethod?: string;
  readonly onError?: (input: unknown) => void;
  readonly repository?: Record<string, unknown>;
} = {}) {
  const returnJob = async () => structuredClone(job);
  const repository = {
    beginVerification: returnJob,
    bindAttempt: returnJob,
    captureSnapshot: returnJob,
    claim: async () => [structuredClone(job)],
    complete: returnJob,
    fail: returnJob,
    getNextItem: async () => structuredClone(item),
    heartbeat: returnJob,
    markItemSucceeded: returnJob,
    release: returnJob,
    ...repositoryOverrides,
    ...(nullMethod ? { [nullMethod]: async () => null } : {}),
  };
  const stateMachine = {
    get: async () => structuredClone(compilationJob),
    start: async () => scenarioCompilationJob(),
    ...compilationOverrides,
  };
  return createLegacySpacePublicationBootstrapRuntime({
    compilationJobs: stateMachine as never,
    generateLeaseToken: () => leaseToken,
    intervalMs: 1_000,
    leaseMs: 60_000,
    maxBatchSize: 1,
    now: () => Date.parse("2026-07-14T12:00:00.000Z"),
    ...(onError ? { onError } : {}),
    repository: repository as never,
    workerId: "bootstrap-worker-1",
  });
}

function scenarioJob(
  overrides: Partial<LegacySpacePublicationBootstrap> = {},
): LegacySpacePublicationBootstrap {
  return {
    checkpoint: "rebuilding",
    completedDocuments: 0,
    createdAt: "2026-07-14T12:00:00.000Z",
    heartbeatAt: "2026-07-14T12:00:00.000Z",
    id: bootstrapId,
    idempotencyKey: "legacy-space-publication-bootstrap-v1",
    knowledgeSpaceId,
    leaseExpiresAt: "2026-07-14T12:01:00.000Z",
    leaseToken,
    rowVersion: 1,
    runState: "running",
    snapshotMetadata: {},
    tenantId,
    totalDocuments: 1,
    updatedAt: "2026-07-14T12:00:00.000Z",
    workerId: "bootstrap-worker-1",
    ...overrides,
  };
}

function scenarioItem(
  overrides: Partial<LegacySpacePublicationBootstrapItem> = {},
): LegacySpacePublicationBootstrapItem {
  return {
    bootstrapId,
    createdAt: "2026-07-14T12:00:00.000Z",
    documentAssetId: documentIds[0],
    documentSha256: "1".repeat(64),
    documentVersion: 1,
    ordinal: 0,
    status: "pending",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}

function scenarioCompilationJob(
  overrides: Partial<DocumentCompilationJob> = {},
): DocumentCompilationJob {
  return {
    createdAt: Date.parse("2026-07-14T12:00:00.000Z"),
    documentAssetId: documentIds[0],
    id: attemptIds[0],
    knowledgeSpaceId,
    runState: "running",
    stage: "queued",
    tenantId,
    updatedAt: Date.parse("2026-07-14T12:00:00.000Z"),
    version: 1,
    ...overrides,
  };
}

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
