import type { DocumentOutline, DocumentOutlineNode } from "@knowledge/core";

import type { DocumentOutlineRepository } from "./document-outline-repository";
import {
  type GraphEntity,
  type GraphIndexRepository,
  type GraphTraversalEntity,
  type GraphTraversalResult,
  cloneGraphEntity,
  compareGraphTraversalEntities,
  validateGraphTraversalInput,
} from "./graph-index-repository";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import type { PublishedGraphIndexRepository } from "./published-graph-index-repository";
import {
  type RetrievalMetadataFilters,
  type RetrievalSource,
  cloneRetrievalCitation,
  normalizeRetrievalPermissionScope,
} from "./retrieval-candidates";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import type { RetrievalPlanner } from "./retrieval-planner";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  HybridRetrievalResult,
  ResolvedRetrievalMode,
  RetrieveHybridInput,
} from "./retrieval-types";

export interface SummaryTreeRetrievalPathOptions {
  readonly maxLeafTopK: number;
  readonly maxSelectedSections: number;
  readonly maxSummaryTopK: number;
  readonly retriever: BasicHybridRetriever;
}

export interface DocumentOutlineRetrievalPathOptions {
  readonly maxOutlinesPerQuery: number;
  readonly outlines: DocumentOutlineRepository;
  readonly planner?: RetrievalPlanner | undefined;
  readonly retriever: BasicHybridRetriever;
}

export interface GraphExpandedRetrievalPathOptions {
  readonly fanout: number;
  readonly graph: GraphIndexRepository;
  readonly graphBoost: number;
  readonly graphTopK: number;
  readonly maxDepth: number;
  readonly maxSeedEntities: number;
  readonly maxTraversalNodes: number;
  /** Immutable publication-scoped graph reader used whenever a query carries a snapshot. */
  readonly publishedGraph?: PublishedGraphIndexRepository | undefined;
  readonly retriever: BasicHybridRetriever;
  /** Production guard: Deep must not fall back to the mutable/legacy graph. */
  readonly strictPublishedReads?: boolean | undefined;
  readonly timeoutMs: number;
}

export class DeepGraphCapabilityUnavailableError extends Error {
  constructor() {
    super("Deep retrieval requires the published Graph capability");
    this.name = "DeepGraphCapabilityUnavailableError";
  }
}

/**
 * Keeps Fast and Research available when a deployment has no strict published Graph reader, while
 * making the Deep product contract fail closed instead of silently degrading to ordinary hybrid.
 */
export function createRequiredDeepGraphCapabilityGuard({
  available,
  retriever,
}: {
  readonly available: boolean;
  readonly retriever: BasicHybridRetriever;
}): BasicHybridRetriever {
  if (available) {
    return retriever;
  }

  return {
    retrieve: async (input) => {
      if (input.mode === "deep") {
        throw new DeepGraphCapabilityUnavailableError();
      }
      return retriever.retrieve(input);
    },
  };
}

export interface TableSpecificRetrievalPathOptions {
  readonly maxTableCandidates: number;
  readonly maxTableTopK: number;
  readonly retriever: BasicHybridRetriever;
  readonly tableBoost: number;
}

export interface ImageOcrRetrievalPathOptions {
  readonly imageBoost: number;
  readonly maxImageCandidates: number;
  readonly maxImageTopK: number;
  readonly retriever: BasicHybridRetriever;
}

export function createSummaryTreeRetrievalPath({
  maxLeafTopK,
  maxSelectedSections,
  maxSummaryTopK,
  retriever,
}: SummaryTreeRetrievalPathOptions): BasicHybridRetriever {
  if (!Number.isInteger(maxSummaryTopK) || maxSummaryTopK < 1) {
    throw new Error("Summary tree retrieval maxSummaryTopK must be at least 1");
  }

  if (!Number.isInteger(maxLeafTopK) || maxLeafTopK < 1) {
    throw new Error("Summary tree retrieval maxLeafTopK must be at least 1");
  }

  if (!Number.isInteger(maxSelectedSections) || maxSelectedSections < 1) {
    throw new Error("Summary tree retrieval maxSelectedSections must be at least 1");
  }

  return {
    retrieve: async (input) => {
      if (!shouldRunModeExtension(input.mode, "summary-tree")) {
        return retriever.retrieve(input);
      }

      const summaryResult = await retriever.retrieve({
        ...input,
        filters: summaryTreeSummaryFilters(input.filters),
        limit: Math.min(maxSelectedSections, input.limit + maxSelectedSections),
        topK: Math.min(input.topK, maxSummaryTopK),
      });
      const selectedSections = summaryResult.items
        .map((item) => item.citation.sectionPath)
        .filter((sectionPath) => sectionPath.length > 0)
        .slice(0, maxSelectedSections);
      const leafResult = await retriever.retrieve({
        ...input,
        filters: summaryTreeLeafFilters(input.filters),
        limit: Math.min(maxLeafTopK, Math.max(input.limit * 2, input.limit)),
        topK: Math.min(input.topK, maxLeafTopK),
      });
      const sectionFiltered =
        selectedSections.length === 0
          ? leafResult.items
          : leafResult.items.filter((item) =>
              selectedSections.some((sectionPath) =>
                retrievalSectionStartsWith(item.citation.sectionPath, sectionPath),
              ),
            );
      const items = (sectionFiltered.length === 0 ? leafResult.items : sectionFiltered).slice(
        0,
        input.limit,
      );

      return {
        items,
        metrics: leafResult.metrics
          ? {
              ...leafResult.metrics,
              summaryCandidates: summaryResult.items.length,
              summarySelectedSections: selectedSections.length,
            }
          : undefined,
        plan: leafResult.plan,
      };
    },
  };
}

export function createDocumentOutlineRetrievalPath({
  maxOutlinesPerQuery,
  outlines,
  planner,
  retriever,
}: DocumentOutlineRetrievalPathOptions): BasicHybridRetriever {
  if (!Number.isInteger(maxOutlinesPerQuery) || maxOutlinesPerQuery < 1) {
    throw new Error("Document outline retrieval maxOutlinesPerQuery must be at least 1");
  }

  return {
    retrieve: async (input) => {
      const requestedLimit = input.limit;
      const plannedRetrieval = planner?.plan({
        mode: input.mode,
        query: input.query,
        topK: input.topK,
        traceId: input.traceId,
      });
      const plannedPageIndexResearch = shouldRunModeExtension(input.mode, "document-outline");
      // This is a legacy compatibility path. Research itself has no hybrid planner fanout; use a
      // bounded Fast base only to locate documents that still carry old, non-published outlines.
      const baseResult = await retriever.retrieve(
        plannedPageIndexResearch ? { ...input, mode: "fast", limit: requestedLimit } : input,
      );
      const pageIndexResearch =
        plannedPageIndexResearch || shouldRunModeExtension(input.mode, "document-outline");
      const reportedPlan = plannedPageIndexResearch ? plannedRetrieval : baseResult.plan;

      if (!pageIndexResearch || baseResult.items.length === 0) {
        return {
          ...baseResult,
          items: baseResult.items.slice(0, requestedLimit).map(cloneHybridRetrievalItem),
          plan: reportedPlan,
        };
      }

      const outlineKeys = uniqueOutlineKeys(baseResult.items).slice(0, maxOutlinesPerQuery);
      const outlineResults = await Promise.all(
        outlineKeys.map((key) =>
          outlines.getByDocumentVersion({
            documentAssetId: key.documentAssetId,
            version: key.documentVersion,
          }),
        ),
      );
      const outlineByKey = new Map<string, DocumentOutline>();

      for (const outline of outlineResults) {
        if (outline) {
          outlineByKey.set(outlineKey(outline.documentAssetId, outline.version), outline);
        }
      }

      if (pageIndexResearch) {
        const selection = selectReasoningTreeSearchMatch(
          input.query,
          baseResult.items,
          outlineByKey,
        );

        if (selection) {
          const fallbackHybridCandidateNodeIds = baseResult.items.map((item) => item.nodeId);
          const selectedItems = baseResult.items
            .filter((item) => itemMatchesSelectedOutlineNode(item, selection))
            .slice(0, requestedLimit);
          const finalItems =
            selectedItems.length > 0 ? selectedItems : baseResult.items.slice(0, requestedLimit);
          const finalEvidenceNodeIds = finalItems.map((item) => item.nodeId);
          let matchedItems = 0;

          const items = finalItems.map((item) => {
            const outline = outlineByKey.get(
              outlineKey(item.citation.documentAssetId, item.citation.documentVersion),
            );
            const match = outline ? findBestOutlineNode(outline, item) : null;
            const matchedNode = match?.node ?? selection.node;

            if (match) {
              matchedItems += 1;
            }

            return {
              ...cloneHybridRetrievalItem(item),
              metadata: {
                ...cloneJsonObject(item.metadata),
                documentOutline: documentOutlineMetadata(selection.outline, matchedNode),
                reasoningTreeSearch: {
                  fallbackHybridCandidateNodeIds,
                  finalEvidenceNodeIds,
                  inspectedNodeIds: selection.visitedNodeIds,
                  openedRanges: [documentOutlineOpenedRange(selection.outline, selection.node)],
                  reasoning:
                    "Matched the research query against PageIndex outline titles and summaries, opened the best section range, and retained final evidence inside the selected range.",
                  selectedNodeId: selection.node.id,
                  selectedSectionPath: [...selection.node.sectionPath],
                  strategy: "document-outline-guided-v1",
                  visitedNodeIds: selection.visitedNodeIds,
                },
              },
            };
          });

          return {
            items,
            metrics: baseResult.metrics
              ? {
                  ...baseResult.metrics,
                  documentOutlineMatchedItems: matchedItems,
                  reasoningTreeSearchNodes: selection.visitedNodeIds.length,
                }
              : undefined,
            plan: reportedPlan,
          };
        }
      }

      let matchedItems = 0;
      let reasoningTreeSearchNodes = 0;
      const items = baseResult.items.slice(0, requestedLimit).map((item) => {
        const outline = outlineByKey.get(
          outlineKey(item.citation.documentAssetId, item.citation.documentVersion),
        );

        if (!outline) {
          return cloneHybridRetrievalItem(item);
        }

        const match = findBestOutlineNode(outline, item);

        if (!match) {
          return cloneHybridRetrievalItem(item);
        }

        matchedItems += 1;
        reasoningTreeSearchNodes += match.visitedNodeIds.length;

        return {
          ...cloneHybridRetrievalItem(item),
          metadata: {
            ...cloneJsonObject(item.metadata),
            documentOutline: documentOutlineMetadata(outline, match.node),
            ...(pageIndexResearch
              ? {
                  reasoningTreeSearch: {
                    fallbackHybridCandidateNodeIds: [item.nodeId],
                    finalEvidenceNodeIds: [item.nodeId],
                    inspectedNodeIds: match.visitedNodeIds,
                    openedRanges: [documentOutlineOpenedRange(outline, match.node)],
                    reasoning:
                      "Selected the deepest document outline node matching the retrieved evidence citation section, page, or offset.",
                    selectedNodeId: match.node.id,
                    selectedSectionPath: [...match.node.sectionPath],
                    strategy: "document-outline-guided-v1",
                    visitedNodeIds: match.visitedNodeIds,
                  },
                }
              : {}),
          },
        };
      });

      return {
        items,
        metrics: baseResult.metrics
          ? {
              ...baseResult.metrics,
              ...(matchedItems > 0 ? { documentOutlineMatchedItems: matchedItems } : {}),
              ...(pageIndexResearch && reasoningTreeSearchNodes > 0
                ? { reasoningTreeSearchNodes }
                : {}),
            }
          : undefined,
        plan: reportedPlan,
      };
    },
  };
}

export function createTableSpecificRetrievalPath({
  maxTableCandidates,
  maxTableTopK,
  retriever,
  tableBoost,
}: TableSpecificRetrievalPathOptions): BasicHybridRetriever {
  validateTableSpecificRetrievalOptions({ maxTableCandidates, maxTableTopK, tableBoost });

  return {
    retrieve: async (input) => {
      const baseResult = await retriever.retrieve(input);

      if (!shouldRunTableSpecificRetrieval(input)) {
        return baseResult;
      }

      const tableResult = await retriever.retrieve({
        ...input,
        filters: tableSpecificRetrievalFilters(input.filters),
        limit: Math.min(input.limit, maxTableCandidates),
        topK: Math.min(input.topK, maxTableTopK),
      });

      return {
        items: mergeTableSpecificRetrievalItems({
          baseItems: baseResult.items,
          limit: input.limit,
          tableBoost,
          tableItems: tableResult.items,
        }),
        metrics: tableSpecificRetrievalMetrics(baseResult.metrics, tableResult.items.length),
        plan: baseResult.plan,
      };
    },
  };
}

export function createImageOcrRetrievalPath({
  imageBoost,
  maxImageCandidates,
  maxImageTopK,
  retriever,
}: ImageOcrRetrievalPathOptions): BasicHybridRetriever {
  validateImageOcrRetrievalOptions({ imageBoost, maxImageCandidates, maxImageTopK });

  return {
    retrieve: async (input) => {
      const baseResult = await retriever.retrieve(input);

      if (!shouldRunImageOcrRetrieval(input)) {
        return baseResult;
      }

      const imageResult = await retriever.retrieve({
        ...input,
        filters: imageOcrRetrievalFilters(input.filters),
        limit: Math.min(input.limit, maxImageCandidates),
        topK: Math.min(input.topK, maxImageTopK),
      });

      return {
        items: mergeImageOcrRetrievalItems({
          baseItems: baseResult.items,
          imageBoost,
          imageItems: imageResult.items,
          limit: input.limit,
        }),
        metrics: imageOcrRetrievalMetrics(baseResult.metrics, imageResult.items.length),
        plan: baseResult.plan,
      };
    },
  };
}

export function createGraphExpandedRetrievalPath({
  fanout,
  graph,
  graphBoost,
  graphTopK,
  maxDepth,
  maxSeedEntities,
  maxTraversalNodes,
  publishedGraph,
  retriever,
  strictPublishedReads = false,
  timeoutMs,
}: GraphExpandedRetrievalPathOptions): BasicHybridRetriever {
  validateGraphExpandedRetrievalOptions({
    fanout,
    graphBoost,
    graphTopK,
    maxDepth,
    maxSeedEntities,
    maxTraversalNodes,
    timeoutMs,
  });

  return {
    retrieve: async (input) => {
      const baseResult = await retriever.retrieve(input);
      if (!shouldRunModeExtension(input.mode, "graph-expansion")) {
        return baseResult;
      }
      const snapshot = input.projectionSnapshot;
      if (strictPublishedReads && !snapshot) {
        throw new Error("Deep graph retrieval requires a published projection snapshot");
      }
      if (snapshot && snapshot.knowledgeSpaceId !== input.knowledgeSpaceId) {
        throw new Error("Published graph snapshot knowledgeSpaceId does not match retrieval input");
      }
      if (snapshot && input.tenantId !== undefined && snapshot.tenantId !== input.tenantId) {
        throw new Error("Published graph snapshot tenantId does not match retrieval input");
      }
      if (snapshot && !publishedGraph) {
        throw new DeepGraphCapabilityUnavailableError();
      }

      const expansionStartedAt = Date.now();
      const metadataSeedEntityIds = graphSeedEntityIdsFromItems(baseResult.items, maxSeedEntities);
      const seedEntityIds = snapshot
        ? uniqueStrings(
            await (publishedGraph as PublishedGraphIndexRepository).findSeedEntityIds({
              candidateEntityIds: metadataSeedEntityIds,
              limit: maxSeedEntities,
              permissionScope: input.permissionScope ?? [],
              snapshot,
              sourceNodeIds: baseResult.items.map((item) => item.nodeId),
            }),
          ).slice(0, maxSeedEntities)
        : metadataSeedEntityIds;

      if (seedEntityIds.length === 0) {
        return withGraphExpansionMetrics(baseResult, [], 0, [], Date.now() - expansionStartedAt);
      }

      const traversalResults = await Promise.all(
        seedEntityIds.map((startEntityId) =>
          snapshot
            ? (publishedGraph as PublishedGraphIndexRepository).traverse({
                fanout,
                maxDepth,
                maxNodes: maxTraversalNodes,
                permissionScope: input.permissionScope ?? [],
                snapshot,
                startEntityId,
                timeoutMs,
              })
            : graph.traverse({
                fanout,
                knowledgeSpaceId: input.knowledgeSpaceId,
                maxDepth,
                maxNodes: maxTraversalNodes,
                permissionScope: input.permissionScope ?? [],
                startEntityId,
                timeoutMs,
              }),
        ),
      );
      const permissionScope = normalizeRetrievalPermissionScope(input.permissionScope);
      const graphEntities = uniqueGraphTraversalEntities(
        traversalResults.flatMap((result) => result.entities),
      ).filter((entity) => canReadGraphEntity(entity, permissionScope));
      // Nodes persist graphEntityIds; keep names as a compatibility fallback for older metadata.
      const graphEntityFilters = uniqueStrings(
        graphEntities.flatMap((entity) => [entity.id, entity.name]),
      ).slice(0, graphTopK * 2);
      const graphSourceNodeIds = uniqueStrings(
        graphEntities.flatMap((entity) => entity.sourceNodeIds),
      );
      const publishedGraphCandidateNodeIds = snapshot
        ? intersectPublishedGraphSourceNodeIds(input.filters?.nodeIds, graphSourceNodeIds)
        : [];

      if (
        graphEntityFilters.length === 0 ||
        (snapshot && publishedGraphCandidateNodeIds.length === 0)
      ) {
        return withGraphExpansionMetrics(
          baseResult,
          traversalResults,
          0,
          seedEntityIds,
          Date.now() - expansionStartedAt,
        );
      }

      const graphResult = await retriever.retrieve({
        ...input,
        filters: snapshot
          ? publishedGraphExpandedRetrievalFilters(input.filters, publishedGraphCandidateNodeIds)
          : graphExpandedRetrievalFilters(input.filters, graphEntityFilters),
        limit: graphTopK,
        topK: graphTopK,
      });

      return {
        items: mergeGraphExpandedRetrievalItems({
          baseItems: baseResult.items,
          graphBoost,
          graphItems: graphResult.items,
          limit: input.limit,
          seedEntityIds,
          traversedEntityIds: graphEntities.map((entity) => entity.id),
        }),
        metrics: graphExpandedRetrievalMetrics({
          baseMetrics: baseResult.metrics,
          expansionMs: Date.now() - expansionStartedAt,
          graphCandidateCount: graphResult.items.length,
          seedEntityIds,
          traversalResults,
        }),
        plan: baseResult.plan,
      };
    },
  };
}

function validateGraphExpandedRetrievalOptions({
  fanout,
  graphBoost,
  graphTopK,
  maxDepth,
  maxSeedEntities,
  maxTraversalNodes,
  timeoutMs,
}: Omit<
  GraphExpandedRetrievalPathOptions,
  "graph" | "publishedGraph" | "retriever" | "strictPublishedReads"
>): void {
  if (!Number.isInteger(maxSeedEntities) || maxSeedEntities < 1) {
    throw new Error("Graph expanded retrieval maxSeedEntities must be at least 1");
  }

  if (!Number.isInteger(graphTopK) || graphTopK < 1) {
    throw new Error("Graph expanded retrieval graphTopK must be at least 1");
  }

  if (!Number.isFinite(graphBoost) || graphBoost <= 0) {
    throw new Error("Graph expanded retrieval graphBoost must be greater than 0");
  }

  validateGraphTraversalInput({
    fanout,
    knowledgeSpaceId: "validation",
    maxDepth,
    maxNodes: maxTraversalNodes,
    startEntityId: "validation",
    timeoutMs,
  });
}

function validateTableSpecificRetrievalOptions({
  maxTableCandidates,
  maxTableTopK,
  tableBoost,
}: Omit<TableSpecificRetrievalPathOptions, "retriever">): void {
  if (!Number.isInteger(maxTableCandidates) || maxTableCandidates < 1) {
    throw new Error("Table retrieval maxTableCandidates must be at least 1");
  }

  if (!Number.isInteger(maxTableTopK) || maxTableTopK < 1) {
    throw new Error("Table retrieval maxTableTopK must be at least 1");
  }

  if (!Number.isFinite(tableBoost) || tableBoost <= 0) {
    throw new Error("Table retrieval tableBoost must be greater than 0");
  }
}

function shouldRunTableSpecificRetrieval(input: RetrieveHybridInput): boolean {
  if (!shouldRunModeExtension(input.mode, "table-specific")) {
    return false;
  }

  const nodeKinds = input.filters?.nodeKinds;

  if (nodeKinds && !nodeKinds.includes("table")) {
    return false;
  }

  return Boolean(nodeKinds?.includes("table") || isTabularRetrievalQuery(input.query));
}

function isTabularRetrievalQuery(query: string): boolean {
  return /\b(table|tables|tabular|row|rows|column|columns|cell|cells|csv|spreadsheet|sheet)\b/i.test(
    query,
  );
}

function tableSpecificRetrievalFilters(
  filters: RetrievalMetadataFilters | undefined,
): RetrievalMetadataFilters {
  return {
    ...(filters ?? {}),
    nodeKinds: ["table"],
  };
}

function mergeTableSpecificRetrievalItems({
  baseItems,
  limit,
  tableBoost,
  tableItems,
}: {
  readonly baseItems: readonly HybridRetrievalItem[];
  readonly limit: number;
  readonly tableBoost: number;
  readonly tableItems: readonly HybridRetrievalItem[];
}): HybridRetrievalItem[] {
  const byNodeId = new Map<string, HybridRetrievalItem>();

  for (const item of baseItems) {
    byNodeId.set(item.nodeId, cloneHybridRetrievalItem(item));
  }

  for (const item of tableItems) {
    const existing = byNodeId.get(item.nodeId);
    const tableRetrieval = {
      boost: tableBoost,
      reason: "tabular-query",
    };

    if (existing) {
      byNodeId.set(item.nodeId, {
        ...existing,
        metadata: {
          ...cloneJsonObject(existing.metadata),
          tableRetrieval,
        },
        projectionIds: uniqueStrings([...existing.projectionIds, ...item.projectionIds]),
        score: existing.score + item.score * tableBoost,
        sources: uniqueRetrievalSources([...existing.sources, ...item.sources]),
      });
      continue;
    }

    byNodeId.set(item.nodeId, {
      ...cloneHybridRetrievalItem(item),
      metadata: {
        ...cloneJsonObject(item.metadata),
        tableRetrieval,
      },
      score: item.score + tableBoost,
    });
  }

  return Array.from(byNodeId.values())
    .sort(
      (first, second) => second.score - first.score || first.nodeId.localeCompare(second.nodeId),
    )
    .slice(0, limit)
    .map(cloneHybridRetrievalItem);
}

function tableSpecificRetrievalMetrics(
  baseMetrics: HybridRetrievalMetrics | undefined,
  tableCandidateCount: number,
): HybridRetrievalMetrics | undefined {
  return baseMetrics
    ? {
        ...baseMetrics,
        tableCandidates: tableCandidateCount,
      }
    : undefined;
}

function validateImageOcrRetrievalOptions({
  imageBoost,
  maxImageCandidates,
  maxImageTopK,
}: Omit<ImageOcrRetrievalPathOptions, "retriever">): void {
  if (!Number.isInteger(maxImageCandidates) || maxImageCandidates < 1) {
    throw new Error("Image retrieval maxImageCandidates must be at least 1");
  }

  if (!Number.isInteger(maxImageTopK) || maxImageTopK < 1) {
    throw new Error("Image retrieval maxImageTopK must be at least 1");
  }

  if (!Number.isFinite(imageBoost) || imageBoost <= 0) {
    throw new Error("Image retrieval imageBoost must be greater than 0");
  }
}

function shouldRunImageOcrRetrieval(input: RetrieveHybridInput): boolean {
  if (!shouldRunModeExtension(input.mode, "image-ocr")) {
    return false;
  }

  const nodeKinds = input.filters?.nodeKinds;

  if (nodeKinds && !nodeKinds.includes("image")) {
    return false;
  }

  return Boolean(nodeKinds?.includes("image") || isVisualRetrievalQuery(input.query));
}

function shouldRunModeExtension(
  mode: ResolvedRetrievalMode | undefined,
  extension:
    | "document-outline"
    | "graph-expansion"
    | "image-ocr"
    | "summary-tree"
    | "table-specific",
): boolean {
  const effectiveMode = mode ?? "fast";

  switch (effectiveMode) {
    case "fast":
      return false;
    case "deep":
      return (
        extension === "graph-expansion" ||
        extension === "table-specific" ||
        extension === "image-ocr"
      );
    case "research":
      return (
        extension === "document-outline" ||
        extension === "summary-tree" ||
        extension === "table-specific" ||
        extension === "image-ocr"
      );
  }
}

function uniqueOutlineKeys(
  items: readonly HybridRetrievalItem[],
): Array<{ readonly documentAssetId: string; readonly documentVersion: number }> {
  const seen = new Set<string>();
  const keys: Array<{ readonly documentAssetId: string; readonly documentVersion: number }> = [];

  for (const item of items) {
    const key = outlineKey(item.citation.documentAssetId, item.citation.documentVersion);

    if (!seen.has(key)) {
      seen.add(key);
      keys.push({
        documentAssetId: item.citation.documentAssetId,
        documentVersion: item.citation.documentVersion,
      });
    }
  }

  return keys;
}

function outlineKey(documentAssetId: string, version: number): string {
  return `${documentAssetId}:${version}`;
}

function selectReasoningTreeSearchMatch(
  query: string,
  items: readonly HybridRetrievalItem[],
  outlineByKey: ReadonlyMap<string, DocumentOutline>,
): {
  readonly node: DocumentOutlineNode;
  readonly outline: DocumentOutline;
  readonly visitedNodeIds: string[];
} | null {
  let selected:
    | {
        readonly node: DocumentOutlineNode;
        readonly outline: DocumentOutline;
        readonly score: number;
        readonly visitedNodeIds: string[];
      }
    | undefined;

  for (const outline of outlineByKey.values()) {
    const outlineItems = items.filter(
      (item) =>
        item.citation.documentAssetId === outline.documentAssetId &&
        item.citation.documentVersion === outline.version,
    );
    const visit = (node: DocumentOutlineNode, ancestors: readonly DocumentOutlineNode[]) => {
      const citationScore = Math.max(
        0,
        ...outlineItems.map((item) => outlineNodeMatchScore(node, item)),
      );
      if (citationScore > 0) {
        const queryScore = outlineNodeQueryScore(node, query);
        // Query relevance leads PageIndex navigation; citation locality is the bounded tie-breaker.
        const score = queryScore * 1_000 + citationScore;
        if (
          !selected ||
          score > selected.score ||
          (score === selected.score && node.level > selected.node.level)
        ) {
          selected = {
            node,
            outline,
            score,
            visitedNodeIds: [...ancestors.map((ancestor) => ancestor.id), node.id],
          };
        }
      }

      for (const child of node.children) {
        visit(child, [...ancestors, node]);
      }
    };

    for (const node of outline.nodes) {
      visit(node, []);
    }
  }

  return selected
    ? {
        node: selected.node,
        outline: selected.outline,
        visitedNodeIds: selected.visitedNodeIds,
      }
    : null;
}

function outlineNodeQueryScore(node: DocumentOutlineNode, query: string): number {
  const terms = pageIndexQueryTerms(query);
  if (terms.length === 0) {
    return 0;
  }

  const title = node.title.toLocaleLowerCase();
  const summary = node.summary?.toLocaleLowerCase() ?? "";
  const section = node.sectionPath.join(" ").toLocaleLowerCase();
  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) {
      score += 4;
    }
    if (summary.includes(term)) {
      score += 3;
    }
    if (section.includes(term)) {
      score += 2;
    }
  }

  return score;
}

function pageIndexQueryTerms(query: string): string[] {
  const normalized = query.trim().toLocaleLowerCase();
  const terms = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const expanded = terms.flatMap((term) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(term)
      ? Array.from(term)
      : [term],
  );

  return [...new Set(expanded.filter((term) => term.length > 1 || /[^\p{ASCII}]/u.test(term)))];
}

function itemMatchesSelectedOutlineNode(
  item: HybridRetrievalItem,
  selection: {
    readonly node: DocumentOutlineNode;
    readonly outline: DocumentOutline;
  },
): boolean {
  if (
    item.citation.documentAssetId !== selection.outline.documentAssetId ||
    item.citation.documentVersion !== selection.outline.version
  ) {
    return false;
  }

  return outlineNodeMatchScore(selection.node, item) > 0;
}

function findBestOutlineNode(
  outline: DocumentOutline,
  item: HybridRetrievalItem,
): { readonly node: DocumentOutlineNode; readonly visitedNodeIds: string[] } | null {
  let bestNode: DocumentOutlineNode | undefined;
  let bestScore = 0;
  let bestVisitedNodeIds: string[] = [];
  const visit = (node: DocumentOutlineNode, ancestors: readonly DocumentOutlineNode[]) => {
    const visitedNodeIds = [...ancestors.map((ancestor) => ancestor.id), node.id];
    const score = outlineNodeMatchScore(node, item);

    if (score > bestScore) {
      bestNode = node;
      bestScore = score;
      bestVisitedNodeIds = visitedNodeIds;
    }

    for (const child of node.children) {
      visit(child, [...ancestors, node]);
    }
  };

  for (const node of outline.nodes) {
    visit(node, []);
  }

  return bestNode ? { node: bestNode, visitedNodeIds: bestVisitedNodeIds } : null;
}

function outlineNodeMatchScore(node: DocumentOutlineNode, item: HybridRetrievalItem): number {
  let score = 0;

  if (retrievalSectionStartsWith(item.citation.sectionPath, node.sectionPath)) {
    score += 100 + node.sectionPath.length * 10;
  } else if (node.sectionPath.length === 1 && node.tocSource === "fallback") {
    score += 1;
  }

  if (
    item.citation.pageNumber !== undefined &&
    node.startPage !== undefined &&
    node.endPage !== undefined &&
    item.citation.pageNumber >= node.startPage &&
    item.citation.pageNumber <= node.endPage
  ) {
    score += 20;
  }

  if (
    item.citation.startOffset !== undefined &&
    node.startOffset !== undefined &&
    node.endOffset !== undefined &&
    item.citation.startOffset >= node.startOffset &&
    item.citation.startOffset <= node.endOffset
  ) {
    score += 20;
  }

  return score;
}

function documentOutlineMetadata(
  outline: DocumentOutline,
  node: DocumentOutlineNode,
): Record<string, unknown> {
  return {
    nodeId: node.id,
    outlineId: outline.id,
    outlineVersion: outline.outlineVersion,
    sectionPath: [...node.sectionPath],
    summary: node.summary,
    title: node.title,
    tocSource: node.tocSource,
    ...(node.endOffset === undefined ? {} : { endOffset: node.endOffset }),
    ...(node.endPage === undefined ? {} : { endPage: node.endPage }),
    ...(node.startOffset === undefined ? {} : { startOffset: node.startOffset }),
    ...(node.startPage === undefined ? {} : { startPage: node.startPage }),
    ...(node.titleLocation === undefined
      ? {}
      : {
          titleLocation: {
            confidence: node.titleLocation.confidence,
            ...(node.titleLocation.endOffset === undefined
              ? {}
              : { endOffset: node.titleLocation.endOffset }),
            ...(node.titleLocation.matchedText === undefined
              ? {}
              : { matchedText: node.titleLocation.matchedText }),
            ...(node.titleLocation.pageNumber === undefined
              ? {}
              : { pageNumber: node.titleLocation.pageNumber }),
            source: node.titleLocation.source,
            ...(node.titleLocation.startOffset === undefined
              ? {}
              : { startOffset: node.titleLocation.startOffset }),
          },
        }),
  };
}

function documentOutlineOpenedRange(
  outline: DocumentOutline,
  node: DocumentOutlineNode,
): Record<string, unknown> {
  return {
    documentAssetId: outline.documentAssetId,
    documentVersion: outline.version,
    outlineNodeId: node.id,
    sectionPath: [...node.sectionPath],
    title: node.title,
    ...(node.endOffset === undefined ? {} : { endOffset: node.endOffset }),
    ...(node.endPage === undefined ? {} : { endPage: node.endPage }),
    ...(node.startOffset === undefined ? {} : { startOffset: node.startOffset }),
    ...(node.startPage === undefined ? {} : { startPage: node.startPage }),
  };
}

function isVisualRetrievalQuery(query: string): boolean {
  return /\b(image|images|figure|figures|photo|photos|chart|charts|diagram|diagrams|ocr|caption|captions|screenshot|scan|scanned)\b/i.test(
    query,
  );
}

function imageOcrRetrievalFilters(
  filters: RetrievalMetadataFilters | undefined,
): RetrievalMetadataFilters {
  return {
    ...(filters ?? {}),
    nodeKinds: ["image"],
  };
}

function mergeImageOcrRetrievalItems({
  baseItems,
  imageBoost,
  imageItems,
  limit,
}: {
  readonly baseItems: readonly HybridRetrievalItem[];
  readonly imageBoost: number;
  readonly imageItems: readonly HybridRetrievalItem[];
  readonly limit: number;
}): HybridRetrievalItem[] {
  const byNodeId = new Map<string, HybridRetrievalItem>();

  for (const item of baseItems) {
    byNodeId.set(item.nodeId, cloneHybridRetrievalItem(item));
  }

  for (const item of imageItems) {
    const existing = byNodeId.get(item.nodeId);
    const imageRetrieval = {
      boost: imageBoost,
      reason: "visual-query",
    };
    const multimodalCandidate = multimodalCandidateMetadata(item);

    if (existing) {
      byNodeId.set(item.nodeId, {
        ...existing,
        metadata: {
          ...cloneJsonObject(existing.metadata),
          imageRetrieval,
          ...(multimodalCandidate ? { multimodalCandidate } : {}),
        },
        projectionIds: uniqueStrings([...existing.projectionIds, ...item.projectionIds]),
        score: existing.score + item.score * imageBoost,
        sources: uniqueRetrievalSources([...existing.sources, ...item.sources]),
      });
      continue;
    }

    byNodeId.set(item.nodeId, {
      ...cloneHybridRetrievalItem(item),
      metadata: {
        ...cloneJsonObject(item.metadata),
        imageRetrieval,
        ...(multimodalCandidate ? { multimodalCandidate } : {}),
      },
      score: item.score + imageBoost,
    });
  }

  return Array.from(byNodeId.values())
    .sort(
      (first, second) => second.score - first.score || first.nodeId.localeCompare(second.nodeId),
    )
    .slice(0, limit)
    .map(cloneHybridRetrievalItem);
}

function multimodalCandidateMetadata(
  item: HybridRetrievalItem,
): Readonly<Record<string, unknown>> | undefined {
  const multimodal = isPlainObject(item.metadata.multimodal) ? item.metadata.multimodal : {};
  const parseElementId =
    metadataString(item.metadata, "parseElementId") ??
    metadataString(multimodal, "parseElementId") ??
    firstMetadataString(item.metadata, "elementIds");

  return {
    ...(isPlainObject(multimodal.assetRef)
      ? { assetRef: cloneJsonObject(multimodal.assetRef) }
      : {}),
    ...(isPlainObject(multimodal.boundingBox)
      ? { boundingBox: cloneJsonObject(multimodal.boundingBox) }
      : {}),
    documentAssetId: item.citation.documentAssetId,
    documentVersion: item.citation.documentVersion,
    ...(metadataString(multimodal, "modality")
      ? { modality: metadataString(multimodal, "modality") }
      : {}),
    ...(parseElementId ? { parseElementId } : {}),
    ...(item.citation.pageNumber ? { pageNumber: item.citation.pageNumber } : {}),
    sectionPath: [...item.citation.sectionPath],
    source: "image-ocr-retrieval",
  };
}

function imageOcrRetrievalMetrics(
  baseMetrics: HybridRetrievalMetrics | undefined,
  imageCandidateCount: number,
): HybridRetrievalMetrics | undefined {
  return baseMetrics
    ? {
        ...baseMetrics,
        imageCandidates: imageCandidateCount,
        multimodalCandidates: (baseMetrics.multimodalCandidates ?? 0) + imageCandidateCount,
      }
    : undefined;
}

function graphSeedEntityIdsFromItems(
  items: readonly HybridRetrievalItem[],
  maxSeedEntities: number,
): string[] {
  const ids: string[] = [];

  for (const item of items) {
    for (const entityId of graphEntityIdsFromRetrievalMetadata(item.metadata)) {
      if (!ids.includes(entityId)) {
        ids.push(entityId);
      }

      if (ids.length >= maxSeedEntities) {
        return ids;
      }
    }
  }

  return ids;
}

function graphEntityIdsFromRetrievalMetadata(metadata: Record<string, unknown>): string[] {
  const ids = [
    ...graphMetadataStringValues(metadata, "graphEntityIds"),
    ...graphMetadataStringValues(metadata, "graphEntities"),
  ];
  const nodeMetadata = metadata.nodeMetadata;

  if (isPlainObject(nodeMetadata)) {
    ids.push(
      ...graphMetadataStringValues(nodeMetadata, "graphEntityIds"),
      ...graphMetadataStringValues(nodeMetadata, "graphEntities"),
    );
  }

  return uniqueStrings(ids).filter((id) => id.trim().length > 0);
}

function graphMetadataStringValues(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];

  return Array.isArray(value)
    ? value.find((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
}

function uniqueGraphTraversalEntities(
  entities: readonly GraphTraversalEntity[],
): GraphTraversalEntity[] {
  const byId = new Map<string, GraphTraversalEntity>();

  for (const entity of entities) {
    const existing = byId.get(entity.id);

    if (!existing || entity.depth < existing.depth) {
      byId.set(entity.id, {
        ...cloneGraphEntity(entity),
        depth: entity.depth,
      });
    }
  }

  return Array.from(byId.values()).sort(compareGraphTraversalEntities);
}

function canReadGraphEntity(
  entity: GraphEntity,
  allowedPermissionScope: ReadonlySet<string> | undefined,
): boolean {
  return (
    allowedPermissionScope === undefined ||
    entity.permissionScope.length === 0 ||
    entity.permissionScope.every((scope) => allowedPermissionScope.has(scope))
  );
}

function graphExpandedRetrievalFilters(
  filters: RetrievalMetadataFilters | undefined,
  graphEntityFilters: readonly string[],
): RetrievalMetadataFilters {
  return {
    ...(filters ?? {}),
    entities: uniqueStrings([...(filters?.entities ?? []), ...graphEntityFilters]),
  };
}

function publishedGraphExpandedRetrievalFilters(
  filters: RetrievalMetadataFilters | undefined,
  graphSourceNodeIds: readonly string[],
): RetrievalMetadataFilters {
  return {
    ...(filters ?? {}),
    nodeIds: uniqueStrings(graphSourceNodeIds),
  };
}

function intersectPublishedGraphSourceNodeIds(
  existingNodeIds: readonly string[] | undefined,
  graphSourceNodeIds: readonly string[],
): string[] {
  if (!existingNodeIds?.length) {
    return [...graphSourceNodeIds];
  }

  const existing = new Set(existingNodeIds);
  return graphSourceNodeIds.filter((nodeId) => existing.has(nodeId));
}

function mergeGraphExpandedRetrievalItems({
  baseItems,
  graphBoost,
  graphItems,
  limit,
  seedEntityIds,
  traversedEntityIds,
}: {
  readonly baseItems: readonly HybridRetrievalItem[];
  readonly graphBoost: number;
  readonly graphItems: readonly HybridRetrievalItem[];
  readonly limit: number;
  readonly seedEntityIds: readonly string[];
  readonly traversedEntityIds: readonly string[];
}): HybridRetrievalItem[] {
  const byNodeId = new Map<string, HybridRetrievalItem>();

  for (const item of baseItems) {
    byNodeId.set(item.nodeId, cloneHybridRetrievalItem(item));
  }

  for (const item of graphItems) {
    const existing = byNodeId.get(item.nodeId);
    const graphExpansion = {
      seedEntityIds: [...seedEntityIds],
      traversedEntityIds: [...traversedEntityIds],
    };

    if (existing) {
      byNodeId.set(item.nodeId, {
        ...existing,
        metadata: {
          ...cloneJsonObject(existing.metadata),
          graphExpansion,
        },
        projectionIds: uniqueStrings([...existing.projectionIds, ...item.projectionIds]),
        score: existing.score + item.score * graphBoost,
        sources: uniqueRetrievalSources([...existing.sources, ...item.sources]),
      });
      continue;
    }

    byNodeId.set(item.nodeId, {
      ...cloneHybridRetrievalItem(item),
      metadata: {
        ...cloneJsonObject(item.metadata),
        graphExpansion,
      },
      score: item.score * graphBoost,
    });
  }

  return Array.from(byNodeId.values())
    .sort(
      (first, second) => second.score - first.score || first.nodeId.localeCompare(second.nodeId),
    )
    .slice(0, limit)
    .map(cloneHybridRetrievalItem);
}

function uniqueRetrievalSources(sources: readonly RetrievalSource[]): RetrievalSource[] {
  const result: RetrievalSource[] = [];

  for (const source of sources) {
    if (!result.includes(source)) {
      result.push(source);
    }
  }

  return result;
}

function cloneHybridRetrievalItem(item: HybridRetrievalItem): HybridRetrievalItem {
  return {
    citation: cloneRetrievalCitation(item.citation),
    metadata: cloneJsonObject(item.metadata),
    nodeId: item.nodeId,
    ...(item.permissionScope === undefined ? {} : { permissionScope: [...item.permissionScope] }),
    projectionIds: [...item.projectionIds],
    score: item.score,
    sources: [...item.sources],
  };
}

function withGraphExpansionMetrics(
  baseResult: HybridRetrievalResult,
  traversalResults: readonly GraphTraversalResult[],
  graphCandidateCount: number,
  seedEntityIds: readonly string[],
  expansionMs: number,
): HybridRetrievalResult {
  return {
    items: baseResult.items.map(cloneHybridRetrievalItem),
    metrics: graphExpandedRetrievalMetrics({
      baseMetrics: baseResult.metrics,
      expansionMs,
      graphCandidateCount,
      seedEntityIds,
      traversalResults,
    }),
    plan: baseResult.plan,
  };
}

function graphExpandedRetrievalMetrics({
  baseMetrics,
  expansionMs,
  graphCandidateCount,
  seedEntityIds,
  traversalResults,
}: {
  readonly baseMetrics: HybridRetrievalMetrics | undefined;
  readonly expansionMs: number;
  readonly graphCandidateCount: number;
  readonly seedEntityIds: readonly string[];
  readonly traversalResults: readonly GraphTraversalResult[];
}): HybridRetrievalMetrics | undefined {
  if (!baseMetrics) {
    return undefined;
  }

  return {
    ...baseMetrics,
    graphExpansionCandidates: graphCandidateCount,
    graphExpansionMs: Math.max(0, expansionMs),
    graphExpansionTimedOut: traversalResults.some((result) => result.metrics.timedOut),
    graphExpansionRelations: traversalResults.reduce(
      (total, result) => total + result.relations.length,
      0,
    ),
    graphExpansionSeeds: seedEntityIds.length,
    graphExpansionTraversedEntities: uniqueGraphTraversalEntities(
      traversalResults.flatMap((result) => result.entities),
    ).length,
  };
}

function summaryTreeSummaryFilters(
  filters: RetrievalMetadataFilters | undefined,
): RetrievalMetadataFilters {
  return {
    ...(filters ?? {}),
    nodeKinds: ["summary"],
  };
}

function summaryTreeLeafFilters(
  filters: RetrievalMetadataFilters | undefined,
): RetrievalMetadataFilters {
  const originalKinds = filters?.nodeKinds?.filter((kind) => kind !== "summary");

  return {
    ...(filters ?? {}),
    nodeKinds:
      originalKinds && originalKinds.length > 0 ? originalKinds : ["chunk", "section", "table"],
  };
}

function retrievalSectionStartsWith(
  candidateSectionPath: readonly string[],
  selectedSectionPath: readonly string[],
): boolean {
  return selectedSectionPath.every((segment, index) => candidateSectionPath[index] === segment);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}
