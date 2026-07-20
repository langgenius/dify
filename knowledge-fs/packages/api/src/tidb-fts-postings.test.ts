import type { IndexProjection } from "@knowledge/core";
import { IndexProjectionSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  MAX_TIDB_FTS_DOCUMENT_BYTES,
  MAX_TIDB_FTS_POSTINGS_PER_BATCH,
  MAX_TIDB_FTS_QUERY_TERMS,
  MAX_TIDB_FTS_TERM_UTF8_BYTES,
  TIDB_FTS_TOKENIZER_VERSION,
  createTidbFtsProjectionPostingPlans,
  createTidbFtsQueryTerms,
  hashTidbFtsTerm,
} from "./tidb-fts-postings";

function projection(overrides: Partial<IndexProjection> = {}): IndexProjection {
  return IndexProjectionSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata: { ftsText: "Policy policy 更新" },
    nodeId: "20000000-0000-4000-8000-000000000001",
    projectionVersion: 1,
    status: "ready",
    type: "fts",
    ...overrides,
  });
}

describe("TiDB FTS posting tokenizer", () => {
  it("uses deterministic NFKC mixed-language terms, frequency, and fixed-width hashes", () => {
    const plan = createTidbFtsProjectionPostingPlans([projection()])[0];

    expect(plan?.postings).toEqual([
      expect.objectContaining({
        documentTokenCount: 4,
        term: expect.any(String),
        termFrequency: expect.any(Number),
        termHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        tokenizerVersion: TIDB_FTS_TOKENIZER_VERSION,
      }),
      expect.any(Object),
      expect.any(Object),
    ]);
    expect(plan?.postings.find((posting) => posting.term === "policy")).toMatchObject({
      documentTokenCount: 4,
      termFrequency: 2,
      termHash: "816aff1073b705e4a4851c42824198a6ff0eb0adbae0504aa7f5597fd434e555",
    });
    expect(hashTidbFtsTerm("保")).toBe(
      "921290ede3d5f2a1294a5dc4088dd8da24a85019804e554782adacaa32c247c6",
    );
  });

  it("deduplicates query terms and bounds query and posting candidate work", () => {
    expect(createTidbFtsQueryTerms("Policy policy 更新")).toMatchObject({
      hashes: [expect.stringMatching(/^[0-9a-f]{64}$/), expect.any(String), expect.any(String)],
      terms: ["policy", "更", "新"],
    });
    const tooManyQueryTerms = Array.from(
      { length: MAX_TIDB_FTS_QUERY_TERMS + 1 },
      (_, index) => `term${index}`,
    ).join(" ");
    expect(() => createTidbFtsQueryTerms(tooManyQueryTerms)).toThrow(
      `maxTerms=${MAX_TIDB_FTS_QUERY_TERMS}`,
    );
  });

  it("ignores overlong terms and rejects oversized batches before database mutation", () => {
    const bounded = createTidbFtsProjectionPostingPlans([
      projection({ metadata: { ftsText: `${"a".repeat(129)} policy ${"𐐀".repeat(100)}` } }),
    ])[0];
    expect(bounded?.postings.map((posting) => posting.term)).toEqual(["policy"]);
    expect(() =>
      createTidbFtsProjectionPostingPlans([projection({ metadata: { ftsText: "a".repeat(129) } })]),
    ).toThrow("searchable bounded ftsText term");
    expect(Buffer.byteLength("𐐀".repeat(100), "utf8")).toBeGreaterThan(
      MAX_TIDB_FTS_TERM_UTF8_BYTES,
    );
    expect(() =>
      createTidbFtsProjectionPostingPlans([
        projection({ metadata: { ftsText: "policy ".repeat(MAX_TIDB_FTS_DOCUMENT_BYTES) } }),
      ]),
    ).toThrow(`maxUtf8Bytes=${MAX_TIDB_FTS_DOCUMENT_BYTES}`);

    const projections = Array.from(
      { length: Math.ceil(MAX_TIDB_FTS_POSTINGS_PER_BATCH / 2_048) + 1 },
      (_, projectionIndex) =>
        projection({
          id: `00000000-0000-4000-8000-${(projectionIndex + 1).toString(16).padStart(12, "0")}`,
          metadata: {
            ftsText: Array.from(
              { length: 2_048 },
              (__, termIndex) => `t${projectionIndex}x${termIndex}`,
            ).join(" "),
          },
          nodeId: `20000000-0000-4000-8000-${(projectionIndex + 1).toString(16).padStart(12, "0")}`,
        }),
    );
    expect(() => createTidbFtsProjectionPostingPlans(projections)).toThrow(
      `maxPostings=${MAX_TIDB_FTS_POSTINGS_PER_BATCH}`,
    );
  });
});
