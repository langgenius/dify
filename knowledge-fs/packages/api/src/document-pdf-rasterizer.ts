import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  type DocumentMultimodalBoundingBox,
  type ParseArtifact,
  ParseArtifactSchema,
  type ParseElement,
  type PlatformAdapter,
} from "@knowledge/core";

import { cloneJsonObject, isPlainObject } from "./json-utils";
import {
  createDocumentMultimodalAssetObjectKey,
  createDocumentMultimodalAssetVariantObjectKey,
} from "./storage-path-utils";

const execFileAsync = promisify(execFile);

export interface DocumentPdfRasterizer {
  render(input: RenderDocumentPdfPageInput): Promise<RenderedDocumentPdfImage | null>;
}

export interface RenderDocumentPdfPageInput {
  readonly boundingBox?: DocumentMultimodalBoundingBox | undefined;
  readonly boundingBoxGeometry?: DocumentPdfBoundingBoxGeometry | undefined;
  readonly documentBody: Uint8Array;
  readonly elementId: string;
  readonly pageNumber: number;
}

export type DocumentPdfBoundingBoxCoordinateSystem = "pdf-point" | "pixel" | "relative";

export interface DocumentPdfBoundingBoxGeometry {
  readonly coordinateSystem: DocumentPdfBoundingBoxCoordinateSystem;
  readonly pageHeight?: number | undefined;
  readonly pageWidth?: number | undefined;
  readonly sourceDpi?: number | undefined;
}

export type DocumentPdfRasterCropKind = "chart" | "figure" | "page" | "table";

export interface RenderedDocumentPdfImage {
  readonly body: Uint8Array;
  readonly contentType: "image/png";
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly variants?: Readonly<Record<string, RenderedDocumentPdfImageVariant>> | undefined;
}

export interface RenderedDocumentPdfImageVariant {
  readonly body: Uint8Array;
  readonly contentType: "image/png";
  readonly height?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly width?: number | undefined;
}

export interface RasterizeDocumentPdfMultimodalAssetsInput {
  readonly artifact: ParseArtifact;
  readonly documentBody: Uint8Array;
  readonly documentMimeType: string;
  readonly knowledgeSpaceId: string;
  readonly maxRasterizedAssets?: number | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly rasterizer?: DocumentPdfRasterizer | undefined;
  readonly tenantId: string;
}

export interface RasterizeDocumentPdfMultimodalAssetsResult {
  readonly artifact: ParseArtifact;
  readonly rasterizedCount: number;
}

export interface PopplerPdfRasterizerOptions {
  readonly command?: string | undefined;
  readonly dpi?: number | undefined;
  readonly thumbnailDpi?: number | undefined;
  readonly thumbnailVariantName?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

const defaultMaxRasterizedAssets = 500;
const defaultThumbnailDpi = 48;
const defaultThumbnailVariantName = "thumbnail";

export async function rasterizeDocumentPdfMultimodalAssets({
  artifact,
  documentBody,
  documentMimeType,
  knowledgeSpaceId,
  maxRasterizedAssets = defaultMaxRasterizedAssets,
  objectStorage,
  rasterizer,
  tenantId,
}: RasterizeDocumentPdfMultimodalAssetsInput): Promise<RasterizeDocumentPdfMultimodalAssetsResult> {
  if (!rasterizer || !isPdfMimeType(documentMimeType)) {
    return { artifact, rasterizedCount: 0 };
  }

  if (!Number.isSafeInteger(maxRasterizedAssets) || maxRasterizedAssets < 1) {
    throw new Error("Document PDF rasterized asset max count must be at least 1");
  }

  let rasterizedCount = 0;
  const elements = [];

  for (const element of artifact.elements) {
    const candidate = pdfRasterizationCandidate(element);

    if (!candidate) {
      elements.push(element);
      continue;
    }

    if (rasterizedCount >= maxRasterizedAssets) {
      throw new Error(
        `Document PDF rasterized asset count exceeds maxRasterizedAssets=${maxRasterizedAssets}`,
      );
    }

    const rendered = await rasterizer.render({
      ...(candidate.boundingBox ? { boundingBox: candidate.boundingBox } : {}),
      ...(candidate.boundingBoxGeometry
        ? { boundingBoxGeometry: candidate.boundingBoxGeometry }
        : {}),
      documentBody,
      elementId: element.id,
      pageNumber: candidate.pageNumber,
    });

    if (!rendered) {
      elements.push(element);
      continue;
    }

    const sha256 = sha256Hex(rendered.body);
    const objectKey = createDocumentMultimodalAssetObjectKey({
      assetId: artifact.documentAssetId,
      contentType: rendered.contentType,
      elementId: element.id,
      knowledgeSpaceId,
      sha256,
      tenantId,
    });

    await objectStorage.putObject({
      body: rendered.body,
      contentType: rendered.contentType,
      key: objectKey,
      metadata: {
        cropKind: candidate.cropKind,
        documentAssetId: artifact.documentAssetId,
        pageNumber: String(candidate.pageNumber),
        parseArtifactId: artifact.id,
        parseElementId: element.id,
        sha256,
        source: "pdf-raster",
        tenantId,
      },
    });
    const variants = await storeRenderedImageVariants({
      artifact,
      element,
      knowledgeSpaceId,
      objectStorage,
      pageNumber: candidate.pageNumber,
      rendered,
      tenantId,
    });

    rasterizedCount += 1;
    elements.push({
      ...element,
      metadata: {
        ...cloneJsonObject(element.metadata),
        assetRef: {
          contentType: rendered.contentType,
          cropKind: candidate.cropKind,
          objectKey,
          sha256,
          source: "pdf-raster",
          ...(Object.keys(variants).length > 0 ? { variants } : {}),
        },
        pdfRaster: {
          ...(candidate.boundingBox ? { boundingBox: candidate.boundingBox } : {}),
          ...(candidate.boundingBoxGeometry ? { geometry: candidate.boundingBoxGeometry } : {}),
          contentType: rendered.contentType,
          cropKind: candidate.cropKind,
          pageNumber: candidate.pageNumber,
          ...(rendered.metadata ? { renderer: cloneJsonObject(rendered.metadata) } : {}),
          sha256,
          ...(Object.keys(variants).length > 0 ? { variants } : {}),
        },
      },
    });
  }

  if (rasterizedCount === 0) {
    return { artifact, rasterizedCount };
  }

  return {
    artifact: ParseArtifactSchema.parse({
      ...artifact,
      elements,
      metadata: {
        ...artifact.metadata,
        pdfRasterAssets: {
          rasterizedCount,
          source: "pdf-raster",
        },
      },
    }),
    rasterizedCount,
  };
}

async function storeRenderedImageVariants({
  artifact,
  element,
  knowledgeSpaceId,
  objectStorage,
  pageNumber,
  rendered,
  tenantId,
}: {
  readonly artifact: ParseArtifact;
  readonly element: ParseElement;
  readonly knowledgeSpaceId: string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly pageNumber: number;
  readonly rendered: RenderedDocumentPdfImage;
  readonly tenantId: string;
}): Promise<Record<string, Record<string, unknown>>> {
  const variants: Record<string, Record<string, unknown>> = {};

  for (const [variant, image] of Object.entries(rendered.variants ?? {})) {
    const sha256 = sha256Hex(image.body);
    const objectKey = createDocumentMultimodalAssetVariantObjectKey({
      assetId: artifact.documentAssetId,
      contentType: image.contentType,
      elementId: element.id,
      knowledgeSpaceId,
      sha256,
      tenantId,
      variant,
    });

    await objectStorage.putObject({
      body: image.body,
      contentType: image.contentType,
      key: objectKey,
      metadata: {
        documentAssetId: artifact.documentAssetId,
        pageNumber: String(pageNumber),
        parseArtifactId: artifact.id,
        parseElementId: element.id,
        sha256,
        source: "pdf-raster",
        tenantId,
        variant,
      },
    });

    variants[variant] = {
      contentType: image.contentType,
      ...(image.height !== undefined ? { height: image.height } : {}),
      ...(image.width !== undefined ? { width: image.width } : {}),
      objectKey,
      sha256,
    };
  }

  return variants;
}

export function createPopplerPdfRasterizer({
  command = "pdftoppm",
  dpi = 144,
  thumbnailDpi = defaultThumbnailDpi,
  thumbnailVariantName = defaultThumbnailVariantName,
  timeoutMs = 30_000,
}: PopplerPdfRasterizerOptions = {}): DocumentPdfRasterizer {
  if (!Number.isSafeInteger(dpi) || dpi < 1) {
    throw new Error("Poppler PDF rasterizer dpi must be at least 1");
  }

  if (!Number.isSafeInteger(thumbnailDpi) || thumbnailDpi < 1) {
    throw new Error("Poppler PDF rasterizer thumbnailDpi must be at least 1");
  }

  if (!thumbnailVariantName.trim()) {
    throw new Error("Poppler PDF rasterizer thumbnailVariantName must be non-empty");
  }

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Poppler PDF rasterizer timeoutMs must be at least 1");
  }

  return {
    render: async ({ boundingBox, boundingBoxGeometry, documentBody, elementId, pageNumber }) => {
      const workDir = await mkdtemp(join(tmpdir(), "knowledge-fs-pdf-raster-"));
      const inputPath = join(workDir, "input.pdf");
      const outputPrefix = join(workDir, "page");
      const thumbnailOutputPrefix = join(workDir, "thumbnail");

      try {
        await writeFile(inputPath, documentBody);
        await renderPopplerPng({
          boundingBox,
          boundingBoxGeometry,
          command,
          dpi,
          inputPath,
          outputPrefix,
          pageNumber,
          timeoutMs,
        });
        const outputPath = await findPopplerOutputPath(workDir, "page-");

        if (!outputPath) {
          return null;
        }

        await renderPopplerPng({
          boundingBox,
          boundingBoxGeometry,
          command,
          dpi: thumbnailDpi,
          inputPath,
          outputPrefix: thumbnailOutputPrefix,
          pageNumber,
          timeoutMs,
        });
        const thumbnailOutputPath = await findPopplerOutputPath(workDir, "thumbnail-");

        return {
          body: new Uint8Array(await readFile(outputPath)),
          contentType: "image/png",
          metadata: {
            command,
            ...(boundingBox
              ? {
                  crop: {
                    boundingBox,
                    normalizedBoundingBox: normalizePdfRasterBoundingBoxForDpi({
                      boundingBox,
                      dpi,
                      geometry: boundingBoxGeometry,
                    }),
                    ...(boundingBoxGeometry ? { geometry: boundingBoxGeometry } : {}),
                  },
                }
              : {}),
            dpi,
            elementId,
            pageNumber,
            thumbnailDpi,
          },
          ...(thumbnailOutputPath
            ? {
                variants: {
                  [thumbnailVariantName]: {
                    body: new Uint8Array(await readFile(thumbnailOutputPath)),
                    contentType: "image/png",
                    metadata: {
                      command,
                      ...(boundingBox
                        ? {
                            crop: {
                              boundingBox,
                              normalizedBoundingBox: normalizePdfRasterBoundingBoxForDpi({
                                boundingBox,
                                dpi: thumbnailDpi,
                                geometry: boundingBoxGeometry,
                              }),
                              ...(boundingBoxGeometry ? { geometry: boundingBoxGeometry } : {}),
                            },
                          }
                        : {}),
                      dpi: thumbnailDpi,
                      elementId,
                      pageNumber,
                      variant: thumbnailVariantName,
                    },
                  },
                },
              }
            : {}),
        };
      } finally {
        await rm(workDir, { force: true, recursive: true });
      }
    },
  };
}

async function renderPopplerPng({
  boundingBox,
  boundingBoxGeometry,
  command,
  dpi,
  inputPath,
  outputPrefix,
  pageNumber,
  timeoutMs,
}: {
  readonly boundingBox: DocumentMultimodalBoundingBox | undefined;
  readonly boundingBoxGeometry: DocumentPdfBoundingBoxGeometry | undefined;
  readonly command: string;
  readonly dpi: number;
  readonly inputPath: string;
  readonly outputPrefix: string;
  readonly pageNumber: number;
  readonly timeoutMs: number;
}): Promise<void> {
  const args = [
    "-f",
    String(pageNumber),
    "-l",
    String(pageNumber),
    "-png",
    "-r",
    String(dpi),
    ...popplerCropArgs(
      boundingBox
        ? normalizePdfRasterBoundingBoxForDpi({
            boundingBox,
            dpi,
            geometry: boundingBoxGeometry,
          })
        : undefined,
    ),
    inputPath,
    outputPrefix,
  ];
  await execFileAsync(command, args, {
    timeout: timeoutMs,
    windowsHide: true,
  });
}

function pdfRasterizationCandidate(element: ParseElement): {
  readonly boundingBox?: DocumentMultimodalBoundingBox;
  readonly boundingBoxGeometry?: DocumentPdfBoundingBoxGeometry;
  readonly cropKind: DocumentPdfRasterCropKind;
  readonly pageNumber: number;
} | null {
  if (element.type !== "image" && element.type !== "page-break" && element.type !== "table") {
    return null;
  }

  const pageNumber = element.pageNumber;

  if (!pageNumber) {
    return null;
  }

  const existingAssetRef = isPlainObject(element.metadata.assetRef)
    ? element.metadata.assetRef
    : {};

  if (typeof existingAssetRef.objectKey === "string" || typeof existingAssetRef.uri === "string") {
    return null;
  }

  const boundingBox = parseBoundingBoxFromMetadata(element.metadata);

  if ((element.type === "image" || element.type === "table") && !boundingBox) {
    return null;
  }

  return {
    ...(boundingBox ? { boundingBox } : {}),
    ...(boundingBox ? { boundingBoxGeometry: parseBoundingBoxGeometry(element.metadata) } : {}),
    cropKind: inferPdfRasterCropKind(element),
    pageNumber,
  };
}

function inferPdfRasterCropKind(element: ParseElement): DocumentPdfRasterCropKind {
  if (element.type === "page-break") {
    return "page";
  }

  if (element.type === "table") {
    return "table";
  }

  const explicitKind = metadataStringFromKeys(
    element.metadata,
    "cropKind",
    "visualKind",
    "figureType",
    "imageType",
    "type",
    "category",
  )?.toLowerCase();

  if (explicitKind && /\b(chart|plot|graph)\b/u.test(explicitKind)) {
    return "chart";
  }

  if (explicitKind && /\b(table|grid)\b/u.test(explicitKind)) {
    return "table";
  }

  const descriptiveText = [
    metadataStringFromKeys(element.metadata, "title", "caption", "alt", "label"),
    element.text,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (
    /\b(chart|plot|graph|histogram|scatter|bar chart|line chart|pie chart)\b/u.test(descriptiveText)
  ) {
    return "chart";
  }

  return "figure";
}

export function normalizePdfRasterBoundingBoxForDpi({
  boundingBox,
  dpi,
  geometry,
}: {
  readonly boundingBox: DocumentMultimodalBoundingBox;
  readonly dpi: number;
  readonly geometry?: DocumentPdfBoundingBoxGeometry | undefined;
}): DocumentMultimodalBoundingBox {
  const coordinateSystem = geometry?.coordinateSystem ?? "pixel";

  if (coordinateSystem === "pdf-point") {
    const scale = dpi / 72;

    return scaleBoundingBox(boundingBox, scale, scale);
  }

  if (coordinateSystem === "relative" && geometry?.pageWidth && geometry.pageHeight) {
    const scale = dpi / 72;

    return {
      height: boundingBox.height * geometry.pageHeight * scale,
      width: boundingBox.width * geometry.pageWidth * scale,
      x: boundingBox.x * geometry.pageWidth * scale,
      y: boundingBox.y * geometry.pageHeight * scale,
    };
  }

  if (coordinateSystem === "pixel" && geometry?.sourceDpi && geometry.sourceDpi !== dpi) {
    const scale = dpi / geometry.sourceDpi;

    return scaleBoundingBox(boundingBox, scale, scale);
  }

  return boundingBox;
}

function scaleBoundingBox(
  boundingBox: DocumentMultimodalBoundingBox,
  scaleX: number,
  scaleY: number,
): DocumentMultimodalBoundingBox {
  return {
    height: boundingBox.height * scaleY,
    width: boundingBox.width * scaleX,
    x: boundingBox.x * scaleX,
    y: boundingBox.y * scaleY,
  };
}

function parseBoundingBoxGeometry(
  metadata: Readonly<Record<string, unknown>>,
): DocumentPdfBoundingBoxGeometry {
  const coordinates = isPlainObject(metadata.coordinates) ? metadata.coordinates : {};
  const page = firstPlainObjectFromKeys(
    metadata,
    "page",
    "pageDimensions",
    "pageSize",
    "page_size",
    "sourcePage",
  );
  const layout = firstPlainObjectFromKeys(metadata, "layout", "dimensions", "sourceDimensions");
  const pageWidth =
    metadataNumberFromKeys(
      metadata,
      "pageWidth",
      "page_width",
      "layoutWidth",
      "layout_width",
      "sourcePageWidth",
    ) ??
    metadataNumberFromKeys(page, "width", "pageWidth", "page_width", "layout_width") ??
    metadataNumberFromKeys(layout, "width", "pageWidth", "page_width", "layout_width") ??
    metadataNumberFromKeys(coordinates, "layout_width", "page_width", "width");
  const pageHeight =
    metadataNumberFromKeys(
      metadata,
      "pageHeight",
      "page_height",
      "layoutHeight",
      "layout_height",
      "sourcePageHeight",
    ) ??
    metadataNumberFromKeys(page, "height", "pageHeight", "page_height", "layout_height") ??
    metadataNumberFromKeys(layout, "height", "pageHeight", "page_height", "layout_height") ??
    metadataNumberFromKeys(coordinates, "layout_height", "page_height", "height");
  const sourceDpi =
    metadataNumberFromKeys(metadata, "sourceDpi", "source_dpi", "dpi", "imageDpi") ??
    metadataNumberFromKeys(page, "sourceDpi", "source_dpi", "dpi") ??
    metadataNumberFromKeys(layout, "sourceDpi", "source_dpi", "dpi");

  return {
    coordinateSystem: parseCoordinateSystem(metadata) ?? "pixel",
    ...(pageHeight !== undefined ? { pageHeight } : {}),
    ...(pageWidth !== undefined ? { pageWidth } : {}),
    ...(sourceDpi !== undefined ? { sourceDpi } : {}),
  };
}

function parseCoordinateSystem(
  metadata: Readonly<Record<string, unknown>>,
): DocumentPdfBoundingBoxCoordinateSystem | undefined {
  const boundingBox = isPlainObject(metadata.boundingBox) ? metadata.boundingBox : {};
  const bbox = isPlainObject(metadata.bbox) ? metadata.bbox : {};
  const box = isPlainObject(metadata.box) ? metadata.box : {};
  const coordinates = isPlainObject(metadata.coordinates) ? metadata.coordinates : {};
  const raw =
    metadataString(metadata, "boundingBoxCoordinateSystem") ??
    metadataString(metadata, "boundingBoxUnit") ??
    metadataString(metadata, "bboxUnit") ??
    metadataString(metadata, "coordinateSystem") ??
    metadataString(metadata, "coordinateUnit") ??
    metadataString(metadata, "unit") ??
    metadataString(boundingBox, "coordinateSystem") ??
    metadataString(boundingBox, "unit") ??
    metadataString(boundingBox, "units") ??
    metadataString(bbox, "coordinateSystem") ??
    metadataString(bbox, "unit") ??
    metadataString(bbox, "units") ??
    metadataString(box, "coordinateSystem") ??
    metadataString(box, "unit") ??
    metadataString(box, "units") ??
    metadataString(coordinates, "coordinate_system") ??
    metadataString(coordinates, "coordinate_unit") ??
    metadataString(coordinates, "unit") ??
    metadataString(coordinates, "system");
  const normalized = raw?.toLowerCase().replaceAll("_", "-");

  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "pdf-point" ||
    normalized === "pdf-points" ||
    normalized === "point" ||
    normalized === "points" ||
    normalized === "pt"
  ) {
    return "pdf-point";
  }

  if (
    normalized === "relative" ||
    normalized === "ratio" ||
    normalized === "fraction" ||
    normalized === "normalized" ||
    normalized === "normalized-0-1"
  ) {
    return "relative";
  }

  if (normalized === "pixel" || normalized === "pixels" || normalized === "px") {
    return "pixel";
  }

  return undefined;
}

function parseBoundingBoxFromMetadata(
  metadata: Readonly<Record<string, unknown>>,
): DocumentMultimodalBoundingBox | undefined {
  return (
    parseBoundingBox(metadata.boundingBox) ??
    parseBoundingBox(metadata.bbox) ??
    parseBoundingBox(metadata.box) ??
    parseBoundingBox(metadata.coordinates)
  );
}

function parseBoundingBox(value: unknown): DocumentMultimodalBoundingBox | undefined {
  if (Array.isArray(value)) {
    return parseBoundingBoxArray(value);
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const x = metadataNumberFromKeys(value, "x", "left", "l");
  const y = metadataNumberFromKeys(value, "y", "top", "t");
  const width = metadataNumberFromKeys(value, "width", "w");
  const height = metadataNumberFromKeys(value, "height", "h");

  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
    return { height, width, x, y };
  }

  const x1 = metadataNumberFromKeys(value, "x1", "left");
  const y1 = metadataNumberFromKeys(value, "y1", "top");
  const x2 = metadataNumberFromKeys(value, "x2", "right");
  const y2 = metadataNumberFromKeys(value, "y2", "bottom");

  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }

  const inferredWidth = x2 - x1;
  const inferredHeight = y2 - y1;

  return inferredWidth >= 0 && inferredHeight >= 0
    ? { height: inferredHeight, width: inferredWidth, x: x1, y: y1 }
    : undefined;
}

function parseBoundingBoxArray(
  value: readonly unknown[],
): DocumentMultimodalBoundingBox | undefined {
  if (value.length < 4) {
    return undefined;
  }

  const [x, y, third, fourth] = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof third !== "number" ||
    typeof fourth !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(third) ||
    !Number.isFinite(fourth) ||
    x < 0 ||
    y < 0
  ) {
    return undefined;
  }

  if (third >= x && fourth >= y) {
    return { height: fourth - y, width: third - x, x, y };
  }

  return third >= 0 && fourth >= 0 ? { height: fourth, width: third, x, y } : undefined;
}

function metadataNumber(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = metadata[key];

  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function metadataNumberFromKeys(
  metadata: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = metadataNumber(metadata, key);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function firstPlainObjectFromKeys(
  metadata: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): Readonly<Record<string, unknown>> {
  for (const key of keys) {
    const value = metadata[key];

    if (isPlainObject(value)) {
      return value;
    }
  }

  return {};
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function metadataStringFromKeys(
  metadata: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = metadataString(metadata, key);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function popplerCropArgs(boundingBox: DocumentMultimodalBoundingBox | undefined): string[] {
  if (!boundingBox) {
    return [];
  }

  return [
    "-x",
    String(Math.floor(boundingBox.x)),
    "-y",
    String(Math.floor(boundingBox.y)),
    "-W",
    String(Math.ceil(boundingBox.width)),
    "-H",
    String(Math.ceil(boundingBox.height)),
  ];
}

async function findPopplerOutputPath(workDir: string, prefix: string): Promise<string | null> {
  const files = await readdir(workDir);
  const image = files.find((file) => file.startsWith(prefix) && file.endsWith(".png"));

  return image ? join(workDir, image) : null;
}

function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().split(";")[0]?.trim() === "application/pdf";
}

function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}
