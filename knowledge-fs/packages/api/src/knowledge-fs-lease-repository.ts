import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type KnowledgeFsLease,
  KnowledgeFsLeaseSchema,
} from "@knowledge/core";

import { optionalNumberColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

export interface KnowledgeFsLeaseLookupInput {
  readonly id: string;
  readonly tenantId: string;
}

export interface KnowledgeFsLeaseHeartbeatInput extends KnowledgeFsLeaseLookupInput {
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeFsLeaseReleaseInput extends KnowledgeFsLeaseLookupInput {
  readonly status: "released" | "failed" | "expired";
  readonly updatedAt: string;
}

export interface KnowledgeFsLeaseListExpiredInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly now: string;
  readonly tenantId: string;
}

export interface KnowledgeFsLeaseListActiveInput extends KnowledgeFsLeaseListExpiredInput {
  readonly knowledgeSpaceId: string;
}

export interface KnowledgeFsLeaseListResult {
  readonly items: readonly KnowledgeFsLease[];
  readonly nextCursor?: string | undefined;
}

export interface KnowledgeFsLeaseRepository {
  acquire(input: KnowledgeFsLease): Promise<KnowledgeFsLease>;
  delete(input: KnowledgeFsLeaseLookupInput): Promise<KnowledgeFsLease | null>;
  get(input: KnowledgeFsLeaseLookupInput): Promise<KnowledgeFsLease | null>;
  heartbeat(input: KnowledgeFsLeaseHeartbeatInput): Promise<KnowledgeFsLease | null>;
  listActive(input: KnowledgeFsLeaseListActiveInput): Promise<KnowledgeFsLeaseListResult>;
  listExpired(input: KnowledgeFsLeaseListExpiredInput): Promise<KnowledgeFsLeaseListResult>;
  release(input: KnowledgeFsLeaseReleaseInput): Promise<KnowledgeFsLease | null>;
}

export interface InMemoryKnowledgeFsLeaseRepositoryOptions {
  readonly maxLeases: number;
  readonly maxListLimit: number;
}

export interface DatabaseKnowledgeFsLeaseRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxListLimit: number;
}

export class KnowledgeFsLeaseCapacityExceededError extends Error {
  constructor(maxLeases: number) {
    super(`KnowledgeFS lease repository maxLeases=${maxLeases} exceeded`);
  }
}

export class KnowledgeFsLeaseConflictError extends Error {
  constructor(lease: KnowledgeFsLease, conflictingLease: KnowledgeFsLease) {
    super(
      `KnowledgeFS lease conflict for ${lease.virtualPath}: ${lease.leaseType} conflicts with ${conflictingLease.leaseType}`,
    );
  }
}

export class KnowledgeFsLeaseListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`KnowledgeFS lease repository maxListLimit=${maxListLimit} exceeded`);
  }
}

export class KnowledgeFsLeaseDeletionFenceActiveError extends Error {
  constructor() {
    super("KnowledgeFS lease acquisition is unavailable while durable deletion is active");
  }
}

export function createInMemoryKnowledgeFsLeaseRepository({
  maxLeases,
  maxListLimit,
}: InMemoryKnowledgeFsLeaseRepositoryOptions): KnowledgeFsLeaseRepository {
  if (!Number.isSafeInteger(maxLeases) || maxLeases < 1) {
    throw new Error("KnowledgeFS lease repository maxLeases must be at least 1");
  }

  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("KnowledgeFS lease repository maxListLimit must be at least 1");
  }

  const leases = new Map<string, KnowledgeFsLease>();

  return {
    async acquire(input) {
      const lease = cloneLease(KnowledgeFsLeaseSchema.parse(input));
      const key = leaseKey(lease.tenantId, lease.id);

      if (!leases.has(key) && leases.size >= maxLeases) {
        throw new KnowledgeFsLeaseCapacityExceededError(maxLeases);
      }

      const conflict = findConflictingLease(leases, lease);

      if (conflict) {
        throw new KnowledgeFsLeaseConflictError(lease, conflict);
      }

      leases.set(key, cloneLease(lease));

      return cloneLease(lease);
    },

    async delete({ id, tenantId }) {
      const key = leaseKey(tenantId, id);
      const lease = leases.get(key);

      if (!lease) {
        return null;
      }

      leases.delete(key);

      return cloneLease(lease);
    },

    async get({ id, tenantId }) {
      const lease = leases.get(leaseKey(tenantId, id));

      return lease ? cloneLease(lease) : null;
    },

    async heartbeat({ expiresAt, heartbeatAt, id, tenantId, updatedAt }) {
      const key = leaseKey(tenantId, id);
      const current = leases.get(key);

      if (!current) {
        return null;
      }

      const updated = cloneLease(
        KnowledgeFsLeaseSchema.parse({
          ...current,
          expiresAt,
          heartbeatAt,
          updatedAt,
        }),
      );
      leases.set(key, cloneLease(updated));

      return cloneLease(updated);
    },

    async listActive({ cursor, knowledgeSpaceId, limit, now, tenantId }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
        throw new KnowledgeFsLeaseListLimitExceededError(maxListLimit);
      }

      const cursorTuple = cursor ? decodeExpiredLeaseCursor(cursor) : null;
      const active = Array.from(leases.values())
        .filter((lease) => lease.tenantId === tenantId)
        .filter((lease) => lease.knowledgeSpaceId === knowledgeSpaceId)
        .filter((lease) => lease.status === "active")
        .filter((lease) => lease.expiresAt > now)
        .sort(compareExpiredLeases)
        .filter((lease) => (cursorTuple ? compareExpiredLeaseTuple(lease, cursorTuple) > 0 : true));
      const page = active.slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneLease);
      const nextLease = page.at(limit);

      return {
        items,
        ...(nextLease === undefined ? {} : { nextCursor: encodeExpiredLeaseCursor(items.at(-1)) }),
      };
    },

    async listExpired({ cursor, limit, now, tenantId }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
        throw new KnowledgeFsLeaseListLimitExceededError(maxListLimit);
      }

      const cursorTuple = cursor ? decodeExpiredLeaseCursor(cursor) : null;
      const expired = Array.from(leases.values())
        .filter((lease) => lease.tenantId === tenantId)
        .filter((lease) => lease.expiresAt <= now)
        .sort(compareExpiredLeases)
        .filter((lease) => (cursorTuple ? compareExpiredLeaseTuple(lease, cursorTuple) > 0 : true));
      const page = expired.slice(0, limit);
      const nextLease = expired.at(limit);

      return {
        items: page.map(cloneLease),
        ...(nextLease === undefined ? {} : { nextCursor: encodeExpiredLeaseCursor(page.at(-1)) }),
      };
    },

    async release({ id, status, tenantId, updatedAt }) {
      const key = leaseKey(tenantId, id);
      const current = leases.get(key);

      if (!current) {
        return null;
      }

      const updated = cloneLease(
        KnowledgeFsLeaseSchema.parse({
          ...current,
          status,
          updatedAt,
        }),
      );
      leases.set(key, cloneLease(updated));

      return cloneLease(updated);
    },
  };
}

export function createDatabaseKnowledgeFsLeaseRepository({
  database,
  maxListLimit,
}: DatabaseKnowledgeFsLeaseRepositoryOptions): KnowledgeFsLeaseRepository {
  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("KnowledgeFS lease repository maxListLimit must be at least 1");
  }
  const tableName = "knowledge_fs_leases";
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);

  return {
    async acquire(input) {
      const lease = cloneLease(KnowledgeFsLeaseSchema.parse(input));
      return database.transaction(async (transaction) => {
        if (
          !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
            knowledgeSpaceId: lease.knowledgeSpaceId,
            tenantId: lease.tenantId,
          }))
        ) {
          throw new KnowledgeFsLeaseDeletionFenceActiveError();
        }
        if (lease.leaseType !== "read") {
          const conflict = await transaction.execute({
            maxRows: 1,
            operation: "select",
            params: [
              lease.tenantId,
              lease.knowledgeSpaceId,
              lease.virtualPath,
              lease.id,
              lease.acquiredAt,
            ],
            sql: `SELECT * FROM ${q(tableName)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("virtual_path")} = ${p(3)} AND ${q("id")} <> ${p(4)} AND ${q("status")} = 'active' AND ${q("expires_at")} > ${p(5)} AND ${q("lease_type")} <> 'read' LIMIT 1 FOR UPDATE;`,
            tableName,
          });
          if (conflict.rows[0]) {
            throw new KnowledgeFsLeaseConflictError(
              lease,
              mapDatabaseKnowledgeFsLease(conflict.rows[0]),
            );
          }
        }
        const columns = [
          "id",
          "tenant_id",
          "knowledge_space_id",
          "session_id",
          "lease_type",
          "target_type",
          "target_id",
          "target_version",
          "virtual_path",
          "status",
          "heartbeat_at",
          "expires_at",
          "metadata",
          "acquired_at",
          "updated_at",
        ] as const;
        const params = [
          lease.id,
          lease.tenantId,
          lease.knowledgeSpaceId,
          lease.sessionId,
          lease.leaseType,
          lease.targetType,
          lease.targetId,
          lease.targetVersion ?? null,
          lease.virtualPath,
          lease.status,
          lease.heartbeatAt,
          lease.expiresAt,
          JSON.stringify(lease.metadata),
          lease.acquiredAt,
          lease.updatedAt,
        ] satisfies readonly DatabaseQueryValue[];
        const result = await transaction.execute({
          maxRows: 1,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(tableName)} (${columns.map(q).join(", ")}) SELECT ${columns
            .map((column, index) => jsonInsertPlaceholder(database, index + 1, column))
            .join(
              ", ",
            )} FROM ${q("knowledge_spaces")} AS lease_space INNER JOIN ${q("knowledge_fs_sessions")} AS lease_session ON lease_session.${q("tenant_id")} = ${p(2)} AND lease_session.${q("knowledge_space_id")} = ${p(3)} AND lease_session.${q("id")} = ${p(4)} AND lease_session.${q("expires_at")} > ${p(14)} WHERE lease_space.${q("tenant_id")} = ${p(2)} AND lease_space.${q("id")} = ${p(3)} AND lease_space.${q("lifecycle_state")} = 'active' AND lease_space.${q("deletion_job_id")} IS NULL AND NOT EXISTS (SELECT 1 FROM ${q("deletion_jobs")} AS active_deletion WHERE active_deletion.${q("tenant_id")} = ${p(2)} AND active_deletion.${q("knowledge_space_id")} = ${p(3)} AND active_deletion.${q("active_slot")} = 1)${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
        if (result.rowsAffected !== 1 && result.rows.length !== 1) {
          throw new KnowledgeFsLeaseDeletionFenceActiveError();
        }
        return result.rows[0] ? mapDatabaseKnowledgeFsLease(result.rows[0]) : lease;
      });
    },
    async delete({ id, tenantId }) {
      return database.transaction(async (transaction) => {
        const current = await databaseKnowledgeFsLeaseGet(database, transaction, {
          id,
          tenantId,
        });
        if (!current) return null;
        await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [tenantId, id],
          sql: `DELETE FROM ${q(tableName)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)};`,
          tableName,
        });
        return current;
      });
    },
    get: (input) => databaseKnowledgeFsLeaseGet(database, database, input),
    async heartbeat({ expiresAt, heartbeatAt, id, tenantId, updatedAt }) {
      return database.transaction(async (transaction) => {
        const scope = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [tenantId, id],
          sql: `SELECT ${q("knowledge_space_id")} FROM ${q(tableName)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)} LIMIT 1;`,
          tableName,
        });
        const knowledgeSpaceId = scope.rows[0]?.knowledge_space_id;
        if (
          typeof knowledgeSpaceId !== "string" ||
          !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
            knowledgeSpaceId,
            tenantId,
          }))
        ) {
          return null;
        }
        return updateDatabaseKnowledgeFsLease(database, {
          executor: transaction,
          fields: [
            ["expires_at", expiresAt],
            ["heartbeat_at", heartbeatAt],
            ["updated_at", updatedAt],
          ],
          fenced: false,
          id,
          tenantId,
        });
      });
    },
    async listActive({ cursor, knowledgeSpaceId, limit, now, tenantId }) {
      validateDatabaseLeaseListLimit(limit, maxListLimit);
      return databaseKnowledgeFsLeaseList(database, {
        active: true,
        cursor,
        knowledgeSpaceId,
        limit,
        now,
        tenantId,
      });
    },
    async listExpired({ cursor, limit, now, tenantId }) {
      validateDatabaseLeaseListLimit(limit, maxListLimit);
      return databaseKnowledgeFsLeaseList(database, {
        active: false,
        cursor,
        limit,
        now,
        tenantId,
      });
    },
    async release({ id, status, tenantId, updatedAt }) {
      return updateDatabaseKnowledgeFsLease(database, {
        fields: [
          ["status", status],
          ["updated_at", updatedAt],
        ],
        fenced: false,
        id,
        tenantId,
      });
    },
  };
}

async function databaseKnowledgeFsLeaseGet(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeFsLeaseLookupInput,
): Promise<KnowledgeFsLease | null> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.id],
    sql: `SELECT * FROM ${q("knowledge_fs_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${knowledgeFsLeaseReadableSql(database, "knowledge_fs_leases")} LIMIT 1;`,
    tableName: "knowledge_fs_leases",
  });
  return result.rows[0] ? mapDatabaseKnowledgeFsLease(result.rows[0]) : null;
}

function knowledgeFsLeaseReadableSql(database: DatabaseAdapter, table: string): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  return `NOT EXISTS (SELECT 1 FROM ${q("deletion_jobs")} AS active_deletion WHERE active_deletion.${q("tenant_id")} = ${q(table)}.${q("tenant_id")} AND active_deletion.${q("knowledge_space_id")} = ${q(table)}.${q("knowledge_space_id")} AND active_deletion.${q("active_slot")} = 1)`;
}

async function updateDatabaseKnowledgeFsLease(
  database: DatabaseAdapter,
  input: {
    readonly executor?: DatabaseExecutor | undefined;
    readonly fields: readonly (readonly [string, DatabaseQueryValue])[];
    readonly fenced: boolean;
    readonly id: string;
    readonly tenantId: string;
  },
): Promise<KnowledgeFsLease | null> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = input.fields.map((field) => field[1]);
  params.push(input.tenantId, input.id);
  const tenantPosition = input.fields.length + 1;
  const idPosition = input.fields.length + 2;
  const executor = input.executor ?? database;
  const result = await executor.execute({
    maxRows: 1,
    operation: "update",
    params,
    sql: `UPDATE ${q("knowledge_fs_leases")} SET ${input.fields
      .map(([column], index) => `${q(column)} = ${p(index + 1)}`)
      .join(
        ", ",
      )} WHERE ${q("tenant_id")} = ${p(tenantPosition)} AND ${q("id")} = ${p(idPosition)}${input.fenced ? ` AND ${knowledgeFsLeaseReadableSql(database, "knowledge_fs_leases")}` : ""}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
    tableName: "knowledge_fs_leases",
  });
  if (result.rows[0]) return mapDatabaseKnowledgeFsLease(result.rows[0]);
  return result.rowsAffected > 0
    ? databaseKnowledgeFsLeaseGet(database, executor, {
        id: input.id,
        tenantId: input.tenantId,
      })
    : null;
}

async function databaseKnowledgeFsLeaseList(
  database: DatabaseAdapter,
  input: {
    readonly active: boolean;
    readonly cursor?: string | undefined;
    readonly knowledgeSpaceId?: string | undefined;
    readonly limit: number;
    readonly now: string;
    readonly tenantId: string;
  },
): Promise<KnowledgeFsLeaseListResult> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const cursor = input.cursor ? decodeExpiredLeaseCursor(input.cursor) : undefined;
  const params: DatabaseQueryValue[] = [input.tenantId];
  let scope = "";
  if (input.knowledgeSpaceId) {
    params.push(input.knowledgeSpaceId);
    scope = ` AND ${q("knowledge_space_id")} = ${p(params.length)}`;
  }
  params.push(input.now);
  const nowPosition = params.length;
  let cursorSql = "";
  if (cursor) {
    params.push(cursor.expiresAt, cursor.expiresAt, cursor.id);
    cursorSql = ` AND (${q("expires_at")} > ${p(params.length - 2)} OR (${q("expires_at")} = ${p(params.length - 1)} AND ${q("id")} > ${p(params.length)}))`;
  }
  params.push(input.limit + 1);
  const result = await database.execute({
    maxRows: input.limit + 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${q("knowledge_fs_leases")} WHERE ${q("tenant_id")} = ${p(1)}${scope} AND ${input.active ? `${q("status")} = 'active' AND ${q("expires_at")} >` : `${q("expires_at")} <=`} ${p(nowPosition)}${cursorSql} AND ${knowledgeFsLeaseReadableSql(database, "knowledge_fs_leases")} ORDER BY ${q("expires_at")} ASC, ${q("id")} ASC LIMIT ${p(params.length)};`,
    tableName: "knowledge_fs_leases",
  });
  const page = result.rows.map(mapDatabaseKnowledgeFsLease);
  const items = page.slice(0, input.limit);
  return {
    items,
    ...(page.length > input.limit ? { nextCursor: encodeExpiredLeaseCursor(items.at(-1)) } : {}),
  };
}

function mapDatabaseKnowledgeFsLease(row: DatabaseRow): KnowledgeFsLease {
  const targetVersion = optionalNumberColumn(row, "target_version");
  return KnowledgeFsLeaseSchema.parse({
    acquiredAt: stringColumn(row, "acquired_at"),
    expiresAt: stringColumn(row, "expires_at"),
    heartbeatAt: stringColumn(row, "heartbeat_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    leaseType: stringColumn(row, "lease_type"),
    metadata: jsonObjectColumn(row, "metadata"),
    sessionId: stringColumn(row, "session_id"),
    status: stringColumn(row, "status"),
    targetId: stringColumn(row, "target_id"),
    targetType: stringColumn(row, "target_type"),
    ...(targetVersion === undefined ? {} : { targetVersion }),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    virtualPath: stringColumn(row, "virtual_path"),
  });
}

function validateDatabaseLeaseListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw new KnowledgeFsLeaseListLimitExceededError(maxListLimit);
  }
}

function findConflictingLease(
  leases: ReadonlyMap<string, KnowledgeFsLease>,
  requested: KnowledgeFsLease,
): KnowledgeFsLease | null {
  if (requested.leaseType === "read") {
    return null;
  }

  for (const existing of leases.values()) {
    if (
      existing.id === requested.id ||
      existing.tenantId !== requested.tenantId ||
      existing.knowledgeSpaceId !== requested.knowledgeSpaceId ||
      existing.virtualPath !== requested.virtualPath ||
      existing.status !== "active" ||
      existing.expiresAt <= requested.acquiredAt ||
      existing.leaseType === "read"
    ) {
      continue;
    }

    return cloneLease(existing);
  }

  return null;
}

function compareExpiredLeases(left: KnowledgeFsLease, right: KnowledgeFsLease): number {
  return left.expiresAt.localeCompare(right.expiresAt) || left.id.localeCompare(right.id);
}

function compareExpiredLeaseTuple(
  lease: KnowledgeFsLease,
  cursor: { readonly expiresAt: string; readonly id: string },
): number {
  return lease.expiresAt.localeCompare(cursor.expiresAt) || lease.id.localeCompare(cursor.id);
}

function encodeExpiredLeaseCursor(lease: KnowledgeFsLease | undefined): string | undefined {
  if (!lease) {
    return undefined;
  }

  return Buffer.from(JSON.stringify({ expiresAt: lease.expiresAt, id: lease.id })).toString(
    "base64url",
  );
}

function decodeExpiredLeaseCursor(cursor: string): {
  readonly expiresAt: string;
  readonly id: string;
} {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      expiresAt?: unknown;
      id?: unknown;
    };

    if (typeof decoded.expiresAt === "string" && typeof decoded.id === "string") {
      return { expiresAt: decoded.expiresAt, id: decoded.id };
    }
  } catch {
    // Fall through to a stable validation error below.
  }

  throw new Error("KnowledgeFS lease cursor is invalid");
}

function leaseKey(tenantId: string, id: string): string {
  return `${tenantId}:${id}`;
}

function cloneLease(lease: KnowledgeFsLease): KnowledgeFsLease {
  return KnowledgeFsLeaseSchema.parse(JSON.parse(JSON.stringify(lease)) as unknown);
}
