import {
  type JobPayload,
  type JobQueueAdapter,
  type JobRecord,
  PublicationGenerationIdSchema,
  UuidSchema,
} from "@knowledge/core";
import type { KnowledgeSpaceDurablePermissionReference } from "./knowledge-space-authorization";

export type DocumentCompilationJobStage =
  | "queued"
  | "parsed"
  | "outline_built"
  | "nodes_generated"
  | "projection_built"
  | "smoke_eval_passed"
  | "published"
  | "failed"
  | "canceled";

export type DocumentCompilationRunState =
  | "dispatch_pending"
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "canceled"
  | "superseded";

export interface DocumentCompilationJob {
  baseHeadRevision?: number;
  /** Durable Capability v2 provenance. Mutually exclusive with legacy member provenance. */
  capabilityGrantId?: string;
  candidateFingerprint?: string;
  candidatePublicationId?: string;
  completedAt?: number;
  createdAt: number;
  documentAssetId: string;
  error?: string;
  executionAttempts?: number;
  id: string;
  knowledgeSpaceId: string;
  leaseExpiresAt?: number;
  maxExecutionAttempts?: number;
  /** Internal durable ACL provenance. This field must never be serialized in the public DTO. */
  permissionSnapshot?: KnowledgeSpaceDurablePermissionReference;
  publicationGenerationId?: string;
  queueJobId?: string;
  /** Internal actor binding. This field must never be serialized in the public job DTO. */
  requestedBySubjectId?: string;
  retryAt?: number;
  runState?: DocumentCompilationRunState;
  stage: DocumentCompilationJobStage;
  tenantId: string;
  updatedAt: number;
  version: number;
}

export interface StartDocumentCompilationJobInput {
  /** Internal space-bootstrap fence. Public upload/reindex handlers never accept this field. */
  readonly bootstrapJobId?: string | undefined;
  /** Durable Capability v2 provenance; the bearer and raw jti are never accepted here. */
  readonly capabilityGrantId?: string | undefined;
  /**
   * Creates the durable attempt/outbox in a non-claimable state. Callers must persist and bind the
   * exact product candidate before invoking `releaseDispatch`; this closes the start-then-bind race.
   */
  readonly deferDispatch?: boolean | undefined;
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  /** Durable ACL provenance issued for the exact caller channel/credential. */
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  /** Authenticated caller that initiated a public upload/reindex job. */
  readonly requestedBySubjectId?: string | undefined;
  readonly tenantId: string;
  readonly version: number;
}

export interface RetryDocumentCompilationJobInput {
  /** Fresh Capability v2 provenance authorizing this control operation. */
  readonly capabilityGrantId?: string | undefined;
  /** Fresh durable ACL provenance issued for the caller authorizing this retry. */
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  /** Authenticated caller authorizing this retry. */
  readonly requestedBySubjectId?: string | undefined;
}

export type ControlDocumentCompilationJobInput = RetryDocumentCompilationJobInput;

export interface DocumentCompilationJobRepository {
  create(job: DocumentCompilationJob): Promise<DocumentCompilationJob>;
  deleteTerminalOlderThan(input: DeleteTerminalDocumentCompilationJobsInput): Promise<number>;
  get(id: string): Promise<DocumentCompilationJob | null>;
  getMany(ids: readonly string[]): Promise<DocumentCompilationJob[]>;
  update(job: DocumentCompilationJob): Promise<DocumentCompilationJob>;
}

export interface DeleteTerminalDocumentCompilationJobsInput {
  readonly maxJobs: number;
  readonly olderThan: number;
  readonly tenantId: string;
}

export interface InMemoryDocumentCompilationJobRepositoryOptions {
  readonly maxJobs: number;
}

export interface DocumentCompilationJobStateMachineOptions {
  readonly generateId: () => string;
  readonly generatePublicationGenerationId?: (() => string) | undefined;
  readonly jobs: Pick<JobQueueAdapter, "cancel" | "enqueue" | "fail">;
  readonly now?: () => number;
  readonly repository: DocumentCompilationJobRepository;
}

export interface DocumentCompilationJobStateMachine {
  advance(id: string, nextStage: DocumentCompilationJobStage): Promise<DocumentCompilationJob>;
  cancel(
    id: string,
    reason?: string,
    input?: ControlDocumentCompilationJobInput,
  ): Promise<DocumentCompilationJob>;
  fail(
    id: string,
    error: string,
    options?: FailDocumentCompilationJobOptions,
  ): Promise<DocumentCompilationJob>;
  get(id: string): Promise<DocumentCompilationJob | null>;
  getMany(ids: readonly string[]): Promise<DocumentCompilationJob[]>;
  /** Makes a deliberately deferred durable outbox claimable after its product intent is bound. */
  releaseDispatch?(id: string): Promise<DocumentCompilationJob>;
  /** Available only when the backing repository can atomically reactivate the durable attempt. */
  retry?(id: string, input?: RetryDocumentCompilationJobInput): Promise<DocumentCompilationJob>;
  start(input: StartDocumentCompilationJobInput): Promise<DocumentCompilationJob>;
}

export interface DocumentCompilationCleanupWorkerOptions {
  readonly jobs: Pick<JobQueueAdapter, "enqueue">;
  readonly maxCleanupJobs: number;
  readonly now?: () => number;
  readonly repository: DocumentCompilationJobRepository;
}

export interface EnqueueDocumentCompilationCleanupInput {
  readonly maxJobs?: number | undefined;
  readonly olderThan: number;
  readonly tenantId: string;
}

export interface DocumentCompilationCleanupResult {
  readonly deleted: number;
  readonly olderThan: number;
  readonly tenantId: string;
}

export interface DocumentCompilationCleanupWorker {
  enqueue(input: EnqueueDocumentCompilationCleanupInput): Promise<JobRecord>;
  process(payload: JobPayload): Promise<DocumentCompilationCleanupResult>;
}

export interface FailDocumentCompilationJobOptions {
  readonly retryAt?: number;
}

const stageOrder: readonly DocumentCompilationJobStage[] = [
  "queued",
  "parsed",
  "outline_built",
  "nodes_generated",
  "projection_built",
  "smoke_eval_passed",
  "published",
];

const terminalStages = new Set<DocumentCompilationJobStage>(["published", "failed", "canceled"]);

export function createDocumentCompilationJobStateMachine({
  generateId,
  generatePublicationGenerationId,
  jobs,
  now = Date.now,
  repository,
}: DocumentCompilationJobStateMachineOptions): DocumentCompilationJobStateMachine {
  return {
    advance: async (id: string, nextStage: DocumentCompilationJobStage) => {
      const job = await requireCompilationJob(repository, id);

      if (job.stage === nextStage) {
        if (job.runState === "retry_wait") {
          return cloneDocumentCompilationJob(
            await repository.update({
              ...withoutRetrySchedule(job),
              runState: "running",
              updatedAt: now(),
            }),
          );
        }
        return cloneDocumentCompilationJob(job);
      }

      const currentIndex = stageOrder.indexOf(job.stage);
      const nextIndex = stageOrder.indexOf(nextStage);
      if (currentIndex >= 0 && nextIndex >= 0 && nextIndex < currentIndex) {
        return cloneDocumentCompilationJob(job);
      }

      assertCanAdvance(job, nextStage);
      const timestamp = now();
      const updated = await repository.update({
        ...withoutRetrySchedule(job),
        ...(nextStage === "published" ? { completedAt: timestamp } : {}),
        runState: nextStage === "published" ? "succeeded" : "running",
        stage: nextStage,
        updatedAt: timestamp,
      });
      return cloneDocumentCompilationJob(updated);
    },
    cancel: async (id: string, reason?: string) => {
      const job = await requireCompilationJob(repository, id);
      assertNotTerminal(job);
      const timestamp = now();
      if (job.queueJobId) {
        await jobs.cancel(job.queueJobId, reason);
      }
      const updated = await repository.update({
        ...withoutRetrySchedule(job),
        ...(reason ? { error: reason } : {}),
        completedAt: timestamp,
        runState: "canceled",
        stage: "canceled",
        updatedAt: timestamp,
      });
      return cloneDocumentCompilationJob(updated);
    },
    fail: async (id: string, error: string, options?: FailDocumentCompilationJobOptions) => {
      const job = await requireCompilationJob(repository, id);
      assertNotTerminal(job);
      const timestamp = now();
      if (job.queueJobId) {
        await jobs.fail(job.queueJobId, error, options);
      }
      if (options?.retryAt !== undefined) {
        const updated = await repository.update({
          ...job,
          error,
          retryAt: options.retryAt,
          runState: "retry_wait",
          updatedAt: timestamp,
        });
        return cloneDocumentCompilationJob(updated);
      }
      const updated = await repository.update({
        ...withoutRetrySchedule(job),
        completedAt: timestamp,
        error,
        runState: "failed",
        stage: "failed",
        updatedAt: timestamp,
      });
      return cloneDocumentCompilationJob(updated);
    },
    get: async (id: string) => {
      const job = await repository.get(id);
      return job ? cloneDocumentCompilationJob(job) : null;
    },
    getMany: async (ids: readonly string[]) => {
      const uniqueIds = Array.from(new Set(ids));
      const jobs = await repository.getMany(uniqueIds);
      return jobs.map(cloneDocumentCompilationJob);
    },
    start: async (input: StartDocumentCompilationJobInput) => {
      validateStartInput(input);
      const id = generateId();
      const publicationGenerationId = generatePublicationGenerationId
        ? PublicationGenerationIdSchema.parse(generatePublicationGenerationId())
        : undefined;
      const timestamp = now();
      const payload = toDocumentCompilationJobPayload(id, publicationGenerationId, input);
      const queueJob = await jobs.enqueue({
        idempotencyKey: documentCompilationIdempotencyKey(input),
        payload,
        type: "document.compile",
      });
      const queuedCompilationJobId = queuedDocumentCompilationJobId(queueJob.payload) ?? id;
      const queuedPublicationGenerationId = queuedDocumentCompilationPublicationGenerationId(
        queueJob.payload,
      );
      const existing = await repository.get(queuedCompilationJobId);

      if (publicationGenerationId !== undefined && queuedPublicationGenerationId === undefined) {
        throw new Error("Document compilation queue omitted publicationGenerationId");
      }

      if (
        queuedCompilationJobId === id &&
        queuedPublicationGenerationId !== publicationGenerationId
      ) {
        throw new Error("Document compilation queue changed publicationGenerationId");
      }

      if (existing) {
        if (existing.publicationGenerationId !== queuedPublicationGenerationId) {
          throw new Error("Document compilation queue generation does not match the persisted job");
        }

        return cloneDocumentCompilationJob(existing);
      }

      const job = await repository.create({
        createdAt: timestamp,
        ...(input.capabilityGrantId ? { capabilityGrantId: input.capabilityGrantId } : {}),
        documentAssetId: input.documentAssetId,
        id: queuedCompilationJobId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
        ...(queuedPublicationGenerationId
          ? { publicationGenerationId: queuedPublicationGenerationId }
          : {}),
        queueJobId: queueJob.id,
        ...(input.requestedBySubjectId ? { requestedBySubjectId: input.requestedBySubjectId } : {}),
        runState: "queued",
        stage: "queued",
        tenantId: input.tenantId,
        updatedAt: timestamp,
        version: input.version,
      });
      return cloneDocumentCompilationJob(job);
    },
  };
}

function queuedDocumentCompilationJobId(payload: JobPayload): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const id = (payload as Readonly<Record<string, JobPayload>>).documentCompilationJobId;

  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function queuedDocumentCompilationPublicationGenerationId(payload: JobPayload): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const publicationGenerationId = (payload as Readonly<Record<string, JobPayload>>)
    .publicationGenerationId;

  if (typeof publicationGenerationId !== "string") {
    return undefined;
  }

  return PublicationGenerationIdSchema.parse(publicationGenerationId);
}

export function createDocumentCompilationCleanupWorker({
  jobs,
  maxCleanupJobs,
  now = Date.now,
  repository,
}: DocumentCompilationCleanupWorkerOptions): DocumentCompilationCleanupWorker {
  validateCleanupMaxJobs(maxCleanupJobs, "maxCleanupJobs");

  return {
    enqueue: async (input) => {
      const cleanupInput = validateCleanupInput({
        maxJobs: input.maxJobs ?? maxCleanupJobs,
        olderThan: input.olderThan,
        tenantId: input.tenantId,
      });

      return jobs.enqueue({
        idempotencyKey: `retention.cleanup.document-compilation:${cleanupInput.tenantId}:${cleanupInput.olderThan}`,
        payload: {
          maxJobs: cleanupInput.maxJobs,
          olderThan: cleanupInput.olderThan,
          requestedAt: now(),
          tenantId: cleanupInput.tenantId,
        },
        type: "retention.cleanup.document-compilation",
      });
    },
    process: async (payload) => {
      const cleanupInput = validateCleanupPayload(payload, maxCleanupJobs);
      const deleted = await repository.deleteTerminalOlderThan(cleanupInput);

      return {
        deleted,
        olderThan: cleanupInput.olderThan,
        tenantId: cleanupInput.tenantId,
      };
    },
  };
}

export function createInMemoryDocumentCompilationJobRepository({
  maxJobs,
}: InMemoryDocumentCompilationJobRepositoryOptions): DocumentCompilationJobRepository {
  if (maxJobs < 1) {
    throw new Error("Document compilation job repository maxJobs must be at least 1");
  }

  const jobs = new Map<string, DocumentCompilationJob>();

  return {
    create: async (job) => {
      if (!jobs.has(job.id) && jobs.size >= maxJobs) {
        throw new Error(`Document compilation job repository maxJobs=${maxJobs} exceeded`);
      }

      const cloned = cloneDocumentCompilationJob(job);
      jobs.set(cloned.id, cloned);
      return cloneDocumentCompilationJob(cloned);
    },
    deleteTerminalOlderThan: async (input) => {
      const cleanupInput = validateCleanupInput(input);
      const selected = Array.from(jobs.values())
        .filter((job) => job.tenantId === cleanupInput.tenantId)
        .filter((job) => terminalStages.has(job.stage))
        .filter((job) => job.completedAt !== undefined && job.completedAt < cleanupInput.olderThan)
        .slice(0, cleanupInput.maxJobs + 1);

      if (selected.length > cleanupInput.maxJobs) {
        throw new Error(`Document compilation cleanup maxJobs=${cleanupInput.maxJobs} exceeded`);
      }

      for (const job of selected) {
        jobs.delete(job.id);
      }

      return selected.length;
    },
    get: async (id) => {
      const job = jobs.get(id);
      return job ? cloneDocumentCompilationJob(job) : null;
    },
    getMany: async (ids) =>
      Array.from(new Set(ids))
        .map((id) => jobs.get(id))
        .filter((job): job is DocumentCompilationJob => Boolean(job))
        .map(cloneDocumentCompilationJob),
    update: async (job) => {
      if (!jobs.has(job.id)) {
        throw new Error(`Document compilation job ${job.id} not found`);
      }

      const cloned = cloneDocumentCompilationJob(job);
      jobs.set(cloned.id, cloned);
      return cloneDocumentCompilationJob(cloned);
    },
  };
}

function documentCompilationIdempotencyKey({
  documentAssetId,
  knowledgeSpaceId,
  tenantId,
  version,
}: StartDocumentCompilationJobInput): string {
  return `${tenantId}:${knowledgeSpaceId}:${documentAssetId}:${version}`;
}

function toDocumentCompilationJobPayload(
  documentCompilationJobId: string,
  publicationGenerationId: string | undefined,
  { documentAssetId, knowledgeSpaceId, tenantId, version }: StartDocumentCompilationJobInput,
): JobPayload {
  return {
    documentAssetId,
    documentCompilationJobId,
    knowledgeSpaceId,
    ...(publicationGenerationId ? { publicationGenerationId } : {}),
    tenantId,
    version,
  };
}

async function requireCompilationJob(
  repository: DocumentCompilationJobRepository,
  id: string,
): Promise<DocumentCompilationJob> {
  const job = await repository.get(id);

  if (!job) {
    throw new Error(`Document compilation job ${id} not found`);
  }

  return job;
}

function assertCanAdvance(
  job: DocumentCompilationJob,
  nextStage: DocumentCompilationJobStage,
): void {
  assertNotTerminal(job);

  if (nextStage === "failed" || nextStage === "canceled") {
    throw new Error(`Document compilation job cannot advance to ${nextStage}`);
  }

  const currentIndex = stageOrder.indexOf(job.stage);
  const nextIndex = stageOrder.indexOf(nextStage);

  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Document compilation job cannot advance from ${job.stage} to ${nextStage}`);
  }
}

function assertNotTerminal(job: DocumentCompilationJob): void {
  if (terminalStages.has(job.stage)) {
    throw new Error(`Document compilation job ${job.stage} is terminal`);
  }
}

function withoutRetrySchedule(
  job: DocumentCompilationJob,
): Omit<DocumentCompilationJob, "retryAt"> {
  const { retryAt: _retryAt, ...current } = job;
  return current;
}

function validateStartInput(input: StartDocumentCompilationJobInput): void {
  if (Boolean(input.permissionSnapshot) !== Boolean(input.requestedBySubjectId)) {
    throw new Error(
      "Document compilation requester and permission snapshot must be bound together",
    );
  }
  if (input.capabilityGrantId && input.permissionSnapshot) {
    throw new Error("Document compilation requires exactly one authorization binding");
  }
  if (input.capabilityGrantId) {
    UuidSchema.parse(input.capabilityGrantId);
  }
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim().length === 0) {
      throw new Error(`Document compilation job ${key} is required`);
    }
  }

  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error("Document compilation job version must be a positive integer");
  }
  if (
    input.permissionSnapshot &&
    (!input.permissionSnapshot.id.trim() ||
      !Number.isSafeInteger(input.permissionSnapshot.revision) ||
      input.permissionSnapshot.revision < 1 ||
      !["interactive", "service_api", "mcp", "agent"].includes(
        input.permissionSnapshot.accessChannel,
      ))
  ) {
    throw new Error("Document compilation job permission snapshot is invalid");
  }
}

function validateCleanupInput({
  maxJobs,
  olderThan,
  tenantId,
}: DeleteTerminalDocumentCompilationJobsInput): DeleteTerminalDocumentCompilationJobsInput {
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId) {
    throw new Error("Document compilation cleanup tenantId is required");
  }

  validateCleanupMaxJobs(maxJobs, "maxJobs");

  if (!Number.isSafeInteger(olderThan) || olderThan < 0) {
    throw new Error("Document compilation cleanup olderThan must be a non-negative integer");
  }

  return {
    maxJobs,
    olderThan,
    tenantId: normalizedTenantId,
  };
}

function validateCleanupMaxJobs(maxJobs: number, label: "maxCleanupJobs" | "maxJobs"): void {
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1) {
    throw new Error(`Document compilation cleanup ${label} must be at least 1`);
  }
}

function validateCleanupPayload(
  payload: JobPayload,
  maxCleanupJobs: number,
): DeleteTerminalDocumentCompilationJobsInput {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Document compilation cleanup payload is invalid");
  }

  const candidate = payload as Record<string, unknown>;
  const maxJobs = candidate.maxJobs;
  const olderThan = candidate.olderThan;
  const tenantId = candidate.tenantId;

  if (
    typeof maxJobs !== "number" ||
    typeof olderThan !== "number" ||
    typeof tenantId !== "string"
  ) {
    throw new Error("Document compilation cleanup payload is invalid");
  }

  if (maxJobs > maxCleanupJobs) {
    throw new Error(
      `Document compilation cleanup maxJobs exceeds maxCleanupJobs=${maxCleanupJobs}`,
    );
  }

  return validateCleanupInput({
    maxJobs,
    olderThan,
    tenantId,
  });
}

function cloneDocumentCompilationJob(job: DocumentCompilationJob): DocumentCompilationJob {
  return JSON.parse(JSON.stringify(job)) as DocumentCompilationJob;
}
