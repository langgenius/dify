import { describe, expect, it } from "vitest";

import { createMemoryCacheAdapter } from "./cache";

describe("memory cache adapter", () => {
  it("rejects unbounded cache configurations", () => {
    expect(() => createMemoryCacheAdapter({ maxEntries: 0 })).toThrow(
      "Memory cache maxEntries must be at least 1",
    );
    expect(() => createMemoryCacheAdapter({ maxEntries: 1, maxTotalBytes: 0 })).toThrow(
      "Memory cache maxTotalBytes must be at least 1",
    );
  });

  it("stores and deletes version-aware cache values", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 2 });
    const value = new TextEncoder().encode("cached evidence");

    await cache.set("retrieval:v1:tenant-1:query", value);

    await expect(cache.get("retrieval:v1:tenant-1:query")).resolves.toEqual(value);

    await cache.delete("retrieval:v1:tenant-1:query");

    await expect(cache.get("retrieval:v1:tenant-1:query")).resolves.toBeNull();
  });

  it("deletes a cache namespace in bounded stable pages", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 10 });
    await cache.set("space:one:a", new Uint8Array([1]));
    await cache.set("space:one:b", new Uint8Array([2]));
    await cache.set("space:one:c", new Uint8Array([3]));
    await cache.set("space:two:a", new Uint8Array([4]));

    const first = await cache.deletePrefix?.({ limit: 2, prefix: "space:one:" });
    expect(first).toEqual({ deleted: 2, nextCursor: "space:one:b" });
    expect(first?.nextCursor).toBeDefined();
    await expect(
      cache.deletePrefix?.({ cursor: first?.nextCursor ?? "", limit: 2, prefix: "space:one:" }),
    ).resolves.toEqual({ deleted: 1 });
    await expect(cache.get("space:two:a")).resolves.toEqual(new Uint8Array([4]));
    await expect(cache.stats()).resolves.toEqual({ entries: 1, totalBytes: 1 });
  });

  it("validates prefix deletion requests and purges expired entries during stats", async () => {
    let currentTime = 1_000;
    const cache = createMemoryCacheAdapter({ maxEntries: 2, now: () => currentTime });

    await expect(cache.deletePrefix?.({ limit: 1.5, prefix: "space:" })).rejects.toThrow(
      "Cache prefix delete limit must be at least 1",
    );
    await expect(cache.deletePrefix?.({ limit: 0, prefix: "space:" })).rejects.toThrow(
      "Cache prefix delete limit must be at least 1",
    );
    await expect(cache.deletePrefix?.({ limit: 1, prefix: "" })).rejects.toThrow(
      "Cache prefix delete prefix is required",
    );

    await cache.set("space:expired", new Uint8Array([1, 2]), { ttlMs: 50 });
    currentTime = 1_051;
    await expect(cache.stats()).resolves.toEqual({ entries: 0, totalBytes: 0 });
  });

  it("expires values by ttl without retaining stale bytes", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 2, now: () => 1_000 });

    await cache.set("generation:v1:short-lived", new Uint8Array([1, 2, 3]), { ttlMs: 50 });

    await expect(cache.get("generation:v1:short-lived", { now: 1_020 })).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await expect(cache.get("generation:v1:short-lived", { now: 1_051 })).resolves.toBeNull();
    await expect(cache.stats()).resolves.toMatchObject({ entries: 0, totalBytes: 0 });
  });

  it("purges expired values when collecting stats", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 2, now: () => 2_000 });

    await cache.set("generation:v1:expired", new Uint8Array([1, 2, 3]), { ttlMs: 50 });

    await expect(cache.stats()).resolves.toMatchObject({ entries: 1, totalBytes: 3 });
    await expect(cache.get("generation:v1:expired", { now: 2_051 })).resolves.toBeNull();
    await expect(cache.stats()).resolves.toMatchObject({ entries: 0, totalBytes: 0 });
  });

  it("evicts the oldest entry when maxEntries would be exceeded", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 2 });

    await cache.set("a", new Uint8Array([1]));
    await cache.set("b", new Uint8Array([2]));
    await cache.set("c", new Uint8Array([3]));

    await expect(cache.get("a")).resolves.toBeNull();
    await expect(cache.get("b")).resolves.toEqual(new Uint8Array([2]));
    await expect(cache.get("c")).resolves.toEqual(new Uint8Array([3]));
    await expect(cache.stats()).resolves.toMatchObject({ entries: 2, totalBytes: 2 });
  });

  it("evicts least-recently-used entries when maxTotalBytes would be exceeded", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 10, maxTotalBytes: 4 });

    await cache.set("a", new Uint8Array([1, 1]));
    await cache.set("b", new Uint8Array([2, 2]));
    await expect(cache.get("a")).resolves.toEqual(new Uint8Array([1, 1]));
    await cache.set("c", new Uint8Array([3, 3]));

    await expect(cache.get("a")).resolves.toEqual(new Uint8Array([1, 1]));
    await expect(cache.get("b")).resolves.toBeNull();
    await expect(cache.get("c")).resolves.toEqual(new Uint8Array([3, 3]));
    await expect(cache.stats()).resolves.toMatchObject({ entries: 2, totalBytes: 4 });
  });

  it("rejects values larger than maxTotalBytes without retaining them", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 10, maxTotalBytes: 2 });

    await expect(cache.set("too-large", new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Memory cache value exceeds maxTotalBytes=2",
    );
    await expect(cache.stats()).resolves.toMatchObject({ entries: 0, totalBytes: 0 });
  });

  it("copies cached bytes so callers cannot mutate retained state", async () => {
    const cache = createMemoryCacheAdapter({ maxEntries: 2 });
    const value = new Uint8Array([1]);

    await cache.set("immutable", value);
    value[0] = 9;

    const cached = await cache.get("immutable");

    expect(cached).toEqual(new Uint8Array([1]));

    if (cached) {
      cached[0] = 8;
    }

    await expect(cache.get("immutable")).resolves.toEqual(new Uint8Array([1]));
  });
});
