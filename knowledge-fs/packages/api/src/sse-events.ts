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
  return formatSseEvent("research_task.progress", {
    createdAt: event.createdAt,
    id: event.id,
    payload: event.payload,
    researchTaskJobId: event.researchTaskJobId,
    sequence: event.sequence,
    stage: event.stage,
    type: event.type,
  });
}

export function formatSseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
