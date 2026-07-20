import { cloneJsonObject } from "./json-utils";
import {
  type RetrievalCandidate,
  type RetrievalCitation,
  type RetrievalSource,
  cloneRetrievalCitation,
} from "./retrieval-candidates";

export interface HybridRetrievalItem {
  readonly citation: RetrievalCitation;
  readonly metadata: Record<string, unknown>;
  readonly nodeId: string;
  readonly permissionScope?: readonly string[] | undefined;
  readonly projectionIds: string[];
  readonly score: number;
  readonly sources: RetrievalSource[];
}

export interface RetrievalFusionRuntime {
  rrfFuse(input: RetrievalRrfFuseInput): RetrievalRrfFusedItem[];
}

export interface RetrievalRrfFuseInput {
  readonly config: {
    readonly k: number;
    readonly limit: number;
    readonly maxInputBytes: number;
    readonly maxItemsPerList: number;
    readonly maxLists: number;
    readonly maxOutputItems: number;
  };
  readonly rankedLists: readonly {
    readonly items: readonly { readonly id: string }[];
    readonly weight: number;
  }[];
}

export interface RetrievalRrfFusedItem {
  readonly id: string;
  readonly ranks: readonly {
    readonly listIndex: number;
    readonly rank: number;
    readonly weight: number;
  }[];
  readonly score: number;
}

export interface RetrievalFusionPlanShape {
  readonly denseTopK: number;
  readonly ftsTopK: number;
  readonly fusionLimit: number;
}

export function fuseRetrievalCandidates({
  dense,
  fts,
  limit,
  rrfK,
}: {
  readonly dense: readonly RetrievalCandidate[];
  readonly fts: readonly RetrievalCandidate[];
  readonly limit: number;
  readonly rrfK: number;
}): HybridRetrievalItem[] {
  if (!Number.isFinite(rrfK) || rrfK < 1) {
    throw new Error("Hybrid retrieval rrfK must be at least 1");
  }

  const byNodeId = new Map<
    string,
    {
      citation: RetrievalCitation;
      metadata: Record<string, unknown>;
      nodeId: string;
      permissionScope: string[];
      projectionIds: string[];
      score: number;
      sources: RetrievalSource[];
    }
  >();
  const addCandidate = (candidate: RetrievalCandidate, rank: number) => {
    const existing = byNodeId.get(candidate.nodeId);
    const contribution = 1 / (rrfK + rank + 1);

    if (existing) {
      existing.score += contribution;
      existing.metadata = mergeRetrievalMetadata(existing.metadata, candidate.metadata);
      existing.projectionIds.push(candidate.projectionId);

      if (!existing.sources.includes(candidate.source)) {
        existing.sources.push(candidate.source);
      }

      return;
    }

    byNodeId.set(candidate.nodeId, {
      citation: cloneRetrievalCitation(candidate.citation),
      metadata: cloneJsonObject(candidate.metadata),
      nodeId: candidate.nodeId,
      permissionScope: [...candidate.permissionScope],
      projectionIds: [candidate.projectionId],
      score: contribution,
      sources: [candidate.source],
    });
  };

  const applyLeg = (leg: readonly RetrievalCandidate[]): void => {
    // Collapse duplicate projections of the same node WITHIN a leg to one RRF contribution.
    // A node with both a text-surrogate and a visual-asset dense projection must not be
    // double-weighted, and its RRF rank must reflect node position, not projection position.
    for (const [rank, entry] of dedupeLegByNode(leg).entries()) {
      addCandidate(entry.candidate, rank);

      if (entry.extraProjectionIds.length > 0) {
        const node = byNodeId.get(entry.candidate.nodeId);
        node?.projectionIds.push(...entry.extraProjectionIds);
      }
    }
  };

  applyLeg(dense);
  applyLeg(fts);

  return finalizeFusion(byNodeId, limit);
}

interface DedupedLegEntry {
  readonly candidate: RetrievalCandidate;
  readonly extraProjectionIds: string[];
}

/**
 * Keep one entry per nodeId within a single retrieval leg (candidates are score-ordered, so the
 * first occurrence is the node's best rank). Projection ids of the dropped duplicates are retained.
 */
function dedupeLegByNode(candidates: readonly RetrievalCandidate[]): DedupedLegEntry[] {
  const indexByNode = new Map<string, number>();
  const entries: DedupedLegEntry[] = [];

  for (const candidate of candidates) {
    const existingIndex = indexByNode.get(candidate.nodeId);

    if (existingIndex !== undefined) {
      entries[existingIndex]?.extraProjectionIds.push(candidate.projectionId);
      continue;
    }

    indexByNode.set(candidate.nodeId, entries.length);
    entries.push({ candidate, extraProjectionIds: [] });
  }

  return entries;
}

function finalizeFusion(
  byNodeId: Map<
    string,
    {
      citation: RetrievalCitation;
      metadata: Record<string, unknown>;
      nodeId: string;
      permissionScope: string[];
      projectionIds: string[];
      score: number;
      sources: RetrievalSource[];
    }
  >,
  limit: number,
): HybridRetrievalItem[] {
  return [...byNodeId.values()]
    .sort(
      (first, second) => second.score - first.score || first.nodeId.localeCompare(second.nodeId),
    )
    .slice(0, limit)
    .map((item) => ({
      citation: cloneRetrievalCitation(item.citation),
      metadata: cloneJsonObject(item.metadata),
      nodeId: item.nodeId,
      permissionScope: [...item.permissionScope],
      projectionIds: [...item.projectionIds],
      score: item.score,
      sources: [...item.sources],
    }));
}

export function fuseRetrievalCandidatesWithRuntime({
  dense,
  fts,
  fusion,
  limit,
  plan,
  rrfK,
}: {
  readonly dense: readonly RetrievalCandidate[];
  readonly fts: readonly RetrievalCandidate[];
  readonly fusion: RetrievalFusionRuntime;
  readonly limit: number;
  readonly plan: RetrievalFusionPlanShape;
  readonly rrfK: number;
}): HybridRetrievalItem[] {
  const aggregates = aggregateRetrievalCandidates({ dense, fts });
  const fused = fusion.rrfFuse({
    config: {
      k: rrfK,
      limit: plan.fusionLimit,
      maxInputBytes: 1024 * 1024,
      maxItemsPerList: Math.max(plan.denseTopK, plan.ftsTopK),
      maxLists: 2,
      maxOutputItems: plan.fusionLimit,
    },
    rankedLists: [
      {
        items: dense.map((candidate) => ({ id: candidate.nodeId })),
        weight: 1,
      },
      {
        items: fts.map((candidate) => ({ id: candidate.nodeId })),
        weight: 1,
      },
    ],
  });

  return fused
    .map((item): HybridRetrievalItem | null => {
      const aggregate = aggregates.get(item.id);

      if (!aggregate) {
        return null;
      }

      return {
        citation: cloneRetrievalCitation(aggregate.citation),
        metadata: cloneJsonObject(aggregate.metadata),
        nodeId: aggregate.nodeId,
        permissionScope: [...aggregate.permissionScope],
        projectionIds: [...aggregate.projectionIds],
        score: item.score,
        sources: [...aggregate.sources],
      };
    })
    .filter((item): item is HybridRetrievalItem => item !== null)
    .slice(0, limit);
}

function aggregateRetrievalCandidates({
  dense,
  fts,
}: {
  readonly dense: readonly RetrievalCandidate[];
  readonly fts: readonly RetrievalCandidate[];
}): Map<
  string,
  {
    citation: RetrievalCitation;
    metadata: Record<string, unknown>;
    nodeId: string;
    permissionScope: string[];
    projectionIds: string[];
    sources: RetrievalSource[];
  }
> {
  const byNodeId = new Map<
    string,
    {
      citation: RetrievalCitation;
      metadata: Record<string, unknown>;
      nodeId: string;
      permissionScope: string[];
      projectionIds: string[];
      sources: RetrievalSource[];
    }
  >();
  const addCandidate = (candidate: RetrievalCandidate) => {
    const existing = byNodeId.get(candidate.nodeId);

    if (existing) {
      existing.metadata = mergeRetrievalMetadata(existing.metadata, candidate.metadata);
      existing.projectionIds.push(candidate.projectionId);

      if (!existing.sources.includes(candidate.source)) {
        existing.sources.push(candidate.source);
      }

      return;
    }

    byNodeId.set(candidate.nodeId, {
      citation: cloneRetrievalCitation(candidate.citation),
      metadata: cloneJsonObject(candidate.metadata),
      nodeId: candidate.nodeId,
      permissionScope: [...candidate.permissionScope],
      projectionIds: [candidate.projectionId],
      sources: [candidate.source],
    });
  };

  for (const candidate of dense) {
    addCandidate(candidate);
  }

  for (const candidate of fts) {
    addCandidate(candidate);
  }

  return byNodeId;
}

function mergeRetrievalMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...cloneJsonObject(incoming),
    ...cloneJsonObject(existing),
  };
}
