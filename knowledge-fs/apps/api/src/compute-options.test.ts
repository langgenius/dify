import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createApiComputeRuntime } from "./compute-options";

describe("createApiComputeRuntime", () => {
  it("always creates the built-in TypeScript compute runtime", () => {
    const compute = createApiComputeRuntime();

    expect(compute).toEqual(
      expect.objectContaining({
        chunkParseArtifact: expect.any(Function),
        countApproxTokens: expect.any(Function),
        countTokens: expect.any(Function),
        diffText: expect.any(Function),
        packEvidence: expect.any(Function),
        rrfFuse: expect.any(Function),
      }),
    );
    expect(compute.countTokens("KnowledgeFS compute")).toBeGreaterThan(0);
  });
});

describe("API app compute wiring", () => {
  it("injects the built-in compute runtime into the gateway unconditionally", () => {
    const source = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).toHaveProperty("@knowledge/compute");
    expect(source).toContain("const compute = createApiComputeRuntime();");
    expect(source).toContain("compute,");
    expect(source).not.toContain("...(compute ? { compute } : {})");
  });
});
