import type {
  DocumentOutline,
  DocumentOutlineNode,
  KnowledgeNode,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type {
  PublishedPageIndexOutlineItem,
  PublishedPageIndexRepository,
} from "./published-page-index-repository";
import {
  PublishedPageIndexCapabilityUnavailableError,
  PublishedPageIndexScanLimitExceededError,
  createPublishedPageIndexRetrievalPath,
} from "./published-page-index-retrieval";
import { createRetrievalPlanner } from "./retrieval-planner";
import type { BasicHybridRetriever, RetrieveHybridInput } from "./retrieval-types";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const PUBLICATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";

describe("published PageIndex retrieval", () => {
  it("retrieves a published Summary hit without calling the hybrid leg", async () => {
    const base = vi.fn(async () => {
      throw new Error("hybrid must not run");
    });
    const pageIndex = pageIndexRepository([
      outlineItem("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", "generation-a", {
        summary: "Camera warranty and sensor policy",
        title: "Support",
      }),
    ]);
    const retriever = createPublishedPageIndexRetrievalPath({
      allowOutlineScanFallback: true,
      maxConcurrentLeafOpens: 4,
      maxLeafEvidenceItems: 100,
      maxOutlineNodesScanned: 100,
      maxOutlinesScanned: 100,
      maxSelectedSections: 20,
      outlinePageSize: 10,
      pageIndex,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: { retrieve: base },
    });

    const result = await retriever.retrieve(input());

    expect(base).not.toHaveBeenCalled();
    expect(pageIndex.listOutlines).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionScope: ["document:read"],
        publicationId: PUBLICATION_ID,
      }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        score: 0.9,
        sources: ["pageindex"],
      }),
    ]);
    expect(result.metrics).toMatchObject({
      denseCandidates: 0,
      ftsCandidates: 0,
      pageIndexOpenedRanges: 1,
      pageIndexScoreVersion: "pageindex-lexical-v2",
    });
    expect(result.plan).toMatchObject({
      denseTopK: 0,
      ftsTopK: 0,
      fusionLimit: 0,
      rerankCandidateLimit: 0,
      resolvedMode: "research",
    });
  });

  it("uses bounded indexed search without enumerating a large outline corpus", async () => {
    const item = outlineItem("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", "generation-a", {
      summary: "Camera warranty",
      title: "Support",
    });
    const delegate = pageIndexRepository([item]);
    const listOutlines = vi.fn(async () => {
      throw new Error("10k+ outlines must never be enumerated");
    });
    const searchSections = vi.fn(async () => ({
      items: [
        {
          documentAssetId: item.documentAssetId,
          documentVersion: item.outline.version,
          generationId: item.generationId,
          node: item.outline.nodes[0] as DocumentOutlineNode,
          outlineId: item.outline.id,
          outlineVersion: item.outline.outlineVersion,
          score: 0.5,
          visitedNodeIds: [item.outline.nodes[0]?.id ?? "missing"],
        },
      ],
      tokenizerVersion: "pageindex-nfkc-exact-v1" as const,
      truncated: false,
    }));
    const retriever = createPublishedPageIndexRetrievalPath({
      maxConcurrentLeafOpens: 2,
      maxLeafEvidenceItems: 100,
      maxOutlineNodesScanned: 1,
      maxOutlinesScanned: 1,
      maxSelectedSections: 100,
      outlinePageSize: 1,
      pageIndex: {
        listOutlines,
        openLeafEvidence: delegate.openLeafEvidence,
        searchSections,
      },
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: emptyRetriever(),
    });

    const result = await retriever.retrieve(input({ topK: 100 }));

    expect(searchSections).toHaveBeenCalledOnce();
    expect(listOutlines).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.metrics).toMatchObject({
      pageIndexCandidateTruncated: false,
      pageIndexScannedNodes: 0,
      pageIndexScannedOutlines: 0,
    });
  });

  it("propagates threshold filtering performed inside bounded indexed search", async () => {
    const item = outlineItem("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", "generation-a", {
      summary: "Camera warranty",
      title: "Support",
    });
    const delegate = pageIndexRepository([item]);
    const retriever = createPublishedPageIndexRetrievalPath({
      maxConcurrentLeafOpens: 2,
      maxLeafEvidenceItems: 20,
      maxOutlineNodesScanned: 1,
      maxOutlinesScanned: 1,
      maxSelectedSections: 20,
      outlinePageSize: 1,
      pageIndex: {
        listOutlines: delegate.listOutlines,
        openLeafEvidence: delegate.openLeafEvidence,
        searchSections: vi.fn(async () => ({
          filteredCount: 4,
          items: [
            {
              documentAssetId: item.documentAssetId,
              documentVersion: item.outline.version,
              generationId: item.generationId,
              node: item.outline.nodes[0] as DocumentOutlineNode,
              outlineId: item.outline.id,
              outlineVersion: item.outline.outlineVersion,
              score: 0.9,
              visitedNodeIds: [item.outline.nodes[0]?.id ?? "missing"],
            },
          ],
          tokenizerVersion: "pageindex-nfkc-exact-v1" as const,
          truncated: false,
        })),
      },
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: emptyRetriever(),
    });

    const result = await retriever.retrieve(
      input({
        retrievalProfile: profile({
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.6 },
          topK: 1,
        }),
        topK: 1,
      }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.metrics?.scoreThresholdFilteredCandidates).toBe(4);
  });

  it("applies the normalized threshold inclusively before final Top K", async () => {
    const pageIndex = pageIndexRepository([
      outlineItem("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", "generation-a", {
        summary: "Camera warranty and sensor policy",
        title: "Support",
      }),
      outlineItem("018f0d60-7a49-7cc2-9c1b-5b36f18f2c52", "generation-b", {
        summary: "Camera only",
        title: "Support",
      }),
    ]);
    const retriever = configuredRetriever(pageIndex);

    const result = await retriever.retrieve(
      input({
        limit: 1,
        retrievalProfile: profile({
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.9 },
          topK: 1,
        }),
        topK: 1,
      }),
    );

    expect(pageIndex.openLeafEvidence).toHaveBeenCalledOnce();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.score).toBe(0.9);
    expect(result.metrics?.scoreThresholdFilteredCandidates).toBe(1);
  });

  it.each(["fast", "deep"] as const)("leaves %s on the ordinary retrieval stack", async (mode) => {
    const base = vi.fn(async () => ({ items: [] }));
    const pageIndex = pageIndexRepository([]);
    const retriever = createPublishedPageIndexRetrievalPath({
      allowOutlineScanFallback: true,
      maxConcurrentLeafOpens: 4,
      maxLeafEvidenceItems: 100,
      maxOutlineNodesScanned: 10,
      maxOutlinesScanned: 10,
      maxSelectedSections: 10,
      outlinePageSize: 5,
      pageIndex,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: { retrieve: base },
    });

    await retriever.retrieve(input({ mode }));

    expect(base).toHaveBeenCalledOnce();
    expect(pageIndex.listOutlines).not.toHaveBeenCalled();
  });

  it("fails closed without a fixed snapshot or server-issued permission scope", async () => {
    const retriever = configuredRetriever(pageIndexRepository([]));

    await expect(
      retriever.retrieve(input({ projectionSnapshot: undefined })),
    ).rejects.toBeInstanceOf(PublishedPageIndexCapabilityUnavailableError);
    await expect(retriever.retrieve(input({ permissionScope: undefined }))).rejects.toBeInstanceOf(
      PublishedPageIndexCapabilityUnavailableError,
    );
  });

  it("fails instead of silently returning a partial corpus when scan bounds are exceeded", async () => {
    const retriever = createPublishedPageIndexRetrievalPath({
      allowOutlineScanFallback: true,
      maxConcurrentLeafOpens: 4,
      maxLeafEvidenceItems: 100,
      maxOutlineNodesScanned: 1,
      maxOutlinesScanned: 10,
      maxSelectedSections: 10,
      outlinePageSize: 5,
      pageIndex: pageIndexRepository([
        outlineItem("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", "generation-a", {
          children: [outlineNode({ id: "child-1" })],
        }),
      ]),
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: emptyRetriever(),
    });

    await expect(retriever.retrieve(input())).rejects.toBeInstanceOf(
      PublishedPageIndexScanLimitExceededError,
    );
  });

  it("bounds concurrent leaf opens and the total requested leaf evidence", async () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      outlineItem(
        `018f0d60-7a49-7cc2-9c1b-${(100 + index).toString().padStart(12, "0")}`,
        `generation-${index}`,
        { summary: "Camera warranty", title: `Support ${index}` },
      ),
    );
    const delegate = pageIndexRepository(items);
    let active = 0;
    let peak = 0;
    let requested = 0;
    const openLeafEvidence = vi.fn(async (openInput) => {
      requested += openInput.limit;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await delegate.openLeafEvidence(openInput);
      } finally {
        active -= 1;
      }
    });
    const retriever = createPublishedPageIndexRetrievalPath({
      allowOutlineScanFallback: true,
      maxConcurrentLeafOpens: 2,
      maxLeafEvidenceItems: 6,
      maxOutlineNodesScanned: 100,
      maxOutlinesScanned: 100,
      maxSelectedSections: 20,
      outlinePageSize: 20,
      pageIndex: { listOutlines: delegate.listOutlines, openLeafEvidence },
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: emptyRetriever(),
    });

    await retriever.retrieve(input({ limit: 10, topK: 10 }));

    expect(openLeafEvidence).toHaveBeenCalledTimes(6);
    expect(requested).toBeLessThanOrEqual(6);
    expect(peak).toBe(2);
  });
});

function configuredRetriever(pageIndex: PublishedPageIndexRepository): BasicHybridRetriever {
  return createPublishedPageIndexRetrievalPath({
    allowOutlineScanFallback: true,
    maxConcurrentLeafOpens: 4,
    maxLeafEvidenceItems: 100,
    maxOutlineNodesScanned: 100,
    maxOutlinesScanned: 100,
    maxSelectedSections: 20,
    outlinePageSize: 10,
    pageIndex,
    planner: createRetrievalPlanner({ maxTopK: 100 }),
    retriever: emptyRetriever(),
  });
}

function pageIndexRepository(
  items: readonly PublishedPageIndexOutlineItem[],
): PublishedPageIndexRepository & {
  readonly listOutlines: ReturnType<typeof vi.fn>;
  readonly openLeafEvidence: ReturnType<typeof vi.fn>;
} {
  const listOutlines = vi.fn(async () => ({ items }));
  const openLeafEvidence = vi.fn(async (openInput) => {
    const item = items.find((candidate) => candidate.outline.id === openInput.outlineId);
    if (!item) {
      throw new Error("outline not found");
    }
    const selectedNode = item.outline.nodes[0];
    if (!selectedNode) {
      throw new Error("outline node not found");
    }
    const node = knowledgeNode(item.documentAssetId, item.generationId, selectedNode.id);

    return {
      items: [
        {
          citation: {
            artifactHash: node.artifactHash,
            documentAssetId: node.documentAssetId,
            documentVersion: item.outline.version,
            endOffset: node.endOffset,
            sectionPath: [...node.sourceLocation.sectionPath],
            startOffset: node.startOffset,
          },
          node,
          outlineId: item.outline.id,
          outlineNodeId: selectedNode.id,
          projections: [
            {
              id: `018f0d60-7a49-7cc2-9c1b-${item.documentAssetId.slice(-12)}`,
            },
          ],
        },
      ],
      openedRange: { endOffset: selectedNode.endOffset ?? 100, startOffset: 0 },
      outline: item.outline,
      selectedNode,
    };
  });

  return { listOutlines, openLeafEvidence };
}

function outlineItem(
  outlineId: string,
  generationId: string,
  nodeOverrides: Partial<DocumentOutlineNode>,
): PublishedPageIndexOutlineItem {
  const documentAssetId = outlineId.replace(/.$/, "9");

  return {
    documentAssetId,
    generationId,
    outline: {
      artifactHash: "a".repeat(64),
      createdAt: "2026-07-14T00:00:00.000Z",
      documentAssetId,
      id: outlineId,
      knowledgeSpaceId: SPACE_ID,
      metadata: {},
      nodes: [outlineNode(nodeOverrides)],
      outlineVersion: "document-outline-v1",
      parseArtifactId: outlineId.replace(/.$/, "8"),
      publicationGenerationId: generationId,
      version: 1,
    },
    publicationId: PUBLICATION_ID,
  };
}

function outlineNode(overrides: Partial<DocumentOutlineNode> = {}): DocumentOutlineNode {
  return {
    childNodeIds: [],
    children: [],
    endOffset: 100,
    id: "outline-node-1",
    level: 1,
    metadata: {},
    sectionPath: ["Support"],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: 0,
    title: "General",
    tocSource: "parser-heading",
    ...overrides,
  };
}

function knowledgeNode(
  documentAssetId: string,
  publicationGenerationId: string,
  suffix: string,
): KnowledgeNode {
  return {
    artifactHash: "a".repeat(64),
    documentAssetId,
    endOffset: 80,
    id: documentAssetId.replace(/.$/, suffix.endsWith("1") ? "7" : "6"),
    kind: "chunk",
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    parseArtifactId: documentAssetId.replace(/.$/, "8"),
    permissionScope: ["document:read"],
    publicationGenerationId,
    sourceLocation: { sectionPath: ["Support"] },
    startOffset: 10,
    text: "Published camera warranty evidence",
  };
}

function input(overrides: Partial<RetrieveHybridInput> = {}): RetrieveHybridInput {
  return {
    knowledgeSpaceId: SPACE_ID,
    limit: 5,
    mode: "research",
    permissionScope: ["document:read"],
    projectionSnapshot: {
      fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
      headRevision: 3,
      knowledgeSpaceId: SPACE_ID,
      projectionVersion: 2,
      publicationId: PUBLICATION_ID,
      tenantId: "tenant-1",
    },
    query: "camera warranty sensor",
    queryVector: [],
    retrievalProfile: profile(),
    tenantId: "tenant-1",
    topK: 5,
    ...overrides,
  };
}

function profile(
  overrides: Partial<KnowledgeSpaceRetrievalProfile> = {},
): KnowledgeSpaceRetrievalProfile {
  return {
    defaultMode: "research",
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "vendor/reasoning",
      provider: "vendor",
    },
    rerank: { enabled: false },
    revision: 1,
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 5,
    ...overrides,
  };
}

function emptyRetriever(): BasicHybridRetriever {
  return { retrieve: async () => ({ items: [] }) };
}
