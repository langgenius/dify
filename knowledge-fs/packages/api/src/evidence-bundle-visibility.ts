import type { EvidenceBundle, EvidenceItem } from "@knowledge/core";

import {
  TRACE_EVIDENCE_AVAILABILITY_METADATA_KEY,
  TRACE_UNAVAILABLE_EVIDENCE_TEXT,
  type TraceEvidenceUnavailableReason,
} from "./answer-trace-evidence-availability";
import type { DocumentAssetRepository } from "./document-asset-repository";

const DefaultMaxEvidenceDocumentAssets = 1_000;

/**
 * Revalidates the live document closure behind persisted evidence.
 *
 * DocumentAssetRepository.get is deliberately active-only. Consequently this check also rejects
 * evidence backed by a document (or parent Source) whose durable deletion has been accepted, even
 * while the AnswerTrace/Research partial/workspace snapshot is waiting for physical cleanup.
 */
export async function evidenceBundlesHaveActiveDocuments({
  assets,
  bundles,
  knowledgeSpaceId,
  maxDocumentAssets = DefaultMaxEvidenceDocumentAssets,
}: {
  readonly assets: Pick<DocumentAssetRepository, "get" | "getManyByIds">;
  readonly bundles: readonly EvidenceBundle[];
  readonly knowledgeSpaceId: string;
  readonly maxDocumentAssets?: number | undefined;
}): Promise<boolean> {
  if (!Number.isSafeInteger(maxDocumentAssets) || maxDocumentAssets < 1) {
    throw new Error("Evidence visibility maxDocumentAssets must be a positive integer");
  }

  const documentAssetIds = new Set<string>();
  for (const bundle of bundles) {
    for (const item of bundle.items) {
      for (const citation of item.citations) {
        documentAssetIds.add(citation.documentAssetId);
        if (documentAssetIds.size > maxDocumentAssets) return false;
      }
    }
  }

  const sortedIds = [...documentAssetIds].sort();
  if (assets.getManyByIds) {
    const referencedAssets = await assets.getManyByIds({ ids: sortedIds, knowledgeSpaceId });
    const activeIds = new Set(referencedAssets.map((asset) => asset.id));
    return sortedIds.every((id) => activeIds.has(id));
  }
  const referencedAssets = await Promise.all(
    sortedIds.map((id) => assets.get({ id, knowledgeSpaceId })),
  );
  return referencedAssets.every(Boolean);
}

/**
 * Projects a page of persisted Research evidence with one active-document lookup. History stays
 * visible, while an item that cites a deleted/deleting document becomes a content-free tombstone.
 * Missing bulk-read support fails closed without falling back to an N+1 read path.
 */
export async function projectEvidenceBundlesToActiveDocuments({
  assets,
  bundles,
  knowledgeSpaceId,
  maxDocumentAssets = DefaultMaxEvidenceDocumentAssets,
}: {
  readonly assets: Pick<DocumentAssetRepository, "getManyByIds">;
  readonly bundles: readonly EvidenceBundle[];
  readonly knowledgeSpaceId: string;
  readonly maxDocumentAssets?: number | undefined;
}): Promise<readonly EvidenceBundle[]> {
  if (!Number.isSafeInteger(maxDocumentAssets) || maxDocumentAssets < 1) {
    throw new Error("Evidence visibility maxDocumentAssets must be a positive integer");
  }

  const documentAssetIds = new Set<string>();
  for (const bundle of bundles) {
    for (const item of bundle.items) {
      for (const citation of item.citations) {
        documentAssetIds.add(citation.documentAssetId);
        if (documentAssetIds.size > maxDocumentAssets) {
          return bundles.map((candidate) =>
            unavailableEvidenceBundle(candidate, "evidence-unavailable"),
          );
        }
      }
    }
  }

  const sortedIds = [...documentAssetIds].sort();
  if (sortedIds.length === 0) return bundles;
  if (!assets.getManyByIds) {
    return bundles.map((bundle) => unavailableEvidenceBundle(bundle, "evidence-unavailable"));
  }
  const activeAssets = await assets.getManyByIds({ ids: sortedIds, knowledgeSpaceId });
  const activeAssetIds = new Set(activeAssets.map((asset) => asset.id));
  return bundles.map((bundle) => ({
    ...bundle,
    items: bundle.items.map((item) =>
      item.citations.every((citation) => activeAssetIds.has(citation.documentAssetId))
        ? item
        : unavailableEvidenceItem(item, "document-deleted-or-unavailable"),
    ),
  }));
}

function unavailableEvidenceBundle(
  bundle: EvidenceBundle,
  reason: TraceEvidenceUnavailableReason,
): EvidenceBundle {
  return {
    ...bundle,
    items: bundle.items.map((item) => unavailableEvidenceItem(item, reason)),
  };
}

function unavailableEvidenceItem(
  item: EvidenceItem,
  reason: TraceEvidenceUnavailableReason,
): EvidenceItem {
  return {
    ...item,
    citations: item.citations.map((citation) => ({
      documentAssetId: citation.documentAssetId,
      documentVersion: citation.documentVersion,
      sectionPath: [],
    })),
    conflicts: [],
    freshness: { status: "unknown" },
    metadata: {
      [TRACE_EVIDENCE_AVAILABILITY_METADATA_KEY]: {
        reason,
        status: "unavailable",
      },
    },
    text: TRACE_UNAVAILABLE_EVIDENCE_TEXT,
  };
}
