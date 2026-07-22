import {
  KnowledgeNodeSchema,
  PUBLICATION_GENERATION_ID_SENTINEL,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type EntityExtractionProvider,
  createEntityExtractionFlow,
} from "./entity-extraction-flow";
import { createExtractionQualityControlFlow } from "./extraction-quality-control-flow";
import { createInMemoryGraphIndexRepository } from "./graph-index-repository";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createSemanticIngestionPostProcessor } from "./semantic-ingestion-postprocessor";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("createSemanticIngestionPostProcessor", () => {
  it("extracts provider entities for a parsed artifact and indexes graph entities", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => "2026-05-29T00:00:00.000Z",
    });
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "a".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 65,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        kind: "chunk",
        knowledgeSpaceId,
        metadata: {},
        parseArtifactId,
        permissionScope: ["tenant-1"],
        sourceLocation: { endOffset: 65, sectionPath: ["Overview"], startOffset: 0 },
        startOffset: 0,
        text: "Acme Corp ships Atlas Search under the Renewal Policy.",
      }),
    ]);
    const provider = createRecordingEntityProvider();
    const processor = createSemanticIngestionPostProcessor({
      entityExtraction: createEntityExtractionFlow({
        maxBatchSize: 10,
        maxEntitiesPerNode: 5,
        model: "entity-llm",
        nodes,
        now: () => "2026-05-29T00:00:00.000Z",
        provider,
      }),
      extractionQuality: createExtractionQualityControlFlow({
        maxBatchSize: 10,
        nodes,
        now: () => "2026-05-29T00:00:00.000Z",
      }),
      graph,
      maxNodesPerArtifact: 10,
      nodes,
    });

    const result = await processor.process({
      knowledgeSpaceId,
      parseArtifact: ParseArtifactSchema.parse({
        artifactHash: "a".repeat(64),
        contentType: "text",
        createdAt: "2026-05-29T00:00:00.000Z",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        elements: [],
        id: parseArtifactId,
        metadata: {},
        parser: "native-markdown",
        version: 1,
      }),
      traceId: "trace-semantic-ingestion-1",
    });

    expect(result).toMatchObject({
      entitiesExtracted: 2,
      graphEntityIds: [expect.any(String), expect.any(String)],
      graphEntitiesIndexed: 2,
      graphRelationIds: [],
      nodesScanned: 1,
      nodesUpdated: 1,
      parseArtifactId,
    });
    expect(provider.calls).toHaveLength(1);
    await expect(graph.listEntities({ knowledgeSpaceId, limit: 10 })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ traceId: "trace-semantic-ingestion-1" }),
          name: "Acme Corp",
          type: "organization",
        }),
      ]),
    });
  });

  it("isolates generation-scoped semantic metadata and graph writes from legacy reads", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => "2026-05-29T00:00:00.000Z",
    });
    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80";
    const node = semanticNode("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", 0, publicationGenerationId);
    await nodes.createMany([node]);
    const communityCalls: unknown[] = [];
    const processor = createSemanticIngestionPostProcessor({
      communityMaterializer: {
        materialize: async (input) => {
          communityCalls.push(input);

          return {
            communityCount: 1,
            documentCount: 1,
            entityCount: 1,
            generatedVersion: "ingestion-community-view-v1",
            knowledgeSpaceId,
            pathCount: 1,
            paths: [],
          };
        },
      },
      entityExtraction: createEntityExtractionFlow({
        maxBatchSize: 10,
        maxEntitiesPerNode: 5,
        model: "entity-llm",
        nodes,
        provider: createRecordingEntityProvider(),
      }),
      extractionQuality: createExtractionQualityControlFlow({
        maxBatchSize: 10,
        nodes,
      }),
      graph,
      maxNodesPerArtifact: 10,
      nodes,
    });
    await expect(
      processor.process({
        knowledgeSpaceId,
        parseArtifact: { id: parseArtifactId },
        publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow();
    await expect(
      processor.process({
        knowledgeSpaceId,
        parseArtifact: { id: parseArtifactId },
        publicationGenerationId,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      graphEntitiesIndexed: 2,
      nodesScanned: 1,
      nodesUpdated: 1,
      semanticCommunitiesMaterialized: 0,
    });
    expect(communityCalls).toEqual([]);
    await expect(nodes.get({ id: node.id, knowledgeSpaceId })).resolves.toBeNull();
    const storedNode = await nodes.get({
      id: node.id,
      knowledgeSpaceId,
      publicationGenerationId,
    });
    expect(storedNode?.metadata).toMatchObject({
      entityExtraction: expect.any(Object),
      extractedEntities: expect.any(Array),
      extractionQuality: expect.any(Object),
    });
    await expect(
      graph.listEntities({ knowledgeSpaceId, limit: 10, publicationGenerationId }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({ publicationGenerationId }),
        expect.objectContaining({ publicationGenerationId }),
      ],
    });
    await expect(graph.listEntities({ knowledgeSpaceId, limit: 10 })).resolves.toMatchObject({
      items: [],
    });
  });

  it("rejects artifacts that exceed the configured node bound", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 2,
      maxNodes: 10,
    });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
    });
    await nodes.createMany([
      semanticNode("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", 0),
      semanticNode("018f0d60-7a49-7cc2-9c1b-5b36f18f2c52", 10),
    ]);
    const processor = createSemanticIngestionPostProcessor({
      entityExtraction: createEntityExtractionFlow({
        maxBatchSize: 1,
        model: "entity-llm",
        nodes,
        provider: createRecordingEntityProvider(),
      }),
      extractionQuality: createExtractionQualityControlFlow({
        maxBatchSize: 1,
        nodes,
      }),
      graph,
      maxNodesPerArtifact: 1,
      nodes,
    });

    await expect(
      processor.process({
        knowledgeSpaceId,
        parseArtifact: { id: parseArtifactId },
      }),
    ).rejects.toThrow("Semantic ingestion node count exceeds maxNodesPerArtifact=1");
  });
});

function createRecordingEntityProvider(): EntityExtractionProvider & {
  readonly calls: Parameters<EntityExtractionProvider["extract"]>[0][];
} {
  const calls: Parameters<EntityExtractionProvider["extract"]>[0][] = [];

  return {
    calls,
    extract: async (input) => {
      calls.push(input);

      return {
        entities: [
          {
            confidence: 0.97,
            metadata: { canonicalName: "Acme Corp" },
            text: "Acme Corp",
            type: "organization",
          },
          { confidence: 0.93, text: "Atlas Search", type: "product" },
        ],
        metadata: { provider: "llm-test" },
      };
    },
  };
}

function semanticNode(id: string, startOffset: number, publicationGenerationId?: string) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    endOffset: startOffset + 9,
    id,
    kind: "chunk",
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId,
    permissionScope: ["tenant-1"],
    ...(publicationGenerationId ? { publicationGenerationId } : {}),
    sourceLocation: {
      endOffset: startOffset + 9,
      sectionPath: ["Overview"],
      startOffset,
    },
    startOffset,
    text: `Acme ${startOffset}`,
  });
}
