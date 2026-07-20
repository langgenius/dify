import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  ProjectionSetFingerprintSchema,
  PublicationGenerationIdSchema,
  UuidSchema,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { assertDatabaseKnowledgeSpacePermissionFence } from "./knowledge-space-access-control";
import type { KnowledgeSpaceDurablePermissionReference } from "./knowledge-space-authorization";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

export const DocumentCompilationCheckpoints = [
  "queued",
  "parsed",
  "outline_built",
  "nodes_generated",
  "projection_built",
  "smoke_eval_passed",
  "published",
] as const;
export type DocumentCompilationCheckpoint = (typeof DocumentCompilationCheckpoints)[number];

export const DocumentCompilationAttemptRunStates = [
  "dispatch_pending",
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "canceled",
  "superseded",
] as const;
export type DocumentCompilationAttemptRunState =
  (typeof DocumentCompilationAttemptRunStates)[number];

export const DocumentCompilationOutboxStatuses = [
  "pending",
  "dispatching",
  "dispatched",
  "leased",
  "completed",
  "canceled",
  "dead",
] as const;
export type DocumentCompilationOutboxStatus = (typeof DocumentCompilationOutboxStatuses)[number];

export const DocumentCompilationOutboxEventType = "document.compile" as const;
export const DocumentCompilationOutboxSchemaVersion = 1 as const;

export interface DocumentCompilationAttempt {
  readonly activeSlot?: 1 | undefined;
  readonly baseHeadRevision: number;
  readonly candidateFingerprint?: string | undefined;
  readonly candidatePublicationId?: string | undefined;
  readonly checkpoint: DocumentCompilationCheckpoint;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
  readonly executionAttempts: number;
  readonly externalJobId?: string | undefined;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly maxExecutionAttempts: number;
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  readonly publicationGenerationId: string;
  readonly queueJobId?: string | undefined;
  readonly requestedBySubjectId?: string | undefined;
  readonly retrievalProfile?: DocumentCompilationProfileReference | undefined;
  readonly retryAt?: string | undefined;
  readonly rowVersion: number;
  readonly runState: DocumentCompilationAttemptRunState;
  readonly startedAt?: string | undefined;
  readonly tenantId: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

/** Exact immutable profile identity captured before any compilation work is admitted. */
export interface DocumentCompilationProfileReference {
  readonly kind: "embedding" | "retrieval";
  readonly revision: number;
  readonly revisionId: string;
  readonly snapshotDigest: string;
}

export interface DocumentCompilationOutboxPayload {
  readonly attemptId: string;
}

export interface DocumentCompilationOutboxEvent {
  readonly attemptId: string;
  readonly availableAt: string;
  readonly createdAt: string;
  readonly deliveredAt?: string | undefined;
  readonly dispatchAttempts: number;
  readonly eventType: typeof DocumentCompilationOutboxEventType;
  readonly externalJobId?: string | undefined;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly lastError?: string | undefined;
  readonly lockedBy?: string | undefined;
  readonly lockedUntil?: string | undefined;
  readonly lockToken?: string | undefined;
  readonly payload: DocumentCompilationOutboxPayload;
  readonly queueJobId?: string | undefined;
  readonly schemaVersion: typeof DocumentCompilationOutboxSchemaVersion;
  readonly status: DocumentCompilationOutboxStatus;
  readonly updatedAt: string;
}

export interface StartDocumentCompilationAttemptInput {
  readonly availableAt?: string | undefined;
  readonly baseHeadRevision: number;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  /** In-memory/test writers may provide a frozen reference. Database writers derive it in-transaction. */
  readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly maxExecutionAttempts: number;
  readonly outboxId: string;
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  readonly publicationGenerationId: string;
  readonly requestedBySubjectId?: string | undefined;
  /** In-memory/test writers may provide a frozen reference. Database writers derive it in-transaction. */
  readonly retrievalProfile?: DocumentCompilationProfileReference | undefined;
  readonly tenantId: string;
}

export interface ReleaseDeferredDocumentCompilationDispatchInput {
  readonly attemptId: string;
  readonly expectedRowVersion: number;
  readonly now: string;
}

export interface StartDocumentCompilationAttemptResult {
  readonly attempt: DocumentCompilationAttempt;
  readonly created: boolean;
  readonly outbox: DocumentCompilationOutboxEvent;
}

export interface ClaimDocumentCompilationAttemptInput {
  readonly attemptId: string;
  readonly expectedRowVersion: number;
  readonly externalJobId?: string | undefined;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly queueJobId: string;
  readonly workerId: string;
}

export interface HeartbeatDocumentCompilationAttemptInput {
  readonly attemptId: string;
  readonly expectedRowVersion: number;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly workerId: string;
}

export interface AdvanceDocumentCompilationAttemptInput {
  readonly attemptId: string;
  readonly candidateFingerprint?: string | undefined;
  readonly candidatePublicationId?: string | undefined;
  readonly checkpoint: DocumentCompilationCheckpoint;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly now: string;
}

export interface BindInitialDocumentCompilationProfilesInput {
  readonly attemptId: string;
  readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly now: string;
  readonly retrievalProfile: DocumentCompilationProfileReference;
}

export interface ScheduleDocumentCompilationRetryInput {
  readonly attemptId: string;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly now: string;
  readonly retryAt: string;
}

export interface CompleteDocumentCompilationAttemptInput {
  readonly attemptId: string;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly now: string;
}

export interface FailDocumentCompilationAttemptInput
  extends CompleteDocumentCompilationAttemptInput {
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface FailExhaustedDocumentCompilationAttemptInput {
  readonly attemptId: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly expectedRowVersion: number;
  readonly now: string;
}

export interface CancelDocumentCompilationAttemptInput {
  readonly attemptId: string;
  readonly expectedRowVersion: number;
  readonly now: string;
  /** Fresh caller permission used by public control operations; internal cleanup omits it. */
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  readonly requestedBySubjectId?: string | undefined;
  readonly reason?: string | undefined;
}

export interface SupersedeDocumentCompilationAttemptInput {
  readonly attemptId: string;
  readonly expectedRowVersion: number;
  readonly now: string;
  readonly reason?: string | undefined;
}

export interface RetryTerminalDocumentCompilationAttemptInput {
  readonly attemptId: string;
  readonly availableAt?: string | undefined;
  readonly expectedRowVersion: number;
  readonly now: string;
  /** Rebinds a user-requested retry to the current caller's immutable permission snapshot. */
  readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
  readonly requestedBySubjectId?: string | undefined;
}

export interface DeleteTerminalDocumentCompilationAttemptsInput {
  readonly maxJobs: number;
  readonly olderThan: string;
  readonly tenantId: string;
}

export interface ClaimDocumentCompilationOutboxInput {
  readonly limit: number;
  readonly lockedUntil: string;
  readonly lockToken: string;
  readonly now: string;
  readonly workerId: string;
}

export interface MarkDocumentCompilationOutboxDispatchedInput {
  readonly availableAt: string;
  readonly deliveredAt: string;
  readonly externalJobId?: string | undefined;
  readonly lockToken: string;
  readonly now: string;
  readonly outboxId: string;
  readonly queueJobId: string;
}

export interface ReleaseDocumentCompilationOutboxInput {
  readonly availableAt: string;
  readonly deadLetter?: boolean | undefined;
  readonly error: string;
  readonly lockToken: string;
  readonly now: string;
  readonly outboxId: string;
}

export interface DocumentCompilationAttemptRepository {
  advance(
    input: AdvanceDocumentCompilationAttemptInput,
  ): Promise<DocumentCompilationAttempt | null>;
  bindInitialProfiles(
    input: BindInitialDocumentCompilationProfilesInput,
  ): Promise<DocumentCompilationAttempt | null>;
  cancel(input: CancelDocumentCompilationAttemptInput): Promise<DocumentCompilationAttempt | null>;
  claim(input: ClaimDocumentCompilationAttemptInput): Promise<DocumentCompilationAttempt | null>;
  claimOutbox(
    input: ClaimDocumentCompilationOutboxInput,
  ): Promise<readonly DocumentCompilationOutboxEvent[]>;
  complete(
    input: CompleteDocumentCompilationAttemptInput,
  ): Promise<DocumentCompilationAttempt | null>;
  deleteTerminalOlderThan(input: DeleteTerminalDocumentCompilationAttemptsInput): Promise<number>;
  fail(input: FailDocumentCompilationAttemptInput): Promise<DocumentCompilationAttempt | null>;
  failExhausted(
    input: FailExhaustedDocumentCompilationAttemptInput,
  ): Promise<DocumentCompilationAttempt | null>;
  get(id: string): Promise<DocumentCompilationAttempt | null>;
  getMany(ids: readonly string[]): Promise<readonly DocumentCompilationAttempt[]>;
  heartbeat(
    input: HeartbeatDocumentCompilationAttemptInput,
  ): Promise<DocumentCompilationAttempt | null>;
  markOutboxDispatched(
    input: MarkDocumentCompilationOutboxDispatchedInput,
  ): Promise<DocumentCompilationOutboxEvent | null>;
  releaseOutbox(
    input: ReleaseDocumentCompilationOutboxInput,
  ): Promise<DocumentCompilationOutboxEvent | null>;
  releaseDeferredDispatch?(
    input: ReleaseDeferredDocumentCompilationDispatchInput,
  ): Promise<DocumentCompilationAttempt | null>;
  retryTerminal(
    input: RetryTerminalDocumentCompilationAttemptInput,
  ): Promise<DocumentCompilationAttempt | null>;
  scheduleRetry(
    input: ScheduleDocumentCompilationRetryInput,
  ): Promise<DocumentCompilationAttempt | null>;
  start(
    input: StartDocumentCompilationAttemptInput,
  ): Promise<StartDocumentCompilationAttemptResult>;
  supersede(
    input: SupersedeDocumentCompilationAttemptInput,
  ): Promise<DocumentCompilationAttempt | null>;
}

export interface InMemoryDocumentCompilationAttemptRepositoryOptions {
  readonly maxAttempts?: number | undefined;
  readonly maxOutboxClaimBatchSize?: number | undefined;
  readonly maxOutboxEvents?: number | undefined;
}

export interface DatabaseDocumentCompilationAttemptRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxOutboxClaimBatchSize?: number | undefined;
}

export class DocumentCompilationAttemptHeadConflictError extends Error {
  readonly actualHeadRevision: number;
  readonly expectedHeadRevision: number;

  constructor(expectedHeadRevision: number, actualHeadRevision: number) {
    super(
      `Document compilation base head revision conflict: expected=${expectedHeadRevision} actual=${actualHeadRevision}`,
    );
    this.expectedHeadRevision = expectedHeadRevision;
    this.actualHeadRevision = actualHeadRevision;
  }
}

export class DocumentCompilationAttemptCapacityExceededError extends Error {}
export class DocumentCompilationAttemptTransitionError extends Error {}

const deferredDispatchAvailableAt = "9999-12-31T23:59:59.999Z";

export function createInMemoryDocumentCompilationAttemptRepository(
  options: InMemoryDocumentCompilationAttemptRepositoryOptions = {},
): DocumentCompilationAttemptRepository {
  const maxAttempts = positiveBound(options.maxAttempts ?? 10_000, "maxAttempts");
  const maxOutboxEvents = positiveBound(options.maxOutboxEvents ?? 10_000, "maxOutboxEvents");
  const maxOutboxClaimBatchSize = positiveBound(
    options.maxOutboxClaimBatchSize ?? 100,
    "maxOutboxClaimBatchSize",
  );
  const attempts = new Map<string, DocumentCompilationAttempt>();
  const outbox = new Map<string, DocumentCompilationOutboxEvent>();

  const writeAttempt = (attempt: DocumentCompilationAttempt): DocumentCompilationAttempt => {
    const parsed = parseAttempt(attempt);
    attempts.set(parsed.id, parsed);
    return cloneAttempt(parsed);
  };
  const writeOutbox = (event: DocumentCompilationOutboxEvent): DocumentCompilationOutboxEvent => {
    const parsed = parseOutboxEvent(event);
    outbox.set(parsed.id, parsed);
    return cloneOutboxEvent(parsed);
  };

  return {
    advance: async (input) => {
      const current = fencedMemoryAttempt(attempts, input);
      if (!current || !hasLiveLease(current, input.leaseToken, input.now)) {
        return null;
      }
      assertCheckpointAdvance(current.checkpoint, input.checkpoint);
      const { candidateFingerprint, candidatePublicationId } = resolveCandidateBinding(
        current,
        input,
      );
      assertCandidateBoundForCheckpoint(
        input.checkpoint,
        candidatePublicationId,
        candidateFingerprint,
      );
      return writeAttempt({
        ...current,
        ...(candidateFingerprint ? { candidateFingerprint } : {}),
        ...(candidatePublicationId ? { candidatePublicationId } : {}),
        checkpoint: input.checkpoint,
        rowVersion: current.rowVersion + 1,
        updatedAt: canonicalDateTime(input.now, "now"),
      });
    },
    bindInitialProfiles: async (input) => {
      const current = fencedMemoryAttempt(attempts, input);
      if (!current || !hasLiveLease(current, input.leaseToken, input.now)) {
        return null;
      }
      const profiles = parseInitialProfileBinding(input);
      assertInitialProfilesCanBeBound(current);
      return writeAttempt({
        ...current,
        ...(profiles.embeddingProfile ? { embeddingProfile: profiles.embeddingProfile } : {}),
        retrievalProfile: profiles.retrievalProfile,
        rowVersion: current.rowVersion + 1,
        updatedAt: canonicalDateTime(input.now, "now"),
      });
    },
    cancel: async (input) => {
      const permissionBinding = parseRetryPermissionBinding(input);
      return terminalMemoryTransition(
        attempts,
        outbox,
        input,
        "canceled",
        input.reason,
        permissionBinding,
      );
    },
    claim: async (input) => {
      const current = fencedMemoryAttempt(attempts, input);
      const now = canonicalDateTime(input.now, "now");
      const leaseExpiresAt = canonicalDateTime(input.leaseExpiresAt, "leaseExpiresAt");
      const leaseToken = nonzeroUuid(input.leaseToken, "leaseToken");
      const event = current ? requiredMemoryOutbox(outbox, current.id) : undefined;
      if (
        !current ||
        !event ||
        !isAttemptClaimable(current, now) ||
        current.executionAttempts >= current.maxExecutionAttempts ||
        leaseExpiresAt <= now ||
        !matchesDeliveryIdentity(current, event, input.queueJobId, input.externalJobId)
      ) {
        return null;
      }
      const nextAttempt = parseAttempt({
        ...current,
        executionAttempts: current.executionAttempts + 1,
        heartbeatAt: now,
        leaseExpiresAt,
        leaseToken,
        retryAt: undefined,
        rowVersion: current.rowVersion + 1,
        runState: "running",
        startedAt: current.startedAt ?? now,
        updatedAt: now,
        workerId: requiredString(input.workerId, "workerId", 255),
      });
      const nextOutbox = parseOutboxEvent({
        ...event,
        availableAt: leaseExpiresAt,
        status: "leased",
        updatedAt: now,
      });
      attempts.set(nextAttempt.id, nextAttempt);
      outbox.set(nextOutbox.id, nextOutbox);
      return cloneAttempt(nextAttempt);
    },
    claimOutbox: async (input) => {
      validateClaimOutboxInput(input, maxOutboxClaimBatchSize);
      const now = canonicalDateTime(input.now, "now");
      const lockedUntil = canonicalDateTime(input.lockedUntil, "lockedUntil");
      if (lockedUntil <= now) {
        throw new Error("Document compilation outbox lockedUntil must be after now");
      }
      const lockToken = nonzeroUuid(input.lockToken, "lockToken");
      const workerId = requiredString(input.workerId, "workerId", 255);
      const eligible = Array.from(outbox.values())
        .filter((event) => isOutboxClaimable(event, now))
        .sort(compareOutboxEvents)
        .slice(0, input.limit);

      return eligible.map((event) =>
        writeOutbox({
          ...event,
          dispatchAttempts: event.dispatchAttempts + 1,
          lockedBy: workerId,
          lockedUntil,
          lockToken,
          status: "dispatching",
          updatedAt: now,
        }),
      );
    },
    complete: async (input) => {
      const current = fencedMemoryAttempt(attempts, input);
      if (!current || !hasLiveLease(current, input.leaseToken, input.now)) {
        return null;
      }
      assertCheckpointAdvance(current.checkpoint, "published");
      return commitMemoryTerminal(
        attempts,
        outbox,
        current,
        "succeeded",
        input.now,
        undefined,
        "published",
      );
    },
    deleteTerminalOlderThan: async (input) => {
      const tenantId = tenantIdValue(input.tenantId);
      const olderThan = canonicalDateTime(input.olderThan, "olderThan");
      const maxJobs = positiveBound(input.maxJobs, "maxJobs");
      const candidates = Array.from(attempts.values())
        .filter((attempt) => attempt.tenantId === tenantId)
        .filter((attempt) => isTerminalRunState(attempt.runState))
        .filter((attempt) => (attempt.completedAt ?? attempt.updatedAt) < olderThan)
        .sort(
          (left, right) =>
            left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
        )
        .slice(0, maxJobs);
      for (const attempt of candidates) {
        attempts.delete(attempt.id);
        for (const event of outbox.values()) {
          if (event.attemptId === attempt.id) {
            outbox.delete(event.id);
          }
        }
      }
      return candidates.length;
    },
    fail: async (input) => {
      const current = fencedMemoryAttempt(attempts, input);
      if (!current || !hasLiveLease(current, input.leaseToken, input.now)) {
        return null;
      }
      const errorCode = requiredString(input.errorCode, "errorCode", 64);
      const errorMessage = requiredString(input.errorMessage, "errorMessage");
      return commitMemoryTerminal(attempts, outbox, current, "failed", input.now, {
        errorCode,
        errorMessage,
      });
    },
    failExhausted: async (input) => {
      const current = fencedMemoryAttempt(attempts, input);
      const now = canonicalDateTime(input.now, "now");
      if (!current || !isAttemptExhaustedAndRecoverable(current, now)) {
        return null;
      }
      return commitMemoryTerminal(attempts, outbox, current, "failed", now, {
        errorCode: requiredString(input.errorCode, "errorCode", 64),
        errorMessage: requiredString(input.errorMessage, "errorMessage"),
      });
    },
    get: async (id) => {
      const attempt = attempts.get(uuid(id, "attemptId"));
      return attempt ? cloneAttempt(attempt) : null;
    },
    getMany: async (ids) => {
      const unique = Array.from(new Set(ids.map((id) => uuid(id, "attemptId"))));
      return unique.flatMap((id) => {
        const attempt = attempts.get(id);
        return attempt ? [cloneAttempt(attempt)] : [];
      });
    },
    heartbeat: async (input) => {
      const current = fencedMemoryAttempt(attempts, input);
      const now = canonicalDateTime(input.now, "now");
      const leaseExpiresAt = canonicalDateTime(input.leaseExpiresAt, "leaseExpiresAt");
      if (
        !current ||
        !hasLiveLease(current, input.leaseToken, now) ||
        leaseExpiresAt <= now ||
        current.workerId !== requiredString(input.workerId, "workerId", 255)
      ) {
        return null;
      }
      const event = requiredMemoryOutbox(outbox, current.id);
      if (event.status !== "leased") {
        return null;
      }
      const nextAttempt = parseAttempt({
        ...current,
        heartbeatAt: now,
        leaseExpiresAt,
        rowVersion: current.rowVersion + 1,
        updatedAt: now,
      });
      const nextEvent = parseOutboxEvent({
        ...event,
        availableAt: leaseExpiresAt,
        updatedAt: now,
      });
      attempts.set(nextAttempt.id, nextAttempt);
      outbox.set(nextEvent.id, nextEvent);
      return cloneAttempt(nextAttempt);
    },
    markOutboxDispatched: async (input) => {
      const id = uuid(input.outboxId, "outboxId");
      const current = outbox.get(id);
      const lockToken = nonzeroUuid(input.lockToken, "lockToken");
      if (!current || current.status !== "dispatching" || current.lockToken !== lockToken) {
        return null;
      }
      const now = canonicalDateTime(input.now, "now");
      const deliveredAt = canonicalDateTime(input.deliveredAt, "deliveredAt");
      const availableAt = canonicalDateTime(input.availableAt, "availableAt");
      if (availableAt <= now) {
        throw new Error("Document compilation outbox availableAt must be after now");
      }
      const attempt = attempts.get(current.attemptId);
      if (!attempt || !canAcceptOutboxRedispatch(attempt, now)) {
        return null;
      }
      const event = parseOutboxEvent({
        ...current,
        availableAt,
        deliveredAt,
        externalJobId: optionalString(input.externalJobId, "externalJobId", 255),
        lastError: undefined,
        lockedBy: undefined,
        lockedUntil: undefined,
        lockToken: undefined,
        queueJobId: requiredString(input.queueJobId, "queueJobId", 255),
        status: "dispatched",
        updatedAt: now,
      });
      const nextAttempt = parseAttempt({
        ...attempt,
        externalJobId: event.externalJobId,
        queueJobId: event.queueJobId,
        ...(attempt.runState === "running" ? {} : { retryAt: undefined }),
        rowVersion: attempt.rowVersion + 1,
        runState: attempt.runState === "running" ? "running" : "queued",
        updatedAt: now,
      });
      outbox.set(event.id, event);
      attempts.set(nextAttempt.id, nextAttempt);
      return cloneOutboxEvent(event);
    },
    releaseOutbox: async (input) => {
      const id = uuid(input.outboxId, "outboxId");
      const current = outbox.get(id);
      const lockToken = nonzeroUuid(input.lockToken, "lockToken");
      if (!current || current.status !== "dispatching" || current.lockToken !== lockToken) {
        return null;
      }
      const now = canonicalDateTime(input.now, "now");
      const nextEvent = parseOutboxEvent({
        ...current,
        availableAt: canonicalDateTime(input.availableAt, "availableAt"),
        lastError: requiredString(input.error, "error"),
        lockedBy: undefined,
        lockedUntil: undefined,
        lockToken: undefined,
        status: input.deadLetter ? "dead" : "pending",
        updatedAt: now,
      });
      if (input.deadLetter) {
        const attempt = attempts.get(nextEvent.attemptId);
        if (!attempt || !canAcceptOutboxRedispatch(attempt, now)) {
          throw new DocumentCompilationAttemptTransitionError(
            "Dead outbox does not reference an undispatched active attempt",
          );
        }
        const nextAttempt = toTerminalAttempt(attempt, "failed", now, {
          errorCode: "OUTBOX_DEAD",
          errorMessage: nextEvent.lastError ?? "Outbox delivery failed",
        });
        outbox.set(nextEvent.id, nextEvent);
        attempts.set(nextAttempt.id, nextAttempt);
        return cloneOutboxEvent(nextEvent);
      }
      outbox.set(nextEvent.id, nextEvent);
      return cloneOutboxEvent(nextEvent);
    },
    releaseDeferredDispatch: async (input) => {
      const current = attempts.get(uuid(input.attemptId, "attemptId"));
      if (
        !current ||
        current.rowVersion !== nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
        current.runState !== "dispatch_pending"
      ) {
        return null;
      }
      const event = requiredMemoryOutbox(outbox, current.id);
      if (event.status !== "pending" || event.availableAt !== deferredDispatchAvailableAt) {
        return null;
      }
      const now = canonicalDateTime(input.now, "now");
      const nextAttempt = writeAttempt({
        ...current,
        rowVersion: current.rowVersion + 1,
        updatedAt: now,
      });
      writeOutbox({ ...event, availableAt: now, updatedAt: now });
      return nextAttempt;
    },
    retryTerminal: async (input) => {
      const permissionBinding = parseRetryPermissionBinding(input);
      const id = uuid(input.attemptId, "attemptId");
      const current = attempts.get(id);
      if (
        !current ||
        current.rowVersion !== nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
        current.runState !== "failed"
      ) {
        return null;
      }
      const active = Array.from(attempts.values()).find(
        (attempt) =>
          attempt.id !== current.id &&
          attempt.activeSlot === 1 &&
          activeScopeKey(attempt) === activeScopeKey(current),
      );
      if (active) {
        return null;
      }
      const event = requiredMemoryOutbox(outbox, current.id);
      const now = canonicalDateTime(input.now, "now");
      const nextEvent = parseOutboxEvent({
        ...event,
        availableAt: canonicalDateTime(input.availableAt ?? input.now, "availableAt"),
        deliveredAt: undefined,
        dispatchAttempts: 0,
        externalJobId: undefined,
        lastError: undefined,
        lockedBy: undefined,
        lockedUntil: undefined,
        lockToken: undefined,
        queueJobId: undefined,
        status: "pending",
        updatedAt: now,
      });
      const nextAttempt = parseAttempt({
        ...current,
        activeSlot: 1,
        completedAt: undefined,
        executionAttempts: 0,
        externalJobId: undefined,
        heartbeatAt: undefined,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        queueJobId: undefined,
        ...permissionBinding,
        retryAt: undefined,
        rowVersion: current.rowVersion + 1,
        runState: "dispatch_pending",
        startedAt: undefined,
        updatedAt: now,
        workerId: undefined,
      });
      outbox.set(nextEvent.id, nextEvent);
      attempts.set(nextAttempt.id, nextAttempt);
      return cloneAttempt(nextAttempt);
    },
    scheduleRetry: async (input) => {
      const current = fencedMemoryAttempt(attempts, input);
      const now = canonicalDateTime(input.now, "now");
      if (!current || !hasLiveLease(current, input.leaseToken, now)) {
        return null;
      }
      const retryAt = canonicalDateTime(input.retryAt, "retryAt");
      if (retryAt <= now || current.executionAttempts >= current.maxExecutionAttempts) {
        return null;
      }
      const event = requiredMemoryOutbox(outbox, current.id);
      const nextAttempt = parseAttempt({
        ...current,
        externalJobId: undefined,
        heartbeatAt: undefined,
        lastErrorCode: optionalString(input.errorCode, "errorCode", 64),
        lastErrorMessage: optionalString(input.errorMessage, "errorMessage"),
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        queueJobId: undefined,
        retryAt,
        rowVersion: current.rowVersion + 1,
        runState: "retry_wait",
        updatedAt: now,
        workerId: undefined,
      });
      const nextEvent = parseOutboxEvent({
        ...event,
        availableAt: retryAt,
        deliveredAt: undefined,
        dispatchAttempts: 0,
        externalJobId: undefined,
        lastError: optionalString(input.errorMessage, "errorMessage"),
        lockedBy: undefined,
        lockedUntil: undefined,
        lockToken: undefined,
        queueJobId: undefined,
        status: "pending",
        updatedAt: now,
      });
      attempts.set(nextAttempt.id, nextAttempt);
      outbox.set(nextEvent.id, nextEvent);
      return cloneAttempt(nextAttempt);
    },
    start: async (input) => {
      const parsed = parseStartInput(input);
      const existing = Array.from(attempts.values()).find(
        (attempt) => attempt.activeSlot === 1 && activeScopeKey(attempt) === activeScopeKey(parsed),
      );
      if (existing) {
        const event = Array.from(outbox.values()).find(
          (candidate) =>
            candidate.attemptId === existing.id &&
            candidate.eventType === DocumentCompilationOutboxEventType,
        );
        if (!event) {
          throw new Error("Active document compilation attempt has no durable outbox event");
        }
        return { attempt: cloneAttempt(existing), created: false, outbox: cloneOutboxEvent(event) };
      }
      if (attempts.size >= maxAttempts || outbox.size >= maxOutboxEvents) {
        throw new DocumentCompilationAttemptCapacityExceededError(
          "Document compilation attempt repository capacity exceeded",
        );
      }
      if (attempts.has(parsed.id) || outbox.has(parsed.outboxId)) {
        throw new DocumentCompilationAttemptTransitionError(
          "Document compilation attempt or outbox ID already exists",
        );
      }
      const attempt = startAttempt(parsed);
      const event = startOutboxEvent(parsed);
      attempts.set(attempt.id, attempt);
      outbox.set(event.id, event);
      return { attempt: cloneAttempt(attempt), created: true, outbox: cloneOutboxEvent(event) };
    },
    supersede: async (input) =>
      terminalMemoryTransition(attempts, outbox, input, "superseded", input.reason),
  };
}

export function createDatabaseDocumentCompilationAttemptRepository({
  database,
  maxOutboxClaimBatchSize: configuredMaxOutboxClaimBatchSize = 100,
}: DatabaseDocumentCompilationAttemptRepositoryOptions): DocumentCompilationAttemptRepository {
  const maxOutboxClaimBatchSize = positiveBound(
    configuredMaxOutboxClaimBatchSize,
    "maxOutboxClaimBatchSize",
  );

  return {
    advance: async (input) =>
      databaseMutateFencedAttempt(database, input, async (current, transaction) => {
        assertCheckpointAdvance(current.checkpoint, input.checkpoint);
        const { candidateFingerprint, candidatePublicationId, newlyBound } =
          resolveCandidateBinding(current, input);
        assertCandidateBoundForCheckpoint(
          input.checkpoint,
          candidatePublicationId,
          candidateFingerprint,
        );
        if (newlyBound && candidatePublicationId && candidateFingerprint) {
          await requireDatabaseCandidateBinding(database, transaction, current, {
            candidateFingerprint,
            candidatePublicationId,
          });
        }
        return {
          ...current,
          ...(candidateFingerprint ? { candidateFingerprint } : {}),
          ...(candidatePublicationId ? { candidatePublicationId } : {}),
          checkpoint: input.checkpoint,
          rowVersion: current.rowVersion + 1,
          updatedAt: canonicalDateTime(input.now, "now"),
        };
      }),
    bindInitialProfiles: async (input) => {
      const requested = parseInitialProfileBinding(input);
      return databaseMutateFencedAttempt(database, input, async (current, transaction) => {
        assertInitialProfilesCanBeBound(current);
        const active = await databaseActiveCompilationProfiles(database, transaction, current);
        if (!active.retrievalProfile) {
          throw new DocumentCompilationAttemptTransitionError(
            "Document compilation cannot bind initial profiles before a retrieval profile is active",
          );
        }
        if (
          !sameProfileReference(requested.retrievalProfile, active.retrievalProfile) ||
          Boolean(requested.embeddingProfile) !== Boolean(active.embeddingProfile) ||
          (requested.embeddingProfile &&
            active.embeddingProfile &&
            !sameProfileReference(requested.embeddingProfile, active.embeddingProfile))
        ) {
          throw new DocumentCompilationAttemptTransitionError(
            "Document compilation requested initial profiles are no longer active",
          );
        }
        return {
          ...current,
          ...(active.embeddingProfile ? { embeddingProfile: active.embeddingProfile } : {}),
          retrievalProfile: active.retrievalProfile,
          rowVersion: current.rowVersion + 1,
          updatedAt: canonicalDateTime(input.now, "now"),
        };
      });
    },
    cancel: async (input) =>
      databaseTerminalControlTransition(database, input, "canceled", input.reason),
    claim: async (input) =>
      database.transaction(async (transaction) => {
        const current = await databaseGetAttempt(database, transaction, input.attemptId, true);
        if (
          !current ||
          current.rowVersion !== nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion")
        ) {
          return null;
        }
        const event = await databaseGetAttemptOutbox(database, transaction, current.id, true);
        const now = canonicalDateTime(input.now, "now");
        const leaseExpiresAt = canonicalDateTime(input.leaseExpiresAt, "leaseExpiresAt");
        if (
          !event ||
          !isAttemptClaimable(current, now) ||
          current.executionAttempts >= current.maxExecutionAttempts ||
          leaseExpiresAt <= now ||
          !matchesDeliveryIdentity(current, event, input.queueJobId, input.externalJobId)
        ) {
          return null;
        }
        const nextAttempt = await databasePersistAttempt(
          database,
          transaction,
          {
            ...current,
            executionAttempts: current.executionAttempts + 1,
            heartbeatAt: now,
            leaseExpiresAt,
            leaseToken: nonzeroUuid(input.leaseToken, "leaseToken"),
            retryAt: undefined,
            rowVersion: current.rowVersion + 1,
            runState: "running",
            startedAt: current.startedAt ?? now,
            updatedAt: now,
            workerId: requiredString(input.workerId, "workerId", 255),
          },
          current.rowVersion,
        );
        await databasePersistOutbox(database, transaction, {
          ...event,
          availableAt: leaseExpiresAt,
          status: "leased",
          updatedAt: now,
        });
        return nextAttempt;
      }),
    claimOutbox: async (input) => {
      validateClaimOutboxInput(input, maxOutboxClaimBatchSize);
      const now = canonicalDateTime(input.now, "now");
      const lockedUntil = canonicalDateTime(input.lockedUntil, "lockedUntil");
      if (lockedUntil <= now) {
        throw new Error("Document compilation outbox lockedUntil must be after now");
      }
      const lockToken = nonzeroUuid(input.lockToken, "lockToken");
      const workerId = requiredString(input.workerId, "workerId", 255);

      return database.transaction(async (transaction) => {
        const params: DatabaseQueryValue[] = [now, now, input.limit];
        const result = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params,
          sql: `SELECT * FROM ${quoteDatabaseIdentifier(
            database,
            outboxTableName,
          )} WHERE ((${quoteDatabaseIdentifier(
            database,
            "status",
          )} IN ('pending', 'dispatched', 'leased') AND ${quoteDatabaseIdentifier(
            database,
            "available_at",
          )} <= ${databasePlaceholder(database, 1)}) OR (${quoteDatabaseIdentifier(
            database,
            "status",
          )} = 'dispatching' AND ${quoteDatabaseIdentifier(
            database,
            "locked_until",
          )} <= ${databasePlaceholder(database, 2)})) ORDER BY ${quoteDatabaseIdentifier(
            database,
            "available_at",
          )} ASC, ${quoteDatabaseIdentifier(database, "created_at")} ASC, ${quoteDatabaseIdentifier(
            database,
            "id",
          )} ASC LIMIT ${databasePlaceholder(database, 3)} FOR UPDATE${
            database.dialect === "postgres" ? " SKIP LOCKED" : ""
          };`,
          tableName: outboxTableName,
        });
        const claimed: DocumentCompilationOutboxEvent[] = [];
        for (const row of result.rows) {
          const event = mapOutboxRow(row);
          claimed.push(
            await databasePersistOutbox(database, transaction, {
              ...event,
              dispatchAttempts: event.dispatchAttempts + 1,
              lockedBy: workerId,
              lockedUntil,
              lockToken,
              status: "dispatching",
              updatedAt: now,
            }),
          );
        }
        return claimed;
      });
    },
    complete: async (input) =>
      databaseTerminalFencedTransition(database, input, "succeeded", (current) => {
        assertCheckpointAdvance(current.checkpoint, "published");
        return { checkpoint: "published" };
      }),
    deleteTerminalOlderThan: async (input) => {
      const tenantId = tenantIdValue(input.tenantId);
      const olderThan = canonicalDateTime(input.olderThan, "olderThan");
      const maxJobs = positiveBound(input.maxJobs, "maxJobs");
      return database.transaction(async (transaction) => {
        const selected = await transaction.execute({
          maxRows: maxJobs,
          operation: "select",
          params: [tenantId, olderThan, maxJobs],
          sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
            database,
            attemptTableName,
          )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
            database,
            1,
          )} AND ${quoteDatabaseIdentifier(
            database,
            "run_state",
          )} IN ('succeeded', 'failed', 'canceled', 'superseded') AND ${quoteDatabaseIdentifier(
            database,
            "completed_at",
          )} < ${databasePlaceholder(database, 2)} ORDER BY ${quoteDatabaseIdentifier(
            database,
            "completed_at",
          )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
            database,
            3,
          )} FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
          tableName: attemptTableName,
        });
        const ids = selected.rows.map((row) => uuid(stringColumn(row, "id"), "attemptId"));
        if (ids.length === 0) {
          return 0;
        }
        const placeholders = ids.map((_, index) => databasePlaceholder(database, index + 1));
        const deleted = await transaction.execute({
          maxRows: ids.length,
          operation: "delete",
          params: ids,
          sql: `DELETE FROM ${quoteDatabaseIdentifier(
            database,
            attemptTableName,
          )} WHERE ${quoteDatabaseIdentifier(database, "id")} IN (${placeholders.join(", ")});`,
          tableName: attemptTableName,
        });
        if (deleted.rowsAffected !== ids.length) {
          throw new Error("Document compilation attempt cleanup changed concurrently");
        }
        return deleted.rowsAffected;
      });
    },
    fail: async (input) =>
      databaseTerminalFencedTransition(database, input, "failed", () => ({
        error: {
          errorCode: requiredString(input.errorCode, "errorCode", 64),
          errorMessage: requiredString(input.errorMessage, "errorMessage"),
        },
      })),
    failExhausted: async (input) =>
      database.transaction(async (transaction) => {
        const current = await databaseGetAttempt(database, transaction, input.attemptId, true);
        const now = canonicalDateTime(input.now, "now");
        if (
          !current ||
          current.rowVersion !==
            nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
          !isAttemptExhaustedAndRecoverable(current, now)
        ) {
          return null;
        }
        return databaseCommitTerminal(database, transaction, current, "failed", now, {
          errorCode: requiredString(input.errorCode, "errorCode", 64),
          errorMessage: requiredString(input.errorMessage, "errorMessage"),
        });
      }),
    get: async (id) => databaseGetAttempt(database, database, id, false),
    getMany: async (ids) => databaseGetManyAttempts(database, ids),
    heartbeat: async (input) =>
      database.transaction(async (transaction) => {
        const current = await databaseGetAttempt(database, transaction, input.attemptId, true);
        const now = canonicalDateTime(input.now, "now");
        const leaseExpiresAt = canonicalDateTime(input.leaseExpiresAt, "leaseExpiresAt");
        if (
          !current ||
          current.rowVersion !==
            nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
          !hasLiveLease(current, input.leaseToken, now) ||
          leaseExpiresAt <= now ||
          current.workerId !== requiredString(input.workerId, "workerId", 255)
        ) {
          return null;
        }
        const event = await databaseGetAttemptOutbox(database, transaction, current.id, true);
        if (!event || event.status !== "leased") {
          return null;
        }
        const nextAttempt = await databasePersistAttempt(
          database,
          transaction,
          {
            ...current,
            heartbeatAt: now,
            leaseExpiresAt,
            rowVersion: current.rowVersion + 1,
            updatedAt: now,
          },
          current.rowVersion,
        );
        await databasePersistOutbox(database, transaction, {
          ...event,
          availableAt: leaseExpiresAt,
          updatedAt: now,
        });
        return nextAttempt;
      }),
    markOutboxDispatched: async (input) =>
      database.transaction(async (transaction) => {
        const lockToken = nonzeroUuid(input.lockToken, "lockToken");
        const locked = await databaseLockAttemptThenDispatchingOutbox(
          database,
          transaction,
          input.outboxId,
          lockToken,
        );
        if (!locked) {
          return null;
        }
        const { attempt, outbox: current } = locked;
        const now = canonicalDateTime(input.now, "now");
        const availableAt = canonicalDateTime(input.availableAt, "availableAt");
        if (availableAt <= now) {
          throw new Error("Document compilation outbox availableAt must be after now");
        }
        if (!canAcceptOutboxRedispatch(attempt, now)) {
          return null;
        }
        const event = parseOutboxEvent({
          ...current,
          availableAt,
          deliveredAt: canonicalDateTime(input.deliveredAt, "deliveredAt"),
          externalJobId: optionalString(input.externalJobId, "externalJobId", 255),
          lastError: undefined,
          lockedBy: undefined,
          lockedUntil: undefined,
          lockToken: undefined,
          queueJobId: requiredString(input.queueJobId, "queueJobId", 255),
          status: "dispatched",
          updatedAt: now,
        });
        await databasePersistAttempt(
          database,
          transaction,
          {
            ...attempt,
            externalJobId: event.externalJobId,
            queueJobId: event.queueJobId,
            ...(attempt.runState === "running" ? {} : { retryAt: undefined }),
            rowVersion: attempt.rowVersion + 1,
            runState: attempt.runState === "running" ? "running" : "queued",
            updatedAt: now,
          },
          attempt.rowVersion,
        );
        await databasePersistOutbox(database, transaction, event);
        return event;
      }),
    releaseOutbox: async (input) =>
      database.transaction(async (transaction) => {
        const lockToken = nonzeroUuid(input.lockToken, "lockToken");
        const locked = input.deadLetter
          ? await databaseLockAttemptThenDispatchingOutbox(
              database,
              transaction,
              input.outboxId,
              lockToken,
            )
          : null;
        const current = input.deadLetter
          ? locked?.outbox
          : await databaseGetOutbox(database, transaction, input.outboxId, true);
        if (!current || current.status !== "dispatching" || current.lockToken !== lockToken) {
          return null;
        }
        const now = canonicalDateTime(input.now, "now");
        const deadAttempt = locked?.attempt;
        if (input.deadLetter && (!deadAttempt || !canAcceptOutboxRedispatch(deadAttempt, now))) {
          throw new DocumentCompilationAttemptTransitionError(
            "Dead outbox does not reference an undispatched active attempt",
          );
        }
        const event = parseOutboxEvent({
          ...current,
          availableAt: canonicalDateTime(input.availableAt, "availableAt"),
          lastError: requiredString(input.error, "error"),
          lockedBy: undefined,
          lockedUntil: undefined,
          lockToken: undefined,
          status: input.deadLetter ? "dead" : "pending",
          updatedAt: now,
        });
        if (input.deadLetter && deadAttempt) {
          await databasePersistAttempt(
            database,
            transaction,
            toTerminalAttempt(deadAttempt, "failed", now, {
              errorCode: "OUTBOX_DEAD",
              errorMessage: event.lastError ?? "Outbox delivery failed",
            }),
            deadAttempt.rowVersion,
          );
        }
        await databasePersistOutbox(database, transaction, event);
        return event;
      }),
    releaseDeferredDispatch: async (input) =>
      database.transaction(async (transaction) => {
        const expectedRowVersion = nonnegativeInteger(
          input.expectedRowVersion,
          "expectedRowVersion",
        );
        const accepts = (attempt: DocumentCompilationAttempt) =>
          attempt.rowVersion === expectedRowVersion && attempt.runState === "dispatch_pending";
        const observed = await databaseGetAttempt(database, transaction, input.attemptId, false);
        if (!observed || !accepts(observed)) return null;
        const current = await databaseLockCompilationControlAttemptAfterSpace(
          database,
          transaction,
          observed,
          accepts,
        );
        if (!current) return null;
        const event = await databaseGetAttemptOutbox(database, transaction, current.id, true);
        if (
          !event ||
          event.status !== "pending" ||
          event.availableAt !== deferredDispatchAvailableAt
        ) {
          return null;
        }
        const now = canonicalDateTime(input.now, "now");
        await requireDatabaseCompilationControlResources(
          database,
          transaction,
          current,
          {
            ...(current.permissionSnapshot
              ? { permissionSnapshot: current.permissionSnapshot }
              : {}),
            ...(current.requestedBySubjectId
              ? { requestedBySubjectId: current.requestedBySubjectId }
              : {}),
          },
          now,
          Boolean(current.permissionSnapshot),
        );
        const released = await databasePersistAttempt(
          database,
          transaction,
          { ...current, rowVersion: current.rowVersion + 1, updatedAt: now },
          current.rowVersion,
        );
        await databasePersistOutbox(database, transaction, {
          ...event,
          availableAt: now,
          updatedAt: now,
        });
        return released;
      }),
    retryTerminal: async (input) =>
      database.transaction(async (transaction) => {
        const permissionBinding = parseRetryPermissionBinding(input);
        const expectedRowVersion = nonnegativeInteger(
          input.expectedRowVersion,
          "expectedRowVersion",
        );
        const accepts = (attempt: DocumentCompilationAttempt) =>
          attempt.rowVersion === expectedRowVersion && attempt.runState === "failed";
        const observed = await databaseGetAttempt(database, transaction, input.attemptId, false);
        if (!observed || !accepts(observed)) return null;
        const current = await databaseLockCompilationControlAttemptAfterSpace(
          database,
          transaction,
          observed,
          accepts,
        );
        if (!current) return null;
        const active = await databaseGetActiveAttempt(database, transaction, current, true);
        if (active) {
          return null;
        }
        await requireDatabaseCompilationControlResources(
          database,
          transaction,
          current,
          permissionBinding,
          canonicalDateTime(input.now, "now"),
          true,
        );
        await restoreDatabaseCompilationProductIntent(database, transaction, current);
        const event = await databaseGetAttemptOutbox(database, transaction, current.id, true);
        if (!event) {
          throw new Error("Document compilation retry has no durable outbox event");
        }
        const now = canonicalDateTime(input.now, "now");
        await databasePersistOutbox(database, transaction, {
          ...event,
          availableAt: canonicalDateTime(input.availableAt ?? input.now, "availableAt"),
          deliveredAt: undefined,
          dispatchAttempts: 0,
          externalJobId: undefined,
          lastError: undefined,
          lockedBy: undefined,
          lockedUntil: undefined,
          lockToken: undefined,
          queueJobId: undefined,
          status: "pending",
          updatedAt: now,
        });
        return databasePersistAttempt(
          database,
          transaction,
          {
            ...current,
            activeSlot: 1,
            completedAt: undefined,
            executionAttempts: 0,
            externalJobId: undefined,
            heartbeatAt: undefined,
            lastErrorCode: undefined,
            lastErrorMessage: undefined,
            leaseExpiresAt: undefined,
            leaseToken: undefined,
            queueJobId: undefined,
            ...permissionBinding,
            retryAt: undefined,
            rowVersion: current.rowVersion + 1,
            runState: "dispatch_pending",
            startedAt: undefined,
            updatedAt: now,
            workerId: undefined,
          },
          current.rowVersion,
        );
      }),
    scheduleRetry: async (input) =>
      database.transaction(async (transaction) => {
        const current = await databaseGetAttempt(database, transaction, input.attemptId, true);
        const now = canonicalDateTime(input.now, "now");
        if (
          !current ||
          current.rowVersion !==
            nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
          !hasLiveLease(current, input.leaseToken, now)
        ) {
          return null;
        }
        const retryAt = canonicalDateTime(input.retryAt, "retryAt");
        if (retryAt <= now || current.executionAttempts >= current.maxExecutionAttempts) {
          return null;
        }
        const event = await databaseGetAttemptOutbox(database, transaction, current.id, true);
        if (!event) {
          throw new Error("Document compilation attempt has no durable outbox event");
        }
        const nextAttempt = await databasePersistAttempt(
          database,
          transaction,
          {
            ...current,
            externalJobId: undefined,
            heartbeatAt: undefined,
            lastErrorCode: optionalString(input.errorCode, "errorCode", 64),
            lastErrorMessage: optionalString(input.errorMessage, "errorMessage"),
            leaseExpiresAt: undefined,
            leaseToken: undefined,
            queueJobId: undefined,
            retryAt,
            rowVersion: current.rowVersion + 1,
            runState: "retry_wait",
            updatedAt: now,
            workerId: undefined,
          },
          current.rowVersion,
        );
        await databasePersistOutbox(database, transaction, {
          ...event,
          availableAt: retryAt,
          deliveredAt: undefined,
          dispatchAttempts: 0,
          externalJobId: undefined,
          lastError: optionalString(input.errorMessage, "errorMessage"),
          lockedBy: undefined,
          lockedUntil: undefined,
          lockToken: undefined,
          queueJobId: undefined,
          status: "pending",
          updatedAt: now,
        });
        return nextAttempt;
      }),
    start: async (input) => databaseStartAttempt(database, input),
    supersede: async (input) =>
      databaseTerminalControlTransition(database, input, "superseded", input.reason),
  };
}

interface ParsedStartDocumentCompilationAttemptInput
  extends Omit<StartDocumentCompilationAttemptInput, "availableAt"> {
  readonly availableAt: string;
}

type TerminalDocumentCompilationAttemptRunState = Extract<
  DocumentCompilationAttemptRunState,
  "canceled" | "failed" | "succeeded" | "superseded"
>;

const checkpointOrder = new Map<DocumentCompilationCheckpoint, number>(
  DocumentCompilationCheckpoints.map((checkpoint, index) => [checkpoint, index]),
);
const attemptRunStateSet = new Set<string>(DocumentCompilationAttemptRunStates);
const checkpointSet = new Set<string>(DocumentCompilationCheckpoints);
const outboxStatusSet = new Set<string>(DocumentCompilationOutboxStatuses);
const permissionAccessChannels = new Set(["interactive", "service_api", "mcp", "agent"]);

function parsePermissionSnapshotReference(
  input: KnowledgeSpaceDurablePermissionReference,
): KnowledgeSpaceDurablePermissionReference {
  const accessChannel = input.accessChannel;
  if (!permissionAccessChannels.has(accessChannel)) {
    throw new Error("Document compilation permission snapshot accessChannel is invalid");
  }
  return {
    accessChannel,
    id: uuid(input.id, "permissionSnapshot.id"),
    revision: positiveInteger(input.revision, "permissionSnapshot.revision"),
  };
}

function permissionSnapshotFromRow(
  row: DatabaseRow,
): KnowledgeSpaceDurablePermissionReference | undefined {
  const id = optionalStringColumn(row, "permission_snapshot_id");
  const revision = optionalNumberColumn(row, "permission_snapshot_revision");
  const accessChannel = optionalStringColumn(row, "access_channel");
  if (id === undefined && revision === undefined && accessChannel === undefined) {
    return undefined;
  }
  if (id === undefined || revision === undefined || accessChannel === undefined) {
    throw new Error("Document compilation permission snapshot database binding is incomplete");
  }
  return parsePermissionSnapshotReference({
    accessChannel: accessChannel as KnowledgeSpaceDurablePermissionReference["accessChannel"],
    id,
    revision,
  });
}

function profileReferenceFromRow(
  row: DatabaseRow,
  kind: DocumentCompilationProfileReference["kind"],
): DocumentCompilationProfileReference | undefined {
  const storedKind = optionalStringColumn(row, `${kind}_profile_kind`);
  const revisionId = optionalStringColumn(row, `${kind}_profile_revision_id`);
  const revision = optionalNumberColumn(row, `${kind}_profile_revision`);
  const snapshotDigest = optionalStringColumn(row, `${kind}_profile_snapshot_digest`);
  if (
    storedKind === undefined &&
    revisionId === undefined &&
    revision === undefined &&
    snapshotDigest === undefined
  ) {
    return undefined;
  }
  if (
    storedKind === undefined ||
    revisionId === undefined ||
    revision === undefined ||
    snapshotDigest === undefined
  ) {
    throw new Error(`Document compilation ${kind} profile database binding is incomplete`);
  }
  return parseProfileReference(
    {
      kind: storedKind as DocumentCompilationProfileReference["kind"],
      revision,
      revisionId,
      snapshotDigest,
    },
    kind,
  );
}

function parseProfileReference(
  input: DocumentCompilationProfileReference,
  expectedKind: DocumentCompilationProfileReference["kind"],
): DocumentCompilationProfileReference {
  if (input.kind !== expectedKind) {
    throw new Error(`Document compilation ${expectedKind} profile kind is invalid`);
  }
  const snapshotDigest = input.snapshotDigest.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(snapshotDigest)) {
    throw new Error(`Document compilation ${expectedKind} profile snapshotDigest is invalid`);
  }
  return {
    kind: expectedKind,
    revision: positiveInteger(input.revision, `${expectedKind}Profile.revision`),
    revisionId: uuid(input.revisionId, `${expectedKind}Profile.revisionId`),
    snapshotDigest,
  };
}

function sameProfileReference(
  left: DocumentCompilationProfileReference,
  right: DocumentCompilationProfileReference,
): boolean {
  return (
    left.kind === right.kind &&
    left.revisionId === right.revisionId &&
    left.revision === right.revision &&
    left.snapshotDigest === right.snapshotDigest
  );
}

function parseInitialProfileBinding(
  input: Pick<BindInitialDocumentCompilationProfilesInput, "embeddingProfile" | "retrievalProfile">,
): {
  readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
  readonly retrievalProfile: DocumentCompilationProfileReference;
} {
  return {
    ...(input.embeddingProfile
      ? { embeddingProfile: parseProfileReference(input.embeddingProfile, "embedding") }
      : {}),
    retrievalProfile: parseProfileReference(input.retrievalProfile, "retrieval"),
  };
}

function assertInitialProfilesCanBeBound(current: DocumentCompilationAttempt): void {
  if (
    current.checkpoint !== "queued" ||
    current.embeddingProfile !== undefined ||
    current.retrievalProfile !== undefined ||
    current.candidatePublicationId !== undefined ||
    current.candidateFingerprint !== undefined
  ) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation initial profiles can only be bound once before processing starts",
    );
  }
}

function parseRetryPermissionBinding(
  input: Pick<
    RetryTerminalDocumentCompilationAttemptInput,
    "permissionSnapshot" | "requestedBySubjectId"
  >,
): Pick<DocumentCompilationAttempt, "permissionSnapshot" | "requestedBySubjectId"> {
  if (Boolean(input.permissionSnapshot) !== Boolean(input.requestedBySubjectId)) {
    throw new Error(
      "Document compilation retry requester and permission snapshot must be bound together",
    );
  }
  if (!input.permissionSnapshot || !input.requestedBySubjectId) return {};
  return {
    permissionSnapshot: parsePermissionSnapshotReference(input.permissionSnapshot),
    requestedBySubjectId: requiredString(input.requestedBySubjectId, "requestedBySubjectId", 255),
  };
}

function parseStartInput(
  input: StartDocumentCompilationAttemptInput,
): ParsedStartDocumentCompilationAttemptInput {
  if (Boolean(input.permissionSnapshot) !== Boolean(input.requestedBySubjectId)) {
    throw new Error(
      "Document compilation requester and permission snapshot must be bound together",
    );
  }
  const createdAt = canonicalDateTime(input.createdAt, "createdAt");
  return {
    availableAt: canonicalDateTime(input.availableAt ?? input.createdAt, "availableAt"),
    baseHeadRevision: nonnegativeInteger(input.baseHeadRevision, "baseHeadRevision"),
    createdAt,
    documentAssetId: uuid(input.documentAssetId, "documentAssetId"),
    documentVersion: positiveInteger(input.documentVersion, "documentVersion"),
    ...(input.embeddingProfile
      ? { embeddingProfile: parseProfileReference(input.embeddingProfile, "embedding") }
      : {}),
    id: uuid(input.id, "attemptId"),
    knowledgeSpaceId: uuid(input.knowledgeSpaceId, "knowledgeSpaceId"),
    maxExecutionAttempts: positiveInteger(input.maxExecutionAttempts, "maxExecutionAttempts"),
    outboxId: uuid(input.outboxId, "outboxId"),
    ...(input.permissionSnapshot
      ? { permissionSnapshot: parsePermissionSnapshotReference(input.permissionSnapshot) }
      : {}),
    publicationGenerationId: PublicationGenerationIdSchema.parse(input.publicationGenerationId),
    ...(input.requestedBySubjectId
      ? {
          requestedBySubjectId: requiredString(
            input.requestedBySubjectId,
            "requestedBySubjectId",
            255,
          ),
        }
      : {}),
    ...(input.retrievalProfile
      ? { retrievalProfile: parseProfileReference(input.retrievalProfile, "retrieval") }
      : {}),
    tenantId: tenantIdValue(input.tenantId),
  };
}

function startAttempt(
  input: ParsedStartDocumentCompilationAttemptInput,
): DocumentCompilationAttempt {
  return parseAttempt({
    activeSlot: 1,
    baseHeadRevision: input.baseHeadRevision,
    checkpoint: "queued",
    createdAt: input.createdAt,
    documentAssetId: input.documentAssetId,
    documentVersion: input.documentVersion,
    ...(input.embeddingProfile ? { embeddingProfile: input.embeddingProfile } : {}),
    executionAttempts: 0,
    id: input.id,
    knowledgeSpaceId: input.knowledgeSpaceId,
    maxExecutionAttempts: input.maxExecutionAttempts,
    ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
    publicationGenerationId: input.publicationGenerationId,
    ...(input.requestedBySubjectId ? { requestedBySubjectId: input.requestedBySubjectId } : {}),
    ...(input.retrievalProfile ? { retrievalProfile: input.retrievalProfile } : {}),
    rowVersion: 0,
    runState: "dispatch_pending",
    tenantId: input.tenantId,
    updatedAt: input.createdAt,
  });
}

function startOutboxEvent(
  input: ParsedStartDocumentCompilationAttemptInput,
): DocumentCompilationOutboxEvent {
  return parseOutboxEvent({
    attemptId: input.id,
    availableAt: input.availableAt,
    createdAt: input.createdAt,
    dispatchAttempts: 0,
    eventType: DocumentCompilationOutboxEventType,
    id: input.outboxId,
    idempotencyKey: `${DocumentCompilationOutboxEventType}:${input.id}`,
    payload: { attemptId: input.id },
    schemaVersion: DocumentCompilationOutboxSchemaVersion,
    status: "pending",
    updatedAt: input.createdAt,
  });
}

function parseAttempt(input: DocumentCompilationAttempt): DocumentCompilationAttempt {
  if (Boolean(input.permissionSnapshot) !== Boolean(input.requestedBySubjectId)) {
    throw new Error(
      "Document compilation requester and permission snapshot must be bound together",
    );
  }
  const runState = enumValue(
    input.runState,
    attemptRunStateSet,
    "runState",
  ) as DocumentCompilationAttemptRunState;
  const checkpoint = enumValue(
    input.checkpoint,
    checkpointSet,
    "checkpoint",
  ) as DocumentCompilationCheckpoint;
  const activeSlot = input.activeSlot;
  const isTerminal = isTerminalRunState(runState);
  if ((isTerminal && activeSlot !== undefined) || (!isTerminal && activeSlot !== 1)) {
    throw new Error("Document compilation attempt activeSlot does not match runState");
  }
  const completedAt = optionalDateTime(input.completedAt, "completedAt");
  if ((isTerminal && completedAt === undefined) || (!isTerminal && completedAt !== undefined)) {
    throw new Error("Document compilation attempt completedAt does not match runState");
  }
  const workerId = optionalString(input.workerId, "workerId", 255);
  const leaseToken = optionalNonzeroUuid(input.leaseToken, "leaseToken");
  const leaseExpiresAt = optionalDateTime(input.leaseExpiresAt, "leaseExpiresAt");
  const heartbeatAt = optionalDateTime(input.heartbeatAt, "heartbeatAt");
  const hasCompleteLease =
    workerId !== undefined &&
    leaseToken !== undefined &&
    leaseExpiresAt !== undefined &&
    heartbeatAt !== undefined;
  const hasAnyLease =
    workerId !== undefined ||
    leaseToken !== undefined ||
    leaseExpiresAt !== undefined ||
    heartbeatAt !== undefined;
  if ((runState === "running" && !hasCompleteLease) || (runState !== "running" && hasAnyLease)) {
    throw new Error("Document compilation attempt lease columns do not match runState");
  }
  const retryAt = optionalDateTime(input.retryAt, "retryAt");
  if ((runState === "retry_wait") !== (retryAt !== undefined)) {
    throw new Error("Document compilation attempt retryAt does not match runState");
  }
  const candidatePublicationId = optionalUuid(
    input.candidatePublicationId,
    "candidatePublicationId",
  );
  const candidateFingerprint = input.candidateFingerprint
    ? ProjectionSetFingerprintSchema.parse(input.candidateFingerprint)
    : undefined;
  assertCandidatePair(candidatePublicationId, candidateFingerprint);
  assertCandidateBoundForCheckpoint(checkpoint, candidatePublicationId, candidateFingerprint);
  const executionAttempts = nonnegativeInteger(input.executionAttempts, "executionAttempts");
  const maxExecutionAttempts = positiveInteger(input.maxExecutionAttempts, "maxExecutionAttempts");
  if (executionAttempts > maxExecutionAttempts) {
    throw new Error("Document compilation attempt executionAttempts exceeds maxExecutionAttempts");
  }

  return {
    ...(activeSlot === 1 ? { activeSlot: 1 as const } : {}),
    baseHeadRevision: nonnegativeInteger(input.baseHeadRevision, "baseHeadRevision"),
    ...(candidateFingerprint ? { candidateFingerprint } : {}),
    ...(candidatePublicationId ? { candidatePublicationId } : {}),
    checkpoint,
    ...(completedAt ? { completedAt } : {}),
    createdAt: canonicalDateTime(input.createdAt, "createdAt"),
    documentAssetId: uuid(input.documentAssetId, "documentAssetId"),
    documentVersion: positiveInteger(input.documentVersion, "documentVersion"),
    ...(input.embeddingProfile
      ? { embeddingProfile: parseProfileReference(input.embeddingProfile, "embedding") }
      : {}),
    executionAttempts,
    ...(optionalString(input.externalJobId, "externalJobId", 255)
      ? { externalJobId: optionalString(input.externalJobId, "externalJobId", 255) }
      : {}),
    ...(heartbeatAt ? { heartbeatAt } : {}),
    id: uuid(input.id, "attemptId"),
    knowledgeSpaceId: uuid(input.knowledgeSpaceId, "knowledgeSpaceId"),
    ...(optionalString(input.lastErrorCode, "lastErrorCode", 64)
      ? { lastErrorCode: optionalString(input.lastErrorCode, "lastErrorCode", 64) }
      : {}),
    ...(optionalString(input.lastErrorMessage, "lastErrorMessage")
      ? { lastErrorMessage: optionalString(input.lastErrorMessage, "lastErrorMessage") }
      : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(leaseToken ? { leaseToken } : {}),
    maxExecutionAttempts,
    ...(input.permissionSnapshot
      ? { permissionSnapshot: parsePermissionSnapshotReference(input.permissionSnapshot) }
      : {}),
    publicationGenerationId: PublicationGenerationIdSchema.parse(input.publicationGenerationId),
    ...(optionalString(input.requestedBySubjectId, "requestedBySubjectId", 255)
      ? {
          requestedBySubjectId: optionalString(
            input.requestedBySubjectId,
            "requestedBySubjectId",
            255,
          ),
        }
      : {}),
    ...(input.retrievalProfile
      ? { retrievalProfile: parseProfileReference(input.retrievalProfile, "retrieval") }
      : {}),
    ...(optionalString(input.queueJobId, "queueJobId", 255)
      ? { queueJobId: optionalString(input.queueJobId, "queueJobId", 255) }
      : {}),
    ...(retryAt ? { retryAt } : {}),
    rowVersion: nonnegativeInteger(input.rowVersion, "rowVersion"),
    runState,
    ...(optionalDateTime(input.startedAt, "startedAt")
      ? { startedAt: optionalDateTime(input.startedAt, "startedAt") }
      : {}),
    tenantId: tenantIdValue(input.tenantId),
    updatedAt: canonicalDateTime(input.updatedAt, "updatedAt"),
    ...(workerId ? { workerId } : {}),
  };
}

function parseOutboxEvent(input: DocumentCompilationOutboxEvent): DocumentCompilationOutboxEvent {
  const status = enumValue(
    input.status,
    outboxStatusSet,
    "outbox status",
  ) as DocumentCompilationOutboxStatus;
  const lockedBy = optionalString(input.lockedBy, "lockedBy", 255);
  const lockToken = optionalNonzeroUuid(input.lockToken, "lockToken");
  const lockedUntil = optionalDateTime(input.lockedUntil, "lockedUntil");
  const hasCompleteLock =
    lockedBy !== undefined && lockToken !== undefined && lockedUntil !== undefined;
  const hasAnyLock = lockedBy !== undefined || lockToken !== undefined || lockedUntil !== undefined;
  if ((status === "dispatching" && !hasCompleteLock) || (status !== "dispatching" && hasAnyLock)) {
    throw new Error("Document compilation outbox lock columns do not match status");
  }
  const attemptId = uuid(input.attemptId, "attemptId");
  const payload = parseOutboxPayload(input.payload);
  if (payload.attemptId !== attemptId) {
    throw new Error("Document compilation outbox payload attemptId does not match attemptId");
  }
  if (input.eventType !== DocumentCompilationOutboxEventType) {
    throw new Error(`Unsupported document compilation outbox eventType=${input.eventType}`);
  }
  if (input.schemaVersion !== DocumentCompilationOutboxSchemaVersion) {
    throw new Error(`Unsupported document compilation outbox schemaVersion=${input.schemaVersion}`);
  }
  return {
    attemptId,
    availableAt: canonicalDateTime(input.availableAt, "availableAt"),
    createdAt: canonicalDateTime(input.createdAt, "createdAt"),
    ...(optionalDateTime(input.deliveredAt, "deliveredAt")
      ? { deliveredAt: optionalDateTime(input.deliveredAt, "deliveredAt") }
      : {}),
    dispatchAttempts: nonnegativeInteger(input.dispatchAttempts, "dispatchAttempts"),
    eventType: DocumentCompilationOutboxEventType,
    ...(optionalString(input.externalJobId, "externalJobId", 255)
      ? { externalJobId: optionalString(input.externalJobId, "externalJobId", 255) }
      : {}),
    id: uuid(input.id, "outboxId"),
    idempotencyKey: requiredString(input.idempotencyKey, "idempotencyKey", 255),
    ...(optionalString(input.lastError, "lastError")
      ? { lastError: optionalString(input.lastError, "lastError") }
      : {}),
    ...(lockedBy ? { lockedBy } : {}),
    ...(lockedUntil ? { lockedUntil } : {}),
    ...(lockToken ? { lockToken } : {}),
    payload,
    ...(optionalString(input.queueJobId, "queueJobId", 255)
      ? { queueJobId: optionalString(input.queueJobId, "queueJobId", 255) }
      : {}),
    schemaVersion: DocumentCompilationOutboxSchemaVersion,
    status,
    updatedAt: canonicalDateTime(input.updatedAt, "updatedAt"),
  };
}

function parseOutboxPayload(input: unknown): DocumentCompilationOutboxPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Document compilation outbox payload must be an object");
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "attemptId") {
    throw new Error("Document compilation outbox payload must contain only attemptId");
  }
  const attemptId = (input as Record<string, unknown>).attemptId;
  if (typeof attemptId !== "string") {
    throw new Error("Document compilation outbox payload attemptId must be a UUID");
  }
  return { attemptId: uuid(attemptId, "payload.attemptId") };
}

function cloneAttempt(input: DocumentCompilationAttempt): DocumentCompilationAttempt {
  return parseAttempt(JSON.parse(JSON.stringify(input)) as DocumentCompilationAttempt);
}

function cloneOutboxEvent(input: DocumentCompilationOutboxEvent): DocumentCompilationOutboxEvent {
  return parseOutboxEvent(JSON.parse(JSON.stringify(input)) as DocumentCompilationOutboxEvent);
}

function activeScopeKey(
  input: Pick<
    DocumentCompilationAttempt,
    "documentAssetId" | "documentVersion" | "knowledgeSpaceId" | "tenantId"
  >,
): string {
  return `${input.tenantId}:${input.knowledgeSpaceId}:${input.documentAssetId}:${input.documentVersion}`;
}

function fencedMemoryAttempt(
  attempts: Map<string, DocumentCompilationAttempt>,
  input: { readonly attemptId: string; readonly expectedRowVersion: number },
): DocumentCompilationAttempt | null {
  const attempt = attempts.get(uuid(input.attemptId, "attemptId"));
  return attempt?.rowVersion === nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion")
    ? attempt
    : null;
}

function hasLiveLease(
  attempt: DocumentCompilationAttempt,
  leaseToken: string,
  nowInput: string,
): boolean {
  const now = canonicalDateTime(nowInput, "now");
  return (
    attempt.runState === "running" &&
    attempt.leaseToken === nonzeroUuid(leaseToken, "leaseToken") &&
    attempt.leaseExpiresAt !== undefined &&
    attempt.leaseExpiresAt > now
  );
}

function isAttemptClaimable(attempt: DocumentCompilationAttempt, now: string): boolean {
  return (
    attempt.runState === "queued" ||
    (attempt.runState === "retry_wait" &&
      attempt.retryAt !== undefined &&
      attempt.retryAt <= now) ||
    (attempt.runState === "running" &&
      attempt.leaseExpiresAt !== undefined &&
      attempt.leaseExpiresAt <= now)
  );
}

function isAttemptExhaustedAndRecoverable(
  attempt: DocumentCompilationAttempt,
  now: string,
): boolean {
  if (attempt.activeSlot !== 1 || attempt.executionAttempts < attempt.maxExecutionAttempts) {
    return false;
  }
  return (
    attempt.runState === "queued" ||
    (attempt.runState === "retry_wait" &&
      attempt.retryAt !== undefined &&
      attempt.retryAt <= now) ||
    (attempt.runState === "running" &&
      attempt.leaseExpiresAt !== undefined &&
      attempt.leaseExpiresAt <= now)
  );
}

function isOutboxClaimable(event: DocumentCompilationOutboxEvent, now: string): boolean {
  return (
    ((event.status === "pending" || event.status === "dispatched" || event.status === "leased") &&
      event.availableAt <= now) ||
    (event.status === "dispatching" && event.lockedUntil !== undefined && event.lockedUntil <= now)
  );
}

function canAcceptOutboxRedispatch(attempt: DocumentCompilationAttempt, now: string): boolean {
  return (
    attempt.runState === "dispatch_pending" ||
    attempt.runState === "retry_wait" ||
    attempt.runState === "queued" ||
    (attempt.runState === "running" &&
      attempt.leaseExpiresAt !== undefined &&
      attempt.leaseExpiresAt <= now)
  );
}

function compareOutboxEvents(
  left: DocumentCompilationOutboxEvent,
  right: DocumentCompilationOutboxEvent,
): number {
  return (
    left.availableAt.localeCompare(right.availableAt) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function assertCheckpointAdvance(
  current: DocumentCompilationCheckpoint,
  next: DocumentCompilationCheckpoint,
): void {
  const currentIndex = checkpointOrder.get(current);
  const nextIndex = checkpointOrder.get(next);
  if (
    currentIndex === undefined ||
    nextIndex === undefined ||
    (next !== current && nextIndex !== currentIndex + 1)
  ) {
    throw new DocumentCompilationAttemptTransitionError(
      `Document compilation checkpoint cannot advance from ${current} to ${next}`,
    );
  }
}

function assertCandidatePair(
  candidatePublicationId: string | undefined,
  candidateFingerprint: string | undefined,
): void {
  if ((candidatePublicationId === undefined) !== (candidateFingerprint === undefined)) {
    throw new Error(
      "Document compilation candidatePublicationId and candidateFingerprint must be set together",
    );
  }
}

function assertCandidateBoundForCheckpoint(
  checkpoint: DocumentCompilationCheckpoint,
  candidatePublicationId: string | undefined,
  candidateFingerprint: string | undefined,
): void {
  const checkpointIndex = checkpointOrder.get(checkpoint);
  const projectionBuiltIndex = checkpointOrder.get("projection_built");
  if (
    checkpointIndex !== undefined &&
    projectionBuiltIndex !== undefined &&
    checkpointIndex >= projectionBuiltIndex &&
    (!candidatePublicationId || !candidateFingerprint)
  ) {
    throw new DocumentCompilationAttemptTransitionError(
      `Document compilation checkpoint=${checkpoint} requires a bound candidate publication`,
    );
  }
}

function resolveCandidateBinding(
  current: Pick<DocumentCompilationAttempt, "candidateFingerprint" | "candidatePublicationId">,
  input: Pick<
    AdvanceDocumentCompilationAttemptInput,
    "candidateFingerprint" | "candidatePublicationId"
  >,
): {
  readonly candidateFingerprint?: string | undefined;
  readonly candidatePublicationId?: string | undefined;
  readonly newlyBound: boolean;
} {
  const requestedPublicationId = optionalUuid(
    input.candidatePublicationId,
    "candidatePublicationId",
  );
  const requestedFingerprint = input.candidateFingerprint
    ? ProjectionSetFingerprintSchema.parse(input.candidateFingerprint)
    : undefined;

  if (current.candidatePublicationId || current.candidateFingerprint) {
    assertCandidatePair(current.candidatePublicationId, current.candidateFingerprint);
    if (
      (requestedPublicationId !== undefined &&
        requestedPublicationId !== current.candidatePublicationId) ||
      (requestedFingerprint !== undefined && requestedFingerprint !== current.candidateFingerprint)
    ) {
      throw new DocumentCompilationAttemptTransitionError(
        "Document compilation candidate binding is immutable",
      );
    }
    return {
      candidateFingerprint: current.candidateFingerprint,
      candidatePublicationId: current.candidatePublicationId,
      newlyBound: false,
    };
  }

  assertCandidatePair(requestedPublicationId, requestedFingerprint);
  return {
    ...(requestedFingerprint ? { candidateFingerprint: requestedFingerprint } : {}),
    ...(requestedPublicationId ? { candidatePublicationId: requestedPublicationId } : {}),
    newlyBound: requestedPublicationId !== undefined,
  };
}

function toTerminalAttempt(
  current: DocumentCompilationAttempt,
  runState: TerminalDocumentCompilationAttemptRunState,
  nowInput: string,
  error?: { readonly errorCode: string; readonly errorMessage: string } | undefined,
  checkpoint: DocumentCompilationCheckpoint = current.checkpoint,
): DocumentCompilationAttempt {
  if (isTerminalRunState(current.runState)) {
    throw new DocumentCompilationAttemptTransitionError(
      `Document compilation attempt is already ${current.runState}`,
    );
  }
  const now = canonicalDateTime(nowInput, "now");
  return parseAttempt({
    ...current,
    activeSlot: undefined,
    checkpoint,
    completedAt: now,
    heartbeatAt: undefined,
    lastErrorCode: error?.errorCode,
    lastErrorMessage: error?.errorMessage,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    retryAt: undefined,
    rowVersion: current.rowVersion + 1,
    runState,
    updatedAt: now,
    workerId: undefined,
  });
}

function isTerminalRunState(runState: DocumentCompilationAttemptRunState): boolean {
  return (
    runState === "succeeded" ||
    runState === "failed" ||
    runState === "canceled" ||
    runState === "superseded"
  );
}

function terminalOutboxStatus(
  runState: TerminalDocumentCompilationAttemptRunState,
): DocumentCompilationOutboxStatus {
  if (runState === "succeeded") {
    return "completed";
  }
  if (runState === "failed") {
    return "dead";
  }
  return "canceled";
}

function terminalOutboxEvent(
  event: DocumentCompilationOutboxEvent,
  runState: TerminalDocumentCompilationAttemptRunState,
  now: string,
  error?: string | undefined,
): DocumentCompilationOutboxEvent {
  return parseOutboxEvent({
    ...event,
    ...(error ? { lastError: error } : {}),
    lockedBy: undefined,
    lockedUntil: undefined,
    lockToken: undefined,
    status: terminalOutboxStatus(runState),
    updatedAt: canonicalDateTime(now, "now"),
  });
}

function matchesDeliveryIdentity(
  attempt: DocumentCompilationAttempt,
  event: DocumentCompilationOutboxEvent,
  queueJobIdInput: string,
  externalJobIdInput: string | undefined,
): boolean {
  const queueJobId = requiredString(queueJobIdInput, "queueJobId", 255);
  const externalJobId = optionalString(externalJobIdInput, "externalJobId", 255);
  return (
    (event.status === "dispatched" || event.status === "leased") &&
    attempt.queueJobId === queueJobId &&
    event.queueJobId === queueJobId &&
    (externalJobId === undefined ||
      (attempt.externalJobId === externalJobId && event.externalJobId === externalJobId))
  );
}

function commitMemoryTerminal(
  attempts: Map<string, DocumentCompilationAttempt>,
  outbox: Map<string, DocumentCompilationOutboxEvent>,
  current: DocumentCompilationAttempt,
  runState: TerminalDocumentCompilationAttemptRunState,
  now: string,
  error?: { readonly errorCode: string; readonly errorMessage: string } | undefined,
  checkpoint?: DocumentCompilationCheckpoint | undefined,
): DocumentCompilationAttempt {
  const currentEvent = requiredMemoryOutbox(outbox, current.id);
  const nextAttempt = toTerminalAttempt(current, runState, now, error, checkpoint);
  const nextEvent = terminalOutboxEvent(currentEvent, runState, now, error?.errorMessage);
  attempts.set(nextAttempt.id, nextAttempt);
  outbox.set(nextEvent.id, nextEvent);
  return cloneAttempt(nextAttempt);
}

function terminalMemoryTransition(
  attempts: Map<string, DocumentCompilationAttempt>,
  outbox: Map<string, DocumentCompilationOutboxEvent>,
  input: {
    readonly attemptId: string;
    readonly expectedRowVersion: number;
    readonly now: string;
  },
  runState: Extract<TerminalDocumentCompilationAttemptRunState, "canceled" | "superseded">,
  reason?: string | undefined,
  permissionBinding: Pick<
    DocumentCompilationAttempt,
    "permissionSnapshot" | "requestedBySubjectId"
  > = {},
): DocumentCompilationAttempt | null {
  const current = fencedMemoryAttempt(attempts, input);
  if (!current || isTerminalRunState(current.runState)) {
    return null;
  }
  const normalizedReason = optionalString(reason, "reason");
  return commitMemoryTerminal(
    attempts,
    outbox,
    permissionBinding.permissionSnapshot ? { ...current, ...permissionBinding } : current,
    runState,
    input.now,
    normalizedReason
      ? {
          errorCode: runState === "canceled" ? "CANCELED" : "SUPERSEDED",
          errorMessage: normalizedReason,
        }
      : undefined,
  );
}

function requiredMemoryOutbox(
  outbox: Map<string, DocumentCompilationOutboxEvent>,
  attemptId: string,
): DocumentCompilationOutboxEvent {
  const event = Array.from(outbox.values()).find(
    (candidate) =>
      candidate.attemptId === attemptId &&
      candidate.eventType === DocumentCompilationOutboxEventType,
  );
  if (!event) {
    throw new Error("Document compilation attempt has no durable outbox event");
  }
  return event;
}

function canonicalDateTime(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  try {
    return new Date(DateTimeSchema.parse(normalized)).toISOString();
  } catch {
    throw new Error(`Document compilation ${label} must be an ISO date-time`);
  }
}

function optionalDateTime(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : canonicalDateTime(value, label);
}

function tenantIdValue(value: string): string {
  return requiredString(value, "tenantId", 255);
}

function uuid(value: string, label: string): string {
  try {
    return UuidSchema.parse(value).toLowerCase();
  } catch {
    throw new Error(`Document compilation ${label} must be a UUID`);
  }
}

function nonzeroUuid(value: string, label: string): string {
  try {
    return PublicationGenerationIdSchema.parse(value);
  } catch {
    throw new Error(`Document compilation ${label} must be a non-zero UUID`);
  }
}

function optionalUuid(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : uuid(value, label);
}

function optionalNonzeroUuid(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : nonzeroUuid(value, label);
}

function requiredString(value: string, label: string, maximumLength?: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`Document compilation ${label} is required`);
  }
  if (maximumLength !== undefined && normalized.length > maximumLength) {
    throw new Error(`Document compilation ${label} must be at most ${maximumLength} characters`);
  }
  return normalized;
}

function optionalString(
  value: string | undefined,
  label: string,
  maximumLength?: number,
): string | undefined {
  return value === undefined ? undefined : requiredString(value, label, maximumLength);
}

function enumValue(value: string, allowed: ReadonlySet<string>, label: string): string {
  if (!allowed.has(value)) {
    throw new Error(`Document compilation ${label} is invalid`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumDatabaseInteger) {
    throw new Error(
      `Document compilation ${label} must be between 0 and ${maximumDatabaseInteger}`,
    );
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumDatabaseInteger) {
    throw new Error(
      `Document compilation ${label} must be between 1 and ${maximumDatabaseInteger}`,
    );
  }
  return value;
}

function positiveBound(value: number, label: string): number {
  return positiveInteger(value, label);
}

function validateClaimOutboxInput(
  input: ClaimDocumentCompilationOutboxInput,
  maxOutboxClaimBatchSize: number,
): void {
  const limit = positiveBound(input.limit, "outbox claim limit");
  if (limit > maxOutboxClaimBatchSize) {
    throw new Error(
      `Document compilation outbox claim limit exceeds maxOutboxClaimBatchSize=${maxOutboxClaimBatchSize}`,
    );
  }
}

const maximumDatabaseInteger = 2_147_483_647;
const attemptTableName = "document_compilation_attempts";
const outboxTableName = "document_compilation_outbox";
const knowledgeSpaceTableName = "knowledge_spaces";
const documentAssetTableName = "document_assets";
const publicationHeadTableName = "projection_set_publication_heads";
const publicationTableName = "projection_set_publications";

async function databaseStartAttempt(
  database: DatabaseAdapter,
  input: StartDocumentCompilationAttemptInput,
): Promise<StartDocumentCompilationAttemptResult> {
  const parsed = parseStartInput(input);

  return database.transaction(async (transaction) => {
    await requireDatabaseCompilationScope(database, transaction, parsed);
    const existing = await databaseGetActiveAttempt(database, transaction, parsed, true);
    if (existing) {
      const existingOutbox = await databaseGetAttemptOutbox(
        database,
        transaction,
        existing.id,
        true,
      );
      if (!existingOutbox) {
        throw new Error("Active document compilation attempt has no durable outbox event");
      }
      return { attempt: existing, created: false, outbox: existingOutbox };
    }
    const actualHeadRevision = await databaseCurrentHeadRevision(database, transaction, parsed);
    if (actualHeadRevision !== parsed.baseHeadRevision) {
      throw new DocumentCompilationAttemptHeadConflictError(
        parsed.baseHeadRevision,
        actualHeadRevision,
      );
    }
    const activeProfiles = await databaseActiveCompilationProfiles(database, transaction, parsed);
    if (
      (parsed.embeddingProfile &&
        (!activeProfiles.embeddingProfile ||
          !sameProfileReference(parsed.embeddingProfile, activeProfiles.embeddingProfile))) ||
      (parsed.retrievalProfile &&
        (!activeProfiles.retrievalProfile ||
          !sameProfileReference(parsed.retrievalProfile, activeProfiles.retrievalProfile)))
    ) {
      throw new DocumentCompilationAttemptTransitionError(
        "Document compilation requested profile snapshot is no longer active",
      );
    }
    const frozenInput: ParsedStartDocumentCompilationAttemptInput = {
      ...parsed,
      ...activeProfiles,
    };
    const newAttempt = startAttempt(frozenInput);
    const newOutbox = startOutboxEvent(frozenInput);

    const columns = attemptColumns;
    const params = attemptColumnValues(newAttempt);
    const insertKeyword = database.dialect === "postgres" ? "INSERT" : "INSERT IGNORE";
    const conflictClause =
      database.dialect === "postgres"
        ? ` ON CONFLICT (${[
            "tenant_id",
            "knowledge_space_id",
            "document_asset_id",
            "document_version",
            "active_slot",
          ]
            .map((column) => quoteDatabaseIdentifier(database, column))
            .join(", ")}) DO NOTHING RETURNING *`
        : "";
    const inserted = await transaction.execute({
      maxRows: 1,
      operation: "insert",
      params,
      sql: `${insertKeyword} INTO ${quoteDatabaseIdentifier(database, attemptTableName)} (${columns
        .map((column) => quoteDatabaseIdentifier(database, column))
        .join(", ")}) VALUES (${params
        .map((_, index) => databasePlaceholder(database, index + 1))
        .join(", ")})${conflictClause};`,
      tableName: attemptTableName,
    });

    if (inserted.rowsAffected !== 1) {
      const existing = await databaseGetActiveAttempt(database, transaction, newAttempt, true);
      if (!existing) {
        throw new Error(
          "Document compilation attempt insert conflicted without a readable active attempt",
        );
      }
      const existingOutbox = await databaseGetAttemptOutbox(
        database,
        transaction,
        existing.id,
        true,
      );
      if (!existingOutbox) {
        throw new Error("Active document compilation attempt has no durable outbox event");
      }
      return { attempt: existing, created: false, outbox: existingOutbox };
    }

    const persistedAttempt = inserted.rows[0] ? mapAttemptRow(inserted.rows[0]) : newAttempt;
    const outboxParams = outboxColumnValues(newOutbox);
    const outboxConflictClause = database.dialect === "postgres" ? " RETURNING *" : "";
    const outboxInsert = await transaction.execute({
      maxRows: 1,
      operation: "insert",
      params: outboxParams,
      sql: `INSERT INTO ${quoteDatabaseIdentifier(database, outboxTableName)} (${outboxColumns
        .map((column) => quoteDatabaseIdentifier(database, column))
        .join(", ")}) VALUES (${outboxParams
        .map((_, index) => outboxInsertPlaceholder(database, index + 1, outboxColumns[index]))
        .join(", ")})${outboxConflictClause};`,
      tableName: outboxTableName,
    });
    if (outboxInsert.rowsAffected !== 1) {
      throw new Error("Document compilation outbox insert did not persist exactly one event");
    }
    return {
      attempt: persistedAttempt,
      created: true,
      outbox: outboxInsert.rows[0] ? mapOutboxRow(outboxInsert.rows[0]) : newOutbox,
    };
  });
}

async function databaseActiveCompilationProfiles(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: Pick<StartDocumentCompilationAttemptInput, "knowledgeSpaceId" | "tenantId">,
): Promise<{
  readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
  readonly retrievalProfile?: DocumentCompilationProfileReference | undefined;
}> {
  const headTable = "knowledge_space_profile_heads";
  const revisionTable = "knowledge_space_profile_revisions";
  const result = await transaction.execute({
    maxRows: 3,
    operation: "select",
    params: [tenantIdValue(input.tenantId), uuid(input.knowledgeSpaceId, "knowledgeSpaceId")],
    sql: `SELECT h.${quoteDatabaseIdentifier(database, "kind")} AS ${quoteDatabaseIdentifier(
      database,
      "profile_kind",
    )}, h.${quoteDatabaseIdentifier(
      database,
      "profile_revision_id",
    )} AS ${quoteDatabaseIdentifier(database, "profile_revision_id")}, h.${quoteDatabaseIdentifier(
      database,
      "active_revision",
    )} AS ${quoteDatabaseIdentifier(database, "profile_revision")}, r.${quoteDatabaseIdentifier(
      database,
      "snapshot_digest",
    )} AS ${quoteDatabaseIdentifier(database, "profile_snapshot_digest")} FROM ${quoteDatabaseIdentifier(
      database,
      headTable,
    )} h INNER JOIN ${quoteDatabaseIdentifier(
      database,
      revisionTable,
    )} r ON r.${quoteDatabaseIdentifier(database, "tenant_id")} = h.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} AND r.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = h.${quoteDatabaseIdentifier(database, "knowledge_space_id")} AND r.${quoteDatabaseIdentifier(
      database,
      "kind",
    )} = h.${quoteDatabaseIdentifier(database, "kind")} AND r.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = h.${quoteDatabaseIdentifier(database, "profile_revision_id")} AND r.${quoteDatabaseIdentifier(
      database,
      "revision",
    )} = h.${quoteDatabaseIdentifier(database, "active_revision")} AND r.${quoteDatabaseIdentifier(
      database,
      "state",
    )} = 'active' WHERE h.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND h.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND h.${quoteDatabaseIdentifier(
      database,
      "kind",
    )} IN ('embedding', 'retrieval') ORDER BY h.${quoteDatabaseIdentifier(
      database,
      "kind",
    )} ASC FOR UPDATE;`,
    tableName: headTable,
  });
  const references = new Map<
    DocumentCompilationProfileReference["kind"],
    DocumentCompilationProfileReference
  >();
  for (const row of result.rows) {
    const kind = stringColumn(row, "profile_kind");
    if (kind !== "embedding" && kind !== "retrieval") {
      throw new DocumentCompilationAttemptTransitionError(
        "Document compilation active profile query returned an invalid kind",
      );
    }
    if (references.has(kind)) {
      throw new DocumentCompilationAttemptTransitionError(
        `Document compilation has multiple active ${kind} profile heads`,
      );
    }
    references.set(
      kind,
      parseProfileReference(
        {
          kind,
          revision: numberColumn(row, "profile_revision"),
          revisionId: stringColumn(row, "profile_revision_id"),
          snapshotDigest: stringColumn(row, "profile_snapshot_digest"),
        },
        kind,
      ),
    );
  }
  const embeddingProfile = references.get("embedding");
  const retrievalProfile = references.get("retrieval");
  if (references.size === 0) {
    return {};
  }
  // Lazy initial activation installs embedding before retrieval. Treat that recoverable,
  // unpublished intermediate state exactly like an uninitialized tuple; the leased coordinator
  // will finish retrieval activation before any parser/index work starts.
  if (embeddingProfile && !retrievalProfile && references.size === 1) {
    return {};
  }
  if (!retrievalProfile || references.size !== (embeddingProfile ? 2 : 1)) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation requires an active retrieval profile head",
    );
  }
  return {
    ...(embeddingProfile ? { embeddingProfile } : {}),
    retrievalProfile,
  };
}

async function requireDatabaseCompilationScope(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: ParsedStartDocumentCompilationAttemptInput,
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, input))) {
    throw new Error("Document compilation knowledge space is missing, deleting, or not writable");
  }

  const asset = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [input.knowledgeSpaceId, input.documentAssetId, input.documentVersion],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")}, ${quoteDatabaseIdentifier(database, "source_id")} FROM ${quoteDatabaseIdentifier(
      database,
      documentAssetTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(database, "version")} = ${databasePlaceholder(
      database,
      3,
    )} AND ${quoteDatabaseIdentifier(database, "lifecycle_state")} = 'active' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: documentAssetTableName,
  });
  if (!asset.rows[0]) {
    throw new Error("Document compilation document/version is missing, deleting, or not writable");
  }
  const sourceId = optionalStringColumn(asset.rows[0], "source_id");
  if (sourceId) {
    const source = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [input.knowledgeSpaceId, sourceId],
      sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(database, "sources")} WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "status")} <> 'deleting' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
      tableName: "sources",
    });
    if (!source.rows[0]) {
      throw new Error("Document compilation parent source is deleting or unavailable");
    }
  }
  if (input.permissionSnapshot && input.requestedBySubjectId) {
    await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: transaction,
      fence: {
        accessChannel: input.permissionSnapshot.accessChannel,
        knowledgeSpaceId: input.knowledgeSpaceId,
        permissionSnapshotId: input.permissionSnapshot.id,
        permissionSnapshotRevision: input.permissionSnapshot.revision,
        requestedBySubjectId: input.requestedBySubjectId,
        tenantId: input.tenantId,
      },
      now: input.createdAt,
      requiredAccess: "write",
    });
  }
}

async function databaseCurrentHeadRevision(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: Pick<StartDocumentCompilationAttemptInput, "knowledgeSpaceId" | "tenantId">,
): Promise<number> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantIdValue(input.tenantId), uuid(input.knowledgeSpaceId, "knowledgeSpaceId")],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "head_revision")} FROM ${quoteDatabaseIdentifier(
      database,
      publicationHeadTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      2,
    )} LIMIT 1;`,
    tableName: publicationHeadTableName,
  });
  return result.rows[0]
    ? nonnegativeInteger(numberColumn(result.rows[0], "head_revision"), "headRevision")
    : 0;
}

type CompilationPermissionBinding = Pick<
  DocumentCompilationAttempt,
  "permissionSnapshot" | "requestedBySubjectId"
>;

/**
 * Locks the space deletion fence before the attempt row. Publication and deletion admission use
 * this same order, so a concurrent public retry/cancel or deferred dispatch cannot deadlock by
 * holding the attempt while waiting for the space.
 */
async function databaseLockCompilationControlAttemptAfterSpace(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  observed: DocumentCompilationAttempt,
  accepts: (attempt: DocumentCompilationAttempt) => boolean,
): Promise<DocumentCompilationAttempt | null> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, observed))) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation knowledge space is deleting or not writable",
    );
  }
  const current = await databaseGetAttempt(database, transaction, observed.id, true);
  if (
    !current ||
    current.tenantId !== observed.tenantId ||
    current.knowledgeSpaceId !== observed.knowledgeSpaceId ||
    !accepts(current)
  ) {
    return null;
  }
  return current;
}

/**
 * Final request-control resource/ACL fence. The caller already holds the space and attempt locks
 * in that order; this completes asset, parent Source, logical-document and durable-permission
 * revalidation before changing the attempt/outbox.
 */
async function requireDatabaseCompilationControlResources(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  attempt: DocumentCompilationAttempt,
  permission: CompilationPermissionBinding,
  now: string,
  requireLogicalDocument: boolean,
): Promise<void> {
  const q = (column: string) => quoteDatabaseIdentifier(database, column);
  const p = (position: number) => databasePlaceholder(database, position);
  const assetResult = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [attempt.knowledgeSpaceId, attempt.documentAssetId, attempt.documentVersion],
    sql: `SELECT asset.${q("id")}, asset.${q("source_id")} FROM ${q("document_assets")} asset WHERE asset.${q("knowledge_space_id")} = ${p(1)} AND asset.${q("id")} = ${p(2)} AND asset.${q("version")} = ${p(3)} AND asset.${q("lifecycle_state")} = 'active' AND asset.${q("deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: "document_assets",
  });
  const asset = assetResult.rows[0];
  if (!asset) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation asset is deleting or unavailable",
    );
  }
  const sourceId = optionalStringColumn(asset, "source_id");
  if (sourceId) {
    const source = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [attempt.knowledgeSpaceId, sourceId],
      sql: `SELECT ${q("id")} FROM ${q("sources")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${q("status")} <> 'deleting' AND ${q("deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
      tableName: "sources",
    });
    if (!source.rows[0]) {
      throw new DocumentCompilationAttemptTransitionError(
        "Document compilation parent source is deleting or unavailable",
      );
    }
  }

  const document = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [
      attempt.tenantId,
      attempt.knowledgeSpaceId,
      attempt.id,
      attempt.documentAssetId,
      attempt.documentVersion,
    ],
    sql: `SELECT document.${q("id")} FROM ${q("logical_documents")} document JOIN ${q("document_revisions")} revision ON revision.${q("tenant_id")} = document.${q("tenant_id")} AND revision.${q("knowledge_space_id")} = document.${q("knowledge_space_id")} AND revision.${q("document_id")} = document.${q("id")} WHERE document.${q("tenant_id")} = ${p(1)} AND document.${q("knowledge_space_id")} = ${p(2)} AND document.${q("status")} <> 'deleting' AND document.${q("deletion_job_id")} IS NULL AND revision.${q("document_asset_id")} = ${p(4)} AND revision.${q("document_asset_version")} = ${p(5)} AND (revision.${q("compilation_attempt_id")} = ${p(3)} OR (revision.${q("revision")} = document.${q("active_revision")} AND revision.${q("state")} = 'active') OR EXISTS (SELECT 1 FROM ${q("document_reindex_attempts")} settings_attempt WHERE settings_attempt.${q("tenant_id")} = revision.${q("tenant_id")} AND settings_attempt.${q("knowledge_space_id")} = revision.${q("knowledge_space_id")} AND settings_attempt.${q("document_id")} = revision.${q("document_id")} AND settings_attempt.${q("document_revision")} = revision.${q("revision")} AND settings_attempt.${q("compilation_attempt_id")} = ${p(3)}) OR EXISTS (SELECT 1 FROM ${q("document_chunk_state_changes")} chunk_change WHERE chunk_change.${q("tenant_id")} = revision.${q("tenant_id")} AND chunk_change.${q("knowledge_space_id")} = revision.${q("knowledge_space_id")} AND chunk_change.${q("document_id")} = revision.${q("document_id")} AND chunk_change.${q("document_revision")} = revision.${q("revision")} AND chunk_change.${q("compilation_attempt_id")} = ${p(3)})) LIMIT 1 FOR UPDATE;`,
    tableName: "logical_documents",
  });
  if (requireLogicalDocument && !document.rows[0]) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation logical document is deleting or unavailable",
    );
  }
  if (permission.permissionSnapshot && permission.requestedBySubjectId) {
    await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: transaction,
      fence: {
        accessChannel: permission.permissionSnapshot.accessChannel,
        knowledgeSpaceId: attempt.knowledgeSpaceId,
        permissionSnapshotId: permission.permissionSnapshot.id,
        permissionSnapshotRevision: permission.permissionSnapshot.revision,
        requestedBySubjectId: permission.requestedBySubjectId,
        tenantId: attempt.tenantId,
      },
      now,
      requiredAccess: "write",
    });
  }
}

/** Restores the exact failed product mutation before its outbox becomes pending again. */
async function restoreDatabaseCompilationProductIntent(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  attempt: DocumentCompilationAttempt,
): Promise<void> {
  const q = (column: string) => quoteDatabaseIdentifier(database, column);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: readonly DatabaseQueryValue[] = [
    attempt.tenantId,
    attempt.knowledgeSpaceId,
    attempt.id,
  ];
  const revisionResult = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${q("document_revisions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("compilation_attempt_id")} = ${p(3)} LIMIT 1 FOR UPDATE;`,
    tableName: "document_revisions",
  });
  const settingsResult = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${q("document_reindex_attempts")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("compilation_attempt_id")} = ${p(3)} LIMIT 1 FOR UPDATE;`,
    tableName: "document_reindex_attempts",
  });
  const chunkResult = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${q("document_chunk_state_changes")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("compilation_attempt_id")} = ${p(3)} LIMIT 1 FOR UPDATE;`,
    tableName: "document_chunk_state_changes",
  });
  const intents = [revisionResult.rows[0], settingsResult.rows[0], chunkResult.rows[0]].filter(
    Boolean,
  );
  if (intents.length > 1) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation attempt is bound to multiple product intents",
    );
  }

  const revision = revisionResult.rows[0];
  if (revision) {
    await assertRetryDocumentHead(database, transaction, revision);
    const state = stringColumn(revision, "state");
    if (state === "failed") {
      const restored = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [attempt.tenantId, attempt.knowledgeSpaceId, attempt.id],
        sql: `UPDATE ${q("document_revisions")} SET ${q("state")} = 'candidate' WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("compilation_attempt_id")} = ${p(3)} AND ${q("state")} = 'failed';`,
        tableName: "document_revisions",
      });
      if (restored.rowsAffected !== 1) throw productIntentRestoreConflict();
      if (optionalNumberColumn(revision, "expected_active_revision") === undefined) {
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            attempt.tenantId,
            attempt.knowledgeSpaceId,
            stringColumn(revision, "document_id"),
          ],
          sql: `UPDATE ${q("logical_documents")} SET ${q("status")} = 'pending' WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} = ${p(3)} AND ${q("status")} = 'failed';`,
          tableName: "logical_documents",
        });
      }
    } else if (state !== "candidate") {
      throw productIntentRestoreConflict();
    }
    return;
  }

  const settingsAttempt = settingsResult.rows[0];
  if (settingsAttempt) {
    await assertRetrySettingsHead(database, transaction, settingsAttempt);
    const settingsRevision = numberColumn(settingsAttempt, "settings_revision");
    const documentId = stringColumn(settingsAttempt, "document_id");
    const candidate = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [attempt.tenantId, attempt.knowledgeSpaceId, documentId, settingsRevision],
      sql: `SELECT ${q("state")} FROM ${q("document_settings_revisions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("document_id")} = ${p(3)} AND ${q("revision")} = ${p(4)} LIMIT 1 FOR UPDATE;`,
      tableName: "document_settings_revisions",
    });
    const candidateState = candidate.rows[0] ? stringColumn(candidate.rows[0], "state") : "missing";
    if (candidateState === "failed") {
      const restored = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [attempt.tenantId, attempt.knowledgeSpaceId, documentId, settingsRevision],
        sql: `UPDATE ${q("document_settings_revisions")} SET ${q("state")} = 'candidate' WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("document_id")} = ${p(3)} AND ${q("revision")} = ${p(4)} AND ${q("state")} = 'failed';`,
        tableName: "document_settings_revisions",
      });
      if (restored.rowsAffected !== 1) throw productIntentRestoreConflict();
    } else if (candidateState !== "candidate") {
      throw productIntentRestoreConflict();
    }
    const reindexState = stringColumn(settingsAttempt, "state");
    if (reindexState === "failed" || reindexState === "canceled") {
      const restored = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [attempt.tenantId, attempt.knowledgeSpaceId, attempt.id],
        sql: `UPDATE ${q("document_reindex_attempts")} SET ${q("state")} = 'running', ${q("active_slot")} = 1, ${q("error_code")} = NULL, ${q("error_message")} = NULL, ${q("completed_at")} = NULL, ${q("row_version")} = ${q("row_version")} + 1 WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("compilation_attempt_id")} = ${p(3)} AND ${q("state")} IN ('failed', 'canceled');`,
        tableName: "document_reindex_attempts",
      });
      if (restored.rowsAffected !== 1) throw productIntentRestoreConflict();
    } else if (reindexState !== "running" && reindexState !== "queued") {
      throw productIntentRestoreConflict();
    }
    return;
  }

  const chunk = chunkResult.rows[0];
  if (chunk) {
    await assertRetryChunkHead(database, transaction, chunk);
    const state = stringColumn(chunk, "state");
    if (state === "failed") {
      const restored = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [attempt.tenantId, attempt.knowledgeSpaceId, attempt.id],
        sql: `UPDATE ${q("document_chunk_state_changes")} SET ${q("state")} = 'candidate' WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("compilation_attempt_id")} = ${p(3)} AND ${q("state")} = 'failed';`,
        tableName: "document_chunk_state_changes",
      });
      if (restored.rowsAffected !== 1) throw productIntentRestoreConflict();
    } else if (state !== "candidate") {
      throw productIntentRestoreConflict();
    }
  }
}

async function assertRetryDocumentHead(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  revision: DatabaseRow,
): Promise<void> {
  const document = await retryDocumentRow(database, transaction, revision);
  if (
    !document ||
    (optionalNumberColumn(document, "active_revision") ?? null) !==
      (optionalNumberColumn(revision, "expected_active_revision") ?? null) ||
    numberColumn(document, "row_version") !==
      numberColumn(revision, "expected_document_row_version")
  ) {
    throw productIntentRestoreConflict();
  }
}

async function assertRetrySettingsHead(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  settingsAttempt: DatabaseRow,
): Promise<void> {
  const document = await retryDocumentRow(database, transaction, settingsAttempt);
  const q = (column: string) => quoteDatabaseIdentifier(database, column);
  const p = (position: number) => databasePlaceholder(database, position);
  const head = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [
      stringColumn(settingsAttempt, "tenant_id"),
      stringColumn(settingsAttempt, "knowledge_space_id"),
      stringColumn(settingsAttempt, "document_id"),
    ],
    sql: `SELECT ${q("active_revision")} FROM ${q("document_settings_heads")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("document_id")} = ${p(3)} LIMIT 1 FOR UPDATE;`,
    tableName: "document_settings_heads",
  });
  if (
    !document ||
    optionalNumberColumn(document, "active_revision") !==
      numberColumn(settingsAttempt, "document_revision") ||
    (head.rows[0] ? numberColumn(head.rows[0], "active_revision") : 0) !==
      numberColumn(settingsAttempt, "expected_settings_head_revision")
  ) {
    throw productIntentRestoreConflict();
  }
}

async function assertRetryChunkHead(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  chunk: DatabaseRow,
): Promise<void> {
  const document = await retryDocumentRow(database, transaction, chunk);
  if (
    !document ||
    optionalNumberColumn(document, "active_revision") !== numberColumn(chunk, "document_revision")
  ) {
    throw productIntentRestoreConflict();
  }
}

async function retryDocumentRow(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  row: DatabaseRow,
): Promise<DatabaseRow | undefined> {
  const q = (column: string) => quoteDatabaseIdentifier(database, column);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [
      stringColumn(row, "tenant_id"),
      stringColumn(row, "knowledge_space_id"),
      stringColumn(row, "document_id"),
    ],
    sql: `SELECT ${q("active_revision")}, ${q("row_version")} FROM ${q("logical_documents")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} = ${p(3)} AND ${q("status")} <> 'deleting' AND ${q("deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: "logical_documents",
  });
  return result.rows[0];
}

function productIntentRestoreConflict(): DocumentCompilationAttemptTransitionError {
  return new DocumentCompilationAttemptTransitionError(
    "Document compilation product intent is no longer retryable",
  );
}

async function requireDatabaseCandidateBinding(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  attempt: Pick<DocumentCompilationAttempt, "knowledgeSpaceId" | "tenantId">,
  candidate: { readonly candidateFingerprint: string; readonly candidatePublicationId: string },
): Promise<void> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [
      tenantIdValue(attempt.tenantId),
      uuid(attempt.knowledgeSpaceId, "knowledgeSpaceId"),
      uuid(candidate.candidatePublicationId, "candidatePublicationId"),
      ProjectionSetFingerprintSchema.parse(candidate.candidateFingerprint),
      "candidate",
    ],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
      database,
      publicationTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      3,
    )} AND ${quoteDatabaseIdentifier(database, "fingerprint")} = ${databasePlaceholder(
      database,
      4,
    )} AND ${quoteDatabaseIdentifier(database, "status")} = ${databasePlaceholder(
      database,
      5,
    )} LIMIT 1 FOR UPDATE;`,
    tableName: publicationTableName,
  });
  if (!result.rows[0]) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation candidate binding is not a candidate in the attempt scope",
    );
  }
}

async function databaseGetAttempt(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  idInput: string,
  forUpdate: boolean,
): Promise<DocumentCompilationAttempt | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [uuid(idInput, "attemptId")],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      attemptTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      1,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: attemptTableName,
  });
  return result.rows[0] ? mapAttemptRow(result.rows[0]) : null;
}

async function databaseGetManyAttempts(
  database: DatabaseAdapter,
  idsInput: readonly string[],
): Promise<readonly DocumentCompilationAttempt[]> {
  const ids = Array.from(new Set(idsInput.map((id) => uuid(id, "attemptId"))));
  if (ids.length === 0) {
    return [];
  }
  if (ids.length > maximumGetManyAttempts) {
    throw new Error(`Document compilation getMany cannot exceed ${maximumGetManyAttempts} IDs`);
  }
  const result = await database.execute({
    maxRows: ids.length,
    operation: "select",
    params: ids,
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      attemptTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "id")} IN (${ids
      .map((_, index) => databasePlaceholder(database, index + 1))
      .join(", ")});`,
    tableName: attemptTableName,
  });
  const attemptsById = new Map(
    result.rows.map((row) => {
      const attempt = mapAttemptRow(row);
      return [attempt.id, attempt] as const;
    }),
  );
  return ids.flatMap((id) => {
    const attempt = attemptsById.get(id);
    return attempt ? [attempt] : [];
  });
}

async function databaseGetActiveAttempt(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: Pick<
    DocumentCompilationAttempt,
    "documentAssetId" | "documentVersion" | "knowledgeSpaceId" | "tenantId"
  >,
  forUpdate: boolean,
): Promise<DocumentCompilationAttempt | null> {
  const params: DatabaseQueryValue[] = [
    tenantIdValue(input.tenantId),
    uuid(input.knowledgeSpaceId, "knowledgeSpaceId"),
    uuid(input.documentAssetId, "documentAssetId"),
    positiveInteger(input.documentVersion, "documentVersion"),
    1,
  ];
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      attemptTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      2,
    )} AND ${quoteDatabaseIdentifier(database, "document_asset_id")} = ${databasePlaceholder(
      database,
      3,
    )} AND ${quoteDatabaseIdentifier(database, "document_version")} = ${databasePlaceholder(
      database,
      4,
    )} AND ${quoteDatabaseIdentifier(database, "active_slot")} = ${databasePlaceholder(
      database,
      5,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: attemptTableName,
  });
  return result.rows[0] ? mapAttemptRow(result.rows[0]) : null;
}

async function databaseGetOutbox(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  idInput: string,
  forUpdate: boolean,
): Promise<DocumentCompilationOutboxEvent | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [uuid(idInput, "outboxId")],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      outboxTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      1,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: outboxTableName,
  });
  return result.rows[0] ? mapOutboxRow(result.rows[0]) : null;
}

async function databaseGetAttemptOutbox(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  attemptIdInput: string,
  forUpdate: boolean,
): Promise<DocumentCompilationOutboxEvent | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [uuid(attemptIdInput, "attemptId"), DocumentCompilationOutboxEventType],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      outboxTableName,
    )} WHERE ${quoteDatabaseIdentifier(database, "attempt_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${quoteDatabaseIdentifier(database, "event_type")} = ${databasePlaceholder(
      database,
      2,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: outboxTableName,
  });
  return result.rows[0] ? mapOutboxRow(result.rows[0]) : null;
}

async function databaseLockAttemptThenDispatchingOutbox(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  outboxIdInput: string,
  lockToken: string,
): Promise<{
  readonly attempt: DocumentCompilationAttempt;
  readonly outbox: DocumentCompilationOutboxEvent;
} | null> {
  // Discover the parent without a row lock so every transaction that needs both
  // rows acquires its actual locks in the same attempt -> outbox order.
  const observed = await databaseGetOutbox(database, transaction, outboxIdInput, false);
  if (!observed || observed.status !== "dispatching" || observed.lockToken !== lockToken) {
    return null;
  }
  const attempt = await databaseGetAttempt(database, transaction, observed.attemptId, true);
  if (!attempt) {
    return null;
  }
  const outbox = await databaseGetOutbox(database, transaction, observed.id, true);
  if (
    !outbox ||
    outbox.attemptId !== attempt.id ||
    outbox.status !== "dispatching" ||
    outbox.lockToken !== lockToken
  ) {
    return null;
  }
  return { attempt, outbox };
}

async function databasePersistAttempt(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: DocumentCompilationAttempt,
  expectedRowVersion: number,
): Promise<DocumentCompilationAttempt> {
  const attempt = parseAttempt(input);
  const columns = attemptColumns.slice(1);
  const params = [
    ...attemptColumnValues(attempt).slice(1),
    attempt.id,
    nonnegativeInteger(expectedRowVersion, "expectedRowVersion"),
  ];
  const result = await transaction.execute({
    maxRows: 1,
    operation: "update",
    params,
    sql: `UPDATE ${quoteDatabaseIdentifier(database, attemptTableName)} SET ${columns
      .map(
        (column, index) =>
          `${quoteDatabaseIdentifier(database, column)} = ${databasePlaceholder(database, index + 1)}`,
      )
      .join(", ")} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      columns.length + 1,
    )} AND ${quoteDatabaseIdentifier(database, "row_version")} = ${databasePlaceholder(
      database,
      columns.length + 2,
    )};`,
    tableName: attemptTableName,
  });
  if (result.rowsAffected !== 1) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation attempt changed concurrently during CAS update",
    );
  }
  return attempt;
}

async function databasePersistOutbox(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: DocumentCompilationOutboxEvent,
): Promise<DocumentCompilationOutboxEvent> {
  const event = parseOutboxEvent(input);
  const columns = outboxMutableColumns;
  const params = [...outboxMutableColumnValues(event), event.id];
  const result = await transaction.execute({
    maxRows: 1,
    operation: "update",
    params,
    sql: `UPDATE ${quoteDatabaseIdentifier(database, outboxTableName)} SET ${columns
      .map(
        (column, index) =>
          `${quoteDatabaseIdentifier(database, column)} = ${databasePlaceholder(database, index + 1)}`,
      )
      .join(", ")} WHERE ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(
      database,
      columns.length + 1,
    )};`,
    tableName: outboxTableName,
  });
  if (result.rowsAffected !== 1) {
    throw new DocumentCompilationAttemptTransitionError(
      "Document compilation outbox changed concurrently during update",
    );
  }
  return event;
}

async function databaseMutateAttempt(
  database: DatabaseAdapter,
  attemptId: string,
  expectedRowVersion: number,
  transition: (
    current: DocumentCompilationAttempt,
    transaction: DatabaseExecutor,
  ) => Promise<DocumentCompilationAttempt | null> | DocumentCompilationAttempt | null,
): Promise<DocumentCompilationAttempt | null> {
  return database.transaction(async (transaction) => {
    const current = await databaseGetAttempt(database, transaction, attemptId, true);
    if (
      !current ||
      current.rowVersion !== nonnegativeInteger(expectedRowVersion, "expectedRowVersion")
    ) {
      return null;
    }
    const next = await transition(current, transaction);
    return next ? databasePersistAttempt(database, transaction, next, current.rowVersion) : null;
  });
}

async function databaseMutateFencedAttempt(
  database: DatabaseAdapter,
  input: {
    readonly attemptId: string;
    readonly expectedRowVersion: number;
    readonly leaseToken: string;
    readonly now: string;
  },
  transition: (
    current: DocumentCompilationAttempt,
    transaction: DatabaseExecutor,
  ) => Promise<DocumentCompilationAttempt | null> | DocumentCompilationAttempt | null,
): Promise<DocumentCompilationAttempt | null> {
  return databaseMutateAttempt(
    database,
    input.attemptId,
    input.expectedRowVersion,
    async (current, transaction) =>
      hasLiveLease(current, input.leaseToken, input.now) ? transition(current, transaction) : null,
  );
}

async function databaseTerminalFencedTransition(
  database: DatabaseAdapter,
  input: {
    readonly attemptId: string;
    readonly expectedRowVersion: number;
    readonly leaseToken: string;
    readonly now: string;
  },
  runState: Extract<TerminalDocumentCompilationAttemptRunState, "failed" | "succeeded">,
  transition: (current: DocumentCompilationAttempt) => {
    readonly checkpoint?: DocumentCompilationCheckpoint | undefined;
    readonly error?: { readonly errorCode: string; readonly errorMessage: string } | undefined;
  },
): Promise<DocumentCompilationAttempt | null> {
  return database.transaction(async (transaction) => {
    const current = await databaseGetAttempt(database, transaction, input.attemptId, true);
    if (
      !current ||
      current.rowVersion !== nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
      !hasLiveLease(current, input.leaseToken, input.now)
    ) {
      return null;
    }
    const patch = transition(current);
    return databaseCommitTerminal(
      database,
      transaction,
      current,
      runState,
      input.now,
      patch.error,
      patch.checkpoint,
    );
  });
}

async function databaseTerminalControlTransition(
  database: DatabaseAdapter,
  input: CancelDocumentCompilationAttemptInput | SupersedeDocumentCompilationAttemptInput,
  runState: Extract<TerminalDocumentCompilationAttemptRunState, "canceled" | "superseded">,
  reason?: string | undefined,
): Promise<DocumentCompilationAttempt | null> {
  return database.transaction(async (transaction) => {
    const expectedRowVersion = nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion");
    const accepts = (attempt: DocumentCompilationAttempt) =>
      attempt.rowVersion === expectedRowVersion && !isTerminalRunState(attempt.runState);
    const observed = await databaseGetAttempt(database, transaction, input.attemptId, false);
    if (!observed || !accepts(observed)) return null;
    const permissionBinding =
      "permissionSnapshot" in input || "requestedBySubjectId" in input
        ? parseRetryPermissionBinding(input)
        : {};
    const current = permissionBinding.permissionSnapshot
      ? await databaseLockCompilationControlAttemptAfterSpace(
          database,
          transaction,
          observed,
          accepts,
        )
      : await databaseGetAttempt(database, transaction, input.attemptId, true);
    if (!current || !accepts(current)) return null;
    if (permissionBinding.permissionSnapshot) {
      await requireDatabaseCompilationControlResources(
        database,
        transaction,
        current,
        permissionBinding,
        canonicalDateTime(input.now, "now"),
        true,
      );
    }
    const normalizedReason = optionalString(reason, "reason");
    return databaseCommitTerminal(
      database,
      transaction,
      permissionBinding.permissionSnapshot ? { ...current, ...permissionBinding } : current,
      runState,
      input.now,
      normalizedReason
        ? {
            errorCode: runState === "canceled" ? "CANCELED" : "SUPERSEDED",
            errorMessage: normalizedReason,
          }
        : undefined,
    );
  });
}

async function databaseCommitTerminal(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  current: DocumentCompilationAttempt,
  runState: TerminalDocumentCompilationAttemptRunState,
  now: string,
  error?: { readonly errorCode: string; readonly errorMessage: string } | undefined,
  checkpoint?: DocumentCompilationCheckpoint | undefined,
): Promise<DocumentCompilationAttempt> {
  const currentEvent = await databaseGetAttemptOutbox(database, transaction, current.id, true);
  if (!currentEvent) {
    throw new Error("Document compilation attempt has no durable outbox event");
  }
  const nextAttempt = toTerminalAttempt(current, runState, now, error, checkpoint);
  const nextEvent = terminalOutboxEvent(currentEvent, runState, now, error?.errorMessage);
  await databasePersistAttempt(database, transaction, nextAttempt, current.rowVersion);
  await databasePersistOutbox(database, transaction, nextEvent);
  return nextAttempt;
}

function mapAttemptRow(row: DatabaseRow): DocumentCompilationAttempt {
  const activeSlot = optionalNumberColumn(row, "active_slot");
  if (activeSlot !== undefined && activeSlot !== 1) {
    throw new Error("Document compilation database active_slot must be NULL or 1");
  }
  return parseAttempt({
    ...(activeSlot === 1 ? { activeSlot: 1 } : {}),
    baseHeadRevision: numberColumn(row, "base_head_revision"),
    candidateFingerprint: optionalStringColumn(row, "candidate_fingerprint"),
    candidatePublicationId: optionalStringColumn(row, "candidate_publication_id"),
    checkpoint: stringColumn(row, "checkpoint") as DocumentCompilationCheckpoint,
    completedAt: optionalStringColumn(row, "completed_at"),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    documentVersion: numberColumn(row, "document_version"),
    embeddingProfile: profileReferenceFromRow(row, "embedding"),
    executionAttempts: numberColumn(row, "execution_attempts"),
    externalJobId: optionalStringColumn(row, "external_job_id"),
    heartbeatAt: optionalStringColumn(row, "heartbeat_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    lastErrorCode: optionalStringColumn(row, "last_error_code"),
    lastErrorMessage: optionalStringColumn(row, "last_error_message"),
    leaseExpiresAt: optionalStringColumn(row, "lease_expires_at"),
    leaseToken: optionalStringColumn(row, "lease_token"),
    maxExecutionAttempts: numberColumn(row, "max_execution_attempts"),
    permissionSnapshot: permissionSnapshotFromRow(row),
    publicationGenerationId: stringColumn(row, "publication_generation_id"),
    requestedBySubjectId: optionalStringColumn(row, "requested_by_subject_id"),
    retrievalProfile: profileReferenceFromRow(row, "retrieval"),
    queueJobId: optionalStringColumn(row, "queue_job_id"),
    retryAt: optionalStringColumn(row, "retry_at"),
    rowVersion: numberColumn(row, "row_version"),
    runState: stringColumn(row, "run_state") as DocumentCompilationAttemptRunState,
    startedAt: optionalStringColumn(row, "started_at"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    workerId: optionalStringColumn(row, "worker_id"),
  });
}

function mapOutboxRow(row: DatabaseRow): DocumentCompilationOutboxEvent {
  const payload = jsonObjectColumn(row, "payload");
  return parseOutboxEvent({
    attemptId: stringColumn(row, "attempt_id"),
    availableAt: stringColumn(row, "available_at"),
    createdAt: stringColumn(row, "created_at"),
    deliveredAt: optionalStringColumn(row, "delivered_at"),
    dispatchAttempts: numberColumn(row, "dispatch_attempts"),
    eventType: stringColumn(row, "event_type") as typeof DocumentCompilationOutboxEventType,
    externalJobId: optionalStringColumn(row, "external_job_id"),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    lastError: optionalStringColumn(row, "last_error"),
    lockedBy: optionalStringColumn(row, "locked_by"),
    lockedUntil: optionalStringColumn(row, "locked_until"),
    lockToken: optionalStringColumn(row, "lock_token"),
    payload: parseOutboxPayload(payload),
    queueJobId: optionalStringColumn(row, "queue_job_id"),
    schemaVersion: numberColumn(
      row,
      "schema_version",
    ) as typeof DocumentCompilationOutboxSchemaVersion,
    status: stringColumn(row, "status") as DocumentCompilationOutboxStatus,
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function attemptColumnValues(attempt: DocumentCompilationAttempt): readonly DatabaseQueryValue[] {
  return [
    attempt.id,
    attempt.tenantId,
    attempt.knowledgeSpaceId,
    attempt.documentAssetId,
    attempt.documentVersion,
    attempt.embeddingProfile?.kind ?? null,
    attempt.embeddingProfile?.revisionId ?? null,
    attempt.embeddingProfile?.revision ?? null,
    attempt.embeddingProfile?.snapshotDigest ?? null,
    attempt.retrievalProfile?.kind ?? null,
    attempt.retrievalProfile?.revisionId ?? null,
    attempt.retrievalProfile?.revision ?? null,
    attempt.retrievalProfile?.snapshotDigest ?? null,
    attempt.publicationGenerationId,
    attempt.requestedBySubjectId ?? null,
    attempt.permissionSnapshot?.id ?? null,
    attempt.permissionSnapshot?.revision ?? null,
    attempt.permissionSnapshot?.accessChannel ?? null,
    attempt.baseHeadRevision,
    attempt.candidatePublicationId ?? null,
    attempt.candidateFingerprint ?? null,
    attempt.checkpoint,
    attempt.runState,
    attempt.activeSlot ?? null,
    attempt.executionAttempts,
    attempt.maxExecutionAttempts,
    attempt.queueJobId ?? null,
    attempt.externalJobId ?? null,
    attempt.workerId ?? null,
    attempt.leaseToken ?? null,
    attempt.leaseExpiresAt ?? null,
    attempt.heartbeatAt ?? null,
    attempt.retryAt ?? null,
    attempt.lastErrorCode ?? null,
    attempt.lastErrorMessage ?? null,
    attempt.rowVersion,
    attempt.createdAt,
    attempt.updatedAt,
    attempt.startedAt ?? null,
    attempt.completedAt ?? null,
  ];
}

function outboxColumnValues(event: DocumentCompilationOutboxEvent): readonly DatabaseQueryValue[] {
  return [
    event.id,
    event.attemptId,
    event.eventType,
    event.schemaVersion,
    JSON.stringify(event.payload),
    event.idempotencyKey,
    event.status,
    event.dispatchAttempts,
    event.availableAt,
    event.lockedBy ?? null,
    event.lockToken ?? null,
    event.lockedUntil ?? null,
    event.queueJobId ?? null,
    event.externalJobId ?? null,
    event.deliveredAt ?? null,
    event.lastError ?? null,
    event.createdAt,
    event.updatedAt,
  ];
}

function outboxMutableColumnValues(
  event: DocumentCompilationOutboxEvent,
): readonly DatabaseQueryValue[] {
  return [
    event.status,
    event.dispatchAttempts,
    event.availableAt,
    event.lockedBy ?? null,
    event.lockToken ?? null,
    event.lockedUntil ?? null,
    event.queueJobId ?? null,
    event.externalJobId ?? null,
    event.deliveredAt ?? null,
    event.lastError ?? null,
    event.updatedAt,
  ];
}

function outboxInsertPlaceholder(
  database: Pick<DatabaseAdapter, "dialect">,
  position: number,
  column: string | undefined,
): string {
  const placeholder = databasePlaceholder(database, position);
  if (column !== "payload") {
    return placeholder;
  }
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}

const attemptColumns = [
  "id",
  "tenant_id",
  "knowledge_space_id",
  "document_asset_id",
  "document_version",
  "embedding_profile_kind",
  "embedding_profile_revision_id",
  "embedding_profile_revision",
  "embedding_profile_snapshot_digest",
  "retrieval_profile_kind",
  "retrieval_profile_revision_id",
  "retrieval_profile_revision",
  "retrieval_profile_snapshot_digest",
  "publication_generation_id",
  "requested_by_subject_id",
  "permission_snapshot_id",
  "permission_snapshot_revision",
  "access_channel",
  "base_head_revision",
  "candidate_publication_id",
  "candidate_fingerprint",
  "checkpoint",
  "run_state",
  "active_slot",
  "execution_attempts",
  "max_execution_attempts",
  "queue_job_id",
  "external_job_id",
  "worker_id",
  "lease_token",
  "lease_expires_at",
  "heartbeat_at",
  "retry_at",
  "last_error_code",
  "last_error_message",
  "row_version",
  "created_at",
  "updated_at",
  "started_at",
  "completed_at",
] as const;

const outboxColumns = [
  "id",
  "attempt_id",
  "event_type",
  "schema_version",
  "payload",
  "idempotency_key",
  "status",
  "dispatch_attempts",
  "available_at",
  "locked_by",
  "lock_token",
  "locked_until",
  "queue_job_id",
  "external_job_id",
  "delivered_at",
  "last_error",
  "created_at",
  "updated_at",
] as const;

const outboxMutableColumns = [
  "status",
  "dispatch_attempts",
  "available_at",
  "locked_by",
  "lock_token",
  "locked_until",
  "queue_job_id",
  "external_job_id",
  "delivered_at",
  "last_error",
  "updated_at",
] as const;

const maximumGetManyAttempts = 1_000;
