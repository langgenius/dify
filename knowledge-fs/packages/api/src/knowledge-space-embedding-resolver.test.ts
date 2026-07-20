import {
  type KnowledgeSpaceEmbeddingProfile,
  createDefaultKnowledgeSpaceManifest,
  createKnowledgeSpaceEmbeddingProfile,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeSpaceEmbeddingProfileChangedError,
  KnowledgeSpaceEmbeddingProfileNotFoundError,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
  createKnowledgeSpaceEmbeddingResolver,
} from "./knowledge-space-embedding-resolver";
import { createInMemoryKnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";

const provider = {
  embed: vi.fn(),
  kind: "plugin-daemon" as const,
  models: vi.fn(),
};
const CANONICAL_VECTOR_SPACE_ID = `embedding-space-sha256:${"a".repeat(64)}`;

describe("createKnowledgeSpaceEmbeddingResolver", () => {
  it("resolves a tenant-scoped persisted profile and caches only the matching provider", async () => {
    const get = vi.fn(async () => ({
      embeddingProfile: {
        model: "embed-large",
        pluginId: "acme/embed",
        provider: "acme",
        revision: 2,
        vectorSpaceId: CANONICAL_VECTOR_SPACE_ID,
      },
    }));
    const providerFactory = vi.fn(() => provider);
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      manifests: { get } as never,
      providerFactory,
    });

    await expect(
      resolver.resolve({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" }),
    ).resolves.toEqual({
      model: "embed-large",
      pluginId: "acme/embed",
      provider: "acme",
      providerInstance: provider,
      revision: 2,
      vectorSpaceId: CANONICAL_VECTOR_SPACE_ID,
    });
    await resolver.resolve({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" });

    expect(get).toHaveBeenCalledWith({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" });
    expect(providerFactory).toHaveBeenCalledTimes(1);
  });

  it("bounds provider instances with an LRU cache", async () => {
    const profiles = new Map<string, KnowledgeSpaceEmbeddingProfile>(
      await Promise.all(
        ["a", "b", "c"].map(
          async (suffix) =>
            [
              `space-${suffix}`,
              await createKnowledgeSpaceEmbeddingProfile({
                model: `embed-${suffix}`,
                pluginId: "acme/embed",
                provider: "acme",
              }),
            ] as const,
        ),
      ),
    );
    const providerFactory = vi.fn(() => ({ ...provider }));
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      manifests: {
        get: async ({ knowledgeSpaceId }: { readonly knowledgeSpaceId: string }) => ({
          embeddingProfile: profiles.get(knowledgeSpaceId),
        }),
      } as never,
      maxCachedProviders: 2,
      providerFactory,
    });

    await resolver.resolve({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" });
    await resolver.resolve({ knowledgeSpaceId: "space-b", tenantId: "tenant-a" });
    await resolver.resolve({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" });
    await resolver.resolve({ knowledgeSpaceId: "space-c", tenantId: "tenant-a" });
    await resolver.resolve({ knowledgeSpaceId: "space-b", tenantId: "tenant-a" });

    expect(providerFactory).toHaveBeenCalledTimes(4);
    expect(() =>
      createKnowledgeSpaceEmbeddingResolver({
        manifests: { get: async () => null } as never,
        maxCachedProviders: 0,
        providerFactory,
      }),
    ).toThrow("maxCachedProviders must be at least 1");
  });

  it("uses a query-frozen profile without rereading the mutable manifest", async () => {
    const get = vi.fn(async () => {
      throw new Error("mutable manifest must not be read");
    });
    const frozen = await createKnowledgeSpaceEmbeddingProfile(
      { model: "embed-frozen", pluginId: "acme/embed", provider: "acme" },
      3,
    );
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      manifests: { get } as never,
      providerFactory: () => provider,
    });

    await expect(
      resolver.resolve({
        knowledgeSpaceId: "space-a",
        profile: frozen,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ ...frozen, providerInstance: provider });
    expect(get).not.toHaveBeenCalled();
  });

  it("uses the explicit deployment fallback only for legacy manifests", async () => {
    const fallbackProfile = {
      model: "legacy-model",
      pluginId: "legacy/plugin",
      provider: "legacy-provider",
      revision: 1,
      vectorSpaceId: "legacy-vector-space",
    };
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      fallback: { profile: fallbackProfile, provider },
      manifests: { get: async () => ({}) } as never,
      providerFactory: vi.fn(),
    });

    await expect(
      resolver.resolve({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" }),
    ).resolves.toEqual({ ...fallbackProfile, providerInstance: provider });
  });

  it("keeps a legacy fallback usable when the manifest has not been bootstrapped", async () => {
    const fallbackProfile = {
      model: "legacy-model",
      pluginId: "legacy/plugin",
      provider: "legacy-provider",
      revision: 1,
      vectorSpaceId: "legacy-model",
    };
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      fallback: { profile: fallbackProfile, provider },
      manifests: { get: async () => null } as never,
      providerFactory: vi.fn(),
    });

    await expect(
      resolver.resolve({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" }),
    ).resolves.toMatchObject({ ...fallbackProfile, providerInstance: provider });
    await expect(
      resolver.observeDimension?.({
        dimension: 1536,
        knowledgeSpaceId: "space-a",
        revision: 1,
        tenantId: "tenant-a",
        vectorSpaceId: "legacy-model",
      }),
    ).resolves.toBeUndefined();
  });

  it("fails closed when the scoped manifest does not exist", async () => {
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      manifests: { get: async () => null } as never,
      providerFactory: vi.fn(),
    });

    await expect(
      resolver.resolve({ knowledgeSpaceId: "missing", tenantId: "tenant-a" }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceEmbeddingProfileNotFoundError);
  });

  it("rejects non-canonical persisted profiles", async () => {
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      manifests: {
        get: async () => ({
          embeddingProfile: {
            model: "model",
            pluginId: "plugin",
            provider: "provider",
            vectorSpaceId: "space",
            version: 3,
          },
        }),
      } as never,
      providerFactory: () => provider,
    });

    await expect(
      resolver.resolve({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" }),
    ).rejects.toThrow();

    const invalid = createKnowledgeSpaceEmbeddingResolver({
      manifests: { get: async () => ({ embeddingProfile: { revision: 1 } }) } as never,
      providerFactory: () => provider,
    });
    await expect(
      invalid.resolve({ knowledgeSpaceId: "space-a", tenantId: "tenant-a" }),
    ).rejects.toThrow();
  });

  it("persists the first daemon-observed dimension with vector-space CAS", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profile = await createKnowledgeSpaceEmbeddingProfile({
      model: "embed-large",
      pluginId: "acme/embed",
      provider: "acme",
    });
    await manifests.create(
      createDefaultKnowledgeSpaceManifest({
        createdAt: "2026-07-13T00:00:00.000Z",
        embeddingProfile: profile,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c01",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c02",
        tenantId: "tenant-a",
        updatedAt: "2026-07-13T00:00:00.000Z",
      }),
    );
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      manifests,
      now: () => "2026-07-13T00:00:01.000Z",
      providerFactory: () => provider,
    });

    await resolver.observeDimension?.({
      dimension: 3072,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c02",
      revision: profile.revision,
      tenantId: "tenant-a",
      vectorSpaceId: profile.vectorSpaceId,
    });

    await expect(
      manifests.get({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c02",
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({
      embeddingProfile: { dimension: 3072, vectorSpaceId: profile.vectorSpaceId },
      manifestVersion: 2,
    });
  });

  it("fails closed when a response tries to observe a superseded profile", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profile = await createKnowledgeSpaceEmbeddingProfile({
      model: "embed-v2",
      pluginId: "acme/embed",
      provider: "acme",
    });
    await manifests.create(
      createDefaultKnowledgeSpaceManifest({
        createdAt: "2026-07-13T00:00:00.000Z",
        embeddingProfile: profile,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c03",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c04",
        tenantId: "tenant-a",
        updatedAt: "2026-07-13T00:00:00.000Z",
      }),
    );
    const resolver = createKnowledgeSpaceEmbeddingResolver({
      manifests,
      providerFactory: () => provider,
    });

    await expect(
      resolver.observeDimension?.({
        dimension: 1536,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c04",
        revision: profile.revision - 1,
        tenantId: "tenant-a",
        vectorSpaceId: "legacy-space",
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceEmbeddingProfileChangedError);
  });
});

describe("assertObservedEmbeddingDimension", () => {
  it("uses the response dimension as authoritative and checks a persisted observation", () => {
    expect(() =>
      assertObservedEmbeddingDimension({
        observedDimension: 3072,
        profile: { vectorSpaceId: "vs" },
      }),
    ).not.toThrow();
    expect(() =>
      assertObservedEmbeddingDimension({
        observedDimension: 768,
        profile: { dimension: 3072, vectorSpaceId: "vs" },
      }),
    ).toThrow(/expected observed dimension=3072/);
  });
});

describe("assertEmbeddingModelMatchesProfile", () => {
  it("fails closed when the daemon returns a different model for the configured vector space", () => {
    expect(() =>
      assertEmbeddingModelMatchesProfile({
        observedModel: "embed-v2",
        profile: { model: "embed-v1", vectorSpaceId: "vs" },
      }),
    ).toThrow(/does not match configured model/);
  });
});
