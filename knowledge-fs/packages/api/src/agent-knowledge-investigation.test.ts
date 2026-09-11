import { describe, expect, it, vi } from "vitest";
import {
  AgentInvestigationConflictError,
  type AgentKnowledgeAssessment,
  createAgentKnowledgeInvestigationService,
} from "./agent-knowledge-investigation";
import { createAnswerTraceRecorder } from "./answer-trace-recorder";
import { createInMemoryAnswerTraceRepository } from "./answer-trace-repository";
import { createInMemoryFailedQueryRepository } from "./failed-query-repository";
import type { QualityControlRepository } from "./quality-control";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function input() {
  return {
    investigationId: id(1),
    knowledgeSpaceId: id(2),
    capabilityGrantId: id(3),
    tenantId: "tenant",
    actorSubjectId: "dify-app:agent",
    candidateGrants: ["tenant:tenant"],
    query: "What is the refund policy and renewal price?",
    answer: "I could not find the information.",
    status: "completed" as const,
    attempts: [4, 5, 6].map((n) => ({
      command_id: id(n),
      control_space_id: id(2),
      command: "search" as const,
      query: n === 6 ? "renewal pricing" : "refund policy",
      path: "",
      outcome: "empty" as const,
      code: null,
      started_at_ms: n,
      elapsed_ms: 10,
      delivered: true,
      evidence: "",
      receipt_ids: [],
      trace_id: null,
      authorization_fingerprint: "a".repeat(64),
    })),
  };
}
function setup(assessment: AgentKnowledgeAssessment) {
  const answerTraces = createInMemoryAnswerTraceRepository({ maxSteps: 100, maxTraces: 100 });
  const failedQueries = createInMemoryFailedQueryRepository({ maxFailedQueries: 100 });
  const triage = { triage: vi.fn(async () => assessment) };
  const cases = new Map();
  const createBadCase = vi.fn<QualityControlRepository["createBadCase"]>(async (value) => {
    const record = {
      ...value,
      id: value.id ?? id(90),
      revision: 1,
      status: "open" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };
    cases.set(record.id, record);
    return record;
  });
  const service = createAgentKnowledgeInvestigationService({
    answerTraces,
    failedQueries,
    triage,
    answerTraceRecorder: createAnswerTraceRecorder({ repository: answerTraces }),
    qualityControl: { createBadCase },
  });
  return { service, triage, answerTraces, failedQueries, createBadCase, cases };
}

describe("Agent investigation quality", () => {
  it("keeps rewrites and recovered misses in one trace without failed queries", async () => {
    const runtime = setup({ outcome: "resolved", issues: [] });
    const request = input();
    const lastAttempt = request.attempts[2];
    if (!lastAttempt) throw new Error("missing fixture");
    const result = await runtime.service.capture({
      ...request,
      attempts: [
        ...request.attempts,
        {
          ...lastAttempt,
          command_id: id(7),
          command: "open",
          outcome: "evidence",
          evidence: "Refunds within 30 days. Renewal costs $10.",
        },
      ],
    });
    expect(result.records).toEqual([]);
    expect(runtime.triage.triage).toHaveBeenCalledTimes(1);
    expect(runtime.createBadCase).not.toHaveBeenCalled();
    const trace = await runtime.answerTraces.get({ id: id(1), knowledgeSpaceId: id(2) });
    expect(trace?.steps[0]?.metadata.attempts).toHaveLength(4);
    // Final answers can contain other spaces' evidence; do not republish them into this space.
    expect(trace?.steps[0]?.metadata).not.toHaveProperty("answer");
    expect(JSON.stringify(trace)).not.toContain("Refunds within 30 days");
    expect(JSON.stringify(trace)).not.toContain("authorization_fingerprint");
  });

  it("keeps separate unanswered subquestions and creates cases only for retrieval misses", async () => {
    const runtime = setup({
      outcome: "unresolved",
      issues: [
        { commandId: id(4), query: "refund policy", verdict: "retrieval-miss" },
        { commandId: id(6), query: "renewal pricing", verdict: "coverage-gap" },
      ],
    });
    const first = await runtime.service.capture(input());
    const retry = await runtime.service.capture({ ...input(), capabilityGrantId: id(9) });
    expect(retry).toEqual(first);
    expect(first.records).toHaveLength(2);
    expect(runtime.cases.size).toBe(1);
    expect(runtime.triage.triage).toHaveBeenCalledTimes(1);
    const query = await runtime.failedQueries.get({
      id: first.records[0]?.failedQueryId ?? "missing",
      knowledgeSpaceId: id(2),
      tenantId: "tenant",
      subjectId: "dify-app:agent",
      candidateGrants: ["tenant:tenant"],
    });
    expect(query?.metadata.source).toBe("agent");
    expect(query?.metadata).not.toHaveProperty("workflowCapture");
  });

  it.each(["errors", "interrupted", "not-delivered", "directory", "image-only"])(
    "does not classify %s as a knowledge failure",
    async (kind) => {
      const runtime = setup({ outcome: "unresolved", issues: [] });
      const request = input();
      await runtime.service.capture({
        ...request,
        status: kind === "interrupted" ? "interrupted" : "completed",
        query: kind === "image-only" ? "" : request.query,
        attempts: request.attempts.map((a) => ({
          ...a,
          outcome: kind === "errors" ? "error" : a.outcome,
          delivered: kind !== "not-delivered",
          command: kind === "directory" ? "ls" : a.command,
        })),
      });
      expect(runtime.triage.triage).not.toHaveBeenCalled();
      expect(runtime.createBadCase).not.toHaveBeenCalled();
    },
  );

  it("rejects invented anchors and collapses duplicate anchors", async () => {
    const runtime = setup({
      outcome: "unresolved",
      issues: [
        { commandId: id(77), query: "invented", verdict: "retrieval-miss" },
        { commandId: id(4), query: "refund", verdict: "retrieval-miss" },
        { commandId: id(4), query: "refund rewrite", verdict: "retrieval-miss" },
      ],
    });
    expect((await runtime.service.capture(input())).records).toHaveLength(1);
  });

  it("resumes after a projection failure without repeating classification", async () => {
    const runtime = setup({
      outcome: "unresolved",
      issues: [{ commandId: id(4), query: "refund", verdict: "retrieval-miss" }],
    });
    runtime.createBadCase.mockRejectedValueOnce(new Error("database offline"));
    await expect(runtime.service.capture(input())).rejects.toThrow("database offline");
    expect((await runtime.service.capture(input())).records[0]?.badCaseId).toBeTruthy();
    expect(runtime.triage.triage).toHaveBeenCalledTimes(1);
  });

  it("rejects changed content or actor under an already committed investigation ID", async () => {
    const runtime = setup({ outcome: "resolved", issues: [] });
    await runtime.service.capture(input());
    await expect(
      runtime.service.capture({ ...input(), query: "different" }),
    ).rejects.toBeInstanceOf(AgentInvestigationConflictError);
    await expect(
      runtime.service.capture({ ...input(), actorSubjectId: "other" }),
    ).rejects.toBeInstanceOf(AgentInvestigationConflictError);
  });
});
