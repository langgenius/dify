export type RetrievalStudioEvidenceState =
  | "answerable"
  | "conflict"
  | "not-enough-evidence"
  | "partial"
  | "permission-limited";

export interface RetrievalStudioCandidateInput {
  readonly citationLabel: string;
  readonly evidenceState?: RetrievalStudioEvidenceState | undefined;
  readonly nodeId: string;
  readonly rerankScore?: number | undefined;
  readonly score: number;
  readonly sources: readonly string[];
  readonly title: string;
}

export interface RetrievalStudioEvidenceBundleInput {
  readonly itemCount: number;
  readonly missingEvidenceCount: number;
  readonly state: RetrievalStudioEvidenceState;
}

export interface RetrievalStudioStrategyInput {
  readonly candidates: readonly RetrievalStudioCandidateInput[];
  readonly evidenceBundle: RetrievalStudioEvidenceBundleInput;
  readonly latencyMs: number;
  readonly name: string;
  readonly recallAtK: number;
}

export interface RetrievalStudioComparisonInput {
  readonly maxCandidates?: number | undefined;
  readonly strategies: readonly RetrievalStudioStrategyInput[];
}

export interface RetrievalStudioCandidateView {
  readonly citationLabel: string;
  readonly evidenceState: RetrievalStudioEvidenceState;
  readonly nodeId: string;
  readonly rerankScoreLabel: string;
  readonly scoreLabel: string;
  readonly sourcesLabel: string;
  readonly title: string;
}

export interface RetrievalStudioColumn {
  readonly averageScoreLabel: string;
  readonly candidateCountLabel: string;
  readonly candidates: readonly RetrievalStudioCandidateView[];
  readonly evidenceBundleLabel: string;
  readonly latencyLabel: string;
  readonly name: string;
  readonly recallLabel: string;
}

export interface RetrievalStudioComparison {
  readonly columns: readonly RetrievalStudioColumn[];
  readonly winner: string;
}

const defaultMaxCandidates = 5;

export function createRetrievalStudioComparison({
  maxCandidates = defaultMaxCandidates,
  strategies,
}: RetrievalStudioComparisonInput): RetrievalStudioComparison {
  validatePositiveInteger(maxCandidates, "Retrieval Studio maxCandidates");

  if (strategies.length !== 2) {
    throw new Error("Retrieval Studio requires exactly two strategies");
  }

  const columns = strategies.map((strategy) => strategyColumn(strategy, maxCandidates));

  return {
    columns,
    winner: winnerName(strategies, columns),
  };
}

function strategyColumn(
  strategy: RetrievalStudioStrategyInput,
  maxCandidates: number,
): RetrievalStudioColumn {
  validateStrategy(strategy);

  const candidates = strategy.candidates.slice(0, maxCandidates).map(candidateView);
  const averageScore =
    candidates.length === 0
      ? 0
      : strategy.candidates
          .slice(0, maxCandidates)
          .reduce((total, candidate) => total + candidate.score, 0) / candidates.length;

  return {
    averageScoreLabel: formatPercent(averageScore),
    candidateCountLabel: `${candidates.length} shown`,
    candidates,
    evidenceBundleLabel: `${strategy.evidenceBundle.state} - ${strategy.evidenceBundle.itemCount} evidence, ${strategy.evidenceBundle.missingEvidenceCount} missing`,
    latencyLabel: formatMs(strategy.latencyMs),
    name: strategy.name.trim(),
    recallLabel: formatPercent(strategy.recallAtK),
  };
}

function candidateView(candidate: RetrievalStudioCandidateInput): RetrievalStudioCandidateView {
  validateCandidate(candidate);

  return {
    citationLabel: candidate.citationLabel.trim(),
    evidenceState: candidate.evidenceState ?? "not-enough-evidence",
    nodeId: candidate.nodeId.trim(),
    rerankScoreLabel:
      candidate.rerankScore === undefined ? "n/a" : formatPercent(candidate.rerankScore),
    scoreLabel: formatPercent(candidate.score),
    sourcesLabel: candidate.sources.length === 0 ? "none" : candidate.sources.join(" + "),
    title: candidate.title.trim(),
  };
}

function winnerName(
  strategies: readonly RetrievalStudioStrategyInput[],
  columns: readonly RetrievalStudioColumn[],
): string {
  const [left, right] = strategies as readonly [
    RetrievalStudioStrategyInput,
    RetrievalStudioStrategyInput,
  ];
  const [leftColumn, rightColumn] = columns as readonly [
    RetrievalStudioColumn,
    RetrievalStudioColumn,
  ];

  const comparison =
    compareMetric(left.recallAtK, right.recallAtK) ||
    compareMetric(
      percentLabelToNumber(leftColumn.averageScoreLabel),
      percentLabelToNumber(rightColumn.averageScoreLabel),
    ) ||
    compareMetric(right.latencyMs, left.latencyMs);

  if (comparison === 0) {
    return "tie";
  }

  return comparison > 0 ? left.name.trim() : right.name.trim();
}

function validateStrategy(strategy: RetrievalStudioStrategyInput): void {
  if (!strategy.name.trim()) {
    throw new Error("Retrieval Studio strategy name is required");
  }

  validateZeroToOne(strategy.recallAtK, "Retrieval Studio recallAtK");

  if (!Number.isFinite(strategy.latencyMs) || strategy.latencyMs < 0) {
    throw new Error("Retrieval Studio latencyMs must be non-negative");
  }

  validateNonNegativeInteger(
    strategy.evidenceBundle.itemCount,
    "Retrieval Studio evidence itemCount",
  );
  validateNonNegativeInteger(
    strategy.evidenceBundle.missingEvidenceCount,
    "Retrieval Studio evidence missingEvidenceCount",
  );

  for (const candidate of strategy.candidates) {
    validateCandidate(candidate);
  }
}

function validateCandidate(candidate: RetrievalStudioCandidateInput): void {
  if (!candidate.title.trim()) {
    throw new Error("Retrieval Studio candidate title is required");
  }

  if (!candidate.nodeId.trim()) {
    throw new Error("Retrieval Studio candidate nodeId is required");
  }

  if (!candidate.citationLabel.trim()) {
    throw new Error("Retrieval Studio candidate citationLabel is required");
  }

  validateZeroToOne(candidate.score, "Retrieval Studio candidate score");

  if (candidate.rerankScore !== undefined) {
    validateZeroToOne(candidate.rerankScore, "Retrieval Studio candidate rerankScore");
  }
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be non-negative`);
  }
}

function validateZeroToOne(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
}

function compareMetric(left: number, right: number): number {
  return left === right ? 0 : left > right ? 1 : -1;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function percentLabelToNumber(value: string): number {
  return Number.parseInt(value.replace("%", ""), 10) / 100;
}

function formatMs(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} ms`;
}
