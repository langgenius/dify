import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiEmbeddingOptions } from "./embedding-options";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createApiEmbeddingOptions", () => {
  it("disables dense embeddings when explicitly turned off", () => {
    expect(createApiEmbeddingOptions({ KNOWLEDGE_EMBEDDING_PROVIDER: "off" })).toEqual({});
  });

  it("routes embeddings through Dify by default", async () => {
    const options = createApiEmbeddingOptions({
      // Plugin-backed dimensions come from the daemon response, not this legacy/static setting.
      KNOWLEDGE_EMBEDDING_DIMENSION: "999",
      KNOWLEDGE_EMBEDDING_MODEL: "text-embedding-3-large",
      KNOWLEDGE_EMBEDDING_PLUGIN_ID: "langgenius/openai",
      KNOWLEDGE_EMBEDDING_PLUGIN_PROVIDER: "openai",
    });

    expect(options.legacyDefaultConfigured).toBe(true);
    expect(options.denseEmbeddingModel).toBe("text-embedding-3-large");
    expect(options.denseEmbeddingSelection).toEqual({
      model: "text-embedding-3-large",
      pluginId: "langgenius/openai",
      provider: "openai",
    });
    expect(options.embeddingProvider?.kind).toBe("dify-model-runtime");
    expect(options.denseEmbeddingProvider).toBe(options.embeddingProvider);
    await expect(options.embeddingProvider?.models()).resolves.toEqual([
      expect.objectContaining({ id: "text-embedding-3-large", provider: "dify-model-runtime" }),
    ]);
    expect((await options.embeddingProvider.models())[0]).not.toHaveProperty("dimension");

    const independentlySelectedProvider = options.knowledgeSpaceEmbeddingProviderFactory({
      model: "embed-multilingual-v3.0",
      pluginId: "langgenius/cohere",
      provider: "cohere",
    });
    await expect(independentlySelectedProvider.models()).resolves.toEqual([
      expect.objectContaining({ id: "embed-multilingual-v3.0", provider: "dify-model-runtime" }),
    ]);
  });

  it("builds a profile-only Dify factory without a deployment default", async () => {
    const options = createApiEmbeddingOptions({});

    expect(options.legacyDefaultConfigured).toBe(false);
    expect(options.denseEmbeddingSelection).toBeUndefined();
    expect(options.embeddingProvider.kind).toBe("dify-model-runtime");
    await expect(options.embeddingProvider.models()).resolves.toEqual([]);
    await expect(
      options.embeddingProvider.embed({ model: "unused", texts: ["test"] }),
    ).rejects.toThrow("No deployment-default embedding model");

    const selected = options.knowledgeSpaceEmbeddingProviderFactory({
      model: "space-embedding",
      pluginId: "vendor/embedding",
      provider: "vendor",
    });
    expect(selected.kind).toBe("dify-model-runtime");
    await expect(selected.models()).resolves.toEqual([
      expect.objectContaining({ id: "space-embedding", provider: "dify-model-runtime" }),
    ]);
  });

  it("never includes model credentials in Dify embedding requests", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        data: { embeddings: [[0.1, 0.2]], model: "resolved" },
        error: "",
      });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const options = createApiEmbeddingOptions({
      KNOWLEDGE_EMBEDDING_MODEL: "legacy-model",
      KNOWLEDGE_EMBEDDING_PLUGIN_ID: "vendor/embedding",
      KNOWLEDGE_EMBEDDING_PLUGIN_PROVIDER: "vendor",
    });

    await options.embeddingProvider.embed({
      model: "legacy-model",
      tenantId: "tenant-1",
      texts: ["legacy"],
    });
    await options
      .knowledgeSpaceEmbeddingProviderFactory({
        model: "space-model",
        pluginId: "vendor/embedding",
        provider: "vendor",
      })
      .embed({ model: "space-model", tenantId: "tenant-2", texts: ["space"] });

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies.every((body) => !("credentials" in body))).toBe(true);
    expect(requestBodies.map((body) => body.provider)).toEqual([
      "vendor/embedding/vendor",
      "vendor/embedding/vendor",
    ]);
  });

  it("supports an explicit static provider for tests", () => {
    expect(
      createApiEmbeddingOptions({
        KNOWLEDGE_EMBEDDING_DIMENSION: "4",
        KNOWLEDGE_EMBEDDING_PROVIDER: "static",
      }),
    ).toMatchObject({
      denseEmbeddingSelection: {
        model: "static-embedding",
        pluginId: "static",
        provider: "static",
      },
      denseEmbeddingModel: "static-embedding",
      denseEmbeddingProvider: { kind: "static" },
      embeddingProvider: { kind: "static" },
    });
  });

  it("does not force embedding models to a fixed dimension", async () => {
    const options = createApiEmbeddingOptions({
      KNOWLEDGE_EMBEDDING_DIMENSION: "3072",
      KNOWLEDGE_EMBEDDING_PROVIDER: "static",
    });

    await expect(options.embeddingProvider.models()).resolves.toEqual([
      expect.objectContaining({ dimension: 3072 }),
    ]);

    expect(() => createApiEmbeddingOptions({ KNOWLEDGE_EMBEDDING_PROVIDER: "static" })).toThrow(
      "KNOWLEDGE_EMBEDDING_DIMENSION is required",
    );

    expect(() =>
      options.knowledgeSpaceEmbeddingProviderFactory({
        model: "model",
        pluginId: "not-static",
        provider: "static",
      }),
    ).toThrow("Static embedding runtime only supports");
  });

  it("rejects incomplete defaults, production static providers, and unknown providers", () => {
    expect(() =>
      createApiEmbeddingOptions({ KNOWLEDGE_EMBEDDING_PLUGIN_ID: "langgenius/openai" }),
    ).toThrow(
      "KNOWLEDGE_EMBEDDING_PLUGIN_ID and KNOWLEDGE_EMBEDDING_PLUGIN_PROVIDER must be configured together",
    );
    expect(() =>
      createApiEmbeddingOptions({ KNOWLEDGE_EMBEDDING_PLUGIN_PROVIDER: "openai" }),
    ).toThrow(
      "KNOWLEDGE_EMBEDDING_PLUGIN_ID and KNOWLEDGE_EMBEDDING_PLUGIN_PROVIDER must be configured together",
    );
    expect(() =>
      createApiEmbeddingOptions({
        KNOWLEDGE_EMBEDDING_DIMENSION: "4",
        KNOWLEDGE_EMBEDDING_PROVIDER: "static",
        NODE_ENV: "production",
      }),
    ).toThrow("Static embedding provider is forbidden in production");
    expect(() =>
      createApiEmbeddingOptions({
        KNOWLEDGE_EMBEDDING_DIMENSION: "4",
        KNOWLEDGE_EMBEDDING_PROVIDER: "static",
        NODE_ENV: "PRODUCTION",
      }),
    ).toThrow("Static embedding provider is forbidden in production");
    expect(() =>
      createApiEmbeddingOptions({ KNOWLEDGE_EMBEDDING_PROVIDER: "unsupported" }),
    ).toThrow("KNOWLEDGE_EMBEDDING_PROVIDER must be dify-model-runtime");
  });

  it("keeps API app assembly profile-scoped without a deployment fallback", async () => {
    const { readFile } = await import("node:fs/promises");
    const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(indexSource).toContain("createKnowledgeSpaceEmbeddingResolver({");
    expect(indexSource).toContain("persisted embedding profile fails closed");
    expect(indexSource).not.toContain("fallback: {");
    expect(indexSource).not.toContain("defaultEmbeddingSelection:");
    expect(indexSource).not.toContain("denseEmbeddingProvider: embeddingOptions");
    expect(indexSource).not.toContain("embeddingProvider: embeddingOptions");
  });
});
