import {
  type CacheAdapter,
  KnowledgeSpaceObjectKeyPrefixSchema,
  type ObjectStorageAdapter,
} from "@knowledge/core";

import type { DeletionLifecycleFenceScope } from "./deletion-lifecycle-fence";
import {
  KnowledgeSpaceCacheKinds,
  LegacySpaceCachePrefixes,
  knowledgeSpaceCacheNamespaces,
} from "./knowledge-space-cache-namespace";

export class DeletionCleanupCapabilityUnavailableError extends Error {
  constructor(capability: string) {
    super(`Deletion cleanup capability is unavailable: ${capability}`);
    this.name = "DeletionCleanupCapabilityUnavailableError";
  }
}

export interface DeletionCleanupPageInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface DeletionCleanupPageResult {
  readonly deleted: number;
  readonly nextCursor?: string | undefined;
}

export async function deleteCachePrefixPage(
  cache: CacheAdapter,
  input: DeletionCleanupPageInput & { readonly prefix: string },
): Promise<DeletionCleanupPageResult> {
  const prefix = requiredPrefix(input.prefix, "cache prefix");
  const limit = positiveLimit(input.limit);
  if (!cache.deletePrefix) {
    throw new DeletionCleanupCapabilityUnavailableError("cache.deletePrefix");
  }
  const result = await cache.deletePrefix({
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit,
    prefix,
  });
  return validateCleanupResult(result, limit, "cache prefix cleanup");
}

/** Deletes one bounded page under an exact space or document object namespace. */
export async function deleteObjectPrefixPage(
  storage: Pick<ObjectStorageAdapter, "deleteObject" | "listObjects">,
  input: DeletionCleanupPageInput & { readonly objectKeyPrefix: string },
): Promise<DeletionCleanupPageResult> {
  const prefix = immutableObjectKeyPrefix(input.objectKeyPrefix);
  const limit = positiveLimit(input.limit);
  const page = await storage.listObjects({
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit,
    prefix,
  });
  const keys = page.objects.map((object) => object.key);
  if (keys.some((key) => !key.startsWith(prefix))) {
    throw new Error("Object cleanup adapter returned a key outside the deletion prefix");
  }
  if (new Set(keys).size !== keys.length || keys.length > limit) {
    throw new Error("Object cleanup adapter returned an invalid bounded page");
  }
  await Promise.all(keys.map((key) => storage.deleteObject(key)));
  return {
    deleted: keys.length,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

/** Deletes DB-enumerated source/document object keys without allowing a tenant/space escape. */
export async function deleteExactObjectKeys(
  storage: Pick<ObjectStorageAdapter, "deleteObject">,
  input: {
    readonly keys: readonly string[];
    readonly maxKeys: number;
    readonly objectKeyPrefix: string;
  },
): Promise<number> {
  const maxKeys = positiveLimit(input.maxKeys);
  if (input.keys.length > maxKeys || new Set(input.keys).size !== input.keys.length) {
    throw new Error(`Exact object cleanup keys must be unique and at most maxKeys=${maxKeys}`);
  }
  const prefix = immutableObjectKeyPrefix(input.objectKeyPrefix);
  const keys = input.keys.map((key) => requiredPrefix(key, "object key"));
  if (keys.some((key) => !key.startsWith(prefix))) {
    throw new Error("Exact object cleanup key escapes the knowledge-space prefix");
  }
  await Promise.all(keys.map((key) => storage.deleteObject(key)));
  return keys.length;
}

export interface DeletionDerivedCleaner {
  readonly name: string;
  cleanup(
    input: DeletionCleanupPageInput & { readonly scope: DeletionLifecycleFenceScope },
  ): Promise<DeletionCleanupPageResult>;
}

/**
 * Production cache cleaners. Digest-only v1 entries are globally drained first because they
 * cannot be attributed to a space; v2 entries are then deleted only under the target namespace.
 */
export function createKnowledgeSpaceCacheDeletionCleaners(
  cache: CacheAdapter,
): readonly DeletionDerivedCleaner[] {
  const legacy = LegacySpaceCachePrefixes.map((prefix, index) => ({
    name: `cache-legacy-${KnowledgeSpaceCacheKinds[index]}`,
    cleanup: (input: DeletionCleanupPageInput & { readonly scope: DeletionLifecycleFenceScope }) =>
      deleteCachePrefixPage(cache, {
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit,
        prefix,
      }),
  }));
  const scoped = KnowledgeSpaceCacheKinds.map((kind, index) => ({
    name: `cache-v2-${kind}`,
    cleanup: (input: DeletionCleanupPageInput & { readonly scope: DeletionLifecycleFenceScope }) =>
      deleteCachePrefixPage(cache, {
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit,
        prefix: knowledgeSpaceCacheNamespaces(input.scope)[index] as string,
      }),
  }));
  return [...legacy, ...scoped];
}

export interface DeletionDerivedCleanupCheckpoint {
  readonly cleanerIndex: number;
  readonly cursor?: string | undefined;
}

export interface DeletionDerivedCleanupStepResult {
  readonly cleaner: string;
  readonly complete: boolean;
  readonly deleted: number;
  readonly nextCheckpoint?: DeletionDerivedCleanupCheckpoint | undefined;
}

/**
 * Executes exactly one bounded derived cleaner page. The returned checkpoint is durable-job safe:
 * retries repeat only the current idempotent page, and cleaner order remains deterministic.
 */
export async function runDerivedDeletionCleanupStep(input: {
  readonly checkpoint?: DeletionDerivedCleanupCheckpoint | undefined;
  readonly cleaners: readonly DeletionDerivedCleaner[];
  readonly limit: number;
  readonly scope: DeletionLifecycleFenceScope;
}): Promise<DeletionDerivedCleanupStepResult> {
  const cleaners = validateCleaners(input.cleaners);
  const limit = positiveLimit(input.limit);
  const checkpoint = normalizeCheckpoint(input.checkpoint, cleaners.length);
  const cleaner = cleaners[checkpoint.cleanerIndex];
  if (!cleaner) {
    throw new Error("Derived deletion cleanup checkpoint is complete");
  }
  const result = validateCleanupResult(
    await cleaner.cleanup({
      ...(checkpoint.cursor ? { cursor: checkpoint.cursor } : {}),
      limit,
      scope: input.scope,
    }),
    limit,
    `derived cleaner ${cleaner.name}`,
  );
  const nextCheckpoint = result.nextCursor
    ? { cleanerIndex: checkpoint.cleanerIndex, cursor: result.nextCursor }
    : checkpoint.cleanerIndex + 1 < cleaners.length
      ? { cleanerIndex: checkpoint.cleanerIndex + 1 }
      : undefined;
  return {
    cleaner: cleaner.name,
    complete: nextCheckpoint === undefined,
    deleted: result.deleted,
    ...(nextCheckpoint ? { nextCheckpoint } : {}),
  };
}

function validateCleaners(cleaners: readonly DeletionDerivedCleaner[]): DeletionDerivedCleaner[] {
  if (cleaners.length === 0 || cleaners.length > 64) {
    throw new Error("Derived deletion cleanup requires between 1 and 64 cleaners");
  }
  const normalized = cleaners.map((cleaner) => ({
    ...cleaner,
    name: requiredName(cleaner.name),
  }));
  if (new Set(normalized.map((cleaner) => cleaner.name)).size !== normalized.length) {
    throw new Error("Derived deletion cleanup cleaner names must be unique");
  }
  return normalized;
}

function normalizeCheckpoint(
  checkpoint: DeletionDerivedCleanupCheckpoint | undefined,
  cleanerCount: number,
): DeletionDerivedCleanupCheckpoint {
  const normalized = checkpoint ?? { cleanerIndex: 0 };
  if (
    !Number.isSafeInteger(normalized.cleanerIndex) ||
    normalized.cleanerIndex < 0 ||
    normalized.cleanerIndex >= cleanerCount
  ) {
    throw new Error("Derived deletion cleanup checkpoint is invalid");
  }
  if (normalized.cursor !== undefined && !normalized.cursor) {
    throw new Error("Derived deletion cleanup cursor must not be empty");
  }
  return normalized;
}

function validateCleanupResult(
  result: DeletionCleanupPageResult,
  limit: number,
  label: string,
): DeletionCleanupPageResult {
  if (!Number.isSafeInteger(result.deleted) || result.deleted < 0 || result.deleted > limit) {
    throw new Error(`${label} returned an invalid deleted count`);
  }
  if (result.nextCursor !== undefined && !result.nextCursor) {
    throw new Error(`${label} returned an empty cursor`);
  }
  return {
    deleted: result.deleted,
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
  };
}

function positiveLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("Deletion cleanup limit must be between 1 and 10000");
  }
  return limit;
}

function immutableObjectKeyPrefix(value: string): string {
  return `${KnowledgeSpaceObjectKeyPrefixSchema.parse(value)}/`;
}

function requiredPrefix(value: string, field: string): string {
  if (!value || value !== value.trim() || value.length > 2048) {
    throw new Error(`Deletion cleanup ${field} is invalid`);
  }
  return value;
}

function requiredName(value: string): string {
  if (!value || value !== value.trim() || value.length > 512) {
    throw new Error("Deletion cleanup name is invalid");
  }
  return value;
}
