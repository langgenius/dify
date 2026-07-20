import {
  type DocumentAssetRepository,
  createInMemoryDocumentAssetRepository,
} from "./document-asset-repository";

/**
 * Seeds the backing assets required by candidate-readable path and node fixtures. A path alone is
 * intentionally insufficient authorization: production reads close over the current asset ACL.
 */
export async function createInitializedTestDocumentAssets(
  knowledgeSpaceId: string,
  assetIds: readonly string[],
) {
  const assets = createInMemoryDocumentAssetRepository({
    maxAssets: Math.max(1, assetIds.length),
  });
  for (const [index, id] of assetIds.entries()) {
    await assets.create({
      filename: `candidate-asset-${index + 1}.md`,
      id,
      knowledgeSpaceId,
      metadata: { permissionScope: [] },
      mimeType: "text/markdown",
      objectKey: `tenant-1/spaces/${knowledgeSpaceId}/documents/${id}/document.md`,
      sha256: String(index + 1).padStart(64, "0"),
      sizeBytes: 1,
      tenantId: "tenant-1",
    });
  }
  return assets;
}

export function rollbackInitializedTestDocumentAsset(
  assets: DocumentAssetRepository,
  knowledgeSpaceId: string,
  id: string,
) {
  return assets.rollbackStaleWrite({
    expectedObjectKey: `tenant-1/spaces/${knowledgeSpaceId}/documents/${id}/document.md`,
    expectedVersion: 1,
    id,
    knowledgeSpaceId,
  });
}
