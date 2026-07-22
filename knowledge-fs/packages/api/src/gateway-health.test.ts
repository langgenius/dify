import { createTypeScriptComputeRuntime } from "@knowledge/compute";
import { describe, expect, it } from "vitest";

import { collectGatewayComponentHealth } from "./gateway-health";

describe("gateway health utilities", () => {
  it("collects component health with safe defaults for optional providers", async () => {
    await expect(
      collectGatewayComponentHealth({
        compute: createTypeScriptComputeRuntime(),
        embedding: { health: async () => true },
        llm: { health: async () => false },
        parser: undefined,
        reranker: { models: async () => ["rerank-v1"] },
      }),
    ).resolves.toEqual({
      compute: true,
      embedding: true,
      llm: false,
      parser: true,
      reranker: true,
    });
  });

  it("treats thrown health and model checks as unhealthy", async () => {
    await expect(
      collectGatewayComponentHealth({
        compute: {
          countTokens: () => 1,
          rrfFuse: () => {
            throw new Error("compute down");
          },
        },
        embedding: {
          health: async () => {
            throw new Error("embedding down");
          },
        },
        llm: {
          models: async () => {
            throw new Error("llm down");
          },
        },
        parser: { health: async () => true },
      }),
    ).resolves.toMatchObject({
      compute: false,
      embedding: false,
      llm: false,
      parser: true,
      reranker: false,
    });
  });
});
