import { describe, expect, it, vi } from "vitest";

import { createApiKnowledgeFsOperationalMetrics } from "./operational-metrics";

describe("API KnowledgeFS operational metrics", () => {
  it("emits only sanitized, aggregation-ready capability and upload events", () => {
    const emit = vi.fn();
    const metrics = createApiKnowledgeFsOperationalMetrics({ emit });

    metrics.capabilityV2.record({
      action: "knowledge_spaces.read",
      callerKind: "interactive",
      outcome: "failure",
      reason: "ACTION_MISMATCH",
      stage: "guard",
    });
    metrics.uploadSessions.record({ bytes: 4_096, mode: "single", status: "completed" });
    metrics.retrieval.record({
      candidateCount: 8,
      filteredCount: 3,
      mode: "auto",
      rerankMs: 12,
      resolvedMode: "deep",
      resultCount: 5,
      zeroResult: false,
    });
    metrics.durableTasks.record({
      lifecycle: "terminal",
      outcome: "completed",
      taskKind: "research",
    });
    metrics.legacyAuthorization.record({
      method: "GET",
      routeKind: "access_policy",
    });

    expect(emit.mock.calls.map((call) => call[0])).toEqual([
      {
        action: "knowledge_spaces.read",
        callerKind: "interactive",
        event: "knowledge_fs.capability_v2.metric",
        outcome: "failure",
        reason: "ACTION_MISMATCH",
        stage: "guard",
      },
      {
        bytes: 4_096,
        event: "knowledge_fs.upload_session.metric",
        mode: "single",
        status: "completed",
      },
      {
        candidateCount: 8,
        event: "knowledge_fs.retrieval.metric",
        filteredCount: 3,
        mode: "auto",
        rerankMs: 12,
        resolvedMode: "deep",
        resultCount: 5,
        zeroResult: false,
      },
      {
        event: "knowledge_fs.durable_task.metric",
        lifecycle: "terminal",
        outcome: "completed",
        taskKind: "research",
      },
      {
        event: "knowledge_fs.legacy_authorization.metric",
        method: "GET",
        routeKind: "access_policy",
      },
    ]);
    const serialized = JSON.stringify(emit.mock.calls);
    for (const forbidden of ["token", "jti", "tenantId", "knowledgeSpaceId", "objectKey", "url"])
      expect(serialized).not.toContain(forbidden);
  });

  it("never lets a structured metric sink failure reach product code", () => {
    const metrics = createApiKnowledgeFsOperationalMetrics({
      emit: () => {
        throw new Error("stdout unavailable");
      },
    });

    expect(() =>
      metrics.uploadSessions.record({ bytes: 1, mode: "small_fallback", status: "created" }),
    ).not.toThrow();
    expect(() =>
      metrics.durableTasks.record({ lifecycle: "retry", taskKind: "document_compilation" }),
    ).not.toThrow();
  });

  it("absorbs rejected structured metric sink promises", async () => {
    const metrics = createApiKnowledgeFsOperationalMetrics({
      emit: async () => {
        throw new Error("collector unavailable");
      },
    });

    metrics.durableTasks.record({ lifecycle: "retry", taskKind: "research" });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
});
