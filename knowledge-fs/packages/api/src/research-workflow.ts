import { type Citation, type EvidenceBundle, EvidenceBundleSchema } from "@knowledge/core";

import type { ConflictDetectionReport, ConflictDetectionService } from "./conflict-detection";
import type { FreshnessCheckingReport, FreshnessCheckingService } from "./freshness-checking";
import {
  type ResearchTaskDryRunPlan,
  type ResearchTaskDryRunPlanner,
  type ResearchTaskLimits,
  type ResearchTaskResolvedMode,
  evaluateResearchTaskLimits,
} from "./research-task-planning";
import type { SourceComparisonReport, SourceComparisonService } from "./source-comparison";

export interface BudgetedResearchRetrieverInput {
  readonly knowledgeSpaceId: string;
  readonly mode?: ResearchTaskResolvedMode | undefined;
  readonly query: string;
  readonly topK: number;
  readonly traceId?: string | undefined;
}

export interface BudgetedResearchRetriever {
  retrieve(input: BudgetedResearchRetrieverInput): Promise<EvidenceBundle>;
}

export interface BudgetedResearchWorkflowOptions {
  readonly conflictDetection: ConflictDetectionService;
  readonly freshnessChecking: FreshnessCheckingService;
  readonly maxCitations?: number | undefined;
  readonly maxTopK?: number | undefined;
  readonly now?: () => string;
  readonly planner: ResearchTaskDryRunPlanner;
  readonly retriever: BudgetedResearchRetriever;
  readonly sourceComparison: SourceComparisonService;
}

export interface BudgetedResearchWorkflowInput {
  readonly budgetUsd?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly limits?: ResearchTaskLimits | undefined;
  readonly mode?: ResearchTaskResolvedMode | undefined;
  readonly query: string;
  readonly topK?: number | undefined;
  readonly traceId?: string | undefined;
}

export interface BudgetedResearchWorkflowReport {
  readonly citations: readonly Citation[];
  readonly completedAt: string;
  readonly conflictReport: ConflictDetectionReport;
  readonly evidenceBundleId: string;
  readonly freshnessReport: FreshnessCheckingReport;
  readonly knowledgeSpaceId: string;
  readonly plan: ResearchTaskDryRunPlan;
  readonly query: string;
  readonly sourceComparisonReport: SourceComparisonReport;
  readonly status: "completed";
  readonly strategyVersion: "budgeted-research-workflow-v1";
  readonly summary: string;
  readonly traceId?: string | undefined;
}

export interface BudgetedResearchWorkflow {
  run(input: BudgetedResearchWorkflowInput): Promise<BudgetedResearchWorkflowReport>;
}

const defaultMaxCitations = 100;
const defaultMaxTopK = 50;

export function createBudgetedResearchWorkflow({
  conflictDetection,
  freshnessChecking,
  maxCitations = defaultMaxCitations,
  maxTopK = defaultMaxTopK,
  now = () => new Date().toISOString(),
  planner,
  retriever,
  sourceComparison,
}: BudgetedResearchWorkflowOptions): BudgetedResearchWorkflow {
  if (!Number.isSafeInteger(maxTopK) || maxTopK < 1) {
    throw new Error("Budgeted research workflow maxTopK must be at least 1");
  }

  if (!Number.isSafeInteger(maxCitations) || maxCitations < 1) {
    throw new Error("Budgeted research workflow maxCitations must be at least 1");
  }

  return {
    run: async (input) => {
      const knowledgeSpaceId = input.knowledgeSpaceId.trim();
      const query = input.query.trim();
      const topK = input.topK ?? 10;

      if (!knowledgeSpaceId) {
        throw new Error("Budgeted research workflow knowledgeSpaceId is required");
      }

      if (!query) {
        throw new Error("Budgeted research workflow query is required");
      }

      if (!Number.isSafeInteger(topK) || topK < 1) {
        throw new Error("Budgeted research workflow topK must be at least 1");
      }

      if (topK > maxTopK) {
        throw new Error(`Budgeted research workflow topK exceeds maxTopK=${maxTopK}`);
      }

      const plan = planner.plan({
        budgetUsd: input.budgetUsd,
        knowledgeSpaceId,
        mode: input.mode,
        query,
        topK,
        traceId: input.traceId,
      });

      if (plan.budget.exceedsBudget) {
        throw new Error("Budgeted research workflow budget exceeded");
      }

      const limitEvaluation = evaluateResearchTaskLimits(plan, input.limits);

      if (!limitEvaluation.allowed) {
        throw new Error("Budgeted research workflow limits exceeded");
      }

      const evidenceBundle = EvidenceBundleSchema.parse(
        cloneJson(
          await retriever.retrieve({
            knowledgeSpaceId,
            mode: input.mode,
            query,
            topK,
            traceId: input.traceId,
          }),
        ),
      );
      const [sourceComparisonReport, freshnessReport] = await Promise.all([
        sourceComparison.compare({
          evidenceBundle,
          knowledgeSpaceId,
          traceId: input.traceId,
        }),
        freshnessChecking.check({
          evidenceBundle,
          knowledgeSpaceId,
          traceId: input.traceId,
        }),
      ]);
      const conflictReport = await conflictDetection.detect({
        comparisonReport: sourceComparisonReport,
        knowledgeSpaceId,
        traceId: input.traceId,
      });
      const citations = collectCitations(evidenceBundle, maxCitations);

      return cloneJson({
        citations,
        completedAt: now(),
        conflictReport,
        evidenceBundleId: evidenceBundle.id,
        freshnessReport,
        knowledgeSpaceId,
        plan,
        query,
        sourceComparisonReport,
        status: "completed",
        strategyVersion: "budgeted-research-workflow-v1",
        summary: [
          sourceComparisonReport.summary,
          conflictReport.summary,
          freshnessReport.summary,
        ].join(" "),
        ...(input.traceId ? { traceId: input.traceId } : {}),
      } satisfies BudgetedResearchWorkflowReport);
    },
  };
}

function collectCitations(evidenceBundle: EvidenceBundle, maxCitations: number): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const item of evidenceBundle.items) {
    for (const citation of item.citations) {
      const key = JSON.stringify(citation);

      if (!seen.has(key)) {
        if (citations.length >= maxCitations) {
          throw new Error(
            `Budgeted research workflow citation count exceeds maxCitations=${maxCitations}`,
          );
        }

        seen.add(key);
        citations.push(cloneJson(citation));
      }
    }
  }

  return citations;
}

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
