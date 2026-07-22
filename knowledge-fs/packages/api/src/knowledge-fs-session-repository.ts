import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
  type KnowledgeFsSession,
  KnowledgeFsSessionSchema,
} from "@knowledge/core";

import { stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

export interface KnowledgeFsSessionLookupInput {
  readonly id: string;
  readonly tenantId: string;
}

export interface KnowledgeFsSessionHeartbeatInput extends KnowledgeFsSessionLookupInput {
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeFsSessionListExpiredInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly now: string;
  readonly tenantId: string;
}

export interface KnowledgeFsSessionListActiveInput extends KnowledgeFsSessionListExpiredInput {
  readonly knowledgeSpaceId: string;
}

export interface KnowledgeFsSessionListResult {
  readonly items: readonly KnowledgeFsSession[];
  readonly nextCursor?: string | undefined;
}

export interface KnowledgeFsSessionRepository {
  create(input: KnowledgeFsSession): Promise<KnowledgeFsSession>;
  delete(input: KnowledgeFsSessionLookupInput): Promise<KnowledgeFsSession | null>;
  get(input: KnowledgeFsSessionLookupInput): Promise<KnowledgeFsSession | null>;
  heartbeat(input: KnowledgeFsSessionHeartbeatInput): Promise<KnowledgeFsSession | null>;
  listActive(input: KnowledgeFsSessionListActiveInput): Promise<KnowledgeFsSessionListResult>;
  listExpired(input: KnowledgeFsSessionListExpiredInput): Promise<KnowledgeFsSessionListResult>;
}

export interface InMemoryKnowledgeFsSessionRepositoryOptions {
  readonly maxListLimit: number;
  readonly maxSessions: number;
}

export interface DatabaseKnowledgeFsSessionRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxListLimit: number;
}

export class KnowledgeFsSessionCapacityExceededError extends Error {
  constructor(maxSessions: number) {
    super(`KnowledgeFS session repository maxSessions=${maxSessions} exceeded`);
  }
}

export class KnowledgeFsSessionListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`KnowledgeFS session repository maxListLimit=${maxListLimit} exceeded`);
  }
}

export class KnowledgeFsSessionDeletionFenceActiveError extends Error {
  constructor() {
    super("KnowledgeFS session creation is unavailable while durable deletion is active");
  }
}

export function createInMemoryKnowledgeFsSessionRepository({
  maxListLimit,
  maxSessions,
}: InMemoryKnowledgeFsSessionRepositoryOptions): KnowledgeFsSessionRepository {
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) {
    throw new Error("KnowledgeFS session repository maxSessions must be at least 1");
  }

  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("KnowledgeFS session repository maxListLimit must be at least 1");
  }

  const sessions = new Map<string, KnowledgeFsSession>();

  return {
    async create(input) {
      const session = cloneSession(KnowledgeFsSessionSchema.parse(input));
      const key = sessionKey(session.tenantId, session.id);

      if (!sessions.has(key) && sessions.size >= maxSessions) {
        throw new KnowledgeFsSessionCapacityExceededError(maxSessions);
      }

      sessions.set(key, cloneSession(session));

      return cloneSession(session);
    },

    async delete({ id, tenantId }) {
      const key = sessionKey(tenantId, id);
      const session = sessions.get(key);

      if (!session) {
        return null;
      }

      sessions.delete(key);

      return cloneSession(session);
    },

    async get({ id, tenantId }) {
      const session = sessions.get(sessionKey(tenantId, id));

      return session ? cloneSession(session) : null;
    },

    async heartbeat({ expiresAt, heartbeatAt, id, tenantId, updatedAt }) {
      const key = sessionKey(tenantId, id);
      const current = sessions.get(key);

      if (!current) {
        return null;
      }

      const updated = cloneSession(
        KnowledgeFsSessionSchema.parse({
          ...current,
          expiresAt,
          heartbeatAt,
          updatedAt,
        }),
      );
      sessions.set(key, cloneSession(updated));

      return cloneSession(updated);
    },

    async listActive({ cursor, knowledgeSpaceId, limit, now, tenantId }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
        throw new KnowledgeFsSessionListLimitExceededError(maxListLimit);
      }

      const cursorTuple = cursor ? decodeExpiredSessionCursor(cursor) : null;
      const active = Array.from(sessions.values())
        .filter((session) => session.tenantId === tenantId)
        .filter((session) => session.knowledgeSpaceId === knowledgeSpaceId)
        .filter((session) => session.expiresAt > now)
        .sort(compareExpiredSessions)
        .filter((session) =>
          cursorTuple ? compareExpiredSessionTuple(session, cursorTuple) > 0 : true,
        );
      const page = active.slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneSession);
      const nextSession = page.at(limit);

      return {
        items,
        ...(nextSession === undefined
          ? {}
          : { nextCursor: encodeExpiredSessionCursor(items.at(-1)) }),
      };
    },

    async listExpired({ cursor, limit, now, tenantId }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
        throw new KnowledgeFsSessionListLimitExceededError(maxListLimit);
      }

      const cursorTuple = cursor ? decodeExpiredSessionCursor(cursor) : null;
      const expired = Array.from(sessions.values())
        .filter((session) => session.tenantId === tenantId)
        .filter((session) => session.expiresAt <= now)
        .sort(compareExpiredSessions)
        .filter((session) =>
          cursorTuple ? compareExpiredSessionTuple(session, cursorTuple) > 0 : true,
        );
      const page = expired.slice(0, limit);
      const nextSession = expired.at(limit);

      return {
        items: page.map(cloneSession),
        ...(nextSession === undefined
          ? {}
          : { nextCursor: encodeExpiredSessionCursor(page.at(-1)) }),
      };
    },
  };
}

export function createDatabaseKnowledgeFsSessionRepository({
  database,
  maxListLimit,
}: DatabaseKnowledgeFsSessionRepositoryOptions): KnowledgeFsSessionRepository {
  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("KnowledgeFS session repository maxListLimit must be at least 1");
  }
  const tableName = "knowledge_fs_sessions";
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);

  return {
    async create(input) {
      const session = cloneSession(KnowledgeFsSessionSchema.parse(input));
      const columns = [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "client_kind",
        "client_version",
        "subject",
        "permission_snapshot",
        "consistency_class",
        "heartbeat_at",
        "expires_at",
        "metadata",
        "created_at",
        "updated_at",
      ] as const;
      const params = [
        session.id,
        session.tenantId,
        session.knowledgeSpaceId,
        session.clientKind,
        session.clientVersion,
        JSON.stringify(session.subject),
        JSON.stringify(session.permissionSnapshot),
        session.consistencyClass,
        session.heartbeatAt,
        session.expiresAt,
        JSON.stringify(session.metadata),
        session.createdAt,
        session.updatedAt,
      ] satisfies readonly DatabaseQueryValue[];
      const result = await database.transaction(async (transaction) => {
        if (
          !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
            knowledgeSpaceId: session.knowledgeSpaceId,
            tenantId: session.tenantId,
          }))
        ) {
          return { rows: [], rowsAffected: 0 } as const;
        }
        return transaction.execute({
          maxRows: 1,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(tableName)} (${columns.map(q).join(", ")}) VALUES (${columns
            .map((column, index) =>
              ["subject", "permission_snapshot", "metadata"].includes(column)
                ? jsonInsertPlaceholder(database, index + 1, column)
                : p(index + 1),
            )
            .join(", ")})${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
      });
      if (result.rowsAffected !== 1 && result.rows.length !== 1) {
        throw new KnowledgeFsSessionDeletionFenceActiveError();
      }
      return result.rows[0] ? mapDatabaseKnowledgeFsSession(result.rows[0]) : session;
    },
    async delete({ id, tenantId }) {
      return database.transaction(async (transaction) => {
        const current = await databaseKnowledgeFsSessionGet(database, transaction, {
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
    get: (input) => databaseKnowledgeFsSessionGet(database, database, input),
    async heartbeat({ expiresAt, heartbeatAt, id, tenantId, updatedAt }) {
      const result = await database.transaction(async (transaction) => {
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
          return { rows: [], rowsAffected: 0 } as const;
        }
        return transaction.execute({
          maxRows: 1,
          operation: "update",
          params: [expiresAt, heartbeatAt, updatedAt, tenantId, id],
          sql: `UPDATE ${q(tableName)} SET ${q("expires_at")} = ${p(1)}, ${q("heartbeat_at")} = ${p(2)}, ${q("updated_at")} = ${p(3)} WHERE ${q("tenant_id")} = ${p(4)} AND ${q("id")} = ${p(5)}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
      });
      if (result.rows[0]) return mapDatabaseKnowledgeFsSession(result.rows[0]);
      return result.rowsAffected > 0
        ? databaseKnowledgeFsSessionGet(database, database, { id, tenantId })
        : null;
    },
    async listActive({ cursor, knowledgeSpaceId, limit, now, tenantId }) {
      validateDatabaseSessionListLimit(limit, maxListLimit);
      return databaseKnowledgeFsSessionList(database, {
        active: true,
        cursor,
        knowledgeSpaceId,
        limit,
        now,
        tenantId,
      });
    },
    async listExpired({ cursor, limit, now, tenantId }) {
      validateDatabaseSessionListLimit(limit, maxListLimit);
      return databaseKnowledgeFsSessionList(database, {
        active: false,
        cursor,
        limit,
        now,
        tenantId,
      });
    },
  };
}

async function databaseKnowledgeFsSessionGet(
  database: DatabaseAdapter,
  executor: Pick<DatabaseAdapter, "execute">,
  input: KnowledgeFsSessionLookupInput,
): Promise<KnowledgeFsSession | null> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.id],
    sql: `SELECT * FROM ${q("knowledge_fs_sessions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${knowledgeFsSessionReadableSql(database, "knowledge_fs_sessions")} LIMIT 1;`,
    tableName: "knowledge_fs_sessions",
  });
  return result.rows[0] ? mapDatabaseKnowledgeFsSession(result.rows[0]) : null;
}

function knowledgeFsSessionReadableSql(database: DatabaseAdapter, table: string): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  return `NOT EXISTS (SELECT 1 FROM ${q("deletion_jobs")} AS active_deletion WHERE active_deletion.${q("tenant_id")} = ${q(table)}.${q("tenant_id")} AND active_deletion.${q("knowledge_space_id")} = ${q(table)}.${q("knowledge_space_id")} AND active_deletion.${q("active_slot")} = 1)`;
}

async function databaseKnowledgeFsSessionList(
  database: DatabaseAdapter,
  input: {
    readonly active: boolean;
    readonly cursor?: string | undefined;
    readonly knowledgeSpaceId?: string | undefined;
    readonly limit: number;
    readonly now: string;
    readonly tenantId: string;
  },
): Promise<KnowledgeFsSessionListResult> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const cursor = input.cursor ? decodeExpiredSessionCursor(input.cursor) : undefined;
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
    sql: `SELECT * FROM ${q("knowledge_fs_sessions")} WHERE ${q("tenant_id")} = ${p(1)}${scope} AND ${q("expires_at")} ${input.active ? ">" : "<="} ${p(nowPosition)}${cursorSql} AND ${knowledgeFsSessionReadableSql(database, "knowledge_fs_sessions")} ORDER BY ${q("expires_at")} ASC, ${q("id")} ASC LIMIT ${p(params.length)};`,
    tableName: "knowledge_fs_sessions",
  });
  const page = result.rows.map(mapDatabaseKnowledgeFsSession);
  const items = page.slice(0, input.limit);
  return {
    items,
    ...(page.length > input.limit ? { nextCursor: encodeExpiredSessionCursor(items.at(-1)) } : {}),
  };
}

function mapDatabaseKnowledgeFsSession(row: DatabaseRow): KnowledgeFsSession {
  return KnowledgeFsSessionSchema.parse({
    clientKind: stringColumn(row, "client_kind"),
    clientVersion: stringColumn(row, "client_version"),
    consistencyClass: stringColumn(row, "consistency_class"),
    createdAt: stringColumn(row, "created_at"),
    expiresAt: stringColumn(row, "expires_at"),
    heartbeatAt: stringColumn(row, "heartbeat_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    permissionSnapshot: jsonObjectColumn(row, "permission_snapshot"),
    subject: jsonObjectColumn(row, "subject"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function validateDatabaseSessionListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw new KnowledgeFsSessionListLimitExceededError(maxListLimit);
  }
}

function compareExpiredSessions(left: KnowledgeFsSession, right: KnowledgeFsSession): number {
  return left.expiresAt.localeCompare(right.expiresAt) || left.id.localeCompare(right.id);
}

function compareExpiredSessionTuple(
  session: KnowledgeFsSession,
  cursor: { readonly expiresAt: string; readonly id: string },
): number {
  return session.expiresAt.localeCompare(cursor.expiresAt) || session.id.localeCompare(cursor.id);
}

function encodeExpiredSessionCursor(session: KnowledgeFsSession | undefined): string | undefined {
  if (!session) {
    return undefined;
  }

  return Buffer.from(JSON.stringify({ expiresAt: session.expiresAt, id: session.id })).toString(
    "base64url",
  );
}

function decodeExpiredSessionCursor(cursor: string): {
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

  throw new Error("KnowledgeFS session cursor is invalid");
}

function sessionKey(tenantId: string, id: string): string {
  return `${tenantId}:${id}`;
}

function cloneSession(session: KnowledgeFsSession): KnowledgeFsSession {
  return KnowledgeFsSessionSchema.parse(JSON.parse(JSON.stringify(session)) as unknown);
}
