import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("embedding code health guardrails", () => {
  it("keeps dense-vector cloning at ownership boundaries only", () => {
    const source = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");

    expect(source).not.toContain("encodeJson(cloneEmbedTextsResult(result))");
    expect(source).not.toContain("return cloneEmbedTextsResult(payload)");
    expect(source).not.toContain("const dense = cloneDenseVectors(parsed.data.embeddings.float)");
    expect(source).not.toContain("vectors[item.index] = [...item.embedding]");
    expect(source).not.toContain("return [...vector]");
    expect(source).not.toContain("function stableJson");
  });
});
