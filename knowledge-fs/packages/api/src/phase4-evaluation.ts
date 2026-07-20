export type Phase4EvaluationVariant = "baseline" | "enriched" | "graph-expanded" | "summary-tree";

export interface Phase4EvaluationMetrics {
  readonly citationHitRate: number;
  readonly noAnswerRate: number;
  readonly recallAtK: number;
  readonly totalQuestions: number;
}

export interface Phase4EvaluationInput {
  readonly generatedAt: string;
  readonly goldenSet: {
    readonly name: string;
    readonly totalQuestions: number;
  };
  readonly variants: Record<Phase4EvaluationVariant, Phase4EvaluationMetrics>;
}

export interface Phase4EvaluationMetricDelta {
  readonly citationHitRate: number;
  readonly noAnswerRate: number;
  readonly recallAtK: number;
}

export interface Phase4EvaluationReport extends Phase4EvaluationInput {
  readonly impact: {
    readonly enrichedVsBaseline: Phase4EvaluationMetricDelta;
    readonly graphExpandedVsBaseline: Phase4EvaluationMetricDelta;
    readonly summaryTreeVsBaseline: Phase4EvaluationMetricDelta;
  };
  readonly phase: "phase-4";
  readonly recommendation: string;
}

const variants: readonly Phase4EvaluationVariant[] = [
  "baseline",
  "enriched",
  "summary-tree",
  "graph-expanded",
];

export function createPhase4EvaluationReport(input: Phase4EvaluationInput): Phase4EvaluationReport {
  validatePhase4EvaluationInput(input);

  const report = {
    generatedAt: input.generatedAt,
    goldenSet: { ...input.goldenSet },
    impact: {
      enrichedVsBaseline: metricDelta(input.variants.enriched, input.variants.baseline),
      graphExpandedVsBaseline: metricDelta(
        input.variants["graph-expanded"],
        input.variants.baseline,
      ),
      summaryTreeVsBaseline: metricDelta(input.variants["summary-tree"], input.variants.baseline),
    },
    phase: "phase-4" as const,
    recommendation: recommendation(input),
    variants: cloneVariants(input.variants),
  };

  return report;
}

function validatePhase4EvaluationInput(input: Phase4EvaluationInput): void {
  if (!input.generatedAt.trim()) {
    throw new Error("Phase 4 evaluation generatedAt is required");
  }

  if (!input.goldenSet.name.trim()) {
    throw new Error("Phase 4 evaluation goldenSet.name is required");
  }

  if (!Number.isInteger(input.goldenSet.totalQuestions) || input.goldenSet.totalQuestions < 1) {
    throw new Error("Phase 4 evaluation goldenSet.totalQuestions must be at least 1");
  }

  for (const variant of variants) {
    validateMetrics(variant, input.variants[variant], input.goldenSet.totalQuestions);
  }
}

function validateMetrics(
  variant: Phase4EvaluationVariant,
  metrics: Phase4EvaluationMetrics,
  totalQuestions: number,
): void {
  if (metrics.totalQuestions !== totalQuestions) {
    throw new Error(
      `Phase 4 evaluation ${variant}.totalQuestions must match goldenSet.totalQuestions=${totalQuestions}`,
    );
  }

  validateUnitMetric(`${variant}.recallAtK`, metrics.recallAtK);
  validateUnitMetric(`${variant}.citationHitRate`, metrics.citationHitRate);
  validateUnitMetric(`${variant}.noAnswerRate`, metrics.noAnswerRate);
}

function validateUnitMetric(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Phase 4 evaluation ${label} must be between 0 and 1`);
  }
}

function cloneVariants(
  value: Record<Phase4EvaluationVariant, Phase4EvaluationMetrics>,
): Record<Phase4EvaluationVariant, Phase4EvaluationMetrics> {
  return {
    baseline: { ...value.baseline },
    enriched: { ...value.enriched },
    "graph-expanded": { ...value["graph-expanded"] },
    "summary-tree": { ...value["summary-tree"] },
  };
}

function metricDelta(
  current: Phase4EvaluationMetrics,
  baseline: Phase4EvaluationMetrics,
): Phase4EvaluationMetricDelta {
  return {
    citationHitRate: roundMetric(current.citationHitRate - baseline.citationHitRate),
    noAnswerRate: roundMetric(current.noAnswerRate - baseline.noAnswerRate),
    recallAtK: roundMetric(current.recallAtK - baseline.recallAtK),
  };
}

function recommendation(input: Phase4EvaluationInput): string {
  const strongest = (["enriched", "summary-tree", "graph-expanded"] as const).reduce(
    (best, variant) =>
      input.variants[variant].recallAtK > input.variants[best].recallAtK ? variant : best,
    "enriched",
  );

  return `${strongest} is the strongest Phase 4 retrieval variant by recallAtK on ${input.goldenSet.name}.`;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
