import type { JobQueueAdapter, JobQueueStats } from "@knowledge/core";

import type { ResearchTaskPlanMode } from "./research-task-planning";

export type BackpressurePriority = "high" | "low" | "normal";
export type BackpressureReason = "high-latency" | "queue-depth";
export type BackpressureAction = "allow" | "downgrade" | "pause";

export interface BackpressureMetrics {
  readonly p95LatencyMs: number;
}

export interface BackpressureTaskPauserInput {
  readonly reason: string;
  readonly resumeAfter: number;
  readonly taskId: string;
}

export interface BackpressureTaskPauser {
  pause(input: BackpressureTaskPauserInput): Promise<void>;
}

export interface BackpressureAutomationOptions {
  readonly highLatencyMs: number;
  readonly maxQueuedJobs: number;
  readonly now?: () => number;
  readonly pauseForMs?: number | undefined;
  readonly pauser: BackpressureTaskPauser;
}

export interface BackpressureEvaluationInput {
  readonly jobs: Pick<JobQueueAdapter, "stats">;
  readonly metrics: BackpressureMetrics;
  readonly priority: BackpressurePriority;
  readonly requestedMode: ResearchTaskPlanMode;
  readonly taskId?: string | undefined;
}

export interface BackpressureDecision {
  readonly action: BackpressureAction;
  readonly effectiveMode: ResearchTaskPlanMode;
  readonly evaluatedAt: number;
  readonly reasons: readonly BackpressureReason[];
  readonly resumeAfter?: number | undefined;
  readonly stats: JobQueueStats;
  readonly strategyVersion: "backpressure-automation-v1";
}

export interface BackpressureAutomation {
  evaluate(input: BackpressureEvaluationInput): Promise<BackpressureDecision>;
}

const defaultPauseForMs = 60_000;

export function createBackpressureAutomation({
  highLatencyMs,
  maxQueuedJobs,
  now = Date.now,
  pauseForMs = defaultPauseForMs,
  pauser,
}: BackpressureAutomationOptions): BackpressureAutomation {
  validatePositiveInteger(highLatencyMs, "highLatencyMs");
  validatePositiveInteger(maxQueuedJobs, "maxQueuedJobs");
  validatePositiveInteger(pauseForMs, "pauseForMs");

  return {
    evaluate: async (input) => {
      validateLatency(input.metrics.p95LatencyMs);
      const stats = await input.jobs.stats();
      const evaluatedAt = now();
      const reasons = collectReasons({
        highLatencyMs,
        maxQueuedJobs,
        p95LatencyMs: input.metrics.p95LatencyMs,
        stats,
      });
      const effectiveMode =
        reasons.length > 0 ? downgradeMode(input.requestedMode) : input.requestedMode;
      const shouldPause =
        reasons.length > 0 &&
        input.priority === "low" &&
        input.requestedMode === "research" &&
        input.taskId !== undefined;
      const resumeAfter = shouldPause ? evaluatedAt + pauseForMs : undefined;
      const action: BackpressureAction = shouldPause
        ? "pause"
        : effectiveMode === input.requestedMode
          ? "allow"
          : "downgrade";

      if (shouldPause) {
        const pauseResumeAfter = evaluatedAt + pauseForMs;
        await pauser.pause({
          reason: `Backpressure: ${reasons.join(", ")}`,
          resumeAfter: pauseResumeAfter,
          taskId: input.taskId,
        });
      }

      return {
        action,
        effectiveMode,
        evaluatedAt,
        reasons,
        ...(resumeAfter === undefined ? {} : { resumeAfter }),
        stats,
        strategyVersion: "backpressure-automation-v1",
      };
    },
  };
}

function collectReasons({
  highLatencyMs,
  maxQueuedJobs,
  p95LatencyMs,
  stats,
}: {
  readonly highLatencyMs: number;
  readonly maxQueuedJobs: number;
  readonly p95LatencyMs: number;
  readonly stats: JobQueueStats;
}): BackpressureReason[] {
  const reasons: BackpressureReason[] = [];

  if (p95LatencyMs >= highLatencyMs) {
    reasons.push("high-latency");
  }

  if (stats.queued > maxQueuedJobs) {
    reasons.push("queue-depth");
  }

  return reasons;
}

function downgradeMode(mode: ResearchTaskPlanMode): ResearchTaskPlanMode {
  return mode === "deep" || mode === "research" ? "fast" : mode;
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Backpressure ${label} must be at least 1`);
  }
}

function validateLatency(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Backpressure p95LatencyMs must be a finite non-negative number");
  }
}
