import {
  type KnowledgeNode,
  KnowledgeNodeSchema,
  type KnowledgeSpaceRetrievalProfile,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDocumentSemanticEnrichmentProcessor,
  createJointSemanticGraphMaterializer,
} from "./document-semantic-enrichment-processor";
import {
  createInMemoryDocumentSemanticEnrichmentRepository,
  createInMemoryDocumentSemanticExtractionCheckpointRepository,
} from "./document-semantic-enrichment-repository";
import { createInMemoryGraphIndexRepository } from "./graph-index-repository";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createLlmSemanticChunker } from "./llm-semantic-chunker";

const tenantId = "tenant-1";
const knowledgeSpaceId = uuid(1);
const documentAssetId = uuid(2);
const parseArtifactId = uuid(3);
const publicationGenerationId = uuid(4);
const createdAt = "2026-08-09T10:00:00.000Z";

describe("createDocumentSemanticEnrichmentProcessor", () => {
  it("validates processor and joint materializer bounds", () => {
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
    const baseProcessor = {
      checkpoints: createInMemoryDocumentSemanticExtractionCheckpointRepository(),
      graph,
      maxConcurrentBatches: 1,
      maxEntitiesPerNode: 1,
      maxNodesPerArtifact: 1,
      maxOutputTokens: 1,
      maxRelationsPerNode: 1,
      nodes,
      providerBatchSize: 1,
      providerFactory: () => semanticProvider(),
    };
    for (const [name, override] of [
      ["maxConcurrentBatches", { maxConcurrentBatches: 0 }],
      ["maxEntitiesPerNode", { maxEntitiesPerNode: 0 }],
      ["maxNodesPerArtifact", { maxNodesPerArtifact: 0 }],
      ["maxOutputTokens", { maxOutputTokens: 0 }],
      ["maxRelationsPerNode", { maxRelationsPerNode: 0 }],
      ["providerBatchSize", { providerBatchSize: 0 }],
    ] as const) {
      expect(() =>
        createDocumentSemanticEnrichmentProcessor({ ...baseProcessor, ...override }),
      ).toThrow(`${name} must be at least 1`);
    }

    const baseMaterializer = {
      graph,
      maxEntitiesPerNode: 1,
      maxNodesPerArtifact: 1,
      maxRelationsPerNode: 1,
      nodes,
    };
    for (const [name, override] of [
      ["maxEntitiesPerNode", { maxEntitiesPerNode: 0 }],
      ["maxNodesPerArtifact", { maxNodesPerArtifact: 0 }],
      ["maxRelationsPerNode", { maxRelationsPerNode: 0 }],
    ] as const) {
      expect(() =>
        createJointSemanticGraphMaterializer({ ...baseMaterializer, ...override }),
      ).toThrow(`${name} must be at least 1`);
    }
  });

  it("returns an empty result without constructing a provider", async () => {
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
    let providerFactoryCalls = 0;
    const processor = createDocumentSemanticEnrichmentProcessor({
      checkpoints: createInMemoryDocumentSemanticExtractionCheckpointRepository(),
      graph,
      maxConcurrentBatches: 1,
      maxEntitiesPerNode: 1,
      maxNodesPerArtifact: 1,
      maxOutputTokens: 1,
      maxRelationsPerNode: 1,
      nodes,
      providerBatchSize: 1,
      providerFactory: () => {
        providerFactoryCalls += 1;
        return semanticProvider();
      },
    });
    const expected = {
      entitiesExtracted: 0,
      graphEntityIds: [],
      graphEntitiesIndexed: 0,
      graphRelationIds: [],
      graphRelationsIndexed: 0,
      nodesScanned: 0,
      semanticProviderCalls: 0,
      semanticProviderCallsMaximum: 0,
    };

    await expect(processor.process(await semanticJob())).resolves.toEqual(expected);
    await expect(
      createJointSemanticGraphMaterializer({
        graph,
        maxEntitiesPerNode: 1,
        maxNodesPerArtifact: 1,
        maxRelationsPerNode: 1,
        nodes,
      }).materialize({
        createdAt,
        knowledgeSpaceId,
        parseArtifactId,
        publicationGenerationId,
        retrievalProfile: (await semanticJob()).retrievalProfile,
      }),
    ).resolves.toEqual(expected);
    expect(providerFactoryCalls).toBe(0);
  });

  it("rejects an artifact page that exceeds the configured node bound", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 2,
    });
    await nodes.createMany([knowledgeNode(0), knowledgeNode(1)]);
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 2,
      maxEntities: 2,
      maxRelations: 2,
    });
    const processor = createDocumentSemanticEnrichmentProcessor({
      checkpoints: createInMemoryDocumentSemanticExtractionCheckpointRepository(),
      graph,
      maxConcurrentBatches: 1,
      maxEntitiesPerNode: 1,
      maxNodesPerArtifact: 1,
      maxOutputTokens: 1,
      maxRelationsPerNode: 1,
      nodes,
      providerBatchSize: 1,
      providerFactory: () => semanticProvider(),
    });

    await expect(processor.process(await semanticJob())).rejects.toThrow(
      "node count exceeds maxNodesPerArtifact=1",
    );
    await expect(
      createJointSemanticGraphMaterializer({
        graph,
        maxEntitiesPerNode: 1,
        maxNodesPerArtifact: 1,
        maxRelationsPerNode: 1,
        nodes,
      }).materialize({
        createdAt,
        knowledgeSpaceId,
        parseArtifactId,
        publicationGenerationId,
        retrievalProfile: (await semanticJob()).retrievalProfile,
      }),
    ).rejects.toThrow("node count exceeds maxNodesPerArtifact=1");
  });

  it("batches 80 nodes into at most 20 requests, checkpoints them, and preserves published nodes", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 100,
      maxListLimit: 100,
      maxNodes: 100,
    });
    const originals = Array.from({ length: 80 }, (_, index) => knowledgeNode(index));
    await nodes.createMany(originals);
    const checkpoints = createInMemoryDocumentSemanticExtractionCheckpointRepository();
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 500,
      maxEntities: 500,
      maxRelations: 500,
    });
    const provider = semanticProvider();
    const processor = createDocumentSemanticEnrichmentProcessor({
      checkpoints,
      graph,
      maxConcurrentBatches: 4,
      maxEntitiesPerNode: 8,
      maxNodesPerArtifact: 100,
      maxOutputTokens: 1_500,
      maxRelationsPerNode: 8,
      nodes,
      now: () => createdAt,
      providerBatchSize: 8,
      providerFactory: () => provider,
    });
    const job = await semanticJob();

    await expect(processor.process(job)).resolves.toMatchObject({
      entitiesExtracted: 160,
      graphEntitiesIndexed: 160,
      graphRelationsIndexed: 80,
      nodesScanned: 80,
      semanticProviderCalls: 20,
      semanticProviderCallsMaximum: 20,
    });
    expect(provider.entityCalls).toBe(10);
    expect(provider.relationCalls).toBe(10);
    const graphEntities = await graph.listEntities({
      knowledgeSpaceId,
      limit: 200,
      publicationGenerationId,
    });
    expect(graphEntities.items).toHaveLength(160);

    const persisted = await nodes.listByArtifact({
      knowledgeSpaceId,
      limit: 100,
      parseArtifactId,
      publicationGenerationId,
    });
    expect(persisted.items).toEqual(originals);

    await expect(processor.process(job)).resolves.toMatchObject({
      graphEntitiesIndexed: 160,
      graphRelationsIndexed: 80,
      semanticProviderCalls: 0,
    });
    expect(provider.entityCalls).toBe(10);
    expect(provider.relationCalls).toBe(10);
  });

  it("resumes only missing semantic batches after a late provider failure", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 100,
      maxListLimit: 100,
      maxNodes: 100,
    });
    await nodes.createMany(Array.from({ length: 80 }, (_, index) => knowledgeNode(index)));
    const checkpoints = createInMemoryDocumentSemanticExtractionCheckpointRepository();
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 500,
      maxEntities: 500,
      maxRelations: 500,
    });
    const provider = semanticProvider({ failEntityCall: 4 });
    const processor = createDocumentSemanticEnrichmentProcessor({
      checkpoints,
      graph,
      maxConcurrentBatches: 1,
      maxEntitiesPerNode: 8,
      maxNodesPerArtifact: 100,
      maxOutputTokens: 1_500,
      maxRelationsPerNode: 8,
      nodes,
      now: () => createdAt,
      providerBatchSize: 8,
      providerFactory: () => provider,
    });
    const job = await semanticJob();

    await expect(processor.process(job)).rejects.toThrow("late semantic timeout");
    expect(provider.entityCalls).toBe(4);

    provider.failEntityCall = undefined;
    await expect(processor.process(job)).resolves.toMatchObject({
      nodesScanned: 80,
      semanticProviderCalls: 17,
      semanticProviderCallsMaximum: 20,
    });
    // Three completed entity batches are reused: 4 failed/first-run + 7 retry + 10 relations.
    expect(provider.entityCalls).toBe(11);
    expect(provider.relationCalls).toBe(10);
  });

  it("does not call the relation model for zero- or one-entity nodes", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    await nodes.createMany([knowledgeNode(0)]);
    const provider = semanticProvider({ entityCount: 1 });
    let gatedRequests = 0;
    const processor = createDocumentSemanticEnrichmentProcessor({
      checkpoints: createInMemoryDocumentSemanticExtractionCheckpointRepository(),
      graph: createInMemoryGraphIndexRepository({
        maxBatchSize: 10,
        maxEntities: 10,
        maxRelations: 10,
      }),
      maxConcurrentBatches: 1,
      maxEntitiesPerNode: 8,
      maxNodesPerArtifact: 10,
      maxOutputTokens: 1_500,
      maxRelationsPerNode: 8,
      modelRequestGate: {
        run: async (request) => {
          gatedRequests += 1;
          return request();
        },
      },
      nodes,
      now: () => createdAt,
      providerBatchSize: 8,
      providerFactory: () => provider,
    });

    await expect(processor.process(await semanticJob())).resolves.toMatchObject({
      semanticProviderCalls: 1,
      semanticProviderCallsMaximum: 1,
    });
    expect(provider.entityCalls).toBe(1);
    expect(provider.relationCalls).toBe(0);
    expect(gatedRequests).toBe(1);
  });

  it("fails closed when a checkpoint repository drops a completed batch", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    await nodes.createMany([knowledgeNode(0)]);
    const processor = createDocumentSemanticEnrichmentProcessor({
      checkpoints: {
        getMany: async () => [],
        putMany: async () => [],
      },
      graph: createInMemoryGraphIndexRepository({
        maxBatchSize: 2,
        maxEntities: 2,
        maxRelations: 2,
      }),
      maxConcurrentBatches: 1,
      maxEntitiesPerNode: 2,
      maxNodesPerArtifact: 1,
      maxOutputTokens: 1_500,
      maxRelationsPerNode: 2,
      nodes,
      providerBatchSize: 1,
      providerFactory: () => semanticProvider({ entityCount: 1 }),
    });

    await expect(processor.process(await semanticJob())).rejects.toThrow(
      "checkpoint is incomplete",
    );
  });

  it("rejects mixed, legacy, and frozen-model-mismatched semantic generations", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
    });
    const job = await semanticJob();
    const validJoint = await jointKnowledgeNode(job.retrievalProfile);
    const mixedNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    await mixedNodes.createMany([validJoint, knowledgeNode(1)]);
    const processorFor = (nodes: ReturnType<typeof createInMemoryKnowledgeNodeRepository>) =>
      createDocumentSemanticEnrichmentProcessor({
        checkpoints: createInMemoryDocumentSemanticExtractionCheckpointRepository(),
        graph,
        maxConcurrentBatches: 1,
        maxEntitiesPerNode: 8,
        maxNodesPerArtifact: 10,
        maxOutputTokens: 1_500,
        maxRelationsPerNode: 8,
        nodes,
        providerBatchSize: 8,
        providerFactory: () => semanticProvider(),
      });

    await expect(processorFor(mixedNodes).process(job)).rejects.toThrow(
      "refuses a mixed joint/legacy node generation",
    );

    const legacyNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    await legacyNodes.createMany([knowledgeNode(0)]);
    await expect(
      createJointSemanticGraphMaterializer({
        graph,
        maxEntitiesPerNode: 8,
        maxNodesPerArtifact: 10,
        maxRelationsPerNode: 8,
        nodes: legacyNodes,
      }).materialize({
        createdAt,
        knowledgeSpaceId,
        parseArtifactId,
        publicationGenerationId,
        retrievalProfile: job.retrievalProfile,
      }),
    ).rejects.toThrow("refuses a legacy or invalid node generation");

    const otherProfile: KnowledgeSpaceRetrievalProfile = {
      ...job.retrievalProfile,
      reasoningModel: { model: "other", pluginId: "other-plugin", provider: "other-provider" },
    };
    const mismatchedJoint = await jointKnowledgeNode(otherProfile);
    const mismatchedNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    await mismatchedNodes.createMany([mismatchedJoint]);
    await expect(processorFor(mismatchedNodes).process(job)).rejects.toThrow(
      "joint metadata does not match the frozen reasoning model",
    );
    await expect(
      createJointSemanticGraphMaterializer({
        graph,
        maxEntitiesPerNode: 8,
        maxNodesPerArtifact: 10,
        maxRelationsPerNode: 8,
        nodes: mismatchedNodes,
      }).materialize({
        createdAt,
        knowledgeSpaceId,
        parseArtifactId,
        publicationGenerationId,
        retrievalProfile: job.retrievalProfile,
      }),
    ).rejects.toThrow("metadata does not match the frozen reasoning model");
  });

  it("indexes joint semantic-chunk metadata without a second model request", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    let chunkingCalls = 0;
    const semanticNodes = await createLlmSemanticChunker({
      now: () => createdAt,
      reasoningProviderFactory: () => ({
        kind: "plugin-daemon",
        async *stream(input) {
          chunkingCalls += 1;
          const user = input.messages.find((message) => message.role === "user");
          const payload = JSON.parse(user?.content ?? "{}") as {
            units: Array<{ id: string }>;
          };
          yield {
            delta: JSON.stringify({
              chunks: [
                {
                  endUnitId: payload.units.at(-1)?.id,
                  entities: [
                    { confidence: 0.98, id: "acme", text: "Acme", type: "organization" },
                    { confidence: 0.97, id: "policy", text: "policy", type: "policy" },
                  ],
                  relations: [
                    {
                      confidence: 0.96,
                      objectEntityId: "policy",
                      subjectEntityId: "acme",
                      type: "references",
                    },
                  ],
                  sectionPath: ["Guide", "Renewal"],
                  sectionSummary: "Acme renewal policy.",
                  startUnitId: payload.units[0]?.id,
                },
              ],
            }),
            type: "delta" as const,
          };
          yield {
            finishReason: "stop",
            metadata: { model: input.model, provider: "plugin-daemon" },
            type: "done" as const,
          };
        },
      }),
    }).chunk({
      knowledgeSpaceId,
      parseArtifact: ParseArtifactSchema.parse({
        artifactHash: "a".repeat(64),
        contentType: "text",
        createdAt,
        documentAssetId,
        elements: [
          {
            id: "element-1",
            metadata: {},
            sectionPath: ["Guide"],
            text: "Acme follows the renewal policy.",
            type: "paragraph",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "native-markdown",
        version: 1,
      }),
      publicationGenerationId,
      retrievalProfile: (await semanticJob()).retrievalProfile,
      tenantId,
    });
    await nodes.createMany(semanticNodes);
    let enrichmentFactoryCalls = 0;
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
    });
    const processor = createDocumentSemanticEnrichmentProcessor({
      checkpoints: createInMemoryDocumentSemanticExtractionCheckpointRepository(),
      graph,
      maxConcurrentBatches: 1,
      maxEntitiesPerNode: 8,
      maxNodesPerArtifact: 10,
      maxOutputTokens: 1_500,
      maxRelationsPerNode: 8,
      nodes,
      now: () => createdAt,
      providerBatchSize: 8,
      providerFactory: () => {
        enrichmentFactoryCalls += 1;
        throw new Error("joint semantic nodes must not invoke enrichment provider");
      },
    });

    await expect(processor.process(await semanticJob())).resolves.toMatchObject({
      entitiesExtracted: 2,
      graphEntitiesIndexed: 2,
      graphRelationsIndexed: 1,
      semanticProviderCalls: 0,
      semanticProviderCallsMaximum: 0,
    });
    expect(chunkingCalls).toBe(1);
    expect(enrichmentFactoryCalls).toBe(0);
    await expect(
      createJointSemanticGraphMaterializer({
        graph,
        maxEntitiesPerNode: 8,
        maxNodesPerArtifact: 10,
        maxRelationsPerNode: 8,
        nodes,
        now: () => createdAt,
      }).materialize({
        createdAt,
        knowledgeSpaceId,
        parseArtifactId,
        publicationGenerationId,
        retrievalProfile: (await semanticJob()).retrievalProfile,
      }),
    ).resolves.toMatchObject({
      graphEntityIds: [expect.any(String), expect.any(String)],
      graphRelationIds: [expect.any(String)],
      semanticProviderCalls: 0,
    });
  });
});

function semanticProvider(options: { entityCount?: number; failEntityCall?: number } = {}) {
  const provider = {
    entityCalls: 0,
    failEntityCall: options.failEntityCall,
    relationCalls: 0,
    generate: async (input: {
      readonly messages: readonly { readonly content: string; readonly role: string }[];
    }) => {
      const system = input.messages.find((message) => message.role === "system")?.content ?? "";
      const raw = input.messages.find((message) => message.role === "user")?.content ?? "{}";
      const payload = JSON.parse(raw) as {
        nodes?: readonly {
          readonly entities?: readonly { readonly text: string }[];
          readonly nodeId: string;
        }[];
      };
      const items = payload.nodes ?? [];
      if (system.includes("relations")) {
        provider.relationCalls += 1;
        return {
          text: JSON.stringify({
            nodes: items.map((item) => ({
              nodeId: item.nodeId,
              relations:
                (item.entities?.length ?? 0) >= 2
                  ? [
                      {
                        confidence: 0.95,
                        object: item.entities?.[1]?.text,
                        subject: item.entities?.[0]?.text,
                        type: "references",
                      },
                    ]
                  : [],
            })),
          }),
        };
      }
      provider.entityCalls += 1;
      if (provider.failEntityCall === provider.entityCalls) {
        throw new Error("late semantic timeout");
      }
      const entityCount = options.entityCount ?? 2;
      return {
        text: JSON.stringify({
          nodes: items.map((item) => ({
            entities: Array.from({ length: entityCount }, (_, index) => ({
              confidence: 0.95,
              text: `${index === 0 ? "Organization" : "Policy"}-${item.nodeId}`,
              type: index === 0 ? "organization" : "policy",
            })),
            nodeId: item.nodeId,
          })),
        }),
      };
    },
  };
  return provider;
}

async function jointKnowledgeNode(
  retrievalProfile: KnowledgeSpaceRetrievalProfile,
): Promise<KnowledgeNode> {
  const nodes = await createLlmSemanticChunker({
    now: () => createdAt,
    reasoningProviderFactory: () => ({
      kind: "plugin-daemon",
      async *stream(input) {
        const user = input.messages.find((message) => message.role === "user");
        const payload = JSON.parse(user?.content ?? "{}") as {
          units: Array<{ id: string }>;
        };
        yield {
          delta: JSON.stringify({
            chunks: [
              {
                endUnitId: payload.units.at(-1)?.id,
                entities: [
                  { confidence: 0.98, id: "acme", text: "Acme", type: "organization" },
                  { confidence: 0.97, id: "policy", text: "policy", type: "policy" },
                ],
                relations: [
                  {
                    confidence: 0.96,
                    objectEntityId: "policy",
                    subjectEntityId: "acme",
                    type: "references",
                  },
                ],
                startUnitId: payload.units[0]?.id,
              },
            ],
          }),
          type: "delta" as const,
        };
        yield {
          finishReason: "stop",
          metadata: { model: input.model, provider: "plugin-daemon" },
          type: "done" as const,
        };
      },
    }),
  }).chunk({
    knowledgeSpaceId,
    parseArtifact: ParseArtifactSchema.parse({
      artifactHash: "a".repeat(64),
      contentType: "text",
      createdAt,
      documentAssetId,
      elements: [
        {
          id: "joint-element",
          metadata: {},
          sectionPath: ["Guide"],
          text: "Acme follows the renewal policy.",
          type: "paragraph",
        },
      ],
      id: parseArtifactId,
      metadata: {},
      parser: "native-markdown",
      version: 1,
    }),
    publicationGenerationId,
    retrievalProfile,
    tenantId,
  });
  const node = nodes[0];
  if (!node) throw new Error("joint semantic node fixture is empty");
  return node;
}

async function semanticJob() {
  const repository = createInMemoryDocumentSemanticEnrichmentRepository({
    generateLeaseToken: () => uuid(99),
  });
  return repository.enqueue({
    availableAt: createdAt,
    baseHeadRevision: 7,
    compilationAttemptId: uuid(6),
    createdAt,
    documentAssetId,
    documentVersion: 1,
    id: uuid(10),
    knowledgeSpaceId,
    maxExecutionAttempts: 3,
    parseArtifactId,
    publicationGenerationId,
    retrievalProfile: {
      defaultMode: "research",
      reasoningModel: { model: "reasoning", pluginId: "plugin", provider: "provider" },
      rerank: { enabled: false },
      revision: 1,
      scoreThreshold: { enabled: false, stage: "mode-final" },
      topK: 10,
    },
    tenantId,
  });
}

function knowledgeNode(index: number): KnowledgeNode {
  const startOffset = index * 100;
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId,
    endOffset: startOffset + 50,
    id: uuid(1_000 + index),
    kind: "chunk",
    knowledgeSpaceId,
    metadata: { chunkIndex: index },
    parseArtifactId,
    permissionScope: [tenantId],
    publicationGenerationId,
    sourceLocation: {
      endOffset: startOffset + 50,
      sectionPath: ["Guide", `Section ${index}`],
      startOffset,
    },
    startOffset,
    text: `Acme organization follows renewal policy in section ${index}.`,
  });
}

function uuid(value: number): string {
  return `018f0d60-7a49-7cc2-9c1b-${value.toString().padStart(12, "0")}`;
}
