type AbRetrievalStrategyWinner = "baseline" | "challenger" | "tie";

export interface RetrievalEvaluationMetricsShape {
  readonly citationHitRate: number;
  readonly noAnswerRate: number;
  readonly recallAtK: number;
}

export interface AbRetrievalStrategyShape {
  readonly name: string;
  readonly retriever: unknown;
}

export function validateRetrievalEvaluationBounds({
  limit,
  maxQuestions,
  maxTopK,
  topK,
}: {
  readonly limit: number;
  readonly maxQuestions: number;
  readonly maxTopK: number;
  readonly topK: number;
}): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Retrieval evaluation question limit must be at least 1");
  }

  if (limit > maxQuestions) {
    throw new Error(`Retrieval evaluation question limit exceeds maxQuestions=${maxQuestions}`);
  }

  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error("Retrieval evaluation topK must be at least 1");
  }

  if (topK > maxTopK) {
    throw new Error(`Retrieval evaluation topK exceeds maxTopK=${maxTopK}`);
  }
}

export function validateRetrievalEvaluationRunnerOptions({
  embeddingModel,
  maxQuestions,
  maxTopK,
}: {
  readonly embeddingModel: string;
  readonly maxQuestions: number;
  readonly maxTopK: number;
}): void {
  if (!Number.isInteger(maxQuestions) || maxQuestions < 1) {
    throw new Error("Retrieval evaluation maxQuestions must be at least 1");
  }

  if (!Number.isInteger(maxTopK) || maxTopK < 1) {
    throw new Error("Retrieval evaluation maxTopK must be at least 1");
  }

  if (embeddingModel.trim().length === 0) {
    throw new Error("Retrieval evaluation embeddingModel must not be empty");
  }
}

export function validateAbRetrievalStrategies<T extends AbRetrievalStrategyShape>(
  strategies: readonly T[],
): readonly [T, T] {
  if (strategies.length !== 2) {
    throw new Error("A/B retrieval strategy comparison requires exactly two strategies");
  }

  const normalized = strategies.map((strategy) => ({
    ...strategy,
    name: strategy.name.trim(),
  }));

  for (const strategy of normalized) {
    if (!strategy.name) {
      throw new Error("A/B retrieval strategy comparison strategy name is required");
    }

    if (strategy.name.length > 80) {
      throw new Error("A/B retrieval strategy comparison strategy name must be at most 80 chars");
    }
  }

  if (normalized[0]?.name === normalized[1]?.name) {
    throw new Error("A/B retrieval strategy comparison strategy names must be unique");
  }

  return [normalized[0] as T, normalized[1] as T];
}

export function abRetrievalWinner(
  baseline: RetrievalEvaluationMetricsShape,
  challenger: RetrievalEvaluationMetricsShape,
): AbRetrievalStrategyWinner {
  const compared =
    compareMetric(challenger.recallAtK, baseline.recallAtK) ||
    compareMetric(challenger.citationHitRate, baseline.citationHitRate) ||
    compareMetric(baseline.noAnswerRate, challenger.noAnswerRate);

  return compared > 0 ? "challenger" : compared < 0 ? "baseline" : "tie";
}

export function validatePositiveIntegerBound(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
}

export function validateZeroToOne(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
}

function compareMetric(left: number, right: number): number {
  const delta = left - right;
  if (Math.abs(delta) < 0.000_001) {
    return 0;
  }
  return delta > 0 ? 1 : -1;
}
