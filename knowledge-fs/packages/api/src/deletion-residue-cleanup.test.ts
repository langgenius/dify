import { createMemoryCacheAdapter, createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import type { ObjectStorageAdapter } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  DeletionCleanupCapabilityUnavailableError,
  type DeletionDerivedCleaner,
  createKnowledgeSpaceCacheDeletionCleaners,
  deleteCachePrefixPage,
  deleteExactObjectKeys,
  deleteObjectPrefixPage,
  runDerivedDeletionCleanupStep,
} from "./deletion-residue-cleanup";
import {
  LegacySpaceCachePrefixes,
  knowledgeSpaceCacheNamespace,
} from "./knowledge-space-cache-namespace";

const scope = {
  documentAssetId: "document-1",
  knowledgeSpaceId: "space-1",
  tenantId: "tenant-1",
} as const;
const objectKeyPrefix = "tenant-1/spaces/space-1";

describe("deletion residue cleanup", () => {
  it("invalidates cache namespaces in bounded pages and fails closed without capability", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 10 });
    await cache.set("space:one:a", new Uint8Array([1]));
    await cache.set("space:one:b", new Uint8Array([2]));
    await cache.set("space:two:a", new Uint8Array([3]));

    const first = await deleteCachePrefixPage(cache, { limit: 1, prefix: "space:one:" });
    expect(first).toEqual({ deleted: 1, nextCursor: "space:one:a" });
    await expect(
      deleteCachePrefixPage(cache, {
        cursor: first.nextCursor,
        limit: 1,
        prefix: "space:one:",
      }),
    ).resolves.toEqual({ deleted: 1 });
    await expect(cache.get("space:two:a")).resolves.toEqual(new Uint8Array([3]));

    const { deletePrefix: _deletePrefix, ...cacheWithoutPrefixDelete } = cache;
    await expect(
      deleteCachePrefixPage(cacheWithoutPrefixDelete, { limit: 1, prefix: "x:" }),
    ).rejects.toBeInstanceOf(DeletionCleanupCapabilityUnavailableError);
  });

  it("drains unscoped legacy roots before target v2 namespaces and preserves other spaces", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 20 });
    const targetNamespace = knowledgeSpaceCacheNamespace({
      kind: "evidence-bundle",
      knowledgeSpaceId: scope.knowledgeSpaceId,
    });
    const otherNamespace = knowledgeSpaceCacheNamespace({
      kind: "evidence-bundle",
      knowledgeSpaceId: "space-2",
    });
    await cache.set(`${LegacySpaceCachePrefixes[1]}legacy-sensitive-digest`, new Uint8Array([1]));
    await cache.set(`${targetNamespace}version:v2:target`, new Uint8Array([2]));
    await cache.set(`${otherNamespace}version:v2:keep`, new Uint8Array([3]));

    const cleaners = createKnowledgeSpaceCacheDeletionCleaners(cache);
    expect(cleaners.slice(0, 4).every((cleaner) => cleaner.name.startsWith("cache-legacy-"))).toBe(
      true,
    );
    for (const cleaner of cleaners) {
      let cursor: string | undefined;
      do {
        const result = await cleaner.cleanup({ ...(cursor ? { cursor } : {}), limit: 1, scope });
        cursor = result.nextCursor;
      } while (cursor);
    }

    await expect(
      cache.get(`${LegacySpaceCachePrefixes[1]}legacy-sensitive-digest`),
    ).resolves.toBeNull();
    await expect(cache.get(`${targetNamespace}version:v2:target`)).resolves.toBeNull();
    await expect(cache.get(`${otherNamespace}version:v2:keep`)).resolves.toEqual(
      new Uint8Array([3]),
    );
  });

  it("enumerates and deletes only the exact bounded object prefix", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 32 });
    const prefix = "tenant-1/spaces/space-1/documents/document-1/";
    await storage.putObject({ body: new Uint8Array([1]), key: `${prefix}a.md` });
    await storage.putObject({ body: new Uint8Array([2]), key: `${prefix}b.md` });
    await storage.putObject({
      body: new Uint8Array([3]),
      key: "tenant-1/spaces/space-2/documents/document-1/keep.md",
    });

    const first = await deleteObjectPrefixPage(storage, { limit: 1, objectKeyPrefix });
    expect(first).toMatchObject({ deleted: 1, nextCursor: expect.any(String) });
    await expect(
      deleteObjectPrefixPage(storage, {
        cursor: first.nextCursor,
        limit: 1,
        objectKeyPrefix,
      }),
    ).resolves.toEqual({ deleted: 1 });
    await expect(
      storage.getObject("tenant-1/spaces/space-2/documents/document-1/keep.md"),
    ).resolves.toEqual(new Uint8Array([3]));
  });

  it("validates a complete object page before deleting any returned key", async () => {
    const deleteObject = vi.fn(async () => undefined);
    const storage = {
      deleteObject,
      listObjects: async () => ({
        objects: [
          { key: "tenant-1/spaces/space-1/documents/document-1/ok", metadata: {}, sizeBytes: 1 },
          { key: "tenant-2/private", metadata: {}, sizeBytes: 1 },
        ],
      }),
    } satisfies Pick<ObjectStorageAdapter, "deleteObject" | "listObjects">;

    await expect(deleteObjectPrefixPage(storage, { limit: 2, objectKeyPrefix })).rejects.toThrow(
      "outside the deletion prefix",
    );
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("rejects invalid bounds, checkpoints, and cleaner pages before destructive work", async () => {
    const deleteObject = vi.fn(async () => undefined);
    const duplicatePageStorage = {
      deleteObject,
      listObjects: async () => ({
        objects: [
          { key: `${objectKeyPrefix}/same`, metadata: {}, sizeBytes: 1 },
          { key: `${objectKeyPrefix}/same`, metadata: {}, sizeBytes: 1 },
        ],
      }),
    } satisfies Pick<ObjectStorageAdapter, "deleteObject" | "listObjects">;
    const cleaner = (
      name: string,
      result: { readonly deleted: number; readonly nextCursor?: string | undefined } = {
        deleted: 0,
      },
    ): DeletionDerivedCleaner => ({ name, cleanup: async () => result });

    const invalidOperations: readonly (() => Promise<unknown>)[] = [
      () => deleteObjectPrefixPage(duplicatePageStorage, { limit: 2, objectKeyPrefix }),
      () =>
        deleteExactObjectKeys(
          { deleteObject },
          {
            keys: [`${objectKeyPrefix}/same`, `${objectKeyPrefix}/same`],
            maxKeys: 2,
            objectKeyPrefix,
          },
        ),
      () => deleteExactObjectKeys({ deleteObject }, { keys: [], maxKeys: 0, objectKeyPrefix }),
      () => deleteExactObjectKeys({ deleteObject }, { keys: [" "], maxKeys: 1, objectKeyPrefix }),
      () => runDerivedDeletionCleanupStep({ cleaners: [], limit: 1, scope }),
      () =>
        runDerivedDeletionCleanupStep({
          cleaners: Array.from({ length: 65 }, (_, index) => cleaner(`cleaner-${index}`)),
          limit: 1,
          scope,
        }),
      () =>
        runDerivedDeletionCleanupStep({
          cleaners: [cleaner("duplicate"), cleaner("duplicate")],
          limit: 1,
          scope,
        }),
      () => runDerivedDeletionCleanupStep({ cleaners: [cleaner(" ")], limit: 1, scope }),
      () =>
        runDerivedDeletionCleanupStep({
          checkpoint: { cleanerIndex: -1 },
          cleaners: [cleaner("valid")],
          limit: 1,
          scope,
        }),
      () =>
        runDerivedDeletionCleanupStep({
          checkpoint: { cleanerIndex: 0, cursor: "" },
          cleaners: [cleaner("valid")],
          limit: 1,
          scope,
        }),
      () =>
        runDerivedDeletionCleanupStep({
          cleaners: [cleaner("invalid-count", { deleted: 2 })],
          limit: 1,
          scope,
        }),
      () =>
        runDerivedDeletionCleanupStep({
          cleaners: [cleaner("invalid-cursor", { deleted: 0, nextCursor: "" })],
          limit: 1,
          scope,
        }),
    ];

    for (const operation of invalidOperations) await expect(operation()).rejects.toThrow();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("bounds exact DB-enumerated keys to the knowledge-space namespace", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 32 });
    const key = "tenant-1/spaces/space-1/documents/document-1/file.md";
    await storage.putObject({ body: new Uint8Array([1]), key });
    await expect(
      deleteExactObjectKeys(storage, { keys: [key], maxKeys: 1, objectKeyPrefix }),
    ).resolves.toBe(1);
    await expect(
      deleteExactObjectKeys(storage, {
        keys: ["tenant-2/spaces/space-1/private"],
        maxKeys: 1,
        objectKeyPrefix,
      }),
    ).rejects.toThrow("escapes the knowledge-space prefix");
  });

  it("uses the immutable manifest prefix instead of deriving it from raw tenant identity", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 32 });
    const normalizedManifestPrefix = "tenant_unsafe/spaces/space-1";
    const key = `${normalizedManifestPrefix}/documents/document-1/file.md`;
    await storage.putObject({ body: new Uint8Array([1]), key });

    await expect(
      deleteExactObjectKeys(storage, {
        keys: [key],
        maxKeys: 1,
        objectKeyPrefix: normalizedManifestPrefix,
      }),
    ).resolves.toBe(1);
    await expect(
      deleteObjectPrefixPage(storage, {
        limit: 1,
        objectKeyPrefix: "tenant/../unsafe",
      }),
    ).rejects.toThrow();
  });

  it("advances deterministic derived cleaners with resumable checkpoints", async () => {
    const calls: string[] = [];
    const cleaners: DeletionDerivedCleaner[] = [
      {
        name: "graph",
        cleanup: async ({ cursor }) => {
          calls.push(`graph:${cursor ?? "start"}`);
          return cursor ? { deleted: 1 } : { deleted: 2, nextCursor: "graph-page-2" };
        },
      },
      {
        name: "traces",
        cleanup: async () => {
          calls.push("traces:start");
          return { deleted: 0 };
        },
      },
    ];

    const first = await runDerivedDeletionCleanupStep({ cleaners, limit: 2, scope });
    expect(first).toMatchObject({
      cleaner: "graph",
      complete: false,
      nextCheckpoint: { cleanerIndex: 0, cursor: "graph-page-2" },
    });
    const second = await runDerivedDeletionCleanupStep({
      checkpoint: first.nextCheckpoint,
      cleaners,
      limit: 2,
      scope,
    });
    expect(second.nextCheckpoint).toEqual({ cleanerIndex: 1 });
    await expect(
      runDerivedDeletionCleanupStep({
        checkpoint: second.nextCheckpoint,
        cleaners,
        limit: 2,
        scope,
      }),
    ).resolves.toMatchObject({ cleaner: "traces", complete: true, deleted: 0 });
    expect(calls).toEqual(["graph:start", "graph:graph-page-2", "traces:start"]);
  });
});
