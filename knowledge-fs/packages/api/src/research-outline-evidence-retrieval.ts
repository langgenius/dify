import { selectPageIndexDocuments } from "./page-index-document-selection";
import { type PageIndexNodeQueueItem, openPageIndexEvidenceQueue } from "./page-index-node-queue";
import { buildPageIndexNodeValues } from "./page-index-node-values";
import { pageIndexQueryTerms } from "./page-index-scoring";
import type {
  PublishedPageIndexOutlineItem,
  PublishedPageIndexRepository,
  PublishedPageIndexScope,
} from "./published-page-index-repository";
import {
  InteractiveResearchEvidenceRetrievalPolicy,
  validateResearchRetrievalPolicy,
} from "./research-retrieval-policy";
import type { RetrievalCandidate, RetrievalSource } from "./retrieval-candidates";
import { fuseRankedHybridRetrievalLists } from "./retrieval-fusion";
import type { BasicHybridRetriever, RetrieveHybridInput } from "./retrieval-types";

export interface ResearchOutlineEvidenceRetrievalOptions {
  readonly lexicalWeight?: number | undefined;
  readonly maxConcurrentOpens?: number | undefined;
  readonly pageIndex: PublishedPageIndexRepository;
  readonly retriever: BasicHybridRetriever;
  readonly valueWeight?: number | undefined;
}

/**
 * Expands full-space Dense/FTS candidates through immutable outline ranges without an LLM call.
 * Dense values and exact outline postings choose bounded ranges; RRF merges the opened evidence
 * with the ordinary candidate list while preserving the publication and permission scope.
 */
export function createResearchOutlineEvidenceRetrieval({
  lexicalWeight = 0.7,
  maxConcurrentOpens = 4,
  pageIndex,
  retriever,
  valueWeight = 1,
}: ResearchOutlineEvidenceRetrievalOptions): BasicHybridRetriever {
  positiveFinite(lexicalWeight, "lexicalWeight");
  positiveFinite(valueWeight, "valueWeight");
  positiveInteger(maxConcurrentOpens, "maxConcurrentOpens");

  return {
    retrieve: async (input) => {
      const base = await retriever.retrieve(input);
      if (input.mode !== "research") return base;

      const scope = researchPageIndexScope(input);
      const policy = validateResearchRetrievalPolicy(
        input.researchExecutionPolicy ?? InteractiveResearchEvidenceRetrievalPolicy,
      );
      const candidates = base.items.map(hybridItemAsCandidate);
      const selectedDocuments = selectPageIndexDocuments({
        candidates,
        maxDocuments: policy.maxDocuments,
        maxHitsPerDocument: policy.maxHitsPerDocument,
      });
      const outlines =
        selectedDocuments.length === 0
          ? { items: [] }
          : await pageIndex.listOutlines({
              ...scope,
              documentAssetIds: selectedDocuments.map((document) => document.documentAssetId),
              limit: policy.maxDocuments,
              permissionScope: input.permissionScope ?? [],
            });
      const documentById = new Map(
        selectedDocuments.map((document) => [document.documentAssetId, document] as const),
      );
      const queue = new Map<string, PageIndexNodeQueueItem>();

      for (const item of outlines.items) {
        const document = documentById.get(item.documentAssetId);
        if (!document) continue;
        const values = buildPageIndexNodeValues({
          hits: document.hits,
          maxHitsPerNode: policy.maxHitsPerDocument,
          outline: item.outline,
        });
        for (const nodeId of values.rankedOpenableNodeIds.slice(
          0,
          policy.maxValueNodesPerOutline,
        )) {
          const value = values.valuesByNodeId.get(nodeId);
          if (!value || value.peakValue <= 0) continue;
          addQueueItem(queue, {
            documentAssetId: item.documentAssetId,
            documentScore: document.score,
            generationId: item.generationId,
            outlineId: item.outline.id,
            outlineNodeId: nodeId,
            priorityScore: value.peakValue * valueWeight,
            valueBreadthScore: value.breadthValue,
            valuePeakScore: value.peakValue,
          });
        }
      }

      let lexicalCandidates = 0;
      if (pageIndex.searchSections) {
        const terms = pageIndexQueryTerms(input.query);
        if (terms.length > 0) {
          const lexical = await pageIndex.searchSections({
            ...scope,
            limit: policy.maxQueueItems,
            permissionScope: input.permissionScope ?? [],
            terms,
          });
          lexicalCandidates = lexical.items.length;
          for (const item of lexical.items) {
            if (!isOpenable(item.node)) continue;
            addQueueItem(queue, {
              documentAssetId: item.documentAssetId,
              documentScore: item.score,
              generationId: item.generationId,
              outlineId: item.outlineId,
              outlineNodeId: item.node.id,
              priorityScore: item.score * lexicalWeight,
              valueBreadthScore: item.score,
              valuePeakScore: item.score,
            });
          }
        }
      }

      const boundedQueue = [...queue.values()]
        .sort(
          (left, right) =>
            right.priorityScore - left.priorityScore ||
            left.outlineId.localeCompare(right.outlineId) ||
            left.outlineNodeId.localeCompare(right.outlineNodeId),
        )
        .slice(0, policy.maxQueueItems);
      const opened = await openPageIndexEvidenceQueue({
        maxConcurrentOpens: Math.min(maxConcurrentOpens, policy.maxConcurrentTreeSelections),
        maxEvidencePerRange: policy.maxEvidencePerRange,
        maxFinalItems: Math.max(input.limit, policy.maxFinalItems),
        permissionScope: input.permissionScope ?? [],
        queue: boundedQueue,
        repository: pageIndex,
        scope,
      });
      const fused = fuseRankedHybridRetrievalLists({
        limit: input.limit,
        lists: [
          { items: base.items, label: "hybrid", weight: 1 },
          { items: opened.items, label: "outline", weight: 0.9 },
        ],
      });

      return {
        items: fused,
        metrics: base.metrics
          ? {
              ...base.metrics,
              pageIndexMatchedNodes: boundedQueue.length,
              pageIndexOpenedRanges: opened.openedRangeCount,
              pageIndexScannedOutlines: outlines.items.length,
              researchOutlineLexicalCandidates: lexicalCandidates,
            }
          : undefined,
        plan: base.plan,
      };
    },
  };
}

function researchPageIndexScope(input: RetrieveHybridInput): PublishedPageIndexScope {
  const snapshot = input.projectionSnapshot;
  if (!snapshot || !input.tenantId || input.permissionScope === undefined) {
    throw new Error(
      "Research outline evidence requires a published snapshot, tenant, and permission scope",
    );
  }
  if (
    snapshot.knowledgeSpaceId !== input.knowledgeSpaceId ||
    snapshot.tenantId !== input.tenantId
  ) {
    throw new Error("Research outline evidence snapshot does not match the query scope");
  }
  return {
    fingerprint: snapshot.fingerprint,
    knowledgeSpaceId: snapshot.knowledgeSpaceId,
    publicationId: snapshot.publicationId,
    tenantId: snapshot.tenantId,
  };
}

function hybridItemAsCandidate(
  item: Awaited<ReturnType<BasicHybridRetriever["retrieve"]>>["items"][number],
): RetrievalCandidate {
  return {
    citation: { ...item.citation, sectionPath: [...item.citation.sectionPath] },
    metadata: { ...item.metadata },
    nodeId: item.nodeId,
    permissionScope: [...(item.permissionScope ?? [])],
    projectionId: item.projectionIds[0] ?? item.nodeId,
    score: item.score,
    source: preferredSource(item.sources),
  };
}

function preferredSource(sources: readonly RetrievalSource[]): RetrievalSource {
  return sources.includes("dense")
    ? "dense"
    : sources.includes("fts")
      ? "fts"
      : (sources[0] ?? "pageindex");
}

function addQueueItem(
  queue: Map<string, PageIndexNodeQueueItem>,
  item: Omit<PageIndexNodeQueueItem, "contributions">,
): void {
  const key = `${item.outlineId}\u001f${item.outlineNodeId}`;
  const existing = queue.get(key);
  if (existing && existing.priorityScore >= item.priorityScore) return;
  queue.set(key, { ...item, contributions: ["value"] });
}

function isOpenable(node: PublishedPageIndexOutlineItem["outline"]["nodes"][number]): boolean {
  return (
    node.startOffset !== undefined &&
    node.endOffset !== undefined &&
    node.endOffset > node.startOffset
  );
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Research outline evidence ${label} must be at least 1`);
  }
}

function positiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Research outline evidence ${label} must be positive and finite`);
  }
}
