import type { DifyModelRuntimeClient, DifyRerankInput } from "@knowledge/dify-model-runtime-client";
import { describe, expect, it } from "vitest";

import {
  ProviderInputError,
  ProviderResponseError,
  createDifyModelRuntimeRerankerProvider,
} from "./index";

function fakeClient(handler: (input: DifyRerankInput) => Promise<unknown>): DifyModelRuntimeClient {
  return {
    invokeLlm: async function* () {},
    invokeMultimodalEmbedding: async () => undefined,
    invokeRerank: handler,
    invokeTextEmbedding: async () => undefined,
    listModels: async () => ({ items: [] }),
  };
}

const BASE = {
  model: "rerank-english-v3.0",
  pluginId: "langgenius/cohere",
  provider: "cohere",
} as const;

const DOCS = [
  { id: "a", metadata: { source: "x" }, text: "alpha" },
  { id: "b", text: "beta" },
  { id: "c", text: "gamma" },
];

describe("Dify model runtime reranker provider", () => {
  it("reranks through Dify and matches indices back to documents", async () => {
    const calls: DifyRerankInput[] = [];
    const provider = createDifyModelRuntimeRerankerProvider({
      ...BASE,
      client: fakeClient(async (input) => {
        calls.push(input);

        return {
          docs: [
            { index: 2, score: 0.9 },
            { index: 0, score: 0.5 },
          ],
          model: "rerank-english-v3.0",
        };
      }),
      scoreThreshold: 0.1,
    });

    const result = await provider.rerank({
      documents: DOCS,
      model: BASE.model,
      query: "which is best",
      tenantId: "tenant-abc",
      topN: 2,
    });

    expect(result.items).toEqual([
      { document: { id: "c", metadata: {}, text: "gamma" }, index: 2, score: 0.9 },
      { document: { id: "a", metadata: { source: "x" }, text: "alpha" }, index: 0, score: 0.5 },
    ]);
    expect(result.metadata).toEqual({
      model: "rerank-english-v3.0",
      provider: "dify-model-runtime",
    });
    expect(calls[0]).toMatchObject({
      docs: ["alpha", "beta", "gamma"],
      model: "rerank-english-v3.0",
      pluginId: "langgenius/cohere",
      provider: "cohere",
      query: "which is best",
      scoreThreshold: 0.1,
      tenantId: "tenant-abc",
      topN: 2,
    });
  });

  it("requires a per-call tenantId", async () => {
    const provider = createDifyModelRuntimeRerankerProvider({
      ...BASE,
      client: fakeClient(async () => ({ docs: [] })),
    });

    await expect(
      provider.rerank({ documents: DOCS, model: BASE.model, query: "q" }),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });

  it("fails closed for out-of-range indices and invalid responses", async () => {
    const outOfRange = createDifyModelRuntimeRerankerProvider({
      ...BASE,
      client: fakeClient(async () => ({ docs: [{ index: 99, score: 1 }] })),
    });

    await expect(
      outOfRange.rerank({ documents: DOCS, model: BASE.model, query: "q", tenantId: "t" }),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    const invalid = createDifyModelRuntimeRerankerProvider({
      ...BASE,
      client: fakeClient(async () => ({ wrong: true })),
    });

    await expect(
      invalid.rerank({ documents: DOCS, model: BASE.model, query: "q", tenantId: "t" }),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it.each([
    {
      data: { docs: [{ index: 0, score: 1.1 }] },
      label: "scores outside the normalized domain",
    },
    {
      data: {
        docs: [
          { index: 0, score: 0.9 },
          { index: 0, score: 0.8 },
        ],
      },
      label: "duplicate indices",
    },
    {
      data: { docs: [{ index: 0, score: 0.9 }], model: "different-model" },
      label: "a mismatched model identity",
    },
  ])("rejects $label", async ({ data }) => {
    const provider = createDifyModelRuntimeRerankerProvider({
      ...BASE,
      client: fakeClient(async () => data),
    });

    await expect(
      provider.rerank({ documents: DOCS, model: BASE.model, query: "q", tenantId: "t" }),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it("synthesizes a model descriptor and validates constructor options", async () => {
    const provider = createDifyModelRuntimeRerankerProvider({
      ...BASE,
      client: fakeClient(async () => ({ docs: [] })),
    });

    await expect(provider.models()).resolves.toEqual([
      expect.objectContaining({ id: BASE.model, provider: "dify-model-runtime" }),
    ]);

    expect(() =>
      createDifyModelRuntimeRerankerProvider({
        ...BASE,
        client: fakeClient(async () => ({ docs: [] })),
        provider: "  ",
      }),
    ).toThrow(ProviderInputError);
  });
});
