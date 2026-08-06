import { type EvidenceBundle, EvidenceBundleSchema, type JobPayload } from "@knowledge/core";
import { z } from "zod";

import {
  type PageIndexLayeredTreeCheckpoint,
  parsePageIndexLayeredTreeCheckpoint,
} from "./page-index-layered-tree-search";
import type { PageIndexNodeQueueItem } from "./page-index-node-queue";
import type { ResearchRetrievalBudgetSnapshot } from "./research-retrieval-policy";
import type { RetrievalSource } from "./retrieval-candidates";
import type { HybridRetrievalResult } from "./retrieval-types";

const retrievalSources = new Set<RetrievalSource>(["dense", "fts", "pageindex", "visual"]);

export const ResearchRetrievalCheckpointVersion = "research-retrieval-checkpoint-v2" as const;
export const RESEARCH_RETRIEVAL_DURABLE_CHECKPOINT_METADATA_KEY =
  "__knowledgeFsResearchRetrievalCheckpointV2" as const;

export interface ResearchRetrievalCheckpointNavigation {
  readonly documentAssetId: string;
  readonly documentScore: number;
  readonly estimatedPromptTokens: number;
  readonly generationId: string;
  readonly layeredCheckpoint: PageIndexLayeredTreeCheckpoint;
  readonly outlineId: string;
  readonly scannedNodeIds: readonly string[];
}

export interface ResearchRetrievalCheckpointMetrics {
  readonly candidateTruncated: boolean;
  readonly degradationFlags: readonly string[];
  readonly denseCandidates: number;
  readonly fallbackDocuments: number;
  readonly flattenedLevels: number;
  readonly layeredDocuments: number;
  readonly layeredSteps: number;
  readonly metadataFilteredCandidates: number;
  readonly openedRanges: number;
  readonly permissionFilteredCandidates: number;
  readonly scannedNodes: number;
  readonly selectedDocuments: number;
  readonly serializedTreeTokens: number;
  readonly valueMs: number;
  readonly wholeTreeDocuments: number;
}

export interface ResearchRetrievalSearchCheckpoint {
  readonly budget: ResearchRetrievalBudgetSnapshot;
  readonly fingerprint: string;
  readonly knowledgeSpaceId: string;
  readonly metrics: ResearchRetrievalCheckpointMetrics;
  readonly missingAspects: readonly string[];
  readonly navigation: readonly ResearchRetrievalCheckpointNavigation[];
  readonly openedRangeCount: number;
  readonly openedTruncated: boolean;
  readonly phase: "complete" | "evidence" | "navigation";
  readonly publicationId: string;
  readonly query: string;
  readonly queue: readonly PageIndexNodeQueueItem[];
  readonly queueOffset: number;
  readonly researchSufficiencyReached: boolean;
  readonly sequence: number;
  readonly tenantId: string;
  readonly traceId: string;
  readonly version: typeof ResearchRetrievalCheckpointVersion;
}

export interface ResearchRetrievalDurableCheckpoint {
  readonly evidenceBundle: EvidenceBundle;
  readonly searchState: ResearchRetrievalSearchCheckpoint;
}

const durableCheckpointEnvelopeSchema = z
  .object({
    evidenceBundle: z.unknown(),
    searchState: z.unknown(),
  })
  .strict();

const budgetSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    exhaustedReasons: z
      .array(
        z.enum([
          "model-calls",
          "opened-resources",
          "retrieval-steps",
          "rounds",
          "supplemental-searches",
          "wall-clock",
        ]),
      )
      .max(6),
    modelCalls: z.number().int().nonnegative(),
    openedResources: z.number().int().nonnegative(),
    retrievalSteps: z.number().int().nonnegative(),
    rounds: z.number().int().nonnegative(),
    supplementalSearches: z.number().int().nonnegative(),
  })
  .strict();

const metricsSchema = z
  .object({
    candidateTruncated: z.boolean(),
    degradationFlags: z.array(z.string().trim().min(1).max(200)).max(100),
    denseCandidates: z.number().int().nonnegative(),
    fallbackDocuments: z.number().int().nonnegative(),
    flattenedLevels: z.number().int().nonnegative(),
    layeredDocuments: z.number().int().nonnegative(),
    layeredSteps: z.number().int().nonnegative(),
    metadataFilteredCandidates: z.number().int().nonnegative(),
    openedRanges: z.number().int().nonnegative(),
    permissionFilteredCandidates: z.number().int().nonnegative(),
    scannedNodes: z.number().int().nonnegative(),
    selectedDocuments: z.number().int().nonnegative(),
    serializedTreeTokens: z.number().int().nonnegative(),
    valueMs: z.number().nonnegative(),
    wholeTreeDocuments: z.number().int().nonnegative(),
  })
  .strict();

const queueItemSchema = z
  .object({
    contributions: z.array(z.enum(["llm", "value"])).max(2),
    documentAssetId: z.string().min(1).max(512),
    documentScore: z.number().min(0).max(1),
    generationId: z.string().min(1).max(512),
    llmReason: z.string().min(1).max(500).optional(),
    llmScore: z.number().min(0).max(1).optional(),
    outlineId: z.string().min(1).max(512),
    outlineNodeId: z.string().min(1).max(512),
    priorityScore: z.number().min(0).max(1),
    valueBreadthScore: z.number().min(0).max(1),
    valuePeakScore: z.number().min(0).max(1),
  })
  .strict();

const searchCheckpointBaseSchema = z
  .object({
    budget: budgetSchema,
    fingerprint: z.string().min(1).max(512),
    knowledgeSpaceId: z.string().min(1).max(512),
    metrics: metricsSchema,
    missingAspects: z.array(z.string().trim().min(1).max(500)).max(100),
    navigation: z
      .array(
        z
          .object({
            documentAssetId: z.string().min(1).max(512),
            documentScore: z.number().min(0).max(1),
            estimatedPromptTokens: z.number().int().nonnegative(),
            generationId: z.string().min(1).max(512),
            layeredCheckpoint: z.unknown(),
            outlineId: z.string().min(1).max(512),
            scannedNodeIds: z.array(z.string().min(1).max(512)).max(100_000),
          })
          .strict(),
      )
      .max(100),
    openedRangeCount: z.number().int().nonnegative(),
    openedTruncated: z.boolean(),
    phase: z.enum(["complete", "evidence", "navigation"]),
    publicationId: z.string().min(1).max(512),
    query: z.string().trim().min(1).max(16_384),
    queue: z.array(queueItemSchema).max(1_000),
    queueOffset: z.number().int().nonnegative(),
    researchSufficiencyReached: z.boolean(),
    sequence: z.number().int().nonnegative(),
    tenantId: z.string().min(1).max(512),
    traceId: z.string().min(1).max(512),
    version: z.literal(ResearchRetrievalCheckpointVersion),
  })
  .strict();

export function parseResearchRetrievalSearchCheckpoint(
  value: unknown,
): ResearchRetrievalSearchCheckpoint {
  const parsed = searchCheckpointBaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Research retrieval search checkpoint is invalid", {
      cause: parsed.error,
    });
  }
  if (parsed.data.queueOffset > parsed.data.queue.length) {
    throw new Error("Research retrieval search checkpoint queueOffset exceeds queue length");
  }
  const navigation = parsed.data.navigation.map((entry) => ({
    ...entry,
    layeredCheckpoint: parsePageIndexLayeredTreeCheckpoint(entry.layeredCheckpoint),
  }));
  const identities = new Set<string>();
  for (const entry of navigation) {
    const identity = `${entry.documentAssetId}\u001f${entry.outlineId}`;
    if (identities.has(identity)) {
      throw new Error("Research retrieval search checkpoint contains duplicate navigation state");
    }
    identities.add(identity);
    if (
      entry.layeredCheckpoint.documentAssetId !== entry.documentAssetId ||
      entry.layeredCheckpoint.outlineId !== entry.outlineId ||
      entry.layeredCheckpoint.query !== parsed.data.query
    ) {
      throw new Error("Research retrieval search checkpoint navigation scope mismatch");
    }
  }
  return { ...parsed.data, navigation };
}

export function validateResearchRetrievalDurableCheckpoint(
  value: unknown,
): ResearchRetrievalDurableCheckpoint {
  const envelope = durableCheckpointEnvelopeSchema.parse(value);
  const evidenceBundle = EvidenceBundleSchema.parse(envelope.evidenceBundle);
  const searchState = parseResearchRetrievalSearchCheckpoint(envelope.searchState);
  if (
    evidenceBundle.query !== searchState.query ||
    (evidenceBundle.traceId !== undefined && evidenceBundle.traceId !== searchState.traceId)
  ) {
    throw new Error("Research retrieval durable checkpoint scope mismatch");
  }
  return { evidenceBundle, searchState };
}

export function toResearchRetrievalDurableCheckpointPayload(
  checkpoint: ResearchRetrievalDurableCheckpoint,
): JobPayload {
  return JSON.parse(
    JSON.stringify(validateResearchRetrievalDurableCheckpoint(checkpoint)),
  ) as JobPayload;
}

export function researchRetrievalDurableCheckpointFromMetadata(
  metadata: Readonly<Record<string, JobPayload>>,
): ResearchRetrievalDurableCheckpoint | undefined {
  const value = metadata[RESEARCH_RETRIEVAL_DURABLE_CHECKPOINT_METADATA_KEY];
  return value === undefined ? undefined : validateResearchRetrievalDurableCheckpoint(value);
}

export function validateResearchRetrievalSearchCheckpointScope({
  checkpoint,
  fingerprint,
  knowledgeSpaceId,
  publicationId,
  query,
  tenantId,
  traceId,
}: {
  readonly checkpoint: ResearchRetrievalSearchCheckpoint;
  readonly fingerprint: string;
  readonly knowledgeSpaceId: string;
  readonly publicationId: string;
  readonly query: string;
  readonly tenantId: string;
  readonly traceId: string;
}): ResearchRetrievalSearchCheckpoint {
  const parsed = parseResearchRetrievalSearchCheckpoint(checkpoint);
  if (
    parsed.fingerprint !== fingerprint ||
    parsed.knowledgeSpaceId !== knowledgeSpaceId ||
    parsed.publicationId !== publicationId ||
    parsed.query !== query.trim() ||
    parsed.tenantId !== tenantId ||
    parsed.traceId !== traceId
  ) {
    throw new Error("Research retrieval search checkpoint scope mismatch");
  }
  return parsed;
}

/**
 * Rehydrates the bounded evidence persisted at a replay-safe Research boundary. The checkpoint is
 * scoped by the durable job and is re-authorized by the worker before use; this conversion never
 * performs a mutable projection read.
 */
export function retrievalResultFromResearchCheckpoint(
  value: EvidenceBundle,
): HybridRetrievalResult {
  const bundle = EvidenceBundleSchema.parse(value);
  return {
    items: bundle.items.map((item) => {
      const citation = item.citations[0];
      if (!citation) {
        throw new Error(`Research retrieval checkpoint node=${item.nodeId} has no citation`);
      }
      if (!citation.artifactHash) {
        throw new Error(`Research retrieval checkpoint node=${item.nodeId} has no artifact hash`);
      }
      const projectionIds = stringArray(item.metadata.projectionIds);
      const sources = stringArray(item.metadata.sources).filter(
        (source): source is RetrievalSource => retrievalSources.has(source as RetrievalSource),
      );
      return {
        citation: {
          artifactHash: citation.artifactHash,
          documentAssetId: citation.documentAssetId,
          documentVersion: citation.documentVersion,
          ...(citation.endOffset === undefined ? {} : { endOffset: citation.endOffset }),
          ...(citation.pageNumber === undefined ? {} : { pageNumber: citation.pageNumber }),
          sectionPath: [...citation.sectionPath],
          ...(citation.startOffset === undefined ? {} : { startOffset: citation.startOffset }),
        },
        metadata: {
          checkpointed: true,
          retrievalScore: item.scores.retrieval,
          text: item.text,
        },
        nodeId: item.nodeId,
        projectionIds:
          projectionIds.length > 0 ? projectionIds : [`research-checkpoint:${item.nodeId}`],
        score: item.scores.final,
        sources: sources.length > 0 ? sources : ["pageindex"],
      };
    }),
  };
}

export function validateResearchRetrievalCheckpointScope({
  checkpoint,
  query,
  traceId,
}: {
  readonly checkpoint: EvidenceBundle;
  readonly query: string;
  readonly traceId: string;
}): EvidenceBundle {
  const parsed = EvidenceBundleSchema.parse(checkpoint);
  if (parsed.query !== query.trim()) {
    throw new Error("Research retrieval checkpoint query mismatch");
  }
  if (parsed.traceId !== undefined && parsed.traceId !== traceId) {
    throw new Error("Research retrieval checkpoint trace mismatch");
  }
  return parsed;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}
