import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ParseArtifact } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type DocumentPdfRasterizer,
  createPopplerPdfRasterizer,
  normalizePdfRasterBoundingBoxForDpi,
  rasterizeDocumentPdfMultimodalAssets,
} from "./document-pdf-rasterizer";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const documentBody = new TextEncoder().encode("%PDF-1.7\n");

describe("rasterizeDocumentPdfMultimodalAssets", () => {
  it("stores rasterized PDF image crops and rewrites asset refs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: unknown[] = [];
    const rasterizer: DocumentPdfRasterizer = {
      render: async (input) => {
        calls.push(input);

        return {
          body: new Uint8Array([1, 2, 3, 4]),
          contentType: "image/png",
          metadata: { renderer: "test" },
          variants: {
            thumbnail: {
              body: new Uint8Array([9, 9, 9]),
              contentType: "image/png",
              height: 90,
              width: 120,
            },
          },
        };
      },
    };

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: {
              boundingBox: { height: 40, width: 30, x: 10, y: 20 },
              boundingBoxCoordinateSystem: "pdf-point",
              caption: "PDF diagram",
            },
            pageNumber: 2,
            sectionPath: ["Architecture"],
            text: "PDF diagram",
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer,
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        boundingBox: { height: 40, width: 30, x: 10, y: 20 },
        boundingBoxGeometry: { coordinateSystem: "pdf-point" },
        documentBody,
        elementId: "figure-1",
        pageNumber: 2,
      }),
    ]);
    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.metadata).toMatchObject({
      pdfRasterAssets: {
        rasterizedCount: 1,
        source: "pdf-raster",
      },
    });
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: expect.stringMatching(
          /^tenant-1\/spaces\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42\/documents\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43\/assets\/figure-1-[a-f0-9]{12}\.png$/u,
        ),
        sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
        source: "pdf-raster",
        variants: {
          thumbnail: {
            contentType: "image/png",
            height: 90,
            objectKey: expect.stringMatching(/figure-1-thumbnail-[a-f0-9]{12}\.png$/u),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            width: 120,
          },
        },
      },
      pdfRaster: {
        boundingBox: { height: 40, width: 30, x: 10, y: 20 },
        contentType: "image/png",
        geometry: { coordinateSystem: "pdf-point" },
        pageNumber: 2,
        renderer: { renderer: "test" },
        variants: {
          thumbnail: {
            objectKey: expect.stringMatching(/figure-1-thumbnail-[a-f0-9]{12}\.png$/u),
          },
        },
      },
    });
    const variants = (
      result.artifact.elements[0]?.metadata.assetRef as Readonly<Record<string, unknown>>
    ).variants as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    await expect(
      adapter.objectStorage.getObject(
        String(
          (
            result.artifact.elements[0]?.metadata.assetRef as
              | Readonly<Record<string, unknown>>
              | undefined
          )?.objectKey,
        ),
      ),
    ).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    await expect(
      adapter.objectStorage.getObject(String(variants.thumbnail?.objectKey)),
    ).resolves.toEqual(new Uint8Array([9, 9, 9]));
  });

  it("can rasterize page-break elements as full-page previews", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "page-3",
            metadata: {},
            pageNumber: 3,
            sectionPath: [],
            type: "page-break",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async (input) => ({
          body: new Uint8Array([5, 6, 7, input.pageNumber]),
          contentType: "image/png",
        }),
      },
      tenantId: "tenant-1",
    });

    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: expect.stringMatching(/page-3-[a-f0-9]{12}\.png$/u),
        source: "pdf-raster",
      },
      pdfRaster: {
        pageNumber: 3,
      },
    });
  });

  it("infers parser-specific bbox aliases and page geometry", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: unknown[] = [];
    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "chart-1",
            metadata: {
              bbox: { h: 0.25, left: 0.1, top: 0.2, unit: "normalized", w: 0.5 },
              caption: "Quarterly revenue chart",
              page: { height: 792, width: 612 },
              sourceDpi: 72,
            },
            pageNumber: 4,
            sectionPath: ["Financials"],
            text: "Revenue chart",
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async (input) => {
          calls.push(input);

          return {
            body: new Uint8Array([4, 3, 2, 1]),
            contentType: "image/png",
          };
        },
      },
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        boundingBox: { height: 0.25, width: 0.5, x: 0.1, y: 0.2 },
        boundingBoxGeometry: {
          coordinateSystem: "relative",
          pageHeight: 792,
          pageWidth: 612,
          sourceDpi: 72,
        },
        elementId: "chart-1",
        pageNumber: 4,
      }),
    ]);
    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        cropKind: "chart",
      },
      pdfRaster: {
        boundingBox: { height: 0.25, width: 0.5, x: 0.1, y: 0.2 },
        cropKind: "chart",
        geometry: {
          coordinateSystem: "relative",
          pageHeight: 792,
          pageWidth: 612,
          sourceDpi: 72,
        },
        pageNumber: 4,
      },
    });
  });

  it("rasterizes table elements as table-specific visual crops", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: unknown[] = [];
    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "table-1",
            metadata: {
              boundingBox: { height: 120, width: 320, x: 24, y: 48 },
              title: "Renewal amounts",
            },
            pageNumber: 5,
            sectionPath: ["Financials"],
            text: "Vendor | Amount",
            type: "table",
          },
        ],
      }),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async (input) => {
          calls.push(input);

          return {
            body: new Uint8Array([8, 8, 8]),
            contentType: "image/png",
          };
        },
      },
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        boundingBox: { height: 120, width: 320, x: 24, y: 48 },
        elementId: "table-1",
        pageNumber: 5,
      }),
    ]);
    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).toMatchObject({
      assetRef: {
        cropKind: "table",
        objectKey: expect.stringMatching(/table-1-[a-f0-9]{12}\.png$/u),
        source: "pdf-raster",
      },
      pdfRaster: {
        cropKind: "table",
        pageNumber: 5,
      },
    });
  });

  it("skips non-PDF documents, missing PDF candidates, and existing asset refs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    let calls = 0;

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact({
        elements: [
          {
            id: "figure-1",
            metadata: { boundingBox: { height: 1, width: 1, x: 0, y: 0 } },
            sectionPath: [],
            type: "image",
          },
          {
            id: "figure-2",
            metadata: {
              assetRef: { uri: "data:image/png;base64,AQID" },
              boundingBox: { height: 1, width: 1, x: 0, y: 0 },
            },
            pageNumber: 1,
            sectionPath: [],
            type: "image",
          },
        ],
      }),
      documentBody,
      documentMimeType: "text/markdown",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async () => {
          calls += 1;

          return null;
        },
      },
      tenantId: "tenant-1",
    });

    expect(result.rasterizedCount).toBe(0);
    expect(result.artifact.elements[1]?.metadata).toMatchObject({
      assetRef: { uri: "data:image/png;base64,AQID" },
    });
    expect(calls).toBe(0);
  });

  it("rejects documents that exceed the rasterized asset count limit", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    await expect(
      rasterizeDocumentPdfMultimodalAssets({
        artifact: artifact({
          elements: [
            {
              id: "figure-1",
              metadata: { boundingBox: { height: 1, width: 1, x: 0, y: 0 } },
              pageNumber: 1,
              sectionPath: [],
              type: "image",
            },
            {
              id: "figure-2",
              metadata: { boundingBox: { height: 1, width: 1, x: 0, y: 0 } },
              pageNumber: 1,
              sectionPath: [],
              type: "image",
            },
          ],
        }),
        documentBody,
        documentMimeType: "application/pdf",
        knowledgeSpaceId,
        maxRasterizedAssets: 1,
        objectStorage: adapter.objectStorage,
        rasterizer: {
          render: async () => ({
            body: new Uint8Array([1]),
            contentType: "image/png",
          }),
        },
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document PDF rasterized asset count exceeds maxRasterizedAssets=1");
  });

  it("validates Poppler thumbnail rasterizer options", () => {
    expect(() => createPopplerPdfRasterizer({ thumbnailDpi: 0 })).toThrow(
      "Poppler PDF rasterizer thumbnailDpi must be at least 1",
    );
    expect(() => createPopplerPdfRasterizer({ thumbnailVariantName: "" })).toThrow(
      "Poppler PDF rasterizer thumbnailVariantName must be non-empty",
    );
    expect(createPopplerPdfRasterizer({ thumbnailDpi: 32 })).toBeDefined();
  });

  it("normalizes PDF raster bounding boxes across coordinate systems", () => {
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox: { height: 72, width: 144, x: 36, y: 18 },
        dpi: 144,
        geometry: { coordinateSystem: "pdf-point" },
      }),
    ).toEqual({ height: 144, width: 288, x: 72, y: 36 });
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox: { height: 0.25, width: 0.5, x: 0.1, y: 0.2 },
        dpi: 144,
        geometry: { coordinateSystem: "relative", pageHeight: 792, pageWidth: 612 },
      }),
    ).toEqual({ height: 396, width: 612, x: 122.4, y: 316.8 });
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox: { height: 20, width: 40, x: 10, y: 5 },
        dpi: 72,
        geometry: { coordinateSystem: "pixel", sourceDpi: 144 },
      }),
    ).toEqual({ height: 10, width: 20, x: 5, y: 2.5 });
  });
});

function artifact(input: Pick<ParseArtifact, "elements">): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "mixed",
    createdAt: "2026-06-23T00:00:00.000Z",
    documentAssetId,
    elements: input.elements,
    id: parseArtifactId,
    metadata: {},
    parser: "unstructured",
    version: 1,
  };
}
