import {
  KnowledgeNodeSchema,
  type KnowledgeSpaceModelSelection,
  createDefaultKnowledgeSpaceManifest,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createInMemoryGraphIndexRepository } from "./graph-index-repository";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createKnowledgeSpaceSemanticIngestionPostProcessor } from "./knowledge-space-semantic-ingestion-postprocessor";
import type { EntityExtractionTextProvider } from "./llm-entity-extraction-provider";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const OTHER_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const PARSE_ARTIFACT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("knowledge-space semantic ingestion postprocessor", () => {
  it("uses the frozen space reasoning model for entity and relation graph indexing", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => "2026-07-30T00:00:00.000Z",
    });
    await nodes.createMany([
      semanticNode({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        knowledgeSpaceId: SPACE_ID,
      }),
    ]);
    const manifestGet = vi.fn(async () => {
      throw new Error("mutable manifest must not be read");
    });
    const providerFactory = vi.fn((_selection: KnowledgeSpaceModelSelection) =>
      graphExtractionProvider(),
    );
    const processor = createKnowledgeSpaceSemanticIngestionPostProcessor({
      graph,
      manifests: { get: manifestGet },
      maxEntitiesPerNode: 5,
      maxNodesPerArtifact: 10,
      maxOutputTokens: 256,
      maxRelationsPerNode: 5,
      nodes,
      now: () => "2026-07-30T00:00:00.000Z",
      providerFactory,
    });
    const retrievalProfile = {
      defaultMode: "research" as const,
      reasoningModel: {
        model: "frozen-reasoning-model",
        pluginId: "vendor/chat",
        provider: "vendor",
      },
      rerank: { enabled: false },
      revision: 7,
      scoreThreshold: { enabled: false, stage: "mode-final" as const },
      topK: 12,
    };

    await expect(
      processor.process({
        knowledgeSpaceId: SPACE_ID,
        parseArtifact: { id: PARSE_ARTIFACT_ID },
        retrievalProfile,
        tenantId: "tenant-1",
        traceId: "trace-frozen-profile",
      }),
    ).resolves.toMatchObject({
      entitiesExtracted: 2,
      graphEntitiesIndexed: 2,
      graphRelationsIndexed: 1,
      nodesScanned: 1,
      nodesUpdated: 1,
    });

    expect(manifestGet).not.toHaveBeenCalled();
    expect(providerFactory).toHaveBeenCalledOnce();
    expect(providerFactory).toHaveBeenCalledWith(retrievalProfile.reasoningModel);
    await expect(
      nodes.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        knowledgeSpaceId: SPACE_ID,
      }),
    ).resolves.toMatchObject({
      metadata: {
        entityExtraction: { model: "frozen-reasoning-model" },
        relationExtraction: { model: "frozen-reasoning-model" },
      },
    });
    await expect(
      graph.listEntities({ knowledgeSpaceId: SPACE_ID, limit: 10 }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ name: "Acme Corp", type: "organization" }),
        expect.objectContaining({ name: "Atlas Search", type: "product" }),
      ]),
    });
  });

  it("resolves each space's reasoning model independently from its manifest", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 20,
      maxRelations: 20,
    });
    await nodes.createMany([
      semanticNode({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        knowledgeSpaceId: SPACE_ID,
      }),
      semanticNode({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        knowledgeSpaceId: OTHER_SPACE_ID,
      }),
    ]);
    const selections = new Map<string, KnowledgeSpaceModelSelection>([
      [SPACE_ID, { model: "space-a-reasoning", pluginId: "vendor/chat-a", provider: "vendor-a" }],
      [
        OTHER_SPACE_ID,
        { model: "space-b-reasoning", pluginId: "vendor/chat-b", provider: "vendor-b" },
      ],
    ]);
    const providerFactory = vi.fn((selection: KnowledgeSpaceModelSelection) =>
      modelAwareEntityProvider(selection.model),
    );
    const processor = createKnowledgeSpaceSemanticIngestionPostProcessor({
      graph,
      manifests: {
        get: async ({ knowledgeSpaceId, tenantId }) => {
          const reasoningModel = selections.get(knowledgeSpaceId);

          return reasoningModel
            ? {
                ...createDefaultKnowledgeSpaceManifest({
                  createdAt: "2026-07-30T00:00:00.000Z",
                  id:
                    knowledgeSpaceId === SPACE_ID
                      ? "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60"
                      : "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
                  knowledgeSpaceId,
                  tenantId,
                  updatedAt: "2026-07-30T00:00:00.000Z",
                }),
                retrievalProfile: {
                  defaultMode: "research",
                  reasoningModel,
                  rerank: { enabled: false },
                  revision: 1,
                  scoreThreshold: { enabled: false, stage: "mode-final" },
                  topK: 5,
                },
              }
            : null;
        },
      },
      maxEntitiesPerNode: 5,
      maxNodesPerArtifact: 10,
      maxOutputTokens: 256,
      maxRelationsPerNode: 5,
      nodes,
      providerFactory,
    });

    for (const knowledgeSpaceId of [SPACE_ID, OTHER_SPACE_ID]) {
      await processor.process({
        knowledgeSpaceId,
        parseArtifact: { id: PARSE_ARTIFACT_ID },
        tenantId: "tenant-1",
      });
    }

    expect(providerFactory.mock.calls.map(([selection]) => selection.model)).toEqual([
      "space-a-reasoning",
      "space-b-reasoning",
    ]);
    await expect(
      nodes.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        knowledgeSpaceId: SPACE_ID,
      }),
    ).resolves.toMatchObject({
      metadata: { entityExtraction: { model: "space-a-reasoning" } },
    });
    await expect(
      nodes.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        knowledgeSpaceId: OTHER_SPACE_ID,
      }),
    ).resolves.toMatchObject({
      metadata: { entityExtraction: { model: "space-b-reasoning" } },
    });
  });

  it("fails closed when profile resolution lacks tenant scope", async () => {
    const processor = createKnowledgeSpaceSemanticIngestionPostProcessor({
      graph: createInMemoryGraphIndexRepository({
        maxBatchSize: 10,
        maxEntities: 10,
        maxRelations: 10,
      }),
      manifests: { get: async () => null },
      maxEntitiesPerNode: 5,
      maxNodesPerArtifact: 10,
      maxOutputTokens: 256,
      maxRelationsPerNode: 5,
      nodes: createInMemoryKnowledgeNodeRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxNodes: 10,
      }),
      providerFactory: () => graphExtractionProvider(),
    });

    await expect(
      processor.process({
        knowledgeSpaceId: SPACE_ID,
        parseArtifact: { id: PARSE_ARTIFACT_ID },
      }),
    ).rejects.toThrow("requires a tenant scope");
  });

  it("fails closed when the space has no configured reasoning model", async () => {
    const processor = createKnowledgeSpaceSemanticIngestionPostProcessor({
      graph: createInMemoryGraphIndexRepository({
        maxBatchSize: 10,
        maxEntities: 10,
        maxRelations: 10,
      }),
      manifests: { get: async () => null },
      maxEntitiesPerNode: 5,
      maxNodesPerArtifact: 10,
      maxOutputTokens: 256,
      maxRelationsPerNode: 5,
      nodes: createInMemoryKnowledgeNodeRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxNodes: 10,
      }),
      providerFactory: () => graphExtractionProvider(),
    });

    await expect(
      processor.process({
        knowledgeSpaceId: SPACE_ID,
        parseArtifact: { id: PARSE_ARTIFACT_ID },
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("requires a configured reasoning model");
  });
});

function graphExtractionProvider(): EntityExtractionTextProvider {
  return {
    kind: "plugin-daemon",
    generate: async (input) => ({
      model: input.model,
      text: input.messages[0]?.content.includes("graph relations")
        ? JSON.stringify({
            relations: [
              {
                confidence: 0.91,
                object: "Atlas Search",
                subject: "Acme Corp",
                type: "references",
              },
            ],
          })
        : JSON.stringify({
            entities: [
              {
                canonicalName: "Acme Corp",
                confidence: 0.97,
                text: "Acme Corp",
                type: "organization",
              },
              {
                confidence: 0.94,
                text: "Atlas Search",
                type: "product",
              },
            ],
          }),
    }),
  };
}

function modelAwareEntityProvider(model: string): EntityExtractionTextProvider {
  return {
    generate: async (input) => ({
      model: input.model,
      text: input.messages[0]?.content.includes("graph relations")
        ? JSON.stringify({ relations: [] })
        : JSON.stringify({
            entities: [
              {
                confidence: 0.95,
                text: `${model} entity`,
                type: "term",
              },
            ],
          }),
    }),
  };
}

function semanticNode({
  id,
  knowledgeSpaceId,
}: {
  readonly id: string;
  readonly knowledgeSpaceId: string;
}) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
    endOffset: 49,
    id,
    kind: "chunk",
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId: PARSE_ARTIFACT_ID,
    permissionScope: ["tenant-1"],
    sourceLocation: {
      endOffset: 49,
      sectionPath: ["Overview"],
      startOffset: 0,
    },
    startOffset: 0,
    text: "Acme Corp ships Atlas Search for enterprise retrieval.",
  });
}
