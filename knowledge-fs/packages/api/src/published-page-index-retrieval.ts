import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";

import { cloneJsonObject } from "./json-utils";
import {
  type PageIndexSemanticCandidate,
  PageIndexSemanticScoreVersion,
  type PageIndexSemanticTreeSearch,
} from "./page-index-semantic-tree-search";
import {
  type HybridRetrievalRepository,
  type RetrievalCandidate,
  filterRetrievalCandidatesByMetadata,
  filterRetrievalCandidatesByPermission,
  normalizeRetrievalPermissionScope,
} from "./retrieval-candidates";
import { normalizeRetrievalMetadataFilters } from "./retrieval-filter-utils";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import { normalizeRetrievalScoreSeries } from "./retrieval-fusion";
import type { RetrievalPlanner } from "./retrieval-planner";
import { evidenceTextFromHybridItem } from "./retrieval-rerank";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  HybridRetrievalResult,
  RetrievalPlan,
  RetrieveHybridInput,
} from "./retrieval-types";

export interface PublishedPageIndexRetrievalOptions {
  /** Maximum number of dense evidence candidates sent to the reasoning model. */
  readonly maxSemanticCandidates: number;
  readonly now?: (() => number) | undefined;
  readonly planner: RetrievalPlanner;
  readonly retriever: BasicHybridRetriever;
  /** Profile-scoped LLM judge used for value-guided PageIndex tree search. */
  readonly semanticTreeSearch: PageIndexSemanticTreeSearch;
  /**
   * Published dense projections provide the semantic value signal. Production repositories must
   * enforce publication membership in SQL before returning candidates.
   */
  readonly valueSearch: Pick<
    HybridRetrievalRepository,
    "publishedMembershipEnforced" | "searchDense"
  >;
}

export class PublishedPageIndexCapabilityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedPageIndexCapabilityUnavailableError";
  }
}

interface ValueCandidate {
  readonly candidate: RetrievalCandidate;
  readonly candidateId: string;
  readonly sectionValueScore: number;
  readonly valueScore: number;
}

interface ValueSection {
  readonly candidates: readonly {
    readonly candidate: RetrievalCandidate;
    readonly normalizedScore: number;
  }[];
  readonly key: string;
  readonly score: number;
}

/**
 * Replaces the Research leg with semantic Value Search followed by LLM PageIndex tree scoring.
 *
 * Fast and Deep delegate unchanged. Research first searches the immutable published dense
 * projections, aggregates chunk values by document section path, keeps a diverse value-ranked
 * evidence set, and asks the frozen knowledge-space reasoning model to assign the final [0, 1]
 * evidence scores. Exact-term/PageIndex character coverage is not part of final selection.
 */
export function createPublishedPageIndexRetrievalPath({
  maxSemanticCandidates,
  now = Date.now,
  planner,
  retriever,
  semanticTreeSearch,
  valueSearch,
}: PublishedPageIndexRetrievalOptions): BasicHybridRetriever {
  validatePositiveInteger(maxSemanticCandidates, "maxSemanticCandidates");

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
        input,
        maxSemanticCandidates,
        now,
        plan,
        semanticTreeSearch,
        valueSearch,
      });
    },
  };
}

async function retrievePublishedPageIndex({
  input,
  maxSemanticCandidates,
  now,
  plan,
  semanticTreeSearch,
  valueSearch,
}: {
  readonly input: RetrieveHybridInput;
  readonly maxSemanticCandidates: number;
  readonly now: () => number;
  readonly plan: RetrievalPlan;
  readonly semanticTreeSearch: PageIndexSemanticTreeSearch;
  readonly valueSearch: Pick<
    HybridRetrievalRepository,
    "publishedMembershipEnforced" | "searchDense"
  >;
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
  if (!input.retrievalProfile) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research semantic tree search requires a frozen retrieval profile",
    );
  }
  if (!input.denseProjectionModel?.trim()) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research semantic Value Search requires a frozen embedding vector space",
    );
  }
  if (input.queryVector.length === 0 || !input.queryVector.every(Number.isFinite)) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research semantic Value Search requires a finite query embedding",
    );
  }
  if (valueSearch.publishedMembershipEnforced !== true) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research semantic Value Search requires authoritative published-membership filtering",
    );
  }

  const valueStartedAt = now();
  const rawValueCandidates = await valueSearch.searchDense({
    denseProjectionModel: input.denseProjectionModel,
    denseProjectionStatuses: input.denseProjectionStatuses,
    denseProjectionVersion: input.denseProjectionVersion,
    filters: input.filters,
    knowledgeSpaceId: input.knowledgeSpaceId,
    permissionScope: input.permissionScope,
    projectionSetCandidateFingerprint: input.projectionSetCandidateFingerprint,
    projectionSetFingerprint: input.projectionSetFingerprint,
    projectionSetPublicationId: snapshot.publicationId,
    projectionSetReadMode: input.projectionSetReadMode,
    queryVector: input.queryVector,
    tenantId: snapshot.tenantId,
    topK: Math.max(1, plan.denseTopK),
  });
  const valueMs = Math.max(0, now() - valueStartedAt);
  const metadataFiltered = filterRetrievalCandidatesByMetadata(
    rawValueCandidates,
    normalizeRetrievalMetadataFilters(input.filters),
  );
  const permissionFiltered = filterRetrievalCandidatesByPermission(
    metadataFiltered,
    normalizeRetrievalPermissionScope(input.permissionScope),
  );
  const valueCandidates = buildValueCandidates(
    permissionFiltered,
    Math.min(maxSemanticCandidates, plan.denseTopK),
  );
  const candidateTruncated = permissionFiltered.length > valueCandidates.length;

  if (valueCandidates.length === 0) {
    return {
      items: [],
      metrics: semanticPageIndexMetrics({
        candidateTruncated,
        denseCandidates: rawValueCandidates.length,
        finalItems: 0,
        metadataFilteredCandidates: rawValueCandidates.length - metadataFiltered.length,
        permissionFilteredCandidates: metadataFiltered.length - permissionFiltered.length,
        scoredCandidates: 0,
        selectedSections: 0,
        thresholdFiltered: 0,
        totalMs: Math.max(0, now() - startedAt),
        valueMs,
      }),
      plan,
    };
  }

  const scored = await semanticTreeSearch.score({
    candidates: valueCandidates.map(pageIndexSemanticCandidate),
    query: input.query,
    reasoningModel: input.retrievalProfile.reasoningModel,
    tenantId: snapshot.tenantId,
  });
  const scoresByCandidateId = new Map(scored.map((score) => [score.candidateId, score]));
  const threshold = scoreThreshold(input.retrievalProfile);
  const scoredItems = valueCandidates
    .map((entry): HybridRetrievalItem => {
      const semanticScore = scoresByCandidateId.get(entry.candidateId);
      if (!semanticScore) {
        throw new PublishedPageIndexCapabilityUnavailableError(
          `Research semantic tree search omitted candidate=${entry.candidateId}`,
        );
      }
      return semanticPageIndexItem({
        entry,
        reason: semanticScore.reason,
        score: semanticScore.score,
        snapshotFingerprint: snapshot.fingerprint,
        snapshotHeadRevision: snapshot.headRevision,
        snapshotPublicationId: snapshot.publicationId,
      });
    })
    .sort(
      (first, second) => second.score - first.score || first.nodeId.localeCompare(second.nodeId),
    );
  const relevantItems = scoredItems.filter((item) => item.score > 0);
  const thresholded =
    threshold === undefined
      ? relevantItems
      : relevantItems.filter((item) => item.score >= threshold);
  const items = thresholded.slice(0, input.limit);
  const selectedSectionCount = new Set(
    items.map((item) => valueSectionKey(item.citation.documentAssetId, item.citation.sectionPath)),
  ).size;

  return {
    items,
    metrics: semanticPageIndexMetrics({
      candidateTruncated,
      denseCandidates: rawValueCandidates.length,
      finalItems: items.length,
      metadataFilteredCandidates: rawValueCandidates.length - metadataFiltered.length,
      permissionFilteredCandidates: metadataFiltered.length - permissionFiltered.length,
      scoredCandidates: scoredItems.length,
      selectedSections: selectedSectionCount,
      thresholdFiltered: relevantItems.length - thresholded.length,
      totalMs: Math.max(0, now() - startedAt),
      valueMs,
    }),
    plan,
  };
}

function buildValueCandidates(
  candidates: readonly RetrievalCandidate[],
  limit: number,
): readonly ValueCandidate[] {
  if (candidates.length === 0 || limit < 1) {
    return [];
  }
  const normalized = normalizeRetrievalScoreSeries(candidates.map((candidate) => candidate.score));
  const sections = new Map<
    string,
    {
      candidates: {
        readonly candidate: RetrievalCandidate;
        readonly normalizedScore: number;
      }[];
      key: string;
      rawScore: number;
    }
  >();
  candidates.forEach((candidate, index) => {
    const normalizedScore = normalized[index] ?? 0;
    const key = valueSectionKey(candidate.citation.documentAssetId, candidate.citation.sectionPath);
    const section = sections.get(key) ?? { candidates: [], key, rawScore: 0 };
    section.candidates.push({ candidate, normalizedScore });
    section.rawScore += normalizedScore;
    sections.set(key, section);
  });

  const rawSections = [...sections.values()].map(
    (section): ValueSection => ({
      candidates: section.candidates.sort(
        (left, right) =>
          right.normalizedScore - left.normalizedScore ||
          left.candidate.nodeId.localeCompare(right.candidate.nodeId),
      ),
      key: section.key,
      score: section.rawScore / Math.sqrt(section.candidates.length + 1),
    }),
  );
  const normalizedSectionScores = normalizeRetrievalScoreSeries(
    rawSections.map((section) => section.score),
  );
  const rankedSections = rawSections
    .map((section, index) => ({
      ...section,
      score: normalizedSectionScores[index] ?? 0,
    }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));

  // Round-robin across PageIndex paths prevents one long section from consuming the complete LLM
  // candidate budget while retaining each section's strongest semantic chunks first.
  const selected: ValueCandidate[] = [];
  for (let depth = 0; selected.length < limit; depth += 1) {
    let added = false;
    for (const section of rankedSections) {
      const entry = section.candidates[depth];
      if (!entry) {
        continue;
      }
      added = true;
      selected.push({
        candidate: entry.candidate,
        candidateId: `c${selected.length + 1}`,
        sectionValueScore: section.score,
        valueScore: entry.normalizedScore,
      });
      if (selected.length >= limit) {
        break;
      }
    }
    if (!added) {
      break;
    }
  }
  return selected;
}

function pageIndexSemanticCandidate(entry: ValueCandidate): PageIndexSemanticCandidate {
  return {
    candidateId: entry.candidateId,
    documentAssetId: entry.candidate.citation.documentAssetId,
    nodeId: entry.candidate.nodeId,
    sectionPath: [...entry.candidate.citation.sectionPath],
    sectionValueScore: entry.sectionValueScore,
    text: evidenceTextFromHybridItem({
      citation: entry.candidate.citation,
      metadata: entry.candidate.metadata,
      nodeId: entry.candidate.nodeId,
      permissionScope: entry.candidate.permissionScope,
      projectionIds: [entry.candidate.projectionId],
      score: entry.candidate.score,
      sources: [entry.candidate.source],
    }),
    valueScore: entry.valueScore,
  };
}

function semanticPageIndexItem({
  entry,
  reason,
  score,
  snapshotFingerprint,
  snapshotHeadRevision,
  snapshotPublicationId,
}: {
  readonly entry: ValueCandidate;
  readonly reason: string;
  readonly score: number;
  readonly snapshotFingerprint: string;
  readonly snapshotHeadRevision: number;
  readonly snapshotPublicationId: string;
}): HybridRetrievalItem {
  const candidate = entry.candidate;
  return {
    citation: {
      ...candidate.citation,
      sectionPath: [...candidate.citation.sectionPath],
    },
    metadata: {
      ...cloneJsonObject(candidate.metadata),
      pageIndex: {
        llmReason: reason,
        normalizedScore: score,
        scoreVersion: PageIndexSemanticScoreVersion,
        sectionValueScore: entry.sectionValueScore,
        valueScore: entry.valueScore,
      },
      projectionSnapshot: {
        fingerprint: snapshotFingerprint,
        headRevision: snapshotHeadRevision,
        publicationId: snapshotPublicationId,
      },
      reasoningTreeSearch: {
        selectedNodeId: candidate.nodeId,
        selectedSectionPath: [...candidate.citation.sectionPath],
        strategy: PageIndexSemanticScoreVersion,
        valueSearch: {
          sectionValueScore: entry.sectionValueScore,
          valueScore: entry.valueScore,
        },
      },
    },
    nodeId: candidate.nodeId,
    permissionScope: [...candidate.permissionScope],
    projectionIds: [candidate.projectionId],
    score,
    sources: uniqueSources([candidate.source, "pageindex"]),
  };
}

function semanticPageIndexMetrics({
  candidateTruncated,
  denseCandidates,
  finalItems,
  metadataFilteredCandidates,
  permissionFilteredCandidates,
  scoredCandidates,
  selectedSections,
  thresholdFiltered,
  totalMs,
  valueMs,
}: {
  readonly candidateTruncated: boolean;
  readonly denseCandidates: number;
  readonly finalItems: number;
  readonly metadataFilteredCandidates: number;
  readonly permissionFilteredCandidates: number;
  readonly scoredCandidates: number;
  readonly selectedSections: number;
  readonly thresholdFiltered: number;
  readonly totalMs: number;
  readonly valueMs: number;
}): HybridRetrievalMetrics {
  return {
    denseCandidates,
    denseMs: valueMs,
    documentOutlineMatchedItems: finalItems,
    ftsCandidates: 0,
    ftsMs: 0,
    fusedCandidates: scoredCandidates,
    fusionMs: 0,
    metadataFilteredCandidates,
    pageIndexCandidateTruncated: candidateTruncated,
    pageIndexMatchedNodes: scoredCandidates,
    pageIndexOpenedRanges: selectedSections,
    pageIndexScannedNodes: scoredCandidates,
    pageIndexScannedOutlines: selectedSections,
    pageIndexScoreVersion: PageIndexSemanticScoreVersion,
    permissionFilteredCandidates,
    reasoningTreeSearchNodes: scoredCandidates,
    scoreThresholdFilteredCandidates: thresholdFiltered,
    summaryCandidates: 0,
    summarySelectedSections: selectedSections,
    totalMs,
  };
}

function scoreThreshold(profile: KnowledgeSpaceRetrievalProfile): number | undefined {
  return profile.scoreThreshold.enabled ? profile.scoreThreshold.value : undefined;
}

function valueSectionKey(documentAssetId: string, sectionPath: readonly string[]): string {
  return `${documentAssetId}\u001e${sectionPath.join("\u001f")}`;
}

function uniqueSources(
  sources: readonly HybridRetrievalItem["sources"][number][],
): HybridRetrievalItem["sources"] {
  return [...new Set(sources)];
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Published PageIndex retrieval ${name} must be a positive integer`);
  }
}
