import type { DocumentOutline, DocumentOutlineNode } from "@knowledge/core";

import {
  type ConcurrencyGate,
  mapWithConcurrency,
  runWithAbortSignal,
} from "./bounded-concurrency";
import { cloneJsonObject } from "./json-utils";
import type { PageIndexNodeValuePrior } from "./page-index-whole-tree-selection";
import type { PageIndexWholeTreeNodeSelection } from "./page-index-whole-tree-selection";
import type {
  PublishedPageIndexRepository,
  PublishedPageIndexScope,
} from "./published-page-index-repository";
import type { HybridRetrievalItem } from "./retrieval-fusion";

export type PageIndexNodeQueueContribution = "llm" | "value";

export interface PageIndexNodeQueueOutlineInput {
  readonly documentScore: number;
  readonly generationId: string;
  readonly llmSelections: readonly PageIndexWholeTreeNodeSelection[];
  readonly outline: DocumentOutline;
  readonly rankedValueNodeIds: readonly string[];
  readonly valuesByNodeId: ReadonlyMap<string, PageIndexNodeValuePrior>;
}

export interface PageIndexNodeQueueItem {
  readonly contributions: readonly PageIndexNodeQueueContribution[];
  readonly documentAssetId: string;
  readonly documentScore: number;
  readonly generationId: string;
  readonly llmReason?: string | undefined;
  readonly llmScore?: number | undefined;
  readonly outlineId: string;
  readonly outlineNodeId: string;
  readonly priorityScore: number;
  readonly valueBreadthScore: number;
  readonly valuePeakScore: number;
}

export interface BuildPageIndexNodeQueueInput {
  readonly maxQueueItems: number;
  readonly maxValueNodesPerOutline: number;
  readonly outlines: readonly PageIndexNodeQueueOutlineInput[];
}

export interface OpenPageIndexEvidenceQueueInput {
  readonly maxConcurrentOpens: number;
  readonly maxEvidencePerRange: number;
  readonly maxFinalItems: number;
  readonly openGate?: ConcurrencyGate | undefined;
  readonly permissionScope: readonly string[];
  readonly queue: readonly PageIndexNodeQueueItem[];
  /** Reserves one request-wide resource unit immediately before a physical range open. */
  readonly reserveOpen?: (() => boolean) | undefined;
  readonly repository: Pick<PublishedPageIndexRepository, "openLeafEvidence">;
  readonly signal?: AbortSignal | undefined;
  readonly scope: PublishedPageIndexScope;
}

export interface OpenPageIndexEvidenceQueueResult {
  readonly items: HybridRetrievalItem[];
  readonly openedRangeCount: number;
  readonly truncated: boolean;
}

/** Merges layered/compatibility LLM and dense Value decisions into one bounded range-open queue. */
export function buildPageIndexNodeQueue({
  maxQueueItems,
  maxValueNodesPerOutline,
  outlines,
}: BuildPageIndexNodeQueueInput): readonly PageIndexNodeQueueItem[] {
  validatePositiveInteger(maxQueueItems, "maxQueueItems");
  validatePositiveInteger(maxValueNodesPerOutline, "maxValueNodesPerOutline");
  const queue = new Map<string, MutableQueueItem>();

  for (const context of outlines) {
    validateScore(context.documentScore, "documentScore");
    const nodesById = indexOpenableNodes(context.outline.nodes);
    for (const selection of context.llmSelections) {
      validateScore(selection.score, "llm selection score");
      if (!nodesById.has(selection.nodeId)) {
        continue;
      }
      mergeQueueItem(queue, context, selection.nodeId, {
        llmReason: selection.reason,
        llmScore: selection.score,
      });
    }
    for (const nodeId of context.rankedValueNodeIds.slice(0, maxValueNodesPerOutline)) {
      if (!nodesById.has(nodeId)) {
        continue;
      }
      const value = context.valuesByNodeId.get(nodeId);
      if (!value || value.peakValue <= 0) {
        continue;
      }
      validateScore(value.peakValue, "value peak score");
      validateScore(value.breadthValue, "value breadth score");
      mergeQueueItem(queue, context, nodeId, { value });
    }
  }

  return [...queue.values()].map(freezeQueueItem).sort(compareQueueItems).slice(0, maxQueueItems);
}

/**
 * Opens queued immutable publication ranges with bounded concurrency and deduplicates knowledge
 * nodes that appear in overlapping outline ranges.
 */
export async function openPageIndexEvidenceQueue({
  maxConcurrentOpens,
  maxEvidencePerRange,
  maxFinalItems,
  openGate,
  permissionScope,
  queue,
  reserveOpen,
  repository,
  signal,
  scope,
}: OpenPageIndexEvidenceQueueInput): Promise<OpenPageIndexEvidenceQueueResult> {
  validatePositiveInteger(maxConcurrentOpens, "maxConcurrentOpens");
  validatePositiveInteger(maxEvidencePerRange, "maxEvidencePerRange");
  validatePositiveInteger(maxFinalItems, "maxFinalItems");
  if (queue.length === 0) {
    return { items: [], openedRangeCount: 0, truncated: false };
  }

  const attempts = await mapWithConcurrency(
    queue,
    maxConcurrentOpens,
    async (selection) => {
      signal?.throwIfAborted();
      const open = async () => {
        signal?.throwIfAborted();
        // Reserve only after the shared gate admits this operation. Queued work that is canceled
        // must not consume the request-wide budget for a range that was never physically opened.
        if (reserveOpen && !reserveOpen()) return undefined;
        return {
          result: await runWithAbortSignal(
            () =>
              repository.openLeafEvidence({
                ...scope,
                documentAssetId: selection.documentAssetId,
                generationId: selection.generationId,
                limit: maxEvidencePerRange,
                outlineId: selection.outlineId,
                outlineNodeId: selection.outlineNodeId,
                permissionScope,
              }),
            signal,
          ),
          selection,
        };
      };
      return openGate ? openGate.run(open, { signal }) : open();
    },
    signal,
  );
  const opened = attempts.filter(
    (attempt): attempt is NonNullable<(typeof attempts)[number]> => attempt !== undefined,
  );
  const byNodeId = new Map<string, MutableEvidenceItem>();

  for (const { result, selection } of opened) {
    for (const evidence of result.items) {
      const projectionIds = evidence.projections.map((projection) => projection.id);
      const existing = byNodeId.get(evidence.node.id);
      if (existing) {
        existing.score = Math.max(existing.score, selection.priorityScore);
        for (const projectionId of projectionIds) {
          existing.projectionIds.add(projectionId);
        }
        for (const contribution of selection.contributions) {
          existing.contributions.add(contribution);
        }
        if (selection.llmReason) {
          existing.llmReasons.add(selection.llmReason);
        }
        existing.outlineNodeIds.add(selection.outlineNodeId);
        continue;
      }
      byNodeId.set(evidence.node.id, {
        citation: {
          ...evidence.citation,
          sectionPath: [...evidence.citation.sectionPath],
        },
        contributions: new Set(selection.contributions),
        metadata: cloneJsonObject(evidence.node.metadata),
        nodeId: evidence.node.id,
        llmReasons: new Set(selection.llmReason ? [selection.llmReason] : []),
        outlineId: selection.outlineId,
        outlineNodeIds: new Set([selection.outlineNodeId]),
        permissionScope: [...evidence.node.permissionScope],
        projectionIds: new Set(projectionIds),
        score: selection.priorityScore,
        text: evidence.node.text,
      });
    }
  }

  const allItems = [...byNodeId.values()]
    .map(freezeEvidenceItem)
    .sort((left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId));
  return {
    items: allItems.slice(0, maxFinalItems),
    openedRangeCount: opened.length,
    truncated:
      opened.length < queue.length ||
      allItems.length > maxFinalItems ||
      opened.some(({ result }) => result.truncated),
  };
}

interface MutableQueueItem {
  readonly contributions: Set<PageIndexNodeQueueContribution>;
  readonly documentAssetId: string;
  readonly documentScore: number;
  readonly generationId: string;
  llmReason?: string | undefined;
  llmScore?: number | undefined;
  readonly outlineId: string;
  readonly outlineNodeId: string;
  valueBreadthScore: number;
  valuePeakScore: number;
}

function mergeQueueItem(
  queue: Map<string, MutableQueueItem>,
  context: PageIndexNodeQueueOutlineInput,
  outlineNodeId: string,
  contribution: {
    readonly llmReason?: string | undefined;
    readonly llmScore?: number | undefined;
    readonly value?: PageIndexNodeValuePrior | undefined;
  },
): void {
  const key = `${context.outline.id}\u001f${outlineNodeId}`;
  const existing = queue.get(key) ?? {
    contributions: new Set<PageIndexNodeQueueContribution>(),
    documentAssetId: context.outline.documentAssetId,
    documentScore: context.documentScore,
    generationId: context.generationId,
    outlineId: context.outline.id,
    outlineNodeId,
    valueBreadthScore: 0,
    valuePeakScore: 0,
  };
  if (contribution.llmScore !== undefined) {
    existing.contributions.add("llm");
    if (existing.llmScore === undefined || contribution.llmScore > existing.llmScore) {
      existing.llmScore = contribution.llmScore;
      existing.llmReason = contribution.llmReason;
    }
  }
  if (contribution.value) {
    existing.contributions.add("value");
    existing.valueBreadthScore = Math.max(
      existing.valueBreadthScore,
      contribution.value.breadthValue,
    );
    existing.valuePeakScore = Math.max(existing.valuePeakScore, contribution.value.peakValue);
  }
  queue.set(key, existing);
}

function freezeQueueItem(item: MutableQueueItem): PageIndexNodeQueueItem {
  return {
    contributions: (["llm", "value"] as const).filter((value) => item.contributions.has(value)),
    documentAssetId: item.documentAssetId,
    documentScore: item.documentScore,
    generationId: item.generationId,
    ...(item.llmReason === undefined ? {} : { llmReason: item.llmReason }),
    ...(item.llmScore === undefined ? {} : { llmScore: item.llmScore }),
    outlineId: item.outlineId,
    outlineNodeId: item.outlineNodeId,
    // The LLM lane is the mode-final semantic judge when present. Value remains a scheduling
    // prior/fallback and must not overwrite the judge score merely because dense normalization
    // assigned a query-relative 1.0.
    priorityScore: item.llmScore ?? item.valuePeakScore,
    valueBreadthScore: item.valueBreadthScore,
    valuePeakScore: item.valuePeakScore,
  };
}

function compareQueueItems(left: PageIndexNodeQueueItem, right: PageIndexNodeQueueItem): number {
  return (
    right.priorityScore - left.priorityScore ||
    Number(right.llmScore !== undefined) - Number(left.llmScore !== undefined) ||
    right.valuePeakScore - left.valuePeakScore ||
    right.valueBreadthScore - left.valueBreadthScore ||
    right.documentScore - left.documentScore ||
    left.outlineId.localeCompare(right.outlineId) ||
    left.outlineNodeId.localeCompare(right.outlineNodeId)
  );
}

function indexOpenableNodes(
  nodes: readonly DocumentOutlineNode[],
): ReadonlyMap<string, DocumentOutlineNode> {
  const output = new Map<string, DocumentOutlineNode>();
  const visit = (items: readonly DocumentOutlineNode[]): void => {
    for (const node of items) {
      if (
        node.startOffset !== undefined &&
        node.endOffset !== undefined &&
        node.endOffset > node.startOffset
      ) {
        output.set(node.id, node);
      }
      visit(node.children);
    }
  };
  visit(nodes);
  return output;
}

interface MutableEvidenceItem {
  readonly citation: HybridRetrievalItem["citation"];
  readonly contributions: Set<PageIndexNodeQueueContribution>;
  readonly metadata: Record<string, unknown>;
  readonly nodeId: string;
  readonly llmReasons: Set<string>;
  readonly outlineId: string;
  readonly outlineNodeIds: Set<string>;
  readonly permissionScope: string[];
  readonly projectionIds: Set<string>;
  score: number;
  readonly text: string;
}

function freezeEvidenceItem(item: MutableEvidenceItem): HybridRetrievalItem {
  const contributions = (["llm", "value"] as const).filter((value) =>
    item.contributions.has(value),
  );
  const llmReasons = [...item.llmReasons].sort();
  return {
    citation: { ...item.citation, sectionPath: [...item.citation.sectionPath] },
    metadata: {
      ...item.metadata,
      pageIndex: {
        contributions,
        ...(llmReasons[0] ? { llmReason: llmReasons[0] } : {}),
        outlineId: item.outlineId,
        outlineNodeIds: [...item.outlineNodeIds].sort(),
      },
      reasoningTreeSearch: {
        contributions,
        selectedNodeIds: [...item.outlineNodeIds].sort(),
      },
      text: item.text,
    },
    nodeId: item.nodeId,
    permissionScope: [...item.permissionScope],
    projectionIds: [...item.projectionIds].sort(),
    score: item.score,
    sources: contributions.includes("value") ? ["pageindex", "dense"] : ["pageindex"],
  };
}

function validateScore(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`PageIndex node queue ${label} must be within [0, 1]`);
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PageIndex node queue ${name} must be a positive integer`);
  }
}
