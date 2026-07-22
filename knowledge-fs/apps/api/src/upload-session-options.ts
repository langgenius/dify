import { randomUUID } from "node:crypto";

import {
  type CapabilityGrantProvenanceRepository,
  type DocumentAssetRepository,
  type DocumentCompilationJobStateMachine,
  type KnowledgeGatewayOptions,
  type KnowledgePathRepository,
  type KnowledgeSpaceManifestRepository,
  type LogicalDocumentRepository,
  type StorageQuotaRepository,
  type UploadSessionOperationalMetrics,
  type UploadSessionRepository,
  type UploadSessionService,
  createEmbeddingProfileFreezingDocumentAssetRepository,
  createKnowledgeSpaceManifestStorageQuotaRepository,
  createUploadSessionDocumentCompletionPublisher,
  createUploadSessionService,
} from "@knowledge/api";

import { parseDirectAllowedOrigins } from "./direct-transport-security";

export interface ApiUploadSessionEnv {
  readonly KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_BATCH_SIZE?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_INTERVAL_MS?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_STALE_MS?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_ENABLED?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_INCOMPLETE_MULTIPART_DAYS?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_MAX_FILE_BYTES?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_PART_BYTES?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_THRESHOLD_BYTES?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_PRESIGN_TTL_SECONDS?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_SESSION_TTL_MS?: string | undefined;
  readonly KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_BYTES?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export interface ApiUploadSessionOptions {
  readonly allowedOrigins: readonly string[];
  readonly cleanupBatchSize: number;
  readonly cleanupIntervalMs: number;
  readonly cleanupStaleMs: number;
  readonly incompleteMultipartDays: number;
  readonly maxFileBytes: number;
  readonly multipartPartSizeBytes: number;
  readonly multipartThresholdBytes: number;
  readonly presignTtlSeconds: number;
  readonly sessionTtlMs: number;
  readonly smallFileFallbackMaxBytes: number;
}

export interface ApiUploadSessionCleanupTickResult {
  readonly expired: number;
  readonly failed: number;
  readonly skipped: boolean;
}

export interface ApiUploadSessionCleanupRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<ApiUploadSessionCleanupTickResult>;
}

export interface ApiUploadSessionAssembly {
  readonly ready: boolean;
  readonly sessions?: UploadSessionService | undefined;
  readonly storageQuotas?: StorageQuotaRepository | undefined;
  start(): void;
  stop(): void;
}

export interface ApiUploadSessionRepositories {
  readonly assets?: DocumentAssetRepository | undefined;
  readonly capabilityGrants?: CapabilityGrantProvenanceRepository | undefined;
  readonly compilationJobs?: DocumentCompilationJobStateMachine | undefined;
  readonly logicalDocuments?: LogicalDocumentRepository | undefined;
  readonly manifests?: KnowledgeSpaceManifestRepository | undefined;
  readonly paths?: KnowledgePathRepository | undefined;
  readonly sessions?: UploadSessionRepository | undefined;
  readonly usesDatabaseRepositories: boolean;
}

const mebibyte = 1024 * 1024;

export function createApiUploadSessionOptions(
  env: ApiUploadSessionEnv = process.env,
): ApiUploadSessionOptions | undefined {
  if (!enabled(env.KNOWLEDGE_DIRECT_UPLOAD_ENABLED)) return undefined;

  const allowedOrigins = parseDirectAllowedOrigins({
    environment: env.NODE_ENV,
    name: "KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS",
    value: env.KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS,
  });
  const maxFileBytes = positiveInteger(
    env.KNOWLEDGE_DIRECT_UPLOAD_MAX_FILE_BYTES,
    100 * 1024 * mebibyte,
    "KNOWLEDGE_DIRECT_UPLOAD_MAX_FILE_BYTES",
  );
  const multipartPartSizeBytes = boundedInteger(
    env.KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_PART_BYTES,
    16 * mebibyte,
    "KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_PART_BYTES",
    5 * mebibyte,
    5 * 1024 * mebibyte,
  );
  const multipartThresholdBytes = positiveInteger(
    env.KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_THRESHOLD_BYTES,
    64 * mebibyte,
    "KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_THRESHOLD_BYTES",
  );
  const smallFileFallbackMaxBytes = nonnegativeInteger(
    env.KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_BYTES,
    8 * mebibyte,
    "KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_BYTES",
  );
  if (multipartThresholdBytes > maxFileBytes) {
    throw new Error(
      "KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_THRESHOLD_BYTES must not exceed KNOWLEDGE_DIRECT_UPLOAD_MAX_FILE_BYTES",
    );
  }
  if (smallFileFallbackMaxBytes >= multipartThresholdBytes) {
    throw new Error(
      "KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_BYTES must be below KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_THRESHOLD_BYTES",
    );
  }
  if (Math.ceil(maxFileBytes / multipartPartSizeBytes) > 10_000) {
    throw new Error(
      "KNOWLEDGE_DIRECT_UPLOAD_MAX_FILE_BYTES requires more than 10000 configured multipart parts",
    );
  }

  return {
    allowedOrigins,
    cleanupBatchSize: boundedInteger(
      env.KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_BATCH_SIZE,
      100,
      "KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_BATCH_SIZE",
      1,
      1_000,
    ),
    cleanupIntervalMs: positiveInteger(
      env.KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_INTERVAL_MS,
      60_000,
      "KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_INTERVAL_MS",
    ),
    cleanupStaleMs: positiveInteger(
      env.KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_STALE_MS,
      5 * 60_000,
      "KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_STALE_MS",
    ),
    incompleteMultipartDays: boundedInteger(
      env.KNOWLEDGE_DIRECT_UPLOAD_INCOMPLETE_MULTIPART_DAYS,
      2,
      "KNOWLEDGE_DIRECT_UPLOAD_INCOMPLETE_MULTIPART_DAYS",
      1,
      365,
    ),
    maxFileBytes,
    multipartPartSizeBytes,
    multipartThresholdBytes,
    presignTtlSeconds: boundedInteger(
      env.KNOWLEDGE_DIRECT_UPLOAD_PRESIGN_TTL_SECONDS,
      600,
      "KNOWLEDGE_DIRECT_UPLOAD_PRESIGN_TTL_SECONDS",
      1,
      900,
    ),
    sessionTtlMs: positiveInteger(
      env.KNOWLEDGE_DIRECT_UPLOAD_SESSION_TTL_MS,
      60 * 60_000,
      "KNOWLEDGE_DIRECT_UPLOAD_SESSION_TTL_MS",
    ),
    smallFileFallbackMaxBytes,
  };
}

export async function createApiUploadSessionAssembly(input: {
  readonly adapter: Pick<KnowledgeGatewayOptions["adapter"], "objectStorage">;
  readonly capabilityV2Configured: boolean;
  readonly config: ApiUploadSessionOptions | undefined;
  readonly metrics?: UploadSessionOperationalMetrics | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly repositories: ApiUploadSessionRepositories;
}): Promise<ApiUploadSessionAssembly | undefined> {
  if (!input.config) return undefined;
  const repositories = input.repositories;
  const releaseDispatch = repositories.compilationJobs?.releaseDispatch;
  if (
    !input.capabilityV2Configured ||
    !repositories.usesDatabaseRepositories ||
    !repositories.assets ||
    !repositories.capabilityGrants ||
    !repositories.compilationJobs ||
    !releaseDispatch ||
    !repositories.logicalDocuments ||
    !repositories.manifests ||
    !repositories.paths ||
    !repositories.sessions
  ) {
    return unavailableUploadSessionAssembly();
  }

  try {
    await input.adapter.objectStorage.directUpload?.ensureIncompleteMultipartUploadLifecycle({
      daysAfterInitiation: input.config.incompleteMultipartDays,
    });
  } catch (error) {
    input.onError?.(error);
    return unavailableUploadSessionAssembly();
  }

  const assets = createEmbeddingProfileFreezingDocumentAssetRepository({
    assets: repositories.assets,
    manifests: repositories.manifests,
  });
  const publisher = createUploadSessionDocumentCompletionPublisher({
    assets,
    compilationJobs: {
      releaseDispatch: releaseDispatch.bind(repositories.compilationJobs),
      start: repositories.compilationJobs.start.bind(repositories.compilationJobs),
    },
    grants: repositories.capabilityGrants,
    logicalDocuments: repositories.logicalDocuments,
    paths: repositories.paths,
  });
  const storageQuotas = createKnowledgeSpaceManifestStorageQuotaRepository({
    manifests: repositories.manifests,
  });
  const sessions = createUploadSessionService({
    completionPublisher: publisher,
    generateId: randomUUID,
    maxFileBytes: input.config.maxFileBytes,
    multipartPartSizeBytes: input.config.multipartPartSizeBytes,
    multipartThresholdBytes: input.config.multipartThresholdBytes,
    ...(input.metrics ? { metrics: input.metrics } : {}),
    objectStorage: input.adapter.objectStorage,
    objectStorageUsage: assets,
    presignTtlSeconds: input.config.presignTtlSeconds,
    quotas: storageQuotas,
    repository: repositories.sessions,
    sessionTtlMs: input.config.sessionTtlMs,
    smallFileFallbackMaxBytes: input.config.smallFileFallbackMaxBytes,
  });
  const cleanup = createApiUploadSessionCleanupRuntime({
    cleanupBatchSize: input.config.cleanupBatchSize,
    cleanupIntervalMs: input.config.cleanupIntervalMs,
    cleanupStaleMs: input.config.cleanupStaleMs,
    ...(input.onError ? { onError: input.onError } : {}),
    sessions,
  });
  return {
    ready: true,
    sessions,
    storageQuotas,
    start: cleanup.start,
    stop: cleanup.stop,
  };
}

export function createApiUploadSessionCleanupRuntime(input: {
  readonly cleanupBatchSize: number;
  readonly cleanupIntervalMs: number;
  readonly cleanupStaleMs: number;
  readonly now?: (() => number) | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly sessions: Pick<UploadSessionService, "cleanupExpired">;
}): ApiUploadSessionCleanupRuntime {
  const cleanupBatchSize = boundedValue(input.cleanupBatchSize, "cleanupBatchSize", 1, 1_000);
  const cleanupIntervalMs = boundedValue(
    input.cleanupIntervalMs,
    "cleanupIntervalMs",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const cleanupStaleMs = boundedValue(
    input.cleanupStaleMs,
    "cleanupStaleMs",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const now = input.now ?? Date.now;
  let active = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<ApiUploadSessionCleanupTickResult> => {
    if (active) return { expired: 0, failed: 0, skipped: true };
    active = true;
    try {
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < cleanupStaleMs) {
        throw new Error("Upload session cleanup clock is outside the configured stale window");
      }
      const result = await input.sessions.cleanupExpired({
        limit: cleanupBatchSize,
        staleBefore: timestamp - cleanupStaleMs,
      });
      return { ...result, skipped: false };
    } catch (error) {
      input.onError?.(error);
      return { expired: 0, failed: 1, skipped: false };
    } finally {
      active = false;
    }
  };

  return {
    start: () => {
      if (timer) return;
      timer = setInterval(() => void tick(), cleanupIntervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}

function enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "on") return true;
  throw new Error("KNOWLEDGE_DIRECT_UPLOAD_ENABLED must be on/true/1 or off/false/0");
}

function unavailableUploadSessionAssembly(): ApiUploadSessionAssembly {
  return {
    ready: false,
    start: () => undefined,
    stop: () => undefined,
  };
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  return boundedInteger(value, fallback, name, 1, Number.MAX_SAFE_INTEGER);
}

function nonnegativeInteger(value: string | undefined, fallback: number, name: string): number {
  return boundedInteger(value, fallback, name, 0, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  const raw = value?.trim();
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a safe integer between ${min} and ${max}`);
  }
  return parsed;
}

function boundedValue(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Upload session ${name} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}
