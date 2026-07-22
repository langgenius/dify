import type { SourceProductWorkflowRepository, SourceWorkflowRun } from "./source-product-workflow";

export interface SourceSyncPolicyRuntime {
  start(): () => Promise<void>;
  stop(): Promise<void>;
  tick(): Promise<readonly SourceWorkflowRun[]>;
}

/** Durable scheduler: repository enqueue atomically advances each policy with run + outbox. */
export function createSourceSyncPolicyRuntime(input: {
  readonly intervalMs?: number | undefined;
  readonly maxDuePerTick?: number | undefined;
  readonly maxExecutionAttempts?: number | undefined;
  readonly now?: (() => string) | undefined;
  readonly repository: Pick<SourceProductWorkflowRepository, "enqueueDueSyncRuns">;
}): SourceSyncPolicyRuntime {
  const intervalMs = input.intervalMs ?? 30_000;
  const maxDuePerTick = input.maxDuePerTick ?? 25;
  const maxExecutionAttempts = input.maxExecutionAttempts ?? 5;
  const now = input.now ?? (() => new Date().toISOString());
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 100) {
    throw new Error("Source sync scheduler interval must be at least 100ms");
  }
  if (!Number.isSafeInteger(maxDuePerTick) || maxDuePerTick < 1 || maxDuePerTick > 1_000) {
    throw new Error("Source sync scheduler batch size must be 1-1000");
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let lane: Promise<unknown> = Promise.resolve();
  let stopping = false;
  const tick = () =>
    input.repository.enqueueDueSyncRuns({
      limit: maxDuePerTick,
      maxExecutionAttempts,
      now: now(),
    });
  return {
    tick,
    start: () => {
      if (!timer) {
        timer = setInterval(() => {
          if (stopping) return;
          lane = lane.then(tick, tick).catch(() => undefined);
        }, intervalMs);
        timer.unref?.();
      }
      return async () => {
        stopping = true;
        if (timer) clearInterval(timer);
        timer = undefined;
        await lane;
      };
    },
    stop: async () => {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await lane;
    },
  };
}
