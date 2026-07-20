import { cloneJsonObject, isPlainObject } from "./json-utils";

export interface MultimodalEvidenceAttachment {
  readonly assetDescriptorPath?: string | undefined;
  readonly assetRef?: Record<string, unknown> | undefined;
  readonly assetRoute?: string | undefined;
  readonly boundingBox?: Record<string, unknown> | undefined;
  readonly caption?: string | undefined;
  readonly documentAssetId: string;
  readonly manifestItemId?: string | undefined;
  readonly modality: string;
  readonly nodeId?: string | undefined;
  readonly ocrText?: string | undefined;
  readonly pageNumber?: number | undefined;
  readonly parseArtifactId?: string | undefined;
  readonly parseElementId?: string | undefined;
  readonly sectionPath: readonly string[];
  readonly textPreview?: string | undefined;
}

export function multimodalEvidenceFromCitations({
  citations,
  maxItems,
}: {
  readonly citations: readonly Record<string, unknown>[];
  readonly maxItems: number;
}): MultimodalEvidenceAttachment[] {
  if (!Number.isInteger(maxItems) || maxItems < 0) {
    throw new Error("Multimodal evidence maxItems must be non-negative");
  }

  return citations
    .map(multimodalEvidenceFromCitation)
    .filter((attachment): attachment is MultimodalEvidenceAttachment => attachment !== null)
    .slice(0, maxItems);
}

export function multimodalEvidenceAnswerLines(
  attachments: readonly MultimodalEvidenceAttachment[],
): string[] {
  if (attachments.length === 0) {
    return [];
  }

  return [
    "Multimodal evidence:",
    ...attachments.map((attachment, index) => {
      const location = [
        attachment.pageNumber === undefined ? undefined : `page ${attachment.pageNumber}`,
        attachment.sectionPath.join(" / ") || undefined,
      ]
        .filter(Boolean)
        .join(", ");
      const route = attachment.assetRoute ?? attachment.assetDescriptorPath;
      // Surface the actual visual text so text-only models can ground on it, not just the route.
      const text = [
        attachment.caption ? `caption: ${attachment.caption}` : undefined,
        attachment.ocrText ? `OCR: ${attachment.ocrText}` : undefined,
        attachment.caption || attachment.ocrText ? undefined : attachment.textPreview,
      ]
        .filter(Boolean)
        .join("; ");

      return `${index + 1}. ${attachment.modality}${location ? ` (${location})` : ""}${route ? `: ${route}` : ""}${text ? ` — ${text}` : ""}`;
    }),
  ];
}

function multimodalEvidenceFromCitation(
  citation: Readonly<Record<string, unknown>>,
): MultimodalEvidenceAttachment | null {
  const candidate = isPlainObject(citation.multimodalCandidate)
    ? citation.multimodalCandidate
    : undefined;

  if (!candidate) {
    return null;
  }

  const documentAssetId = metadataString(candidate, "documentAssetId");
  const modality = metadataString(candidate, "modality");

  if (!documentAssetId || !modality) {
    return null;
  }

  return {
    ...(metadataString(candidate, "assetDescriptorPath")
      ? { assetDescriptorPath: metadataString(candidate, "assetDescriptorPath") }
      : {}),
    ...(isPlainObject(candidate.assetRef) ? { assetRef: cloneJsonObject(candidate.assetRef) } : {}),
    ...(metadataString(candidate, "assetRoute")
      ? { assetRoute: metadataString(candidate, "assetRoute") }
      : {}),
    ...(isPlainObject(candidate.boundingBox)
      ? { boundingBox: cloneJsonObject(candidate.boundingBox) }
      : {}),
    ...(metadataString(candidate, "caption")
      ? { caption: metadataString(candidate, "caption") }
      : {}),
    documentAssetId,
    ...(metadataString(candidate, "manifestItemId")
      ? { manifestItemId: metadataString(candidate, "manifestItemId") }
      : {}),
    modality,
    ...(metadataString(citation, "nodeId") ? { nodeId: metadataString(citation, "nodeId") } : {}),
    ...(metadataString(candidate, "ocrText")
      ? { ocrText: metadataString(candidate, "ocrText") }
      : {}),
    ...(metadataInteger(candidate, "pageNumber") === undefined
      ? {}
      : { pageNumber: metadataInteger(candidate, "pageNumber") }),
    ...(metadataString(candidate, "parseArtifactId")
      ? { parseArtifactId: metadataString(candidate, "parseArtifactId") }
      : {}),
    ...(metadataString(candidate, "parseElementId")
      ? { parseElementId: metadataString(candidate, "parseElementId") }
      : {}),
    sectionPath: metadataStringArray(candidate, "sectionPath"),
    ...(metadataString(candidate, "textPreview")
      ? { textPreview: metadataString(candidate, "textPreview") }
      : {}),
  };
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function metadataInteger(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = metadata[key];

  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function metadataStringArray(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = metadata[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
