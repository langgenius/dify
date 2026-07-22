import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiRerankerOptions } from "./reranker-options";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createApiRerankerOptions", () => {
  it("routes reranking through Dify by default", async () => {
    const options = createApiRerankerOptions({
      KNOWLEDGE_RERANK_MODEL: "rerank-v3.5",
      KNOWLEDGE_RERANK_PLUGIN_ID: "langgenius/cohere",
      KNOWLEDGE_RERANK_PLUGIN_PROVIDER: "cohere",
    });

    expect(options?.legacyDefaultConfigured).toBe(true);
    expect(options?.model).toBe("rerank-v3.5");
    expect(options?.provider.kind).toBe("dify-model-runtime");
    await expect(options?.provider.models()).resolves.toEqual([
      expect.objectContaining({ id: "rerank-v3.5", provider: "dify-model-runtime" }),
    ]);
    const selected = options?.providerFactory?.({
      model: "rerank-space-a",
      pluginId: "vendor/rerank",
      provider: "vendor",
    });
    expect(selected?.kind).toBe("dify-model-runtime");
    await expect(selected?.models()).resolves.toEqual([
      expect.objectContaining({ id: "rerank-space-a", provider: "dify-model-runtime" }),
    ]);
  });

  it("supports an explicit static reranker for tests", async () => {
    const options = createApiRerankerOptions({ KNOWLEDGE_RERANK_PROVIDER: "static" });

    expect(options?.model).toBe("static-rerank");
    expect(options?.legacyDefaultConfigured).toBe(true);
    expect(options?.provider.kind).toBe("static");
    await expect(options?.provider.models()).resolves.toEqual([
      expect.objectContaining({ id: "static-rerank", provider: "static" }),
    ]);
  });

  it("forbids the test-only static reranker in production", () => {
    expect(() =>
      createApiRerankerOptions({ KNOWLEDGE_RERANK_PROVIDER: "static", NODE_ENV: "production" }),
    ).toThrow("Static rerank provider is forbidden in production");
  });

  it("can be disabled explicitly", () => {
    expect(createApiRerankerOptions({ KNOWLEDGE_RERANK_PROVIDER: "off" })).toBeUndefined();
  });

  it("builds a dynamic Dify factory without a deployment default", async () => {
    const options = createApiRerankerOptions({});

    expect(options?.legacyDefaultConfigured).toBe(false);
    expect(options?.provider.kind).toBe("dify-model-runtime");
    await expect(options?.provider.models()).resolves.toEqual([]);

    const selected = options?.providerFactory?.({
      model: "space-reranker",
      pluginId: "vendor/reranker",
      provider: "vendor",
    });
    expect(selected?.kind).toBe("dify-model-runtime");
    await expect(selected?.models()).resolves.toEqual([
      expect.objectContaining({ id: "space-reranker", provider: "dify-model-runtime" }),
    ]);
  });

  it("never includes model credentials in Dify rerank requests", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestBodies.push(body);
      return Response.json({
        data: { docs: [{ index: 0, score: 0.8 }], model: body.model },
        error: "",
      });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const options = createApiRerankerOptions({
      KNOWLEDGE_RERANK_MODEL: "legacy-model",
      KNOWLEDGE_RERANK_PLUGIN_ID: "vendor/reranker",
      KNOWLEDGE_RERANK_PLUGIN_PROVIDER: "vendor",
    });
    if (!options) throw new Error("Expected reranker options");

    await options.provider.rerank({
      documents: [{ id: "legacy", text: "legacy" }],
      model: "legacy-model",
      query: "q",
      tenantId: "tenant-1",
    });
    await options
      .providerFactory?.({
        model: "space-model",
        pluginId: "vendor/reranker",
        provider: "vendor",
      })
      .rerank({
        documents: [{ id: "space", text: "space" }],
        model: "space-model",
        query: "q",
        tenantId: "tenant-2",
      });

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies.every((body) => !("credentials" in body))).toBe(true);
  });

  it("rejects an incomplete legacy default and unknown providers", () => {
    expect(() =>
      createApiRerankerOptions({ KNOWLEDGE_RERANK_PLUGIN_ID: "vendor/reranker" }),
    ).toThrow(
      "KNOWLEDGE_RERANK_PLUGIN_ID and KNOWLEDGE_RERANK_PLUGIN_PROVIDER must be configured together",
    );
    expect(() => createApiRerankerOptions({ KNOWLEDGE_RERANK_PLUGIN_PROVIDER: "vendor" })).toThrow(
      "KNOWLEDGE_RERANK_PLUGIN_ID and KNOWLEDGE_RERANK_PLUGIN_PROVIDER must be configured together",
    );
    expect(() => createApiRerankerOptions({ KNOWLEDGE_RERANK_PROVIDER: "unsupported" })).toThrow(
      "KNOWLEDGE_RERANK_PROVIDER must be dify-model-runtime",
    );
  });
});

describe("API app reranker wiring", () => {
  it("injects only the per-space reranker factory into production retrieval", () => {
    const indexSource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrieverSource = readFileSync(
      resolve(import.meta.dirname, "retriever-options.ts"),
      "utf8",
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).toHaveProperty("@knowledge/embeddings");
    expect(indexSource).toContain("createApiRerankerOptions");
    expect(indexSource).toContain("createApiRetriever");
    expect(indexSource).toContain("rerankerOptions");
    expect(indexSource).toContain("legacyDefaultConfigured: false");
    expect(indexSource).toContain("componentHealth");
    expect(retrieverSource).toContain("createFinalRerankRetrieval");
    expect(retrieverSource).toContain("rerankerFactory: rerankerOptions.providerFactory");
    expect(retrieverSource).toContain("reranker: rerankerOptions.provider");
    expect(retrieverSource).toContain("rerankerModel: rerankerOptions.model");
  });
});
