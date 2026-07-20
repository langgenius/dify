import type {
  PluginDaemonClientWithManagement,
  PluginDaemonModelProvider,
  PluginDaemonModelSchema,
} from "@knowledge/plugin-daemon-client";
import { describe, expect, it, vi } from "vitest";

import { createPluginDaemonModelCapabilityCatalog } from "./plugin-daemon-model-capability-catalog";

const embeddingSchema: PluginDaemonModelSchema = {
  deprecated: false,
  features: ["batch"],
  fetch_from: "predefined-model",
  label: { en_US: "Embed 384" },
  model: "embed-384",
  model_properties: { context_size: 8192, nested: { hidden: true } },
  model_type: "text-embedding",
  parameter_rules: [],
};

describe("createPluginDaemonModelCapabilityCatalog", () => {
  it("flattens installed declarations into a bounded, capability-filtered cursor page", async () => {
    const listModelProviders = vi.fn(async () => [
      provider({
        models: [
          embeddingSchema,
          { ...embeddingSchema, model: "llm-a", model_type: "llm" },
          { ...embeddingSchema, model: "rerank-a", model_type: "rerank" },
        ],
      }),
    ]);
    const catalog = createPluginDaemonModelCapabilityCatalog({
      client: client({ listModelProviders }),
      providerPageSize: 64,
    });

    const first = await catalog.list({ kind: "embedding", limit: 1, tenantId: "tenant-1" });

    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      capabilities: {
        modelProperties: { context_size: 8192 },
        modelType: "text-embedding",
        pluginUniqueIdentifier: "langgenius/openai:0.2.3@sha256:abc",
      },
      kinds: ["embedding"],
      model: "embed-384",
      pluginId: "langgenius/openai",
      pluginVersion: "0.2.3",
      provider: "openai",
    });
    expect(first.items[0]?.schemaFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.nextCursor).toBeUndefined();
    expect(listModelProviders).toHaveBeenCalledWith({
      page: 1,
      pageSize: 64,
      tenantId: "tenant-1",
    });
  });

  it("resumes within a provider model list without duplicating or skipping entries", async () => {
    const models = ["embed-a", "embed-b", "embed-c"].map((model) => ({
      ...embeddingSchema,
      model,
    }));
    const catalog = createPluginDaemonModelCapabilityCatalog({
      client: client({ listModelProviders: async () => [provider({ models })] }),
    });

    const first = await catalog.list({ limit: 2, tenantId: "tenant-1" });
    expect(first.items.map((item) => item.model)).toEqual(["embed-a", "embed-b"]);
    expect(first.nextCursor).toBeTruthy();

    const second = await catalog.list({
      cursor: first.nextCursor,
      limit: 2,
      tenantId: "tenant-1",
    });
    expect(second.items.map((item) => item.model)).toEqual(["embed-c"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("resolves predefined and customizable model schemas and includes install identity", async () => {
    const customizableProvider = provider({
      configurateMethods: ["customizable-model"],
      models: [],
      supportedModelTypes: ["text-embedding"],
    });
    const getModelSchema = vi.fn(async () => ({
      ...embeddingSchema,
      fetch_from: "customizable-model" as const,
      model: "custom-embedding",
    }));
    const catalog = createPluginDaemonModelCapabilityCatalog({
      client: client({ getModelSchema, listModelProviders: async () => [customizableProvider] }),
    });
    const selection = {
      model: "custom-embedding",
      pluginId: customizableProvider.plugin_id,
      provider: customizableProvider.provider,
    };

    const resolved = await catalog.resolve({ kind: "embedding", selection, tenantId: "tenant-1" });

    expect(resolved).toMatchObject({ model: "custom-embedding", pluginVersion: "0.2.3" });
    expect(getModelSchema).toHaveBeenCalledWith({
      credentials: {},
      model: "custom-embedding",
      modelType: "text-embedding",
      pluginId: customizableProvider.plugin_id,
      provider: customizableProvider.provider,
      tenantId: "tenant-1",
    });
  });

  it("validates daemon-resolved model credentials and fails closed for missing selections", async () => {
    const validateModelCredentials = vi.fn(async () => ({ result: true }));
    const installed = provider({ models: [embeddingSchema] });
    const catalog = createPluginDaemonModelCapabilityCatalog({
      client: client({
        listModelProviders: async () => [installed],
        validateModelCredentials,
      }),
    });
    const selection = {
      model: embeddingSchema.model,
      pluginId: installed.plugin_id,
      provider: installed.provider,
    };

    await expect(
      catalog.validate?.({ kind: "embedding", selection, tenantId: "tenant-1" }),
    ).resolves.toBe(true);
    expect(validateModelCredentials).toHaveBeenCalledWith({
      credentials: {},
      model: embeddingSchema.model,
      modelType: "text-embedding",
      pluginId: installed.plugin_id,
      provider: installed.provider,
      tenantId: "tenant-1",
    });

    await expect(
      catalog.resolve({
        kind: "embedding",
        selection: { ...selection, model: "missing" },
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
  });

  it("rejects tampered cursors and ambiguous plugin installation identities", async () => {
    const first = provider({ models: [embeddingSchema] });
    const second = {
      ...first,
      id: "20000000-0000-4000-8000-000000000002",
      plugin_unique_identifier: "langgenius/openai:0.2.4@sha256:def",
    };
    const catalog = createPluginDaemonModelCapabilityCatalog({
      client: client({ listModelProviders: async () => [first, second] }),
    });
    await expect(catalog.list({ cursor: "%%%", limit: 1, tenantId: "tenant-1" })).rejects.toThrow(
      "Invalid model catalog cursor",
    );
    await expect(
      catalog.resolve({
        kind: "embedding",
        selection: {
          model: embeddingSchema.model,
          pluginId: first.plugin_id,
          provider: first.provider,
        },
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("ambiguous installed model identity");
  });
});

function provider({
  configurateMethods = ["predefined-model"],
  models,
  supportedModelTypes = ["llm", "text-embedding", "rerank"],
}: {
  readonly configurateMethods?: PluginDaemonModelProvider["declaration"]["configurate_methods"];
  readonly models: PluginDaemonModelSchema[];
  readonly supportedModelTypes?: PluginDaemonModelProvider["declaration"]["supported_model_types"];
}): PluginDaemonModelProvider {
  return {
    created_at: "2026-07-14T12:00:00.000Z",
    declaration: {
      configurate_methods: configurateMethods,
      label: { en_US: "OpenAI" },
      models,
      provider: "openai",
      supported_model_types: supportedModelTypes,
    },
    id: "10000000-0000-4000-8000-000000000001",
    plugin_id: "langgenius/openai",
    plugin_unique_identifier: "langgenius/openai:0.2.3@sha256:abc",
    provider: "openai",
    tenant_id: "tenant-1",
    updated_at: "2026-07-14T12:00:00.000Z",
  };
}

function client(
  overrides: Partial<PluginDaemonClientWithManagement>,
): PluginDaemonClientWithManagement {
  return {
    dispatchDatasourceStream: async function* () {},
    dispatchStream: async function* () {},
    dispatchUnary: async () => undefined,
    getModelSchema: async () => embeddingSchema,
    listModelProviders: async () => [],
    validateModelCredentials: async () => ({ result: true }),
    validateProviderCredentials: async () => ({ result: true }),
    ...overrides,
  };
}
