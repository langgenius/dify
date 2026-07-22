import { describe, expect, it } from "vitest";

import {
  KnowledgeFsDiffResponseSchema,
  KnowledgeFsEntryResponseSchema,
  SemanticDiffSummarySchema,
} from "./knowledge-fs-response-schemas";

describe("knowledge-fs-response-schemas", () => {
  it("accepts bounded KnowledgeFS entries and diff responses", () => {
    expect(
      KnowledgeFsEntryResponseSchema.parse({
        kind: "resource",
        metadata: { source: "test" },
        name: "node.md",
        path: "/by-topic/node.md",
        resourceType: "node",
        targetId: "node-1",
        version: 1,
      }),
    ).toEqual({
      kind: "resource",
      metadata: { source: "test" },
      name: "node.md",
      path: "/by-topic/node.md",
      resourceType: "node",
      targetId: "node-1",
      version: 1,
    });

    expect(
      KnowledgeFsDiffResponseSchema.parse({
        mode: "word",
        newPath: "/new.md",
        oldPath: "/old.md",
        operations: [{ kind: "insert", newEnd: 1, newStart: 1, text: "hello" }],
        stats: { delete: 0, equal: 0, insert: 1 },
      }),
    ).toMatchObject({ mode: "word" });
  });

  it("rejects oversized semantic diff metadata", () => {
    expect(() =>
      SemanticDiffSummarySchema.parse({
        changes: [],
        metadata: { payload: "x".repeat(20_000) },
        summary: "summary",
      }),
    ).toThrow("Semantic diff metadata exceeds");
  });
});
