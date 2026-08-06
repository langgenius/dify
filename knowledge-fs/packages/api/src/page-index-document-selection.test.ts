import { describe, expect, it } from "vitest";

import { selectPageIndexDocuments } from "./page-index-document-selection";
import type { RetrievalCandidate } from "./retrieval-candidates";

describe("selectPageIndexDocuments", () => {
  it("ranks documents by bounded normalized hit aggregation", () => {
    const selected = selectPageIndexDocuments({
      candidates: [
        candidate("doc-many", "many-1", 0.6),
        candidate("doc-many", "many-2", 0.6),
        candidate("doc-many", "many-3", 0.6),
        candidate("doc-many", "many-4", 0.6),
        candidate("doc-many", "many-5", 0.6),
        candidate("doc-direct", "direct", 1),
      ],
      maxDocuments: 2,
      maxHitsPerDocument: 3,
    });

    expect(selected.map((document) => document.documentAssetId)).toEqual([
      "doc-direct",
      "doc-many",
    ]);
    expect(selected[0]).toMatchObject({ hitCount: 1, score: 1 });
    expect(selected[1]?.hits).toHaveLength(3);
    expect(selected[1]?.hitCount).toBe(5);
  });

  it("counts one strongest hit per node so duplicate projections cannot inflate a document", () => {
    const selected = selectPageIndexDocuments({
      candidates: [
        candidate("doc-duplicate", "same-node", 1, "projection-a"),
        candidate("doc-duplicate", "same-node", 0.99, "projection-b"),
        candidate("doc-breadth", "node-a", 0.8),
        candidate("doc-breadth", "node-b", 0.79),
      ],
      maxDocuments: 2,
      maxHitsPerDocument: 5,
    });

    const duplicate = selected.find((document) => document.documentAssetId === "doc-duplicate");
    expect(duplicate).toMatchObject({ hitCount: 1 });
    expect(duplicate?.hits.map((hit) => hit.candidate.projectionId)).toEqual(["projection-a"]);
  });

  it("uses document id as the stable tie breaker and enforces the shortlist bound", () => {
    const selected = selectPageIndexDocuments({
      candidates: [candidate("doc-b", "node-b", 1), candidate("doc-a", "node-a", 1)],
      maxDocuments: 1,
      maxHitsPerDocument: 2,
    });

    expect(selected.map((document) => document.documentAssetId)).toEqual(["doc-a"]);
  });

  it("rejects invalid bounds and non-finite candidate scores", () => {
    expect(() =>
      selectPageIndexDocuments({
        candidates: [],
        maxDocuments: 0,
        maxHitsPerDocument: 1,
      }),
    ).toThrow("maxDocuments must be at least 1");
    expect(() =>
      selectPageIndexDocuments({
        candidates: [],
        maxDocuments: 1,
        maxHitsPerDocument: 0,
      }),
    ).toThrow("maxHitsPerDocument must be at least 1");
    expect(() =>
      selectPageIndexDocuments({
        candidates: [candidate("doc", "node", Number.NaN)],
        maxDocuments: 1,
        maxHitsPerDocument: 1,
      }),
    ).toThrow("finite numbers");
  });
});

function candidate(
  documentAssetId: string,
  nodeId: string,
  score: number,
  projectionId = `projection-${nodeId}`,
): RetrievalCandidate {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId,
      documentVersion: 1,
      sectionPath: ["Document"],
    },
    metadata: { text: nodeId },
    nodeId,
    permissionScope: ["document:read"],
    projectionId,
    score,
    source: "dense",
  };
}
