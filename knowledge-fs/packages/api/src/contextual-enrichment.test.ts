import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type CacheAdapter,
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type KnowledgeNode,
  KnowledgeNodeSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type ContextualEnrichmentProvider,
  type EntityExtractionProvider,
  type RelationExtractionProvider,
  createContextualEnrichmentFlow,
  createDatabaseKnowledgeNodeRepository,
  createEntityExtractionFlow,
  createExtractionQualityControlFlow,
  createInMemoryKnowledgeNodeRepository,
  createRelationExtractionFlow,
} from "./index";

interface KnowledgeNodeRow {
  artifact_hash: string;
  document_asset_id: string;
  end_offset: number;
  id: string;
  kind: string;
  knowledge_space_id: string;
  metadata: unknown;
  parse_artifact_id: string;
  permission_scope: unknown;
  publication_generation_id?: string | null;
  source_location: unknown;
  start_offset: number;
  text: string;
  updated_at?: string | null;
}

function knowledgeNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    endOffset: 24,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    kind: "chunk",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: { chunkIndex: 1 },
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    permissionScope: ["tenant-1"],
    sourceLocation: { sectionPath: ["Guide"], startOffset: 0, endOffset: 24 },
    startOffset: 0,
    text: "Refunds require approval.",
    ...overrides,
  });
}

function createRecordingContextualProvider(): ContextualEnrichmentProvider & {
  readonly calls: ContextualEnrichmentProvider["generate"] extends (input: infer Input) => unknown
    ? Input[]
    : never[];
} {
  const calls: Parameters<ContextualEnrichmentProvider["generate"]>[0][] = [];

  return {
    calls,
    generate: async (input) => {
      calls.push(input);

      return {
        metadata: { provider: "static", requestId: `request-${calls.length}` },
        text: `Context for ${input.node.id}: ${input.node.text}`,
      };
    },
  };
}

function createRecordingEntityProvider(): EntityExtractionProvider & {
  readonly calls: Parameters<EntityExtractionProvider["extract"]>[0][];
} {
  const calls: Parameters<EntityExtractionProvider["extract"]>[0][] = [];

  return {
    calls,
    extract: async (input) => {
      calls.push(input);

      return {
        entities: input.node.text.includes("Acme")
          ? [
              {
                confidence: 0.98,
                metadata: { canonicalName: "Acme Corp" },
                text: "Acme Corp",
                type: "organization",
              },
              {
                confidence: 0.91,
                text: "Refund Policy",
                type: "policy",
              },
              {
                confidence: 0.88,
                text: "$10K",
                type: "metric",
              },
            ]
          : [
              {
                confidence: 0.93,
                text: "May 12, 2026",
                type: "date",
              },
              {
                confidence: 0.89,
                text: "Atlas",
                type: "product",
              },
              {
                confidence: 0.86,
                text: "SLA",
                type: "term",
              },
              {
                confidence: 0.84,
                text: "Jane Doe",
                type: "person",
              },
            ],
        metadata: { provider: "static", requestId: `entity-request-${calls.length}` },
      };
    },
  };
}

function createRecordingRelationProvider(): RelationExtractionProvider & {
  readonly calls: Parameters<RelationExtractionProvider["extract"]>[0][];
} {
  const calls: Parameters<RelationExtractionProvider["extract"]>[0][] = [];

  return {
    calls,
    extract: async (input) => {
      calls.push(input);

      return {
        metadata: { provider: "static", requestId: `relation-request-${calls.length}` },
        relations: input.node.text.includes("supersedes")
          ? [
              {
                confidence: 0.87,
                object: "Legacy SLA",
                subject: "Atlas SLA",
                type: "supersedes",
              },
              {
                confidence: 0.81,
                object: "Legacy SLA",
                subject: "New SLA",
                type: "contradicts",
              },
            ]
          : [
              {
                confidence: 0.96,
                metadata: { evidence: "sentence-1" },
                object: "Refund Policy",
                subject: "Acme Corp",
                type: "mentions",
              },
              {
                confidence: 0.92,
                object: "approval workflow",
                subject: "Refund Policy",
                type: "defines",
              },
              {
                confidence: 0.89,
                object: "Atlas SLA",
                subject: "Refund Policy",
                type: "references",
              },
              {
                confidence: 0.84,
                object: "Manager approval",
                subject: "Refund Policy",
                type: "depends_on",
              },
            ],
      };
    },
  };
}

function createRecordingCache(): CacheAdapter & {
  readonly gets: string[];
  readonly sets: string[];
} {
  const entries = new Map<string, Uint8Array>();
  const gets: string[] = [];
  const sets: string[] = [];

  return {
    gets,
    kind: "memory",
    sets,
    delete: async (key) => {
      entries.delete(key);
    },
    get: async (key) => {
      gets.push(key);
      const value = entries.get(key);

      return value ? new Uint8Array(value) : null;
    },
    health: async () => true,
    set: async (key, value) => {
      sets.push(key);
      entries.set(key, new Uint8Array(value));
    },
    stats: async () => ({
      entries: entries.size,
      totalBytes: [...entries.values()].reduce((total, value) => total + value.byteLength, 0),
    }),
  };
}

function createFakeKnowledgeNodeExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, KnowledgeNodeRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      const columnsPerNode = 14;

      for (let index = 0; index < input.params.length; index += columnsPerNode) {
        const [
          id,
          knowledgeSpaceId,
          publicationGenerationId,
          documentAssetId,
          parseArtifactId,
          kind,
          text,
          startOffset,
          endOffset,
          sourceLocation,
          permissionScope,
          artifactHash,
          metadata,
          updatedAt,
        ] = input.params.slice(index, index + columnsPerNode);
        rows.set(String(id), {
          artifact_hash: String(artifactHash),
          document_asset_id: String(documentAssetId),
          end_offset: Number(endOffset),
          id: String(id),
          kind: String(kind),
          knowledge_space_id: String(knowledgeSpaceId),
          metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
          parse_artifact_id: String(parseArtifactId),
          permission_scope:
            typeof permissionScope === "string" ? JSON.parse(permissionScope) : permissionScope,
          publication_generation_id:
            publicationGenerationId === null ? null : String(publicationGenerationId),
          source_location:
            typeof sourceLocation === "string" ? JSON.parse(sourceLocation) : sourceLocation,
          start_offset: Number(startOffset),
          text: String(text),
          updated_at: updatedAt === null ? null : String(updatedAt),
        });
      }

      return {
        rows: Array.from(rows.values()).map((row) => ({ ...row })),
        rowsAffected: rows.size,
      };
    }

    if (input.operation === "update") {
      const knowledgeSpaceId = String(input.params[0]);
      const patchCount = Math.floor((input.params.length - 1) / 3);
      let rowsAffected = 0;

      for (let index = 0; index < patchCount; index += 1) {
        const id = String(input.params[1 + index * 2]);
        const metadata = input.params[2 + index * 2];
        const row = rows.get(id);

        if (row && row.knowledge_space_id === knowledgeSpaceId) {
          rowsAffected += 1;
          rows.set(id, {
            ...row,
            metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
          });
        }
      }

      return { rows: [], rowsAffected };
    }

    if (input.operation === "select") {
      const [knowledgeSpaceId, ...ids] = input.params;
      const selected = ids
        .map((id) => rows.get(String(id)))
        .filter((row): row is KnowledgeNodeRow =>
          Boolean(row && row.knowledge_space_id === knowledgeSpaceId),
        )
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor, rows };
}

describe("contextual enrichment", () => {
  it("enriches knowledge nodes with provider-generated contextual descriptions", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 3,
      maxListLimit: 3,
      maxNodes: 3,
    });
    const provider = createRecordingContextualProvider();
    const first = knowledgeNode();
    const second = knowledgeNode({
      endOffset: 50,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      metadata: { chunkIndex: 2 },
      sourceLocation: { sectionPath: ["Guide", "Approvals"], startOffset: 25, endOffset: 50 },
      startOffset: 25,
      text: "Managers approve exceptions.",
    });
    await nodes.createMany([first, second]);

    const flow = createContextualEnrichmentFlow({
      maxBatchSize: 3,
      maxOutputTokens: 128,
      model: "context-model",
      nodes,
      now: () => "2026-05-12T12:00:00.000Z",
      provider,
    });
    const result = await flow.enrich({
      knowledgeSpaceId: first.knowledgeSpaceId,
      nodeIds: [first.id, second.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      traceId: "trace-enrich-1",
    });

    expect(result.missingNodeIds).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"]);
    expect(result.enrichedNodes).toHaveLength(2);
    expect(result.enrichedNodes[0]).toMatchObject({
      id: first.id,
      metadata: {
        chunkIndex: 1,
        contextualDescription: `Context for ${first.id}: Refunds require approval.`,
        contextualEnrichment: {
          enrichedAt: "2026-05-12T12:00:00.000Z",
          model: "context-model",
          promptVersion: "contextual-enrichment-v1",
          provider: "static",
          requestId: "request-1",
          traceId: "trace-enrich-1",
        },
      },
    });
    expect(provider.calls).toEqual([
      expect.objectContaining({
        maxOutputTokens: 128,
        model: "context-model",
        node: first,
        promptVersion: "contextual-enrichment-v1",
      }),
      expect.objectContaining({
        node: second,
      }),
    ]);

    const enrichedNode = result.enrichedNodes[0];
    if (!enrichedNode) {
      throw new Error("Expected enriched knowledge node");
    }
    enrichedNode.metadata.contextualDescription = "mutated";
    await expect(
      nodes.get({
        id: first.id,
        knowledgeSpaceId: first.knowledgeSpaceId,
      }),
    ).resolves.toMatchObject({
      metadata: {
        contextualDescription: `Context for ${first.id}: Refunds require approval.`,
      },
    });
  });

  it("updates contextual metadata with a parameterized database repository batch", async () => {
    const fake = createFakeKnowledgeNodeExecutor();
    const repository = createDatabaseKnowledgeNodeRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxBatchSize: 4,
      maxListLimit: 4,
    });
    const first = knowledgeNode();
    const second = knowledgeNode({
      endOffset: 50,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      metadata: { chunkIndex: 2 },
      startOffset: 25,
      text: "Managers approve exceptions.",
    });
    await repository.createMany([first, second]);

    await expect(
      repository.updateMetadataMany({
        knowledgeSpaceId: first.knowledgeSpaceId,
        patches: [
          {
            id: first.id,
            metadata: { ...first.metadata, contextualDescription: "Refund approval context" },
          },
          {
            id: second.id,
            metadata: { ...second.metadata, contextualDescription: "Manager exception context" },
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: first.id,
        metadata: { chunkIndex: 1, contextualDescription: "Refund approval context" },
      }),
      expect.objectContaining({
        id: second.id,
        metadata: { chunkIndex: 2, contextualDescription: "Manager exception context" },
      }),
    ]);
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "update",
        tableName: "knowledge_nodes",
      }),
    );
    expect(fake.calls[1]?.sql).not.toContain("Refund approval context");
    expect(fake.calls[1]?.params).toContain(
      JSON.stringify({
        chunkIndex: 1,
        contextualDescription: "Refund approval context",
      }),
    );
  });

  it("rejects unbounded contextual enrichment batches and empty provider output", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });
    const first = knowledgeNode();
    await nodes.createMany([first]);
    const flow = createContextualEnrichmentFlow({
      maxBatchSize: 1,
      model: "context-model",
      nodes,
      provider: {
        generate: async () => ({ text: "   " }),
      },
    });

    await expect(
      flow.enrich({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [first.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51"],
      }),
    ).rejects.toThrow("Contextual enrichment nodeIds exceeds maxBatchSize=1");
    await expect(
      flow.enrich({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [first.id],
      }),
    ).rejects.toThrow("Contextual enrichment provider returned empty text");
    expect(() =>
      createContextualEnrichmentFlow({
        maxBatchSize: 0,
        model: "context-model",
        nodes,
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Contextual enrichment maxBatchSize must be at least 1");
    expect(() =>
      createContextualEnrichmentFlow({
        maxBatchSize: 1,
        maxOutputTokens: 0,
        model: "context-model",
        nodes,
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Contextual enrichment maxOutputTokens must be at least 1");
    expect(() =>
      createContextualEnrichmentFlow({
        maxBatchSize: 1,
        model: " ",
        nodes,
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Contextual enrichment model is required");
    expect(() =>
      createContextualEnrichmentFlow({
        maxBatchSize: 1,
        model: "context-model",
        nodes,
        promptVersion: " ",
        provider: { generate: async () => ({ text: "ok" }) },
      }),
    ).toThrow("Contextual enrichment promptVersion is required");
  });

  it("handles missing contextual enrichment nodes without provider calls", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });
    const provider = createRecordingContextualProvider();
    const flow = createContextualEnrichmentFlow({
      maxBatchSize: 2,
      model: "context-model",
      nodes,
      provider,
    });

    await expect(
      flow.enrich({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      }),
    ).resolves.toEqual({
      enrichedNodes: [],
      missingNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
    });
    expect(provider.calls).toEqual([]);
    await expect(
      flow.enrich({
        knowledgeSpaceId: " ",
        nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      }),
    ).rejects.toThrow("Contextual enrichment knowledgeSpaceId is required");
    await expect(
      flow.enrich({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        nodeIds: [],
      }),
    ).rejects.toThrow("Contextual enrichment nodeIds must contain at least 1 node id");
    await expect(
      flow.enrich({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        nodeIds: [" "],
      }),
    ).rejects.toThrow("Contextual enrichment nodeIds must be non-empty strings");
  });

  it("skips already-enriched nodes and reuses bounded cache entries without leaking text in keys", async () => {
    const cache = createRecordingCache();
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 3,
      maxListLimit: 3,
      maxNodes: 3,
    });
    const existing = knowledgeNode({
      metadata: { chunkIndex: 1, contextualDescription: "Existing context" },
      text: "Sensitive refund policy text",
    });
    const uncached = knowledgeNode({
      endOffset: 49,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      metadata: { chunkIndex: 2 },
      sourceLocation: { sectionPath: ["Guide"], startOffset: 25, endOffset: 49 },
      startOffset: 25,
      text: "Cached enrichment target",
    });
    const provider = createRecordingContextualProvider();
    await nodes.createMany([existing, uncached]);

    const firstFlow = createContextualEnrichmentFlow({
      cache,
      cacheTtlMs: 60_000,
      maxBatchSize: 3,
      model: "context-model",
      nodes,
      provider,
    });
    const firstResult = await firstFlow.enrich({
      knowledgeSpaceId: existing.knowledgeSpaceId,
      nodeIds: [existing.id, uncached.id],
    });

    expect(firstResult.enrichedNodes.map((node) => node.id)).toEqual([uncached.id]);
    expect(firstResult.skippedNodes).toEqual([{ id: existing.id, reason: "already-enriched" }]);
    expect(provider.calls.map((call) => call.node.id)).toEqual([uncached.id]);
    expect(cache.sets).toHaveLength(1);
    expect(cache.sets[0]).not.toContain("Cached enrichment target");
    expect(cache.sets[0]).not.toContain("Sensitive refund policy text");

    const cachedNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    await cachedNodes.createMany([uncached]);
    const cachedFlow = createContextualEnrichmentFlow({
      cache,
      maxBatchSize: 1,
      model: "context-model",
      nodes: cachedNodes,
      provider: {
        generate: async () => {
          throw new Error("provider should not be called on cache hit");
        },
      },
    });
    const cachedResult = await cachedFlow.enrich({
      knowledgeSpaceId: uncached.knowledgeSpaceId,
      nodeIds: [uncached.id],
    });

    expect(cachedResult.enrichedNodes).toEqual([
      expect.objectContaining({
        id: uncached.id,
        metadata: expect.objectContaining({
          contextualDescription: `Context for ${uncached.id}: Cached enrichment target`,
          contextualEnrichment: expect.objectContaining({
            cacheHit: true,
            model: "context-model",
            promptVersion: "contextual-enrichment-v1",
          }),
        }),
      }),
    ]);
  });

  it("rejects enrichment when estimated provider cost exceeds the configured budget", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const node = knowledgeNode();
    const provider = createRecordingContextualProvider();
    await nodes.createMany([node]);

    const flow = createContextualEnrichmentFlow({
      estimatedCostUsdPerNode: 0.02,
      maxBatchSize: 1,
      maxEstimatedCostUsd: 0.01,
      model: "context-model",
      nodes,
      provider,
    });

    await expect(
      flow.enrich({
        knowledgeSpaceId: node.knowledgeSpaceId,
        nodeIds: [node.id],
      }),
    ).rejects.toThrow("Contextual enrichment estimated cost 0.02 exceeds budget 0.01");
    expect(provider.calls).toEqual([]);
    await expect(
      nodes.get({ id: node.id, knowledgeSpaceId: node.knowledgeSpaceId }),
    ).resolves.toMatchObject({
      metadata: { chunkIndex: 1 },
    });
  });

  it("skips low-quality enrichment output without writing node metadata", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const node = knowledgeNode();
    await nodes.createMany([node]);

    const flow = createContextualEnrichmentFlow({
      maxBatchSize: 1,
      minQualityScore: 0.8,
      model: "context-model",
      nodes,
      provider: {
        generate: async () => ({
          metadata: { qualityScore: 0.4 },
          text: "Weak context",
        }),
      },
    });
    const result = await flow.enrich({
      knowledgeSpaceId: node.knowledgeSpaceId,
      nodeIds: [node.id],
    });

    expect(result.enrichedNodes).toEqual([]);
    expect(result.skippedNodes).toEqual([{ id: node.id, reason: "quality-threshold" }]);
    await expect(
      nodes.get({ id: node.id, knowledgeSpaceId: node.knowledgeSpaceId }),
    ).resolves.toMatchObject({
      metadata: { chunkIndex: 1 },
    });
  });

  it("validates cost-control options and supports forced refresh of existing context", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const existing = knowledgeNode({
      metadata: { chunkIndex: 1, contextualDescription: "Stale context" },
    });
    const provider = createRecordingContextualProvider();
    await nodes.createMany([existing]);

    const flow = createContextualEnrichmentFlow({
      cache: createRecordingCache(),
      cacheTtlMs: 1_000,
      estimatedCostUsdPerNode: 0,
      maxBatchSize: 1,
      maxEstimatedCostUsd: 0,
      minQualityScore: 1,
      model: "context-model",
      nodes,
      provider,
    });
    await expect(
      flow.enrich({
        forceRefresh: true,
        knowledgeSpaceId: existing.knowledgeSpaceId,
        nodeIds: [existing.id],
      }),
    ).resolves.toMatchObject({
      enrichedNodes: [
        {
          id: existing.id,
          metadata: {
            contextualDescription: `Context for ${existing.id}: Refunds require approval.`,
          },
        },
      ],
    });
    expect(provider.calls).toHaveLength(1);

    expect(() =>
      createContextualEnrichmentFlow({
        cacheTtlMs: 0,
        maxBatchSize: 1,
        model: "context-model",
        nodes,
        provider,
      }),
    ).toThrow("Contextual enrichment cacheTtlMs must be at least 1");
    expect(() =>
      createContextualEnrichmentFlow({
        estimatedCostUsdPerNode: -1,
        maxBatchSize: 1,
        model: "context-model",
        nodes,
        provider,
      }),
    ).toThrow("Contextual enrichment estimatedCostUsdPerNode must be non-negative");
    expect(() =>
      createContextualEnrichmentFlow({
        maxBatchSize: 1,
        maxEstimatedCostUsd: -1,
        model: "context-model",
        nodes,
        provider,
      }),
    ).toThrow("Contextual enrichment maxEstimatedCostUsd must be non-negative");
    expect(() =>
      createContextualEnrichmentFlow({
        maxBatchSize: 1,
        minQualityScore: 1.1,
        model: "context-model",
        nodes,
        provider,
      }),
    ).toThrow("Contextual enrichment minQualityScore must be between 0 and 1");
  });

  it("rejects invalid knowledge node metadata update batches", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const first = knowledgeNode();
    await nodes.createMany([first]);

    await expect(
      nodes.updateMetadataMany({
        knowledgeSpaceId: first.knowledgeSpaceId,
        patches: [],
      }),
    ).rejects.toThrow("Knowledge node metadata update batch must contain at least 1 patch");
    await expect(
      nodes.updateMetadataMany({
        knowledgeSpaceId: first.knowledgeSpaceId,
        patches: [
          { id: first.id, metadata: first.metadata },
          {
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
            metadata: {},
          },
        ],
      }),
    ).rejects.toThrow("Knowledge node metadata update exceeds maxBatchSize=1");
    await expect(
      nodes.updateMetadataMany({
        knowledgeSpaceId: first.knowledgeSpaceId,
        patches: [{ id: " ", metadata: {} }],
      }),
    ).rejects.toThrow("Knowledge node metadata update id is required");
  });
});

describe("entity extraction", () => {
  it("extracts typed entities into knowledge node metadata with bounded provider calls", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 3,
      maxListLimit: 3,
      maxNodes: 3,
    });
    const first = knowledgeNode({
      text: "Acme Corp approved the Refund Policy for $10K exceptions.",
    });
    const second = knowledgeNode({
      endOffset: 88,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      metadata: { chunkIndex: 2 },
      sourceLocation: { sectionPath: ["Guide", "SLA"], startOffset: 24, endOffset: 88 },
      startOffset: 24,
      text: "Jane Doe renewed the Atlas SLA on May 12, 2026.",
    });
    await nodes.createMany([first, second]);
    const provider = createRecordingEntityProvider();

    const flow = createEntityExtractionFlow({
      maxBatchSize: 3,
      maxEntitiesPerNode: 8,
      model: "entity-model",
      nodes,
      now: () => "2026-05-12T13:00:00.000Z",
      provider,
    });
    const result = await flow.extract({
      knowledgeSpaceId: first.knowledgeSpaceId,
      nodeIds: [first.id, second.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      traceId: "trace-entity-1",
    });

    expect(result.missingNodeIds).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"]);
    expect(result.extractedNodes).toHaveLength(2);
    expect(result.extractedNodes[0]).toMatchObject({
      id: first.id,
      metadata: {
        chunkIndex: 1,
        entityExtraction: {
          entityCount: 3,
          extractedAt: "2026-05-12T13:00:00.000Z",
          model: "entity-model",
          promptVersion: "entity-extraction-v1",
          provider: "static",
          requestId: "entity-request-1",
          traceId: "trace-entity-1",
        },
        extractedEntities: [
          {
            confidence: 0.98,
            metadata: { canonicalName: "Acme Corp" },
            text: "Acme Corp",
            type: "organization",
          },
          {
            confidence: 0.91,
            text: "Refund Policy",
            type: "policy",
          },
          {
            confidence: 0.88,
            text: "$10K",
            type: "metric",
          },
        ],
      },
    });
    expect(result.extractedNodes[1]?.metadata.extractedEntities).toEqual([
      { confidence: 0.93, text: "May 12, 2026", type: "date" },
      { confidence: 0.89, text: "Atlas", type: "product" },
      { confidence: 0.86, text: "SLA", type: "term" },
      { confidence: 0.84, text: "Jane Doe", type: "person" },
    ]);
    expect(provider.calls).toEqual([
      expect.objectContaining({
        maxEntities: 8,
        model: "entity-model",
        node: first,
        promptVersion: "entity-extraction-v1",
      }),
      expect.objectContaining({
        node: second,
      }),
    ]);
    expect(provider.calls[0]?.prompt).toContain("people, organizations, products");

    const extractedNode = result.extractedNodes[0];
    if (!extractedNode) {
      throw new Error("Expected extracted knowledge node");
    }
    const extractedEntities = extractedNode.metadata.extractedEntities as Array<
      Record<string, unknown>
    >;
    const firstEntity = extractedEntities[0];
    if (!firstEntity) {
      throw new Error("Expected extracted entity");
    }
    firstEntity.text = "mutated";
    await expect(
      nodes.get({
        id: first.id,
        knowledgeSpaceId: first.knowledgeSpaceId,
      }),
    ).resolves.toMatchObject({
      metadata: {
        extractedEntities: expect.arrayContaining([
          expect.objectContaining({
            text: "Acme Corp",
          }),
        ]),
      },
    });
  });

  it("rejects invalid or unbounded entity extraction inputs and provider output", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });
    const first = knowledgeNode();
    await nodes.createMany([first]);
    const flow = createEntityExtractionFlow({
      maxBatchSize: 1,
      maxEntitiesPerNode: 1,
      model: "entity-model",
      nodes,
      provider: {
        extract: async () => ({
          entities: [
            { confidence: 0.9, text: "Refund Policy", type: "policy" },
            { confidence: 0.8, text: "Acme", type: "organization" },
          ],
        }),
      },
    });

    await expect(
      flow.extract({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [first.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51"],
      }),
    ).rejects.toThrow("Entity extraction nodeIds exceeds maxBatchSize=1");
    await expect(
      flow.extract({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [first.id],
      }),
    ).rejects.toThrow("Entity extraction provider returned 2 entities over maxEntitiesPerNode=1");
    await expect(
      createEntityExtractionFlow({
        maxBatchSize: 1,
        model: "entity-model",
        nodes,
        provider: {
          extract: async () => ({ entities: [{ confidence: 2, text: "x", type: "term" }] }),
        },
      }).extract({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [first.id] }),
    ).rejects.toThrow("Entity extraction entity confidence must be between 0 and 1");
    await expect(
      createEntityExtractionFlow({
        maxBatchSize: 1,
        model: "entity-model",
        nodes,
        provider: {
          extract: async () => ({
            entities: [{ confidence: 0.5, text: "x", type: "unknown" as "term" }],
          }),
        },
      }).extract({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [first.id] }),
    ).rejects.toThrow("Entity extraction entity type is unsupported");
    expect(() =>
      createEntityExtractionFlow({
        maxBatchSize: 0,
        model: "entity-model",
        nodes,
        provider: { extract: async () => ({ entities: [] }) },
      }),
    ).toThrow("Entity extraction maxBatchSize must be at least 1");
    expect(() =>
      createEntityExtractionFlow({
        maxBatchSize: 1,
        maxEntitiesPerNode: 0,
        model: "entity-model",
        nodes,
        provider: { extract: async () => ({ entities: [] }) },
      }),
    ).toThrow("Entity extraction maxEntitiesPerNode must be at least 1");
    expect(() =>
      createEntityExtractionFlow({
        maxBatchSize: 1,
        model: " ",
        nodes,
        provider: { extract: async () => ({ entities: [] }) },
      }),
    ).toThrow("Entity extraction model is required");
    expect(() =>
      createEntityExtractionFlow({
        maxBatchSize: 1,
        model: "entity-model",
        nodes,
        promptVersion: " ",
        provider: { extract: async () => ({ entities: [] }) },
      }),
    ).toThrow("Entity extraction promptVersion is required");
    await expect(
      flow.extract({
        knowledgeSpaceId: " ",
        nodeIds: [first.id],
      }),
    ).rejects.toThrow("Entity extraction knowledgeSpaceId is required");
    await expect(
      flow.extract({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [],
      }),
    ).rejects.toThrow("Entity extraction nodeIds must contain at least 1 node id");
  });

  it("handles missing entity extraction nodes without provider calls", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const provider = createRecordingEntityProvider();
    const flow = createEntityExtractionFlow({
      maxBatchSize: 1,
      model: "entity-model",
      nodes,
      provider,
    });

    await expect(
      flow.extract({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      }),
    ).resolves.toEqual({
      extractedNodes: [],
      missingNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
    });
    expect(provider.calls).toEqual([]);
  });

  it("records empty entity extraction results without dropping extraction metadata", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const first = knowledgeNode();
    await nodes.createMany([first]);
    const flow = createEntityExtractionFlow({
      maxBatchSize: 1,
      model: "entity-model",
      nodes,
      now: () => "2026-05-12T14:00:00.000Z",
      provider: {
        extract: async () => ({ entities: [] }),
      },
    });

    await expect(
      flow.extract({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [first.id],
      }),
    ).resolves.toMatchObject({
      extractedNodes: [
        {
          id: first.id,
          metadata: {
            entityExtraction: {
              entityCount: 0,
              extractedAt: "2026-05-12T14:00:00.000Z",
              model: "entity-model",
              promptVersion: "entity-extraction-v1",
            },
            extractedEntities: [],
          },
        },
      ],
      missingNodeIds: [],
    });
  });
});

describe("relation extraction", () => {
  it("extracts typed relations using existing node entities as provider context", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });
    const first = knowledgeNode({
      metadata: {
        chunkIndex: 1,
        extractedEntities: [
          { confidence: 0.98, text: "Acme Corp", type: "organization" },
          { confidence: 0.91, text: "Refund Policy", type: "policy" },
        ],
      },
      text: "Acme Corp mentions and defines the Refund Policy for the Atlas SLA.",
    });
    const second = knowledgeNode({
      endOffset: 49,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      metadata: {
        chunkIndex: 2,
        extractedEntities: [
          { confidence: 0.89, text: "Atlas SLA", type: "term" },
          { confidence: 0.72, text: "Legacy SLA", type: "term" },
        ],
      },
      sourceLocation: { sectionPath: ["Guide"], startOffset: 25, endOffset: 49 },
      startOffset: 25,
      text: "Atlas SLA supersedes Legacy SLA but New SLA contradicts Legacy SLA.",
    });
    await nodes.createMany([first, second]);
    const provider = createRecordingRelationProvider();

    const flow = createRelationExtractionFlow({
      maxBatchSize: 2,
      maxRelationsPerNode: 6,
      model: "relation-model",
      nodes,
      now: () => "2026-05-12T15:00:00.000Z",
      provider,
    });
    const result = await flow.extract({
      knowledgeSpaceId: first.knowledgeSpaceId,
      nodeIds: [first.id, second.id],
      traceId: "trace-relation-1",
    });

    expect(result.missingNodeIds).toEqual([]);
    expect(result.extractedNodes[0]).toMatchObject({
      id: first.id,
      metadata: {
        relationExtraction: {
          extractedAt: "2026-05-12T15:00:00.000Z",
          model: "relation-model",
          promptVersion: "relation-extraction-v1",
          provider: "static",
          relationCount: 4,
          requestId: "relation-request-1",
          traceId: "trace-relation-1",
        },
        extractedRelations: [
          {
            confidence: 0.96,
            metadata: { evidence: "sentence-1" },
            object: "Refund Policy",
            subject: "Acme Corp",
            type: "mentions",
          },
          {
            confidence: 0.92,
            object: "approval workflow",
            subject: "Refund Policy",
            type: "defines",
          },
          {
            confidence: 0.89,
            object: "Atlas SLA",
            subject: "Refund Policy",
            type: "references",
          },
          {
            confidence: 0.84,
            object: "Manager approval",
            subject: "Refund Policy",
            type: "depends_on",
          },
        ],
      },
    });
    expect(result.extractedNodes[1]?.metadata.extractedRelations).toEqual([
      { confidence: 0.87, object: "Legacy SLA", subject: "Atlas SLA", type: "supersedes" },
      { confidence: 0.81, object: "Legacy SLA", subject: "New SLA", type: "contradicts" },
    ]);
    expect(provider.calls[0]).toMatchObject({
      entities: [
        { confidence: 0.98, text: "Acme Corp", type: "organization" },
        { confidence: 0.91, text: "Refund Policy", type: "policy" },
      ],
      maxRelations: 6,
      model: "relation-model",
      node: first,
      promptVersion: "relation-extraction-v1",
    });
    expect(provider.calls[0]?.prompt).toContain(
      "mentions, defines, references, depends_on, supersedes, and contradicts",
    );

    const extractedNode = result.extractedNodes[0];
    if (!extractedNode) {
      throw new Error("Expected relation-extracted node");
    }
    const relations = extractedNode.metadata.extractedRelations as Array<Record<string, unknown>>;
    const firstRelation = relations[0];
    if (!firstRelation) {
      throw new Error("Expected extracted relation");
    }
    firstRelation.subject = "mutated";
    await expect(
      nodes.get({ id: first.id, knowledgeSpaceId: first.knowledgeSpaceId }),
    ).resolves.toMatchObject({
      metadata: {
        extractedRelations: expect.arrayContaining([
          expect.objectContaining({ subject: "Acme Corp" }),
        ]),
      },
    });
  });

  it("rejects invalid or unbounded relation extraction inputs and provider output", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });
    const first = knowledgeNode();
    await nodes.createMany([first]);
    const flow = createRelationExtractionFlow({
      maxBatchSize: 1,
      maxRelationsPerNode: 1,
      model: "relation-model",
      nodes,
      provider: {
        extract: async () => ({
          relations: [
            { confidence: 0.9, object: "B", subject: "A", type: "mentions" },
            { confidence: 0.8, object: "D", subject: "C", type: "references" },
          ],
        }),
      },
    });

    await expect(
      flow.extract({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [first.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51"],
      }),
    ).rejects.toThrow("Relation extraction nodeIds exceeds maxBatchSize=1");
    await expect(
      flow.extract({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [first.id],
      }),
    ).rejects.toThrow(
      "Relation extraction provider returned 2 relations over maxRelationsPerNode=1",
    );
    await expect(
      createRelationExtractionFlow({
        maxBatchSize: 1,
        model: "relation-model",
        nodes,
        provider: {
          extract: async () => ({
            relations: [{ confidence: 2, object: "B", subject: "A", type: "mentions" }],
          }),
        },
      }).extract({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [first.id] }),
    ).rejects.toThrow("Relation extraction relation confidence must be between 0 and 1");
    await expect(
      createRelationExtractionFlow({
        maxBatchSize: 1,
        model: "relation-model",
        nodes,
        provider: {
          extract: async () => ({
            relations: [
              { confidence: 0.5, object: "B", subject: "A", type: "unknown" as "mentions" },
            ],
          }),
        },
      }).extract({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [first.id] }),
    ).rejects.toThrow("Relation extraction relation type is unsupported");
    await expect(
      createRelationExtractionFlow({
        maxBatchSize: 1,
        model: "relation-model",
        nodes,
        provider: {
          extract: async () => ({
            relations: [{ confidence: 0.5, object: " ", subject: "A", type: "mentions" }],
          }),
        },
      }).extract({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [first.id] }),
    ).rejects.toThrow("Relation extraction relation object is required");
    expect(() =>
      createRelationExtractionFlow({
        maxBatchSize: 0,
        model: "relation-model",
        nodes,
        provider: { extract: async () => ({ relations: [] }) },
      }),
    ).toThrow("Relation extraction maxBatchSize must be at least 1");
    expect(() =>
      createRelationExtractionFlow({
        maxBatchSize: 1,
        maxRelationsPerNode: 0,
        model: "relation-model",
        nodes,
        provider: { extract: async () => ({ relations: [] }) },
      }),
    ).toThrow("Relation extraction maxRelationsPerNode must be at least 1");
    expect(() =>
      createRelationExtractionFlow({
        maxBatchSize: 1,
        model: " ",
        nodes,
        provider: { extract: async () => ({ relations: [] }) },
      }),
    ).toThrow("Relation extraction model is required");
    expect(() =>
      createRelationExtractionFlow({
        maxBatchSize: 1,
        model: "relation-model",
        nodes,
        promptVersion: " ",
        provider: { extract: async () => ({ relations: [] }) },
      }),
    ).toThrow("Relation extraction promptVersion is required");
    await expect(flow.extract({ knowledgeSpaceId: " ", nodeIds: [first.id] })).rejects.toThrow(
      "Relation extraction knowledgeSpaceId is required",
    );
    await expect(
      flow.extract({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [] }),
    ).rejects.toThrow("Relation extraction nodeIds must contain at least 1 node id");
  });

  it("handles missing relation extraction nodes without provider calls", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const provider = createRecordingRelationProvider();
    const flow = createRelationExtractionFlow({
      maxBatchSize: 1,
      model: "relation-model",
      nodes,
      provider,
    });

    await expect(
      flow.extract({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      }),
    ).resolves.toEqual({
      extractedNodes: [],
      missingNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
    });
    expect(provider.calls).toEqual([]);
  });
});

describe("extraction quality controls", () => {
  it("marks low-confidence and duplicate extraction outputs as graph-ineligible", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });
    const first = knowledgeNode({
      metadata: {
        chunkIndex: 1,
        extractedEntities: [
          { confidence: 0.95, text: "Acme Corp", type: "organization" },
          { confidence: 0.9, text: " acme corp ", type: "organization" },
          { confidence: 0.4, text: "Weak Entity", type: "term" },
          { confidence: 0.88, text: "Atlas", type: "product" },
        ],
        extractedRelations: [
          { confidence: 0.93, object: "Refund Policy", subject: "Acme Corp", type: "mentions" },
          { confidence: 0.91, object: "Refund Policy", subject: "Acme Corp", type: "mentions" },
          { confidence: 0.3, object: "Legacy SLA", subject: "Atlas", type: "contradicts" },
        ],
      },
    });
    await nodes.createMany([first]);

    const flow = createExtractionQualityControlFlow({
      maxBatchSize: 2,
      maxEligibleEntitiesPerNode: 2,
      maxEligibleRelationsPerNode: 1,
      minEntityConfidence: 0.75,
      minRelationConfidence: 0.8,
      nodes,
      now: () => "2026-05-12T16:00:00.000Z",
    });
    const result = await flow.apply({
      knowledgeSpaceId: first.knowledgeSpaceId,
      nodeIds: [first.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      traceId: "trace-quality-1",
    });

    expect(result.missingNodeIds).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"]);
    expect(result.controlledNodes).toHaveLength(1);
    expect(result.stats).toEqual({
      eligibleEntities: 2,
      eligibleRelations: 1,
      ineligibleEntities: 2,
      ineligibleRelations: 2,
    });
    expect(result.controlledNodes[0]).toMatchObject({
      metadata: {
        extractionQuality: {
          appliedAt: "2026-05-12T16:00:00.000Z",
          eligibleEntities: 2,
          eligibleRelations: 1,
          ineligibleEntities: 2,
          ineligibleRelations: 2,
          minEntityConfidence: 0.75,
          minRelationConfidence: 0.8,
          traceId: "trace-quality-1",
        },
        extractedEntities: [
          expect.objectContaining({
            quality: { graphEligible: true },
            text: "Acme Corp",
          }),
          expect.objectContaining({
            quality: { graphEligible: false, reason: "duplicate" },
            text: "acme corp",
          }),
          expect.objectContaining({
            quality: { graphEligible: false, reason: "confidence-threshold" },
            text: "Weak Entity",
          }),
          expect.objectContaining({
            quality: { graphEligible: true },
            text: "Atlas",
          }),
        ],
        extractedRelations: [
          expect.objectContaining({
            quality: { graphEligible: true },
            subject: "Acme Corp",
          }),
          expect.objectContaining({
            quality: { graphEligible: false, reason: "duplicate" },
            subject: "Acme Corp",
          }),
          expect.objectContaining({
            quality: { graphEligible: false, reason: "confidence-threshold" },
            subject: "Atlas",
          }),
        ],
      },
    });
  });

  it("applies entity and relation eligibility budgets and validates bounds", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const first = knowledgeNode({
      metadata: {
        extractedEntities: [
          { confidence: 0.99, text: "A", type: "term" },
          { confidence: 0.98, text: "B", type: "term" },
        ],
        extractedRelations: [
          { confidence: 0.99, object: "B", subject: "A", type: "references" },
          { confidence: 0.98, object: "C", subject: "A", type: "references" },
        ],
      },
    });
    await nodes.createMany([first]);
    const flow = createExtractionQualityControlFlow({
      maxBatchSize: 1,
      maxEligibleEntitiesPerNode: 1,
      maxEligibleRelationsPerNode: 1,
      nodes,
    });

    await expect(
      flow.apply({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [first.id] }),
    ).resolves.toMatchObject({
      controlledNodes: [
        {
          metadata: {
            extractedEntities: [
              expect.objectContaining({ quality: { graphEligible: true } }),
              expect.objectContaining({ quality: { graphEligible: false, reason: "budget" } }),
            ],
            extractedRelations: [
              expect.objectContaining({ quality: { graphEligible: true } }),
              expect.objectContaining({ quality: { graphEligible: false, reason: "budget" } }),
            ],
          },
        },
      ],
    });
    expect(() => createExtractionQualityControlFlow({ maxBatchSize: 0, nodes })).toThrow(
      "Extraction quality maxBatchSize must be at least 1",
    );
    expect(() =>
      createExtractionQualityControlFlow({ maxBatchSize: 1, maxEligibleEntitiesPerNode: 0, nodes }),
    ).toThrow("Extraction quality maxEligibleEntitiesPerNode must be at least 1");
    expect(() =>
      createExtractionQualityControlFlow({
        maxBatchSize: 1,
        maxEligibleRelationsPerNode: 0,
        nodes,
      }),
    ).toThrow("Extraction quality maxEligibleRelationsPerNode must be at least 1");
    expect(() =>
      createExtractionQualityControlFlow({ maxBatchSize: 1, minEntityConfidence: 1.1, nodes }),
    ).toThrow("Extraction quality minEntityConfidence must be between 0 and 1");
    expect(() =>
      createExtractionQualityControlFlow({ maxBatchSize: 1, minRelationConfidence: -0.1, nodes }),
    ).toThrow("Extraction quality minRelationConfidence must be between 0 and 1");
    await expect(flow.apply({ knowledgeSpaceId: " ", nodeIds: [first.id] })).rejects.toThrow(
      "Extraction quality knowledgeSpaceId is required",
    );
    await expect(
      flow.apply({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [] }),
    ).rejects.toThrow("Extraction quality nodeIds must contain at least 1 node id");
    await expect(
      flow.apply({ knowledgeSpaceId: first.knowledgeSpaceId, nodeIds: [" "] }),
    ).rejects.toThrow("Extraction quality nodeIds must be non-empty strings");
  });

  it("handles missing quality-control nodes and nodes without extracted metadata", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });
    const first = knowledgeNode({ metadata: { chunkIndex: 1 } });
    await nodes.createMany([first]);
    const flow = createExtractionQualityControlFlow({
      maxBatchSize: 2,
      nodes,
      now: () => "2026-05-12T16:30:00.000Z",
    });

    await expect(
      flow.apply({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: [first.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      }),
    ).resolves.toMatchObject({
      controlledNodes: [
        {
          metadata: {
            extractedEntities: [],
            extractedRelations: [],
            extractionQuality: {
              appliedAt: "2026-05-12T16:30:00.000Z",
              eligibleEntities: 0,
              eligibleRelations: 0,
              ineligibleEntities: 0,
              ineligibleRelations: 0,
            },
          },
        },
      ],
      missingNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
      stats: {
        eligibleEntities: 0,
        eligibleRelations: 0,
        ineligibleEntities: 0,
        ineligibleRelations: 0,
      },
    });
    await expect(
      flow.apply({
        knowledgeSpaceId: first.knowledgeSpaceId,
        nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c98"],
      }),
    ).resolves.toEqual({
      controlledNodes: [],
      missingNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c98"],
      stats: {
        eligibleEntities: 0,
        eligibleRelations: 0,
        ineligibleEntities: 0,
        ineligibleRelations: 0,
      },
    });
  });
});
