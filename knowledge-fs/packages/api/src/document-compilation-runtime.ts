import { randomUUID } from "node:crypto";

import { type JobPayload, type JobQueueAdapter, type JobRecord, UuidSchema } from "@knowledge/core";

import {
  type AdvanceDocumentCompilationAttemptInput,
  type BindInitialDocumentCompilationProfilesInput,
  type DocumentCompilationAttempt,
  type DocumentCompilationAttemptRepository,
  type DocumentCompilationCheckpoint,
  DocumentCompilationOutboxEventType,
} from "./document-compilation-attempt-repository";

export interface DocumentCompilationRuntimeOptions {
  readonly attempts: Pick<
    DocumentCompilationAttemptRepository,
    | "advance"
    | "bindInitialProfiles"
    | "claim"
    | "complete"
    | "fail"
    | "failExhausted"
    | "get"
    | "heartbeat"
    | "scheduleRetry"
  >;
  readonly classifyError?: DocumentCompilationErrorClassifier | undefined;
  readonly contentionRetryDelayMs?: number | undefined;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly initialRetryDelayMs?: number | undefined;
  readonly intervalMs: number;
  readonly jobs: Pick<JobQueueAdapter, "complete" | "fail" | "heartbeat" | "lease" | "retry">;
  readonly leaseMs: number;
  readonly maxBatchSize: number;
  readonly maxRetryDelayMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: { readonly error: unknown; readonly job?: JobRecord }) => void)
    | undefined;
  readonly processor: DocumentCompilationAttemptProcessor;
  readonly workerId: string;
}

export interface AdvanceDocumentCompilationExecutionInput {
  readonly candidateFingerprint?: string | undefined;
  readonly candidatePublicationId?: string | undefined;
  readonly checkpoint: DocumentCompilationCheckpoint;
}

export interface DocumentCompilationExecutionContext {
  /** The latest fenced database snapshot; it changes after advance/heartbeat. */
  readonly attempt: DocumentCompilationAttempt;
  /** Aborted when either the database or broker lease is lost. */
  readonly signal: AbortSignal;
  advance(input: AdvanceDocumentCompilationExecutionInput): Promise<DocumentCompilationAttempt>;
  bindInitialProfiles(
    input: Pick<
      BindInitialDocumentCompilationProfilesInput,
      "embeddingProfile" | "retrievalProfile"
    >,
  ): Promise<DocumentCompilationAttempt>;
  heartbeat(): Promise<DocumentCompilationAttempt>;
  /**
   * Runs an attempt-dependent side effect on the same serialized lane as advance/heartbeat.
   * Background heartbeats cannot change rowVersion between the supplied snapshot and completion.
   */
  withLeaseSnapshot<T>(operation: (attempt: DocumentCompilationAttempt) => Promise<T>): Promise<T>;
}

/**
 * Performs one resumable execution. Before resolving, a successful processor advances the durable
 * checkpoint through `smoke_eval_passed`; the runtime then owns the final `published` transition.
 * Throw `DocumentCompilationProcessingError` to opt a known transient failure into retry.
 */
export type DocumentCompilationAttemptProcessor = (
  context: DocumentCompilationExecutionContext,
) => Promise<void>;

export interface DocumentCompilationErrorClassification {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type DocumentCompilationErrorClassifier = (
  error: unknown,
  attempt: DocumentCompilationAttempt,
) => DocumentCompilationErrorClassification;

export interface DocumentCompilationRuntimeTickResult {
  /** Queue jobs superseded by a newer persisted delivery identity. */
  readonly acknowledgedStale: number;
  /** Queue jobs whose attempt was already terminal and therefore only needed acknowledgement. */
  readonly acknowledgedTerminal: number;
  /** Jobs released after losing a database/queue fence or a claim race. */
  readonly deferred: number;
  readonly failed: number;
  readonly leased: number;
  /** Invalid envelopes or envelopes whose durable attempt no longer exists. */
  readonly rejected: number;
  readonly retryScheduled: number;
  readonly succeeded: number;
}

export interface DocumentCompilationRuntime {
  /** Starts periodic execution. Calling start more than once is harmless. */
  start(): void;
  /** Stops future periodic ticks. Running processors receive no synthetic cancellation. */
  stop(): void;
  /** Runs one non-overlapping, document.compile-only queue pass. */
  tick(): Promise<DocumentCompilationRuntimeTickResult>;
}

export class DocumentCompilationProcessingError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { readonly cause?: unknown; readonly code: string; readonly retryable: boolean },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DocumentCompilationProcessingError";
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

export class DocumentCompilationLeaseLostError extends Error {
  constructor(message = "Document compilation execution lease was lost", options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentCompilationLeaseLostError";
  }
}

const terminalRunStates = new Set<DocumentCompilationAttempt["runState"]>([
  "succeeded",
  "failed",
  "canceled",
  "superseded",
]);
const defaultInitialRetryDelayMs = 1_000;
const defaultMaxRetryDelayMs = 5 * 60_000;
const defaultContentionRetryDelayMs = 1_000;

/**
 * Runs durable document compilation attempts. Queue payloads are treated only as attempt locators:
 * the processor receives the complete, freshly claimed database row and never queue-supplied scope,
 * generation, version, or candidate fields.
 */
export function createDocumentCompilationRuntime({
  attempts,
  classifyError = defaultDocumentCompilationErrorClassifier,
  contentionRetryDelayMs = defaultContentionRetryDelayMs,
  generateLeaseToken = randomUUID,
  leaseMs,
  heartbeatIntervalMs = Math.max(1, Math.floor(leaseMs / 3)),
  initialRetryDelayMs = defaultInitialRetryDelayMs,
  intervalMs,
  jobs,
  maxBatchSize,
  maxRetryDelayMs = defaultMaxRetryDelayMs,
  now = Date.now,
  onError,
  processor,
  workerId,
}: DocumentCompilationRuntimeOptions): DocumentCompilationRuntime {
  validatePositiveInteger(intervalMs, "intervalMs");
  validatePositiveInteger(leaseMs, "leaseMs");
  validatePositiveInteger(maxBatchSize, "maxBatchSize");
  validatePositiveInteger(heartbeatIntervalMs, "heartbeatIntervalMs");
  validatePositiveInteger(contentionRetryDelayMs, "contentionRetryDelayMs");
  validatePositiveInteger(initialRetryDelayMs, "initialRetryDelayMs");
  validatePositiveInteger(maxRetryDelayMs, "maxRetryDelayMs");
  if (heartbeatIntervalMs >= leaseMs) {
    throw new Error("Document compilation runtime heartbeatIntervalMs must be less than leaseMs");
  }
  if (initialRetryDelayMs > maxRetryDelayMs) {
    throw new Error(
      "Document compilation runtime initialRetryDelayMs must not exceed maxRetryDelayMs",
    );
  }
  if (!workerId.trim()) {
    throw new Error("Document compilation runtime workerId must not be empty");
  }

  let activeTick: Promise<DocumentCompilationRuntimeTickResult> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function deferQueueJob(
    job: JobRecord,
    attempt?: DocumentCompilationAttempt,
  ): Promise<void> {
    const timestamp = validTimestamp(now(), "now");
    const durableWakeAt = Math.max(
      parseTimestamp(attempt?.retryAt),
      parseTimestamp(attempt?.leaseExpiresAt),
    );
    const runAfter = Math.max(timestamp + contentionRetryDelayMs, durableWakeAt);
    await jobs.retry(job.id, { runAfter });
  }

  async function acknowledgeTerminal(job: JobRecord): Promise<"acknowledgedTerminal"> {
    await jobs.complete(job.id);
    return "acknowledgedTerminal";
  }

  async function acknowledgeStale(job: JobRecord): Promise<"acknowledgedStale"> {
    await jobs.complete(job.id);
    return "acknowledgedStale";
  }

  async function rejectEnvelope(job: JobRecord, error: unknown): Promise<"rejected"> {
    onError?.({ error, job });
    await jobs.fail(job.id, errorMessage(error));
    return "rejected";
  }

  async function reconcileFailedClaim(
    job: JobRecord,
    attemptId: string,
  ): Promise<DocumentCompilationJobOutcome> {
    let current = await attempts.get(attemptId);
    if (!current) {
      return rejectEnvelope(job, new Error(`Document compilation attempt ${attemptId} not found`));
    }
    if (terminalRunStates.has(current.runState)) {
      return acknowledgeTerminal(job);
    }
    if (current.queueJobId && current.queueJobId !== job.id) {
      // This is an older delivery than the identity persisted by the latest outbox dispatch.
      return acknowledgeStale(job);
    }

    if (current.executionAttempts >= current.maxExecutionAttempts) {
      const timestamp = validTimestamp(now(), "now");
      const failed = await attempts.failExhausted({
        attemptId: current.id,
        errorCode: "EXECUTION_ATTEMPTS_EXHAUSTED",
        errorMessage: "Document compilation execution attempts exhausted",
        expectedRowVersion: current.rowVersion,
        now: isoTimestamp(timestamp),
      });
      if (failed) {
        // The database is the terminal authority; the queue is only acknowledged afterwards.
        await jobs.complete(job.id);
        return "failed";
      }
      current = (await attempts.get(attemptId)) ?? current;
      if (terminalRunStates.has(current.runState)) {
        return acknowledgeTerminal(job);
      }
    }

    if (current.runState === "retry_wait") {
      // scheduleRetry already recreated the durable outbox event. A stale broker delivery must not
      // create a second retry schedule.
      await jobs.complete(job.id);
      return "retryScheduled";
    }

    await deferQueueJob(job, current);
    return "deferred";
  }

  async function processClaimedJob(
    job: JobRecord,
    claimed: DocumentCompilationAttempt,
    leaseToken: string,
  ): Promise<DocumentCompilationJobOutcome> {
    const execution = createFencedExecution({
      attempts,
      generateNow: now,
      heartbeatIntervalMs,
      job,
      jobs,
      leaseMs,
      leaseToken,
      initialAttempt: claimed,
      workerId,
    });
    let processingError: unknown;

    try {
      await processor(execution.context);
    } catch (error) {
      processingError = error;
    }

    const leaseFailure = await execution.finish();
    if (leaseFailure) {
      onError?.({ error: leaseFailure, job });
      const fresh = await attempts.get(claimed.id);
      if (fresh && terminalRunStates.has(fresh.runState)) {
        return acknowledgeTerminal(job);
      }
      await deferQueueJob(job, fresh ?? execution.current());
      return "deferred";
    }

    const current = execution.current();
    const timestamp = validTimestamp(now(), "now");

    if (processingError === undefined) {
      const completed = await attempts.complete({
        attemptId: current.id,
        expectedRowVersion: current.rowVersion,
        leaseToken,
        now: isoTimestamp(timestamp),
      });
      if (!completed) {
        return reconcileFailedClaim(job, current.id);
      }
      await jobs.complete(job.id);
      return "succeeded";
    }

    const classified = normalizeErrorClassification(classifyError(processingError, current));
    const canRetry =
      classified.retryable && current.executionAttempts < current.maxExecutionAttempts;

    if (canRetry) {
      const retryAt =
        timestamp +
        exponentialDelay(initialRetryDelayMs, maxRetryDelayMs, current.executionAttempts);
      const scheduled = await attempts.scheduleRetry({
        attemptId: current.id,
        errorCode: classified.code,
        errorMessage: classified.message,
        expectedRowVersion: current.rowVersion,
        leaseToken,
        now: isoTimestamp(timestamp),
        retryAt: isoTimestamp(retryAt),
      });
      if (!scheduled) {
        return reconcileFailedClaim(job, current.id);
      }
      // scheduleRetry atomically owns the next delivery through its outbox row.
      await jobs.complete(job.id);
      return "retryScheduled";
    }

    const failed = await attempts.fail({
      attemptId: current.id,
      errorCode: classified.code,
      errorMessage: classified.message,
      expectedRowVersion: current.rowVersion,
      leaseToken,
      now: isoTimestamp(timestamp),
    });
    if (!failed) {
      return reconcileFailedClaim(job, current.id);
    }
    await jobs.complete(job.id);
    return "failed";
  }

  async function processLeasedJob(job: JobRecord): Promise<DocumentCompilationJobOutcome> {
    let attemptId: string;
    try {
      attemptId = parseAttemptPayload(job.payload).attemptId;
    } catch (error) {
      return rejectEnvelope(job, error);
    }

    const snapshot = await attempts.get(attemptId);
    if (!snapshot) {
      return rejectEnvelope(job, new Error(`Document compilation attempt ${attemptId} not found`));
    }
    if (terminalRunStates.has(snapshot.runState)) {
      return acknowledgeTerminal(job);
    }
    if (
      (snapshot.queueJobId && snapshot.queueJobId !== job.id) ||
      (snapshot.externalJobId && job.externalJobId && snapshot.externalJobId !== job.externalJobId)
    ) {
      return acknowledgeStale(job);
    }
    if (snapshot.runState === "retry_wait") {
      // A successful scheduleRetry transaction has already made its outbox authoritative.
      return acknowledgeTerminal(job).then(() => "retryScheduled");
    }

    const claimTime = validTimestamp(now(), "now");
    const leaseToken = generateLeaseToken();
    const claimed = await attempts.claim({
      attemptId,
      expectedRowVersion: snapshot.rowVersion,
      ...(job.externalJobId ? { externalJobId: job.externalJobId } : {}),
      leaseExpiresAt: isoTimestamp(claimTime + leaseMs),
      leaseToken,
      now: isoTimestamp(claimTime),
      queueJobId: job.id,
      workerId,
    });
    if (!claimed) {
      return reconcileFailedClaim(job, attemptId);
    }

    return processClaimedJob(job, claimed, leaseToken);
  }

  async function runTick(): Promise<DocumentCompilationRuntimeTickResult> {
    const leaseTime = validTimestamp(now(), "now");
    const leased = await jobs.lease({
      leaseMs,
      limit: maxBatchSize,
      now: leaseTime,
      types: [DocumentCompilationOutboxEventType],
      workerId,
    });
    const result: MutableDocumentCompilationRuntimeTickResult = {
      acknowledgedStale: 0,
      acknowledgedTerminal: 0,
      deferred: 0,
      failed: 0,
      leased: leased.length,
      rejected: 0,
      retryScheduled: 0,
      succeeded: 0,
    };

    const outcomes = await Promise.all(
      leased.map(async (job): Promise<DocumentCompilationJobOutcome | undefined> => {
        try {
          return await processLeasedJob(job);
        } catch (error) {
          onError?.({ error, job });
          // Leave a broker job leased when its post-database acknowledgement fails. Its later
          // redelivery observes the durable state and performs acknowledgement only.
          return undefined;
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome) {
        result[outcome] += 1;
      }
    }

    return result;
  }

  function tick(): Promise<DocumentCompilationRuntimeTickResult> {
    if (activeTick) {
      return activeTick;
    }
    activeTick = runTick().finally(() => {
      activeTick = undefined;
    });
    return activeTick;
  }

  return {
    start: () => {
      if (timer) {
        return;
      }
      void tick().catch((error) => onError?.({ error }));
      timer = setInterval(() => {
        void tick().catch((error) => onError?.({ error }));
      }, intervalMs);
      (timer as { unref?: () => void }).unref?.();
    },
    stop: () => {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}

interface FencedExecutionOptions {
  readonly attempts: Pick<
    DocumentCompilationAttemptRepository,
    "advance" | "bindInitialProfiles" | "heartbeat"
  >;
  readonly generateNow: () => number;
  readonly heartbeatIntervalMs: number;
  readonly initialAttempt: DocumentCompilationAttempt;
  readonly job: JobRecord;
  readonly jobs: Pick<JobQueueAdapter, "heartbeat">;
  readonly leaseMs: number;
  readonly leaseToken: string;
  readonly workerId: string;
}

interface FencedExecution {
  readonly context: DocumentCompilationExecutionContext;
  current(): DocumentCompilationAttempt;
  finish(): Promise<DocumentCompilationLeaseLostError | undefined>;
}

function createFencedExecution({
  attempts,
  generateNow,
  heartbeatIntervalMs,
  initialAttempt,
  job,
  jobs,
  leaseMs,
  leaseToken,
  workerId,
}: FencedExecutionOptions): FencedExecution {
  let current = initialAttempt;
  let leaseFailure: DocumentCompilationLeaseLostError | undefined;
  let mutationTail: Promise<void> = Promise.resolve();
  const abortController = new AbortController();

  function loseLease(message: string, cause?: unknown): DocumentCompilationLeaseLostError {
    if (!leaseFailure) {
      leaseFailure = new DocumentCompilationLeaseLostError(message, { cause });
      abortController.abort(leaseFailure);
    }
    return leaseFailure;
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(async () => {
      if (leaseFailure) {
        throw leaseFailure;
      }
      return operation();
    });
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function heartbeat(): Promise<DocumentCompilationAttempt> {
    return serialize(async () => {
      const timestamp = validTimestamp(generateNow(), "now");
      let updated: DocumentCompilationAttempt | null;
      try {
        updated = await attempts.heartbeat({
          attemptId: current.id,
          expectedRowVersion: current.rowVersion,
          leaseExpiresAt: isoTimestamp(timestamp + leaseMs),
          leaseToken,
          now: isoTimestamp(timestamp),
          workerId,
        });
      } catch (error) {
        throw loseLease("Document compilation database heartbeat failed", error);
      }
      if (!updated) {
        throw loseLease("Document compilation database heartbeat lost its fence");
      }
      current = updated;
      try {
        await jobs.heartbeat({
          jobId: job.id,
          leaseMs,
          now: timestamp,
          workerId,
        });
      } catch (error) {
        throw loseLease("Document compilation queue heartbeat failed", error);
      }
      return current;
    });
  }

  async function advance(
    input: AdvanceDocumentCompilationExecutionInput,
  ): Promise<DocumentCompilationAttempt> {
    return serialize(async () => {
      const timestamp = validTimestamp(generateNow(), "now");
      const advanceInput: AdvanceDocumentCompilationAttemptInput = {
        attemptId: current.id,
        ...(input.candidateFingerprint ? { candidateFingerprint: input.candidateFingerprint } : {}),
        ...(input.candidatePublicationId
          ? { candidatePublicationId: input.candidatePublicationId }
          : {}),
        checkpoint: input.checkpoint,
        expectedRowVersion: current.rowVersion,
        leaseToken,
        now: isoTimestamp(timestamp),
      };
      // A thrown transition/validation error is processor failure, not proof that ownership was
      // lost. If a database error was commit-ambiguous, the later fenced terminal write will fail
      // its row version and reconciliation will defer safely.
      const updated = await attempts.advance(advanceInput);
      if (!updated) {
        throw loseLease("Document compilation checkpoint update lost its fence");
      }
      current = updated;
      return current;
    });
  }

  async function bindInitialProfiles(
    input: Pick<
      BindInitialDocumentCompilationProfilesInput,
      "embeddingProfile" | "retrievalProfile"
    >,
  ): Promise<DocumentCompilationAttempt> {
    return serialize(async () => {
      const timestamp = validTimestamp(generateNow(), "now");
      const updated = await attempts.bindInitialProfiles({
        attemptId: current.id,
        ...(input.embeddingProfile ? { embeddingProfile: input.embeddingProfile } : {}),
        expectedRowVersion: current.rowVersion,
        leaseToken,
        now: isoTimestamp(timestamp),
        retrievalProfile: input.retrievalProfile,
      });
      if (!updated) {
        throw loseLease("Document compilation initial profile binding lost its fence");
      }
      current = updated;
      return current;
    });
  }

  async function withLeaseSnapshot<T>(
    operation: (attempt: DocumentCompilationAttempt) => Promise<T>,
  ): Promise<T> {
    return serialize(() => operation(current));
  }

  const context: DocumentCompilationExecutionContext = {
    get attempt() {
      return current;
    },
    advance,
    bindInitialProfiles,
    heartbeat,
    signal: abortController.signal,
    withLeaseSnapshot,
  };
  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch(() => undefined);
  }, heartbeatIntervalMs);
  (heartbeatTimer as { unref?: () => void }).unref?.();

  return {
    context,
    current: () => current,
    finish: async () => {
      clearInterval(heartbeatTimer);
      await mutationTail;
      return leaseFailure;
    },
  };
}

export function defaultDocumentCompilationErrorClassifier(
  error: unknown,
): DocumentCompilationErrorClassification {
  if (error instanceof DocumentCompilationProcessingError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: "DOCUMENT_COMPILATION_FAILED",
    message: errorMessage(error),
    retryable: false,
  };
}

function normalizeErrorClassification(
  classification: DocumentCompilationErrorClassification,
): DocumentCompilationErrorClassification {
  const code = classification.code.trim().slice(0, 64);
  const message = classification.message.trim().slice(0, 4_096);
  if (!code || !message) {
    throw new Error("Document compilation error classification requires code and message");
  }
  return { code, message, retryable: classification.retryable };
}

function parseAttemptPayload(payload: JobPayload): { readonly attemptId: string } {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Document compilation queue payload must be an object");
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "attemptId") {
    throw new Error("Document compilation queue payload must contain only attemptId");
  }
  const attemptId = (payload as Readonly<Record<string, JobPayload>>).attemptId;
  if (typeof attemptId !== "string") {
    throw new Error("Document compilation queue attemptId must be a string");
  }
  return { attemptId: UuidSchema.parse(attemptId) };
}

function exponentialDelay(initialMs: number, maximumMs: number, attempt: number): number {
  const exponent = Math.max(0, Math.min(52, attempt - 1));
  return Math.min(maximumMs, initialMs * 2 ** exponent);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 4_096);
  }
  return "Document compilation execution failed";
}

function validatePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Document compilation runtime ${field} must be a positive integer`);
  }
}

function validTimestamp(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Document compilation runtime ${field} must be a finite timestamp`);
  }
  return value;
}

function isoTimestamp(value: number): string {
  return new Date(value).toISOString();
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

type DocumentCompilationJobOutcome = Exclude<keyof DocumentCompilationRuntimeTickResult, "leased">;

type MutableDocumentCompilationRuntimeTickResult = {
  -readonly [Key in keyof DocumentCompilationRuntimeTickResult]: DocumentCompilationRuntimeTickResult[Key];
};
