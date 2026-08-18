import type { DocumentOutline, KnowledgeNode } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { PublishedPageIndexRepository } from "./published-page-index-repository";
import { createResearchOutlineEvidenceRetrieval } from "./research-outline-evidence-retrieval";

const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const outlineNode = {
  childNodeIds: [],
  children: [],
  endOffset: 100,
  id: "section-1",
  level: 1,
  metadata: {},
  sectionPath: ["Renewal"],
  sourceElementIds: [],
  sourceNodeIds: ["base-node"],
  startOffset: 0,
  summary: "Renewal notice and timing",
  title: "Renewal",
  tocSource: "llm-inferred" as const,
};
const outline: DocumentOutline = {
  artifactHash: "a".repeat(64),
  createdAt: new Date(0).toISOString(),
  documentAssetId,
  id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  knowledgeSpaceId: "space-1",
  metadata: {},
  nodes: [outlineNode],
  outlineVersion: "outline-v1",
  parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
  version: 1,
};

describe("Research outline evidence retrieval", () => {
  it("opens bounded published outline ranges and rank-fuses them with full-space recall", async () => {
    const listOutlines = vi.fn(async () => ({
      items: [
        {
          documentAssetId,
          generationId: "generation-1",
          outline,
          publicationId: "publication-1",
        },
      ],
    }));
    const openLeafEvidence = vi.fn(async () => ({
      items: [
        {
          citation: {
            artifactHash: "a".repeat(64),
            documentAssetId,
            documentVersion: 1,
            endOffset: 100,
            sectionPath: ["Renewal"],
            startOffset: 0,
          },
          node: knowledgeNode("opened-node", "Renewal notice is thirty days"),
          outlineId: outline.id,
          outlineNodeId: outlineNode.id,
          projections: [{ id: "projection-opened", type: "dense-vector" as const }],
        },
      ],
      openedRange: { endOffset: 100, startOffset: 0 },
      outline,
      selectedNode: outlineNode,
    }));
    const searchSections = vi.fn(async () => ({
      items: [
        {
          documentAssetId,
          documentVersion: 1,
          generationId: "generation-1",
          node: outlineNode,
          outlineId: outline.id,
          outlineVersion: outline.outlineVersion,
          score: 1,
          visitedNodeIds: [outlineNode.id],
        },
      ],
      tokenizerVersion: "pageindex-nfkc-exact-v1" as const,
      truncated: false,
    }));
    const pageIndex: PublishedPageIndexRepository = {
      listOutlines,
      openLeafEvidence,
      searchSections,
    };
    const retriever = createResearchOutlineEvidenceRetrieval({
      pageIndex,
      retriever: {
        retrieve: async () => ({
          items: [hybridItem("base-node", "Renewal summary")],
          metrics: {
            denseCandidates: 1,
            denseMs: 1,
            ftsCandidates: 1,
            ftsMs: 1,
            fusedCandidates: 1,
            fusionMs: 1,
            totalMs: 3,
          },
        }),
      },
    });

    const result = await retriever.retrieve({
      denseProjectionModel: "vector-space-1",
      knowledgeSpaceId: "space-1",
      limit: 10,
      mode: "research",
      permissionScope: ["tenant:tenant-1"],
      projectionSnapshot: {
        fingerprint: "a".repeat(64),
        headRevision: 1,
        knowledgeSpaceId: "space-1",
        projectionVersion: 1,
        publicationId: "publication-1",
        tenantId: "tenant-1",
      },
      query: "renewal notice",
      queryVector: [0.1],
      tenantId: "tenant-1",
      topK: 10,
    });

    expect(listOutlines).toHaveBeenCalledWith(
      expect.objectContaining({ documentAssetIds: [documentAssetId], limit: 10 }),
    );
    expect(searchSections).toHaveBeenCalledOnce();
    expect(openLeafEvidence).toHaveBeenCalledOnce();
    expect(result.items.map((item) => item.nodeId)).toEqual(["base-node", "opened-node"]);
    expect(result.metrics).toMatchObject({
      pageIndexMatchedNodes: 1,
      pageIndexOpenedRanges: 1,
      researchOutlineLexicalCandidates: 1,
    });
  });

  it("keeps exact outline-section recall available when dense and FTS return no candidates", async () => {
    const listOutlines = vi.fn(async () => ({ items: [] }));
    const openLeafEvidence = vi.fn(async () => ({
      items: [
        {
          citation: {
            artifactHash: "a".repeat(64),
            documentAssetId,
            documentVersion: 1,
            endOffset: 100,
            sectionPath: ["Renewal"],
            startOffset: 0,
          },
          node: knowledgeNode("outline-only", "Renewal notice is thirty days"),
          outlineId: outline.id,
          outlineNodeId: outlineNode.id,
          projections: [{ id: "projection-outline-only", type: "dense-vector" as const }],
        },
      ],
      openedRange: { endOffset: 100, startOffset: 0 },
      outline,
      selectedNode: outlineNode,
    }));
    const searchSections = vi.fn(async () => ({
      items: [
        {
          documentAssetId,
          documentVersion: 1,
          generationId: "generation-1",
          node: outlineNode,
          outlineId: outline.id,
          outlineVersion: outline.outlineVersion,
          score: 1,
          visitedNodeIds: [outlineNode.id],
        },
      ],
      tokenizerVersion: "pageindex-nfkc-exact-v1" as const,
      truncated: false,
    }));
    const retriever = createResearchOutlineEvidenceRetrieval({
      pageIndex: { listOutlines, openLeafEvidence, searchSections },
      retriever: {
        retrieve: async () => ({
          items: [],
          metrics: {
            denseCandidates: 0,
            denseMs: 1,
            ftsCandidates: 0,
            ftsMs: 1,
            fusedCandidates: 0,
            fusionMs: 1,
            totalMs: 3,
          },
        }),
      },
    });

    const result = await retriever.retrieve({
      denseProjectionModel: "vector-space-1",
      knowledgeSpaceId: "space-1",
      limit: 10,
      mode: "research",
      permissionScope: ["tenant:tenant-1"],
      projectionSnapshot: {
        fingerprint: "a".repeat(64),
        headRevision: 1,
        knowledgeSpaceId: "space-1",
        projectionVersion: 1,
        publicationId: "publication-1",
        tenantId: "tenant-1",
      },
      query: "renewal notice",
      queryVector: [0.1],
      tenantId: "tenant-1",
      topK: 10,
    });

    expect(listOutlines).not.toHaveBeenCalled();
    expect(searchSections).toHaveBeenCalledOnce();
    expect(openLeafEvidence).toHaveBeenCalledOnce();
    expect(result.items.map((item) => item.nodeId)).toEqual(["outline-only"]);
  });

  it("does not inspect outlines outside Research mode", async () => {
    const listOutlines = vi.fn();
    const base = { items: [hybridItem("base-node", "Renewal summary")] };
    const retriever = createResearchOutlineEvidenceRetrieval({
      pageIndex: {
        listOutlines,
        openLeafEvidence: vi.fn(),
      },
      retriever: { retrieve: async () => base },
    });

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: "space-1",
        limit: 5,
        mode: "fast",
        query: "renewal",
        queryVector: [0.1],
        topK: 5,
      }),
    ).resolves.toBe(base);
    expect(listOutlines).not.toHaveBeenCalled();
  });

  it("fails closed without an immutable tenant-scoped publication", async () => {
    const retriever = createResearchOutlineEvidenceRetrieval({
      pageIndex: { listOutlines: vi.fn(), openLeafEvidence: vi.fn() },
      retriever: { retrieve: async () => ({ items: [hybridItem("base-node", "Renewal")] }) },
    });

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: "space-1",
        limit: 5,
        mode: "research",
        query: "renewal",
        queryVector: [0.1],
        topK: 5,
      }),
    ).rejects.toThrow("published snapshot, tenant, and permission scope");
  });

  it("rejects a publication snapshot from another retrieval scope", async () => {
    const retriever = createResearchOutlineEvidenceRetrieval({
      pageIndex: { listOutlines: vi.fn(), openLeafEvidence: vi.fn() },
      retriever: { retrieve: async () => ({ items: [hybridItem("base-node", "Renewal")] }) },
    });

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: "space-1",
        limit: 5,
        mode: "research",
        permissionScope: [],
        projectionSnapshot: {
          fingerprint: "a".repeat(64),
          headRevision: 1,
          knowledgeSpaceId: "another-space",
          projectionVersion: 1,
          publicationId: "publication-1",
          tenantId: "tenant-1",
        },
        query: "renewal",
        queryVector: [0.1],
        tenantId: "tenant-1",
        topK: 5,
      }),
    ).rejects.toThrow("does not match the query scope");
  });

  it("returns an empty deterministic result when no outline section is searchable", async () => {
    const retriever = createResearchOutlineEvidenceRetrieval({
      pageIndex: { listOutlines: vi.fn(), openLeafEvidence: vi.fn() },
      retriever: { retrieve: async () => ({ items: [] }) },
    });

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: "space-1",
        limit: 5,
        mode: "research",
        permissionScope: [],
        projectionSnapshot: {
          fingerprint: "a".repeat(64),
          headRevision: 1,
          knowledgeSpaceId: "space-1",
          projectionVersion: 1,
          publicationId: "publication-1",
          tenantId: "tenant-1",
        },
        query: "renewal",
        queryVector: [0.1],
        tenantId: "tenant-1",
        topK: 5,
      }),
    ).resolves.toEqual({ items: [], metrics: undefined, plan: undefined });
  });

  it("validates deterministic expansion bounds at assembly", () => {
    expect(() =>
      createResearchOutlineEvidenceRetrieval({
        maxConcurrentOpens: 0,
        pageIndex: { listOutlines: vi.fn(), openLeafEvidence: vi.fn() },
        retriever: { retrieve: vi.fn() },
      }),
    ).toThrow("maxConcurrentOpens must be at least 1");
    expect(() =>
      createResearchOutlineEvidenceRetrieval({
        lexicalWeight: 0,
        pageIndex: { listOutlines: vi.fn(), openLeafEvidence: vi.fn() },
        retriever: { retrieve: vi.fn() },
      }),
    ).toThrow("lexicalWeight must be positive and finite");
  });
});

function hybridItem(nodeId: string, text: string) {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId,
      documentVersion: 1,
      endOffset: 100,
      sectionPath: ["Renewal"],
      startOffset: 0,
    },
    metadata: { text },
    nodeId,
    permissionScope: ["tenant:tenant-1"],
    projectionIds: [`projection-${nodeId}`],
    score: 0.9,
    sources: ["dense" as const],
  };
}

function knowledgeNode(id: string, text: string): KnowledgeNode {
  return {
    artifactHash: "a".repeat(64),
    documentAssetId,
    endOffset: 100,
    id,
    kind: "chunk",
    knowledgeSpaceId: "space-1",
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    permissionScope: ["tenant:tenant-1"],
    sourceLocation: {
      endOffset: 100,
      sectionPath: ["Renewal"],
      startOffset: 0,
    },
    startOffset: 0,
    text,
  };
}
