import type { EvidenceBundle } from "@knowledge/core";

import type { HybridRetrievalItem } from "./retrieval-fusion";
import { evidenceTextFromHybridItem } from "./retrieval-rerank";

export function hybridRetrievalItemToEvidenceItem(
  item: HybridRetrievalItem,
): EvidenceBundle["items"][number] {
  return {
    citations: [
      {
        artifactHash: item.citation.artifactHash,
        documentAssetId: item.citation.documentAssetId,
        documentVersion: item.citation.documentVersion,
        ...(item.citation.endOffset === undefined ? {} : { endOffset: item.citation.endOffset }),
        ...(item.citation.pageNumber === undefined ? {} : { pageNumber: item.citation.pageNumber }),
        sectionPath: [...item.citation.sectionPath],
        ...(item.citation.startOffset === undefined
          ? {}
          : { startOffset: item.citation.startOffset }),
      },
    ],
    conflicts: evidenceConflictsFromMetadata(item.metadata),
    freshness: evidenceFreshnessFromMetadata(item.metadata),
    metadata: {
      projectionIds: [...item.projectionIds],
      sources: [...item.sources],
    },
    nodeId: item.nodeId,
    score: item.score,
    scores: {
      final: item.score,
      ...(metadataScore(item.metadata, "freshnessScore") === undefined
        ? {}
        : { freshness: metadataScore(item.metadata, "freshnessScore") }),
      ...(metadataScore(item.metadata, "rerankScore") === undefined
        ? {}
        : { rerank: metadataScore(item.metadata, "rerankScore") }),
      retrieval: metadataScore(item.metadata, "retrievalScore") ?? item.score,
    },
    text: evidenceTextFromHybridItem(item),
  };
}

export function evidenceFreshnessFromMetadata(
  metadata: Record<string, unknown>,
): EvidenceBundle["items"][number]["freshness"] {
  const status = metadata.freshnessStatus;

  return {
    ...(typeof metadata.observedAt === "string" ? { observedAt: metadata.observedAt } : {}),
    ...(typeof metadata.sourceUpdatedAt === "string"
      ? { sourceUpdatedAt: metadata.sourceUpdatedAt }
      : {}),
    status: status === "fresh" || status === "stale" || status === "unknown" ? status : "unknown",
  };
}

export function evidenceConflictsFromMetadata(
  metadata: Record<string, unknown>,
): EvidenceBundle["items"][number]["conflicts"] {
  const conflicts = metadata.conflicts;
  return Array.isArray(conflicts)
    ? conflicts.filter(isEvidenceConflictMetadata).map((conflict) => ({
        reason: conflict.reason,
        severity: conflict.severity,
        ...(conflict.withNodeId === undefined ? {} : { withNodeId: conflict.withNodeId }),
      }))
    : [];
}

function isEvidenceConflictMetadata(value: unknown): value is {
  readonly reason: string;
  readonly severity: "blocking" | "info" | "warning";
  readonly withNodeId?: string | undefined;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const conflict = value as {
    readonly reason?: unknown;
    readonly severity?: unknown;
    readonly withNodeId?: unknown;
  };
  return (
    typeof conflict.reason === "string" &&
    (conflict.severity === "blocking" ||
      conflict.severity === "info" ||
      conflict.severity === "warning") &&
    (conflict.withNodeId === undefined || typeof conflict.withNodeId === "string")
  );
}

function metadataScore(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" ? value : undefined;
}
