import { randomUUID } from "node:crypto";

import {
  type CapabilityGrantProvenanceRepository,
  type DeletionLifecycleFenceGuard,
  type DurableTaskOperationalMetrics,
  type KnowledgeGatewayOptions,
  type KnowledgeSpaceAccessService,
  type KnowledgeSpaceManifestRepository,
  type PublishedProjectionReadSnapshotResolver,
  type QueryGenerator,
  type ResearchTaskDurableRepository,
  type ResearchTaskJobStateMachine,
  type ResearchTaskPartialResultRepository,
  type ResearchTaskProgressRepository,
  type ResearchTaskRuntime,
  createResearchTaskJobStateMachine,
  createResearchTaskRuntime,
} from "@knowledge/api";

export interface ApiResearchTaskRuntimeEnv {
  readonly RESEARCH_TASK_HEARTBEAT_INTERVAL_MS?: string | undefined;
  readonly RESEARCH_TASK_LEASE_MS?: string | undefined;
  readonly RESEARCH_TASK_MAX_BATCH_SIZE?: string | undefined;
  readonly RESEARCH_TASK_MAX_EXECUTION_ATTEMPTS?: string | undefined;
  readonly RESEARCH_TASK_RUNTIME_INTERVAL_MS?: string | undefined;
  readonly RESEARCH_TASK_WORKER_ID?: string | undefined;
}

export interface CreateApiResearchTaskRuntimeOptions {
  readonly access: KnowledgeSpaceAccessService;
  readonly adapter: KnowledgeGatewayOptions["adapter"];
  readonly capabilityGrants?: CapabilityGrantProvenanceRepository | undefined;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly env?: ApiResearchTaskRuntimeEnv | undefined;
  readonly generator: QueryGenerator;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly metrics?: DurableTaskOperationalMetrics | undefined;
  readonly partials: ResearchTaskPartialResultRepository;
  readonly progress: ResearchTaskProgressRepository;
  readonly projectionSnapshotResolver?: PublishedProjectionReadSnapshotResolver | undefined;
  readonly repository: ResearchTaskDurableRepository;
}

export interface ApiResearchTaskRuntimeAssembly {
  readonly jobs: ResearchTaskJobStateMachine;
  readonly partials: ResearchTaskPartialResultRepository;
  readonly progress: ResearchTaskProgressRepository;
  readonly runtime: ResearchTaskRuntime;
  start(): void;
  stop(): void;
}

export function assertApiResearchTaskDurability({
  production,
  runtimeConfigured,
  usesDatabaseRepositories,
}: {
  readonly production: boolean;
  readonly runtimeConfigured: boolean;
  readonly usesDatabaseRepositories: boolean;
}): void {
  if (production && (!usesDatabaseRepositories || !runtimeConfigured)) {
    throw new Error(
      "Production Research requires the database job/outbox, partial, progress, ACL, and query runtime",
    );
  }
}

export function createApiResearchTaskRuntime({
  access,
  adapter,
  capabilityGrants,
  deletionFence,
  env = process.env,
  generator,
  manifests,
  metrics,
  partials,
  progress,
  projectionSnapshotResolver,
  repository,
}: CreateApiResearchTaskRuntimeOptions): ApiResearchTaskRuntimeAssembly {
  const workerId = env.RESEARCH_TASK_WORKER_ID?.trim() || `research-task-${process.pid}`;
  const leaseMs = envInteger(env.RESEARCH_TASK_LEASE_MS, 30_000, "RESEARCH_TASK_LEASE_MS");
  const maxBatchSize = envInteger(
    env.RESEARCH_TASK_MAX_BATCH_SIZE,
    10,
    "RESEARCH_TASK_MAX_BATCH_SIZE",
  );
  const heartbeatIntervalMs = envInteger(
    env.RESEARCH_TASK_HEARTBEAT_INTERVAL_MS,
    Math.max(1, Math.floor(leaseMs / 3)),
    "RESEARCH_TASK_HEARTBEAT_INTERVAL_MS",
  );
  const maxExecutionAttempts = envInteger(
    env.RESEARCH_TASK_MAX_EXECUTION_ATTEMPTS,
    5,
    "RESEARCH_TASK_MAX_EXECUTION_ATTEMPTS",
  );
  const jobs = createResearchTaskJobStateMachine({
    durableDispatch: repository,
    generateId: randomUUID,
    jobs: adapter.jobs,
    maxExecutionAttempts,
    ...(metrics ? { metrics } : {}),
    repository,
  });
  const runtime = createResearchTaskRuntime({
    access,
    allowLegacyProfileFallback: false,
    ...(capabilityGrants ? { capabilityGrants } : {}),
    ...(deletionFence ? { deletionFence } : {}),
    generator,
    heartbeatIntervalMs,
    intervalMs: envInteger(
      env.RESEARCH_TASK_RUNTIME_INTERVAL_MS,
      1_000,
      "RESEARCH_TASK_RUNTIME_INTERVAL_MS",
    ),
    leaseMs,
    manifests,
    maxBatchSize,
    ...(metrics ? { metrics } : {}),
    partials,
    ...(projectionSnapshotResolver ? { projectionSnapshotResolver } : {}),
    repository,
    workerId: `${workerId}:consumer`,
  });

  return {
    jobs,
    partials,
    progress,
    runtime,
    start() {
      runtime.start();
    },
    stop() {
      runtime.stop();
    },
  };
}

function envInteger(value: string | undefined, fallback: number, field: string): number {
  if (value === undefined || !value.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}
