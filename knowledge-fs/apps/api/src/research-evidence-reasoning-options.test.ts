import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createApiResearchEvidenceReasoningOptions } from "./research-evidence-reasoning-options";

describe("Research evidence reasoning options", () => {
  it("uses one 8K structured-output budget by default", () => {
    expect(createApiResearchEvidenceReasoningOptions({})).toEqual({
      maxOutputTokens: 8_192,
      timeoutMs: 60_000,
    });
  });

  it("accepts explicit positive runtime bounds", () => {
    expect(
      createApiResearchEvidenceReasoningOptions({
        KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS: "1536",
        KNOWLEDGE_RESEARCH_REASONING_TIMEOUT_MS: "45000",
      }),
    ).toEqual({
      maxOutputTokens: 1_536,
      timeoutMs: 45_000,
    });
  });

  it("rejects invalid bounds", () => {
    expect(() =>
      createApiResearchEvidenceReasoningOptions({
        KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS: "0",
      }),
    ).toThrow("KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS must be a positive integer");
  });

  it("wires the dedicated Research budgets instead of the old 512-token answer cap", () => {
    const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(indexSource).toContain("createApiResearchEvidenceReasoningOptions");
    expect(indexSource).toContain(
      "maxOutputTokens: researchEvidenceReasoningOptions.maxOutputTokens",
    );
    expect(indexSource).not.toContain("recoveryMaxOutputTokens");
    expect(indexSource).not.toContain("Math.min(profileReasoningCapability.maxOutputTokens, 512)");
  });
});
