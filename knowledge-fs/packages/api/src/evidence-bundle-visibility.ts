import type { EvidenceBundle } from "@knowledge/core";

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
  readonly assets: Pick<DocumentAssetRepository, "get">;
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

  const referencedAssets = await Promise.all(
    [...documentAssetIds].sort().map((id) => assets.get({ id, knowledgeSpaceId })),
  );
  return referencedAssets.every(Boolean);
}
