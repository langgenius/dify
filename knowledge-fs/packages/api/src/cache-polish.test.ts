import { type CacheAdapter, KnowledgePathSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createKnowledgePathResolutionCache } from "./index";

function createRecordingCache(): CacheAdapter & {
  readonly getCalls: string[];
  readonly setCalls: Array<{
    readonly key: string;
    readonly options?: { readonly ttlMs?: number };
  }>;
  readonly values: Map<string, Uint8Array>;
} {
  const values = new Map<string, Uint8Array>();
  const getCalls: string[] = [];
  const setCalls: Array<{ readonly key: string; readonly options?: { readonly ttlMs?: number } }> =
    [];

  return {
    delete: async (key) => {
      values.delete(key);
    },
    get: async (key) => {
      getCalls.push(key);
      const value = values.get(key);

      return value ? new Uint8Array(value) : null;
    },
    getCalls,
    health: async () => true,
    kind: "memory",
    set: async (key, value, options) => {
      setCalls.push({ key, ...(options ? { options } : {}) });
      values.set(key, new Uint8Array(value));
    },
    setCalls,
    stats: async () => ({
      entries: values.size,
      totalBytes: Array.from(values.values()).reduce((total, value) => total + value.byteLength, 0),
    }),
    values,
  };
}

describe("createKnowledgePathResolutionCache", () => {
  it("caches path resolutions by permission snapshot and path index version", async () => {
    const cache = createRecordingCache();
    const pathCache = createKnowledgePathResolutionCache({
      cache,
      cacheVersion: "path-cache-v1",
      ttlMs: 60_000,
    });
    const path = KnowledgePathSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a02",
      metadata: { title: "Cached path" },
      resourceType: "node",
      targetId: "node-1",
      version: 1,
      viewName: "by-type",
      viewType: "physical",
      virtualPath: "/knowledge/by-type/cached.md",
    });

    await pathCache.set(
      {
        commandName: "stat",
        knowledgeSpaceId: path.knowledgeSpaceId,
        manifestVersion: 1,
        mountVersion: "mount@1",
        pathIndexVersion: "paths@1",
        permissionSnapshot: ["project:alpha", "tenant:tenant-1"],
        targetVersion: "node@1",
        tenantId: "tenant-1",
        virtualPath: path.virtualPath,
      },
      path,
    );

    const cached = await pathCache.get({
      commandName: "stat",
      knowledgeSpaceId: path.knowledgeSpaceId,
      manifestVersion: 1,
      mountVersion: "mount@1",
      pathIndexVersion: "paths@1",
      permissionSnapshot: ["tenant:tenant-1", "project:alpha"],
      targetVersion: "node@1",
      tenantId: "tenant-1",
      virtualPath: path.virtualPath,
    });

    expect(cached).toEqual(path);
    if (!cached) {
      throw new Error("Expected cached path");
    }
    cached.metadata.title = "mutated";
    await expect(
      pathCache.get({
        commandName: "stat",
        knowledgeSpaceId: path.knowledgeSpaceId,
        manifestVersion: 1,
        mountVersion: "mount@1",
        pathIndexVersion: "paths@1",
        permissionSnapshot: ["project:alpha", "tenant:tenant-1"],
        targetVersion: "node@1",
        tenantId: "tenant-1",
        virtualPath: path.virtualPath,
      }),
    ).resolves.toEqual(path);
    expect(cache.setCalls[0]?.key).toContain("space-cache:v2:knowledge-path:tenant:");
    expect(cache.setCalls[0]?.key).toContain(
      `:space:${path.knowledgeSpaceId}:version:path-cache-v1:`,
    );
    expect(cache.setCalls[0]?.key).not.toContain("tenant-1");
    expect(cache.setCalls[0]?.key).not.toContain(path.virtualPath);
    expect(cache.setCalls[0]?.options).toEqual({ ttlMs: 60_000 });
    await expect(
      pathCache.get({
        commandName: "stat",
        knowledgeSpaceId: path.knowledgeSpaceId,
        manifestVersion: 1,
        mountVersion: "mount@1",
        pathIndexVersion: "paths@2",
        permissionSnapshot: ["project:alpha", "tenant:tenant-1"],
        targetVersion: "node@1",
        tenantId: "tenant-1",
        virtualPath: path.virtualPath,
      }),
    ).resolves.toBeNull();
  });

  it("rejects unbounded or incomplete path cache inputs", async () => {
    const cache = createRecordingCache();
    const pathCache = createKnowledgePathResolutionCache({
      cache,
      cacheVersion: "path-cache-v1",
      maxPathBytes: 8,
      ttlMs: 60_000,
    });

    await expect(
      pathCache.get({
        commandName: "stat",
        knowledgeSpaceId: "space",
        manifestVersion: 1,
        mountVersion: "mount@1",
        pathIndexVersion: "paths@1",
        permissionSnapshot: [],
        tenantId: "tenant-1",
        virtualPath: "/knowledge/oversized.md",
      }),
    ).rejects.toThrow("Knowledge path cache virtualPath exceeds maxPathBytes=8");

    expect(() =>
      createKnowledgePathResolutionCache({
        cache,
        cacheVersion: " ",
        ttlMs: 60_000,
      }),
    ).toThrow("Knowledge path cache cacheVersion is required");
  });
});
