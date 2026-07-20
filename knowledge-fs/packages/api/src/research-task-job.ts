import {
  type EvidenceBundle,
  EvidenceBundleSchema,
  type JobPayload,
  type JobQueueAdapter,
} from "@knowledge/core";

import type { ResearchTaskPlanMode, ResearchTaskResolvedMode } from "./research-task-planning";
import type { ResearchTaskProgressPublisher } from "./research-task-progress";

export const ResearchTaskAccessChannels = ["interactive", "service_api", "mcp", "agent"] as const;
export type ResearchTaskAccessChannel = (typeof ResearchTaskAccessChannels)[number];

/** A non-secret locator for the immutable, server-issued ACL snapshot. */
export interface ResearchTaskPermissionSnapshotReference {
  readonly accessChannel: ResearchTaskAccessChannel;
  readonly id: string;
  readonly revision: number;
}

export type ResearchTaskJobStage =
  | "queued"
  | "planning"
  | "retrieving"
  | "analyzing"
  | "generating"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface ResearchTaskJob {
  budgetUsd?: number;
  completedAt?: number;
  cost: ResearchTaskCostSummary;
  createdAt: number;
  error?: string;
  id: string;
  knowledgeSpaceId: string;
  limits?: ResearchTaskJobLimits | undefined;
  metadata: Record<string, JobPayload>;
  mode?: ResearchTaskPlanMode | undefined;
  executionAttempts: number;
  heartbeatAt?: number | undefined;
  leaseExpiresAt?: number | undefined;
  leaseToken?: string | undefined;
  maxExecutionAttempts: number;
  pausedAt?: number;
  pausedFromStage?: Exclude<ResearchTaskJobStage, "canceled" | "completed" | "failed" | "paused">;
  permissionSnapshot: ResearchTaskPermissionSnapshotReference;
  query: string;
  queueJobId?: string | undefined;
  retryAt?: number | undefined;
  rowVersion: number;
  resumeAfter?: number;
  stage: ResearchTaskJobStage;
  subjectId: string;
  tenantId: string;
  topK?: number | undefined;
  updatedAt: number;
  workerId?: string | undefined;
}

export interface StartResearchTaskJobInput {
  readonly budgetUsd?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly limits?: ResearchTaskJobLimits | undefined;
  readonly metadata?: Record<string, JobPayload>;
  /** New durable jobs persist only the concrete pipeline selected at admission. */
  readonly mode?: ResearchTaskResolvedMode | undefined;
  readonly permissionSnapshot: ResearchTaskPermissionSnapshotReference;
  readonly query: string;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly topK?: number | undefined;
}

export interface ResearchTaskJobRepository {
  create(job: ResearchTaskJob): Promise<ResearchTaskJob>;
  get(id: string): Promise<ResearchTaskJob | null>;
  getMany(ids: readonly string[]): Promise<ResearchTaskJob[]>;
  update(job: ResearchTaskJob): Promise<ResearchTaskJob>;
}

export interface ResearchTaskPartialResult {
  evidenceBundle: EvidenceBundle;
  knowledgeSpaceId: string;
  researchTaskJobId: string;
  sequence: number;
  tenantId: string;
}

export interface AppendResearchTaskPartialResultInput {
  readonly evidenceBundle: EvidenceBundle;
  readonly idempotencyKey?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly researchTaskJobId: string;
  readonly tenantId: string;
}

export interface ListResearchTaskPartialResultsInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly researchTaskJobId: string;
  readonly tenantId: string;
}

export interface ListResearchTaskPartialResultsResult {
  readonly items: readonly ResearchTaskPartialResult[];
  readonly nextCursor?: string | undefined;
}

export interface ResearchTaskPartialResultRepository {
  append(input: AppendResearchTaskPartialResultInput): Promise<ResearchTaskPartialResult>;
  list(input: ListResearchTaskPartialResultsInput): Promise<ListResearchTaskPartialResultsResult>;
}

export interface InMemoryResearchTaskJobRepositoryOptions {
  readonly maxJobs: number;
}

export interface InMemoryResearchTaskPartialResultRepositoryOptions {
  readonly maxListLimit: number;
  readonly maxResults: number;
}

export interface ResearchTaskJobStateMachineOptions {
  readonly durableDispatch?: ResearchTaskDurableDispatch | undefined;
  readonly generateId: () => string;
  readonly jobs: Pick<JobQueueAdapter, "cancel" | "enqueue" | "fail">;
  readonly maxCostEntries?: number;
  readonly maxCostUsageBytes?: number;
  readonly maxExecutionAttempts?: number;
  readonly maxQueryBytes?: number;
  readonly now?: () => number;
  readonly progress?: ResearchTaskProgressPublisher | undefined;
  readonly repository: ResearchTaskJobRepository;
}

/**
 * Atomically persists a task and a pending delivery, or appends a new resume delivery. Production
 * consumers claim the database outbox and execution lease in one transaction, so a process crash
 * cannot strand a task between persistence, delivery, and execution.
 */
export interface ResearchTaskDurableDispatch {
  requestResume(input: {
    readonly job: ResearchTaskJob;
    readonly resumeFromStage: ResearchTaskJobStage;
    readonly updatedAt: number;
  }): Promise<ResearchTaskJob>;
  start(job: ResearchTaskJob): Promise<ResearchTaskJob>;
}

export interface ResearchTaskJobStateMachine {
  advance(id: string, nextStage: ResearchTaskJobStage): Promise<ResearchTaskJob>;
  cancel(id: string, reason?: string): Promise<ResearchTaskJob>;
  fail(id: string, error: string, options?: FailResearchTaskJobOptions): Promise<ResearchTaskJob>;
  get(id: string): Promise<ResearchTaskJob | null>;
  getMany(ids: readonly string[]): Promise<ResearchTaskJob[]>;
  pause(id: string, options: PauseResearchTaskJobOptions): Promise<ResearchTaskJob>;
  recordCost(id: string, input: RecordResearchTaskCostInput): Promise<ResearchTaskJob>;
  resume(id: string): Promise<ResearchTaskJob>;
  start(input: StartResearchTaskJobInput): Promise<ResearchTaskJob>;
}

export interface FailResearchTaskJobOptions {
  readonly retryAt?: number;
}

export interface PauseResearchTaskJobOptions {
  readonly reason: string;
  readonly resumeAfter?: number | undefined;
}

export interface ResearchTaskCostEntry {
  readonly costUsd: number;
  readonly provider: string;
  readonly recordedAt: number;
  readonly step: string;
  readonly usage: Record<string, JobPayload>;
}

export interface ResearchTaskCostSummary {
  readonly budgetExceeded?: boolean | undefined;
  readonly budgetUsd?: number | undefined;
  readonly entries: readonly ResearchTaskCostEntry[];
  readonly totalUsd: number;
}

export interface RecordResearchTaskCostInput {
  readonly costUsd: number;
  readonly provider: string;
  readonly step: string;
  readonly usage?: Record<string, JobPayload> | undefined;
}

export interface ResearchTaskJobLimits {
  readonly maxRetrievalSteps?: number | undefined;
  readonly maxScannedResources?: number | undefined;
  readonly maxToolCalls?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

const defaultMaxQueryBytes = 16_384;
const defaultMaxCostEntries = 1_000;
const defaultMaxCostUsageBytes = 16_384;
const defaultMaxExecutionAttempts = 5;

const stageOrder: readonly ResearchTaskJobStage[] = [
  "queued",
  "planning",
  "retrieving",
  "analyzing",
  "generating",
  "completed",
];

const terminalStages = new Set<ResearchTaskJobStage>(["completed", "failed", "canceled"]);

export function createResearchTaskJobStateMachine({
  durableDispatch,
  generateId,
  jobs,
  maxCostEntries = defaultMaxCostEntries,
  maxCostUsageBytes = defaultMaxCostUsageBytes,
  maxExecutionAttempts = defaultMaxExecutionAttempts,
  maxQueryBytes = defaultMaxQueryBytes,
  now = Date.now,
  progress,
  repository,
}: ResearchTaskJobStateMachineOptions): ResearchTaskJobStateMachine {
  validateMaxCostEntries(maxCostEntries);
  validateMaxCostUsageBytes(maxCostUsageBytes);
  validateMaxQueryBytes(maxQueryBytes);
  validatePositiveInteger(maxExecutionAttempts, "maxExecutionAttempts");

  return {
    advance: async (id: string, nextStage: ResearchTaskJobStage) => {
      const job = await requireResearchTaskJob(repository, id);
      assertCanAdvance(job, nextStage);
      const timestamp = now();
      const updated = await repository.update({
        ...job,
        ...(nextStage === "completed" ? { completedAt: timestamp } : {}),
        stage: nextStage,
        updatedAt: timestamp,
      });
      await progress?.publish(updated, "research_task.stage_changed", {
        previousStage: job.stage,
      });
      return cloneResearchTaskJob(updated);
    },
    cancel: async (id: string, reason?: string) => {
      const job = await requireResearchTaskJob(repository, id);
      assertNotTerminal(job);
      const timestamp = now();
      if (!durableDispatch && job.queueJobId) {
        await jobs.cancel(job.queueJobId, reason);
      }
      const updated = await repository.update({
        ...job,
        ...(reason ? { error: reason } : {}),
        completedAt: timestamp,
        stage: "canceled",
        updatedAt: timestamp,
      });
      await progress?.publish(updated, "research_task.canceled", reason ? { reason } : {});
      return cloneResearchTaskJob(updated);
    },
    fail: async (id: string, error: string, options?: FailResearchTaskJobOptions) => {
      const job = await requireResearchTaskJob(repository, id);
      assertNotTerminal(job);
      const timestamp = now();
      if (!durableDispatch && job.queueJobId) {
        await jobs.fail(job.queueJobId, error, options);
      }
      const updated = await repository.update({
        ...job,
        completedAt: timestamp,
        error,
        stage: "failed",
        updatedAt: timestamp,
      });
      await progress?.publish(updated, "research_task.failed", { error });
      return cloneResearchTaskJob(updated);
    },
    get: async (id: string) => {
      const job = await repository.get(id);
      return job ? cloneResearchTaskJob(job) : null;
    },
    getMany: async (ids: readonly string[]) => {
      const uniqueIds = Array.from(new Set(ids));
      const jobs = await repository.getMany(uniqueIds);
      return jobs.map(cloneResearchTaskJob);
    },
    pause: async (id: string, options: PauseResearchTaskJobOptions) => {
      const job = await requireResearchTaskJob(repository, id);
      assertNotTerminal(job);
      if (job.stage === "paused") {
        return cloneResearchTaskJob(job);
      }
      const reason = requiredString(options.reason, "pause reason");
      const timestamp = now();
      if (!durableDispatch && job.queueJobId) {
        await jobs.cancel(job.queueJobId, reason);
      }
      const updated = await repository.update({
        ...job,
        error: reason,
        pausedAt: timestamp,
        pausedFromStage: pauseableStage(job.stage),
        ...(options.resumeAfter === undefined ? {} : { resumeAfter: options.resumeAfter }),
        stage: "paused",
        updatedAt: timestamp,
      });
      await progress?.publish(updated, "research_task.paused", { reason });

      return cloneResearchTaskJob(updated);
    },
    recordCost: async (id: string, input: RecordResearchTaskCostInput) => {
      const job = await requireResearchTaskJob(repository, id);
      assertNotTerminal(job);
      if (job.cost.entries.length >= maxCostEntries) {
        throw new Error(`Research task cost entries exceed maxCostEntries=${maxCostEntries}`);
      }
      const cost = validateCostInput(input, maxCostUsageBytes);
      const timestamp = now();
      const entries = [
        ...job.cost.entries,
        {
          ...cost,
          recordedAt: timestamp,
        },
      ];
      const totalUsd = roundCurrency(entries.reduce((total, entry) => total + entry.costUsd, 0));
      const budgetExceeded = job.budgetUsd !== undefined && totalUsd > job.budgetUsd;

      if (budgetExceeded) {
        if (!durableDispatch && job.queueJobId) {
          await jobs.cancel(job.queueJobId, "Research task budget exhausted");
        }
      }

      const updated = await repository.update({
        ...job,
        ...(budgetExceeded
          ? {
              completedAt: timestamp,
              error: "Research task budget exhausted",
              stage: "canceled" as const,
            }
          : {}),
        cost: {
          ...(job.budgetUsd === undefined ? {} : { budgetUsd: job.budgetUsd }),
          ...(budgetExceeded ? { budgetExceeded: true } : {}),
          entries,
          totalUsd,
        },
        updatedAt: timestamp,
      });
      if (budgetExceeded) {
        await progress?.publish(updated, "research_task.canceled", {
          reason: "Research task budget exhausted",
        });
      }

      return cloneResearchTaskJob(updated);
    },
    resume: async (id: string) => {
      const job = await requireResearchTaskJob(repository, id);
      assertNotTerminal(job);
      const timestamp = now();
      const resumeFromStage =
        job.stage === "paused" ? (job.pausedFromStage ?? "queued") : job.stage;
      if (durableDispatch) {
        const updated = await durableDispatch.requestResume({
          job,
          resumeFromStage,
          updatedAt: timestamp,
        });
        await progress?.publish(updated, "research_task.resumed", { resumedFrom: job.stage });
        return cloneResearchTaskJob(updated);
      }
      const queueJob = await jobs.enqueue({
        idempotencyKey: researchTaskResumeIdempotencyKey(job, resumeFromStage),
        payload: toResearchTaskJobPayload(id),
        type: "research.task",
      });
      const unpausedJob =
        job.stage === "paused"
          ? omitPauseFields({ ...job, stage: resumeFromStage })
          : cloneResearchTaskJob(job);
      const updated = await repository.update({
        ...unpausedJob,
        queueJobId: queueJob.id,
        updatedAt: timestamp,
      });
      await progress?.publish(updated, "research_task.resumed", { resumedFrom: job.stage });

      return cloneResearchTaskJob(updated);
    },
    start: async (input: StartResearchTaskJobInput) => {
      const validated = validateStartInput(input, maxQueryBytes);
      const id = generateId();
      const timestamp = now();
      const payload = toResearchTaskJobPayload(id);
      const pendingJob: ResearchTaskJob = {
        createdAt: timestamp,
        ...(validated.budgetUsd === undefined ? {} : { budgetUsd: validated.budgetUsd }),
        cost: {
          ...(validated.budgetUsd === undefined ? {} : { budgetUsd: validated.budgetUsd }),
          entries: [],
          totalUsd: 0,
        },
        executionAttempts: 0,
        id,
        knowledgeSpaceId: validated.knowledgeSpaceId,
        ...(validated.limits === undefined ? {} : { limits: validated.limits }),
        maxExecutionAttempts,
        metadata: validated.metadata,
        ...(validated.mode === undefined ? {} : { mode: validated.mode }),
        permissionSnapshot: validated.permissionSnapshot,
        query: validated.query,
        rowVersion: 1,
        stage: "queued",
        subjectId: validated.subjectId,
        tenantId: validated.tenantId,
        ...(validated.topK === undefined ? {} : { topK: validated.topK }),
        updatedAt: timestamp,
      };
      if (durableDispatch) {
        const job = await durableDispatch.start(pendingJob);
        await progress?.publish(job, "research_task.started");
        return cloneResearchTaskJob(job);
      }
      const queueJob = await jobs.enqueue({
        idempotencyKey: researchTaskIdempotencyKey(id, validated),
        payload,
        type: "research.task",
      });
      const job = await repository.create({
        ...pendingJob,
        queueJobId: queueJob.id,
      });
      await progress?.publish(job, "research_task.started");
      return cloneResearchTaskJob(job);
    },
  };
}

export function createInMemoryResearchTaskJobRepository({
  maxJobs,
}: InMemoryResearchTaskJobRepositoryOptions): ResearchTaskJobRepository {
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1) {
    throw new Error("Research task job repository maxJobs must be at least 1");
  }

  const jobs = new Map<string, ResearchTaskJob>();

  return {
    create: async (job) => {
      if (!jobs.has(job.id) && jobs.size >= maxJobs) {
        throw new Error(`Research task job repository maxJobs=${maxJobs} exceeded`);
      }

      const cloned = cloneResearchTaskJob(job);
      jobs.set(cloned.id, cloned);
      return cloneResearchTaskJob(cloned);
    },
    get: async (id) => {
      const job = jobs.get(id);
      return job ? cloneResearchTaskJob(job) : null;
    },
    getMany: async (ids) =>
      Array.from(new Set(ids))
        .map((id) => jobs.get(id))
        .filter((job): job is ResearchTaskJob => Boolean(job))
        .map(cloneResearchTaskJob),
    update: async (job) => {
      const current = jobs.get(job.id);
      if (!current) {
        throw new Error(`Research task job ${job.id} not found`);
      }
      if (current.rowVersion !== job.rowVersion) {
        throw new Error("Research task job update lost its row-version fence");
      }

      const cloned = cloneResearchTaskJob({ ...job, rowVersion: job.rowVersion + 1 });
      jobs.set(cloned.id, cloned);
      return cloneResearchTaskJob(cloned);
    },
  };
}

export function createInMemoryResearchTaskPartialResultRepository({
  maxListLimit,
  maxResults,
}: InMemoryResearchTaskPartialResultRepositoryOptions): ResearchTaskPartialResultRepository {
  if (!Number.isSafeInteger(maxResults) || maxResults < 1) {
    throw new Error("Research task partial result repository maxResults must be at least 1");
  }

  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("Research task partial result repository maxListLimit must be at least 1");
  }

  const results: ResearchTaskPartialResult[] = [];
  const idempotentResults = new Map<string, ResearchTaskPartialResult>();
  let nextSequence = 1;

  return {
    append: async (input) => {
      validatePartialResultScope(input);
      const idempotencyKey = input.idempotencyKey?.trim();
      if (input.idempotencyKey !== undefined && !idempotencyKey) {
        throw new Error("Research task partial result idempotencyKey must not be empty");
      }
      const idempotentKey = idempotencyKey
        ? `${input.tenantId}\u0000${input.researchTaskJobId}\u0000${idempotencyKey}`
        : undefined;
      const existing = idempotentKey ? idempotentResults.get(idempotentKey) : undefined;
      if (existing) {
        return clonePartialResult(existing);
      }

      if (results.length >= maxResults) {
        throw new Error(
          `Research task partial result repository maxResults=${maxResults} exceeded`,
        );
      }

      const result = {
        evidenceBundle: EvidenceBundleSchema.parse(cloneEvidenceBundle(input.evidenceBundle)),
        knowledgeSpaceId: input.knowledgeSpaceId.trim(),
        researchTaskJobId: input.researchTaskJobId.trim(),
        sequence: nextSequence++,
        tenantId: input.tenantId.trim(),
      } satisfies ResearchTaskPartialResult;

      results.push(result);
      if (idempotentKey) {
        idempotentResults.set(idempotentKey, result);
      }

      return clonePartialResult(result);
    },
    list: async (input) => {
      const normalized = validatePartialResultListInput(input, maxListLimit);
      const selected = results
        .filter((result) => result.tenantId === normalized.tenantId)
        .filter((result) => result.researchTaskJobId === normalized.researchTaskJobId)
        .filter((result) => result.sequence > normalized.cursorSequence)
        .sort((first, second) => first.sequence - second.sequence)
        .slice(0, normalized.limit + 1);

      const items = selected.slice(0, normalized.limit).map(clonePartialResult);
      const overflow = selected.at(normalized.limit);

      return {
        items,
        ...(overflow ? { nextCursor: String(items.at(-1)?.sequence) } : {}),
      };
    },
  };
}

function researchTaskIdempotencyKey(
  researchTaskJobId: string,
  { knowledgeSpaceId, tenantId }: StartResearchTaskJobInput,
): string {
  return `research.task:${tenantId}:${knowledgeSpaceId}:${researchTaskJobId}`;
}

function researchTaskResumeIdempotencyKey(
  job: ResearchTaskJob,
  resumeFromStage: ResearchTaskJobStage,
): string {
  return `research.task.resume:${job.tenantId}:${job.knowledgeSpaceId}:${job.id}:${resumeFromStage}`;
}

function toResearchTaskJobPayload(researchTaskJobId: string): JobPayload {
  return { researchTaskJobId };
}

async function requireResearchTaskJob(
  repository: ResearchTaskJobRepository,
  id: string,
): Promise<ResearchTaskJob> {
  const job = await repository.get(id);

  if (!job) {
    throw new Error(`Research task job ${id} not found`);
  }

  return job;
}

function assertCanAdvance(job: ResearchTaskJob, nextStage: ResearchTaskJobStage): void {
  assertNotTerminal(job);

  if (nextStage === "failed" || nextStage === "canceled") {
    throw new Error(`Research task job cannot advance to ${nextStage}`);
  }

  const currentIndex = stageOrder.indexOf(job.stage);
  const nextIndex = stageOrder.indexOf(nextStage);

  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Research task job cannot advance from ${job.stage} to ${nextStage}`);
  }
}

function assertNotTerminal(job: ResearchTaskJob): void {
  if (terminalStages.has(job.stage)) {
    throw new Error(`Research task job ${job.stage} is terminal`);
  }
}

function pauseableStage(
  stage: ResearchTaskJobStage,
): Exclude<ResearchTaskJobStage, "canceled" | "completed" | "failed" | "paused"> {
  if (stage === "paused" || stage === "completed" || stage === "failed" || stage === "canceled") {
    throw new Error(`Research task job cannot pause from ${stage}`);
  }

  return stage;
}

function omitPauseFields(job: ResearchTaskJob): ResearchTaskJob {
  const {
    pausedAt: _pausedAt,
    pausedFromStage: _pausedFromStage,
    resumeAfter: _resumeAfter,
    ...rest
  } = job;

  return rest;
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Research task job ${label} is required`);
  }

  return normalized;
}

function validateStartInput(
  input: StartResearchTaskJobInput,
  maxQueryBytes: number,
): Required<StartResearchTaskJobInput> {
  const tenantId = input.tenantId.trim();
  const knowledgeSpaceId = input.knowledgeSpaceId.trim();
  const subjectId = input.subjectId.trim();
  const query = input.query.trim();

  if (!tenantId) {
    throw new Error("Research task job tenantId is required");
  }

  if (!knowledgeSpaceId) {
    throw new Error("Research task job knowledgeSpaceId is required");
  }

  if (!subjectId) {
    throw new Error("Research task job subjectId is required");
  }

  if (!query) {
    throw new Error("Research task job query is required");
  }

  if (new TextEncoder().encode(query).byteLength > maxQueryBytes) {
    throw new Error(`Research task job query exceeds maxQueryBytes=${maxQueryBytes}`);
  }

  if (input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0)) {
    throw new Error("Research task budgetUsd must be a non-negative finite number");
  }

  return {
    budgetUsd: input.budgetUsd,
    knowledgeSpaceId,
    limits: validateResearchTaskJobLimits(input.limits),
    metadata: cloneRecord(input.metadata ?? {}),
    mode: validateResearchTaskMode(input.mode),
    permissionSnapshot: validatePermissionSnapshotReference(input.permissionSnapshot),
    query,
    subjectId,
    tenantId,
    topK: validateResearchTaskTopK(input.topK),
  };
}

function validateResearchTaskMode(
  mode: ResearchTaskResolvedMode | undefined,
): ResearchTaskResolvedMode | undefined {
  if (mode === undefined) {
    return undefined;
  }

  if (mode !== "deep" && mode !== "fast" && mode !== "research") {
    throw new Error("Research task mode is invalid");
  }

  return mode;
}

function validateResearchTaskTopK(topK: number | undefined): number | undefined {
  if (topK === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(topK) || topK < 1) {
    throw new Error("Research task topK must be at least 1");
  }

  return topK;
}

function validateResearchTaskJobLimits(
  limits: ResearchTaskJobLimits | undefined,
): ResearchTaskJobLimits | undefined {
  if (limits === undefined) {
    return undefined;
  }

  const normalized: {
    maxRetrievalSteps?: number;
    maxScannedResources?: number;
    maxToolCalls?: number;
    timeoutMs?: number;
  } = {};

  for (const [key, value] of Object.entries(limits) as Array<
    [keyof ResearchTaskJobLimits, number | undefined]
  >) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`Research task limit ${key} must be at least 1`);
    }

    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function validateCostInput(
  input: RecordResearchTaskCostInput,
  maxCostUsageBytes: number,
): Omit<ResearchTaskCostEntry, "recordedAt"> {
  if (!Number.isFinite(input.costUsd) || input.costUsd < 0) {
    throw new Error("Research task costUsd must be a non-negative finite number");
  }

  const provider = input.provider.trim();
  const step = input.step.trim();

  if (!provider) {
    throw new Error("Research task cost provider is required");
  }

  if (!step) {
    throw new Error("Research task cost step is required");
  }

  const usage = cloneRecord(input.usage ?? {});
  const usageBytes = new TextEncoder().encode(JSON.stringify(usage)).byteLength;

  if (usageBytes > maxCostUsageBytes) {
    throw new Error(`Research task cost usage exceeds maxCostUsageBytes=${maxCostUsageBytes}`);
  }

  return {
    costUsd: roundCurrency(input.costUsd),
    provider,
    step,
    usage,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validateMaxQueryBytes(maxQueryBytes: number): void {
  if (!Number.isSafeInteger(maxQueryBytes) || maxQueryBytes < 1) {
    throw new Error("Research task job maxQueryBytes must be at least 1");
  }
}

function validateMaxCostEntries(maxCostEntries: number): void {
  if (!Number.isSafeInteger(maxCostEntries) || maxCostEntries < 1) {
    throw new Error("Research task job maxCostEntries must be at least 1");
  }
}

function validateMaxCostUsageBytes(maxCostUsageBytes: number): void {
  if (!Number.isSafeInteger(maxCostUsageBytes) || maxCostUsageBytes < 1) {
    throw new Error("Research task job maxCostUsageBytes must be at least 1");
  }
}

function validatePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Research task job ${field} must be at least 1`);
  }
}

function validatePermissionSnapshotReference(
  input: ResearchTaskPermissionSnapshotReference,
): ResearchTaskPermissionSnapshotReference {
  const id = input.id.trim();
  if (!id) {
    throw new Error("Research task permission snapshot id is required");
  }
  if (!ResearchTaskAccessChannels.includes(input.accessChannel)) {
    throw new Error("Research task permission snapshot access channel is invalid");
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error("Research task permission snapshot revision must be at least 1");
  }
  return { accessChannel: input.accessChannel, id, revision: input.revision };
}

function cloneRecord(input: Record<string, JobPayload>): Record<string, JobPayload> {
  return JSON.parse(JSON.stringify(input)) as Record<string, JobPayload>;
}

function cloneResearchTaskJob(job: ResearchTaskJob): ResearchTaskJob {
  return JSON.parse(JSON.stringify(job)) as ResearchTaskJob;
}

function validatePartialResultScope(input: AppendResearchTaskPartialResultInput): void {
  for (const [key, value] of Object.entries({
    knowledgeSpaceId: input.knowledgeSpaceId,
    researchTaskJobId: input.researchTaskJobId,
    tenantId: input.tenantId,
  })) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Research task partial result ${key} is required`);
    }
  }
}

function validatePartialResultListInput(
  input: ListResearchTaskPartialResultsInput,
  maxListLimit: number,
): ListResearchTaskPartialResultsInput & { readonly cursorSequence: number } {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
    throw new Error("Research task partial result list limit must be at least 1");
  }

  if (input.limit > maxListLimit) {
    throw new Error(`Research task partial result list limit exceeds maxListLimit=${maxListLimit}`);
  }

  const researchTaskJobId = input.researchTaskJobId.trim();
  const tenantId = input.tenantId.trim();

  if (!researchTaskJobId) {
    throw new Error("Research task partial result researchTaskJobId is required");
  }

  if (!tenantId) {
    throw new Error("Research task partial result tenantId is required");
  }

  const cursorSequence = input.cursor === undefined ? 0 : Number.parseInt(input.cursor, 10);

  if (
    input.cursor !== undefined &&
    (!Number.isSafeInteger(cursorSequence) ||
      cursorSequence < 0 ||
      String(cursorSequence) !== input.cursor)
  ) {
    throw new Error("Research task partial result cursor is invalid");
  }

  return {
    ...input,
    cursorSequence,
    researchTaskJobId,
    tenantId,
  };
}

function clonePartialResult(result: ResearchTaskPartialResult): ResearchTaskPartialResult {
  return JSON.parse(JSON.stringify(result)) as ResearchTaskPartialResult;
}

function cloneEvidenceBundle(bundle: EvidenceBundle): EvidenceBundle {
  return JSON.parse(JSON.stringify(bundle)) as EvidenceBundle;
}
