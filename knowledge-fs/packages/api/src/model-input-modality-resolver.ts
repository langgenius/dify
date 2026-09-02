import { createHash } from "node:crypto";

import { stableJson } from "@knowledge/core";

import {
  type ModelCapabilityCatalog,
  type ModelCapabilitySnapshot,
  ModelCapabilitySnapshotSchema,
  ModelCatalogEntrySchema,
  type ModelInputModality,
  modelInputModalitiesFromCatalogCapabilities,
} from "./model-capability-preflight";

export interface ResolveModelInputModalitiesInput {
  readonly signal?: AbortSignal | undefined;
  /** Untrusted persisted snapshot shape; invalid/older rows fail closed to text. */
  readonly snapshot: unknown;
  readonly tenantId: string;
}

export interface ModelInputModalityResolver {
  resolve(input: ResolveModelInputModalitiesInput): Promise<readonly ModelInputModality[]>;
}

export interface ModelInputModalityResolverOptions {
  readonly catalog: Pick<ModelCapabilityCatalog, "resolve">;
  readonly maxEntries?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly ttlMs?: number | undefined;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 1_024;
const TEXT_ONLY_MODALITIES = Object.freeze(["text"] as const);
const VISION_MODALITIES = Object.freeze(["text", "image"] as const);

/**
 * Reads modalities from an immutable capability snapshot. Legacy snapshots are upgraded through
 * one bounded catalog lookup only when the currently installed model declaration hashes to the
 * exact capability digest that was frozen with the profile. Catalog drift and outages fail closed
 * to text, so a mutable provider declaration can never silently grant image access.
 */
export function createModelInputModalityResolver({
  catalog,
  maxEntries = DEFAULT_MAX_CACHE_ENTRIES,
  now = Date.now,
  ttlMs = DEFAULT_CACHE_TTL_MS,
}: ModelInputModalityResolverOptions): ModelInputModalityResolver {
  assertPositiveInteger(maxEntries, "maxEntries");
  assertPositiveInteger(ttlMs, "ttlMs");
  const cache = new Map<
    string,
    { readonly expiresAt: number; readonly modalities: readonly ModelInputModality[] }
  >();
  const cacheModalities = (
    key: string,
    timestamp: number,
    modalities: readonly ModelInputModality[],
  ) => {
    cache.set(key, { expiresAt: timestamp + ttlMs, modalities });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return modalities;
  };

  return {
    resolve: async ({ signal, snapshot: value, tenantId }) => {
      signal?.throwIfAborted();
      const parsedSnapshot = ModelCapabilitySnapshotSchema.safeParse(value);
      // Capability rows created before the current snapshot contract (or corrupted rows) do not
      // contain enough immutable identity to grant image access. Keep the knowledge space usable,
      // but fail closed to text without consulting a mutable catalog declaration.
      if (!parsedSnapshot.success) {
        return TEXT_ONLY_MODALITIES;
      }
      const snapshot = parsedSnapshot.data;
      if (snapshot.inputModalities) {
        return Object.freeze([...snapshot.inputModalities]);
      }

      const normalizedTenantId = tenantId.trim();
      if (!normalizedTenantId) {
        return TEXT_ONLY_MODALITIES;
      }
      const key = `${normalizedTenantId}\u0000${snapshot.capabilityDigest}`;
      const cached = cache.get(key);
      const timestamp = now();
      if (cached && cached.expiresAt > timestamp) {
        // Refresh insertion order so the bounded map behaves like a small LRU.
        cache.delete(key);
        cache.set(key, cached);
        return cached.modalities;
      }
      cache.delete(key);

      try {
        const rawEntry = await catalog.resolve({
          kind: snapshot.kind,
          selection: snapshot.selection,
          ...(signal ? { signal } : {}),
          tenantId: normalizedTenantId,
        });
        signal?.throwIfAborted();
        if (!rawEntry) return cacheModalities(key, timestamp, TEXT_ONLY_MODALITIES);
        const entry = ModelCatalogEntrySchema.parse(rawEntry);
        if (!sameFrozenIdentity(snapshot, entry)) {
          return cacheModalities(key, timestamp, TEXT_ONLY_MODALITIES);
        }
        if (legacyCapabilityDigest(snapshot, entry.capabilities) !== snapshot.capabilityDigest) {
          return cacheModalities(key, timestamp, TEXT_ONLY_MODALITIES);
        }
        const modalities = modelInputModalitiesFromCatalogCapabilities(entry.capabilities).includes(
          "image",
        )
          ? VISION_MODALITIES
          : TEXT_ONLY_MODALITIES;
        return cacheModalities(key, timestamp, modalities);
      } catch (error) {
        signal?.throwIfAborted();
        return cacheModalities(key, timestamp, TEXT_ONLY_MODALITIES);
      }
    },
  };
}

function sameFrozenIdentity(
  snapshot: ModelCapabilitySnapshot,
  entry: ReturnType<typeof ModelCatalogEntrySchema.parse>,
): boolean {
  return (
    entry.kinds.includes(snapshot.kind) &&
    entry.model === snapshot.selection.model &&
    entry.pluginId === snapshot.selection.pluginId &&
    entry.provider === snapshot.selection.provider &&
    entry.pluginUniqueIdentifier === snapshot.pluginUniqueIdentifier &&
    entry.schemaFingerprint === snapshot.schemaFingerprint &&
    entry.pluginVersion === snapshot.pluginVersion
  );
}

function legacyCapabilityDigest(
  snapshot: ModelCapabilitySnapshot,
  capabilities: Readonly<Record<string, unknown>>,
): string {
  const {
    capabilityDigest: _capabilityDigest,
    checkedAt: _checkedAt,
    inputModalities: _inputModalities,
    ...material
  } = snapshot;
  return `sha256:${createHash("sha256")
    .update(stableJson({ ...material, capabilities }))
    .digest("hex")}`;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Model input modality resolver ${name} must be a positive integer`);
  }
}
