import { randomUUID } from "node:crypto";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { cloneJsonObject, jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";

import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
  type Source,
  SourceSchema,
} from "@knowledge/core";
import { candidatePermissionScopeAllows } from "./candidate-content-authorization";
import { resolveCapabilityJobPublicationGrant } from "./capability-job-fence";
import {
  type DatabaseKnowledgeSpacePermissionFence,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

export interface CreateSourceInput {
  readonly connectionId?: string | undefined;
  readonly credentialRef?: string | undefined;
  readonly id?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly name: string;
  readonly permissionScope?: readonly string[] | undefined;
  readonly status?: Source["status"] | undefined;
  readonly type: Source["type"];
  readonly uri: string;
}

export interface SourceLookupInput {
  readonly id: string;
  readonly knowledgeSpaceId: string;
}

/** Internal row shape used only while a durable deletion is fenced. */
export type SourceForDeletion = Omit<Source, "status"> & {
  readonly status: Source["status"] | "deleting";
};

export interface UpdateSourceInput extends SourceLookupInput {
  /** null detaches the connection; undefined keeps the current binding. */
  readonly connectionId?: string | null | undefined;
  /** `null` explicitly revokes the current SecretStore reference; undefined leaves it unchanged. */
  readonly credentialRef?: string | null | undefined;
  /**
   * Optimistic-concurrency guard: when provided, the update only applies if the stored version
   * still matches, otherwise `SourceVersionConflictError` is thrown. Every successful update
   * bumps the version.
   */
  readonly expectedVersion?: number | undefined;
  /** Fully replaces the stored metadata when provided (callers read-merge-write). */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly name?: string | undefined;
  readonly status?: Source["status"] | undefined;
}

export class SourceVersionConflictError extends Error {
  constructor(id: string, expectedVersion: number) {
    super(`Source ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}

export class SourcePermissionFenceError extends Error {
  readonly code = "SOURCE_PERMISSION_FENCE_INVALID";

  constructor(message = "Source mutation permission is no longer valid") {
    super(message);
    this.name = "SourcePermissionFenceError";
  }
}

export interface SourceCursor {
  readonly id: string;
}

export interface ListSourcesInput {
  readonly cursor?: SourceCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
}

export interface ListSourcesResult {
  readonly items: Source[];
  readonly nextCursor?: SourceCursor | undefined;
}

export interface ListAllSourcesInput {
  readonly cursor?: SourceCursor | undefined;
  readonly limit: number;
}

export interface ClaimSourceForSyncInput {
  readonly id: string;
  readonly knowledgeSpaceId: string;
  /** Timestamp recorded as the claim (becomes `updatedAt`). */
  readonly now: string;
  /** A `syncing` source whose last update predates this is stale and may be re-claimed. */
  readonly staleBefore: string;
}

export interface SourceRepository {
  /**
   * Atomically claims a source for a sync run: transitions it to `syncing` only if it is not
   * already `syncing` (or its claim is stale). Returns the claimed source, or null when another
   * worker holds the claim. This is the multi-replica mutual-exclusion primitive for the sync
   * scheduler — in database mode it is a single conditional UPDATE.
   */
  claimForSync(input: ClaimSourceForSyncInput): Promise<Source | null>;
  /** Final-act fence used by durable bulk disable; validates access, scope, deletion, and CAS. */
  disableWithPermissionFence(
    input: SourceLookupInput & {
      readonly expectedVersion: number;
      readonly now: string;
    } & (
        | {
            readonly capabilityGrantId: string;
            readonly permissionFence?: never;
            readonly tenantId: string;
          }
        | {
            readonly capabilityGrantId?: never;
            readonly permissionFence: DatabaseKnowledgeSpacePermissionFence;
            readonly tenantId?: never;
          }
      ),
  ): Promise<Source | null>;
  create(input: CreateSourceInput): Promise<Source>;
  get(input: SourceLookupInput): Promise<Source | null>;
  /** Internal durable-deletion lookup; includes a row already fenced as deleting. */
  getForDeletion(input: SourceLookupInput): Promise<SourceForDeletion | null>;
  list(input: ListSourcesInput): Promise<ListSourcesResult>;
  /** Cross-space id-ordered page over every source; used by the sync scheduler. */
  listAll(input: ListAllSourcesInput): Promise<ListSourcesResult>;
  update(input: UpdateSourceInput): Promise<Source | null>;
}

export interface InMemorySourceRepositoryOptions {
  readonly generateId?: () => string;
  readonly maxSources: number;
  readonly now?: () => string;
}

export interface DatabaseSourceRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: () => string;
  readonly now?: () => string;
}

export class SourceCapacityExceededError extends Error {
  constructor(maxSources: number) {
    super(`Source repository maxSources=${maxSources} exceeded`);
  }
}

function buildSource(input: CreateSourceInput, id: string, timestamp: string): Source {
  return SourceSchema.parse({
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    createdAt: timestamp,
    ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
    id,
    knowledgeSpaceId: input.knowledgeSpaceId,
    metadata: cloneJsonObject(input.metadata ?? {}),
    name: input.name,
    permissionScope: input.permissionScope ? [...input.permissionScope] : [],
    status: input.status ?? "active",
    type: input.type,
    updatedAt: timestamp,
    uri: input.uri,
  });
}

export function createInMemorySourceRepository({
  generateId = randomUUID,
  maxSources,
  now = () => new Date().toISOString(),
}: InMemorySourceRepositoryOptions): SourceRepository {
  if (maxSources < 1) {
    throw new Error("Source repository maxSources must be at least 1");
  }

  const sources = new Map<string, Source>();

  return {
    claimForSync: async ({ id, knowledgeSpaceId, now: claimedAt, staleBefore }) => {
      const existing = sources.get(id);

      if (!existing || existing.knowledgeSpaceId !== knowledgeSpaceId) {
        return null;
      }

      if (existing.status === "syncing" && existing.updatedAt >= staleBefore) {
        return null;
      }

      const claimed = SourceSchema.parse({
        ...existing,
        status: "syncing",
        updatedAt: claimedAt,
        version: existing.version + 1,
      });
      sources.set(id, cloneSource(claimed));

      return cloneSource(claimed);
    },
    disableWithPermissionFence: async (input) => {
      const { expectedVersion, id, knowledgeSpaceId, now: updatedAt } = input;
      if (input.permissionFence && input.permissionFence.knowledgeSpaceId !== knowledgeSpaceId) {
        throw new SourcePermissionFenceError("Source mutation permission scope is invalid");
      }
      const existing = sources.get(id);
      if (!existing || existing.knowledgeSpaceId !== knowledgeSpaceId) return null;
      if (existing.version !== expectedVersion) {
        throw new SourceVersionConflictError(id, expectedVersion);
      }
      const updated = SourceSchema.parse({
        ...existing,
        status: "disabled",
        updatedAt,
        version: existing.version + 1,
      });
      sources.set(id, cloneSource(updated));
      return cloneSource(updated);
    },
    create: async (input) => {
      if (sources.size >= maxSources) {
        throw new SourceCapacityExceededError(maxSources);
      }

      const source = buildSource(input, input.id ?? generateId(), now());
      sources.set(source.id, cloneSource(source));

      return cloneSource(source);
    },
    get: async ({ id, knowledgeSpaceId }) => {
      const source = sources.get(id);

      return source && source.knowledgeSpaceId === knowledgeSpaceId ? cloneSource(source) : null;
    },
    getForDeletion: async ({ id, knowledgeSpaceId }) => {
      const source = sources.get(id);

      return source && source.knowledgeSpaceId === knowledgeSpaceId ? cloneSource(source) : null;
    },
    list: async ({ cursor, knowledgeSpaceId, limit }) => {
      validateSourceListLimit(limit);

      const rows = Array.from(sources.values())
        .filter((source) => source.knowledgeSpaceId === knowledgeSpaceId)
        .filter((source) => !cursor || source.id > cursor.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      const page = rows.slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneSource);
      const lastItem = items.at(-1);

      return {
        items,
        ...(page.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    listAll: async ({ cursor, limit }) => {
      validateSourceListLimit(limit);

      const rows = Array.from(sources.values())
        .filter((source) => !cursor || source.id > cursor.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      const page = rows.slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneSource);
      const lastItem = items.at(-1);

      return {
        items,
        ...(page.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    update: async ({
      connectionId,
      credentialRef,
      expectedVersion,
      id,
      knowledgeSpaceId,
      metadata,
      name,
      status,
    }) => {
      const existing = sources.get(id);

      if (!existing || existing.knowledgeSpaceId !== knowledgeSpaceId) {
        return null;
      }

      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new SourceVersionConflictError(id, expectedVersion);
      }

      const updated = SourceSchema.parse({
        ...existing,
        ...(connectionId === undefined
          ? {}
          : connectionId === null
            ? { connectionId: undefined }
            : { connectionId }),
        ...(credentialRef === undefined
          ? {}
          : credentialRef === null
            ? { credentialRef: undefined }
            : { credentialRef }),
        ...(metadata === undefined ? {} : { metadata: cloneJsonObject(metadata) }),
        ...(name === undefined ? {} : { name }),
        ...(status === undefined ? {} : { status }),
        updatedAt: now(),
        version: existing.version + 1,
      });
      sources.set(id, cloneSource(updated));

      return cloneSource(updated);
    },
  };
}

export function createDatabaseSourceRepository({
  database,
  generateId = randomUUID,
  now = () => new Date().toISOString(),
}: DatabaseSourceRepositoryOptions): SourceRepository {
  const tableName = "sources";

  return {
    claimForSync: async ({ id, knowledgeSpaceId, now: claimedAt, staleBefore }) => {
      // Single conditional UPDATE: the database serializes concurrent claims, so exactly one
      // worker wins even across replicas. Stale `syncing` rows (crashed claim holders) are
      // re-claimable once their last update predates `staleBefore`.
      const params = [
        "syncing",
        claimedAt,
        id,
        knowledgeSpaceId,
        "syncing",
        staleBefore,
      ] satisfies readonly DatabaseQueryValue[];
      const result = await database.execute({
        maxRows: 1,
        operation: "update",
        params,
        sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
          database,
          "status",
        )} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(
          database,
          "updated_at",
        )} = ${databasePlaceholder(database, 2)}, ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${quoteDatabaseIdentifier(database, "version")} + 1 WHERE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 4)} AND (${quoteDatabaseIdentifier(
          database,
          "status",
        )} <> ${databasePlaceholder(database, 5)} OR ${quoteDatabaseIdentifier(
          database,
          "updated_at",
        )} < ${databasePlaceholder(database, 6)}) AND ${quoteDatabaseIdentifier(
          database,
          "status",
        )} <> 'deleting' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL${
          database.dialect === "postgres" ? " RETURNING *" : ""
        };`,
        tableName,
      });

      if (database.dialect === "postgres") {
        return result.rows[0] ? mapDatabaseSourceRow(result.rows[0]) : null;
      }

      return result.rowsAffected > 0 ? databaseSourceGet(database, { id, knowledgeSpaceId }) : null;
    },
    disableWithPermissionFence: async (input) =>
      database.transaction(async (tx) => {
        const { expectedVersion, id, knowledgeSpaceId, now: updatedAt } = input;
        const capabilityGrantId = input.capabilityGrantId;
        const permissionFence = input.permissionFence;
        let tenantId: string;
        if (capabilityGrantId) tenantId = input.tenantId;
        else if (permissionFence) tenantId = permissionFence.tenantId;
        else throw new SourcePermissionFenceError();
        if (
          (permissionFence && permissionFence.knowledgeSpaceId !== knowledgeSpaceId) ||
          !(await lockKnowledgeSpaceForDeletionAdmission(database, tx, {
            knowledgeSpaceId,
            tenantId,
          }))
        ) {
          throw new SourcePermissionFenceError("Source mutation is deletion-fenced or mis-scoped");
        }
        const permissionScopes = capabilityGrantId
          ? (
              await resolveCapabilityJobPublicationGrant(database, tx, {
                capabilityGrantId,
                knowledgeSpaceId,
                tenantId,
              })
            ).contentScopeIds
          : permissionFence
            ? (
                await assertDatabaseKnowledgeSpacePermissionFence({
                  database,
                  executor: tx,
                  fence: permissionFence,
                  now: updatedAt,
                  requiredAccess: "write",
                })
              ).permissionScopes
            : (() => {
                throw new SourcePermissionFenceError();
              })();
        const selected = await tx.execute({
          maxRows: 1,
          operation: "select",
          params: [id, knowledgeSpaceId],
          sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "status")} <> 'deleting' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
          tableName,
        });
        const row = selected.rows[0];
        if (!row) return null;
        const current = mapDatabaseSourceRow(row);
        if (!candidatePermissionScopeAllows(current.permissionScope, permissionScopes)) {
          throw new SourcePermissionFenceError();
        }
        if (current.version !== expectedVersion) {
          throw new SourceVersionConflictError(id, expectedVersion);
        }
        const next = SourceSchema.parse({
          ...current,
          status: "disabled",
          updatedAt,
          version: current.version + 1,
        });
        const result = await tx.execute({
          maxRows: 1,
          operation: "update",
          params: [
            next.status,
            next.updatedAt,
            next.version,
            id,
            knowledgeSpaceId,
            expectedVersion,
          ],
          sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(database, "status")} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(database, "updated_at")} = ${databasePlaceholder(database, 2)}, ${quoteDatabaseIdentifier(database, "version")} = ${databasePlaceholder(database, 3)} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(database, "version")} = ${databasePlaceholder(database, 6)} AND ${quoteDatabaseIdentifier(database, "status")} <> 'deleting' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
        if (result.rowsAffected !== 1) {
          throw new SourceVersionConflictError(id, expectedVersion);
        }
        return result.rows[0] ? mapDatabaseSourceRow(result.rows[0]) : cloneSource(next);
      }),
    create: async (input) => {
      const source = buildSource(input, input.id ?? generateId(), now());
      const columns = [
        "id",
        "knowledge_space_id",
        "connection_id",
        "credential_ref",
        "name",
        "type",
        "status",
        "uri",
        "permission_scope",
        "metadata",
        "version",
        "created_at",
        "updated_at",
      ];
      const params = [
        source.id,
        source.knowledgeSpaceId,
        source.connectionId ?? null,
        source.credentialRef ?? null,
        source.name,
        source.type,
        source.status,
        source.uri,
        JSON.stringify(source.permissionScope),
        JSON.stringify(source.metadata),
        source.version,
        source.createdAt,
        source.updatedAt,
      ] satisfies readonly DatabaseQueryValue[];
      const result = await database.execute({
        maxRows: 1,
        operation: "insert",
        params,
        sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
          .map((column) => quoteDatabaseIdentifier(database, column))
          .join(", ")}) VALUES (${params
          .map((_, index) => jsonInsertPlaceholder(database, index + 1, columns[index]))
          .join(", ")})${database.dialect === "postgres" ? " RETURNING *" : ""};`,
        tableName,
      });

      return result.rows[0] ? mapDatabaseSourceRow(result.rows[0]) : source;
    },
    get: async (input) => databaseSourceGet(database, input),
    getForDeletion: async (input) => databaseSourceGetForDeletion(database, input),
    list: async ({ cursor, knowledgeSpaceId, limit }) => {
      validateSourceListLimit(limit);

      const readLimit = limit + 1;
      const params = cursor
        ? [knowledgeSpaceId, cursor.id, readLimit]
        : [knowledgeSpaceId, readLimit];
      const cursorSql = cursor
        ? ` AND ${quoteDatabaseIdentifier(database, "id")} > ${databasePlaceholder(database, 2)}`
        : "";
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "status",
        )} <> 'deleting'${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "id",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapDatabaseSourceRow);
      const items = rows.slice(0, limit).map(cloneSource);
      const lastItem = items.at(-1);

      return {
        items,
        ...(rows.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    listAll: async ({ cursor, limit }) => {
      validateSourceListLimit(limit);

      const readLimit = limit + 1;
      const params = cursor ? [cursor.id, readLimit] : [readLimit];
      const cursorSql = cursor
        ? ` AND ${quoteDatabaseIdentifier(database, "id")} > ${databasePlaceholder(database, 1)}`
        : "";
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "status",
        )} <> 'deleting'${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "id",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapDatabaseSourceRow);
      const items = rows.slice(0, limit).map(cloneSource);
      const lastItem = items.at(-1);

      return {
        items,
        ...(rows.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    update: async ({
      connectionId,
      credentialRef,
      expectedVersion,
      id,
      knowledgeSpaceId,
      metadata,
      name,
      status,
    }) => {
      const existing = await databaseSourceGet(database, { id, knowledgeSpaceId });

      if (!existing) {
        return null;
      }

      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new SourceVersionConflictError(id, expectedVersion);
      }

      const updated = SourceSchema.parse({
        ...existing,
        ...(connectionId === undefined
          ? {}
          : connectionId === null
            ? { connectionId: undefined }
            : { connectionId }),
        ...(credentialRef === undefined
          ? {}
          : credentialRef === null
            ? { credentialRef: undefined }
            : { credentialRef }),
        ...(metadata === undefined ? {} : { metadata: cloneJsonObject(metadata) }),
        ...(name === undefined ? {} : { name }),
        ...(status === undefined ? {} : { status }),
        updatedAt: now(),
        version: existing.version + 1,
      });
      const setColumns = ["name", "status", "metadata", "version", "updated_at"];
      const setParams: DatabaseQueryValue[] = [
        updated.name,
        updated.status,
        JSON.stringify(updated.metadata),
        updated.version,
        updated.updatedAt,
      ];
      if (credentialRef !== undefined) {
        setColumns.push("credential_ref");
        setParams.push(updated.credentialRef ?? null);
      }
      if (connectionId !== undefined) {
        setColumns.push("connection_id");
        setParams.push(updated.connectionId ?? null);
      }
      const params = [
        ...setParams,
        id,
        knowledgeSpaceId,
        ...(expectedVersion === undefined ? [] : [expectedVersion]),
      ] satisfies readonly DatabaseQueryValue[];
      // With expectedVersion the WHERE clause pins the stored version, so the database itself
      // rejects a concurrent modification (rowsAffected 0 -> conflict).
      const result = await database.execute({
        maxRows: 1,
        operation: "update",
        params,
        sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${setColumns
          .map(
            (column, index) =>
              `${quoteDatabaseIdentifier(database, column)} = ${jsonInsertPlaceholder(
                database,
                index + 1,
                column,
              )}`,
          )
          .join(", ")} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
          database,
          setColumns.length + 1,
        )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
          database,
          setColumns.length + 2,
        )}${
          expectedVersion === undefined
            ? ""
            : ` AND ${quoteDatabaseIdentifier(database, "version")} = ${databasePlaceholder(
                database,
                setColumns.length + 3,
              )}`
        } AND ${quoteDatabaseIdentifier(database, "status")} <> 'deleting' AND ${quoteDatabaseIdentifier(
          database,
          "deletion_job_id",
        )} IS NULL;`,
        tableName,
      });

      if (result.rowsAffected === 0) {
        if (expectedVersion !== undefined) {
          throw new SourceVersionConflictError(id, expectedVersion);
        }
        return null;
      }

      return cloneSource(updated);
    },
  };
}

async function databaseSourceGet(
  database: DatabaseAdapter,
  input: SourceLookupInput,
): Promise<Source | null> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.id, input.knowledgeSpaceId],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "sources")} WHERE ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "status",
    )} <> 'deleting' LIMIT 1;`,
    tableName: "sources",
  });

  return result.rows[0] ? mapDatabaseSourceRow(result.rows[0]) : null;
}

async function databaseSourceGetForDeletion(
  database: DatabaseAdapter,
  input: SourceLookupInput,
): Promise<SourceForDeletion | null> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.id, input.knowledgeSpaceId],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "sources")} WHERE ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
    tableName: "sources",
  });

  return result.rows[0] ? mapDatabaseSourceForDeletionRow(result.rows[0]) : null;
}

/** Shared by database-side source mutations that must commit atomically with auxiliary ledgers. */
export function mapDatabaseSourceRow(row: DatabaseRow): Source {
  const connectionId = optionalStringColumn(row, "connection_id");
  const credentialRef = optionalStringColumn(row, "credential_ref");
  return SourceSchema.parse({
    ...(connectionId ? { connectionId } : {}),
    createdAt: stringColumn(row, "created_at"),
    ...(credentialRef ? { credentialRef } : {}),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    name: stringColumn(row, "name"),
    permissionScope: jsonStringArrayColumn(row, "permission_scope"),
    status: stringColumn(row, "status"),
    type: stringColumn(row, "type"),
    updatedAt: stringColumn(row, "updated_at"),
    uri: stringColumn(row, "uri"),
    version: numberColumn(row, "version"),
  });
}

function mapDatabaseSourceForDeletionRow(row: DatabaseRow): SourceForDeletion {
  const status = stringColumn(row, "status");

  if (status !== "deleting") {
    return mapDatabaseSourceRow(row);
  }

  // Validate every public Source field with the canonical schema while keeping the lifecycle-only
  // status out of that public schema and therefore out of ordinary API contracts.
  return {
    ...mapDatabaseSourceRow({ ...row, status: "disabled" }),
    status,
  };
}

function cloneSource(source: Source): Source {
  return {
    ...source,
    metadata: cloneJsonObject(source.metadata),
    permissionScope: [...source.permissionScope],
  };
}

function validateSourceListLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Source list limit must be at least 1");
  }
}
