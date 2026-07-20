import { describe, expect, it } from "vitest";

import { KnowledgeFsNotFoundError, KnowledgeFsValidationError } from "./knowledge-fs-errors";

describe("knowledge-fs-errors", () => {
  it("exports stable KnowledgeFS error classes for gateway and utility boundaries", () => {
    expect(new KnowledgeFsValidationError("invalid")).toBeInstanceOf(Error);
    expect(new KnowledgeFsNotFoundError("missing")).toBeInstanceOf(Error);
    expect(new KnowledgeFsNotFoundError("missing").message).toBe("missing");
  });
});
