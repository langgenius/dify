import { knowledgeFsFailureForCode } from "./knowledge-fs-errors";
import type { ResearchTaskProgressEvent } from "./research-task-progress";

export type QuerySseEvent =
  | {
      readonly delta: string;
      readonly type: "delta";
    }
  | {
      readonly finishReason: string;
      readonly metadata?: Record<string, unknown> | undefined;
      readonly type: "done";
    };

export function formatQuerySseEvent(event: QuerySseEvent, traceId: string): string {
  if (event.type === "delta") {
    return formatSseEvent("answer.delta", {
      delta: event.delta,
      traceId,
    });
  }

  return formatSseEvent("answer.done", {
    finishReason: event.finishReason,
    ...(event.metadata ? { metadata: event.metadata } : {}),
    traceId,
  });
}

export function formatResearchTaskProgressSseEvent(event: ResearchTaskProgressEvent): string {
  const eventName = researchTaskSseEventName(event);
  const payload = publicResearchTaskProgressPayload(event);
  return `id: ${event.sequence}\n${formatSseEvent(eventName, {
    createdAt: event.createdAt,
    id: event.id,
    payload,
    researchTaskJobId: event.researchTaskJobId,
    sequence: event.sequence,
    stage: event.stage,
    type: event.type,
  })}`;
}

function publicResearchTaskProgressPayload(
  event: ResearchTaskProgressEvent,
): Record<string, unknown> {
  if (event.type !== "research_task.failed") {
    const { error: _diagnosticError, ...safePayload } = event.payload;
    return safePayload;
  }
  const rawCode = event.payload.error;
  const code =
    typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{1,127}$/u.test(rawCode)
      ? rawCode
      : "RESEARCH_TASK_FAILED";
  const failure = knowledgeFsFailureForCode(code, {
    stage: event.stage,
    traceId: event.researchTaskJobId,
  });
  return { error: failure.code, failure };
}

export function isResearchTaskTerminalProgressEvent(event: ResearchTaskProgressEvent): boolean {
  return event.stage === "completed" || event.stage === "failed" || event.stage === "canceled";
}

function researchTaskSseEventName(event: ResearchTaskProgressEvent): string {
  if (event.stage === "completed") return "completed";
  if (event.stage === "failed") return "failed";
  if (event.stage === "canceled") return "cancelled";
  if (event.type === "research_task.answer_delta") return "answer.delta";
  return "research_task.progress";
}

export function formatSseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
