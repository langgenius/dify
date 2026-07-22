import type { CacheAdapter } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createCacheSessionContextRepository } from "./session-context-repository";

function createRecordingCache(): CacheAdapter & {
  readonly values: Map<string, Uint8Array>;
} {
  const values = new Map<string, Uint8Array>();

  return {
    kind: "memory",
    values,
    delete: async (key) => {
      values.delete(key);
    },
    get: async (key) => {
      const value = values.get(key);

      return value ? new Uint8Array(value) : null;
    },
    health: async () => true,
    set: async (key, value) => {
      values.set(key, new Uint8Array(value));
    },
    stats: async () => ({
      entries: values.size,
      totalBytes: [...values.values()].reduce((sum, value) => sum + value.byteLength, 0),
    }),
  };
}

describe("createCacheSessionContextRepository", () => {
  it("compensates the cache write when the retrieval lease is lost after set", async () => {
    const cache = createRecordingCache();
    const sessions = createCacheSessionContextRepository({
      cache,
      generateId: () => "session-fenced",
    });
    const assertActive = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("lease lost"));

    await expect(
      sessions.recordQuery({
        knowledgeSpaceId: "space-a",
        permissionSnapshot: ["read"],
        query: "must be compensated",
        retrievalExecution: { assertActive },
        subjectId: "subject-a",
        tenantId: "tenant-a",
        traceId: "trace-a",
      }),
    ).rejects.toThrow("lease lost");

    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(cache.values.size).toBe(0);
  });

  it("records bounded cache-backed query context with clone isolation", async () => {
    const cache = createRecordingCache();
    const sessions = createCacheSessionContextRepository({
      cache,
      generateId: () => "session-a",
      maxActiveDocumentIds: 2,
      maxActiveEntityIds: 2,
      maxPreviousQueries: 2,
      now: () => Date.parse("2026-05-11T13:00:00.000Z"),
      ttlMs: 60_000,
    });

    const first = await sessions.recordQuery({
      activeDocumentIds: ["doc-a", "doc-b", "doc-c"],
      activeEntityIds: ["entity-a", "entity-b", "entity-c"],
      knowledgeSpaceId: "space-a",
      permissionSnapshot: ["read", "write"],
      query: "first question",
      subjectId: "subject-a",
      tenantId: "tenant-a",
      traceId: "trace-a",
    });
    const firstQuery = first.stored.previousQueries[0];
    expect(firstQuery).toBeDefined();
    if (!firstQuery) {
      throw new Error("Expected previous query");
    }
    (firstQuery as { query: string }).query = "mutated";
    const storedKey = [...cache.values.keys()][0];
    expect(storedKey).toContain("space-cache:v2:session-context:tenant:");
    expect(storedKey).toContain(":space:space-a:version:session-context-v1:");
    expect(storedKey).not.toContain("tenant-a");

    await expect(
      sessions.get({
        knowledgeSpaceId: "space-a",
        sessionId: "session-a",
        subjectId: "subject-a",
        tenantId: "tenant-a",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        activeDocumentIds: ["doc-b", "doc-c"],
        activeEntityIds: ["entity-b", "entity-c"],
        previousQueries: [expect.objectContaining({ query: "first question" })],
      }),
    );
  });

  it("validates bounds and invalidates context when permissions change", async () => {
    expect(() =>
      createCacheSessionContextRepository({
        cache: createRecordingCache(),
        maxPreviousQueries: 0,
      }),
    ).toThrow("Session context maxPreviousQueries must be at least 1");

    const sessions = createCacheSessionContextRepository({
      cache: createRecordingCache(),
      generateId: () => "session-b",
      now: () => Date.parse("2026-05-11T13:00:00.000Z"),
      ttlMs: 60_000,
    });
    await sessions.recordQuery({
      knowledgeSpaceId: "space-a",
      permissionSnapshot: ["read"],
      query: "first question",
      subjectId: "subject-a",
      tenantId: "tenant-a",
      traceId: "trace-a",
    });
    const changed = await sessions.recordQuery({
      knowledgeSpaceId: "space-a",
      permissionSnapshot: ["read", "write"],
      query: "second question",
      sessionId: "session-b",
      subjectId: "subject-a",
      tenantId: "tenant-a",
      traceId: "trace-b",
    });

    expect(changed.context.permissionInvalidated).toBe(true);
    expect(changed.stored.previousQueries).toEqual([
      expect.objectContaining({ query: "second question" }),
    ]);
  });
});
