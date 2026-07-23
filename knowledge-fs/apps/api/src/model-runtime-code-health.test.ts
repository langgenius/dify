import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MODEL_RUNTIME_FILES = [
  "answer-generation-options.ts",
  "dify-model-capability-catalog.ts",
  "dify-model-runtime-options.ts",
  "embedding-options.ts",
  "generation-provider.ts",
  "llm-options.ts",
  "multimodal-answer-options.ts",
  "multimodal-enrichment-options.ts",
  "reranker-options.ts",
  "visual-embedding-options.ts",
] as const;

describe("KnowledgeFS model-runtime architecture", () => {
  it("keeps every application model path behind Dify and out of plugin-daemon credentials", () => {
    for (const file of MODEL_RUNTIME_FILES) {
      const source = readFileSync(resolve(import.meta.dirname, file), "utf8");

      expect(source, file).not.toContain("@knowledge/plugin-daemon-client");
      expect(source, file).not.toMatch(/\bcredentials\s*:/u);
      expect(source, file).not.toMatch(/dispatch(?:Stream|Unary)\s*\(/u);
    }
  });

  it("keeps the API app independent from direct plugin-daemon transports", () => {
    const packageJson = readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8");
    const dockerfile = readFileSync(resolve(import.meta.dirname, "../Dockerfile"), "utf8");

    expect(packageJson).not.toContain("@knowledge/plugin-daemon-client");
    expect(dockerfile).not.toContain("packages/plugin-daemon-client");
  });
});
