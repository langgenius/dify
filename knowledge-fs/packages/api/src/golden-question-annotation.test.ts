import { describe, expect, it } from "vitest";

import { annotatedGoldenQuestionMetadata } from "./golden-question-annotation";

const SUBJECT = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "subject-1",
  tenantId: "tenant-1",
};

describe("golden-question-annotation", () => {
  it("appends clone-isolated annotation metadata with summary counts", () => {
    const question = {
      id: "question-1",
      expectedEvidenceIds: [],
      knowledgeSpaceId: "space-1",
      metadata: {
        annotations: [{ annotatedAt: "old" }],
        preserved: { nested: true },
      },
      question: "What changed?",
      tags: [],
    };

    const metadata = annotatedGoldenQuestionMetadata({
      annotatedAt: "2026-05-15T00:00:00.000Z",
      input: {
        answerCorrectness: "partially-correct",
        evidenceRelevance: [
          { evidenceId: "node-1", relevant: true },
          { evidenceId: "node-2", note: "stale", relevant: false },
        ],
        note: "needs better citation",
      },
      question,
      subject: SUBJECT,
    });

    expect(metadata.annotationSummary).toEqual({
      irrelevantEvidenceCount: 1,
      latestAnswerCorrectness: "partially-correct",
      relevantEvidenceCount: 1,
      totalAnnotations: 2,
    });
    expect(metadata.annotations).toHaveLength(2);
    expect(metadata.annotations).not.toBe(question.metadata.annotations);
    expect(metadata.preserved).toEqual({ nested: true });
  });

  it("retains only the latest bounded annotation window", () => {
    const question = {
      id: "question-1",
      expectedEvidenceIds: [],
      knowledgeSpaceId: "space-1",
      metadata: {
        annotations: Array.from({ length: 60 }, (_, index) => ({ index })),
      },
      question: "What changed?",
      tags: [],
    };

    const metadata = annotatedGoldenQuestionMetadata({
      annotatedAt: "2026-05-15T00:00:00.000Z",
      input: {
        answerCorrectness: "correct",
        evidenceRelevance: [],
      },
      question,
      subject: SUBJECT,
    });

    const annotations = metadata.annotations;

    if (!Array.isArray(annotations)) {
      throw new Error("Expected annotations to be an array");
    }

    expect(annotations).toHaveLength(50);
    expect(annotations[0]).toEqual({ index: 11 });
    expect(metadata.annotationSummary).toMatchObject({ totalAnnotations: 50 });
  });
});
