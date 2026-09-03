import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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

import { createConcurrencyGate } from "./bounded-concurrency";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import {
  createDocumentMultimodalAssetObjectKey,
  createDocumentMultimodalAssetVariantObjectKey,
} from "./storage-path-utils";

const execFileAsync = promisify(execFile);

export interface DocumentPdfRasterizer {
  render(input: RenderDocumentPdfPageInput): Promise<RenderedDocumentPdfImage | null>;
  renderBatch?(
    input: RenderDocumentPdfBatchInput,
  ): Promise<readonly (RenderedDocumentPdfImage | null)[]>;
  /** Reuses one materialized source document while the caller renders and persists bounded pages. */
  withDocumentSession?<T>(
    input: DocumentPdfRasterSessionInput,
    operation: (session: DocumentPdfRasterSession) => Promise<T>,
  ): Promise<T>;
  /** Holds a bounded slot across source loading, rendering, and object persistence. */
  withMaterializationSlot?<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export interface DocumentPdfRasterSession {
  renderBatch(input: {
    readonly requests: readonly RenderDocumentPdfPageRequest[];
  }): Promise<readonly (RenderedDocumentPdfImage | null)[]>;
}

export interface DocumentPdfRasterSessionInput {
  readonly documentBody: Uint8Array;
  readonly signal?: AbortSignal | undefined;
}

export interface RenderDocumentPdfPageRequest {
  readonly boundingBox?: DocumentMultimodalBoundingBox | undefined;
  readonly boundingBoxGeometry?: DocumentPdfBoundingBoxGeometry | undefined;
  readonly elementId: string;
  readonly pageNumber: number;
}

export interface RenderDocumentPdfPageInput extends RenderDocumentPdfPageRequest {
  readonly documentBody: Uint8Array;
  readonly signal?: AbortSignal | undefined;
}

export interface RenderDocumentPdfBatchInput {
  readonly documentBody: Uint8Array;
  readonly requests: readonly RenderDocumentPdfPageRequest[];
  readonly signal?: AbortSignal | undefined;
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
  readonly maxDurationMs?: number | undefined;
  readonly maxRasterizedAssets?: number | undefined;
  readonly maxRasterizedBytes?: number | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly rasterizer?: DocumentPdfRasterizer | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
  readonly writeOwnerId?: string | undefined;
}

export interface RasterizeDocumentPdfMultimodalAssetsResult {
  readonly artifact: ParseArtifact;
  readonly candidateCount: number;
  readonly rasterizedCount: number;
  readonly unresolvedCount: number;
}

export class DocumentPdfRenderError extends Error {
  readonly code = "DOCUMENT_PDF_RENDER_FAILED";
  readonly retryable = false;

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "DocumentPdfRenderError";
  }
}

class DocumentPdfObjectCleanupError extends AggregateError {
  readonly retryable: boolean;

  constructor(errors: readonly unknown[], message: string, options?: { readonly cause?: unknown }) {
    super(errors, message, { cause: options?.cause });
    this.name = "DocumentPdfObjectCleanupError";
    this.retryable = errors.some(isRetryableError);
  }
}

function isRetryableError(error: unknown): boolean {
  if (
    error instanceof Error &&
    "retryable" in error &&
    (error as { readonly retryable?: unknown }).retryable === true
  ) {
    return true;
  }
  if (error instanceof AggregateError) {
    return error.errors.some(isRetryableError);
  }
  return false;
}

function createPdfRasterizationAbortScope({
  maxDurationMs,
  parentSignal,
}: {
  readonly maxDurationMs: number;
  readonly parentSignal?: AbortSignal | undefined;
}): { readonly dispose: () => void; readonly signal: AbortSignal } {
  const controller = new AbortController();
  const abortFromParent = () => {
    if (parentSignal && !controller.signal.aborted) {
      controller.abort(callerPdfRasterAbortReason(parentSignal));
    }
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(
        new DocumentPdfRenderError(
          `Document PDF rasterization exceeded maxDurationMs=${maxDurationMs}`,
        ),
      );
    }
  }, maxDurationMs);
  timeout.unref();

  return {
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal,
  };
}

async function raceWithPdfRasterAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return operation;
  }

  if (signal.aborted) {
    void operation.catch(() => undefined);
    throw pdfRasterAbortReason(signal);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(pdfRasterAbortReason(signal));
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });

    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );

    if (signal.aborted) {
      cleanup();
      reject(pdfRasterAbortReason(signal));
    }
  });
}

function throwIfCallerAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw callerPdfRasterAbortReason(signal);
  }
}

function throwIfPdfRasterAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw pdfRasterAbortReason(signal);
  }
}

function callerPdfRasterAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error && !(signal.reason instanceof DocumentPdfRenderError)) {
    return signal.reason;
  }

  const error = new Error("Document PDF rasterization was aborted by the caller", {
    cause: signal.reason,
  });
  error.name = "AbortError";
  return error;
}

function pdfRasterAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Document PDF rasterization was aborted");
}

export interface PopplerPdfRasterizerOptions {
  readonly command?: string | undefined;
  readonly dpi?: number | undefined;
  readonly pdfInfoCommand?: string | undefined;
  readonly maxEncodedCropBytes?: number | undefined;
  readonly maxEncodedImageBytes?: number | undefined;
  readonly maxEncodedPageBytes?: number | undefined;
  readonly maxConcurrency?: number | undefined;
  readonly maxPageDimension?: number | undefined;
  readonly maxPagePixels?: number | undefined;
  readonly thumbnailDpi?: number | undefined;
  readonly thumbnailVariantName?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

const defaultMaxRasterizedAssets = 500;
const defaultMaxRasterizedBytes = 128 * 1024 * 1024;
const defaultMaxRasterizationDurationMs = 10 * 60 * 1_000;
const defaultMaxEncodedCropBytes = 64 * 1024 * 1024;
const defaultMaxEncodedImageBytes = 32 * 1024 * 1024;
const defaultMaxEncodedPageBytes = 32 * 1024 * 1024;
const defaultMaxPageDimension = 4_096;
const defaultMaxPagePixels = 20_000_000;
const defaultThumbnailDpi = 48;
const defaultThumbnailVariantName = "thumbnail";

export async function rasterizeDocumentPdfMultimodalAssets({
  artifact,
  documentBody,
  documentMimeType,
  knowledgeSpaceId,
  maxDurationMs = defaultMaxRasterizationDurationMs,
  maxRasterizedAssets = defaultMaxRasterizedAssets,
  maxRasterizedBytes = defaultMaxRasterizedBytes,
  objectStorage,
  rasterizer,
  signal,
  tenantId,
  writeOwnerId,
}: RasterizeDocumentPdfMultimodalAssetsInput): Promise<RasterizeDocumentPdfMultimodalAssetsResult> {
  throwIfCallerAborted(signal);

  if (!isPdfMimeType(documentMimeType)) {
    return { artifact, candidateCount: 0, rasterizedCount: 0, unresolvedCount: 0 };
  }

  if (rasterizer && (!Number.isSafeInteger(maxRasterizedAssets) || maxRasterizedAssets < 1)) {
    throw new Error("Document PDF rasterized asset max count must be at least 1");
  }

  if (rasterizer && (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1)) {
    throw new Error("Document PDF rasterization maxDurationMs must be at least 1");
  }

  if (rasterizer && (!Number.isSafeInteger(maxRasterizedBytes) || maxRasterizedBytes < 1)) {
    throw new Error("Document PDF rasterized byte max must be at least 1");
  }

  const candidates = artifact.elements.flatMap((element, elementIndex) => {
    const candidate = pdfRasterizationCandidate(element);

    if (!candidate) {
      return [];
    }

    return [
      {
        candidate,
        element,
        elementIndex,
        request: {
          ...(candidate.boundingBox ? { boundingBox: candidate.boundingBox } : {}),
          ...(candidate.boundingBoxGeometry
            ? { boundingBoxGeometry: candidate.boundingBoxGeometry }
            : {}),
          elementId: element.id,
          pageNumber: candidate.pageNumber,
        } satisfies RenderDocumentPdfPageRequest,
      },
    ];
  });
  const candidateCount = candidates.length;
  const candidateElementIndexes = new Set(candidates.map(({ elementIndex }) => elementIndex));
  const pendingVisualElementIndexes = new Set(
    artifact.elements.flatMap((element, elementIndex) =>
      isPendingPdfVisual(element) ? [elementIndex] : [],
    ),
  );
  const fallbackUnresolvedCount = new Set([
    ...candidateElementIndexes,
    ...pendingVisualElementIndexes,
  ]).size;
  const hasUnrenderablePendingVisual = [...pendingVisualElementIndexes].some(
    (elementIndex) => !candidateElementIndexes.has(elementIndex),
  );

  if (!rasterizer || candidateCount === 0 || hasUnrenderablePendingVisual) {
    return {
      artifact,
      candidateCount,
      rasterizedCount: 0,
      unresolvedCount: fallbackUnresolvedCount,
    };
  }

  if (candidateCount > maxRasterizedAssets) {
    throw new DocumentPdfRenderError(
      `Document PDF rasterized asset count exceeds maxRasterizedAssets=${maxRasterizedAssets}`,
    );
  }

  const abortScope = createPdfRasterizationAbortScope({ maxDurationMs, parentSignal: signal });

  const elements = [...artifact.elements];
  const candidatesByPage = new Map<number, typeof candidates>();

  for (const entry of candidates) {
    const pageCandidates = candidatesByPage.get(entry.candidate.pageNumber) ?? [];
    pageCandidates.push(entry);
    candidatesByPage.set(entry.candidate.pageNumber, pageCandidates);
  }

  const createdObjectKeys = new Set<string>();
  let rasterizedBytes = 0;
  let rasterizedCount = 0;

  const materializePages = async (session?: DocumentPdfRasterSession): Promise<boolean> => {
    // A page is the bounded unit of work: render all of its candidates while the shared page bitmap
    // is resident, then persist those results before moving on.
    for (const pageCandidates of candidatesByPage.values()) {
      const requests = pageCandidates.map(({ request }) => request);
      const renderedImages = session
        ? await renderDocumentPdfSessionRequests({
            requests,
            session,
            signal: abortScope.signal,
          })
        : await renderDocumentPdfRequests({
            documentBody,
            rasterizer,
            requests,
            signal: abortScope.signal,
          });
      rasterizedBytes += renderedImages.reduce(
        (total, image) =>
          total +
          (image?.body.byteLength ?? 0) +
          Object.values(image?.variants ?? {}).reduce(
            (variantTotal, variant) => variantTotal + variant.body.byteLength,
            0,
          ),
        0,
      );

      if (rasterizedBytes > maxRasterizedBytes) {
        throw new DocumentPdfRenderError(
          `Document PDF rasterizer output exceeds maxRasterizedBytes=${maxRasterizedBytes}`,
        );
      }
      const hasUnresolvedVisual = pageCandidates.some(
        ({ element }, index) =>
          (element.type === "image" || element.type === "table") && renderedImages[index] === null,
      );

      if (hasUnresolvedVisual) {
        const cleanupFailures = await deleteCreatedPdfRasterObjects({
          createdObjectKeys,
          objectStorage,
        });

        if (cleanupFailures.length > 0) {
          throw new DocumentPdfObjectCleanupError(
            cleanupFailures,
            `Document PDF rasterizer could not compensate ${cleanupFailures.length} object(s) before provider fallback`,
          );
        }

        return false;
      }

      for (const [
        candidateIndex,
        { candidate, element, elementIndex },
      ] of pageCandidates.entries()) {
        const rendered = renderedImages[candidateIndex];

        if (!rendered) {
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
          ...(writeOwnerId ? { writeOwnerId } : {}),
        });

        await putTrackedPdfRasterObject({
          createdObjectKeys,
          input: {
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
          },
          objectStorage,
          signal: abortScope.signal,
        });
        const variants = await storeRenderedImageVariants({
          artifact,
          createdObjectKeys,
          element,
          knowledgeSpaceId,
          objectStorage,
          pageNumber: candidate.pageNumber,
          rendered,
          signal: abortScope.signal,
          tenantId,
          writeOwnerId,
        });

        rasterizedCount += 1;
        elements[elementIndex] = {
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
        };
      }
    }

    return true;
  };

  try {
    const materialized = rasterizer.withDocumentSession
      ? await rasterizer.withDocumentSession(
          { documentBody, signal: abortScope.signal },
          materializePages,
        )
      : await materializePages();

    if (!materialized) {
      return {
        artifact,
        candidateCount,
        rasterizedCount: 0,
        unresolvedCount: fallbackUnresolvedCount,
      };
    }
  } catch (error) {
    if (error instanceof DocumentPdfObjectCleanupError) {
      throw error;
    }

    const cleanupFailures = await deleteCreatedPdfRasterObjects({
      createdObjectKeys,
      objectStorage,
    });

    if (cleanupFailures.length > 0) {
      throw new DocumentPdfObjectCleanupError(
        [error, ...cleanupFailures],
        `Document PDF raster asset processing failed and could not compensate ${cleanupFailures.length} object(s)`,
        { cause: error },
      );
    }

    throw error;
  } finally {
    abortScope.dispose();
  }

  const unresolvedCount = candidateCount - rasterizedCount;

  if (rasterizedCount === 0) {
    return { artifact, candidateCount, rasterizedCount, unresolvedCount };
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
    candidateCount,
    rasterizedCount,
    unresolvedCount,
  };
}

async function renderDocumentPdfRequests({
  documentBody,
  rasterizer,
  requests,
  signal,
}: {
  readonly documentBody: Uint8Array;
  readonly rasterizer: DocumentPdfRasterizer;
  readonly requests: readonly RenderDocumentPdfPageRequest[];
  readonly signal?: AbortSignal | undefined;
}): Promise<readonly (RenderedDocumentPdfImage | null)[]> {
  try {
    throwIfPdfRasterAborted(signal);

    if (rasterizer.renderBatch) {
      const rendered = await raceWithPdfRasterAbort(
        rasterizer.renderBatch({ documentBody, requests, signal }),
        signal,
      );

      if (!Array.isArray(rendered) || rendered.length !== requests.length) {
        throw new DocumentPdfRenderError(
          `Document PDF rasterizer returned ${Array.isArray(rendered) ? rendered.length : "an invalid"} batch results for ${requests.length} requests`,
        );
      }

      return rendered;
    }

    const rendered: (RenderedDocumentPdfImage | null)[] = [];

    for (const request of requests) {
      rendered.push(
        await raceWithPdfRasterAbort(
          rasterizer.render({ ...request, documentBody, signal }),
          signal,
        ),
      );
    }

    return rendered;
  } catch (error) {
    if (signal?.aborted) {
      throw pdfRasterAbortReason(signal);
    }

    if (error instanceof DocumentPdfRenderError) {
      throw error;
    }

    throw new DocumentPdfRenderError("Document PDF rasterizer failed to render candidates", {
      cause: error,
    });
  }
}

async function renderDocumentPdfSessionRequests({
  requests,
  session,
  signal,
}: {
  readonly requests: readonly RenderDocumentPdfPageRequest[];
  readonly session: DocumentPdfRasterSession;
  readonly signal?: AbortSignal | undefined;
}): Promise<readonly (RenderedDocumentPdfImage | null)[]> {
  try {
    throwIfPdfRasterAborted(signal);
    const rendered = await session.renderBatch({ requests });
    throwIfPdfRasterAborted(signal);

    if (!Array.isArray(rendered) || rendered.length !== requests.length) {
      throw new DocumentPdfRenderError(
        `Document PDF rasterizer returned ${Array.isArray(rendered) ? rendered.length : "an invalid"} batch results for ${requests.length} requests`,
      );
    }

    return rendered;
  } catch (error) {
    if (signal?.aborted) {
      throw pdfRasterAbortReason(signal);
    }

    if (error instanceof DocumentPdfRenderError) {
      throw error;
    }

    throw new DocumentPdfRenderError("Document PDF rasterizer failed to render candidates", {
      cause: error,
    });
  }
}

async function putTrackedPdfRasterObject({
  createdObjectKeys,
  input,
  objectStorage,
  signal,
}: {
  readonly createdObjectKeys: Set<string>;
  readonly input: Parameters<PlatformAdapter["objectStorage"]["putObject"]>[0];
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly signal?: AbortSignal | undefined;
}): Promise<void> {
  throwIfPdfRasterAborted(signal);
  const existedBefore = (await objectStorage.headObject(input.key)) !== null;
  throwIfPdfRasterAborted(signal);
  await objectStorage.putObject(input);

  if (!existedBefore) {
    createdObjectKeys.add(input.key);
  }

  throwIfPdfRasterAborted(signal);
}

async function deleteCreatedPdfRasterObjects({
  createdObjectKeys,
  objectStorage,
}: {
  readonly createdObjectKeys: Set<string>;
  readonly objectStorage: PlatformAdapter["objectStorage"];
}): Promise<readonly unknown[]> {
  const failures: unknown[] = [];

  for (const key of [...createdObjectKeys].reverse()) {
    try {
      await objectStorage.deleteObject(key);
      createdObjectKeys.delete(key);
    } catch (error) {
      failures.push(
        new AggregateError([error], `Failed to compensate PDF raster object key=${key}`),
      );
      // The worker-level execution owner keeps the complete receipt and performs the bounded retry.
      break;
    }
  }

  return failures;
}

async function storeRenderedImageVariants({
  artifact,
  createdObjectKeys,
  element,
  knowledgeSpaceId,
  objectStorage,
  pageNumber,
  rendered,
  signal,
  tenantId,
  writeOwnerId,
}: {
  readonly artifact: ParseArtifact;
  readonly createdObjectKeys: Set<string>;
  readonly element: ParseElement;
  readonly knowledgeSpaceId: string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly pageNumber: number;
  readonly rendered: RenderedDocumentPdfImage;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
  readonly writeOwnerId?: string | undefined;
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
      ...(writeOwnerId ? { writeOwnerId } : {}),
    });

    await putTrackedPdfRasterObject({
      createdObjectKeys,
      input: {
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
      },
      objectStorage,
      signal,
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
  maxEncodedCropBytes = defaultMaxEncodedCropBytes,
  maxEncodedImageBytes = defaultMaxEncodedImageBytes,
  maxEncodedPageBytes = defaultMaxEncodedPageBytes,
  maxConcurrency = 2,
  maxPageDimension = defaultMaxPageDimension,
  maxPagePixels = defaultMaxPagePixels,
  pdfInfoCommand = "pdfinfo",
  thumbnailDpi = defaultThumbnailDpi,
  thumbnailVariantName = defaultThumbnailVariantName,
  timeoutMs = 30_000,
}: PopplerPdfRasterizerOptions = {}): DocumentPdfRasterizer {
  if (!Number.isSafeInteger(dpi) || dpi < 1) {
    throw new Error("Poppler PDF rasterizer dpi must be at least 1");
  }

  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error("Poppler PDF rasterizer maxConcurrency must be at least 1");
  }

  if (!Number.isSafeInteger(maxPageDimension) || maxPageDimension < 1) {
    throw new Error("Poppler PDF rasterizer maxPageDimension must be at least 1");
  }

  if (!Number.isSafeInteger(maxPagePixels) || maxPagePixels < 1) {
    throw new Error("Poppler PDF rasterizer maxPagePixels must be at least 1");
  }

  if (!Number.isSafeInteger(maxEncodedPageBytes) || maxEncodedPageBytes < 1) {
    throw new Error("Poppler PDF rasterizer maxEncodedPageBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxEncodedImageBytes) || maxEncodedImageBytes < 1) {
    throw new Error("Poppler PDF rasterizer maxEncodedImageBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxEncodedCropBytes) || maxEncodedCropBytes < 1) {
    throw new Error("Poppler PDF rasterizer maxEncodedCropBytes must be at least 1");
  }

  if (!pdfInfoCommand.trim()) {
    throw new Error("Poppler PDF rasterizer pdfInfoCommand must be non-empty");
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

  const documentSessionGate = createConcurrencyGate(maxConcurrency);
  const materializationGate = createConcurrencyGate(maxConcurrency);
  const renderGate = createConcurrencyGate(maxConcurrency);
  const renderBatch = async ({
    documentBody,
    requests,
    signal,
  }: RenderDocumentPdfBatchInput): Promise<readonly (RenderedDocumentPdfImage | null)[]> => {
    const operation = renderGate.run(
      () =>
        runPopplerPdfRenderOperation({
          operation: () =>
            renderPopplerPdfBatch({
              command,
              documentBody,
              dpi,
              maxEncodedCropBytes,
              maxEncodedImageBytes,
              maxEncodedPageBytes,
              maxPageDimension,
              maxPagePixels,
              pdfInfoCommand,
              requests,
              signal,
              thumbnailDpi,
              thumbnailVariantName,
              timeoutMs,
            }),
          signal,
        }),
      signal ? { signal } : undefined,
    );

    return raceWithPdfRasterAbort(operation, signal);
  };

  return {
    render: async ({ documentBody, signal, ...request }) => {
      const rendered = await renderBatch({ documentBody, requests: [request], signal });

      return rendered[0] ?? null;
    },
    renderBatch,
    withDocumentSession: async <T>(
      { documentBody, signal }: DocumentPdfRasterSessionInput,
      operation: (session: DocumentPdfRasterSession) => Promise<T>,
    ) => {
      throwIfPdfRasterAborted(signal);
      const pending = documentSessionGate.run(
        async () => {
          throwIfPdfRasterAborted(signal);
          const document = await runPopplerPdfRenderOperation({
            operation: () => materializePopplerPdfDocument({ documentBody, signal }),
            signal,
          });
          const sessionRenderGate = createConcurrencyGate(1);
          const activeRenders = new Set<Promise<readonly (RenderedDocumentPdfImage | null)[]>>();
          let sessionOpen = true;
          let operationFailed = false;
          let operationFailure: unknown;
          let result!: T;

          try {
            result = await operation({
              renderBatch: ({ requests }) => {
                if (!sessionOpen) {
                  return Promise.reject(
                    new DocumentPdfRenderError("Poppler PDF rasterizer document session is closed"),
                  );
                }

                const render = sessionRenderGate.run(
                  () =>
                    renderGate.run(
                      () =>
                        runPopplerPdfRenderOperation({
                          operation: () =>
                            renderMaterializedPopplerPdfBatch({
                              command,
                              document,
                              dpi,
                              maxEncodedCropBytes,
                              maxEncodedImageBytes,
                              maxEncodedPageBytes,
                              maxPageDimension,
                              maxPagePixels,
                              pdfInfoCommand,
                              requests,
                              signal,
                              thumbnailDpi,
                              thumbnailVariantName,
                              timeoutMs,
                            }),
                          signal,
                        }),
                      signal ? { signal } : undefined,
                    ),
                  signal ? { signal } : undefined,
                );
                activeRenders.add(render);
                void render.then(
                  () => activeRenders.delete(render),
                  () => activeRenders.delete(render),
                );
                return render;
              },
            });
          } catch (error) {
            operationFailed = true;
            operationFailure = error;
          }

          sessionOpen = false;
          await Promise.allSettled([...activeRenders]);
          let cleanupFailed = false;
          let cleanupFailure: unknown;
          try {
            await removePopplerPdfDocument(document);
          } catch (error) {
            cleanupFailed = true;
            cleanupFailure = error;
          }

          if (cleanupFailed) {
            if (operationFailed) {
              throw new AggregateError(
                [operationFailure, cleanupFailure],
                "Poppler PDF rasterizer document session failed and cleanup was unsuccessful",
                { cause: operationFailure },
              );
            }

            throw cleanupFailure;
          }

          if (operationFailed) {
            throw operationFailure;
          }

          throwIfPdfRasterAborted(signal);
          return result;
        },
        signal ? { signal } : undefined,
      );

      // Render, persistence, and cleanup must settle before cancellation becomes observable.
      return pending;
    },
    withMaterializationSlot: async <T>(operation: () => Promise<T>, signal?: AbortSignal) => {
      const pending = materializationGate.run(
        async () => {
          throwIfPdfRasterAborted(signal);
          const result = await operation();
          throwIfPdfRasterAborted(signal);
          return result;
        },
        signal ? { signal } : undefined,
      );

      // The caller owns compensation. Wait for any uncancellable storage/database work to settle
      // before surfacing cancellation so cleanup cannot race a late PUT or commit.
      return pending;
    },
  };
}

async function runPopplerPdfRenderOperation<T>({
  operation,
  signal,
}: {
  readonly operation: () => Promise<T>;
  readonly signal?: AbortSignal | undefined;
}): Promise<T> {
  throwIfPdfRasterAborted(signal);

  try {
    return await operation();
  } catch (error) {
    if (signal?.aborted) {
      throw pdfRasterAbortReason(signal);
    }

    if (error instanceof DocumentPdfRenderError) {
      throw error;
    }
    throw new DocumentPdfRenderError("Poppler PDF rasterizer failed", { cause: error });
  }
}

interface PopplerRenderedPage {
  readonly body: Uint8Array;
  readonly channels: 1 | 2 | 3 | 4;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly wasDownscaled: boolean;
}

interface PopplerPdfPageSize {
  readonly heightPoints: number;
  readonly widthPoints: number;
}

interface MaterializedPopplerPdfDocument {
  readonly inputPath: string;
  readonly pageSizes: Map<number, Promise<PopplerPdfPageSize>>;
  readonly workDir: string;
}

async function materializePopplerPdfDocument({
  documentBody,
  signal,
}: {
  readonly documentBody: Uint8Array;
  readonly signal?: AbortSignal | undefined;
}): Promise<MaterializedPopplerPdfDocument> {
  const workDir = await mkdtemp(join(tmpdir(), "knowledge-fs-pdf-raster-"));
  const inputPath = join(workDir, "input.pdf");

  try {
    await writeFile(inputPath, documentBody, { signal });
    throwIfPdfRasterAborted(signal);
    return { inputPath, pageSizes: new Map(), workDir };
  } catch (error) {
    await rm(workDir, { force: true, recursive: true });
    throw error;
  }
}

async function removePopplerPdfDocument(document: MaterializedPopplerPdfDocument): Promise<void> {
  await rm(document.workDir, { force: true, recursive: true });
}

async function renderPopplerPdfBatch({
  command,
  documentBody,
  dpi,
  maxEncodedCropBytes,
  maxEncodedImageBytes,
  maxEncodedPageBytes,
  maxPageDimension,
  maxPagePixels,
  pdfInfoCommand,
  requests,
  signal,
  thumbnailDpi,
  thumbnailVariantName,
  timeoutMs,
}: {
  readonly command: string;
  readonly documentBody: Uint8Array;
  readonly dpi: number;
  readonly maxEncodedCropBytes: number;
  readonly maxEncodedImageBytes: number;
  readonly maxEncodedPageBytes: number;
  readonly maxPageDimension: number;
  readonly maxPagePixels: number;
  readonly pdfInfoCommand: string;
  readonly requests: readonly RenderDocumentPdfPageRequest[];
  readonly signal?: AbortSignal | undefined;
  readonly thumbnailDpi: number;
  readonly thumbnailVariantName: string;
  readonly timeoutMs: number;
}): Promise<readonly (RenderedDocumentPdfImage | null)[]> {
  if (requests.length === 0) {
    return [];
  }

  const document = await materializePopplerPdfDocument({ documentBody, signal });

  try {
    return await renderMaterializedPopplerPdfBatch({
      command,
      document,
      dpi,
      maxEncodedCropBytes,
      maxEncodedImageBytes,
      maxEncodedPageBytes,
      maxPageDimension,
      maxPagePixels,
      pdfInfoCommand,
      requests,
      signal,
      thumbnailDpi,
      thumbnailVariantName,
      timeoutMs,
    });
  } finally {
    await removePopplerPdfDocument(document);
  }
}

async function renderMaterializedPopplerPdfBatch({
  command,
  document,
  dpi,
  maxEncodedCropBytes,
  maxEncodedImageBytes,
  maxEncodedPageBytes,
  maxPageDimension,
  maxPagePixels,
  pdfInfoCommand,
  requests,
  signal,
  thumbnailDpi,
  thumbnailVariantName,
  timeoutMs,
}: {
  readonly command: string;
  readonly document: MaterializedPopplerPdfDocument;
  readonly dpi: number;
  readonly maxEncodedCropBytes: number;
  readonly maxEncodedImageBytes: number;
  readonly maxEncodedPageBytes: number;
  readonly maxPageDimension: number;
  readonly maxPagePixels: number;
  readonly pdfInfoCommand: string;
  readonly requests: readonly RenderDocumentPdfPageRequest[];
  readonly signal?: AbortSignal | undefined;
  readonly thumbnailDpi: number;
  readonly thumbnailVariantName: string;
  readonly timeoutMs: number;
}): Promise<readonly (RenderedDocumentPdfImage | null)[]> {
  if (requests.length === 0) {
    return [];
  }

  const rendered: (RenderedDocumentPdfImage | null)[] = Array.from(
    { length: requests.length },
    () => null,
  );
  const requestsByPage = new Map<
    number,
    { readonly index: number; readonly request: RenderDocumentPdfPageRequest }[]
  >();
  let aggregateEncodedCropBytes = 0;

  for (const [index, request] of requests.entries()) {
    const pageRequests = requestsByPage.get(request.pageNumber) ?? [];
    pageRequests.push({ index, request });
    requestsByPage.set(request.pageNumber, pageRequests);
  }

  for (const [pageNumber, pageRequests] of requestsByPage) {
    throwIfPdfRasterAborted(signal);
    const pageSize = await readCachedPopplerPdfPageSize({
      command: pdfInfoCommand,
      document,
      pageNumber,
      signal,
      timeoutMs,
    });
    const page = await renderPopplerPage({
      command,
      dpi,
      inputPath: document.inputPath,
      maxEncodedPageBytes,
      maxPageDimension,
      maxPagePixels,
      pageNumber,
      pageSize,
      signal,
      timeoutMs,
      workDir: document.workDir,
    });

    if (!page) {
      continue;
    }

    const thumbnailPage =
      thumbnailDpi === dpi
        ? page
        : await renderPopplerPage({
            command,
            dpi: thumbnailDpi,
            inputPath: document.inputPath,
            maxEncodedPageBytes,
            maxPageDimension: proportionalThumbnailMaxDimension({
              dpi,
              maxPageDimension,
              thumbnailDpi,
            }),
            maxPagePixels,
            pageNumber,
            pageSize,
            signal,
            timeoutMs,
            workDir: document.workDir,
          });

    for (const { index, request } of pageRequests) {
      const body = await cropPopplerPage({
        boundingBox: request.boundingBox,
        boundingBoxGeometry: request.boundingBoxGeometry,
        dpi,
        page,
        maxPagePixels,
        signal,
      });

      if (!body) {
        continue;
      }

      const thumbnailBody = thumbnailPage
        ? await cropPopplerPage({
            boundingBox: request.boundingBox,
            boundingBoxGeometry: request.boundingBoxGeometry,
            dpi: thumbnailDpi,
            page: thumbnailPage,
            maxPagePixels,
            signal,
          })
        : null;

      const encodedBytes = body.byteLength + (thumbnailBody?.byteLength ?? 0);

      if (
        body.byteLength > maxEncodedImageBytes ||
        (thumbnailBody?.byteLength ?? 0) > maxEncodedImageBytes
      ) {
        throw new DocumentPdfRenderError(
          `Document PDF rasterizer encoded image exceeds maxEncodedImageBytes=${maxEncodedImageBytes}`,
        );
      }

      aggregateEncodedCropBytes += encodedBytes;

      if (aggregateEncodedCropBytes > maxEncodedCropBytes) {
        throw new DocumentPdfRenderError(
          `Document PDF rasterizer encoded crop output exceeds maxEncodedCropBytes=${maxEncodedCropBytes}`,
        );
      }

      rendered[index] = {
        body,
        contentType: "image/png",
        metadata: createPopplerImageMetadata({
          command,
          dpi,
          renderedPage: page,
          request,
          thumbnailDpi,
        }),
        ...(thumbnailBody
          ? {
              variants: {
                [thumbnailVariantName]: {
                  body: thumbnailBody,
                  contentType: "image/png",
                  metadata: createPopplerImageMetadata({
                    command,
                    dpi: thumbnailDpi,
                    renderedPage: thumbnailPage ?? page,
                    request,
                    variant: thumbnailVariantName,
                  }),
                },
              },
            }
          : {}),
      };
    }
  }

  return rendered;
}

async function renderPopplerPage({
  command,
  dpi,
  inputPath,
  maxEncodedPageBytes,
  maxPageDimension,
  maxPagePixels,
  pageNumber,
  pageSize,
  signal,
  timeoutMs,
  workDir,
}: {
  readonly command: string;
  readonly dpi: number;
  readonly inputPath: string;
  readonly maxEncodedPageBytes: number;
  readonly maxPageDimension: number;
  readonly maxPagePixels: number;
  readonly pageNumber: number;
  readonly pageSize: PopplerPdfPageSize;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly workDir: string;
}): Promise<PopplerRenderedPage | null> {
  const outputName = `page-${pageNumber}-dpi-${dpi}`;
  const outputPrefix = join(workDir, outputName);
  const scaleTo = popplerScaleToForPage({ dpi, maxPageDimension, pageSize });
  await renderPopplerPng({
    command,
    dpi,
    inputPath,
    outputPrefix,
    pageNumber,
    scaleTo,
    signal,
    timeoutMs,
  });
  throwIfPdfRasterAborted(signal);
  const outputPath = await findPopplerOutputPath(workDir, `${outputName}-`);

  if (!outputPath) {
    return null;
  }

  try {
    const outputStat = await stat(outputPath);

    if (outputStat.size > maxEncodedPageBytes) {
      throw new DocumentPdfRenderError(
        `Poppler PDF rasterizer encoded page exceeds maxEncodedPageBytes=${maxEncodedPageBytes}`,
      );
    }

    const sharp = (await import("sharp")).default;
    const body = await readFile(outputPath, { signal });
    throwIfPdfRasterAborted(signal);
    const { data: pixels, info } = await awaitUncancellablePdfRasterOperation(
      sharp(outputPath, { limitInputPixels: maxPagePixels })
        .raw()
        .toBuffer({ resolveWithObject: true }),
      signal,
    );

    if (info.width * info.height > maxPagePixels) {
      throw new DocumentPdfRenderError(
        `Poppler PDF rasterizer decoded page exceeds maxPagePixels=${maxPagePixels}`,
      );
    }

    return {
      body: new Uint8Array(body),
      channels: info.channels,
      height: info.height,
      pixels: new Uint8Array(pixels),
      width: info.width,
      wasDownscaled: scaleTo !== undefined,
    };
  } finally {
    await rm(outputPath, { force: true });
  }
}

async function readCachedPopplerPdfPageSize({
  command,
  document,
  pageNumber,
  signal,
  timeoutMs,
}: {
  readonly command: string;
  readonly document: MaterializedPopplerPdfDocument;
  readonly pageNumber: number;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
}): Promise<PopplerPdfPageSize> {
  const cached = document.pageSizes.get(pageNumber);

  if (cached) {
    return cached;
  }

  const pending = readPopplerPdfPageSize({
    command,
    inputPath: document.inputPath,
    pageNumber,
    signal,
    timeoutMs,
  });
  document.pageSizes.set(pageNumber, pending);

  try {
    return await pending;
  } catch (error) {
    if (document.pageSizes.get(pageNumber) === pending) {
      document.pageSizes.delete(pageNumber);
    }
    throw error;
  }
}

async function readPopplerPdfPageSize({
  command,
  inputPath,
  pageNumber,
  signal,
  timeoutMs,
}: {
  readonly command: string;
  readonly inputPath: string;
  readonly pageNumber: number;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
}): Promise<PopplerPdfPageSize> {
  const { stdout } = await execFileAsync(
    command,
    ["-f", String(pageNumber), "-l", String(pageNumber), "-box", inputPath],
    { signal, timeout: timeoutMs, windowsHide: true },
  );
  const match = /Page(?:\s+\d+)?\s+size:\s*([\d.]+)\s+x\s+([\d.]+)\s+pts/iu.exec(String(stdout));
  const widthPoints = Number(match?.[1]);
  const heightPoints = Number(match?.[2]);

  if (!(widthPoints > 0) || !(heightPoints > 0)) {
    throw new DocumentPdfRenderError(
      `Poppler PDF rasterizer could not determine page size for pageNumber=${pageNumber}`,
    );
  }

  return { heightPoints, widthPoints };
}

function popplerScaleToForPage({
  dpi,
  maxPageDimension,
  pageSize,
}: {
  readonly dpi: number;
  readonly maxPageDimension: number;
  readonly pageSize: PopplerPdfPageSize;
}): number | undefined {
  const naturalMaxDimension = (Math.max(pageSize.widthPoints, pageSize.heightPoints) * dpi) / 72;

  return naturalMaxDimension > maxPageDimension ? maxPageDimension : undefined;
}

async function renderPopplerPng({
  command,
  dpi,
  inputPath,
  outputPrefix,
  pageNumber,
  scaleTo,
  signal,
  timeoutMs,
}: {
  readonly command: string;
  readonly dpi: number;
  readonly inputPath: string;
  readonly outputPrefix: string;
  readonly pageNumber: number;
  readonly scaleTo: number | undefined;
  readonly signal?: AbortSignal | undefined;
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
    ...(scaleTo === undefined ? [] : ["-scale-to", String(scaleTo)]),
    inputPath,
    outputPrefix,
  ];
  await execFileAsync(command, args, {
    signal,
    timeout: timeoutMs,
    windowsHide: true,
  });
}

async function cropPopplerPage({
  boundingBox,
  boundingBoxGeometry,
  dpi,
  maxPagePixels,
  page,
  signal,
}: {
  readonly boundingBox: DocumentMultimodalBoundingBox | undefined;
  readonly boundingBoxGeometry: DocumentPdfBoundingBoxGeometry | undefined;
  readonly dpi: number;
  readonly maxPagePixels: number;
  readonly page: PopplerRenderedPage;
  readonly signal?: AbortSignal | undefined;
}): Promise<Uint8Array | null> {
  throwIfPdfRasterAborted(signal);

  if (!boundingBox) {
    return page.body;
  }

  assertScaledPdfRasterCoordinatesCanBeNormalized({ boundingBoxGeometry, page });

  const normalizedBoundingBox = normalizePdfRasterBoundingBoxForDpi({
    boundingBox,
    dpi,
    geometry: boundingBoxGeometry,
    renderedPage: page,
  });
  const crop = clampPdfRasterCropToPage(normalizedBoundingBox, page);

  if (!crop) {
    return null;
  }

  const sharp = (await import("sharp")).default;
  const body = await awaitUncancellablePdfRasterOperation(
    sharp(page.pixels, {
      limitInputPixels: maxPagePixels,
      raw: {
        channels: page.channels,
        height: page.height,
        width: page.width,
      },
    })
      .extract(crop)
      .png()
      .toBuffer(),
    signal,
  );

  return new Uint8Array(body);
}

function assertScaledPdfRasterCoordinatesCanBeNormalized({
  boundingBoxGeometry,
  page,
}: {
  readonly boundingBoxGeometry: DocumentPdfBoundingBoxGeometry | undefined;
  readonly page: PopplerRenderedPage;
}): void {
  if (!page.wasDownscaled || boundingBoxGeometry?.coordinateSystem === "relative") {
    return;
  }

  if (boundingBoxGeometry?.pageWidth && boundingBoxGeometry.pageHeight) {
    return;
  }

  throw new DocumentPdfRenderError(
    "Poppler PDF rasterizer cannot normalize coordinates after page dimension capping without source page dimensions",
  );
}

export async function awaitUncancellablePdfRasterOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  let aborted = signal?.aborted ?? false;
  const onAbort = () => {
    aborted = true;
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await operation;

    if ((aborted || signal?.aborted) && signal) {
      throw pdfRasterAbortReason(signal);
    }

    return result;
  } catch (error) {
    if ((aborted || signal?.aborted) && signal) {
      throw pdfRasterAbortReason(signal);
    }

    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function proportionalThumbnailMaxDimension({
  dpi,
  maxPageDimension,
  thumbnailDpi,
}: {
  readonly dpi: number;
  readonly maxPageDimension: number;
  readonly thumbnailDpi: number;
}): number {
  return Math.max(1, Math.floor(maxPageDimension * Math.min(1, thumbnailDpi / dpi)));
}

function clampPdfRasterCropToPage(
  boundingBox: DocumentMultimodalBoundingBox,
  page: Pick<PopplerRenderedPage, "height" | "width">,
): {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
} | null {
  const requestedLeft = Math.floor(boundingBox.x);
  const requestedTop = Math.floor(boundingBox.y);
  const requestedRight = Math.ceil(boundingBox.x + boundingBox.width);
  const requestedBottom = Math.ceil(boundingBox.y + boundingBox.height);
  const left = Math.max(0, requestedLeft);
  const top = Math.max(0, requestedTop);
  const right = Math.min(page.width, requestedRight);
  const bottom = Math.min(page.height, requestedBottom);

  if (left >= right || top >= bottom) {
    return null;
  }

  return { height: bottom - top, left, top, width: right - left };
}

function createPopplerImageMetadata({
  command,
  dpi,
  renderedPage,
  request,
  thumbnailDpi,
  variant,
}: {
  readonly command: string;
  readonly dpi: number;
  readonly renderedPage: Pick<PopplerRenderedPage, "height" | "width">;
  readonly request: RenderDocumentPdfPageRequest;
  readonly thumbnailDpi?: number | undefined;
  readonly variant?: string | undefined;
}): Readonly<Record<string, unknown>> {
  return {
    command,
    ...(request.boundingBox
      ? {
          crop: {
            boundingBox: request.boundingBox,
            normalizedBoundingBox: normalizePdfRasterBoundingBoxForDpi({
              boundingBox: request.boundingBox,
              dpi,
              geometry: request.boundingBoxGeometry,
              renderedPage,
            }),
            ...(request.boundingBoxGeometry ? { geometry: request.boundingBoxGeometry } : {}),
          },
        }
      : {}),
    dpi,
    elementId: request.elementId,
    pageNumber: request.pageNumber,
    ...(thumbnailDpi !== undefined ? { thumbnailDpi } : {}),
    ...(variant !== undefined ? { variant } : {}),
  };
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

  if (hasPdfAssetReference(element)) {
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

function isPendingPdfVisual(element: ParseElement): boolean {
  return (element.type === "image" || element.type === "table") && !hasPdfAssetReference(element);
}

function hasPdfAssetReference(element: ParseElement): boolean {
  const assetRef = isPlainObject(element.metadata.assetRef) ? element.metadata.assetRef : {};

  return typeof assetRef.objectKey === "string" || typeof assetRef.uri === "string";
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
  renderedPage,
}: {
  readonly boundingBox: DocumentMultimodalBoundingBox;
  readonly dpi: number;
  readonly geometry?: DocumentPdfBoundingBoxGeometry | undefined;
  readonly renderedPage?: { readonly height: number; readonly width: number } | undefined;
}): DocumentMultimodalBoundingBox {
  const coordinateSystem = geometry?.coordinateSystem ?? "pixel";

  if (coordinateSystem === "pdf-point") {
    if (geometry?.pageWidth && geometry.pageHeight && renderedPage) {
      return scaleBoundingBox(
        boundingBox,
        renderedPage.width / geometry.pageWidth,
        renderedPage.height / geometry.pageHeight,
      );
    }

    const scale = dpi / 72;

    return scaleBoundingBox(boundingBox, scale, scale);
  }

  if (coordinateSystem === "relative" && renderedPage) {
    return {
      height: boundingBox.height * renderedPage.height,
      width: boundingBox.width * renderedPage.width,
      x: boundingBox.x * renderedPage.width,
      y: boundingBox.y * renderedPage.height,
    };
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

  if (coordinateSystem === "pixel" && geometry?.pageWidth && geometry.pageHeight && renderedPage) {
    return scaleBoundingBox(
      boundingBox,
      renderedPage.width / geometry.pageWidth,
      renderedPage.height / geometry.pageHeight,
    );
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

  if (
    normalized === "pixel" ||
    normalized === "pixels" ||
    normalized === "pixelspace" ||
    normalized === "pixel-space" ||
    normalized === "px"
  ) {
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
