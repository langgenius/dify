import { parseResearchModelUsage } from "./research-model-usage";

export const IngestionModelStages = [
  "semantic-chunking",
  "outline-summary",
  "graph-entity",
  "graph-relation",
  "graph-community-summary",
  "findability",
  "text-embedding",
  "visual-embedding",
] as const;

export type IngestionModelStage = (typeof IngestionModelStages)[number];

/**
 * One bounded model request. Token fields are optional because some providers do not report usage;
 * callers must not turn an estimate into provider-reported usage.
 */
export interface IngestionModelCallOperationalMetric {
  readonly cacheHits: number;
  readonly durationMs: number;
  readonly inputTokens?: number | undefined;
  readonly itemCount: number;
  readonly outcome: "failed" | "succeeded";
  readonly outputTokens?: number | undefined;
  readonly providerCalls: number;
  /** Items satisfied by a durable upstream semantic artifact instead of another model call. */
  readonly reusedItems?: number | undefined;
  readonly retries: number;
  readonly stage: IngestionModelStage;
  readonly totalTokens?: number | undefined;
}

export interface IngestionModelCallOperationalMetrics {
  record(metric: IngestionModelCallOperationalMetric): Promise<void> | void;
}

export function ingestionModelUsageFromMetadata(metadata: unknown): {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
} {
  const usage = parseResearchModelUsage(metadata);
  return {
    ...(usage?.promptTokens === undefined ? {} : { inputTokens: usage.promptTokens }),
    ...(usage?.completionTokens === undefined ? {} : { outputTokens: usage.completionTokens }),
    ...(usage?.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  };
}

export function recordIngestionModelCallMetric(
  metrics: IngestionModelCallOperationalMetrics | undefined,
  metric: IngestionModelCallOperationalMetric,
): void {
  if (!metrics) return;
  try {
    const pending = metrics.record(metric);
    if (pending) void pending.catch(() => undefined);
  } catch {
    // Optional telemetry must never own model output or durable compilation state.
  }
}
