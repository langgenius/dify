import { describe, expect, it } from "vitest";

import { createEvaluationDashboardSummary } from "./evaluation-dashboard";

describe("createEvaluationDashboardSummary", () => {
  it("summarizes bounded evaluation runs for dashboard trends", () => {
    const summary = createEvaluationDashboardSummary({
      maxRuns: 5,
      maxTrendPoints: 3,
      runs: [
        {
          citationAccuracy: 0.79,
          costUsd: 1.4,
          failedQuestions: 3,
          faithfulnessScore: 0.81,
          id: "run-1",
          latencyMs: 980,
          recallAtK: 0.84,
          runAt: "2026-05-13T10:00:00.000Z",
          totalQuestions: 12,
        },
        {
          citationAccuracy: 0.83,
          costUsd: 1.1,
          failedQuestions: 2,
          faithfulnessScore: 0.86,
          id: "run-2",
          latencyMs: 870,
          recallAtK: 0.88,
          runAt: "2026-05-13T11:00:00.000Z",
          totalQuestions: 12,
        },
        {
          citationAccuracy: 0.9,
          costUsd: 0.9,
          failedQuestions: 1,
          faithfulnessScore: 0.92,
          id: "run-3",
          latencyMs: 740,
          recallAtK: 0.91,
          runAt: "2026-05-13T12:00:00.000Z",
          totalQuestions: 12,
        },
      ],
    });

    expect(summary.latest).toMatchObject({
      citationAccuracyLabel: "90%",
      faithfulnessLabel: "92%",
      passRateLabel: "92%",
      recallLabel: "91%",
    });
    expect(summary.recallTrend.map((point) => point.label)).toEqual(["10:00", "11:00", "12:00"]);
    expect(summary.recallTrend.map((point) => point.valueLabel)).toEqual(["84%", "88%", "91%"]);
    expect(summary.citationTrend.map((point) => point.valueLabel)).toEqual(["79%", "83%", "90%"]);
    expect(summary.costLatency).toEqual({
      averageCostLabel: "$1.13",
      averageLatencyLabel: "863 ms",
      latestCostLabel: "$0.90",
      latestLatencyLabel: "740 ms",
    });
  });

  it("rejects unbounded dashboard inputs and invalid metric ranges", () => {
    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 0,
        runs: [],
      }),
    ).toThrow("Evaluation dashboard maxRuns must be at least 1");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 1.2,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard recallAtK must be between 0 and 1");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: 2,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard failedQuestions cannot exceed totalQuestions");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: " ",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard run id is required");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "not-a-date",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard runAt must be a valid timestamp");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: -0.1,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard citationAccuracy must be between 0 and 1");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: Number.NaN,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard faithfulnessScore must be between 0 and 1");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 0,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard totalQuestions must be at least 1");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: -1,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard failedQuestions must be non-negative");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: -0.01,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard costUsd must be non-negative");

    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: -1,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard latencyMs must be non-negative");
  });

  it("bounds run count and handles empty dashboard data", () => {
    expect(() =>
      createEvaluationDashboardSummary({
        maxRuns: 1,
        runs: [
          {
            citationAccuracy: 0.5,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: "run-1",
            latencyMs: 10,
            recallAtK: 0.8,
            runAt: "2026-05-13T10:00:00.000Z",
            totalQuestions: 1,
          },
          {
            citationAccuracy: 0.6,
            costUsd: 0,
            failedQuestions: 0,
            faithfulnessScore: 0.9,
            id: "run-2",
            latencyMs: 10,
            recallAtK: 0.9,
            runAt: "2026-05-13T11:00:00.000Z",
            totalQuestions: 1,
          },
        ],
      }),
    ).toThrow("Evaluation dashboard runs exceeds maxRuns=1");

    expect(() =>
      createEvaluationDashboardSummary({
        maxTrendPoints: 0,
        runs: [],
      }),
    ).toThrow("Evaluation dashboard maxTrendPoints must be at least 1");

    expect(createEvaluationDashboardSummary({ runs: [] })).toEqual({
      citationTrend: [],
      costLatency: {
        averageCostLabel: "$0.00",
        averageLatencyLabel: "0 ms",
        latestCostLabel: "$0.00",
        latestLatencyLabel: "0 ms",
      },
      latest: {
        citationAccuracyLabel: "0%",
        faithfulnessLabel: "0%",
        passRateLabel: "100%",
        recallLabel: "0%",
        runId: "",
      },
      recallTrend: [],
    });
  });
});
