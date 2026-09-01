import { EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { traceEvidenceAvailabilityFromMetadata } from "./answer-trace-evidence-availability";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import {
  evidenceBundlesHaveActiveDocuments,
  projectEvidenceBundlesToActiveDocuments,
} from "./evidence-bundle-visibility";

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

  it("bulk-projects only deleted-document items to content-free tombstones", async () => {
    const secondDocumentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6b02";
    const getManyByIds = vi.fn(async () => [
      { id: documentAssetId, knowledgeSpaceId, metadata: {} },
    ]);

    const projected = await projectEvidenceBundlesToActiveDocuments({
      assets: { getManyByIds } as never,
      bundles: [evidenceBundle(documentAssetId, secondDocumentAssetId)],
      knowledgeSpaceId,
    });

    expect(projected[0]?.items[0]).toMatchObject({
      metadata: {},
      text: "evidence-1",
    });
    expect(projected[0]?.items[1]).toMatchObject({
      citations: [{ documentAssetId: secondDocumentAssetId, sectionPath: [] }],
      conflicts: [],
      freshness: { status: "unknown" },
      text: "Evidence deleted or unavailable",
    });
    expect(traceEvidenceAvailabilityFromMetadata(projected[0]?.items[1]?.metadata ?? {})).toEqual({
      reason: "document-deleted-or-unavailable",
      status: "unavailable",
    });
    expect(getManyByIds).toHaveBeenCalledOnce();
    expect(getManyByIds).toHaveBeenCalledWith({
      ids: [documentAssetId, secondDocumentAssetId],
      knowledgeSpaceId,
    });
  });

  it("fails closed without per-document lookups when the bulk asset reader is unavailable", async () => {
    const bundle = evidenceBundle(documentAssetId);

    const projected = await projectEvidenceBundlesToActiveDocuments({
      assets: {} as never,
      bundles: [bundle],
      knowledgeSpaceId,
    });

    expect(projected[0]?.items[0]?.text).toBe("Evidence deleted or unavailable");
    expect(traceEvidenceAvailabilityFromMetadata(projected[0]?.items[0]?.metadata ?? {})).toEqual({
      reason: "evidence-unavailable",
      status: "unavailable",
    });
  });
});
