import type { DocumentCompilationAttemptRepository } from "./document-compilation-attempt-repository";
import type {
  DocumentCompilationJobStateMachine,
  StartDocumentCompilationJobInput,
} from "./document-compilation-job";
import type { PageIndexFindabilityRepository } from "./page-index-findability-repository";

export interface PageIndexSummaryRepairRuntimeTickResult {
  readonly claimed: number;
  readonly dispatched: number;
  readonly failed: number;
  readonly requeued: number;
}

export interface PageIndexSummaryRepairRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<PageIndexSummaryRepairRuntimeTickResult>;
}

export interface PageIndexSummaryRepairRuntimeOptions {
  readonly attempts: Pick<DocumentCompilationAttemptRepository, "get">;
  readonly compilationJobs: Pick<DocumentCompilationJobStateMachine, "start">;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly maxBatchSize: number;
  readonly now?: (() => number) | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly repository: Pick<
    PageIndexFindabilityRepository,
    "claimSummaryRepairs" | "completeSummaryRepair" | "failSummaryRepair"
  >;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly workerId: string;
}

/** Durable, bounded dispatcher for low-findability summary regeneration. */
export function createPageIndexSummaryRepairRuntime({
  attempts,
  compilationJobs,
  intervalMs,
  leaseMs,
  maxAttempts,
  maxBatchSize,
  now = Date.now,
  onError,
  repository,
  retryBaseMs,
  retryMaxMs,
  workerId,
}: PageIndexSummaryRepairRuntimeOptions): PageIndexSummaryRepairRuntime {
  for (const [label, value] of [
    ["intervalMs", intervalMs],
    ["leaseMs", leaseMs],
    ["maxAttempts", maxAttempts],
    ["maxBatchSize", maxBatchSize],
    ["retryBaseMs", retryBaseMs],
    ["retryMaxMs", retryMaxMs],
  ] as const) {
    positiveInteger(value, label);
  }
  if (retryMaxMs < retryBaseMs) {
    throw new Error("PageIndex summary repair retryMaxMs must be at least retryBaseMs");
  }
  if (!workerId.trim()) throw new Error("PageIndex summary repair workerId is required");
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<PageIndexSummaryRepairRuntimeTickResult> | undefined;

  const runTick = async (): Promise<PageIndexSummaryRepairRuntimeTickResult> => {
    const timestamp = now();
    const claimed = await repository.claimSummaryRepairs({
      leaseExpiresAt: new Date(timestamp + leaseMs).toISOString(),
      limit: maxBatchSize,
      now: new Date(timestamp).toISOString(),
      workerId,
    });
    const result = { claimed: claimed.length, dispatched: 0, failed: 0, requeued: 0 };
    await Promise.all(
      claimed.map(async (repair) => {
        if (!repair.lockToken) throw new Error("Claimed summary repair has no lock token");
        try {
          const source = await attempts.get(repair.compilationAttemptId);
          if (!source || source.runState !== "succeeded" || source.checkpoint !== "published") {
            throw new SummaryRepairNotReadyError();
          }
          await compilationJobs.start(startInput(source));
          const completed = await repository.completeSummaryRepair({
            id: repair.id,
            lockToken: repair.lockToken,
            now: new Date(now()).toISOString(),
          });
          if (!completed) throw new Error("PageIndex summary repair completion lost its lease");
          result.dispatched += 1;
        } catch (error) {
          const retry = repair.summaryRepairAttempts < maxAttempts;
          const retryAt = retry
            ? new Date(
                now() +
                  Math.min(
                    retryMaxMs,
                    retryBaseMs * 2 ** Math.max(0, repair.summaryRepairAttempts - 1),
                  ),
              ).toISOString()
            : undefined;
          await repository.failSummaryRepair({
            error: error instanceof Error ? error.message : "PageIndex summary repair failed",
            id: repair.id,
            lockToken: repair.lockToken,
            now: new Date(now()).toISOString(),
            ...(retryAt ? { retryAt } : {}),
          });
          if (retry) result.requeued += 1;
          else result.failed += 1;
          if (!(error instanceof SummaryRepairNotReadyError)) onError?.(error);
        }
      }),
    );
    return result;
  };

  return {
    start: () => {
      if (timer) return;
      void runTick().catch((error) => onError?.(error));
      timer = setInterval(() => void runTick().catch((error) => onError?.(error)), intervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
    tick: () => {
      if (active) return active;
      active = runTick().finally(() => {
        active = undefined;
      });
      return active;
    },
  };
}

function startInput(
  source: NonNullable<Awaited<ReturnType<DocumentCompilationAttemptRepository["get"]>>>,
): StartDocumentCompilationJobInput {
  return {
    ...(source.capabilityGrantId ? { capabilityGrantId: source.capabilityGrantId } : {}),
    documentAssetId: source.documentAssetId,
    knowledgeSpaceId: source.knowledgeSpaceId,
    ...(source.permissionSnapshot ? { permissionSnapshot: source.permissionSnapshot } : {}),
    ...(source.requestedBySubjectId ? { requestedBySubjectId: source.requestedBySubjectId } : {}),
    tenantId: source.tenantId,
    version: source.documentVersion,
  };
}

class SummaryRepairNotReadyError extends Error {
  constructor() {
    super("PageIndex summary repair waits for the source compilation to complete");
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PageIndex summary repair ${label} must be a positive integer`);
  }
}
