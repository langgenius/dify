import { describe, expect, it, vi } from "vitest";

import { createApiIngestionModelRuntimeOptions } from "./ingestion-model-runtime-options";

describe("createApiIngestionModelRuntimeOptions", () => {
  it("uses conservative production defaults", () => {
    const options = createApiIngestionModelRuntimeOptions({});

    expect(options.globalConcurrency).toBe(16);
    expect(options.outlineSummaryBatchMaxInputChars).toBe(32_000);
    expect(options.outlineSummaryBatchSize).toBe(8);
    expect(options.outlineSummaryMaxConcurrency).toBe(8);
    expect(options.semanticExtractionBatchSize).toBe(8);
    expect(options.semanticExtractionMaxConcurrency).toBe(4);
  });

  it("accepts bounded concurrency overrides", () => {
    const options = createApiIngestionModelRuntimeOptions({
      KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY: "24",
      KNOWLEDGE_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS: "64000",
      KNOWLEDGE_OUTLINE_SUMMARY_BATCH_SIZE: "16",
      KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY: "12",
      KNOWLEDGE_SEMANTIC_EXTRACTION_BATCH_SIZE: "10",
      KNOWLEDGE_SEMANTIC_EXTRACTION_MAX_CONCURRENCY: "6",
    });

    expect(options.globalConcurrency).toBe(24);
    expect(options.outlineSummaryBatchMaxInputChars).toBe(64_000);
    expect(options.outlineSummaryBatchSize).toBe(16);
    expect(options.outlineSummaryMaxConcurrency).toBe(12);
    expect(options.semanticExtractionBatchSize).toBe(10);
    expect(options.semanticExtractionMaxConcurrency).toBe(6);
  });

  it("connects the shared gate to aggregation-only operational metrics", async () => {
    const record = vi.fn();
    const options = createApiIngestionModelRuntimeOptions(
      { KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY: "1" },
      { record },
    );

    await expect(options.modelRequestGate.run(async () => "ok")).resolves.toBe("ok");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ activeRequests: 1, lifecycle: "acquired", limit: 1 }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ activeRequests: 0, lifecycle: "released", limit: 1 }),
    );
  });

  it.each([
    ["KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY", "0"],
    ["KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY", "129"],
    ["KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY", "1.5"],
    ["KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY", "0"],
    ["KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY", "33"],
    ["KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY", "many"],
    ["KNOWLEDGE_OUTLINE_SUMMARY_BATCH_SIZE", "33"],
    ["KNOWLEDGE_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS", "200001"],
    ["KNOWLEDGE_SEMANTIC_EXTRACTION_BATCH_SIZE", "33"],
    ["KNOWLEDGE_SEMANTIC_EXTRACTION_MAX_CONCURRENCY", "0"],
  ] as const)("rejects invalid %s=%s", (name, value) => {
    expect(() => createApiIngestionModelRuntimeOptions({ [name]: value })).toThrow(name);
  });
});
