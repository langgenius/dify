import type {
  HybridRetrievalResult,
  ResolvedRetrievalMode,
  RetrievalMode,
  RetrieveHybridInput,
} from "./retrieval-types";

export interface RetrievalOperationalMetric {
  readonly candidateCount: number;
  readonly filteredCount: number;
  readonly mode: RetrievalMode;
  readonly rerankMs: number;
  readonly resolvedMode: ResolvedRetrievalMode;
  readonly resultCount: number;
  readonly zeroResult: boolean;
}

export interface RetrievalOperationalMetrics {
  record(metric: RetrievalOperationalMetric): Promise<void> | void;
}

export type DurableTaskOperationalMetric =
  | {
      readonly lifecycle: "queued" | "retry" | "running";
      readonly taskKind: "document_compilation" | "research";
    }
  | {
      readonly lifecycle: "terminal";
      readonly outcome: "canceled" | "completed" | "failed";
      readonly taskKind: "document_compilation" | "research";
    };

export interface DurableTaskOperationalMetrics {
  record(metric: DurableTaskOperationalMetric): Promise<void> | void;
}

/**
 * Reduces rich retrieval diagnostics to aggregation-only result dimensions. The returned object
 * deliberately has no scope, request, model, URL, token, or free-form error fields.
 */
export function buildRetrievalOperationalMetric({
  input,
  result,
}: {
  readonly input: RetrieveHybridInput;
  readonly result: HybridRetrievalResult;
}): RetrievalOperationalMetric {
  const metrics = result.metrics;
  const recalledCandidates =
    nonnegative(metrics?.denseCandidates) + nonnegative(metrics?.ftsCandidates);
  const candidateCount = Math.max(
    result.items.length,
    recalledCandidates,
    nonnegative(metrics?.fusedCandidates),
    nonnegative(metrics?.pageIndexMatchedNodes),
    nonnegative(metrics?.rerankCandidates),
  );
  const filteredCount =
    nonnegative(metrics?.metadataFilteredCandidates) +
    nonnegative(metrics?.permissionFilteredCandidates) +
    nonnegative(metrics?.projectionFilteredCandidates) +
    nonnegative(metrics?.scoreThresholdFilteredCandidates);
  const resolvedMode = result.plan?.resolvedMode ?? input.mode ?? "fast";

  return {
    candidateCount,
    filteredCount,
    mode: input.requestedMode ?? result.plan?.requestedMode ?? input.mode ?? "fast",
    rerankMs: nonnegative(metrics?.rerankMs),
    resolvedMode,
    resultCount: result.items.length,
    zeroResult: result.items.length === 0,
  };
}

export function recordRetrievalOperationalMetric(
  metrics: RetrievalOperationalMetrics | undefined,
  input: RetrieveHybridInput,
  result: HybridRetrievalResult,
): void {
  recordBestEffort(metrics, buildRetrievalOperationalMetric({ input, result }));
}

export function recordDurableTaskOperationalMetric(
  metrics: DurableTaskOperationalMetrics | undefined,
  metric: DurableTaskOperationalMetric,
): void {
  recordBestEffort(metrics, metric);
}

function recordBestEffort<Metric>(
  metrics: { record(metric: Metric): Promise<void> | void } | undefined,
  metric: Metric,
): void {
  if (!metrics) return;
  try {
    const pending = metrics.record(metric);
    if (pending) void pending.catch(() => undefined);
  } catch {
    // Operational telemetry must never own retrieval output or durable task state.
  }
}

function nonnegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}
