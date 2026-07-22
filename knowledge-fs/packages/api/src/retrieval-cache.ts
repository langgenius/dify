import { createHash } from "node:crypto";

import type { CacheAdapter, EvidenceBundle } from "@knowledge/core";
import { EvidenceBundleSchema } from "@knowledge/core";

import {
  cacheNamespaceSegment,
  knowledgeSpaceCacheNamespace,
} from "./knowledge-space-cache-namespace";
import type { RetrievalMetadataFilters } from "./retrieval-candidates";
import { normalizeRetrievalMetadataFilters } from "./retrieval-filter-utils";
import {
  type RetrievalQueryLanguage,
  detectRetrievalQueryLanguage,
  normalizeMixedLanguageFtsText,
} from "./retrieval-text-utils";

export interface QueryNormalizationCacheOptions {
  readonly cache: CacheAdapter;
  readonly maxQueryBytes?: number | undefined;
  readonly strategyVersion?: string | undefined;
  readonly ttlMs?: number | undefined;
}

export interface EvidenceBundleCacheOptions {
  readonly cache: CacheAdapter;
  readonly maxQueryBytes?: number | undefined;
  readonly strategyVersion: string;
  readonly ttlMs: number;
}

export interface EvidenceBundleCacheKeyInput {
  readonly filters?: RetrievalMetadataFilters | undefined;
  readonly indexProjectionFingerprint: string;
  readonly knowledgeSpaceId: string;
  readonly permissionSnapshot: readonly string[];
  readonly query: string;
  readonly retrievalStrategy: string;
  readonly snapshotFingerprint: string;
}

export interface EvidenceBundleCache {
  get(input: EvidenceBundleCacheKeyInput): Promise<EvidenceBundle | null>;
  set(input: EvidenceBundleCacheKeyInput, bundle: EvidenceBundle): Promise<void>;
}

export interface NormalizeQueryInput {
  readonly query: string;
}

export interface NormalizedQueryResult {
  readonly cacheHit: boolean;
  readonly normalizedQuery: string;
  readonly queryLanguage: RetrievalQueryLanguage;
  readonly strategyVersion: string;
}

export interface QueryNormalizationCache {
  normalize(input: NormalizeQueryInput): Promise<NormalizedQueryResult>;
}

export function createQueryNormalizationCache({
  cache,
  maxQueryBytes = 16 * 1024,
  strategyVersion = "mixed-cjk-latin-v1",
  ttlMs = 5 * 60 * 1000,
}: QueryNormalizationCacheOptions): QueryNormalizationCache {
  if (!Number.isSafeInteger(maxQueryBytes) || maxQueryBytes < 1) {
    throw new Error("Query normalization maxQueryBytes must be at least 1");
  }

  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error("Query normalization ttlMs must be at least 1");
  }

  if (!strategyVersion.trim()) {
    throw new Error("Query normalization strategyVersion is required");
  }

  return {
    async normalize(input) {
      const query = input.query.trim();

      if (!query) {
        throw new Error("Query normalization query is required");
      }

      if (new TextEncoder().encode(query).byteLength > maxQueryBytes) {
        throw new Error(`Query normalization query exceeds maxQueryBytes=${maxQueryBytes}`);
      }

      const normalizedQuery = normalizeMixedLanguageFtsText(query);
      const queryLanguage = detectRetrievalQueryLanguage(query);
      const key = queryNormalizationCacheKey({
        normalizedQuery,
        queryLanguage,
        strategyVersion,
      });
      const cached = await cache.get(key);

      if (cached) {
        return {
          ...decodeNormalizedQueryResult(cached),
          cacheHit: true,
        };
      }

      const result: NormalizedQueryResult = {
        cacheHit: false,
        normalizedQuery,
        queryLanguage,
        strategyVersion,
      };
      await cache.set(key, encodeNormalizedQueryResult(result), { ttlMs });

      return { ...result };
    },
  };
}

export function createEvidenceBundleCache({
  cache,
  maxQueryBytes = 16 * 1024,
  strategyVersion,
  ttlMs,
}: EvidenceBundleCacheOptions): EvidenceBundleCache {
  if (!Number.isSafeInteger(maxQueryBytes) || maxQueryBytes < 1) {
    throw new Error("EvidenceBundle cache maxQueryBytes must be at least 1");
  }

  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error("EvidenceBundle cache ttlMs must be at least 1");
  }

  if (!strategyVersion.trim()) {
    throw new Error("EvidenceBundle cache strategyVersion is required");
  }

  return {
    async get(input) {
      const key = evidenceBundleCacheKey(validateEvidenceBundleCacheKeyInput(input), {
        maxQueryBytes,
        strategyVersion,
      });
      const cached = await cache.get(key);

      if (!cached) {
        return null;
      }

      try {
        return cloneEvidenceBundle(
          EvidenceBundleSchema.parse(JSON.parse(new TextDecoder().decode(cached))),
        );
      } catch {
        return null;
      }
    },
    async set(input, bundle) {
      const key = evidenceBundleCacheKey(validateEvidenceBundleCacheKeyInput(input), {
        maxQueryBytes,
        strategyVersion,
      });
      await cache.set(key, encodeEvidenceBundle(EvidenceBundleSchema.parse(bundle)), { ttlMs });
    },
  };
}

function queryNormalizationCacheKey({
  normalizedQuery,
  queryLanguage,
  strategyVersion,
}: {
  readonly normalizedQuery: string;
  readonly queryLanguage: RetrievalQueryLanguage;
  readonly strategyVersion: string;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ normalizedQuery, queryLanguage, strategyVersion }))
    .digest("hex");

  return `query-normalization:${strategyVersion}:${digest}`;
}

function validateEvidenceBundleCacheKeyInput(
  input: EvidenceBundleCacheKeyInput,
): EvidenceBundleCacheKeyInput {
  const query = input.query.trim();
  const retrievalStrategy = input.retrievalStrategy.trim();
  const indexProjectionFingerprint = input.indexProjectionFingerprint.trim();
  const knowledgeSpaceId = input.knowledgeSpaceId.trim();
  const snapshotFingerprint = input.snapshotFingerprint.trim();

  if (!query) {
    throw new Error("EvidenceBundle cache query is required");
  }

  if (!retrievalStrategy) {
    throw new Error("EvidenceBundle cache retrievalStrategy is required");
  }

  if (!indexProjectionFingerprint) {
    throw new Error("EvidenceBundle cache indexProjectionFingerprint is required");
  }

  if (!knowledgeSpaceId) {
    throw new Error("EvidenceBundle cache knowledgeSpaceId is required");
  }

  if (!snapshotFingerprint) {
    throw new Error("EvidenceBundle cache snapshotFingerprint is required");
  }

  return {
    ...(input.filters === undefined
      ? {}
      : { filters: normalizeRetrievalMetadataFilters(input.filters) }),
    indexProjectionFingerprint,
    knowledgeSpaceId,
    permissionSnapshot: uniqueStrings(input.permissionSnapshot.map((scope) => scope.trim())).sort(),
    query,
    retrievalStrategy,
    snapshotFingerprint,
  };
}

function evidenceBundleCacheKey(
  input: EvidenceBundleCacheKeyInput,
  options: {
    readonly maxQueryBytes: number;
    readonly strategyVersion: string;
  },
): string {
  if (new TextEncoder().encode(input.query).byteLength > options.maxQueryBytes) {
    throw new Error(`EvidenceBundle cache query exceeds maxQueryBytes=${options.maxQueryBytes}`);
  }

  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        filters: input.filters ?? {},
        indexProjectionFingerprint: input.indexProjectionFingerprint,
        knowledgeSpaceId: input.knowledgeSpaceId,
        permissionSnapshot: input.permissionSnapshot,
        query: input.query,
        retrievalStrategy: input.retrievalStrategy,
        snapshotFingerprint: input.snapshotFingerprint,
        strategyVersion: options.strategyVersion,
      }),
    )
    .digest("hex");

  const namespace = knowledgeSpaceCacheNamespace({
    kind: "evidence-bundle",
    knowledgeSpaceId: input.knowledgeSpaceId,
  });
  return `${namespace}version:${cacheNamespaceSegment(
    options.strategyVersion,
    "strategyVersion",
  )}:${digest}`;
}

function encodeEvidenceBundle(bundle: EvidenceBundle): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(cloneEvidenceBundle(bundle)));
}

function cloneEvidenceBundle(bundle: EvidenceBundle): EvidenceBundle {
  return EvidenceBundleSchema.parse(JSON.parse(JSON.stringify(bundle)));
}

function encodeNormalizedQueryResult(result: NormalizedQueryResult): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      normalizedQuery: result.normalizedQuery,
      queryLanguage: result.queryLanguage,
      strategyVersion: result.strategyVersion,
    }),
  );
}

function decodeNormalizedQueryResult(bytes: Uint8Array): Omit<NormalizedQueryResult, "cacheHit"> {
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
    normalizedQuery?: unknown;
    queryLanguage?: unknown;
    strategyVersion?: unknown;
  };

  if (
    typeof payload.normalizedQuery !== "string" ||
    !isRetrievalQueryLanguage(payload.queryLanguage) ||
    typeof payload.strategyVersion !== "string"
  ) {
    throw new Error("Query normalization cache entry is invalid");
  }

  return {
    normalizedQuery: payload.normalizedQuery,
    queryLanguage: payload.queryLanguage,
    strategyVersion: payload.strategyVersion,
  };
}

function isRetrievalQueryLanguage(value: unknown): value is RetrievalQueryLanguage {
  return value === "cjk" || value === "latin" || value === "mixed-cjk-latin" || value === "other";
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}
