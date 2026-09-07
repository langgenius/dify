import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type DocumentMultimodalAssetRef,
  type ParseArtifact,
  ParseArtifactSchema,
  type ParseElement,
  type PlatformAdapter,
} from "@knowledge/core";

import type {
  DocumentImageVariantGenerator,
  GeneratedDocumentImageVariant,
} from "./document-image-variant-generator";
import { createDocumentRemoteMediaBudget } from "./document-remote-media-budget";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import {
  createDocumentMultimodalAssetObjectKey,
  createDocumentMultimodalAssetVariantObjectKey,
} from "./storage-path-utils";

export interface ExtractDocumentMultimodalAssetsInput {
  readonly allowLocalAssetPaths?: readonly string[] | undefined;
  readonly artifact: ParseArtifact;
  readonly knowledgeSpaceId: string;
  readonly maxEmbeddedAssetBytes?: number | undefined;
  readonly maxExtractedAssets?: number | undefined;
  readonly maxLocalAssetBytes?: number | undefined;
  readonly maxRemoteAssetBytes?: number | undefined;
  readonly maxRemoteAssetAttempts?: number | undefined;
  readonly maxTotalRemoteAssetBytes?: number | undefined;
  readonly remoteAssetTimeoutMs?: number | undefined;
  readonly maxTotalAssetBytes?: number | undefined;
  readonly maxVariantPixels?: number | undefined;
  readonly maxTotalVariantPixels?: number | undefined;
  readonly maxVariantDurationMs?: number | undefined;
  readonly imageVariantGenerator?: DocumentImageVariantGenerator | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly remoteAssetFetcher?: DocumentRemoteAssetFetcher | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
  readonly writeOwnerId?: string | undefined;
}

export interface DocumentRemoteAssetFetcher {
  fetch(input: {
    readonly maxBytes: number;
    readonly signal?: AbortSignal | undefined;
    readonly url: string;
  }): Promise<{ readonly body: Uint8Array; readonly contentType: string } | null>;
}

export interface ExtractDocumentMultimodalAssetsResult {
  readonly artifact: ParseArtifact;
  readonly extractedCount: number;
  /** Number of extractable visual assets left inline because the per-document cap was reached. */
  readonly skippedForCapCount: number;
}

interface DataUriImage {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly dimensions?: ImageDimensions | undefined;
  readonly source: "data-uri" | "local-file" | "remote-url";
}

interface ImageDimensions {
  readonly height: number;
  readonly width: number;
}

type AnalysisUnavailableReason = NonNullable<
  DocumentMultimodalAssetRef["analysisUnavailable"]
>["reason"];

const dataUriPattern = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/iu;
const defaultMaxEmbeddedAssetBytes = 10 * 1024 * 1024;
const defaultMaxExtractedAssets = 1_000;
const defaultMaxLocalAssetBytes = 50 * 1024 * 1024;
const defaultMaxRemoteAssetBytes = 10 * 1024 * 1024;
const supportedRemoteImageContentTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function extractDocumentMultimodalAssets({
  allowLocalAssetPaths = [],
  artifact,
  knowledgeSpaceId,
  maxEmbeddedAssetBytes = defaultMaxEmbeddedAssetBytes,
  maxExtractedAssets = defaultMaxExtractedAssets,
  maxLocalAssetBytes = defaultMaxLocalAssetBytes,
  maxRemoteAssetBytes = defaultMaxRemoteAssetBytes,
  maxRemoteAssetAttempts = 100,
  maxTotalRemoteAssetBytes = 32 * 1024 * 1024,
  remoteAssetTimeoutMs = 60_000,
  maxTotalAssetBytes = 64 * 1024 * 1024,
  maxVariantPixels = 20_000_000,
  maxTotalVariantPixels = 100_000_000,
  maxVariantDurationMs = 60_000,
  imageVariantGenerator,
  objectStorage,
  remoteAssetFetcher,
  signal,
  tenantId,
  writeOwnerId,
}: ExtractDocumentMultimodalAssetsInput): Promise<ExtractDocumentMultimodalAssetsResult> {
  if (!Number.isSafeInteger(maxEmbeddedAssetBytes) || maxEmbeddedAssetBytes < 1) {
    throw new Error("Document multimodal embedded asset max bytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxLocalAssetBytes) || maxLocalAssetBytes < 1) {
    throw new Error("Document multimodal local asset max bytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxExtractedAssets) || maxExtractedAssets < 1) {
    throw new Error("Document multimodal max extracted assets must be at least 1");
  }

  if (!Number.isSafeInteger(maxRemoteAssetBytes) || maxRemoteAssetBytes < 1) {
    throw new Error("Document multimodal remote asset max bytes must be at least 1");
  }
  for (const [name, value] of Object.entries({
    maxTotalAssetBytes,
    maxVariantPixels,
    maxTotalVariantPixels,
    maxVariantDurationMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be at least 1`);
  }

  let extractedCount = 0;
  let skippedForCapCount = 0;
  let materializedBytes = 0;
  let variantPixels = 0;
  const variantDeadline = performance.now() + maxVariantDurationMs;
  const mediaReasons = new Set<string>();
  const remoteBudget = createDocumentRemoteMediaBudget({
    fetcher: remoteAssetFetcher,
    maxAttempts: maxRemoteAssetAttempts,
    maxBytes: maxRemoteAssetBytes,
    maxTotalBytes: maxTotalRemoteAssetBytes,
    signal,
    timeoutMs: remoteAssetTimeoutMs,
  });
  const extractionSources = new Set<string>();
  const elements = [];
  const allowedLocalRoots = normalizeAllowedLocalAssetPaths(allowLocalAssetPaths);
  const canonicalAllowedLocalRoots = (
    await Promise.all(allowedLocalRoots.map((root) => realpath(root).catch(() => null)))
  ).filter((root): root is string => root !== null);

  for (const element of artifact.elements) {
    signal?.throwIfAborted();
    if (element.type !== "image" && element.type !== "table") {
      elements.push(element);
      continue;
    }

    const assetRef = isPlainObject(element.metadata.assetRef) ? element.metadata.assetRef : null;
    const uri = typeof assetRef?.uri === "string" ? assetRef.uri.trim() : "";
    if (
      extractedCount >= maxExtractedAssets &&
      (dataUriPattern.test(uri) ||
        isRemoteHttpUri(uri) ||
        (allowedLocalRoots.length > 0 && localPathFromUri(uri)))
    ) {
      skippedForCapCount += 1;
      elements.push(withAnalysisUnavailable(element, "asset-count-budget"));
      continue;
    }
    if (materializedBytes >= maxTotalAssetBytes && uri) {
      mediaReasons.add("materialized-byte-budget");
      elements.push(withAnalysisUnavailable(element, "materialized-byte-budget"));
      continue;
    }
    let image =
      parseDataUriImage(uri, maxEmbeddedAssetBytes) ??
      (await readLocalImageAsset({
        allowedRoots: allowedLocalRoots,
        canonicalAllowedRoots: canonicalAllowedLocalRoots,
        assetRef,
        maxLocalAssetBytes,
        uri,
      }));

    if (!image && isRemoteHttpUri(uri)) {
      const fetched = await remoteBudget.fetch(uri);
      if (fetched) {
        const contentType = normalizeRemoteImageContentType(fetched.contentType);
        if (!contentType) {
          throw new Error("Document multimodal remote asset content type is unsupported");
        }
        if (fetched.body.byteLength === 0) {
          throw new Error("Document multimodal remote asset is empty");
        }
        const dimensions = readImageDimensions(fetched.body, contentType);
        image = {
          body: fetched.body,
          contentType,
          ...(dimensions ? { dimensions } : {}),
          source: "remote-url",
        };
      }
    }

    if (!assetRef || !image) {
      elements.push(element);
      continue;
    }

    if (image.body.byteLength > maxTotalAssetBytes - materializedBytes) {
      mediaReasons.add("materialized-byte-budget");
      elements.push(withAnalysisUnavailable(element, "materialized-byte-budget"));
      continue;
    }
    materializedBytes += image.body.byteLength;

    const sha256 = sha256Hex(image.body);
    const objectKey = createDocumentMultimodalAssetObjectKey({
      assetId: artifact.documentAssetId,
      contentType: image.contentType,
      elementId: element.id,
      knowledgeSpaceId,
      sha256,
      tenantId,
      ...(writeOwnerId ? { writeOwnerId } : {}),
    });

    await objectStorage.putObject({
      body: image.body,
      contentType: image.contentType,
      key: objectKey,
      metadata: {
        documentAssetId: artifact.documentAssetId,
        parseArtifactId: artifact.id,
        parseElementId: element.id,
        sha256,
        tenantId,
        ...(writeOwnerId ? { writeOwnerId } : {}),
      },
    });
    signal?.throwIfAborted();
    let analysisUnavailableReason: AnalysisUnavailableReason | undefined;
    const markAnalysisUnavailable = (reason: AnalysisUnavailableReason) => {
      analysisUnavailableReason = reason;
      mediaReasons.add(reason);
    };
    const imagePixels = image.dimensions
      ? image.dimensions.width * image.dimensions.height
      : maxVariantPixels;
    const canGenerateVariants =
      imageVariantGenerator &&
      imagePixels > 0 &&
      Number.isSafeInteger(imagePixels) &&
      imagePixels <= maxVariantPixels &&
      imagePixels <= maxTotalVariantPixels - variantPixels;
    if (imageVariantGenerator && !canGenerateVariants)
      markAnalysisUnavailable("variant-pixel-budget");
    if (canGenerateVariants) variantPixels += imagePixels;
    const variantTimeRemaining = Math.ceil(variantDeadline - performance.now());
    if (canGenerateVariants && variantTimeRemaining <= 0)
      markAnalysisUnavailable("variant-deadline");
    const variants =
      canGenerateVariants && variantTimeRemaining > 0
        ? await storeGeneratedImageVariants({
            assetId: artifact.documentAssetId,
            elementId: element.id,
            generator: imageVariantGenerator,
            image,
            knowledgeSpaceId,
            objectStorage,
            onUnavailable: markAnalysisUnavailable,
            onMaterializedBytes: (bytes) => {
              materializedBytes += bytes;
            },
            remainingBytes: maxTotalAssetBytes - materializedBytes,
            timeoutMs: variantTimeRemaining,
            tenantId,
            ...(signal ? { signal } : {}),
            ...(writeOwnerId ? { writeOwnerId } : {}),
          })
        : {};

    extractedCount += 1;
    extractionSources.add(image.source);
    const { uri: _uri, ...remainingAssetRef } = cloneJsonObject(assetRef);
    const existingVariants = isPlainObject(remainingAssetRef.variants)
      ? cloneJsonObject(remainingAssetRef.variants)
      : {};
    elements.push({
      ...element,
      metadata: {
        ...cloneJsonObject(element.metadata),
        assetRef: {
          ...remainingAssetRef,
          ...(analysisUnavailableReason
            ? { analysisUnavailable: { reason: analysisUnavailableReason } }
            : {}),
          contentType: image.contentType,
          ...(image.dimensions ? image.dimensions : {}),
          objectKey,
          sha256,
          source: image.source,
          sourceUriSha256: sha256Hex(new TextEncoder().encode(uri)),
          ...(Object.keys(variants).length > 0
            ? {
                variants: {
                  ...existingVariants,
                  ...variants,
                },
              }
            : Object.keys(existingVariants).length > 0
              ? { variants: existingVariants }
              : {}),
        },
      },
    });
  }

  if (
    extractedCount === 0 &&
    remoteBudget.reasons.size === 0 &&
    mediaReasons.size === 0 &&
    skippedForCapCount === 0
  ) {
    return { artifact, extractedCount, skippedForCapCount };
  }

  return {
    artifact: ParseArtifactSchema.parse({
      ...artifact,
      elements,
      metadata: {
        ...artifact.metadata,
        ...mediaCoverageMetadata(artifact, [
          ...remoteBudget.reasons,
          ...mediaReasons,
          ...(skippedForCapCount > 0 ? ["asset-count-budget"] : []),
        ]),
        multimodalAssets: {
          extractedCount,
          remoteAttempts: remoteBudget.attempts,
          remoteDownloadedBytes: remoteBudget.downloadedBytes,
          materializedBytes,
          variantPixels,
          ...(skippedForCapCount > 0 ? { skippedForCapCount } : {}),
          sources: [...extractionSources].sort(),
        },
      },
    }),
    extractedCount,
    skippedForCapCount,
  };
}

function withAnalysisUnavailable(
  element: ParseElement,
  reason: AnalysisUnavailableReason,
): ParseElement {
  return {
    ...element,
    metadata: {
      ...element.metadata,
      assetRef: {
        ...(isPlainObject(element.metadata.assetRef) ? element.metadata.assetRef : {}),
        analysisUnavailable: { reason },
      },
    },
  };
}

function mediaCoverageMetadata(artifact: ParseArtifact, reasons: readonly string[]) {
  if (reasons.length === 0) return {};
  const previous = isPlainObject(artifact.metadata.parseCoverage)
    ? artifact.metadata.parseCoverage
    : {};
  const media = isPlainObject(previous.media) ? previous.media : {};
  const existingReasons = Array.isArray(media.reasons)
    ? media.reasons.filter((item): item is string => typeof item === "string").slice(0, 32)
    : [];
  return {
    parseCoverage: {
      ...previous,
      media: {
        ...media,
        status: "partial",
        reasons: [...new Set([...existingReasons, ...reasons])],
      },
    },
  };
}

function isRemoteHttpUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function normalizeRemoteImageContentType(value: string): string | null {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return supportedRemoteImageContentTypes.has(normalized) ? normalized : null;
}

async function storeGeneratedImageVariants({
  assetId,
  elementId,
  generator,
  image,
  knowledgeSpaceId,
  objectStorage,
  onUnavailable,
  onMaterializedBytes,
  remainingBytes,
  timeoutMs,
  tenantId,
  signal,
  writeOwnerId,
}: {
  readonly assetId: string;
  readonly elementId: string;
  readonly generator: DocumentImageVariantGenerator;
  readonly image: DataUriImage;
  readonly knowledgeSpaceId: string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly onUnavailable: (reason: AnalysisUnavailableReason) => void;
  readonly onMaterializedBytes: (bytes: number) => void;
  readonly remainingBytes: number;
  readonly timeoutMs: number;
  readonly tenantId: string;
  readonly signal?: AbortSignal | undefined;
  readonly writeOwnerId?: string | undefined;
}): Promise<Record<string, Record<string, unknown>>> {
  const variants: Record<string, Record<string, unknown>> = {};
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("variant-deadline")), timeoutMs);
  let generated: readonly GeneratedDocumentImageVariant[];
  try {
    signal?.throwIfAborted();
    generated = await generator.generate({
      body: image.body,
      contentType: image.contentType,
      elementId,
      signal: controller.signal,
    });
    signal?.throwIfAborted();
    if (controller.signal.aborted) {
      onUnavailable("variant-deadline");
      return {};
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (controller.signal.aborted) {
      onUnavailable("variant-deadline");
      return {};
    }
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "provider_input" || error.code === "provider_timeout") &&
      "retryable" in error &&
      error.retryable === false
    ) {
      onUnavailable("variant-input-rejected");
      return {};
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
  if (generated.length === 0) onUnavailable("variant-unavailable");
  const generatedBytes = generated.reduce((sum, variant) => sum + variant.body.byteLength, 0);
  if (!Number.isSafeInteger(generatedBytes) || generatedBytes > remainingBytes) {
    onUnavailable("materialized-byte-budget");
    return {};
  }
  onMaterializedBytes(generatedBytes);

  for (const variant of generated) {
    const stored = await storeGeneratedImageVariant({
      assetId,
      elementId,
      knowledgeSpaceId,
      objectStorage,
      tenantId,
      variant,
      ...(writeOwnerId ? { writeOwnerId } : {}),
    });
    variants[variant.name] = stored;
  }

  return variants;
}

async function storeGeneratedImageVariant({
  assetId,
  elementId,
  knowledgeSpaceId,
  objectStorage,
  tenantId,
  variant,
  writeOwnerId,
}: {
  readonly assetId: string;
  readonly elementId: string;
  readonly knowledgeSpaceId: string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly tenantId: string;
  readonly variant: GeneratedDocumentImageVariant;
  readonly writeOwnerId?: string | undefined;
}): Promise<Record<string, unknown>> {
  const sha256 = sha256Hex(variant.body);
  const objectKey = createDocumentMultimodalAssetVariantObjectKey({
    assetId,
    contentType: variant.contentType,
    elementId,
    knowledgeSpaceId,
    sha256,
    tenantId,
    variant: variant.name,
    ...(writeOwnerId ? { writeOwnerId } : {}),
  });

  await objectStorage.putObject({
    body: variant.body,
    contentType: variant.contentType,
    key: objectKey,
    metadata: {
      documentAssetId: assetId,
      kind: "document-multimodal-asset-variant",
      parseElementId: elementId,
      sha256,
      tenantId,
      variant: variant.name,
      ...(writeOwnerId ? { writeOwnerId } : {}),
    },
  });

  return {
    contentType: variant.contentType,
    ...(variant.execution ? { execution: { ...variant.execution } } : {}),
    ...(variant.height !== undefined ? { height: variant.height } : {}),
    objectKey,
    sha256,
    ...(variant.width !== undefined ? { width: variant.width } : {}),
  };
}

function parseDataUriImage(uri: string, maxEmbeddedAssetBytes: number): DataUriImage | null {
  const match = uri.match(dataUriPattern);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const body = new Uint8Array(Buffer.from(match[2].replaceAll(/\s+/gu, ""), "base64"));

  if (body.byteLength === 0) {
    return null;
  }

  if (body.byteLength > maxEmbeddedAssetBytes) {
    throw new Error(
      `Document multimodal embedded asset exceeds maxEmbeddedAssetBytes=${maxEmbeddedAssetBytes}`,
    );
  }

  const dimensions = readImageDimensions(body, match[1].toLowerCase());

  return {
    body,
    contentType: match[1].toLowerCase(),
    ...(dimensions ? { dimensions } : {}),
    source: "data-uri",
  };
}

async function readLocalImageAsset({
  allowedRoots,
  canonicalAllowedRoots,
  assetRef,
  maxLocalAssetBytes,
  uri,
}: {
  readonly allowedRoots: readonly string[];
  readonly canonicalAllowedRoots: readonly string[];
  readonly assetRef: Readonly<Record<string, unknown>> | null;
  readonly maxLocalAssetBytes: number;
  readonly uri: string;
}): Promise<DataUriImage | null> {
  if (allowedRoots.length === 0) {
    return null;
  }

  const localPath = localPathFromUri(uri);

  if (!localPath || !pathIsWithinAllowedRoots(localPath, allowedRoots)) {
    return null;
  }

  const contentType = assetRefContentType(assetRef) ?? inferImageContentTypeFromPath(localPath);

  if (!contentType) {
    return null;
  }

  // Resolve both roots and the target before opening; O_NOFOLLOW also rejects replacement of
  // the final component with a symlink between realpath and open.
  const canonicalPath = await realpath(localPath);
  if (!pathIsWithinAllowedRoots(canonicalPath, canonicalAllowedRoots)) return null;
  const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();

    if (!metadata.isFile()) {
      return null;
    }

    if (metadata.size > maxLocalAssetBytes) {
      throw new Error(
        `Document multimodal local asset exceeds maxLocalAssetBytes=${maxLocalAssetBytes}`,
      );
    }

    const buffer = Buffer.alloc(Math.min(metadata.size, maxLocalAssetBytes) + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > maxLocalAssetBytes)
      throw new Error(
        `Document multimodal local asset exceeds maxLocalAssetBytes=${maxLocalAssetBytes}`,
      );
    if (bytesRead !== metadata.size)
      throw new Error("Document multimodal local asset changed during read");
    const body = new Uint8Array(buffer.subarray(0, bytesRead));
    const dimensions = readImageDimensions(body, contentType);

    return {
      body,
      contentType,
      ...(dimensions ? { dimensions } : {}),
      source: "local-file",
    };
  } finally {
    await handle.close();
  }
}

function readImageDimensions(body: Uint8Array, contentType: string): ImageDimensions | undefined {
  if (contentType === "image/png") {
    return readPngDimensions(body);
  }

  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return readJpegDimensions(body);
  }

  if (contentType === "image/gif") {
    return body.length >= 10
      ? { height: readUint16Le(body, 8), width: readUint16Le(body, 6) }
      : undefined;
  }

  if (contentType === "image/webp") {
    return readWebpDimensions(body);
  }

  return undefined;
}

function readPngDimensions(body: Uint8Array): ImageDimensions | undefined {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

  if (
    body.length < 24 ||
    !pngSignature.every((byte, index) => body[index] === byte) ||
    String.fromCharCode(...body.slice(12, 16)) !== "IHDR"
  ) {
    return undefined;
  }

  return {
    height: readUint32Be(body, 20),
    width: readUint32Be(body, 16),
  };
}

function readJpegDimensions(body: Uint8Array): ImageDimensions | undefined {
  if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;

  while (offset + 9 < body.length) {
    if (body[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = body[offset + 1];
    const length = readUint16Be(body, offset + 2);

    if (length < 2 || offset + 2 + length > body.length) {
      return undefined;
    }

    if (
      marker !== undefined &&
      ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf))
    ) {
      return {
        height: readUint16Be(body, offset + 5),
        width: readUint16Be(body, offset + 7),
      };
    }

    offset += 2 + length;
  }

  return undefined;
}

function readWebpDimensions(body: Uint8Array): ImageDimensions | undefined {
  if (
    body.length < 30 ||
    String.fromCharCode(...body.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...body.slice(8, 12)) !== "WEBP"
  ) {
    return undefined;
  }

  const chunkType = String.fromCharCode(...body.slice(12, 16));

  if (chunkType === "VP8X" && body.length >= 30) {
    return {
      height: readUint24Le(body, 27) + 1,
      width: readUint24Le(body, 24) + 1,
    };
  }

  if (chunkType === "VP8 " && body.length >= 30) {
    return {
      height: readUint16Le(body, 28) & 0x3fff,
      width: readUint16Le(body, 26) & 0x3fff,
    };
  }

  if (chunkType === "VP8L" && body.length >= 25) {
    const bits =
      (body[21] ?? 0) |
      ((body[22] ?? 0) << 8) |
      ((body[23] ?? 0) << 16) |
      (((body[24] ?? 0) & 0x3f) << 24);

    return {
      height: ((bits >> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    };
  }

  return undefined;
}

function readUint16Be(body: Uint8Array, offset: number): number {
  return ((body[offset] ?? 0) << 8) + (body[offset + 1] ?? 0);
}

function readUint16Le(body: Uint8Array, offset: number): number {
  return (body[offset] ?? 0) + ((body[offset + 1] ?? 0) << 8);
}

function readUint24Le(body: Uint8Array, offset: number): number {
  return (body[offset] ?? 0) + ((body[offset + 1] ?? 0) << 8) + ((body[offset + 2] ?? 0) << 16);
}

function readUint32Be(body: Uint8Array, offset: number): number {
  return (
    (body[offset] ?? 0) * 0x1000000 +
    ((body[offset + 1] ?? 0) << 16) +
    ((body[offset + 2] ?? 0) << 8) +
    (body[offset + 3] ?? 0)
  );
}

function normalizeAllowedLocalAssetPaths(paths: readonly string[]): string[] {
  return paths.map((path) => resolve(path)).filter((path) => path.trim());
}

function localPathFromUri(uri: string): string | null {
  if (!uri) {
    return null;
  }

  if (uri.startsWith("file://")) {
    return resolve(fileURLToPath(uri));
  }

  if (uri.startsWith("/")) {
    return resolve(uri);
  }

  return null;
}

function pathIsWithinAllowedRoots(path: string, allowedRoots: readonly string[]): boolean {
  const resolvedPath = resolve(path);

  return allowedRoots.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`));
}

function assetRefContentType(
  assetRef: Readonly<Record<string, unknown>> | null,
): string | undefined {
  const contentType = typeof assetRef?.contentType === "string" ? assetRef.contentType : "";

  return contentType.toLowerCase().startsWith("image/") ? contentType.toLowerCase() : undefined;
}

function inferImageContentTypeFromPath(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".webp":
      return "image/webp";
    default:
      return undefined;
  }
}

function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}
