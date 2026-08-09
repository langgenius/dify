import type {
  DocumentSemanticEnrichmentProcessor,
  DocumentSemanticEnrichmentProcessorResult,
} from "./document-semantic-enrichment-processor";
import type {
  DocumentSemanticEnrichmentJob,
  DocumentSemanticEnrichmentRepository,
} from "./document-semantic-enrichment-repository";

export interface DocumentSemanticEnrichmentGenerationGuard {
  status(job: DocumentSemanticEnrichmentJob): Promise<"current" | "pending" | "superseded">;
}

export interface DocumentSemanticEnrichmentRuntimeTickResult {
  readonly claimed: number;
  readonly failed: number;
  readonly retried: number;
  readonly succeeded: number;
  readonly superseded: number;
}

export interface DocumentSemanticEnrichmentRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<DocumentSemanticEnrichmentRuntimeTickResult>;
}

export interface DocumentSemanticEnrichmentOperationalMetric {
  readonly degraded: boolean;
  readonly durationMs: number;
  readonly executionAttempt: number;
  readonly failureKind?: "timeout" | "rate_limited" | "other" | undefined;
  readonly nodesScanned?: number | undefined;
  readonly outcome: "waiting" | "retry" | "failed" | "succeeded" | "superseded";
  readonly providerCalls?: number | undefined;
  readonly queueWaitMs: number;
}

export interface DocumentSemanticEnrichmentOperationalMetrics {
  record(metric: DocumentSemanticEnrichmentOperationalMetric): Promise<void> | void;
}

export interface DocumentSemanticEnrichmentRuntimeOptions {
  readonly claimLimit: number;
  readonly generationGuard: DocumentSemanticEnrichmentGenerationGuard;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly metrics?: DocumentSemanticEnrichmentOperationalMetrics | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: { readonly error: unknown; readonly job: DocumentSemanticEnrichmentJob }) => void)
    | undefined;
  readonly processor: DocumentSemanticEnrichmentProcessor;
  readonly repository: DocumentSemanticEnrichmentRepository;
  readonly retryBaseMs: number;
  readonly workerId: string;
}

/** Durable optional graph worker. Its queue is independent from searchable publication. */
export function createDocumentSemanticEnrichmentRuntime({
  claimLimit,
  generationGuard,
  leaseMs,
  heartbeatIntervalMs = Math.max(1, Math.floor(leaseMs / 3)),
  intervalMs,
  metrics,
  now = () => Date.now(),
  onError,
  processor,
  repository,
  retryBaseMs,
  workerId,
}: DocumentSemanticEnrichmentRuntimeOptions): DocumentSemanticEnrichmentRuntime {
  for (const [name, value] of Object.entries({
    claimLimit,
    heartbeatIntervalMs,
    intervalMs,
    leaseMs,
    retryBaseMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Document semantic enrichment runtime ${name} must be positive`);
    }
  }
  if (heartbeatIntervalMs >= leaseMs) {
    throw new Error("Document semantic enrichment heartbeat interval must be below its lease");
  }
  if (!workerId.trim()) throw new Error("Document semantic enrichment workerId is required");

  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;

  const processJob = async (
    job: DocumentSemanticEnrichmentJob,
  ): Promise<"failed" | "retried" | "succeeded" | "superseded"> => {
    if (!job.leaseToken || !job.workerId) {
      throw new Error("Claimed document semantic enrichment job has no lease identity");
    }
    const lease = { id: job.id, leaseToken: job.leaseToken, workerId: job.workerId } as const;
    const startedAt = now();
    const record = (
      outcome: DocumentSemanticEnrichmentOperationalMetric["outcome"],
      options: {
        readonly error?: unknown;
        readonly result?: DocumentSemanticEnrichmentProcessorResult;
      } = {},
    ): void => {
      recordSemanticMetric(metrics, {
        degraded: outcome === "failed",
        durationMs: Math.max(0, now() - startedAt),
        executionAttempt: job.executionAttempts,
        ...(options.error ? { failureKind: semanticFailureKind(options.error) } : {}),
        ...(options.result ? { nodesScanned: options.result.nodesScanned } : {}),
        outcome,
        ...(options.result ? { providerCalls: options.result.semanticProviderCalls } : {}),
        queueWaitMs: Math.max(0, startedAt - Date.parse(job.createdAt)),
      });
    };
    let heartbeatLost = false;
    const heartbeat = setInterval(() => {
      const timestamp = now();
      void repository
        .heartbeat({
          ...lease,
          leaseExpiresAt: iso(timestamp + leaseMs),
          now: iso(timestamp),
        })
        .then((renewed) => {
          if (!renewed) heartbeatLost = true;
        })
        .catch(() => {
          heartbeatLost = true;
        });
    }, heartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      const generationStatus = await generationGuard.status(job);
      if (generationStatus === "pending") {
        const timestamp = now();
        const released = await repository.release({
          ...lease,
          availableAt: iso(timestamp + retryBaseMs),
          now: iso(timestamp),
          preserveExecutionAttempt: true,
          state: "retry_wait",
        });
        if (!released) throw new Error("Semantic enrichment publication wait lost its lease");
        record("waiting");
        return "retried";
      }
      if (generationStatus === "superseded") {
        const released = await repository.release({
          ...lease,
          errorCode: "SEMANTIC_GENERATION_SUPERSEDED",
          errorMessage: "A newer document generation is published",
          now: iso(now()),
          state: "superseded",
        });
        if (!released) throw new Error("Semantic enrichment supersede lost its lease");
        record("superseded");
        return "superseded";
      }

      const result = await processor.process(job);
      if (heartbeatLost) throw new Error("Semantic enrichment execution lease was lost");
      const released = await repository.release({
        ...lease,
        now: iso(now()),
        result: resultRecord(result),
        state: "succeeded",
      });
      if (!released) throw new Error("Semantic enrichment completion lost its lease");
      record("succeeded", { result });
      return "succeeded";
    } catch (error) {
      onError?.({ error, job });
      const exhausted = job.executionAttempts >= job.maxExecutionAttempts;
      const timestamp = now();
      const released = await repository.release({
        ...lease,
        ...(exhausted
          ? {}
          : { availableAt: iso(timestamp + retryDelay(retryBaseMs, job.executionAttempts)) }),
        errorCode: semanticErrorCode(error),
        errorMessage: semanticErrorMessage(error),
        now: iso(timestamp),
        state: exhausted ? "failed" : "retry_wait",
      });
      if (!released) throw error;
      record(exhausted ? "failed" : "retry", { error });
      return exhausted ? "failed" : "retried";
    } finally {
      clearInterval(heartbeat);
    }
  };

  const tick = async (): Promise<DocumentSemanticEnrichmentRuntimeTickResult> => {
    if (ticking) return emptyTickResult();
    ticking = true;
    try {
      const timestamp = now();
      const claimed = await repository.claim({
        leaseExpiresAt: iso(timestamp + leaseMs),
        limit: claimLimit,
        now: iso(timestamp),
        workerId,
      });
      const result = { ...emptyTickResult(), claimed: claimed.length };
      const outcomes = await Promise.all(claimed.map(processJob));
      for (const outcome of outcomes) result[outcome] += 1;
      return result;
    } finally {
      ticking = false;
    }
  };

  return {
    start: () => {
      if (timer) return;
      void tick().catch(() => undefined);
      timer = setInterval(() => void tick().catch(() => undefined), intervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}

function resultRecord(
  result: DocumentSemanticEnrichmentProcessorResult,
): Readonly<Record<string, unknown>> {
  return { ...result };
}

function emptyTickResult(): DocumentSemanticEnrichmentRuntimeTickResult {
  return { claimed: 0, failed: 0, retried: 0, succeeded: 0, superseded: 0 };
}

function retryDelay(baseMs: number, attempt: number): number {
  return Math.min(60 * 60 * 1_000, baseMs * 2 ** Math.max(0, attempt - 1));
}

function semanticErrorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code.slice(0, 128)
    : "SEMANTIC_ENRICHMENT_FAILED";
}

function semanticErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function semanticFailureKind(
  error: unknown,
): NonNullable<DocumentSemanticEnrichmentOperationalMetric["failureKind"]> {
  const record = typeof error === "object" && error !== null ? error : undefined;
  const code = record && "code" in record ? String(record.code).toLowerCase() : "";
  const status = record && "status" in record ? Number(record.status) : undefined;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (status === 429 || code.includes("429") || code.includes("rate_limit")) {
    return "rate_limited";
  }
  if (
    code.includes("timeout") ||
    code.includes("timedout") ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return "timeout";
  }
  return "other";
}

function recordSemanticMetric(
  metrics: DocumentSemanticEnrichmentOperationalMetrics | undefined,
  metric: DocumentSemanticEnrichmentOperationalMetric,
): void {
  if (!metrics) return;
  try {
    const pending = metrics.record(metric);
    if (pending) void pending.catch(() => undefined);
  } catch {
    // Optional enrichment telemetry cannot own graph availability or retry state.
  }
}

function iso(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new Error("Semantic enrichment runtime clock is invalid");
  return new Date(timestamp).toISOString();
}
