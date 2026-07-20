import type { AuthSubject } from "@knowledge/core";

import { cloneJsonObject, isPlainObject } from "./json-utils";

const MAX_GOLDEN_QUESTION_ANNOTATIONS = 50;

export type GoldenQuestionAnswerCorrectness =
  | "correct"
  | "incorrect"
  | "not-answerable"
  | "partially-correct";

export interface GoldenQuestionEvidenceRelevanceInput {
  readonly evidenceId: string;
  readonly note?: string | undefined;
  readonly relevant: boolean;
}

export interface AnnotateGoldenQuestionInput {
  readonly answerCorrectness: GoldenQuestionAnswerCorrectness;
  readonly evidenceRelevance: readonly GoldenQuestionEvidenceRelevanceInput[];
  readonly note?: string | undefined;
}

export function annotatedGoldenQuestionMetadata({
  annotatedAt,
  input,
  question,
  subject,
}: {
  readonly annotatedAt: string;
  readonly input: AnnotateGoldenQuestionInput;
  readonly question: { readonly metadata: Record<string, unknown> };
  readonly subject: AuthSubject;
}): Record<string, unknown> {
  const metadata = cloneJsonObject(question.metadata);
  const existingAnnotations = Array.isArray(metadata.annotations)
    ? metadata.annotations.filter(isPlainObject).slice(-(MAX_GOLDEN_QUESTION_ANNOTATIONS - 1))
    : [];
  const evidenceRelevance = input.evidenceRelevance.map((item) => ({
    evidenceId: item.evidenceId,
    ...(item.note ? { note: item.note } : {}),
    relevant: item.relevant,
  }));
  const annotation = {
    annotatedAt,
    annotatedBy: subject.subjectId,
    answerCorrectness: input.answerCorrectness,
    evidenceRelevance,
    ...(input.note ? { note: input.note } : {}),
  };
  const annotations = [...existingAnnotations, annotation];
  const latestRelevantCount = evidenceRelevance.filter((item) => item.relevant).length;

  return {
    ...metadata,
    annotationSummary: {
      irrelevantEvidenceCount: evidenceRelevance.length - latestRelevantCount,
      latestAnswerCorrectness: input.answerCorrectness,
      relevantEvidenceCount: latestRelevantCount,
      totalAnnotations: annotations.length,
    },
    annotations,
  };
}
