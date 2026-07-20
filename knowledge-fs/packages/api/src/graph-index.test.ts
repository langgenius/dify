import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type KnowledgeNode,
  KnowledgeNodeSchema,
  PUBLICATION_GENERATION_ID_SENTINEL,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import {
  type GraphEntity,
  type GraphRelation,
  createDatabaseGraphIndexRepository,
  createGraphIndexWriter,
  createInMemoryGraphIndexRepository,
  createInMemoryKnowledgeNodeRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

function knowledgeNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    artifactHash: "b".repeat(64),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    endOffset: 32,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    kind: "chunk",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    permissionScope: ["tenant-1"],
    sourceLocation: { sectionPath: ["Guide"], startOffset: 0, endOffset: 32 },
    startOffset: 0,
    text: "Acme Corp mentions the Refund Policy.",
    ...overrides,
  });
}

function graphEntity(overrides: Partial<GraphEntity> = {}): GraphEntity {
  return {
    aliases: ["Acme"],
    canonicalKey: "organization:acme",
    confidence: 0.9,
    createdAt: "2026-05-12T12:00:00.000Z",
    extractionVersion: 1,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60",
    knowledgeSpaceId: "space-1",
    metadata: {},
    name: "Acme",
    permissionScope: ["tenant-1"],
    sourceNodeIds: ["node-1"],
    type: "organization",
    updatedAt: "2026-05-12T12:00:00.000Z",
    ...overrides,
  };
}

function graphRelation(overrides: Partial<GraphRelation> = {}): GraphRelation {
  return {
    confidence: 0.9,
    createdAt: "2026-05-12T12:00:00.000Z",
    extractionVersion: 1,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c70",
    knowledgeSpaceId: "space-1",
    metadata: {},
    objectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
    permissionScope: ["tenant-1"],
    sourceNodeIds: ["node-1"],
    subjectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
    type: "mentions",
    updatedAt: "2026-05-12T12:00:00.000Z",
    ...overrides,
  };
}

function createFakeGraphExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const entities = new Map<string, Record<string, unknown>>();
  const relations = new Map<string, Record<string, unknown>>();
  const scopedKey = (...parts: readonly unknown[]) =>
    parts.map((part) => (part === null || part === undefined ? "legacy" : String(part))).join(":");
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.tableName === "graph_entities" && input.operation === "insert") {
      const columnsPerEntity = 14;

      for (let index = 0; index < input.params.length; index += columnsPerEntity) {
        const [
          id,
          knowledgeSpaceId,
          publicationGenerationId,
          canonicalKey,
          type,
          name,
          aliases,
          confidence,
          sourceNodeIds,
          permissionScope,
          metadata,
          extractionVersion,
          createdAt,
          updatedAt,
        ] = input.params.slice(index, index + columnsPerEntity);
        const key = scopedKey(knowledgeSpaceId, publicationGenerationId, canonicalKey);
        const existing = entities.get(key);
        entities.set(key, {
          aliases: typeof aliases === "string" ? JSON.parse(aliases) : aliases,
          canonical_key: canonicalKey,
          confidence,
          created_at: existing?.created_at ?? createdAt,
          extraction_version: extractionVersion,
          id: existing?.id ?? id,
          knowledge_space_id: knowledgeSpaceId,
          metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
          name,
          permission_scope:
            typeof permissionScope === "string" ? JSON.parse(permissionScope) : permissionScope,
          publication_generation_id: publicationGenerationId,
          source_node_ids:
            typeof sourceNodeIds === "string" ? JSON.parse(sourceNodeIds) : sourceNodeIds,
          type,
          updated_at: updatedAt,
        });
      }

      return { rows: [...entities.values()], rowsAffected: entities.size };
    }

    if (
      input.tableName === "graph_entities" &&
      input.operation === "select" &&
      input.sql.includes("canonical_key")
    ) {
      const [knowledgeSpaceId, canonicalKey, publicationGenerationId] = input.params;
      const row = entities.get(scopedKey(knowledgeSpaceId, publicationGenerationId, canonicalKey));

      return { rows: row ? [row] : [], rowsAffected: 0 };
    }

    if (input.tableName === "graph_relations" && input.operation === "insert") {
      const columnsPerRelation = 13;

      for (let index = 0; index < input.params.length; index += columnsPerRelation) {
        const [
          id,
          knowledgeSpaceId,
          publicationGenerationId,
          subjectEntityId,
          objectEntityId,
          type,
          confidence,
          sourceNodeIds,
          permissionScope,
          metadata,
          extractionVersion,
          createdAt,
          updatedAt,
        ] = input.params.slice(index, index + columnsPerRelation);
        const key = scopedKey(
          knowledgeSpaceId,
          publicationGenerationId,
          subjectEntityId,
          type,
          objectEntityId,
          extractionVersion,
        );
        const existing = relations.get(key);
        relations.set(key, {
          confidence,
          created_at: existing?.created_at ?? createdAt,
          extraction_version: extractionVersion,
          id: existing?.id ?? id,
          knowledge_space_id: knowledgeSpaceId,
          metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
          object_entity_id: objectEntityId,
          permission_scope:
            typeof permissionScope === "string" ? JSON.parse(permissionScope) : permissionScope,
          publication_generation_id: publicationGenerationId,
          source_node_ids:
            typeof sourceNodeIds === "string" ? JSON.parse(sourceNodeIds) : sourceNodeIds,
          subject_entity_id: subjectEntityId,
          type,
          updated_at: updatedAt,
        });
      }

      return { rows: [...relations.values()], rowsAffected: relations.size };
    }

    if (
      input.tableName === "graph_relations" &&
      input.operation === "select" &&
      input.sql.includes("subject_entity_id")
    ) {
      const [
        knowledgeSpaceId,
        subjectEntityId,
        type,
        objectEntityId,
        extractionVersion,
        publicationGenerationId,
      ] = input.params;
      const row = relations.get(
        scopedKey(
          knowledgeSpaceId,
          publicationGenerationId,
          subjectEntityId,
          type,
          objectEntityId,
          extractionVersion,
        ),
      );

      return { rows: row ? [row] : [], rowsAffected: 0 };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor };
}

function createFakeGraphTraversalExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    return {
      rows: [
        {
          depth: 0,
          entity_aliases: ["Root"],
          entity_canonical_key: "organization:root",
          entity_confidence: 0.99,
          entity_created_at: "2026-05-12T12:00:00.000Z",
          entity_extraction_version: 1,
          entity_id: "entity-root",
          entity_metadata: {},
          entity_name: "Root",
          entity_permission_scope: ["tenant-1"],
          entity_publication_generation_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
          entity_source_node_ids: ["node-1"],
          entity_type: "organization",
          entity_updated_at: "2026-05-12T12:00:00.000Z",
          knowledge_space_id: "space-1",
          relation_confidence: null,
          relation_created_at: null,
          relation_extraction_version: null,
          relation_id: null,
          relation_metadata: null,
          relation_object_entity_id: null,
          relation_permission_scope: null,
          relation_publication_generation_id: null,
          relation_source_node_ids: null,
          relation_subject_entity_id: null,
          relation_type: null,
          relation_updated_at: null,
        },
        {
          depth: 1,
          entity_aliases: ["Child"],
          entity_canonical_key: "policy:child",
          entity_confidence: 0.92,
          entity_created_at: "2026-05-12T12:00:00.000Z",
          entity_extraction_version: 1,
          entity_id: "entity-child",
          entity_metadata: {},
          entity_name: "Child",
          entity_permission_scope: ["tenant-1"],
          entity_publication_generation_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
          entity_source_node_ids: ["node-1"],
          entity_type: "policy",
          entity_updated_at: "2026-05-12T12:00:00.000Z",
          knowledge_space_id: "space-1",
          relation_confidence: 0.91,
          relation_created_at: "2026-05-12T12:00:00.000Z",
          relation_extraction_version: 1,
          relation_id: "relation-child",
          relation_metadata: {},
          relation_object_entity_id: "entity-child",
          relation_permission_scope: ["tenant-1"],
          relation_publication_generation_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
          relation_source_node_ids: ["node-1"],
          relation_subject_entity_id: "entity-root",
          relation_type: "mentions",
          relation_updated_at: "2026-05-12T12:00:00.000Z",
        },
      ],
      rowsAffected: 2,
    };
  };

  return { calls, executor };
}

describe("graph index persistence", () => {
  const graphTimestamp = "2026-05-12T12:00:00.000Z";

  it("indexes graph-eligible entities and relations without writing ineligible outputs", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 8,
      maxEntities: 8,
      maxRelations: 8,
      now: () => "2026-05-12T12:00:00.000Z",
    });
    const first = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      metadata: {
        extractedEntities: [
          {
            confidence: 0.98,
            metadata: { canonicalName: "Acme Corp" },
            quality: { graphEligible: true },
            text: "Acme Corp",
            type: "organization",
          },
          {
            confidence: 0.91,
            quality: { graphEligible: true },
            text: "Refund Policy",
            type: "policy",
          },
          {
            confidence: 0.4,
            quality: { graphEligible: false, reason: "confidence-threshold" },
            text: "weak concept",
            type: "term",
          },
        ],
        extractedRelations: [
          {
            confidence: 0.96,
            metadata: { evidence: "sentence-1" },
            object: "Refund Policy",
            quality: { graphEligible: true },
            subject: "Acme Corp",
            type: "mentions",
          },
          {
            confidence: 0.42,
            object: "weak concept",
            quality: { graphEligible: false, reason: "confidence-threshold" },
            subject: "Acme Corp",
            type: "references",
          },
        ],
      },
    });
    const second = knowledgeNode({
      endOffset: 65,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      metadata: {
        extractedEntities: [
          {
            confidence: 0.94,
            quality: { graphEligible: true },
            text: "ACME Corp",
            type: "organization",
          },
        ],
        extractedRelations: [],
      },
      permissionScope: ["tenant-1", "confidential"],
      sourceLocation: { sectionPath: ["Guide"], startOffset: 33, endOffset: 65 },
      startOffset: 33,
    });
    await nodes.createMany([first, second]);

    const writer = createGraphIndexWriter({
      extractionVersion: 3,
      graph,
      maxBatchSize: 4,
      nodes,
    });
    const result = await writer.index({
      knowledgeSpaceId: first.knowledgeSpaceId,
      nodeIds: [first.id, second.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      traceId: "trace-graph-1",
    });

    expect(result.missingNodeIds).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"]);
    expect(result.stats).toEqual({
      entitiesIndexed: 2,
      relationsIndexed: 1,
      skippedEntities: 1,
      skippedRelations: 1,
    });
    expect(result.entities.map((entity) => entity.canonicalKey)).toEqual([
      "organization:acme corp",
      "policy:refund policy",
    ]);
    expect(result.entities.map((entity) => entity.id)).toEqual([
      "8f659f9a-04ed-5608-b91b-019d742ee94c",
      "6a592967-e0bd-5164-8003-ff758bc3a152",
    ]);
    expect(result.entities[0]).toMatchObject({
      aliases: ["Acme Corp", "ACME Corp"],
      confidence: 0.98,
      extractionVersion: 3,
      metadata: { traceId: "trace-graph-1" },
      permissionScope: ["tenant-1", "confidential"],
      sourceNodeIds: [first.id, second.id],
    });
    expect(result.relations[0]).toMatchObject({
      confidence: 0.96,
      extractionVersion: 3,
      metadata: { evidence: "sentence-1", traceId: "trace-graph-1" },
      permissionScope: ["tenant-1"],
      sourceNodeIds: [first.id],
      type: "mentions",
    });

    // Back-reference: each source node now carries the graph entity ids it maps to (merged onto
    // existing metadata), so retrieval can seed graph expansion from a node's matched entities.
    const firstStored = await nodes.get({ id: first.id, knowledgeSpaceId: first.knowledgeSpaceId });
    const secondStored = await nodes.get({
      id: second.id,
      knowledgeSpaceId: second.knowledgeSpaceId,
    });
    const acmeId = result.entities[0]?.id;
    const refundId = result.entities[1]?.id;
    expect(firstStored?.metadata.graphEntityIds).toEqual([acmeId, refundId].sort());
    expect(secondStored?.metadata.graphEntityIds).toEqual([acmeId]);
    expect(firstStored?.metadata.extractedEntities).toBeDefined();
  });

  it("isolates generation-scoped graph ids without mutating legacy node back-references", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 8,
      maxEntities: 8,
      maxRelations: 8,
      now: () => graphTimestamp,
    });
    const firstGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80";
    const secondGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81";
    const node = knowledgeNode({
      metadata: {
        extractedEntities: [
          {
            confidence: 0.98,
            quality: { graphEligible: true },
            text: "Acme Corp",
            type: "organization",
          },
          {
            confidence: 0.91,
            quality: { graphEligible: true },
            text: "Refund Policy",
            type: "policy",
          },
        ],
        extractedRelations: [
          {
            confidence: 0.96,
            object: "Refund Policy",
            quality: { graphEligible: true },
            subject: "Acme Corp",
            type: "mentions",
          },
        ],
      },
    });
    const firstGenerationNode = knowledgeNode({
      ...node,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c91",
      publicationGenerationId: firstGeneration,
    });
    const secondGenerationNode = knowledgeNode({
      ...node,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c92",
      publicationGenerationId: secondGeneration,
    });
    await nodes.createMany([node, firstGenerationNode, secondGenerationNode]);
    const writer = createGraphIndexWriter({
      extractionVersion: 1,
      graph,
      maxBatchSize: 4,
      nodes,
    });
    const first = await writer.index({
      knowledgeSpaceId: node.knowledgeSpaceId,
      nodeIds: [firstGenerationNode.id],
      publicationGenerationId: firstGeneration,
    });
    const replay = await writer.index({
      knowledgeSpaceId: node.knowledgeSpaceId,
      nodeIds: [firstGenerationNode.id],
      publicationGenerationId: firstGeneration.toUpperCase(),
    });
    const second = await writer.index({
      knowledgeSpaceId: node.knowledgeSpaceId,
      nodeIds: [secondGenerationNode.id],
      publicationGenerationId: secondGeneration,
    });

    expect(first.entities).toHaveLength(2);
    expect(first.relations).toHaveLength(1);
    expect(
      first.entities.every((entity) => entity.publicationGenerationId === firstGeneration),
    ).toBe(true);
    expect(
      first.relations.every((relation) => relation.publicationGenerationId === firstGeneration),
    ).toBe(true);
    expect(replay.entities.map((entity) => entity.id)).toEqual(
      first.entities.map((entity) => entity.id),
    );
    expect(replay.relations.map((relation) => relation.id)).toEqual(
      first.relations.map((relation) => relation.id),
    );
    expect(second.entities.map((entity) => entity.id)).not.toEqual(
      first.entities.map((entity) => entity.id),
    );
    expect(second.relations.map((relation) => relation.id)).not.toEqual(
      first.relations.map((relation) => relation.id),
    );
    const storedNode = await nodes.get({
      id: node.id,
      knowledgeSpaceId: node.knowledgeSpaceId,
    });
    expect(storedNode?.metadata.graphEntityIds).toBeUndefined();
    await expect(
      graph.listEntities({
        knowledgeSpaceId: node.knowledgeSpaceId,
        limit: 8,
        publicationGenerationId: firstGeneration,
      }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining(
        first.entities.map((entity) => expect.objectContaining({ id: entity.id })),
      ),
    });
    await expect(
      graph.listEntities({ knowledgeSpaceId: node.knowledgeSpaceId, limit: 8 }),
    ).resolves.toMatchObject({ items: [] });
  });

  it("traverses graph relations with depth, fanout, and node budgets", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 8,
      maxEntities: 8,
      maxRelations: 8,
      now: () => graphTimestamp,
    });
    await graph.upsertEntities([
      graphEntity({
        canonicalKey: "organization:acme",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
        name: "Acme",
        type: "organization",
      }),
      graphEntity({
        canonicalKey: "policy:refund",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
        name: "Refund Policy",
        type: "policy",
      }),
      graphEntity({
        canonicalKey: "term:approval",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c63",
        name: "Approval",
        type: "term",
      }),
      graphEntity({
        canonicalKey: "product:atlas",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c64",
        name: "Atlas",
        type: "product",
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c71",
        objectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
        subjectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
        type: "mentions",
      }),
      graphRelation({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c72",
        objectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c64",
        subjectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
        type: "references",
      }),
      graphRelation({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c73",
        objectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c63",
        subjectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
        type: "defines",
      }),
    ]);

    const result = await graph.traverse({
      fanout: 1,
      knowledgeSpaceId: "space-1",
      maxDepth: 2,
      maxNodes: 3,
      permissionScope: ["tenant-1"],
      startEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
      timeoutMs: 250,
    });

    expect(result.entities.map((entity) => [entity.id, entity.depth])).toEqual([
      ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c61", 0],
      ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c62", 1],
      ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c63", 2],
    ]);
    expect(result.relations.map((relation) => [relation.id, relation.depth])).toEqual([
      ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c71", 1],
      ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c73", 2],
    ]);
    expect(result.metrics).toMatchObject({
      depthReached: 2,
      exploredRelations: 2,
      fanout: 1,
      maxDepth: 2,
      maxNodes: 3,
      timedOut: false,
    });
    expect(result.truncated).toBe(false);
  });

  it("truncates graph traversal before adding relations to omitted entities", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 4,
      maxEntities: 4,
      maxRelations: 4,
      now: () => graphTimestamp,
    });
    await graph.upsertEntities([
      graphEntity({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c91",
      }),
      graphEntity({
        canonicalKey: "policy:first",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c92",
        name: "First",
        type: "policy",
      }),
      graphEntity({
        canonicalKey: "policy:second",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c93",
        name: "Second",
        type: "policy",
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c94",
        objectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c92",
        subjectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c91",
        type: "defines",
      }),
      graphRelation({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c95",
        objectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c93",
        subjectEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c91",
        type: "mentions",
      }),
    ]);

    const result = await graph.traverse({
      fanout: 2,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 2,
      permissionScope: ["tenant-1"],
      startEntityId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c91",
      timeoutMs: 250,
    });

    expect(result.truncated).toBe(true);
    expect(result.entities).toHaveLength(2);
    expect(result.relations.map((relation) => relation.objectEntityId)).toEqual([
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c92",
    ]);
  });

  it("prunes graph source mentions and removes orphan entities", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => graphTimestamp,
    });
    await graph.upsertEntities([
      graphEntity({
        canonicalKey: "organization:acme",
        id: "entity-shared",
        name: "Acme",
        sourceNodeIds: ["node-1", "node-2"],
      }),
      graphEntity({
        canonicalKey: "policy:old-policy",
        id: "entity-orphan",
        name: "Old Policy",
        sourceNodeIds: ["node-1"],
        type: "policy",
      }),
      graphEntity({
        canonicalKey: "policy:new-policy",
        id: "entity-kept",
        name: "New Policy",
        sourceNodeIds: ["node-2"],
        type: "policy",
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "relation-pruned",
        objectEntityId: "entity-orphan",
        sourceNodeIds: ["node-1"],
        subjectEntityId: "entity-shared",
      }),
      graphRelation({
        id: "relation-kept",
        objectEntityId: "entity-kept",
        sourceNodeIds: ["node-1", "node-2"],
        subjectEntityId: "entity-shared",
      }),
    ]);

    const result = await graph.pruneSourceNodes({
      knowledgeSpaceId: "space-1",
      maxSourceNodes: 2,
      sourceNodeIds: ["node-1"],
    });
    const traversal = await graph.traverse({
      fanout: 5,
      knowledgeSpaceId: "space-1",
      maxDepth: 2,
      maxNodes: 10,
      permissionScope: ["tenant-1"],
      startEntityId: "entity-shared",
      timeoutMs: 100,
    });

    expect(result).toEqual({
      prunedEntities: 1,
      prunedRelations: 1,
      updatedEntities: 1,
      updatedRelations: 1,
    });
    expect(traversal.entities.map((entity) => [entity.id, entity.sourceNodeIds])).toEqual([
      ["entity-shared", ["node-2"]],
      ["entity-kept", ["node-2"]],
    ]);
    expect(traversal.relations.map((relation) => relation.id)).toEqual(["relation-kept"]);

    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 2,
        sourceNodeIds: ["missing-node"],
      }),
    ).resolves.toEqual({
      prunedEntities: 0,
      prunedRelations: 0,
      updatedEntities: 0,
      updatedRelations: 0,
    });
  });

  it("deletes a whole merged graph component when any source contribution is deleted", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => graphTimestamp,
    });
    await graph.upsertEntities([
      graphEntity({
        aliases: ["Private A"],
        canonicalKey: "organization:shared",
        id: "entity-shared-a",
        metadata: { privateFact: "only document A" },
        name: "Shared",
        sourceNodeIds: ["node-a"],
      }),
      graphEntity({
        aliases: ["Public B"],
        canonicalKey: "organization:shared",
        id: "entity-shared-b",
        metadata: { publicFact: "document B" },
        name: "Shared",
        sourceNodeIds: ["node-b"],
      }),
      graphEntity({
        canonicalKey: "policy:clean",
        id: "entity-clean",
        name: "Clean",
        sourceNodeIds: ["node-b"],
        type: "policy",
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "relation-clean-to-shared",
        objectEntityId: "entity-shared-a",
        sourceNodeIds: ["node-b"],
        subjectEntityId: "entity-clean",
      }),
    ]);

    await expect(
      graph.deleteComponentsBySourceNodesAcrossGenerations({
        knowledgeSpaceId: "space-1",
        maxGenerations: 1,
        maxSourceNodes: 1,
        sourceNodeIds: ["node-a"],
      }),
    ).resolves.toEqual({ deletedEntities: 1, deletedRelations: 1 });

    await expect(graph.listEntities({ knowledgeSpaceId: "space-1", limit: 10 })).resolves.toEqual({
      items: [expect.objectContaining({ id: "entity-clean" })],
    });
    const traversal = await graph.traverse({
      fanout: 5,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 10,
      permissionScope: ["tenant-1"],
      startEntityId: "entity-clean",
      timeoutMs: 100,
    });
    expect(traversal.entities.map((entity) => entity.id)).toEqual(["entity-clean"]);
    expect(traversal.relations).toEqual([]);
    expect(JSON.stringify(traversal)).not.toContain("Private A");
    expect(JSON.stringify(traversal)).not.toContain("only document A");
  });

  it("keeps source-pruned graph entities when remaining relations still reference them", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => graphTimestamp,
    });
    await graph.upsertEntities([
      graphEntity({
        canonicalKey: "organization:acme",
        id: "entity-root",
        name: "Acme",
        sourceNodeIds: ["node-2"],
      }),
      graphEntity({
        canonicalKey: "policy:referenced",
        id: "entity-referenced",
        name: "Referenced Policy",
        sourceNodeIds: ["node-1"],
        type: "policy",
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "relation-reference",
        objectEntityId: "entity-referenced",
        sourceNodeIds: ["node-2"],
        subjectEntityId: "entity-root",
      }),
    ]);

    const result = await graph.pruneSourceNodes({
      knowledgeSpaceId: "space-1",
      maxSourceNodes: 1,
      sourceNodeIds: ["node-1"],
    });
    const traversal = await graph.traverse({
      fanout: 5,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 10,
      permissionScope: ["tenant-1"],
      startEntityId: "entity-root",
      timeoutMs: 100,
    });

    expect(result).toEqual({
      prunedEntities: 0,
      prunedRelations: 0,
      updatedEntities: 1,
      updatedRelations: 0,
    });
    expect(traversal.entities.map((entity) => [entity.id, entity.sourceNodeIds])).toEqual([
      ["entity-root", ["node-2"]],
      ["entity-referenced", []],
    ]);
  });

  it("prunes matching graph JSON references across legacy and immutable generations", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => graphTimestamp,
    });
    const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50";
    await graph.upsertEntities([
      graphEntity({ id: "legacy-entity", sourceNodeIds: ["node-stale"] }),
      graphEntity({
        canonicalKey: "organization:acme-candidate",
        id: "candidate-entity",
        publicationGenerationId: generationId,
        sourceNodeIds: ["node-stale"],
      }),
    ]);

    await expect(
      graph.pruneSourceNodesAcrossGenerations({
        knowledgeSpaceId: "space-1",
        maxGenerations: 2,
        maxSourceNodes: 1,
        sourceNodeIds: ["node-stale"],
      }),
    ).resolves.toEqual({
      prunedEntities: 2,
      prunedRelations: 0,
      updatedEntities: 0,
      updatedRelations: 0,
    });
    await expect(graph.listEntities({ knowledgeSpaceId: "space-1", limit: 10 })).resolves.toEqual({
      items: [],
    });
    await expect(
      graph.listEntities({
        knowledgeSpaceId: "space-1",
        limit: 10,
        publicationGenerationId: generationId,
      }),
    ).resolves.toEqual({ items: [] });
  });

  it("uses recursive CTE SQL with explicit graph traversal budgets", async () => {
    const fake = createFakeGraphTraversalExecutor();
    const graph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxBatchSize: 4,
    });

    const result = await graph.traverse({
      fanout: 2,
      knowledgeSpaceId: "space-1",
      maxDepth: 2,
      maxNodes: 5,
      permissionScope: ["tenant-1"],
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      startEntityId: "entity-root",
      timeoutMs: 250,
    });

    expect(result.entities.map((entity) => entity.id)).toEqual(["entity-root", "entity-child"]);
    expect(result.entities.every((entity) => entity.publicationGenerationId)).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      maxRows: 15,
      operation: "select",
      tableName: "graph_relations",
    });
    expect(fake.calls[0]?.params).toEqual([
      "space-1",
      "entity-root",
      2,
      2,
      5,
      '["tenant-1"]',
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    ]);
    expect(fake.calls[0]?.sql).toContain("WITH RECURSIVE");
    expect(fake.calls[0]?.sql).toContain("fanout_rank");
    expect(fake.calls[0]?.sql).toContain(
      '"publication_generation_id" IS NOT DISTINCT FROM $7::uuid',
    );
    expect(fake.calls[0]?.sql).not.toContain("CAST(NULL AS CHAR)");
    expect(fake.calls[0]?.sql).not.toContain("CAST(NULL AS DOUBLE PRECISION)");
    expect(fake.calls[0]?.sql).not.toContain("entity-root");

    const tidbFake = createFakeGraphTraversalExecutor();
    const tidbGraph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({ executor: tidbFake.executor, kind: "tidb" }),
      maxBatchSize: 4,
    });
    await tidbGraph.traverse({
      fanout: 2,
      knowledgeSpaceId: "space-1",
      maxDepth: 2,
      maxNodes: 5,
      permissionScope: ["tenant-1"],
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      startEntityId: "entity-root",
      timeoutMs: 250,
    });
    expect(tidbFake.calls[0]?.params).toEqual([
      "space-1",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      '["tenant-1"]',
      '["tenant-1"]',
      "space-1",
      "entity-root",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      '["tenant-1"]',
      2,
      "space-1",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      2,
      5,
    ]);
    expect(tidbFake.calls[0]?.sql).toContain("`publication_generation_id` <=> ?");
    expect(tidbFake.calls[0]?.sql.match(/\?/g)).toHaveLength(tidbFake.calls[0]?.params.length ?? 0);
  });

  it("uses parameterized database graph source pruning SQL", async () => {
    const fake = createFakeGraphExecutor();
    const graph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
      maxBatchSize: 5,
    });

    const result = await graph.pruneSourceNodes({
      knowledgeSpaceId: "space-1",
      maxSourceNodes: 5,
      sourceNodeIds: ["node-1", "node-2"],
    });

    expect(result).toEqual({
      prunedEntities: 0,
      prunedRelations: 0,
      updatedEntities: 0,
      updatedRelations: 0,
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      maxRows: 1,
      operation: "delete",
      params: ["space-1", JSON.stringify(["node-1", "node-2"])],
      tableName: "graph_relations",
    });
    expect(fake.calls[0]?.sql).toContain("WITH");
    expect(fake.calls[0]?.sql).toContain("graph_entities");
    expect(fake.calls[0]?.sql).toContain("graph_relations");
    expect(fake.calls[0]?.sql).toContain('"publication_generation_id" IS NULL');
    expect(fake.calls[0]?.sql).not.toContain("node-1");

    await graph.pruneSourceNodes({
      knowledgeSpaceId: "space-1",
      maxSourceNodes: 5,
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      sourceNodeIds: ["node-1"],
    });
    const generationPrune = fake.calls.filter((call) => call.operation === "delete").at(-1);
    expect(generationPrune?.params).toEqual([
      "space-1",
      JSON.stringify(["node-1"]),
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    ]);
    expect(generationPrune?.sql).toContain("IS NOT DISTINCT FROM $3::uuid");

    const tidbFake = createFakeGraphExecutor();
    const tidbGraph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({
        executor: tidbFake.executor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: tidbFake.executor }),
      }),
      maxBatchSize: 5,
    });
    await tidbGraph.pruneSourceNodes({
      knowledgeSpaceId: "space-1",
      maxSourceNodes: 5,
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      sourceNodeIds: ["node-1"],
    });
    const tidbGenerationPrune = tidbFake.calls.find((call) => call.operation === "delete");
    expect(tidbGenerationPrune?.sql).toContain("JSON_OVERLAPS");
    expect(tidbGenerationPrune?.sql).toContain("<=>");
    expect(tidbGenerationPrune?.params).toEqual([
      "space-1",
      JSON.stringify(["node-1"]),
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    ]);
    expect(tidbGenerationPrune?.sql.match(/\?/g)).toHaveLength(
      tidbGenerationPrune?.params.length ?? 0,
    );
    expect(tidbGenerationPrune?.sql).not.toContain("node-1");

    const countedCalls: DatabaseExecuteInput[] = [];
    const countedGraph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          countedCalls.push(input);

          return {
            rows: [
              {
                pruned_entities: 1,
                pruned_relations: 2,
                updated_entities: 3,
                updated_relations: 4,
              },
            ],
            rowsAffected: 1,
          };
        },
        kind: "postgres",
      }),
      maxBatchSize: 5,
    });
    await expect(
      countedGraph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 5,
        sourceNodeIds: ["node-1"],
      }),
    ).resolves.toEqual({
      prunedEntities: 1,
      prunedRelations: 2,
      updatedEntities: 3,
      updatedRelations: 4,
    });
    expect(countedCalls).toHaveLength(1);
  });

  it.each(["postgres", "tidb"] as const)(
    "inventories and prunes every matching graph generation with bounded %s SQL",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50";
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select") {
          return {
            rows: [
              { publication_generation_id: null },
              { publication_generation_id: generationId },
            ],
            rowsAffected: 2,
          };
        }
        return {
          rows: [
            {
              pruned_entities: 1,
              pruned_relations: 2,
              updated_entities: 3,
              updated_relations: 4,
            },
          ],
          rowsAffected: 1,
        };
      };
      const graph = createDatabaseGraphIndexRepository({
        database: createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => callback({ execute: executor }),
        }),
        maxBatchSize: 5,
      });

      await expect(
        graph.pruneSourceNodesAcrossGenerations({
          knowledgeSpaceId: "space-1",
          maxGenerations: 2,
          maxSourceNodes: 1,
          sourceNodeIds: ["node-1"],
        }),
      ).resolves.toEqual({
        prunedEntities: 2,
        prunedRelations: 4,
        updatedEntities: 6,
        updatedRelations: 8,
      });
      const inventory = calls[0];
      expect(inventory).toEqual(
        expect.objectContaining({
          maxRows: 3,
          operation: "select",
          tableName: "graph_entities",
        }),
      );
      expect(inventory?.params).toEqual(
        kind === "postgres"
          ? ["space-1", JSON.stringify(["node-1"])]
          : ["space-1", JSON.stringify(["node-1"]), "space-1", JSON.stringify(["node-1"])],
      );
      expect(inventory?.sql).toContain("graph_entities");
      expect(inventory?.sql).toContain("graph_relations");
      expect(inventory?.sql).toContain(kind === "postgres" ? "?|" : "JSON_OVERLAPS");

      const pruneCalls = calls.filter((call) => call.operation === "delete");
      expect(pruneCalls).toHaveLength(2);
      expect(pruneCalls[0]?.params).toEqual(["space-1", JSON.stringify(["node-1"])]);
      expect(pruneCalls[1]?.params).toEqual(["space-1", JSON.stringify(["node-1"]), generationId]);
      expect(pruneCalls[0]?.sql).toContain(
        kind === "postgres" ? '"publication_generation_id" IS NULL' : "<=>",
      );
      expect(pruneCalls[1]?.sql).toContain(
        kind === "postgres" ? "IS NOT DISTINCT FROM $3::uuid" : "<=>",
      );
      if (kind === "tidb") {
        for (const call of calls) {
          expect(call.sql.match(/\?/g)).toHaveLength(call.params.length);
        }
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "deletes contaminated graph components and endpoint relations with %s SQL",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select") {
          return { rows: [{ publication_generation_id: null }], rowsAffected: 1 };
        }
        return {
          rows: [],
          rowsAffected: input.tableName === "graph_relations" ? 3 : 2,
        };
      };
      const graph = createDatabaseGraphIndexRepository({
        database: createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => callback({ execute: executor }),
        }),
        maxBatchSize: 5,
      });

      await expect(
        graph.deleteComponentsBySourceNodesAcrossGenerations({
          knowledgeSpaceId: "space-1",
          maxGenerations: 1,
          maxSourceNodes: 1,
          sourceNodeIds: ["node-a"],
        }),
      ).resolves.toEqual({ deletedEntities: 2, deletedRelations: 3 });

      const deletes = calls.filter((call) => call.operation === "delete");
      expect(deletes).toHaveLength(2);
      expect(deletes[0]?.tableName).toBe("graph_relations");
      expect(deletes[0]?.sql).toContain("subject_entity_id");
      expect(deletes[0]?.sql).toContain("object_entity_id");
      expect(deletes[0]?.sql).toContain(
        kind === "postgres" ? "jsonb_array_elements_text" : "JSON_OVERLAPS",
      );
      expect(deletes[1]?.tableName).toBe("graph_entities");
      expect(deletes.every((call) => !call.sql.includes("node-a"))).toBe(true);
      if (kind === "tidb") {
        for (const call of calls) {
          expect(call.sql.match(/\?/g)).toHaveLength(call.params.length);
        }
      }
    },
  );

  it("fails closed when only the mutable graph index is wired to the gateway", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const space = await spaces.create({
      name: "Support",
      slug: "support",
      tenantId: "tenant-1",
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 4,
      maxEntities: 4,
      maxRelations: 4,
      now: () => graphTimestamp,
    });
    await graph.upsertEntities([
      graphEntity({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
        knowledgeSpaceId: space.id,
        permissionScope: [],
      }),
    ]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          "other-token": {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-2",
            tenantId: "tenant-2",
          },
          "read-token": {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      graphIndex: graph,
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        { knowledgeSpaceId: space.id },
      ]),
      knowledgeSpaces: spaces,
    });

    const response = await app.request(
      `/knowledge-spaces/${space.id}/graph/traverse?entityId=018f0d60-7a49-7cc2-9c1b-5b36f18f2c81&depth=2&fanout=2&maxNodes=4&timeoutMs=250`,
      { headers: { authorization: "Bearer read-token" } },
    );
    const hidden = await app.request(
      `/knowledge-spaces/${space.id}/graph/traverse?entityId=018f0d60-7a49-7cc2-9c1b-5b36f18f2c81`,
      { headers: { authorization: "Bearer other-token" } },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Published graph traversal is unavailable",
    });
    expect(hidden.status).toBe(404);
  });

  it("lists related documents through the KnowledgeFS by-entity virtual view", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => graphTimestamp,
    });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 2 });
    const space = await spaces.create({
      name: "Docs",
      slug: "docs",
      tenantId: "tenant-1",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          read: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      graphIndex: graph,
      documentAssets: assets,
      knowledgeNodes: nodes,
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        { knowledgeSpaceId: space.id },
      ]),
      knowledgeSpaces: spaces,
    });
    await Promise.all([
      assets.create({
        filename: "acme.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: space.id,
        mimeType: "text/markdown",
        objectKey: "tenant-1/acme.md",
        sha256: "a".repeat(64),
        sizeBytes: 1,
      }),
      assets.create({
        filename: "refund.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        knowledgeSpaceId: space.id,
        mimeType: "text/markdown",
        objectKey: "tenant-1/refund.md",
        sha256: "b".repeat(64),
        sizeBytes: 1,
      }),
    ]);
    await nodes.createMany([
      knowledgeNode({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        knowledgeSpaceId: space.id,
        permissionScope: [],
        text: "Acme overview",
      }),
      knowledgeNode({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        endOffset: 65,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        knowledgeSpaceId: space.id,
        permissionScope: [],
        sourceLocation: { sectionPath: ["Guide"], startOffset: 33, endOffset: 65 },
        startOffset: 33,
        text: "Refund policy",
      }),
    ]);
    await graph.upsertEntities([
      graphEntity({
        id: "entity-acme",
        knowledgeSpaceId: space.id,
        name: "Acme",
        permissionScope: [],
        sourceNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c50"],
      }),
      graphEntity({
        canonicalKey: "policy:refund-policy",
        id: "entity-refund",
        knowledgeSpaceId: space.id,
        name: "Refund Policy",
        permissionScope: [],
        sourceNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c51"],
        type: "policy",
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "relation-acme-refund",
        knowledgeSpaceId: space.id,
        objectEntityId: "entity-refund",
        permissionScope: [],
        sourceNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c50"],
        subjectEntityId: "entity-acme",
        type: "references",
      }),
    ]);

    const root = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-entity",
      )}&limit=5`,
      {
        headers: { authorization: "Bearer read" },
      },
    );
    const entityDocs = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-entity/entity-acme",
      )}&limit=5`,
      {
        headers: { authorization: "Bearer read" },
      },
    );
    const pagedRoot = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-entity",
      )}&limit=1`,
      {
        headers: { authorization: "Bearer read" },
      },
    );
    const truncatedDocs = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-entity/entity-acme",
      )}&limit=1`,
      {
        headers: { authorization: "Bearer read" },
      },
    );
    const invalidPath = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-entity/entity-acme/extra",
      )}&limit=5`,
      {
        headers: { authorization: "Bearer read" },
      },
    );

    expect(root.status).toBe(200);
    await expect(root.json()).resolves.toMatchObject({
      items: [
        {
          kind: "directory",
          metadata: {
            entityId: "entity-acme",
            semanticView: {
              buildStatus: "ready",
              generatedVersion: "live",
              staleStatus: "fresh",
            },
            type: "organization",
          },
          name: "Acme",
          path: "/knowledge/by-entity/entity-acme",
        },
        {
          kind: "directory",
          metadata: {
            entityId: "entity-refund",
            semanticView: {
              buildStatus: "ready",
              generatedVersion: "live",
              staleStatus: "fresh",
            },
            type: "policy",
          },
          name: "Refund Policy",
          path: "/knowledge/by-entity/entity-refund",
        },
      ],
      path: "/knowledge/by-entity",
      truncated: false,
    });
    expect(entityDocs.status).toBe(200);
    await expect(entityDocs.json()).resolves.toMatchObject({
      items: [
        {
          kind: "resource",
          metadata: {
            entityId: "entity-acme",
            nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c50"],
            semanticView: {
              buildStatus: "ready",
              generatedVersion: "live",
              staleStatus: "fresh",
            },
          },
          name: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          path: "/knowledge/by-entity/entity-acme/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          resourceType: "document",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        },
        {
          kind: "resource",
          metadata: {
            entityId: "entity-acme",
            nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c51"],
            semanticView: {
              buildStatus: "ready",
              generatedVersion: "live",
              staleStatus: "fresh",
            },
          },
          name: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          path: "/knowledge/by-entity/entity-acme/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          resourceType: "document",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        },
      ],
      path: "/knowledge/by-entity/entity-acme",
      truncated: false,
    });
    expect(pagedRoot.status).toBe(200);
    const pagedRootJson = await pagedRoot.json();
    expect(pagedRootJson).toMatchObject({
      items: [{ name: "Acme" }],
      path: "/knowledge/by-entity",
      truncated: true,
    });
    expect(pagedRootJson.nextCursor).toBeTypeOf("string");
    const secondRootPage = await app.request(
      `/knowledge-spaces/${space.id}/fs/ls?path=${encodeURIComponent(
        "/knowledge/by-entity",
      )}&limit=1&cursor=${encodeURIComponent(String(pagedRootJson.nextCursor))}`,
      {
        headers: { authorization: "Bearer read" },
      },
    );
    expect(secondRootPage.status).toBe(200);
    await expect(secondRootPage.json()).resolves.toMatchObject({
      items: [{ name: "Refund Policy" }],
      path: "/knowledge/by-entity",
      truncated: false,
    });
    expect(truncatedDocs.status).toBe(200);
    await expect(truncatedDocs.json()).resolves.toMatchObject({
      items: [{ targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43" }],
      path: "/knowledge/by-entity/entity-acme",
      truncated: true,
    });
    expect(invalidPath.status).toBe(400);
  });

  it("returns 503 before consulting a mutable graph for a missing entity", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const space = await spaces.create({
      name: "Support",
      slug: "support",
      tenantId: "tenant-1",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          "read-token": {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      graphIndex: createInMemoryGraphIndexRepository({
        maxBatchSize: 1,
        maxEntities: 1,
        maxRelations: 1,
      }),
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        { knowledgeSpaceId: space.id },
      ]),
      knowledgeSpaces: spaces,
    });

    const response = await app.request(
      `/knowledge-spaces/${space.id}/graph/traverse?entityId=018f0d60-7a49-7cc2-9c1b-5b36f18f2c99`,
      { headers: { authorization: "Bearer read-token" } },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Published graph traversal is unavailable",
    });
  });

  it("keeps in-memory graph records bounded and clone isolated", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 2,
      maxEntities: 2,
      maxRelations: 1,
      now: () => "2026-05-12T12:00:00.000Z",
    });
    const first = await graph.upsertEntities([
      {
        aliases: ["Acme"],
        canonicalKey: "organization:acme",
        confidence: 0.9,
        createdAt: graphTimestamp,
        extractionVersion: 1,
        id: "entity-1",
        knowledgeSpaceId: "space-1",
        metadata: { nested: { source: "test" } },
        name: "Acme",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-1"],
        type: "organization",
        updatedAt: graphTimestamp,
      },
    ]);

    (first[0]?.metadata.nested as { source: string }).source = "mutated";
    const stored = await graph.upsertEntities([
      {
        ...first[0],
        metadata: { nested: { source: "stored" } },
      } as GraphEntity,
    ]);

    expect(stored[0]?.metadata).toEqual({ nested: { source: "stored" } });
    await expect(
      graph.upsertEntities([
        {
          aliases: ["A"],
          canonicalKey: "term:a",
          confidence: 0.8,
          createdAt: graphTimestamp,
          extractionVersion: 1,
          id: "entity-2",
          knowledgeSpaceId: "space-1",
          metadata: {},
          name: "A",
          permissionScope: [],
          sourceNodeIds: ["node-1"],
          type: "term",
          updatedAt: graphTimestamp,
        },
        {
          aliases: ["B"],
          canonicalKey: "term:b",
          confidence: 0.8,
          createdAt: graphTimestamp,
          extractionVersion: 1,
          id: "entity-3",
          knowledgeSpaceId: "space-1",
          metadata: {},
          name: "B",
          permissionScope: [],
          sourceNodeIds: ["node-1"],
          type: "term",
          updatedAt: graphTimestamp,
        },
      ]),
    ).rejects.toThrow("Graph entity capacity exceeded");
  });

  it("lists only the explicitly selected publication generation", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 3,
      maxEntities: 3,
      maxRelations: 1,
    });
    const base = graphEntity({
      canonicalKey: "organization:acme",
      id: "entity-legacy",
    });
    const first = {
      ...base,
      id: "entity-generation-1",
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    };
    const second = {
      ...base,
      id: "entity-generation-2",
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
    };

    await graph.upsertEntities([base, first, second]);

    await expect(
      graph.listEntities({ knowledgeSpaceId: base.knowledgeSpaceId, limit: 3 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: base.id })],
    });
    await expect(
      graph.listEntities({
        knowledgeSpaceId: base.knowledgeSpaceId,
        limit: 3,
        publicationGenerationId: first.publicationGenerationId,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: first.id })],
    });
    await expect(
      graph.listEntities({
        knowledgeSpaceId: base.knowledgeSpaceId,
        limit: 3,
        publicationGenerationId: second.publicationGenerationId,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: second.id })],
    });
  });

  it("renders generation-scoped entity list SQL for PostgreSQL and TiDB", async () => {
    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50";
    const postgresFake = createFakeGraphExecutor();
    const postgresGraph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({ executor: postgresFake.executor, kind: "postgres" }),
      maxBatchSize: 2,
    });

    await postgresGraph.listEntities({ knowledgeSpaceId: "space-1", limit: 2 });
    await postgresGraph.listEntities({
      cursor: { id: "entity-1", name: "Acme" },
      knowledgeSpaceId: "space-1",
      limit: 2,
      publicationGenerationId,
    });

    expect(postgresFake.calls[0]?.params).toEqual(["space-1", 3]);
    expect(postgresFake.calls[0]?.sql).toContain('"publication_generation_id" IS NULL');
    expect(postgresFake.calls[1]?.params).toEqual([
      "space-1",
      publicationGenerationId,
      "Acme",
      "Acme",
      "entity-1",
      3,
    ]);
    expect(postgresFake.calls[1]?.sql).toContain('"publication_generation_id" = $2');
    expect(postgresFake.calls[1]?.sql).toContain("LIMIT $6");

    const tidbFake = createFakeGraphExecutor();
    const tidbGraph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({ executor: tidbFake.executor, kind: "tidb" }),
      maxBatchSize: 2,
    });
    await tidbGraph.listEntities({
      knowledgeSpaceId: "space-1",
      limit: 2,
      publicationGenerationId,
    });

    expect(tidbFake.calls[0]?.params).toEqual(["space-1", publicationGenerationId, 3]);
    expect(tidbFake.calls[0]?.sql).toContain("`publication_generation_id` = ?");
    expect(tidbFake.calls[0]?.sql.match(/\?/g)).toHaveLength(tidbFake.calls[0]?.params.length ?? 0);
  });

  it("traverses only legacy rows or the explicitly selected generation", async () => {
    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50";
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 6,
      maxEntities: 6,
      maxRelations: 4,
      now: () => graphTimestamp,
    });
    await graph.upsertEntities([
      graphEntity({ id: "legacy-root" }),
      graphEntity({
        canonicalKey: "policy:legacy-child",
        id: "legacy-child",
        name: "Legacy Child",
        type: "policy",
      }),
      graphEntity({
        canonicalKey: "organization:candidate-root",
        id: "candidate-root",
        publicationGenerationId,
      }),
      graphEntity({
        canonicalKey: "policy:candidate-child",
        id: "candidate-child",
        name: "Candidate Child",
        publicationGenerationId,
        type: "policy",
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "legacy-relation",
        objectEntityId: "legacy-child",
        subjectEntityId: "legacy-root",
      }),
      graphRelation({
        id: "candidate-relation",
        objectEntityId: "candidate-child",
        publicationGenerationId,
        subjectEntityId: "candidate-root",
      }),
    ]);

    const legacy = await graph.traverse({
      fanout: 2,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 4,
      permissionScope: ["tenant-1"],
      startEntityId: "legacy-root",
      timeoutMs: 100,
    });
    const candidate = await graph.traverse({
      fanout: 2,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 4,
      permissionScope: ["tenant-1"],
      publicationGenerationId,
      startEntityId: "candidate-root",
      timeoutMs: 100,
    });
    const hiddenCandidate = await graph.traverse({
      fanout: 2,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 4,
      permissionScope: ["tenant-1"],
      startEntityId: "candidate-root",
      timeoutMs: 100,
    });

    expect(legacy.entities.map((entity) => entity.id)).toEqual(["legacy-root", "legacy-child"]);
    expect(legacy.relations.map((relation) => relation.id)).toEqual(["legacy-relation"]);
    expect(candidate.entities.map((entity) => entity.id)).toEqual([
      "candidate-root",
      "candidate-child",
    ]);
    expect(
      candidate.entities.every(
        (entity) => entity.publicationGenerationId === publicationGenerationId,
      ),
    ).toBe(true);
    expect(candidate.relations).toEqual([
      expect.objectContaining({ id: "candidate-relation", publicationGenerationId }),
    ]);
    expect(hiddenCandidate.entities).toEqual([]);
  });

  it("prunes source nodes without crossing publication generations", async () => {
    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50";
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 6,
      maxEntities: 6,
      maxRelations: 4,
      now: () => graphTimestamp,
    });
    await graph.upsertEntities([
      graphEntity({ id: "legacy-root", sourceNodeIds: ["shared-node"] }),
      graphEntity({
        canonicalKey: "policy:legacy-child",
        id: "legacy-child",
        sourceNodeIds: ["shared-node"],
        type: "policy",
      }),
      graphEntity({
        canonicalKey: "organization:candidate-root",
        id: "candidate-root",
        publicationGenerationId,
        sourceNodeIds: ["shared-node"],
      }),
      graphEntity({
        canonicalKey: "policy:candidate-child",
        id: "candidate-child",
        publicationGenerationId,
        sourceNodeIds: ["shared-node"],
        type: "policy",
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "legacy-relation",
        objectEntityId: "legacy-child",
        sourceNodeIds: ["shared-node"],
        subjectEntityId: "legacy-root",
      }),
      graphRelation({
        id: "candidate-relation",
        objectEntityId: "candidate-child",
        publicationGenerationId,
        sourceNodeIds: ["shared-node"],
        subjectEntityId: "candidate-root",
      }),
    ]);

    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 1,
        publicationGenerationId,
        sourceNodeIds: ["shared-node"],
      }),
    ).resolves.toEqual({
      prunedEntities: 2,
      prunedRelations: 1,
      updatedEntities: 0,
      updatedRelations: 0,
    });
    await expect(
      graph.listEntities({
        knowledgeSpaceId: "space-1",
        limit: 4,
        publicationGenerationId,
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      graph.listEntities({ knowledgeSpaceId: "space-1", limit: 4 }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: "legacy-child" }),
        expect.objectContaining({ id: "legacy-root" }),
      ],
    });

    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 1,
        sourceNodeIds: ["shared-node"],
      }),
    ).resolves.toEqual({
      prunedEntities: 2,
      prunedRelations: 1,
      updatedEntities: 0,
      updatedRelations: 0,
    });
  });

  it("deduplicates relation upserts and rejects relation capacity overflows", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 2,
      maxEntities: 2,
      maxRelations: 1,
      now: () => graphTimestamp,
    });
    const relation: GraphRelation = {
      confidence: 0.8,
      createdAt: graphTimestamp,
      extractionVersion: 1,
      id: "relation-1",
      knowledgeSpaceId: "space-1",
      metadata: { traceId: "trace-one" },
      objectEntityId: "entity-2",
      permissionScope: ["tenant-1"],
      sourceNodeIds: ["node-1"],
      subjectEntityId: "entity-1",
      type: "mentions",
      updatedAt: graphTimestamp,
    };
    const stored = await graph.upsertRelations([relation]);
    const updated = await graph.upsertRelations([
      {
        ...relation,
        confidence: 0.95,
        id: "relation-duplicate-id",
        metadata: { traceId: "trace-two" },
        sourceNodeIds: ["node-1", "node-2"],
      },
    ]);

    expect(stored[0]?.id).toBe("relation-1");
    expect(updated[0]).toMatchObject({
      confidence: 0.95,
      id: "relation-1",
      metadata: { traceId: "trace-two" },
      sourceNodeIds: ["node-1", "node-2"],
    });
    await expect(
      graph.upsertRelations([
        {
          ...relation,
          id: "relation-2",
          objectEntityId: "entity-3",
        },
      ]),
    ).rejects.toThrow("Graph relation capacity exceeded");
  });

  it("uses parameterized SQL with bounded batch writes for the database repository", async () => {
    const fake = createFakeGraphExecutor();
    const database = createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" });
    const graph = createDatabaseGraphIndexRepository({
      database,
      maxBatchSize: 4,
    });
    const entities = await graph.upsertEntities([
      {
        aliases: ["Acme Corp"],
        canonicalKey: "organization:acme corp",
        confidence: 0.98,
        createdAt: graphTimestamp,
        extractionVersion: 3,
        id: "entity-1",
        knowledgeSpaceId: "space-1",
        metadata: { traceId: "trace-db" },
        name: "Acme Corp",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-1"],
        type: "organization",
        updatedAt: graphTimestamp,
      },
    ]);
    const relations = await graph.upsertRelations([
      {
        confidence: 0.95,
        createdAt: graphTimestamp,
        extractionVersion: 3,
        id: "relation-1",
        knowledgeSpaceId: "space-1",
        metadata: { traceId: "trace-db" },
        objectEntityId: "entity-2",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-1"],
        subjectEntityId: entities[0]?.id ?? "entity-1",
        type: "mentions",
        updatedAt: graphTimestamp,
      },
    ]);

    expect(entities[0]?.canonicalKey).toBe("organization:acme corp");
    expect(relations[0]?.type).toBe("mentions");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toMatchObject({
      maxRows: 1,
      operation: "insert",
      tableName: "graph_entities",
    });
    expect(fake.calls[1]).toMatchObject({
      maxRows: 1,
      operation: "insert",
      tableName: "graph_relations",
    });
    expect(fake.calls[0]?.sql).not.toContain("Acme Corp");
    expect(fake.calls[1]?.sql).not.toContain("trace-db");
    expect(fake.calls[0]?.params).toContain("organization:acme corp");
  });

  it("renders TiDB-compatible graph upserts without PostgreSQL-only conflict syntax", async () => {
    const fake = createFakeGraphExecutor();
    const graph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
      maxBatchSize: 2,
    });

    await graph.upsertEntities([
      {
        aliases: ["Refund Policy"],
        canonicalKey: "policy:refund policy",
        confidence: 0.91,
        createdAt: graphTimestamp,
        extractionVersion: 3,
        id: "entity-policy",
        knowledgeSpaceId: "space-1",
        metadata: {},
        name: "Refund Policy",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-1"],
        type: "policy",
        updatedAt: graphTimestamp,
      },
    ]);
    await graph.upsertRelations([
      {
        confidence: 0.88,
        createdAt: graphTimestamp,
        extractionVersion: 3,
        id: "relation-tidb",
        knowledgeSpaceId: "space-1",
        metadata: {},
        objectEntityId: "entity-policy",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-1"],
        subjectEntityId: "entity-acme",
        type: "references",
        updatedAt: graphTimestamp,
      },
    ]);

    expect(fake.calls[0]?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(fake.calls[0]?.sql).not.toContain("ON CONFLICT");
    expect(fake.calls[1]?.sql).toContain("`publication_generation_id` <=> ?");
    expect(fake.calls[1]?.params).toEqual(["space-1", "policy:refund policy", null]);
    expect(fake.calls[2]?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(fake.calls[3]?.sql).toContain("`publication_generation_id` <=> ?");
    expect(fake.calls[3]?.params).toEqual([
      "space-1",
      "entity-acme",
      "references",
      "entity-policy",
      3,
      null,
    ]);
  });

  it("uses TiDB canonical entity ids when the legacy writer merges relations", async () => {
    const fake = createFakeGraphExecutor();
    const graph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
      maxBatchSize: 4,
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const node = knowledgeNode({
      metadata: {
        extractedEntities: [
          {
            confidence: 0.98,
            quality: { graphEligible: true },
            text: "Acme Corp",
            type: "organization",
          },
          {
            confidence: 0.91,
            quality: { graphEligible: true },
            text: "Refund Policy",
            type: "policy",
          },
        ],
        extractedRelations: [
          {
            confidence: 0.96,
            object: "Refund Policy",
            quality: { graphEligible: true },
            subject: "Acme Corp",
            type: "mentions",
          },
        ],
      },
    });
    await nodes.createMany([node]);
    await graph.upsertEntities([
      {
        aliases: ["Acme Corp"],
        canonicalKey: "organization:acme corp",
        confidence: 0.8,
        createdAt: graphTimestamp,
        extractionVersion: 1,
        id: "entity-canonical-acme",
        knowledgeSpaceId: node.knowledgeSpaceId,
        metadata: {},
        name: "Acme Corp",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-old"],
        type: "organization",
        updatedAt: graphTimestamp,
      },
      {
        aliases: ["Refund Policy"],
        canonicalKey: "policy:refund policy",
        confidence: 0.8,
        createdAt: graphTimestamp,
        extractionVersion: 1,
        id: "entity-canonical-policy",
        knowledgeSpaceId: node.knowledgeSpaceId,
        metadata: {},
        name: "Refund Policy",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-old"],
        type: "policy",
        updatedAt: graphTimestamp,
      },
    ]);

    const result = await createGraphIndexWriter({
      extractionVersion: 1,
      graph,
      maxBatchSize: 4,
      nodes,
    }).index({
      knowledgeSpaceId: node.knowledgeSpaceId,
      nodeIds: [node.id],
    });

    expect(result.entities.map(({ canonicalKey, id }) => ({ canonicalKey, id }))).toEqual([
      { canonicalKey: "organization:acme corp", id: "entity-canonical-acme" },
      { canonicalKey: "policy:refund policy", id: "entity-canonical-policy" },
    ]);
    expect(result.relations).toMatchObject([
      {
        objectEntityId: "entity-canonical-policy",
        subjectEntityId: "entity-canonical-acme",
      },
    ]);
    const relationInsert = fake.calls.find(
      (call) => call.operation === "insert" && call.tableName === "graph_relations",
    );
    expect(relationInsert?.params[3]).toBe("entity-canonical-acme");
    expect(relationInsert?.params[4]).toBe("entity-canonical-policy");
  });

  it("skips relations whose endpoints are not eligible graph entities", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 4,
      maxEntities: 4,
      maxRelations: 4,
      now: () => graphTimestamp,
    });
    const node = knowledgeNode({
      metadata: {
        extractedEntities: [
          {
            confidence: 0.91,
            quality: { graphEligible: true },
            text: "Refund Policy",
            type: "policy",
          },
          { confidence: 1, text: "", type: "term" },
          "invalid-entity",
        ],
        extractedRelations: [
          {
            confidence: 0.87,
            object: "Missing Entity",
            quality: { graphEligible: true },
            subject: "Refund Policy",
            type: "references",
          },
          "invalid-relation",
        ],
      },
    });
    await nodes.createMany([node]);

    const result = await createGraphIndexWriter({
      extractionVersion: 1,
      graph,
      maxBatchSize: 1,
      nodes,
    }).index({ knowledgeSpaceId: node.knowledgeSpaceId, nodeIds: [node.id] });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.metadata).toEqual({});
    expect(result.relations).toEqual([]);
    expect(result.stats).toEqual({
      entitiesIndexed: 1,
      relationsIndexed: 0,
      skippedEntities: 0,
      skippedRelations: 1,
    });
  });

  it("returns empty database batches without issuing graph SQL", async () => {
    const fake = createFakeGraphExecutor();
    const graph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxBatchSize: 1,
    });

    await expect(graph.upsertEntities([])).resolves.toEqual([]);
    await expect(graph.upsertRelations([])).resolves.toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("rejects unbounded graph indexing inputs", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 1,
      maxEntities: 1,
      maxRelations: 1,
    });
    const writer = createGraphIndexWriter({
      extractionVersion: 1,
      graph,
      maxBatchSize: 1,
      nodes,
    });

    await expect(
      writer.index({
        knowledgeSpaceId: "space-1",
        nodeIds: ["node-1", "node-2"],
      }),
    ).rejects.toThrow("Graph index nodeIds exceeds maxBatchSize=1");
    expect(() =>
      createGraphIndexWriter({
        extractionVersion: 0,
        graph,
        maxBatchSize: 1,
        nodes,
      }),
    ).toThrow("Graph index extractionVersion must be at least 1");
    expect(() =>
      createGraphIndexWriter({
        extractionVersion: 1,
        graph,
        maxBatchSize: 0,
        nodes,
      }),
    ).toThrow("Graph index maxBatchSize must be at least 1");
    expect(() =>
      createInMemoryGraphIndexRepository({
        maxBatchSize: 0,
        maxEntities: 1,
        maxRelations: 1,
      }),
    ).toThrow("Graph repository maxBatchSize must be at least 1");
    expect(() =>
      createInMemoryGraphIndexRepository({
        maxBatchSize: 1,
        maxEntities: 0,
        maxRelations: 1,
      }),
    ).toThrow("Graph repository maxEntities must be at least 1");
    expect(() =>
      createInMemoryGraphIndexRepository({
        maxBatchSize: 1,
        maxEntities: 1,
        maxRelations: 0,
      }),
    ).toThrow("Graph repository maxRelations must be at least 1");
    await expect(
      writer.index({
        knowledgeSpaceId: "",
        nodeIds: ["node-1"],
      }),
    ).rejects.toThrow("Graph index knowledgeSpaceId is required");
    await expect(
      writer.index({
        knowledgeSpaceId: "space-1",
        nodeIds: [],
      }),
    ).rejects.toThrow("Graph index nodeIds must contain at least 1 node id");
    await expect(
      writer.index({
        knowledgeSpaceId: "space-1",
        nodeIds: [""],
      }),
    ).rejects.toThrow("Graph index nodeIds must be non-empty strings");
    await expect(
      writer.index({
        knowledgeSpaceId: "space-1",
        nodeIds: ["node-1"],
        publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
      }),
    ).rejects.toThrow("Graph index publicationGenerationId must be a non-zero UUID");
    await expect(
      graph.upsertEntities([
        graphEntity({ publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL }),
      ]),
    ).rejects.toThrow("Graph entity publicationGenerationId must be a non-zero UUID");
    await expect(
      graph.upsertRelations([
        graphRelation({ publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL }),
      ]),
    ).rejects.toThrow("Graph relation publicationGenerationId must be a non-zero UUID");
    await expect(
      graph.listEntities({
        knowledgeSpaceId: "space-1",
        limit: 1,
        publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
      }),
    ).rejects.toThrow("Graph entity list publicationGenerationId must be a non-zero UUID");
    await expect(
      graph.traverse({
        fanout: 1,
        knowledgeSpaceId: "",
        maxDepth: 1,
        maxNodes: 1,
        startEntityId: "entity-1",
        timeoutMs: 1,
      }),
    ).rejects.toThrow("Graph traversal knowledgeSpaceId is required");
    await expect(
      graph.traverse({
        fanout: 1,
        knowledgeSpaceId: "space-1",
        maxDepth: 3,
        maxNodes: 1,
        startEntityId: "entity-1",
        timeoutMs: 1,
      }),
    ).rejects.toThrow("Graph traversal maxDepth must be between 1 and 2");
    await expect(
      graph.traverse({
        fanout: 0,
        knowledgeSpaceId: "space-1",
        maxDepth: 1,
        maxNodes: 1,
        startEntityId: "entity-1",
        timeoutMs: 1,
      }),
    ).rejects.toThrow("Graph traversal fanout must be at least 1");
    await expect(
      graph.traverse({
        fanout: 1,
        knowledgeSpaceId: "space-1",
        maxDepth: 1,
        maxNodes: 0,
        startEntityId: "entity-1",
        timeoutMs: 1,
      }),
    ).rejects.toThrow("Graph traversal maxNodes must be at least 1");
    await expect(
      graph.traverse({
        fanout: 1,
        knowledgeSpaceId: "space-1",
        maxDepth: 1,
        maxNodes: 1,
        startEntityId: "",
        timeoutMs: 1,
      }),
    ).rejects.toThrow("Graph traversal startEntityId is required");
    await expect(
      graph.traverse({
        fanout: 1,
        knowledgeSpaceId: "space-1",
        maxDepth: 1,
        maxNodes: 1,
        publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
        startEntityId: "entity-1",
        timeoutMs: 1,
      }),
    ).rejects.toThrow("Graph traversal publicationGenerationId must be a non-zero UUID");
    await expect(
      graph.traverse({
        fanout: 1,
        knowledgeSpaceId: "space-1",
        maxDepth: 1,
        maxNodes: 1,
        startEntityId: "entity-1",
        timeoutMs: 0,
      }),
    ).rejects.toThrow("Graph traversal timeoutMs must be at least 1");
    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "",
        maxSourceNodes: 1,
        sourceNodeIds: ["node-1"],
      }),
    ).rejects.toThrow("Graph source pruning knowledgeSpaceId is required");
    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 0,
        sourceNodeIds: ["node-1"],
      }),
    ).rejects.toThrow("Graph source pruning maxSourceNodes must be at least 1");
    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 1,
        sourceNodeIds: [],
      }),
    ).rejects.toThrow("Graph source pruning sourceNodeIds must contain at least 1 node id");
    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 1,
        sourceNodeIds: ["node-1", "node-2"],
      }),
    ).rejects.toThrow("Graph source pruning sourceNodeIds exceeds maxSourceNodes=1");
    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 1,
        publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
        sourceNodeIds: ["node-1"],
      }),
    ).rejects.toThrow("Graph source pruning publicationGenerationId must be a non-zero UUID");
    await expect(
      graph.pruneSourceNodes({
        knowledgeSpaceId: "space-1",
        maxSourceNodes: 1,
        sourceNodeIds: [""],
      }),
    ).rejects.toThrow("Graph source pruning sourceNodeIds must be non-empty strings");
  });
});
