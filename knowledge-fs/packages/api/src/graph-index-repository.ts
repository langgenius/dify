import { PublicationGenerationIdSchema } from "@knowledge/core";
import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { uniqueStrings } from "./api-shared-utils";
import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import type { EntityExtractionType, RelationExtractionType } from "./extraction-types";
import {
  type PublishedGenerationReferenceGuard,
  assertDatabaseGenerationNotPublished,
  assertExactGenerationReplay,
  assertInMemoryGenerationNotPublished,
} from "./generation-immutability";
import { cloneJsonObject, jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";

export interface GraphEntity {
  readonly aliases: readonly string[];
  readonly canonicalKey: string;
  readonly confidence: number;
  readonly createdAt: string;
  readonly extractionVersion: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly permissionScope: readonly string[];
  readonly publicationGenerationId?: string | undefined;
  readonly sourceNodeIds: readonly string[];
  readonly type: EntityExtractionType;
  readonly updatedAt: string;
}

export interface GraphRelation {
  readonly confidence: number;
  readonly createdAt: string;
  readonly extractionVersion: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly objectEntityId: string;
  readonly permissionScope: readonly string[];
  readonly publicationGenerationId?: string | undefined;
  readonly sourceNodeIds: readonly string[];
  readonly subjectEntityId: string;
  readonly type: RelationExtractionType;
  readonly updatedAt: string;
}

export interface GraphIndexRepository {
  deleteComponentsBySourceNodesAcrossGenerations(
    input: DeleteGraphComponentsBySourceNodesAcrossGenerationsInput,
  ): Promise<DeleteGraphComponentsBySourceNodesResult>;
  listEntities(input: ListGraphEntitiesInput): Promise<ListGraphEntitiesResult>;
  pruneSourceNodes(input: PruneGraphSourceNodesInput): Promise<PruneGraphSourceNodesResult>;
  pruneSourceNodesAcrossGenerations(
    input: PruneGraphSourceNodesAcrossGenerationsInput,
  ): Promise<PruneGraphSourceNodesResult>;
  traverse(input: TraverseGraphInput): Promise<GraphTraversalResult>;
  upsertEntities(entities: readonly GraphEntity[]): Promise<GraphEntity[]>;
  upsertRelations(relations: readonly GraphRelation[]): Promise<GraphRelation[]>;
}

export interface DeleteGraphComponentsBySourceNodesAcrossGenerationsInput
  extends Omit<PruneGraphSourceNodesInput, "publicationGenerationId"> {
  readonly maxGenerations: number;
}

export interface DeleteGraphComponentsBySourceNodesResult {
  readonly deletedEntities: number;
  readonly deletedRelations: number;
}

export interface GraphEntityCursor {
  readonly id: string;
  readonly name: string;
}

export interface ListGraphEntitiesInput {
  readonly cursor?: GraphEntityCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly publicationGenerationId?: string | undefined;
}

export interface ListGraphEntitiesResult {
  readonly items: GraphEntity[];
  readonly nextCursor?: GraphEntityCursor | undefined;
}

export interface PruneGraphSourceNodesInput {
  readonly knowledgeSpaceId: string;
  readonly maxSourceNodes: number;
  readonly publicationGenerationId?: string | undefined;
  readonly sourceNodeIds: readonly string[];
}

export interface PruneGraphSourceNodesResult {
  readonly prunedEntities: number;
  readonly prunedRelations: number;
  readonly updatedEntities: number;
  readonly updatedRelations: number;
}

export interface PruneGraphSourceNodesAcrossGenerationsInput
  extends Omit<PruneGraphSourceNodesInput, "publicationGenerationId"> {
  readonly maxGenerations: number;
}

export interface TraverseGraphInput {
  readonly fanout: number;
  readonly knowledgeSpaceId: string;
  readonly maxDepth: number;
  readonly maxNodes: number;
  /** Caller-visible permission scopes. Omitted scopes default to public-only traversal. */
  readonly permissionScope?: readonly string[] | undefined;
  readonly publicationGenerationId?: string | undefined;
  readonly startEntityId: string;
  readonly timeoutMs: number;
}

export interface GraphTraversalEntity extends GraphEntity {
  readonly depth: number;
}

export interface GraphTraversalRelation extends GraphRelation {
  readonly depth: number;
}

export interface GraphTraversalMetrics {
  readonly depthReached: number;
  readonly elapsedMs: number;
  readonly exploredRelations: number;
  readonly fanout: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly timedOut: boolean;
}

export interface GraphTraversalResult {
  readonly entities: GraphTraversalEntity[];
  readonly metrics: GraphTraversalMetrics;
  readonly relations: GraphTraversalRelation[];
  readonly truncated: boolean;
}

export interface InMemoryGraphIndexRepositoryOptions {
  readonly maxBatchSize: number;
  readonly maxEntities: number;
  readonly maxRelations: number;
  readonly now?: () => string;
  readonly publishedGenerationGuard?: PublishedGenerationReferenceGuard | undefined;
}

export interface DatabaseGraphIndexRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxBatchSize: number;
}

export function createInMemoryGraphIndexRepository({
  maxBatchSize,
  maxEntities,
  maxRelations,
  now = () => new Date().toISOString(),
  publishedGenerationGuard,
}: InMemoryGraphIndexRepositoryOptions): GraphIndexRepository {
  validateGraphRepositoryBounds({ maxBatchSize, maxEntities, maxRelations });

  const entities = new Map<string, GraphEntity>();
  const entitiesById = new Map<string, GraphEntity>();
  const relations = new Map<string, GraphRelation>();

  return {
    deleteComponentsBySourceNodesAcrossGenerations: async (input) => {
      validateGraphPruneSourceNodesAcrossGenerationsInput(input);
      return deleteInMemoryGraphComponentsBySourceNodes({
        entities,
        entitiesById,
        input,
        relations,
      });
    },
    listEntities: async (input) => {
      validateGraphListEntitiesInput(input);
      const publicationGenerationId = normalizeGraphPublicationGenerationId(
        input.publicationGenerationId,
        "Graph entity list",
      );
      const sorted = Array.from(entitiesById.values())
        .filter((entity) => entity.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter((entity) => graphRecordMatchesGeneration(entity, publicationGenerationId))
        .sort(compareGraphEntitiesForList);
      const afterCursor = input.cursor
        ? sorted.filter(
            (entity) => compareGraphEntityToCursor(entity, input.cursor as GraphEntityCursor) > 0,
          )
        : sorted;
      const page = afterCursor.slice(0, input.limit);
      const hasMore = afterCursor.length > input.limit;
      const last = page.at(-1);

      return {
        items: page.map(cloneGraphEntity),
        ...(hasMore && last ? { nextCursor: { id: last.id, name: last.name } } : {}),
      };
    },
    pruneSourceNodes: async (input) => {
      validateGraphPruneSourceNodesInput(input);
      const publicationGenerationId = normalizeGraphPublicationGenerationId(
        input.publicationGenerationId,
        "Graph source pruning",
      );
      if (publicationGenerationId) {
        await assertInMemoryGenerationNotPublished({
          componentType: "graph-entity",
          guard: publishedGenerationGuard,
          knowledgeSpaceId: input.knowledgeSpaceId,
          publicationGenerationId,
        });
      }
      return pruneInMemoryGraphSourceNodes({
        entities,
        entitiesById,
        input,
        now,
        publicationGenerationId,
        relations,
      });
    },
    pruneSourceNodesAcrossGenerations: async (input) => {
      validateGraphPruneSourceNodesAcrossGenerationsInput(input);
      const sourceNodeIds = new Set(input.sourceNodeIds);
      const generations = new Set(
        [...entities.values(), ...relations.values()]
          .filter((record) => record.knowledgeSpaceId === input.knowledgeSpaceId)
          .filter((record) => record.sourceNodeIds.some((id) => sourceNodeIds.has(id)))
          .map((record) => record.publicationGenerationId ?? "legacy"),
      );
      if (generations.size > input.maxGenerations) {
        throw new Error(
          `Graph source pruning generations exceeds maxGenerations=${input.maxGenerations}`,
        );
      }
      return pruneInMemoryGraphSourceNodes({
        acrossGenerations: true,
        entities,
        entitiesById,
        input,
        now,
        relations,
      });
    },
    traverse: async (input) => {
      const publicationGenerationId = normalizeGraphPublicationGenerationId(
        input.publicationGenerationId,
        "Graph traversal",
      );
      return traverseInMemoryGraph({
        entitiesById,
        input: { ...input, publicationGenerationId },
        nowMs: () => Date.now(),
        relations,
      });
    },
    upsertEntities: async (input) => {
      validateGraphEntityBatch(input, maxBatchSize);
      const parsed = input.map((entity) =>
        cloneGraphEntity({
          ...entity,
          publicationGenerationId: normalizeGraphPublicationGenerationId(
            entity.publicationGenerationId,
            "Graph entity",
          ),
        }),
      );
      validateGraphEntityLogicalBatch(parsed);
      const nextKeys = parsed.filter(
        (entity) => !entities.has(graphEntityStorageKey(entity)),
      ).length;

      if (entities.size + nextKeys > maxEntities) {
        throw new Error(`Graph entity capacity exceeded maxEntities=${maxEntities}`);
      }

      const timestamp = now();
      const stored = parsed.map((entity) => {
        const key = graphEntityStorageKey(entity);
        const existing = entities.get(key);
        if (entity.publicationGenerationId) {
          const existingById = entitiesById.get(graphEntityIdStorageKey(entity));
          if (existingById && existingById.canonicalKey !== entity.canonicalKey) {
            assertExactGenerationReplay({
              componentType: "graph-entity",
              incoming: entity,
              logicalKey: key,
              persisted: existingById,
            });
          }
          if (existing) {
            assertExactGenerationReplay({
              componentType: "graph-entity",
              incoming: entity,
              logicalKey: key,
              persisted: existing,
            });
            return cloneGraphEntity(existing);
          }
          const next = cloneGraphEntity(entity);
          entities.set(key, next);
          entitiesById.set(graphEntityIdStorageKey(next), next);
          return cloneGraphEntity(next);
        }
        const next = cloneGraphEntity({
          ...entity,
          aliases: uniqueStrings([...(existing?.aliases ?? []), ...entity.aliases]),
          confidence: Math.max(existing?.confidence ?? 0, entity.confidence),
          createdAt: existing?.createdAt ?? entity.createdAt,
          extractionVersion: Math.max(
            existing?.extractionVersion ?? entity.extractionVersion,
            entity.extractionVersion,
          ),
          id: existing?.id ?? entity.id,
          metadata: {
            ...(existing?.metadata ?? {}),
            ...entity.metadata,
          },
          permissionScope: uniqueStrings([
            ...(existing?.permissionScope ?? []),
            ...entity.permissionScope,
          ]),
          sourceNodeIds: uniqueStrings([
            ...(existing?.sourceNodeIds ?? []),
            ...entity.sourceNodeIds,
          ]),
          updatedAt: timestamp,
        });
        if (existing && existing.id !== next.id) {
          entitiesById.delete(graphEntityIdStorageKey(existing));
        }
        entities.set(key, next);
        entitiesById.set(graphEntityIdStorageKey(next), next);

        return cloneGraphEntity(next);
      });

      return stored;
    },
    upsertRelations: async (input) => {
      validateGraphRelationBatch(input, maxBatchSize);
      const parsed = input.map((relation) =>
        cloneGraphRelation({
          ...relation,
          publicationGenerationId: normalizeGraphPublicationGenerationId(
            relation.publicationGenerationId,
            "Graph relation",
          ),
        }),
      );
      validateGraphRelationLogicalBatch(parsed);
      const nextKeys = parsed.filter(
        (relation) => !relations.has(graphRelationStorageKey(relation)),
      ).length;

      if (relations.size + nextKeys > maxRelations) {
        throw new Error(`Graph relation capacity exceeded maxRelations=${maxRelations}`);
      }

      const timestamp = now();
      const stored = parsed.map((relation) => {
        const key = graphRelationStorageKey(relation);
        const existing = relations.get(key);
        if (relation.publicationGenerationId) {
          const existingById = Array.from(relations.values()).find(
            (candidate) =>
              candidate.knowledgeSpaceId === relation.knowledgeSpaceId &&
              candidate.publicationGenerationId === relation.publicationGenerationId &&
              candidate.id === relation.id,
          );
          if (existingById && graphRelationStorageKey(existingById) !== key) {
            assertExactGenerationReplay({
              componentType: "graph-relation",
              incoming: relation,
              logicalKey: key,
              persisted: existingById,
            });
          }
          if (existing) {
            assertExactGenerationReplay({
              componentType: "graph-relation",
              incoming: relation,
              logicalKey: key,
              persisted: existing,
            });
            return cloneGraphRelation(existing);
          }
          const next = cloneGraphRelation(relation);
          relations.set(key, next);
          return cloneGraphRelation(next);
        }
        const next = cloneGraphRelation({
          ...relation,
          confidence: Math.max(existing?.confidence ?? 0, relation.confidence),
          createdAt: existing?.createdAt ?? relation.createdAt,
          extractionVersion: Math.max(
            existing?.extractionVersion ?? relation.extractionVersion,
            relation.extractionVersion,
          ),
          id: existing?.id ?? relation.id,
          metadata: {
            ...(existing?.metadata ?? {}),
            ...relation.metadata,
          },
          permissionScope: uniqueStrings([
            ...(existing?.permissionScope ?? []),
            ...relation.permissionScope,
          ]),
          sourceNodeIds: uniqueStrings([
            ...(existing?.sourceNodeIds ?? []),
            ...relation.sourceNodeIds,
          ]),
          updatedAt: timestamp,
        });
        relations.set(key, next);

        return cloneGraphRelation(next);
      });

      return stored;
    },
  };
}

/**
 * Executor form used by durable deletion. The caller must run it in the same transaction as the
 * deletion lease/attempt fence so a stale worker cannot commit a graph cleanup page.
 */
export async function deleteDatabaseGraphComponentsBySourceNodesAcrossGenerations(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: DeleteGraphComponentsBySourceNodesAcrossGenerationsInput,
): Promise<DeleteGraphComponentsBySourceNodesResult> {
  validateGraphPruneSourceNodesAcrossGenerationsInput(input);
  const sourceNodeIds = JSON.stringify([...input.sourceNodeIds]);
  const generationRows = await executor.execute({
    maxRows: input.maxGenerations + 1,
    operation: "select",
    params:
      database.dialect === "postgres"
        ? [input.knowledgeSpaceId, sourceNodeIds]
        : [input.knowledgeSpaceId, sourceNodeIds, input.knowledgeSpaceId, sourceNodeIds],
    sql: graphSourceNodeGenerationInventorySql(database, input.maxGenerations + 1),
    tableName: "graph_entities",
  });
  if (generationRows.rows.length > input.maxGenerations) {
    throw new Error(
      `Graph source pruning generations exceeds maxGenerations=${input.maxGenerations}`,
    );
  }

  let deletedEntities = 0;
  let deletedRelations = 0;
  for (const row of generationRows.rows) {
    const publicationGenerationId = optionalStringColumn(row, "publication_generation_id");
    const postgresParams: DatabaseQueryValue[] = [input.knowledgeSpaceId, sourceNodeIds];
    if (publicationGenerationId) postgresParams.push(publicationGenerationId);
    const relationParams: DatabaseQueryValue[] =
      database.dialect === "postgres"
        ? postgresParams
        : [
            input.knowledgeSpaceId,
            ...(publicationGenerationId ? [publicationGenerationId] : []),
            sourceNodeIds,
            sourceNodeIds,
          ];
    const entityParams: DatabaseQueryValue[] =
      database.dialect === "postgres"
        ? postgresParams
        : [
            input.knowledgeSpaceId,
            ...(publicationGenerationId ? [publicationGenerationId] : []),
            sourceNodeIds,
          ];
    const relationsResult = await executor.execute({
      maxRows: 0,
      operation: "delete",
      params: relationParams,
      sql: graphDeleteContaminatedRelationsSql(database, publicationGenerationId !== undefined),
      tableName: "graph_relations",
    });
    const entitiesResult = await executor.execute({
      maxRows: 0,
      operation: "delete",
      params: entityParams,
      sql: graphDeleteContaminatedEntitiesSql(database, publicationGenerationId !== undefined),
      tableName: "graph_entities",
    });
    deletedRelations += relationsResult.rowsAffected;
    deletedEntities += entitiesResult.rowsAffected;
  }
  return { deletedEntities, deletedRelations };
}

export function createDatabaseGraphIndexRepository({
  database,
  maxBatchSize,
}: DatabaseGraphIndexRepositoryOptions): GraphIndexRepository {
  validateGraphRepositoryBounds({
    maxBatchSize,
    maxEntities: Number.MAX_SAFE_INTEGER,
    maxRelations: Number.MAX_SAFE_INTEGER,
  });

  return {
    deleteComponentsBySourceNodesAcrossGenerations: async (input) =>
      database.transaction((transaction) =>
        deleteDatabaseGraphComponentsBySourceNodesAcrossGenerations(database, transaction, input),
      ),
    listEntities: async (input) => {
      validateGraphListEntitiesInput(input);
      const publicationGenerationId = normalizeGraphPublicationGenerationId(
        input.publicationGenerationId,
        "Graph entity list",
      );
      const params: DatabaseQueryValue[] = [input.knowledgeSpaceId];
      const generationColumn = quoteDatabaseIdentifier(database, "publication_generation_id");
      const generationSql =
        publicationGenerationId === undefined
          ? ` AND ${generationColumn} IS NULL`
          : ` AND ${generationColumn} = ${databasePlaceholder(
              database,
              params.push(publicationGenerationId),
            )}`;
      let cursorSql = "";

      if (input.cursor) {
        const nameAfterPosition = params.push(input.cursor.name);
        const nameEqualPosition = params.push(input.cursor.name);
        const idPosition = params.push(input.cursor.id);
        cursorSql = ` AND (${quoteDatabaseIdentifier(database, "name")} > ${databasePlaceholder(
          database,
          nameAfterPosition,
        )} OR (${quoteDatabaseIdentifier(database, "name")} = ${databasePlaceholder(
          database,
          nameEqualPosition,
        )} AND ${quoteDatabaseIdentifier(database, "id")} > ${databasePlaceholder(
          database,
          idPosition,
        )}))`;
      }

      const limitPosition = params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "graph_entities")} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)}${generationSql}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "name",
        )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
          database,
          limitPosition,
        )};`,
        tableName: "graph_entities",
      });
      const rows = result.rows.map(mapGraphEntityRow);
      const items = rows.slice(0, input.limit);
      const hasMore = rows.length > input.limit;
      const last = items.at(-1);

      return {
        items: items.map(cloneGraphEntity),
        ...(hasMore && last ? { nextCursor: { id: last.id, name: last.name } } : {}),
      };
    },
    pruneSourceNodes: async (input) => {
      validateGraphPruneSourceNodesInput(input);
      const publicationGenerationId = normalizeGraphPublicationGenerationId(
        input.publicationGenerationId,
        "Graph source pruning",
      );
      const prune = async (executor: DatabaseExecutor) => {
        if (publicationGenerationId) {
          await assertDatabaseGenerationNotPublished({
            componentType: "graph-entity",
            database,
            executor,
            knowledgeSpaceId: input.knowledgeSpaceId,
            publicationGenerationId,
          });
        }
        const result = await executor.execute({
          maxRows: 1,
          operation: "delete",
          params: [
            input.knowledgeSpaceId,
            JSON.stringify([...input.sourceNodeIds]),
            ...(publicationGenerationId !== undefined ? [publicationGenerationId] : []),
          ],
          sql: graphPruneSourceNodesSql(database, publicationGenerationId !== undefined),
          tableName: "graph_relations",
        });
        const row = result.rows[0];

        return {
          prunedEntities: row ? numberColumn(row, "pruned_entities") : 0,
          prunedRelations: row ? numberColumn(row, "pruned_relations") : 0,
          updatedEntities: row ? numberColumn(row, "updated_entities") : 0,
          updatedRelations: row ? numberColumn(row, "updated_relations") : 0,
        };
      };
      return publicationGenerationId ? database.transaction(prune) : prune(database);
    },
    pruneSourceNodesAcrossGenerations: async (input) => {
      validateGraphPruneSourceNodesAcrossGenerationsInput(input);
      const sourceNodeIds = JSON.stringify([...input.sourceNodeIds]);

      return database.transaction(async (transaction) => {
        const generationRows = await transaction.execute({
          maxRows: input.maxGenerations + 1,
          operation: "select",
          params:
            database.dialect === "postgres"
              ? [input.knowledgeSpaceId, sourceNodeIds]
              : [input.knowledgeSpaceId, sourceNodeIds, input.knowledgeSpaceId, sourceNodeIds],
          sql: graphSourceNodeGenerationInventorySql(database, input.maxGenerations + 1),
          tableName: "graph_entities",
        });
        if (generationRows.rows.length > input.maxGenerations) {
          throw new Error(
            `Graph source pruning generations exceeds maxGenerations=${input.maxGenerations}`,
          );
        }
        const aggregate = {
          prunedEntities: 0,
          prunedRelations: 0,
          updatedEntities: 0,
          updatedRelations: 0,
        };
        for (const row of generationRows.rows) {
          const publicationGenerationId = optionalStringColumn(row, "publication_generation_id");
          const result = await transaction.execute({
            maxRows: 1,
            operation: "delete",
            params: [
              input.knowledgeSpaceId,
              sourceNodeIds,
              ...(publicationGenerationId ? [publicationGenerationId] : []),
            ],
            sql: graphPruneSourceNodesSql(database, publicationGenerationId !== undefined),
            tableName: "graph_relations",
          });
          const resultRow = result.rows[0];
          if (resultRow) {
            aggregate.prunedEntities += numberColumn(resultRow, "pruned_entities");
            aggregate.prunedRelations += numberColumn(resultRow, "pruned_relations");
            aggregate.updatedEntities += numberColumn(resultRow, "updated_entities");
            aggregate.updatedRelations += numberColumn(resultRow, "updated_relations");
          }
        }

        return aggregate;
      });
    },
    traverse: async (input) => {
      validateGraphTraversalInput(input);
      const publicationGenerationId = normalizeGraphPublicationGenerationId(
        input.publicationGenerationId,
        "Graph traversal",
      );
      const normalizedInput = { ...input, publicationGenerationId };
      const startedAt = Date.now();
      const permissionScope = JSON.stringify(uniqueStrings(input.permissionScope ?? []));
      const result = await database.execute({
        maxRows: input.maxNodes * (input.fanout + 1),
        operation: "select",
        params: graphTraversalParams(database, normalizedInput, permissionScope),
        sql: graphTraversalSql(database, publicationGenerationId !== undefined),
        tableName: "graph_relations",
      });

      return mapGraphTraversalRows({
        elapsedMs: Date.now() - startedAt,
        fanout: input.fanout,
        maxDepth: input.maxDepth,
        maxNodes: input.maxNodes,
        rows: result.rows,
      });
    },
    upsertEntities: async (input) => {
      validateGraphEntityBatch(input, maxBatchSize);
      const entities = input.map((entity) =>
        cloneGraphEntity({
          ...entity,
          publicationGenerationId: normalizeGraphPublicationGenerationId(
            entity.publicationGenerationId,
            "Graph entity",
          ),
        }),
      );

      if (entities.length === 0) {
        return [];
      }
      if (entities.every((entity) => !entity.publicationGenerationId)) {
        return databaseUpsertGraphEntities({ database, entities, executor: database });
      }
      return database.transaction((transaction) =>
        databaseUpsertGraphEntities({ database, entities, executor: transaction }),
      );
    },
    upsertRelations: async (input) => {
      validateGraphRelationBatch(input, maxBatchSize);
      const relations = input.map((relation) =>
        cloneGraphRelation({
          ...relation,
          publicationGenerationId: normalizeGraphPublicationGenerationId(
            relation.publicationGenerationId,
            "Graph relation",
          ),
        }),
      );

      if (relations.length === 0) {
        return [];
      }
      if (relations.every((relation) => !relation.publicationGenerationId)) {
        return databaseUpsertGraphRelations({ database, executor: database, relations });
      }
      return database.transaction((transaction) =>
        databaseUpsertGraphRelations({ database, executor: transaction, relations }),
      );
    },
  };
}

async function databaseUpsertGraphEntities({
  database,
  entities,
  executor,
}: {
  readonly database: DatabaseAdapter;
  readonly entities: readonly GraphEntity[];
  readonly executor: DatabaseExecutor;
}): Promise<GraphEntity[]> {
  validateGraphEntityLogicalBatch(entities);
  const legacy = entities.filter((entity) => !entity.publicationGenerationId);
  const immutable = entities.filter((entity) => Boolean(entity.publicationGenerationId));
  const persistedLegacy = await databaseWriteGraphEntityBatch({
    database,
    entities: legacy,
    executor,
    immutable: false,
  });
  const persistedImmutable = await databaseWriteGraphEntityBatch({
    database,
    entities: immutable,
    executor,
    immutable: true,
  });
  const byLogicalKey = new Map(
    [...persistedLegacy, ...persistedImmutable].map((entity) => [
      graphEntityStorageKey(entity),
      entity,
    ]),
  );

  return entities.map((entity) => {
    const persisted = byLogicalKey.get(graphEntityStorageKey(entity));
    if (!persisted) {
      throw new Error("Graph entity upsert did not persist its logical row");
    }
    return cloneGraphEntity(persisted);
  });
}

async function databaseWriteGraphEntityBatch({
  database,
  entities,
  executor,
  immutable,
}: {
  readonly database: DatabaseAdapter;
  readonly entities: readonly GraphEntity[];
  readonly executor: DatabaseExecutor;
  readonly immutable: boolean;
}): Promise<GraphEntity[]> {
  if (entities.length === 0) {
    return [];
  }
  const tableName = "graph_entities";
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "canonical_key",
    "type",
    "name",
    "aliases",
    "confidence",
    "source_node_ids",
    "permission_scope",
    "metadata",
    "extraction_version",
    "created_at",
    "updated_at",
  ];
  const params = entities.flatMap((entity) => [
    entity.id,
    entity.knowledgeSpaceId,
    entity.publicationGenerationId ?? null,
    entity.canonicalKey,
    entity.type,
    entity.name,
    JSON.stringify(entity.aliases),
    entity.confidence,
    JSON.stringify(entity.sourceNodeIds),
    JSON.stringify(entity.permissionScope),
    JSON.stringify(entity.metadata),
    entity.extractionVersion,
    entity.createdAt,
    entity.updatedAt,
  ]) satisfies readonly DatabaseQueryValue[];
  const mutableColumns = columns.filter(
    (column) =>
      column !== "id" &&
      column !== "knowledge_space_id" &&
      column !== "canonical_key" &&
      column !== "publication_generation_id",
  );
  const suffix = immutable
    ? database.dialect === "postgres"
      ? " ON CONFLICT DO NOTHING RETURNING *"
      : ` ON DUPLICATE KEY UPDATE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${quoteDatabaseIdentifier(database, "id")}`
    : database.dialect === "postgres"
      ? ` ON CONFLICT (${quoteDatabaseIdentifier(database, "knowledge_space_id")}, ${quoteDatabaseIdentifier(
          database,
          "canonical_key",
        )}, (COALESCE(${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )}, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET ${mutableColumns
          .map((column) => graphUpsertAssignment(database, tableName, column, "postgres"))
          .join(", ")} RETURNING *`
      : ` ON DUPLICATE KEY UPDATE ${mutableColumns
          .map((column) => graphUpsertAssignment(database, tableName, column, "tidb"))
          .join(", ")}`;
  const result = await executor.execute({
    maxRows: entities.length,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES ${databaseValuesSql(database, columns, entities.length)}${suffix};`,
    tableName,
  });

  if (!immutable && database.dialect === "postgres") {
    return result.rows.length > 0 ? result.rows.map(mapGraphEntityRow) : [...entities];
  }

  const persisted: GraphEntity[] = [];
  for (const entity of entities) {
    const row = await getGraphEntityByLogicalKey({ database, entity, executor, tableName });
    if (immutable) {
      assertExactGenerationReplay({
        componentType: "graph-entity",
        incoming: entity,
        logicalKey: graphEntityStorageKey(entity),
        persisted: row,
      });
    }
    persisted.push(row);
  }
  return persisted;
}

async function databaseUpsertGraphRelations({
  database,
  executor,
  relations,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly relations: readonly GraphRelation[];
}): Promise<GraphRelation[]> {
  validateGraphRelationLogicalBatch(relations);
  const legacy = relations.filter((relation) => !relation.publicationGenerationId);
  const immutable = relations.filter((relation) => Boolean(relation.publicationGenerationId));
  const persistedLegacy = await databaseWriteGraphRelationBatch({
    database,
    executor,
    immutable: false,
    relations: legacy,
  });
  const persistedImmutable = await databaseWriteGraphRelationBatch({
    database,
    executor,
    immutable: true,
    relations: immutable,
  });
  const byLogicalKey = new Map(
    [...persistedLegacy, ...persistedImmutable].map((relation) => [
      graphRelationStorageKey(relation),
      relation,
    ]),
  );

  return relations.map((relation) => {
    const persisted = byLogicalKey.get(graphRelationStorageKey(relation));
    if (!persisted) {
      throw new Error("Graph relation upsert did not persist its logical row");
    }
    return cloneGraphRelation(persisted);
  });
}

async function databaseWriteGraphRelationBatch({
  database,
  executor,
  immutable,
  relations,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly immutable: boolean;
  readonly relations: readonly GraphRelation[];
}): Promise<GraphRelation[]> {
  if (relations.length === 0) {
    return [];
  }
  const tableName = "graph_relations";
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "subject_entity_id",
    "object_entity_id",
    "type",
    "confidence",
    "source_node_ids",
    "permission_scope",
    "metadata",
    "extraction_version",
    "created_at",
    "updated_at",
  ];
  const params = relations.flatMap((relation) => [
    relation.id,
    relation.knowledgeSpaceId,
    relation.publicationGenerationId ?? null,
    relation.subjectEntityId,
    relation.objectEntityId,
    relation.type,
    relation.confidence,
    JSON.stringify(relation.sourceNodeIds),
    JSON.stringify(relation.permissionScope),
    JSON.stringify(relation.metadata),
    relation.extractionVersion,
    relation.createdAt,
    relation.updatedAt,
  ]) satisfies readonly DatabaseQueryValue[];
  const mutableColumns = columns.filter(
    (column) =>
      column !== "id" &&
      column !== "knowledge_space_id" &&
      column !== "publication_generation_id" &&
      column !== "subject_entity_id" &&
      column !== "object_entity_id" &&
      column !== "type" &&
      column !== "extraction_version",
  );
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
          "knowledge_space_id",
        )}, ${quoteDatabaseIdentifier(database, "subject_entity_id")}, ${quoteDatabaseIdentifier(
          database,
          "type",
        )}, ${quoteDatabaseIdentifier(database, "object_entity_id")}, ${quoteDatabaseIdentifier(
          database,
          "extraction_version",
        )}, (COALESCE(${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )}, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET ${mutableColumns
          .map((column) => graphUpsertAssignment(database, tableName, column, "postgres"))
          .join(", ")} RETURNING *`
      : ` ON DUPLICATE KEY UPDATE ${mutableColumns
          .map((column) => graphUpsertAssignment(database, tableName, column, "tidb"))
          .join(", ")}`;
  const result = await executor.execute({
    maxRows: relations.length,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES ${databaseValuesSql(database, columns, relations.length)}${suffix};`,
    tableName,
  });

  if (!immutable && database.dialect === "postgres") {
    return result.rows.length > 0 ? result.rows.map(mapGraphRelationRow) : [...relations];
  }

  const persisted: GraphRelation[] = [];
  for (const relation of relations) {
    const row = await getGraphRelationByLogicalKey({ database, executor, relation, tableName });
    if (immutable) {
      assertExactGenerationReplay({
        componentType: "graph-relation",
        incoming: relation,
        logicalKey: graphRelationStorageKey(relation),
        persisted: row,
      });
    }
    persisted.push(row);
  }
  return persisted;
}

async function getGraphEntityByLogicalKey({
  database,
  entity,
  executor,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly entity: GraphEntity;
  readonly executor: DatabaseExecutor;
  readonly tableName: string;
}): Promise<GraphEntity> {
  const result = await executor.execute({
    maxRows: 2,
    operation: "select",
    params: [entity.knowledgeSpaceId, entity.canonicalKey, entity.publicationGenerationId ?? null],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "canonical_key",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} ${database.dialect === "postgres" ? "IS NOT DISTINCT FROM" : "<=>"} ${databasePlaceholder(
      database,
      3,
    )}${database.dialect === "postgres" ? "::uuid" : ""} LIMIT 2;`,
    tableName,
  });

  const [row, duplicate] = result.rows;

  if (!row) {
    throw new Error("Graph entity upsert did not persist its logical row");
  }

  if (duplicate) {
    throw new Error("Graph entity upsert resolved multiple persisted logical rows");
  }

  const persisted = mapGraphEntityRow(row);

  if (
    persisted.knowledgeSpaceId !== entity.knowledgeSpaceId ||
    persisted.publicationGenerationId !== entity.publicationGenerationId ||
    persisted.canonicalKey !== entity.canonicalKey
  ) {
    throw new Error("Graph entity upsert resolved a mismatched persisted logical row");
  }

  return persisted;
}

async function getGraphRelationByLogicalKey({
  database,
  executor,
  relation,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly relation: GraphRelation;
  readonly tableName: string;
}): Promise<GraphRelation> {
  const result = await executor.execute({
    maxRows: 2,
    operation: "select",
    params: [
      relation.knowledgeSpaceId,
      relation.subjectEntityId,
      relation.type,
      relation.objectEntityId,
      relation.extractionVersion,
      relation.publicationGenerationId ?? null,
    ],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "subject_entity_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "type",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "object_entity_id",
    )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "extraction_version",
    )} = ${databasePlaceholder(database, 5)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )} ${database.dialect === "postgres" ? "IS NOT DISTINCT FROM" : "<=>"} ${databasePlaceholder(
      database,
      6,
    )}${database.dialect === "postgres" ? "::uuid" : ""} LIMIT 2;`,
    tableName,
  });

  const [row, duplicate] = result.rows;

  if (!row) {
    throw new Error("Graph relation upsert did not persist its logical row");
  }

  if (duplicate) {
    throw new Error("Graph relation upsert resolved multiple persisted logical rows");
  }

  const persisted = mapGraphRelationRow(row);

  if (
    persisted.knowledgeSpaceId !== relation.knowledgeSpaceId ||
    persisted.publicationGenerationId !== relation.publicationGenerationId ||
    persisted.subjectEntityId !== relation.subjectEntityId ||
    persisted.type !== relation.type ||
    persisted.objectEntityId !== relation.objectEntityId ||
    persisted.extractionVersion !== relation.extractionVersion
  ) {
    throw new Error("Graph relation upsert resolved a mismatched persisted logical row");
  }

  return persisted;
}

function graphUpsertAssignment(
  database: DatabaseAdapter,
  tableName: string,
  column: string,
  dialect: "postgres" | "tidb",
): string {
  const quotedColumn = quoteDatabaseIdentifier(database, column);
  const existing = `${quoteDatabaseIdentifier(database, tableName)}.${quotedColumn}`;
  const incoming = dialect === "postgres" ? `EXCLUDED.${quotedColumn}` : `VALUES(${quotedColumn})`;

  if (column === "aliases" || column === "source_node_ids" || column === "permission_scope") {
    if (dialect === "postgres") {
      return `${quotedColumn} = (SELECT COALESCE(jsonb_agg(merged.value ORDER BY merged.value), '[]'::jsonb) FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(${existing} || ${incoming})) AS merged(value))`;
    }

    return `${quotedColumn} = COALESCE((SELECT JSON_ARRAYAGG(merged.value) FROM (SELECT existing_values.value FROM JSON_TABLE(${existing}, '$[*]' COLUMNS (value VARCHAR(1024) PATH '$')) AS existing_values UNION SELECT incoming_values.value FROM JSON_TABLE(${incoming}, '$[*]' COLUMNS (value VARCHAR(1024) PATH '$')) AS incoming_values) AS merged), JSON_ARRAY())`;
  }

  if (column === "metadata") {
    return dialect === "postgres"
      ? `${quotedColumn} = ${existing} || ${incoming}`
      : `${quotedColumn} = JSON_MERGE_PATCH(${existing}, ${incoming})`;
  }

  if (column === "confidence" || column === "extraction_version") {
    return `${quotedColumn} = GREATEST(${existing}, ${incoming})`;
  }

  if (column === "created_at") {
    return `${quotedColumn} = ${existing}`;
  }

  return `${quotedColumn} = ${incoming}`;
}

function validateGraphRepositoryBounds({
  maxBatchSize,
  maxEntities,
  maxRelations,
}: {
  readonly maxBatchSize: number;
  readonly maxEntities: number;
  readonly maxRelations: number;
}) {
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Graph repository maxBatchSize must be at least 1");
  }

  if (!Number.isInteger(maxEntities) || maxEntities < 1) {
    throw new Error("Graph repository maxEntities must be at least 1");
  }

  if (!Number.isInteger(maxRelations) || maxRelations < 1) {
    throw new Error("Graph repository maxRelations must be at least 1");
  }
}

function validateGraphEntityBatch(entities: readonly GraphEntity[], maxBatchSize: number) {
  if (entities.length > maxBatchSize) {
    throw new Error(`Graph entity batch size exceeds maxBatchSize=${maxBatchSize}`);
  }

  for (const entity of entities) {
    if (!entity.id.trim() || !entity.knowledgeSpaceId.trim() || !entity.canonicalKey.trim()) {
      throw new Error("Graph entity id, knowledgeSpaceId, and canonicalKey are required");
    }

    if (entity.canonicalKey.length > 512 || entity.name.length > 255 || entity.type.length > 64) {
      throw new Error("Graph entity canonicalKey, name, or type exceeds database key bounds");
    }

    if (
      entity.publicationGenerationId !== undefined &&
      !PublicationGenerationIdSchema.safeParse(entity.publicationGenerationId).success
    ) {
      throw new Error("Graph entity publicationGenerationId must be a non-zero UUID");
    }
  }
}

function validateGraphEntityLogicalBatch(entities: readonly GraphEntity[]): void {
  const byLogicalKey = new Map<string, GraphEntity>();
  const byPhysicalId = new Map<string, GraphEntity>();
  for (const entity of entities) {
    if (!entity.publicationGenerationId) {
      continue;
    }
    const logicalKey = graphEntityStorageKey(entity);
    const existingLogical = byLogicalKey.get(logicalKey);
    const existingId = byPhysicalId.get(graphEntityIdStorageKey(entity));
    if (existingLogical) {
      assertExactGenerationReplay({
        componentType: "graph-entity",
        incoming: entity,
        logicalKey,
        persisted: existingLogical,
      });
    }
    if (existingId) {
      assertExactGenerationReplay({
        componentType: "graph-entity",
        incoming: entity,
        logicalKey,
        persisted: existingId,
      });
    }
    byLogicalKey.set(logicalKey, entity);
    byPhysicalId.set(graphEntityIdStorageKey(entity), entity);
  }
}

function validateGraphRelationBatch(relations: readonly GraphRelation[], maxBatchSize: number) {
  if (relations.length > maxBatchSize) {
    throw new Error(`Graph relation batch size exceeds maxBatchSize=${maxBatchSize}`);
  }

  for (const relation of relations) {
    if (
      !relation.id.trim() ||
      !relation.knowledgeSpaceId.trim() ||
      !relation.subjectEntityId.trim() ||
      !relation.objectEntityId.trim()
    ) {
      throw new Error(
        "Graph relation id, knowledgeSpaceId, subjectEntityId, and objectEntityId are required",
      );
    }

    if (relation.type.length > 64) {
      throw new Error("Graph relation type exceeds database key bounds");
    }

    if (
      relation.publicationGenerationId !== undefined &&
      !PublicationGenerationIdSchema.safeParse(relation.publicationGenerationId).success
    ) {
      throw new Error("Graph relation publicationGenerationId must be a non-zero UUID");
    }
  }
}

function validateGraphRelationLogicalBatch(relations: readonly GraphRelation[]): void {
  const byLogicalKey = new Map<string, GraphRelation>();
  const byPhysicalId = new Map<string, GraphRelation>();
  for (const relation of relations) {
    if (!relation.publicationGenerationId) {
      continue;
    }
    const logicalKey = graphRelationStorageKey(relation);
    const physicalKey = `${relation.knowledgeSpaceId}:${relation.publicationGenerationId}:${relation.id}`;
    const existingLogical = byLogicalKey.get(logicalKey);
    const existingId = byPhysicalId.get(physicalKey);
    if (existingLogical) {
      assertExactGenerationReplay({
        componentType: "graph-relation",
        incoming: relation,
        logicalKey,
        persisted: existingLogical,
      });
    }
    if (existingId) {
      assertExactGenerationReplay({
        componentType: "graph-relation",
        incoming: relation,
        logicalKey,
        persisted: existingId,
      });
    }
    byLogicalKey.set(logicalKey, relation);
    byPhysicalId.set(physicalKey, relation);
  }
}

function validateGraphListEntitiesInput({
  cursor,
  knowledgeSpaceId,
  limit,
  publicationGenerationId,
}: ListGraphEntitiesInput) {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Graph entity list knowledgeSpaceId is required");
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Graph entity list limit must be at least 1");
  }

  if (cursor && (!cursor.id.trim() || !cursor.name.trim())) {
    throw new Error("Graph entity list cursor is invalid");
  }

  validateGraphPublicationGenerationId(publicationGenerationId, "Graph entity list");
}

function compareGraphEntitiesForList(left: GraphEntity, right: GraphEntity): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function compareGraphEntityToCursor(entity: GraphEntity, cursor: GraphEntityCursor): number {
  return entity.name.localeCompare(cursor.name) || entity.id.localeCompare(cursor.id);
}

function validateGraphPruneSourceNodesInput({
  knowledgeSpaceId,
  maxSourceNodes,
  publicationGenerationId,
  sourceNodeIds,
}: PruneGraphSourceNodesInput) {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Graph source pruning knowledgeSpaceId is required");
  }

  if (!Number.isInteger(maxSourceNodes) || maxSourceNodes < 1) {
    throw new Error("Graph source pruning maxSourceNodes must be at least 1");
  }

  if (sourceNodeIds.length < 1) {
    throw new Error("Graph source pruning sourceNodeIds must contain at least 1 node id");
  }

  if (sourceNodeIds.length > maxSourceNodes) {
    throw new Error(`Graph source pruning sourceNodeIds exceeds maxSourceNodes=${maxSourceNodes}`);
  }

  if (sourceNodeIds.some((id) => !id.trim())) {
    throw new Error("Graph source pruning sourceNodeIds must be non-empty strings");
  }

  validateGraphPublicationGenerationId(publicationGenerationId, "Graph source pruning");
}

function validateGraphPruneSourceNodesAcrossGenerationsInput(
  input:
    | DeleteGraphComponentsBySourceNodesAcrossGenerationsInput
    | PruneGraphSourceNodesAcrossGenerationsInput,
): void {
  validateGraphPruneSourceNodesInput(input);
  if (
    !Number.isSafeInteger(input.maxGenerations) ||
    input.maxGenerations < 1 ||
    input.maxGenerations > 10_000
  ) {
    throw new Error("Graph source pruning maxGenerations must be between 1 and 10000");
  }
}

function deleteInMemoryGraphComponentsBySourceNodes({
  entities,
  entitiesById,
  input,
  relations,
}: {
  readonly entities: Map<string, GraphEntity>;
  readonly entitiesById: Map<string, GraphEntity>;
  readonly input: DeleteGraphComponentsBySourceNodesAcrossGenerationsInput;
  readonly relations: Map<string, GraphRelation>;
}): DeleteGraphComponentsBySourceNodesResult {
  const sourceNodeIds = new Set(input.sourceNodeIds);
  const contaminatedEntityIds = new Set<string>();
  const generations = new Set<string>();

  for (const entity of entities.values()) {
    if (
      entity.knowledgeSpaceId === input.knowledgeSpaceId &&
      entity.sourceNodeIds.some((id) => sourceNodeIds.has(id))
    ) {
      contaminatedEntityIds.add(graphEntityIdStorageKey(entity));
      generations.add(entity.publicationGenerationId ?? "legacy");
    }
  }
  for (const relation of relations.values()) {
    if (
      relation.knowledgeSpaceId === input.knowledgeSpaceId &&
      relation.sourceNodeIds.some((id) => sourceNodeIds.has(id))
    ) {
      generations.add(relation.publicationGenerationId ?? "legacy");
    }
  }
  if (generations.size > input.maxGenerations) {
    throw new Error(
      `Graph source pruning generations exceeds maxGenerations=${input.maxGenerations}`,
    );
  }

  let deletedRelations = 0;
  for (const [key, relation] of Array.from(relations.entries())) {
    if (relation.knowledgeSpaceId !== input.knowledgeSpaceId) continue;
    const relationContaminated = relation.sourceNodeIds.some((id) => sourceNodeIds.has(id));
    const endpointContaminated =
      contaminatedEntityIds.has(
        graphEntityIdStorageKey({
          id: relation.subjectEntityId,
          knowledgeSpaceId: relation.knowledgeSpaceId,
          publicationGenerationId: relation.publicationGenerationId,
        }),
      ) ||
      contaminatedEntityIds.has(
        graphEntityIdStorageKey({
          id: relation.objectEntityId,
          knowledgeSpaceId: relation.knowledgeSpaceId,
          publicationGenerationId: relation.publicationGenerationId,
        }),
      );
    if (!relationContaminated && !endpointContaminated) continue;
    relations.delete(key);
    deletedRelations += 1;
  }

  let deletedEntities = 0;
  for (const [key, entity] of Array.from(entities.entries())) {
    if (!contaminatedEntityIds.has(graphEntityIdStorageKey(entity))) continue;
    entities.delete(key);
    entitiesById.delete(graphEntityIdStorageKey(entity));
    deletedEntities += 1;
  }

  return { deletedEntities, deletedRelations };
}

function pruneInMemoryGraphSourceNodes({
  acrossGenerations = false,
  entities,
  entitiesById,
  input,
  now,
  publicationGenerationId,
  relations,
}: {
  readonly acrossGenerations?: boolean;
  readonly entities: Map<string, GraphEntity>;
  readonly entitiesById: Map<string, GraphEntity>;
  readonly input: Pick<PruneGraphSourceNodesInput, "knowledgeSpaceId" | "sourceNodeIds">;
  readonly now: () => string;
  readonly publicationGenerationId?: string | undefined;
  readonly relations: Map<string, GraphRelation>;
}): PruneGraphSourceNodesResult {
  const sourceNodeIds = new Set(input.sourceNodeIds);
  let updatedRelations = 0;
  let prunedRelations = 0;
  let updatedEntities = 0;
  let prunedEntities = 0;

  for (const [key, relation] of Array.from(relations.entries())) {
    if (
      relation.knowledgeSpaceId !== input.knowledgeSpaceId ||
      (!acrossGenerations && !graphRecordMatchesGeneration(relation, publicationGenerationId))
    ) {
      continue;
    }
    const nextSourceNodeIds = relation.sourceNodeIds.filter((id) => !sourceNodeIds.has(id));
    if (nextSourceNodeIds.length === relation.sourceNodeIds.length) continue;
    if (nextSourceNodeIds.length === 0) {
      relations.delete(key);
      prunedRelations += 1;
      continue;
    }
    relations.set(
      key,
      cloneGraphRelation({ ...relation, sourceNodeIds: nextSourceNodeIds, updatedAt: now() }),
    );
    updatedRelations += 1;
  }

  for (const [key, entity] of Array.from(entities.entries())) {
    if (
      entity.knowledgeSpaceId !== input.knowledgeSpaceId ||
      (!acrossGenerations && !graphRecordMatchesGeneration(entity, publicationGenerationId))
    ) {
      continue;
    }
    const nextSourceNodeIds = entity.sourceNodeIds.filter((id) => !sourceNodeIds.has(id));
    if (nextSourceNodeIds.length === entity.sourceNodeIds.length) continue;
    if (nextSourceNodeIds.length === 0 && !graphEntityHasRelations(entity, relations)) {
      entities.delete(key);
      entitiesById.delete(graphEntityIdStorageKey(entity));
      prunedEntities += 1;
      continue;
    }
    const next = cloneGraphEntity({
      ...entity,
      sourceNodeIds: nextSourceNodeIds,
      updatedAt: now(),
    });
    entities.set(key, next);
    entitiesById.set(graphEntityIdStorageKey(next), next);
    updatedEntities += 1;
  }

  return { prunedEntities, prunedRelations, updatedEntities, updatedRelations };
}

function graphEntityHasRelations(
  entity: GraphEntity,
  relations: ReadonlyMap<string, GraphRelation>,
): boolean {
  for (const relation of relations.values()) {
    if (
      relation.knowledgeSpaceId === entity.knowledgeSpaceId &&
      graphRecordMatchesGeneration(relation, entity.publicationGenerationId) &&
      (relation.subjectEntityId === entity.id || relation.objectEntityId === entity.id)
    ) {
      return true;
    }
  }

  return false;
}

export function validateGraphTraversalInput({
  fanout,
  knowledgeSpaceId,
  maxDepth,
  maxNodes,
  permissionScope,
  publicationGenerationId,
  startEntityId,
  timeoutMs,
}: TraverseGraphInput) {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Graph traversal knowledgeSpaceId is required");
  }

  if (!startEntityId.trim()) {
    throw new Error("Graph traversal startEntityId is required");
  }

  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 2) {
    throw new Error("Graph traversal maxDepth must be between 1 and 2");
  }

  if (!Number.isInteger(fanout) || fanout < 1) {
    throw new Error("Graph traversal fanout must be at least 1");
  }

  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new Error("Graph traversal maxNodes must be at least 1");
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Graph traversal timeoutMs must be at least 1");
  }

  if (permissionScope?.some((scope) => !scope.trim())) {
    throw new Error("Graph traversal permissionScope must contain non-empty strings");
  }

  validateGraphPublicationGenerationId(publicationGenerationId, "Graph traversal");
}

function traverseInMemoryGraph({
  entitiesById,
  input,
  nowMs,
  relations,
}: {
  readonly entitiesById: ReadonlyMap<string, GraphEntity>;
  readonly input: TraverseGraphInput;
  readonly nowMs: () => number;
  readonly relations: ReadonlyMap<string, GraphRelation>;
}): GraphTraversalResult {
  validateGraphTraversalInput(input);
  const startedAt = nowMs();
  const deadline = startedAt + input.timeoutMs;
  const allowedPermissionScope = new Set(input.permissionScope ?? []);
  const root = entitiesById.get(
    graphEntityIdStorageKey({
      id: input.startEntityId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      publicationGenerationId: input.publicationGenerationId,
    }),
  );

  if (
    !root ||
    root.knowledgeSpaceId !== input.knowledgeSpaceId ||
    !canReadGraphPermissionScope(root.permissionScope, allowedPermissionScope)
  ) {
    return emptyGraphTraversalResult({
      elapsedMs: nowMs() - startedAt,
      fanout: input.fanout,
      maxDepth: input.maxDepth,
      maxNodes: input.maxNodes,
    });
  }

  const traversalEntities = new Map<string, GraphTraversalEntity>([
    [root.id, { ...cloneGraphEntity(root), depth: 0 }],
  ]);
  const traversalRelations = new Map<string, GraphTraversalRelation>();
  let frontier = [root.id];
  let depthReached = 0;
  let exploredRelations = 0;
  let timedOut = false;
  let truncated = false;

  for (let depth = 1; depth <= input.maxDepth; depth += 1) {
    if (nowMs() > deadline) {
      timedOut = true;
      truncated = true;
      break;
    }

    const nextFrontier: string[] = [];

    for (const entityId of frontier) {
      const outgoing = Array.from(relations.values())
        .filter((relation) => relation.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter((relation) => graphRecordMatchesGeneration(relation, input.publicationGenerationId))
        .filter((relation) => relation.subjectEntityId === entityId)
        .filter((relation) =>
          canReadGraphPermissionScope(relation.permissionScope, allowedPermissionScope),
        )
        .filter((relation) => {
          const target = entitiesById.get(
            graphEntityIdStorageKey({
              id: relation.objectEntityId,
              knowledgeSpaceId: input.knowledgeSpaceId,
              publicationGenerationId: input.publicationGenerationId,
            }),
          );

          return (
            target?.knowledgeSpaceId === input.knowledgeSpaceId &&
            canReadGraphPermissionScope(target.permissionScope, allowedPermissionScope)
          );
        })
        .sort(compareGraphRelationsForTraversal)
        .slice(0, input.fanout);

      for (const relation of outgoing) {
        const target = entitiesById.get(
          graphEntityIdStorageKey({
            id: relation.objectEntityId,
            knowledgeSpaceId: input.knowledgeSpaceId,
            publicationGenerationId: input.publicationGenerationId,
          }),
        );

        if (!target || target.knowledgeSpaceId !== input.knowledgeSpaceId) {
          continue;
        }

        if (!traversalEntities.has(target.id)) {
          if (traversalEntities.size >= input.maxNodes) {
            truncated = true;
            continue;
          }

          traversalEntities.set(target.id, { ...cloneGraphEntity(target), depth });
          nextFrontier.push(target.id);
        }

        exploredRelations += 1;
        traversalRelations.set(relation.id, { ...cloneGraphRelation(relation), depth });
      }
    }

    if (nextFrontier.length === 0) {
      break;
    }

    depthReached = depth;
    frontier = nextFrontier;
  }

  return {
    entities: Array.from(traversalEntities.values()).sort(compareGraphTraversalEntities),
    metrics: {
      depthReached,
      elapsedMs: nowMs() - startedAt,
      exploredRelations,
      fanout: input.fanout,
      maxDepth: input.maxDepth,
      maxNodes: input.maxNodes,
      timedOut,
    },
    relations: Array.from(traversalRelations.values()).sort(compareGraphTraversalRelations),
    truncated,
  };
}

function canReadGraphPermissionScope(
  requiredPermissionScope: readonly string[],
  allowedPermissionScope: ReadonlySet<string>,
): boolean {
  return (
    requiredPermissionScope.length === 0 ||
    requiredPermissionScope.every((scope) => allowedPermissionScope.has(scope))
  );
}

function emptyGraphTraversalResult({
  elapsedMs,
  fanout,
  maxDepth,
  maxNodes,
}: {
  readonly elapsedMs: number;
  readonly fanout: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}): GraphTraversalResult {
  return {
    entities: [],
    metrics: {
      depthReached: 0,
      elapsedMs,
      exploredRelations: 0,
      fanout,
      maxDepth,
      maxNodes,
      timedOut: false,
    },
    relations: [],
    truncated: false,
  };
}

function validateGraphPublicationGenerationId(
  publicationGenerationId: string | undefined,
  inputName: string,
) {
  normalizeGraphPublicationGenerationId(publicationGenerationId, inputName);
}

function normalizeGraphPublicationGenerationId(
  publicationGenerationId: string | undefined,
  inputName: string,
): string | undefined {
  if (publicationGenerationId === undefined) {
    return undefined;
  }

  const parsed = PublicationGenerationIdSchema.safeParse(publicationGenerationId);
  if (!parsed.success) {
    throw new Error(`${inputName} publicationGenerationId must be a non-zero UUID`);
  }

  return parsed.data;
}

function graphRecordMatchesGeneration(
  record: { readonly publicationGenerationId?: string | undefined },
  publicationGenerationId: string | undefined,
): boolean {
  return record.publicationGenerationId === publicationGenerationId;
}

function graphEntityIdStorageKey(entity: {
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId?: string | undefined;
}): string {
  return `${entity.knowledgeSpaceId}:${entity.publicationGenerationId ?? "legacy"}:${entity.id}`;
}

function graphEntityStorageKey(entity: GraphEntity): string {
  return `${entity.knowledgeSpaceId}:${entity.publicationGenerationId ?? "legacy"}:${entity.canonicalKey}`;
}

function graphRelationStorageKey(relation: GraphRelation): string {
  return [
    relation.knowledgeSpaceId,
    relation.publicationGenerationId ?? "legacy",
    relation.subjectEntityId,
    relation.type,
    relation.objectEntityId,
    relation.extractionVersion,
  ].join(":");
}

export function cloneGraphEntity(entity: GraphEntity): GraphEntity {
  return {
    aliases: [...entity.aliases],
    canonicalKey: entity.canonicalKey,
    confidence: entity.confidence,
    createdAt: entity.createdAt,
    extractionVersion: entity.extractionVersion,
    id: entity.id,
    knowledgeSpaceId: entity.knowledgeSpaceId,
    metadata: cloneJsonObject(entity.metadata),
    name: entity.name,
    permissionScope: [...entity.permissionScope],
    ...(entity.publicationGenerationId
      ? { publicationGenerationId: entity.publicationGenerationId }
      : {}),
    sourceNodeIds: [...entity.sourceNodeIds],
    type: entity.type,
    updatedAt: entity.updatedAt,
  };
}

export function cloneGraphRelation(relation: GraphRelation): GraphRelation {
  return {
    confidence: relation.confidence,
    createdAt: relation.createdAt,
    extractionVersion: relation.extractionVersion,
    id: relation.id,
    knowledgeSpaceId: relation.knowledgeSpaceId,
    metadata: cloneJsonObject(relation.metadata),
    objectEntityId: relation.objectEntityId,
    permissionScope: [...relation.permissionScope],
    ...(relation.publicationGenerationId
      ? { publicationGenerationId: relation.publicationGenerationId }
      : {}),
    sourceNodeIds: [...relation.sourceNodeIds],
    subjectEntityId: relation.subjectEntityId,
    type: relation.type,
    updatedAt: relation.updatedAt,
  };
}

function mapGraphEntityRow(row: DatabaseRow): GraphEntity {
  return cloneGraphEntity({
    aliases: jsonStringArrayColumn(row, "aliases"),
    canonicalKey: stringColumn(row, "canonical_key"),
    confidence: numberColumn(row, "confidence"),
    createdAt: stringColumn(row, "created_at"),
    extractionVersion: numberColumn(row, "extraction_version"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    name: stringColumn(row, "name"),
    permissionScope: jsonStringArrayColumn(row, "permission_scope"),
    publicationGenerationId: publicationGenerationIdColumn(row, "publication_generation_id"),
    sourceNodeIds: jsonStringArrayColumn(row, "source_node_ids"),
    type: stringColumn(row, "type") as EntityExtractionType,
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function mapGraphRelationRow(row: DatabaseRow): GraphRelation {
  return cloneGraphRelation({
    confidence: numberColumn(row, "confidence"),
    createdAt: stringColumn(row, "created_at"),
    extractionVersion: numberColumn(row, "extraction_version"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    objectEntityId: stringColumn(row, "object_entity_id"),
    permissionScope: jsonStringArrayColumn(row, "permission_scope"),
    publicationGenerationId: publicationGenerationIdColumn(row, "publication_generation_id"),
    sourceNodeIds: jsonStringArrayColumn(row, "source_node_ids"),
    subjectEntityId: stringColumn(row, "subject_entity_id"),
    type: stringColumn(row, "type") as RelationExtractionType,
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function publicationGenerationIdColumn(row: DatabaseRow, column: string): string | undefined {
  const value = optionalStringColumn(row, column);
  return value === undefined ? undefined : PublicationGenerationIdSchema.parse(value);
}

function databaseValuesSql(
  database: DatabaseAdapter,
  columns: readonly string[],
  rowCount: number,
): string {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const offset = rowIndex * columns.length;

    return `(${columns
      .map((column, columnIndex) =>
        jsonInsertPlaceholder(database, offset + columnIndex + 1, column),
      )
      .join(", ")})`;
  }).join(", ");
}

function graphTraversalParams(
  database: DatabaseAdapter,
  input: TraverseGraphInput,
  permissionScope: string,
): DatabaseQueryValue[] {
  const generation = input.publicationGenerationId;

  if (database.dialect === "postgres") {
    return [
      input.knowledgeSpaceId,
      input.startEntityId,
      input.maxDepth,
      input.fanout,
      input.maxNodes,
      permissionScope,
      ...(generation !== undefined ? [generation] : []),
    ];
  }

  return generation === undefined
    ? [
        input.knowledgeSpaceId,
        permissionScope,
        permissionScope,
        input.knowledgeSpaceId,
        input.startEntityId,
        permissionScope,
        input.fanout,
        input.knowledgeSpaceId,
        input.maxDepth,
        input.maxNodes,
      ]
    : [
        input.knowledgeSpaceId,
        generation,
        generation,
        permissionScope,
        permissionScope,
        input.knowledgeSpaceId,
        input.startEntityId,
        generation,
        permissionScope,
        input.fanout,
        input.knowledgeSpaceId,
        generation,
        input.maxDepth,
        input.maxNodes,
      ];
}

function graphSourceNodeGenerationInventorySql(database: DatabaseAdapter, limit: number): string {
  const p = (position: number) => databasePlaceholder(database, position);
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const generation = q("publication_generation_id");
  const sourceNodeIds = q("source_node_ids");
  const knowledgeSpaceId = q("knowledge_space_id");

  if (database.dialect === "postgres") {
    const overlap = (alias: string) =>
      `${alias}.${sourceNodeIds} ?| ARRAY(SELECT value FROM jsonb_array_elements_text(${p(
        2,
      )}::jsonb) AS input_nodes(value))`;
    return `SELECT generation_scope.${generation} FROM (SELECT entity_row.${generation} FROM ${q(
      "graph_entities",
    )} entity_row WHERE entity_row.${knowledgeSpaceId} = ${p(1)} AND ${overlap(
      "entity_row",
    )} UNION SELECT relation_row.${generation} FROM ${q(
      "graph_relations",
    )} relation_row WHERE relation_row.${knowledgeSpaceId} = ${p(1)} AND ${overlap(
      "relation_row",
    )}) generation_scope ORDER BY generation_scope.${generation} ASC NULLS FIRST LIMIT ${limit};`;
  }

  return `SELECT generation_scope.${generation} FROM (SELECT entity_row.${generation} FROM ${q(
    "graph_entities",
  )} entity_row WHERE entity_row.${knowledgeSpaceId} = ${p(1)} AND JSON_OVERLAPS(entity_row.${sourceNodeIds}, CAST(${p(
    2,
  )} AS JSON)) UNION SELECT relation_row.${generation} FROM ${q(
    "graph_relations",
  )} relation_row WHERE relation_row.${knowledgeSpaceId} = ${p(
    3,
  )} AND JSON_OVERLAPS(relation_row.${sourceNodeIds}, CAST(${p(
    4,
  )} AS JSON))) generation_scope ORDER BY generation_scope.${generation} ASC LIMIT ${limit};`;
}

function graphDeleteContaminatedRelationsSql(
  database: DatabaseAdapter,
  hasPublicationGeneration: boolean,
): string {
  const p = (position: number) => databasePlaceholder(database, position);
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const relation = "contaminated_relation";
  const entity = "contaminated_endpoint";
  const overlap = (alias: string) =>
    database.dialect === "postgres"
      ? `${alias}.${q("source_node_ids")} ?| ARRAY(SELECT value FROM jsonb_array_elements_text(${p(
          2,
        )}::jsonb) AS input_nodes(value))`
      : `JSON_OVERLAPS(${alias}.${q("source_node_ids")}, CAST(${p(2)} AS JSON))`;
  const generation = graphGenerationScopeSql(
    database,
    `${relation}.${q("publication_generation_id")}`,
    3,
    hasPublicationGeneration,
  );
  const endpointGeneration = graphSameGenerationSql(
    database,
    `${entity}.${q("publication_generation_id")}`,
    `${relation}.${q("publication_generation_id")}`,
  );
  const target = `${relation}.${q("knowledge_space_id")} = ${p(
    1,
  )} AND ${generation} AND (${overlap(relation)} OR EXISTS (SELECT 1 FROM ${q(
    "graph_entities",
  )} AS ${entity} WHERE ${entity}.${q("knowledge_space_id")} = ${relation}.${q(
    "knowledge_space_id",
  )} AND ${endpointGeneration} AND (${entity}.${q("id")} = ${relation}.${q(
    "subject_entity_id",
  )} OR ${entity}.${q("id")} = ${relation}.${q("object_entity_id")}) AND ${overlap(entity)}))`;
  return database.dialect === "postgres"
    ? `DELETE FROM ${q("graph_relations")} AS ${relation} WHERE ${target};`
    : `DELETE ${relation} FROM ${q("graph_relations")} AS ${relation} WHERE ${target};`;
}

function graphDeleteContaminatedEntitiesSql(
  database: DatabaseAdapter,
  hasPublicationGeneration: boolean,
): string {
  const p = (position: number) => databasePlaceholder(database, position);
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const entity = "contaminated_entity";
  const overlap =
    database.dialect === "postgres"
      ? `${entity}.${q("source_node_ids")} ?| ARRAY(SELECT value FROM jsonb_array_elements_text(${p(
          2,
        )}::jsonb) AS input_nodes(value))`
      : `JSON_OVERLAPS(${entity}.${q("source_node_ids")}, CAST(${p(2)} AS JSON))`;
  const target = `${entity}.${q("knowledge_space_id")} = ${p(1)} AND ${graphGenerationScopeSql(
    database,
    `${entity}.${q("publication_generation_id")}`,
    3,
    hasPublicationGeneration,
  )} AND ${overlap}`;
  return database.dialect === "postgres"
    ? `DELETE FROM ${q("graph_entities")} AS ${entity} WHERE ${target};`
    : `DELETE ${entity} FROM ${q("graph_entities")} AS ${entity} WHERE ${target};`;
}

function graphPruneSourceNodesSql(
  database: DatabaseAdapter,
  hasPublicationGeneration: boolean,
): string {
  const p = (position: number) => databasePlaceholder(database, position);
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);

  if (database.dialect === "postgres") {
    return `WITH input_nodes AS (SELECT value AS node_id FROM jsonb_array_elements_text(${p(
      2,
    )}::jsonb) AS source_nodes(value)), relation_updates AS (UPDATE ${q(
      "graph_relations",
    )} relation_row SET ${q("source_node_ids")} = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(relation_row.${q(
      "source_node_ids",
    )}) AS remaining(value) WHERE value NOT IN (SELECT node_id FROM input_nodes)), '[]'::jsonb) WHERE relation_row.${q(
      "knowledge_space_id",
    )} = ${p(1)} AND ${graphGenerationScopeSql(
      database,
      `relation_row.${q("publication_generation_id")}`,
      3,
      hasPublicationGeneration,
    )} AND relation_row.${q(
      "source_node_ids",
    )} ?| ARRAY(SELECT node_id FROM input_nodes) RETURNING relation_row.${q(
      "id",
    )}, relation_row.${q("source_node_ids")}), deleted_relations AS (DELETE FROM ${q(
      "graph_relations",
    )} relation_row WHERE relation_row.${q("knowledge_space_id")} = ${p(
      1,
    )} AND ${graphGenerationScopeSql(
      database,
      `relation_row.${q("publication_generation_id")}`,
      3,
      hasPublicationGeneration,
    )} AND relation_row.${q("source_node_ids")} = '[]'::jsonb RETURNING relation_row.${q(
      "id",
    )}), entity_updates AS (UPDATE ${q("graph_entities")} entity_row SET ${q(
      "source_node_ids",
    )} = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(entity_row.${q(
      "source_node_ids",
    )}) AS remaining(value) WHERE value NOT IN (SELECT node_id FROM input_nodes)), '[]'::jsonb) WHERE entity_row.${q(
      "knowledge_space_id",
    )} = ${p(1)} AND ${graphGenerationScopeSql(
      database,
      `entity_row.${q("publication_generation_id")}`,
      3,
      hasPublicationGeneration,
    )} AND entity_row.${q(
      "source_node_ids",
    )} ?| ARRAY(SELECT node_id FROM input_nodes) RETURNING entity_row.${q(
      "id",
    )}, entity_row.${q("source_node_ids")}), deleted_entities AS (DELETE FROM ${q(
      "graph_entities",
    )} entity_row WHERE entity_row.${q("knowledge_space_id")} = ${p(
      1,
    )} AND ${graphGenerationScopeSql(
      database,
      `entity_row.${q("publication_generation_id")}`,
      3,
      hasPublicationGeneration,
    )} AND entity_row.${q("source_node_ids")} = '[]'::jsonb AND NOT EXISTS (SELECT 1 FROM ${q(
      "graph_relations",
    )} relation_row WHERE relation_row.${q(
      "knowledge_space_id",
    )} = entity_row.${q("knowledge_space_id")} AND ${graphSameGenerationSql(
      database,
      `relation_row.${q("publication_generation_id")}`,
      `entity_row.${q("publication_generation_id")}`,
    )} AND (relation_row.${q("subject_entity_id")} = entity_row.${q("id")} OR relation_row.${q(
      "object_entity_id",
    )} = entity_row.${q("id")})) RETURNING entity_row.${q(
      "id",
    )}) SELECT (SELECT COUNT(*) FROM deleted_entities) AS ${q(
      "pruned_entities",
    )}, (SELECT COUNT(*) FROM deleted_relations) AS ${q(
      "pruned_relations",
    )}, (SELECT COUNT(*) FROM entity_updates) - (SELECT COUNT(*) FROM deleted_entities) AS ${q(
      "updated_entities",
    )}, (SELECT COUNT(*) FROM relation_updates) - (SELECT COUNT(*) FROM deleted_relations) AS ${q(
      "updated_relations",
    )};`;
  }

  return `WITH prune_input AS (SELECT ${p(1)} AS knowledge_space_id, CAST(${p(
    2,
  )} AS JSON) AS source_node_ids, ${
    hasPublicationGeneration ? p(3) : "NULL"
  } AS publication_generation_id), input_nodes AS (SELECT node_id FROM JSON_TABLE((SELECT source_node_ids FROM prune_input), '$[*]' COLUMNS (node_id VARCHAR(255) PATH '$')) source_nodes), relation_updates AS (UPDATE ${q(
    "graph_relations",
  )} relation_row SET ${q("source_node_ids")} = COALESCE((SELECT JSON_ARRAYAGG(value) FROM JSON_TABLE(relation_row.${q(
    "source_node_ids",
  )}, '$[*]' COLUMNS (value VARCHAR(255) PATH '$')) remaining WHERE value NOT IN (SELECT node_id FROM input_nodes)), JSON_ARRAY()) WHERE relation_row.${q(
    "knowledge_space_id",
  )} = (SELECT knowledge_space_id FROM prune_input) AND relation_row.${q(
    "publication_generation_id",
  )} <=> (SELECT publication_generation_id FROM prune_input) AND JSON_OVERLAPS(relation_row.${q(
    "source_node_ids",
  )}, (SELECT source_node_ids FROM prune_input))), deleted_relations AS (DELETE FROM ${q(
    "graph_relations",
  )} WHERE ${q("knowledge_space_id")} = (SELECT knowledge_space_id FROM prune_input) AND ${q(
    "publication_generation_id",
  )} <=> (SELECT publication_generation_id FROM prune_input) AND JSON_LENGTH(${q(
    "source_node_ids",
  )}) = 0), entity_updates AS (UPDATE ${q(
    "graph_entities",
  )} entity_row SET ${q("source_node_ids")} = COALESCE((SELECT JSON_ARRAYAGG(value) FROM JSON_TABLE(entity_row.${q(
    "source_node_ids",
  )}, '$[*]' COLUMNS (value VARCHAR(255) PATH '$')) remaining WHERE value NOT IN (SELECT node_id FROM input_nodes)), JSON_ARRAY()) WHERE entity_row.${q(
    "knowledge_space_id",
  )} = (SELECT knowledge_space_id FROM prune_input) AND entity_row.${q(
    "publication_generation_id",
  )} <=> (SELECT publication_generation_id FROM prune_input) AND JSON_OVERLAPS(entity_row.${q(
    "source_node_ids",
  )}, (SELECT source_node_ids FROM prune_input))), deleted_entities AS (DELETE FROM ${q(
    "graph_entities",
  )} WHERE ${q("knowledge_space_id")} = (SELECT knowledge_space_id FROM prune_input) AND ${q(
    "publication_generation_id",
  )} <=> (SELECT publication_generation_id FROM prune_input) AND JSON_LENGTH(${q(
    "source_node_ids",
  )}) = 0 AND NOT EXISTS (SELECT 1 FROM ${q("graph_relations")} relation_row WHERE relation_row.${q(
    "knowledge_space_id",
  )} = ${q("graph_entities")}.${q("knowledge_space_id")} AND relation_row.${q(
    "publication_generation_id",
  )} <=> ${q("graph_entities")}.${q("publication_generation_id")} AND (relation_row.${q(
    "subject_entity_id",
  )} = ${q("graph_entities")}.${q("id")} OR relation_row.${q(
    "object_entity_id",
  )} = ${q("graph_entities")}.${q("id")}))) SELECT 0 AS ${q("pruned_entities")}, 0 AS ${q(
    "pruned_relations",
  )}, 0 AS ${q("updated_entities")}, 0 AS ${q("updated_relations")};`;
}

function graphTraversalSql(database: DatabaseAdapter, hasPublicationGeneration: boolean): string {
  const p = (position: number) => databasePlaceholder(database, position);
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const relationFanout = "relation_fanout";
  const graphWalk = "graph_walk";
  const childEntity = "child_entity";
  const candidateEntity = "candidate_entity";
  const relationRow = "relation_row";
  const rootEntity = "root_entity";

  return `WITH RECURSIVE ${relationFanout} AS (SELECT ${relationRow}.${q(
    "id",
  )}, ${relationRow}.${q("knowledge_space_id")}, ${relationRow}.${q(
    "publication_generation_id",
  )}, ${relationRow}.${q(
    "subject_entity_id",
  )}, ${relationRow}.${q("object_entity_id")}, ${relationRow}.${q(
    "type",
  )}, ${relationRow}.${q("confidence")}, ${relationRow}.${q(
    "source_node_ids",
  )}, ${relationRow}.${q("permission_scope")}, ${relationRow}.${q(
    "metadata",
  )}, ${relationRow}.${q("extraction_version")}, ${relationRow}.${q(
    "created_at",
  )}, ${relationRow}.${q("updated_at")}, ROW_NUMBER() OVER (PARTITION BY ${relationRow}.${q(
    "subject_entity_id",
  )} ORDER BY ${relationRow}.${q("type")} ASC, ${relationRow}.${q(
    "object_entity_id",
  )} ASC, ${relationRow}.${q("id")} ASC) AS ${q("fanout_rank")} FROM ${q(
    "graph_relations",
  )} ${relationRow} JOIN ${q("graph_entities")} ${candidateEntity} ON ${candidateEntity}.${q(
    "knowledge_space_id",
  )} = ${relationRow}.${q("knowledge_space_id")} AND ${candidateEntity}.${q(
    "id",
  )} = ${relationRow}.${q("object_entity_id")} WHERE ${relationRow}.${q(
    "knowledge_space_id",
  )} = ${p(1)} AND ${graphGenerationScopeSql(
    database,
    `${relationRow}.${q("publication_generation_id")}`,
    7,
    hasPublicationGeneration,
  )} AND ${graphGenerationScopeSql(
    database,
    `${candidateEntity}.${q("publication_generation_id")}`,
    7,
    hasPublicationGeneration,
  )} AND ${graphPermissionScopeSql(
    database,
    `${relationRow}.${q("permission_scope")}`,
    6,
  )} AND ${graphPermissionScopeSql(
    database,
    `${candidateEntity}.${q("permission_scope")}`,
    6,
  )}), ${graphWalk} AS (SELECT ${rootEntity}.${q(
    "knowledge_space_id",
  )} AS ${q("knowledge_space_id")}, ${rootEntity}.${q(
    "publication_generation_id",
  )} AS ${q("entity_publication_generation_id")}, ${rootEntity}.${q("id")} AS ${q(
    "entity_id",
  )}, ${rootEntity}.${q("canonical_key")} AS ${q(
    "entity_canonical_key",
  )}, ${rootEntity}.${q("type")} AS ${q("entity_type")}, ${rootEntity}.${q(
    "name",
  )} AS ${q("entity_name")}, ${rootEntity}.${q("aliases")} AS ${q(
    "entity_aliases",
  )}, ${rootEntity}.${q("confidence")} AS ${q("entity_confidence")}, ${rootEntity}.${q(
    "source_node_ids",
  )} AS ${q("entity_source_node_ids")}, ${rootEntity}.${q("permission_scope")} AS ${q(
    "entity_permission_scope",
  )}, ${rootEntity}.${q("metadata")} AS ${q("entity_metadata")}, ${rootEntity}.${q(
    "extraction_version",
  )} AS ${q("entity_extraction_version")}, ${rootEntity}.${q("created_at")} AS ${q(
    "entity_created_at",
  )}, ${rootEntity}.${q("updated_at")} AS ${q("entity_updated_at")}, NULL AS ${q(
    "relation_id",
  )}, NULL AS ${q("relation_subject_entity_id")}, NULL AS ${q(
    "relation_object_entity_id",
  )}, NULL AS ${q("relation_type")}, NULL AS ${q("relation_confidence")}, NULL AS ${q(
    "relation_source_node_ids",
  )}, NULL AS ${q("relation_permission_scope")}, NULL AS ${q(
    "relation_metadata",
  )}, NULL AS ${q("relation_extraction_version")}, NULL AS ${q(
    "relation_created_at",
  )}, NULL AS ${q("relation_updated_at")}, NULL AS ${q(
    "relation_publication_generation_id",
  )}, 0 AS ${q("depth")} FROM ${q(
    "graph_entities",
  )} ${rootEntity} WHERE ${rootEntity}.${q("knowledge_space_id")} = ${p(1)} AND ${rootEntity}.${q(
    "id",
  )} = ${p(2)} AND ${graphGenerationScopeSql(
    database,
    `${rootEntity}.${q("publication_generation_id")}`,
    7,
    hasPublicationGeneration,
  )} AND ${graphPermissionScopeSql(
    database,
    `${rootEntity}.${q("permission_scope")}`,
    6,
  )} UNION ALL SELECT ${childEntity}.${q(
    "knowledge_space_id",
  )} AS ${q("knowledge_space_id")}, ${childEntity}.${q(
    "publication_generation_id",
  )} AS ${q("entity_publication_generation_id")}, ${childEntity}.${q("id")} AS ${q(
    "entity_id",
  )}, ${childEntity}.${q("canonical_key")} AS ${q("entity_canonical_key")}, ${childEntity}.${q(
    "type",
  )} AS ${q("entity_type")}, ${childEntity}.${q("name")} AS ${q(
    "entity_name",
  )}, ${childEntity}.${q("aliases")} AS ${q("entity_aliases")}, ${childEntity}.${q(
    "confidence",
  )} AS ${q("entity_confidence")}, ${childEntity}.${q("source_node_ids")} AS ${q(
    "entity_source_node_ids",
  )}, ${childEntity}.${q("permission_scope")} AS ${q(
    "entity_permission_scope",
  )}, ${childEntity}.${q("metadata")} AS ${q("entity_metadata")}, ${childEntity}.${q(
    "extraction_version",
  )} AS ${q("entity_extraction_version")}, ${childEntity}.${q("created_at")} AS ${q(
    "entity_created_at",
  )}, ${childEntity}.${q("updated_at")} AS ${q("entity_updated_at")}, ${relationFanout}.${q(
    "id",
  )} AS ${q("relation_id")}, ${relationFanout}.${q("subject_entity_id")} AS ${q(
    "relation_subject_entity_id",
  )}, ${relationFanout}.${q("object_entity_id")} AS ${q(
    "relation_object_entity_id",
  )}, ${relationFanout}.${q("type")} AS ${q("relation_type")}, ${relationFanout}.${q(
    "confidence",
  )} AS ${q("relation_confidence")}, ${relationFanout}.${q("source_node_ids")} AS ${q(
    "relation_source_node_ids",
  )}, ${relationFanout}.${q("permission_scope")} AS ${q(
    "relation_permission_scope",
  )}, ${relationFanout}.${q("metadata")} AS ${q("relation_metadata")}, ${relationFanout}.${q(
    "extraction_version",
  )} AS ${q("relation_extraction_version")}, ${relationFanout}.${q("created_at")} AS ${q(
    "relation_created_at",
  )}, ${relationFanout}.${q("updated_at")} AS ${q(
    "relation_updated_at",
  )}, ${relationFanout}.${q("publication_generation_id")} AS ${q(
    "relation_publication_generation_id",
  )}, ${graphWalk}.${q(
    "depth",
  )} + 1 AS ${q("depth")} FROM ${graphWalk} JOIN ${relationFanout} ON ${relationFanout}.${q(
    "subject_entity_id",
  )} = ${graphWalk}.${q("entity_id")} AND ${relationFanout}.${q("fanout_rank")} <= ${p(
    4,
  )} JOIN ${q("graph_entities")} ${childEntity} ON ${childEntity}.${q(
    "knowledge_space_id",
  )} = ${p(1)} AND ${childEntity}.${q("id")} = ${relationFanout}.${q(
    "object_entity_id",
  )} AND ${graphGenerationScopeSql(
    database,
    `${childEntity}.${q("publication_generation_id")}`,
    7,
    hasPublicationGeneration,
  )} WHERE ${graphWalk}.${q("depth")} < ${p(3)}) SELECT * FROM ${graphWalk} LIMIT ${p(5)};`;
}

function graphPermissionScopeSql(
  database: DatabaseAdapter,
  qualifiedColumn: string,
  parameterPosition: number,
): string {
  const permissionScope = databasePlaceholder(database, parameterPosition);

  return database.dialect === "postgres"
    ? `(jsonb_array_length(${qualifiedColumn}) = 0 OR ${qualifiedColumn} <@ ${permissionScope}::jsonb)`
    : `(JSON_LENGTH(${qualifiedColumn}) = 0 OR JSON_CONTAINS(CAST(${permissionScope} AS JSON), ${qualifiedColumn}))`;
}

function graphGenerationScopeSql(
  database: DatabaseAdapter,
  qualifiedColumn: string,
  parameterPosition: number,
  hasPublicationGeneration: boolean,
): string {
  if (!hasPublicationGeneration) {
    return `${qualifiedColumn} IS NULL`;
  }

  const publicationGenerationId = databasePlaceholder(database, parameterPosition);

  return database.dialect === "postgres"
    ? `${qualifiedColumn} IS NOT DISTINCT FROM ${publicationGenerationId}::uuid`
    : `${qualifiedColumn} <=> ${publicationGenerationId}`;
}

function graphSameGenerationSql(
  database: DatabaseAdapter,
  leftQualifiedColumn: string,
  rightQualifiedColumn: string,
): string {
  return database.dialect === "postgres"
    ? `${leftQualifiedColumn} IS NOT DISTINCT FROM ${rightQualifiedColumn}`
    : `${leftQualifiedColumn} <=> ${rightQualifiedColumn}`;
}

function mapGraphTraversalRows({
  elapsedMs,
  fanout,
  maxDepth,
  maxNodes,
  rows,
}: {
  readonly elapsedMs: number;
  readonly fanout: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly rows: readonly DatabaseRow[];
}): GraphTraversalResult {
  const entities = new Map<string, GraphTraversalEntity>();
  const relations = new Map<string, GraphTraversalRelation>();

  for (const row of rows) {
    const depth = numberColumn(row, "depth");
    const entity = mapGraphTraversalEntityRow(row, depth);
    entities.set(entity.id, entity);

    if (row.relation_id !== null && row.relation_id !== undefined) {
      const relation = mapGraphTraversalRelationRow(row, depth);
      relations.set(relation.id, relation);
    }
  }

  const entityList = Array.from(entities.values()).sort(compareGraphTraversalEntities);
  const relationList = Array.from(relations.values()).sort(compareGraphTraversalRelations);

  return {
    entities: entityList,
    metrics: {
      depthReached: entityList.reduce((max, entity) => Math.max(max, entity.depth), 0),
      elapsedMs,
      exploredRelations: relationList.length,
      fanout,
      maxDepth,
      maxNodes,
      timedOut: false,
    },
    relations: relationList,
    truncated: rows.length >= maxNodes,
  };
}

function mapGraphTraversalEntityRow(row: DatabaseRow, depth: number): GraphTraversalEntity {
  return {
    ...cloneGraphEntity({
      aliases: jsonStringArrayColumn(row, "entity_aliases"),
      canonicalKey: stringColumn(row, "entity_canonical_key"),
      confidence: numberColumn(row, "entity_confidence"),
      createdAt: stringColumn(row, "entity_created_at"),
      extractionVersion: numberColumn(row, "entity_extraction_version"),
      id: stringColumn(row, "entity_id"),
      knowledgeSpaceId: stringColumn(row, "knowledge_space_id") ?? "",
      metadata: jsonObjectColumn(row, "entity_metadata"),
      name: stringColumn(row, "entity_name"),
      permissionScope: jsonStringArrayColumn(row, "entity_permission_scope"),
      publicationGenerationId: publicationGenerationIdColumn(
        row,
        "entity_publication_generation_id",
      ),
      sourceNodeIds: jsonStringArrayColumn(row, "entity_source_node_ids"),
      type: stringColumn(row, "entity_type") as EntityExtractionType,
      updatedAt: stringColumn(row, "entity_updated_at"),
    }),
    depth,
  };
}

function mapGraphTraversalRelationRow(row: DatabaseRow, depth: number): GraphTraversalRelation {
  return {
    ...cloneGraphRelation({
      confidence: numberColumn(row, "relation_confidence"),
      createdAt: stringColumn(row, "relation_created_at"),
      extractionVersion: numberColumn(row, "relation_extraction_version"),
      id: stringColumn(row, "relation_id"),
      knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
      metadata: jsonObjectColumn(row, "relation_metadata"),
      objectEntityId: stringColumn(row, "relation_object_entity_id"),
      permissionScope: jsonStringArrayColumn(row, "relation_permission_scope"),
      publicationGenerationId: publicationGenerationIdColumn(
        row,
        "relation_publication_generation_id",
      ),
      sourceNodeIds: jsonStringArrayColumn(row, "relation_source_node_ids"),
      subjectEntityId: stringColumn(row, "relation_subject_entity_id"),
      type: stringColumn(row, "relation_type") as RelationExtractionType,
      updatedAt: stringColumn(row, "relation_updated_at"),
    }),
    depth,
  };
}

function compareGraphRelationsForTraversal(left: GraphRelation, right: GraphRelation): number {
  return (
    left.type.localeCompare(right.type) ||
    left.objectEntityId.localeCompare(right.objectEntityId) ||
    left.id.localeCompare(right.id)
  );
}

export function compareGraphTraversalEntities(
  left: GraphTraversalEntity,
  right: GraphTraversalEntity,
): number {
  return left.depth - right.depth || left.id.localeCompare(right.id);
}

function compareGraphTraversalRelations(
  left: GraphTraversalRelation,
  right: GraphTraversalRelation,
): number {
  return left.depth - right.depth || compareGraphRelationsForTraversal(left, right);
}
