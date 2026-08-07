import type {
  DocumentOutline,
  DocumentOutlineNode,
  GoldenQuestion,
  KnowledgeSpaceModelSelection,
} from "@knowledge/core";

import {
  PageIndexLayeredTreePromptVersion,
  type PageIndexLayeredTreeSearch,
  PageIndexLayeredTreeSearchContractError,
  createInitialPageIndexLayeredTreeCheckpoint,
} from "./page-index-layered-tree-search";

export interface PageIndexExpectedEvidenceRange {
  readonly documentAssetId: string;
  readonly endOffset: number;
  readonly evidenceId: string;
  readonly startOffset: number;
}

export interface PageIndexFindabilitySummaryRepairQueue {
  enqueue(input: {
    readonly documentAssetId: string;
    readonly reason: "low-findability";
  }): Promise<void>;
}

export interface PageIndexFindabilityEvaluatorOptions {
  readonly evaluatorVersion: string;
  readonly layeredTreeSearch: PageIndexLayeredTreeSearch;
  readonly maxQuestions: number;
  readonly maxTreeDepth: number;
  readonly minMeanReciprocalRank: number;
  readonly minPathRecallAtK: number;
  readonly minQuestions: number;
  readonly minRecallAtK: number;
  readonly summaryRepair?: PageIndexFindabilitySummaryRepairQueue | undefined;
  readonly topK: number;
}

export interface EvaluatePageIndexFindabilityInput {
  readonly evidenceRanges: readonly PageIndexExpectedEvidenceRange[];
  readonly outline: DocumentOutline;
  /** Existing human-maintained labels only. This evaluator has no question writer dependency. */
  readonly questions: readonly GoldenQuestion[];
  readonly reasoningModel: KnowledgeSpaceModelSelection;
  readonly tenantId: string;
}

export interface PageIndexFindabilityEvaluationResult {
  readonly abstentionRate: number;
  readonly evaluatorVersion: string;
  readonly meanReciprocalRank: number;
  readonly model: KnowledgeSpaceModelSelection;
  readonly pathRecallAtK: number;
  readonly promptVersion: typeof PageIndexLayeredTreePromptVersion;
  readonly recallAtK: number;
  readonly recommendedRoute: "hybrid" | "layered" | "unchanged";
  readonly sampleCount: number;
  readonly status: "failed" | "not-evaluated" | "passed";
  readonly summaryRepairRequested: boolean;
  readonly topK: number;
}

export interface PageIndexFindabilityEvaluator {
  evaluate(input: EvaluatePageIndexFindabilityInput): Promise<PageIndexFindabilityEvaluationResult>;
}

/**
 * Evaluates whether a title-and-summary-only tree can locate human-labelled evidence. It never
 * creates Golden Questions. Missing/insufficient labels produce `not-evaluated` and leave routing
 * unchanged.
 */
export function createPageIndexFindabilityEvaluator({
  evaluatorVersion,
  layeredTreeSearch,
  maxQuestions,
  maxTreeDepth,
  minMeanReciprocalRank,
  minPathRecallAtK,
  minQuestions,
  minRecallAtK,
  summaryRepair,
  topK,
}: PageIndexFindabilityEvaluatorOptions): PageIndexFindabilityEvaluator {
  const normalizedVersion = evaluatorVersion.trim();
  if (!normalizedVersion) {
    throw new Error("PageIndex findability evaluatorVersion is required");
  }
  validatePositiveInteger(maxQuestions, "maxQuestions");
  validatePositiveInteger(maxTreeDepth, "maxTreeDepth");
  validatePositiveInteger(minQuestions, "minQuestions");
  validatePositiveInteger(topK, "topK");
  if (minQuestions > maxQuestions) {
    throw new Error("PageIndex findability minQuestions must not exceed maxQuestions");
  }
  validateThreshold(minMeanReciprocalRank, "minMeanReciprocalRank");
  validateThreshold(minPathRecallAtK, "minPathRecallAtK");
  validateThreshold(minRecallAtK, "minRecallAtK");

  return {
    evaluate: async (input) => {
      const evidenceToNode = mapExpectedEvidenceToOutlineNodes({
        evidenceRanges: input.evidenceRanges,
        outline: input.outline,
      });
      const samples = input.questions
        .map((question) => ({
          expectedNodeIds: new Set(
            question.expectedEvidenceIds
              .map((evidenceId) => evidenceToNode.get(evidenceId))
              .filter((nodeId): nodeId is string => nodeId !== undefined),
          ),
          question,
        }))
        .filter((sample) => sample.expectedNodeIds.size > 0)
        .sort((left, right) => left.question.id.localeCompare(right.question.id))
        .slice(0, maxQuestions);
      if (samples.length < minQuestions) {
        return result({
          abstentionRate: 0,
          evaluatorVersion: normalizedVersion,
          meanReciprocalRank: 0,
          model: input.reasoningModel,
          pathRecallAtK: 0,
          recallAtK: 0,
          recommendedRoute: "unchanged",
          sampleCount: samples.length,
          status: "not-evaluated",
          summaryRepairRequested: false,
          topK,
        });
      }

      const pathsByNodeId = outlinePaths(input.outline.nodes);
      let abstentions = 0;
      let exactHits = 0;
      let pathHits = 0;
      let reciprocalRankTotal = 0;
      for (const sample of samples) {
        let selectedNodeIds: readonly string[] = [];
        try {
          let checkpoint = createInitialPageIndexLayeredTreeCheckpoint({
            outline: input.outline,
            query: sample.question.question,
          });
          while (!checkpoint.completed && checkpoint.depth < maxTreeDepth) {
            checkpoint = (
              await layeredTreeSearch.step({
                checkpoint,
                outline: input.outline,
                query: sample.question.question,
                reasoningModel: input.reasoningModel,
                tenantId: input.tenantId,
              })
            ).checkpoint;
          }
          selectedNodeIds = [...checkpoint.openSelections]
            .sort(
              (left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId),
            )
            .slice(0, topK)
            .map((entry) => entry.nodeId);
        } catch (error) {
          if (
            error instanceof PageIndexLayeredTreeSearchContractError &&
            error.failureKind === "integrity"
          ) {
            throw error;
          }
          selectedNodeIds = [];
        }
        if (selectedNodeIds.length === 0) {
          abstentions += 1;
          continue;
        }
        const firstExactRank = selectedNodeIds.findIndex((nodeId) =>
          sample.expectedNodeIds.has(nodeId),
        );
        if (firstExactRank >= 0) {
          exactHits += 1;
          reciprocalRankTotal += 1 / (firstExactRank + 1);
        }
        if (
          selectedNodeIds.some((selectedNodeId) =>
            [...sample.expectedNodeIds].some((expectedNodeId) =>
              sameTreePath(selectedNodeId, expectedNodeId, pathsByNodeId),
            ),
          )
        ) {
          pathHits += 1;
        }
      }

      const sampleCount = samples.length;
      const recallAtK = exactHits / sampleCount;
      const meanReciprocalRank = reciprocalRankTotal / sampleCount;
      const pathRecallAtK = pathHits / sampleCount;
      const abstentionRate = abstentions / sampleCount;
      const passed =
        recallAtK >= minRecallAtK &&
        meanReciprocalRank >= minMeanReciprocalRank &&
        pathRecallAtK >= minPathRecallAtK;
      let summaryRepairRequested = false;
      if (!passed && summaryRepair) {
        await summaryRepair.enqueue({
          documentAssetId: input.outline.documentAssetId,
          reason: "low-findability",
        });
        summaryRepairRequested = true;
      }
      return result({
        abstentionRate,
        evaluatorVersion: normalizedVersion,
        meanReciprocalRank,
        model: input.reasoningModel,
        pathRecallAtK,
        recallAtK,
        recommendedRoute: passed ? "layered" : "hybrid",
        sampleCount,
        status: passed ? "passed" : "failed",
        summaryRepairRequested,
        topK,
      });
    },
  };
}

export function mapExpectedEvidenceToOutlineNodes({
  evidenceRanges,
  outline,
}: {
  readonly evidenceRanges: readonly PageIndexExpectedEvidenceRange[];
  readonly outline: DocumentOutline;
}): ReadonlyMap<string, string> {
  const nodes = flattenOutlineNodes(outline.nodes).filter(
    (node) => node.startOffset !== undefined && node.endOffset !== undefined,
  );
  const output = new Map<string, string>();
  for (const range of evidenceRanges) {
    if (
      range.documentAssetId !== outline.documentAssetId ||
      !range.evidenceId.trim() ||
      !Number.isSafeInteger(range.startOffset) ||
      !Number.isSafeInteger(range.endOffset) ||
      range.startOffset < 0 ||
      range.endOffset <= range.startOffset
    ) {
      continue;
    }
    const covering = nodes
      .filter(
        (node) =>
          (node.startOffset as number) <= range.startOffset &&
          (node.endOffset as number) >= range.endOffset,
      )
      .sort(
        (left, right) =>
          right.level - left.level ||
          nodeWidth(left) - nodeWidth(right) ||
          left.id.localeCompare(right.id),
      )[0];
    if (covering) {
      output.set(range.evidenceId, covering.id);
    }
  }
  return output;
}

function outlinePaths(
  nodes: readonly DocumentOutlineNode[],
): ReadonlyMap<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>();
  const visit = (items: readonly DocumentOutlineNode[], ancestors: readonly string[]) => {
    for (const node of items) {
      const path = [...ancestors, node.id];
      paths.set(node.id, path);
      visit(node.children, path);
    }
  };
  visit(nodes, []);
  return paths;
}

function sameTreePath(
  leftNodeId: string,
  rightNodeId: string,
  pathsByNodeId: ReadonlyMap<string, readonly string[]>,
): boolean {
  const left = pathsByNodeId.get(leftNodeId);
  const right = pathsByNodeId.get(rightNodeId);
  return Boolean(left && right && (isPrefix(left, right) || isPrefix(right, left)));
}

function isPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((entry, index) => value[index] === entry);
}

function flattenOutlineNodes(
  nodes: readonly DocumentOutlineNode[],
): readonly DocumentOutlineNode[] {
  return nodes.flatMap((node) => [node, ...flattenOutlineNodes(node.children)]);
}

function nodeWidth(node: DocumentOutlineNode): number {
  return (node.endOffset as number) - (node.startOffset as number);
}

function result(
  input: Omit<PageIndexFindabilityEvaluationResult, "promptVersion">,
): PageIndexFindabilityEvaluationResult {
  return {
    ...input,
    abstentionRate: roundMetric(input.abstentionRate),
    meanReciprocalRank: roundMetric(input.meanReciprocalRank),
    pathRecallAtK: roundMetric(input.pathRecallAtK),
    promptVersion: PageIndexLayeredTreePromptVersion,
    recallAtK: roundMetric(input.recallAtK),
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validateThreshold(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`PageIndex findability ${name} must be within [0, 1]`);
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PageIndex findability ${name} must be a positive integer`);
  }
}
