import { describe, expect, it } from "vitest";

import { createApiSemanticEntityExtractionOptions } from "./llm-options";

const PLUGIN_ENV = {
  KNOWLEDGE_ENTITY_EXTRACTION_MODEL: "entity-model",
  KNOWLEDGE_ENTITY_EXTRACTION_PLUGIN_ID: "langgenius/openai",
  KNOWLEDGE_ENTITY_EXTRACTION_PLUGIN_PROVIDER: "openai",
  KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER: "plugin-daemon",
} as const;

describe("createApiSemanticEntityExtractionOptions", () => {
  it("keeps semantic entity extraction disabled until plugin-daemon is selected", () => {
    expect(createApiSemanticEntityExtractionOptions({})).toEqual({});
    expect(
      createApiSemanticEntityExtractionOptions({ KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER: "off" }),
    ).toEqual({});
  });

  it("configures plugin-daemon-backed semantic extraction from environment", () => {
    const options = createApiSemanticEntityExtractionOptions({
      ...PLUGIN_ENV,
      KNOWLEDGE_ENTITY_EXTRACTION_MAX_ENTITIES_PER_NODE: "25",
      KNOWLEDGE_ENTITY_EXTRACTION_MAX_NODES_PER_RUN: "10",
      KNOWLEDGE_RELATION_EXTRACTION_MAX_RELATIONS_PER_NODE: "12",
      KNOWLEDGE_COMMUNITY_SUMMARY_MODEL: "summary-model",
    });

    expect(options).toMatchObject({
      semanticEntityExtractionMaxEntitiesPerNode: 25,
      semanticEntityExtractionMaxNodesPerRun: 10,
      semanticEntityExtractionModel: "entity-model",
      semanticRelationExtractionMaxRelationsPerNode: 12,
      semanticRelationExtractionModel: "entity-model",
      semanticCommunitySummaryModel: "summary-model",
    });
    expect(options.semanticEntityExtractionProvider).toBeDefined();
    expect(options.semanticRelationExtractionProvider).toBeDefined();
    expect(options.semanticCommunitySummaryProvider).toBeDefined();
  });

  it("requires plugin-daemon config and validates numeric bounds", () => {
    expect(() =>
      createApiSemanticEntityExtractionOptions({
        KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER: "plugin-daemon",
      }),
    ).toThrow("KNOWLEDGE_ENTITY_EXTRACTION_MODEL is required for semantic entity extraction");
    expect(() =>
      createApiSemanticEntityExtractionOptions({
        ...PLUGIN_ENV,
        KNOWLEDGE_ENTITY_EXTRACTION_MAX_OUTPUT_TOKENS: "0",
      }),
    ).toThrow("KNOWLEDGE_ENTITY_EXTRACTION_MAX_OUTPUT_TOKENS must be a positive integer");
  });

  it("rejects unknown providers", () => {
    expect(() =>
      createApiSemanticEntityExtractionOptions({ KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER: "mistral" }),
    ).toThrow("KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER must be plugin-daemon or off");
  });
});
