import type { GoldenQuestionCursor } from "./golden-question-repository";

export type RetrievalEvaluationItemStatus = "hit" | "miss" | "no-answer";

export interface RetrievalEvaluationItem {
  readonly citationEvidenceIds: readonly string[];
  readonly expectedEvidenceIds: readonly string[];
  readonly goldenQuestionId: string;
  readonly matchedCitationIds: readonly string[];
  readonly matchedEvidenceIds: readonly string[];
  readonly question: string;
  readonly retrievedEvidenceIds: readonly string[];
  readonly status: RetrievalEvaluationItemStatus;
  readonly tags: readonly string[];
}

export interface RetrievalEvaluationMetrics {
  readonly citationHitRate: number;
  readonly noAnswerRate: number;
  readonly recallAtK: number;
  readonly totalQuestions: number;
}

export interface RetrievalEvaluationReport {
  readonly items: readonly RetrievalEvaluationItem[];
  readonly metrics: RetrievalEvaluationMetrics;
  readonly nextCursor?: GoldenQuestionCursor | undefined;
}

export interface AdvancedRetrievalEvaluationItem extends RetrievalEvaluationItem {
  readonly citationAccuracy: number;
  readonly contextPrecision: number;
  readonly faithfulnessScore: number;
  readonly judgedRelevantEvidenceIds: readonly string[];
  readonly relevanceScore: number;
}

export interface AdvancedRetrievalEvaluationMetrics extends RetrievalEvaluationMetrics {
  readonly citationAccuracy: number;
  readonly contextPrecision: number;
  readonly faithfulnessScore: number;
  readonly relevanceScore: number;
}

export interface AdvancedRetrievalEvaluationReport {
  readonly items: readonly AdvancedRetrievalEvaluationItem[];
  readonly metrics: AdvancedRetrievalEvaluationMetrics;
  readonly nextCursor?: GoldenQuestionCursor | undefined;
}

export interface RetrievalEvaluationMetricDelta {
  readonly citationHitRate: number;
  readonly noAnswerRate: number;
  readonly recallAtK: number;
}

export function retrievalEvaluationReportFromItems(
  items: readonly RetrievalEvaluationItem[],
  nextCursor?: GoldenQuestionCursor | undefined,
): RetrievalEvaluationReport {
  if (items.length === 0) {
    return emptyRetrievalEvaluationReport(nextCursor);
  }

  const totalQuestions = items.length;
  const recallHits = items.filter((item) => item.matchedEvidenceIds.length > 0).length;
  const citationHits = items.filter((item) => item.matchedCitationIds.length > 0).length;
  const noAnswers = items.filter((item) => item.status === "no-answer").length;

  return {
    items: items.map((item) => cloneRetrievalEvaluationItem(item)),
    metrics: {
      citationHitRate: citationHits / totalQuestions,
      noAnswerRate: noAnswers / totalQuestions,
      recallAtK: recallHits / totalQuestions,
      totalQuestions,
    },
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function emptyRetrievalEvaluationReport(
  nextCursor?: GoldenQuestionCursor | undefined,
): RetrievalEvaluationReport {
  return {
    items: [],
    metrics: {
      citationHitRate: 0,
      noAnswerRate: 0,
      recallAtK: 0,
      totalQuestions: 0,
    },
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function advancedRetrievalEvaluationReportFromItems(
  items: readonly AdvancedRetrievalEvaluationItem[],
  nextCursor?: GoldenQuestionCursor | undefined,
): AdvancedRetrievalEvaluationReport {
  if (items.length === 0) {
    return emptyAdvancedRetrievalEvaluationReport(nextCursor);
  }

  const baseReport = retrievalEvaluationReportFromItems(items, nextCursor);
  const totalQuestions = items.length;

  return {
    items: items.map((item) => cloneAdvancedRetrievalEvaluationItem(item)),
    metrics: {
      ...baseReport.metrics,
      citationAccuracy:
        items.reduce((total, item) => total + item.citationAccuracy, 0) / totalQuestions,
      contextPrecision:
        items.reduce((total, item) => total + item.contextPrecision, 0) / totalQuestions,
      faithfulnessScore:
        items.reduce((total, item) => total + item.faithfulnessScore, 0) / totalQuestions,
      relevanceScore:
        items.reduce((total, item) => total + item.relevanceScore, 0) / totalQuestions,
    },
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function emptyAdvancedRetrievalEvaluationReport(
  nextCursor?: GoldenQuestionCursor | undefined,
): AdvancedRetrievalEvaluationReport {
  return {
    items: [],
    metrics: {
      citationAccuracy: 0,
      citationHitRate: 0,
      contextPrecision: 0,
      faithfulnessScore: 0,
      noAnswerRate: 0,
      recallAtK: 0,
      relevanceScore: 0,
      totalQuestions: 0,
    },
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function cloneRetrievalEvaluationItem(
  item: RetrievalEvaluationItem,
): RetrievalEvaluationItem {
  return {
    citationEvidenceIds: [...item.citationEvidenceIds],
    expectedEvidenceIds: [...item.expectedEvidenceIds],
    goldenQuestionId: item.goldenQuestionId,
    matchedCitationIds: [...item.matchedCitationIds],
    matchedEvidenceIds: [...item.matchedEvidenceIds],
    question: item.question,
    retrievedEvidenceIds: [...item.retrievedEvidenceIds],
    status: item.status,
    tags: [...item.tags],
  };
}

export function cloneAdvancedRetrievalEvaluationItem(
  item: AdvancedRetrievalEvaluationItem,
): AdvancedRetrievalEvaluationItem {
  return {
    ...cloneRetrievalEvaluationItem(item),
    citationAccuracy: item.citationAccuracy,
    contextPrecision: item.contextPrecision,
    faithfulnessScore: item.faithfulnessScore,
    judgedRelevantEvidenceIds: [...item.judgedRelevantEvidenceIds],
    relevanceScore: item.relevanceScore,
  };
}

export function cloneRetrievalEvaluationReport(
  report: RetrievalEvaluationReport,
): RetrievalEvaluationReport {
  return {
    items: report.items.map((item) => cloneRetrievalEvaluationItem(item)),
    metrics: { ...report.metrics },
    ...(report.nextCursor ? { nextCursor: { ...report.nextCursor } } : {}),
  };
}

export function retrievalEvaluationDelta(
  left: RetrievalEvaluationMetrics,
  right: RetrievalEvaluationMetrics,
): RetrievalEvaluationMetricDelta {
  return {
    citationHitRate: left.citationHitRate - right.citationHitRate,
    noAnswerRate: left.noAnswerRate - right.noAnswerRate,
    recallAtK: left.recallAtK - right.recallAtK,
  };
}

export function zeroRetrievalEvaluationDelta(): RetrievalEvaluationMetricDelta {
  return {
    citationHitRate: 0,
    noAnswerRate: 0,
    recallAtK: 0,
  };
}
