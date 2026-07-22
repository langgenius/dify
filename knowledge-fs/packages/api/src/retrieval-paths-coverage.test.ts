import { describe, expect, it } from "vitest";

import { createInMemoryDocumentOutlineRepository } from "./document-outline-repository";
import type {
  GraphIndexRepository,
  GraphTraversalEntity,
  GraphTraversalResult,
} from "./graph-index-repository";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import {
  createDocumentOutlineRetrievalPath,
  createGraphExpandedRetrievalPath,
  createImageOcrRetrievalPath,
  createSummaryTreeRetrievalPath,
  createTableSpecificRetrievalPath,
} from "./retrieval-paths";
import { createRetrievalPlanner } from "./retrieval-planner";
import type { BasicHybridRetriever } from "./retrieval-types";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const DOC_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const DOC_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99";

function retrievalItem(overrides: Partial<HybridRetrievalItem> = {}): HybridRetrievalItem {
  return {
    citation: {
      artifactHash: "b".repeat(64),
      documentAssetId: DOC_A,
      documentVersion: 1,
      sectionPath: ["Guide"],
    },
    metadata: {},
    nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    projectionIds: ["projection-1"],
    score: 1,
    sources: ["dense"],
    ...overrides,
  };
}

function baseMetrics() {
  return {
    denseCandidates: 1,
    denseMs: 1,
    ftsCandidates: 0,
    ftsMs: 1,
    fusedCandidates: 1,
    fusionMs: 1,
    totalMs: 2,
  };
}

function traversalEntity({
  depth,
  id,
  name,
  permissionScope = [],
}: {
  readonly depth: number;
  readonly id: string;
  readonly name: string;
  readonly permissionScope?: readonly string[];
}): GraphTraversalEntity {
  return {
    aliases: [],
    canonicalKey: `organization:${name.toLowerCase()}`,
    confidence: 0.9,
    createdAt: "2026-05-12T12:00:00.000Z",
    depth,
    extractionVersion: 1,
    id,
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    metadata: {},
    name,
    permissionScope,
    sourceNodeIds: [],
    type: "organization",
    updatedAt: "2026-05-12T12:00:00.000Z",
  };
}

function traversalResult(
  entities: readonly GraphTraversalEntity[],
  timedOut = false,
): GraphTraversalResult {
  return {
    entities: [...entities],
    metrics: {
      depthReached: 1,
      elapsedMs: 1,
      exploredRelations: 0,
      fanout: 2,
      maxDepth: 2,
      maxNodes: 5,
      timedOut,
    },
    relations: [],
    truncated: false,
  };
}

function fakeGraph(
  traverse: (startEntityId: string) => GraphTraversalResult,
): GraphIndexRepository {
  return {
    deleteComponentsBySourceNodesAcrossGenerations: async () => {
      throw new Error(
        "deleteComponentsBySourceNodesAcrossGenerations is not used by graph expansion",
      );
    },
    listEntities: async () => {
      throw new Error("listEntities is not used by graph expansion");
    },
    pruneSourceNodes: async () => {
      throw new Error("pruneSourceNodes is not used by graph expansion");
    },
    pruneSourceNodesAcrossGenerations: async () => {
      throw new Error("pruneSourceNodesAcrossGenerations is not used by graph expansion");
    },
    traverse: async (input) => traverse(input.startEntityId),
    upsertEntities: async () => {
      throw new Error("upsertEntities is not used by graph expansion");
    },
    upsertRelations: async () => {
      throw new Error("upsertRelations is not used by graph expansion");
    },
  };
}

describe("retrieval paths branch coverage", () => {
  it("falls back to unfiltered leaves when no leaf matches a selected summary section", async () => {
    const calls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push(JSON.parse(JSON.stringify(input)));

        if (input.filters?.nodeKinds?.includes("summary")) {
          return {
            items: [
              retrievalItem({
                citation: {
                  artifactHash: "b".repeat(64),
                  documentAssetId: DOC_A,
                  documentVersion: 1,
                  sectionPath: ["Guide"],
                },
                nodeId: "summary-guide",
              }),
            ],
          };
        }

        return {
          items: [
            retrievalItem({
              citation: {
                artifactHash: "b".repeat(64),
                documentAssetId: DOC_A,
                documentVersion: 1,
                sectionPath: ["FAQ"],
              },
              nodeId: "leaf-faq",
              score: 0.9,
            }),
            retrievalItem({
              citation: {
                artifactHash: "b".repeat(64),
                documentAssetId: DOC_A,
                documentVersion: 1,
                sectionPath: ["FAQ", "Refunds"],
              },
              nodeId: "leaf-faq-refunds",
              score: 0.8,
            }),
          ],
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
      filters: { nodeKinds: ["summary", "chunk"] },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      mode: "research",
      query: "refund policy",
      queryVector: [0.1],
      topK: 5,
    });

    // The summary leg selected ["Guide"], but no leaf lives under it -> keep all leaves.
    expect(result.items.map((item) => item.nodeId)).toEqual(["leaf-faq", "leaf-faq-refunds"]);
    // Explicit non-summary node kinds survive into the leaf retrieval filters.
    expect(calls[1]?.filters?.nodeKinds).toEqual(["chunk"]);

    // A summary-only node kind filter falls back to the default leaf kinds.
    await retriever.retrieve({
      filters: { nodeKinds: ["summary"] },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      mode: "research",
      query: "refund policy",
      queryVector: [0.1],
      topK: 5,
    });
    expect(calls[3]?.filters?.nodeKinds).toEqual(["chunk", "section", "table"]);
  });

  it("keeps document-outline traversal out of deep mode", async () => {
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 4 });
    await outlines.upsert({
      artifactHash: "b".repeat(64),
      createdAt: "2026-05-12T12:00:00.000Z",
      documentAssetId: DOC_A,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d80",
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      metadata: {},
      nodes: [
        {
          childNodeIds: [],
          children: [],
          id: "n-bare",
          level: 1,
          metadata: {},
          sectionPath: ["Bare"],
          sourceElementIds: [],
          sourceNodeIds: [],
          summary: "Bare summary.",
          title: "Bare",
          tocSource: "parser-heading",
        },
        {
          childNodeIds: [],
          children: [],
          id: "n-title",
          level: 1,
          metadata: {},
          sectionPath: ["TL"],
          sourceElementIds: [],
          sourceNodeIds: [],
          title: "TL",
          titleLocation: {
            confidence: 0.5,
            matchedText: "TL",
            source: "llm-inferred",
          },
          tocSource: "llm-inferred",
        },
        {
          childNodeIds: [],
          children: [],
          id: "n-fallback",
          level: 1,
          metadata: {},
          sectionPath: ["Misc"],
          sourceElementIds: [],
          sourceNodeIds: [],
          title: "Misc",
          tocSource: "fallback",
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
              documentAssetId: DOC_A,
              documentVersion: 1,
              sectionPath: ["Bare", "Sub"],
            },
            nodeId: "leaf-bare",
            score: 0.9,
          }),
          retrievalItem({
            citation: {
              artifactHash: "b".repeat(64),
              documentAssetId: DOC_A,
              documentVersion: 1,
              sectionPath: ["TL"],
            },
            nodeId: "leaf-title",
            score: 0.8,
          }),
          retrievalItem({
            citation: {
              artifactHash: "b".repeat(64),
              documentAssetId: DOC_B,
              documentVersion: 1,
              sectionPath: ["Any"],
            },
            nodeId: "leaf-no-outline",
            score: 0.7,
          }),
        ],
        metrics: baseMetrics(),
      }),
    };

    const result = await createDocumentOutlineRetrievalPath({
      maxOutlinesPerQuery: 3,
      outlines,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "deep",
      query: "bare section",
      queryVector: [0.1],
      topK: 3,
    });

    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.metadata.documentOutline === undefined)).toBe(true);
    expect(result.metrics).not.toHaveProperty("documentOutlineMatchedItems");
  });

  it("selects a minimal outline node in research mode and skips foreign-document evidence", async () => {
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 4 });
    await outlines.upsert({
      artifactHash: "b".repeat(64),
      createdAt: "2026-05-12T12:00:00.000Z",
      documentAssetId: DOC_A,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d81",
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      metadata: {},
      nodes: [
        {
          childNodeIds: [],
          children: [],
          id: "n-bare",
          level: 1,
          metadata: {},
          sectionPath: ["Bare"],
          sourceElementIds: [],
          sourceNodeIds: [],
          title: "Bare",
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
              documentAssetId: DOC_B,
              documentVersion: 1,
              sectionPath: ["Elsewhere"],
            },
            nodeId: "leaf-no-outline",
            score: 0.95,
          }),
          retrievalItem({
            citation: {
              artifactHash: "b".repeat(64),
              documentAssetId: DOC_A,
              documentVersion: 1,
              sectionPath: ["Bare", "Sub"],
            },
            nodeId: "leaf-bare",
            score: 0.9,
          }),
        ],
        plan: {
          denseTopK: 2,
          ftsTopK: 2,
          fusionLimit: 2,
          queryLanguage: "latin",
          requestedMode: "research",
          rerankCandidateLimit: 2,
          resolvedMode: "research",
          strategyVersion: "retrieval-planner-v1",
          topK: 2,
        },
      }),
    };

    const result = await createDocumentOutlineRetrievalPath({
      maxOutlinesPerQuery: 2,
      outlines,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      mode: "research",
      query: "bare research",
      queryVector: [0.1],
      topK: 2,
    });

    expect(result.items.map((item) => item.nodeId)).toEqual(["leaf-bare"]);
    const reasoning = result.items[0]?.metadata.reasoningTreeSearch as Record<string, unknown>;
    expect(reasoning).toMatchObject({
      fallbackHybridCandidateNodeIds: ["leaf-no-outline", "leaf-bare"],
      finalEvidenceNodeIds: ["leaf-bare"],
      selectedNodeId: "n-bare",
      selectedSectionPath: ["Bare"],
    });
    const openedRange = (reasoning.openedRanges as Record<string, unknown>[])[0];
    expect(openedRange).toEqual({
      documentAssetId: DOC_A,
      documentVersion: 1,
      outlineNodeId: "n-bare",
      sectionPath: ["Bare"],
      title: "Bare",
    });
    // The base retrieval carried no metrics, so the enriched result keeps them absent.
    expect(result.metrics).toBeUndefined();
  });

  it("uses PageIndex summaries to choose the research section instead of base rank alone", async () => {
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 1 });
    await outlines.upsert({
      artifactHash: "b".repeat(64),
      createdAt: "2026-05-12T12:00:00.000Z",
      documentAssetId: DOC_A,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d82",
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      metadata: {},
      nodes: [
        {
          childNodeIds: [],
          children: [],
          id: "n-overview",
          level: 1,
          metadata: {},
          sectionPath: ["Overview"],
          sourceElementIds: [],
          sourceNodeIds: [],
          summary: "General product introduction.",
          title: "Overview",
          tocSource: "parser-heading",
        },
        {
          childNodeIds: [],
          children: [],
          id: "n-refunds",
          level: 1,
          metadata: {},
          sectionPath: ["Operations"],
          sourceElementIds: [],
          sourceNodeIds: [],
          summary: "Refund approval and exception workflow.",
          title: "Operations",
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
              documentAssetId: DOC_A,
              documentVersion: 1,
              sectionPath: ["Overview"],
            },
            nodeId: "leaf-overview",
            score: 0.99,
          }),
          retrievalItem({
            citation: {
              artifactHash: "b".repeat(64),
              documentAssetId: DOC_A,
              documentVersion: 1,
              sectionPath: ["Operations"],
            },
            nodeId: "leaf-refunds",
            score: 0.5,
          }),
        ],
      }),
    };

    const result = await createDocumentOutlineRetrievalPath({
      maxOutlinesPerQuery: 1,
      outlines,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "research",
      query: "refund approval exceptions",
      queryVector: [0.1],
      topK: 2,
    });

    expect(result.items.map((item) => item.nodeId)).toEqual(["leaf-refunds"]);
    expect(result.items[0]?.metadata.reasoningTreeSearch).toMatchObject({
      selectedNodeId: "n-refunds",
      selectedSectionPath: ["Operations"],
      strategy: "document-outline-guided-v1",
    });
  });

  it("keeps the legacy outline compatibility scan at the caller's requested limit", async () => {
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 1 });
    await outlines.upsert({
      artifactHash: "b".repeat(64),
      createdAt: "2026-05-12T12:00:00.000Z",
      documentAssetId: DOC_A,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d83",
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      metadata: {},
      nodes: [
        {
          childNodeIds: [],
          children: [],
          id: "n-overview-wide",
          level: 1,
          metadata: {},
          sectionPath: ["Overview"],
          sourceElementIds: [],
          sourceNodeIds: [],
          summary: "General product introduction.",
          title: "Overview",
          tocSource: "parser-heading",
        },
        {
          childNodeIds: [],
          children: [],
          id: "n-refunds-wide",
          level: 1,
          metadata: {},
          sectionPath: ["Operations"],
          sourceElementIds: [],
          sourceNodeIds: [],
          summary: "Refund approval and exception workflow.",
          title: "Operations",
          tocSource: "parser-heading",
        },
      ],
      outlineVersion: "document-outline-v1",
      parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      version: 1,
    });
    const planner = createRetrievalPlanner({ maxTopK: 50 });
    const baseCandidates = [
      ...Array.from({ length: 7 }, (_, index) =>
        retrievalItem({
          citation: {
            artifactHash: "b".repeat(64),
            documentAssetId: DOC_A,
            documentVersion: 1,
            sectionPath: ["Overview"],
          },
          nodeId: `leaf-overview-wide-${index + 1}`,
          score: 1 - index / 100,
        }),
      ),
      retrievalItem({
        citation: {
          artifactHash: "b".repeat(64),
          documentAssetId: DOC_A,
          documentVersion: 1,
          sectionPath: ["Operations"],
        },
        nodeId: "leaf-refunds-wide",
        score: 0.5,
      }),
    ];
    const baseLimits: number[] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        baseLimits.push(input.limit);

        return {
          items: baseCandidates.slice(0, input.limit),
          plan: planner.plan({
            mode: input.mode,
            query: input.query,
            topK: input.topK,
            traceId: input.traceId,
          }),
        };
      },
    };

    const result = await createDocumentOutlineRetrievalPath({
      maxOutlinesPerQuery: 1,
      outlines,
      planner,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "research",
      query: "refund approval exceptions",
      queryVector: [0.1],
      topK: 2,
    });

    // Published Research no longer advertises hybrid fanout. This legacy compatibility path may
    // inspect only the already-bounded caller window; production uses indexed PageIndex instead.
    expect(baseLimits).toEqual([1]);
    expect(result.plan).toMatchObject({
      denseTopK: 0,
      ftsTopK: 0,
      fusionLimit: 0,
      rerankCandidateLimit: 0,
      resolvedMode: "research",
    });
    expect(result.items.map((item) => item.nodeId)).toEqual(["leaf-overview-wide-1"]);
    expect(result.items[0]?.metadata.reasoningTreeSearch).toMatchObject({
      fallbackHybridCandidateNodeIds: ["leaf-overview-wide-1"],
      finalEvidenceNodeIds: ["leaf-overview-wide-1"],
      selectedNodeId: "n-overview-wide",
    });
  });

  it("does not widen resolved Research from a returned hybrid fusion budget", async () => {
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 1 });
    await outlines.upsert({
      artifactHash: "b".repeat(64),
      createdAt: "2026-05-12T12:00:00.000Z",
      documentAssetId: DOC_A,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d84",
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      metadata: {},
      nodes: [
        {
          childNodeIds: [],
          children: [],
          id: "n-overview-fallback",
          level: 1,
          metadata: {},
          sectionPath: ["Overview"],
          sourceElementIds: [],
          sourceNodeIds: [],
          title: "Overview",
          tocSource: "parser-heading",
        },
        {
          childNodeIds: [],
          children: [],
          id: "n-refunds-fallback",
          level: 1,
          metadata: {},
          sectionPath: ["Operations"],
          sourceElementIds: [],
          sourceNodeIds: [],
          summary: "Refund approval exceptions.",
          title: "Operations",
          tocSource: "parser-heading",
        },
      ],
      outlineVersion: "document-outline-v1",
      parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      version: 1,
    });
    const baseCandidates = [
      retrievalItem({ nodeId: "leaf-overview-fallback-1" }),
      retrievalItem({ nodeId: "leaf-overview-fallback-2" }),
      retrievalItem({ nodeId: "leaf-overview-fallback-3" }),
      retrievalItem({
        citation: {
          artifactHash: "b".repeat(64),
          documentAssetId: DOC_A,
          documentVersion: 1,
          sectionPath: ["Operations"],
        },
        nodeId: "leaf-refunds-fallback",
      }),
    ];
    const baseLimits: number[] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        baseLimits.push(input.limit);

        return {
          items: baseCandidates.slice(0, input.limit),
          plan: {
            denseTopK: 10,
            ftsTopK: 10,
            fusionLimit: 5,
            queryLanguage: "latin",
            requestedMode: "research",
            rerankCandidateLimit: 0,
            resolvedMode: "research",
            strategyVersion: "retrieval-planner-v1",
            topK: 1,
          },
        };
      },
    };

    const result = await createDocumentOutlineRetrievalPath({
      maxOutlinesPerQuery: 1,
      outlines,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "research",
      query: "research refund approval exceptions",
      queryVector: [0.1],
      topK: 1,
    });

    expect(baseLimits).toEqual([1]);
    expect(result.items.map((item) => item.nodeId)).toEqual(["leaf-overview-fallback-1"]);
  });

  it("keeps metrics absent in deep mode when the base retrieval reports none", async () => {
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 4 });
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => ({
        items: [retrievalItem({ nodeId: "leaf-plain" })],
      }),
    };

    const result = await createDocumentOutlineRetrievalPath({
      maxOutlinesPerQuery: 2,
      outlines,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      mode: "deep",
      query: "plain question",
      queryVector: [0.1],
      topK: 2,
    });

    expect(result.items.map((item) => item.nodeId)).toEqual(["leaf-plain"]);
    expect(result.metrics).toBeUndefined();
  });

  it("keeps hybrid results untouched in research mode when no outline node matches", async () => {
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 4 });
    await outlines.upsert({
      artifactHash: "b".repeat(64),
      createdAt: "2026-05-12T12:00:00.000Z",
      documentAssetId: DOC_A,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d82",
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      metadata: {},
      nodes: [
        {
          childNodeIds: [],
          children: [],
          id: "n-unrelated",
          level: 1,
          metadata: {},
          sectionPath: ["Unrelated"],
          sourceElementIds: [],
          sourceNodeIds: [],
          title: "Unrelated",
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
              documentAssetId: DOC_A,
              documentVersion: 1,
              sectionPath: ["Different"],
            },
            nodeId: "leaf-different",
          }),
        ],
        metrics: baseMetrics(),
      }),
    };

    const result = await createDocumentOutlineRetrievalPath({
      maxOutlinesPerQuery: 2,
      outlines,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      mode: "research",
      query: "different research",
      queryVector: [0.1],
      topK: 2,
    });

    expect(result.items[0]?.metadata.documentOutline).toBeUndefined();
    expect(result.items[0]?.metadata.reasoningTreeSearch).toBeUndefined();
    expect(result.metrics).not.toHaveProperty("documentOutlineMatchedItems");
    expect(result.metrics).not.toHaveProperty("reasoningTreeSearchNodes");
  });

  it("skips table retrieval in deep mode when explicit node kinds exclude tables", async () => {
    let callCount = 0;
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => {
        callCount += 1;

        return { items: [retrievalItem({ nodeId: "chunk-node" })] };
      },
    };

    const result = await createTableSpecificRetrievalPath({
      maxTableCandidates: 2,
      maxTableTopK: 2,
      retriever: baseRetriever,
      tableBoost: 0.5,
    }).retrieve({
      filters: { nodeKinds: ["chunk"] },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      mode: "deep",
      query: "show the revenue table",
      queryVector: [0.1],
      topK: 2,
    });

    expect(callCount).toBe(1);
    expect(result.items.map((item) => item.nodeId)).toEqual(["chunk-node"]);
  });

  it("breaks table merge score ties deterministically by node id", async () => {
    let callCount = 0;
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => {
        callCount += 1;

        if (callCount > 1) {
          return { items: [retrievalItem({ nodeId: "node-c", score: 0.2 })] };
        }

        return { items: [retrievalItem({ nodeId: "node-a", score: 0.7 })] };
      },
    };

    const result = await createTableSpecificRetrievalPath({
      maxTableCandidates: 2,
      maxTableTopK: 2,
      retriever: baseRetriever,
      tableBoost: 0.5,
    }).retrieve({
      filters: { nodeKinds: ["table"] },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 3,
      mode: "deep",
      query: "renewal amounts",
      queryVector: [0.1],
      topK: 2,
    });

    // node-c is boosted to 0.2 + 0.5 = 0.7, tying node-a; ties order by node id.
    expect(result.items.map((item) => item.nodeId)).toEqual(["node-a", "node-c"]);
    expect(result.items[1]?.score).toBeCloseTo(0.7);
  });

  it("skips image retrieval in deep mode when explicit node kinds exclude images", async () => {
    let callCount = 0;
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => {
        callCount += 1;

        return { items: [retrievalItem({ nodeId: "chunk-node" })] };
      },
    };

    const result = await createImageOcrRetrievalPath({
      imageBoost: 0.2,
      maxImageCandidates: 2,
      maxImageTopK: 2,
      retriever: baseRetriever,
    }).retrieve({
      filters: { nodeKinds: ["chunk"] },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      mode: "deep",
      query: "show the chart figure",
      queryVector: [0.1],
      topK: 2,
    });

    expect(callCount).toBe(1);
    expect(result.items.map((item) => item.nodeId)).toEqual(["chunk-node"]);
  });

  it("builds multimodal candidate metadata from nested multimodal image metadata", async () => {
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        if (input.filters?.nodeKinds?.includes("image")) {
          return {
            items: [
              retrievalItem({
                metadata: {
                  multimodal: {
                    assetRef: { assetId: "asset-1" },
                    boundingBox: { height: 10, width: 20, x: 1, y: 2 },
                    modality: "image",
                    parseElementId: "el-1",
                  },
                },
                nodeId: "img-1",
                score: 0.4,
              }),
            ],
          };
        }

        return { items: [retrievalItem({ nodeId: "chunk-node", score: 0.9 })] };
      },
    };

    const result = await createImageOcrRetrievalPath({
      imageBoost: 0.2,
      maxImageCandidates: 2,
      maxImageTopK: 2,
      retriever: baseRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 3,
      mode: "deep",
      query: "which figure shows the chart",
      queryVector: [0.1],
      topK: 2,
    });

    const imageItem = result.items.find((item) => item.nodeId === "img-1");
    expect(imageItem?.metadata.multimodalCandidate).toEqual({
      assetRef: { assetId: "asset-1" },
      boundingBox: { height: 10, width: 20, x: 1, y: 2 },
      documentAssetId: DOC_A,
      documentVersion: 1,
      modality: "image",
      parseElementId: "el-1",
      sectionPath: ["Guide"],
      source: "image-ocr-retrieval",
    });
  });

  it("skips table and image retrieval in deep mode for non-matching queries", async () => {
    let tableCalls = 0;
    const tableRetriever: BasicHybridRetriever = {
      retrieve: async () => {
        tableCalls += 1;

        return { items: [retrievalItem({ nodeId: "chunk-node" })] };
      },
    };
    await createTableSpecificRetrievalPath({
      maxTableCandidates: 1,
      maxTableTopK: 1,
      retriever: tableRetriever,
      tableBoost: 0.5,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "deep",
      query: "what is the refund policy",
      queryVector: [0.1],
      topK: 1,
    });
    expect(tableCalls).toBe(1);

    let imageCalls = 0;
    const imageRetriever: BasicHybridRetriever = {
      retrieve: async () => {
        imageCalls += 1;

        return { items: [retrievalItem({ nodeId: "chunk-node" })] };
      },
    };
    await createImageOcrRetrievalPath({
      imageBoost: 0.2,
      maxImageCandidates: 1,
      maxImageTopK: 1,
      retriever: imageRetriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "deep",
      query: "what is the refund policy",
      queryVector: [0.1],
      topK: 1,
    });
    expect(imageCalls).toBe(1);
  });

  it("runs extensions only from an already resolved mode", async () => {
    const makeCountingRetriever = () => {
      const counter = { calls: 0 };
      const retriever: BasicHybridRetriever = {
        retrieve: async () => {
          counter.calls += 1;

          return { items: [retrievalItem({ nodeId: "auto-node" })] };
        },
      };

      return { counter, retriever };
    };

    const table = makeCountingRetriever();
    await createTableSpecificRetrievalPath({
      maxTableCandidates: 1,
      maxTableTopK: 1,
      retriever: table.retriever,
      tableBoost: 0.5,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "deep",
      query: "totals table",
      queryVector: [0.1],
      topK: 1,
    });
    expect(table.counter.calls).toBe(2);

    const image = makeCountingRetriever();
    await createImageOcrRetrievalPath({
      imageBoost: 0.2,
      maxImageCandidates: 1,
      maxImageTopK: 1,
      retriever: image.retriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "deep",
      query: "renewal chart",
      queryVector: [0.1],
      topK: 1,
    });
    expect(image.counter.calls).toBe(2);

    const graph = makeCountingRetriever();
    await createGraphExpandedRetrievalPath({
      fanout: 1,
      graph: fakeGraph(() => traversalResult([])),
      graphBoost: 0.5,
      graphTopK: 1,
      maxDepth: 1,
      maxSeedEntities: 1,
      maxTraversalNodes: 2,
      retriever: graph.retriever,
      timeoutMs: 100,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "fast",
      query: "renewal chart",
      queryVector: [0.1],
      topK: 1,
    });
    expect(graph.counter.calls).toBe(1);

    const summary = makeCountingRetriever();
    await createSummaryTreeRetrievalPath({
      maxLeafTopK: 1,
      maxSelectedSections: 1,
      maxSummaryTopK: 1,
      retriever: summary.retriever,
    }).retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "fast",
      query: "renewal",
      queryVector: [0.1],
      topK: 1,
    });
    expect(summary.counter.calls).toBe(1);
  });

  it("merges duplicate traversal entities at their shallowest depth and boosts overlapping graph hits", async () => {
    const calls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async (input) => {
        calls.push(JSON.parse(JSON.stringify(input)));

        if (calls.length > 1) {
          return {
            items: [
              retrievalItem({
                nodeId: "node-a",
                projectionIds: ["graph-projection"],
                score: 0.4,
                sources: ["fts"],
              }),
              retrievalItem({ nodeId: "node-c", score: 1.2 }),
            ],
          };
        }

        return {
          items: [
            retrievalItem({
              metadata: {
                graphEntities: "ent-b",
                nodeMetadata: { graphEntityIds: ["ent-a"] },
              },
              nodeId: "node-a",
              score: 1,
            }),
            retrievalItem({ nodeId: "node-b", score: 0.6 }),
          ],
          metrics: baseMetrics(),
        };
      },
    };
    const graph = fakeGraph((startEntityId) => {
      if (startEntityId === "ent-b") {
        return traversalResult([
          traversalEntity({ depth: 0, id: "ent-b", name: "Beta" }),
          traversalEntity({ depth: 1, id: "ent-shared", name: "Shared" }),
        ]);
      }

      return traversalResult(
        [
          traversalEntity({ depth: 0, id: "ent-a", name: "Alpha" }),
          traversalEntity({ depth: 0, id: "ent-shared", name: "Shared" }),
        ],
        true,
      );
    });

    const result = await createGraphExpandedRetrievalPath({
      fanout: 2,
      graph,
      graphBoost: 0.5,
      graphTopK: 4,
      maxDepth: 2,
      maxSeedEntities: 2,
      maxTraversalNodes: 5,
      retriever: baseRetriever,
      timeoutMs: 250,
    }).retrieve({
      filters: { entities: ["Preexisting"] },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 3,
      mode: "deep",
      query: "acme partners",
      queryVector: [0.1],
      topK: 2,
    });

    // Graph entity ids drive matching; names remain for backward-compatible metadata.
    expect(calls[1]?.filters?.entities).toEqual([
      "Preexisting",
      "ent-a",
      "Alpha",
      "ent-b",
      "Beta",
      "ent-shared",
      "Shared",
    ]);
    // node-a merges the graph hit (1 + 0.4 * 0.5); node-c ties node-b at 0.6 and sorts by id.
    expect(result.items.map((item) => item.nodeId)).toEqual(["node-a", "node-b", "node-c"]);
    expect(result.items[0]?.score).toBeCloseTo(1.2);
    expect(result.items[0]?.metadata.graphExpansion).toEqual({
      seedEntityIds: ["ent-b", "ent-a"],
      traversedEntityIds: ["ent-a", "ent-b", "ent-shared"],
    });
    expect(result.items[0]?.projectionIds).toEqual(["projection-1", "graph-projection"]);
    expect(result.items[0]?.sources).toEqual(["dense", "fts"]);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        graphExpansionCandidates: 2,
        graphExpansionSeeds: 2,
        graphExpansionTimedOut: true,
        graphExpansionTraversedEntities: 3,
      }),
    );
  });

  it("keeps metrics absent when graph expansion finds no readable entities on a metric-less base", async () => {
    let callCount = 0;
    const baseRetriever: BasicHybridRetriever = {
      retrieve: async () => {
        callCount += 1;

        return {
          items: [
            retrievalItem({
              metadata: { graphEntityIds: ["ent-restricted"] },
              nodeId: "node-seed",
            }),
          ],
        };
      },
    };
    const graph = fakeGraph(() =>
      traversalResult([
        traversalEntity({
          depth: 0,
          id: "ent-restricted",
          name: "Restricted",
          permissionScope: ["finance"],
        }),
      ]),
    );

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
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "deep",
      permissionScope: ["tenant-1"],
      query: "restricted policy",
      queryVector: [0.1],
      topK: 1,
    });

    expect(callCount).toBe(1);
    expect(result.items.map((item) => item.nodeId)).toEqual(["node-seed"]);
    expect(result.metrics).toBeUndefined();
  });
});
