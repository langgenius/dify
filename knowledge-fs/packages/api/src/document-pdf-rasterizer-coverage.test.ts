import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ParseArtifact, ParseElement } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type DocumentPdfRasterizer,
  type RenderDocumentPdfPageInput,
  createPopplerPdfRasterizer,
  normalizePdfRasterBoundingBoxForDpi,
  rasterizeDocumentPdfMultimodalAssets,
} from "./document-pdf-rasterizer";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const documentBody = new TextEncoder().encode("%PDF-1.7\n");

function artifact(elements: readonly ParseElement[]): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "mixed",
    createdAt: "2026-06-23T00:00:00.000Z",
    documentAssetId,
    elements: [...elements],
    id: parseArtifactId,
    metadata: {},
    parser: "unstructured",
    version: 1,
  };
}

function recordingRasterizer(calls: RenderDocumentPdfPageInput[]): DocumentPdfRasterizer {
  return {
    render: async (input) => {
      calls.push(input);
      return { body: new Uint8Array([1, 2, 3]), contentType: "image/png" };
    },
  };
}

describe("document pdf rasterizer coverage", () => {
  it("rejects invalid maxRasterizedAssets values", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    await expect(
      rasterizeDocumentPdfMultimodalAssets({
        artifact: artifact([]),
        documentBody,
        documentMimeType: "application/pdf",
        knowledgeSpaceId,
        maxRasterizedAssets: 0,
        objectStorage: adapter.objectStorage,
        rasterizer: recordingRasterizer([]),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Document PDF rasterized asset max count must be at least 1");
  });

  it("keeps elements unchanged when the renderer yields no image", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const input = artifact([
      {
        id: "figure-1",
        metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
        pageNumber: 1,
        sectionPath: [],
        text: "figure",
        type: "image",
      },
    ]);

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: input,
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: { render: async () => null },
      tenantId: "tenant-1",
    });

    expect(result.rasterizedCount).toBe(0);
    expect(result.artifact).toBe(input);
    expect(result.artifact.elements[0]?.metadata).not.toHaveProperty("assetRef");
    expect(result.artifact.metadata).not.toHaveProperty("pdfRasterAssets");
  });

  it("skips elements without pages or boxes and elements that already have assets", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: RenderDocumentPdfPageInput[] = [];
    const boundingBox = { height: 10, width: 10, x: 0, y: 0 };

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact([
        { id: "no-page", metadata: { boundingBox }, sectionPath: [], type: "image" },
        { id: "no-box", metadata: {}, pageNumber: 1, sectionPath: [], type: "image" },
        {
          id: "has-object-key",
          metadata: { assetRef: { objectKey: "existing/key.png" }, boundingBox },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
        {
          id: "has-uri",
          metadata: { assetRef: { uri: "data:image/png;base64,AQID" }, boundingBox },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
        {
          id: "empty-asset-ref",
          metadata: { assetRef: { note: "not a stored asset yet" }, boundingBox },
          pageNumber: 2,
          sectionPath: [],
          type: "image",
        },
      ]),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: recordingRasterizer(calls),
      tenantId: "tenant-1",
    });

    expect(calls.map((call) => call.elementId)).toEqual(["empty-asset-ref"]);
    expect(result.rasterizedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata).not.toHaveProperty("assetRef");
    expect(result.artifact.elements[4]?.metadata.assetRef).toMatchObject({
      source: "pdf-raster",
    });
  });

  it("stores rendered variants without dimensions", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact([
        {
          id: "figure-1",
          metadata: { boundingBox: { height: 10, width: 10, x: 0, y: 0 } },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
      ]),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: {
        render: async () => ({
          body: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
          variants: { preview: { body: new Uint8Array([7, 7]), contentType: "image/png" } },
        }),
      },
      tenantId: "tenant-1",
    });

    const assetRef = result.artifact.elements[0]?.metadata.assetRef as Record<string, unknown>;
    const variants = assetRef.variants as Record<string, Record<string, unknown>>;
    expect(variants.preview).toMatchObject({ contentType: "image/png" });
    expect(variants.preview).not.toHaveProperty("height");
    expect(variants.preview).not.toHaveProperty("width");
  });

  it("validates Poppler dpi and timeout options", () => {
    expect(() => createPopplerPdfRasterizer({ dpi: 0 })).toThrow(
      "Poppler PDF rasterizer dpi must be at least 1",
    );
    expect(() => createPopplerPdfRasterizer({ timeoutMs: 0 })).toThrow(
      "Poppler PDF rasterizer timeoutMs must be at least 1",
    );
  });

  it("infers crop kinds from explicit metadata kind hints", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const boundingBox = { height: 10, width: 10, x: 0, y: 0 };

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact([
        {
          id: "chart-1",
          metadata: { boundingBox, visualKind: "Line Chart" },
          pageNumber: 1,
          sectionPath: [],
          text: "trend",
          type: "image",
        },
        {
          id: "grid-1",
          metadata: { boundingBox, category: "data grid" },
          pageNumber: 1,
          sectionPath: [],
          text: "rows",
          type: "image",
        },
        {
          id: "photo-1",
          metadata: { boundingBox, caption: "A nice photo", imageType: "photo" },
          pageNumber: 1,
          sectionPath: [],
          text: "Team offsite",
          type: "image",
        },
      ]),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: recordingRasterizer([]),
      tenantId: "tenant-1",
    });

    const cropKinds = result.artifact.elements.map(
      (element) => (element.metadata.assetRef as Record<string, unknown> | undefined)?.cropKind,
    );
    expect(cropKinds).toEqual(["chart", "table", "figure"]);
  });

  it("parses bounding boxes and units from parser-specific metadata shapes", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: RenderDocumentPdfPageInput[] = [];

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact([
        {
          id: "coords-1",
          metadata: {
            coordinates: {
              layout_height: 792,
              layout_width: 612,
              system: "points",
              x1: 10,
              x2: 110,
              y1: 20,
              y2: 220,
            },
          },
          pageNumber: 6,
          sectionPath: [],
          text: "coordinates form",
          type: "image",
        },
        {
          id: "box-1",
          metadata: { box: { h: 5, unit: "px", w: 6, x: 1, y: 2 } },
          pageNumber: 1,
          sectionPath: [],
          text: "box form",
          type: "image",
        },
        {
          id: "array-corners",
          metadata: { bbox: [10, 20, 110, 220] },
          pageNumber: 2,
          sectionPath: [],
          text: "corner array",
          type: "image",
        },
        {
          id: "array-size",
          metadata: { bbox: [50, 60, 20, 30] },
          pageNumber: 3,
          sectionPath: [],
          text: "size array",
          type: "image",
        },
        {
          id: "units-from-object",
          metadata: { bbox: [1, 2, 3, 4], boundingBox: { units: "pt" } },
          pageNumber: 4,
          sectionPath: [],
          text: "object units",
          type: "image",
        },
      ]),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: recordingRasterizer(calls),
      tenantId: "tenant-1",
    });

    expect(result.rasterizedCount).toBe(5);
    expect(calls[0]).toMatchObject({
      boundingBox: { height: 200, width: 100, x: 10, y: 20 },
      boundingBoxGeometry: { coordinateSystem: "pdf-point", pageHeight: 792, pageWidth: 612 },
    });
    expect(calls[1]).toMatchObject({
      boundingBox: { height: 5, width: 6, x: 1, y: 2 },
      boundingBoxGeometry: { coordinateSystem: "pixel" },
    });
    expect(calls[2]).toMatchObject({
      boundingBox: { height: 200, width: 100, x: 10, y: 20 },
    });
    expect(calls[3]).toMatchObject({
      boundingBox: { height: 30, width: 20, x: 50, y: 60 },
    });
    expect(calls[4]).toMatchObject({
      boundingBox: { height: 2, width: 2, x: 1, y: 2 },
      boundingBoxGeometry: { coordinateSystem: "pdf-point" },
    });
  });

  it("rejects malformed bounding boxes so their elements are skipped", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const calls: RenderDocumentPdfPageInput[] = [];

    const result = await rasterizeDocumentPdfMultimodalAssets({
      artifact: artifact([
        {
          id: "short-array",
          metadata: { bbox: [1, 2] },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
        {
          id: "negative-origin",
          metadata: { bbox: [-1, 2, 3, 4] },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
        {
          id: "negative-size",
          metadata: { bbox: [5, 6, -1, -2] },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
        {
          id: "negative-width-corners",
          metadata: { box: { x1: 100, x2: 10, y1: 0, y2: 5 } },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
        {
          id: "negative-height-corners",
          metadata: { box: { x1: 0, x2: 5, y1: 100, y2: 10 } },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
        {
          id: "missing-corners",
          metadata: { box: { left: 5, top: 6 } },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
        {
          id: "unknown-unit",
          metadata: { boundingBox: { height: 4, width: 3, x: 1, y: 2 }, unit: "weird-unit" },
          pageNumber: 1,
          sectionPath: [],
          type: "image",
        },
      ]),
      documentBody,
      documentMimeType: "application/pdf",
      knowledgeSpaceId,
      objectStorage: adapter.objectStorage,
      rasterizer: recordingRasterizer(calls),
      tenantId: "tenant-1",
    });

    // Only the element with a valid box (unknown units default to pixel) rasterizes.
    expect(calls.map((call) => call.elementId)).toEqual(["unknown-unit"]);
    expect(calls[0]).toMatchObject({
      boundingBox: { height: 4, width: 3, x: 1, y: 2 },
      boundingBoxGeometry: { coordinateSystem: "pixel" },
    });
    expect(result.rasterizedCount).toBe(1);
  });

  it("leaves bounding boxes unchanged for identity geometries", () => {
    const boundingBox = { height: 10, width: 20, x: 1, y: 2 };

    // No geometry: coordinate system defaults to pixel with no source dpi.
    expect(normalizePdfRasterBoundingBoxForDpi({ boundingBox, dpi: 144 })).toEqual(boundingBox);
    // Relative geometry without page dimensions cannot scale.
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox,
        dpi: 144,
        geometry: { coordinateSystem: "relative" },
      }),
    ).toEqual(boundingBox);
    // Pixel geometry that already matches the target dpi is a no-op.
    expect(
      normalizePdfRasterBoundingBoxForDpi({
        boundingBox,
        dpi: 144,
        geometry: { coordinateSystem: "pixel", sourceDpi: 144 },
      }),
    ).toEqual(boundingBox);
  });
});
