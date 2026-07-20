import type { KnowledgeSpaceModelSelection } from "@knowledge/core";
import type { EmbeddingProvider, RerankerProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import {
  type ModelCapabilityCatalog,
  ModelCapabilityPreflightError,
  type ModelCatalogEntry,
  type ReasoningModelPreflightProvider,
  createModelCapabilityPreflight,
} from "./model-capability-preflight";

const selection: KnowledgeSpaceModelSelection = {
  model: "tenant-embedding",
  pluginId: "langgenius/openai:1.2.3@install-42",
  provider: "openai",
};

describe("createModelCapabilityPreflight", () => {
  it.each([384, 1536, 3072])(
    "observes the embedding model's actual %i dimension without a fixed-size assumption",
    async (dimension) => {
      const embed = vi.fn(async () => ({
        dense: [Array.from({ length: dimension }, (_, index) => index / dimension)],
        metadata: { dimension, model: selection.model, provider: "plugin-daemon" as const },
        model: selection.model,
      }));
      const preflight = createModelCapabilityPreflight({
        catalog: catalog(entry("embedding")),
        embeddingProviderFactory: () => embeddingProvider(embed, dimension),
        now: () => "2026-07-14T12:00:00.000Z",
        reasoningProviderFactory: () => reasoningProvider(),
        rerankerProviderFactory: () => rerankerProvider(),
      });

      const snapshot = await preflight.verify({
        kind: "embedding",
        selection,
        tenantId: "tenant-1",
      });

      expect(snapshot).toMatchObject({
        checkedAt: "2026-07-14T12:00:00.000Z",
        dimension,
        distanceMetric: "cosine",
        kind: "embedding",
        pluginUniqueIdentifier: "langgenius/openai:1.2.3@sha256:install-42",
        pluginVersion: "1.2.3",
        schemaFingerprint: `sha256:${"a".repeat(64)}`,
        selection,
      });
      expect(snapshot.capabilityDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(embed).toHaveBeenCalledWith({
        inputType: "search_query",
        model: selection.model,
        signal: expect.any(AbortSignal),
        tenantId: "tenant-1",
        texts: ["knowledge-fs model capability preflight"],
      });
    },
  );

  it.each([
    { acceptedDimension: 4096, dialect: "postgres" as const, rejectedDimension: 16_001 },
    { acceptedDimension: 16_000, dialect: "tidb" as const, rejectedDimension: 16_384 },
  ])(
    "accepts exact fallback dimensions but rejects vectors beyond $dialect storage capacity",
    async ({ acceptedDimension, dialect, rejectedDimension }) => {
      const createPreflight = (dimension: number) =>
        createModelCapabilityPreflight({
          catalog: catalog(entry("embedding")),
          embeddingProviderFactory: () =>
            embeddingProvider(
              async (input) => ({
                dense: [Array.from({ length: dimension }, () => 0)],
                metadata: {
                  dimension,
                  model: input.model,
                  provider: "plugin-daemon" as const,
                },
                model: input.model,
              }),
              dimension,
            ),
          reasoningProviderFactory: () => reasoningProvider(),
          rerankerProviderFactory: () => rerankerProvider(),
          vectorStorageDialect: dialect,
        });

      await expect(
        createPreflight(acceptedDimension).verify({
          kind: "embedding",
          selection,
          tenantId: "tenant-1",
        }),
      ).resolves.toMatchObject({ dimension: acceptedDimension });
      await expect(
        createPreflight(rejectedDimension).verify({
          kind: "embedding",
          selection,
          tenantId: "tenant-1",
        }),
      ).rejects.toMatchObject({
        code: "EMBEDDING_DIMENSION_UNSUPPORTED",
        retryable: false,
      });
    },
  );

  it("keeps the semantic capability digest stable across observation timestamps", async () => {
    let checkedAt = "2026-07-14T12:00:00.000Z";
    const preflight = createModelCapabilityPreflight({
      catalog: catalog(entry("embedding")),
      embeddingProviderFactory: () =>
        embeddingProvider(
          async (input) => ({
            dense: [[0, 1, 2, 3]],
            metadata: { dimension: 4, model: input.model, provider: "plugin-daemon" },
            model: input.model,
          }),
          4,
        ),
      now: () => checkedAt,
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    const first = await preflight.verify({
      kind: "embedding",
      selection,
      tenantId: "tenant-1",
    });
    checkedAt = "2026-07-14T13:00:00.000Z";
    const second = await preflight.verify({
      kind: "embedding",
      selection,
      tenantId: "tenant-1",
    });

    expect(first.checkedAt).not.toBe(second.checkedAt);
    expect(first.capabilityDigest).toBe(second.capabilityDigest);
  });

  it("rejects an uninstalled selection before constructing or invoking a provider", async () => {
    const embeddingProviderFactory = vi.fn(() => embeddingProvider());
    const preflight = createModelCapabilityPreflight({
      catalog: catalog(null),
      embeddingProviderFactory,
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });

    await expect(
      preflight.verify({ kind: "embedding", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "MODEL_SELECTION_NOT_FOUND", retryable: false });
    expect(embeddingProviderFactory).not.toHaveBeenCalled();
  });

  it("rejects catalog identity and capability mismatches", async () => {
    const identityMismatch = createModelCapabilityPreflight({
      catalog: catalog({ ...entry("embedding"), model: "other" }),
      embeddingProviderFactory: () => embeddingProvider(),
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    await expect(
      identityMismatch.verify({ kind: "embedding", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "MODEL_IDENTITY_MISMATCH" });

    const kindMismatch = createModelCapabilityPreflight({
      catalog: catalog(entry("reasoning")),
      embeddingProviderFactory: () => embeddingProvider(),
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    await expect(
      kindMismatch.verify({ kind: "embedding", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_MISMATCH" });
  });

  it("requires daemon credential validation when the catalog exposes it", async () => {
    const embeddingProviderFactory = vi.fn(() => embeddingProvider());
    const preflight = createModelCapabilityPreflight({
      catalog: {
        ...catalog(entry("embedding")),
        validate: async () => false,
      },
      embeddingProviderFactory,
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });

    await expect(
      preflight.verify({ kind: "embedding", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({
      code: "MODEL_PREFLIGHT_FAILED",
      message: "The selected model's credentials are not valid",
      retryable: false,
    });
    expect(embeddingProviderFactory).not.toHaveBeenCalled();
  });

  it("rejects inconsistent embedding dimensions and model aliases", async () => {
    const dimensionMismatch = createModelCapabilityPreflight({
      catalog: catalog(entry("embedding")),
      embeddingProviderFactory: () =>
        embeddingProvider(
          async () => ({
            dense: [[0, 1, 2]],
            metadata: { dimension: 2, model: selection.model, provider: "plugin-daemon" },
            model: selection.model,
          }),
          3,
        ),
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    await expect(
      dimensionMismatch.verify({ kind: "embedding", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_INVALID" });

    const identityMismatch = createModelCapabilityPreflight({
      catalog: catalog(entry("embedding")),
      embeddingProviderFactory: () =>
        embeddingProvider(async () => ({
          dense: [[0, 1]],
          metadata: { dimension: 2, model: "alias", provider: "plugin-daemon" },
          model: "alias",
        })),
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    await expect(
      identityMismatch.verify({ kind: "embedding", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "MODEL_IDENTITY_MISMATCH" });
  });

  it("runs bounded rerank and reasoning probes with strict response identity", async () => {
    const rerank = vi.fn(rerankerProvider().rerank);
    const generate = vi.fn(reasoningProvider().generate);
    const shared = {
      embeddingProviderFactory: () => embeddingProvider(),
      reasoningProviderFactory: () => ({ ...reasoningProvider(), generate }),
      rerankerProviderFactory: () => ({ ...rerankerProvider(), rerank }),
    };
    const rerankPreflight = createModelCapabilityPreflight({
      catalog: catalog(entry("rerank")),
      ...shared,
    });
    const reasoningPreflight = createModelCapabilityPreflight({
      catalog: catalog(entry("reasoning")),
      ...shared,
    });

    const rerankSnapshot = await rerankPreflight.verify({
      kind: "rerank",
      selection,
      tenantId: "tenant-1",
    });
    const reasoningSnapshot = await reasoningPreflight.verify({
      kind: "reasoning",
      selection,
      tenantId: "tenant-1",
    });
    expect(rerankSnapshot).toMatchObject({ kind: "rerank" });
    expect(reasoningSnapshot).toMatchObject({ kind: "reasoning" });
    expect(rerankSnapshot).not.toHaveProperty("dimension");
    expect(reasoningSnapshot).not.toHaveProperty("dimension");
    expect(rerank).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: selection.model, tenantId: "tenant-1" }),
    );
  });

  it.each(["catalog", "credential-validation", "probe"] as const)(
    "enforces a hard deadline when the %s dependency ignores AbortSignal",
    async (stage) => {
      vi.useFakeTimers();
      try {
        let ignoredSignal: AbortSignal | undefined;
        const never = new Promise<never>(() => undefined);
        const capabilityCatalog: ModelCapabilityCatalog = {
          list: async () => ({ items: [] }),
          resolve: async (input) => {
            if (stage === "catalog") {
              ignoredSignal = input.signal;
              return never;
            }
            return entry("embedding");
          },
          validate: async (input) => {
            if (stage === "credential-validation") {
              ignoredSignal = input.signal;
              return never;
            }
            return true;
          },
        };
        const preflight = createModelCapabilityPreflight({
          catalog: capabilityCatalog,
          embeddingProviderFactory: () =>
            stage === "probe"
              ? embeddingProvider(async (input) => {
                  ignoredSignal = input.signal;
                  return never;
                })
              : embeddingProvider(),
          reasoningProviderFactory: () => reasoningProvider(),
          rerankerProviderFactory: () => rerankerProvider(),
          timeoutMs: 25,
        });

        const verification = preflight.verify({
          kind: "embedding",
          selection,
          tenantId: "tenant-1",
        });
        const rejection = expect(verification).rejects.toMatchObject({
          code: "MODEL_PREFLIGHT_FAILED",
          message: "The selected model capability preflight timed out",
          retryable: true,
        });
        await vi.advanceTimersByTimeAsync(25);
        await rejection;
        expect(ignoredSignal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("rejects empty reasoning output and an unverified observed identity", async () => {
    const emptyOutput = createModelCapabilityPreflight({
      catalog: catalog(entry("reasoning")),
      embeddingProviderFactory: () => embeddingProvider(),
      reasoningProviderFactory: () =>
        reasoningProvider(async (input) => ({
          metadata: { model: input.model },
          model: input.model,
          text: "  ",
        })),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    await expect(
      emptyOutput.verify({ kind: "reasoning", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_MISMATCH" });

    const identityMismatch = createModelCapabilityPreflight({
      catalog: catalog(entry("reasoning")),
      embeddingProviderFactory: () => embeddingProvider(),
      reasoningProviderFactory: () =>
        reasoningProvider(async (input) => ({
          metadata: { model: "unverified-alias" },
          model: input.model,
          text: "OK",
        })),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    await expect(
      identityMismatch.verify({ kind: "reasoning", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "MODEL_IDENTITY_MISMATCH" });
  });

  it("rejects rerank results that forge input documents or duplicate result identity", async () => {
    const forgedDocument = createModelCapabilityPreflight({
      catalog: catalog(entry("rerank")),
      embeddingProviderFactory: () => embeddingProvider(),
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () =>
        rerankerProvider(async (input) => ({
          items: [
            {
              document: { id: "forged", metadata: {}, text: input.documents[0]?.text ?? "" },
              index: 0,
              score: 0.9,
            },
          ],
          metadata: { model: input.model, provider: "plugin-daemon" },
          model: input.model,
        })),
    });
    await expect(
      forgedDocument.verify({ kind: "rerank", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_MISMATCH" });

    const duplicateResult = createModelCapabilityPreflight({
      catalog: catalog(entry("rerank")),
      embeddingProviderFactory: () => embeddingProvider(),
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () =>
        rerankerProvider(async (input) => {
          const document = input.documents[0] ?? { id: "missing", text: "missing" };
          return {
            items: [
              { document: { ...document, metadata: {} }, index: 0, score: 0.9 },
              { document: { ...document, metadata: {} }, index: 0, score: 0.8 },
            ],
            metadata: { model: input.model, provider: "plugin-daemon" },
            model: input.model,
          };
        }),
    });
    await expect(
      duplicateResult.verify({ kind: "rerank", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_MISMATCH" });
  });

  it("collapses provider and catalog failures to stable non-secret errors", async () => {
    const catalogFailure = createModelCapabilityPreflight({
      catalog: {
        list: async () => Promise.reject(new Error("secret catalog token")),
        resolve: async () => Promise.reject(new Error("secret catalog token")),
      },
      embeddingProviderFactory: () => embeddingProvider(),
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    await expect(
      catalogFailure.verify({ kind: "embedding", selection, tenantId: "tenant-1" }),
    ).rejects.toMatchObject({
      code: "MODEL_PREFLIGHT_FAILED",
      message: "Model capability catalog is temporarily unavailable",
      retryable: true,
    });

    const providerFailure = createModelCapabilityPreflight({
      catalog: catalog(entry("embedding")),
      embeddingProviderFactory: () =>
        embeddingProvider(async () => Promise.reject(new Error("secret provider credential"))),
      reasoningProviderFactory: () => reasoningProvider(),
      rerankerProviderFactory: () => rerankerProvider(),
    });
    let error: unknown;
    try {
      await providerFailure.verify({ kind: "embedding", selection, tenantId: "tenant-1" });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ModelCapabilityPreflightError);
    expect(error).toMatchObject({
      code: "MODEL_PREFLIGHT_FAILED",
      message: "The selected model failed its capability preflight",
      retryable: true,
    });
    expect((error as Error).message).not.toContain("credential");
  });
});

function entry(kind: "embedding" | "reasoning" | "rerank"): ModelCatalogEntry {
  return {
    capabilities: { declared: true },
    kinds: [kind],
    model: selection.model,
    pluginId: selection.pluginId,
    pluginUniqueIdentifier: "langgenius/openai:1.2.3@sha256:install-42",
    pluginVersion: "1.2.3",
    provider: selection.provider,
    schemaFingerprint: `sha256:${"a".repeat(64)}`,
  };
}

function catalog(result: ModelCatalogEntry | null): ModelCapabilityCatalog {
  return {
    list: async () => ({ items: result ? [result] : [] }),
    resolve: async () => result,
  };
}

function embeddingProvider(
  embed: EmbeddingProvider["embed"] = async (input) => ({
    dense: [[0, 1]],
    metadata: { dimension: 2, model: input.model, provider: "plugin-daemon" },
    model: input.model,
  }),
  dimension = 2,
): EmbeddingProvider {
  return {
    embed,
    kind: "plugin-daemon",
    models: async () => [
      {
        dimension,
        distanceMetric: "cosine",
        id: selection.model,
        maxInputTokens: 8_192,
        provider: "plugin-daemon",
        recommendedBatchSize: 16,
        supportsDense: true,
        supportsMultiVector: false,
        supportsSparse: false,
        tokenizerVersion: "daemon",
        version: "1",
      },
    ],
  };
}

function rerankerProvider(
  rerank: RerankerProvider["rerank"] = async (input) => ({
    items: [
      {
        document: {
          id: input.documents[0]?.id ?? "missing",
          metadata: {},
          text: "knowledge retrieval",
        },
        index: 0,
        score: 0.9,
      },
    ],
    metadata: { model: input.model, provider: "plugin-daemon" },
    model: input.model,
  }),
): RerankerProvider {
  return {
    kind: "plugin-daemon",
    models: async () => [],
    rerank,
  };
}

function reasoningProvider(
  generate: ReasoningModelPreflightProvider["generate"] = async (input) => ({
    metadata: { model: input.model },
    model: input.model,
    text: "OK",
  }),
): ReasoningModelPreflightProvider {
  return {
    generate,
  };
}
