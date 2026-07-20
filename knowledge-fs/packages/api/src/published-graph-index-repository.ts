import type { DatabaseAdapter, DatabaseQueryValue, DatabaseRow } from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { readableDocumentParentSourcePredicateSql } from "./document-asset-visibility-sql";
import type { EntityExtractionType, RelationExtractionType } from "./extraction-types";
import {
  type GraphEntity,
  type GraphRelation,
  type GraphTraversalEntity,
  type GraphTraversalRelation,
  type GraphTraversalResult,
  cloneGraphEntity,
  cloneGraphRelation,
  compareGraphTraversalEntities,
  validateGraphTraversalInput,
} from "./graph-index-repository";
import { jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";

export interface FindPublishedGraphSeedEntityIdsInput {
  readonly candidateEntityIds: readonly string[];
  readonly limit: number;
  readonly permissionScope: readonly string[];
  readonly snapshot: PublishedProjectionReadSnapshot;
  readonly sourceNodeIds: readonly string[];
}

export interface TraversePublishedGraphInput {
  readonly fanout: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly permissionScope: readonly string[];
  readonly snapshot: PublishedProjectionReadSnapshot;
  readonly startEntityId: string;
  readonly timeoutMs: number;
}

/**
 * Read-only graph view over one immutable publication.
 *
 * Implementations must enforce graph-entity/graph-relation publication membership, exact
 * generation ownership, document/source-node closure, and permission scope before a row can
 * affect traversal. A publication remains readable after a head switch while its status is
 * `superseded`; the current head must never be re-resolved inside a query.
 */
export interface PublishedGraphIndexRepository {
  findSeedEntityIds(input: FindPublishedGraphSeedEntityIdsInput): Promise<readonly string[]>;
  traverse(input: TraversePublishedGraphInput): Promise<GraphTraversalResult>;
}

export interface DatabasePublishedGraphIndexRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxSeedLookupSize: number;
  readonly now?: (() => number) | undefined;
}

export class PublishedGraphSnapshotNotFoundError extends Error {
  constructor() {
    super("Published graph snapshot is unavailable");
    this.name = "PublishedGraphSnapshotNotFoundError";
  }
}

export class PublishedGraphSeedLookupLimitExceededError extends Error {
  constructor(maxSeedLookupSize: number) {
    super(`Published graph seed lookup exceeds maxSeedLookupSize=${maxSeedLookupSize}`);
    this.name = "PublishedGraphSeedLookupLimitExceededError";
  }
}

export function createDatabasePublishedGraphIndexRepository({
  database,
  maxSeedLookupSize,
  now = () => Date.now(),
}: DatabasePublishedGraphIndexRepositoryOptions): PublishedGraphIndexRepository {
  if (!Number.isInteger(maxSeedLookupSize) || maxSeedLookupSize < 1) {
    throw new Error("Published graph maxSeedLookupSize must be at least 1");
  }

  return {
    findSeedEntityIds: async (input) => {
      validateSeedLookupInput(input, maxSeedLookupSize);
      await requirePublishedGraphSnapshot(database, input.snapshot);

      const candidateEntityIds = uniqueNonEmptyStrings(input.candidateEntityIds);
      const sourceNodeIds = uniqueNonEmptyStrings(input.sourceNodeIds);
      if (candidateEntityIds.length === 0 && sourceNodeIds.length === 0) {
        return [];
      }

      const params = publishedSnapshotParams(input.snapshot);
      const permissionJson = JSON.stringify(uniqueNonEmptyStrings(input.permissionScope));
      params.push(permissionJson);
      const graphPermissionPosition = params.length;
      if (database.dialect === "tidb") {
        params.push(permissionJson);
      }
      const sourcePermissionPosition = params.length;
      const seedPredicates: string[] = [];

      if (candidateEntityIds.length > 0) {
        seedPredicates.push(
          `${column(database, "e", "id")} IN (${appendPlaceholders(
            database,
            params,
            candidateEntityIds,
          )})`,
        );
      }
      if (sourceNodeIds.length > 0) {
        seedPredicates.push(
          graphSourceNodeOverlapSql(
            database,
            column(database, "e", "source_node_ids"),
            params,
            sourceNodeIds,
          ),
        );
      }

      params.push(input.limit);
      const result = await database.execute({
        maxRows: input.limit,
        operation: "select",
        params,
        sql: `SELECT ${column(database, "e", "id")} AS ${quoted(
          database,
          "entity_id",
        )}${publishedGraphEntityFromSql(database, "e", "em")}${publishedSnapshotWhereSql(
          database,
          "em",
          "graph-entity",
        )} AND ${graphPermissionSql(
          database,
          column(database, "e", "permission_scope"),
          graphPermissionPosition,
        )} AND ${graphSourceNodeClosureSql(
          database,
          "e",
          "em",
          sourcePermissionPosition,
        )} AND (${seedPredicates.join(" OR ")}) ORDER BY ${column(
          database,
          "e",
          "id",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName: "projection_set_publication_members",
      });

      return result.rows.map((row) => stringColumn(row, "entity_id"));
    },
    traverse: async (input) => {
      validatePublishedGraphTraversalInput(input);
      await requirePublishedGraphSnapshot(database, input.snapshot);
      const startedAt = now();
      const deadline = startedAt + input.timeoutMs;
      const root = await loadPublishedGraphRoot(database, input);

      if (!root) {
        return emptyPublishedGraphTraversal(input, now() - startedAt);
      }

      const entities = new Map<string, GraphTraversalEntity>([
        [root.id, { ...cloneGraphEntity(root), depth: 0 }],
      ]);
      const relations = new Map<string, GraphTraversalRelation>();
      let frontier = [root.id];
      let depthReached = 0;
      let exploredRelations = 0;
      let timedOut = false;
      let truncated = false;

      for (let depth = 1; depth <= input.maxDepth; depth += 1) {
        if (now() > deadline) {
          timedOut = true;
          truncated = true;
          break;
        }

        const rows = await loadPublishedGraphEdges(database, input, frontier);
        const nextFrontier: string[] = [];

        for (const row of rows) {
          const relation = mapPublishedGraphRelationRow(row);
          const target = mapPublishedGraphEntityRow(row);

          if (!entities.has(target.id)) {
            if (entities.size >= input.maxNodes) {
              truncated = true;
              continue;
            }
            entities.set(target.id, { ...target, depth });
            nextFrontier.push(target.id);
          }

          exploredRelations += 1;
          relations.set(relation.id, { ...relation, depth });
        }

        if (now() > deadline) {
          timedOut = true;
          truncated = true;
          break;
        }
        if (nextFrontier.length === 0) {
          break;
        }

        depthReached = depth;
        frontier = uniqueNonEmptyStrings(nextFrontier);
      }

      return {
        entities: [...entities.values()].sort(compareGraphTraversalEntities),
        metrics: {
          depthReached,
          elapsedMs: now() - startedAt,
          exploredRelations,
          fanout: input.fanout,
          maxDepth: input.maxDepth,
          maxNodes: input.maxNodes,
          timedOut,
        },
        relations: [...relations.values()].sort(comparePublishedGraphTraversalRelations),
        truncated,
      };
    },
  };
}

async function requirePublishedGraphSnapshot(
  database: DatabaseAdapter,
  snapshot: PublishedProjectionReadSnapshot,
): Promise<void> {
  validateSnapshot(snapshot);
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: publishedSnapshotParams(snapshot),
    sql: `SELECT 1 AS ${quoted(database, "snapshot_exists")} FROM ${quoted(
      database,
      "projection_set_publications",
    )} pub${publishedSnapshotWhereOnlySql(database)} LIMIT 1;`,
    tableName: "projection_set_publications",
  });

  if (!result.rows[0]) {
    throw new PublishedGraphSnapshotNotFoundError();
  }
}

async function loadPublishedGraphRoot(
  database: DatabaseAdapter,
  input: TraversePublishedGraphInput,
): Promise<GraphEntity | null> {
  const params = publishedSnapshotParams(input.snapshot);
  const permissionJson = JSON.stringify(uniqueNonEmptyStrings(input.permissionScope));
  params.push(permissionJson);
  const graphPermissionPosition = params.length;
  let sourcePermissionPosition: number;
  let startEntityPosition: number;
  if (database.dialect === "tidb") {
    params.push(input.startEntityId, permissionJson);
    startEntityPosition = params.length - 1;
    sourcePermissionPosition = params.length;
  } else {
    sourcePermissionPosition = graphPermissionPosition;
    params.push(input.startEntityId);
    startEntityPosition = params.length;
  }
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT e.*${publishedGraphEntityFromSql(
      database,
      "e",
      "em",
    )}${publishedSnapshotWhereSql(database, "em", "graph-entity")} AND ${graphPermissionSql(
      database,
      column(database, "e", "permission_scope"),
      graphPermissionPosition,
    )} AND ${column(database, "e", "id")} = ${databasePlaceholder(
      database,
      startEntityPosition,
    )} AND ${graphSourceNodeClosureSql(database, "e", "em", sourcePermissionPosition)} LIMIT 1;`,
    tableName: "projection_set_publication_members",
  });

  return result.rows[0] ? mapGraphEntityRow(result.rows[0]) : null;
}

async function loadPublishedGraphEdges(
  database: DatabaseAdapter,
  input: TraversePublishedGraphInput,
  frontier: readonly string[],
): Promise<readonly DatabaseRow[]> {
  const normalizedFrontier = uniqueNonEmptyStrings(frontier);
  if (normalizedFrontier.length === 0) {
    return [];
  }

  const params = publishedSnapshotParams(input.snapshot);
  const permissionJson = JSON.stringify(uniqueNonEmptyStrings(input.permissionScope));
  let permissionPositions: readonly number[];
  let frontierSql: string;
  if (database.dialect === "postgres") {
    params.push(permissionJson);
    permissionPositions = [
      params.length,
      params.length,
      params.length,
      params.length,
      params.length,
      params.length,
    ];
    frontierSql = appendPlaceholders(database, params, normalizedFrontier);
  } else {
    // TiDB binds `?` in textual order: snapshot identity, frontier, three row ACLs, then three
    // source-node-closure ACLs.
    frontierSql = appendPlaceholders(database, params, normalizedFrontier);
    params.push(
      permissionJson,
      permissionJson,
      permissionJson,
      permissionJson,
      permissionJson,
      permissionJson,
    );
    permissionPositions = [
      params.length - 5,
      params.length - 4,
      params.length - 3,
      params.length - 2,
      params.length - 1,
      params.length,
    ];
  }
  params.push(input.fanout, input.fanout * normalizedFrontier.length);
  const fanoutPosition = params.length - 1;
  const limitPosition = params.length;
  const ranked = "ranked_graph_edges";

  const result = await database.execute({
    maxRows: input.fanout * normalizedFrontier.length,
    operation: "select",
    params,
    sql: `SELECT * FROM (SELECT ${publishedGraphRelationSelectSql(
      database,
      "r",
    )}, ${publishedGraphEntitySelectSql(
      database,
      "child",
    )}, ROW_NUMBER() OVER (PARTITION BY ${column(
      database,
      "r",
      "subject_entity_id",
    )} ORDER BY ${column(database, "r", "type")} ASC, ${column(
      database,
      "r",
      "object_entity_id",
    )} ASC, ${column(database, "r", "id")} ASC) AS ${quoted(
      database,
      "fanout_rank",
    )} FROM ${quoted(database, "projection_set_publications")} pub JOIN ${quoted(
      database,
      "projection_set_publication_members",
    )} rm ON ${publicationMemberToPublicationJoinSql(database, "rm")} JOIN ${quoted(
      database,
      "graph_relations",
    )} r ON ${graphComponentMemberJoinSql(database, "r", "rm", "graph-relation")} JOIN ${quoted(
      database,
      "projection_set_publication_members",
    )} sm ON ${samePublicationMemberSql(database, "sm", "rm", "graph-entity")} AND ${column(
      database,
      "sm",
      "component_key",
    )} = ${column(database, "r", "subject_entity_id")} JOIN ${quoted(
      database,
      "graph_entities",
    )} subject ON ${graphComponentMemberJoinSql(
      database,
      "subject",
      "sm",
      "graph-entity",
    )} JOIN ${quoted(database, "projection_set_publication_members")} cm ON ${samePublicationMemberSql(
      database,
      "cm",
      "rm",
      "graph-entity",
    )} AND ${column(database, "cm", "component_key")} = ${column(
      database,
      "r",
      "object_entity_id",
    )} JOIN ${quoted(database, "graph_entities")} child ON ${graphComponentMemberJoinSql(
      database,
      "child",
      "cm",
      "graph-entity",
    )}${publishedSnapshotWhereOnlySql(database)} AND ${column(
      database,
      "r",
      "subject_entity_id",
    )} IN (${frontierSql}) AND ${column(database, "rm", "document_asset_id")} IS NOT NULL AND ${graphPermissionSql(
      database,
      column(database, "r", "permission_scope"),
      permissionPositions[0] as number,
    )} AND ${graphPermissionSql(
      database,
      column(database, "subject", "permission_scope"),
      permissionPositions[1] as number,
    )} AND ${graphPermissionSql(
      database,
      column(database, "child", "permission_scope"),
      permissionPositions[2] as number,
    )} AND ${graphSourceNodeClosureSql(
      database,
      "r",
      "rm",
      permissionPositions[3] as number,
    )} AND ${graphSourceNodeClosureSql(
      database,
      "subject",
      "sm",
      permissionPositions[4] as number,
    )} AND ${graphSourceNodeClosureSql(
      database,
      "child",
      "cm",
      permissionPositions[5] as number,
    )}) ${ranked} WHERE ${quoted(
      database,
      "fanout_rank",
    )} <= ${databasePlaceholder(database, fanoutPosition)} ORDER BY ${quoted(
      database,
      "relation_type",
    )} ASC, ${quoted(database, "relation_object_entity_id")} ASC, ${quoted(
      database,
      "relation_id",
    )} ASC LIMIT ${databasePlaceholder(database, limitPosition)};`,
    tableName: "projection_set_publication_members",
  });

  return result.rows;
}

function publishedGraphEntityFromSql(
  database: DatabaseAdapter,
  entityAlias: string,
  memberAlias: string,
): string {
  return ` FROM ${quoted(database, "projection_set_publications")} pub JOIN ${quoted(
    database,
    "projection_set_publication_members",
  )} ${memberAlias} ON ${publicationMemberToPublicationJoinSql(
    database,
    memberAlias,
  )} JOIN ${quoted(database, "graph_entities")} ${entityAlias} ON ${graphComponentMemberJoinSql(
    database,
    entityAlias,
    memberAlias,
    "graph-entity",
  )}`;
}

function publicationMemberToPublicationJoinSql(
  database: DatabaseAdapter,
  memberAlias: string,
): string {
  return `${column(database, memberAlias, "tenant_id")} = ${column(
    database,
    "pub",
    "tenant_id",
  )} AND ${column(database, memberAlias, "knowledge_space_id")} = ${column(
    database,
    "pub",
    "knowledge_space_id",
  )} AND ${column(database, memberAlias, "publication_id")} = ${column(database, "pub", "id")}`;
}

function graphComponentMemberJoinSql(
  database: DatabaseAdapter,
  componentAlias: string,
  memberAlias: string,
  componentType: "graph-entity" | "graph-relation",
): string {
  return `${column(database, memberAlias, "component_type")} = '${componentType}' AND ${column(
    database,
    memberAlias,
    "component_key",
  )} = ${column(database, componentAlias, "id")} AND ${column(
    database,
    memberAlias,
    "knowledge_space_id",
  )} = ${column(database, componentAlias, "knowledge_space_id")} AND ${column(
    database,
    memberAlias,
    "generation_id",
  )} = ${column(database, componentAlias, "publication_generation_id")}`;
}

function samePublicationMemberSql(
  database: DatabaseAdapter,
  memberAlias: string,
  referenceAlias: string,
  componentType: "graph-entity" | "graph-relation",
): string {
  return `${column(database, memberAlias, "tenant_id")} = ${column(
    database,
    referenceAlias,
    "tenant_id",
  )} AND ${column(database, memberAlias, "knowledge_space_id")} = ${column(
    database,
    referenceAlias,
    "knowledge_space_id",
  )} AND ${column(database, memberAlias, "publication_id")} = ${column(
    database,
    referenceAlias,
    "publication_id",
  )} AND ${column(database, memberAlias, "component_type")} = '${componentType}'`;
}

function publishedSnapshotWhereSql(
  database: DatabaseAdapter,
  memberAlias: string,
  componentType: "graph-entity" | "graph-relation",
): string {
  return `${publishedSnapshotWhereOnlySql(database)} AND ${column(
    database,
    memberAlias,
    "component_type",
  )} = '${componentType}' AND ${column(database, memberAlias, "document_asset_id")} IS NOT NULL`;
}

function publishedSnapshotWhereOnlySql(database: DatabaseAdapter): string {
  return ` WHERE ${column(database, "pub", "tenant_id")} = ${databasePlaceholder(
    database,
    1,
  )} AND ${column(database, "pub", "knowledge_space_id")} = ${databasePlaceholder(
    database,
    2,
  )} AND ${column(database, "pub", "id")} = ${databasePlaceholder(
    database,
    3,
  )} AND ${column(database, "pub", "fingerprint")} = ${databasePlaceholder(
    database,
    4,
  )} AND ${column(database, "pub", "status")} IN ('published', 'superseded')`;
}

function graphPermissionSql(
  database: DatabaseAdapter,
  qualifiedScopeColumn: string,
  permissionPosition: number,
): string {
  const placeholder = databasePlaceholder(database, permissionPosition);
  return database.dialect === "postgres"
    ? `${placeholder}::jsonb @> ${qualifiedScopeColumn}`
    : `JSON_CONTAINS(CAST(${placeholder} AS JSON), ${qualifiedScopeColumn})`;
}

function graphSourceNodeClosureSql(
  database: DatabaseAdapter,
  componentAlias: string,
  memberAlias: string,
  permissionPosition: number,
): string {
  const sourceNodeIds = column(database, componentAlias, "source_node_ids");
  const sourceNode = "closure_node";
  const sourceProjection = "closure_projection";
  const sourceMember = "closure_member";
  const documentAsset = "closure_document";
  const activeDocumentClosure = `EXISTS (SELECT 1 FROM ${quoted(
    database,
    "document_assets",
  )} ${documentAsset} WHERE ${column(database, documentAsset, "id")} = ${column(
    database,
    memberAlias,
    "document_asset_id",
  )} AND ${column(database, documentAsset, "knowledge_space_id")} = ${column(
    database,
    memberAlias,
    "knowledge_space_id",
  )} AND ${column(
    database,
    documentAsset,
    "lifecycle_state",
  )} = 'active' AND ${readableDocumentParentSourcePredicateSql(
    database,
    documentAsset,
    "closure_parent_source",
  )})`;
  const publishedSourceMembership = `EXISTS (SELECT 1 FROM ${quoted(
    database,
    "projection_set_publication_members",
  )} ${sourceMember} JOIN ${quoted(
    database,
    "index_projections",
  )} ${sourceProjection} ON ${column(database, sourceProjection, "id")} = ${column(
    database,
    sourceMember,
    "component_key",
  )} AND ${column(database, sourceProjection, "knowledge_space_id")} = ${column(
    database,
    sourceMember,
    "knowledge_space_id",
  )} AND ${column(database, sourceProjection, "publication_generation_id")} = ${column(
    database,
    sourceMember,
    "generation_id",
  )} WHERE ${column(database, sourceMember, "tenant_id")} = ${column(
    database,
    memberAlias,
    "tenant_id",
  )} AND ${column(database, sourceMember, "knowledge_space_id")} = ${column(
    database,
    memberAlias,
    "knowledge_space_id",
  )} AND ${column(database, sourceMember, "publication_id")} = ${column(
    database,
    memberAlias,
    "publication_id",
  )} AND ${column(database, sourceMember, "component_type")} = 'index-projection' AND ${column(
    database,
    sourceMember,
    "generation_id",
  )} = ${column(database, memberAlias, "generation_id")} AND ${column(
    database,
    sourceMember,
    "document_asset_id",
  )} = ${column(database, memberAlias, "document_asset_id")} AND ${column(
    database,
    sourceProjection,
    "node_id",
  )} = ${column(database, sourceNode, "id")} AND ${column(
    database,
    sourceProjection,
    "status",
  )} = 'ready')`;
  const matchingCount = `SELECT COUNT(*) FROM ${quoted(
    database,
    "knowledge_nodes",
  )} ${sourceNode} WHERE ${column(database, sourceNode, "knowledge_space_id")} = ${column(
    database,
    componentAlias,
    "knowledge_space_id",
  )} AND ${column(database, sourceNode, "publication_generation_id")} = ${column(
    database,
    memberAlias,
    "generation_id",
  )} AND ${column(database, sourceNode, "document_asset_id")} = ${column(
    database,
    memberAlias,
    "document_asset_id",
  )} AND ${publishedSourceMembership} AND ${graphPermissionSql(
    database,
    column(database, sourceNode, "permission_scope"),
    permissionPosition,
  )} AND ${
    database.dialect === "postgres"
      ? `${sourceNodeIds} ? CAST(${column(database, sourceNode, "id")} AS text)`
      : `JSON_CONTAINS(${sourceNodeIds}, JSON_QUOTE(CAST(${column(
          database,
          sourceNode,
          "id",
        )} AS CHAR)))`
  }`;
  const jsonLength =
    database.dialect === "postgres"
      ? `jsonb_array_length(${sourceNodeIds})`
      : `JSON_LENGTH(${sourceNodeIds})`;

  return `${activeDocumentClosure} AND ${jsonLength} > 0 AND (${matchingCount}) = ${jsonLength}`;
}

function graphSourceNodeOverlapSql(
  database: DatabaseAdapter,
  sourceNodeIdsColumn: string,
  params: DatabaseQueryValue[],
  sourceNodeIds: readonly string[],
): string {
  if (database.dialect === "postgres") {
    const placeholders = sourceNodeIds.map((sourceNodeId) => {
      params.push(sourceNodeId);
      return `${databasePlaceholder(database, params.length)}::text`;
    });
    return `${sourceNodeIdsColumn} ?| ARRAY[${placeholders.join(", ")}]`;
  }

  return `(${sourceNodeIds
    .map((sourceNodeId) => {
      params.push(sourceNodeId);
      return `JSON_CONTAINS(${sourceNodeIdsColumn}, JSON_QUOTE(${databasePlaceholder(
        database,
        params.length,
      )}))`;
    })
    .join(" OR ")})`;
}

function publishedGraphEntitySelectSql(database: DatabaseAdapter, alias: string): string {
  return graphEntityColumns
    .map((name) => `${column(database, alias, name)} AS ${quoted(database, `entity_${name}`)}`)
    .join(", ");
}

function publishedGraphRelationSelectSql(database: DatabaseAdapter, alias: string): string {
  return graphRelationColumns
    .map((name) => `${column(database, alias, name)} AS ${quoted(database, `relation_${name}`)}`)
    .join(", ");
}

const graphEntityColumns = [
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
] as const;

const graphRelationColumns = [
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
] as const;

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
    publicationGenerationId: optionalStringColumn(row, "publication_generation_id"),
    sourceNodeIds: jsonStringArrayColumn(row, "source_node_ids"),
    type: stringColumn(row, "type") as EntityExtractionType,
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function mapPublishedGraphEntityRow(row: DatabaseRow): GraphEntity {
  return cloneGraphEntity({
    aliases: jsonStringArrayColumn(row, "entity_aliases"),
    canonicalKey: stringColumn(row, "entity_canonical_key"),
    confidence: numberColumn(row, "entity_confidence"),
    createdAt: stringColumn(row, "entity_created_at"),
    extractionVersion: numberColumn(row, "entity_extraction_version"),
    id: stringColumn(row, "entity_id"),
    knowledgeSpaceId: stringColumn(row, "entity_knowledge_space_id"),
    metadata: jsonObjectColumn(row, "entity_metadata"),
    name: stringColumn(row, "entity_name"),
    permissionScope: jsonStringArrayColumn(row, "entity_permission_scope"),
    publicationGenerationId: optionalStringColumn(row, "entity_publication_generation_id"),
    sourceNodeIds: jsonStringArrayColumn(row, "entity_source_node_ids"),
    type: stringColumn(row, "entity_type") as EntityExtractionType,
    updatedAt: stringColumn(row, "entity_updated_at"),
  });
}

function mapPublishedGraphRelationRow(row: DatabaseRow): GraphRelation {
  return cloneGraphRelation({
    confidence: numberColumn(row, "relation_confidence"),
    createdAt: stringColumn(row, "relation_created_at"),
    extractionVersion: numberColumn(row, "relation_extraction_version"),
    id: stringColumn(row, "relation_id"),
    knowledgeSpaceId: stringColumn(row, "relation_knowledge_space_id"),
    metadata: jsonObjectColumn(row, "relation_metadata"),
    objectEntityId: stringColumn(row, "relation_object_entity_id"),
    permissionScope: jsonStringArrayColumn(row, "relation_permission_scope"),
    publicationGenerationId: optionalStringColumn(row, "relation_publication_generation_id"),
    sourceNodeIds: jsonStringArrayColumn(row, "relation_source_node_ids"),
    subjectEntityId: stringColumn(row, "relation_subject_entity_id"),
    type: stringColumn(row, "relation_type") as RelationExtractionType,
    updatedAt: stringColumn(row, "relation_updated_at"),
  });
}

function emptyPublishedGraphTraversal(
  input: TraversePublishedGraphInput,
  elapsedMs: number,
): GraphTraversalResult {
  return {
    entities: [],
    metrics: {
      depthReached: 0,
      elapsedMs,
      exploredRelations: 0,
      fanout: input.fanout,
      maxDepth: input.maxDepth,
      maxNodes: input.maxNodes,
      timedOut: false,
    },
    relations: [],
    truncated: false,
  };
}

function validateSeedLookupInput(
  input: FindPublishedGraphSeedEntityIdsInput,
  maxSeedLookupSize: number,
): void {
  validateSnapshot(input.snapshot);
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error("Published graph seed limit must be at least 1");
  }
  if (input.limit > maxSeedLookupSize) {
    throw new PublishedGraphSeedLookupLimitExceededError(maxSeedLookupSize);
  }
  if (input.candidateEntityIds.length + input.sourceNodeIds.length > maxSeedLookupSize) {
    throw new PublishedGraphSeedLookupLimitExceededError(maxSeedLookupSize);
  }
  validateNonEmptyStrings(input.candidateEntityIds, "candidateEntityIds");
  validateNonEmptyStrings(input.sourceNodeIds, "sourceNodeIds");
  validateNonEmptyStrings(input.permissionScope, "permissionScope");
}

function validatePublishedGraphTraversalInput(input: TraversePublishedGraphInput): void {
  validateSnapshot(input.snapshot);
  validateGraphTraversalInput({
    fanout: input.fanout,
    knowledgeSpaceId: input.snapshot.knowledgeSpaceId,
    maxDepth: input.maxDepth,
    maxNodes: input.maxNodes,
    permissionScope: input.permissionScope,
    startEntityId: input.startEntityId,
    timeoutMs: input.timeoutMs,
  });
}

function validateSnapshot(snapshot: PublishedProjectionReadSnapshot): void {
  for (const [name, value] of Object.entries({
    fingerprint: snapshot.fingerprint,
    knowledgeSpaceId: snapshot.knowledgeSpaceId,
    publicationId: snapshot.publicationId,
    tenantId: snapshot.tenantId,
  })) {
    if (!value.trim()) {
      throw new Error(`Published graph snapshot ${name} is required`);
    }
  }
}

function validateNonEmptyStrings(values: readonly string[], name: string): void {
  if (values.some((value) => !value.trim())) {
    throw new Error(`Published graph ${name} must contain non-empty strings`);
  }
}

function publishedSnapshotParams(snapshot: PublishedProjectionReadSnapshot): DatabaseQueryValue[] {
  return [
    snapshot.tenantId,
    snapshot.knowledgeSpaceId,
    snapshot.publicationId,
    snapshot.fingerprint,
  ];
}

function appendPlaceholders(
  database: DatabaseAdapter,
  params: DatabaseQueryValue[],
  values: readonly string[],
): string {
  return values
    .map((value) => {
      params.push(value);
      return databasePlaceholder(database, params.length);
    })
    .join(", ");
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function comparePublishedGraphTraversalRelations(
  left: GraphTraversalRelation,
  right: GraphTraversalRelation,
): number {
  return (
    left.depth - right.depth ||
    left.type.localeCompare(right.type) ||
    left.objectEntityId.localeCompare(right.objectEntityId) ||
    left.id.localeCompare(right.id)
  );
}

function quoted(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function column(database: DatabaseAdapter, alias: string, identifier: string): string {
  return `${alias}.${quoted(database, identifier)}`;
}
