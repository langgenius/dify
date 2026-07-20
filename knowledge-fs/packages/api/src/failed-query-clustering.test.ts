import type { FailedQuery } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { clusterFailedQueries, clusterKeyForQuery } from "./failed-query-clustering";

function failedQuery(id: string, query: string): FailedQuery {
  return {
    createdAt: "2026-07-06T00:00:00.000Z",
    id,
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata: {},
    mode: "fast",
    query,
    status: "pending-triage",
    trigger: "no-retrieval-evidence",
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}

describe("clusterKeyForQuery", () => {
  it("collapses case, punctuation, word order, and stopwords", () => {
    expect(clusterKeyForQuery("What is the Refund Policy?")).toBe("policy refund");
    expect(clusterKeyForQuery("refund policy")).toBe("policy refund");
    expect(clusterKeyForQuery("Tell me the POLICY, refund!")).toBe("policy refund");
    // Different content words -> different key.
    expect(clusterKeyForQuery("shipping cost")).not.toBe(clusterKeyForQuery("refund policy"));
  });

  it("falls back to a normalized form for all-stopword queries", () => {
    expect(clusterKeyForQuery("what is it")).toBe("what is it");
  });
});

describe("clusterFailedQueries", () => {
  it("groups paraphrases and orders by frequency", () => {
    const clusters = clusterFailedQueries([
      failedQuery("a", "What is the refund policy?"),
      failedQuery("b", "refund policy"),
      failedQuery("c", "Tell me the POLICY, refund!"),
      failedQuery("d", "shipping cost to canada"),
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ clusterKey: "policy refund", count: 3 });
    expect(clusters[0]?.failedQueryIds).toEqual(["a", "b", "c"]);
    expect(clusters[0]?.representative.id).toBe("a");
    expect(clusters[1]).toMatchObject({ count: 1 });
  });
});
