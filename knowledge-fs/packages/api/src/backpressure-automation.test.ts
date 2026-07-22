import { describe, expect, it } from "vitest";

import { createBackpressureAutomation } from "./backpressure-automation";

describe("backpressure automation", () => {
  it("downgrades high-latency research mode and pauses low-priority tasks under queue pressure", async () => {
    const paused: unknown[] = [];
    const automation = createBackpressureAutomation({
      highLatencyMs: 1_000,
      maxQueuedJobs: 10,
      now: () => 1_000,
      pauseForMs: 30_000,
      pauser: {
        pause: async (input) => {
          paused.push(input);
        },
      },
    });

    const decision = await automation.evaluate({
      jobs: {
        stats: async () => ({
          canceled: 0,
          completed: 10,
          failed: 1,
          queued: 42,
          running: 8,
        }),
      },
      metrics: { p95LatencyMs: 1_250 },
      priority: "low",
      requestedMode: "research",
      taskId: "research-task-job-1",
    });

    expect(decision).toEqual({
      action: "pause",
      effectiveMode: "fast",
      evaluatedAt: 1_000,
      reasons: ["high-latency", "queue-depth"],
      resumeAfter: 31_000,
      stats: {
        canceled: 0,
        completed: 10,
        failed: 1,
        queued: 42,
        running: 8,
      },
      strategyVersion: "backpressure-automation-v1",
    });
    expect(paused).toEqual([
      {
        reason: "Backpressure: high-latency, queue-depth",
        resumeAfter: 31_000,
        taskId: "research-task-job-1",
      },
    ]);
  });

  it("allows normal traffic and only downgrades non-low-priority work under pressure", async () => {
    const paused: unknown[] = [];
    const automation = createBackpressureAutomation({
      highLatencyMs: 1_000,
      maxQueuedJobs: 10,
      pauser: {
        pause: async (input) => {
          paused.push(input);
        },
      },
    });

    await expect(
      automation.evaluate({
        jobs: {
          stats: async () => ({ canceled: 0, completed: 0, failed: 0, queued: 2, running: 1 }),
        },
        metrics: { p95LatencyMs: 500 },
        priority: "low",
        requestedMode: "deep",
        taskId: "research-task-job-1",
      }),
    ).resolves.toMatchObject({
      action: "allow",
      effectiveMode: "deep",
      reasons: [],
    });

    await expect(
      automation.evaluate({
        jobs: {
          stats: async () => ({ canceled: 0, completed: 0, failed: 0, queued: 12, running: 1 }),
        },
        metrics: { p95LatencyMs: 500 },
        priority: "high",
        requestedMode: "research",
        taskId: "research-task-job-2",
      }),
    ).resolves.toMatchObject({
      action: "downgrade",
      effectiveMode: "fast",
      reasons: ["queue-depth"],
    });
    expect(paused).toEqual([]);
  });

  it("rejects invalid thresholds and unbounded metric input", async () => {
    expect(() =>
      createBackpressureAutomation({
        highLatencyMs: 0,
        maxQueuedJobs: 10,
        pauser: { pause: async () => undefined },
      }),
    ).toThrow("Backpressure highLatencyMs must be at least 1");

    const automation = createBackpressureAutomation({
      highLatencyMs: 1_000,
      maxQueuedJobs: 10,
      pauser: { pause: async () => undefined },
    });

    await expect(
      automation.evaluate({
        jobs: {
          stats: async () => ({ canceled: 0, completed: 0, failed: 0, queued: 0, running: 0 }),
        },
        metrics: { p95LatencyMs: Number.POSITIVE_INFINITY },
        priority: "low",
        requestedMode: "research",
      }),
    ).rejects.toThrow("Backpressure p95LatencyMs must be a finite non-negative number");
  });
});
