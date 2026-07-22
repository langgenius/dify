import { z } from "zod";

export const RuntimeTargetSchema = z.enum(["cloudflare-workers", "node-docker"]);
export type RuntimeTarget = z.infer<typeof RuntimeTargetSchema>;

export const HealthStatusSchema = z.object({
  ok: z.boolean(),
  runtime: RuntimeTargetSchema,
  components: z.record(z.string(), z.boolean()).default({}),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export interface DatabaseAdapter {
  readonly kind: "tidb" | "postgres";
  readonly dialect: "tidb" | "postgres";
  checkPerformanceIndexes(): Promise<DatabasePerformanceIndexStatus>;
  close?(): Promise<void>;
  execute(input: DatabaseExecuteInput): Promise<DatabaseExecuteResult>;
  getCapabilities(): Promise<DatabaseCapabilities>;
  getSchemaSummary(): Promise<DatabaseSchemaSummary>;
  health(): Promise<boolean>;
  planBatchGetRows(input: DatabaseBatchGetRowsInput): Promise<DatabaseQueryPlan>;
  planListRows(input: DatabaseListRowsInput): Promise<DatabaseQueryPlan>;
  renderMigrationSql(): Promise<readonly string[]>;
  transaction<T>(callback: DatabaseTransactionCallback<T>): Promise<T>;
}

export interface DatabaseCapabilities {
  readonly consistency: "strong";
  readonly estimatedFullTextSearchP99Ms: number;
  readonly estimatedVectorSearchP99Ms: number;
  readonly fullTextCjkNative: boolean;
  readonly maxVectorDimensions: number;
  readonly maxVectors: number;
  readonly permissionFiltering: "sql-where";
  readonly publicationStrategy: "projection-table" | "table-swap";
  readonly supportsBlueGreenTableSwap: boolean;
  readonly supportsConcurrentVectorAndFullText: boolean;
  readonly supportsDenseVector: boolean;
  readonly supportsFullText: boolean;
  readonly supportsRecursiveCte: boolean;
  readonly type: DatabaseAdapter["kind"];
}

export type DatabaseQueryValue = null | boolean | number | string;
export type DatabaseExecuteOperation = "delete" | "insert" | "schema" | "select" | "update";
export type DatabaseRow = Readonly<Record<string, unknown>>;

export interface DatabaseExecuteInput {
  readonly maxRows: number;
  readonly operation: DatabaseExecuteOperation;
  readonly params: readonly DatabaseQueryValue[];
  readonly sql: string;
  readonly tableName: string;
}

export interface DatabaseExecuteResult {
  readonly rows: readonly DatabaseRow[];
  readonly rowsAffected: number;
}

export interface DatabaseExecutor {
  execute(input: DatabaseExecuteInput): Promise<DatabaseExecuteResult>;
}

export type DatabaseTransactionCallback<T> = (executor: DatabaseExecutor) => Promise<T>;

export interface DatabaseTransactionRunner {
  transaction<T>(callback: DatabaseTransactionCallback<T>): Promise<T>;
}

export interface DatabaseQueryFilter {
  readonly column: string;
  readonly operator: "eq";
  readonly value: DatabaseQueryValue;
}

export interface DatabaseQueryOrder {
  readonly column: string;
  readonly direction: "asc" | "desc";
}

export interface DatabaseCursor {
  readonly values: readonly DatabaseQueryValue[];
}

export interface DatabaseListRowsInput {
  readonly cursor?: DatabaseCursor;
  readonly filters: readonly DatabaseQueryFilter[];
  readonly indexName: string;
  readonly limit: number;
  readonly orderBy: readonly DatabaseQueryOrder[];
  readonly tableName: string;
}

export interface DatabaseBatchGetRowsInput {
  readonly idColumn?: string;
  readonly ids: readonly string[];
  readonly tableName: string;
}

export interface DatabaseQueryPlan {
  readonly accessPattern: "indexed-list" | "primary-key-batch";
  readonly cursorColumns: readonly string[];
  readonly indexName?: string;
  readonly limit: number;
  readonly params: readonly DatabaseQueryValue[];
  readonly sql: string;
  readonly tableName: string;
}

export interface DatabaseSchemaIndexSummary {
  readonly columns: readonly string[];
  readonly name: string;
  readonly purpose: string;
  readonly tableName: string;
  readonly unique: boolean;
}

export interface DatabaseSchemaSummary {
  readonly dialect: DatabaseAdapter["dialect"];
  readonly indexes: readonly DatabaseSchemaIndexSummary[];
  readonly tables: readonly string[];
}

export interface DatabasePerformanceIndexStatus {
  readonly missing: readonly {
    readonly indexName: string;
    readonly purpose: string;
    readonly tableName: string;
  }[];
  readonly ok: boolean;
}

export interface ObjectMetadata {
  readonly checksumSha256Base64?: string;
  readonly contentType?: string;
  readonly key: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly sizeBytes: number;
}

export interface PutObjectInput {
  readonly body: Uint8Array;
  readonly checksumSha256Base64?: string;
  readonly contentType?: string;
  readonly key: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ListObjectsInput {
  readonly cursor?: string;
  readonly limit: number;
  readonly prefix: string;
}

export interface ListObjectsResult {
  readonly nextCursor?: string;
  readonly objects: readonly ObjectMetadata[];
}

/** A short-lived, bearer-like object-store URL. Callers must never persist or log `url`. */
export interface PresignedObjectUpload {
  readonly expiresAt: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "PUT";
  readonly url: string;
}

export interface PresignPutObjectInput {
  readonly checksumSha256Base64?: string;
  readonly contentLength: number;
  readonly contentType?: string;
  readonly expiresInSeconds: number;
  readonly key: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CreateMultipartObjectUploadInput {
  readonly contentType?: string;
  readonly key: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface MultipartObjectUpload {
  readonly key: string;
  readonly uploadId: string;
}

export interface PresignMultipartObjectPartInput {
  readonly checksumSha256Base64?: string;
  readonly contentLength: number;
  readonly expiresInSeconds: number;
  readonly key: string;
  readonly partNumber: number;
  readonly uploadId: string;
}

export interface CompletedMultipartObjectPart {
  readonly checksumSha256Base64?: string;
  readonly etag: string;
  readonly partNumber: number;
}

export interface CompleteMultipartObjectUploadInput {
  readonly key: string;
  readonly parts: readonly CompletedMultipartObjectPart[];
  readonly uploadId: string;
}

export interface VerifyObjectSha256Input {
  readonly checksumSha256Base64: string;
  readonly expectedSizeBytes: number;
  readonly key: string;
}

export interface AbortMultipartObjectUploadInput {
  readonly key: string;
  readonly uploadId: string;
}

export interface IncompleteMultipartUploadLifecycleInput {
  readonly daysAfterInitiation: number;
}

/**
 * Optional data-plane capability. Its absence is deliberate for local/memory storage so product
 * code can offer only the separately bounded small-file fallback instead of silently proxying a
 * large body through the API process.
 */
export interface ObjectStorageDirectUploadAdapter {
  abortMultipartUpload(input: AbortMultipartObjectUploadInput): Promise<void>;
  completeMultipartUpload(input: CompleteMultipartObjectUploadInput): Promise<void>;
  createMultipartUpload(input: CreateMultipartObjectUploadInput): Promise<MultipartObjectUpload>;
  ensureIncompleteMultipartUploadLifecycle(
    input: IncompleteMultipartUploadLifecycleInput,
  ): Promise<void>;
  presignMultipartPart(input: PresignMultipartObjectPartInput): Promise<PresignedObjectUpload>;
  presignPutObject(input: PresignPutObjectInput): Promise<PresignedObjectUpload>;
  /** Streams the stored object through a bounded digest; implementations must never buffer it whole. */
  verifyObjectSha256(input: VerifyObjectSha256Input): Promise<boolean>;
}

export interface ObjectStorageAdapter {
  readonly kind: "r2" | "s3-compatible" | "local" | "memory";
  close?(): Promise<void>;
  deleteObject(key: string): Promise<void>;
  readonly directUpload?: ObjectStorageDirectUploadAdapter;
  getObject(key: string): Promise<Uint8Array | null>;
  getObjectStream(key: string): Promise<ReadableStream<Uint8Array> | null>;
  health(): Promise<boolean>;
  headObject(key: string): Promise<ObjectMetadata | null>;
  listObjects(input: ListObjectsInput): Promise<ListObjectsResult>;
  putObject(input: PutObjectInput): Promise<ObjectMetadata>;
}

export interface CacheAdapter {
  readonly kind: "kv" | "redis" | "memory";
  close?(): Promise<void>;
  delete(key: string): Promise<void>;
  /** Optional bounded namespace cleanup used by durable deletion workers. */
  deletePrefix?(input: {
    readonly cursor?: string;
    readonly limit: number;
    readonly prefix: string;
  }): Promise<{ readonly deleted: number; readonly nextCursor?: string }>;
  get(key: string, options?: { readonly now?: number }): Promise<Uint8Array | null>;
  health(): Promise<boolean>;
  set(key: string, value: Uint8Array, options?: { readonly ttlMs?: number }): Promise<void>;
  stats(): Promise<{
    readonly entries: number;
    readonly totalBytes: number;
  }>;
}

export type JobPayload =
  | null
  | boolean
  | number
  | string
  | readonly JobPayload[]
  | { readonly [key: string]: JobPayload };

export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface JobRecord {
  readonly attempts: number;
  readonly canceledAt?: number;
  readonly completedAt?: number;
  readonly createdAt: number;
  readonly error?: string;
  readonly externalJobId?: string;
  readonly failedAt?: number;
  readonly heartbeatAt?: number;
  readonly id: string;
  readonly idempotencyKey?: string;
  readonly leaseExpiresAt?: number;
  readonly payload: JobPayload;
  readonly runAfter?: number;
  readonly startedAt?: number;
  readonly status: JobStatus;
  readonly type: string;
  readonly workerId?: string;
}

export interface EnqueueJobInput {
  readonly idempotencyKey?: string;
  readonly payload: JobPayload;
  readonly runAfter?: number;
  readonly type: string;
}

export interface DequeueJobsInput {
  readonly limit: number;
  readonly now?: number;
  readonly types?: readonly string[];
  readonly workerId: string;
}

export interface LeaseJobsInput extends DequeueJobsInput {
  readonly leaseMs: number;
}

export interface HeartbeatJobInput {
  readonly jobId: string;
  readonly leaseMs: number;
  readonly now?: number;
  readonly workerId: string;
}

export interface FailJobOptions {
  readonly retryAt?: number;
}

export interface RetryJobOptions {
  readonly runAfter?: number;
}

export interface JobQueueStats {
  readonly canceled: number;
  readonly completed: number;
  readonly failed: number;
  readonly queued: number;
  readonly running: number;
}

export interface JobQueueAdapter {
  readonly kind: "cloudflare-queues" | "pg-boss" | "inline";
  cancel(jobId: string, reason?: string): Promise<void>;
  close?(): Promise<void>;
  complete(jobId: string): Promise<void>;
  dequeue(input: DequeueJobsInput): Promise<readonly JobRecord[]>;
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  fail(jobId: string, error: string, options?: FailJobOptions): Promise<void>;
  heartbeat(input: HeartbeatJobInput): Promise<JobRecord>;
  health(): Promise<boolean>;
  lease(input: LeaseJobsInput): Promise<readonly JobRecord[]>;
  retry(jobId: string, options?: RetryJobOptions): Promise<void>;
  stats(): Promise<JobQueueStats>;
  status(jobId: string): Promise<JobRecord | null>;
}

export interface PlatformAdapter {
  readonly runtime: RuntimeTarget;
  readonly database: DatabaseAdapter;
  readonly objectStorage: ObjectStorageAdapter;
  readonly cache: CacheAdapter;
  readonly jobs: JobQueueAdapter;
  close?(): Promise<void>;
  health(): Promise<HealthStatus>;
}

const closedPlatformAdapters = new WeakSet<PlatformAdapter>();

export async function closePlatformAdapter(adapter: PlatformAdapter): Promise<void> {
  if (closedPlatformAdapters.has(adapter)) {
    return;
  }

  closedPlatformAdapters.add(adapter);

  await Promise.all([
    adapter.database.close?.(),
    adapter.objectStorage.close?.(),
    adapter.cache.close?.(),
    adapter.jobs.close?.(),
    adapter.close?.(),
  ]);
}

export async function collectPlatformHealth(adapter: PlatformAdapter): Promise<HealthStatus> {
  const [database, objectStorage, cache, jobs] = await Promise.all([
    safeHealthCheck(() => adapter.database.health()),
    safeHealthCheck(() => adapter.objectStorage.health()),
    safeHealthCheck(() => adapter.cache.health()),
    safeHealthCheck(() => adapter.jobs.health()),
  ]);

  return HealthStatusSchema.parse({
    ok: database && objectStorage && cache && jobs,
    runtime: adapter.runtime,
    components: {
      cache,
      database,
      jobs,
      objectStorage,
    },
  });
}

async function safeHealthCheck(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}
