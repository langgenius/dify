import type {
  DifyModelRuntimeClient,
  DifyTextEmbeddingInput,
} from "@knowledge/dify-model-runtime-client";
import { describe, expect, it } from "vitest";

import {
  ProviderInputError,
  ProviderResponseError,
  createDifyModelRuntimeEmbeddingProvider,
} from "./index";

function fakeClient(
  handler: (input: DifyTextEmbeddingInput) => Promise<unknown>,
): DifyModelRuntimeClient {
  return {
    invokeLlm: async function* () {},
    invokeMultimodalEmbedding: async () => undefined,
    invokeRerank: async () => undefined,
    invokeTextEmbedding: handler,
    listModels: async () => ({ items: [] }),
  };
}

const BASE = {
  model: "text-embedding-3-large",
  pluginId: "langgenius/openai",
  provider: "openai",
} as const;

describe("Dify model runtime embedding provider", () => {
  it("embeds through Dify and maps the ModelInstance response", async () => {
    const calls: DifyTextEmbeddingInput[] = [];
    const provider = createDifyModelRuntimeEmbeddingProvider({
      ...BASE,
      client: fakeClient(async (input) => {
        calls.push(input);

        return {
          embeddings: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
          model: "resolved-model",
          usage: { tokens: 7, total_tokens: 7 },
        };
      }),
    });

    const result = await provider.embed({
      inputType: "search_document",
      model: "text-embedding-3-large",
      tenantId: "tenant-abc",
      texts: ["a", "b"],
    });

    expect(result).toEqual({
      dense: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      metadata: {
        dimension: 2,
        model: "resolved-model",
        provider: "dify-model-runtime",
        usage: { totalTokens: 7 },
      },
      model: "resolved-model",
    });
    expect(calls[0]).toMatchObject({
      inputType: "document",
      model: "text-embedding-3-large",
      pluginId: "langgenius/openai",
      provider: "openai",
      tenantId: "tenant-abc",
      texts: ["a", "b"],
    });
  });

  it("maps the search_query input type to query", async () => {
    let captured: DifyTextEmbeddingInput | undefined;
    const provider = createDifyModelRuntimeEmbeddingProvider({
      ...BASE,
      client: fakeClient(async (input) => {
        captured = input;

        return { embeddings: [[1, 1]] };
      }),
    });

    await provider.embed({
      inputType: "search_query",
      model: BASE.model,
      tenantId: "tenant-abc",
      texts: ["q"],
    });

    expect(captured?.inputType).toBe("query");
  });

  it("requires a per-call tenantId", async () => {
    const provider = createDifyModelRuntimeEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ embeddings: [[1, 1]] })),
    });

    await expect(provider.embed({ model: BASE.model, texts: ["q"] })).rejects.toBeInstanceOf(
      ProviderInputError,
    );
  });

  it("rejects invalid or mismatched embedding responses", async () => {
    const invalid = createDifyModelRuntimeEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ wrong: true })),
    });

    await expect(
      invalid.embed({ model: BASE.model, tenantId: "t", texts: ["q"] }),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    const mismatch = createDifyModelRuntimeEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ embeddings: [[1, 1]] })),
    });

    await expect(
      mismatch.embed({ model: BASE.model, tenantId: "t", texts: ["a", "b"] }),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    const inconsistentDimensions = createDifyModelRuntimeEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({
        embeddings: [
          [1, 1],
          [1, 1, 1],
        ],
      })),
    });

    await expect(
      inconsistentDimensions.embed({ model: BASE.model, tenantId: "t", texts: ["a", "b"] }),
    ).rejects.toThrow("inconsistent embedding dimension");
  });

  it("discovers a plugin model dimension from the actual response", async () => {
    const provider = createDifyModelRuntimeEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ embeddings: [[0.1, 0.2, 0.3]] })),
    });

    await expect(provider.models()).resolves.toEqual([
      expect.not.objectContaining({ dimension: expect.anything() }),
    ]);
    await expect(
      provider.embed({ model: BASE.model, tenantId: "t", texts: ["query"] }),
    ).resolves.toMatchObject({ metadata: { dimension: 3 } });
    await expect(provider.models()).resolves.toEqual([
      expect.objectContaining({ dimension: 3, id: BASE.model }),
    ]);
  });

  it("synthesizes a model descriptor and validates constructor options", async () => {
    const provider = createDifyModelRuntimeEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ embeddings: [[1, 1]] })),
      dimension: 1536,
    });

    await expect(provider.models()).resolves.toEqual([
      expect.objectContaining({
        dimension: 1536,
        id: "text-embedding-3-large",
        provider: "dify-model-runtime",
        supportsDense: true,
      }),
    ]);

    expect(() =>
      createDifyModelRuntimeEmbeddingProvider({
        ...BASE,
        client: fakeClient(async () => ({})),
        model: "  ",
      }),
    ).toThrow(ProviderInputError);
    expect(() =>
      createDifyModelRuntimeEmbeddingProvider({
        ...BASE,
        client: fakeClient(async () => ({})),
        pluginId: "  ",
      }),
    ).toThrow(ProviderInputError);
    expect(() =>
      createDifyModelRuntimeEmbeddingProvider({
        ...BASE,
        client: fakeClient(async () => ({})),
        provider: "  ",
      }),
    ).toThrow(ProviderInputError);
  });
});
