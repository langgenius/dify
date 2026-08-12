import type { AnswerTrace, FailedQuery } from "@knowledge/core";

import type { AnswerTraceRecorder } from "./answer-trace-recorder";
import type { AnswerTraceRepository } from "./answer-trace-repository";
import type { FailedQueryRepository } from "./failed-query-repository";
import type { QualityControlRepository } from "./quality-control";

export type WorkflowFailedRetrievalVerdict =
  | "coverage-gap"
  | "irrelevant"
  | "retrieval-miss"
  | "uncertain";

export interface WorkflowFailedRetrievalTriage {
  triage(input: {
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly query: string;
    readonly tenantId: string;
  }): Promise<{ readonly verdict: WorkflowFailedRetrievalVerdict }>;
}

export interface CaptureWorkflowFailedRetrievalInput {
  readonly actorSubjectId: string;
  readonly candidateGrants: readonly string[];
  readonly capabilityGrantId: string;
  readonly eventId: string;
  readonly knowledgeSpaceId: string;
  readonly mode: "deep" | "fast" | "research";
  readonly query: string;
  readonly retrievalTraceId: string;
  readonly tenantId: string;
}

export interface CaptureWorkflowFailedRetrievalResult {
  readonly badCaseId?: string | undefined;
  readonly failedQueryId: string;
  readonly verdict: WorkflowFailedRetrievalVerdict;
}

export interface WorkflowFailedRetrievalCaptureService {
  capture(
    input: CaptureWorkflowFailedRetrievalInput,
  ): Promise<CaptureWorkflowFailedRetrievalResult>;
}

export class WorkflowFailedRetrievalReplayConflictError extends Error {
  constructor(eventId: string) {
    super(`Workflow failed-retrieval event id=${eventId} was reused with a different payload`);
    this.name = "WorkflowFailedRetrievalReplayConflictError";
  }
}

export function createWorkflowFailedRetrievalCaptureService({
  answerTraceRecorder,
  answerTraces,
  failedQueries,
  now = () => new Date().toISOString(),
  qualityControl,
  triage,
}: {
  readonly answerTraceRecorder: AnswerTraceRecorder;
  readonly answerTraces: Pick<AnswerTraceRepository, "get">;
  readonly failedQueries: FailedQueryRepository;
  readonly now?: (() => string) | undefined;
  readonly qualityControl?: Pick<QualityControlRepository, "createBadCase"> | undefined;
  readonly triage: WorkflowFailedRetrievalTriage;
}): WorkflowFailedRetrievalCaptureService {
  return {
    capture: async (input) => {
      const lookup = {
        candidateGrants: input.candidateGrants,
        id: input.eventId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        subjectId: input.actorSubjectId,
        tenantId: input.tenantId,
      };
      let failedQuery = await failedQueries.get(lookup);
      let traceCapabilityGrantId = input.capabilityGrantId;

      if (!failedQuery) {
        traceCapabilityGrantId = await ensureWorkflowAnswerTrace(
          answerTraces,
          answerTraceRecorder,
          input,
        );
      }
      failedQuery = await failedQueries.captureWorkflowFailedRetrieval({
        actorSubjectId: input.actorSubjectId,
        answerTraceId: input.eventId,
        candidateGrants: input.candidateGrants,
        capabilityGrantId: input.capabilityGrantId,
        id: input.eventId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        mode: input.mode,
        query: input.query,
        retrievalTraceId: input.retrievalTraceId,
        subjectId: input.actorSubjectId,
        tenantId: input.tenantId,
        traceCapabilityGrantId,
      });

      let verdict = persistedVerdict(failedQuery);
      if (!verdict) {
        verdict = (
          await triage.triage({
            candidateGrants: input.candidateGrants,
            knowledgeSpaceId: input.knowledgeSpaceId,
            query: input.query,
            tenantId: input.tenantId,
          })
        ).verdict;
        const completed = await failedQueries.completeWorkflowFailedRetrievalTriage({
          actorSubjectId: input.actorSubjectId,
          candidateGrants: input.candidateGrants,
          capabilityGrantId: input.capabilityGrantId,
          id: input.eventId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          subjectId: input.actorSubjectId,
          tenantId: input.tenantId,
          triagedAt: now(),
          verdict,
        });
        if (!completed) throw new Error("Workflow failed query disappeared during LLM triage");
        failedQuery = completed;
      }

      if (verdict !== "retrieval-miss") {
        return { failedQueryId: failedQuery.id, verdict };
      }
      if (!qualityControl) {
        throw new Error("Quality bad-case runtime unavailable");
      }
      const badCase = await qualityControl.createBadCase({
        actorSubjectId: input.actorSubjectId,
        candidateGrants: input.candidateGrants,
        capabilityGrantId: input.capabilityGrantId,
        id: input.eventId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        reason:
          "Workflow retrieval returned no evidence even though the knowledge base appears to contain relevant answer material.",
        tags: ["workflow", "auto-captured", "retrieval-miss"],
        tenantId: input.tenantId,
        traceId: input.eventId,
      });
      return { badCaseId: badCase.id, failedQueryId: failedQuery.id, verdict };
    },
  };
}

async function ensureWorkflowAnswerTrace(
  answerTraces: Pick<AnswerTraceRepository, "get">,
  recorder: AnswerTraceRecorder,
  input: CaptureWorkflowFailedRetrievalInput,
): Promise<string> {
  const existing = await answerTraces.get({
    id: input.eventId,
    knowledgeSpaceId: input.knowledgeSpaceId,
  });
  if (existing) {
    assertWorkflowAnswerTraceReplay(existing, input);
    if (!existing.capabilityGrantId) {
      throw new WorkflowFailedRetrievalReplayConflictError(input.eventId);
    }
    return existing.capabilityGrantId;
  }
  const recorded = await recorder.record({
    capabilityGrantId: input.capabilityGrantId,
    knowledgeSpaceId: input.knowledgeSpaceId,
    mode: input.mode,
    query: input.query,
    steps: [
      {
        metadata: {
          actorSubjectId: input.actorSubjectId,
          eventId: input.eventId,
          finishReason: "no-retrieval-evidence",
          retrievalTraceId: input.retrievalTraceId,
          source: "workflow",
        },
        name: "query.retrieve",
        status: "ok",
      },
    ],
    tenantId: input.tenantId,
    traceId: input.eventId,
  });
  if (!recorded.capabilityGrantId) {
    throw new Error("Workflow failed-retrieval AnswerTrace lost Capability provenance");
  }
  return recorded.capabilityGrantId;
}

function assertWorkflowAnswerTraceReplay(
  existing: AnswerTrace,
  input: CaptureWorkflowFailedRetrievalInput,
): void {
  const step = existing.steps.length === 1 ? existing.steps[0] : undefined;
  if (
    existing.id !== input.eventId ||
    existing.knowledgeSpaceId !== input.knowledgeSpaceId ||
    existing.tenantId !== input.tenantId ||
    existing.query !== input.query ||
    existing.mode !== input.mode ||
    step?.name !== "query.retrieve" ||
    step.status !== "ok" ||
    step.metadata.actorSubjectId !== input.actorSubjectId ||
    step.metadata.eventId !== input.eventId ||
    step.metadata.retrievalTraceId !== input.retrievalTraceId ||
    step.metadata.finishReason !== "no-retrieval-evidence" ||
    step.metadata.source !== "workflow"
  ) {
    throw new WorkflowFailedRetrievalReplayConflictError(input.eventId);
  }
}

function persistedVerdict(failedQuery: FailedQuery): WorkflowFailedRetrievalVerdict | null {
  const triage = failedQuery.metadata.triage;
  if (!triage || typeof triage !== "object" || Array.isArray(triage)) return null;
  const verdict = (triage as Readonly<Record<string, unknown>>).verdict;
  return verdict === "coverage-gap" ||
    verdict === "irrelevant" ||
    verdict === "retrieval-miss" ||
    verdict === "uncertain"
    ? verdict
    : null;
}
