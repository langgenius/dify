import { ParseArtifactSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type DocumentAssetRepository,
  createInMemoryDocumentAssetRepository,
} from "./document-asset-repository";
import { createDocumentMultimodalCandidateResolver } from "./document-multimodal-candidate-resolver";
import {
  type ParseArtifactRepository,
  createInMemoryParseArtifactRepository,
} from "./parse-artifact-repository";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("document multimodal candidate resolver branch coverage", () => {
  it("returns null when the asset, artifact version, or parse element is missing", async () => {
    const { assets, parseArtifacts } = await seedRepositories();
    const resolver = createDocumentMultimodalCandidateResolver({ assets, parseArtifacts });
    const missingAssetResolver = createDocumentMultimodalCandidateResolver({
      assets: createInMemoryDocumentAssetRepository({ maxAssets: 1 }),
      parseArtifacts,
    });

    // Asset repository has no matching document asset.
    await expect(
      missingAssetResolver.resolve({
        candidate: { documentAssetId, documentVersion: 1, parseElementId: "table-1" },
        knowledgeSpaceId,
      }),
    ).resolves.toBeNull();
    // Asset exists, but the requested document version has no parse artifact.
    await expect(
      resolver.resolve({
        candidate: { documentAssetId, documentVersion: 2, parseElementId: "table-1" },
        knowledgeSpaceId,
      }),
    ).resolves.toBeNull();
    // Artifact exists, but the parse element is not a manifest item.
    await expect(
      resolver.resolve({
        candidate: { documentAssetId, documentVersion: 1, parseElementId: "unknown-element" },
        knowledgeSpaceId,
      }),
    ).resolves.toBeNull();
    // Blank candidate strings are rejected before any lookup.
    await expect(
      resolver.resolve({
        candidate: { documentAssetId: "   ", documentVersion: 1, parseElementId: "table-1" },
        knowledgeSpaceId,
      }),
    ).resolves.toBeNull();
  });

  it("resolves table items without asset refs, bounding boxes, offsets, or page numbers", async () => {
    const { assets, parseArtifacts } = await seedRepositories();
    const resolver = createDocumentMultimodalCandidateResolver({ assets, parseArtifacts });

    const resolved = await resolver.resolve({
      candidate: { documentAssetId, documentVersion: 1, parseElementId: "table-1" },
      knowledgeSpaceId,
    });

    expect(resolved).toMatchObject({
      manifestItemId: `${parseArtifactId}:0:table-1`,
      modality: "table",
      parseArtifactId,
      sectionPath: ["Metrics"],
      textPreview: "metric | value\nARR | $12M",
    });
    expect(resolved).not.toHaveProperty("assetRef");
    expect(resolved).not.toHaveProperty("assetRoute");
    expect(resolved).not.toHaveProperty("boundingBox");
    expect(resolved).not.toHaveProperty("caption");
    expect(resolved).not.toHaveProperty("endOffset");
    expect(resolved).not.toHaveProperty("pageNumber");
    expect(resolved).not.toHaveProperty("startOffset");
  });

  it("carries OCR text and keeps non-data uris in cloned asset refs without asset routes", async () => {
    const { assets, parseArtifacts } = await seedRepositories();
    const resolver = createDocumentMultimodalCandidateResolver({ assets, parseArtifacts });

    const resolved = await resolver.resolve({
      candidate: { documentAssetId, documentVersion: 1, parseElementId: "figure-remote" },
      knowledgeSpaceId,
    });

    expect(resolved).toMatchObject({
      assetRef: { uri: "https://example.test/figure.png" },
      manifestItemId: `${parseArtifactId}:1:figure-remote`,
      modality: "image",
      ocrText: "OCR extracted revenue table",
      pageNumber: 6,
    });
    // Without an object key there is no serveable multimodal asset route,
    // and the cloned asset ref carries no content type, object key, or sha256.
    expect(resolved).not.toHaveProperty("assetRoute");
    expect(resolved?.assetRef).toEqual({ uri: "https://example.test/figure.png" });
  });
});

async function seedRepositories(): Promise<{
  assets: DocumentAssetRepository;
  parseArtifacts: ParseArtifactRepository;
}> {
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
  await parseArtifacts.create(
    ParseArtifactSchema.parse({
      artifactHash: "b".repeat(64),
      contentType: "mixed",
      createdAt: "2026-06-23T00:00:00.000Z",
      documentAssetId,
      elements: [
        {
          id: "table-1",
          metadata: {},
          sectionPath: ["Metrics"],
          text: "metric | value\nARR | $12M",
          type: "table",
        },
        {
          id: "figure-remote",
          metadata: {
            assetRef: { uri: "https://example.test/figure.png" },
            ocrText: "OCR extracted revenue table",
          },
          pageNumber: 6,
          sectionPath: ["Figures"],
          type: "image",
        },
      ],
      id: parseArtifactId,
      metadata: {},
      parser: "unstructured",
      version: 1,
    }),
  );

  return { assets, parseArtifacts };
}
