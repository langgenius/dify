import type {
  AuthSubject,
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";

import type { AnswerTraceRecorder } from "./answer-trace-recorder";
import {
  type FailedQueryRecorder,
  failedQueryTrigger,
  readTopScore,
} from "./failed-query-recorder";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import type {
  ResearchTaskProgressEvent,
  ResearchTaskProgressRepository,
} from "./research-task-progress";
import {
  type ActiveRetrievalExecutionLease,
  RetrievalExecutionLeaseLostError,
} from "./retrieval-execution-lease";
import type { QuerySessionContext } from "./session-context-repository";
import {
  formatQuerySseEvent,
  formatResearchTaskProgressSseEvent,
  formatSseEvent,
} from "./sse-events";

export type QueryGenerationMode = "deep" | "fast" | "research";

export interface QueryGenerationInput {
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly knowledgeSpaceId: string;
  readonly mode: QueryGenerationMode;
  readonly permissionSnapshot?:
    | {
        readonly accessChannel: "agent" | "interactive" | "mcp" | "service_api";
        readonly id: string;
        readonly revision: number;
      }
    | undefined;
  readonly permissionScope: readonly string[];
  readonly projectionSnapshot?: PublishedProjectionReadSnapshot | undefined;
  readonly query: string;
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfile | undefined;
  readonly sessionContext?: QuerySessionContext | undefined;
  readonly subject: AuthSubject;
  /** Per-run resolved limit; durable Research jobs persist and replay this exact value. */
  readonly topK?: number | undefined;
  readonly traceId: string;
}

/**
 * Returns the non-secret, versioned knowledge-space retrieval settings that
 * actually governed a query. Keeping this summary alongside the resolved plan
 * makes model/config drift diagnosable without exposing plugin credentials.
 */
export function queryRetrievalProfileMetadata(
  profile: KnowledgeSpaceRetrievalProfile | undefined,
): Record<string, unknown> | undefined {
  if (!profile) {
    return undefined;
  }

  return {
    defaultMode: profile.defaultMode,
    reasoningModel: { ...profile.reasoningModel },
    rerank: {
      enabled: profile.rerank.enabled,
      ...(profile.rerank.model ? { model: { ...profile.rerank.model } } : {}),
    },
    revision: profile.revision,
    scoreThreshold: { ...profile.scoreThreshold },
    topK: profile.topK,
  };
}

/** Safe identity of the immutable publication cut used by every query stage. */
export function queryProjectionSnapshotMetadata(
  snapshot: PublishedProjectionReadSnapshot | undefined,
): Record<string, unknown> | undefined {
  if (!snapshot) {
    return undefined;
  }

  return {
    fingerprint: snapshot.fingerprint,
    headRevision: snapshot.headRevision,
    projectionVersion: snapshot.projectionVersion,
    publicationId: snapshot.publicationId,
  };
}

export interface QueryTraceStep {
  readonly endedAt: string;
  readonly metadata: Record<string, unknown>;
  readonly name: string;
  readonly startedAt: string;
  readonly status: "error" | "ok" | "skipped";
}

export type QueryGenerationEvent =
  | {
      readonly delta: string;
      readonly type: "delta";
    }
  | {
      readonly finishReason: string;
      readonly metadata?: Record<string, unknown> | undefined;
      readonly type: "done";
    }
  | {
      /** Internal per-stage timing; persisted into the answer trace, never streamed to clients. */
      readonly step: QueryTraceStep;
      readonly type: "trace-step";
    };

/** Builds a trace-step event from a `Date.now()` start mark; duration lands in step metadata. */
export function traceStepEvent(
  name: string,
  startedAtMs: number,
  status: QueryTraceStep["status"],
  metadata: Record<string, unknown> = {},
): QueryGenerationEvent {
  const endedAtMs = Date.now();

  return {
    step: {
      endedAt: new Date(endedAtMs).toISOString(),
      metadata: { durationMs: Math.max(0, endedAtMs - startedAtMs), ...metadata },
      name,
      startedAt: new Date(startedAtMs).toISOString(),
      status,
    },
    type: "trace-step",
  };
}

export interface QueryGenerator {
  stream(input: QueryGenerationInput): AsyncIterable<QueryGenerationEvent>;
}

export function createQuerySseResponse({
  answerTraceRecorder,
  executionLease,
  failedQueryLowConfidenceScoreFloor,
  failedQueryRecorder,
  generator,
  initialTraceSteps = [],
  input,
  onTerminal,
  sessionId,
  traceId,
}: {
  readonly answerTraceRecorder?: AnswerTraceRecorder | undefined;
  readonly executionLease?: ActiveRetrievalExecutionLease | undefined;
  readonly failedQueryLowConfidenceScoreFloor?: number | undefined;
  readonly failedQueryRecorder?: FailedQueryRecorder | undefined;
  readonly generator: QueryGenerator;
  /** Admission-stage trace steps measured before the answer generator starts. */
  readonly initialTraceSteps?: readonly QueryTraceStep[] | undefined;
  readonly input: QueryGenerationInput;
  readonly onTerminal?:
    | ((status: "canceled" | "failed" | "succeeded") => Promise<void>)
    | undefined;
  readonly sessionId?: string | undefined;
  readonly traceId: string;
}): Response {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<QueryGenerationEvent> | undefined;
  let clientCanceled = false;
  let terminalState: "canceled" | "failed" | "running" | "succeeded" | "success-committing" =
    "running";
  let released = false;
  const releaseLease = async (): Promise<void> => {
    if (!executionLease || released) return;
    released = true;
    await executionLease.release();
  };
  const stream = new ReadableStream<Uint8Array>({
    async cancel() {
      clientCanceled = true;
      void iterator?.return?.();
      // Once final success persistence starts, the computation has crossed its point of no return.
      // A transport disconnect may stop delivery, but must not race in a contradictory canceled
      // activity beside a durable successful AnswerTrace.
      if (terminalState === "running") {
        terminalState = "canceled";
        await onTerminal?.("canceled").catch(() => undefined);
      }
      await releaseLease().catch(() => undefined);
    },
    async start(controller) {
      const events: QueryGenerationEvent[] = initialTraceSteps.map((step) => ({
        step: {
          ...step,
          metadata: { ...step.metadata },
        },
        type: "trace-step",
      }));
      let doneEvent: Extract<QueryGenerationEvent, { readonly type: "done" }> | undefined;
      try {
        await executionLease?.assertActive();
        iterator = generator.stream(input)[Symbol.asyncIterator]();
        while (!clientCanceled && terminalState === "running") {
          const next = await nextGenerationEvent(iterator, executionLease);
          if (clientCanceled || terminalState !== "running") return;
          if (next.done) break;
          const event = next.value;
          await executionLease?.assertActive();

          if (doneEvent) {
            throw new Error("Query generator emitted an event after its terminal done event");
          }
          events.push(event);

          // Trace steps are answer-trace bookkeeping, not client payload.
          if (event.type === "trace-step") {
            continue;
          }

          // A client must not observe answer.done until the durable AnswerTrace commit below has
          // succeeded. Delta chunks may already be visible, but a trace failure then produces an
          // explicit answer.error rather than a falsely successful terminal signal.
          if (event.type === "done") {
            doneEvent = event;
            continue;
          }

          controller.enqueue(encoder.encode(formatQuerySseEvent(event, traceId)));
        }
        if (clientCanceled || terminalState !== "running") return;
        if (!doneEvent) {
          throw new Error("Query generator completed without a terminal done event");
        }
        await executionLease?.assertActive();
        if (clientCanceled || terminalState !== "running") return;

        // This synchronous state transition closes the cancel race before the durable write begins.
        // The AnswerTrace repository itself takes the knowledge-space deletion admission lock.
        terminalState = "success-committing";
        await recordAnswerTrace({
          answerTraceRecorder,
          events,
          input,
          status: "ok",
          traceId,
        });
        terminalState = "succeeded";

        try {
          await captureFailedQuery({
            events,
            failedQueryLowConfidenceScoreFloor,
            failedQueryRecorder,
            input,
            traceId,
          });
          if (!clientCanceled) {
            controller.enqueue(encoder.encode(formatQuerySseEvent(doneEvent, traceId)));
          }
        } finally {
          // Activity is a compatibility/read-model projection. The successful AnswerTrace above is
          // authoritative, so callback failure or a disconnected controller cannot downgrade it.
          await onTerminal?.("succeeded").catch(() => undefined);
        }
      } catch (error) {
        void iterator?.return?.();
        if (terminalState === "succeeded" || terminalState === "canceled") {
          return;
        }
        const claimedTerminalCommit = terminalState === "success-committing";
        terminalState = "failed";
        const leaseLost =
          error instanceof RetrievalExecutionLeaseLostError || executionLease?.signal.aborted;
        // A disconnect before terminal ownership is claimed is a cancellation. Once the success
        // commit begins, however, this stream owns the durable terminal outcome. If that commit
        // fails after a disconnect, persist/project failure instead of leaving query.requested
        // pending forever. The AnswerTrace repository still enforces deletion admission itself.
        const mustFinalizeClaimedTerminal = claimedTerminalCommit && clientCanceled;
        if (mustFinalizeClaimedTerminal || (!leaseLost && !clientCanceled)) {
          try {
            if (!mustFinalizeClaimedTerminal) {
              await executionLease?.assertActive();
            }
            await recordAnswerTrace({
              answerTraceRecorder,
              events,
              input,
              status: "error",
              traceId,
            });
          } catch {
            // A concurrent lease loss must not create a late trace after deletion cleanup.
          }
        }
        if (mustFinalizeClaimedTerminal || !clientCanceled) {
          await onTerminal?.("failed").catch(() => undefined);
        }
        if (!clientCanceled) {
          try {
            controller.enqueue(
              encoder.encode(
                formatSseEvent("answer.error", {
                  error: leaseLost
                    ? "Query stopped because knowledge deletion started"
                    : "Query generation failed",
                  traceId,
                }),
              ),
            );
          } catch {
            // The client may have disconnected while the generator or lease check was in flight.
          }
        }
      } finally {
        await releaseLease().catch(() => undefined);
        if (!clientCanceled) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream; charset=utf-8",
      ...(sessionId ? { "x-session-id": sessionId } : {}),
      "x-query-run-id": traceId,
      "x-trace-id": traceId,
    },
    status: 200,
  });
}

async function nextGenerationEvent(
  iterator: AsyncIterator<QueryGenerationEvent>,
  executionLease: ActiveRetrievalExecutionLease | undefined,
): Promise<IteratorResult<QueryGenerationEvent>> {
  if (!executionLease) return iterator.next();
  if (executionLease.signal.aborted) throw new RetrievalExecutionLeaseLostError();

  let removeAbortListener: (() => void) | undefined;
  const leaseLost = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new RetrievalExecutionLeaseLostError());
    executionLease.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => executionLease.signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([iterator.next(), leaseLost]);
  } finally {
    removeAbortListener?.();
  }
}

async function recordAnswerTrace({
  answerTraceRecorder,
  events,
  input,
  status,
  traceId,
}: {
  readonly answerTraceRecorder?: AnswerTraceRecorder | undefined;
  readonly events: readonly QueryGenerationEvent[];
  readonly input: QueryGenerationInput;
  readonly status: "error" | "ok";
  readonly traceId: string;
}): Promise<void> {
  if (!answerTraceRecorder) {
    return;
  }
  // A derived trace without a durable grant cannot be safely served later. Fail closed by not
  // persisting it rather than creating an ownerless EvidenceBundle capability.
  if (!input.permissionSnapshot) {
    return;
  }

  const doneEvent = [...events]
    .reverse()
    .find((event): event is Extract<QueryGenerationEvent, { readonly type: "done" }> => {
      return event.type === "done";
    });

  // Per-stage steps emitted by the generator (embed / retrieve / answer), followed by the
  // summary step that folds the done-event metadata — the shape earlier consumers rely on.
  const stageSteps = events
    .filter((event): event is Extract<QueryGenerationEvent, { readonly type: "trace-step" }> => {
      return event.type === "trace-step";
    })
    .map((event) => event.step);

  await answerTraceRecorder.record({
    knowledgeSpaceId: input.knowledgeSpaceId,
    mode: input.mode,
    permissionSnapshot: input.permissionSnapshot,
    query: input.query,
    subjectId: input.subject.subjectId,
    steps: [
      ...stageSteps,
      {
        metadata: {
          eventCount: events.length,
          ...(doneEvent?.finishReason ? { finishReason: doneEvent.finishReason } : {}),
          ...(doneEvent?.metadata ? doneEvent.metadata : {}),
        },
        name: "query.generate",
        status,
      },
    ],
    traceId,
  });
}

async function captureFailedQuery({
  events,
  failedQueryLowConfidenceScoreFloor,
  failedQueryRecorder,
  input,
  traceId,
}: {
  readonly events: readonly QueryGenerationEvent[];
  readonly failedQueryLowConfidenceScoreFloor?: number | undefined;
  readonly failedQueryRecorder?: FailedQueryRecorder | undefined;
  readonly input: QueryGenerationInput;
  readonly traceId: string;
}): Promise<void> {
  if (!failedQueryRecorder) {
    return;
  }
  // Provenance-free legacy rows cannot be authorized safely. If a caller bypasses the normal
  // query handler and omits its server-issued snapshot, fail closed by skipping capture.
  if (!input.permissionSnapshot) {
    return;
  }

  const doneEvent = [...events]
    .reverse()
    .find((event): event is Extract<QueryGenerationEvent, { readonly type: "done" }> => {
      return event.type === "done";
    });
  const trigger = failedQueryTrigger({
    finishReason: doneEvent?.finishReason,
    ...(doneEvent?.metadata ? { metadata: doneEvent.metadata } : {}),
    ...(failedQueryLowConfidenceScoreFloor !== undefined
      ? { lowConfidenceScoreFloor: failedQueryLowConfidenceScoreFloor }
      : {}),
  });

  if (!trigger) {
    return;
  }

  const topScore = readTopScore(doneEvent?.metadata);

  try {
    await failedQueryRecorder.record({
      answerTraceId: traceId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      metadata: {
        ...(doneEvent?.finishReason ? { finishReason: doneEvent.finishReason } : {}),
        ...(topScore !== undefined ? { topScore } : {}),
      },
      mode: input.mode,
      permission: {
        accessChannel: input.permissionSnapshot.accessChannel,
        candidateGrants: [...input.permissionScope],
        permissionSnapshotId: input.permissionSnapshot.id,
        permissionSnapshotRevision: input.permissionSnapshot.revision,
        requestedBySubjectId: input.subject.subjectId,
      },
      query: input.query,
      tenantId: input.subject.tenantId,
      trigger,
    });
  } catch (error) {
    // Query responses must not fail after streaming because failed-query capture failed.
    console.warn("Failed query capture failed", {
      errorClass: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      traceId,
    });
  }
}

export function createResearchTaskProgressSseResponse({
  authorize,
  authorizationRecheckIntervalMs = 1_000,
  cursor,
  limit,
  repository,
  researchTaskJobId,
  tenantId,
}: {
  readonly authorize?: (() => Promise<void>) | undefined;
  readonly authorizationRecheckIntervalMs?: number | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly repository: ResearchTaskProgressRepository;
  readonly researchTaskJobId: string;
  readonly tenantId: string;
}): Response {
  if (
    !Number.isSafeInteger(authorizationRecheckIntervalMs) ||
    authorizationRecheckIntervalMs < 10 ||
    authorizationRecheckIntervalMs > 60_000
  ) {
    throw new Error("Research task progress authorization interval must be between 10 and 60000");
  }
  const encoder = new TextEncoder();
  let liveIterator: AsyncIterator<ResearchTaskProgressEvent> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async cancel() {
      closed = true;
      await liveIterator?.return?.();
    },
    async start(controller) {
      let failed = false;
      try {
        const backlog = await repository.list({
          cursor,
          limit,
          researchTaskJobId,
          tenantId,
        });
        let sentEvents = 0;

        for (const event of backlog.items) {
          await authorize?.();
          controller.enqueue(encoder.encode(formatResearchTaskProgressSseEvent(event)));
          sentEvents += 1;
        }

        if (sentEvents >= limit) {
          return;
        }

        const subscriptionCursor =
          backlog.items.at(-1)?.sequence === undefined
            ? cursor
            : String(backlog.items.at(-1)?.sequence);
        liveIterator = repository
          .subscribe({
            ...(subscriptionCursor === undefined ? {} : { cursor: subscriptionCursor }),
            researchTaskJobId,
            tenantId,
          })
          [Symbol.asyncIterator]();

        while (!closed && sentEvents < limit) {
          const next = authorize
            ? await nextProgressEventWithAuthorization({
                authorize,
                intervalMs: authorizationRecheckIntervalMs,
                isClosed: () => closed,
                iterator: liveIterator,
              })
            : await liveIterator.next();

          if (next.done) {
            break;
          }

          await authorize?.();
          controller.enqueue(encoder.encode(formatResearchTaskProgressSseEvent(next.value)));
          sentEvents += 1;
        }
      } catch (error) {
        failed = true;
        if (!closed) {
          controller.error(error);
        }
      } finally {
        await liveIterator?.return?.();
        if (!failed && !closed) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream; charset=utf-8",
    },
    status: 200,
  });
}

async function nextProgressEventWithAuthorization(input: {
  readonly authorize: () => Promise<void>;
  readonly intervalMs: number;
  readonly isClosed: () => boolean;
  readonly iterator: AsyncIterator<ResearchTaskProgressEvent>;
}): Promise<IteratorResult<ResearchTaskProgressEvent>> {
  const next = input.iterator.next();
  while (!input.isClosed()) {
    await input.authorize();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      next.then((value) => ({ kind: "event" as const, value })),
      new Promise<{ readonly kind: "interval" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "interval" }), input.intervalMs);
      }),
    ]);
    if (timeout) {
      clearTimeout(timeout);
    }
    if (result.kind === "event") {
      return result.value;
    }
  }
  return { done: true, value: undefined as never };
}
