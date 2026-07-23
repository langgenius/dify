import { type PlatformAdapter, collectPlatformHealth } from "@knowledge/core";

import { createMemoryCacheAdapter } from "./cache";
import { createSchemaDatabaseAdapter } from "./database";
import { createDifyObjectStorageAdapter } from "./dify-object-storage";
import { createInlineJobQueueAdapter } from "./job-queue";
import { type PgBossClient, createPgBossJobQueueAdapter } from "./pg-boss-job-queue";
import {
  type PostgresPoolLike,
  checkPostgresHealth,
  createPostgresDatabaseExecutor,
  createPostgresPool,
} from "./postgres";

type RuntimeEnv = Readonly<Record<string, string | undefined>>;

export interface NodePlatformAdapterOptions {
  readonly databasePool?: PostgresPoolLike;
  readonly difyStorageFetch?: typeof globalThis.fetch;
  readonly env?: RuntimeEnv;
  readonly jobBoss?: PgBossClient;
}

const maxObjectBytes = 64 * 1024 * 1024;
const defaultDifyInnerApiUrl = "http://localhost:5001";
const defaultDifyInnerApiKey = "QaHbTe77CtuXmsfyhR7+vRjI/+XbV1AaFy691iy+kGDv2Jvy0/eAh8Y1";

export function createNodePlatformAdapter(
  options: NodePlatformAdapterOptions = {},
): PlatformAdapter {
  const env = options.env ?? process.env;
  const database = createNodeDatabaseAdapter(env, options.databasePool);
  const adapter: PlatformAdapter = {
    runtime: "node-docker",
    database,
    objectStorage: createNodeObjectStorageAdapter(env, options.difyStorageFetch),
    cache: createMemoryCacheAdapter({ maxEntries: 10_000 }),
    jobs: options.jobBoss
      ? createPgBossJobQueueAdapter({
          boss: options.jobBoss,
          maxBatchSize: 100,
          maxQueuedJobs: 10_000,
        })
      : createInlineJobQueueAdapter({
          maxBatchSize: 100,
          maxQueuedJobs: 10_000,
        }),
    health: async () => collectPlatformHealth(adapter),
  };

  return adapter;
}

function createNodeDatabaseAdapter(env: RuntimeEnv, databasePool?: PostgresPoolLike) {
  const configuredUrl = env.DATABASE_URL?.trim();

  if (databasePool || configuredUrl) {
    const pool =
      databasePool ??
      createPostgresPool({
        connectionString: configuredUrl ?? "",
        connectionTimeoutMillis: parsePositiveInteger(env.POSTGRES_CONNECTION_TIMEOUT_MS, 5_000),
        idleTimeoutMillis: parsePositiveInteger(env.POSTGRES_IDLE_TIMEOUT_MS, 10_000),
        max: parsePositiveInteger(env.POSTGRES_POOL_MAX, 10),
      });
    const executor = createPostgresDatabaseExecutor({ pool });
    const close = pool.end ? () => pool.end?.() ?? Promise.resolve() : undefined;

    return createSchemaDatabaseAdapter({
      ...(close ? { close } : {}),
      executor: executor.execute,
      health: () => checkPostgresHealth(pool),
      kind: "postgres",
      transaction: executor.transaction,
    });
  }

  return createSchemaDatabaseAdapter({ kind: "postgres" });
}

function createNodeObjectStorageAdapter(
  env: RuntimeEnv,
  difyStorageFetch?: typeof globalThis.fetch,
) {
  return createDifyObjectStorageAdapter({
    apiKey: env.DIFY_INNER_API_KEY?.trim() || defaultDifyInnerApiKey,
    baseUrl: env.DIFY_INNER_API_URL?.trim() || defaultDifyInnerApiUrl,
    ...(difyStorageFetch ? { fetch: difyStorageFetch } : {}),
    maxObjectBytes,
  });
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}
