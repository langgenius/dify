import { type KnowledgeNode, KnowledgeNodeSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type BasicHybridRetriever,
  type HybridRetrievalItem,
  type SummaryTreeProvider,
  createDocumentOutlineRetrievalPath,
  createGraphExpandedRetrievalPath,
  createImageOcrRetrievalPath,
  createInMemoryDocumentOutlineRepository,
  createInMemoryGraphIndexRepository,
  createInMemoryKnowledgeNodeRepository,
  createSummaryTreeBuilder,
  createSummaryTreeMaintenanceFlow,
  createSummaryTreeRetrievalPath,
  createTableSpecificRetrievalPath,
} from "./index";

function knowledgeNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    artifactHash: "b".repeat(64),
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

function createRecordingSummaryProvider(): SummaryTreeProvider & {
  readonly calls: Parameters<SummaryTreeProvider["generate"]>[0][];
} {
  const calls: Parameters<SummaryTreeProvider["generate"]>[0][] = [];

  return {
    calls,
    generate: async (input) => {
      calls.push(input);

      return {
        metadata: { provider: "static", requestId: `summary-${calls.length}` },
        text: `${input.level} summary for ${input.childNodes.map((node) => node.id).join(",")}`,
      };
    },
  };
}

function retrievalItem(overrides: Partial<HybridRetrievalItem> = {}): HybridRetrievalItem {
  return {
    citation: {
      artifactHash: "b".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      documentVersion: 1,
      sectionPath: ["Guide"],
    },
    metadata: {},
    nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    permissionScope: ["tenant-1"],
    projectionIds: ["projection-1"],
    score: 1,
    sources: ["dense"],
    ...overrides,
  };
}

describe("summary tree builder", () => {
  it("builds section and document summary nodes in one bounded repository write", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const first = knowledgeNode();
    const second = knowledgeNode({
      endOffset: 58,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      metadata: { chunkIndex: 2 },
      sourceLocation: { sectionPath: ["Guide"], startOffset: 25, endOffset: 58 },
      startOffset: 25,
      text: "Managers approve refund exceptions.",
    });
    const third = knowledgeNode({
      endOffset: 95,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      metadata: { chunkIndex: 3 },
      permissionScope: ["tenant-1", "finance"],
      sourceLocation: { sectionPath: ["FAQ"], startOffset: 59, endOffset: 95 },
      startOffset: 59,
      text: "Finance reviews quarterly policy changes.",
    });
    await nodes.createMany([third, first, second]);
    const provider = createRecordingSummaryProvider();

    const builder = createSummaryTreeBuilder({
      maxInputChars: 1_000,
      maxLeafNodes: 4,
      maxSections: 4,
      maxSummaryChars: 200,
      maxSummaryNodes: 4,
      model: "summary-model",
      nodes,
      now: () => "2026-05-12T12:00:00.000Z",
      provider,
    });
    const result = await builder.build({
      artifactHash: first.artifactHash,
      documentAssetId: first.documentAssetId,
      knowledgeSpaceId: first.knowledgeSpaceId,
      leafNodeIds: [first.id, second.id, third.id],
      parseArtifactId: first.parseArtifactId,
      traceId: "trace-summary-1",
    });

    expect(result.leafCount).toBe(3);
    expect(result.sectionCount).toBe(2);
    expect(result.summaryNodes).toHaveLength(3);
    expect(result.summaryNodes.map((node) => node.kind)).toEqual(["summary", "summary", "summary"]);
    expect(provider.calls.map((call) => call.level)).toEqual(["section", "section", "document"]);
    expect(provider.calls[0]?.childNodes.map((node) => node.id)).toEqual([first.id, second.id]);
    expect(provider.calls[1]?.childNodes.map((node) => node.id)).toEqual([third.id]);

    const [guideSummary, faqSummary, documentSummary] = result.summaryNodes;
    if (!guideSummary || !faqSummary || !documentSummary) {
      throw new Error("Expected section and document summary nodes");
    }
    expect(guideSummary).toMatchObject({
      documentAssetId: first.documentAssetId,
      knowledgeSpaceId: first.knowledgeSpaceId,
      metadata: {
        childNodeIds: [first.id, second.id],
        generatedAt: "2026-05-12T12:00:00.000Z",
        model: "summary-model",
        promptVersion: "summary-tree-v1",
        requestId: "summary-1",
        summaryLevel: "section",
        traceId: "trace-summary-1",
      },
      permissionScope: ["tenant-1"],
      sourceLocation: { sectionPath: ["Guide"], startOffset: 0, endOffset: 58 },
      startOffset: 0,
      text: `section summary for ${first.id},${second.id}`,
    });
    expect(faqSummary?.permissionScope).toEqual(["finance", "tenant-1"]);
    expect(documentSummary).toMatchObject({
      metadata: {
        childNodeIds: [guideSummary.id, faqSummary.id],
        summaryLevel: "document",
      },
      permissionScope: ["finance", "tenant-1"],
      sourceLocation: { sectionPath: [], startOffset: 0, endOffset: 95 },
    });
    await expect(
      nodes.getMany({
        ids: result.summaryNodes.map((node) => node.id),
        knowledgeSpaceId: first.knowledgeSpaceId,
      }),
    ).resolves.toEqual(result.summaryNodes);

    guideSummary.metadata.summaryLevel = "mutated";
    await expect(
      nodes.get({
        id: guideSummary.id,
        knowledgeSpaceId: first.knowledgeSpaceId,
      }),
    ).resolves.toMatchObject({
      metadata: { summaryLevel: "section" },
    });
  });

  it("rejects missing, mixed-document, oversized, and low-quality summary builds", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 3,
      maxListLimit: 3,
      maxNodes: 6,
    });
    const first = knowledgeNode();
    const mixedDocument = knowledgeNode({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c54",
    });
    await nodes.createMany([first, mixedDocument]);
    const provider = createRecordingSummaryProvider();
    const builder = createSummaryTreeBuilder({
      maxInputChars: 32,
      maxLeafNodes: 2,
      maxSections: 1,
      maxSummaryChars: 20,
      maxSummaryNodes: 2,
      model: "summary-model",
      nodes,
      provider,
    });

    await expect(
      builder.build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [first.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree missing leaf nodes");
    await expect(
      builder.build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [first.id, mixedDocument.id],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree leaf nodes must belong to one document artifact");
    await expect(
      builder.build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [first.id, mixedDocument.id, "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree leafNodeIds exceeds maxLeafNodes=2");

    const longText = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      text: "x".repeat(33),
    });
    const longNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    await longNodes.createMany([longText]);
    await expect(
      createSummaryTreeBuilder({
        maxInputChars: 32,
        maxLeafNodes: 1,
        maxSections: 1,
        maxSummaryChars: 20,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes: longNodes,
        provider,
      }).build({
        artifactHash: longText.artifactHash,
        documentAssetId: longText.documentAssetId,
        knowledgeSpaceId: longText.knowledgeSpaceId,
        leafNodeIds: [longText.id],
        parseArtifactId: longText.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree input exceeds maxInputChars=32");

    const oversizedProvider: SummaryTreeProvider = {
      generate: async () => ({ text: "x".repeat(21) }),
    };
    await expect(
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 1,
        maxSections: 1,
        maxSummaryChars: 20,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes,
        provider: oversizedProvider,
      }).build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [first.id],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree provider output exceeds maxSummaryChars=20");
  });

  it("validates summary tree bounds, section fanout, and empty provider output", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 4,
    });
    const first = knowledgeNode();
    const second = knowledgeNode({
      endOffset: 50,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      sourceLocation: { sectionPath: ["FAQ"], startOffset: 25, endOffset: 50 },
      startOffset: 25,
      text: "Refund timing depends on payment rail.",
    });
    const provider = createRecordingSummaryProvider();
    await nodes.createMany([first, second]);

    await expect(
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 2,
        maxSections: 1,
        maxSummaryChars: 200,
        maxSummaryNodes: 3,
        model: "summary-model",
        nodes,
        provider,
      }).build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [first.id, second.id],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree section count exceeds maxSections=1");

    await expect(
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 2,
        maxSections: 2,
        maxSummaryChars: 200,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes,
        provider,
      }).build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [first.id, second.id],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree output exceeds maxSummaryNodes=2");

    expect(() =>
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 1,
        maxSections: 1,
        maxSummaryChars: 200,
        maxSummaryNodes: 1,
        model: "summary-model",
        nodes,
        provider,
      }),
    ).toThrow("Summary tree maxSummaryNodes must be at least 2");
    expect(() =>
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 0,
        maxSections: 1,
        maxSummaryChars: 200,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes,
        provider,
      }),
    ).toThrow("Summary tree maxLeafNodes must be at least 1");
    expect(() =>
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 1,
        maxSections: 0,
        maxSummaryChars: 200,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes,
        provider,
      }),
    ).toThrow("Summary tree maxSections must be at least 1");
    expect(() =>
      createSummaryTreeBuilder({
        maxInputChars: 0,
        maxLeafNodes: 1,
        maxSections: 1,
        maxSummaryChars: 200,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes,
        provider,
      }),
    ).toThrow("Summary tree maxInputChars must be at least 1");
    expect(() =>
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 1,
        maxSections: 1,
        maxSummaryChars: 0,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes,
        provider,
      }),
    ).toThrow("Summary tree maxSummaryChars must be at least 1");
    expect(() =>
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 1,
        maxSections: 1,
        maxSummaryChars: 200,
        maxSummaryNodes: 2,
        model: " ",
        nodes,
        provider,
      }),
    ).toThrow("Summary tree model is required");
    expect(() =>
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 1,
        maxSections: 1,
        maxSummaryChars: 200,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes,
        promptVersion: " ",
        provider,
      }),
    ).toThrow("Summary tree promptVersion is required");

    const emptyProvider: SummaryTreeProvider = {
      generate: async () => ({ text: "   " }),
    };
    await expect(
      createSummaryTreeBuilder({
        maxInputChars: 1_000,
        maxLeafNodes: 1,
        maxSections: 1,
        maxSummaryChars: 200,
        maxSummaryNodes: 2,
        model: "summary-model",
        nodes,
        provider: emptyProvider,
      }).build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [first.id],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree provider returned empty text");

    const validBuilder = createSummaryTreeBuilder({
      maxInputChars: 1_000,
      maxLeafNodes: 1,
      maxSections: 1,
      maxSummaryChars: 200,
      maxSummaryNodes: 2,
      model: "summary-model",
      nodes,
      provider,
    });
    await expect(
      validBuilder.build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: " ",
        leafNodeIds: [first.id],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree knowledgeSpaceId is required");
    await expect(
      validBuilder.build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree leafNodeIds must contain at least 1 node id");
    await expect(
      validBuilder.build({
        artifactHash: first.artifactHash,
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        leafNodeIds: [" "],
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree leafNodeIds must be non-empty strings");
  });

  it("rebuilds changed summary branches while reusing unaffected section summaries", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const first = knowledgeNode();
    const second = knowledgeNode({
      endOffset: 50,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      sourceLocation: { sectionPath: ["Guide"], startOffset: 25, endOffset: 50 },
      startOffset: 25,
      text: "Managers approve exceptions.",
    });
    const third = knowledgeNode({
      endOffset: 80,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      sourceLocation: { sectionPath: ["FAQ"], startOffset: 51, endOffset: 80 },
      startOffset: 51,
      text: "Finance reviews policy changes.",
    });
    await nodes.createMany([first, second, third]);

    const initialProvider = createRecordingSummaryProvider();
    const commonOptions = {
      maxInputChars: 1_000,
      maxLeafNodes: 4,
      maxSections: 4,
      maxSummaryChars: 200,
      maxSummaryNodes: 4,
      model: "summary-model",
      nodes,
      provider: initialProvider,
    };
    const initial = await createSummaryTreeBuilder(commonOptions).build({
      artifactHash: first.artifactHash,
      documentAssetId: first.documentAssetId,
      knowledgeSpaceId: first.knowledgeSpaceId,
      leafNodeIds: [first.id, second.id, third.id],
      parseArtifactId: first.parseArtifactId,
    });
    const originalFaqSummary = initial.summaryNodes.find(
      (node) =>
        node.metadata.summaryLevel === "section" && node.sourceLocation.sectionPath[0] === "FAQ",
    );
    if (!originalFaqSummary) {
      throw new Error("Expected existing FAQ summary");
    }

    const changedFirst = {
      ...first,
      text: "Refunds require director approval.",
    };
    await nodes.upsertMany([changedFirst]);
    const maintenanceProvider = createRecordingSummaryProvider();
    const maintenance = createSummaryTreeMaintenanceFlow({
      ...commonOptions,
      maxChangedLeafNodes: 2,
      provider: maintenanceProvider,
    });
    const result = await maintenance.rebuildChangedBranches({
      allLeafNodeIds: [first.id, second.id, third.id],
      artifactHash: first.artifactHash,
      changedLeafNodeIds: [first.id],
      documentAssetId: first.documentAssetId,
      knowledgeSpaceId: first.knowledgeSpaceId,
      parseArtifactId: first.parseArtifactId,
      traceId: "trace-maintain-1",
    });

    expect(result.rebuiltSectionCount).toBe(1);
    expect(result.reusedSectionCount).toBe(1);
    expect(maintenanceProvider.calls.map((call) => call.level)).toEqual(["section", "document"]);
    expect(maintenanceProvider.calls[0]?.childNodes.map((node) => node.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(maintenanceProvider.calls[1]?.childNodes.map((node) => node.id)).toEqual([
      result.summaryNodes[0]?.id,
      originalFaqSummary.id,
    ]);
    expect(result.summaryNodes).toHaveLength(2);
    expect(result.reusedSectionNodeIds).toEqual([originalFaqSummary.id]);
    await expect(
      nodes.get({ id: originalFaqSummary.id, knowledgeSpaceId: first.knowledgeSpaceId }),
    ).resolves.toEqual(originalFaqSummary);
    await expect(
      maintenance.rebuildChangedBranches({
        allLeafNodeIds: [first.id],
        artifactHash: first.artifactHash,
        changedLeafNodeIds: [first.id, second.id, third.id],
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree changedLeafNodeIds exceeds maxChangedLeafNodes=2");
    await expect(
      maintenance.rebuildChangedBranches({
        allLeafNodeIds: [first.id],
        artifactHash: first.artifactHash,
        changedLeafNodeIds: [],
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree changedLeafNodeIds must contain at least 1 node id");
    await expect(
      maintenance.rebuildChangedBranches({
        allLeafNodeIds: [first.id],
        artifactHash: first.artifactHash,
        changedLeafNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c99"],
        documentAssetId: first.documentAssetId,
        knowledgeSpaceId: first.knowledgeSpaceId,
        parseArtifactId: first.parseArtifactId,
      }),
    ).rejects.toThrow("Summary tree changedLeafNodeIds must be included in allLeafNodeIds");
    expect(() =>
      createSummaryTreeMaintenanceFlow({
        ...commonOptions,
        maxChangedLeafNodes: 0,
        provider: maintenanceProvider,
      }),
    ).toThrow("Summary tree maxChangedLeafNodes must be at least 1");
  });

  it("uses summary nodes as a top-down navigation step for research retrieval", async () => {
    const calls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push({
          ...input,
          filters: input.filters ? { ...input.filters } : undefined,
          permissionScope: input.permissionScope ? [...input.permissionScope] : undefined,
          queryVector: [...input.queryVector],
        });

        if (calls.length === 1) {
          return {
            items: [
              retrievalItem({
                citation: {
                  artifactHash: "b".repeat(64),
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
                  documentVersion: 1,
                  sectionPath: ["Guide"],
                },
                metadata: { summaryLevel: "section" },
                nodeId: "summary-guide",
                sources: ["fts"],
              }),
            ],
            metrics: {
              denseCandidates: 0,
              denseMs: 1,
              ftsCandidates: 1,
              ftsMs: 1,
              fusedCandidates: 1,
              fusionMs: 1,
              totalMs: 3,
            },
          };
        }

        return {
          items: [
            retrievalItem({ nodeId: "leaf-guide", score: 0.9 }),
            retrievalItem({
              citation: {
                artifactHash: "b".repeat(64),
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
                documentVersion: 1,
                sectionPath: ["FAQ"],
              },
              nodeId: "leaf-faq",
              score: 0.8,
            }),
          ],
          metrics: {
            denseCandidates: 2,
            denseMs: 1,
            ftsCandidates: 2,
            ftsMs: 1,
            fusedCandidates: 2,
            fusionMs: 1,
            totalMs: 3,
          },
        };
      },
    };
    const retriever = createSummaryTreeRetrievalPath({
      maxLeafTopK: 10,
      maxSelectedSections: 2,
      maxSummaryTopK: 2,
      retriever: baseRetriever,
    });

    const result = await retriever.retrieve({
      filters: { sourceIds: ["source-1"] },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "research",
      permissionScope: ["tenant-1"],
      query: "refund approval",
      queryVector: [0.1, 0.2],
      topK: 5,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      filters: { nodeKinds: ["summary"], sourceIds: ["source-1"] },
      limit: 2,
      mode: "research",
      topK: 2,
    });
    expect(calls[1]).toMatchObject({
      filters: { nodeKinds: ["chunk", "section", "table"], sourceIds: ["source-1"] },
      limit: 2,
      mode: "research",
      topK: 5,
    });
    expect(result.items.map((item) => item.nodeId)).toEqual(["leaf-guide"]);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        summaryCandidates: 1,
        summarySelectedSections: 1,
      }),
    );

    const fastResult = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "fast",
      query: "refund approval",
      queryVector: [0.1],
      topK: 1,
    });
    expect(fastResult.items.map((item) => item.nodeId)).toEqual(["leaf-guide", "leaf-faq"]);
    expect(calls).toHaveLength(3);
    expect(() =>
      createSummaryTreeRetrievalPath({
        maxLeafTopK: 0,
        maxSelectedSections: 1,
        maxSummaryTopK: 1,
        retriever: baseRetriever,
      }),
    ).toThrow("Summary tree retrieval maxLeafTopK must be at least 1");
    expect(() =>
      createSummaryTreeRetrievalPath({
        maxLeafTopK: 1,
        maxSelectedSections: 0,
        maxSummaryTopK: 1,
        retriever: baseRetriever,
      }),
    ).toThrow("Summary tree retrieval maxSelectedSections must be at least 1");
    expect(() =>
      createSummaryTreeRetrievalPath({
        maxLeafTopK: 1,
        maxSelectedSections: 1,
        maxSummaryTopK: 0,
        retriever: baseRetriever,
      }),
    ).toThrow("Summary tree retrieval maxSummaryTopK must be at least 1");
  });

  it("falls back to leaf retrieval when summary navigation selects no section", async () => {
    let callCount = 0;
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => {
        callCount += 1;

        return callCount === 1
          ? {
              items: [
                retrievalItem({
                  citation: {
                    artifactHash: "b".repeat(64),
                    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
                    documentVersion: 1,
                    sectionPath: [],
                  },
                  nodeId: "document-summary",
                }),
              ],
            }
          : {
              items: [retrievalItem({ nodeId: "leaf-guide" })],
            };
      },
    };
    const result = await createSummaryTreeRetrievalPath({
      maxLeafTopK: 2,
      maxSelectedSections: 1,
      maxSummaryTopK: 1,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "research",
      query: "refund approval",
      queryVector: [0.1],
      topK: 1,
    });

    expect(result.items.map((item) => item.nodeId)).toEqual(["leaf-guide"]);
    expect(result.metrics).toBeUndefined();
  });

  it("enriches deep and research retrieval results with document outline context", async () => {
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 4 });
    await outlines.upsert({
      artifactHash: "b".repeat(64),
      createdAt: "2026-05-12T12:00:00.000Z",
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d80",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { builder: "deterministic-parse-artifact" },
      nodes: [
        {
          childNodeIds: ["outline-guide-refunds"],
          children: [
            {
              childNodeIds: [],
              children: [],
              endOffset: 90,
              endPage: 3,
              id: "outline-guide-refunds",
              level: 2,
              metadata: {},
              sectionPath: ["Guide", "Refunds"],
              sourceElementIds: ["element-refunds"],
              sourceNodeIds: [],
              startOffset: 20,
              startPage: 2,
              summary: "Refund approval steps and exception handling.",
              title: "Refunds",
              titleLocation: {
                confidence: 1,
                endOffset: 27,
                pageNumber: 2,
                source: "parser-heading",
                startOffset: 20,
              },
              tocSource: "parser-heading",
            },
          ],
          endOffset: 120,
          endPage: 4,
          id: "outline-guide",
          level: 1,
          metadata: {},
          sectionPath: ["Guide"],
          sourceElementIds: ["element-guide"],
          sourceNodeIds: [],
          startOffset: 0,
          startPage: 1,
          summary: "Guide summary.",
          title: "Guide",
          titleLocation: {
            confidence: 1,
            endOffset: 5,
            pageNumber: 1,
            source: "parser-heading",
            startOffset: 0,
          },
          tocSource: "parser-heading",
        },
      ],
      outlineVersion: "document-outline-v1",
      parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      version: 1,
    });
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [
          retrievalItem({
            citation: {
              artifactHash: "b".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
              documentVersion: 1,
              pageNumber: 2,
              sectionPath: ["Guide", "Refunds"],
              startOffset: 44,
            },
            nodeId: "leaf-refunds",
          }),
          retrievalItem({
            citation: {
              artifactHash: "b".repeat(64),
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
              documentVersion: 1,
              pageNumber: 8,
              sectionPath: ["Other"],
              startOffset: 400,
            },
            nodeId: "leaf-other",
          }),
        ],
        metrics: {
          denseCandidates: 2,
          denseMs: 1,
          ftsCandidates: 0,
          ftsMs: 1,
          fusedCandidates: 2,
          fusionMs: 1,
          totalMs: 3,
        },
      }),
    };
    const retriever = createDocumentOutlineRetrievalPath({
      maxOutlinesPerQuery: 2,
      outlines,
      retriever: baseRetriever,
    });

    const deepResult = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "deep",
      query: "refund approval",
      queryVector: [0.1],
      topK: 1,
    });

    expect(deepResult.items[0]?.metadata.documentOutline).toBeUndefined();
    expect(deepResult.items[0]?.metadata.reasoningTreeSearch).toBeUndefined();
    expect(deepResult.metrics).not.toHaveProperty("documentOutlineMatchedItems");

    const researchResult = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "research",
      query: "research refund approval exceptions",
      queryVector: [0.1],
      topK: 1,
    });
    expect(researchResult.items[0]?.metadata.reasoningTreeSearch).toMatchObject({
      fallbackHybridCandidateNodeIds: ["leaf-refunds", "leaf-other"],
      finalEvidenceNodeIds: ["leaf-refunds"],
      inspectedNodeIds: ["outline-guide", "outline-guide-refunds"],
      openedRanges: [
        {
          outlineNodeId: "outline-guide-refunds",
          sectionPath: ["Guide", "Refunds"],
          startOffset: 20,
          startPage: 2,
        },
      ],
      reasoning: expect.stringContaining("retained final evidence inside the selected range"),
      selectedNodeId: "outline-guide-refunds",
      selectedSectionPath: ["Guide", "Refunds"],
      strategy: "document-outline-guided-v1",
      visitedNodeIds: ["outline-guide", "outline-guide-refunds"],
    });
    expect(researchResult.items.map((item) => item.nodeId)).toEqual(["leaf-refunds"]);
    expect(researchResult.metrics).toMatchObject({
      documentOutlineMatchedItems: 1,
      reasoningTreeSearchNodes: 2,
    });

    const fastResult = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "fast",
      query: "refund approval",
      queryVector: [0.1],
      topK: 1,
    });
    expect(fastResult.items[0]?.metadata.documentOutline).toBeUndefined();
    expect(() =>
      createDocumentOutlineRetrievalPath({
        maxOutlinesPerQuery: 0,
        outlines,
        retriever: baseRetriever,
      }),
    ).toThrow("Document outline retrieval maxOutlinesPerQuery must be at least 1");
  });

  it("merges bounded graph expansion into deep retrieval", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => "2026-05-12T12:00:00.000Z",
    });
    await graph.upsertEntities([
      {
        aliases: ["Acme"],
        canonicalKey: "organization:acme corp",
        confidence: 0.95,
        createdAt: "2026-05-12T12:00:00.000Z",
        extractionVersion: 1,
        id: "entity-root",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        metadata: {},
        name: "Acme Corp",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-seed"],
        type: "organization",
        updatedAt: "2026-05-12T12:00:00.000Z",
      },
      {
        aliases: ["Refund Policy"],
        canonicalKey: "policy:refund policy",
        confidence: 0.9,
        createdAt: "2026-05-12T12:00:00.000Z",
        extractionVersion: 1,
        id: "entity-related",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        metadata: {},
        name: "Refund Policy",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-graph"],
        type: "policy",
        updatedAt: "2026-05-12T12:00:00.000Z",
      },
    ]);
    await graph.upsertRelations([
      {
        confidence: 0.88,
        createdAt: "2026-05-12T12:00:00.000Z",
        extractionVersion: 1,
        id: "relation-1",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        metadata: {},
        objectEntityId: "entity-related",
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-seed"],
        subjectEntityId: "entity-root",
        type: "references",
        updatedAt: "2026-05-12T12:00:00.000Z",
      },
    ]);

    const calls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push({
          ...input,
          filters: input.filters ? { ...input.filters } : undefined,
          permissionScope: input.permissionScope ? [...input.permissionScope] : undefined,
          queryVector: [...input.queryVector],
        });

        if (calls.length === 1) {
          return {
            items: [
              retrievalItem({
                metadata: { graphEntityIds: ["entity-root"], nodeKind: "chunk" },
                nodeId: "node-seed",
                score: 1,
              }),
              retrievalItem({
                metadata: { nodeKind: "chunk" },
                nodeId: "node-baseline",
                score: 0.4,
              }),
            ],
            metrics: {
              denseCandidates: 2,
              denseMs: 1,
              ftsCandidates: 0,
              ftsMs: 1,
              fusedCandidates: 2,
              fusionMs: 1,
              totalMs: 3,
            },
          };
        }

        return {
          items: [
            retrievalItem({
              metadata: { nodeKind: "chunk" },
              nodeId: "node-graph",
              score: 0.9,
            }),
          ],
          metrics: {
            denseCandidates: 1,
            denseMs: 1,
            ftsCandidates: 0,
            ftsMs: 1,
            fusedCandidates: 1,
            fusionMs: 1,
            totalMs: 2,
          },
        };
      },
    };

    const result = await createGraphExpandedRetrievalPath({
      fanout: 2,
      graph,
      graphBoost: 0.5,
      graphTopK: 4,
      maxDepth: 2,
      maxSeedEntities: 1,
      maxTraversalNodes: 5,
      retriever: baseRetriever,
      timeoutMs: 250,
    }).retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 2,
      mode: "deep",
      permissionScope: ["tenant-1"],
      query: "refund approval",
      queryVector: [0.1, 0.2],
      topK: 2,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      filters: {
        entities: ["entity-root", "Acme Corp", "entity-related", "Refund Policy"],
      },
      limit: 4,
      mode: "deep",
      topK: 4,
    });
    expect(result.items.map((item) => item.nodeId)).toEqual(["node-seed", "node-graph"]);
    expect(result.items[1]?.metadata.graphExpansion).toEqual({
      seedEntityIds: ["entity-root"],
      traversedEntityIds: ["entity-root", "entity-related"],
    });
    expect(result.metrics).toEqual(
      expect.objectContaining({
        graphExpansionCandidates: 1,
        graphExpansionRelations: 1,
        graphExpansionSeeds: 1,
        graphExpansionTraversedEntities: 2,
      }),
    );

    const fastResult = await createGraphExpandedRetrievalPath({
      fanout: 1,
      graph,
      graphBoost: 0.5,
      graphTopK: 1,
      maxDepth: 1,
      maxSeedEntities: 1,
      maxTraversalNodes: 2,
      retriever: baseRetriever,
      timeoutMs: 100,
    }).retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "fast",
      query: "refund approval",
      queryVector: [0.1],
      topK: 1,
    });
    expect(fastResult.items.map((item) => item.nodeId)).toEqual(["node-graph"]);
    expect(calls).toHaveLength(3);
  });

  it("keeps graph expanded retrieval bounded and falls back when no seed entity exists", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
    });
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [retrievalItem({ metadata: { nodeKind: "chunk" }, nodeId: "node-without-graph" })],
      }),
    };

    const result = await createGraphExpandedRetrievalPath({
      fanout: 1,
      graph,
      graphBoost: 0.5,
      graphTopK: 1,
      maxDepth: 1,
      maxSeedEntities: 1,
      maxTraversalNodes: 2,
      retriever: baseRetriever,
      timeoutMs: 100,
    }).retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "deep",
      query: "refund approval",
      queryVector: [0.1],
      topK: 1,
    });

    expect(result.items.map((item) => item.nodeId)).toEqual(["node-without-graph"]);
    expect(result.metrics).toBeUndefined();
    expect(() =>
      createGraphExpandedRetrievalPath({
        fanout: 1,
        graph,
        graphBoost: 0.5,
        graphTopK: 1,
        maxDepth: 1,
        maxSeedEntities: 0,
        maxTraversalNodes: 2,
        retriever: baseRetriever,
        timeoutMs: 100,
      }),
    ).toThrow("Graph expanded retrieval maxSeedEntities must be at least 1");
    expect(() =>
      createGraphExpandedRetrievalPath({
        fanout: 1,
        graph,
        graphBoost: 0.5,
        graphTopK: 0,
        maxDepth: 1,
        maxSeedEntities: 1,
        maxTraversalNodes: 2,
        retriever: baseRetriever,
        timeoutMs: 100,
      }),
    ).toThrow("Graph expanded retrieval graphTopK must be at least 1");
    expect(() =>
      createGraphExpandedRetrievalPath({
        fanout: 1,
        graph,
        graphBoost: 0,
        graphTopK: 1,
        maxDepth: 1,
        maxSeedEntities: 1,
        maxTraversalNodes: 2,
        retriever: baseRetriever,
        timeoutMs: 100,
      }),
    ).toThrow("Graph expanded retrieval graphBoost must be greater than 0");
    expect(() =>
      createGraphExpandedRetrievalPath({
        fanout: 0,
        graph,
        graphBoost: 0.5,
        graphTopK: 1,
        maxDepth: 1,
        maxSeedEntities: 1,
        maxTraversalNodes: 2,
        retriever: baseRetriever,
        timeoutMs: 100,
      }),
    ).toThrow("Graph traversal fanout must be at least 1");
  });

  it("does not expand graph entities outside the caller permission scope", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
    });
    await graph.upsertEntities([
      {
        aliases: [],
        canonicalKey: "policy:restricted",
        confidence: 0.95,
        createdAt: "2026-05-12T12:00:00.000Z",
        extractionVersion: 1,
        id: "entity-restricted",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        metadata: {},
        name: "Restricted Policy",
        permissionScope: ["finance"],
        sourceNodeIds: ["node-restricted"],
        type: "policy",
        updatedAt: "2026-05-12T12:00:00.000Z",
      },
    ]);
    let callCount = 0;
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => {
        callCount += 1;

        return {
          items: [
            retrievalItem({
              metadata: { graphEntityIds: ["entity-restricted"] },
              nodeId: "node-seed",
            }),
          ],
          metrics: {
            denseCandidates: 1,
            denseMs: 1,
            ftsCandidates: 0,
            ftsMs: 1,
            fusedCandidates: 1,
            fusionMs: 1,
            totalMs: 2,
          },
        };
      },
    };

    const result = await createGraphExpandedRetrievalPath({
      fanout: 1,
      graph,
      graphBoost: 0.5,
      graphTopK: 2,
      maxDepth: 1,
      maxSeedEntities: 1,
      maxTraversalNodes: 2,
      retriever: baseRetriever,
      timeoutMs: 100,
    }).retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "deep",
      permissionScope: ["tenant-1"],
      query: "refund approval",
      queryVector: [0.1],
      topK: 1,
    });

    expect(callCount).toBe(1);
    expect(result.items.map((item) => item.nodeId)).toEqual(["node-seed"]);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        graphExpansionCandidates: 0,
        graphExpansionSeeds: 1,
        graphExpansionTraversedEntities: 0,
      }),
    );
  });

  it("adds a bounded table-specific retrieval leg for tabular questions", async () => {
    const calls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push(JSON.parse(JSON.stringify(input)));

        if (input.filters?.nodeKinds?.includes("table")) {
          return {
            items: [
              retrievalItem({
                metadata: { nodeKind: "table", table: { columns: ["Vendor", "Amount"] } },
                nodeId: "table-node",
                score: 0.6,
              }),
            ],
            metrics: {
              denseCandidates: 1,
              denseMs: 1,
              ftsCandidates: 1,
              ftsMs: 1,
              fusedCandidates: 1,
              fusionMs: 1,
              totalMs: 2,
            },
          };
        }

        return {
          items: [
            retrievalItem({
              metadata: { nodeKind: "chunk" },
              nodeId: "chunk-node",
              score: 0.7,
            }),
          ],
          metrics: {
            denseCandidates: 1,
            denseMs: 1,
            ftsCandidates: 1,
            ftsMs: 1,
            fusedCandidates: 1,
            fusionMs: 1,
            totalMs: 2,
          },
        };
      },
    };

    const retriever = createTableSpecificRetrievalPath({
      maxTableCandidates: 2,
      maxTableTopK: 4,
      retriever: baseRetriever,
      tableBoost: 0.25,
    });
    const result = await retriever.retrieve({
      filters: { sourceIds: ["source-1"] },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 2,
      mode: "deep",
      permissionScope: ["tenant-1"],
      query: "Which table rows show renewal amount by vendor?",
      queryVector: [0.1, 0.2],
      topK: 8,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      filters: { nodeKinds: ["table"], sourceIds: ["source-1"] },
      limit: 2,
      topK: 4,
    });
    expect(result.items.map((item) => item.nodeId)).toEqual(["table-node", "chunk-node"]);
    expect(result.items[0]).toMatchObject({
      metadata: {
        tableRetrieval: {
          boost: 0.25,
          reason: "tabular-query",
        },
      },
      score: 0.85,
    });
    expect(result.metrics).toEqual(
      expect.objectContaining({
        tableCandidates: 1,
      }),
    );

    const plainResult = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "fast",
      query: "renewal policy",
      queryVector: [0.1],
      topK: 1,
    });
    expect(plainResult.items.map((item) => item.nodeId)).toEqual(["chunk-node"]);
    expect(calls).toHaveLength(3);
  });

  it("keeps table-specific retrieval bounded and respects explicit non-table filters", async () => {
    const calls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push(JSON.parse(JSON.stringify(input)));

        return {
          items: [retrievalItem({ metadata: { nodeKind: "chunk" }, nodeId: "chunk-node" })],
        };
      },
    };

    const retriever = createTableSpecificRetrievalPath({
      maxTableCandidates: 1,
      maxTableTopK: 1,
      retriever: baseRetriever,
      tableBoost: 0.1,
    });
    await retriever.retrieve({
      filters: { nodeKinds: ["chunk"] },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      query: "show table columns",
      queryVector: [0.1],
      topK: 1,
    });
    expect(calls).toHaveLength(1);

    const tableFilteredResult = await retriever.retrieve({
      filters: { nodeKinds: ["table"] },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "deep",
      query: "renewal policy",
      queryVector: [0.1],
      topK: 1,
    });
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({
      filters: { nodeKinds: ["table"] },
      limit: 1,
      topK: 1,
    });
    expect(tableFilteredResult.metrics).toBeUndefined();

    expect(() =>
      createTableSpecificRetrievalPath({
        maxTableCandidates: 0,
        maxTableTopK: 1,
        retriever: baseRetriever,
        tableBoost: 0.1,
      }),
    ).toThrow("Table retrieval maxTableCandidates must be at least 1");
    expect(() =>
      createTableSpecificRetrievalPath({
        maxTableCandidates: 1,
        maxTableTopK: 0,
        retriever: baseRetriever,
        tableBoost: 0.1,
      }),
    ).toThrow("Table retrieval maxTableTopK must be at least 1");
    expect(() =>
      createTableSpecificRetrievalPath({
        maxTableCandidates: 1,
        maxTableTopK: 1,
        retriever: baseRetriever,
        tableBoost: 0,
      }),
    ).toThrow("Table retrieval tableBoost must be greater than 0");
  });

  it("merges duplicate table-specific retrieval hits without duplicating nodes", async () => {
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        if (input.filters?.nodeKinds?.includes("table")) {
          return {
            items: [
              retrievalItem({
                metadata: { nodeKind: "table", tableOnly: true },
                nodeId: "table-node",
                projectionIds: ["table-projection"],
                score: 0.4,
                sources: ["fts"],
              }),
            ],
          };
        }

        return {
          items: [
            retrievalItem({
              metadata: { nodeKind: "table" },
              nodeId: "table-node",
              projectionIds: ["base-projection"],
              score: 0.7,
              sources: ["dense"],
            }),
          ],
        };
      },
    };

    const result = await createTableSpecificRetrievalPath({
      maxTableCandidates: 1,
      maxTableTopK: 1,
      retriever: baseRetriever,
      tableBoost: 0.25,
    }).retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "deep",
      query: "table renewal amount",
      queryVector: [0.1],
      topK: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      metadata: {
        nodeKind: "table",
        tableRetrieval: {
          boost: 0.25,
          reason: "tabular-query",
        },
      },
      nodeId: "table-node",
      projectionIds: ["base-projection", "table-projection"],
      sources: ["dense", "fts"],
    });
    expect(result.items[0]?.score).toBeCloseTo(0.8);
  });

  it("adds a bounded image/OCR retrieval leg for visual questions", async () => {
    const calls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push(JSON.parse(JSON.stringify(input)));

        if (input.filters?.nodeKinds?.includes("image")) {
          return {
            items: [
              retrievalItem({
                citation: {
                  artifactHash: "b".repeat(64),
                  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
                  documentVersion: 1,
                  pageNumber: 4,
                  sectionPath: ["Charts"],
                },
                metadata: {
                  nodeKind: "image",
                  ocrText: "Q1 renewal chart",
                  parseElementId: "figure-1",
                },
                nodeId: "image-node",
                score: 0.5,
              }),
            ],
            metrics: {
              denseCandidates: 1,
              denseMs: 1,
              ftsCandidates: 1,
              ftsMs: 1,
              fusedCandidates: 1,
              fusionMs: 1,
              totalMs: 2,
            },
          };
        }

        return {
          items: [
            retrievalItem({
              metadata: { nodeKind: "chunk" },
              nodeId: "chunk-node",
              score: 0.7,
            }),
          ],
          metrics: {
            denseCandidates: 1,
            denseMs: 1,
            ftsCandidates: 1,
            ftsMs: 1,
            fusedCandidates: 1,
            fusionMs: 1,
            totalMs: 2,
          },
        };
      },
    };

    const retriever = createImageOcrRetrievalPath({
      imageBoost: 0.2,
      maxImageCandidates: 2,
      maxImageTopK: 3,
      retriever: baseRetriever,
    });
    const result = await retriever.retrieve({
      filters: { sourceIds: ["source-1"] },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 2,
      mode: "deep",
      permissionScope: ["tenant-1"],
      query: "Which figure shows renewal OCR from the chart?",
      queryVector: [0.1, 0.2],
      topK: 8,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      filters: { nodeKinds: ["image"], sourceIds: ["source-1"] },
      limit: 2,
      topK: 3,
    });
    expect(result.items.map((item) => item.nodeId)).toEqual(["chunk-node", "image-node"]);
    expect(result.items[1]).toMatchObject({
      metadata: {
        imageRetrieval: {
          boost: 0.2,
          reason: "visual-query",
        },
        multimodalCandidate: {
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          documentVersion: 1,
          pageNumber: 4,
          parseElementId: "figure-1",
          sectionPath: ["Charts"],
          source: "image-ocr-retrieval",
        },
      },
      score: 0.7,
    });
    expect(result.metrics).toEqual(expect.objectContaining({ imageCandidates: 1 }));
  });

  it("keeps image/OCR retrieval bounded and respects explicit non-image filters", async () => {
    const calls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push(JSON.parse(JSON.stringify(input)));

        return {
          items: [retrievalItem({ metadata: { nodeKind: "chunk" }, nodeId: "chunk-node" })],
        };
      },
    };
    const retriever = createImageOcrRetrievalPath({
      imageBoost: 0.1,
      maxImageCandidates: 1,
      maxImageTopK: 1,
      retriever: baseRetriever,
    });

    await retriever.retrieve({
      filters: { nodeKinds: ["chunk"] },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      query: "show OCR figure",
      queryVector: [0.1],
      topK: 1,
    });
    expect(calls).toHaveLength(1);

    const imageFilteredResult = await retriever.retrieve({
      filters: { nodeKinds: ["image"] },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "deep",
      query: "renewal policy",
      queryVector: [0.1],
      topK: 1,
    });
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({
      filters: { nodeKinds: ["image"] },
      limit: 1,
      topK: 1,
    });
    expect(imageFilteredResult.metrics).toBeUndefined();

    const plainResult = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      query: "renewal policy",
      queryVector: [0.1],
      topK: 1,
    });
    expect(plainResult.items.map((item) => item.nodeId)).toEqual(["chunk-node"]);
    expect(calls).toHaveLength(4);

    expect(() =>
      createImageOcrRetrievalPath({
        imageBoost: 0.1,
        maxImageCandidates: 0,
        maxImageTopK: 1,
        retriever: baseRetriever,
      }),
    ).toThrow("Image retrieval maxImageCandidates must be at least 1");
    expect(() =>
      createImageOcrRetrievalPath({
        imageBoost: 0.1,
        maxImageCandidates: 1,
        maxImageTopK: 0,
        retriever: baseRetriever,
      }),
    ).toThrow("Image retrieval maxImageTopK must be at least 1");
    expect(() =>
      createImageOcrRetrievalPath({
        imageBoost: 0,
        maxImageCandidates: 1,
        maxImageTopK: 1,
        retriever: baseRetriever,
      }),
    ).toThrow("Image retrieval imageBoost must be greater than 0");
  });

  it("merges duplicate image/OCR retrieval hits without duplicating nodes", async () => {
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        if (input.filters?.nodeKinds?.includes("image")) {
          return {
            items: [
              retrievalItem({
                metadata: {
                  elementIds: ["figure-1"],
                  nodeKind: "image",
                  ocrText: "Renewal chart",
                },
                nodeId: "image-node",
                projectionIds: ["image-projection"],
                score: 0.5,
                sources: ["fts"],
              }),
            ],
          };
        }

        return {
          items: [
            retrievalItem({
              metadata: { nodeKind: "image" },
              nodeId: "image-node",
              projectionIds: ["base-projection"],
              score: 0.7,
              sources: ["dense"],
            }),
          ],
        };
      },
    };

    const result = await createImageOcrRetrievalPath({
      imageBoost: 0.2,
      maxImageCandidates: 1,
      maxImageTopK: 1,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "deep",
      query: "figure renewal OCR",
      queryVector: [0.1],
      topK: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      metadata: {
        imageRetrieval: {
          boost: 0.2,
          reason: "visual-query",
        },
        multimodalCandidate: {
          parseElementId: "figure-1",
          source: "image-ocr-retrieval",
        },
        nodeKind: "image",
      },
      nodeId: "image-node",
      projectionIds: ["base-projection", "image-projection"],
      sources: ["dense", "fts"],
    });
    expect(result.items[0]?.score).toBeCloseTo(0.8);
  });
});
