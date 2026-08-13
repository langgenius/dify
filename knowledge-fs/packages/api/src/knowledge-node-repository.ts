import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
  KnowledgeNode,
} from "@knowledge/core";
import {
  KnowledgeNodeSchema,
  KnowledgeSpaceModelSelectionSchema,
  PUBLICATION_GENERATION_ID_SENTINEL,
  PublicationGenerationIdSchema,
  UuidSchema,
  stableJson,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import {
  type PublishedGenerationReferenceGuard,
  assertDatabaseGenerationNotPublished,
  assertExactGenerationReplay,
  assertInMemoryGenerationNotPublished,
} from "./generation-immutability";
import {
  cloneJsonObject,
  isPlainObject,
  jsonObjectColumn,
  jsonStringArrayColumn,
} from "./json-utils";
import {
  type KnowledgeNodeGenerationCompletionReceipt,
  type KnowledgeNodeGenerationReceipt,
  type KnowledgeNodeGenerationUnitRangeReceipt,
  type KnowledgeNodeGenerationWindowReceipt,
  type KnowledgeNodeSemanticGenerationConfig,
  MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES,
  MAX_LLM_SEMANTIC_COMPLETION_IDENTITIES,
  MAX_LLM_SEMANTIC_FINISH_REASON_CODE_POINTS,
  MAX_LLM_SEMANTIC_TERMINAL_IDENTITY_CODE_POINTS,
  MAX_LLM_SEMANTIC_UNIT_ID_CODE_POINTS,
  MAX_LLM_SEMANTIC_WINDOWS,
  MAX_LLM_SEMANTIC_WINDOW_ID_CODE_POINTS,
  knowledgeNodeGenerationReceiptSerializedBytes,
  llmSemanticCompletionFingerprint,
} from "./semantic-generation-receipt";

export type {
  KnowledgeNodeGenerationCompletionReceipt,
  KnowledgeNodeGenerationReceipt,
  KnowledgeNodeGenerationUnitRangeReceipt,
  KnowledgeNodeGenerationWindowReceipt,
  KnowledgeNodeSemanticGenerationConfig,
} from "./semantic-generation-receipt";

export interface KnowledgeNodeCursor {
  readonly id: string;
  readonly startOffset: number;
}

export interface KnowledgeNodeSpaceCursor {
  readonly id: string;
}

export interface ListKnowledgeNodesByArtifactInput {
  readonly cursor?: KnowledgeNodeCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly parseArtifactId: string;
  readonly publicationGenerationId?: string | undefined;
}

export interface ListKnowledgeNodesResult {
  readonly items: KnowledgeNode[];
  readonly nextCursor?: KnowledgeNodeCursor;
}

export interface ListKnowledgeNodesBySpaceInput {
  readonly cursor?: KnowledgeNodeSpaceCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly publicationGenerationId?: string | undefined;
}

export interface ListKnowledgeNodesBySpaceResult {
  readonly items: KnowledgeNode[];
  readonly nextCursor?: KnowledgeNodeSpaceCursor;
}

export interface GetManyKnowledgeNodesInput {
  readonly ids: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId?: string | undefined;
}

export interface DeleteKnowledgeNodesByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly maxNodes: number;
}

export interface DeleteKnowledgeNodesResult {
  readonly deleted: number;
  readonly nodeIds: readonly string[];
}

export interface ListKnowledgeNodeIdsByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly maxNodes: number;
}

export interface KnowledgeNodeLookupInput {
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId?: string | undefined;
}

export interface UpdateKnowledgeNodeMetadataPatch {
  readonly id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface UpdateKnowledgeNodeMetadataManyInput {
  readonly knowledgeSpaceId: string;
  readonly patches: readonly UpdateKnowledgeNodeMetadataPatch[];
  readonly publicationGenerationId?: string | undefined;
}

export interface KnowledgeNodeGenerationReceiptLookupInput {
  readonly knowledgeSpaceId: string;
  readonly parseArtifactId: string;
  readonly publicationGenerationId: string;
}

export interface CompleteKnowledgeNodeGenerationInput {
  readonly nodes: readonly KnowledgeNode[];
  readonly receipt: KnowledgeNodeGenerationReceipt;
}

export interface CompleteKnowledgeNodeGenerationResult {
  readonly nodes: KnowledgeNode[];
  readonly receipt: KnowledgeNodeGenerationReceipt;
}

export interface KnowledgeNodeRepository {
  completeGenerationAtomically?(
    input: CompleteKnowledgeNodeGenerationInput,
  ): Promise<CompleteKnowledgeNodeGenerationResult>;
  createMany(nodes: readonly KnowledgeNode[]): Promise<KnowledgeNode[]>;
  deleteByDocumentAsset(
    input: DeleteKnowledgeNodesByDocumentAssetInput,
  ): Promise<DeleteKnowledgeNodesResult>;
  get(input: KnowledgeNodeLookupInput): Promise<KnowledgeNode | null>;
  getGenerationReceipt?(
    input: KnowledgeNodeGenerationReceiptLookupInput,
  ): Promise<KnowledgeNodeGenerationReceipt | null>;
  getMany(input: GetManyKnowledgeNodesInput): Promise<KnowledgeNode[]>;
  /**
   * Reads immutable evidence references by their globally unique ids without selecting a
   * publication generation. Callers must still provide the owning knowledge space.
   */
  getManyByIdsAcrossGenerations(input: GetManyKnowledgeNodesInput): Promise<KnowledgeNode[]>;
  listByArtifact(input: ListKnowledgeNodesByArtifactInput): Promise<ListKnowledgeNodesResult>;
  listIdsByDocumentAsset(
    input: ListKnowledgeNodeIdsByDocumentAssetInput,
  ): Promise<readonly string[]>;
  listBySpace(input: ListKnowledgeNodesBySpaceInput): Promise<ListKnowledgeNodesBySpaceResult>;
  updateMetadataMany(input: UpdateKnowledgeNodeMetadataManyInput): Promise<KnowledgeNode[]>;
  /**
   * Persists one immutable publication generation in a single repository transaction while the
   * implementation may split SQL statements into repository-safe batches.
   */
  upsertGenerationAtomically?(nodes: readonly KnowledgeNode[]): Promise<KnowledgeNode[]>;
  upsertMany(nodes: readonly KnowledgeNode[]): Promise<KnowledgeNode[]>;
}

export interface InMemoryKnowledgeNodeRepositoryOptions {
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
  readonly maxNodes: number;
  readonly publishedGenerationGuard?: PublishedGenerationReferenceGuard | undefined;
}

export interface DatabaseKnowledgeNodeRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
}

export class KnowledgeNodeCapacityExceededError extends Error {
  constructor(maxNodes: number) {
    super(`Knowledge node repository maxNodes=${maxNodes} exceeded`);
  }
}

export class KnowledgeNodeOwnershipConflictError extends Error {
  constructor(id: string) {
    super(`Knowledge node id=${id} is already owned by another scope or generation`);
  }
}

export class KnowledgeNodeLogicalConflictError extends Error {
  constructor() {
    super("Knowledge node logical identity is already owned by another node id");
  }
}

export class KnowledgeNodeGenerationReceiptConflictError extends Error {
  constructor() {
    super("Knowledge node generation receipt conflicts with the immutable persisted receipt");
  }
}

export function createInMemoryKnowledgeNodeRepository({
  maxBatchSize,
  maxListLimit,
  maxNodes,
  publishedGenerationGuard,
}: InMemoryKnowledgeNodeRepositoryOptions): KnowledgeNodeRepository {
  validateKnowledgeNodeRepositoryBounds({ maxBatchSize, maxListLimit, maxNodes });

  const nodes = new Map<string, KnowledgeNode>();
  const generationReceipts = new Map<string, KnowledgeNodeGenerationReceipt>();
  const upsertAtomically = (input: readonly KnowledgeNode[]): KnowledgeNode[] => {
    const parsed = input.map((node) => cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)));
    validateKnowledgeNodeLogicalBatch(parsed);
    const next = new Map(nodes);
    const persisted: KnowledgeNode[] = [];

    for (const node of parsed) {
      const existingById = next.get(node.id);
      if (existingById && !hasSameKnowledgeNodeOwnership(existingById, node)) {
        throw new KnowledgeNodeOwnershipConflictError(node.id);
      }
      if (
        existingById &&
        knowledgeNodeLogicalIdentity(existingById) !== knowledgeNodeLogicalIdentity(node)
      ) {
        throw new KnowledgeNodeLogicalConflictError();
      }

      const existingByLogicalIdentity = findKnowledgeNodeByLogicalIdentity(next.values(), node);
      if (
        existingById &&
        existingByLogicalIdentity &&
        existingById.id !== existingByLogicalIdentity.id
      ) {
        throw new KnowledgeNodeLogicalConflictError();
      }
      if (
        existingByLogicalIdentity &&
        !hasSameKnowledgeNodeOwnership(existingByLogicalIdentity, node)
      ) {
        throw new KnowledgeNodeOwnershipConflictError(node.id);
      }

      const existing = existingById ?? existingByLogicalIdentity;
      if (existing && node.publicationGenerationId) {
        assertExactGenerationReplay({
          componentType: "knowledge-node",
          incoming: node,
          logicalKey: knowledgeNodeLogicalIdentity(node),
          persisted: existing,
        });
        persisted.push(existing);
        continue;
      }
      const stored = existing ? { ...node, id: existing.id } : node;
      next.set(stored.id, cloneKnowledgeNode(stored));
      persisted.push(stored);
    }

    if (next.size > maxNodes) {
      throw new KnowledgeNodeCapacityExceededError(maxNodes);
    }

    nodes.clear();
    for (const [id, node] of next) {
      nodes.set(id, node);
    }

    return persisted.map(cloneKnowledgeNode);
  };

  return {
    completeGenerationAtomically: async (input) => {
      const receipt = validateKnowledgeNodeGenerationCompletion(input);
      const key = knowledgeNodeGenerationReceiptKey(receipt);
      const existingReceipt = generationReceipts.get(key);
      if (existingReceipt && stableJson(existingReceipt) !== stableJson(receipt)) {
        throw new KnowledgeNodeGenerationReceiptConflictError();
      }
      const persistedNodes = input.nodes.length > 0 ? upsertAtomically(input.nodes) : [];
      generationReceipts.set(key, cloneKnowledgeNodeGenerationReceipt(receipt));
      return {
        nodes: persistedNodes,
        receipt: cloneKnowledgeNodeGenerationReceipt(existingReceipt ?? receipt),
      };
    },
    createMany: async (input) => {
      validateKnowledgeNodeBatch(input, maxBatchSize);
      const parsed = input.map((node) => cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)));
      validateKnowledgeNodeLogicalBatch(parsed);
      const next = new Map(nodes);
      const persisted: KnowledgeNode[] = [];

      for (const node of parsed) {
        if (node.publicationGenerationId) {
          const existingById = next.get(node.id);
          const existingByLogicalIdentity = findKnowledgeNodeByLogicalIdentity(next.values(), node);
          if (
            existingById &&
            existingByLogicalIdentity &&
            existingById.id !== existingByLogicalIdentity.id
          ) {
            throw new KnowledgeNodeLogicalConflictError();
          }
          const existing = existingById ?? existingByLogicalIdentity;
          if (existing) {
            assertExactGenerationReplay({
              componentType: "knowledge-node",
              incoming: node,
              logicalKey: knowledgeNodeLogicalIdentity(node),
              persisted: existing,
            });
            persisted.push(existing);
            continue;
          }
        }
        if (next.has(node.id)) {
          throw new KnowledgeNodeOwnershipConflictError(node.id);
        }
        if (findKnowledgeNodeByLogicalIdentity(next.values(), node)) {
          throw new KnowledgeNodeLogicalConflictError();
        }
        next.set(node.id, cloneKnowledgeNode(node));
        persisted.push(node);
      }

      if (next.size > maxNodes) {
        throw new KnowledgeNodeCapacityExceededError(maxNodes);
      }

      nodes.clear();
      for (const [id, node] of next) {
        nodes.set(id, node);
      }

      return persisted.map(cloneKnowledgeNode);
    },
    upsertGenerationAtomically: async (input) => {
      validateKnowledgeNodeGenerationBatch(input);
      return upsertAtomically(input);
    },
    upsertMany: async (input) => {
      validateKnowledgeNodeBatch(input, maxBatchSize);
      return upsertAtomically(input);
    },
    deleteByDocumentAsset: async ({ documentAssetId, knowledgeSpaceId, maxNodes }) => {
      if (!Number.isInteger(maxNodes) || maxNodes < 1) {
        throw new Error("Knowledge node delete maxNodes must be at least 1");
      }

      // Deleting a source document is a physical cascade, so it intentionally removes its legacy,
      // active, candidate, and retained historical node generations together.
      const selected = Array.from(nodes.values())
        .filter((node) => node.knowledgeSpaceId === knowledgeSpaceId)
        .filter((node) => node.documentAssetId === documentAssetId)
        .slice(0, maxNodes + 1);

      if (selected.length > maxNodes) {
        throw new Error(`Knowledge node delete maxNodes=${maxNodes} exceeded`);
      }

      for (const node of selected) {
        if (node.publicationGenerationId) {
          await assertInMemoryGenerationNotPublished({
            componentKey: node.id,
            componentType: "knowledge-node",
            guard: publishedGenerationGuard,
            knowledgeSpaceId: node.knowledgeSpaceId,
            publicationGenerationId: node.publicationGenerationId,
          });
        }
      }

      for (const node of selected) {
        nodes.delete(node.id);
      }

      return {
        deleted: selected.length,
        nodeIds: selected.map((node) => node.id),
      };
    },
    get: async ({ id, knowledgeSpaceId, publicationGenerationId }) => {
      const generation = normalizeKnowledgeNodeGeneration(publicationGenerationId);
      const node = nodes.get(id);

      return node &&
        node.knowledgeSpaceId === knowledgeSpaceId &&
        hasKnowledgeNodeGeneration(node, generation)
        ? cloneKnowledgeNode(node)
        : null;
    },
    getGenerationReceipt: async (input) => {
      const normalized = normalizeKnowledgeNodeGenerationReceiptLookup(input);
      const receipt = generationReceipts.get(knowledgeNodeGenerationReceiptKey(normalized));
      return receipt ? cloneKnowledgeNodeGenerationReceipt(receipt) : null;
    },
    getMany: async ({ ids, knowledgeSpaceId, publicationGenerationId }) => {
      validateKnowledgeNodeBatchIds(ids, maxBatchSize);
      const generation = normalizeKnowledgeNodeGeneration(publicationGenerationId);
      const uniqueIds = uniqueStrings(ids);

      return uniqueIds
        .map((id) => nodes.get(id))
        .filter((node): node is KnowledgeNode =>
          Boolean(
            node &&
              node.knowledgeSpaceId === knowledgeSpaceId &&
              hasKnowledgeNodeGeneration(node, generation),
          ),
        )
        .map(cloneKnowledgeNode);
    },
    getManyByIdsAcrossGenerations: async ({ ids, knowledgeSpaceId }) => {
      validateKnowledgeNodeBatchIds(ids, maxBatchSize);
      const uniqueIds = uniqueStrings(ids);

      return uniqueIds
        .map((id) => nodes.get(id))
        .filter((node): node is KnowledgeNode =>
          Boolean(node && node.knowledgeSpaceId === knowledgeSpaceId),
        )
        .map(cloneKnowledgeNode);
    },
    updateMetadataMany: async ({ knowledgeSpaceId, patches, publicationGenerationId }) => {
      validateKnowledgeNodeMetadataPatches(patches, maxBatchSize);
      const generation = normalizeKnowledgeNodeGeneration(publicationGenerationId);
      const updated: KnowledgeNode[] = [];

      if (generation) {
        await assertInMemoryGenerationNotPublished({
          componentType: "knowledge-node",
          guard: publishedGenerationGuard,
          knowledgeSpaceId,
          publicationGenerationId: generation,
        });
      }

      for (const patch of patches) {
        const existing = nodes.get(patch.id);

        if (
          !existing ||
          existing.knowledgeSpaceId !== knowledgeSpaceId ||
          !hasKnowledgeNodeGeneration(existing, generation)
        ) {
          continue;
        }

        const node = KnowledgeNodeSchema.parse({
          ...existing,
          metadata: cloneJsonObject(patch.metadata),
        });
        nodes.set(node.id, cloneKnowledgeNode(node));
        updated.push(cloneKnowledgeNode(node));
      }

      return updated;
    },
    listByArtifact: async (input) => {
      validateKnowledgeNodeListLimit(input.limit, maxListLimit);
      const generation = normalizeKnowledgeNodeGeneration(input.publicationGenerationId);
      const rows = Array.from(nodes.values())
        .filter((node) => node.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter((node) => node.parseArtifactId === input.parseArtifactId)
        .filter((node) => hasKnowledgeNodeGeneration(node, generation))
        .filter((node) => isKnowledgeNodeAfterCursor(node, input.cursor))
        .sort(compareKnowledgeNodesByArtifactOffset);
      const page = rows.slice(0, input.limit + 1);
      const items = page.slice(0, input.limit).map(cloneKnowledgeNode);
      const lastItem = items.at(-1);
      const nextCursor =
        page.length > input.limit && lastItem ? knowledgeNodeCursor(lastItem) : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    listIdsByDocumentAsset: async (input) => {
      validateKnowledgeNodeDocumentBound(input, "list");
      const selected = Array.from(nodes.values())
        .filter((node) => node.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter((node) => node.documentAssetId === input.documentAssetId)
        .sort(compareKnowledgeNodesById)
        .slice(0, input.maxNodes + 1);
      if (selected.length > input.maxNodes) {
        throw new Error(`Knowledge node list maxNodes=${input.maxNodes} exceeded for document`);
      }

      return selected.map((node) => node.id);
    },
    listBySpace: async (input) => {
      validateKnowledgeNodeListLimit(input.limit, maxListLimit);
      const generation = normalizeKnowledgeNodeGeneration(input.publicationGenerationId);
      const rows = Array.from(nodes.values())
        .filter((node) => node.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter((node) => hasKnowledgeNodeGeneration(node, generation))
        .filter((node) => !input.cursor || node.id > input.cursor.id)
        .sort(compareKnowledgeNodesById);
      const page = rows.slice(0, input.limit + 1);
      const items = page.slice(0, input.limit).map(cloneKnowledgeNode);
      const lastItem = items.at(-1);
      const nextCursor = page.length > input.limit && lastItem ? { id: lastItem.id } : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
  };
}

export function createDatabaseKnowledgeNodeRepository({
  database,
  maxBatchSize,
  maxListLimit,
}: DatabaseKnowledgeNodeRepositoryOptions): KnowledgeNodeRepository {
  validateKnowledgeNodeRepositoryBounds({
    maxBatchSize,
    maxListLimit,
    maxNodes: Number.MAX_SAFE_INTEGER,
  });
  const tableName = "knowledge_nodes";
  const receiptTableName = "knowledge_node_generation_receipts";

  return {
    completeGenerationAtomically: async (input) => {
      const receipt = validateKnowledgeNodeGenerationCompletion(input);
      const parsedNodes = input.nodes.map((node) =>
        cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)),
      );
      validateKnowledgeNodeLogicalBatch(parsedNodes);

      return database.transaction(async (transaction) => {
        const persisted: KnowledgeNode[] = [];
        for (const batch of chunkKnowledgeNodeBatch(parsedNodes, maxBatchSize)) {
          persisted.push(
            ...(await databaseWriteKnowledgeNodeGroups({
              database,
              executor: transaction,
              legacyMode: "upsert",
              nodes: batch,
              tableName,
            })),
          );
        }
        const persistedReceipt = await databaseWriteKnowledgeNodeGenerationReceipt({
          database,
          executor: transaction,
          receipt,
          tableName: receiptTableName,
        });
        return { nodes: persisted, receipt: persistedReceipt };
      });
    },
    createMany: async (input) => {
      validateKnowledgeNodeBatch(input, maxBatchSize);
      const nodes = input.map((node) => cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)));
      validateKnowledgeNodeLogicalBatch(nodes);
      if (nodes.every((node) => !node.publicationGenerationId)) {
        return databaseWriteKnowledgeNodeGroups({
          database,
          executor: database,
          legacyMode: "create",
          nodes,
          tableName,
        });
      }
      return database.transaction((transaction) =>
        databaseWriteKnowledgeNodeGroups({
          database,
          executor: transaction,
          legacyMode: "create",
          nodes,
          tableName,
        }),
      );
    },
    upsertGenerationAtomically: async (input) => {
      validateKnowledgeNodeGenerationBatch(input);
      const nodes = input.map((node) => cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)));
      validateKnowledgeNodeLogicalBatch(nodes);

      return database.transaction(async (transaction) => {
        const persisted: KnowledgeNode[] = [];
        for (const batch of chunkKnowledgeNodeBatch(nodes, maxBatchSize)) {
          persisted.push(
            ...(await databaseWriteKnowledgeNodeGroups({
              database,
              executor: transaction,
              legacyMode: "upsert",
              nodes: batch,
              tableName,
            })),
          );
        }
        return persisted;
      });
    },
    upsertMany: async (input) => {
      validateKnowledgeNodeBatch(input, maxBatchSize);
      const nodes = input.map((node) => cloneKnowledgeNode(KnowledgeNodeSchema.parse(node)));
      validateKnowledgeNodeLogicalBatch(nodes);
      if (nodes.every((node) => !node.publicationGenerationId)) {
        return databaseWriteKnowledgeNodeGroups({
          database,
          executor: database,
          legacyMode: "upsert",
          nodes,
          tableName,
        });
      }
      return database.transaction((transaction) =>
        databaseWriteKnowledgeNodeGroups({
          database,
          executor: transaction,
          legacyMode: "upsert",
          nodes,
          tableName,
        }),
      );
    },
    deleteByDocumentAsset: async ({ documentAssetId, knowledgeSpaceId, maxNodes }) => {
      if (!Number.isInteger(maxNodes) || maxNodes < 1) {
        throw new Error("Knowledge node delete maxNodes must be at least 1");
      }

      // A source-document deletion is a physical cascade and intentionally spans every retained
      // generation. All ordinary reads and metadata mutations remain generation-scoped.
      return database.transaction(async (transaction) => {
        const selected = await transaction.execute({
          maxRows: maxNodes + 1,
          operation: "select",
          params: [knowledgeSpaceId, documentAssetId],
          sql: `SELECT ${quoteDatabaseIdentifier(database, "id")}, ${quoteDatabaseIdentifier(
            database,
            "publication_generation_id",
          )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "document_asset_id",
          )} = ${databasePlaceholder(database, 2)} LIMIT ${maxNodes + 1} FOR UPDATE;`,
          tableName,
        });
        const nodeIds = selected.rows.map((row) => stringColumn(row, "id"));

        if (nodeIds.length > maxNodes) {
          throw new Error(`Knowledge node delete maxNodes=${maxNodes} exceeded`);
        }

        for (const generation of new Set(
          selected.rows.flatMap((row) => {
            const value = optionalStringColumn(row, "publication_generation_id");
            return value ? [value] : [];
          }),
        )) {
          await assertDatabaseGenerationNotPublished({
            componentType: "knowledge-node",
            database,
            executor: transaction,
            knowledgeSpaceId,
            publicationGenerationId: generation,
          });
        }

        if (nodeIds.length === 0) {
          return { deleted: 0, nodeIds: [] };
        }

        const params = [knowledgeSpaceId, ...nodeIds] satisfies readonly DatabaseQueryValue[];
        const idPlaceholders = nodeIds
          .map((_, index) => databasePlaceholder(database, index + 2))
          .join(", ");
        const deleted = await transaction.execute({
          maxRows: nodeIds.length,
          operation: "delete",
          params,
          sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (${idPlaceholders});`,
          tableName,
        });

        return { deleted: deleted.rowsAffected, nodeIds };
      });
    },
    get: async ({ id, knowledgeSpaceId, publicationGenerationId }) => {
      const params: DatabaseQueryValue[] = [knowledgeSpaceId, id];
      const generationSql = knowledgeNodeGenerationPredicate(
        database,
        params,
        publicationGenerationId,
      );
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${databasePlaceholder(database, 2)} AND ${generationSql} LIMIT 1;`,
        tableName,
      });

      return result.rows[0] ? mapKnowledgeNodeRow(result.rows[0]) : null;
    },
    getGenerationReceipt: async (input) => {
      const normalized = normalizeKnowledgeNodeGenerationReceiptLookup(input);
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [
          normalized.knowledgeSpaceId,
          normalized.publicationGenerationId,
          normalized.parseArtifactId,
        ],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, receiptTableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "parse_artifact_id",
        )} = ${databasePlaceholder(database, 3)} LIMIT 1;`,
        tableName: receiptTableName,
      });
      return result.rows[0] ? mapKnowledgeNodeGenerationReceiptRow(result.rows[0]) : null;
    },
    getMany: async ({ ids, knowledgeSpaceId, publicationGenerationId }) => {
      return databaseKnowledgeNodeGetMany(database, tableName, maxBatchSize, {
        ids,
        knowledgeSpaceId,
        ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
      });
    },
    getManyByIdsAcrossGenerations: async ({ ids, knowledgeSpaceId }) => {
      return databaseKnowledgeNodeGetMany(
        database,
        tableName,
        maxBatchSize,
        { ids, knowledgeSpaceId },
        database,
        true,
      );
    },
    updateMetadataMany: async ({ knowledgeSpaceId, patches, publicationGenerationId }) => {
      validateKnowledgeNodeMetadataPatches(patches, maxBatchSize);
      const update = (executor: DatabaseExecutor) =>
        databaseUpdateKnowledgeNodeMetadata({
          database,
          executor,
          knowledgeSpaceId,
          maxBatchSize,
          patches,
          publicationGenerationId,
          tableName,
        });

      if (!publicationGenerationId) {
        return update(database);
      }

      return database.transaction(async (transaction) => {
        const ids = uniqueStrings(patches.map((patch) => patch.id));
        const params: DatabaseQueryValue[] = [knowledgeSpaceId, ...ids];
        const generationSql = knowledgeNodeGenerationPredicate(
          database,
          params,
          publicationGenerationId,
        );
        await transaction.execute({
          maxRows: ids.length,
          operation: "select",
          params,
          sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
            database,
            tableName,
          )} WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
            database,
            1,
          )} AND ${quoteDatabaseIdentifier(database, "id")} IN (${ids
            .map((_, index) => databasePlaceholder(database, index + 2))
            .join(", ")}) AND ${generationSql} FOR UPDATE;`,
          tableName,
        });
        await assertDatabaseGenerationNotPublished({
          componentType: "knowledge-node",
          database,
          executor: transaction,
          knowledgeSpaceId,
          publicationGenerationId,
        });

        return update(transaction);
      });
    },
    listByArtifact: async ({
      cursor,
      knowledgeSpaceId,
      limit,
      parseArtifactId,
      publicationGenerationId,
    }) => {
      validateKnowledgeNodeListLimit(limit, maxListLimit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [knowledgeSpaceId, parseArtifactId];
      const generationSql = knowledgeNodeGenerationPredicate(
        database,
        params,
        publicationGenerationId,
      );
      let cursorSql = "";
      if (cursor) {
        params.push(cursor.startOffset, cursor.id);
        const offsetPosition = params.length - 1;
        const idPosition = params.length;
        cursorSql = ` AND (${quoteDatabaseIdentifier(
          database,
          "start_offset",
        )} > ${databasePlaceholder(database, offsetPosition)} OR (${quoteDatabaseIdentifier(
          database,
          "start_offset",
        )} = ${databasePlaceholder(database, offsetPosition)} AND ${quoteDatabaseIdentifier(
          database,
          "id",
        )} > ${databasePlaceholder(database, idPosition)}))`;
      }
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
          "parse_artifact_id",
        )} = ${databasePlaceholder(database, 2)} AND ${generationSql}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "start_offset",
        )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
          database,
          params.length,
        )};`,
        tableName,
      });
      const rows = result.rows.map(mapKnowledgeNodeRow);
      const items = rows.slice(0, limit).map(cloneKnowledgeNode);
      const lastItem = items.at(-1);
      const nextCursor =
        rows.length > limit && lastItem ? knowledgeNodeCursor(lastItem) : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    listIdsByDocumentAsset: async (input) => {
      validateKnowledgeNodeDocumentBound(input, "list");
      const result = await database.execute({
        maxRows: input.maxNodes + 1,
        operation: "select",
        params: [input.knowledgeSpaceId, input.documentAssetId],
        sql: `SELECT ${quoteDatabaseIdentifier(
          database,
          "id",
        )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 2)} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "id",
        )} ASC LIMIT ${input.maxNodes + 1};`,
        tableName,
      });
      if (result.rows.length > input.maxNodes) {
        throw new Error(`Knowledge node list maxNodes=${input.maxNodes} exceeded for document`);
      }

      return result.rows.map((row) => stringColumn(row, "id"));
    },
    listBySpace: async ({ cursor, knowledgeSpaceId, limit, publicationGenerationId }) => {
      validateKnowledgeNodeListLimit(limit, maxListLimit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [knowledgeSpaceId];
      const generationSql = knowledgeNodeGenerationPredicate(
        database,
        params,
        publicationGenerationId,
      );
      let cursorSql = "";
      if (cursor) {
        params.push(cursor.id);
        cursorSql = ` AND ${quoteDatabaseIdentifier(database, "id")} > ${databasePlaceholder(
          database,
          params.length,
        )}`;
      }
      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${generationSql}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "id",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapKnowledgeNodeRow);
      const items = rows.slice(0, limit).map(cloneKnowledgeNode);
      const lastItem = items.at(-1);
      const nextCursor = rows.length > limit && lastItem ? { id: lastItem.id } : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
  };
}

export function cloneKnowledgeNode(node: KnowledgeNode): KnowledgeNode {
  return KnowledgeNodeSchema.parse(JSON.parse(JSON.stringify(node)) as unknown);
}

export function knowledgeNodeCursor(node: KnowledgeNode): KnowledgeNodeCursor {
  return {
    id: node.id,
    startOffset: node.startOffset,
  };
}

function validateKnowledgeNodeGenerationCompletion({
  nodes,
  receipt: inputReceipt,
}: CompleteKnowledgeNodeGenerationInput): KnowledgeNodeGenerationReceipt {
  const receipt = validateKnowledgeNodeGenerationReceipt(inputReceipt);
  if (nodes.length !== receipt.storedNodeCount) {
    throw new Error("Knowledge node generation receipt storedNodeCount does not match nodes");
  }
  const expectedIndexes = Array.from(
    { length: receipt.documentChunkCount },
    (_, index) => index,
  ).filter((index) => !receipt.excludedNodeOrdinals.includes(index));
  const actualIndexes: number[] = [];
  for (const candidate of nodes) {
    const node = KnowledgeNodeSchema.parse(candidate);
    if (
      node.knowledgeSpaceId !== receipt.knowledgeSpaceId ||
      node.documentAssetId !== receipt.documentAssetId ||
      node.parseArtifactId !== receipt.parseArtifactId ||
      node.publicationGenerationId !== receipt.publicationGenerationId ||
      node.artifactHash !== receipt.artifactHash ||
      !Number.isSafeInteger(node.metadata.chunkIndex)
    ) {
      throw new Error("Knowledge node generation receipt identity does not match nodes");
    }
    actualIndexes.push(node.metadata.chunkIndex as number);
  }
  actualIndexes.sort((left, right) => left - right);
  if (stableJson(actualIndexes) !== stableJson(expectedIndexes)) {
    throw new Error("Knowledge node generation receipt chunk indexes do not match nodes");
  }
  return receipt;
}

function validateKnowledgeNodeGenerationReceipt(
  input: KnowledgeNodeGenerationReceipt,
): KnowledgeNodeGenerationReceipt {
  assertKnowledgeNodeGenerationReceiptSize(input);
  const knowledgeSpaceId = UuidSchema.parse(input.knowledgeSpaceId);
  const publicationGenerationId = PublicationGenerationIdSchema.parse(
    input.publicationGenerationId,
  );
  const parseArtifactId = UuidSchema.parse(input.parseArtifactId);
  const documentAssetId = UuidSchema.parse(input.documentAssetId);
  if (input.schemaVersion !== 1) {
    throw new Error("Knowledge node generation receipt schemaVersion must be 1");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.artifactHash)) {
    throw new Error("Knowledge node generation receipt artifactHash is invalid");
  }
  const semanticConfig = input.semanticConfig;
  for (const [name, value] of [
    ["maxChunkChars", semanticConfig.maxChunkChars],
    ["maxNodes", semanticConfig.maxNodes],
    ["maxWindowChars", semanticConfig.maxWindowChars],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Knowledge node generation receipt ${name} must be at least 1`);
    }
  }
  if (
    !Number.isSafeInteger(semanticConfig.overlapChars) ||
    semanticConfig.overlapChars < 0 ||
    semanticConfig.overlapChars >= semanticConfig.maxChunkChars
  ) {
    throw new Error("Knowledge node generation receipt overlapChars is invalid");
  }
  if (
    semanticConfig.maxWindowChars < semanticConfig.maxChunkChars ||
    !semanticConfig.promptVersion.trim()
  ) {
    throw new Error("Knowledge node generation receipt semantic config is invalid");
  }
  if (
    !Number.isSafeInteger(input.documentChunkCount) ||
    input.documentChunkCount < 0 ||
    input.documentChunkCount > semanticConfig.maxNodes ||
    !Number.isSafeInteger(input.storedNodeCount) ||
    input.storedNodeCount < 0 ||
    input.storedNodeCount > input.documentChunkCount
  ) {
    throw new Error("Knowledge node generation receipt node counts are invalid");
  }
  const excludedNodeOrdinals = [...input.excludedNodeOrdinals];
  if (
    excludedNodeOrdinals.some(
      (ordinal) =>
        !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= input.documentChunkCount,
    ) ||
    excludedNodeOrdinals.some((ordinal, index) => {
      const previous = excludedNodeOrdinals[index - 1];
      return previous !== undefined && ordinal <= previous;
    }) ||
    input.storedNodeCount !== input.documentChunkCount - excludedNodeOrdinals.length
  ) {
    throw new Error("Knowledge node generation receipt exclusions are invalid");
  }
  for (const fingerprint of [
    input.promptResponseFingerprint,
    input.requestFingerprint,
    input.responseFingerprint,
    input.storedResponseFingerprint,
  ]) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(fingerprint)) {
      throw new Error("Knowledge node generation receipt fingerprint is invalid");
    }
  }
  const permissionScope = [...input.permissionScope];
  if (permissionScope.some((scope) => typeof scope !== "string" || !scope.trim())) {
    throw new Error("Knowledge node generation receipt permissionScope is invalid");
  }
  if (input.language !== undefined && !input.language.trim()) {
    throw new Error("Knowledge node generation receipt language is invalid");
  }
  const modelSelection = KnowledgeSpaceModelSelectionSchema.parse(input.modelSelection);
  const completionCatalog = validateKnowledgeNodeGenerationCompletionCatalog(
    input.completionCatalog,
  );
  const windowManifest = validateKnowledgeNodeGenerationWindowManifest(
    input.windowManifest,
    input.documentChunkCount,
    semanticConfig.maxNodes,
    completionCatalog.length,
  );
  const receipt: KnowledgeNodeGenerationReceipt = {
    artifactHash: input.artifactHash,
    completionCatalog,
    documentAssetId,
    documentChunkCount: input.documentChunkCount,
    excludedNodeOrdinals,
    knowledgeSpaceId,
    ...(input.language === undefined ? {} : { language: input.language }),
    modelSelection,
    parseArtifactId,
    permissionScope,
    promptResponseFingerprint: input.promptResponseFingerprint,
    publicationGenerationId,
    requestFingerprint: input.requestFingerprint,
    responseFingerprint: input.responseFingerprint,
    schemaVersion: 1,
    semanticConfig: {
      maxChunkChars: semanticConfig.maxChunkChars,
      maxNodes: semanticConfig.maxNodes,
      maxWindowChars: semanticConfig.maxWindowChars,
      overlapChars: semanticConfig.overlapChars,
      promptVersion: semanticConfig.promptVersion,
    },
    storedNodeCount: input.storedNodeCount,
    storedResponseFingerprint: input.storedResponseFingerprint,
    windowManifest,
  };
  assertKnowledgeNodeGenerationReceiptSize(receipt);
  return receipt;
}

function validateKnowledgeNodeGenerationCompletionCatalog(
  input: readonly KnowledgeNodeGenerationCompletionReceipt[],
): KnowledgeNodeGenerationCompletionReceipt[] {
  if (!Array.isArray(input) || input.length > MAX_LLM_SEMANTIC_COMPLETION_IDENTITIES) {
    throw new Error("Knowledge node generation receipt completion catalog is invalid");
  }
  const fingerprints = new Set<string>();
  const identities = new Set<string>();
  return input.map((candidate) => {
    if (!isPlainObject(candidate)) {
      throw new Error("Knowledge node generation receipt completion identity is invalid");
    }
    const actualModel = optionalBoundedReceiptString(
      candidate.actualModel,
      "actualModel",
      MAX_LLM_SEMANTIC_TERMINAL_IDENTITY_CODE_POINTS,
    );
    const actualProvider = optionalBoundedReceiptString(
      candidate.actualProvider,
      "actualProvider",
      MAX_LLM_SEMANTIC_TERMINAL_IDENTITY_CODE_POINTS,
    );
    const finishReason = optionalBoundedReceiptString(
      candidate.finishReason,
      "finishReason",
      MAX_LLM_SEMANTIC_FINISH_REASON_CODE_POINTS,
    );
    const transportProvider = optionalBoundedReceiptString(
      candidate.transportProvider,
      "transportProvider",
      MAX_LLM_SEMANTIC_TERMINAL_IDENTITY_CODE_POINTS,
    );
    const identity = {
      ...(actualModel ? { actualModel } : {}),
      ...(actualProvider ? { actualProvider } : {}),
      ...(finishReason ? { finishReason } : {}),
      ...(transportProvider ? { transportProvider } : {}),
    };
    const fingerprint = llmSemanticCompletionFingerprint(identity);
    if (
      candidate.fingerprint !== fingerprint ||
      fingerprints.has(fingerprint) ||
      identities.has(stableJson(identity))
    ) {
      throw new Error("Knowledge node generation receipt completion identity is invalid");
    }
    fingerprints.add(fingerprint);
    identities.add(stableJson(identity));
    return { fingerprint, ...identity };
  });
}

function validateKnowledgeNodeGenerationWindowManifest(
  input: readonly KnowledgeNodeGenerationWindowReceipt[],
  documentChunkCount: number,
  maxNodes: number,
  completionCatalogLength: number,
): KnowledgeNodeGenerationWindowReceipt[] {
  if (
    !Array.isArray(input) ||
    input.length > maxNodes ||
    input.length > MAX_LLM_SEMANTIC_WINDOWS ||
    (documentChunkCount > 0 && input.length === 0) ||
    (documentChunkCount === 0 && input.length > 0) ||
    (input.length > 0 && completionCatalogLength === 0) ||
    completionCatalogLength > input.length
  ) {
    throw new Error("Knowledge node generation receipt window manifest is incomplete");
  }
  const windowIds = new Set<string>();
  let nextChunkIndex = 0;
  const windows = input.map((window, windowIndex) => {
    if (window === null || typeof window !== "object" || Array.isArray(window)) {
      throw new Error("Knowledge node generation receipt window manifest is invalid");
    }
    if (
      !isValidReceiptWindowId(window.windowId) ||
      window.windowId !== `window-${windowIndex.toString().padStart(6, "0")}` ||
      windowIds.has(window.windowId) ||
      !/^sha256:[a-f0-9]{64}$/u.test(window.inputFingerprint) ||
      !/^sha256:[a-f0-9]{64}$/u.test(window.responseFingerprint) ||
      !Number.isSafeInteger(window.completionIndex) ||
      window.completionIndex < 0 ||
      window.completionIndex >= completionCatalogLength ||
      !Number.isSafeInteger(window.firstChunkIndex) ||
      window.firstChunkIndex !== nextChunkIndex ||
      !Array.isArray(window.chunkRanges) ||
      window.chunkRanges.length < 1 ||
      window.chunkRanges.length > maxNodes
    ) {
      throw new Error("Knowledge node generation receipt window manifest is invalid");
    }
    windowIds.add(window.windowId);
    const coreUnitRange = validateKnowledgeNodeGenerationUnitRange(window.coreUnitRange);
    const committedUnitRange = validateKnowledgeNodeGenerationUnitRange(window.committedUnitRange);
    const lookAheadUnitRange =
      window.lookAheadUnitRange === undefined
        ? undefined
        : validateKnowledgeNodeGenerationUnitRange(window.lookAheadUnitRange);
    const chunkRanges = window.chunkRanges.map(validateKnowledgeNodeGenerationUnitRange);
    nextChunkIndex += chunkRanges.length;
    return {
      chunkRanges,
      committedUnitRange,
      completionIndex: window.completionIndex,
      coreUnitRange,
      firstChunkIndex: window.firstChunkIndex,
      inputFingerprint: window.inputFingerprint,
      ...(lookAheadUnitRange ? { lookAheadUnitRange } : {}),
      responseFingerprint: window.responseFingerprint,
      windowId: window.windowId,
    };
  });
  if (nextChunkIndex !== documentChunkCount) {
    throw new Error("Knowledge node generation receipt window chunks do not cover the document");
  }
  return windows;
}

function validateKnowledgeNodeGenerationUnitRange(
  input: KnowledgeNodeGenerationUnitRangeReceipt,
): KnowledgeNodeGenerationUnitRangeReceipt {
  if (!Array.isArray(input) || input.length !== 2 || !input.every(isValidReceiptUnitId)) {
    throw new Error("Knowledge node generation receipt window unit range is invalid");
  }
  return [input[0] as string, input[1] as string];
}

function isValidReceiptWindowId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Array.from(value).length <= MAX_LLM_SEMANTIC_WINDOW_ID_CODE_POINTS &&
    /^window-\d{6,}$/u.test(value)
  );
}

function isValidReceiptUnitId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Array.from(value).length <= MAX_LLM_SEMANTIC_UNIT_ID_CODE_POINTS &&
    /^u-\d{6,}-\d{6,}$/u.test(value)
  );
}

function optionalBoundedReceiptString(
  value: unknown,
  name: string,
  maxCodePoints: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > maxCodePoints) {
    throw new Error(`Knowledge node generation receipt ${name} is invalid`);
  }
  return value.trim();
}

function assertKnowledgeNodeGenerationReceiptSize(value: unknown): void {
  if (
    knowledgeNodeGenerationReceiptSerializedBytes(value) >
    MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES
  ) {
    throw new Error(
      `Knowledge node generation receipt exceeds maxBytes=${MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES}`,
    );
  }
}

function normalizeKnowledgeNodeGenerationReceiptLookup(
  input: KnowledgeNodeGenerationReceiptLookupInput,
): KnowledgeNodeGenerationReceiptLookupInput {
  return {
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    parseArtifactId: UuidSchema.parse(input.parseArtifactId),
    publicationGenerationId: PublicationGenerationIdSchema.parse(input.publicationGenerationId),
  };
}

function knowledgeNodeGenerationReceiptKey(
  input: KnowledgeNodeGenerationReceiptLookupInput,
): string {
  return stableJson([input.knowledgeSpaceId, input.publicationGenerationId, input.parseArtifactId]);
}

function cloneKnowledgeNodeGenerationReceipt(
  receipt: KnowledgeNodeGenerationReceipt,
): KnowledgeNodeGenerationReceipt {
  return validateKnowledgeNodeGenerationReceipt(
    JSON.parse(JSON.stringify(receipt)) as KnowledgeNodeGenerationReceipt,
  );
}

async function databaseWriteKnowledgeNodeGenerationReceipt({
  database,
  executor,
  receipt,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly receipt: KnowledgeNodeGenerationReceipt;
  readonly tableName: string;
}): Promise<KnowledgeNodeGenerationReceipt> {
  const columns = [
    "knowledge_space_id",
    "publication_generation_id",
    "parse_artifact_id",
    "document_asset_id",
    "artifact_hash",
    "document_chunk_count",
    "stored_node_count",
    "request_fingerprint",
    "response_fingerprint",
    "prompt_response_fingerprint",
    "receipt",
  ] as const;
  const params: readonly DatabaseQueryValue[] = [
    receipt.knowledgeSpaceId,
    receipt.publicationGenerationId,
    receipt.parseArtifactId,
    receipt.documentAssetId,
    receipt.artifactHash,
    receipt.documentChunkCount,
    receipt.storedNodeCount,
    receipt.requestFingerprint,
    receipt.responseFingerprint,
    receipt.promptResponseFingerprint,
    JSON.stringify(receipt),
  ];
  const conflictSql =
    database.dialect === "postgres"
      ? " ON CONFLICT DO NOTHING RETURNING *"
      : ` ON DUPLICATE KEY UPDATE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${quoteDatabaseIdentifier(database, "knowledge_space_id")}`;
  const inserted = await executor.execute({
    maxRows: 1,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES (${columns
      .map((_, index) =>
        index === columns.length - 1
          ? jsonInsertPlaceholder(database, index + 1, "receipt")
          : databasePlaceholder(database, index + 1),
      )
      .join(", ")})${conflictSql};`,
    tableName,
  });
  const row =
    inserted.rows[0] ??
    (
      await executor.execute({
        maxRows: 1,
        operation: "select",
        params: [
          receipt.knowledgeSpaceId,
          receipt.publicationGenerationId,
          receipt.parseArtifactId,
        ],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "parse_artifact_id",
        )} = ${databasePlaceholder(database, 3)} LIMIT 1;`,
        tableName,
      })
    ).rows[0];
  if (!row) {
    throw new Error("Knowledge node generation receipt was not persisted");
  }
  const persisted = mapKnowledgeNodeGenerationReceiptRow(row);
  if (stableJson(persisted) !== stableJson(receipt)) {
    throw new KnowledgeNodeGenerationReceiptConflictError();
  }
  return persisted;
}

function mapKnowledgeNodeGenerationReceiptRow(row: DatabaseRow): KnowledgeNodeGenerationReceipt {
  const receipt = validateKnowledgeNodeGenerationReceipt(
    jsonObjectColumn(row, "receipt") as unknown as KnowledgeNodeGenerationReceipt,
  );
  if (
    stringColumn(row, "knowledge_space_id") !== receipt.knowledgeSpaceId ||
    stringColumn(row, "publication_generation_id") !== receipt.publicationGenerationId ||
    stringColumn(row, "parse_artifact_id") !== receipt.parseArtifactId ||
    stringColumn(row, "document_asset_id") !== receipt.documentAssetId ||
    stringColumn(row, "artifact_hash") !== receipt.artifactHash ||
    numberColumn(row, "document_chunk_count") !== receipt.documentChunkCount ||
    numberColumn(row, "stored_node_count") !== receipt.storedNodeCount ||
    stringColumn(row, "request_fingerprint") !== receipt.requestFingerprint ||
    stringColumn(row, "response_fingerprint") !== receipt.responseFingerprint ||
    stringColumn(row, "prompt_response_fingerprint") !== receipt.promptResponseFingerprint
  ) {
    throw new KnowledgeNodeGenerationReceiptConflictError();
  }
  return receipt;
}

async function databaseWriteKnowledgeNodeGroups({
  database,
  executor,
  legacyMode,
  nodes,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly legacyMode: "create" | "upsert";
  readonly nodes: readonly KnowledgeNode[];
  readonly tableName: string;
}): Promise<KnowledgeNode[]> {
  const legacy = nodes.filter((node) => !node.publicationGenerationId);
  const immutable = nodes.filter((node) => Boolean(node.publicationGenerationId));
  const persistedLegacy = await databaseWriteKnowledgeNodes({
    database,
    executor,
    mode: legacyMode,
    nodes: legacy,
    tableName,
  });
  const persistedImmutable = await databaseWriteKnowledgeNodes({
    database,
    executor,
    mode: "immutable",
    nodes: immutable,
    tableName,
  });
  const byIdentity = new Map(
    [...persistedLegacy, ...persistedImmutable].map((node) => [
      knowledgeNodeLogicalIdentity(node),
      node,
    ]),
  );

  return nodes.map((node) => {
    const persisted = byIdentity.get(knowledgeNodeLogicalIdentity(node));
    if (!persisted) {
      throw new KnowledgeNodeOwnershipConflictError(node.id);
    }
    return cloneKnowledgeNode(persisted);
  });
}

async function databaseWriteKnowledgeNodes({
  database,
  executor,
  mode,
  nodes,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly mode: "create" | "immutable" | "upsert";
  readonly nodes: readonly KnowledgeNode[];
  readonly tableName: string;
}): Promise<KnowledgeNode[]> {
  if (nodes.length === 0) {
    return [];
  }
  const columns = knowledgeNodeColumns();
  const params = knowledgeNodeParams(nodes);
  const values = knowledgeNodeValuesSql(database, columns, nodes.length);
  const generationColumn = quoteDatabaseIdentifier(database, "publication_generation_id");
  const postgresConflictTarget = [
    quoteDatabaseIdentifier(database, "knowledge_space_id"),
    quoteDatabaseIdentifier(database, "parse_artifact_id"),
    quoteDatabaseIdentifier(database, "kind"),
    quoteDatabaseIdentifier(database, "start_offset"),
    quoteDatabaseIdentifier(database, "end_offset"),
    `(COALESCE(${generationColumn}, '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid))`,
  ].join(", ");
  const mutableColumns = [
    "text",
    "source_location",
    "permission_scope",
    "artifact_hash",
    "metadata",
    "updated_at",
  ] as const;
  const tidbOwnershipGuard = [
    "knowledge_space_id",
    "document_asset_id",
    "parse_artifact_id",
    "kind",
    "start_offset",
    "end_offset",
  ]
    .map((column) => {
      const quoted = quoteDatabaseIdentifier(database, column);
      return `${quoted} = VALUES(${quoted})`;
    })
    .concat(`${generationColumn} <=> VALUES(${generationColumn})`)
    .join(" AND ");
  const suffix =
    mode === "create"
      ? database.dialect === "postgres"
        ? " RETURNING *"
        : ""
      : mode === "immutable"
        ? database.dialect === "postgres"
          ? " ON CONFLICT DO NOTHING RETURNING *"
          : ` ON DUPLICATE KEY UPDATE ${quoteDatabaseIdentifier(
              database,
              "id",
            )} = ${quoteDatabaseIdentifier(database, "id")}`
        : database.dialect === "postgres"
          ? ` ON CONFLICT (${postgresConflictTarget}) DO UPDATE SET ${mutableColumns
              .map(
                (column) =>
                  `${quoteDatabaseIdentifier(database, column)} = EXCLUDED.${quoteDatabaseIdentifier(
                    database,
                    column,
                  )}`,
              )
              .join(", ")} WHERE ${quoteDatabaseIdentifier(
              database,
              tableName,
            )}.${quoteDatabaseIdentifier(
              database,
              "document_asset_id",
            )} = EXCLUDED.${quoteDatabaseIdentifier(database, "document_asset_id")} RETURNING *`
          : ` ON DUPLICATE KEY UPDATE ${mutableColumns
              .map((column) => {
                const quoted = quoteDatabaseIdentifier(database, column);
                return `${quoted} = IF(${tidbOwnershipGuard}, VALUES(${quoted}), ${quoted})`;
              })
              .join(", ")}`;
  const result = await executor.execute({
    maxRows: nodes.length,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES ${values}${suffix};`,
    tableName,
  });

  if (mode === "create") {
    return result.rows.length > 0
      ? result.rows.map(mapKnowledgeNodeRow)
      : nodes.map(cloneKnowledgeNode);
  }
  if (mode === "immutable" || database.dialect === "tidb") {
    return databaseKnowledgeNodesGetByLogicalIdentity(
      database,
      executor,
      tableName,
      nodes,
      mode === "immutable",
    );
  }

  return reconcilePersistedKnowledgeNodes(nodes, result.rows.map(mapKnowledgeNodeRow), false);
}

async function databaseUpdateKnowledgeNodeMetadata({
  database,
  executor,
  knowledgeSpaceId,
  maxBatchSize,
  patches,
  publicationGenerationId,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly knowledgeSpaceId: string;
  readonly maxBatchSize: number;
  readonly patches: readonly UpdateKnowledgeNodeMetadataPatch[];
  readonly publicationGenerationId?: string | undefined;
  readonly tableName: string;
}): Promise<KnowledgeNode[]> {
  const params: DatabaseQueryValue[] = [knowledgeSpaceId];
  const generationSql = knowledgeNodeGenerationPredicate(database, params, publicationGenerationId);
  const patchStartPosition = params.length + 1;
  params.push(
    ...patches.flatMap((patch) => [patch.id, JSON.stringify(cloneJsonObject(patch.metadata))]),
  );
  const caseClauses = patches
    .map((_, index) => {
      const idPosition = patchStartPosition + index * 2;
      const metadataPosition = idPosition + 1;

      return `WHEN ${databasePlaceholder(database, idPosition)} THEN ${jsonInsertPlaceholder(
        database,
        metadataPosition,
        "metadata",
      )}`;
    })
    .join(" ");
  const idStartPosition = params.length + 1;
  params.push(...patches.map((patch) => patch.id));
  const idPlaceholders = patches
    .map((_, index) => databasePlaceholder(database, idStartPosition + index))
    .join(", ");

  await executor.execute({
    maxRows: patches.length,
    operation: "update",
    params,
    sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
      database,
      "metadata",
    )} = CASE ${quoteDatabaseIdentifier(database, "id")} ${caseClauses} ELSE ${quoteDatabaseIdentifier(
      database,
      "metadata",
    )} END WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${generationSql} AND ${quoteDatabaseIdentifier(database, "id")} IN (${idPlaceholders});`,
    tableName,
  });

  return databaseKnowledgeNodeGetMany(
    database,
    tableName,
    maxBatchSize,
    {
      ids: patches.map((patch) => patch.id),
      knowledgeSpaceId,
      ...(publicationGenerationId !== undefined ? { publicationGenerationId } : {}),
    },
    executor,
  );
}

async function databaseKnowledgeNodeGetMany(
  database: DatabaseAdapter,
  tableName: string,
  maxBatchSize: number,
  { ids, knowledgeSpaceId, publicationGenerationId }: GetManyKnowledgeNodesInput,
  executor: DatabaseExecutor = database,
  includeAllGenerations = false,
): Promise<KnowledgeNode[]> {
  validateKnowledgeNodeBatchIds(ids, maxBatchSize);
  const uniqueIds = uniqueStrings(ids);

  if (uniqueIds.length === 0) {
    return [];
  }

  const params: DatabaseQueryValue[] = [knowledgeSpaceId, ...uniqueIds];
  const idPlaceholders = uniqueIds
    .map((_, index) => databasePlaceholder(database, index + 2))
    .join(", ");
  const generationSql = includeAllGenerations
    ? undefined
    : knowledgeNodeGenerationPredicate(database, params, publicationGenerationId);
  const result = await executor.execute({
    maxRows: uniqueIds.length,
    operation: "select",
    params,
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "id",
    )} IN (${idPlaceholders})${generationSql ? ` AND ${generationSql}` : ""};`,
    tableName,
  });
  const byId = new Map(result.rows.map((row) => [String(row.id), mapKnowledgeNodeRow(row)]));

  return uniqueIds.flatMap((id) => {
    const node = byId.get(id);

    return node ? [cloneKnowledgeNode(node)] : [];
  });
}

async function databaseKnowledgeNodesGetByLogicalIdentity(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tableName: string,
  nodes: readonly KnowledgeNode[],
  immutable: boolean,
): Promise<KnowledgeNode[]> {
  const params: DatabaseQueryValue[] = [];
  const clauses = nodes.map((node) => {
    params.push(
      node.knowledgeSpaceId,
      node.parseArtifactId,
      node.kind,
      node.startOffset,
      node.endOffset,
    );
    const firstPosition = params.length - 4;
    const generationSql = knowledgeNodeGenerationPredicate(
      database,
      params,
      node.publicationGenerationId,
    );

    return `(${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      firstPosition,
    )} AND ${quoteDatabaseIdentifier(database, "parse_artifact_id")} = ${databasePlaceholder(
      database,
      firstPosition + 1,
    )} AND ${quoteDatabaseIdentifier(database, "kind")} = ${databasePlaceholder(
      database,
      firstPosition + 2,
    )} AND ${quoteDatabaseIdentifier(database, "start_offset")} = ${databasePlaceholder(
      database,
      firstPosition + 3,
    )} AND ${quoteDatabaseIdentifier(database, "end_offset")} = ${databasePlaceholder(
      database,
      firstPosition + 4,
    )} AND ${generationSql})`;
  });
  const result = await executor.execute({
    maxRows: nodes.length,
    operation: "select",
    params,
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${clauses.join(
      " OR ",
    )};`,
    tableName,
  });
  return reconcilePersistedKnowledgeNodes(nodes, result.rows.map(mapKnowledgeNodeRow), immutable);
}

function reconcilePersistedKnowledgeNodes(
  requested: readonly KnowledgeNode[],
  persistedNodes: readonly KnowledgeNode[],
  immutable: boolean,
): KnowledgeNode[] {
  const persistedByLogicalIdentity = new Map(
    persistedNodes.map((node) => [knowledgeNodeLogicalIdentity(node), node] as const),
  );

  return requested.map((node) => {
    const persisted = persistedByLogicalIdentity.get(knowledgeNodeLogicalIdentity(node));
    if (!persisted || !hasSameKnowledgeNodeOwnership(persisted, node)) {
      throw new KnowledgeNodeOwnershipConflictError(node.id);
    }

    if (immutable) {
      assertExactGenerationReplay({
        componentType: "knowledge-node",
        incoming: node,
        logicalKey: knowledgeNodeLogicalIdentity(node),
        persisted,
      });
    }

    return cloneKnowledgeNode(persisted);
  });
}

function knowledgeNodeGenerationPredicate(
  database: DatabaseAdapter,
  params: DatabaseQueryValue[],
  publicationGenerationId: string | undefined,
): string {
  const generationColumn = quoteDatabaseIdentifier(database, "publication_generation_id");
  const generation = normalizeKnowledgeNodeGeneration(publicationGenerationId);

  if (generation === undefined) {
    return `${generationColumn} IS NULL`;
  }

  params.push(generation);
  return `${generationColumn} = ${databasePlaceholder(database, params.length)}`;
}

function knowledgeNodeColumns(): readonly string[] {
  return [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "document_asset_id",
    "parse_artifact_id",
    "kind",
    "text",
    "start_offset",
    "end_offset",
    "source_location",
    "permission_scope",
    "artifact_hash",
    "metadata",
    "updated_at",
  ];
}

function knowledgeNodeParams(nodes: readonly KnowledgeNode[]): readonly DatabaseQueryValue[] {
  return nodes.flatMap((node) => [
    node.id,
    node.knowledgeSpaceId,
    node.publicationGenerationId ?? null,
    node.documentAssetId,
    node.parseArtifactId,
    node.kind,
    node.text,
    node.startOffset,
    node.endOffset,
    JSON.stringify(node.sourceLocation),
    JSON.stringify(node.permissionScope),
    node.artifactHash,
    JSON.stringify(node.metadata),
    node.updatedAt ?? null,
  ]) satisfies readonly DatabaseQueryValue[];
}

function knowledgeNodeValuesSql(
  database: DatabaseAdapter,
  columns: readonly string[],
  rowCount: number,
): string {
  return Array.from({ length: rowCount })
    .map((_, rowIndex) => {
      const offset = rowIndex * columns.length;
      return `(${columns
        .map((column, columnIndex) =>
          jsonInsertPlaceholder(database, offset + columnIndex + 1, column),
        )
        .join(", ")})`;
    })
    .join(", ");
}

function mapKnowledgeNodeRow(row: DatabaseRow): KnowledgeNode {
  const publicationGenerationId = optionalStringColumn(row, "publication_generation_id");
  const updatedAt = optionalStringColumn(row, "updated_at");

  return KnowledgeNodeSchema.parse({
    artifactHash: stringColumn(row, "artifact_hash"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    endOffset: numberColumn(row, "end_offset"),
    id: stringColumn(row, "id"),
    kind: stringColumn(row, "kind"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    parseArtifactId: stringColumn(row, "parse_artifact_id"),
    permissionScope: jsonStringArrayColumn(row, "permission_scope"),
    ...(publicationGenerationId ? { publicationGenerationId } : {}),
    sourceLocation: jsonObjectColumn(row, "source_location"),
    startOffset: numberColumn(row, "start_offset"),
    text: stringColumn(row, "text"),
    ...(updatedAt ? { updatedAt } : {}),
  });
}

function validateKnowledgeNodeRepositoryBounds({
  maxBatchSize,
  maxListLimit,
  maxNodes,
}: {
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
  readonly maxNodes: number;
}) {
  if (maxBatchSize < 1) {
    throw new Error("Knowledge node repository maxBatchSize must be at least 1");
  }

  if (maxListLimit < 1) {
    throw new Error("Knowledge node repository maxListLimit must be at least 1");
  }

  if (maxNodes < 1) {
    throw new Error("Knowledge node repository maxNodes must be at least 1");
  }
}

function validateKnowledgeNodeBatch(nodes: readonly KnowledgeNode[], maxBatchSize: number) {
  if (nodes.length < 1) {
    throw new Error("Knowledge node batch must contain at least 1 node");
  }

  if (nodes.length > maxBatchSize) {
    throw new Error(`Knowledge node batch size exceeds maxBatchSize=${maxBatchSize}`);
  }
}

function validateKnowledgeNodeGenerationBatch(nodes: readonly KnowledgeNode[]): void {
  if (nodes.length < 1) {
    throw new Error("Knowledge node generation batch must contain at least 1 node");
  }
  const first = KnowledgeNodeSchema.parse(nodes[0]);
  if (!first.publicationGenerationId) {
    throw new Error("Knowledge node generation batch requires publicationGenerationId");
  }
  for (const candidate of nodes) {
    const node = KnowledgeNodeSchema.parse(candidate);
    if (
      node.publicationGenerationId !== first.publicationGenerationId ||
      node.knowledgeSpaceId !== first.knowledgeSpaceId ||
      node.parseArtifactId !== first.parseArtifactId
    ) {
      throw new Error("Knowledge node generation batch must share one generation and artifact");
    }
  }
}

function chunkKnowledgeNodeBatch(
  nodes: readonly KnowledgeNode[],
  maxBatchSize: number,
): KnowledgeNode[][] {
  const batches: KnowledgeNode[][] = [];
  for (let start = 0; start < nodes.length; start += maxBatchSize) {
    batches.push(nodes.slice(start, start + maxBatchSize));
  }
  return batches;
}

function validateKnowledgeNodeLogicalBatch(nodes: readonly KnowledgeNode[]): void {
  const identities = new Set<string>();

  for (const node of nodes) {
    const identity = knowledgeNodeLogicalIdentity(node);
    if (identities.has(identity)) {
      throw new KnowledgeNodeLogicalConflictError();
    }
    identities.add(identity);
  }
}

export function validateKnowledgeNodeBatchIds(ids: readonly string[], maxBatchSize: number) {
  if (ids.length > maxBatchSize) {
    throw new Error(`Knowledge node batch size exceeds maxBatchSize=${maxBatchSize}`);
  }
}

function validateKnowledgeNodeMetadataPatches(
  patches: readonly UpdateKnowledgeNodeMetadataPatch[],
  maxBatchSize: number,
) {
  if (patches.length < 1) {
    throw new Error("Knowledge node metadata update batch must contain at least 1 patch");
  }

  if (patches.length > maxBatchSize) {
    throw new Error(`Knowledge node metadata update exceeds maxBatchSize=${maxBatchSize}`);
  }

  for (const patch of patches) {
    if (!patch.id.trim()) {
      throw new Error("Knowledge node metadata update id is required");
    }
  }
}

function validateKnowledgeNodeListLimit(limit: number, maxListLimit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Knowledge node list limit must be at least 1");
  }

  if (limit > maxListLimit) {
    throw new Error(`Knowledge node list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

function validateKnowledgeNodeDocumentBound(
  input: ListKnowledgeNodeIdsByDocumentAssetInput,
  operation: "list",
): void {
  if (!input.knowledgeSpaceId.trim() || !input.documentAssetId.trim()) {
    throw new Error(`Knowledge node ${operation} document scope is required`);
  }
  if (!Number.isInteger(input.maxNodes) || input.maxNodes < 1) {
    throw new Error(`Knowledge node ${operation} maxNodes must be at least 1`);
  }
}

export function compareKnowledgeNodesByArtifactOffset(
  left: KnowledgeNode,
  right: KnowledgeNode,
): number {
  return left.startOffset - right.startOffset || left.id.localeCompare(right.id);
}

function compareKnowledgeNodesById(left: KnowledgeNode, right: KnowledgeNode): number {
  return left.id.localeCompare(right.id);
}

function isKnowledgeNodeAfterCursor(
  node: KnowledgeNode,
  cursor: KnowledgeNodeCursor | undefined,
): boolean {
  return (
    !cursor ||
    node.startOffset > cursor.startOffset ||
    (node.startOffset === cursor.startOffset && node.id > cursor.id)
  );
}

function normalizeKnowledgeNodeGeneration(
  publicationGenerationId: string | undefined,
): string | undefined {
  return publicationGenerationId === undefined
    ? undefined
    : PublicationGenerationIdSchema.parse(publicationGenerationId);
}

function hasKnowledgeNodeGeneration(
  node: KnowledgeNode,
  publicationGenerationId: string | undefined,
): boolean {
  return node.publicationGenerationId === publicationGenerationId;
}

function hasSameKnowledgeNodeOwnership(left: KnowledgeNode, right: KnowledgeNode): boolean {
  return (
    left.knowledgeSpaceId === right.knowledgeSpaceId &&
    left.documentAssetId === right.documentAssetId &&
    left.parseArtifactId === right.parseArtifactId &&
    left.publicationGenerationId === right.publicationGenerationId
  );
}

function findKnowledgeNodeByLogicalIdentity(
  nodes: Iterable<KnowledgeNode>,
  target: KnowledgeNode,
): KnowledgeNode | undefined {
  const targetIdentity = knowledgeNodeLogicalIdentity(target);
  return Array.from(nodes).find(
    (candidate) => knowledgeNodeLogicalIdentity(candidate) === targetIdentity,
  );
}

function knowledgeNodeLogicalIdentity(node: KnowledgeNode): string {
  return JSON.stringify([
    node.knowledgeSpaceId,
    node.parseArtifactId,
    node.kind,
    node.startOffset,
    node.endOffset,
    node.publicationGenerationId ?? null,
  ]);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
