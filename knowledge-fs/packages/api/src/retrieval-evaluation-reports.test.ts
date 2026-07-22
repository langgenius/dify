import { describe, expect, it } from "vitest";

import {
  advancedRetrievalEvaluationReportFromItems,
  cloneRetrievalEvaluationReport,
  emptyAdvancedRetrievalEvaluationReport,
  emptyRetrievalEvaluationReport,
  retrievalEvaluationDelta,
  retrievalEvaluationReportFromItems,
  zeroRetrievalEvaluationDelta,
} from "./retrieval-evaluation-reports";

const cursor = { createdAt: "2026-05-14T00:00:00.000Z", id: "question-2" };

describe("retrieval evaluation reports", () => {
  it("builds retrieval evaluation metrics and clone-isolated items", () => {
    const report = retrievalEvaluationReportFromItems(
      [
        {
          citationEvidenceIds: ["doc-1"],
          expectedEvidenceIds: ["node-1"],
          goldenQuestionId: "q1",
          matchedCitationIds: ["doc-1"],
          matchedEvidenceIds: ["node-1"],
          question: "Question 1",
          retrievedEvidenceIds: ["node-1"],
          status: "hit",
          tags: ["tag-a"],
        },
        {
          citationEvidenceIds: [],
          expectedEvidenceIds: ["node-2"],
          goldenQuestionId: "q2",
          matchedCitationIds: [],
          matchedEvidenceIds: [],
          question: "Question 2",
          retrievedEvidenceIds: [],
          status: "no-answer",
          tags: [],
        },
      ],
      cursor,
    );

    expect(report.metrics).toEqual({
      citationHitRate: 0.5,
      noAnswerRate: 0.5,
      recallAtK: 0.5,
      totalQuestions: 2,
    });
    expect(report.nextCursor).toEqual(cursor);
    (report.items[0]?.tags as string[] | undefined)?.push("mutated");
    expect(cloneRetrievalEvaluationReport(report).items[0]?.tags).toEqual(["tag-a", "mutated"]);
  });

  it("builds empty and advanced reports", () => {
    expect(emptyRetrievalEvaluationReport(cursor)).toEqual({
      items: [],
      metrics: { citationHitRate: 0, noAnswerRate: 0, recallAtK: 0, totalQuestions: 0 },
      nextCursor: cursor,
    });
    expect(emptyAdvancedRetrievalEvaluationReport().metrics).toEqual({
      citationAccuracy: 0,
      citationHitRate: 0,
      contextPrecision: 0,
      faithfulnessScore: 0,
      noAnswerRate: 0,
      recallAtK: 0,
      relevanceScore: 0,
      totalQuestions: 0,
    });

    const advanced = advancedRetrievalEvaluationReportFromItems([
      {
        citationAccuracy: 0.8,
        citationEvidenceIds: ["doc-1"],
        contextPrecision: 0.5,
        expectedEvidenceIds: ["node-1"],
        faithfulnessScore: 0.7,
        goldenQuestionId: "q1",
        judgedRelevantEvidenceIds: ["node-1"],
        matchedCitationIds: ["doc-1"],
        matchedEvidenceIds: ["node-1"],
        question: "Question 1",
        relevanceScore: 0.9,
        retrievedEvidenceIds: ["node-1", "node-2"],
        status: "hit",
        tags: ["tag-a"],
      },
    ]);

    expect(advanced.metrics).toEqual({
      citationAccuracy: 0.8,
      citationHitRate: 1,
      contextPrecision: 0.5,
      faithfulnessScore: 0.7,
      noAnswerRate: 0,
      recallAtK: 1,
      relevanceScore: 0.9,
      totalQuestions: 1,
    });
    (advanced.items[0]?.judgedRelevantEvidenceIds as string[] | undefined)?.push("mutated");
    expect(
      advancedRetrievalEvaluationReportFromItems(advanced.items).items[0]
        ?.judgedRelevantEvidenceIds,
    ).toEqual(["node-1", "mutated"]);
  });

  it("computes evaluation deltas", () => {
    expect(
      retrievalEvaluationDelta(
        { citationHitRate: 0.8, noAnswerRate: 0.1, recallAtK: 0.9, totalQuestions: 10 },
        { citationHitRate: 0.5, noAnswerRate: 0.2, recallAtK: 0.4, totalQuestions: 10 },
      ),
    ).toEqual({ citationHitRate: 0.30000000000000004, noAnswerRate: -0.1, recallAtK: 0.5 });
    expect(zeroRetrievalEvaluationDelta()).toEqual({
      citationHitRate: 0,
      noAnswerRate: 0,
      recallAtK: 0,
    });
  });
});
