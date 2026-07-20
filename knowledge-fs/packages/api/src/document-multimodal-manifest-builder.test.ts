import { describe, expect, it } from "vitest";

import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const sha256 = "a".repeat(64);

describe("createDocumentMultimodalManifestBuilder", () => {
  it("builds deterministic multimodal manifests from parse artifact elements", () => {
    const builder = createDocumentMultimodalManifestBuilder({ maxTextPreviewChars: 24 });
    const manifest = builder.build({
      artifact: {
        artifactHash: sha256,
        contentType: "mixed",
        createdAt: "2026-06-22T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            id: "heading-1",
            metadata: {},
            sectionPath: ["Metrics"],
            text: "Metrics",
            type: "heading",
          },
          {
            id: "table-1",
            metadata: { rows: [{ amount: "$120", vendor: "Acme" }], title: "Renewal amounts" },
            pageNumber: 2,
            sectionPath: ["Metrics"],
            text: "vendor | amount\nAcme | $120",
            type: "table",
          },
          {
            id: "image-1",
            metadata: {
              assetRef: {
                contentType: "image/png",
                objectKey: "tenant-dev/spaces/space/artifacts/figure-1.png",
                sha256: "b".repeat(64),
                variants: {
                  thumbnail: {
                    contentType: "image/png",
                    height: 90,
                    objectKey: "tenant-dev/spaces/space/artifacts/figure-1-thumbnail.png",
                    sha256: "c".repeat(64),
                    width: 120,
                  },
                },
              },
              boundingBox: { height: 120, width: 240, x: 10, y: 20 },
              caption: "Renewal trend chart",
              ocrText: "Q1 renewals increased 12%",
            },
            pageNumber: 3,
            sectionPath: ["Metrics", "Charts"],
            type: "image",
          },
          {
            id: "code-1",
            metadata: {},
            sectionPath: ["Appendix"],
            text: "SELECT * FROM renewals",
            type: "code",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "unstructured",
        version: 1,
      },
      knowledgeSpaceId,
    });
    const rebuilt = builder.build({
      artifact: {
        ...manifestFixture(),
        elements: manifestFixture().elements,
      },
      knowledgeSpaceId,
    });

    expect(manifest.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(rebuilt.id).toBe(manifest.id);
    expect(manifest.items.map((item) => item.modality)).toEqual(["table", "image", "code"]);
    expect(manifest.items[0]).toMatchObject({
      enrichment: { tableStructure: "provided", visualEmbedding: "unsupported" },
      pageNumber: 2,
      parseElementId: "table-1",
      textPreview: "vendor | amount\nAcme ...",
      title: "Renewal amounts",
    });
    expect(manifest.items[1]).toMatchObject({
      assetRef: {
        contentType: "image/png",
        sha256: "b".repeat(64),
        variants: {
          thumbnail: {
            objectKey: "tenant-dev/spaces/space/artifacts/figure-1-thumbnail.png",
            sha256: "c".repeat(64),
          },
        },
      },
      boundingBox: { height: 120, width: 240, x: 10, y: 20 },
      caption: "Renewal trend chart",
      enrichment: {
        asset: "provided",
        caption: "provided",
        ocr: "provided",
        visualEmbedding: "missing",
      },
      ocrText: "Q1 renewals increased 12%",
      sectionPath: ["Metrics", "Charts"],
      textPreview: "Q1 renewals increased...",
    });
    expect(manifest.metadata).toMatchObject({
      modalityCounts: { code: 1, image: 1, page: 0, table: 1 },
      missingVisualEmbeddingCount: 1,
      source: "parse-artifact",
    });
  });

  it("marks rasterized table assets as visual embedding candidates", () => {
    const builder = createDocumentMultimodalManifestBuilder();
    const manifest = builder.build({
      artifact: {
        ...manifestFixture(),
        elements: [
          {
            id: "table-1",
            metadata: {
              assetRef: {
                contentType: "image/png",
                objectKey: "tenant-dev/spaces/space/artifacts/table-1.png",
                sha256: "d".repeat(64),
              },
              boundingBox: { height: 120, width: 320, x: 24, y: 48 },
              pdfRaster: { cropKind: "table", pageNumber: 5 },
              rows: [{ amount: "$120", vendor: "Acme" }],
              title: "Renewal amounts",
            },
            pageNumber: 5,
            sectionPath: ["Metrics"],
            text: "vendor | amount\nAcme | $120",
            type: "table",
          },
        ],
      },
      knowledgeSpaceId,
    });

    expect(manifest.items[0]).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: "tenant-dev/spaces/space/artifacts/table-1.png",
      },
      enrichment: {
        asset: "provided",
        tableStructure: "provided",
        visualEmbedding: "missing",
      },
      modality: "table",
      sourceMetadata: {
        pdfRaster: { cropKind: "table" },
      },
    });
    expect(manifest.metadata).toMatchObject({
      missingAssetCount: 0,
      missingVisualEmbeddingCount: 1,
      modalityCounts: { code: 0, image: 0, page: 0, table: 1 },
    });
  });

  it("does not fabricate an assetRef from unrelated top-level metadata", () => {
    const builder = createDocumentMultimodalManifestBuilder();
    const manifest = builder.build({
      artifact: {
        artifactHash: sha256,
        contentType: "mixed",
        createdAt: "2026-06-22T00:00:00.000Z",
        documentAssetId,
        elements: [
          {
            // A generic source hyperlink + doc mime type, but NO real extracted asset.
            id: "image-1",
            metadata: { mimeType: "application/pdf", uri: "https://example.com/source" },
            sectionPath: ["Charts"],
            type: "image",
          },
          {
            // A real extracted asset carried at the top level (objectKey) is still recognized.
            id: "image-2",
            metadata: {
              contentType: "image/png",
              objectKey: "tenant-1/spaces/s/documents/d/assets/image-2.png",
              sha256: "b".repeat(64),
            },
            sectionPath: ["Charts"],
            type: "image",
          },
        ],
        id: parseArtifactId,
        metadata: {},
        parser: "unstructured",
        version: 1,
      },
      knowledgeSpaceId,
    });

    expect(manifest.items[0]?.assetRef).toBeUndefined();
    expect(manifest.items[0]?.enrichment.asset).toBe("missing");
    expect(manifest.items[1]?.assetRef?.objectKey).toBe(
      "tenant-1/spaces/s/documents/d/assets/image-2.png",
    );
    expect(manifest.items[1]?.enrichment.asset).toBe("provided");
  });

  it("uses generation-scoped deterministic ids for candidate manifests", () => {
    const builder = createDocumentMultimodalManifestBuilder();
    const firstGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60";
    const secondGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61";
    const first = builder.build({
      artifact: manifestFixture(),
      knowledgeSpaceId,
      publicationGenerationId: firstGeneration,
    });
    const retried = builder.build({
      artifact: manifestFixture(),
      knowledgeSpaceId,
      publicationGenerationId: firstGeneration,
    });
    const second = builder.build({
      artifact: manifestFixture(),
      knowledgeSpaceId,
      publicationGenerationId: secondGeneration,
    });

    expect(first.publicationGenerationId).toBe(firstGeneration);
    expect(retried.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
    expect(() =>
      builder.build({
        artifact: manifestFixture(),
        knowledgeSpaceId,
        publicationGenerationId: "",
      }),
    ).toThrow();
  });

  it("rejects unbounded builder options", () => {
    expect(() => createDocumentMultimodalManifestBuilder({ maxTextPreviewChars: 0 })).toThrow(
      "Document multimodal manifest maxTextPreviewChars must be at least 1",
    );
    expect(() => createDocumentMultimodalManifestBuilder({ manifestVersion: "" })).toThrow(
      "Document multimodal manifest version must be non-empty",
    );
  });
});

function manifestFixture() {
  return {
    artifactHash: sha256,
    contentType: "mixed" as const,
    createdAt: "2026-06-22T00:00:00.000Z",
    documentAssetId,
    elements: [
      {
        id: "table-1",
        metadata: { rows: [{ amount: "$120", vendor: "Acme" }], title: "Renewal amounts" },
        pageNumber: 2,
        sectionPath: ["Metrics"],
        text: "vendor | amount\nAcme | $120",
        type: "table" as const,
      },
    ],
    id: parseArtifactId,
    metadata: {},
    parser: "unstructured" as const,
    version: 1,
  };
}
