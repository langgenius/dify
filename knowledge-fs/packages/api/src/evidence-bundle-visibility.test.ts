import { EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { evidenceBundlesHaveActiveDocuments } from "./evidence-bundle-visibility";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01";

function evidenceBundle(...documentAssetIds: string[]) {
  return EvidenceBundleSchema.parse({
    createdAt: "2026-05-12T15:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a01",
    items: documentAssetIds.map((id, index) => ({
      citations: [{ documentAssetId: id, documentVersion: 1 }],
      conflicts: [],
      freshness: { status: "fresh" },
      metadata: {},
      nodeId: `018f0d60-7a49-7cc2-9c1b-5b36f18f6c0${index + 1}`,
      score: 0.9,
      scores: { final: 0.9, retrieval: 0.9 },
      text: `evidence-${index + 1}`,
    })),
    missingEvidence: [],
    query: "Which evidence is still live?",
    state: "partial",
  });
}

describe("evidenceBundlesHaveActiveDocuments", () => {
  it("fails closed as soon as a cited document is no longer active", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const objectKey = `tenant-1/spaces/${knowledgeSpaceId}/documents/${documentAssetId}/document.md`;
    await assets.create({
      filename: "evidence.md",
      id: documentAssetId,
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey,
      sha256: "a".repeat(64),
      sizeBytes: 1,
    });
    const bundle = evidenceBundle(documentAssetId);

    await expect(
      evidenceBundlesHaveActiveDocuments({ assets, bundles: [bundle], knowledgeSpaceId }),
    ).resolves.toBe(true);

    await assets.rollbackStaleWrite({
      expectedObjectKey: objectKey,
      expectedVersion: 1,
      id: documentAssetId,
      knowledgeSpaceId,
    });

    await expect(
      evidenceBundlesHaveActiveDocuments({ assets, bundles: [bundle], knowledgeSpaceId }),
    ).resolves.toBe(false);
  });

  it("rejects an oversized citation closure instead of partially validating it", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const secondDocumentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6b02";

    await expect(
      evidenceBundlesHaveActiveDocuments({
        assets,
        bundles: [evidenceBundle(documentAssetId, secondDocumentAssetId)],
        knowledgeSpaceId,
        maxDocumentAssets: 1,
      }),
    ).resolves.toBe(false);
  });
});
