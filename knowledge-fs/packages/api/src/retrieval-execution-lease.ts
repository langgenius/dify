import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

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
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, input))) {
          throw new RetrievalExecutionAdmissionError();
        }

        const ttlParameter =
          database.dialect === "postgres" ? input.leaseTtlMs : input.leaseTtlMs * 1_000;
        const params = [
          input.id,
          input.tenantId,
          input.knowledgeSpaceId,
          input.subjectId,
          input.traceId,
          input.leaseToken,
          ttlParameter,
        ] satisfies readonly DatabaseQueryValue[];
        const timestamp =
          database.dialect === "postgres" ? "CURRENT_TIMESTAMP" : "CURRENT_TIMESTAMP(3)";
        const expiry =
          database.dialect === "postgres"
            ? `${timestamp} + (${p(database, 7)} * INTERVAL '1 millisecond')`
            : `DATE_ADD(${timestamp}, INTERVAL ${p(database, 7)} MICROSECOND)`;
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
            )}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)}, 'active', 0, ${timestamp}, ${timestamp}, ${expiry}, ${timestamp})${database.dialect === "postgres" ? " RETURNING *" : ""};`,
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
        sql: `SELECT * FROM ${q(database, tableName)} AS retrieval_lease WHERE retrieval_lease.${q(database, "tenant_id")} = ${p(database, 1)} AND retrieval_lease.${q(database, "id")} = ${p(database, 2)} AND retrieval_lease.${q(database, "lease_token")} = ${p(database, 3)} AND retrieval_lease.${q(database, "status")} = 'active' AND retrieval_lease.${q(database, "expires_at")} > CURRENT_TIMESTAMP AND NOT EXISTS (SELECT 1 FROM ${q(database, "deletion_jobs")} AS active_deletion WHERE active_deletion.${q(database, "tenant_id")} = retrieval_lease.${q(database, "tenant_id")} AND active_deletion.${q(database, "knowledge_space_id")} = retrieval_lease.${q(database, "knowledge_space_id")} AND active_deletion.${q(database, "active_slot")} = 1) LIMIT 1;`,
        tableName,
      });
      return result.rows[0] ? mapLease(result.rows[0]) : null;
    },

    drainExpiredForSpace: async ({ knowledgeSpaceId, limit, tenantId }) => {
      positiveInteger(limit, "limit");
      if (limit > maxDrainBatchSize) {
        throw new Error(
          `Retrieval execution lease drain limit exceeds maxDrainBatchSize=${maxDrainBatchSize}`,
        );
      }
      return database.transaction(async (transaction) => {
        const selected = await transaction.execute({
          maxRows: limit,
          operation: "select",
          params: [tenantId, knowledgeSpaceId, limit],
          sql: `SELECT ${q(database, "id")}, ${q(database, "lease_token")}, ${q(database, "row_version")} FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "status")} = 'active' AND ${q(database, "expires_at")} <= CURRENT_TIMESTAMP ORDER BY ${q(database, "expires_at")} ASC, ${q(database, "id")} ASC LIMIT ${p(database, 3)} FOR UPDATE;`,
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
          params: [tenantId, knowledgeSpaceId],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "status")} = 'active' AND ${q(database, "expires_at")} <= CURRENT_TIMESTAMP LIMIT 1;`,
          tableName,
        });
        const live = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [tenantId, knowledgeSpaceId],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "status")} = 'active' AND ${q(database, "expires_at")} > CURRENT_TIMESTAMP LIMIT 1;`,
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
        const expiry =
          database.dialect === "postgres"
            ? `CURRENT_TIMESTAMP + (${p(database, 5)} * INTERVAL '1 millisecond')`
            : `DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${p(database, 5)} MICROSECOND)`;
        const result = await transaction.execute({
          maxRows: database.dialect === "postgres" ? 1 : 0,
          operation: "update",
          params: [fence.tenantId, fence.id, fence.leaseToken, fence.rowVersion, ttlParameter],
          sql: `UPDATE ${q(database, tableName)} AS retrieval_lease SET ${q(database, "heartbeat_at")} = CURRENT_TIMESTAMP, ${q(database, "expires_at")} = ${expiry}, ${q(database, "updated_at")} = CURRENT_TIMESTAMP, ${q(database, "row_version")} = retrieval_lease.${q(database, "row_version")} + 1 WHERE retrieval_lease.${q(database, "tenant_id")} = ${p(database, 1)} AND retrieval_lease.${q(database, "id")} = ${p(database, 2)} AND retrieval_lease.${q(database, "lease_token")} = ${p(database, 3)} AND retrieval_lease.${q(database, "row_version")} = ${p(database, 4)} AND retrieval_lease.${q(database, "status")} = 'active' AND retrieval_lease.${q(database, "expires_at")} > CURRENT_TIMESTAMP AND NOT EXISTS (SELECT 1 FROM ${q(database, "deletion_jobs")} AS active_deletion WHERE active_deletion.${q(database, "tenant_id")} = retrieval_lease.${q(database, "tenant_id")} AND active_deletion.${q(database, "knowledge_space_id")} = retrieval_lease.${q(database, "knowledge_space_id")} AND active_deletion.${q(database, "active_slot")} = 1)${database.dialect === "postgres" ? " RETURNING retrieval_lease.*" : ""};`,
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
        const result = await transaction.execute({
          maxRows: database.dialect === "postgres" ? 1 : 0,
          operation: "update",
          params: [fence.tenantId, fence.id, fence.leaseToken, fence.rowVersion],
          sql: `UPDATE ${q(database, tableName)} SET ${q(database, "status")} = 'released', ${q(database, "updated_at")} = CURRENT_TIMESTAMP, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "lease_token")} = ${p(database, 3)} AND ${q(database, "row_version")} = ${p(database, 4)} AND ${q(database, "status")} = 'active'${database.dialect === "postgres" ? " RETURNING *" : ""};`,
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
      let closed = false;
      let lost = false;
      let operation = Promise.resolve();
      const abort = new AbortController();

      const lose = (): RetrievalExecutionLeaseLostError => {
        lost = true;
        const error = new RetrievalExecutionLeaseLostError();
        if (!abort.signal.aborted) abort.abort(error);
        return error;
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
        if (closed || lost) return;
        await exclusive(async () => {
          if (closed || lost) return;
          const updated = await repository.heartbeat({ ...fence(lease), leaseTtlMs });
          if (!updated) throw lose();
          lease = updated;
        });
      };
      const timer = setInterval(() => void heartbeat().catch(() => lose()), intervalMs);
      timer.unref?.();

      return {
        signal: abort.signal,
        async assertActive() {
          if (closed || lost) throw new RetrievalExecutionLeaseLostError();
          await exclusive(async () => {
            if (closed || lost) throw new RetrievalExecutionLeaseLostError();
            const active = await repository.assertActive(fence(lease));
            if (!active) throw lose();
            lease = active;
          });
        },
        async release() {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          await exclusive(async () => {
            const released = await repository.release(fence(lease));
            if (!released && !lost) throw lose();
            if (released) lease = released;
          });
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
