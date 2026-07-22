import { describe, expect, it } from "vitest";

import {
  decodeGoldenQuestionCursor,
  decodeGraphEntityCursor,
  decodeKnowledgePathCursor,
  encodeGoldenQuestionCursor,
  encodeGraphEntityCursor,
  encodeKnowledgePathCursor,
} from "./cursor-utils";
import { KnowledgeFsValidationError } from "./knowledge-fs-errors";

describe("cursor utilities", () => {
  it("round-trips graph entity cursors with escaped separators", () => {
    const encoded = encodeGraphEntityCursor({ id: "entity|1", name: "Entity/One|A" });

    expect(decodeGraphEntityCursor(encoded)).toEqual({
      id: "entity|1",
      name: "Entity/One|A",
    });
  });

  it("round-trips knowledge path cursors with escaped paths", () => {
    const encoded = encodeKnowledgePathCursor({ id: "path-1", virtualPath: "/by-topic/a|b" });

    expect(decodeKnowledgePathCursor(encoded)).toEqual({
      id: "path-1",
      virtualPath: "/by-topic/a|b",
    });
  });

  it("round-trips golden question cursors", () => {
    const encoded = encodeGoldenQuestionCursor({
      createdAt: "2026-05-13T07:00:00.000Z",
      id: "question-1",
    });

    expect(decodeGoldenQuestionCursor(encoded)).toEqual({
      createdAt: "2026-05-13T07:00:00.000Z",
      id: "question-1",
    });
  });

  it("keeps invalid cursor failures typed as KnowledgeFS validation errors", () => {
    expect(() => decodeGraphEntityCursor("missing-id")).toThrow(KnowledgeFsValidationError);
    expect(() => decodeKnowledgePathCursor("missing-id")).toThrow(KnowledgeFsValidationError);
    expect(() => decodeGoldenQuestionCursor("missing-id")).toThrow(KnowledgeFsValidationError);
  });
});
