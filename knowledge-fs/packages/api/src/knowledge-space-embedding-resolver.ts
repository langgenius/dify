import {
  type KnowledgeSpaceEmbeddingProfile as CoreKnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
} from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";

import {
  type KnowledgeSpaceManifestRepository,
  observeKnowledgeSpaceEmbeddingDimension,
} from "./knowledge-space-manifest-repository";

/**
 * Stable identity of a knowledge space's text-embedding vector space.
 *
 * `model` is the Dify-managed invocation model. `vectorSpaceId` is the immutable identity stored
 * on projections and used by retrieval. A runtime response must echo the configured model exactly;
 * accepting an unpersisted alias could silently change the vector semantics behind this identity.
 */
export type KnowledgeSpaceEmbeddingProfile = CoreKnowledgeSpaceEmbeddingProfile;

export interface ResolveKnowledgeSpaceEmbeddingInput {
  /** Frozen active profile captured with the publication head; skips a mutable manifest reread. */
  readonly profile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ResolvedKnowledgeSpaceEmbedding extends KnowledgeSpaceEmbeddingProfile {
  readonly providerInstance: EmbeddingProvider;
}

export interface KnowledgeSpaceEmbeddingResolver {
  observeDimension?(input: ObserveResolvedKnowledgeSpaceEmbeddingDimensionInput): Promise<void>;
  resolve(
    input: ResolveKnowledgeSpaceEmbeddingInput,
  ): Promise<ResolvedKnowledgeSpaceEmbedding | null>;
}

export interface ObserveResolvedKnowledgeSpaceEmbeddingDimensionInput
  extends ResolveKnowledgeSpaceEmbeddingInput {
  readonly dimension: number;
  readonly revision: number;
  readonly vectorSpaceId: string;
}

export type KnowledgeSpaceEmbeddingProviderFactory = (
  profile: KnowledgeSpaceEmbeddingProfile,
) => EmbeddingProvider;

export interface KnowledgeSpaceEmbeddingResolverOptions {
  /** Optional deployment profile used only by legacy manifests without an embedding profile. */
  readonly fallback?:
    | {
        readonly profile: KnowledgeSpaceEmbeddingProfile;
        readonly provider: EmbeddingProvider;
      }
    | undefined;
  readonly manifests: KnowledgeSpaceManifestRepository;
  /** Bounded LRU size for provider instances keyed by immutable embedding profiles. */
  readonly maxCachedProviders?: number | undefined;
  readonly now?: (() => string) | undefined;
  readonly providerFactory: KnowledgeSpaceEmbeddingProviderFactory;
}

export class KnowledgeSpaceEmbeddingProfileNotFoundError extends Error {
  constructor(knowledgeSpaceId: string) {
    super(`Embedding profile is not configured for knowledge space ${knowledgeSpaceId}`);
  }
}

export class KnowledgeSpaceEmbeddingProfileChangedError extends Error {
  constructor(vectorSpaceId: string) {
    super(`Embedding profile changed while using vector space ${vectorSpaceId}`);
  }
}

export class InvalidKnowledgeSpaceEmbeddingProfileError extends Error {}

/**
 * Resolves the active profile in tenant + knowledge-space scope and reuses provider instances only
 * for byte-for-byte identical profiles. Credentials are intentionally absent from the persisted
 * profile and remain provider-factory/runtime concerns.
 */
export function createKnowledgeSpaceEmbeddingResolver({
  fallback,
  manifests,
  maxCachedProviders = 256,
  now = () => new Date().toISOString(),
  providerFactory,
}: KnowledgeSpaceEmbeddingResolverOptions): KnowledgeSpaceEmbeddingResolver {
  if (!Number.isSafeInteger(maxCachedProviders) || maxCachedProviders < 1) {
    throw new Error("Knowledge space embedding resolver maxCachedProviders must be at least 1");
  }

  const providerCache = new Map<string, EmbeddingProvider>();
  const parsedFallback = fallback
    ? {
        profile: validateKnowledgeSpaceEmbeddingProfile(fallback.profile),
        provider: fallback.provider,
      }
    : undefined;

  return {
    observeDimension: async ({
      dimension,
      knowledgeSpaceId,
      revision,
      tenantId,
      vectorSpaceId,
    }) => {
      const normalizedKnowledgeSpaceId = requiredText(knowledgeSpaceId, "knowledgeSpaceId");
      const normalizedTenantId = requiredText(tenantId, "tenantId");
      const observed = await observeKnowledgeSpaceEmbeddingDimension(manifests, {
        dimension,
        expectedRevision: revision,
        expectedVectorSpaceId: vectorSpaceId,
        knowledgeSpaceId: normalizedKnowledgeSpaceId,
        now,
        tenantId: normalizedTenantId,
      });

      if (observed) {
        return;
      }

      // Legacy manifests intentionally keep using the raw historical model as vectorSpaceId until
      // an explicit rebuild publishes a canonical profile. There is no persisted profile to update.
      const current = await manifests.get({
        knowledgeSpaceId: normalizedKnowledgeSpaceId,
        tenantId: normalizedTenantId,
      });
      if (
        !current?.embeddingProfile &&
        parsedFallback?.profile.vectorSpaceId === vectorSpaceId &&
        parsedFallback.profile.revision === revision
      ) {
        assertObservedEmbeddingDimension({
          observedDimension: dimension,
          profile: parsedFallback.profile,
        });
        return;
      }

      throw new KnowledgeSpaceEmbeddingProfileChangedError(vectorSpaceId);
    },
    resolve: async ({ knowledgeSpaceId, profile: frozenProfile, tenantId }) => {
      const normalizedKnowledgeSpaceId = requiredText(knowledgeSpaceId, "knowledgeSpaceId");
      const normalizedTenantId = requiredText(tenantId, "tenantId");
      const manifest = frozenProfile
        ? undefined
        : await manifests.get({
            knowledgeSpaceId: normalizedKnowledgeSpaceId,
            tenantId: normalizedTenantId,
          });

      if (!manifest && !frozenProfile) {
        if (parsedFallback) {
          return {
            ...parsedFallback.profile,
            providerInstance: parsedFallback.provider,
          };
        }

        throw new KnowledgeSpaceEmbeddingProfileNotFoundError(normalizedKnowledgeSpaceId);
      }

      const rawProfile =
        frozenProfile ??
        (manifest as unknown as { readonly embeddingProfile?: unknown }).embeddingProfile;
      if (rawProfile === undefined) {
        return parsedFallback
          ? {
              ...parsedFallback.profile,
              providerInstance: parsedFallback.provider,
            }
          : null;
      }

      // Persisted profiles have already crossed a trust boundary, so require the core schema's
      // canonical SHA-256 vector-space id. The looser parser is reserved for the internal legacy
      // fallback whose historical projection key is the raw model name.
      const profile = KnowledgeSpaceEmbeddingProfileSchema.parse(rawProfile);
      const cacheKey = embeddingProviderCacheKey(profile);
      const cachedProvider = providerCache.get(cacheKey);
      const provider = cachedProvider ?? providerFactory(profile);

      // Map insertion order provides a dependency-free LRU. Eviction only drops reusable runtime
      // state; routing credentials remain daemon-side and are never part of this cache key.
      if (cachedProvider) {
        providerCache.delete(cacheKey);
      } else if (providerCache.size >= maxCachedProviders) {
        const leastRecentlyUsed = providerCache.keys().next().value;
        if (leastRecentlyUsed !== undefined) {
          providerCache.delete(leastRecentlyUsed);
        }
      }
      providerCache.set(cacheKey, provider);

      return { ...profile, providerInstance: provider };
    },
  };
}

export function validateKnowledgeSpaceEmbeddingProfile(
  profile: KnowledgeSpaceEmbeddingProfile,
): KnowledgeSpaceEmbeddingProfile {
  return parseKnowledgeSpaceEmbeddingProfile(profile);
}

export function assertObservedEmbeddingDimension({
  observedDimension,
  profile,
}: {
  readonly observedDimension: number;
  readonly profile: Pick<KnowledgeSpaceEmbeddingProfile, "dimension" | "vectorSpaceId">;
}): void {
  if (!Number.isSafeInteger(observedDimension) || observedDimension < 1) {
    throw new InvalidKnowledgeSpaceEmbeddingProfileError(
      `Embedding response for vector space ${profile.vectorSpaceId} has invalid dimension=${observedDimension}`,
    );
  }

  if (profile.dimension !== undefined && profile.dimension !== observedDimension) {
    throw new InvalidKnowledgeSpaceEmbeddingProfileError(
      `Embedding response for vector space ${profile.vectorSpaceId} has dimension=${observedDimension}; ` +
        `expected observed dimension=${profile.dimension}`,
    );
  }
}

export function assertEmbeddingModelMatchesProfile({
  observedModel,
  profile,
}: {
  readonly observedModel: string;
  readonly profile: Pick<KnowledgeSpaceEmbeddingProfile, "model" | "vectorSpaceId">;
}): void {
  const normalizedObservedModel = observedModel.trim();
  if (!normalizedObservedModel) {
    throw new InvalidKnowledgeSpaceEmbeddingProfileError(
      `Embedding response for vector space ${profile.vectorSpaceId} has an empty model`,
    );
  }

  if (normalizedObservedModel !== profile.model) {
    throw new InvalidKnowledgeSpaceEmbeddingProfileError(
      `Embedding response model ${normalizedObservedModel} does not match configured model ` +
        `${profile.model} for vector space ${profile.vectorSpaceId}`,
    );
  }
}

function parseKnowledgeSpaceEmbeddingProfile(value: unknown): KnowledgeSpaceEmbeddingProfile {
  if (!isRecord(value)) {
    throw new InvalidKnowledgeSpaceEmbeddingProfileError("Embedding profile must be an object");
  }

  const revisionValue = value.revision ?? value.version;
  const revision =
    typeof revisionValue === "number" && Number.isSafeInteger(revisionValue) && revisionValue > 0
      ? revisionValue
      : undefined;
  if (revision === undefined) {
    throw new InvalidKnowledgeSpaceEmbeddingProfileError(
      "Embedding profile revision must be a positive integer",
    );
  }

  const dimensionValue = value.dimension;
  const dimension =
    dimensionValue === undefined
      ? undefined
      : typeof dimensionValue === "number" &&
          Number.isSafeInteger(dimensionValue) &&
          dimensionValue > 0
        ? dimensionValue
        : null;
  if (dimension === null) {
    throw new InvalidKnowledgeSpaceEmbeddingProfileError(
      "Embedding profile dimension must be a positive integer when present",
    );
  }

  return {
    ...(dimension === undefined ? {} : { dimension }),
    model: requiredProfileText(value.model, "model"),
    pluginId: requiredProfileText(value.pluginId, "pluginId"),
    provider: requiredProfileText(value.provider, "provider"),
    revision,
    vectorSpaceId: requiredProfileText(value.vectorSpaceId, "vectorSpaceId"),
  };
}

function requiredProfileText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidKnowledgeSpaceEmbeddingProfileError(`Embedding profile ${name} is required`);
  }

  return value.trim();
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Knowledge space embedding resolver ${name} is required`);
  }

  return normalized;
}

function embeddingProviderCacheKey(profile: KnowledgeSpaceEmbeddingProfile): string {
  return JSON.stringify([
    profile.pluginId,
    profile.provider,
    profile.model,
    profile.vectorSpaceId,
    profile.revision,
  ]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
