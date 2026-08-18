import { describe, expect, it } from "vitest";

import type { RetrievalCandidate } from "./retrieval-candidates";
import {
  type RetrievalFusionRuntime,
  fuseRankedHybridRetrievalLists,
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
  it("rank-fuses heterogeneous Research lists without comparing their raw scores", () => {
    const first = fuseRetrievalCandidates({
      dense: [
        candidate("node-a", "dense", "dense-a", -100),
        candidate("node-b", "dense", "dense-b", -200),
      ],
      fts: [],
      limit: 2,
    });
    const second = fuseRetrievalCandidates({
      dense: [],
      fts: [
        candidate("node-b", "fts", "fts-b", 1_000_000),
        candidate("node-c", "fts", "fts-c", 999_999),
      ],
      limit: 2,
    });

    const fused = fuseRankedHybridRetrievalLists({
      k: 60,
      limit: 3,
      lists: [
        { items: first, label: "semantic", weight: 1 },
        { items: second, label: "lexical", weight: 1 },
      ],
    });

    expect(fused.map((item) => item.nodeId)).toEqual(["node-b", "node-a", "node-c"]);
    expect(fused[0]).toMatchObject({
      projectionIds: ["dense-b", "fts-b"],
      sources: ["dense", "fts"],
    });
    expect(fused[0]?.metadata.researchRrf).toMatchObject({ version: "weighted-rrf-v1" });
    expect(fused.every((item) => item.score >= 0 && item.score <= 1)).toBe(true);
  });

  it("normalizes each leg before deterministic score fusion and preserves clone isolation", () => {
    const denseA = candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f2d01", "dense", "dense-a", 0.9);
    const denseB = candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f2d02", "dense", "dense-b", 0.7);
    const denseC = candidate("018f0d60-7a49-7cc2-9c1b-5b36f18f2d03", "dense", "dense-c", 0.5);
    const dense = [denseA, denseB, denseC];
    const fts = [
      candidate(denseC.nodeId, "fts", "fts-c", 8),
      candidate(denseA.nodeId, "fts", "fts-a", 6),
      candidate(denseB.nodeId, "fts", "fts-b", 4),
    ];

    const fused = fuseRetrievalCandidates({ dense, fts, limit: 3 });

    expect(fused).toEqual([
      expect.objectContaining({
        nodeId: denseA.nodeId,
        projectionIds: ["dense-a", "fts-a"],
        sources: ["dense", "fts"],
        score: 0.75,
      }),
      expect.objectContaining({
        nodeId: denseC.nodeId,
        projectionIds: ["dense-c", "fts-c"],
        sources: ["dense", "fts"],
        score: 0.5,
      }),
      expect.objectContaining({
        nodeId: denseB.nodeId,
        projectionIds: ["dense-b", "fts-b"],
        sources: ["dense", "fts"],
      }),
    ]);
    expect(fused[2]?.score).toBeCloseTo(0.25, 12);
    fused[0]?.citation.sectionPath.push("mutated");
    expect(denseA.citation.sectionPath).toEqual(["Policy"]);
  });

  it("collapses duplicate projections within a leg before normalizing scores", () => {
    const nodeA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
    const nodeB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
    const dense = [
      candidate(nodeA, "dense", "dense-a-text", 0.9),
      candidate(nodeA, "dense", "dense-a-visual", 0.8),
      candidate(nodeB, "dense", "dense-b", 0.5),
    ];

    const fused = fuseRetrievalCandidates({ dense, fts: [], limit: 2 });

    expect(fused[0]?.nodeId).toBe(nodeA);
    expect(fused[0]?.score).toBe(1);
    expect(fused[0]?.projectionIds).toEqual(["dense-a-text", "dense-a-visual"]);
    expect(fused[0]?.sources).toEqual(["dense"]);
    expect(fused[1]?.nodeId).toBe(nodeB);
    expect(fused[1]?.score).toBe(0);
  });

  it("uses the full weight of one available leg and treats equal scores as tied best results", () => {
    const first = candidate("node-a", "fts", "fts-a", 2);
    const second = candidate("node-b", "fts", "fts-b", 2);

    const fused = fuseRetrievalCandidates({
      dense: [],
      fts: [second, first],
      limit: 2,
    });

    expect(fused.map((item) => ({ nodeId: item.nodeId, score: item.score }))).toEqual([
      { nodeId: first.nodeId, score: 1 },
      { nodeId: second.nodeId, score: 1 },
    ]);
  });

  it("rejects non-finite raw retrieval scores", () => {
    expect(() =>
      fuseRetrievalCandidates({
        dense: [candidate("node-a", "dense", "dense-a", Number.NaN)],
        fts: [],
        limit: 1,
      }),
    ).toThrow("Hybrid retrieval candidate scores must contain only finite numbers");
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
