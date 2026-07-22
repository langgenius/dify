import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseAdapter, DatabaseExecuteInput, DatabaseRow } from "@knowledge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LegacySpacePublicationBootstrapActiveCompilationError,
  LegacySpacePublicationBootstrapAlreadyPublishedError,
  LegacySpacePublicationBootstrapCapacityExceededError,
  LegacySpacePublicationBootstrapSnapshotConflictError,
  LegacySpacePublicationBootstrapTransitionError,
  createDatabaseLegacySpacePublicationBootstrapRepository,
  withKnowledgeSpaceDocumentMutationLease,
} from "./legacy-space-publication-bootstrap";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const bootstrapId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const compilationAttemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const otherAttemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const now = "2026-07-14T12:00:00.000Z";
const later = "2026-07-14T12:05:00.000Z";
const leaseExpiry = "2026-07-14T12:10:00.000Z";

afterEach(() => {
  vi.useRealTimers();
});

describe("legacy publication bootstrap database behavior", () => {
  it("runs the durable start, claim, child failure, retry, rebuild, and verification lifecycle", async () => {
    const fake = statefulDatabase({
      assets: [assetRow()],
    });
    const repository = createRepository(fake.database);

    const started = await repository.start(startInput());
    expect(started).toMatchObject({
      created: true,
      job: { checkpoint: "snapshot_captured", totalDocuments: 1 },
    });
    await expect(repository.get({ knowledgeSpaceId, tenantId })).resolves.toMatchObject({
      id: bootstrapId,
    });
    await expect(repository.getById(bootstrapId)).resolves.toMatchObject({ id: bootstrapId });
    await expect(repository.start(startInput())).resolves.toMatchObject({ created: false });
    await expect(
      repository.start(startInput({ idempotencyKey: "another-ledger" })),
    ).rejects.toThrow("different legacy publication bootstrap ledger");

    const [claimed] = await repository.claim({
      leaseExpiresAt: leaseExpiry,
      leaseToken,
      limit: 1,
      now,
      workerId: "worker-1",
    });
    expect(claimed).toMatchObject({ rowVersion: 1, runState: "running" });
    if (!claimed) throw new Error("Expected a claimed bootstrap");

    await expect(
      repository.heartbeat({
        expectedRowVersion: claimed.rowVersion,
        jobId: bootstrapId,
        leaseExpiresAt: leaseExpiry,
        leaseToken,
        now: later,
        workerId: "another-worker",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.heartbeat({
        expectedRowVersion: claimed.rowVersion,
        jobId: bootstrapId,
        leaseExpiresAt: later,
        leaseToken,
        now: later,
        workerId: "worker-1",
      }),
    ).rejects.toThrow("leaseExpiresAt must be after now");

    const heartbeat = await repository.heartbeat({
      expectedRowVersion: claimed.rowVersion,
      jobId: bootstrapId,
      leaseExpiresAt: leaseExpiry,
      leaseToken,
      now: later,
      workerId: "worker-1",
    });
    expect(heartbeat).toMatchObject({ rowVersion: 2 });
    if (!heartbeat) throw new Error("Expected a heartbeat update");

    const item = await repository.getNextItem(fence(heartbeat.rowVersion, later));
    expect(item).toMatchObject({ documentAssetId, status: "pending" });
    const bound = await repository.bindAttempt({
      ...fence(heartbeat.rowVersion, later),
      compilationAttemptId,
      documentAssetId,
    });
    expect(bound).toMatchObject({ checkpoint: "rebuilding", rowVersion: 3 });
    if (!bound) throw new Error("Expected a bound compilation attempt");
    await expect(
      repository.bindAttempt({
        ...fence(bound.rowVersion, later),
        compilationAttemptId,
        documentAssetId,
      }),
    ).resolves.toMatchObject({ rowVersion: bound.rowVersion });

    await expect(
      repository.fail({
        ...fence(bound.rowVersion, later),
        compilationAttemptId: otherAttemptId,
        documentAssetId,
        errorCode: "compile_failed",
        errorMessage: "child failed",
      }),
    ).rejects.toThrow("compilation attempt changed before failure");
    const failed = await repository.fail({
      ...fence(bound.rowVersion, later),
      compilationAttemptId,
      documentAssetId,
      errorCode: "compile_failed",
      errorMessage: "child failed",
    });
    expect(failed).toMatchObject({
      lastErrorCode: "compile_failed",
      rowVersion: 4,
      runState: "failed",
    });

    await expect(
      repository.retry({ expectedRowVersion: 999, jobId: bootstrapId, now: later }),
    ).resolves.toBeNull();
    const retried = await repository.retry({
      expectedRowVersion: 4,
      jobId: bootstrapId,
      now: later,
    });
    expect(retried).toMatchObject({ rowVersion: 5, runState: "queued" });

    const [reclaimed] = await repository.claim({
      leaseExpiresAt: leaseExpiry,
      leaseToken,
      limit: 1,
      now: later,
      workerId: "worker-2",
    });
    if (!reclaimed) throw new Error("Expected a reclaimed bootstrap");
    const rebound = await repository.bindAttempt({
      ...fence(reclaimed.rowVersion, later),
      compilationAttemptId,
      documentAssetId,
    });
    if (!rebound) throw new Error("Expected a rebound compilation attempt");
    const succeeded = await repository.markItemSucceeded({
      ...fence(rebound.rowVersion, later),
      compilationAttemptId,
      documentAssetId,
    });
    expect(succeeded).toMatchObject({ completedDocuments: 1 });
    if (!succeeded) throw new Error("Expected a completed bootstrap item");
    await expect(
      repository.markItemSucceeded({
        ...fence(succeeded.rowVersion, later),
        compilationAttemptId,
        documentAssetId,
      }),
    ).resolves.toMatchObject({ rowVersion: succeeded.rowVersion });
    await expect(repository.getNextItem(fence(succeeded.rowVersion, later))).resolves.toBeNull();

    const verifying = await repository.beginVerification(fence(succeeded.rowVersion, later));
    expect(verifying).toMatchObject({ checkpoint: "verifying" });
    if (!verifying) throw new Error("Expected bootstrap verification");
    await expect(repository.release(fence(verifying.rowVersion, later))).resolves.toMatchObject({
      runState: "queued",
    });

    expect(fake.calls.some((call) => call.operation === "insert")).toBe(true);
    expect(fake.items.get(documentAssetId)).toMatchObject({ status: "succeeded" });
  });

  it("captures a marker snapshot exactly once and rejects partial, published, or active states", async () => {
    const runningMarker = bootstrapRow({
      checkpoint: "pending_snapshot",
      completed_documents: 0,
      heartbeat_at: now,
      lease_expires_at: leaseExpiry,
      lease_token: leaseToken,
      row_version: 2,
      run_state: "running",
      total_documents: 0,
      worker_id: "worker-1",
    });
    const fake = statefulDatabase({ assets: [assetRow()], bootstrap: runningMarker });
    const repository = createRepository(fake.database);

    const captured = await repository.captureSnapshot(fence(2, later));
    expect(captured).toMatchObject({
      checkpoint: "snapshot_captured",
      rowVersion: 3,
      snapshotMetadata: { documentCount: 1, strategy: "full-generation-rebuild" },
      totalDocuments: 1,
    });
    if (!captured) throw new Error("Expected a captured snapshot");
    await expect(
      repository.captureSnapshot(fence(captured.rowVersion, later)),
    ).resolves.toMatchObject({
      rowVersion: captured.rowVersion,
    });

    const partial = statefulDatabase({
      bootstrap: bootstrapRow({ ...runningMarker, completed_documents: 1, total_documents: 1 }),
    });
    await expect(
      createRepository(partial.database).captureSnapshot(fence(2, later)),
    ).rejects.toThrow("partial document snapshot");

    const published = statefulDatabase({ bootstrap: runningMarker, headExists: true });
    await expect(
      createRepository(published.database).captureSnapshot(fence(2, later)),
    ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapAlreadyPublishedError);

    const active = statefulDatabase({ activeAttempt: true, bootstrap: runningMarker });
    await expect(
      createRepository(active.database).captureSnapshot(fence(2, later)),
    ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapActiveCompilationError);
  });

  it("validates claim and start bounds before mutating durable state", async () => {
    expect(() =>
      createDatabaseLegacySpacePublicationBootstrapRepository({
        database: statefulDatabase({}).database,
        maxClaimBatchSize: 0,
        maxDocuments: 1,
        maxInsertBatchSize: 1,
      }),
    ).toThrow("maxClaimBatchSize must be a positive integer");

    const repository = createRepository(statefulDatabase({}).database);
    await expect(
      repository.claim({ leaseExpiresAt: leaseExpiry, leaseToken, limit: 0, now, workerId: "w" }),
    ).rejects.toThrow("limit must be a positive integer");
    await expect(
      repository.claim({ leaseExpiresAt: leaseExpiry, leaseToken, limit: 3, now, workerId: "w" }),
    ).rejects.toThrow("exceeds maxClaimBatchSize=2");
    await expect(
      repository.claim({ leaseExpiresAt: now, leaseToken, limit: 1, now, workerId: "w" }),
    ).rejects.toThrow("leaseExpiresAt must be after now");
    await expect(
      repository.claim({
        leaseExpiresAt: leaseExpiry,
        leaseToken: "00000000-0000-0000-0000-000000000000",
        limit: 1,
        now,
        workerId: "w",
      }),
    ).rejects.toThrow("leaseToken must not be the zero UUID");
    await expect(
      repository.claim({ leaseExpiresAt: leaseExpiry, leaseToken, limit: 1, now, workerId: " " }),
    ).rejects.toThrow("workerId is required");

    const overCapacity = statefulDatabase({ assets: [assetRow(), assetRow(otherAttemptId)] });
    await expect(
      createRepository(overCapacity.database, 1).start(startInput()),
    ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapCapacityExceededError);
    const missingSpace = statefulDatabase({ spaceExists: false });
    await expect(
      createRepository(missingSpace.database).start(startInput()),
    ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapSnapshotConflictError);
  });

  it("surfaces exact insert, item, and CAS persistence failures", async () => {
    const bootstrapInsert = statefulDatabase({ assets: [assetRow()], failBootstrapInsert: true });
    await expect(createRepository(bootstrapInsert.database).start(startInput())).rejects.toThrow(
      "insert did not persist exactly one row",
    );

    const itemInsert = statefulDatabase({ assets: [assetRow()], failItemInsert: true });
    await expect(createRepository(itemInsert.database).start(startInput())).rejects.toThrow(
      "item count mismatch",
    );

    const cas = statefulDatabase({
      bootstrap: bootstrapRow({
        heartbeat_at: now,
        lease_expires_at: leaseExpiry,
        lease_token: leaseToken,
        row_version: 1,
        run_state: "running",
        worker_id: "worker-1",
      }),
      failBootstrapUpdate: true,
    });
    await expect(createRepository(cas.database).release(fence(1, later))).rejects.toThrow(
      "changed concurrently",
    );

    const itemCas = statefulDatabase({
      bootstrap: bootstrapRow({
        heartbeat_at: now,
        lease_expires_at: leaseExpiry,
        lease_token: leaseToken,
        row_version: 1,
        run_state: "running",
        worker_id: "worker-1",
      }),
      failItemUpdate: true,
      items: [itemRow()],
    });
    await expect(
      createRepository(itemCas.database).bindAttempt({
        ...fence(1, later),
        compilationAttemptId,
        documentAssetId,
      }),
    ).rejects.toThrow("item changed concurrently");

    const lostFence = statefulDatabase({});
    await expect(
      createRepository(lostFence.database).release(fence(1, later)),
    ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapTransitionError);
  });

  it("fails closed at every public transition guard before publication", async () => {
    const noLedger = createRepository(statefulDatabase({}).database);
    await expect(
      noLedger.assertCompilationAdmission({ knowledgeSpaceId, tenantId }),
    ).resolves.toBeUndefined();
    await expect(
      noLedger.acquireDocumentMutationLease({
        acquiredAt: now,
        knowledgeSpaceId,
        operation: "unknown" as never,
        tenantId,
      }),
    ).rejects.toThrow("Unknown knowledge space document mutation operation");
    await expect(
      noLedger.acquireDocumentMutationLease({
        acquiredAt: now,
        knowledgeSpaceId,
        operation: "upload",
        tenantId,
      }),
    ).rejects.toThrow("mutation lease was not acquired");

    const queued = createRepository(statefulDatabase({ bootstrap: bootstrapRow() }).database);
    await expect(
      queued.acquireDocumentMutationLease({
        acquiredAt: now,
        knowledgeSpaceId,
        operation: "upload",
        tenantId,
      }),
    ).rejects.toThrow("fenced by legacy publication bootstrap");

    const running = bootstrapRow({
      heartbeat_at: now,
      lease_expires_at: leaseExpiry,
      lease_token: leaseToken,
      row_version: 1,
      run_state: "running",
      worker_id: "worker-1",
    });
    await expect(
      createRepository(
        statefulDatabase({ bootstrap: running }).database,
      ).assertCompilationAdmission({
        bootstrapJobId: bootstrapId,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBeUndefined();

    const incomplete = createRepository(
      statefulDatabase({ bootstrap: running, items: [itemRow()] }).database,
    );
    await expect(incomplete.beginVerification(fence(1, later))).rejects.toThrow(
      "cannot verify before all documents succeed",
    );
    await expect(
      incomplete.bindAttempt({
        ...fence(1, later),
        compilationAttemptId,
        documentAssetId: otherAttemptId,
      }),
    ).rejects.toThrow("document item was not found");
    await expect(
      incomplete.markItemSucceeded({
        ...fence(1, later),
        compilationAttemptId,
        documentAssetId,
      }),
    ).rejects.toThrow("compilation attempt changed before completion");
    await expect(incomplete.complete(fence(1, later))).rejects.toThrow(
      "cannot complete from checkpoint=snapshot_captured",
    );
    await expect(
      incomplete.fail({
        ...fence(1, later),
        documentAssetId: otherAttemptId,
        errorCode: "failed",
        errorMessage: "missing item",
      }),
    ).rejects.toThrow("document snapshot changed");

    const prebound = createRepository(
      statefulDatabase({
        bootstrap: running,
        items: [itemRow({ compilation_attempt_id: otherAttemptId })],
      }).database,
    );
    await expect(
      prebound.bindAttempt({
        ...fence(1, later),
        compilationAttemptId,
        documentAssetId,
      }),
    ).rejects.toThrow("cannot bind from status=pending");

    const pendingCompletion = createRepository(
      statefulDatabase({ bootstrap: running, items: [itemRow()] }).database,
    );
    await expect(
      pendingCompletion.markItemSucceeded({
        ...fence(1, later),
        compilationAttemptId: otherAttemptId,
        documentAssetId,
      }),
    ).rejects.toThrow("compilation attempt changed before completion");
  });

  it("rejects start races and malformed persisted lifecycle rows", async () => {
    await expect(
      createRepository(statefulDatabase({ headExists: true }).database).start(startInput()),
    ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapAlreadyPublishedError);
    await expect(
      createRepository(statefulDatabase({ activeAttempt: true }).database).start(startInput()),
    ).rejects.toBeInstanceOf(LegacySpacePublicationBootstrapActiveCompilationError);
    await expect(
      createRepository(statefulDatabase({}).database).captureSnapshot(fence(1, later)),
    ).rejects.toThrow("lost its lease fence");

    for (const malformed of [
      bootstrapRow({ completed_documents: 2, total_documents: 1 }),
      bootstrapRow({ run_state: "running" }),
      bootstrapRow({ run_state: "failed" }),
      bootstrapRow({
        checkpoint: "published",
        completed_at: later,
        run_state: "succeeded",
        total_documents: 1,
      }),
      bootstrapRow({ checkpoint: "not-a-checkpoint" }),
    ]) {
      await expect(
        createRepository(statefulDatabase({ bootstrap: malformed }).database).getById(bootstrapId),
      ).rejects.toThrow();
    }

    const malformedItem = statefulDatabase({
      bootstrap: bootstrapRow({
        heartbeat_at: now,
        lease_expires_at: leaseExpiry,
        lease_token: leaseToken,
        row_version: 1,
        run_state: "running",
        worker_id: "worker-1",
      }),
      items: [itemRow({ document_sha256: "invalid" })],
    });
    await expect(
      createRepository(malformedItem.database).getNextItem(fence(1, later)),
    ).rejects.toThrow("documentSha256 must be lowercase SHA-256");
  });

  it("rejects verification count drift and a missing published head", async () => {
    const verifying = bootstrapRow({
      checkpoint: "verifying",
      completed_documents: 1,
      heartbeat_at: now,
      lease_expires_at: leaseExpiry,
      lease_token: leaseToken,
      row_version: 1,
      run_state: "running",
      worker_id: "worker-1",
    });
    await expect(
      createRepository(statefulDatabase({ bootstrap: verifying }).database).complete(
        fence(1, later),
      ),
    ).rejects.toThrow("item count no longer matches");

    const noHead = statefulDatabase({
      bootstrap: verifying,
      items: [itemRow({ compilation_attempt_id: compilationAttemptId, status: "succeeded" })],
    });
    await expect(createRepository(noHead.database).complete(fence(1, later))).rejects.toThrow(
      "no current published head",
    );
  });
});

describe("knowledge space mutation lease wrapper", () => {
  it("mutates directly when no repository is configured", async () => {
    await expect(
      withKnowledgeSpaceDocumentMutationLease({
        acquiredAt: now,
        knowledgeSpaceId,
        mutate: async () => "done",
        operation: "upload",
        tenantId,
      }),
    ).resolves.toBe("done");
  });

  it("heartbeats long mutations and always releases the latest lease", async () => {
    vi.useFakeTimers();
    let finishMutation: ((value: string) => void) | undefined;
    const release = vi.fn(async () => undefined);
    const heartbeat = vi.fn(async (lease: MutationLease) => ({
      ...lease,
      expiresAt: "2026-07-14T12:00:06.000Z",
      heartbeatAt: "2026-07-14T12:00:03.000Z",
    }));
    const promise = withKnowledgeSpaceDocumentMutationLease({
      acquiredAt: now,
      knowledgeSpaceId,
      mutate: () =>
        new Promise<string>((resolve) => {
          finishMutation = resolve;
        }),
      operation: "upload",
      repository: {
        acquireDocumentMutationLease: async () => mutationLease(),
        heartbeatDocumentMutationLease: heartbeat,
        releaseDocumentMutationLease: release,
      },
      tenantId,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    finishMutation?.("done");
    await expect(promise).resolves.toBe("done");
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ heartbeatAt: "2026-07-14T12:00:03.000Z" }),
    );
  });

  it("propagates heartbeat and mutation failures after releasing the lease", async () => {
    vi.useFakeTimers();
    let finishMutation: (() => void) | undefined;
    const release = vi.fn(async () => undefined);
    const heartbeatFailure = withKnowledgeSpaceDocumentMutationLease({
      acquiredAt: now,
      knowledgeSpaceId,
      mutate: () =>
        new Promise<void>((resolve) => {
          finishMutation = resolve;
        }),
      operation: "upload",
      repository: {
        acquireDocumentMutationLease: async () => mutationLease(),
        heartbeatDocumentMutationLease: async () => {
          throw new Error("heartbeat failed");
        },
        releaseDocumentMutationLease: release,
      },
      tenantId,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    finishMutation?.();
    await expect(heartbeatFailure).rejects.toThrow("heartbeat failed");
    expect(release).toHaveBeenCalledOnce();

    await expect(
      withKnowledgeSpaceDocumentMutationLease({
        acquiredAt: now,
        knowledgeSpaceId,
        mutate: async () => {
          throw new Error("mutation failed");
        },
        operation: "upload",
        repository: {
          acquireDocumentMutationLease: async () => mutationLease(),
          releaseDocumentMutationLease: release,
        },
        tenantId,
      }),
    ).rejects.toThrow("mutation failed");
    expect(release).toHaveBeenCalledTimes(2);
  });
});

interface StatefulDatabaseOptions {
  readonly activeAttempt?: boolean;
  readonly assets?: readonly DatabaseRow[];
  readonly bootstrap?: DatabaseRow;
  readonly failBootstrapInsert?: boolean;
  readonly failBootstrapUpdate?: boolean;
  readonly failItemInsert?: boolean;
  readonly failItemUpdate?: boolean;
  readonly headExists?: boolean;
  readonly items?: readonly DatabaseRow[];
  readonly spaceExists?: boolean;
}

const bootstrapColumns = [
  "id",
  "tenant_id",
  "knowledge_space_id",
  "idempotency_key",
  "checkpoint",
  "run_state",
  "total_documents",
  "completed_documents",
  "worker_id",
  "lease_token",
  "lease_expires_at",
  "heartbeat_at",
  "last_error_code",
  "last_error_message",
  "row_version",
  "published_publication_id",
  "published_fingerprint",
  "published_head_revision",
  "snapshot_metadata",
  "created_at",
  "updated_at",
  "completed_at",
] as const;

const mutableBootstrapColumns = bootstrapColumns.filter(
  (column) => !["id", "tenant_id", "knowledge_space_id", "created_at"].includes(column),
);

const itemColumns = [
  "bootstrap_id",
  "document_asset_id",
  "document_version",
  "document_sha256",
  "ordinal",
  "compilation_attempt_id",
  "status",
  "last_error",
  "created_at",
  "updated_at",
] as const;

function statefulDatabase(options: StatefulDatabaseOptions) {
  const calls: DatabaseExecuteInput[] = [];
  let bootstrap = options.bootstrap ? cloneRow(options.bootstrap) : undefined;
  const items = new Map<string, Record<string, unknown>>(
    (options.items ?? []).map((row) => [String(row.document_asset_id), cloneRow(row)]),
  );

  const execute = async (input: DatabaseExecuteInput) => {
    calls.push(input);
    if (input.tableName === "knowledge_spaces") {
      if (input.sql.includes("legacy_exists")) return result([]);
      return result(
        options.spaceExists === false
          ? []
          : [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
      );
    }
    if (
      input.tableName === "deletion_jobs" ||
      input.tableName === "knowledge_space_mutation_leases"
    ) {
      return result([]);
    }
    if (input.tableName === "projection_set_publication_heads") {
      return result(options.headExists ? [{ publication_id: bootstrapId }] : []);
    }
    if (input.tableName === "document_compilation_attempts") {
      return result(options.activeAttempt ? [{ id: compilationAttemptId }] : []);
    }
    if (input.tableName === "document_assets") {
      return result(options.assets ?? []);
    }
    if (input.tableName === "legacy_space_publication_bootstraps") {
      if (input.operation === "select") {
        if (input.sql.includes("run_state") && bootstrap?.run_state !== "queued") return result([]);
        return result(bootstrap ? [cloneRow(bootstrap)] : []);
      }
      if (input.operation === "insert") {
        if (options.failBootstrapInsert) return result([], 0);
        bootstrap = rowFromValues(bootstrapColumns, input.params);
        normalizeJsonColumn(bootstrap, "snapshot_metadata");
        return result([], 1);
      }
      if (input.operation === "update") {
        if (options.failBootstrapUpdate) return result([], 0);
        if (!bootstrap) return result([], 0);
        for (const [index, column] of mutableBootstrapColumns.entries()) {
          bootstrap[column] = input.params[index];
        }
        normalizeJsonColumn(bootstrap, "snapshot_metadata");
        return result(input.maxRows > 0 ? [cloneRow(bootstrap)] : [], 1);
      }
    }
    if (input.tableName === "legacy_space_publication_bootstrap_items") {
      if (input.operation === "select") {
        if (input.sql.includes("COUNT(*)")) {
          return result([
            {
              item_count: [...items.values()].filter((item) => item.status === "succeeded").length,
            },
          ]);
        }
        if (input.params.length === 2) {
          const item = items.get(String(input.params[1]));
          return result(item ? [cloneRow(item)] : []);
        }
        const item = [...items.values()]
          .sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
          .find((candidate) => candidate.status !== "succeeded");
        return result(item ? [cloneRow(item)] : []);
      }
      if (input.operation === "insert") {
        const count = input.params.length / itemColumns.length;
        if (options.failItemInsert) return result([], Math.max(0, count - 1));
        for (let offset = 0; offset < input.params.length; offset += itemColumns.length) {
          const item = rowFromValues(
            itemColumns,
            input.params.slice(offset, offset + itemColumns.length),
          );
          items.set(String(item.document_asset_id), item);
        }
        return result([], count);
      }
      if (input.operation === "update") {
        if (input.params.length === 2) {
          for (const item of items.values()) {
            if (item.status === "failed") {
              item.compilation_attempt_id = null;
              item.last_error = null;
              item.status = "pending";
              item.updated_at = input.params[0];
            }
          }
          return result([], 1);
        }
        if (options.failItemUpdate) return result([], 0);
        const item = items.get(String(input.params[5]));
        if (!item) return result([], 0);
        item.compilation_attempt_id = input.params[0];
        item.status = input.params[1];
        item.last_error = input.params[2];
        item.updated_at = input.params[3];
        return result([], 1);
      }
    }
    throw new Error(`Unexpected stateful bootstrap query: ${input.operation} ${input.tableName}`);
  };

  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: "postgres",
    transaction: async (callback) => callback({ execute }),
  });
  return { calls, database, items };
}

function createRepository(database: DatabaseAdapter, maxDocuments = 10) {
  return createDatabaseLegacySpacePublicationBootstrapRepository({
    database,
    maxClaimBatchSize: 2,
    maxDocuments,
    maxInsertBatchSize: 1,
  });
}

function startInput(patch: Partial<ReturnType<typeof startInputBase>> = {}) {
  return { ...startInputBase(), ...patch };
}

function startInputBase() {
  return {
    createdAt: now,
    id: bootstrapId,
    idempotencyKey: "legacy-bootstrap-v1",
    knowledgeSpaceId,
    tenantId,
  };
}

function fence(expectedRowVersion: number, timestamp: string) {
  return { expectedRowVersion, jobId: bootstrapId, leaseToken, now: timestamp };
}

function assetRow(id = documentAssetId): DatabaseRow {
  return { id, sha256: "a".repeat(64), version: 1 };
}

function bootstrapRow(patch: Record<string, unknown> = {}): DatabaseRow {
  return {
    checkpoint: "snapshot_captured",
    completed_at: null,
    completed_documents: 0,
    created_at: now,
    heartbeat_at: null,
    id: bootstrapId,
    idempotency_key: "legacy-bootstrap-v1",
    knowledge_space_id: knowledgeSpaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: null,
    lease_token: null,
    published_fingerprint: null,
    published_head_revision: null,
    published_publication_id: null,
    row_version: 0,
    run_state: "queued",
    snapshot_metadata: { schemaVersion: 1 },
    tenant_id: tenantId,
    total_documents: 1,
    updated_at: now,
    worker_id: null,
    ...patch,
  };
}

function itemRow(patch: Record<string, unknown> = {}): DatabaseRow {
  return {
    bootstrap_id: bootstrapId,
    compilation_attempt_id: null,
    created_at: now,
    document_asset_id: documentAssetId,
    document_sha256: "a".repeat(64),
    document_version: 1,
    last_error: null,
    ordinal: 0,
    status: "pending",
    updated_at: now,
    ...patch,
  };
}

function rowFromValues(
  columns: readonly string[],
  values: readonly (boolean | number | string | null)[],
): Record<string, unknown> {
  return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null]));
}

function normalizeJsonColumn(row: Record<string, unknown>, column: string): void {
  const value = row[column];
  if (typeof value === "string") row[column] = JSON.parse(value) as object;
}

function cloneRow(row: DatabaseRow): Record<string, unknown> {
  return structuredClone(row) as Record<string, unknown>;
}

function result(rows: readonly DatabaseRow[], rowsAffected = 0) {
  return { rows, rowsAffected };
}

type MutationLease = ReturnType<typeof mutationLease>;

function mutationLease() {
  return {
    acquiredAt: now,
    expiresAt: "2026-07-14T12:00:03.000Z",
    heartbeatAt: now,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
    knowledgeSpaceId,
    leaseToken,
    operation: "upload" as const,
    tenantId,
  };
}
