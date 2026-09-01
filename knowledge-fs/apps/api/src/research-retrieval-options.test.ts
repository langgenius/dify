import { describe, expect, it } from "vitest";

import { createApiResearchRetrievalOptions } from "./research-retrieval-options";

describe("Research retrieval options", () => {
  it("uses the reviewed initial multi-intent rerank pool by default", () => {
    expect(createApiResearchRetrievalOptions({})).toEqual({ maxRerankCandidates: 200 });
  });

  it("accepts a smaller explicit latency/cost envelope", () => {
    expect(
      createApiResearchRetrievalOptions({
        KNOWLEDGE_RESEARCH_MAX_RERANK_CANDIDATES: "80",
      }),
    ).toEqual({ maxRerankCandidates: 80 });
  });

  it.each(["0", "201", "1.5"])("rejects an unsafe rerank pool of %s", (value) => {
    expect(() =>
      createApiResearchRetrievalOptions({
        KNOWLEDGE_RESEARCH_MAX_RERANK_CANDIDATES: value,
      }),
    ).toThrow("KNOWLEDGE_RESEARCH_MAX_RERANK_CANDIDATES");
  });
});
