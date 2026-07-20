import { ParseArtifactSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { createDocumentMultimodalCandidateResolver } from "./document-multimodal-candidate-resolver";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import { createInMemoryDocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("document multimodal candidate resolver", () => {
  it("resolves parse element candidates to manifest items and KnowledgeFS asset routes", async () => {
    const assets = createInMemoryDocumentAssetRepository({
      generateId: () => documentAssetId,
      maxAssets: 1,
      now: () => "2026-06-23T00:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    await assets.create({
      filename: "Quarterly Report.pdf",
      knowledgeSpaceId,
      mimeType: "application/pdf",
      objectKey: "tenant-dev/spaces/space/documents/report.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
    });
    const artifact = await parseArtifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: "b".repeat(64),
        contentType: "mixed",
        createdAt: "2026-06-23T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "figure-1",
            metadata: {
              assetRef: {
                contentType: "image/png",
                objectKey:
                  "tenant-dev/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/assets/figure-1.png",
                sha256: "c".repeat(64),
                uri: "data:image/png;base64,AAAA",
              },
              boundingBox: { height: 120, width: 240, x: 10, y: 20 },
              caption: "Revenue bridge",
              endOffset: 220,
              startOffset: 120,
            },
            pageNumber: 4,
            sectionPath: ["Financials", "Revenue"],
            type: "image",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "unstructured",
        version: 1,
      }),
    );
    const manifests = createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 });
    const deterministicManifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId,
    });
    await manifests.upsert({
      ...deterministicManifest,
      items: deterministicManifest.items.map((item) => ({
        ...item,
        ocrText: "Revenue increased by 18% (persisted OCR)",
      })),
      metadata: { ...deterministicManifest.metadata, enrichment: { source: "persisted" } },
    });
    const resolver = createDocumentMultimodalCandidateResolver({
      assets,
      manifests,
      parseArtifacts,
    });

    await expect(
      resolver.resolve({
        candidate: {
          documentAssetId,
          documentVersion: 1,
          pageNumber: 3,
          parseElementId: "figure-1",
          sectionPath: ["Financials"],
          source: "image-ocr-retrieval",
        },
        knowledgeSpaceId,
      }),
    ).resolves.toMatchObject({
      assetDescriptorPath:
        "/knowledge/docs/Quarterly-Report.pdf--018f0d60/assets/image-Revenue-bridge--018f0d60.json",
      assetRef: {
        contentType: "image/png",
        objectKey:
          "tenant-dev/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/assets/figure-1.png",
        sha256: "c".repeat(64),
      },
      assetRoute:
        "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/multimodal/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44%3A0%3Afigure-1/asset",
      boundingBox: { height: 120, width: 240, x: 10, y: 20 },
      documentAssetId,
      documentVersion: 1,
      endOffset: 220,
      manifestItemId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44:0:figure-1",
      modality: "image",
      ocrText: "Revenue increased by 18% (persisted OCR)",
      pageNumber: 4,
      parseArtifactId,
      parseElementId: "figure-1",
      sectionPath: ["Financials", "Revenue"],
      source: "image-ocr-retrieval",
      startOffset: 120,
    });
  });

  it("returns null for incomplete or stale candidates", async () => {
    const resolver = createDocumentMultimodalCandidateResolver({
      assets: createInMemoryDocumentAssetRepository({ maxAssets: 1 }),
      parseArtifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 1 }),
    });

    await expect(
      resolver.resolve({
        candidate: { documentAssetId, parseElementId: "figure-1" },
        knowledgeSpaceId,
      }),
    ).resolves.toBeNull();
  });
});
