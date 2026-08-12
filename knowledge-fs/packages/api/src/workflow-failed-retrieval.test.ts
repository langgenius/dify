import { describe, expect, it, vi } from "vitest";

import { createAnswerTraceRecorder } from "./answer-trace-recorder";
import { createInMemoryAnswerTraceRepository } from "./answer-trace-repository";
import { createInMemoryFailedQueryRepository } from "./failed-query-repository";
import { createWorkflowFailedRetrievalCaptureService } from "./workflow-failed-retrieval";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "10000000-0000-4000-8000-000000000002";
const FIRST_GRANT_ID = "10000000-0000-4000-8000-000000000003";
const RETRY_GRANT_ID = "10000000-0000-4000-8000-000000000004";

function baseInput(capabilityGrantId = FIRST_GRANT_ID) {
  return {
    actorSubjectId: "dify-app:workflow-app",
    candidateGrants: ["tenant:tenant-1"],
    capabilityGrantId,
    eventId: EVENT_ID,
    knowledgeSpaceId: SPACE_ID,
    mode: "deep" as const,
    query: "发票号码在哪里？",
    retrievalTraceId: "workflow-retrieval-123",
    tenantId: "tenant-1",
  };
}

function setup(verdict: "coverage-gap" | "irrelevant" | "retrieval-miss" | "uncertain") {
  const answerTraces = createInMemoryAnswerTraceRepository({ maxSteps: 10, maxTraces: 10 });
  const failedQueries = createInMemoryFailedQueryRepository({ maxFailedQueries: 10 });
  const triage = { triage: vi.fn(async () => ({ verdict })) };
  const createBadCase = vi.fn(async (input) => ({
    actorSubjectId: input.actorSubjectId,
    createdAt: "2026-08-12T00:00:00.000Z",
    id: input.id ?? EVENT_ID,
    knowledgeSpaceId: input.knowledgeSpaceId,
    reason: input.reason,
    revision: 1,
    status: "open" as const,
    tags: input.tags,
    traceId: input.traceId,
    updatedAt: "2026-08-12T00:00:00.000Z",
  }));
  const service = createWorkflowFailedRetrievalCaptureService({
    answerTraceRecorder: createAnswerTraceRecorder({
      now: () => "2026-08-12T00:00:00.000Z",
      repository: answerTraces,
    }),
    answerTraces,
    failedQueries,
    now: () => "2026-08-12T00:01:00.000Z",
    qualityControl: { createBadCase },
    triage,
  });
  return { answerTraces, createBadCase, failedQueries, service, triage };
}

describe("workflow failed-retrieval capture", () => {
  it("creates one automatic bad case only for retrieval-miss and reuses it across a new grant", async () => {
    const { createBadCase, service, triage } = setup("retrieval-miss");

    await expect(service.capture(baseInput())).resolves.toEqual({
      badCaseId: EVENT_ID,
      failedQueryId: EVENT_ID,
      verdict: "retrieval-miss",
    });
    await expect(service.capture(baseInput(RETRY_GRANT_ID))).resolves.toEqual({
      badCaseId: EVENT_ID,
      failedQueryId: EVENT_ID,
      verdict: "retrieval-miss",
    });
    await expect(
      service.capture({
        ...baseInput(RETRY_GRANT_ID),
        actorSubjectId: "dify-app:different-workflow-app",
      }),
    ).rejects.toThrow("reused with a different payload");

    expect(triage.triage).toHaveBeenCalledTimes(1);
    expect(createBadCase).toHaveBeenCalledTimes(2);
    expect(createBadCase).toHaveBeenLastCalledWith(
      expect.objectContaining({
        capabilityGrantId: RETRY_GRANT_ID,
        id: EVENT_ID,
        reason:
          "Workflow retrieval returned no evidence even though the knowledge base appears to contain relevant answer material.",
        tags: ["workflow", "auto-captured", "retrieval-miss"],
      }),
    );
  });

  it.each(["coverage-gap", "irrelevant", "uncertain"] as const)(
    "records %s without creating a bad case",
    async (verdict) => {
      const { createBadCase, service } = setup(verdict);

      await expect(service.capture(baseInput())).resolves.toEqual({
        failedQueryId: EVENT_ID,
        verdict,
      });
      expect(createBadCase).not.toHaveBeenCalled();
    },
  );
});
