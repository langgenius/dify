import type {
  PluginDaemonClient,
  PluginDaemonDispatchInput,
} from "@knowledge/plugin-daemon-client";
import { describe, expect, it } from "vitest";

import {
  ProviderInputError,
  ProviderResponseError,
  createPluginDaemonRerankerProvider,
} from "./index";

function fakeClient(
  handler: (input: PluginDaemonDispatchInput) => Promise<unknown>,
): PluginDaemonClient {
  return {
    dispatchDatasourceStream: () =>
      (async function* () {
        // unused by the rerank adapter
      })(),
    dispatchStream: () =>
      (async function* () {
        // unused by the rerank adapter
      })(),
    dispatchUnary: handler,
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

describe("createPluginDaemonRerankerProvider", () => {
  it("reranks via the rerank op and matches daemon indices back to documents", async () => {
    const calls: PluginDaemonDispatchInput[] = [];
    const provider = createPluginDaemonRerankerProvider({
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
    expect(result.metadata).toEqual({ model: "rerank-english-v3.0", provider: "plugin-daemon" });
    expect(calls[0]).toMatchObject({
      data: {
        credentials: {},
        docs: ["alpha", "beta", "gamma"],
        model: "rerank-english-v3.0",
        model_type: "rerank",
        provider: "cohere",
        query: "which is best",
        score_threshold: 0.1,
        top_n: 2,
      },
      op: "rerank",
      pluginId: "langgenius/cohere",
      tenantId: "tenant-abc",
    });
  });

  it("requires a per-call tenantId", async () => {
    const provider = createPluginDaemonRerankerProvider({
      ...BASE,
      client: fakeClient(async () => ({ docs: [] })),
    });

    await expect(
      provider.rerank({ documents: DOCS, model: BASE.model, query: "q" }),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });

  it("fails closed for out-of-range indices and invalid responses", async () => {
    const outOfRange = createPluginDaemonRerankerProvider({
      ...BASE,
      client: fakeClient(async () => ({ docs: [{ index: 99, score: 1 }] })),
    });

    await expect(
      outOfRange.rerank({ documents: DOCS, model: BASE.model, query: "q", tenantId: "t" }),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    const invalid = createPluginDaemonRerankerProvider({
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
    const provider = createPluginDaemonRerankerProvider({
      ...BASE,
      client: fakeClient(async () => data),
    });

    await expect(
      provider.rerank({ documents: DOCS, model: BASE.model, query: "q", tenantId: "t" }),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it("synthesizes a model descriptor and validates constructor options", async () => {
    const provider = createPluginDaemonRerankerProvider({
      ...BASE,
      client: fakeClient(async () => ({ docs: [] })),
    });

    await expect(provider.models()).resolves.toEqual([
      expect.objectContaining({ id: BASE.model, provider: "plugin-daemon" }),
    ]);

    expect(() =>
      createPluginDaemonRerankerProvider({
        ...BASE,
        client: fakeClient(async () => ({ docs: [] })),
        provider: "  ",
      }),
    ).toThrow(ProviderInputError);
  });
});
