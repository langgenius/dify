import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { type PlatformAdapter, collectPlatformHealth } from "@knowledge/core";

import { createMemoryCacheAdapter } from "./cache";
import { createSchemaDatabaseAdapter } from "./database";
import { createInlineJobQueueAdapter } from "./job-queue";
import {
  type S3ObjectStorageClient,
  createMemoryObjectStorageAdapter,
  createS3ObjectStorageAdapter,
} from "./object-storage";
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
  readonly env?: RuntimeEnv;
  readonly jobBoss?: PgBossClient;
  readonly objectStorageClient?: S3ObjectStorageClient;
}

const maxObjectBytes = 64 * 1024 * 1024;
const maxMemoryObjects = 10_000;
const maxMemoryObjectBytes = maxObjectBytes * maxMemoryObjects;

export function createNodePlatformAdapter(
  options: NodePlatformAdapterOptions = {},
): PlatformAdapter {
  const env = options.env ?? process.env;
  const database = createNodeDatabaseAdapter(env, options.databasePool);
  const adapter: PlatformAdapter = {
    runtime: "node-docker",
    database,
    objectStorage: createNodeObjectStorageAdapter(env, options.objectStorageClient),
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

/**
 * Builds the S3 client config for the Node object-storage adapter. Static
 * credentials are only included when both `MINIO_ACCESS_KEY` and
 * `MINIO_SECRET_KEY` are present; otherwise they are omitted so the AWS SDK
 * resolves credentials through its default provider chain (e.g. an EC2 IAM
 * instance role or ECS task role).
 */
export function buildNodeS3ClientConfig(env: RuntimeEnv, endpoint: string): S3ClientConfig {
  const accessKeyId = env.MINIO_ACCESS_KEY?.trim();
  const secretAccessKey = env.MINIO_SECRET_KEY?.trim();

  return {
    endpoint,
    forcePathStyle: true,
    region: env.MINIO_REGION?.trim() || "us-east-1",
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  };
}

function createNodeObjectStorageAdapter(
  env: RuntimeEnv,
  objectStorageClient?: S3ObjectStorageClient,
) {
  const bucket = env.MINIO_BUCKET?.trim();
  const endpoint = env.MINIO_ENDPOINT?.trim();

  if (bucket && endpoint) {
    const client = objectStorageClient ?? new S3Client(buildNodeS3ClientConfig(env, endpoint));

    return createS3ObjectStorageAdapter({
      bucket,
      client,
      kind: "s3-compatible",
      maxObjectBytes,
    });
  }

  return createMemoryObjectStorageAdapter({
    kind: "memory",
    maxObjectBytes,
    maxObjects: maxMemoryObjects,
    maxTotalBytes: maxMemoryObjectBytes,
  });
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}
