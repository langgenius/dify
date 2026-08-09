import { type KnowledgeNode, KnowledgeNodeSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDocumentSemanticEnrichmentProcessor } from "./document-semantic-enrichment-processor";
import {
  createInMemoryDocumentSemanticEnrichmentRepository,
  createInMemoryDocumentSemanticExtractionCheckpointRepository,
} from "./document-semantic-enrichment-repository";
import { createInMemoryGraphIndexRepository } from "./graph-index-repository";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = uuid(1);
const documentAssetId = uuid(2);
const parseArtifactId = uuid(3);
const publicationGenerationId = uuid(4);
const createdAt = "2026-08-09T10:00:00.000Z";

describe("createDocumentSemanticEnrichmentProcessor", () => {
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
