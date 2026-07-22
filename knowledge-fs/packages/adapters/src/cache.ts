import type { CacheAdapter } from "@knowledge/core";

export interface MemoryCacheOptions {
  readonly maxEntries: number;
  readonly maxTotalBytes?: number | undefined;
  readonly now?: () => number;
}

interface CacheEntry {
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly value: Uint8Array;
}

export function createMemoryCacheAdapter({
  maxEntries,
  maxTotalBytes,
  now = Date.now,
}: MemoryCacheOptions): CacheAdapter {
  if (maxEntries < 1) {
    throw new Error("Memory cache maxEntries must be at least 1");
  }

  if (maxTotalBytes !== undefined && maxTotalBytes < 1) {
    throw new Error("Memory cache maxTotalBytes must be at least 1");
  }

  const entries = new Map<string, CacheEntry>();
  let totalBytes = 0;

  return {
    kind: "memory",
    delete: async (key) => {
      deleteEntry(entries, key, (bytes) => {
        totalBytes -= bytes;
      });
    },
    deletePrefix: async ({ cursor, limit, prefix }) => {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error("Cache prefix delete limit must be at least 1");
      }
      if (!prefix) {
        throw new Error("Cache prefix delete prefix is required");
      }
      const matchingKeys = [...entries.keys()]
        .filter((key) => key.startsWith(prefix) && (!cursor || key > cursor))
        .sort()
        .slice(0, limit + 1);
      const pageKeys = matchingKeys.slice(0, limit);
      for (const key of pageKeys) {
        deleteEntry(entries, key, (bytes) => {
          totalBytes -= bytes;
        });
      }
      const nextCursor = matchingKeys.length > limit ? pageKeys.at(-1) : undefined;
      return {
        deleted: pageKeys.length,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    get: async (key, options) => {
      const entry = entries.get(key);

      if (!entry) {
        return null;
      }

      if (isExpired(entry, options?.now ?? now())) {
        deleteEntry(entries, key, (bytes) => {
          totalBytes -= bytes;
        });

        return null;
      }

      entries.delete(key);
      entries.set(key, entry);

      return copyBytes(entry.value);
    },
    health: async () => true,
    set: async (key, value, options) => {
      if (maxTotalBytes !== undefined && value.byteLength > maxTotalBytes) {
        throw new Error(`Memory cache value exceeds maxTotalBytes=${maxTotalBytes}`);
      }

      const timestamp = now();
      const entry = {
        createdAt: timestamp,
        ...(options?.ttlMs ? { expiresAt: timestamp + options.ttlMs } : {}),
        value: copyBytes(value),
      } satisfies CacheEntry;

      deleteEntry(entries, key, (bytes) => {
        totalBytes -= bytes;
      });
      entries.set(key, entry);
      totalBytes += entry.value.byteLength;
      totalBytes = evictLeastRecentlyUsed(entries, {
        maxEntries,
        maxTotalBytes,
        totalBytes,
      });
    },
    stats: async () => {
      totalBytes = purgeExpired(entries, now(), totalBytes);

      return {
        entries: entries.size,
        totalBytes,
      };
    },
  };
}

function evictLeastRecentlyUsed(
  entries: Map<string, CacheEntry>,
  {
    maxEntries,
    maxTotalBytes,
    totalBytes,
  }: {
    readonly maxEntries: number;
    readonly maxTotalBytes: number | undefined;
    readonly totalBytes: number;
  },
): number {
  let retainedBytes = totalBytes;
  while (
    entries.size > maxEntries ||
    (maxTotalBytes !== undefined && retainedBytes > maxTotalBytes)
  ) {
    for (const oldestKey of entries.keys()) {
      deleteEntry(entries, oldestKey, (bytes) => {
        retainedBytes -= bytes;
      });
      break;
    }
  }

  return retainedBytes;
}

function purgeExpired(entries: Map<string, CacheEntry>, now: number, totalBytes: number): number {
  let retainedBytes = totalBytes;
  for (const [key, entry] of entries) {
    if (isExpired(entry, now)) {
      deleteEntry(entries, key, (bytes) => {
        retainedBytes -= bytes;
      });
    }
  }

  return retainedBytes;
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt <= now;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function deleteEntry(
  entries: Map<string, CacheEntry>,
  key: string,
  subtractBytes: (bytes: number) => void,
): void {
  const entry = entries.get(key);

  if (!entry) {
    return;
  }

  entries.delete(key);
  subtractBytes(entry.value.byteLength);
}
