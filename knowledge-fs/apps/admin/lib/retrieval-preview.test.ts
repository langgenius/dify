import { describe, expect, it } from "vitest";

import { createRetrievalPreview } from "./retrieval-preview";

describe("createRetrievalPreview", () => {
  it("summarizes streamed answer events into bounded UI state", () => {
    const preview = createRetrievalPreview({
      events: [
        { data: { delta: "The roadmap " }, event: "answer.delta" },
        { data: { delta: "changed." }, event: "answer.delta" },
        {
          data: {
            finishReason: "stop",
            metadata: {
              citations: [
                { label: "roadmap.md#L4", nodeId: "node-1" },
                { label: "release.md#L9", nodeId: "node-2" },
              ],
              confidence: 0.82,
              freshness: "Updated today",
            },
          },
          event: "answer.done",
        },
      ],
      maxAnswerChars: 64,
      maxCitations: 1,
    });

    expect(preview).toEqual({
      answer: "The roadmap changed.",
      citations: [{ label: "roadmap.md#L4", nodeId: "node-1" }],
      confidenceLabel: "82%",
      freshness: "Updated today",
      status: "complete",
    });
  });

  it("rejects unbounded preview inputs before retaining oversized answers", () => {
    expect(() =>
      createRetrievalPreview({
        events: [{ data: { delta: "x".repeat(11) }, event: "answer.delta" }],
        maxAnswerChars: 10,
      }),
    ).toThrow("Retrieval preview answer exceeds maxAnswerChars=10");
  });
});
