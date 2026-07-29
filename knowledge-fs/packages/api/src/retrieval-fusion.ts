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
}: {
  readonly dense: readonly RetrievalCandidate[];
  readonly fts: readonly RetrievalCandidate[];
  readonly limit: number;
}): HybridRetrievalItem[] {
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
  const denseLeg = normalizeLeg(dedupeLegByNode(dense));
  const ftsLeg = normalizeLeg(dedupeLegByNode(fts));
  const activeLegs = Number(denseLeg.length > 0) + Number(ftsLeg.length > 0);

  if (activeLegs === 0) {
    return [];
  }

  const legWeight = 1 / activeLegs;
  const addCandidate = (entry: NormalizedLegEntry, contribution: number): void => {
    const { candidate, extraProjectionIds } = entry;
    const existing = byNodeId.get(candidate.nodeId);

    if (existing) {
      existing.score += contribution;
      existing.metadata = mergeRetrievalMetadata(existing.metadata, candidate.metadata);
      existing.projectionIds.push(candidate.projectionId, ...extraProjectionIds);

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
      projectionIds: [candidate.projectionId, ...extraProjectionIds],
      score: contribution,
      sources: [candidate.source],
    });
  };

  const applyLeg = (leg: readonly NormalizedLegEntry[]): void => {
    for (const entry of leg) {
      addCandidate(entry, entry.normalizedScore * legWeight);
    }
  };

  applyLeg(denseLeg);
  applyLeg(ftsLeg);

  return finalizeFusion(byNodeId, limit);
}

interface DedupedLegEntry {
  readonly candidate: RetrievalCandidate;
  readonly extraProjectionIds: string[];
}

interface NormalizedLegEntry extends DedupedLegEntry {
  readonly normalizedScore: number;
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

/**
 * Relative-score fusion must compare like with like. Dense similarity and FTS rank use different
 * score domains, so each non-empty leg is independently min-max normalized before weighting.
 * A singleton/equal-score leg maps to 1 because every candidate in that leg is tied for best.
 */
function normalizeLeg(entries: readonly DedupedLegEntry[]): NormalizedLegEntry[] {
  const normalizedScores = normalizeRetrievalScoreSeries(
    entries.map((entry) => entry.candidate.score),
  );

  return entries.map((entry, index) => ({
    ...entry,
    normalizedScore: normalizedScores[index] ?? 0,
  }));
}

export function normalizeRetrievalScoreSeries(scores: readonly number[]): number[] {
  if (scores.length === 0) {
    return [];
  }

  for (const score of scores) {
    if (!Number.isFinite(score)) {
      throw new Error("Hybrid retrieval candidate scores must contain only finite numbers");
    }
  }

  const minimum = Math.min(...scores);
  const maximum = Math.max(...scores);
  if (maximum === minimum) {
    return scores.map(() => 1);
  }

  const range = maximum - minimum;
  return scores.map((score) => Math.min(1, Math.max(0, (score - minimum) / range)));
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
