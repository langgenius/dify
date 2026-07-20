import type { CacheAdapter, KnowledgePath } from "@knowledge/core";
import { KnowledgePathSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createKnowledgePathResolutionCache } from "./knowledge-path-resolution-cache";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";

function createRecordingCache(): CacheAdapter & { entries: Map<string, Uint8Array> } {
  const entries = new Map<string, Uint8Array>();

  return {
    entries,
    kind: "memory",
    async delete(key) {
      entries.delete(key);
    },
    async get(key) {
      const value = entries.get(key);

      return value ? new Uint8Array(value) : null;
    },
    async health() {
      return true;
    },
    async set(key, value) {
      entries.set(key, new Uint8Array(value));
    },
    async stats() {
      return {
        entries: entries.size,
        totalBytes: Array.from(entries.values()).reduce((sum, value) => sum + value.byteLength, 0),
      };
    },
  };
}

function knowledgePath(overrides: Partial<KnowledgePath> = {}): KnowledgePath {
  return KnowledgePathSchema.parse({
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a00",
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    metadata: { label: "Readme" },
    resourceType: "document",
    targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
    version: 1,
    viewName: "source",
    viewType: "physical",
    virtualPath: "/sources/docs/readme",
    ...overrides,
  });
}

describe("createKnowledgePathResolutionCache", () => {
  it("stores clone-isolated path resolutions with normalized permission snapshots", async () => {
    const backing = createRecordingCache();
    const cache = createKnowledgePathResolutionCache({ cache: backing, ttlMs: 1_000 });
    const input = {
      commandName: "stat" as const,
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      manifestVersion: 1,
      mountVersion: "mount@1",
      pathIndexVersion: "v1",
      permissionSnapshot: ["write", "read", "read"],
      targetVersion: "document@1",
      tenantId: "tenant-1",
      virtualPath: "/sources/docs/readme",
    };
    const path = knowledgePath();

    await cache.set(input, path);
    path.metadata.label = "mutated";

    const found = await cache.get({
      ...input,
      permissionSnapshot: ["read", "write"],
    });

    expect(found).toEqual(expect.objectContaining({ metadata: { label: "Readme" } }));

    if (found) {
      found.metadata.label = "mutated-again";
    }

    await expect(cache.get(input)).resolves.toEqual(
      expect.objectContaining({ metadata: { label: "Readme" } }),
    );
    await expect(cache.get({ ...input, tenantId: "tenant-2" })).resolves.toBeNull();
    await expect(cache.get({ ...input, manifestVersion: 2 })).resolves.toBeNull();
    await expect(cache.get({ ...input, mountVersion: "mount@2" })).resolves.toBeNull();
    await expect(cache.get({ ...input, commandName: "cat" })).resolves.toBeNull();
    await expect(cache.get({ ...input, targetVersion: "document@2" })).resolves.toBeNull();
  });

  it("returns null for corrupt entries and rejects unbounded keys/configuration", async () => {
    const backing = createRecordingCache();
    const cache = createKnowledgePathResolutionCache({
      cache: backing,
      cacheVersion: "v1",
      maxPathBytes: 12,
    });

    backing.entries.set("knowledge-path:v1:corrupt", new TextEncoder().encode("{"));

    await expect(
      cache.get({
        commandName: "stat",
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        manifestVersion: 1,
        mountVersion: "mount@1",
        pathIndexVersion: "v1",
        permissionSnapshot: [],
        tenantId: "tenant-1",
        virtualPath: "/sources/a",
      }),
    ).resolves.toBeNull();
    await expect(
      cache.get({
        commandName: "stat",
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        manifestVersion: 1,
        mountVersion: "mount@1",
        pathIndexVersion: "v1",
        permissionSnapshot: [],
        tenantId: "tenant-1",
        virtualPath: "/sources/path-that-is-too-long",
      }),
    ).rejects.toThrow("Knowledge path cache virtualPath exceeds maxPathBytes=12");
    expect(() => createKnowledgePathResolutionCache({ cache: backing, maxPathBytes: 0 })).toThrow(
      "Knowledge path cache maxPathBytes must be at least 1",
    );
    expect(() => createKnowledgePathResolutionCache({ cache: backing, cacheVersion: " " })).toThrow(
      "Knowledge path cache cacheVersion is required",
    );
  });
});
