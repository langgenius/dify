export interface RetrievalRegressionMetrics {
  readonly citationAccuracy?: number | undefined;
  readonly citationHitRate: number;
  readonly faithfulnessScore?: number | undefined;
  readonly noAnswerRate: number;
  readonly recallAtK: number;
  readonly totalQuestions: number;
}

export interface RetrievalRegressionThresholds {
  readonly maxCitationAccuracyDrop?: number | undefined;
  readonly maxCitationHitRateDrop: number;
  readonly maxFaithfulnessScoreDrop?: number | undefined;
  readonly maxFailures?: number | undefined;
  readonly maxNoAnswerRate: number;
  readonly maxNoAnswerRateIncrease: number;
  readonly maxRecallAtKDrop: number;
  readonly minCitationAccuracy?: number | undefined;
  readonly minCitationHitRate: number;
  readonly minFaithfulnessScore?: number | undefined;
  readonly minQuestions: number;
  readonly minRecallAtK: number;
}

export interface RetrievalRegressionEvaluationInput {
  readonly baseline?: RetrievalRegressionMetrics | undefined;
  readonly current: RetrievalRegressionMetrics;
}

export interface RetrievalRegressionDeltas {
  readonly citationAccuracy?: number | undefined;
  readonly citationHitRate: number;
  readonly faithfulnessScore?: number | undefined;
  readonly noAnswerRate: number;
  readonly recallAtK: number;
}

export interface RetrievalRegressionResult {
  readonly deltas: RetrievalRegressionDeltas;
  readonly failures: readonly string[];
  readonly passed: boolean;
}

export interface RetrievalRegressionGate {
  evaluate(input: RetrievalRegressionEvaluationInput): RetrievalRegressionResult;
}

export function createRetrievalRegressionGate(
  thresholds: RetrievalRegressionThresholds,
): RetrievalRegressionGate {
  validateThresholds(thresholds);
  const maxFailures = thresholds.maxFailures ?? 20;
  const requiresCitationAccuracy =
    thresholds.minCitationAccuracy !== undefined ||
    thresholds.maxCitationAccuracyDrop !== undefined;
  const requiresFaithfulness =
    thresholds.minFaithfulnessScore !== undefined ||
    thresholds.maxFaithfulnessScoreDrop !== undefined;

  return {
    evaluate({ baseline, current }) {
      validateMetrics("current", current);
      requireAdvancedMetric("current", "citationAccuracy", current, requiresCitationAccuracy);
      requireAdvancedMetric("current", "faithfulnessScore", current, requiresFaithfulness);

      if (baseline) {
        validateMetrics("baseline", baseline);
        requireAdvancedMetric("baseline", "citationAccuracy", baseline, requiresCitationAccuracy);
        requireAdvancedMetric("baseline", "faithfulnessScore", baseline, requiresFaithfulness);
      }

      const baseDeltas = {
        citationHitRate: roundMetric(
          current.citationHitRate - (baseline?.citationHitRate ?? current.citationHitRate),
        ),
        noAnswerRate: roundMetric(
          current.noAnswerRate - (baseline?.noAnswerRate ?? current.noAnswerRate),
        ),
        recallAtK: roundMetric(current.recallAtK - (baseline?.recallAtK ?? current.recallAtK)),
      };
      const citationAccuracyDelta = advancedDelta("citationAccuracy", current, baseline);
      const faithfulnessDelta = advancedDelta("faithfulnessScore", current, baseline);
      const deltas: RetrievalRegressionDeltas = {
        ...baseDeltas,
        ...(citationAccuracyDelta !== undefined ? { citationAccuracy: citationAccuracyDelta } : {}),
        ...(faithfulnessDelta !== undefined ? { faithfulnessScore: faithfulnessDelta } : {}),
      };

      const failures: string[] = [];

      if (current.totalQuestions < thresholds.minQuestions) {
        failures.push(
          `totalQuestions ${current.totalQuestions} is below minQuestions ${thresholds.minQuestions}`,
        );
      }

      if (current.recallAtK < thresholds.minRecallAtK) {
        failures.push(
          `recallAtK ${formatMetric(current.recallAtK)} is below minRecallAtK ${formatMetric(
            thresholds.minRecallAtK,
          )}`,
        );
      }

      if (current.citationHitRate < thresholds.minCitationHitRate) {
        failures.push(
          `citationHitRate ${formatMetric(
            current.citationHitRate,
          )} is below minCitationHitRate ${formatMetric(thresholds.minCitationHitRate)}`,
        );
      }

      if (
        thresholds.minCitationAccuracy !== undefined &&
        current.citationAccuracy !== undefined &&
        current.citationAccuracy < thresholds.minCitationAccuracy
      ) {
        failures.push(
          `citationAccuracy ${formatMetric(
            current.citationAccuracy,
          )} is below minCitationAccuracy ${formatMetric(thresholds.minCitationAccuracy)}`,
        );
      }

      if (
        thresholds.minFaithfulnessScore !== undefined &&
        current.faithfulnessScore !== undefined &&
        current.faithfulnessScore < thresholds.minFaithfulnessScore
      ) {
        failures.push(
          `faithfulnessScore ${formatMetric(
            current.faithfulnessScore,
          )} is below minFaithfulnessScore ${formatMetric(thresholds.minFaithfulnessScore)}`,
        );
      }

      if (current.noAnswerRate > thresholds.maxNoAnswerRate) {
        failures.push(
          `noAnswerRate ${formatMetric(current.noAnswerRate)} exceeds maxNoAnswerRate ${formatMetric(
            thresholds.maxNoAnswerRate,
          )}`,
        );
      }

      if (baseline) {
        const recallDrop = baseline.recallAtK - current.recallAtK;

        if (recallDrop > thresholds.maxRecallAtKDrop) {
          failures.push(
            `recallAtK dropped by ${formatMetric(
              recallDrop,
            )} which exceeds maxRecallAtKDrop ${formatMetric(thresholds.maxRecallAtKDrop)}`,
          );
        }

        const citationDrop = baseline.citationHitRate - current.citationHitRate;

        if (citationDrop > thresholds.maxCitationHitRateDrop) {
          failures.push(
            `citationHitRate dropped by ${formatMetric(
              citationDrop,
            )} which exceeds maxCitationHitRateDrop ${formatMetric(
              thresholds.maxCitationHitRateDrop,
            )}`,
          );
        }

        if (
          thresholds.maxCitationAccuracyDrop !== undefined &&
          baseline.citationAccuracy !== undefined &&
          current.citationAccuracy !== undefined
        ) {
          const citationAccuracyDrop = baseline.citationAccuracy - current.citationAccuracy;

          if (citationAccuracyDrop > thresholds.maxCitationAccuracyDrop) {
            failures.push(
              `citationAccuracy dropped by ${formatMetric(
                citationAccuracyDrop,
              )} which exceeds maxCitationAccuracyDrop ${formatMetric(
                thresholds.maxCitationAccuracyDrop,
              )}`,
            );
          }
        }

        if (
          thresholds.maxFaithfulnessScoreDrop !== undefined &&
          baseline.faithfulnessScore !== undefined &&
          current.faithfulnessScore !== undefined
        ) {
          const faithfulnessDrop = baseline.faithfulnessScore - current.faithfulnessScore;

          if (faithfulnessDrop > thresholds.maxFaithfulnessScoreDrop) {
            failures.push(
              `faithfulnessScore dropped by ${formatMetric(
                faithfulnessDrop,
              )} which exceeds maxFaithfulnessScoreDrop ${formatMetric(
                thresholds.maxFaithfulnessScoreDrop,
              )}`,
            );
          }
        }

        const noAnswerIncrease = current.noAnswerRate - baseline.noAnswerRate;

        if (noAnswerIncrease > thresholds.maxNoAnswerRateIncrease) {
          failures.push(
            `noAnswerRate increased by ${formatMetric(
              noAnswerIncrease,
            )} which exceeds maxNoAnswerRateIncrease ${formatMetric(
              thresholds.maxNoAnswerRateIncrease,
            )}`,
          );
        }
      }

      const boundedFailures = failures.slice(0, maxFailures);

      return {
        deltas,
        failures: boundedFailures,
        passed: boundedFailures.length === 0,
      };
    },
  };
}

function validateThresholds(thresholds: RetrievalRegressionThresholds): void {
  validateUnitMetric("minRecallAtK", thresholds.minRecallAtK);
  validateUnitMetric("minCitationHitRate", thresholds.minCitationHitRate);
  validateUnitMetric("maxNoAnswerRate", thresholds.maxNoAnswerRate);
  validateUnitMetric("maxRecallAtKDrop", thresholds.maxRecallAtKDrop);
  validateUnitMetric("maxCitationHitRateDrop", thresholds.maxCitationHitRateDrop);
  validateUnitMetric("maxNoAnswerRateIncrease", thresholds.maxNoAnswerRateIncrease);
  validateOptionalUnitMetric("minCitationAccuracy", thresholds.minCitationAccuracy);
  validateOptionalUnitMetric("minFaithfulnessScore", thresholds.minFaithfulnessScore);
  validateOptionalUnitMetric("maxCitationAccuracyDrop", thresholds.maxCitationAccuracyDrop);
  validateOptionalUnitMetric("maxFaithfulnessScoreDrop", thresholds.maxFaithfulnessScoreDrop);

  if (!Number.isInteger(thresholds.minQuestions) || thresholds.minQuestions < 1) {
    throw new Error("Retrieval regression minQuestions must be at least 1");
  }

  if (
    thresholds.maxFailures !== undefined &&
    (!Number.isInteger(thresholds.maxFailures) || thresholds.maxFailures < 1)
  ) {
    throw new Error("Retrieval regression maxFailures must be at least 1");
  }
}

function validateMetrics(label: string, metrics: RetrievalRegressionMetrics): void {
  validateUnitMetric(`${label}.recallAtK`, metrics.recallAtK);
  validateUnitMetric(`${label}.citationHitRate`, metrics.citationHitRate);
  validateUnitMetric(`${label}.noAnswerRate`, metrics.noAnswerRate);
  validateOptionalUnitMetric(`${label}.citationAccuracy`, metrics.citationAccuracy);
  validateOptionalUnitMetric(`${label}.faithfulnessScore`, metrics.faithfulnessScore);

  if (!Number.isInteger(metrics.totalQuestions) || metrics.totalQuestions < 0) {
    throw new Error(`Retrieval regression ${label}.totalQuestions must be non-negative`);
  }
}

function validateOptionalUnitMetric(label: string, value: number | undefined): void {
  if (value !== undefined) {
    validateUnitMetric(label, value);
  }
}

function validateUnitMetric(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Retrieval regression ${label} must be between 0 and 1`);
  }
}

function requireAdvancedMetric(
  label: string,
  metric: "citationAccuracy" | "faithfulnessScore",
  metrics: RetrievalRegressionMetrics,
  required: boolean,
): void {
  if (!required || metrics[metric] !== undefined) {
    return;
  }

  const thresholdLabel = metric === "citationAccuracy" ? "citation accuracy" : "faithfulness";

  throw new Error(
    `Retrieval regression ${label}.${metric} is required when ${thresholdLabel} thresholds are configured`,
  );
}

function advancedDelta(
  metric: "citationAccuracy" | "faithfulnessScore",
  current: RetrievalRegressionMetrics,
  baseline: RetrievalRegressionMetrics | undefined,
): number | undefined {
  const currentValue = current[metric];

  if (currentValue === undefined) {
    return undefined;
  }

  return roundMetric(currentValue - (baseline?.[metric] ?? currentValue));
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatMetric(value: number): string {
  return value.toFixed(3);
}
