import { randomUUID } from "node:crypto";

import {
  type DurableDeletionJob,
  type DurableDeletionOutboxDispatcher,
  type DurableDeletionRepository,
  type DurableDeletionRuntime,
  type KnowledgeGatewayOptions,
  type SourceSecretStore,
  assertEvidenceBundleScopeReady,
  createDatabaseDurableDeletionTargetCapabilities,
  createDatabasePollingDurableDeletionWakeSink,
  createDurableDeletionOutboxDispatcher,
  createDurableDeletionRuntime,
  createDurableDeletionTargetProcessors,
} from "@knowledge/api";

export interface ApiDurableDeletionAssembly {
  readonly dispatcher: DurableDeletionOutboxDispatcher;
  readonly runtime: DurableDeletionRuntime;
  start(): void;
  stop(): void;
}

export interface ApiDurableDeletionEnv {
  readonly DURABLE_DELETION_STEP_TIMEOUT_MS?: string | undefined;
}

export interface CreateApiDurableDeletionAssemblyOptions {
  readonly adapter: KnowledgeGatewayOptions["adapter"];
  readonly credentialMode?: "dify-managed" | "local" | undefined;
  readonly enabled: boolean;
  readonly env?: ApiDurableDeletionEnv | undefined;
  readonly production: boolean;
  readonly repository?: DurableDeletionRepository | undefined;
  readonly secretStore?: Pick<SourceSecretStore, "delete"> | undefined;
  readonly usesDatabaseRepositories: boolean;
}

export async function assertApiDurableDeletionDataReadiness({
  database,
  enabled,
}: {
  readonly database: KnowledgeGatewayOptions["adapter"]["database"];
  readonly enabled: boolean;
}): Promise<void> {
  if (!enabled) return;
  await assertEvidenceBundleScopeReady(database);
}

/** Production is fail-closed: HTTP request persistence and both background loops are one unit. */
export function createApiDurableDeletionAssembly({
  adapter,
  credentialMode = "local",
  enabled,
  env = process.env,
  production,
  repository,
  secretStore,
  usesDatabaseRepositories,
}: CreateApiDurableDeletionAssemblyOptions): ApiDurableDeletionAssembly | undefined {
  if (!enabled) return undefined;
  if (production && !usesDatabaseRepositories) {
    throw new Error("Production durable deletion requires database repositories");
  }
  if (!repository) {
    if (production) {
      throw new Error(
        "Production durable deletion requires DURABLE_DELETION_HMAC_KEY_BASE64 and its repository",
      );
    }
    return undefined;
  }
  if (credentialMode === "local" && !secretStore) {
    throw new Error("Durable deletion requires SourceSecretStore cleanup capability");
  }

  const capabilities = createDatabaseDurableDeletionTargetCapabilities({
    cache: adapter.cache,
    credentialMode,
    database: adapter.database,
    objectStorage: adapter.objectStorage,
    ...(secretStore ? { secretStore } : {}),
  });
  const processor = createDurableDeletionTargetProcessors({
    documentAsset: capabilities,
    initialRetryDelayMs: 1_000,
    inventoryPageSize: 100,
    itemBatchSize: 25,
    knowledgeSpace: capabilities,
    logicalDocument: capabilities,
    maxRetryDelayMs: 5 * 60_000,
    repository,
    source: capabilities,
  });
  const timing = resolveApiDurableDeletionRuntimeTiming(env);
  const runtime = createDurableDeletionRuntime({
    heartbeatIntervalMs: timing.heartbeatIntervalMs,
    initialRetryDelayMs: 1_000,
    intervalMs: 1_000,
    leaseMs: timing.leaseMs,
    maxBatchSize: 10,
    maxRetryDelayMs: 5 * 60_000,
    maxStepsPerLease: 25,
    onError: writeDurableDeletionErrorLog,
    processor,
    repository,
    stepTimeoutMs: timing.stepTimeoutMs,
    workerId: `durable-deletion:${randomUUID()}`,
  });
  const dispatcher = createDurableDeletionOutboxDispatcher({
    initialRetryDelayMs: 1_000,
    intervalMs: 500,
    lockMs: 30_000,
    maxBatchSize: 25,
    maxDispatchAttempts: 20,
    maxRetryDelayMs: 5 * 60_000,
    repository,
    wakeSink: createDatabasePollingDurableDeletionWakeSink(),
    workerId: `durable-deletion-outbox:${randomUUID()}`,
  });

  return {
    dispatcher,
    runtime,
    start() {
      dispatcher.start();
      runtime.start();
    },
    stop() {
      runtime.stop();
      dispatcher.stop();
    },
  };
}

export function resolveApiDurableDeletionRuntimeTiming(env: ApiDurableDeletionEnv = process.env): {
  readonly heartbeatIntervalMs: number;
  readonly leaseMs: number;
  readonly stepTimeoutMs: number;
} {
  const stepTimeoutMs = boundedStepTimeout(env.DURABLE_DELETION_STEP_TIMEOUT_MS);
  const heartbeatIntervalMs = stepTimeoutMs + 5_000;
  return {
    heartbeatIntervalMs,
    leaseMs: heartbeatIntervalMs * 3,
    stepTimeoutMs,
  };
}

function boundedStepTimeout(value: string | undefined): number {
  if (value === undefined) return 30_000;
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error("DURABLE_DELETION_STEP_TIMEOUT_MS must be an integer between 5000 and 120000");
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 5_000 || parsed > 120_000) {
    throw new Error("DURABLE_DELETION_STEP_TIMEOUT_MS must be an integer between 5000 and 120000");
  }
  return parsed;
}

export function writeDurableDeletionErrorLog(input: {
  readonly error: unknown;
  readonly job?: DurableDeletionJob | undefined;
}): void {
  const error = input.error instanceof Error ? input.error : undefined;
  process.stderr.write(
    `${JSON.stringify({
      checkpoint: input.job?.checkpoint,
      errorMessage: boundedLogValue(error?.message ?? String(input.error), 16_384),
      errorName: error?.name ?? "UnknownError",
      errorStack: error?.stack ? boundedLogValue(error.stack, 32_768) : undefined,
      event: "knowledge_fs.durable_deletion.failed",
      executionAttempts: input.job?.executionAttempts,
      jobId: input.job?.id,
      knowledgeSpaceId: input.job?.knowledgeSpaceId,
      runState: input.job?.runState,
      targetId: input.job?.targetId,
      targetType: input.job?.targetType,
    })}\n`,
  );
}

function boundedLogValue(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...[truncated]`;
}
