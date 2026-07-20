import type {
  PluginDaemonClient,
  PluginDaemonDispatchInput,
} from "@knowledge/plugin-daemon-client";
import { describe, expect, it } from "vitest";

import {
  ProviderInputError,
  ProviderResponseError,
  createPluginDaemonEmbeddingProvider,
} from "./index";

function fakeClient(
  handler: (input: PluginDaemonDispatchInput) => Promise<unknown>,
): PluginDaemonClient {
  return {
    dispatchDatasourceStream: () =>
      (async function* () {
        // unused by the embedding adapter
      })(),
    dispatchStream: () =>
      (async function* () {
        // unused by the embedding adapter
      })(),
    dispatchUnary: handler,
  };
}

const BASE = {
  model: "text-embedding-3-large",
  pluginId: "langgenius/openai",
  provider: "openai",
} as const;

describe("createPluginDaemonEmbeddingProvider", () => {
  it("embeds via the text_embedding op and maps the daemon response", async () => {
    const calls: PluginDaemonDispatchInput[] = [];
    const provider = createPluginDaemonEmbeddingProvider({
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
      userId: "user-1",
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
        provider: "plugin-daemon",
        usage: { totalTokens: 7 },
      },
      model: "resolved-model",
    });
    expect(calls[0]).toMatchObject({
      data: {
        credentials: {},
        input_type: "document",
        model: "text-embedding-3-large",
        model_type: "text-embedding",
        provider: "openai",
        texts: ["a", "b"],
      },
      op: "text_embedding",
      pluginId: "langgenius/openai",
      tenantId: "tenant-abc",
      userId: "user-1",
    });
  });

  it("maps the search_query input type to query", async () => {
    let captured: PluginDaemonDispatchInput | undefined;
    const provider = createPluginDaemonEmbeddingProvider({
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

    expect((captured?.data as { input_type: string }).input_type).toBe("query");
  });

  it("requires a per-call tenantId", async () => {
    const provider = createPluginDaemonEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ embeddings: [[1, 1]] })),
    });

    await expect(provider.embed({ model: BASE.model, texts: ["q"] })).rejects.toBeInstanceOf(
      ProviderInputError,
    );
  });

  it("rejects invalid or mismatched embedding responses", async () => {
    const invalid = createPluginDaemonEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ wrong: true })),
    });

    await expect(
      invalid.embed({ model: BASE.model, tenantId: "t", texts: ["q"] }),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    const mismatch = createPluginDaemonEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ embeddings: [[1, 1]] })),
    });

    await expect(
      mismatch.embed({ model: BASE.model, tenantId: "t", texts: ["a", "b"] }),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    const inconsistentDimensions = createPluginDaemonEmbeddingProvider({
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
    const provider = createPluginDaemonEmbeddingProvider({
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
    const provider = createPluginDaemonEmbeddingProvider({
      ...BASE,
      client: fakeClient(async () => ({ embeddings: [[1, 1]] })),
      dimension: 1536,
    });

    await expect(provider.models()).resolves.toEqual([
      expect.objectContaining({
        dimension: 1536,
        id: "text-embedding-3-large",
        provider: "plugin-daemon",
        supportsDense: true,
      }),
    ]);

    expect(() =>
      createPluginDaemonEmbeddingProvider({
        ...BASE,
        client: fakeClient(async () => ({})),
        model: "  ",
      }),
    ).toThrow(ProviderInputError);
    expect(() =>
      createPluginDaemonEmbeddingProvider({
        ...BASE,
        client: fakeClient(async () => ({})),
        pluginId: "  ",
      }),
    ).toThrow(ProviderInputError);
    expect(() =>
      createPluginDaemonEmbeddingProvider({
        ...BASE,
        client: fakeClient(async () => ({})),
        provider: "  ",
      }),
    ).toThrow(ProviderInputError);
  });
});
