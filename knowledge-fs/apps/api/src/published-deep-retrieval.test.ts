import {
  DeepGraphCapabilityUnavailableError,
  type GraphIndexRepository,
  type PageIndexWholeTreeSelector,
  type PublishedGraphIndexRepository,
  type PublishedPageIndexRepository,
  createRetrievalPlanner,
} from "@knowledge/api";
import type { RerankerProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import { createApiRetriever } from "./retriever-options";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const PUBLICATION_ID = "20000000-0000-4000-8000-000000000001";
const GENERATION_ID = "30000000-0000-4000-8000-000000000001";
const BASE_NODE_ID = "40000000-0000-4000-8000-000000000001";
const GRAPH_NODE_ID = "40000000-0000-4000-8000-000000000002";
const ROOT_ENTITY_ID = "50000000-0000-4000-8000-000000000001";
const CHILD_ENTITY_ID = "50000000-0000-4000-8000-000000000002";
const TENANT_ID = "tenant-1";

describe("production published Deep stage order", () => {
  it("runs published dense+FTS, published Graph expansion, then exactly one unified rerank", async () => {
    const events: string[] = [];
    const legacyTraverse = vi.fn(async () => {
      throw new Error("legacy graph must not be called for a published snapshot");
    });
    const publishedGraph: PublishedGraphIndexRepository = {
      findSeedEntityIds: async (input) => {
        events.push("published-seed");
        expect(input.snapshot.publicationId).toBe(PUBLICATION_ID);
        expect(input.sourceNodeIds).toEqual([BASE_NODE_ID]);
        return [ROOT_ENTITY_ID];
      },
      traverse: async (input) => {
        events.push("published-traverse");
        expect(input.snapshot.publicationId).toBe(PUBLICATION_ID);
        return {
          entities: [
            graphEntity(ROOT_ENTITY_ID, BASE_NODE_ID, 0),
            graphEntity(CHILD_ENTITY_ID, GRAPH_NODE_ID, 1),
          ],
          metrics: {
            depthReached: 1,
            elapsedMs: 1,
            exploredRelations: 1,
            fanout: input.fanout,
            maxDepth: input.maxDepth,
            maxNodes: input.maxNodes,
            timedOut: false,
          },
          relations: [],
          truncated: false,
        };
      },
    };
    const rerankCalls: string[][] = [];
    const reranker: RerankerProvider = {
      kind: "static",
      models: async () => [],
      rerank: async (input) => {
        events.push("rerank");
        rerankCalls.push(input.documents.map((document) => document.id));
        const ranked = [...input.documents].sort((left, right) =>
          left.id === GRAPH_NODE_ID ? -1 : right.id === GRAPH_NODE_ID ? 1 : 0,
        );
        return {
          items: ranked.map((document, rank) => ({
            document: {
              ...document,
              metadata: { ...(document.metadata ?? {}) },
            },
            index: input.documents.findIndex((candidate) => candidate.id === document.id),
            score: 1 - rank / 10,
          })),
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        };
      },
    };
    const pageIndex = {
      listOutlines: async () => ({ items: [] }),
      openLeafEvidence: async () => {
        throw new Error("PageIndex must not run for Deep");
      },
    } as unknown as PublishedPageIndexRepository;
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      graph: { traverse: legacyTraverse } as unknown as GraphIndexRepository,
      pageIndex,
      pageIndexSemanticTreeSearch: { score: async () => [] },
      pageIndexWholeTreeSelector: wholeTreeSelectorStub(),
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      publishedGraph,
      repository: {
        publishedMembershipEnforced: true,
        searchDense: async (input) => {
          const stage = input.filters?.nodeIds ? "graph-dense" : "base-dense";
          events.push(stage);
          expect(input.projectionSetPublicationId).toBe(PUBLICATION_ID);
          return [
            candidate(
              input.filters?.nodeIds ? GRAPH_NODE_ID : BASE_NODE_ID,
              input.filters?.nodeIds
                ? "60000000-0000-4000-8000-000000000002"
                : "60000000-0000-4000-8000-000000000001",
              "dense",
            ),
          ];
        },
        searchFts: async (input) => {
          const stage = input.filters?.nodeIds ? "graph-fts" : "base-fts";
          events.push(stage);
          expect(input.projectionSetPublicationId).toBe(PUBLICATION_ID);
          return [
            candidate(
              input.filters?.nodeIds ? GRAPH_NODE_ID : BASE_NODE_ID,
              input.filters?.nodeIds
                ? "70000000-0000-4000-8000-000000000002"
                : "70000000-0000-4000-8000-000000000001",
              "fts",
            ),
          ];
        },
      },
      rerankerOptions: { model: "rerank-v1", provider: reranker },
      strictPublishedReads: true,
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: SPACE_ID,
      limit: 2,
      mode: "deep",
      permissionScope: ["team:camera"],
      projectionSnapshot: {
        fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
        headRevision: 9,
        knowledgeSpaceId: SPACE_ID,
        projectionVersion: 3,
        publicationId: PUBLICATION_ID,
        tenantId: TENANT_ID,
      },
      query: "camera warranty policy",
      queryVector: [0.1, 0.2],
      tenantId: TENANT_ID,
      topK: 2,
    });

    expect(legacyTraverse).not.toHaveBeenCalled();
    expect(events.filter((event) => event === "rerank")).toHaveLength(1);
    expect(rerankCalls).toEqual([expect.arrayContaining([BASE_NODE_ID, GRAPH_NODE_ID])]);
    expect(rerankCalls[0]).toHaveLength(2);
    expect(events.indexOf("published-seed")).toBeGreaterThan(events.indexOf("base-dense"));
    expect(events.indexOf("published-seed")).toBeGreaterThan(events.indexOf("base-fts"));
    expect(events.indexOf("published-traverse")).toBeGreaterThan(events.indexOf("published-seed"));
    expect(events.indexOf("graph-dense")).toBeGreaterThan(events.indexOf("published-traverse"));
    expect(events.indexOf("graph-fts")).toBeGreaterThan(events.indexOf("published-traverse"));
    expect(events.at(-1)).toBe("rerank");
    expect(result.items[0]?.nodeId).toBe(GRAPH_NODE_ID);
    expect(result.metrics).toMatchObject({
      denseCandidates: 1,
      ftsCandidates: 1,
      graphExpansionCandidates: 1,
      rerankCandidates: 2,
    });
  });

  it("fails only Deep when the published Graph capability is disabled", async () => {
    const dense = vi.fn(async () => [candidate(BASE_NODE_ID, "base-projection", "dense")]);
    const fts = vi.fn(async () => []);
    const pageIndex = publishedResearchPageIndex();
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      pageIndex,
      pageIndexSemanticTreeSearch: {
        score: async (input) =>
          input.candidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            reason: "semantic match",
            score: 0.8,
          })),
      },
      pageIndexWholeTreeSelector: wholeTreeSelectorStub(),
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        publishedMembershipEnforced: true,
        searchDense: dense,
        searchFts: fts,
      },
      rerankerOptions: {
        providerFactory: () => ({
          kind: "static",
          models: async () => [],
          rerank: async (input) => ({
            items: input.documents.map((document, index) => ({
              document,
              index,
              score: 1,
            })),
            metadata: { model: input.model, provider: "static" },
            model: input.model,
          }),
        }),
      },
      strictPublishedReads: true,
    });
    const baseInput = {
      denseProjectionModel: "embedding-space-v1",
      knowledgeSpaceId: SPACE_ID,
      limit: 2,
      permissionScope: ["team:camera"],
      projectionSnapshot: publishedSnapshot(),
      query: "camera warranty policy",
      queryVector: [0.1, 0.2],
      retrievalProfile: {
        defaultMode: "fast" as const,
        reasoningModel: {
          model: "chat",
          pluginId: "vendor/chat",
          provider: "vendor",
        },
        rerank: {
          enabled: true as const,
          model: {
            model: "rerank-v1",
            pluginId: "vendor/reranker",
            provider: "vendor",
          },
        },
        revision: 1,
        scoreThreshold: {
          enabled: false as const,
          stage: "mode-final" as const,
        },
        topK: 2,
      },
      tenantId: TENANT_ID,
      topK: 2,
    } as const;

    await expect(retriever.retrieve({ ...baseInput, mode: "fast" })).resolves.toMatchObject({
      items: [{ nodeId: BASE_NODE_ID }],
    });
    await expect(retriever.retrieve({ ...baseInput, mode: "research" })).resolves.toMatchObject({
      items: [{ nodeId: BASE_NODE_ID }],
    });
    const callsBeforeDeep = dense.mock.calls.length + fts.mock.calls.length;
    await expect(retriever.retrieve({ ...baseInput, mode: "deep" })).rejects.toBeInstanceOf(
      DeepGraphCapabilityUnavailableError,
    );
    expect(dense.mock.calls.length + fts.mock.calls.length).toBe(callsBeforeDeep);
    expect(pageIndex.searchSections).not.toHaveBeenCalled();
    expect(pageIndex.listOutlines).toHaveBeenCalledOnce();
  });
});

function wholeTreeSelectorStub(): PageIndexWholeTreeSelector {
  return {
    select: async (input) => ({
      estimatedPromptTokens: 100,
      nodeCount: input.outline.nodes.length,
      selections: input.outline.nodes[0]
        ? [
            {
              nodeId: input.outline.nodes[0].id,
              reason: "semantic match",
              score: 0.8,
            },
          ]
        : [],
      strategy: "whole-tree",
      summaryCoverage: 1,
    }),
  };
}

function publishedResearchPageIndex() {
  const documentAssetId = "80000000-0000-4000-8000-000000000001";
  const outlineNode = {
    childNodeIds: [],
    children: [],
    endOffset: 100,
    id: "outline-policy",
    level: 1,
    metadata: {},
    sectionPath: ["Policy"],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: 0,
    summary: "Camera warranty policy",
    title: "Policy",
    tocSource: "parser-heading" as const,
  };
  const outline = {
    artifactHash: "b".repeat(64),
    createdAt: "2026-08-05T00:00:00.000Z",
    documentAssetId,
    id: "81000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    nodes: [outlineNode],
    outlineVersion: "outline-v1",
    parseArtifactId: "82000000-0000-4000-8000-000000000001",
    publicationGenerationId: GENERATION_ID,
    version: 1,
  };
  const listOutlines = vi.fn(
    async (input: Parameters<PublishedPageIndexRepository["listOutlines"]>[0]) => ({
      items: input.documentAssetIds?.includes(documentAssetId)
        ? [
            {
              documentAssetId,
              generationId: GENERATION_ID,
              outline,
              publicationId: input.publicationId,
            },
          ]
        : [],
    }),
  );
  const searchSections = vi.fn(async () => ({
    items: [],
    tokenizerVersion: "pageindex-nfkc-exact-v1" as const,
    truncated: false,
  }));
  const openLeafEvidence = vi.fn(
    async (input: Parameters<PublishedPageIndexRepository["openLeafEvidence"]>[0]) => ({
      items: [
        {
          citation: {
            artifactHash: outline.artifactHash,
            documentAssetId,
            documentVersion: 1,
            sectionPath: ["Policy"],
          },
          node: {
            artifactHash: outline.artifactHash,
            documentAssetId,
            endOffset: 100,
            id: BASE_NODE_ID,
            kind: "chunk" as const,
            knowledgeSpaceId: SPACE_ID,
            metadata: { text: BASE_NODE_ID },
            parseArtifactId: outline.parseArtifactId,
            permissionScope: ["team:camera"],
            publicationGenerationId: GENERATION_ID,
            sourceLocation: { sectionPath: ["Policy"] },
            startOffset: 0,
            text: BASE_NODE_ID,
          },
          outlineId: outline.id,
          outlineNodeId: input.outlineNodeId,
          projections: [
            {
              id: "83000000-0000-4000-8000-000000000001",
              type: "dense-vector" as const,
            },
          ],
        },
      ],
      openedRange: { endOffset: 100, startOffset: 0 },
      outline,
      selectedNode: outlineNode,
      truncated: false,
    }),
  );
  return { listOutlines, openLeafEvidence, searchSections };
}

function graphEntity(id: string, sourceNodeId: string, depth: number) {
  return {
    aliases: [],
    canonicalKey: `organization:${id}`,
    confidence: 0.9,
    createdAt: "2026-07-14T00:00:00.000Z",
    depth,
    extractionVersion: 1,
    id,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    name: id,
    permissionScope: ["team:camera"],
    publicationGenerationId: GENERATION_ID,
    sourceNodeIds: [sourceNodeId],
    type: "organization" as const,
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function candidate(nodeId: string, projectionId: string, source: "dense" | "fts") {
  return {
    citation: {
      artifactHash: "b".repeat(64),
      documentAssetId: "80000000-0000-4000-8000-000000000001",
      documentVersion: 1,
      sectionPath: ["Policy"],
    },
    metadata: { nodeKind: "chunk", text: nodeId },
    nodeId,
    permissionScope: ["team:camera"],
    projectionId,
    score: 0.9,
    source,
  };
}

function publishedSnapshot() {
  return {
    fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    headRevision: 9,
    knowledgeSpaceId: SPACE_ID,
    projectionVersion: 3,
    publicationId: PUBLICATION_ID,
    tenantId: TENANT_ID,
  } as const;
}
