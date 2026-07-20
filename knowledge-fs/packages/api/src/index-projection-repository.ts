import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
  IndexProjection,
} from "@knowledge/core";
import { IndexProjectionSchema } from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  indexProjectionInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import {
  GenerationScopedIndexProjectionLifecycleError,
  type PublishedGenerationReferenceGuard,
  assertDatabaseGenerationNotPublished,
  assertExactGenerationReplay,
  assertInMemoryGenerationNotPublished,
} from "./generation-immutability";
import { jsonObjectColumn } from "./json-utils";
import { validateKnowledgeNodeBatchIds } from "./knowledge-node-repository";
import { normalizeMixedLanguageFtsText } from "./retrieval-text-utils";
import {
  MAX_TIDB_FTS_POSTINGS_PER_BATCH,
  MAX_TIDB_FTS_TERMS_PER_PROJECTION,
  type TidbFtsPosting,
  type TidbFtsProjectionPostingPlan,
  createTidbFtsProjectionPostingPlans,
} from "./tidb-fts-postings";

export interface IndexProjectionCursor {
  readonly id: string;
  readonly nodeId: string;
}

export interface GetManyIndexProjectionsInput {
  readonly ids: readonly string[];
  readonly knowledgeSpaceId: string;
}

export interface ListReadyIndexProjectionsInput {
  readonly cursor?: IndexProjectionCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly publicationGenerationId?: string | undefined;
  readonly type: IndexProjection["type"];
}

export interface ListIndexProjectionsResult {
  readonly items: IndexProjection[];
  readonly nextCursor?: IndexProjectionCursor;
}

export interface IndexProjectionVersionInput {
  readonly knowledgeSpaceId: string;
  readonly projectionVersion: number;
  readonly publicationGenerationId?: string | undefined;
  readonly type: IndexProjection["type"];
}

export interface PruneInactiveIndexProjectionVersionsInput {
  readonly knowledgeSpaceId: string;
  readonly maxProjections: number;
  readonly publicationGenerationId?: string | undefined;
  readonly retainVersions: number;
  readonly type: IndexProjection["type"];
}

export interface IndexProjectionVersionSummary {
  readonly building: number;
  readonly failed: number;
  readonly ready: number;
  readonly stale: number;
  readonly total: number;
}

type MutableIndexProjectionVersionSummary = {
  -readonly [Key in keyof IndexProjectionVersionSummary]: IndexProjectionVersionSummary[Key];
};

export interface PublishIndexProjectionVersionResult {
  readonly published: number;
  readonly staled: number;
}

export interface RollbackIndexProjectionVersionResult {
  readonly failed: number;
}

export interface DeleteIndexProjectionsByNodeIdsInput {
  readonly knowledgeSpaceId: string;
  readonly maxProjections: number;
  readonly nodeIds: readonly string[];
}

export interface UpdateIndexProjectionStatusByIdsInput {
  readonly fromStatus?: IndexProjection["status"] | undefined;
  readonly knowledgeSpaceId: string;
  readonly projectionIds: readonly string[];
  readonly status: IndexProjection["status"];
}

export interface IndexProjectionRepository {
  createMany(projections: readonly IndexProjection[]): Promise<IndexProjection[]>;
  deleteByNodeIds(input: DeleteIndexProjectionsByNodeIdsInput): Promise<number>;
  getMany?(input: GetManyIndexProjectionsInput): Promise<IndexProjection[]>;
  listReadyBySpace(input: ListReadyIndexProjectionsInput): Promise<ListIndexProjectionsResult>;
  pruneInactiveVersions(input: PruneInactiveIndexProjectionVersionsInput): Promise<number>;
  publishVersion(input: IndexProjectionVersionInput): Promise<PublishIndexProjectionVersionResult>;
  rollbackVersion(
    input: IndexProjectionVersionInput,
  ): Promise<RollbackIndexProjectionVersionResult>;
  summarizeVersion(input: IndexProjectionVersionInput): Promise<IndexProjectionVersionSummary>;
  updateStatusByIds?(input: UpdateIndexProjectionStatusByIdsInput): Promise<number>;
}

export interface InMemoryIndexProjectionRepositoryOptions {
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
  readonly maxProjections: number;
  readonly publishedGenerationGuard?: PublishedGenerationReferenceGuard | undefined;
}

export interface DatabaseIndexProjectionRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
}

export class IndexProjectionCapacityExceededError extends Error {
  constructor(maxProjections: number) {
    super(`Index projection repository maxProjections=${maxProjections} exceeded`);
  }
}

export class GenerationScopedFtsPostingConflictError extends Error {
  readonly code = "GENERATION_SCOPED_FTS_POSTING_CONFLICT";

  constructor(projectionId: string) {
    super(`Generation-scoped FTS postings conflict for projectionId=${projectionId}`);
    this.name = "GenerationScopedFtsPostingConflictError";
  }
}

export function createInMemoryIndexProjectionRepository({
  maxBatchSize,
  maxListLimit,
  maxProjections,
  publishedGenerationGuard,
}: InMemoryIndexProjectionRepositoryOptions): IndexProjectionRepository {
  validateIndexProjectionRepositoryBounds({ maxBatchSize, maxListLimit, maxProjections });

  const projections = new Map<string, IndexProjection>();

  return {
    createMany: async (input) => {
      validateIndexProjectionBatch(input, maxBatchSize);
      const parsed = input.map((projection) =>
        cloneIndexProjection(IndexProjectionSchema.parse(projection)),
      );
      const next = new Map(projections);
      const persisted: IndexProjection[] = [];

      for (const projection of parsed) {
        if (projection.publicationGenerationId && projection.status !== "building") {
          throw new GenerationScopedIndexProjectionLifecycleError(
            "Generation-scoped index projections must be created in building status",
          );
        }
        const existing = Array.from(next.values()).find((candidate) =>
          hasSameLogicalProjection(candidate, projection),
        );
        const existingById = next.get(projection.id);
        if (projection.publicationGenerationId && (existing || existingById)) {
          const persistedProjection = existing ?? existingById;
          if (!persistedProjection) {
            throw new Error("Index projection immutable replay resolution failed");
          }
          assertExactGenerationReplay({
            componentType: "index-projection",
            incoming: projection,
            logicalKey: indexProjectionLogicalKey(projection),
            persisted: persistedProjection,
          });
          persisted.push(persistedProjection);
          continue;
        }
        const stored = existing ? { ...projection, id: existing.id } : projection;
        next.set(stored.id, cloneIndexProjection(stored));
        persisted.push(stored);
      }

      if (next.size > maxProjections) {
        throw new IndexProjectionCapacityExceededError(maxProjections);
      }

      projections.clear();
      for (const [id, projection] of next) {
        projections.set(id, projection);
      }

      return persisted.map(cloneIndexProjection);
    },
    deleteByNodeIds: async ({ knowledgeSpaceId, maxProjections, nodeIds }) => {
      // A real document deletion removes every historical/candidate generation for its nodes.
      validateKnowledgeNodeBatchIds(nodeIds, maxBatchSize);

      if (!Number.isInteger(maxProjections) || maxProjections < 1) {
        throw new Error("Index projection delete maxProjections must be at least 1");
      }

      const nodeIdSet = new Set(nodeIds);
      const selected = Array.from(projections.values())
        .filter((projection) => projection.knowledgeSpaceId === knowledgeSpaceId)
        .filter((projection) => nodeIdSet.has(projection.nodeId))
        .slice(0, maxProjections + 1);

      if (selected.length > maxProjections) {
        throw new Error(`Index projection delete maxProjections=${maxProjections} exceeded`);
      }

      for (const projection of selected) {
        if (projection.publicationGenerationId) {
          if (projection.status !== "failed") {
            throw new GenerationScopedIndexProjectionLifecycleError(
              "Only failed generation-scoped index projections can be deleted outside publication",
            );
          }
          await assertInMemoryGenerationNotPublished({
            componentKey: projection.id,
            componentType: "index-projection",
            guard: publishedGenerationGuard,
            knowledgeSpaceId: projection.knowledgeSpaceId,
            publicationGenerationId: projection.publicationGenerationId,
          });
        }
      }

      for (const projection of selected) {
        projections.delete(projection.id);
      }

      return selected.length;
    },
    getMany: async ({ ids, knowledgeSpaceId }) => {
      validateKnowledgeNodeBatchIds(ids, maxBatchSize);
      const selected = new Set(uniqueStrings(ids));

      return Array.from(projections.values())
        .filter(
          (projection) =>
            projection.knowledgeSpaceId === knowledgeSpaceId && selected.has(projection.id),
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(cloneIndexProjection);
    },
    listReadyBySpace: async (input) => {
      validateIndexProjectionListLimit(input.limit, maxListLimit);
      const rows = Array.from(projections.values())
        .filter((projection) => projection.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter(
          (projection) =>
            (projection.publicationGenerationId ?? undefined) === input.publicationGenerationId,
        )
        .filter((projection) => projection.type === input.type)
        .filter((projection) => projection.status === "ready")
        .filter((projection) => isIndexProjectionAfterCursor(projection, input.cursor))
        .sort(compareIndexProjectionsForSpace);
      const page = rows.slice(0, input.limit + 1);
      const items = page.slice(0, input.limit).map(cloneIndexProjection);
      const lastItem = items.at(-1);
      const nextCursor =
        page.length > input.limit && lastItem ? indexProjectionCursor(lastItem) : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    pruneInactiveVersions: async (input) => {
      validateIndexProjectionPruneInput(input);
      const retainedVersions = new Set(
        Array.from(projections.values())
          .filter((projection) => isProjectionInMaintenanceScope(projection, input))
          .map((projection) => projection.projectionVersion)
          .filter((version, index, versions) => versions.indexOf(version) === index)
          .sort((left, right) => right - left)
          .slice(0, input.retainVersions),
      );
      const selected = Array.from(projections.values())
        .filter((projection) => isProjectionInMaintenanceScope(projection, input))
        .filter((projection) => projection.status === "stale" || projection.status === "failed")
        .filter((projection) => !retainedVersions.has(projection.projectionVersion))
        .slice(0, input.maxProjections + 1);

      if (selected.length > input.maxProjections) {
        throw new Error(`Index projection prune maxProjections=${input.maxProjections} exceeded`);
      }

      if (input.publicationGenerationId) {
        if (selected.some((projection) => projection.status !== "failed")) {
          throw new GenerationScopedIndexProjectionLifecycleError(
            "Only failed generation-scoped index projections can be pruned",
          );
        }
        await assertInMemoryGenerationNotPublished({
          componentType: "index-projection",
          guard: publishedGenerationGuard,
          knowledgeSpaceId: input.knowledgeSpaceId,
          publicationGenerationId: input.publicationGenerationId,
        });
      }

      for (const projection of selected) {
        projections.delete(projection.id);
      }

      return selected.length;
    },
    publishVersion: async (input) => {
      validateIndexProjectionVersionInput(input);
      if (input.publicationGenerationId) {
        throw new GenerationScopedIndexProjectionLifecycleError(
          "Generation-scoped index projections can become ready only in the candidate publication transaction",
        );
      }
      let published = 0;
      let staled = 0;

      for (const projection of projections.values()) {
        if (!isProjectionInMaintenanceScope(projection, input)) {
          continue;
        }

        if (projection.projectionVersion === input.projectionVersion) {
          if (projection.status === "building") {
            projection.status = "ready";
            published += 1;
          }
          continue;
        }

        if (projection.status === "ready") {
          projection.status = "stale";
          staled += 1;
        }
      }

      return { published, staled };
    },
    rollbackVersion: async (input) => {
      validateIndexProjectionVersionInput(input);
      if (input.publicationGenerationId) {
        await assertInMemoryGenerationNotPublished({
          componentType: "index-projection",
          guard: publishedGenerationGuard,
          knowledgeSpaceId: input.knowledgeSpaceId,
          publicationGenerationId: input.publicationGenerationId,
        });
      }
      let failed = 0;

      for (const projection of projections.values()) {
        if (
          isProjectionInMaintenanceScope(projection, input) &&
          projection.projectionVersion === input.projectionVersion &&
          projection.status === "building"
        ) {
          projection.status = "failed";
          failed += 1;
        }
      }

      return { failed };
    },
    summarizeVersion: async (input) => {
      validateIndexProjectionVersionInput(input);
      const summary = emptyIndexProjectionVersionSummary();

      for (const projection of projections.values()) {
        if (
          isProjectionInMaintenanceScope(projection, input) &&
          projection.projectionVersion === input.projectionVersion
        ) {
          summary[projection.status] += 1;
          summary.total += 1;
        }
      }

      return summary;
    },
    updateStatusByIds: async ({ fromStatus, knowledgeSpaceId, projectionIds, status }) => {
      validateKnowledgeNodeBatchIds(projectionIds, maxBatchSize);
      const uniqueProjectionIds = new Set(projectionIds);
      const targets = Array.from(projections.values()).filter(
        (projection) =>
          projection.knowledgeSpaceId === knowledgeSpaceId &&
          uniqueProjectionIds.has(projection.id) &&
          (fromStatus === undefined || projection.status === fromStatus),
      );

      for (const projection of targets) {
        if (projection.publicationGenerationId) {
          if (
            status !== "failed" ||
            projection.status !== "building" ||
            fromStatus !== "building"
          ) {
            throw new GenerationScopedIndexProjectionLifecycleError(
              "Generation-scoped status updates only allow explicit building-to-failed cleanup",
            );
          }
          await assertInMemoryGenerationNotPublished({
            componentKey: projection.id,
            componentType: "index-projection",
            guard: publishedGenerationGuard,
            knowledgeSpaceId: projection.knowledgeSpaceId,
            publicationGenerationId: projection.publicationGenerationId,
          });
        }
      }

      for (const projection of targets) {
        projection.status = status;
      }

      return targets.length;
    },
  };
}

function hasSameLogicalProjection(left: IndexProjection, right: IndexProjection): boolean {
  return (
    left.nodeId === right.nodeId &&
    left.type === right.type &&
    left.projectionVersion === right.projectionVersion &&
    (left.model ?? "") === (right.model ?? "") &&
    (left.publicationGenerationId ?? "") === (right.publicationGenerationId ?? "")
  );
}

function indexProjectionLogicalKey(projection: IndexProjection): string {
  return JSON.stringify([
    projection.knowledgeSpaceId,
    projection.nodeId,
    projection.type,
    projection.projectionVersion,
    projection.model ?? null,
    projection.publicationGenerationId ?? null,
  ]);
}

export function createDatabaseIndexProjectionRepository({
  database,
  maxBatchSize,
  maxListLimit,
}: DatabaseIndexProjectionRepositoryOptions): IndexProjectionRepository {
  validateIndexProjectionRepositoryBounds({
    maxBatchSize,
    maxListLimit,
    maxProjections: Number.MAX_SAFE_INTEGER,
  });
  const tableName = "index_projections";

  return {
    createMany: async (input) => {
      validateIndexProjectionBatch(input, maxBatchSize);
      const projections = input.map((projection) =>
        cloneIndexProjection(IndexProjectionSchema.parse(projection)),
      );
      const tidbFtsPlans =
        database.dialect === "tidb" ? createTidbFtsProjectionPostingPlans(projections) : [];
      const write = async (executor: DatabaseExecutor) => {
        const immutableFtsRows = await lockExistingTidbFtsGenerationProjections({
          database,
          executor,
          plans: tidbFtsPlans,
          tableName,
        });
        const persisted = await databaseWriteIndexProjectionGroups({
          database,
          executor,
          projections,
          tableName,
        });
        await writeTidbFtsPostings({
          database,
          executor,
          immutableFtsRows,
          persisted,
          plans: tidbFtsPlans,
        });
        return persisted;
      };
      if (
        tidbFtsPlans.length === 0 &&
        projections.every((projection) => !projection.publicationGenerationId)
      ) {
        return write(database);
      }
      return database.transaction(write);
    },
    deleteByNodeIds: async ({ knowledgeSpaceId, maxProjections, nodeIds }) => {
      // A real document deletion removes every historical/candidate generation for its nodes.
      validateKnowledgeNodeBatchIds(nodeIds, maxBatchSize);

      if (!Number.isInteger(maxProjections) || maxProjections < 1) {
        throw new Error("Index projection delete maxProjections must be at least 1");
      }

      const uniqueNodeIds = uniqueStrings(nodeIds);

      if (uniqueNodeIds.length === 0) {
        return 0;
      }

      return database.transaction(async (transaction) => {
        const params = [knowledgeSpaceId, ...uniqueNodeIds] satisfies readonly DatabaseQueryValue[];
        const nodeIdPlaceholders = uniqueNodeIds
          .map((_, index) => databasePlaceholder(database, index + 2))
          .join(", ");
        const selected = await transaction.execute({
          maxRows: maxProjections + 1,
          operation: "select",
          params,
          sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "node_id",
          )} IN (${nodeIdPlaceholders}) LIMIT ${maxProjections + 1} FOR UPDATE;`,
          tableName,
        });
        if (selected.rows.length > maxProjections) {
          throw new Error(`Index projection delete maxProjections=${maxProjections} exceeded`);
        }
        const projections = selected.rows.map(mapIndexProjectionRow);
        for (const projection of projections) {
          if (!projection.publicationGenerationId) {
            continue;
          }
          if (projection.status !== "failed") {
            throw new GenerationScopedIndexProjectionLifecycleError(
              "Only failed generation-scoped index projections can be deleted outside publication",
            );
          }
          await assertDatabaseGenerationNotPublished({
            componentType: "index-projection",
            database,
            executor: transaction,
            knowledgeSpaceId,
            publicationGenerationId: projection.publicationGenerationId,
          });
        }
        const ids = projections.map((projection) => projection.id);
        if (ids.length === 0) {
          return 0;
        }
        const deleted = await transaction.execute({
          maxRows: ids.length,
          operation: "delete",
          params: ids,
          sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (${ids.map((_, index) => databasePlaceholder(database, index + 1)).join(", ")});`,
          tableName,
        });

        return deleted.rowsAffected;
      });
    },
    getMany: async ({ ids, knowledgeSpaceId }) => {
      validateKnowledgeNodeBatchIds(ids, maxBatchSize);
      const uniqueIds = uniqueStrings(ids);

      if (uniqueIds.length === 0) {
        return [];
      }

      const params = [knowledgeSpaceId, ...uniqueIds] satisfies readonly DatabaseQueryValue[];
      const placeholders = uniqueIds
        .map((_, index) => databasePlaceholder(database, index + 2))
        .join(", ");
      const result = await database.execute({
        maxRows: uniqueIds.length,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "id",
        )} IN (${placeholders}) ORDER BY ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${uniqueIds.length};`,
        tableName,
      });

      return result.rows.map(mapIndexProjectionRow);
    },
    listReadyBySpace: async ({
      cursor,
      knowledgeSpaceId,
      limit,
      publicationGenerationId,
      type,
    }) => {
      validateIndexProjectionListLimit(limit, maxListLimit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [knowledgeSpaceId, type, "ready"];
      const generationSql = publicationGenerationId
        ? (() => {
            params.push(publicationGenerationId);
            return ` = ${databasePlaceholder(database, params.length)}`;
          })()
        : " IS NULL";
      const cursorSql = cursor
        ? (() => {
            params.push(cursor.nodeId);
            const nodeIdPlaceholder = databasePlaceholder(database, params.length);
            params.push(cursor.id);
            const idPlaceholder = databasePlaceholder(database, params.length);
            return ` AND (${quoteDatabaseIdentifier(
              database,
              "node_id",
            )} > ${nodeIdPlaceholder} OR (${quoteDatabaseIdentifier(
              database,
              "node_id",
            )} = ${nodeIdPlaceholder} AND ${quoteDatabaseIdentifier(
              database,
              "id",
            )} > ${idPlaceholder}))`;
          })()
        : "";
      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "type",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "status",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )}${generationSql}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "node_id",
        )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
          database,
          params.length,
        )};`,
        tableName,
      });
      const rows = result.rows.map(mapIndexProjectionRow);
      const items = rows.slice(0, limit).map(cloneIndexProjection);
      const lastItem = items.at(-1);
      const nextCursor =
        rows.length > limit && lastItem ? indexProjectionCursor(lastItem) : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    pruneInactiveVersions: async (input) => {
      validateIndexProjectionPruneInput(input);
      const prune = async (executor: DatabaseExecutor) => {
        const params: DatabaseQueryValue[] = [input.knowledgeSpaceId, input.type];
        const generationPredicate = indexProjectionGenerationPredicate(
          database,
          params,
          input.publicationGenerationId,
        );
        params.push(input.retainVersions);
        const retainVersionsPlaceholder = databasePlaceholder(database, params.length);
        params.push(input.maxProjections);
        const maxProjectionsPlaceholder = databasePlaceholder(database, params.length);
        const result = await executor.execute({
          maxRows: input.maxProjections,
          operation: "delete",
          params,
          sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (SELECT ${quoteDatabaseIdentifier(database, "id")} FROM (SELECT ${quoteDatabaseIdentifier(
            database,
            "id",
          )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "type",
          )} = ${databasePlaceholder(database, 2)} AND ${generationPredicate} AND ${quoteDatabaseIdentifier(
            database,
            "status",
          )} ${input.publicationGenerationId ? "= 'failed'" : "IN ('stale', 'failed')"} AND ${quoteDatabaseIdentifier(
            database,
            "projection_version",
          )} NOT IN (SELECT ${quoteDatabaseIdentifier(
            database,
            "projection_version",
          )} FROM (SELECT DISTINCT ${quoteDatabaseIdentifier(
            database,
            "projection_version",
          )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "type",
          )} = ${databasePlaceholder(database, 2)} AND ${generationPredicate} ORDER BY ${quoteDatabaseIdentifier(
            database,
            "projection_version",
          )} DESC LIMIT ${retainVersionsPlaceholder}) AS retained_index_projection_versions) ORDER BY ${quoteDatabaseIdentifier(
            database,
            "projection_version",
          )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${maxProjectionsPlaceholder}) AS prunable_index_projections);`,
          tableName,
        });

        return result.rowsAffected;
      };

      if (!input.publicationGenerationId) {
        return prune(database);
      }
      return database.transaction(async (transaction) => {
        await assertDatabaseGenerationNotPublished({
          componentType: "index-projection",
          database,
          executor: transaction,
          knowledgeSpaceId: input.knowledgeSpaceId,
          publicationGenerationId: input.publicationGenerationId as string,
        });
        return prune(transaction);
      });
    },
    publishVersion: async (input) => {
      validateIndexProjectionVersionInput(input);
      if (input.publicationGenerationId) {
        throw new GenerationScopedIndexProjectionLifecycleError(
          "Generation-scoped index projections can become ready only in the candidate publication transaction",
        );
      }
      const publishedParams: DatabaseQueryValue[] = [
        "ready",
        input.knowledgeSpaceId,
        input.type,
        input.projectionVersion,
        "building",
      ];
      const publishedGenerationPredicate = indexProjectionGenerationPredicate(
        database,
        publishedParams,
        input.publicationGenerationId,
      );
      const published = await database.execute({
        maxRows: Number.MAX_SAFE_INTEGER,
        operation: "update",
        params: publishedParams,
        sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
          database,
          "status",
        )} = ${databasePlaceholder(database, 1)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "type",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "projection_version",
        )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
          database,
          "status",
        )} = ${databasePlaceholder(database, 5)} AND ${publishedGenerationPredicate};`,
        tableName,
      });
      const staledParams: DatabaseQueryValue[] = [
        "stale",
        input.knowledgeSpaceId,
        input.type,
        "ready",
        input.projectionVersion,
      ];
      const staledGenerationPredicate = indexProjectionGenerationPredicate(
        database,
        staledParams,
        input.publicationGenerationId,
      );
      const staled = await database.execute({
        maxRows: Number.MAX_SAFE_INTEGER,
        operation: "update",
        params: staledParams,
        sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
          database,
          "status",
        )} = ${databasePlaceholder(database, 1)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "type",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "status",
        )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
          database,
          "projection_version",
        )} <> ${databasePlaceholder(database, 5)} AND ${staledGenerationPredicate};`,
        tableName,
      });

      return { published: published.rowsAffected, staled: staled.rowsAffected };
    },
    rollbackVersion: async (input) => {
      validateIndexProjectionVersionInput(input);
      const rollback = async (executor: DatabaseExecutor) => {
        const params: DatabaseQueryValue[] = [
          "failed",
          input.knowledgeSpaceId,
          input.type,
          input.projectionVersion,
          "building",
        ];
        const generationPredicate = indexProjectionGenerationPredicate(
          database,
          params,
          input.publicationGenerationId,
        );
        const failed = await executor.execute({
          maxRows: Number.MAX_SAFE_INTEGER,
          operation: "update",
          params,
          sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
            database,
            "status",
          )} = ${databasePlaceholder(database, 1)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
            database,
            "type",
          )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
            database,
            "projection_version",
          )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
            database,
            "status",
          )} = ${databasePlaceholder(database, 5)} AND ${generationPredicate};`,
          tableName,
        });

        return { failed: failed.rowsAffected };
      };

      if (!input.publicationGenerationId) {
        return rollback(database);
      }
      return database.transaction(async (transaction) => {
        await assertDatabaseGenerationNotPublished({
          componentType: "index-projection",
          database,
          executor: transaction,
          knowledgeSpaceId: input.knowledgeSpaceId,
          publicationGenerationId: input.publicationGenerationId as string,
        });
        return rollback(transaction);
      });
    },
    summarizeVersion: async (input) => {
      validateIndexProjectionVersionInput(input);
      const params: DatabaseQueryValue[] = [
        input.knowledgeSpaceId,
        input.type,
        input.projectionVersion,
      ];
      const generationPredicate = indexProjectionGenerationPredicate(
        database,
        params,
        input.publicationGenerationId,
      );
      const result = await database.execute({
        maxRows: 4,
        operation: "select",
        params,
        sql: `SELECT ${quoteDatabaseIdentifier(database, "status")}, COUNT(*) AS ${quoteDatabaseIdentifier(
          database,
          "count",
        )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "type",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "projection_version",
        )} = ${databasePlaceholder(database, 3)} AND ${generationPredicate} GROUP BY ${quoteDatabaseIdentifier(
          database,
          "status",
        )};`,
        tableName,
      });
      const summary = emptyIndexProjectionVersionSummary();

      for (const row of result.rows) {
        const status = stringColumn(row, "status");
        const count = integerCountColumn(row, "count");

        if (
          status === "building" ||
          status === "failed" ||
          status === "ready" ||
          status === "stale"
        ) {
          summary[status] = count;
          summary.total += count;
        }
      }

      return summary;
    },
    updateStatusByIds: async ({ fromStatus, knowledgeSpaceId, projectionIds, status }) => {
      validateKnowledgeNodeBatchIds(projectionIds, maxBatchSize);
      const uniqueProjectionIds = uniqueStrings(projectionIds);

      if (uniqueProjectionIds.length === 0) {
        return 0;
      }

      return database.transaction(async (transaction) => {
        const selectParams = [
          knowledgeSpaceId,
          ...uniqueProjectionIds,
        ] satisfies readonly DatabaseQueryValue[];
        const selected = await transaction.execute({
          maxRows: uniqueProjectionIds.length,
          operation: "select",
          params: selectParams,
          sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (${uniqueProjectionIds
            .map((_, index) => databasePlaceholder(database, index + 2))
            .join(", ")}) FOR UPDATE;`,
          tableName,
        });
        const targets = selected.rows
          .map(mapIndexProjectionRow)
          .filter((projection) => fromStatus === undefined || projection.status === fromStatus);
        const generations = new Set<string>();
        for (const projection of targets) {
          if (!projection.publicationGenerationId) {
            continue;
          }
          if (
            status !== "failed" ||
            fromStatus !== "building" ||
            projection.status !== "building"
          ) {
            throw new GenerationScopedIndexProjectionLifecycleError(
              "Generation-scoped status updates only allow explicit building-to-failed cleanup",
            );
          }
          generations.add(projection.publicationGenerationId);
        }
        for (const publicationGenerationId of generations) {
          await assertDatabaseGenerationNotPublished({
            componentType: "index-projection",
            database,
            executor: transaction,
            knowledgeSpaceId,
            publicationGenerationId,
          });
        }

        const params: DatabaseQueryValue[] = [status, knowledgeSpaceId, ...uniqueProjectionIds];
        const idPlaceholders = uniqueProjectionIds
          .map((_, index) => databasePlaceholder(database, index + 3))
          .join(", ");
        const fromStatusSql =
          fromStatus === undefined
            ? ""
            : (() => {
                params.push(fromStatus);
                return ` AND ${quoteDatabaseIdentifier(
                  database,
                  "status",
                )} = ${databasePlaceholder(database, params.length)}`;
              })();
        const result = await transaction.execute({
          maxRows: uniqueProjectionIds.length,
          operation: "update",
          params,
          sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
            database,
            "status",
          )} = ${databasePlaceholder(database, 1)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (${idPlaceholders})${fromStatusSql};`,
          tableName,
        });

        return result.rowsAffected;
      });
    },
  };
}

async function lockExistingTidbFtsGenerationProjections({
  database,
  executor,
  plans,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly plans: readonly TidbFtsProjectionPostingPlan[];
  readonly tableName: string;
}): Promise<ReadonlyMap<string, IndexProjection>> {
  const existing = new Map<string, IndexProjection>();
  if (database.dialect !== "tidb") {
    return existing;
  }

  for (const plan of plans) {
    const projection = plan.projection;
    if (!projection.publicationGenerationId) {
      continue;
    }
    const params: DatabaseQueryValue[] = [
      projection.knowledgeSpaceId,
      projection.nodeId,
      projection.type,
      projection.projectionVersion,
      projection.model ?? "",
      projection.publicationGenerationId,
    ];
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
        database,
        "node_id",
      )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
        database,
        "type",
      )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
        database,
        "projection_version",
      )} = ${databasePlaceholder(database, 4)} AND COALESCE(${quoteDatabaseIdentifier(
        database,
        "model",
      )}, '') = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
        database,
        "publication_generation_id",
      )} = ${databasePlaceholder(database, 6)} LIMIT 1 FOR UPDATE;`,
      tableName,
    });
    const row = result.rows[0];
    if (!row) {
      continue;
    }
    const persisted = mapIndexProjectionRow(row);
    assertExactGenerationReplay({
      componentType: "index-projection",
      incoming: projection,
      logicalKey: indexProjectionLogicalKey(projection),
      persisted,
    });
    existing.set(indexProjectionLogicalKey(projection), persisted);
  }

  return existing;
}

async function writeTidbFtsPostings({
  database,
  executor,
  immutableFtsRows,
  persisted,
  plans,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly immutableFtsRows: ReadonlyMap<string, IndexProjection>;
  readonly persisted: readonly IndexProjection[];
  readonly plans: readonly TidbFtsProjectionPostingPlan[];
}): Promise<void> {
  if (database.dialect !== "tidb" || plans.length === 0) {
    return;
  }
  const persistedByLogicalKey = new Map(
    persisted.map((projection) => [indexProjectionLogicalKey(projection), projection]),
  );
  const legacyProjectionIds: string[] = [];
  const inserts: Array<{
    readonly posting: TidbFtsPosting;
    readonly projection: IndexProjection;
  }> = [];

  for (const plan of plans) {
    const logicalKey = indexProjectionLogicalKey(plan.projection);
    const projection = persistedByLogicalKey.get(logicalKey);
    if (!projection) {
      throw new Error("TiDB FTS posting write did not resolve its projection");
    }
    const existingImmutable = immutableFtsRows.get(logicalKey);
    if (existingImmutable) {
      await assertExactTidbFtsPostings({ executor, plan, projection: existingImmutable });
      continue;
    }
    if (!projection.publicationGenerationId) {
      legacyProjectionIds.push(projection.id);
    }
    for (const posting of plan.postings) {
      inserts.push({ posting, projection });
    }
  }

  if (legacyProjectionIds.length > 0) {
    const ids = uniqueStrings(legacyProjectionIds);
    await executor.execute({
      maxRows: MAX_TIDB_FTS_POSTINGS_PER_BATCH,
      operation: "delete",
      params: ids,
      sql: `DELETE FROM ${quoteDatabaseIdentifier(
        database,
        "index_projection_fts_postings",
      )} WHERE ${quoteDatabaseIdentifier(database, "projection_id")} IN (${ids
        .map((_, index) => databasePlaceholder(database, index + 1))
        .join(", ")});`,
      tableName: "index_projection_fts_postings",
    });
  }

  if (inserts.length === 0) {
    return;
  }
  const columns = [
    "id",
    "knowledge_space_id",
    "projection_id",
    "tokenizer_version",
    "term_hash",
    "term",
    "term_frequency",
    "document_token_count",
  ];
  const params = inserts.flatMap(({ posting, projection }) => [
    randomUUID(),
    projection.knowledgeSpaceId,
    projection.id,
    posting.tokenizerVersion,
    posting.termHash,
    posting.term,
    posting.termFrequency,
    posting.documentTokenCount,
  ]) satisfies readonly DatabaseQueryValue[];
  const values = inserts
    .map((_, rowIndex) => {
      const offset = rowIndex * columns.length;
      return `(${columns
        .map((__, columnIndex) => databasePlaceholder(database, offset + columnIndex + 1))
        .join(", ")})`;
    })
    .join(", ");
  await executor.execute({
    maxRows: inserts.length,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(
      database,
      "index_projection_fts_postings",
    )} (${columns.map((column) => quoteDatabaseIdentifier(database, column)).join(", ")}) VALUES ${values};`,
    tableName: "index_projection_fts_postings",
  });
}

async function assertExactTidbFtsPostings({
  executor,
  plan,
  projection,
}: {
  readonly executor: DatabaseExecutor;
  readonly plan: TidbFtsProjectionPostingPlan;
  readonly projection: IndexProjection;
}): Promise<void> {
  const result = await executor.execute({
    maxRows: MAX_TIDB_FTS_TERMS_PER_PROJECTION + 1,
    operation: "select",
    params: [projection.id],
    sql: `SELECT ${[
      "knowledge_space_id",
      "projection_id",
      "tokenizer_version",
      "term_hash",
      "term",
      "term_frequency",
      "document_token_count",
    ]
      .map((column) => `\`${column}\``)
      .join(
        ", ",
      )} FROM \`index_projection_fts_postings\` WHERE \`projection_id\` = ? ORDER BY \`tokenizer_version\` ASC, \`term_hash\` ASC LIMIT ${MAX_TIDB_FTS_TERMS_PER_PROJECTION + 1} FOR UPDATE;`,
    tableName: "index_projection_fts_postings",
  });
  const expected = plan.postings;
  const matches =
    result.rows.length === expected.length &&
    result.rows.every((row, index) => {
      const posting = expected[index];
      return (
        posting !== undefined &&
        stringColumn(row, "knowledge_space_id") === projection.knowledgeSpaceId &&
        stringColumn(row, "projection_id") === projection.id &&
        stringColumn(row, "tokenizer_version") === posting.tokenizerVersion &&
        stringColumn(row, "term_hash") === posting.termHash &&
        stringColumn(row, "term") === posting.term &&
        integerCountColumn(row, "term_frequency") === posting.termFrequency &&
        integerCountColumn(row, "document_token_count") === posting.documentTokenCount
      );
    });

  if (!matches) {
    throw new GenerationScopedFtsPostingConflictError(projection.id);
  }
}

async function databaseWriteIndexProjectionGroups({
  database,
  executor,
  projections,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly projections: readonly IndexProjection[];
  readonly tableName: string;
}): Promise<IndexProjection[]> {
  validateImmutableIndexProjectionBatch(projections);
  const legacy = projections.filter((projection) => !projection.publicationGenerationId);
  const immutable = projections.filter((projection) => Boolean(projection.publicationGenerationId));
  const persistedLegacy = await databaseWriteIndexProjectionBatch({
    database,
    executor,
    immutable: false,
    projections: legacy,
    tableName,
  });
  const persistedImmutable = await databaseWriteIndexProjectionBatch({
    database,
    executor,
    immutable: true,
    projections: immutable,
    tableName,
  });
  const byLogicalKey = new Map(
    [...persistedLegacy, ...persistedImmutable].map((projection) => [
      indexProjectionLogicalKey(projection),
      projection,
    ]),
  );

  return projections.map((projection) => {
    const persisted = byLogicalKey.get(indexProjectionLogicalKey(projection));
    if (!persisted) {
      assertExactGenerationReplay({
        componentType: "index-projection",
        incoming: projection,
        logicalKey: indexProjectionLogicalKey(projection),
        persisted: null,
      });
      throw new Error("Index projection write did not persist its logical row");
    }
    return cloneIndexProjection(persisted);
  });
}

async function databaseWriteIndexProjectionBatch({
  database,
  executor,
  immutable,
  projections,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly immutable: boolean;
  readonly projections: readonly IndexProjection[];
  readonly tableName: string;
}): Promise<IndexProjection[]> {
  if (projections.length === 0) {
    return [];
  }
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "node_id",
    "type",
    "status",
    "model",
    "projection_version",
    "dense_vector",
    "visual_vector",
    "fts_document",
    "metadata",
  ];
  const params = projections.flatMap((projection) => [
    projection.id,
    projection.knowledgeSpaceId,
    projection.publicationGenerationId ?? null,
    projection.nodeId,
    projection.type,
    projection.status,
    projection.model ?? null,
    projection.projectionVersion,
    denseVectorParam(projection),
    visualVectorParam(projection),
    ftsDocumentParam(projection),
    JSON.stringify(projection.metadata),
  ]) satisfies readonly DatabaseQueryValue[];
  const values = projections
    .map((_, rowIndex) => {
      const offset = rowIndex * columns.length;
      return `(${columns
        .map((column, columnIndex) =>
          indexProjectionInsertPlaceholder(database, offset + columnIndex + 1, column),
        )
        .join(", ")})`;
    })
    .join(", ");
  const mutableColumns = ["status", "dense_vector", "visual_vector", "fts_document", "metadata"];
  const suffix = immutable
    ? database.dialect === "postgres"
      ? " ON CONFLICT DO NOTHING RETURNING *"
      : ` ON DUPLICATE KEY UPDATE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${quoteDatabaseIdentifier(database, "id")}`
    : database.dialect === "postgres"
      ? ` ON CONFLICT (${quoteDatabaseIdentifier(
          database,
          "node_id",
        )}, ${quoteDatabaseIdentifier(database, "type")}, ${quoteDatabaseIdentifier(
          database,
          "projection_version",
        )}, (COALESCE(${quoteDatabaseIdentifier(
          database,
          "model",
        )}, '')), (COALESCE(${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )}, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET ${mutableColumns
          .map(
            (column) =>
              `${quoteDatabaseIdentifier(database, column)} = EXCLUDED.${quoteDatabaseIdentifier(
                database,
                column,
              )}`,
          )
          .join(", ")} RETURNING *`
      : ` ON DUPLICATE KEY UPDATE ${mutableColumns
          .map(
            (column) =>
              `${quoteDatabaseIdentifier(database, column)} = VALUES(${quoteDatabaseIdentifier(
                database,
                column,
              )})`,
          )
          .join(", ")}`;
  const result = await executor.execute({
    maxRows: projections.length,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES ${values}${suffix};`,
    tableName,
  });

  if (!immutable && result.rows.length > 0) {
    return result.rows.map(mapIndexProjectionRow);
  }
  if (!immutable && database.dialect === "postgres") {
    return [...projections];
  }

  const persisted: IndexProjection[] = [];
  for (const projection of projections) {
    let row: IndexProjection;
    try {
      row = await getDatabaseIndexProjectionByLogicalKey({
        database,
        executor,
        projection,
        tableName,
      });
    } catch (error) {
      if (!immutable) {
        throw error;
      }
      const byId = await getDatabaseIndexProjectionById({
        database,
        executor,
        id: projection.id,
        knowledgeSpaceId: projection.knowledgeSpaceId,
        tableName,
      });
      assertExactGenerationReplay({
        componentType: "index-projection",
        incoming: projection,
        logicalKey: indexProjectionLogicalKey(projection),
        persisted: byId,
      });
      throw error;
    }
    if (immutable) {
      assertExactGenerationReplay({
        componentType: "index-projection",
        incoming: projection,
        logicalKey: indexProjectionLogicalKey(projection),
        persisted: row,
      });
    }
    persisted.push(row);
  }
  return persisted;
}

async function getDatabaseIndexProjectionByLogicalKey({
  database,
  executor,
  projection,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly projection: IndexProjection;
  readonly tableName: string;
}): Promise<IndexProjection> {
  const params: DatabaseQueryValue[] = [
    projection.knowledgeSpaceId,
    projection.nodeId,
    projection.type,
    projection.projectionVersion,
    projection.model ?? "",
  ];
  const generationSql = projection.publicationGenerationId
    ? (() => {
        params.push(projection.publicationGenerationId);
        return ` = ${databasePlaceholder(database, params.length)}`;
      })()
    : " IS NULL";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "node_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "type",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "projection_version",
    )} = ${databasePlaceholder(database, 4)} AND COALESCE(${quoteDatabaseIdentifier(
      database,
      "model",
    )}, '') = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )}${generationSql} LIMIT 1;`,
    tableName,
  });
  const row = result.rows[0];

  if (!row) {
    throw new Error("Index projection upsert did not persist its logical row");
  }

  return mapIndexProjectionRow(row);
}

async function getDatabaseIndexProjectionById({
  database,
  executor,
  id,
  knowledgeSpaceId,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly tableName: string;
}): Promise<IndexProjection | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [knowledgeSpaceId, id],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
    tableName,
  });

  return result.rows[0] ? mapIndexProjectionRow(result.rows[0]) : null;
}

export function mapIndexProjectionRow(row: DatabaseRow): IndexProjection {
  const model = optionalStringColumn(row, "model");
  const publicationGenerationId = optionalStringColumn(row, "publication_generation_id");

  return IndexProjectionSchema.parse({
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    ...(model ? { model } : {}),
    nodeId: stringColumn(row, "node_id"),
    ...(publicationGenerationId ? { publicationGenerationId } : {}),
    projectionVersion: numberColumn(row, "projection_version"),
    status: stringColumn(row, "status"),
    type: stringColumn(row, "type"),
  });
}

export function cloneIndexProjection(projection: IndexProjection): IndexProjection {
  return IndexProjectionSchema.parse(JSON.parse(JSON.stringify(projection)) as unknown);
}

function validateIndexProjectionRepositoryBounds({
  maxBatchSize,
  maxListLimit,
  maxProjections,
}: {
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
  readonly maxProjections: number;
}) {
  if (maxBatchSize < 1) {
    throw new Error("Index projection repository maxBatchSize must be at least 1");
  }

  if (maxListLimit < 1) {
    throw new Error("Index projection repository maxListLimit must be at least 1");
  }

  if (maxProjections < 1) {
    throw new Error("Index projection repository maxProjections must be at least 1");
  }
}

function validateIndexProjectionBatch(
  projections: readonly IndexProjection[],
  maxBatchSize: number,
) {
  if (projections.length < 1) {
    throw new Error("Index projection batch must contain at least 1 projection");
  }

  if (projections.length > maxBatchSize) {
    throw new Error(`Index projection batch size exceeds maxBatchSize=${maxBatchSize}`);
  }
}

function validateImmutableIndexProjectionBatch(projections: readonly IndexProjection[]): void {
  const logical = new Map<string, IndexProjection>();
  const physical = new Map<string, IndexProjection>();
  for (const projection of projections) {
    if (!projection.publicationGenerationId) {
      continue;
    }
    if (projection.status !== "building") {
      throw new GenerationScopedIndexProjectionLifecycleError(
        "Generation-scoped index projections must be created in building status",
      );
    }
    const logicalKey = indexProjectionLogicalKey(projection);
    const physicalKey = `${projection.knowledgeSpaceId}:${projection.publicationGenerationId}:${projection.id}`;
    const existingLogical = logical.get(logicalKey);
    const existingPhysical = physical.get(physicalKey);
    if (existingLogical) {
      assertExactGenerationReplay({
        componentType: "index-projection",
        incoming: projection,
        logicalKey,
        persisted: existingLogical,
      });
    }
    if (existingPhysical) {
      assertExactGenerationReplay({
        componentType: "index-projection",
        incoming: projection,
        logicalKey,
        persisted: existingPhysical,
      });
    }
    logical.set(logicalKey, projection);
    physical.set(physicalKey, projection);
  }
}

function validateIndexProjectionListLimit(limit: number, maxListLimit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Index projection list limit must be at least 1");
  }

  if (limit > maxListLimit) {
    throw new Error(`Index projection list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

function validateIndexProjectionVersionInput({
  knowledgeSpaceId,
  projectionVersion,
  type,
}: IndexProjectionVersionInput) {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Index projection knowledgeSpaceId is required");
  }

  if (!IndexProjectionSchema.shape.type.safeParse(type).success) {
    throw new Error("Index projection type is invalid");
  }

  if (!Number.isInteger(projectionVersion) || projectionVersion < 1) {
    throw new Error("Index projection version must be a positive integer");
  }
}

function validateIndexProjectionPruneInput({
  knowledgeSpaceId,
  maxProjections,
  retainVersions,
  type,
}: PruneInactiveIndexProjectionVersionsInput) {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Index projection knowledgeSpaceId is required");
  }

  if (!IndexProjectionSchema.shape.type.safeParse(type).success) {
    throw new Error("Index projection type is invalid");
  }

  if (!Number.isInteger(retainVersions) || retainVersions < 1) {
    throw new Error("Index projection prune retainVersions must be at least 1");
  }

  if (!Number.isInteger(maxProjections) || maxProjections < 1) {
    throw new Error("Index projection prune maxProjections must be at least 1");
  }
}

function emptyIndexProjectionVersionSummary(): MutableIndexProjectionVersionSummary {
  return {
    building: 0,
    failed: 0,
    ready: 0,
    stale: 0,
    total: 0,
  };
}

function integerCountColumn(row: DatabaseRow, column: string): number {
  const value = row[column];

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Database row column ${column} must be a nonnegative integer count`);
}

function isProjectionInMaintenanceScope(
  projection: IndexProjection,
  {
    knowledgeSpaceId,
    publicationGenerationId,
    type,
  }: Pick<IndexProjectionVersionInput, "knowledgeSpaceId" | "publicationGenerationId" | "type">,
): boolean {
  return (
    projection.knowledgeSpaceId === knowledgeSpaceId &&
    projection.type === type &&
    (projection.publicationGenerationId ?? undefined) === publicationGenerationId
  );
}

function indexProjectionGenerationPredicate(
  database: DatabaseAdapter,
  params: DatabaseQueryValue[],
  publicationGenerationId: string | undefined,
): string {
  const generationColumn = quoteDatabaseIdentifier(database, "publication_generation_id");

  if (publicationGenerationId === undefined) {
    return `${generationColumn} IS NULL`;
  }

  params.push(publicationGenerationId);
  return `${generationColumn} = ${databasePlaceholder(database, params.length)}`;
}

function compareIndexProjectionsForSpace(left: IndexProjection, right: IndexProjection): number {
  return left.nodeId.localeCompare(right.nodeId) || left.id.localeCompare(right.id);
}

function isIndexProjectionAfterCursor(
  projection: IndexProjection,
  cursor: IndexProjectionCursor | undefined,
): boolean {
  return (
    !cursor ||
    projection.nodeId > cursor.nodeId ||
    (projection.nodeId === cursor.nodeId && projection.id > cursor.id)
  );
}

function indexProjectionCursor(projection: IndexProjection): IndexProjectionCursor {
  return {
    id: projection.id,
    nodeId: projection.nodeId,
  };
}

// Only projections in a SEPARATE visual vector space (image-byte embeddings) go in visual_vector;
// text-surrogate visual projections share the text embedding space and stay in dense_vector.
function isSeparateVisualSpaceProjection(projection: IndexProjection): boolean {
  const multimodal = projection.metadata.multimodal;

  return (
    typeof multimodal === "object" &&
    multimodal !== null &&
    !Array.isArray(multimodal) &&
    (multimodal as Record<string, unknown>).vectorSpace === "visual"
  );
}

function projectionVectorJson(projection: IndexProjection): string {
  const denseVector = projection.metadata.denseVector;

  if (
    !Array.isArray(denseVector) ||
    !denseVector.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    throw new Error("Dense vector projection metadata must include denseVector");
  }

  return JSON.stringify(denseVector);
}

// Text (and text-surrogate visual) dense projections go in `dense_vector`; separate-visual-space
// (image-byte) projections go in `visual_vector`, so a text query never scores a visual-space vector.
function denseVectorParam(projection: IndexProjection): string | null {
  if (projection.type !== "dense-vector" || isSeparateVisualSpaceProjection(projection)) {
    return null;
  }

  return projectionVectorJson(projection);
}

function visualVectorParam(projection: IndexProjection): string | null {
  if (projection.type !== "dense-vector" || !isSeparateVisualSpaceProjection(projection)) {
    return null;
  }

  return projectionVectorJson(projection);
}

function ftsDocumentParam(projection: IndexProjection): string | null {
  if (projection.type !== "fts") {
    return null;
  }

  const ftsText = projection.metadata.ftsText;

  if (typeof ftsText !== "string" || ftsText.length === 0) {
    throw new Error("FTS projection metadata must include ftsText");
  }

  const normalized = normalizeMixedLanguageFtsText(ftsText);

  if (!normalized) {
    throw new Error("FTS projection metadata must include searchable ftsText");
  }

  return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
