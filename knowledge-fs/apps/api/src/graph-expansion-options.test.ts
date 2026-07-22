import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRAPH_EXPANSION_OPTIONS,
  createApiGraphExpansionOptions,
} from "./graph-expansion-options";

describe("createApiGraphExpansionOptions", () => {
  it("returns the built-in defaults when the environment is empty", () => {
    expect(createApiGraphExpansionOptions({})).toEqual(DEFAULT_GRAPH_EXPANSION_OPTIONS);
  });

  it("is disabled via off/false/0 and enabled otherwise", () => {
    expect(createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION: "off" })).toBeUndefined();
    expect(createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION: "FALSE" })).toBeUndefined();
    expect(createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION: " 0 " })).toBeUndefined();
    expect(createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION: "on" })).toBeDefined();
  });

  it("parses overrides for every knob", () => {
    expect(
      createApiGraphExpansionOptions({
        KNOWLEDGE_GRAPH_EXPANSION_FANOUT: "30",
        KNOWLEDGE_GRAPH_EXPANSION_GRAPH_BOOST: "0.35",
        KNOWLEDGE_GRAPH_EXPANSION_GRAPH_TOP_K: "15",
        KNOWLEDGE_GRAPH_EXPANSION_MAX_DEPTH: "1",
        KNOWLEDGE_GRAPH_EXPANSION_MAX_SEED_ENTITIES: "8",
        KNOWLEDGE_GRAPH_EXPANSION_MAX_TRAVERSAL_NODES: "80",
        KNOWLEDGE_GRAPH_EXPANSION_TIMEOUT_MS: "500",
      }),
    ).toEqual({
      fanout: 30,
      graphBoost: 0.35,
      graphTopK: 15,
      maxDepth: 1,
      maxSeedEntities: 8,
      maxTraversalNodes: 80,
      timeoutMs: 500,
    });
  });

  it("fails startup fast on invalid values, naming the variable", () => {
    expect(() =>
      createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION_FANOUT: "zero" }),
    ).toThrow("KNOWLEDGE_GRAPH_EXPANSION_FANOUT must be a positive integer");
    expect(() =>
      createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION_TIMEOUT_MS: "0" }),
    ).toThrow("KNOWLEDGE_GRAPH_EXPANSION_TIMEOUT_MS must be a positive integer");
    expect(() =>
      createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION_MAX_DEPTH: "3" }),
    ).toThrow("KNOWLEDGE_GRAPH_EXPANSION_MAX_DEPTH must be an integer between 1 and 2");
    expect(() =>
      createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION_GRAPH_BOOST: "-0.2" }),
    ).toThrow("KNOWLEDGE_GRAPH_EXPANSION_GRAPH_BOOST must be a number greater than 0");
    expect(() =>
      createApiGraphExpansionOptions({ KNOWLEDGE_GRAPH_EXPANSION_GRAPH_TOP_K: "101" }),
    ).toThrow("KNOWLEDGE_GRAPH_EXPANSION_GRAPH_TOP_K must be an integer between 1 and 100");
  });
});
