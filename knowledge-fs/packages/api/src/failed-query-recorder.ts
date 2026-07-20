import type { FailedQuery } from "@knowledge/core";

import type {
  FailedQueryPermissionBinding,
  FailedQueryRepository,
} from "./failed-query-repository";

export interface RecordFailedQueryInput {
  readonly answerTraceId?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly mode: FailedQuery["mode"];
  readonly permission: FailedQueryPermissionBinding;
  readonly query: string;
  readonly tenantId: string;
  readonly trigger: FailedQuery["trigger"];
}

export interface FailedQueryRecorder {
  record(input: RecordFailedQueryInput): Promise<FailedQuery>;
}

export interface FailedQueryRecorderOptions {
  readonly repository: FailedQueryRepository;
}

/**
 * Persists a failed query (an empty/abstained answer for an in-scope-looking query) as
 * `pending-triage`. Kept off the query hot path — the caller records after the answer has streamed.
 */
export function createFailedQueryRecorder({
  repository,
}: FailedQueryRecorderOptions): FailedQueryRecorder {
  return {
    record: (input) =>
      repository.create({
        ...(input.answerTraceId ? { answerTraceId: input.answerTraceId } : {}),
        knowledgeSpaceId: input.knowledgeSpaceId,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        mode: input.mode,
        permission: input.permission,
        query: input.query,
        status: "pending-triage",
        trigger: input.trigger,
        tenantId: input.tenantId,
      }),
  };
}

export interface FailedQueryTriggerInput {
  readonly finishReason: string | undefined;
  /** When set, a `retrieval-evidence` answer whose top score is below this floor is low-confidence. */
  readonly lowConfidenceScoreFloor?: number | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Maps a query generator's done event to a failed-query trigger, or `null` when the query was
 * answered with sufficient evidence. Empty retrieval is always captured; a low-confidence answer
 * (top retrieval score below an opt-in floor) is captured only when the floor is configured.
 */
export function failedQueryTrigger(input: FailedQueryTriggerInput): FailedQuery["trigger"] | null {
  if (input.finishReason === "no-retrieval-evidence") {
    return "no-retrieval-evidence";
  }

  if (input.finishReason === "retrieval-evidence" && input.lowConfidenceScoreFloor !== undefined) {
    const topScore = readTopScore(input.metadata);

    if (topScore !== undefined && topScore < input.lowConfidenceScoreFloor) {
      return "low-confidence";
    }
  }

  return null;
}

export function readTopScore(metadata: Record<string, unknown> | undefined): number | undefined {
  const value = metadata?.topScore;

  return typeof value === "number" ? value : undefined;
}
