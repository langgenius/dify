import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type DatabaseRow,
  type EmbeddingModel,
  EmbeddingModelSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  EmbeddingModelRegistryCapacityExceededError,
  createDatabaseEmbeddingModelRegistry,
  createInMemoryEmbeddingModelRegistry,
} from "./embedding-model-registry";

const model = EmbeddingModelSchema.parse({
  createdAt: "2026-05-12T08:00:00.000Z",
  dimension: 1536,
  id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
  maxTokens: 8192,
  metadata: { release: "stable" },
  metric: "cosine",
  modelId: "text-embedding-3-small",
  provider: "openai",
  status: "active",
  tokenizer: "cl100k_base",
  updatedAt: "2026-05-12T08:00:00.000Z",
  version: "2026-05-01",
}) satisfies EmbeddingModel;

describe("embedding model registries", () => {
  it("stores clone-isolated models with bounded capacity and stable pagination", async () => {
    const registry = createInMemoryEmbeddingModelRegistry({ maxListLimit: 1, maxModels: 2 });
    const second = EmbeddingModelSchema.parse({
      ...model,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
      modelId: "text-embedding-3-tiny",
    });

    await expect(registry.register(model)).resolves.toEqual(model);
    await expect(registry.register(second)).resolves.toEqual(second);

    const loaded = await registry.get({ modelId: model.modelId, version: model.version });

    if (!loaded) {
      throw new Error("Expected embedding model");
    }

    loaded.metadata.release = "mutated";
    await expect(registry.get({ modelId: model.modelId, version: model.version })).resolves.toEqual(
      model,
    );

    const page = await registry.list({ limit: 1, provider: "openai", status: "active" });
    expect(page).toEqual({
      items: [model],
      nextCursor: { id: model.id, modelId: model.modelId },
    });
    await expect(
      registry.list({ cursor: page.nextCursor, limit: 1, status: "active" }),
    ).resolves.toEqual({ items: [second] });

    await expect(
      registry.register(
        EmbeddingModelSchema.parse({
          ...model,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
          modelId: "voyage-3",
        }),
      ),
    ).rejects.toBeInstanceOf(EmbeddingModelRegistryCapacityExceededError);
  });

  it("rejects invalid bounds, lookup inputs, and unbounded list reads", async () => {
    expect(() => createInMemoryEmbeddingModelRegistry({ maxListLimit: 1, maxModels: 0 })).toThrow(
      "Embedding model registry maxModels must be at least 1",
    );
    expect(() => createInMemoryEmbeddingModelRegistry({ maxListLimit: 0, maxModels: 1 })).toThrow(
      "Embedding model registry maxListLimit must be at least 1",
    );

    const registry = createInMemoryEmbeddingModelRegistry({ maxListLimit: 1, maxModels: 1 });

    await expect(registry.list({ limit: 2, status: "active" })).rejects.toThrow(
      "Embedding model registry list limit exceeds maxListLimit=1",
    );
    await expect(registry.get({ modelId: " ", version: model.version })).rejects.toThrow(
      "Embedding model modelId is required",
    );
    await expect(registry.get({ modelId: model.modelId, version: " " })).rejects.toThrow(
      "Embedding model version is required",
    );
  });

  it("uses parameterized database SQL and maps rows to domain models", async () => {
    const fake = createFakeEmbeddingModelExecutor();
    const registry = createDatabaseEmbeddingModelRegistry({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxListLimit: 2,
    });
    const second = EmbeddingModelSchema.parse({
      ...model,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f04",
      modelId: "text-embedding-3-tiny",
    });

    await expect(registry.register(model)).resolves.toEqual(model);
    await expect(registry.register(second)).resolves.toEqual(second);
    await expect(registry.get({ modelId: model.modelId, version: model.version })).resolves.toEqual(
      model,
    );
    await expect(
      registry.list({ limit: 1, provider: "openai", status: "active" }),
    ).resolves.toEqual({
      items: [model],
      nextCursor: { id: model.id, modelId: model.modelId },
    });

    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "embedding_models",
      }),
    );
    expect(fake.calls[0]?.sql).toContain('ON CONFLICT ("model_id", "version") DO UPDATE');
    expect(fake.calls[0]?.sql).not.toContain(model.modelId);
    expect(fake.calls[0]?.params).toContain(JSON.stringify(model.metadata));
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [model.modelId, model.version],
        tableName: "embedding_models",
      }),
    );
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: ["active", "openai", 2],
        tableName: "embedding_models",
      }),
    );
  });
});

function createFakeEmbeddingModelExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, DatabaseRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });

    if (input.operation === "insert") {
      const [
        id,
        provider,
        modelId,
        version,
        dimension,
        metric,
        tokenizer,
        maxTokens,
        status,
        metadata,
        createdAt,
        updatedAt,
      ] = input.params;
      const row = {
        created_at: String(createdAt),
        dimension: Number(dimension),
        id: String(id),
        max_tokens: Number(maxTokens),
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
        metric: String(metric),
        model_id: String(modelId),
        provider: String(provider),
        status: String(status),
        tokenizer: String(tokenizer),
        updated_at: String(updatedAt),
        version: String(version),
      } satisfies DatabaseRow;

      rows.set(`${row.model_id}:${row.version}`, row);

      return { rows: [{ ...row }], rowsAffected: 1 };
    }

    if (input.operation === "select") {
      if (input.params.length === 2 && input.params[0] !== "active") {
        const [modelId, version] = input.params;
        const row = rows.get(`${String(modelId)}:${String(version)}`);

        return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
      }

      const [status, provider] = input.params;
      const selected = [...rows.values()]
        .filter((row) => row.status === String(status))
        .filter((row) => provider === undefined || row.provider === String(provider))
        .sort(
          (left, right) =>
            String(left.model_id).localeCompare(String(right.model_id)) ||
            String(left.id).localeCompare(String(right.id)),
        );

      return { rows: selected, rowsAffected: selected.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor };
}
