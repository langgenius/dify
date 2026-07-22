import { EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createConflictDetectionService } from "./conflict-detection";
import { createFreshnessCheckingService } from "./freshness-checking";
import { createResearchTaskDryRunPlanner } from "./research-task-planning";
import { createBudgetedResearchWorkflow } from "./research-workflow";
import { createSourceComparisonService } from "./source-comparison";

describe("budgeted research workflow", () => {
  it("runs retrieve, compare, conflict, freshness, citation, and report steps within budget", async () => {
    const calls: string[] = [];
    const retrieveCalls: unknown[] = [];
    const workflow = createBudgetedResearchWorkflow({
      conflictDetection: createConflictDetectionService({
        detector: {
          detect: async (input) => {
            calls.push("conflict");
            const finding = itemAt(input.findings, 0);

            return {
              conflicts: [
                {
                  confidence: 0.91,
                  evidenceNodeIds: finding.evidenceNodeIds,
                  severity: "blocking",
                  summary: "Sources disagree on the notice window.",
                },
              ],
              summary: "One conflict.",
            };
          },
        },
        now: () => "2026-05-12T19:02:00.000Z",
      }),
      freshnessChecking: createFreshnessCheckingService({
        now: () => "2026-05-12T19:03:00.000Z",
        staleAfterSeconds: 86_400,
      }),
      maxCitations: 8,
      maxTopK: 8,
      now: () => "2026-05-12T19:04:00.000Z",
      planner: dryRunPlanner(),
      retriever: {
        retrieve: async (input) => {
          calls.push("retrieve");
          retrieveCalls.push(input);

          return workflowBundle();
        },
      },
      sourceComparison: createSourceComparisonService({
        judge: {
          compare: async (input) => {
            calls.push("compare");
            const first = itemAt(input.sources, 0);
            const second = itemAt(input.sources, 1);

            return {
              findings: [
                {
                  evidenceNodeIds: [first.nodeId, second.nodeId],
                  kind: "difference",
                  summary: "Notice windows differ.",
                },
              ],
              summary: "Sources differ.",
            };
          },
        },
        now: () => "2026-05-12T19:01:00.000Z",
      }),
    });

    const report = await workflow.run({
      budgetUsd: 1,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      query: " compare renewal policy ",
      topK: 3,
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a01",
    });

    expect(calls).toEqual(["retrieve", "compare", "conflict"]);
    expect(retrieveCalls[0]).toMatchObject({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      query: "compare renewal policy",
      topK: 3,
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a01",
    });
    expect(report).toMatchObject({
      citations: [
        { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d01" },
        { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d02" },
      ],
      completedAt: "2026-05-12T19:04:00.000Z",
      conflictReport: {
        conflictCount: 1,
      },
      evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b01",
      freshnessReport: {
        staleCount: 1,
      },
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      query: "compare renewal policy",
      sourceComparisonReport: {
        sourceCount: 2,
      },
      status: "completed",
      strategyVersion: "budgeted-research-workflow-v1",
      summary: "Sources differ. One conflict. 1 stale evidence item(s) found.",
      traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9a01",
    });

    sourceLocationAt(report.citations, 0).sectionPath.push("mutated");
    const second = await workflow.run({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      query: "compare renewal policy",
      topK: 3,
    });
    expect(sourceLocationAt(second.citations, 0).sectionPath).toEqual(["Policy"]);
  });

  it("blocks budget, limit, and unbounded topK requests before retrieval", async () => {
    const calls: string[] = [];
    const workflow = createBudgetedResearchWorkflow({
      conflictDetection: createConflictDetectionService({
        detector: { detect: async () => ({ conflicts: [], summary: "none" }) },
      }),
      freshnessChecking: createFreshnessCheckingService(),
      maxTopK: 4,
      planner: dryRunPlanner(),
      retriever: {
        retrieve: async () => {
          calls.push("retrieve");
          return workflowBundle();
        },
      },
      sourceComparison: createSourceComparisonService({
        judge: { compare: async () => ({ findings: [], summary: "none" }) },
      }),
    });

    await expect(
      workflow.run({
        budgetUsd: 0,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "expensive research",
        topK: 3,
      }),
    ).rejects.toThrow("Budgeted research workflow budget exceeded");

    await expect(
      workflow.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limits: { maxToolCalls: 1 },
        query: "bounded research",
        topK: 3,
      }),
    ).rejects.toThrow("Budgeted research workflow limits exceeded");

    await expect(
      workflow.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "too broad",
        topK: 5,
      }),
    ).rejects.toThrow("Budgeted research workflow topK exceeds maxTopK=4");

    expect(calls).toEqual([]);
  });

  it("rejects invalid configuration, invalid inputs, and excessive citation output", async () => {
    expect(() =>
      createBudgetedResearchWorkflow({
        conflictDetection: createConflictDetectionService({
          detector: { detect: async () => ({ conflicts: [], summary: "none" }) },
        }),
        freshnessChecking: createFreshnessCheckingService(),
        maxTopK: 0,
        planner: dryRunPlanner(),
        retriever: { retrieve: async () => workflowBundle() },
        sourceComparison: createSourceComparisonService({
          judge: { compare: async () => ({ findings: [], summary: "none" }) },
        }),
      }),
    ).toThrow("Budgeted research workflow maxTopK must be at least 1");

    expect(() =>
      createBudgetedResearchWorkflow({
        conflictDetection: createConflictDetectionService({
          detector: { detect: async () => ({ conflicts: [], summary: "none" }) },
        }),
        freshnessChecking: createFreshnessCheckingService(),
        maxCitations: 0,
        planner: dryRunPlanner(),
        retriever: { retrieve: async () => workflowBundle() },
        sourceComparison: createSourceComparisonService({
          judge: { compare: async () => ({ findings: [], summary: "none" }) },
        }),
      }),
    ).toThrow("Budgeted research workflow maxCitations must be at least 1");

    const calls: string[] = [];
    const workflow = createBudgetedResearchWorkflow({
      conflictDetection: createConflictDetectionService({
        detector: { detect: async () => ({ conflicts: [], summary: "none" }) },
      }),
      freshnessChecking: createFreshnessCheckingService(),
      maxCitations: 1,
      planner: dryRunPlanner(),
      retriever: {
        retrieve: async () => {
          calls.push("retrieve");
          return workflowBundle();
        },
      },
      sourceComparison: createSourceComparisonService({
        judge: { compare: async () => ({ findings: [], summary: "none" }) },
      }),
    });

    await expect(
      workflow.run({
        knowledgeSpaceId: " ",
        query: "bounded research",
      }),
    ).rejects.toThrow("Budgeted research workflow knowledgeSpaceId is required");

    await expect(
      workflow.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: " ",
      }),
    ).rejects.toThrow("Budgeted research workflow query is required");

    await expect(
      workflow.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "bounded research",
        topK: 0,
      }),
    ).rejects.toThrow("Budgeted research workflow topK must be at least 1");

    expect(calls).toEqual([]);

    await expect(
      workflow.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "bounded research",
        topK: 2,
      }),
    ).rejects.toThrow("Budgeted research workflow citation count exceeds maxCitations=1");
    expect(calls).toEqual(["retrieve"]);
  });

  it("does not collect one more citation than maxCitations before failing", async () => {
    const workflow = createBudgetedResearchWorkflow({
      conflictDetection: createConflictDetectionService({
        detector: { detect: async () => ({ conflicts: [], summary: "none" }) },
      }),
      freshnessChecking: createFreshnessCheckingService(),
      maxCitations: 1,
      planner: dryRunPlanner(),
      retriever: {
        retrieve: async () =>
          EvidenceBundleSchema.parse({
            ...workflowBundle(),
            items: [
              evidenceItem({
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d01",
                freshness: { status: "fresh" as const },
                nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9c01",
                sectionPath: ["A"],
                text: "A",
              }),
              evidenceItem({
                documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d02",
                freshness: { status: "fresh" as const },
                nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9c02",
                sectionPath: ["B"],
                text: "B",
              }),
            ],
          }),
      },
      sourceComparison: createSourceComparisonService({
        judge: { compare: async () => ({ findings: [], summary: "none" }) },
      }),
    });

    await expect(
      workflow.run({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "bounded research",
        topK: 2,
      }),
    ).rejects.toThrow("Budgeted research workflow citation count exceeds maxCitations=1");
  });

  it("runs source comparison and freshness checks in parallel before conflict detection", async () => {
    const calls: string[] = [];
    let signalComparisonStarted: (() => void) | undefined;
    let releaseComparison: (() => void) | undefined;
    const comparisonStarted = new Promise<void>((resolve) => {
      signalComparisonStarted = resolve;
    });
    const workflow = createBudgetedResearchWorkflow({
      conflictDetection: {
        detect: async () => {
          calls.push("conflict");
          return {
            conflictCount: 0,
            conflicts: [],
            detectedAt: "2026-05-12T19:00:03.000Z",
            evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b01",
            knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            query: "compare renewal policy",
            strategyVersion: "conflict-detection-v1" as const,
            summary: "none",
          };
        },
      },
      freshnessChecking: {
        check: async () => {
          calls.push("freshness");
          await comparisonStarted;
          return {
            checkedAt: "2026-05-12T19:00:02.000Z",
            evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b01",
            knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            query: "compare renewal policy",
            staleCount: 0,
            strategyVersion: "freshness-check-v1" as const,
            summary: "fresh",
            warnings: [],
          };
        },
      },
      planner: dryRunPlanner(),
      retriever: { retrieve: async () => workflowBundle() },
      sourceComparison: {
        compare: async () => {
          calls.push("compare");
          signalComparisonStarted?.();
          await new Promise<void>((release) => {
            releaseComparison = release;
          });
          return {
            comparedAt: "2026-05-12T19:00:01.000Z",
            evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b01",
            findings: [],
            knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
            query: "compare renewal policy",
            sourceCount: 0,
            strategyVersion: "source-comparison-v1" as const,
            summary: "compared",
          };
        },
      },
    });

    const runPromise = workflow.run({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      query: "parallel research",
    });
    await comparisonStarted;
    expect(calls).toEqual(["compare", "freshness"]);
    releaseComparison?.();
    await expect(runPromise).resolves.toMatchObject({ status: "completed" });
  });
});

function dryRunPlanner() {
  return createResearchTaskDryRunPlanner({
    retrievalPlanner: {
      plan: (input) => ({
        denseTopK: input.topK * 2,
        ftsTopK: input.topK * 2,
        fusionLimit: input.topK,
        queryLanguage: "latin",
        requestedMode: input.mode ?? "research",
        rerankCandidateLimit: input.topK,
        resolvedMode: "research",
        strategyVersion: "retrieval-planner-v1",
        topK: input.topK,
      }),
    },
  });
}

function workflowBundle() {
  return EvidenceBundleSchema.parse({
    createdAt: "2026-05-12T19:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9b01",
    items: [
      evidenceItem({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d01",
        freshness: { status: "fresh" as const, sourceUpdatedAt: "2026-05-12T18:59:00.000Z" },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9c01",
        sectionPath: ["Policy"],
        text: "Policy requires 30 days notice.",
      }),
      evidenceItem({
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9d02",
        freshness: { status: "stale" as const, sourceUpdatedAt: "2026-05-01T18:59:00.000Z" },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9c02",
        sectionPath: ["Email"],
        text: "Email asks for 60 days notice.",
      }),
    ],
    missingEvidence: [],
    query: "compare renewal policy",
    state: "conflict",
  });
}

function evidenceItem({
  documentAssetId,
  freshness,
  nodeId,
  sectionPath,
  text,
}: {
  readonly documentAssetId: string;
  readonly freshness: {
    readonly sourceUpdatedAt?: string | undefined;
    readonly status: "fresh" | "stale" | "unknown";
  };
  readonly nodeId: string;
  readonly sectionPath: readonly string[];
  readonly text: string;
}) {
  return {
    citations: [
      {
        documentAssetId,
        documentVersion: 1,
        sectionPath,
        startOffset: 0,
      },
    ],
    conflicts: [],
    freshness,
    metadata: {},
    nodeId,
    score: 0.85,
    scores: { final: 0.85, retrieval: 0.85 },
    text,
  };
}

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (!item) {
    throw new Error(`expected item at index ${index}`);
  }

  return item;
}

function sourceLocationAt<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (!item) {
    throw new Error(`expected source location at index ${index}`);
  }

  return item;
}
