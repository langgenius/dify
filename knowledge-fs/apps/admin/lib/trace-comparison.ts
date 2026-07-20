import { createTraceSummary } from "./trace-summary";

export interface TraceComparisonStep {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly name: string;
}

export interface TraceComparisonTraceInput {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly TraceComparisonStep[];
}

export interface TraceComparisonInput {
  readonly maxSteps?: number | undefined;
  readonly traces: readonly TraceComparisonTraceInput[];
}

export interface TraceComparisonColumn {
  readonly evidenceLabel: string;
  readonly filtersLabel: string;
  readonly label: string;
  readonly recallCandidatesLabel: string;
  readonly rerankLabel: string;
  readonly routeLabel: string;
  readonly stepCountLabel: string;
  readonly traceId: string;
}

export interface TraceComparisonDeltas {
  readonly citationDeltaLabel: string;
  readonly filterChangeLabel: string;
  readonly recallDeltaLabel: string;
  readonly rerankChangeLabel: string;
  readonly routeChangeLabel: string;
}

export interface TraceComparison {
  readonly columns: readonly TraceComparisonColumn[];
  readonly deltas: TraceComparisonDeltas;
}

const defaultMaxSteps = 100;

export function createTraceComparison({
  maxSteps = defaultMaxSteps,
  traces,
}: TraceComparisonInput): TraceComparison {
  validatePositiveInteger(maxSteps, "Trace comparison maxSteps");

  if (traces.length !== 2) {
    throw new Error("Trace comparison requires exactly two traces");
  }

  const columns = traces.map((trace) => traceColumn(trace, maxSteps));

  return {
    columns,
    deltas: traceDeltas(columns),
  };
}

function traceColumn(trace: TraceComparisonTraceInput, maxSteps: number): TraceComparisonColumn {
  if (!trace.id.trim()) {
    throw new Error("Trace comparison trace id is required");
  }

  if (!trace.label.trim()) {
    throw new Error("Trace comparison trace label is required");
  }

  if (trace.steps.length > maxSteps) {
    throw new Error(`Trace comparison trace steps exceeds maxSteps=${maxSteps}`);
  }

  const summary = createTraceSummary({ maxSteps, steps: trace.steps });

  return {
    evidenceLabel: summary.evidence,
    filtersLabel: summary.filters,
    label: trace.label.trim(),
    recallCandidatesLabel: `${summary.recallCandidates} candidates`,
    rerankLabel: summary.rerank,
    routeLabel: summary.route,
    stepCountLabel: `${trace.steps.length} ${trace.steps.length === 1 ? "step" : "steps"}`,
    traceId: trace.id.trim(),
  };
}

function traceDeltas(columns: readonly TraceComparisonColumn[]): TraceComparisonDeltas {
  const [left, right] = columns as readonly [TraceComparisonColumn, TraceComparisonColumn];

  return {
    citationDeltaLabel: deltaLabel(
      parseLeadingNumber(left.evidenceLabel),
      parseLeadingNumber(right.evidenceLabel),
      "citations",
    ),
    filterChangeLabel: filterChangeLabel(left.filtersLabel, right.filtersLabel),
    recallDeltaLabel: deltaLabel(
      parseLeadingNumber(left.recallCandidatesLabel),
      parseLeadingNumber(right.recallCandidatesLabel),
      "candidates",
    ),
    rerankChangeLabel:
      left.rerankLabel === right.rerankLabel
        ? `${left.rerankLabel} stable`
        : `${left.rerankLabel} -> ${right.rerankLabel}`,
    routeChangeLabel:
      left.routeLabel === right.routeLabel
        ? `${left.routeLabel} stable`
        : `${left.routeLabel} -> ${right.routeLabel}`,
  };
}

function filterChangeLabel(left: string, right: string): string {
  const leftFilters = parseFilterLabel(left);
  const rightFilters = parseFilterLabel(right);
  const keys = [...new Set([...Object.keys(leftFilters), ...Object.keys(rightFilters)])].sort();

  if (keys.length === 0) {
    return "none stable";
  }

  return keys
    .map((key) => (leftFilters[key] === rightFilters[key] ? `${key} stable` : `${key} changed`))
    .join(", ");
}

function parseFilterLabel(label: string): Record<string, string> {
  if (label === "none") {
    return {};
  }

  return Object.fromEntries(
    label.split(", ").map((entry) => {
      const [key, ...valueParts] = entry.split("=");
      return [key ?? "", valueParts.join("=")];
    }),
  );
}

function deltaLabel(left: number, right: number, unit: string): string {
  const delta = right - left;

  if (delta === 0) {
    return `0 ${unit}`;
  }

  return `${delta > 0 ? "+" : ""}${delta} ${unit}`;
}

function parseLeadingNumber(label: string): number {
  const value = Number.parseInt(label, 10);
  return Number.isFinite(value) ? value : 0;
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
}
