import { createHash } from "node:crypto";

import {
  type DocumentMultimodalAssetRef,
  DocumentMultimodalAssetRefSchema,
  type DocumentMultimodalBoundingBox,
  type DocumentMultimodalEnrichmentStatus,
  type DocumentMultimodalItem,
  type DocumentMultimodalManifest,
  DocumentMultimodalManifestSchema,
  type ParseArtifact,
  type ParseElement,
  PublicationGenerationIdSchema,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";
import { cloneJsonObject, isPlainObject } from "./json-utils";

export interface DocumentMultimodalManifestBuilder {
  build(input: BuildDocumentMultimodalManifestInput): DocumentMultimodalManifest;
}

export interface BuildDocumentMultimodalManifestInput {
  readonly artifact: ParseArtifact;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId?: string | undefined;
}

export interface DocumentMultimodalManifestBuilderOptions {
  readonly manifestVersion?: string | undefined;
  readonly maxTextPreviewChars?: number | undefined;
}

const defaultManifestVersion = "document-multimodal-manifest-v1";
const defaultMaxTextPreviewChars = 700;

export function createDocumentMultimodalManifestBuilder({
  manifestVersion = defaultManifestVersion,
  maxTextPreviewChars = defaultMaxTextPreviewChars,
}: DocumentMultimodalManifestBuilderOptions = {}): DocumentMultimodalManifestBuilder {
  if (!manifestVersion.trim()) {
    throw new Error("Document multimodal manifest version must be non-empty");
  }

  if (!Number.isInteger(maxTextPreviewChars) || maxTextPreviewChars < 1) {
    throw new Error("Document multimodal manifest maxTextPreviewChars must be at least 1");
  }

  return {
    build: ({ artifact, knowledgeSpaceId, publicationGenerationId }) => {
      const generationId =
        publicationGenerationId === undefined
          ? undefined
          : PublicationGenerationIdSchema.parse(publicationGenerationId);
      const items = artifact.elements
        .map((element, index) =>
          documentMultimodalItemFromElement({
            artifact,
            element,
            index,
            maxTextPreviewChars,
          }),
        )
        .filter((item): item is DocumentMultimodalItem => item !== null);
      const modalityCounts = countModalities(items);

      return DocumentMultimodalManifestSchema.parse({
        artifactHash: artifact.artifactHash,
        createdAt: artifact.createdAt,
        documentAssetId: artifact.documentAssetId,
        id: generationId
          ? deterministicChildId(
              generationId,
              `document:${artifact.documentAssetId}:${artifact.version}:multimodal-manifest:${manifestVersion}`,
            )
          : deterministicUuid(`${artifact.id}:multimodal-manifest:${manifestVersion}`),
        items,
        knowledgeSpaceId,
        manifestVersion,
        metadata: {
          modalityCounts,
          missingAssetCount: items.filter((item) => item.enrichment.asset === "missing").length,
          missingVisualEmbeddingCount: items.filter(
            (item) => item.enrichment.visualEmbedding === "missing",
          ).length,
          source: "parse-artifact",
        },
        parseArtifactId: artifact.id,
        ...(generationId ? { publicationGenerationId: generationId } : {}),
        ...(artifact.updatedAt ? { updatedAt: artifact.updatedAt } : {}),
        version: artifact.version,
      });
    },
  };
}

function documentMultimodalItemFromElement({
  artifact,
  element,
  index,
  maxTextPreviewChars,
}: {
  readonly artifact: ParseArtifact;
  readonly element: ParseElement;
  readonly index: number;
  readonly maxTextPreviewChars: number;
}): DocumentMultimodalItem | null {
  const modality = multimodalModality(element);

  if (!modality) {
    return null;
  }

  const caption = metadataString(element.metadata, "caption");
  const ocrText = metadataString(element.metadata, "ocrText");
  const title = metadataString(element.metadata, "title") ?? caption;
  const assetRef = parseAssetRef(element.metadata);
  const boundingBox = parseBoundingBox(element.metadata.boundingBox);
  const textPreview = textPreviewForElement(element, ocrText, maxTextPreviewChars);
  const startOffset = metadataNumber(element.metadata, "startOffset");
  const endOffset = metadataNumber(element.metadata, "endOffset");

  return {
    ...(assetRef ? { assetRef } : {}),
    ...(boundingBox ? { boundingBox } : {}),
    ...(caption ? { caption } : {}),
    ...(endOffset !== undefined ? { endOffset } : {}),
    enrichment: enrichmentForElement({ assetRef, caption, element, ocrText }),
    id: `${artifact.id}:${index}:${element.id}`,
    modality,
    ...(ocrText ? { ocrText } : {}),
    ...(element.pageNumber ? { pageNumber: element.pageNumber } : {}),
    parseElementId: element.id,
    sectionPath: [...element.sectionPath],
    sourceMetadata: cloneJsonObject(element.metadata),
    ...(startOffset !== undefined ? { startOffset } : {}),
    ...(textPreview ? { textPreview } : {}),
    ...(title ? { title } : {}),
  };
}

function multimodalModality(element: ParseElement): DocumentMultimodalItem["modality"] | null {
  switch (element.type) {
    case "code":
      return "code";
    case "image":
      return "image";
    case "page-break":
      return "page";
    case "table":
      return "table";
    default:
      return null;
  }
}

function enrichmentForElement({
  assetRef,
  caption,
  element,
  ocrText,
}: {
  readonly assetRef: DocumentMultimodalAssetRef | undefined;
  readonly caption: string | undefined;
  readonly element: ParseElement;
  readonly ocrText: string | undefined;
}): DocumentMultimodalItem["enrichment"] {
  return {
    asset: assetRef
      ? "provided"
      : element.type === "image" || element.type === "table"
        ? "missing"
        : "unsupported",
    caption: caption ? "provided" : element.type === "image" ? "missing" : "unsupported",
    ocr:
      ocrText || element.text ? "provided" : element.type === "image" ? "missing" : "unsupported",
    tableStructure: element.type === "table" ? tableStructureStatus(element) : "unsupported",
    visualEmbedding:
      assetRef && isVisualEmbeddingEligibleElement(element) ? "missing" : "unsupported",
  };
}

function isVisualEmbeddingEligibleElement(element: ParseElement): boolean {
  return element.type === "image" || element.type === "page-break" || element.type === "table";
}

function tableStructureStatus(element: ParseElement): DocumentMultimodalEnrichmentStatus {
  if (isPlainObject(element.metadata.table) || Array.isArray(element.metadata.rows)) {
    return "provided";
  }

  return element.text ? "provided" : "missing";
}

function textPreviewForElement(
  element: ParseElement,
  ocrText: string | undefined,
  maxTextPreviewChars: number,
): string | undefined {
  const text = (ocrText ?? element.text ?? "").trim();

  if (!text) {
    return undefined;
  }

  return text.length > maxTextPreviewChars
    ? `${text.slice(0, Math.max(0, maxTextPreviewChars - 3))}...`
    : text;
}

function parseAssetRef(
  metadata: Readonly<Record<string, unknown>>,
): DocumentMultimodalAssetRef | undefined {
  // Only build an assetRef from an explicit `metadata.assetRef` object, or from top-level metadata
  // that carries a strong asset signal (objectKey/sha256). Do NOT scavenge a generic top-level
  // `uri`/`mimeType` (e.g. a source hyperlink or the document's own type) into a fake asset.
  const explicit = isPlainObject(metadata.assetRef) ? metadata.assetRef : undefined;
  const topLevelHasAssetSignal =
    metadataString(metadata, "objectKey") !== undefined ||
    metadataString(metadata, "sha256") !== undefined;
  const candidate = explicit ?? (topLevelHasAssetSignal ? metadata : undefined);

  if (!candidate) {
    return undefined;
  }

  const objectKey = metadataString(candidate, "objectKey");
  const uri = metadataString(candidate, "uri");
  const sha256 = metadataString(candidate, "sha256");
  const contentType =
    metadataString(candidate, "contentType") ?? metadataString(candidate, "mimeType");

  if (!objectKey && !uri && !sha256) {
    return undefined;
  }

  return {
    ...(contentType ? { contentType } : {}),
    ...(objectKey ? { objectKey } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(uri ? { uri } : {}),
    ...(isPlainObject(candidate.variants)
      ? { variants: DocumentMultimodalAssetRefSchema.shape.variants.parse(candidate.variants) }
      : {}),
  };
}

function parseBoundingBox(value: unknown): DocumentMultimodalBoundingBox | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const x = metadataNumber(value, "x");
  const y = metadataNumber(value, "y");
  const width = metadataNumber(value, "width");
  const height = metadataNumber(value, "height");

  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }

  return { height, width, x, y };
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function metadataNumber(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = metadata[key];

  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function countModalities(
  items: readonly DocumentMultimodalItem[],
): Record<DocumentMultimodalItem["modality"], number> {
  const counts: Record<DocumentMultimodalItem["modality"], number> = {
    code: 0,
    image: 0,
    page: 0,
    table: 0,
  };

  for (const item of items) {
    counts[item.modality] += 1;
  }

  return counts;
}

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const chars = hex.split("");
  chars[12] = "4";
  const variant = Number.parseInt(chars[16] ?? "0", 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const normalized = chars.join("");

  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join("-");
}
