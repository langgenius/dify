import { describe, expect, it } from "vitest";

import {
  type PlatformAdapter,
  closePlatformAdapter,
  collectPlatformHealth,
} from "./platform-adapter";

describe("collectPlatformHealth", () => {
  it("aggregates component health into a runtime health result", async () => {
    const adapter: PlatformAdapter = {
      runtime: "node-docker",
      database: {
        kind: "postgres",
        dialect: "postgres",
        checkPerformanceIndexes: async () => ({ missing: [], ok: true }),
        execute: async () => ({ rows: [], rowsAffected: 0 }),
        getCapabilities: async () => ({
          consistency: "strong",
          estimatedFullTextSearchP99Ms: 30,
          estimatedVectorSearchP99Ms: 50,
          fullTextCjkNative: false,
          maxVectorDimensions: 16_384,
          maxVectors: 5_000_000,
          permissionFiltering: "sql-where",
          publicationStrategy: "projection-table",
          supportsBlueGreenTableSwap: false,
          supportsConcurrentVectorAndFullText: true,
          supportsDenseVector: true,
          supportsFullText: true,
          supportsRecursiveCte: true,
          type: "postgres",
        }),
        getSchemaSummary: async () => ({
          dialect: "postgres",
          indexes: [],
          tables: [],
        }),
        health: async () => true,
        planBatchGetRows: async ({ ids, tableName }) => ({
          accessPattern: "primary-key-batch",
          cursorColumns: [],
          limit: ids.length,
          params: [...ids],
          sql: "",
          tableName,
        }),
        planListRows: async ({ indexName, limit, orderBy, tableName }) => ({
          accessPattern: "indexed-list",
          cursorColumns: orderBy.map((order) => order.column),
          indexName,
          limit,
          params: [],
          sql: "",
          tableName,
        }),
        renderMigrationSql: async () => [],
        transaction: async (callback) =>
          callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
      },
      objectStorage: {
        kind: "memory",
        deleteObject: async () => undefined,
        getObject: async () => null,
        getObjectStream: async () => null,
        health: async () => true,
        headObject: async () => null,
        listObjects: async () => ({ objects: [] }),
        putObject: async ({ body, key }) => ({
          key,
          metadata: {},
          sizeBytes: body.byteLength,
        }),
      },
      cache: {
        kind: "memory",
        delete: async () => undefined,
        get: async () => null,
        health: async () => true,
        set: async () => undefined,
        stats: async () => ({ entries: 0, totalBytes: 0 }),
      },
      jobs: {
        kind: "inline",
        cancel: async () => undefined,
        complete: async () => undefined,
        dequeue: async () => [],
        enqueue: async ({ payload, type }) => ({
          attempts: 0,
          createdAt: 0,
          id: "job-1",
          payload,
          status: "queued",
          type,
        }),
        fail: async () => undefined,
        heartbeat: async ({ jobId, workerId }) => ({
          attempts: 1,
          createdAt: 0,
          id: jobId,
          payload: null,
          status: "running",
          type: "test",
          workerId,
        }),
        health: async () => true,
        lease: async () => [],
        retry: async () => undefined,
        stats: async () => ({ canceled: 0, completed: 0, failed: 0, queued: 0, running: 0 }),
        status: async () => null,
      },
      health: async () => ({
        ok: true,
        runtime: "node-docker",
        components: {},
      }),
    };

    await expect(collectPlatformHealth(adapter)).resolves.toEqual({
      ok: true,
      runtime: "node-docker",
      components: {
        cache: true,
        database: true,
        jobs: true,
        objectStorage: true,
      },
    });
  });

  it("reports a component as unhealthy when its health check throws", async () => {
    const adapter: PlatformAdapter = {
      ...(await createHealthyPlatformAdapter()),
      objectStorage: {
        ...(await createHealthyPlatformAdapter()).objectStorage,
        health: async () => {
          throw new Error("storage unavailable");
        },
      },
    };

    await expect(collectPlatformHealth(adapter)).resolves.toEqual({
      ok: false,
      runtime: "node-docker",
      components: {
        cache: true,
        database: true,
        jobs: true,
        objectStorage: false,
      },
    });
  });
});

describe("closePlatformAdapter", () => {
  it("calls optional close hooks exactly once and tolerates missing hooks", async () => {
    const calls: string[] = [];
    const adapter: PlatformAdapter = {
      ...(await createHealthyPlatformAdapter()),
      database: {
        ...(await createHealthyPlatformAdapter()).database,
        close: async () => {
          calls.push("database");
        },
      },
      objectStorage: {
        ...(await createHealthyPlatformAdapter()).objectStorage,
        close: async () => {
          calls.push("objectStorage");
        },
      },
      cache: {
        ...(await createHealthyPlatformAdapter()).cache,
      },
      jobs: {
        ...(await createHealthyPlatformAdapter()).jobs,
        close: async () => {
          calls.push("jobs");
        },
      },
    };

    await closePlatformAdapter(adapter);
    await closePlatformAdapter(adapter);

    expect(calls).toEqual(["database", "objectStorage", "jobs"]);
  });

  it("closes the cache and platform adapter when both hooks are available", async () => {
    const closed = {
      cache: 0,
      platform: 0,
    };
    const healthyAdapter = await createHealthyPlatformAdapter();
    const adapter: PlatformAdapter = {
      ...healthyAdapter,
      cache: {
        ...healthyAdapter.cache,
        close: async () => {
          closed.cache += 1;
        },
      },
      close: async () => {
        closed.platform += 1;
      },
    };

    await closePlatformAdapter(adapter);
    await closePlatformAdapter(adapter);

    expect(closed).toEqual({
      cache: 1,
      platform: 1,
    });
  });
});

async function createHealthyPlatformAdapter(): Promise<PlatformAdapter> {
  return {
    runtime: "node-docker",
    database: {
      kind: "postgres",
      dialect: "postgres",
      checkPerformanceIndexes: async () => ({ missing: [], ok: true }),
      execute: async () => ({ rows: [], rowsAffected: 0 }),
      getCapabilities: async () => ({
        consistency: "strong",
        estimatedFullTextSearchP99Ms: 30,
        estimatedVectorSearchP99Ms: 50,
        fullTextCjkNative: false,
        maxVectorDimensions: 16_384,
        maxVectors: 5_000_000,
        permissionFiltering: "sql-where",
        publicationStrategy: "projection-table",
        supportsBlueGreenTableSwap: false,
        supportsConcurrentVectorAndFullText: true,
        supportsDenseVector: true,
        supportsFullText: true,
        supportsRecursiveCte: true,
        type: "postgres",
      }),
      getSchemaSummary: async () => ({
        dialect: "postgres",
        indexes: [],
        tables: [],
      }),
      health: async () => true,
      planBatchGetRows: async ({ ids, tableName }) => ({
        accessPattern: "primary-key-batch",
        cursorColumns: [],
        limit: ids.length,
        params: [...ids],
        sql: "",
        tableName,
      }),
      planListRows: async ({ indexName, limit, orderBy, tableName }) => ({
        accessPattern: "indexed-list",
        cursorColumns: orderBy.map((order) => order.column),
        indexName,
        limit,
        params: [],
        sql: "",
        tableName,
      }),
      renderMigrationSql: async () => [],
      transaction: async (callback) =>
        callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
    },
    objectStorage: {
      kind: "memory",
      deleteObject: async () => undefined,
      getObject: async () => null,
      getObjectStream: async () => null,
      health: async () => true,
      headObject: async () => null,
      listObjects: async () => ({ objects: [] }),
      putObject: async ({ body, key }) => ({
        key,
        metadata: {},
        sizeBytes: body.byteLength,
      }),
    },
    cache: {
      kind: "memory",
      delete: async () => undefined,
      get: async () => null,
      health: async () => true,
      set: async () => undefined,
      stats: async () => ({ entries: 0, totalBytes: 0 }),
    },
    jobs: {
      kind: "inline",
      cancel: async () => undefined,
      complete: async () => undefined,
      dequeue: async () => [],
      enqueue: async ({ payload, type }) => ({
        attempts: 0,
        createdAt: 0,
        id: "job-1",
        payload,
        status: "queued",
        type,
      }),
      fail: async () => undefined,
      heartbeat: async ({ jobId, workerId }) => ({
        attempts: 1,
        createdAt: 0,
        id: jobId,
        payload: null,
        status: "running",
        type: "test",
        workerId,
      }),
      health: async () => true,
      lease: async () => [],
      retry: async () => undefined,
      stats: async () => ({ canceled: 0, completed: 0, failed: 0, queued: 0, running: 0 }),
      status: async () => null,
    },
    health: async () => ({
      ok: true,
      runtime: "node-docker",
      components: {},
    }),
  };
}
