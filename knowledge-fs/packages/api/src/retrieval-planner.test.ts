import { describe, expect, it } from "vitest";

import { createRetrievalPlanner, defaultRetrievalPlan } from "./retrieval-planner";
import { createInMemoryTraceRecorder } from "./tracing";

describe("retrieval planner", () => {
  it("plans resolved modes with bounded fanout and traced route provenance", () => {
    const traces = createInMemoryTraceRecorder();
    const planner = createRetrievalPlanner({ maxTopK: 100, traces });

    expect(
      planner.plan({
        mode: "fast",
        query: "contract renewal",
        topK: 5,
        traceId: "trace-fast",
      }),
    ).toEqual({
      denseTopK: 5,
      ftsTopK: 5,
      fusionLimit: 5,
      queryLanguage: "latin",
      requestedMode: "fast",
      rerankCandidateLimit: 5,
      resolvedMode: "fast",
      strategyVersion: "retrieval-planner-v1",
      topK: 5,
    });

    expect(
      planner.plan({
        mode: "auto",
        query: "比较 合同 ABC-123 的续约条款和 termination notice 风险",
        resolvedMode: "research",
        topK: 4,
        traceId: "trace-auto",
      }),
    ).toEqual(
      expect.objectContaining({
        denseTopK: 40,
        ftsTopK: 40,
        fusionLimit: 20,
        queryLanguage: "mixed-cjk-latin",
        requestedMode: "auto",
        rerankCandidateLimit: 20,
        resolvedMode: "research",
        strategyVersion: "retrieval-planner-v2",
        topK: 4,
      }),
    );

    expect(traces.spans).toEqual([
      {
        attributes: {
          denseTopK: 5,
          ftsTopK: 5,
          fusionLimit: 5,
          queryLanguage: "latin",
          requestedMode: "fast",
          resolvedMode: "fast",
          rerankCandidateLimit: 5,
          topK: 5,
          traceId: "trace-fast",
        },
        name: "retrieval.plan",
        status: "ok",
      },
      {
        attributes: {
          denseTopK: 40,
          ftsTopK: 40,
          fusionLimit: 20,
          queryLanguage: "mixed-cjk-latin",
          requestedMode: "auto",
          resolvedMode: "research",
          rerankCandidateLimit: 20,
          topK: 4,
          traceId: "trace-auto",
        },
        name: "retrieval.plan",
        status: "ok",
      },
    ]);
    expect(JSON.stringify(traces.spans)).not.toContain("termination notice");

    expect(() => planner.plan({ query: "too many", topK: 101 })).toThrow(
      "Retrieval planner topK exceeds maxTopK=100",
    );
    expect(() => createRetrievalPlanner({ maxTopK: 0 })).toThrow(
      "Retrieval planner maxTopK must be at least 1",
    );
  });

  it("requires Auto to be LLM-resolved before deterministic planning", () => {
    const traces = createInMemoryTraceRecorder();
    const planner = createRetrievalPlanner({ maxTopK: 100, traces });

    expect(
      planner.plan({
        mode: "deep",
        query: "contract renewal notice liability terms",
        topK: 7,
      }),
    ).toEqual(
      expect.objectContaining({
        denseTopK: 35,
        ftsTopK: 35,
        fusionLimit: 21,
        queryLanguage: "latin",
        requestedMode: "deep",
        rerankCandidateLimit: 21,
        resolvedMode: "deep",
        topK: 7,
      }),
    );
    expect(
      planner.plan({
        mode: "research",
        query: "research contract history",
        topK: 30,
      }),
    ).toEqual(
      expect.objectContaining({
        denseTopK: 100,
        ftsTopK: 100,
        fusionLimit: 100,
        requestedMode: "research",
        rerankCandidateLimit: 100,
        resolvedMode: "research",
        strategyVersion: "retrieval-planner-v2",
        topK: 30,
      }),
    );
    expect(
      planner.plan({
        mode: "auto",
        query: "合同续约条款",
        resolvedMode: "deep",
        topK: 3,
      }),
    ).toEqual(
      expect.objectContaining({
        denseTopK: 15,
        ftsTopK: 15,
        fusionLimit: 9,
        queryLanguage: "cjk",
        resolvedMode: "deep",
      }),
    );
    expect(
      planner.plan({
        mode: "auto",
        query: "合同编号是什么？",
        resolvedMode: "fast",
        topK: 2,
      }),
    ).toEqual(
      expect.objectContaining({
        queryLanguage: "cjk",
        requestedMode: "auto",
        resolvedMode: "fast",
      }),
    );
    expect(
      planner.plan({
        mode: "auto",
        query:
          "Analyze and explain the evidence in this deliberately long request while following the linked dependency chain",
        resolvedMode: "deep",
        topK: 2,
      }),
    ).toEqual(
      expect.objectContaining({
        queryLanguage: "latin",
        requestedMode: "auto",
        resolvedMode: "deep",
      }),
    );
    expect(planner.plan({ query: "σύμβαση", topK: 2 })).toEqual(
      expect.objectContaining({
        queryLanguage: "other",
        requestedMode: "fast",
        resolvedMode: "fast",
      }),
    );

    expect(() =>
      planner.plan({ mode: "auto", query: "must be classified upstream", topK: 1 }),
    ).toThrow("Retrieval planner auto mode requires an LLM-resolved mode");
    expect(() =>
      planner.plan({
        mode: "fast",
        query: "explicit mode cannot be overwritten",
        resolvedMode: "deep",
        topK: 1,
      }),
    ).toThrow("Retrieval planner resolved mode must match an explicit requested mode");
    expect(() => planner.plan({ query: "valid", topK: 0 })).toThrow(
      "Retrieval planner topK must be at least 1",
    );
    expect(() => planner.plan({ query: "   ", topK: 1 })).toThrow(
      "Retrieval planner query must not be empty",
    );
    expect(traces.spans.filter((span) => span.status === "error")).toHaveLength(4);
  });

  it("plans image-only retrieval while retaining explicit empty-input errors", () => {
    const planner = createRetrievalPlanner({ maxTopK: 10 });

    expect(planner.plan({ hasQueryImages: true, query: "", topK: 3 })).toEqual(
      expect.objectContaining({ queryLanguage: "other", topK: 3 }),
    );
    expect(defaultRetrievalPlan({ hasQueryImages: true, query: "", topK: 2 })).toEqual(
      expect.objectContaining({ queryLanguage: "other", topK: 2 }),
    );
    expect(() => defaultRetrievalPlan({ query: "", topK: 1 })).toThrow(
      "Retrieval planner query must not be empty",
    );
    expect(() => defaultRetrievalPlan({ query: "valid", topK: 0 })).toThrow(
      "Retrieval planner topK must be at least 1",
    );
    expect(() => planner.plan({ hasQueryImages: false, query: "", topK: 1 })).toThrow(
      "Retrieval planner query or query images must be provided",
    );
  });
});
