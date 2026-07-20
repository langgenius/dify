import { S3Client } from "@aws-sdk/client-s3";
import { type PlatformAdapter, collectPlatformHealth } from "@knowledge/core";

import { createMemoryCacheAdapter } from "./cache";
import {
  type CloudflareJobStateStore,
  type CloudflareQueueBinding,
  createCloudflareJobQueueAdapter,
} from "./cloudflare-job-queue";
import { createSchemaDatabaseAdapter } from "./database";
import {
  type S3ObjectStorageClient,
  createMemoryObjectStorageAdapter,
  createS3ObjectStorageAdapter,
} from "./object-storage";

type RuntimeEnv = Readonly<Record<string, string | undefined>>;

export interface CloudflarePlatformAdapterOptions {
  readonly env?: RuntimeEnv;
  readonly jobQueue?: CloudflareQueueBinding;
  readonly jobStateStore?: CloudflareJobStateStore;
  readonly objectStorageClient?: S3ObjectStorageClient;
}

const maxObjectBytes = 64 * 1024 * 1024;
const maxMemoryObjects = 10_000;
const maxMemoryObjectBytes = maxObjectBytes * maxMemoryObjects;

export function createCloudflarePlatformAdapter(
  options: CloudflarePlatformAdapterOptions = {},
): PlatformAdapter {
  const env = options.env ?? {};
  const adapter: PlatformAdapter = {
    runtime: "cloudflare-workers",
    database: createSchemaDatabaseAdapter({ kind: "tidb" }),
    objectStorage: createCloudflareObjectStorageAdapter(env, options.objectStorageClient),
    cache: createMemoryCacheAdapter({ maxEntries: 10_000 }),
    jobs: createCloudflareJobQueueAdapter({
      ...(options.jobQueue ? { queue: options.jobQueue } : {}),
      ...(options.jobStateStore ? { state: options.jobStateStore } : {}),
      maxBatchSize: 100,
      maxQueuedJobs: 10_000,
    }),
    health: async () => collectPlatformHealth(adapter),
  };

  return adapter;
}

function createCloudflareObjectStorageAdapter(
  env: RuntimeEnv,
  objectStorageClient?: S3ObjectStorageClient,
) {
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const bucket = env.R2_BUCKET?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();

  if (accessKeyId && accountId && bucket && secretAccessKey) {
    const client =
      objectStorageClient ??
      new S3Client({
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        endpoint: env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
        region: env.R2_REGION?.trim() || "auto",
      });

    return createS3ObjectStorageAdapter({
      bucket,
      client,
      kind: "r2",
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
