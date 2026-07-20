import { createHash } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseTransactionCallback,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  SourceCredentialBackfillTransitionError,
  createDatabaseSourceCredentialBackfillRepository,
} from "./source-credential-backfill";
import { createSourceCredentialFingerprinter } from "./source-secret-store";

const tenantId = "tenant-1";
const spaceId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const lifecycleId = "30000000-0000-4000-8000-000000000002";
const leaseToken = "40000000-0000-4000-8000-000000000001";
const candidateRef = "source-secret:v1:50000000-0000-4000-8000-000000000001";
const replacementRef = "source-secret:v1:60000000-0000-4000-8000-000000000001";
const now = "2026-07-14T00:00:10.000Z";
const expires = "2026-07-14T00:01:00.000Z";
const credentials = { apiKey: "must-never-enter-the-job-row", region: "us-east-1" };
const credentialFingerprinter = createSourceCredentialFingerprinter(new Uint8Array(32).fill(41));
const fingerprintCredentials = (value: Readonly<Record<string, unknown>>) =>
  credentialFingerprinter({
    credentials: value,
    knowledgeSpaceId: spaceId,
    sourceId,
    tenantId,
  });
const fingerprint = fingerprintCredentials(credentials);

describe.each(["postgres", "tidb"] as const)(
  "atomic source credential backfill SQL (%s)",
  (dialect) => {
    it("holds the space deletion lock across candidate SecretStore writes", async () => {
      const calls: RecordedCall[] = [];
      let inTransaction = false;
      let mutationRanInTransaction = false;
      const repository = createRepository(
        dialect,
        async (input) => {
          calls.push({ ...input, inTransaction });
          return { rows: [], rowsAffected: 0 };
        },
        (value) => {
          inTransaction = value;
        },
      );

      await expect(
        repository.withWriteAdmission({ knowledgeSpaceId: spaceId, tenantId }, async () => {
          mutationRanInTransaction = inTransaction;
          return "stored";
        }),
      ).resolves.toBe("stored");
      expect(mutationRanInTransaction).toBe(true);
      expect(calls.map((call) => call.tableName)).toEqual(["knowledge_spaces", "deletion_jobs"]);
      expect(calls[0]?.sql).toContain("FOR UPDATE");

      let lateMutationRan = false;
      const deletingRepository = createRepository(
        dialect,
        async () => ({ rows: [], rowsAffected: 0 }),
        undefined,
        { activeDeletion: true },
      );
      await expect(
        deletingRepository.withWriteAdmission({ knowledgeSpaceId: spaceId, tenantId }, async () => {
          lateMutationRan = true;
        }),
      ).rejects.toBeInstanceOf(SourceCredentialBackfillTransitionError);
      expect(lateMutationRan).toBe(false);
    });

    it("discovers job and candidate lifecycle reservation in one transaction", async () => {
      const calls: RecordedCall[] = [];
      let inTransaction = false;
      const repository = createRepository(
        dialect,
        async (input) => {
          calls.push({ ...input, inTransaction });
          if (input.operation === "select" && input.tableName === "sources") {
            return { rows: [discoveryRow()], rowsAffected: 0 };
          }
          return { rows: [], rowsAffected: 1 };
        },
        (value) => {
          inTransaction = value;
        },
      );

      await expect(repository.discover({ limit: 5, now })).resolves.toEqual({
        created: 1,
        nextSourceId: sourceId,
        scanned: 1,
      });
      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "sources"],
        ["select", "knowledge_spaces"],
        ["select", "deletion_jobs"],
        ["insert", "source_credential_backfills"],
        ["insert", "source_secret_lifecycle_refs"],
      ]);
      expect(calls.every((call) => call.inTransaction)).toBe(true);
      expect(calls[3]?.params).toContain(replacementRef);
      expect(calls[3]?.params).toContain(fingerprint);
      expect(calls[3]?.params).not.toContain(
        createHash("sha256").update(JSON.stringify(credentials)).digest("hex"),
      );
      expect(calls[4]?.params).toEqual([
        jobId,
        tenantId,
        spaceId,
        sourceId,
        replacementRef,
        jobId,
        "backfill",
        "candidate",
        7,
        now,
        null,
        null,
        null,
        null,
        null,
        0,
        0,
        null,
        null,
        now,
        now,
        null,
      ]);
      expect(JSON.stringify(calls.flatMap((call) => call.params))).not.toContain(
        credentials.apiKey,
      );
      assertPlaceholderArity(calls, dialect);
    });

    it("claims exactly one candidate with lifecycle-before-job locking", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createRepository(dialect, async (input) => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return { rows: [lifecycleRow("candidate")], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "source_credential_backfills") {
          return input.sql.includes("SELECT *")
            ? { rows: [jobRow()], rowsAffected: 0 }
            : { rows: [{ candidate_credential_ref: candidateRef, id: jobId }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });

      await expect(
        repository.claim({ leaseExpiresAt: expires, limit: 9, now, workerId: "worker-1" }),
      ).resolves.toMatchObject([
        {
          candidateCredentialRef: candidateRef,
          candidateLifecycleState: "candidate",
          leaseToken,
          rowVersion: 1,
          runState: "running",
        },
      ]);
      expect(calls[0]?.maxRows).toBe(1);
      expect(calls[0]?.params).toEqual([now, 1]);
      expect(calls.slice(1, 6).map((call) => call.tableName)).toEqual([
        "source_credential_backfills",
        "knowledge_spaces",
        "deletion_jobs",
        "source_secret_lifecycle_refs",
        "source_credential_backfills",
      ]);
      assertPlaceholderArity(calls, dialect);
    });

    it("renews only candidate/active lifecycle refs and never revives a deleted ref", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createRepository(dialect, async (input) => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return { rows: [lifecycleRow("deleted")], rowsAffected: 0 };
        }
        if (input.operation === "select") return { rows: [runningJobRow()], rowsAffected: 0 };
        return { rows: [], rowsAffected: 1 };
      });

      await expect(
        repository.heartbeat({
          candidateCredentialRef: candidateRef,
          expectedRowVersion: 0,
          jobId,
          leaseExpiresAt: expires,
          leaseToken,
          now,
          workerId: "worker-1",
        }),
      ).rejects.toBeInstanceOf(SourceCredentialBackfillTransitionError);
      expect(calls.filter((call) => call.operation === "update")).toHaveLength(0);
      expect(calls.slice(0, 5).map((call) => call.tableName)).toEqual([
        "source_credential_backfills",
        "knowledge_spaces",
        "deletion_jobs",
        "source_secret_lifecycle_refs",
        "source_credential_backfills",
      ]);
      assertPlaceholderArity(calls, dialect);
    });

    it("atomically activates source, lifecycle, and job in registry-job-source lock order", async () => {
      const calls: RecordedCall[] = [];
      let inTransaction = false;
      const repository = createRepository(
        dialect,
        transitionExecutor(calls, () => inTransaction, {
          lifecycle: lifecycleRow("candidate"),
          job: runningJobRow(),
          source: sourceRow(null, 7, { credentials, provider: "example" }),
        }),
        (value) => {
          inTransaction = value;
        },
      );

      await expect(repository.activateCandidate(fence())).resolves.toMatchObject({
        job: { runState: "succeeded" },
        outcome: "activated",
      });
      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "source_credential_backfills"],
        ["select", "knowledge_spaces"],
        ["select", "deletion_jobs"],
        ["select", "source_secret_lifecycle_refs"],
        ["select", "source_credential_backfills"],
        ["select", "sources"],
        ["update", "sources"],
        ["update", "source_secret_lifecycle_refs"],
        ["update", "source_credential_backfills"],
      ]);
      expect(calls[0]?.inTransaction).toBe(false);
      expect(calls.slice(1).every((call) => call.inTransaction)).toBe(true);
      expect(calls[6]?.params.slice(0, 3)).toEqual([
        candidateRef,
        JSON.stringify({ provider: "example" }),
        8,
      ]);
      assertPlaceholderArity(calls, dialect);
    });

    it("recovers an activate commit whose acknowledgement was lost without another write", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createRepository(
        dialect,
        transitionExecutor(calls, () => true, {
          lifecycle: lifecycleRow("active", { sourceVersion: 8 }),
          job: terminalJobRow("succeeded"),
          source: sourceRow(candidateRef, 8, { provider: "example" }),
        }),
      );

      await expect(repository.activateCandidate(fence())).resolves.toMatchObject({
        job: { runState: "succeeded" },
        outcome: "already_active",
      });
      expect(calls.filter((call) => call.operation !== "select")).toHaveLength(0);
      assertPlaceholderArity(calls, dialect);
    });

    it("refreshes old lifecycle, inserts a new candidate, and requeues job atomically", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const rotatedCredentials = { apiKey: "rotated" };
      const repository = createRepository(
        dialect,
        transitionExecutor(calls, () => true, {
          lifecycle: lifecycleRow("candidate"),
          job: runningJobRow(),
          source: sourceRow(null, 8, { credentials: rotatedCredentials }),
        }),
      );

      await expect(
        repository.refreshCandidate({
          ...fence(),
          secretFingerprint: fingerprintCredentials(rotatedCredentials),
          sourceVersion: 8,
        }),
      ).resolves.toMatchObject({
        job: {
          candidateCredentialRef: replacementRef,
          rowVersion: 1,
          runState: "queued",
          sourceVersion: 8,
        },
        outcome: "refreshed",
      });
      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "source_credential_backfills"],
        ["select", "knowledge_spaces"],
        ["select", "deletion_jobs"],
        ["select", "source_secret_lifecycle_refs"],
        ["select", "source_credential_backfills"],
        ["select", "sources"],
        ["update", "source_secret_lifecycle_refs"],
        ["insert", "source_secret_lifecycle_refs"],
        ["update", "source_credential_backfills"],
      ]);
      assertPlaceholderArity(calls, dialect);
    });

    it("turns a successful-abandon race with newly added legacy data into refresh", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const concurrentCredentials = { apiKey: "added-after-runtime-read" };
      const repository = createRepository(
        dialect,
        transitionExecutor(calls, () => true, {
          lifecycle: lifecycleRow("candidate"),
          job: runningJobRow(),
          source: sourceRow(null, 8, { credentials: concurrentCredentials }),
        }),
      );

      await expect(
        repository.abandonCandidate({ ...fence(), terminalState: "succeeded" }),
      ).resolves.toMatchObject({
        job: {
          candidateCredentialRef: replacementRef,
          runState: "queued",
          secretFingerprint: fingerprintCredentials(concurrentCredentials),
        },
        outcome: "refreshed",
      });
      expect(
        calls.some(
          (call) =>
            call.operation === "insert" && call.tableName === "source_secret_lifecycle_refs",
        ),
      ).toBe(true);
      assertPlaceholderArity(calls, dialect);
    });

    it("atomically retires an abandoned candidate with its terminal job", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createRepository(
        dialect,
        transitionExecutor(calls, () => true, {
          lifecycle: lifecycleRow("candidate"),
          job: runningJobRow(),
          source: null,
        }),
      );

      await expect(
        repository.abandonCandidate({
          ...fence(),
          errorCode: "CANDIDATE_OBJECT_MISSING",
          errorMessage: "Candidate object is missing",
          terminalState: "failed",
        }),
      ).resolves.toMatchObject({
        job: { lastErrorCode: "CANDIDATE_OBJECT_MISSING", runState: "failed" },
        outcome: "abandoned",
      });
      expect(calls.slice(0, 6).map((call) => call.tableName)).toEqual([
        "source_credential_backfills",
        "knowledge_spaces",
        "deletion_jobs",
        "source_secret_lifecycle_refs",
        "source_credential_backfills",
        "sources",
      ]);
      expect(calls.slice(6).map((call) => call.tableName)).toEqual([
        "source_secret_lifecycle_refs",
        "source_credential_backfills",
      ]);
      assertPlaceholderArity(calls, dialect);
    });

    it("manual retry keeps old terminal ref retired and creates a fresh candidate", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let jobReads = 0;
      const repository = createRepository(dialect, async (input) => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return { rows: [lifecycleRow("retired")], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "source_credential_backfills") {
          jobReads += 1;
          return { rows: [terminalJobRow("failed")], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return { rows: [sourceRow(null, 8, { credentials })], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });

      await expect(repository.retry({ jobId, now })).resolves.toMatchObject({
        candidateCredentialRef: replacementRef,
        candidateLifecycleState: "candidate",
        runState: "queued",
        sourceVersion: 8,
      });
      expect(jobReads).toBe(2);
      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "source_credential_backfills"],
        ["select", "knowledge_spaces"],
        ["select", "deletion_jobs"],
        ["select", "source_secret_lifecycle_refs"],
        ["select", "source_credential_backfills"],
        ["select", "sources"],
        ["insert", "source_secret_lifecycle_refs"],
        ["update", "source_credential_backfills"],
      ]);
      assertPlaceholderArity(calls, dialect);
    });

    it("rejects an expired activation fence before any mutation", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createRepository(
        dialect,
        transitionExecutor(calls, () => true, {
          lifecycle: lifecycleRow("candidate"),
          job: runningJobRow({ lease_expires_at: "2026-07-14T00:00:09.000Z" }),
          source: sourceRow(null, 7, { credentials }),
        }),
      );

      await expect(repository.activateCandidate(fence())).rejects.toBeInstanceOf(
        SourceCredentialBackfillTransitionError,
      );
      expect(calls.filter((call) => call.operation !== "select")).toHaveLength(0);
      assertPlaceholderArity(calls, dialect);
    });
  },
);

interface RecordedCall extends DatabaseExecuteInput {
  readonly inTransaction: boolean;
}

function createRepository(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  transactionState?: (running: boolean) => void,
  admission?: { readonly activeDeletion?: boolean | undefined },
) {
  return createDatabaseSourceCredentialBackfillRepository({
    database: createDatabase(dialect, execute, transactionState, admission),
    credentialFingerprinter,
    generateCandidateCredentialRef: () => replacementRef,
    generateId: () => jobId,
    generateLeaseToken: () => leaseToken,
    generateLifecycleId: () => lifecycleId,
    maxClaimBatchSize: 10,
    maxDiscoveryBatchSize: 10,
  });
}

function createDatabase(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  transactionState?: (running: boolean) => void,
  admission?: { readonly activeDeletion?: boolean | undefined },
): DatabaseAdapter {
  const admittedExecute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    const result = await execute(input);
    if (input.operation === "select" && input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "deletion_jobs") {
      return {
        rows: admission?.activeDeletion ? [{ id: "active-deletion-job" }] : [],
        rowsAffected: 0,
      };
    }
    return result;
  };
  return {
    dialect,
    execute: admittedExecute,
    kind: dialect,
    transaction: async <T>(callback: DatabaseTransactionCallback<T>) => {
      transactionState?.(true);
      try {
        return await callback({ execute: admittedExecute });
      } finally {
        transactionState?.(false);
      }
    },
  } as unknown as DatabaseAdapter;
}

function transitionExecutor(
  calls: Array<DatabaseExecuteInput | RecordedCall>,
  inTransaction: () => boolean,
  rows: {
    readonly job: Readonly<Record<string, unknown>>;
    readonly lifecycle: Readonly<Record<string, unknown>>;
    readonly source: Readonly<Record<string, unknown>> | null;
  },
) {
  return async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, inTransaction: inTransaction() });
    if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
      return { rows: [rows.lifecycle], rowsAffected: 0 };
    }
    if (input.operation === "select" && input.tableName === "source_credential_backfills") {
      return { rows: [rows.job], rowsAffected: 0 };
    }
    if (input.operation === "select" && input.tableName === "sources") {
      return { rows: rows.source ? [rows.source] : [], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: 1 };
  };
}

function fence() {
  return {
    candidateCredentialRef: candidateRef,
    expectedRowVersion: 0,
    jobId,
    leaseToken,
    now,
  };
}

function discoveryRow() {
  return {
    knowledge_space_id: spaceId,
    metadata: { credentials, provider: "example" },
    source_id: sourceId,
    source_version: 7,
    tenant_id: tenantId,
  };
}

function jobRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    candidate_credential_ref: candidateRef,
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    heartbeat_at: null,
    id: jobId,
    knowledge_space_id: spaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: null,
    lease_token: null,
    retry_count: 0,
    row_version: 0,
    run_state: "queued",
    secret_fingerprint: fingerprint,
    source_id: sourceId,
    source_version: 7,
    tenant_id: tenantId,
    updated_at: "2026-07-14T00:00:00.000Z",
    worker_id: null,
    ...overrides,
  };
}

function runningJobRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return jobRow({
    heartbeat_at: "2026-07-14T00:00:00.000Z",
    lease_expires_at: expires,
    lease_token: leaseToken,
    run_state: "running",
    worker_id: "worker-1",
    ...overrides,
  });
}

function terminalJobRow(state: "failed" | "succeeded") {
  return jobRow({
    completed_at: now,
    last_error_code: state === "failed" ? "OBJECT_STORE_UNAVAILABLE" : null,
    last_error_message: state === "failed" ? "Backfill failed" : null,
    run_state: state,
  });
}

function lifecycleRow(
  state: "active" | "candidate" | "deleted" | "retired",
  overrides: { readonly sourceVersion?: number } = {},
) {
  return {
    created_at: "2026-07-14T00:00:00.000Z",
    credential_ref: candidateRef,
    delete_attempts: 0,
    deleted_at: state === "deleted" ? now : null,
    heartbeat_at: null,
    id: jobId,
    knowledge_space_id: spaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: null,
    lease_token: null,
    next_delete_at: state === "retired" || state === "deleted" ? now : null,
    operation_id: jobId,
    purpose: "backfill",
    recover_after: now,
    row_version: state === "candidate" ? 0 : 1,
    source_id: sourceId,
    source_version: overrides.sourceVersion ?? 7,
    state,
    tenant_id: tenantId,
    updated_at: now,
    worker_id: null,
  };
}

function sourceRow(
  credentialRef: string | null,
  version: number,
  metadata: Readonly<Record<string, unknown>>,
) {
  return {
    created_at: "2026-07-14T00:00:00.000Z",
    credential_ref: credentialRef,
    id: sourceId,
    knowledge_space_id: spaceId,
    metadata,
    name: "Legacy source",
    permission_scope: [],
    status: "active",
    type: "connector",
    updated_at: now,
    uri: "connector://legacy",
    version,
  };
}

function assertPlaceholderArity(
  calls: readonly DatabaseExecuteInput[],
  dialect: "postgres" | "tidb",
) {
  for (const call of calls) {
    if (dialect === "postgres") {
      const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
      expect(Math.max(0, ...positions), call.sql).toBe(call.params.length);
    } else {
      expect((call.sql.match(/\?/gu) ?? []).length, call.sql).toBe(call.params.length);
    }
  }
}
