import { type JobQueueAdapter, PublicationGenerationIdSchema, UuidSchema } from "@knowledge/core";

import {
  type DocumentCompilationAttempt,
  DocumentCompilationAttemptHeadConflictError,
  type DocumentCompilationAttemptRepository,
} from "./document-compilation-attempt-repository";
import type {
  DocumentCompilationJob,
  DocumentCompilationJobStage,
  DocumentCompilationJobStateMachine,
  RetryDocumentCompilationJobInput,
  StartDocumentCompilationJobInput,
} from "./document-compilation-job";
import {
  type DurableTaskOperationalMetrics,
  recordDurableTaskOperationalMetric,
} from "./operational-metrics";

export interface DurableDocumentCompilationJobStateMachineOptions {
  readonly assertCompilationAdmission?:
    | ((
        input: Pick<
          StartDocumentCompilationJobInput,
          "bootstrapJobId" | "knowledgeSpaceId" | "tenantId"
        >,
      ) => Promise<void>)
    | undefined;
  readonly attempts: DocumentCompilationAttemptRepository;
  readonly generateAttemptId: () => string;
  readonly generateOutboxId: () => string;
  readonly generatePublicationGenerationId: () => string;
  readonly jobs?: Pick<JobQueueAdapter, "cancel"> | undefined;
  readonly maxExecutionAttempts: number;
  readonly maxHeadConflictRetries?: number | undefined;
  readonly metrics?: DurableTaskOperationalMetrics | undefined;
  readonly now?: (() => string) | undefined;
  readonly resolveBaseHeadRevision: (
    input: Pick<StartDocumentCompilationJobInput, "knowledgeSpaceId" | "tenantId">,
  ) => Promise<number>;
}

/**
 * Control-plane adapter for the durable attempt repository. Starting work commits only the
 * attempt and its outbox row; the dispatcher performs external enqueue after that transaction.
 */
export function createDurableDocumentCompilationJobStateMachine({
  assertCompilationAdmission,
  attempts,
  generateAttemptId,
  generateOutboxId,
  generatePublicationGenerationId,
  jobs,
  maxExecutionAttempts,
  maxHeadConflictRetries = 3,
  metrics,
  now = () => new Date().toISOString(),
  resolveBaseHeadRevision,
}: DurableDocumentCompilationJobStateMachineOptions): DocumentCompilationJobStateMachine {
  validatePositiveInteger(maxExecutionAttempts, "maxExecutionAttempts");
  validatePositiveInteger(maxHeadConflictRetries, "maxHeadConflictRetries");

  return {
    advance: async () => {
      throw new Error("Durable document compilation checkpoints are owned by the leased runner");
    },
    cancel: async (id, reason, input) => {
      const permissionBinding = normalizeRetryInput(input);
      const current = await requireAttempt(attempts, id);
      const canceled = await attempts.cancel({
        attemptId: current.id,
        expectedRowVersion: current.rowVersion,
        now: now(),
        ...permissionBinding,
        ...(reason ? { reason } : {}),
      });
      if (!canceled) {
        throw new Error("Document compilation attempt changed while canceling");
      }
      if (current.queueJobId) {
        await jobs?.cancel(current.queueJobId, reason).catch(() => undefined);
      }
      recordDurableTaskOperationalMetric(metrics, {
        lifecycle: "terminal",
        outcome: "canceled",
        taskKind: "document_compilation",
      });
      return attemptToCompilationJob(canceled);
    },
    fail: async () => {
      throw new Error("Durable document compilation failures are owned by the leased runner");
    },
    get: async (id) => {
      const attempt = await attempts.get(id);
      return attempt ? attemptToCompilationJob(attempt) : null;
    },
    getMany: async (ids) =>
      (await attempts.getMany(ids)).map((attempt) => attemptToCompilationJob(attempt)),
    releaseDispatch: async (id) => {
      if (!attempts.releaseDeferredDispatch) {
        throw new Error("Deferred document compilation dispatch is unavailable");
      }
      const current = await requireAttempt(attempts, id);
      const released = await attempts.releaseDeferredDispatch({
        attemptId: current.id,
        expectedRowVersion: current.rowVersion,
        now: now(),
      });
      if (!released) {
        throw new Error("Document compilation deferred dispatch cannot be released");
      }
      return attemptToCompilationJob(released);
    },
    retry: async (id, input) => {
      const permissionBinding = normalizeRetryInput(input);
      const current = await requireAttempt(attempts, id);
      await assertCompilationAdmission?.({
        knowledgeSpaceId: current.knowledgeSpaceId,
        tenantId: current.tenantId,
      });
      const retried = await attempts.retryTerminal({
        attemptId: current.id,
        expectedRowVersion: current.rowVersion,
        now: now(),
        ...permissionBinding,
      });
      if (!retried) {
        throw new Error("Document compilation attempt cannot be retried");
      }
      recordDurableTaskOperationalMetric(metrics, {
        lifecycle: "retry",
        taskKind: "document_compilation",
      });
      return attemptToCompilationJob(retried);
    },
    start: async (input) => {
      const normalized = normalizeStartInput(input);
      await assertCompilationAdmission?.({
        ...(normalized.bootstrapJobId ? { bootstrapJobId: normalized.bootstrapJobId } : {}),
        knowledgeSpaceId: normalized.knowledgeSpaceId,
        tenantId: normalized.tenantId,
      });
      const id = UuidSchema.parse(generateAttemptId());
      const outboxId = UuidSchema.parse(generateOutboxId());
      const publicationGenerationId = PublicationGenerationIdSchema.parse(
        generatePublicationGenerationId(),
      );

      for (let retry = 0; retry < maxHeadConflictRetries; retry += 1) {
        const baseHeadRevision = await resolveBaseHeadRevision(normalized);
        validateNonnegativeInteger(baseHeadRevision, "baseHeadRevision");
        try {
          const result = await attempts.start({
            ...(normalized.deferDispatch ? { availableAt: "9999-12-31T23:59:59.999Z" } : {}),
            baseHeadRevision,
            createdAt: now(),
            ...(normalized.capabilityGrantId
              ? { capabilityGrantId: normalized.capabilityGrantId }
              : {}),
            documentAssetId: normalized.documentAssetId,
            documentVersion: normalized.version,
            id,
            knowledgeSpaceId: normalized.knowledgeSpaceId,
            maxExecutionAttempts,
            outboxId,
            ...(normalized.permissionSnapshot
              ? { permissionSnapshot: normalized.permissionSnapshot }
              : {}),
            publicationGenerationId,
            ...(normalized.requestedBySubjectId
              ? { requestedBySubjectId: normalized.requestedBySubjectId }
              : {}),
            tenantId: normalized.tenantId,
          });
          if (result.created) {
            recordDurableTaskOperationalMetric(metrics, {
              lifecycle: "queued",
              taskKind: "document_compilation",
            });
          }
          return attemptToCompilationJob(result.attempt);
        } catch (error) {
          if (
            !(error instanceof DocumentCompilationAttemptHeadConflictError) ||
            retry === maxHeadConflictRetries - 1
          ) {
            throw error;
          }
        }
      }

      throw new Error("Document compilation attempt could not snapshot the publication head");
    },
  };
}

export function attemptToCompilationJob(
  attempt: DocumentCompilationAttempt,
): DocumentCompilationJob {
  return {
    baseHeadRevision: attempt.baseHeadRevision,
    ...(attempt.capabilityGrantId ? { capabilityGrantId: attempt.capabilityGrantId } : {}),
    ...(attempt.candidateFingerprint ? { candidateFingerprint: attempt.candidateFingerprint } : {}),
    ...(attempt.candidatePublicationId
      ? { candidatePublicationId: attempt.candidatePublicationId }
      : {}),
    ...(attempt.completedAt ? { completedAt: Date.parse(attempt.completedAt) } : {}),
    createdAt: Date.parse(attempt.createdAt),
    documentAssetId: attempt.documentAssetId,
    ...(attempt.lastErrorMessage ? { error: attempt.lastErrorMessage } : {}),
    executionAttempts: attempt.executionAttempts,
    id: attempt.id,
    knowledgeSpaceId: attempt.knowledgeSpaceId,
    ...(attempt.leaseExpiresAt ? { leaseExpiresAt: Date.parse(attempt.leaseExpiresAt) } : {}),
    maxExecutionAttempts: attempt.maxExecutionAttempts,
    ...(attempt.permissionSnapshot ? { permissionSnapshot: attempt.permissionSnapshot } : {}),
    publicationGenerationId: attempt.publicationGenerationId,
    ...(attempt.requestedBySubjectId ? { requestedBySubjectId: attempt.requestedBySubjectId } : {}),
    ...(attempt.queueJobId ? { queueJobId: attempt.queueJobId } : {}),
    ...(attempt.retryAt ? { retryAt: Date.parse(attempt.retryAt) } : {}),
    runState: attempt.runState,
    stage: attemptStage(attempt),
    tenantId: attempt.tenantId,
    updatedAt: Date.parse(attempt.updatedAt),
    version: attempt.documentVersion,
  };
}

function attemptStage(attempt: DocumentCompilationAttempt): DocumentCompilationJobStage {
  if (attempt.runState === "failed") {
    return "failed";
  }
  if (attempt.runState === "canceled" || attempt.runState === "superseded") {
    return "canceled";
  }
  return attempt.checkpoint;
}

async function requireAttempt(
  attempts: DocumentCompilationAttemptRepository,
  id: string,
): Promise<DocumentCompilationAttempt> {
  const attempt = await attempts.get(UuidSchema.parse(id));
  if (!attempt) {
    throw new Error(`Document compilation attempt ${id} not found`);
  }
  return attempt;
}

function normalizeStartInput(
  input: StartDocumentCompilationJobInput,
): StartDocumentCompilationJobInput {
  if (Boolean(input.permissionSnapshot) !== Boolean(input.requestedBySubjectId)) {
    throw new Error(
      "Document compilation requester and permission snapshot must be bound together",
    );
  }
  if (input.capabilityGrantId && input.permissionSnapshot) {
    throw new Error("Document compilation requires exactly one authorization binding");
  }
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new Error("Document compilation attempt tenantId is required");
  }
  if (tenantId.length > 255) {
    throw new Error("Document compilation attempt tenantId exceeds 255 characters");
  }
  validatePositiveInteger(input.version, "version");

  return {
    ...(input.bootstrapJobId ? { bootstrapJobId: UuidSchema.parse(input.bootstrapJobId) } : {}),
    ...(input.capabilityGrantId
      ? { capabilityGrantId: UuidSchema.parse(input.capabilityGrantId) }
      : {}),
    ...(input.deferDispatch ? { deferDispatch: true } : {}),
    documentAssetId: UuidSchema.parse(input.documentAssetId),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
    ...(input.requestedBySubjectId
      ? { requestedBySubjectId: requiredSubjectId(input.requestedBySubjectId) }
      : {}),
    tenantId,
    version: input.version,
  };
}

function normalizeRetryInput(
  input: RetryDocumentCompilationJobInput | undefined,
): RetryDocumentCompilationJobInput {
  if (!input) return {};
  if (Boolean(input.permissionSnapshot) !== Boolean(input.requestedBySubjectId)) {
    throw new Error(
      "Document compilation retry requester and permission snapshot must be bound together",
    );
  }
  if (input.capabilityGrantId && input.permissionSnapshot) {
    throw new Error("Document compilation requires exactly one authorization binding");
  }
  return {
    ...(input.capabilityGrantId
      ? { capabilityGrantId: UuidSchema.parse(input.capabilityGrantId) }
      : {}),
    ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
    ...(input.requestedBySubjectId
      ? { requestedBySubjectId: requiredSubjectId(input.requestedBySubjectId) }
      : {}),
  };
}

function requiredSubjectId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > 255) {
    throw new Error("Document compilation attempt requestedBySubjectId is invalid");
  }
  return normalized;
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Document compilation attempt ${name} must be a positive integer`);
  }
}

function validateNonnegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Document compilation attempt ${name} must be a non-negative integer`);
  }
}
