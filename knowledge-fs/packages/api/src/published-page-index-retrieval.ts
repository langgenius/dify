import type { DocumentOutline, DocumentOutlineNode, KnowledgeNode } from "@knowledge/core";

import { cloneJsonObject } from "./json-utils";
import {
  PageIndexScoreVersion,
  pageIndexQueryTerms,
  scorePageIndexOutlineNode,
} from "./page-index-scoring";
import type { PublishedPageIndexRepository } from "./published-page-index-repository";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import type { RetrievalPlanner } from "./retrieval-planner";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  HybridRetrievalResult,
  RetrievalPlan,
  RetrieveHybridInput,
} from "./retrieval-types";

export interface PublishedPageIndexRetrievalOptions {
  /** Explicitly enable the O(corpus) compatibility path for tests/local development only. */
  readonly allowOutlineScanFallback?: boolean | undefined;
  /** Maximum number of leaf-open operations allowed to be in flight for one query. */
  readonly maxConcurrentLeafOpens: number;
  /** Sum of requested leaf rows across all selected sections. */
  readonly maxLeafEvidenceItems: number;
  readonly maxOutlineNodesScanned: number;
  readonly maxOutlinesScanned: number;
  readonly maxSelectedSections: number;
  readonly now?: (() => number) | undefined;
  readonly outlinePageSize: number;
  readonly pageIndex: PublishedPageIndexRepository;
  readonly planner: RetrievalPlanner;
  readonly retriever: BasicHybridRetriever;
}

export class PublishedPageIndexCapabilityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedPageIndexCapabilityUnavailableError";
  }
}

export class PublishedPageIndexScanLimitExceededError extends Error {
  constructor(limitName: "maxOutlineNodesScanned" | "maxOutlinesScanned", limit: number) {
    super(`Published PageIndex retrieval exceeded ${limitName}=${limit}`);
    this.name = "PublishedPageIndexScanLimitExceededError";
  }
}

interface ScoredOutlineNode {
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly generationId: string;
  readonly node: DocumentOutlineNode;
  readonly outlineId: string;
  readonly outlineVersion: string;
  readonly score: number;
  readonly visitedNodeIds: readonly string[];
}

/**
 * Replaces the production Research leg with an independent read over the
 * immutable published PageIndex snapshot. Fast/Deep delegate unchanged.
 */
export function createPublishedPageIndexRetrievalPath({
  allowOutlineScanFallback = false,
  maxConcurrentLeafOpens,
  maxLeafEvidenceItems,
  maxOutlineNodesScanned,
  maxOutlinesScanned,
  maxSelectedSections,
  now = Date.now,
  outlinePageSize,
  pageIndex,
  planner,
  retriever,
}: PublishedPageIndexRetrievalOptions): BasicHybridRetriever {
  validatePositiveInteger(maxConcurrentLeafOpens, "maxConcurrentLeafOpens");
  validatePositiveInteger(maxLeafEvidenceItems, "maxLeafEvidenceItems");
  validatePositiveInteger(maxOutlineNodesScanned, "maxOutlineNodesScanned");
  validatePositiveInteger(maxOutlinesScanned, "maxOutlinesScanned");
  validatePositiveInteger(maxSelectedSections, "maxSelectedSections");
  validatePositiveInteger(outlinePageSize, "outlinePageSize");

  return {
    retrieve: async (input) => {
      const plan = planner.plan({
        mode: input.mode,
        query: input.query,
        topK: input.topK,
        traceId: input.traceId,
      });

      if (plan.resolvedMode !== "research") {
        return retriever.retrieve(input);
      }

      return retrievePublishedPageIndex({
        allowOutlineScanFallback,
        input,
        maxConcurrentLeafOpens,
        maxLeafEvidenceItems,
        maxOutlineNodesScanned,
        maxOutlinesScanned,
        maxSelectedSections,
        now,
        outlinePageSize,
        pageIndex,
        plan,
      });
    },
  };
}

async function retrievePublishedPageIndex({
  allowOutlineScanFallback,
  input,
  maxConcurrentLeafOpens,
  maxLeafEvidenceItems,
  maxOutlineNodesScanned,
  maxOutlinesScanned,
  maxSelectedSections,
  now,
  outlinePageSize,
  pageIndex,
  plan,
}: {
  readonly allowOutlineScanFallback: boolean;
  readonly input: RetrieveHybridInput;
  readonly maxConcurrentLeafOpens: number;
  readonly maxLeafEvidenceItems: number;
  readonly maxOutlineNodesScanned: number;
  readonly maxOutlinesScanned: number;
  readonly maxSelectedSections: number;
  readonly now: () => number;
  readonly outlinePageSize: number;
  readonly pageIndex: PublishedPageIndexRepository;
  readonly plan: RetrievalPlan;
}): Promise<HybridRetrievalResult> {
  const startedAt = now();
  const snapshot = input.projectionSnapshot;
  if (!snapshot) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research retrieval requires a published projection snapshot",
    );
  }
  if (
    snapshot.knowledgeSpaceId !== input.knowledgeSpaceId ||
    (input.tenantId !== undefined && snapshot.tenantId !== input.tenantId)
  ) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research retrieval projection snapshot does not match the query scope",
    );
  }
  if (input.permissionScope === undefined) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research retrieval requires a server-issued permission scope",
    );
  }
  if (maxSelectedSections < input.topK) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      `Research PageIndex section budget cannot satisfy topK=${input.topK}; maxSelectedSections=${maxSelectedSections}`,
    );
  }

  const terms = pageIndexQueryTerms(input.query);
  const scored: ScoredOutlineNode[] = [];
  let scannedOutlines = 0;
  let scannedNodes = 0;
  let summaryCandidates = 0;
  let candidateTruncated = false;
  let repositoryThresholdFiltered = 0;
  const threshold =
    input.retrievalProfile?.scoreThreshold.enabled === true
      ? input.retrievalProfile.scoreThreshold.value
      : undefined;

  if (pageIndex.searchSections) {
    const indexedSectionLimit = Math.min(
      maxSelectedSections,
      maxLeafEvidenceItems,
      Math.max(input.topK * 4, 20),
    );
    const indexed = await pageIndex.searchSections({
      fingerprint: snapshot.fingerprint,
      knowledgeSpaceId: snapshot.knowledgeSpaceId,
      limit: indexedSectionLimit,
      permissionScope: input.permissionScope,
      publicationId: snapshot.publicationId,
      ...(threshold !== undefined ? { scoreThreshold: threshold } : {}),
      tenantId: snapshot.tenantId,
      terms,
    });
    candidateTruncated = indexed.truncated;
    repositoryThresholdFiltered = indexed.filteredCount ?? 0;
    for (const item of indexed.items) {
      if (item.node.summary) {
        summaryCandidates += 1;
      }
      scored.push({
        documentAssetId: item.documentAssetId,
        documentVersion: item.documentVersion,
        generationId: item.generationId,
        node: item.node,
        outlineId: item.outlineId,
        outlineVersion: item.outlineVersion,
        score: item.score,
        visitedNodeIds: item.visitedNodeIds,
      });
    }
  } else {
    if (!allowOutlineScanFallback) {
      throw new PublishedPageIndexCapabilityUnavailableError(
        "Research requires bounded indexed PageIndex search; outline scan fallback is disabled",
      );
    }
    let cursor: { readonly componentKey: string } | undefined;
    const seenCursors = new Set<string>();
    do {
      const page = await pageIndex.listOutlines({
        fingerprint: snapshot.fingerprint,
        knowledgeSpaceId: snapshot.knowledgeSpaceId,
        limit: Math.min(outlinePageSize, maxOutlinesScanned - scannedOutlines + 1),
        permissionScope: input.permissionScope,
        publicationId: snapshot.publicationId,
        tenantId: snapshot.tenantId,
        ...(cursor ? { cursor } : {}),
      });

      for (const item of page.items) {
        scannedOutlines += 1;
        if (scannedOutlines > maxOutlinesScanned) {
          throw new PublishedPageIndexScanLimitExceededError(
            "maxOutlinesScanned",
            maxOutlinesScanned,
          );
        }

        visitOutlineNodes(item.outline, (node, visitedNodeIds) => {
          scannedNodes += 1;
          if (scannedNodes > maxOutlineNodesScanned) {
            throw new PublishedPageIndexScanLimitExceededError(
              "maxOutlineNodesScanned",
              maxOutlineNodesScanned,
            );
          }
          if (node.summary) {
            summaryCandidates += 1;
          }
          if (!hasOpenableRange(node)) {
            return;
          }

          const result = scorePageIndexOutlineNode(node, terms);
          if (result.score > 0) {
            scored.push({
              documentAssetId: item.documentAssetId,
              documentVersion: item.outline.version,
              generationId: item.generationId,
              node,
              outlineId: item.outline.id,
              outlineVersion: item.outline.outlineVersion,
              score: result.score,
              visitedNodeIds,
            });
          }
        });
      }

      cursor = page.nextCursor;
      if (cursor) {
        if (seenCursors.has(cursor.componentKey)) {
          throw new PublishedPageIndexCapabilityUnavailableError(
            "Published PageIndex outline pagination repeated its cursor",
          );
        }
        seenCursors.add(cursor.componentKey);
      }
    } while (cursor);
  }

  scored.sort(compareScoredOutlineNodes);
  const thresholded =
    threshold === undefined ? scored : scored.filter((entry) => entry.score >= threshold);
  const thresholdFiltered = repositoryThresholdFiltered + scored.length - thresholded.length;
  const sectionBudget = Math.min(
    maxSelectedSections,
    maxLeafEvidenceItems,
    Math.max(input.topK * 4, 20),
    thresholded.length,
  );
  const selected = thresholded.slice(0, sectionBudget);
  const leafLimitPerSection = Math.min(
    input.limit,
    Math.max(1, Math.floor(maxLeafEvidenceItems / Math.max(1, selected.length))),
  );
  const opened = await mapWithConcurrency(selected, maxConcurrentLeafOpens, (entry) =>
    pageIndex.openLeafEvidence({
      documentAssetId: entry.documentAssetId,
      fingerprint: snapshot.fingerprint,
      generationId: entry.generationId,
      knowledgeSpaceId: snapshot.knowledgeSpaceId,
      limit: leafLimitPerSection,
      outlineId: entry.outlineId,
      outlineNodeId: entry.node.id,
      permissionScope: input.permissionScope ?? [],
      publicationId: snapshot.publicationId,
      tenantId: snapshot.tenantId,
    }),
  );
  const byNodeId = new Map<string, HybridRetrievalItem>();

  for (const [index, result] of opened.entries()) {
    const selection = selected[index];
    if (!selection) {
      continue;
    }
    for (const evidence of result.items) {
      const candidate = pageIndexHybridItem({
        evidence,
        openedRange: result.openedRange,
        score: selection.score,
        selection,
        snapshotFingerprint: snapshot.fingerprint,
        snapshotHeadRevision: snapshot.headRevision,
        snapshotPublicationId: snapshot.publicationId,
      });
      const existing = byNodeId.get(candidate.nodeId);
      if (!existing || candidate.score > existing.score) {
        byNodeId.set(candidate.nodeId, candidate);
      } else if (candidate.score === existing.score) {
        byNodeId.set(candidate.nodeId, {
          ...existing,
          projectionIds: uniqueStrings([...existing.projectionIds, ...candidate.projectionIds]),
        });
      }
    }
  }

  const items = [...byNodeId.values()]
    .sort(
      (first, second) => second.score - first.score || first.nodeId.localeCompare(second.nodeId),
    )
    .slice(0, input.limit);
  const totalMs = Math.max(0, now() - startedAt);

  return {
    items,
    metrics: pageIndexMetrics({
      finalItems: items.length,
      matchedNodes: scored.length,
      openedRanges: opened.length,
      scannedNodes,
      scannedOutlines,
      selectedSections: selected.length,
      summaryCandidates,
      thresholdFiltered,
      totalMs,
      candidateTruncated,
    }),
    plan,
  };
}

function visitOutlineNodes(
  outline: DocumentOutline,
  visit: (node: DocumentOutlineNode, visitedNodeIds: readonly string[]) => void,
): void {
  const walk = (node: DocumentOutlineNode, ancestors: readonly string[]) => {
    const visitedNodeIds = [...ancestors, node.id];
    visit(node, visitedNodeIds);
    for (const child of node.children) {
      walk(child, visitedNodeIds);
    }
  };

  for (const node of outline.nodes) {
    walk(node, []);
  }
}

function hasOpenableRange(node: DocumentOutlineNode): boolean {
  return (
    node.startOffset !== undefined &&
    node.endOffset !== undefined &&
    node.endOffset > node.startOffset
  );
}

function compareScoredOutlineNodes(first: ScoredOutlineNode, second: ScoredOutlineNode): number {
  return (
    second.score - first.score ||
    second.node.sectionPath.length - first.node.sectionPath.length ||
    first.outlineId.localeCompare(second.outlineId) ||
    first.node.id.localeCompare(second.node.id)
  );
}

function pageIndexHybridItem({
  evidence,
  openedRange,
  score,
  selection,
  snapshotFingerprint,
  snapshotHeadRevision,
  snapshotPublicationId,
}: {
  readonly evidence: {
    readonly citation: HybridRetrievalItem["citation"];
    readonly node: KnowledgeNode;
    readonly projections: readonly { readonly id: string }[];
  };
  readonly openedRange: { readonly endOffset: number; readonly startOffset: number };
  readonly score: number;
  readonly selection: ScoredOutlineNode;
  readonly snapshotFingerprint: string;
  readonly snapshotHeadRevision: number;
  readonly snapshotPublicationId: string;
}): HybridRetrievalItem {
  return {
    citation: {
      ...evidence.citation,
      sectionPath: [...evidence.citation.sectionPath],
    },
    metadata: {
      ...cloneJsonObject(evidence.node.metadata),
      documentOutline: {
        nodeId: selection.node.id,
        outlineId: selection.outlineId,
        outlineVersion: selection.outlineVersion,
        sectionPath: [...selection.node.sectionPath],
        summary: selection.node.summary,
        title: selection.node.title,
        tocSource: selection.node.tocSource,
      },
      nodeMetadata: cloneJsonObject(evidence.node.metadata),
      pageIndex: {
        generationId: selection.generationId,
        normalizedScore: score,
        scoreVersion: PageIndexScoreVersion,
      },
      projectionSnapshot: {
        fingerprint: snapshotFingerprint,
        headRevision: snapshotHeadRevision,
        publicationId: snapshotPublicationId,
      },
      reasoningTreeSearch: {
        openedRanges: [
          {
            documentAssetId: selection.documentAssetId,
            documentVersion: selection.documentVersion,
            endOffset: openedRange.endOffset,
            outlineNodeId: selection.node.id,
            sectionPath: [...selection.node.sectionPath],
            startOffset: openedRange.startOffset,
          },
        ],
        selectedNodeId: selection.node.id,
        selectedSectionPath: [...selection.node.sectionPath],
        strategy: PageIndexScoreVersion,
        visitedNodeIds: [...selection.visitedNodeIds],
      },
      text: evidence.node.text,
    },
    nodeId: evidence.node.id,
    permissionScope: [...evidence.node.permissionScope],
    projectionIds: uniqueStrings(evidence.projections.map((projection) => projection.id)),
    score,
    sources: ["pageindex"],
  };
}

function pageIndexMetrics({
  finalItems,
  matchedNodes,
  openedRanges,
  scannedNodes,
  scannedOutlines,
  selectedSections,
  summaryCandidates,
  thresholdFiltered,
  totalMs,
  candidateTruncated,
}: {
  readonly candidateTruncated: boolean;
  readonly finalItems: number;
  readonly matchedNodes: number;
  readonly openedRanges: number;
  readonly scannedNodes: number;
  readonly scannedOutlines: number;
  readonly selectedSections: number;
  readonly summaryCandidates: number;
  readonly thresholdFiltered: number;
  readonly totalMs: number;
}): HybridRetrievalMetrics {
  return {
    denseCandidates: 0,
    denseMs: 0,
    documentOutlineMatchedItems: finalItems,
    ftsCandidates: 0,
    ftsMs: 0,
    fusedCandidates: finalItems,
    fusionMs: 0,
    pageIndexMatchedNodes: matchedNodes,
    pageIndexCandidateTruncated: candidateTruncated,
    pageIndexOpenedRanges: openedRanges,
    pageIndexScannedNodes: scannedNodes,
    pageIndexScannedOutlines: scannedOutlines,
    pageIndexScoreVersion: PageIndexScoreVersion,
    reasoningTreeSearchNodes: scannedNodes,
    scoreThresholdFilteredCandidates: thresholdFiltered,
    summaryCandidates,
    summarySelectedSections: selectedSections,
    totalMs,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  map: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input !== undefined) {
        outputs[index] = await map(input, index);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => worker()),
  );
  return outputs;
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Published PageIndex retrieval ${name} must be at least 1`);
  }
}
