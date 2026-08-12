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
      'id: 7\nevent: research_task.progress\ndata: {"createdAt":"2026-05-13T00:00:00.000Z","id":"event-1","payload":{"stageLabel":"Planning"},"researchTaskJobId":"job-1","sequence":7,"stage":"planning","type":"research_task.stage_changed"}\n\n',
    );
  });

  it("names Research answer deltas consistently with direct query streams", () => {
    expect(
      formatResearchTaskProgressSseEvent({
        createdAt: "2026-05-13T00:00:01.000Z",
        id: "event-answer-1",
        knowledgeSpaceId: "ks-1",
        payload: { delta: "hello", executionAttempt: 1, offset: 0 },
        researchTaskJobId: "job-1",
        sequence: 8,
        stage: "generating",
        tenantId: "tenant-1",
        type: "research_task.answer_delta",
      }),
    ).toBe(
      'id: 8\nevent: answer.delta\ndata: {"createdAt":"2026-05-13T00:00:01.000Z","id":"event-answer-1","payload":{"delta":"hello","executionAttempt":1,"offset":0},"researchTaskJobId":"job-1","sequence":8,"stage":"generating","type":"research_task.answer_delta"}\n\n',
    );
  });

  it("normalizes durable Research terminal stages for direct clients", () => {
    expect(
      formatResearchTaskProgressSseEvent({
        createdAt: "2026-05-13T00:00:00.000Z",
        id: "event-2",
        knowledgeSpaceId: "ks-1",
        payload: {},
        researchTaskJobId: "job-1",
        sequence: 8,
        stage: "completed",
        tenantId: "tenant-1",
        type: "research_task.stage_changed",
      }),
    ).toContain("event: completed\n");
  });

  it("replaces raw Research failure diagnostics with the common public failure", () => {
    const event = formatResearchTaskProgressSseEvent({
      createdAt: "2026-05-13T00:00:00.000Z",
      id: "event-failed",
      knowledgeSpaceId: "ks-1",
      payload: { error: "Authorization: Bearer credential-secret" },
      researchTaskJobId: "job-failed",
      sequence: 9,
      stage: "failed",
      tenantId: "tenant-1",
      type: "research_task.failed",
    });

    expect(event).toContain('"error":"RESEARCH_TASK_FAILED"');
    expect(event).toContain('"failure":{"action":"contact_admin"');
    expect(event).not.toContain("credential-secret");
  });

  it("removes retry diagnostics from non-terminal Research progress", () => {
    const event = formatResearchTaskProgressSseEvent({
      createdAt: "2026-05-13T00:00:00.000Z",
      id: "event-retry",
      knowledgeSpaceId: "ks-1",
      payload: {
        error: "Authorization: Bearer credential-secret",
        retryAt: 2_000,
        retryScheduled: true,
      },
      researchTaskJobId: "job-retry",
      sequence: 10,
      stage: "retrieving",
      tenantId: "tenant-1",
      type: "research_task.stage_changed",
    });

    expect(event).toContain('"retryScheduled":true');
    expect(event).not.toContain("credential-secret");
    expect(event).not.toContain('"error"');
  });

  it("uses the common event formatter for error frames", () => {
    expect(formatSseEvent("answer.error", { error: "Query generation failed", traceId: "t" })).toBe(
      'event: answer.error\ndata: {"error":"Query generation failed","traceId":"t"}\n\n',
    );
  });
});
