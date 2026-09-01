import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { lockKnowledgeSpaceForRetrievalAdmission } from "./knowledge-space-deletion-admission";

const tableName = "retrieval_execution_leases";

export type RetrievalExecutionLeaseStatus = "active" | "expired" | "released";

export interface RetrievalExecutionLease {
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly leaseToken: string;
  readonly rowVersion: number;
  readonly status: RetrievalExecutionLeaseStatus;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly traceId: string;
  readonly updatedAt: string;
}

export interface RetrievalExecutionLeaseFence {
  readonly id: string;
  readonly leaseToken: string;
  readonly rowVersion: number;
  readonly tenantId: string;
}

export interface RetrievalExecutionLeaseRepository {
  acquire(input: {
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly leaseToken: string;
    readonly leaseTtlMs: number;
    readonly subjectId: string;
    readonly tenantId: string;
    readonly traceId: string;
  }): Promise<RetrievalExecutionLease>;
  assertActive(fence: RetrievalExecutionLeaseFence): Promise<RetrievalExecutionLease | null>;
  drainExpiredForSpace(input: {
    /** Immutable deletion-admission fence; leases admitted later must not prolong quiescence. */
    readonly acquiredBefore: string;
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly tenantId: string;
  }): Promise<{
    readonly expired: number;
    readonly hasExpiredRemaining: boolean;
    readonly hasLive: boolean;
  }>;
  heartbeat(
    fence: RetrievalExecutionLeaseFence & { readonly leaseTtlMs: number },
  ): Promise<RetrievalExecutionLease | null>;
  release(fence: RetrievalExecutionLeaseFence): Promise<RetrievalExecutionLease | null>;
}

export class RetrievalExecutionAdmissionError extends Error {
  readonly code = "RETRIEVAL_DELETION_IN_PROGRESS";

  constructor() {
    super("Knowledge space retrieval is unavailable while deletion is in progress");
    this.name = "RetrievalExecutionAdmissionError";
  }
}

export class RetrievalExecutionLeaseLostError extends Error {
  readonly code = "RETRIEVAL_EXECUTION_LEASE_LOST";

  constructor() {
    super("Retrieval execution lease was lost");
    this.name = "RetrievalExecutionLeaseLostError";
  }
}

export function createDatabaseRetrievalExecutionLeaseRepository({
  database,
  maxDrainBatchSize = 1_000,
  maxLeaseTtlMs = 10 * 60_000,
}: {
  readonly database: DatabaseAdapter;
  readonly maxDrainBatchSize?: number | undefined;
  readonly maxLeaseTtlMs?: number | undefined;
}): RetrievalExecutionLeaseRepository {
  positiveInteger(maxDrainBatchSize, "maxDrainBatchSize");
  positiveInteger(maxLeaseTtlMs, "maxLeaseTtlMs");

  const validateTtl = (ttlMs: number): void => {
    positiveInteger(ttlMs, "leaseTtlMs");
    if (ttlMs > maxLeaseTtlMs) {
      throw new Error(`Retrieval execution leaseTtlMs exceeds maxLeaseTtlMs=${maxLeaseTtlMs}`);
    }
  };

  return {
    acquire: async (input) => {
      validateTtl(input.leaseTtlMs);
      return database.transaction(async (transaction) => {
        if (!(await lockKnowledgeSpaceForRetrievalAdmission(database, transaction, input))) {
          throw new RetrievalExecutionAdmissionError();
        }

        const activeChildFence = await readActiveChildDeletionFence(
          database,
          transaction,
          input.tenantId,
          input.knowledgeSpaceId,
        );
        const databaseNow = await readRetrievalAdmissionDatabaseTime(database, transaction);
        const leaseBase = activeChildFence
          ? laterTimestamp(databaseNow, addMilliseconds(activeChildFence, 1))
          : databaseNow;
        const ttlParameter =
          database.dialect === "postgres" ? input.leaseTtlMs : input.leaseTtlMs * 1_000;
        const identityParams = [
          input.id,
          input.tenantId,
          input.knowledgeSpaceId,
          input.subjectId,
          input.traceId,
          input.leaseToken,
        ] satisfies readonly DatabaseQueryValue[];
        // PostgreSQL binds numbered placeholders by their suffix. TiDB binds anonymous `?` in
        // lexical order: the SELECT-list expiry placeholder appears before the derived-table
        // leaseBase placeholder even though their logical positions are rendered as 8 then 7.
        const params =
          database.dialect === "postgres"
            ? [...identityParams, leaseBase, ttlParameter]
            : [...identityParams, ttlParameter, leaseBase];
        const leaseClock = "lease_clock";
        const leaseBaseReference = `${leaseClock}.${q(database, "lease_base")}`;
        const leaseBaseParameter =
          database.dialect === "postgres" ? `${p(database, 7)}::timestamptz` : p(database, 7);
        const expiry =
          database.dialect === "postgres"
            ? `${leaseBaseReference} + (${p(database, 8)} * INTERVAL '1 millisecond')`
            : `DATE_ADD(${leaseBaseReference}, INTERVAL ${p(database, 8)} MICROSECOND)`;
        const insert = await transaction.execute({
          maxRows: database.dialect === "postgres" ? 1 : 0,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(database, tableName)} (${[
            "id",
            "tenant_id",
            "knowledge_space_id",
            "subject_id",
            "trace_id",
            "lease_token",
            "status",
            "row_version",
            "acquired_at",
            "heartbeat_at",
            "expires_at",
            "updated_at",
          ]
            .map((column) => q(database, column))
            .join(
              ", ",
            )}) SELECT ${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)}, 'active', 0, ${leaseBaseReference}, ${leaseBaseReference}, ${expiry}, ${leaseBaseReference} FROM (SELECT ${leaseBaseParameter} AS ${q(database, "lease_base")}) ${leaseClock}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
        if (insert.rowsAffected !== 1) {
          throw new Error("Retrieval execution lease was not acquired");
        }
        const row =
          insert.rows[0] ??
          (await selectLease(database, transaction, input.tenantId, input.id, input.leaseToken));
        if (!row) {
          throw new Error("Retrieval execution lease was not readable after acquisition");
        }
        return mapLease(row);
      });
    },

    assertActive: async (fence) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [fence.tenantId, fence.id, fence.leaseToken],
        sql: `SELECT * FROM ${q(database, tableName)} AS retrieval_lease WHERE retrieval_lease.${q(database, "tenant_id")} = ${p(database, 1)} AND retrieval_lease.${q(database, "id")} = ${p(database, 2)} AND retrieval_lease.${q(database, "lease_token")} = ${p(database, 3)} AND retrieval_lease.${q(database, "status")} = 'active' AND retrieval_lease.${q(database, "expires_at")} > CURRENT_TIMESTAMP AND NOT EXISTS (SELECT 1 FROM ${q(database, "deletion_jobs")} AS active_deletion WHERE active_deletion.${q(database, "tenant_id")} = retrieval_lease.${q(database, "tenant_id")} AND active_deletion.${q(database, "knowledge_space_id")} = retrieval_lease.${q(database, "knowledge_space_id")} AND active_deletion.${q(database, "active_slot")} = 1 AND active_deletion.${q(database, "target_type")} = 'knowledge_space' AND active_deletion.${q(database, "target_id")} = retrieval_lease.${q(database, "knowledge_space_id")}) LIMIT 1;`,
        tableName,
      });
      return result.rows[0] ? mapLease(result.rows[0]) : null;
    },

    drainExpiredForSpace: async ({ acquiredBefore, knowledgeSpaceId, limit, tenantId }) => {
      positiveInteger(limit, "limit");
      timestamp(acquiredBefore, "acquiredBefore");
      if (limit > maxDrainBatchSize) {
        throw new Error(
          `Retrieval execution lease drain limit exceeds maxDrainBatchSize=${maxDrainBatchSize}`,
        );
      }
      return database.transaction(async (transaction) => {
        // The existing (tenant_id, knowledge_space_id, status, expires_at, id) index still drives
        // the bounded stale/live scans. acquired_at is a residual immutable-fence predicate; it
        // does not replace the selective scope/status/expiry prefix or require a second index.
        const selected = await transaction.execute({
          maxRows: limit,
          operation: "select",
          params: [tenantId, knowledgeSpaceId, acquiredBefore, limit],
          sql: `SELECT ${q(database, "id")}, ${q(database, "lease_token")}, ${q(database, "row_version")} FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "acquired_at")} <= ${p(database, 3)} AND ${q(database, "status")} = 'active' AND ${q(database, "expires_at")} <= CURRENT_TIMESTAMP ORDER BY ${q(database, "expires_at")} ASC, ${q(database, "id")} ASC LIMIT ${p(database, 4)} FOR UPDATE;`,
          tableName,
        });
        let expired = 0;
        for (const row of selected.rows) {
          const result = await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [
              tenantId,
              stringColumn(row, "id"),
              stringColumn(row, "lease_token"),
              numberColumn(row, "row_version"),
            ],
            sql: `UPDATE ${q(database, tableName)} SET ${q(database, "status")} = 'expired', ${q(database, "row_version")} = ${q(database, "row_version")} + 1, ${q(database, "updated_at")} = CURRENT_TIMESTAMP WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "lease_token")} = ${p(database, 3)} AND ${q(database, "row_version")} = ${p(database, 4)} AND ${q(database, "status")} = 'active' AND ${q(database, "expires_at")} <= CURRENT_TIMESTAMP;`,
            tableName,
          });
          expired += result.rowsAffected;
        }
        const expiredRemaining = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [tenantId, knowledgeSpaceId, acquiredBefore],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "acquired_at")} <= ${p(database, 3)} AND ${q(database, "status")} = 'active' AND ${q(database, "expires_at")} <= CURRENT_TIMESTAMP LIMIT 1;`,
          tableName,
        });
        const live = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [tenantId, knowledgeSpaceId, acquiredBefore],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "acquired_at")} <= ${p(database, 3)} AND ${q(database, "status")} = 'active' AND ${q(database, "expires_at")} > CURRENT_TIMESTAMP LIMIT 1;`,
          tableName,
        });
        return {
          expired,
          hasExpiredRemaining: expiredRemaining.rows.length > 0,
          hasLive: live.rows.length > 0,
        };
      });
    },

    heartbeat: async (fence) => {
      validateTtl(fence.leaseTtlMs);
      return database.transaction(async (transaction) => {
        const ttlParameter =
          database.dialect === "postgres" ? fence.leaseTtlMs : fence.leaseTtlMs * 1_000;
        const currentTime =
          database.dialect === "postgres" ? "clock_timestamp()" : "CURRENT_TIMESTAMP(3)";
        const leaseBase = `GREATEST(${currentTime}, retrieval_lease.${q(database, "acquired_at")}, retrieval_lease.${q(database, "heartbeat_at")}, retrieval_lease.${q(database, "updated_at")})`;
        const expiry =
          database.dialect === "postgres"
            ? `${leaseBase} + (${p(database, 5)} * INTERVAL '1 millisecond')`
            : `DATE_ADD(${leaseBase}, INTERVAL ${p(database, 1)} MICROSECOND)`;
        const params =
          database.dialect === "postgres"
            ? [fence.tenantId, fence.id, fence.leaseToken, fence.rowVersion, ttlParameter]
            : [ttlParameter, fence.tenantId, fence.id, fence.leaseToken, fence.rowVersion];
        const tenantParameter = p(database, database.dialect === "postgres" ? 1 : 2);
        const idParameter = p(database, database.dialect === "postgres" ? 2 : 3);
        const tokenParameter = p(database, database.dialect === "postgres" ? 3 : 4);
        const rowVersionParameter = p(database, database.dialect === "postgres" ? 4 : 5);
        const result = await transaction.execute({
          maxRows: database.dialect === "postgres" ? 1 : 0,
          operation: "update",
          params,
          sql: `UPDATE ${q(database, tableName)} AS retrieval_lease SET ${q(database, "heartbeat_at")} = ${leaseBase}, ${q(database, "expires_at")} = ${expiry}, ${q(database, "updated_at")} = ${leaseBase}, ${q(database, "row_version")} = retrieval_lease.${q(database, "row_version")} + 1 WHERE retrieval_lease.${q(database, "tenant_id")} = ${tenantParameter} AND retrieval_lease.${q(database, "id")} = ${idParameter} AND retrieval_lease.${q(database, "lease_token")} = ${tokenParameter} AND retrieval_lease.${q(database, "row_version")} = ${rowVersionParameter} AND retrieval_lease.${q(database, "status")} = 'active' AND retrieval_lease.${q(database, "expires_at")} > ${currentTime} AND NOT EXISTS (SELECT 1 FROM ${q(database, "deletion_jobs")} AS active_deletion WHERE active_deletion.${q(database, "tenant_id")} = retrieval_lease.${q(database, "tenant_id")} AND active_deletion.${q(database, "knowledge_space_id")} = retrieval_lease.${q(database, "knowledge_space_id")} AND active_deletion.${q(database, "active_slot")} = 1 AND active_deletion.${q(database, "target_type")} = 'knowledge_space' AND active_deletion.${q(database, "target_id")} = retrieval_lease.${q(database, "knowledge_space_id")})${database.dialect === "postgres" ? " RETURNING retrieval_lease.*" : ""};`,
          tableName,
        });
        if (result.rowsAffected !== 1) return null;
        const row =
          result.rows[0] ??
          (await selectLease(database, transaction, fence.tenantId, fence.id, fence.leaseToken));
        return row ? mapLease(row) : null;
      });
    },

    release: async (fence) =>
      database.transaction(async (transaction) => {
        const currentTime =
          database.dialect === "postgres" ? "clock_timestamp()" : "CURRENT_TIMESTAMP(3)";
        const leaseBase = `GREATEST(${currentTime}, retrieval_lease.${q(database, "acquired_at")}, retrieval_lease.${q(database, "heartbeat_at")}, retrieval_lease.${q(database, "updated_at")})`;
        const result = await transaction.execute({
          maxRows: database.dialect === "postgres" ? 1 : 0,
          operation: "update",
          params: [fence.tenantId, fence.id, fence.leaseToken, fence.rowVersion],
          sql: `UPDATE ${q(database, tableName)} AS retrieval_lease SET ${q(database, "status")} = 'released', ${q(database, "updated_at")} = ${leaseBase}, ${q(database, "row_version")} = retrieval_lease.${q(database, "row_version")} + 1 WHERE retrieval_lease.${q(database, "tenant_id")} = ${p(database, 1)} AND retrieval_lease.${q(database, "id")} = ${p(database, 2)} AND retrieval_lease.${q(database, "lease_token")} = ${p(database, 3)} AND retrieval_lease.${q(database, "row_version")} = ${p(database, 4)} AND retrieval_lease.${q(database, "status")} = 'active'${database.dialect === "postgres" ? " RETURNING retrieval_lease.*" : ""};`,
          tableName,
        });
        if (result.rowsAffected !== 1) return null;
        const row =
          result.rows[0] ??
          (await selectLease(database, transaction, fence.tenantId, fence.id, fence.leaseToken));
        return row ? mapLease(row) : null;
      }),
  };
}

export interface ActiveRetrievalExecutionLease {
  readonly signal: AbortSignal;
  assertActive(): Promise<void>;
  release(): Promise<void>;
}

export interface RetrievalExecutionLeaseCoordinator {
  acquire(input: {
    readonly knowledgeSpaceId: string;
    readonly subjectId: string;
    readonly tenantId: string;
    readonly traceId: string;
  }): Promise<ActiveRetrievalExecutionLease>;
}

export function createRetrievalExecutionLeaseCoordinator({
  generateId = randomUUID,
  generateToken = randomUUID,
  heartbeatIntervalMs,
  leaseTtlMs,
  repository,
}: {
  readonly generateId?: (() => string) | undefined;
  readonly generateToken?: (() => string) | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly leaseTtlMs: number;
  readonly repository: RetrievalExecutionLeaseRepository;
}): RetrievalExecutionLeaseCoordinator {
  positiveInteger(leaseTtlMs, "leaseTtlMs");
  const intervalMs = heartbeatIntervalMs ?? Math.max(1_000, Math.floor(leaseTtlMs / 3));
  positiveInteger(intervalMs, "heartbeatIntervalMs");
  if (intervalMs >= leaseTtlMs) {
    throw new Error("Retrieval execution heartbeatIntervalMs must be less than leaseTtlMs");
  }

  return {
    async acquire(input) {
      let lease = await repository.acquire({
        id: generateId(),
        knowledgeSpaceId: input.knowledgeSpaceId,
        leaseToken: generateToken(),
        leaseTtlMs,
        subjectId: input.subjectId,
        tenantId: input.tenantId,
        traceId: input.traceId,
      });
      // The durable TTL starts when the database inserts the lease, which may be after an
      // arbitrarily long space-lock wait. Starting the local guard from the observed successful
      // result avoids treating a newly issued lease as already expired.
      const acquisitionObservedAt = performance.now();
      let closed = false;
      let lost = false;
      let operation = Promise.resolve();
      let expiryTimer: ReturnType<typeof setTimeout> | undefined;
      let heartbeatInFlight = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let releasePromise: Promise<void> | undefined;
      const abort = new AbortController();

      const stopTimers = (): void => {
        if (expiryTimer !== undefined) clearTimeout(expiryTimer);
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
        expiryTimer = undefined;
        heartbeatTimer = undefined;
      };
      const lose = (): RetrievalExecutionLeaseLostError => {
        lost = true;
        stopTimers();
        const error = new RetrievalExecutionLeaseLostError();
        if (!abort.signal.aborted) abort.abort(error);
        return error;
      };
      const armExpiryDeadline = (
        databaseLease: RetrievalExecutionLease,
        monotonicAnchor: number,
      ): void => {
        if (closed || lost) return;
        if (expiryTimer !== undefined) clearTimeout(expiryTimer);
        const expiresAt = Date.parse(databaseLease.expiresAt);
        const heartbeatAt = Date.parse(databaseLease.heartbeatAt);
        const durableTtlMs = expiresAt - heartbeatAt;
        if (!Number.isFinite(durableTtlMs) || durableTtlMs <= 0) throw lose();
        // Database and application wall clocks may have different offsets. Anchor the durable TTL
        // to a local monotonic call-start time so repository latency is deducted and clock skew
        // cannot make the guard fire immediately or years late.
        const remainingMs = monotonicAnchor + durableTtlMs - performance.now();
        if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
          lose();
          return;
        }
        expiryTimer = setTimeout(() => {
          if (!closed && !lost) lose();
        }, remainingMs);
        expiryTimer.unref?.();
      };
      const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
        const next = operation.then(run, run);
        operation = next.then(
          () => undefined,
          () => undefined,
        );
        return next;
      };
      const heartbeat = async (): Promise<void> => {
        if (closed || lost || heartbeatInFlight) return;
        heartbeatInFlight = true;
        try {
          await exclusive(async () => {
            if (closed || lost) return;
            const heartbeatStartedAt = performance.now();
            const updated = await repository.heartbeat({ ...fence(lease), leaseTtlMs });
            if (closed || lost) return;
            if (!updated) throw lose();
            lease = updated;
            armExpiryDeadline(updated, heartbeatStartedAt);
          });
        } finally {
          heartbeatInFlight = false;
        }
      };
      // A repository exception can be a transient database/network failure and is not proof that
      // the fenced row was lost. Keep the lease until a later heartbeat or explicit assertion can
      // observe the durable state. A successful repository call returning null still invokes
      // lose() inside heartbeat and aborts immediately.
      armExpiryDeadline(lease, acquisitionObservedAt);
      heartbeatTimer = setInterval(() => void heartbeat().catch(() => undefined), intervalMs);
      heartbeatTimer.unref?.();

      return {
        signal: abort.signal,
        async assertActive() {
          if (closed || lost) throw new RetrievalExecutionLeaseLostError();
          await exclusive(async () => {
            if (closed || lost) throw new RetrievalExecutionLeaseLostError();
            const active = await repository.assertActive(fence(lease));
            if (closed || lost) throw new RetrievalExecutionLeaseLostError();
            if (!active) throw lose();
            lease = active;
          });
        },
        async release() {
          if (closed) return;
          if (releasePromise) return releasePromise;
          if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
          releasePromise = (async () => {
            if (lost) {
              closed = true;
              stopTimers();
              return;
            }
            let removeAbortListener: () => void = () => undefined;
            const aborted = abort.signal.aborted
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  const onAbort = () => resolve();
                  abort.signal.addEventListener("abort", onAbort, { once: true });
                  removeAbortListener = () => abort.signal.removeEventListener("abort", onAbort);
                });
            try {
              await Promise.race([
                exclusive(async () => {
                  if (lost) return;
                  const released = await repository.release(fence(lease));
                  if (!released && !lost) throw lose();
                  if (released) lease = released;
                }),
                aborted,
              ]);
            } finally {
              removeAbortListener();
              closed = true;
              stopTimers();
            }
          })();
          return releasePromise;
        },
      };
    },
  };
}

function fence(lease: RetrievalExecutionLease): RetrievalExecutionLeaseFence {
  return {
    id: lease.id,
    leaseToken: lease.leaseToken,
    rowVersion: lease.rowVersion,
    tenantId: lease.tenantId,
  };
}

async function readActiveChildDeletionFence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
): Promise<string | undefined> {
  const deletionAlias = "active_child";
  const rawFence = `COALESCE(${deletionAlias}.${q(database, "started_at")}, ${deletionAlias}.${q(database, "created_at")})`;
  // New fences are millisecond-aligned. Round a legacy PostgreSQL microsecond value upward before
  // adding the post-fence tick so application timestamp parsing can never weaken the ordering.
  const deletionFence =
    database.dialect === "postgres"
      ? `CASE WHEN ${rawFence} = date_trunc('milliseconds', ${rawFence}) THEN ${rawFence} ELSE date_trunc('milliseconds', ${rawFence}) + INTERVAL '1 millisecond' END`
      : rawFence;
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, knowledgeSpaceId],
    // The space lock prevents new child admissions. FOR UPDATE makes this a current TiDB read and
    // freezes the legacy COALESCE value while this retrieval admission is committed.
    sql: `SELECT ${deletionFence} AS ${q(database, "deletion_fence")} FROM ${q(database, "deletion_jobs")} ${deletionAlias} WHERE ${deletionAlias}.${q(database, "tenant_id")} = ${p(database, 1)} AND ${deletionAlias}.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${deletionAlias}.${q(database, "active_slot")} = 1 AND ${deletionAlias}.${q(database, "target_type")} <> 'knowledge_space' ORDER BY ${rawFence} DESC, ${deletionAlias}.${q(database, "id")} DESC LIMIT 1 FOR UPDATE;`,
    tableName: "deletion_jobs",
  });
  const row = result.rows[0];
  if (!row) return undefined;
  const value = timestampColumn(row, "deletion_fence");
  timestamp(value, "active child deletion fence");
  return value;
}

async function readRetrievalAdmissionDatabaseTime(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
): Promise<string> {
  const currentTime =
    database.dialect === "postgres"
      ? "date_trunc('milliseconds', clock_timestamp())"
      : "CURRENT_TIMESTAMP(3)";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [],
    sql: `SELECT ${currentTime} AS ${q(database, "database_now")};`,
    tableName,
  });
  const row = result.rows[0];
  if (!row) throw new Error("Retrieval execution admission clock was not readable");
  const value = timestampColumn(row, "database_now");
  timestamp(value, "admission database time");
  return value;
}

function addMilliseconds(value: string, milliseconds: number): string {
  const result = new Date(Date.parse(value) + milliseconds);
  if (!Number.isFinite(result.getTime())) {
    throw new Error("Retrieval execution admission fence is outside the supported date range");
  }
  return result.toISOString();
}

function laterTimestamp(first: string, second: string): string {
  return Date.parse(second) > Date.parse(first) ? second : first;
}

async function selectLease(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  id: string,
  leaseToken: string,
): Promise<DatabaseRow | undefined> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, id, leaseToken],
    sql: `SELECT * FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "lease_token")} = ${p(database, 3)} LIMIT 1;`,
    tableName,
  });
  return result.rows[0];
}

function mapLease(row: DatabaseRow): RetrievalExecutionLease {
  const status = stringColumn(row, "status");
  if (status !== "active" && status !== "expired" && status !== "released") {
    throw new Error("Retrieval execution lease status is invalid");
  }
  return {
    acquiredAt: timestampColumn(row, "acquired_at"),
    expiresAt: timestampColumn(row, "expires_at"),
    heartbeatAt: timestampColumn(row, "heartbeat_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    leaseToken: stringColumn(row, "lease_token"),
    rowVersion: numberColumn(row, "row_version"),
    status,
    subjectId: stringColumn(row, "subject_id"),
    tenantId: stringColumn(row, "tenant_id"),
    traceId: stringColumn(row, "trace_id"),
    updatedAt: timestampColumn(row, "updated_at"),
  };
}

function timestampColumn(row: DatabaseRow, column: string): string {
  const value = row[column];
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return stringColumn(row, column);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Retrieval execution ${field} must be a positive integer`);
  }
}

function timestamp(value: string, field: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Retrieval execution ${field} must be an ISO date-time`);
  }
}
