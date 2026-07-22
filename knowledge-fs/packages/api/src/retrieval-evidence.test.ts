import { describe, expect, it } from "vitest";

import { hybridRetrievalItemToEvidenceItem } from "./retrieval-evidence";
import type { HybridRetrievalItem } from "./retrieval-fusion";

function item(overrides: Partial<HybridRetrievalItem> = {}): HybridRetrievalItem {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
      documentVersion: 2,
      endOffset: 40,
      pageNumber: 3,
      sectionPath: ["Handbook", "Policy"],
      startOffset: 10,
    },
    metadata: {
      conflicts: [
        { reason: "stale policy", severity: "warning", withNodeId: "node-old" },
        { reason: "ignored", severity: "unknown" },
      ],
      freshnessScore: 0.8,
      freshnessStatus: "fresh",
      observedAt: "2026-05-14T00:00:00.000Z",
      rerankScore: 0.9,
      retrievalScore: 0.7,
      sourceUpdatedAt: "2026-05-13T00:00:00.000Z",
      text: "Evidence text",
    },
    nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
    permissionScope: ["tenant:tenant-1"],
    projectionIds: ["projection-a", "projection-b"],
    score: 0.95,
    sources: ["dense", "fts"],
    ...overrides,
  };
}

describe("retrieval evidence mapping", () => {
  it("maps hybrid retrieval items into clone-isolated evidence bundle items", () => {
    const retrievalItem = item();
    const evidence = hybridRetrievalItemToEvidenceItem(retrievalItem);

    expect(evidence).toEqual({
      citations: [
        {
          artifactHash: "a".repeat(64),
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
          documentVersion: 2,
          endOffset: 40,
          pageNumber: 3,
          sectionPath: ["Handbook", "Policy"],
          startOffset: 10,
        },
      ],
      conflicts: [{ reason: "stale policy", severity: "warning", withNodeId: "node-old" }],
      freshness: {
        observedAt: "2026-05-14T00:00:00.000Z",
        sourceUpdatedAt: "2026-05-13T00:00:00.000Z",
        status: "fresh",
      },
      metadata: {
        projectionIds: ["projection-a", "projection-b"],
        sources: ["dense", "fts"],
      },
      nodeId: retrievalItem.nodeId,
      score: 0.95,
      scores: {
        final: 0.95,
        freshness: 0.8,
        rerank: 0.9,
        retrieval: 0.7,
      },
      text: "Evidence text",
    });

    evidence.citations[0]?.sectionPath.push("mutated");
    expect(retrievalItem.citation.sectionPath).toEqual(["Handbook", "Policy"]);
  });

  it("defaults freshness, retrieval score, optional citation fields, and text fallback", () => {
    const evidence = hybridRetrievalItemToEvidenceItem(
      item({
        citation: {
          artifactHash: "b".repeat(64),
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
          documentVersion: 1,
          sectionPath: [],
        },
        metadata: { freshnessStatus: "mystery" },
        score: 0.33,
      }),
    );

    expect(evidence.citations).toEqual([
      {
        artifactHash: "b".repeat(64),
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        documentVersion: 1,
        sectionPath: [],
      },
    ]);
    expect(evidence.conflicts).toEqual([]);
    expect(evidence.freshness).toEqual({ status: "unknown" });
    expect(evidence.scores).toEqual({ final: 0.33, retrieval: 0.33 });
    expect(evidence.text).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f2c81");
  });
});
