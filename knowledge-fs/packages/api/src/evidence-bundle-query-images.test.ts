import { describe, expect, it } from "vitest";

import { createEvidenceBundleAssembler } from "./evidence-bundle-assembler";

const QUERY_IMAGE = {
  byteSize: 3,
  mimeType: "image/png" as const,
  sha256: "a".repeat(64),
  uploadFileId: "00000000-0000-4000-8000-000000000001",
};

describe("EvidenceBundle query image contracts", () => {
  it("assembles an image-only bundle while preserving the derived retrieval query", () => {
    const assembler = createEvidenceBundleAssembler({
      generateId: () => "00000000-0000-4000-8000-000000000002",
      now: () => "2026-08-07T00:00:00.000Z",
    });

    expect(
      assembler.assemble({
        query: "",
        queryImages: [QUERY_IMAGE],
        retrieval: {
          items: [],
          metrics: {
            denseCandidates: 0,
            denseMs: 0,
            ftsCandidates: 0,
            ftsMs: 0,
            fusedCandidates: 0,
            fusionMs: 0,
            researchBudgetExhaustedReasons: ["max-retrieval-steps"],
            totalMs: 0,
          },
        },
        retrievalQuery: "  invoice total  ",
      }),
    ).toEqual(
      expect.objectContaining({
        query: "",
        queryImages: [QUERY_IMAGE],
        retrievalQuery: "invoice total",
        state: "not-enough-evidence",
      }),
    );
  });

  it("keeps legacy and explicit-empty validation errors distinct", () => {
    const assembler = createEvidenceBundleAssembler();

    expect(() => assembler.assemble({ query: " ", retrieval: { items: [] } })).toThrow(
      "EvidenceBundle assembler query is required",
    );
    expect(() =>
      assembler.assemble({ query: " ", queryImages: [], retrieval: { items: [] } }),
    ).toThrow("EvidenceBundle assembler query or queryImages is required");
  });
});
