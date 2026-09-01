import type { EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import { createResearchQueryVectorizer } from "./research-query-vectorizer";

const embeddingProfile = {
  dimension: 2,
  model: "embedding-model",
  pluginId: "plugin/embedding",
  provider: "embedding",
  revision: 3,
  vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
};

describe("Research query vectorizer", () => {
  it("batches rewrites through the frozen knowledge-space embedding identity", async () => {
    const embed = vi.fn(async () => ({
      dense: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      metadata: { dimension: 2, model: embeddingProfile.model, provider: "static" as const },
      model: embeddingProfile.model,
    }));
    const resolve = vi.fn(async () => ({
      ...embeddingProfile,
      providerInstance: { embed, kind: "static" as const, models: vi.fn() },
    }));
    const vectorizer = createResearchQueryVectorizer({ resolve });

    await expect(
      vectorizer.vectorize({
        embeddingProfile,
        knowledgeSpaceId: "space-1",
        queries: ["query one", "query two"],
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(resolve).toHaveBeenCalledWith({
      knowledgeSpaceId: "space-1",
      profile: embeddingProfile,
      tenantId: "tenant-1",
    });
    expect(embed).toHaveBeenCalledWith({
      inputType: "search_query",
      model: embeddingProfile.model,
      tenantId: "tenant-1",
      texts: ["query one", "query two"],
    });
  });

  it("returns immediately for an empty rewrite set", async () => {
    const resolve = vi.fn();
    const vectorizer = createResearchQueryVectorizer({ resolve });

    await expect(
      vectorizer.vectorize({
        embeddingProfile,
        knowledgeSpaceId: "space-1",
        queries: [],
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("forwards cancellation and stops awaiting an embedding provider that ignores it", async () => {
    const controller = new AbortController();
    const cancellation = new Error("retrieval lease lost");
    const embed = vi.fn(
      async (_input: Parameters<EmbeddingProvider["embed"]>[0]) =>
        new Promise<never>(() => undefined),
    );
    const vectorizer = createResearchQueryVectorizer({
      resolve: async () => ({
        ...embeddingProfile,
        providerInstance: { embed, kind: "static" as const, models: vi.fn() },
      }),
    });
    const pending = vectorizer.vectorize({
      embeddingProfile,
      knowledgeSpaceId: "space-1",
      queries: ["query one"],
      signal: controller.signal,
      tenantId: "tenant-1",
    });
    await vi.waitFor(() => expect(embed).toHaveBeenCalledOnce());
    expect(embed.mock.calls[0]?.[0].signal).toBe(controller.signal);

    controller.abort(cancellation);

    await expect(pending).rejects.toBe(cancellation);
  });

  it.each([
    {
      label: "cannot resolve the frozen profile",
      resolver: async () => null,
      message: "could not be resolved",
    },
    {
      label: "changes the frozen vector space",
      resolver: async () => ({
        ...embeddingProfile,
        providerInstance: embeddingProvider([[0.1, 0.2]]),
        vectorSpaceId: "another-vector-space",
      }),
      message: "changed the frozen vector space",
    },
    {
      label: "returns the wrong vector count",
      resolver: async () => ({
        ...embeddingProfile,
        providerInstance: embeddingProvider([]),
      }),
      message: "returned 0 vectors for 1 queries",
    },
    {
      label: "returns a non-finite vector",
      resolver: async () => ({
        ...embeddingProfile,
        providerInstance: embeddingProvider([[Number.NaN, 0.2]]),
      }),
      message: "not a non-empty finite vector",
    },
  ])("fails closed when the embedding provider $label", async ({ message, resolver }) => {
    const vectorizer = createResearchQueryVectorizer({ resolve: resolver });

    await expect(
      vectorizer.vectorize({
        embeddingProfile,
        knowledgeSpaceId: "space-1",
        queries: ["query one"],
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow(message);
  });
});

function embeddingProvider(dense: number[][]) {
  return {
    embed: async () => ({
      dense,
      metadata: { dimension: 2, model: embeddingProfile.model, provider: "static" as const },
      model: embeddingProfile.model,
    }),
    kind: "static" as const,
    models: async () => [],
  };
}
