export interface EvaluationDashboardRun {
  readonly citationAccuracy: number;
  readonly costUsd: number;
  readonly failedQuestions: number;
  readonly faithfulnessScore: number;
  readonly id: string;
  readonly latencyMs: number;
  readonly recallAtK: number;
  readonly runAt: string;
  readonly totalQuestions: number;
}

export interface EvaluationDashboardTrendPoint {
  readonly label: string;
  readonly runId: string;
  readonly value: number;
  readonly valueLabel: string;
}

export interface EvaluationDashboardSummary {
  readonly citationTrend: readonly EvaluationDashboardTrendPoint[];
  readonly costLatency: {
    readonly averageCostLabel: string;
    readonly averageLatencyLabel: string;
    readonly latestCostLabel: string;
    readonly latestLatencyLabel: string;
  };
  readonly latest: {
    readonly citationAccuracyLabel: string;
    readonly faithfulnessLabel: string;
    readonly passRateLabel: string;
    readonly recallLabel: string;
    readonly runId: string;
  };
  readonly recallTrend: readonly EvaluationDashboardTrendPoint[];
}

export interface EvaluationDashboardSummaryInput {
  readonly maxRuns?: number | undefined;
  readonly maxTrendPoints?: number | undefined;
  readonly runs: readonly EvaluationDashboardRun[];
}

const defaultMaxRuns = 20;
const defaultMaxTrendPoints = 12;

export function createEvaluationDashboardSummary({
  maxRuns = defaultMaxRuns,
  maxTrendPoints = defaultMaxTrendPoints,
  runs,
}: EvaluationDashboardSummaryInput): EvaluationDashboardSummary {
  validatePositiveInteger(maxRuns, "Evaluation dashboard maxRuns");
  validatePositiveInteger(maxTrendPoints, "Evaluation dashboard maxTrendPoints");

  if (runs.length > maxRuns) {
    throw new Error(`Evaluation dashboard runs exceeds maxRuns=${maxRuns}`);
  }

  const sortedRuns = [...runs].sort((left, right) => left.runAt.localeCompare(right.runAt));

  for (const run of sortedRuns) {
    validateRun(run);
  }

  const latest = sortedRuns.at(-1) ?? emptyRun();
  const trendRuns = sortedRuns.slice(-maxTrendPoints);
  const averageCost =
    sortedRuns.length === 0
      ? 0
      : sortedRuns.reduce((total, run) => total + run.costUsd, 0) / sortedRuns.length;
  const averageLatency =
    sortedRuns.length === 0
      ? 0
      : sortedRuns.reduce((total, run) => total + run.latencyMs, 0) / sortedRuns.length;

  return {
    citationTrend: trendRuns.map((run) => trendPoint(run, run.citationAccuracy)),
    costLatency: {
      averageCostLabel: formatUsd(averageCost),
      averageLatencyLabel: formatMs(averageLatency),
      latestCostLabel: formatUsd(latest.costUsd),
      latestLatencyLabel: formatMs(latest.latencyMs),
    },
    latest: {
      citationAccuracyLabel: formatPercent(latest.citationAccuracy),
      faithfulnessLabel: formatPercent(latest.faithfulnessScore),
      passRateLabel: formatPercent(passRate(latest)),
      recallLabel: formatPercent(latest.recallAtK),
      runId: latest.id,
    },
    recallTrend: trendRuns.map((run) => trendPoint(run, run.recallAtK)),
  };
}

function validateRun(run: EvaluationDashboardRun): void {
  if (!run.id.trim()) {
    throw new Error("Evaluation dashboard run id is required");
  }

  if (Number.isNaN(Date.parse(run.runAt))) {
    throw new Error("Evaluation dashboard runAt must be a valid timestamp");
  }

  validateZeroToOne(run.recallAtK, "Evaluation dashboard recallAtK");
  validateZeroToOne(run.citationAccuracy, "Evaluation dashboard citationAccuracy");
  validateZeroToOne(run.faithfulnessScore, "Evaluation dashboard faithfulnessScore");

  if (!Number.isInteger(run.totalQuestions) || run.totalQuestions < 1) {
    throw new Error("Evaluation dashboard totalQuestions must be at least 1");
  }

  if (!Number.isInteger(run.failedQuestions) || run.failedQuestions < 0) {
    throw new Error("Evaluation dashboard failedQuestions must be non-negative");
  }

  if (run.failedQuestions > run.totalQuestions) {
    throw new Error("Evaluation dashboard failedQuestions cannot exceed totalQuestions");
  }

  if (!Number.isFinite(run.costUsd) || run.costUsd < 0) {
    throw new Error("Evaluation dashboard costUsd must be non-negative");
  }

  if (!Number.isFinite(run.latencyMs) || run.latencyMs < 0) {
    throw new Error("Evaluation dashboard latencyMs must be non-negative");
  }
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
}

function validateZeroToOne(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
}

function trendPoint(run: EvaluationDashboardRun, value: number): EvaluationDashboardTrendPoint {
  return {
    label: formatHourMinute(run.runAt),
    runId: run.id,
    value,
    valueLabel: formatPercent(value),
  };
}

function passRate(run: EvaluationDashboardRun): number {
  return (run.totalQuestions - run.failedQuestions) / run.totalQuestions;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatMs(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} ms`;
}

function formatHourMinute(timestamp: string): string {
  const date = new Date(timestamp);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(
    2,
    "0",
  )}`;
}

function emptyRun(): EvaluationDashboardRun {
  return {
    citationAccuracy: 0,
    costUsd: 0,
    failedQuestions: 0,
    faithfulnessScore: 0,
    id: "",
    latencyMs: 0,
    recallAtK: 0,
    runAt: "1970-01-01T00:00:00.000Z",
    totalQuestions: 1,
  };
}
