import { describe, expect, it } from "vitest";

import type { RetrievalCandidate } from "./retrieval-candidates";
import {
  type RetrievalFusionRuntime,
  fuseRetrievalCandidates,
  fuseRetrievalCandidatesWithRuntime,
} from "./retrieval-fusion";

function candidate(
  nodeId: string,
  source: RetrievalCandidate["source"],
  projectionId: string,
  score = 0.9,
): RetrievalCandidate {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
      documentVersion: 1,
      endOffset: 10,
      sectionPath: ["Policy"],
      startOffset: 0,
    },
    metadata: { source },
    nodeId,
    permissionScope: ["tenant:tenant-1"],
    projectionId,
    score,
    source,
  };
}

describe("retrieval fusion", () => {
  it("fuses dense and FTS candidates with deterministic RRF and clone isolation", () => {
    const denseA = candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f2d01", "dense", "dense-a");
    const denseB = candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f2d02", "dense", "dense-b");
    const dense = [denseA, denseB];
    const fts = [candidate(denseA.nodeId, "fts", "fts-a")];

    const fused = fuseRetrievalCandidates({ dense, fts, limit: 2, rrfK: 60 });

    expect(fused).toEqual([
      expect.objectContaining({
        nodeId: denseA.nodeId,
        projectionIds: ["dense-a", "fts-a"],
        sources: ["dense", "fts"],
      }),
      expect.objectContaining({
        nodeId: denseB.nodeId,
        projectionIds: ["dense-b"],
        sources: ["dense"],
      }),
    ]);
    fused[0]?.citation.sectionPath.push("mutated");
    expect(denseA.citation.sectionPath).toEqual(["Policy"]);
    expect(() => fuseRetrievalCandidates({ dense, fts, limit: 2, rrfK: 0 })).toThrow(
      "Hybrid retrieval rrfK must be at least 1",
    );
  });

  it("collapses duplicate projections of the same node within a leg to one RRF contribution", () => {
    const nodeA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
    const nodeB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
    // nodeA has two dense projections (e.g. a text-surrogate and a visual-asset projection).
    const dense = [
      candidate(nodeA, "dense", "dense-a-text"),
      candidate(nodeA, "dense", "dense-a-visual"),
      candidate(nodeB, "dense", "dense-b"),
    ];

    const fused = fuseRetrievalCandidates({ dense, fts: [], limit: 2, rrfK: 60 });

    // nodeA scores a single contribution at rank 0 (1/61), not 1/61 + 1/62; nodeB is at rank 1.
    expect(fused[0]?.nodeId).toBe(nodeA);
    expect(fused[0]?.score).toBeCloseTo(1 / 61, 12);
    expect(fused[0]?.projectionIds).toEqual(["dense-a-text", "dense-a-visual"]);
    expect(fused[0]?.sources).toEqual(["dense"]);
    expect(fused[1]?.nodeId).toBe(nodeB);
    expect(fused[1]?.score).toBeCloseTo(1 / 62, 12);
  });

  it("uses an injected fusion runtime with bounded compute config", () => {
    const denseCandidate = candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f2d03", "dense", "dense-c");
    const ftsCandidate = candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f2d04", "fts", "fts-c");
    const dense = [denseCandidate];
    const fts = [ftsCandidate];
    const calls: unknown[] = [];
    const fusion: RetrievalFusionRuntime = {
      rrfFuse(input) {
        calls.push(JSON.parse(JSON.stringify(input)));
        return [
          { id: ftsCandidate.nodeId, ranks: [{ listIndex: 1, rank: 0, weight: 1 }], score: 0.9 },
          {
            id: denseCandidate.nodeId,
            ranks: [{ listIndex: 0, rank: 0, weight: 1 }],
            score: 0.8,
          },
          { id: "missing", ranks: [], score: 0.7 },
        ];
      },
    };

    const fused = fuseRetrievalCandidatesWithRuntime({
      dense,
      fts,
      fusion,
      limit: 1,
      plan: { denseTopK: 4, ftsTopK: 3, fusionLimit: 5 },
      rrfK: 60,
    });

    expect(calls).toEqual([
      {
        config: {
          k: 60,
          limit: 5,
          maxInputBytes: 1024 * 1024,
          maxItemsPerList: 4,
          maxLists: 2,
          maxOutputItems: 5,
        },
        rankedLists: [
          { items: [{ id: denseCandidate.nodeId }], weight: 1 },
          { items: [{ id: ftsCandidate.nodeId }], weight: 1 },
        ],
      },
    ]);
    expect(fused).toEqual([
      expect.objectContaining({
        nodeId: ftsCandidate.nodeId,
        projectionIds: ["fts-c"],
        score: 0.9,
      }),
    ]);
  });
});
