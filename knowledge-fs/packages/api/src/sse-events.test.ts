import { describe, expect, it } from "vitest";

import {
  formatQuerySseEvent,
  formatResearchTaskProgressSseEvent,
  formatSseEvent,
} from "./sse-events";

describe("SSE event formatting", () => {
  it("formats answer delta and done events with trace correlation", () => {
    expect(formatQuerySseEvent({ delta: "hello", type: "delta" }, "trace-1")).toBe(
      'event: answer.delta\ndata: {"delta":"hello","traceId":"trace-1"}\n\n',
    );

    expect(
      formatQuerySseEvent(
        { finishReason: "stop", metadata: { model: "test-model" }, type: "done" },
        "trace-1",
      ),
    ).toBe(
      'event: answer.done\ndata: {"finishReason":"stop","metadata":{"model":"test-model"},"traceId":"trace-1"}\n\n',
    );
  });

  it("formats research progress events without raw credentials or request state", () => {
    expect(
      formatResearchTaskProgressSseEvent({
        createdAt: "2026-05-13T00:00:00.000Z",
        id: "event-1",
        knowledgeSpaceId: "ks-1",
        payload: { stageLabel: "Planning" },
        researchTaskJobId: "job-1",
        sequence: 7,
        stage: "planning",
        tenantId: "tenant-1",
        type: "research_task.stage_changed",
      }),
    ).toBe(
      'event: research_task.progress\ndata: {"createdAt":"2026-05-13T00:00:00.000Z","id":"event-1","payload":{"stageLabel":"Planning"},"researchTaskJobId":"job-1","sequence":7,"stage":"planning","type":"research_task.stage_changed"}\n\n',
    );
  });

  it("uses the common event formatter for error frames", () => {
    expect(formatSseEvent("answer.error", { error: "Query generation failed", traceId: "t" })).toBe(
      'event: answer.error\ndata: {"error":"Query generation failed","traceId":"t"}\n\n',
    );
  });
});
