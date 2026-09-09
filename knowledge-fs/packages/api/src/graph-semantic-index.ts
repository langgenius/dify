import { createHash } from "node:crypto";
import type {
  DatabaseAdapter,
  DatabaseQueryValue,
  KnowledgeNode,
  KnowledgeSpaceEmbeddingProfile,
} from "@knowledge/core";
import { runWithAbortSignal } from "./bounded-concurrency";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { type DocumentModelBudget, estimateDocumentModelTokens } from "./document-model-budget";
import type { GraphEntity, GraphRelation } from "./graph-index-repository";
import { graphRelationSemanticText } from "./graph-relation-catalog";
import {
  type IngestionModelCallOperationalMetrics,
  ingestionModelUsageFromMetadata,
  recordIngestionModelCallMetric,
} from "./ingestion-model-observability";
import {
  type KnowledgeSpaceEmbeddingResolver,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";

export const GRAPH_SEMANTIC_REPRESENTATION_VERSION = "graph-semantic-representation-v1";
export type GraphSemanticProjectionKind = "entity" | "relation";

export interface GraphSemanticProjection {
  readonly ownerId: string;
  readonly kind: GraphSemanticProjectionKind;
  readonly text: string;
  readonly contentHash: string;
  readonly vector: readonly number[];
}

export interface GraphSemanticIndexScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
  readonly publicationGenerationId: string;
  readonly embeddingProfile: KnowledgeSpaceEmbeddingProfile;
  readonly signal?: AbortSignal | undefined;
  readonly modelBudget?: DocumentModelBudget | undefined;
}

export interface GraphSemanticProjectionRepository {
  hashes(
    input: GraphSemanticIndexScope & {
      readonly kind: GraphSemanticProjectionKind;
      readonly ownerIds: readonly string[];
    },
  ): Promise<ReadonlyMap<string, string>>;
  put(
    input: GraphSemanticIndexScope & { readonly projections: readonly GraphSemanticProjection[] },
  ): Promise<void>;
}

export interface GraphSemanticIndexer {
  index(
    input: GraphSemanticIndexScope & {
      readonly entities: readonly GraphEntity[];
      readonly relations: readonly GraphRelation[];
      readonly nodes: readonly KnowledgeNode[];
    },
  ): Promise<{ readonly indexed: number; readonly reused: number }>;
}

/** Graph vectors have their own owner-cascaded tables, never masquerade as document projections. */
export function createDatabaseGraphSemanticProjectionRepository(
  database: DatabaseAdapter,
): GraphSemanticProjectionRepository {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const table = (kind: GraphSemanticProjectionKind) =>
    kind === "entity" ? "graph_entity_semantic_projections" : "graph_relation_semantic_projections";
  return {
    hashes: async (input) => {
      if (!input.ownerIds.length) return new Map();
      if (input.ownerIds.length > 128) throw new Error("Graph semantic hash batch exceeds 128");
      const params: DatabaseQueryValue[] = [];
      const bind = (value: DatabaseQueryValue) => databasePlaceholder(database, params.push(value));
      const where = `p.${q("knowledge_space_id")} = ${bind(input.knowledgeSpaceId)} AND p.${q("publication_generation_id")} = ${bind(input.publicationGenerationId)} AND p.${q("vector_space_id")} = ${bind(input.embeddingProfile.vectorSpaceId)} AND p.${q("representation_version")} = ${bind(GRAPH_SEMANTIC_REPRESENTATION_VERSION)} AND ks.${q("tenant_id")} = ${bind(input.tenantId)} AND p.${q("owner_id")} IN (${input.ownerIds.map(bind).join(", ")})`;
      const result = await runWithAbortSignal(
        () =>
          database.execute({
            operation: "select",
            tableName: table(input.kind),
            params,
            maxRows: input.ownerIds.length,
            sql: `SELECT p.${q("owner_id")}, p.${q("content_hash")} FROM ${q(table(input.kind))} p JOIN ${q("knowledge_spaces")} ks ON ks.${q("id")} = p.${q("knowledge_space_id")} WHERE ${where};`,
          }),
        input.signal,
      );
      return new Map(result.rows.map((row) => [String(row.owner_id), String(row.content_hash)]));
    },
    put: async (input) => {
      if (!input.projections.length) return;
      if (input.projections.length > 128) throw new Error("Graph semantic write batch exceeds 128");
      input.signal?.throwIfAborted();
      await database.transaction(async (transaction) => {
        const space = await transaction.execute({
          operation: "select",
          tableName: "knowledge_spaces",
          maxRows: 1,
          params: [input.knowledgeSpaceId, input.tenantId],
          sql: `SELECT ${q("lifecycle_state")}, ${q("deletion_job_id")} FROM ${q("knowledge_spaces")} WHERE ${q("id")} = ${databasePlaceholder(database, 1)} AND ${q("tenant_id")} = ${databasePlaceholder(database, 2)} ${database.dialect === "postgres" ? "FOR SHARE" : "FOR UPDATE"};`,
        });
        if (space.rows[0]?.lifecycle_state !== "active" || space.rows[0]?.deletion_job_id != null)
          throw new Error("Graph semantic write scope is unavailable");
        for (const kind of ["entity", "relation"] as const) {
          input.signal?.throwIfAborted();
          const projections = input.projections.filter((projection) => projection.kind === kind);
          if (!projections.length) continue;
          const ownerIds = [...new Set(projections.map((projection) => projection.ownerId))];
          if (ownerIds.length !== projections.length)
            throw new Error("Duplicate graph projection owners");
          const owner = kind === "entity" ? "graph_entities" : "graph_relations";
          const ownerParams: DatabaseQueryValue[] = [
            input.knowledgeSpaceId,
            input.publicationGenerationId,
            ...ownerIds,
          ];
          const owners = await transaction.execute({
            operation: "select",
            tableName: owner,
            maxRows: ownerIds.length,
            params: ownerParams,
            sql: `SELECT ${q("id")} FROM ${q(owner)} WHERE ${q("knowledge_space_id")} = ${databasePlaceholder(database, 1)} AND ${q("publication_generation_id")} = ${databasePlaceholder(database, 2)} AND ${q("id")} IN (${ownerIds.map((_, index) => databasePlaceholder(database, index + 3)).join(", ")}) ${database.dialect === "postgres" ? "FOR SHARE" : "FOR UPDATE"};`,
          });
          if (owners.rows.length !== ownerIds.length)
            throw new Error("Graph semantic projection owner disappeared or changed scope");
          const params: DatabaseQueryValue[] = [];
          const bind = (value: DatabaseQueryValue) =>
            databasePlaceholder(database, params.push(value));
          const columns = [
            "owner_id",
            "knowledge_space_id",
            "publication_generation_id",
            "vector_space_id",
            "dimension",
            "representation_version",
            "content_hash",
            "search_text",
            "vector",
            "created_at",
          ];
          const rows = projections.map((projection) => {
            assertGraphEmbeddingVector(projection.vector, input.embeddingProfile);
            if (
              !/^[a-f0-9]{64}$/.test(projection.contentHash) ||
              !projection.text ||
              projection.text.length > 2000
            )
              throw new Error("Invalid graph projection representation");
            const values = [
              projection.ownerId,
              input.knowledgeSpaceId,
              input.publicationGenerationId,
              input.embeddingProfile.vectorSpaceId,
              projection.vector.length,
              GRAPH_SEMANTIC_REPRESENTATION_VERSION,
              projection.contentHash,
              projection.text,
              JSON.stringify(projection.vector),
              new Date().toISOString(),
            ].map(bind);
            values[8] =
              database.dialect === "postgres"
                ? `${values[8]}::vector`
                : `CAST(${values[8]} AS VECTOR)`;
            return `(${values.join(", ")})`;
          });
          const updateColumns = columns.slice(4);
          const conflict =
            database.dialect === "postgres"
              ? `ON CONFLICT (${q("owner_id")}, ${q("vector_space_id")}) DO UPDATE SET ${updateColumns.map((column) => `${q(column)} = EXCLUDED.${q(column)}`).join(", ")}`
              : `ON DUPLICATE KEY UPDATE ${updateColumns.map((column) => `${q(column)} = VALUES(${q(column)})`).join(", ")}`;
          await transaction.execute({
            operation: "insert",
            tableName: table(kind),
            maxRows: 0,
            params,
            sql: `INSERT INTO ${q(table(kind))} (${columns.map(q).join(", ")}) VALUES ${rows.join(", ")} ${conflict};`,
          });
        }
        input.signal?.throwIfAborted();
      });
    },
  };
}

export function createGraphSemanticIndexer(options: {
  readonly embeddings: KnowledgeSpaceEmbeddingResolver;
  readonly repository: GraphSemanticProjectionRepository;
  readonly batchSize?: number;
  readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
}): GraphSemanticIndexer {
  const batchSize = options.batchSize ?? 16;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 128)
    throw new Error("Invalid graph embedding batch size");
  return {
    index: async (input) => {
      const nodes = new Map(input.nodes.map((node) => [node.id, node]));
      const owners = [
        ...input.entities.map((entity) => ({
          owner: entity,
          kind: "entity" as const,
          text: graphEntitySemanticText(entity, nodes),
        })),
        ...input.relations.map((relation) => ({
          owner: relation,
          kind: "relation" as const,
          text: graphRelationSemanticText(relation.type),
        })),
      ];
      for (const { owner } of owners) {
        if (
          owner.knowledgeSpaceId !== input.knowledgeSpaceId ||
          owner.publicationGenerationId !== input.publicationGenerationId
        )
          throw new Error("Graph semantic indexing crossed owner scope");
      }
      let indexed = 0;
      let reused = 0;
      // Cache only this bounded document invocation. No cross-tenant global cache of private text.
      const vectors = new Map<string, readonly number[]>();
      let resolved: Awaited<ReturnType<KnowledgeSpaceEmbeddingResolver["resolve"]>>;
      for (const kind of ["entity", "relation"] as const) {
        const items = owners.filter((item) => item.kind === kind);
        for (let offset = 0; offset < items.length; offset += batchSize) {
          input.signal?.throwIfAborted();
          const batch = items.slice(offset, offset + batchSize).map((item) => ({
            ...item,
            contentHash: createHash("sha256")
              .update(`${GRAPH_SEMANTIC_REPRESENTATION_VERSION}\n${item.text}`)
              .digest("hex"),
          }));
          const hashes = await options.repository.hashes({
            ...input,
            kind,
            ownerIds: batch.map((item) => item.owner.id),
          });
          const pending = batch.filter((item) => hashes.get(item.owner.id) !== item.contentHash);
          reused += batch.length - pending.length;
          if (!pending.length) continue;
          const missing = [
            ...new Map(
              pending
                .filter((item) => !vectors.has(item.contentHash))
                .map((item) => [item.contentHash, item]),
            ).values(),
          ];
          if (missing.length) {
            resolved ??= await options.embeddings.resolve({
              knowledgeSpaceId: input.knowledgeSpaceId,
              tenantId: input.tenantId,
              profile: input.embeddingProfile,
            });
            if (!resolved || resolved.vectorSpaceId !== input.embeddingProfile.vectorSpaceId)
              throw new Error("Graph embedding profile changed");
            const provider = resolved.providerInstance;
            const startedAt = Date.now();
            input.signal?.throwIfAborted();
            input.modelBudget?.reserve({
              stage: "graph-embedding",
              itemCount: missing.length,
              estimatedTokens: missing.reduce(
                (sum, item) => sum + estimateDocumentModelTokens(item.text),
                0,
              ),
            });
            const invoke = () =>
              runWithAbortSignal(
                () =>
                  provider.embed({
                    model: input.embeddingProfile.model,
                    inputType: "search_document",
                    tenantId: input.tenantId,
                    texts: missing.map((item) => item.text),
                    ...(input.signal ? { signal: input.signal } : {}),
                  }),
                input.signal,
              );
            // Embedding providers own the shared physical-request gate (including their sub-batches).
            // Acquiring the same gate around embed() would deadlock when its concurrency is one.
            await invoke()
              .then((result) => {
                assertEmbeddingModelMatchesProfile({
                  observedModel: result.model,
                  profile: input.embeddingProfile,
                });
                if (result.dense.length !== missing.length)
                  throw new Error("Graph embedding result count mismatch");
                missing.forEach((item, index) => {
                  const vector = result.dense[index] ?? [];
                  assertGraphEmbeddingVector(vector, input.embeddingProfile);
                  vectors.set(item.contentHash, [...vector]);
                });
                return result;
              })
              .then(
                (result) => {
                  recordIngestionModelCallMetric(options.metrics, {
                    stage: "graph-embedding",
                    publicationGenerationId: input.publicationGenerationId,
                    cacheHits: 0,
                    itemCount: missing.length,
                    durationMs: Date.now() - startedAt,
                    providerCalls: 1,
                    retries: 0,
                    outcome: "succeeded",
                    ...ingestionModelUsageFromMetadata(result.metadata),
                  });
                  return result;
                },
                (error) => {
                  recordIngestionModelCallMetric(options.metrics, {
                    stage: "graph-embedding",
                    publicationGenerationId: input.publicationGenerationId,
                    cacheHits: 0,
                    itemCount: missing.length,
                    durationMs: Date.now() - startedAt,
                    providerCalls: 1,
                    retries: 0,
                    outcome: "failed",
                  });
                  throw error;
                },
              );
          }
          await options.repository.put({
            ...input,
            projections: pending.map((item) => {
              const vector = vectors.get(item.contentHash);
              if (!vector) throw new Error("Graph embedding batch is incomplete");
              return {
                ownerId: item.owner.id,
                kind,
                text: item.text,
                contentHash: item.contentHash,
                vector,
              };
            }),
          });
          indexed += pending.length;
          if (kind === "entity") vectors.clear();
        }
        // Retain only predicate vectors between batches; entity vectors are rarely reusable.
        if (kind === "entity") vectors.clear();
      }
      return { indexed, reused };
    },
  };
}

export function graphEntitySemanticText(
  entity: GraphEntity,
  nodes: ReadonlyMap<string, KnowledgeNode>,
): string {
  const description =
    typeof entity.metadata.description === "string"
      ? entity.metadata.description.slice(0, 400)
      : "";
  const context = [...entity.sourceNodeIds]
    .sort()
    .slice(0, 2)
    .flatMap((id) => {
      const node = nodes.get(id);
      if (
        !node ||
        node.knowledgeSpaceId !== entity.knowledgeSpaceId ||
        node.publicationGenerationId !== entity.publicationGenerationId
      )
        return [];
      return [node.text.slice(0, 500)];
    });
  return [
    `Entity: ${entity.name}`,
    `Type: ${entity.type}`,
    `Aliases: ${[...new Set(entity.aliases)].sort().join("; ").slice(0, 500)}`,
    description,
    ...context,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

export function assertGraphEmbeddingVector(
  vector: readonly number[],
  profile: KnowledgeSpaceEmbeddingProfile,
): void {
  if (
    !vector.length ||
    vector.length > 16384 ||
    !vector.every(Number.isFinite) ||
    !vector.some((value) => value !== 0)
  )
    throw new Error("Graph embeddings must be finite nonzero vectors within storage bounds");
  assertObservedEmbeddingDimension({ observedDimension: vector.length, profile });
}
