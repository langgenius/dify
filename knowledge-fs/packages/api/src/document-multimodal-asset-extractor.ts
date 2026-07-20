import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type ParseArtifact, ParseArtifactSchema, type PlatformAdapter } from "@knowledge/core";

import type {
  DocumentImageVariantGenerator,
  GeneratedDocumentImageVariant,
} from "./document-image-variant-generator";
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
  readonly imageVariantGenerator?: DocumentImageVariantGenerator | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly tenantId: string;
}

export interface ExtractDocumentMultimodalAssetsResult {
  readonly artifact: ParseArtifact;
  readonly extractedCount: number;
  /** Number of extractable images left inline because the per-document cap was reached. */
  readonly skippedForCapCount: number;
}

interface DataUriImage {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly dimensions?: ImageDimensions | undefined;
  readonly source: "data-uri" | "local-file";
}

interface ImageDimensions {
  readonly height: number;
  readonly width: number;
}

const dataUriPattern = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/iu;
const defaultMaxEmbeddedAssetBytes = 10 * 1024 * 1024;
const defaultMaxExtractedAssets = 1_000;
const defaultMaxLocalAssetBytes = 50 * 1024 * 1024;

export async function extractDocumentMultimodalAssets({
  allowLocalAssetPaths = [],
  artifact,
  knowledgeSpaceId,
  maxEmbeddedAssetBytes = defaultMaxEmbeddedAssetBytes,
  maxExtractedAssets = defaultMaxExtractedAssets,
  maxLocalAssetBytes = defaultMaxLocalAssetBytes,
  imageVariantGenerator,
  objectStorage,
  tenantId,
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

  let extractedCount = 0;
  let skippedForCapCount = 0;
  const extractionSources = new Set<string>();
  const elements = [];
  const allowedLocalRoots = normalizeAllowedLocalAssetPaths(allowLocalAssetPaths);

  for (const element of artifact.elements) {
    if (element.type !== "image") {
      elements.push(element);
      continue;
    }

    const assetRef = isPlainObject(element.metadata.assetRef) ? element.metadata.assetRef : null;
    const uri = typeof assetRef?.uri === "string" ? assetRef.uri.trim() : "";
    const image =
      parseDataUriImage(uri, maxEmbeddedAssetBytes) ??
      (await readLocalImageAsset({
        allowedRoots: allowedLocalRoots,
        assetRef,
        maxLocalAssetBytes,
        uri,
      }));

    if (!assetRef || !image) {
      elements.push(element);
      continue;
    }

    if (extractedCount >= maxExtractedAssets) {
      // Soft cap: leave the remaining extractable images inline instead of throwing (which would
      // abort ingestion and orphan the assets already written to object storage this run).
      skippedForCapCount += 1;
      elements.push(element);
      continue;
    }

    const sha256 = sha256Hex(image.body);
    const objectKey = createDocumentMultimodalAssetObjectKey({
      assetId: artifact.documentAssetId,
      contentType: image.contentType,
      elementId: element.id,
      knowledgeSpaceId,
      sha256,
      tenantId,
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
      },
    });
    const variants = imageVariantGenerator
      ? await storeGeneratedImageVariants({
          assetId: artifact.documentAssetId,
          elementId: element.id,
          generator: imageVariantGenerator,
          image,
          knowledgeSpaceId,
          objectStorage,
          tenantId,
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

  if (extractedCount === 0) {
    return { artifact, extractedCount, skippedForCapCount };
  }

  return {
    artifact: ParseArtifactSchema.parse({
      ...artifact,
      elements,
      metadata: {
        ...artifact.metadata,
        multimodalAssets: {
          extractedCount,
          ...(skippedForCapCount > 0 ? { skippedForCapCount } : {}),
          sources: [...extractionSources].sort(),
        },
      },
    }),
    extractedCount,
    skippedForCapCount,
  };
}

async function storeGeneratedImageVariants({
  assetId,
  elementId,
  generator,
  image,
  knowledgeSpaceId,
  objectStorage,
  tenantId,
}: {
  readonly assetId: string;
  readonly elementId: string;
  readonly generator: DocumentImageVariantGenerator;
  readonly image: DataUriImage;
  readonly knowledgeSpaceId: string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly tenantId: string;
}): Promise<Record<string, Record<string, unknown>>> {
  const variants: Record<string, Record<string, unknown>> = {};
  const generated = await generator.generate({
    body: image.body,
    contentType: image.contentType,
    elementId,
  });

  for (const variant of generated) {
    const stored = await storeGeneratedImageVariant({
      assetId,
      elementId,
      knowledgeSpaceId,
      objectStorage,
      tenantId,
      variant,
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
}: {
  readonly assetId: string;
  readonly elementId: string;
  readonly knowledgeSpaceId: string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly tenantId: string;
  readonly variant: GeneratedDocumentImageVariant;
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
    },
  });

  return {
    contentType: variant.contentType,
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
  assetRef,
  maxLocalAssetBytes,
  uri,
}: {
  readonly allowedRoots: readonly string[];
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

  const metadata = await stat(localPath);

  if (!metadata.isFile()) {
    return null;
  }

  if (metadata.size > maxLocalAssetBytes) {
    throw new Error(
      `Document multimodal local asset exceeds maxLocalAssetBytes=${maxLocalAssetBytes}`,
    );
  }

  const body = new Uint8Array(await readFile(localPath));
  const dimensions = readImageDimensions(body, contentType);

  return {
    body,
    contentType,
    ...(dimensions ? { dimensions } : {}),
    source: "local-file",
  };
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
