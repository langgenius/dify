import { type ParseArtifact, ParseArtifactSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { finalizeDocumentMultimodalArtifact } from "./document-multimodal-artifact";

describe("finalizeDocumentMultimodalArtifact", () => {
  it("changes lineage for visual bytes and renderer semantics but ignores owner object keys", () => {
    const first = finalizeDocumentMultimodalArtifact(artifact({ owner: "owner-a" }));
    const sameMaterial = finalizeDocumentMultimodalArtifact(artifact({ owner: "owner-b" }));
    const changedBytes = finalizeDocumentMultimodalArtifact(
      artifact({ owner: "owner-c", sha256: "c".repeat(64) }),
    );
    const changedDpi = finalizeDocumentMultimodalArtifact(artifact({ dpi: 200, owner: "owner-d" }));

    expect(first.artifactHash).toBe(sameMaterial.artifactHash);
    expect(changedBytes.artifactHash).not.toBe(first.artifactHash);
    expect(changedDpi.artifactHash).not.toBe(first.artifactHash);
    expect(first.metadata.multimodalMaterialization).toMatchObject({
      assetCount: 1,
      contractVersion: 1,
      digest: first.artifactHash,
      sourceArtifactHash: "a".repeat(64),
    });
  });

  it("is idempotent and preserves parser lineage when no durable visual exists", () => {
    const materialized = finalizeDocumentMultimodalArtifact(artifact({ owner: "owner-a" }));

    expect(finalizeDocumentMultimodalArtifact(materialized).artifactHash).toBe(
      materialized.artifactHash,
    );
    const withoutVisual = ParseArtifactSchema.parse({
      ...artifact({ owner: "owner-a" }),
      elements: [],
    });
    expect(finalizeDocumentMultimodalArtifact(withoutVisual)).toBe(withoutVisual);
  });
});

function artifact({
  dpi = 144,
  owner,
  sha256 = "b".repeat(64),
}: {
  readonly dpi?: number;
  readonly owner: string;
  readonly sha256?: string;
}): ParseArtifact {
  return ParseArtifactSchema.parse({
    artifactHash: "a".repeat(64),
    contentType: "mixed",
    createdAt: "2026-08-18T00:00:00.000Z",
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    elements: [
      {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44:element-1",
        metadata: {
          assetRef: {
            contentType: "image/png",
            objectKey: `tenant/spaces/space/documents/asset/assets/${owner}/figure.png`,
            sha256,
            source: "pdf-raster",
            variants: {
              thumbnail: {
                contentType: "image/png",
                objectKey: `tenant/spaces/space/documents/asset/assets/${owner}/thumb.png`,
                sha256: "d".repeat(64),
              },
            },
          },
          pdfRaster: {
            boundingBox: { height: 40, width: 30, x: 10, y: 20 },
            cropKind: "figure",
            pageNumber: 1,
            renderer: { command: "/usr/bin/pdftoppm", dpi, thumbnailDpi: 48 },
          },
        },
        pageNumber: 1,
        sectionPath: [],
        type: "image",
      },
    ],
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    metadata: {},
    parser: "unstructured",
    version: 1,
  });
}
