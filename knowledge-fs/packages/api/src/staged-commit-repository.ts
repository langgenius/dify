import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
  type KnowledgeSpaceStagedCommit,
  KnowledgeSpaceStagedCommitSchema,
  type KnowledgeSpaceStagedCommitStatus,
} from "@knowledge/core";

import { optionalNumberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";

export interface StagedCommitLookupInput {
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ListStagedCommitsInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly status?: KnowledgeSpaceStagedCommitStatus | undefined;
  readonly tenantId: string;
}

export interface ListStagedCommitsResult {
  readonly items: KnowledgeSpaceStagedCommit[];
  readonly nextCursor?: string;
}

export interface TransitionStagedCommitInput extends StagedCommitLookupInput {
  readonly patch?: Partial<KnowledgeSpaceStagedCommit> | undefined;
  readonly status: KnowledgeSpaceStagedCommitStatus;
  readonly updatedAt: string;
}

export interface StagedCommitRepository {
  create(input: KnowledgeSpaceStagedCommit): Promise<KnowledgeSpaceStagedCommit>;
  get(input: StagedCommitLookupInput): Promise<KnowledgeSpaceStagedCommit | null>;
  list(input: ListStagedCommitsInput): Promise<ListStagedCommitsResult>;
  transition(input: TransitionStagedCommitInput): Promise<KnowledgeSpaceStagedCommit | null>;
}

export interface InMemoryStagedCommitRepositoryOptions {
  readonly maxCommits: number;
  readonly maxListLimit: number;
}

export interface DatabaseStagedCommitRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxListLimit: number;
}

export class StagedCommitCapacityExceededError extends Error {
  constructor(maxCommits: number) {
    super(`StagedCommit repository maxCommits=${maxCommits} exceeded`);
  }
}

export class StagedCommitListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`StagedCommit list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

export class InvalidStagedCommitTransitionError extends Error {
  constructor(from: KnowledgeSpaceStagedCommitStatus, to: KnowledgeSpaceStagedCommitStatus) {
    super(`Invalid staged commit transition from ${from} to ${to}`);
  }
}

export function createInMemoryStagedCommitRepository({
  maxCommits,
  maxListLimit,
}: InMemoryStagedCommitRepositoryOptions): StagedCommitRepository {
  validateStagedCommitRepositoryBounds({ maxCommits, maxListLimit });

  const commitsById = new Map<string, KnowledgeSpaceStagedCommit>();
  const idempotencyIndex = new Map<string, string>();

  return {
    create: async (input) => {
      const commit = cloneCommit(KnowledgeSpaceStagedCommitSchema.parse(input));
      const idempotencyKey = scopedIdempotencyKey(commit);
      const existingId = idempotencyIndex.get(idempotencyKey);

      if (existingId) {
        const existing = commitsById.get(existingId);

        if (existing) {
          return cloneCommit(existing);
        }
      }

      if (commitsById.size >= maxCommits) {
        throw new StagedCommitCapacityExceededError(maxCommits);
      }

      commitsById.set(commit.id, cloneCommit(commit));
      idempotencyIndex.set(idempotencyKey, commit.id);

      return cloneCommit(commit);
    },
    get: async (input) => {
      const commit = commitsById.get(input.id);

      return commit &&
        commit.tenantId === input.tenantId &&
        commit.knowledgeSpaceId === input.knowledgeSpaceId
        ? cloneCommit(commit)
        : null;
    },
    list: async ({ cursor, knowledgeSpaceId, limit, status, tenantId }) => {
      validateStagedCommitListLimit(limit, maxListLimit);

      const page = Array.from(commitsById.values())
        .filter((commit) => commit.tenantId === tenantId)
        .filter((commit) => commit.knowledgeSpaceId === knowledgeSpaceId)
        .filter((commit) => (status ? commit.status === status : true))
        .filter((commit) => (cursor ? commit.id > cursor : true))
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneCommit);
      const nextCursor = page.length > limit ? items.at(-1)?.id : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    transition: async ({ id, knowledgeSpaceId, patch = {}, status, tenantId, updatedAt }) => {
      const existing = commitsById.get(id);

      if (
        !existing ||
        existing.tenantId !== tenantId ||
        existing.knowledgeSpaceId !== knowledgeSpaceId
      ) {
        return null;
      }

      if (!stagedCommitTransitionIsAllowed(existing.status, status)) {
        throw new InvalidStagedCommitTransitionError(existing.status, status);
      }

      const updated = KnowledgeSpaceStagedCommitSchema.parse({
        ...existing,
        ...patch,
        createdAt: existing.createdAt,
        id: existing.id,
        idempotencyKey: existing.idempotencyKey,
        knowledgeSpaceId: existing.knowledgeSpaceId,
        operationType: existing.operationType,
        status,
        tenantId: existing.tenantId,
        updatedAt,
      });

      commitsById.set(id, cloneCommit(updated));

      return cloneCommit(updated);
    },
  };
}

export function createDatabaseStagedCommitRepository({
  database,
  maxListLimit,
}: DatabaseStagedCommitRepositoryOptions): StagedCommitRepository {
  if (!Number.isInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("StagedCommit repository maxListLimit must be at least 1");
  }

  const tableName = "knowledge_space_staged_commits";

  return {
    create: async (input) => {
      const commit = cloneCommit(KnowledgeSpaceStagedCommitSchema.parse(input));
      const columns = stagedCommitColumns;
      const params = stagedCommitColumnValues(commit);
      const conflictClause =
        database.dialect === "postgres"
          ? ` ON CONFLICT (${quoteDatabaseIdentifier(database, "tenant_id")}, ${quoteDatabaseIdentifier(
              database,
              "knowledge_space_id",
            )}, ${quoteDatabaseIdentifier(database, "idempotency_key")}) DO NOTHING RETURNING *`
          : ` ON DUPLICATE KEY UPDATE ${quoteDatabaseIdentifier(
              database,
              "id",
            )} = ${quoteDatabaseIdentifier(database, tableName)}.${quoteDatabaseIdentifier(
              database,
              "id",
            )}`;
      const result = await database.execute({
        maxRows: 1,
        operation: "insert",
        params,
        sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
          .map((column) => quoteDatabaseIdentifier(database, column))
          .join(", ")}) VALUES (${params
          .map((_, index) => databasePlaceholder(database, index + 1))
          .join(", ")})${conflictClause};`,
        tableName,
      });

      if (result.rows[0]) {
        return mapStagedCommitRow(result.rows[0]);
      }

      const stored = await databaseStagedCommitGetByIdempotencyKey(database, commit);
      if (!stored) {
        throw new Error("Staged commit create did not persist a readable row");
      }

      return stored;
    },
    get: async (input) => databaseStagedCommitGet(database, input),
    list: async ({ cursor, knowledgeSpaceId, limit, status, tenantId }) => {
      validateStagedCommitListLimit(limit, maxListLimit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [tenantId, knowledgeSpaceId];
      const conditions = [
        `${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)}`,
        `${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
          database,
          2,
        )}`,
      ];

      if (status !== undefined) {
        params.push(status);
        conditions.push(
          `${quoteDatabaseIdentifier(database, "status")} = ${databasePlaceholder(database, params.length)}`,
        );
      }

      if (cursor !== undefined) {
        params.push(cursor);
        conditions.push(
          `${quoteDatabaseIdentifier(database, "id")} > ${databasePlaceholder(database, params.length)}`,
        );
      }

      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${conditions.join(
          " AND ",
        )} ORDER BY ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
          database,
          params.length,
        )};`,
        tableName,
      });
      const rows = result.rows.map(mapStagedCommitRow);
      const items = rows.slice(0, limit).map(cloneCommit);
      const lastItem = items.at(-1);

      return {
        items,
        ...(rows.length > limit && lastItem ? { nextCursor: lastItem.id } : {}),
      };
    },
    transition: async (input) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await databaseStagedCommitGet(database, input);

        if (!existing) {
          return null;
        }

        if (!stagedCommitTransitionIsAllowed(existing.status, input.status)) {
          throw new InvalidStagedCommitTransitionError(existing.status, input.status);
        }

        const updated = KnowledgeSpaceStagedCommitSchema.parse({
          ...existing,
          ...(input.patch ?? {}),
          createdAt: existing.createdAt,
          id: existing.id,
          idempotencyKey: existing.idempotencyKey,
          knowledgeSpaceId: existing.knowledgeSpaceId,
          operationType: existing.operationType,
          status: input.status,
          tenantId: existing.tenantId,
          updatedAt: input.updatedAt,
        });
        const params = [
          updated.status,
          updated.rawObjectKey ?? null,
          updated.publishedObjectKey ?? null,
          updated.documentAssetId ?? null,
          updated.parseArtifactId ?? null,
          updated.projectionFingerprint ?? null,
          updated.checksum ?? null,
          updated.sizeBytes ?? null,
          updated.errorCode ?? null,
          updated.errorMessage ?? null,
          updated.expiresAt ?? null,
          updated.updatedAt,
          updated.id,
          updated.tenantId,
          updated.knowledgeSpaceId,
          existing.status,
        ] satisfies readonly DatabaseQueryValue[];
        const mutableColumns = [
          "status",
          "raw_object_key",
          "published_object_key",
          "document_asset_id",
          "parse_artifact_id",
          "projection_fingerprint",
          "checksum",
          "size_bytes",
          "error_code",
          "error_message",
          "expires_at",
          "updated_at",
        ];
        const result = await database.execute({
          maxRows: 1,
          operation: "update",
          params,
          sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${mutableColumns
            .map(
              (column, index) =>
                `${quoteDatabaseIdentifier(database, column)} = ${databasePlaceholder(database, index + 1)}`,
            )
            .join(", ")} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
            database,
            13,
          )} AND ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
            database,
            14,
          )} AND ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 15)} AND ${quoteDatabaseIdentifier(
            database,
            "status",
          )} = ${databasePlaceholder(database, 16)}${
            database.dialect === "postgres" ? " RETURNING *" : ""
          };`,
          tableName,
        });

        if (result.rows[0]) {
          return mapStagedCommitRow(result.rows[0]);
        }

        if (result.rowsAffected > 0) {
          return databaseStagedCommitGet(database, input);
        }
      }

      const concurrent = await databaseStagedCommitGet(database, input);
      if (!concurrent) {
        return null;
      }

      throw new InvalidStagedCommitTransitionError(concurrent.status, input.status);
    },
  };
}

async function databaseStagedCommitGet(
  database: DatabaseAdapter,
  input: StagedCommitLookupInput,
): Promise<KnowledgeSpaceStagedCommit | null> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.id, input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_staged_commits",
    )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      3,
    )} LIMIT 1;`,
    tableName: "knowledge_space_staged_commits",
  });

  return result.rows[0] ? mapStagedCommitRow(result.rows[0]) : null;
}

async function databaseStagedCommitGetByIdempotencyKey(
  database: DatabaseAdapter,
  input: Pick<KnowledgeSpaceStagedCommit, "idempotencyKey" | "knowledgeSpaceId" | "tenantId">,
): Promise<KnowledgeSpaceStagedCommit | null> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.idempotencyKey],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_staged_commits",
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(database, "idempotency_key")} = ${databasePlaceholder(
      database,
      3,
    )} LIMIT 1;`,
    tableName: "knowledge_space_staged_commits",
  });

  return result.rows[0] ? mapStagedCommitRow(result.rows[0]) : null;
}

const stagedCommitColumns = [
  "id",
  "tenant_id",
  "knowledge_space_id",
  "operation_type",
  "idempotency_key",
  "status",
  "raw_object_key",
  "published_object_key",
  "document_asset_id",
  "parse_artifact_id",
  "projection_fingerprint",
  "checksum",
  "size_bytes",
  "error_code",
  "error_message",
  "created_at",
  "updated_at",
  "expires_at",
] as const;

function stagedCommitColumnValues(
  commit: KnowledgeSpaceStagedCommit,
): readonly DatabaseQueryValue[] {
  return [
    commit.id,
    commit.tenantId,
    commit.knowledgeSpaceId,
    commit.operationType,
    commit.idempotencyKey,
    commit.status,
    commit.rawObjectKey ?? null,
    commit.publishedObjectKey ?? null,
    commit.documentAssetId ?? null,
    commit.parseArtifactId ?? null,
    commit.projectionFingerprint ?? null,
    commit.checksum ?? null,
    commit.sizeBytes ?? null,
    commit.errorCode ?? null,
    commit.errorMessage ?? null,
    commit.createdAt,
    commit.updatedAt,
    commit.expiresAt ?? null,
  ];
}

function mapStagedCommitRow(row: DatabaseRow): KnowledgeSpaceStagedCommit {
  const rawObjectKey = optionalStringColumn(row, "raw_object_key");
  const publishedObjectKey = optionalStringColumn(row, "published_object_key");
  const documentAssetId = optionalStringColumn(row, "document_asset_id");
  const parseArtifactId = optionalStringColumn(row, "parse_artifact_id");
  const projectionFingerprint = optionalStringColumn(row, "projection_fingerprint");
  const checksum = optionalStringColumn(row, "checksum");
  const sizeBytes = optionalNumberColumn(row, "size_bytes");
  const errorCode = optionalStringColumn(row, "error_code");
  const errorMessage = optionalStringColumn(row, "error_message");
  const expiresAt = optionalStringColumn(row, "expires_at");

  return KnowledgeSpaceStagedCommitSchema.parse({
    ...(checksum === undefined ? {} : { checksum }),
    createdAt: stringColumn(row, "created_at"),
    ...(documentAssetId === undefined ? {} : { documentAssetId }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    operationType: stringColumn(row, "operation_type"),
    ...(parseArtifactId === undefined ? {} : { parseArtifactId }),
    ...(projectionFingerprint === undefined ? {} : { projectionFingerprint }),
    ...(publishedObjectKey === undefined ? {} : { publishedObjectKey }),
    ...(rawObjectKey === undefined ? {} : { rawObjectKey }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    status: stringColumn(row, "status"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function validateStagedCommitRepositoryBounds({
  maxCommits,
  maxListLimit,
}: InMemoryStagedCommitRepositoryOptions): void {
  if (!Number.isInteger(maxCommits) || maxCommits < 1) {
    throw new Error("StagedCommit repository maxCommits must be at least 1");
  }

  if (!Number.isInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("StagedCommit repository maxListLimit must be at least 1");
  }
}

function validateStagedCommitListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw new StagedCommitListLimitExceededError(maxListLimit);
  }
}

function stagedCommitTransitionIsAllowed(
  from: KnowledgeSpaceStagedCommitStatus,
  to: KnowledgeSpaceStagedCommitStatus,
): boolean {
  if (from === to) {
    return true;
  }

  if (terminalStatuses.has(from)) {
    return false;
  }

  if (nonProgressStatuses.has(to)) {
    return true;
  }

  return stagedCommitStatusRank(to) >= stagedCommitStatusRank(from);
}

function stagedCommitStatusRank(status: KnowledgeSpaceStagedCommitStatus): number {
  return stagedCommitStatusOrder.indexOf(status);
}

function scopedIdempotencyKey(commit: KnowledgeSpaceStagedCommit): string {
  return `${commit.tenantId}:${commit.knowledgeSpaceId}:${commit.idempotencyKey}`;
}

function cloneCommit(commit: KnowledgeSpaceStagedCommit): KnowledgeSpaceStagedCommit {
  return KnowledgeSpaceStagedCommitSchema.parse(JSON.parse(JSON.stringify(commit)) as unknown);
}

const stagedCommitStatusOrder: readonly KnowledgeSpaceStagedCommitStatus[] = [
  "received",
  "object-staged",
  "object-verified",
  "metadata-prepared",
  "artifacts-built",
  "nodes-built",
  "projections-built",
  "published",
  "gc-pending",
  "gc-complete",
];

const terminalStatuses = new Set<KnowledgeSpaceStagedCommitStatus>([
  "published",
  "failed-terminal",
  "canceled",
  "gc-complete",
]);

const nonProgressStatuses = new Set<KnowledgeSpaceStagedCommitStatus>([
  "failed-retryable",
  "failed-terminal",
  "canceled",
  "gc-pending",
  "gc-complete",
]);
