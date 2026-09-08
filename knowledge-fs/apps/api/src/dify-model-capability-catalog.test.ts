import type {
  DifyModelCatalogItem,
  DifyModelRuntimeClient,
} from "@knowledge/dify-model-runtime-client";
import { describe, expect, it, vi } from "vitest";

import { createDifyModelCapabilityCatalog } from "./dify-model-capability-catalog";

const embeddingItem: DifyModelCatalogItem = {
  capabilities: {
    deprecated: false,
    modelProperties: { context_size: 8192 },
  },
  model: "embed-384",
  model_type: "text-embedding",
  plugin_id: "langgenius/openai",
  plugin_unique_identifier: "langgenius/openai:0.2.3@sha256:abc",
  provider: "openai",
};

describe("createDifyModelCapabilityCatalog", () => {
  it("passes token limits without invalidating existing capability fingerprints", async () => {
    let item = { ...embeddingItem, model_type: "llm" as const };
    const catalog = createDifyModelCapabilityCatalog({
      client: client({ listModels: async () => ({ items: [item] }) }),
    });
    const request = {
      kind: "reasoning" as const,
      tenantId: "tenant-1",
      selection: {
        model: item.model,
        provider: item.provider,
        pluginId: item.plugin_id,
      },
    };
    const before = await catalog.resolve(request);
    item = {
      ...item,
      ...{
        token_limits: {
          context_tokens: 131072,
          max_output_tokens: 32768,
          output_parameter: "max_completion_tokens",
        },
      },
    };
    const after = await catalog.resolve(request);
    expect(after?.tokenLimits).toEqual({
      contextTokens: 131072,
      maxOutputTokens: 32768,
      outputParameter: "max_completion_tokens",
    });
    expect(after?.schemaFingerprint).toBe(before?.schemaFingerprint);
    expect(after?.capabilities).toEqual(before?.capabilities);
  });
  it("lists tenant-active Dify models across capability types with an opaque cursor", async () => {
    const listModels = vi.fn(async (input: Parameters<DifyModelRuntimeClient["listModels"]>[0]) => {
      if (input.modelType === "text-embedding") return { items: [embeddingItem] };
      if (input.modelType === "llm") {
        return { items: [{ ...embeddingItem, model: "chat", model_type: "llm" as const }] };
      }
      return { items: [{ ...embeddingItem, model: "rerank", model_type: "rerank" as const }] };
    });
    const catalog = createDifyModelCapabilityCatalog({ client: client({ listModels }) });

    const first = await catalog.list({ limit: 2, tenantId: "tenant-1" });

    expect(first.items.map((item) => item.kinds[0])).toEqual(["embedding", "reasoning"]);
    expect(first.items[0]).toMatchObject({
      capabilities: {
        modelProperties: { context_size: 8192 },
        pluginUniqueIdentifier: embeddingItem.plugin_unique_identifier,
      },
      model: embeddingItem.model,
      pluginId: embeddingItem.plugin_id,
      pluginVersion: "0.2.3",
      provider: embeddingItem.provider,
    });
    expect(first.items[0]?.schemaFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.nextCursor).toBeTruthy();

    const second = await catalog.list({
      cursor: first.nextCursor,
      limit: 2,
      tenantId: "tenant-1",
    });
    expect(second.items.map((item) => item.kinds[0])).toEqual(["rerank"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("resolves an exact tenant-active model without accepting credentials", async () => {
    const listModels = vi.fn(async () => ({ items: [embeddingItem] }));
    const catalog = createDifyModelCapabilityCatalog({ client: client({ listModels }) });

    const result = await catalog.resolve({
      kind: "embedding",
      selection: {
        model: embeddingItem.model,
        pluginId: embeddingItem.plugin_id,
        provider: embeddingItem.provider,
      },
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({ model: "embed-384", pluginId: "langgenius/openai" });
    expect(listModels).toHaveBeenCalledWith({
      limit: 2,
      model: "embed-384",
      modelType: "text-embedding",
      pluginId: "langgenius/openai",
      provider: "openai",
      tenantId: "tenant-1",
    });
    expect(catalog.validate).toBeUndefined();
  });

  it("fails closed for ambiguous selections and tampered cursors", async () => {
    const ambiguous = createDifyModelCapabilityCatalog({
      client: client({
        listModels: async () => ({ items: [embeddingItem, embeddingItem] }),
      }),
    });
    await expect(
      ambiguous.resolve({
        kind: "embedding",
        selection: {
          model: embeddingItem.model,
          pluginId: embeddingItem.plugin_id,
          provider: embeddingItem.provider,
        },
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("ambiguous active model selection");

    const catalog = createDifyModelCapabilityCatalog({ client: client({}) });
    await expect(catalog.list({ cursor: "%%%", limit: 1, tenantId: "tenant-1" })).rejects.toThrow(
      "Invalid model catalog cursor",
    );
  });
});

function client(overrides: Partial<DifyModelRuntimeClient>): DifyModelRuntimeClient {
  return {
    invokeLlm: async function* () {},
    invokeMultimodalEmbedding: async () => undefined,
    invokeRerank: async () => undefined,
    invokeTextEmbedding: async () => undefined,
    listModels: async () => ({ items: [] }),
    ...overrides,
  };
}
