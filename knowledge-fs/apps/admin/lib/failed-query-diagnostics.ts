export interface FailedQueryCandidateInput {
  readonly finalRank: number;
  readonly finalScore: number;
  readonly id: string;
  readonly rerankRank?: number | undefined;
  readonly retrievalRank: number;
  readonly retrievalScore: number;
  readonly title: string;
}

export interface FailedQueryExclusionInput {
  readonly id: string;
  readonly reason: string;
  readonly source: string;
  readonly title: string;
}

export interface FailedQueryDiagnosticsInput {
  readonly candidates: readonly FailedQueryCandidateInput[];
  readonly exclusions: readonly FailedQueryExclusionInput[];
  readonly maxCandidates?: number | undefined;
  readonly maxExclusions?: number | undefined;
  readonly query: string;
  readonly traceId: string;
}

export interface FailedQueryCandidateRow {
  readonly finalRankLabel: string;
  readonly finalScoreLabel: string;
  readonly id: string;
  readonly rankingExplanation: string;
  readonly title: string;
}

export interface FailedQueryExclusionRow {
  readonly id: string;
  readonly reasonLabel: string;
  readonly title: string;
}

export interface FailedQueryDiagnostics {
  readonly candidateRows: readonly FailedQueryCandidateRow[];
  readonly exclusionRows: readonly FailedQueryExclusionRow[];
  readonly summary: {
    readonly candidateCountLabel: string;
    readonly exclusionCountLabel: string;
    readonly topIssue: string;
    readonly traceId: string;
  };
}

const defaultMaxCandidates = 5;
const defaultMaxExclusions = 5;

export function createFailedQueryDiagnostics({
  candidates,
  exclusions,
  maxCandidates = defaultMaxCandidates,
  maxExclusions = defaultMaxExclusions,
  query,
  traceId,
}: FailedQueryDiagnosticsInput): FailedQueryDiagnostics {
  validatePositiveInteger(maxCandidates, "Failed query diagnostics maxCandidates");
  validatePositiveInteger(maxExclusions, "Failed query diagnostics maxExclusions");

  if (!query.trim()) {
    throw new Error("Failed query diagnostics query is required");
  }

  if (!traceId.trim()) {
    throw new Error("Failed query diagnostics traceId is required");
  }

  const sortedCandidates = [...candidates].sort(
    (left, right) => left.finalRank - right.finalRank || left.id.localeCompare(right.id),
  );
  const candidateRows = sortedCandidates.slice(0, maxCandidates).map(candidateRow);
  const exclusionRows = exclusions.slice(0, maxExclusions).map(exclusionRow);

  return {
    candidateRows,
    exclusionRows,
    summary: {
      candidateCountLabel: `${candidateRows.length} shown of ${candidates.length}`,
      exclusionCountLabel: `${exclusionRows.length} shown of ${exclusions.length}`,
      topIssue: topIssue(sortedCandidates, exclusions),
      traceId: traceId.trim(),
    },
  };
}

function candidateRow(candidate: FailedQueryCandidateInput): FailedQueryCandidateRow {
  validateCandidate(candidate);

  return {
    finalRankLabel: `#${candidate.finalRank}`,
    finalScoreLabel: formatPercent(candidate.finalScore),
    id: candidate.id.trim(),
    rankingExplanation: rankingExplanation(candidate),
    title: candidate.title.trim(),
  };
}

function exclusionRow(exclusion: FailedQueryExclusionInput): FailedQueryExclusionRow {
  if (!exclusion.id.trim()) {
    throw new Error("Failed query diagnostics exclusion id is required");
  }

  if (!exclusion.title.trim()) {
    throw new Error("Failed query diagnostics exclusion title is required");
  }

  if (!exclusion.reason.trim()) {
    throw new Error("Failed query diagnostics exclusion reason is required");
  }

  if (!exclusion.source.trim()) {
    throw new Error("Failed query diagnostics exclusion source is required");
  }

  return {
    id: exclusion.id.trim(),
    reasonLabel: `${exclusion.reason.trim()} via ${exclusion.source.trim()}`,
    title: exclusion.title.trim(),
  };
}

function rankingExplanation(candidate: FailedQueryCandidateInput): string {
  const rerankLabel =
    candidate.rerankRank === undefined ? "not reranked" : `rerank #${candidate.rerankRank}`;
  const drop =
    candidate.rerankRank !== undefined && candidate.rerankRank > candidate.retrievalRank
      ? `, dropped ${candidate.rerankRank - candidate.retrievalRank}`
      : "";

  return `retrieval #${candidate.retrievalRank} -> ${rerankLabel}${drop}`;
}

function topIssue(
  candidates: readonly FailedQueryCandidateInput[],
  exclusions: readonly FailedQueryExclusionInput[],
): string {
  const droppedCandidates = candidates.filter(
    (candidate) =>
      candidate.rerankRank !== undefined && candidate.rerankRank > candidate.retrievalRank,
  ).length;

  if (droppedCandidates > 0) {
    return `Rerank dropped ${droppedCandidates} candidate after strong retrieval`;
  }

  if (exclusions.length > 0) {
    return `${exclusions.length} filtered candidate${exclusions.length === 1 ? "" : "s"}`;
  }

  return "No obvious diagnostic issue";
}

function validateCandidate(candidate: FailedQueryCandidateInput): void {
  if (!candidate.id.trim()) {
    throw new Error("Failed query diagnostics candidate id is required");
  }

  if (!candidate.title.trim()) {
    throw new Error("Failed query diagnostics candidate title is required");
  }

  validatePositiveInteger(candidate.finalRank, "Failed query diagnostics candidate finalRank");
  validatePositiveInteger(
    candidate.retrievalRank,
    "Failed query diagnostics candidate retrievalRank",
  );
  validateZeroToOne(candidate.finalScore, "Failed query diagnostics candidate finalScore");
  validateZeroToOne(candidate.retrievalScore, "Failed query diagnostics candidate retrievalScore");

  if (candidate.rerankRank !== undefined) {
    validatePositiveInteger(candidate.rerankRank, "Failed query diagnostics candidate rerankRank");
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

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
