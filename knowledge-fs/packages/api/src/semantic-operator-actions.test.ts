import { KnowledgeNodeSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import {
  type EntityExtractionProvider,
  createEntityExtractionFlow,
} from "./entity-extraction-flow";
import { createInMemoryGraphIndexRepository } from "./graph-index-repository";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createInMemoryKnowledgePathRepository } from "./knowledge-path-repository";
import { createSemanticOperator } from "./semantic-operator-actions";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const tenantId = "tenant-1";

describe("createSemanticOperator", () => {
  it("materializes uploaded documents into an explicit topic view", async () => {
    const { assets, graph, nodes, paths } = createRepositories();
    const generatedPathIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c98",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
    ];
    await assets.create({
      filename: "Renewal Policy.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/renewal-policy.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const operator = createSemanticOperator({
      assets,
      generatePathId: () => generatedPathIds.shift() ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f2c9a",
      graph,
      maxDocumentsPerRun: 1,
      maxNodesPerRun: 1,
      nodes,
      now: () => "2026-05-28T00:00:00.000Z",
      paths,
    });

    const result = await operator.materializeTopicView({
      generatedVersion: "operator-topic-view-v2",
      knowledgeSpaceId,
      limit: 1,
      tenantId,
      topicName: "Renewal Risk",
      topicSlug: "renewal-risk",
    });

    expect(result).toMatchObject({
      documentCount: 1,
      generatedVersion: "operator-topic-view-v2",
      pathCount: 1,
      topicName: "Renewal Risk",
      topicSlug: "renewal-risk",
    });
    expect(result.paths[0]).toMatchObject({
      metadata: {
        semanticView: {
          generatedVersion: "operator-topic-view-v2",
          operatorAction: "topic-materialize",
        },
      },
      virtualPath: "/knowledge/by-topic/renewal-risk/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    });
    await expect(
      paths.get({
        knowledgeSpaceId,
        virtualPath: "/knowledge/docs/Renewal-Policy.md--018f0d60",
      }),
    ).resolves.toMatchObject({
      metadata: { filename: "Renewal Policy.md" },
      resourceType: "document",
      viewName: "docs",
      viewType: "physical",
    });
    await expect(
      operator.materializeTopicView({
        knowledgeSpaceId,
        limit: 2,
        tenantId,
      }),
    ).rejects.toThrow("Semantic topic materialization limit exceeds maxDocumentsPerRun=1");
  });

  it("does not fall back to bootstrap extraction when no LLM provider is configured", async () => {
    const { assets, graph, nodes, paths } = createRepositories();
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "b".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 67,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        kind: "chunk",
        knowledgeSpaceId,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        permissionScope: [tenantId],
        sourceLocation: { endOffset: 67, sectionPath: ["Renewal"], startOffset: 0 },
        startOffset: 0,
        text: "Acme Renewal Policy requires 95% coverage by 2026 for renewal operations, not raw counters 0 04 10.",
      }),
    ]);
    const operator = createSemanticOperator({
      assets,
      generatePathId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      graph,
      maxDocumentsPerRun: 1,
      maxNodesPerRun: 1,
      nodes,
      now: () => "2026-05-28T00:00:00.000Z",
      paths,
    });

    await expect(
      operator.extractEntities({
        knowledgeSpaceId,
        limit: 1,
        tenantId,
        traceId: "trace-semantic-1",
      }),
    ).rejects.toThrow("Semantic entity extraction requires an LLM provider");
    await expect(graph.listEntities({ knowledgeSpaceId, limit: 10 })).resolves.toEqual({
      items: [],
    });
    await expect(
      operator.extractEntities({
        knowledgeSpaceId,
        limit: 2,
        tenantId,
      }),
    ).rejects.toThrow("Semantic entity extraction limit exceeds maxNodesPerRun=1");
  });

  it("prefers configured provider entity extraction before graph indexing", async () => {
    const { assets, graph, nodes, paths } = createRepositories();
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: "c".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 79,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        kind: "chunk",
        knowledgeSpaceId,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        permissionScope: [tenantId],
        sourceLocation: { endOffset: 79, sectionPath: ["Roadmap"], startOffset: 0 },
        startOffset: 0,
        text: "Acme Corp ships Atlas Search under the Renewal Policy on 2026-05-28.",
      }),
    ]);
    const provider = createRecordingEntityProvider();
    const operator = createSemanticOperator({
      assets,
      entityExtraction: createEntityExtractionFlow({
        maxBatchSize: 1,
        maxEntitiesPerNode: 5,
        model: "entity-llm",
        nodes,
        now: () => "2026-05-28T01:00:00.000Z",
        provider,
      }),
      generatePathId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      graph,
      maxDocumentsPerRun: 1,
      maxNodesPerRun: 1,
      nodes,
      now: () => "2026-05-28T01:00:00.000Z",
      paths,
    });

    const result = await operator.extractEntities({
      knowledgeSpaceId,
      limit: 1,
      tenantId,
      traceId: "trace-provider-1",
    });

    expect(result).toMatchObject({
      entitiesExtracted: 3,
      extractionMode: "provider",
      graphEntitiesIndexed: 3,
      nodesScanned: 1,
      nodesUpdated: 1,
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      maxEntities: 5,
      model: "entity-llm",
      promptVersion: "entity-extraction-v1",
    });
    const updatedNode = await nodes.get({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      knowledgeSpaceId,
    });
    expect(updatedNode).toMatchObject({
      metadata: {
        entityExtraction: {
          model: "entity-llm",
          provider: "llm-test",
          traceId: "trace-provider-1",
        },
        extractionQuality: {
          eligibleEntities: 3,
          traceId: "trace-provider-1",
        },
      },
    });
    expect(JSON.stringify(updatedNode?.metadata)).not.toContain("operator-bootstrap");
    await expect(graph.listEntities({ knowledgeSpaceId, limit: 10 })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "Acme Corp",
          type: "organization",
        }),
      ]),
    });
  });

  it("performs no semantic writes when the bounded corpus contains hidden content", async () => {
    const { assets, graph, nodes, paths } = createRepositories();
    const visibleAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61";
    const hiddenAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62";
    const visibleNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c71";
    const hiddenNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c72";
    for (const [id, filename, permissionScope] of [
      [visibleAssetId, "Visible.md", ["member:visible"]],
      [hiddenAssetId, "Hidden.md", ["member:hidden"]],
    ] as const) {
      await assets.create({
        filename,
        id,
        knowledgeSpaceId,
        metadata: { permissionScope },
        mimeType: "text/markdown",
        objectKey: `objects/${id}`,
        sha256: "d".repeat(64),
        sizeBytes: 1,
      });
    }
    await nodes.createMany([
      semanticNode({
        documentAssetId: visibleAssetId,
        id: visibleNodeId,
        permissionScope: ["member:visible"],
        text: "Visible Acme policy",
      }),
      semanticNode({
        documentAssetId: hiddenAssetId,
        id: hiddenNodeId,
        permissionScope: ["member:hidden"],
        text: "Hidden merger plan",
      }),
    ]);
    await graph.upsertEntities([
      {
        aliases: [],
        canonicalKey: "organization:shared-acme",
        confidence: 1,
        createdAt: "2026-05-28T00:00:00.000Z",
        extractionVersion: 1,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
        knowledgeSpaceId,
        metadata: { existing: true },
        name: "Shared Acme",
        permissionScope: ["member:visible", "member:hidden"],
        sourceNodeIds: [visibleNodeId, hiddenNodeId],
        type: "organization",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    ]);
    const graphBefore = await graph.listEntities({ knowledgeSpaceId, limit: 10 });
    const provider = createRecordingEntityProvider();
    const operator = createSemanticOperator({
      assets,
      entityExtraction: createEntityExtractionFlow({
        maxBatchSize: 10,
        maxEntitiesPerNode: 5,
        model: "entity-llm",
        nodes,
        provider,
      }),
      generatePathId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      graph,
      maxDocumentsPerRun: 10,
      maxNodesPerRun: 10,
      nodes,
      paths,
    });

    await expect(
      operator.materializeTopicView({
        candidateGrants: ["member:visible"],
        knowledgeSpaceId,
        limit: 10,
        tenantId,
      }),
    ).rejects.toThrow("Semantic mutation requires visibility over the complete candidate corpus");
    await expect(
      operator.extractEntities({
        candidateGrants: ["member:visible"],
        knowledgeSpaceId,
        limit: 10,
        tenantId,
      }),
    ).rejects.toThrow("Semantic mutation requires visibility over the complete candidate corpus");

    expect(provider.calls).toEqual([]);
    await expect(graph.listEntities({ knowledgeSpaceId, limit: 10 })).resolves.toEqual(graphBefore);
    await expect(
      paths.listSemanticDescendants({
        knowledgeSpaceId,
        limit: 10,
        parentPath: "/knowledge/by-topic",
        viewName: "by-topic",
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(nodes.get({ id: hiddenNodeId, knowledgeSpaceId })).resolves.toMatchObject({
      metadata: {},
    });
  });

  it("returns zero-count results for empty repositories and validates operator bounds", async () => {
    const { assets, graph, nodes, paths } = createRepositories();
    const operator = createSemanticOperator({
      assets,
      generatePathId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      graph,
      maxDocumentsPerRun: 10,
      maxNodesPerRun: 10,
      nodes,
      paths,
    });

    await expect(
      operator.materializeTopicView({
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({
      documentCount: 0,
      pathCount: 0,
      topicSlug: "uploaded-documents",
    });
    await expect(
      operator.extractEntities({
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({
      entitiesExtracted: 0,
      graphEntitiesIndexed: 0,
      graphRelationsIndexed: 0,
      nodesScanned: 0,
      nodesUpdated: 0,
    });
    expect(() =>
      createSemanticOperator({
        assets,
        generatePathId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        graph,
        maxDocumentsPerRun: 0,
        maxNodesPerRun: 10,
        nodes,
        paths,
      }),
    ).toThrow("Semantic operator maxDocumentsPerRun must be at least 1");
    expect(() =>
      createSemanticOperator({
        assets,
        generatePathId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        graph,
        maxDocumentsPerRun: 10,
        maxNodesPerRun: 0,
        nodes,
        paths,
      }),
    ).toThrow("Semantic operator maxNodesPerRun must be at least 1");
  });
});

function createRepositories() {
  return {
    assets: createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-28T00:00:00.000Z",
    }),
    graph: createInMemoryGraphIndexRepository({
      maxBatchSize: 20,
      maxEntities: 20,
      maxRelations: 20,
      now: () => "2026-05-28T00:00:00.000Z",
    }),
    nodes: createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    }),
    paths: createInMemoryKnowledgePathRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxPaths: 10,
    }),
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
        entities: [
          {
            confidence: 0.97,
            metadata: { canonicalName: "Acme Corp" },
            text: "Acme Corp",
            type: "organization",
          },
          { confidence: 0.93, text: "Atlas Search", type: "product" },
          { confidence: 0.91, text: "Renewal Policy", type: "policy" },
        ],
        metadata: { provider: "llm-test" },
      };
    },
  };
}

function semanticNode({
  documentAssetId,
  id,
  permissionScope,
  text,
}: {
  readonly documentAssetId: string;
  readonly id: string;
  readonly permissionScope: readonly string[];
  readonly text: string;
}) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "e".repeat(64),
    documentAssetId,
    endOffset: text.length,
    id,
    kind: "chunk",
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    permissionScope,
    sourceLocation: { endOffset: text.length, sectionPath: ["Semantic"], startOffset: 0 },
    startOffset: 0,
    text,
  });
}
