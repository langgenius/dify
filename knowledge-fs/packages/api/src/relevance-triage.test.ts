import { describe, expect, it } from "vitest";

import { createInMemoryFailedQueryRepository } from "./failed-query-repository";
import {
  type RelevanceTriageSignals,
  createFailedQueryTriageRunner,
  createRelevanceTriage,
  statusForVerdict,
} from "./relevance-triage";

const KS = "10000000-0000-4000-8000-000000000001";
const TRIAGE_SCOPE = {
  candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
  subjectId: "editor-1",
  tenantId: "tenant-1",
} as const;
const TRIAGE_PERMISSION = {
  accessChannel: "interactive" as const,
  candidateGrants: TRIAGE_SCOPE.candidateGrants,
  permissionSnapshotId: "10000000-0000-4000-8000-000000000099",
  permissionSnapshotRevision: 1,
  requestedBySubjectId: TRIAGE_SCOPE.subjectId,
};

function signals(overrides: Partial<RelevanceTriageSignals> = {}): RelevanceTriageSignals {
  return {
    answerability: async () => ({ verdict: "retrieval-miss" }),
    graphRelevance: async () => ({ matched: false }),
    summaryRelevance: async () => ({ matched: false }),
    ...overrides,
  };
}

describe("createRelevanceTriage", () => {
  it("returns irrelevant (without calling answerability) when no signal is on-topic", async () => {
    let answerabilityCalls = 0;
    const triage = createRelevanceTriage({
      signals: signals({
        answerability: async () => {
          answerabilityCalls += 1;
          return { verdict: "retrieval-miss" };
        },
        graphRelevance: async () => ({ entityOverlap: 0, matched: false }),
        summaryRelevance: async () => ({ matched: false, score: 0 }),
      }),
    });

    const result = await triage.triage({ knowledgeSpaceId: KS, query: "off topic", tenantId: "t" });
    expect(result.verdict).toBe("irrelevant");
    expect(result.confidence).toBe(1);
    expect(answerabilityCalls).toBe(0);
  });

  it("defers to answerability when a relevance signal is on-topic", async () => {
    const triage = createRelevanceTriage({
      signals: signals({
        answerability: async () => ({ confidence: 0.8, verdict: "coverage-gap" }),
        graphRelevance: async () => ({ entityOverlap: 2, matched: true }),
      }),
    });

    const result = await triage.triage({ knowledgeSpaceId: KS, query: "on topic", tenantId: "t" });
    expect(result).toMatchObject({ confidence: 0.8, verdict: "coverage-gap" });
    expect(result.signals.answerability).toEqual({ confidence: 0.8, verdict: "coverage-gap" });
  });

  it("maps verdicts to statuses", () => {
    expect(statusForVerdict("irrelevant")).toBe("dismissed");
    expect(statusForVerdict("retrieval-miss")).toBe("pending-annotation");
    expect(statusForVerdict("coverage-gap")).toBe("pending-annotation");
    expect(statusForVerdict("uncertain")).toBe("pending-annotation");
  });
});

describe("createFailedQueryTriageRunner", () => {
  it("triages pending queries, transitions status, and records the verdict", async () => {
    const failedQueries = createInMemoryFailedQueryRepository({ maxFailedQueries: 10 });
    const onTopic = await failedQueries.create({
      permission: TRIAGE_PERMISSION,
      tenantId: TRIAGE_SCOPE.tenantId,
      knowledgeSpaceId: KS,
      mode: "fast",
      query: "on topic missing",
      trigger: "no-retrieval-evidence",
    });
    const offTopic = await failedQueries.create({
      permission: TRIAGE_PERMISSION,
      tenantId: TRIAGE_SCOPE.tenantId,
      knowledgeSpaceId: KS,
      mode: "fast",
      query: "off topic noise",
      trigger: "no-retrieval-evidence",
    });

    const runner = createFailedQueryTriageRunner({
      failedQueries,
      now: () => "2026-07-06T00:00:00.000Z",
      triage: {
        triage: async (input) =>
          input.query.includes("on topic")
            ? {
                confidence: 0.7,
                signals: { graph: { matched: true }, summary: { matched: true } },
                verdict: "retrieval-miss",
              }
            : {
                confidence: 0.9,
                signals: { graph: { matched: false }, summary: { matched: false } },
                verdict: "irrelevant",
              },
      },
    });

    const result = await runner.run({
      ...TRIAGE_SCOPE,
      knowledgeSpaceId: KS,
      permission: TRIAGE_PERMISSION,
    });
    expect(result.triaged).toBe(2);
    expect(result.verdicts).toMatchObject({ irrelevant: 1, "retrieval-miss": 1 });

    const promoted = await failedQueries.get({
      ...TRIAGE_SCOPE,
      id: onTopic.id,
      knowledgeSpaceId: KS,
    });
    expect(promoted?.status).toBe("pending-annotation");
    expect(promoted?.metadata.triage).toMatchObject({
      verdict: "retrieval-miss",
      triagedAt: "2026-07-06T00:00:00.000Z",
    });

    const dismissed = await failedQueries.get({
      ...TRIAGE_SCOPE,
      id: offTopic.id,
      knowledgeSpaceId: KS,
    });
    expect(dismissed?.status).toBe("dismissed");

    // Nothing left pending; a second run triages nothing.
    const second = await runner.run({
      ...TRIAGE_SCOPE,
      knowledgeSpaceId: KS,
      permission: TRIAGE_PERMISSION,
    });
    expect(second.triaged).toBe(0);
  });
});
