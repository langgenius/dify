export const MAX_KNOWLEDGE_NODE_SOURCE_METADATA_BYTES = 256 * 1024;
export const MAX_KNOWLEDGE_NODE_FRAGMENT_SOURCE_METADATA_BYTES = 16 * 1024;

const FRAGMENT_SAFE_SOURCE_METADATA_KEYS = new Set(["assetRef", "boundingBox", "caption", "title"]);
const KNOWLEDGE_NODE_SOURCE_METADATA_KEYS = [
  "assetRef",
  "boundingBox",
  "caption",
  "title",
  "ocrText",
  "table",
  "textAsHtml",
] as const;

export type SourceMetadataOmissionReason = "fragmented-source-element" | "size-limit";

export interface SourceMetadataOmission {
  readonly field: string;
  readonly reason: SourceMetadataOmissionReason;
}

export interface KnowledgeNodeSourceMetadataProjection {
  readonly metadata: Record<string, unknown>;
  readonly omissions: readonly SourceMetadataOmission[];
  readonly projectedBytes: number;
}

/**
 * Projects parser element metadata onto a knowledge node without amplifying large source payloads.
 *
 * A parser may attach the complete OCR text or HTML representation of a table to one source
 * element. Copying that payload onto every chunk produced from the element turns a linear parse
 * artifact into an O(chunks * metadata) allocation. Fragment nodes therefore retain only the
 * compact location/reference fields. Complete elements may retain the richer fields, but only
 * within a deterministic serialized-byte budget.
 */
export function projectParseElementMetadataForKnowledgeNode(
  source: Readonly<Record<string, unknown>>,
  {
    completeElement,
    maxBytes = completeElement
      ? MAX_KNOWLEDGE_NODE_SOURCE_METADATA_BYTES
      : MAX_KNOWLEDGE_NODE_FRAGMENT_SOURCE_METADATA_BYTES,
  }: {
    readonly completeElement: boolean;
    readonly maxBytes?: number | undefined;
  },
): KnowledgeNodeSourceMetadataProjection {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Knowledge node source metadata maxBytes must be at least 1");
  }

  const metadata: Record<string, unknown> = {};
  const omissions: SourceMetadataOmission[] = [];
  let projectedBytes = 2; // Opening and closing braces of the projected JSON object.
  let projectedFields = 0;

  for (const field of KNOWLEDGE_NODE_SOURCE_METADATA_KEYS) {
    if (!Object.hasOwn(source, field) || source[field] === undefined) {
      continue;
    }
    if (!completeElement && !FRAGMENT_SAFE_SOURCE_METADATA_KEYS.has(field)) {
      omissions.push({ field, reason: "fragmented-source-element" });
      continue;
    }

    const serialized = JSON.stringify({ [field]: source[field] });
    if (serialized === undefined || serialized === "{}") {
      continue;
    }
    const entryBytes = utf8ByteLength(serialized) - 2 + (projectedFields === 0 ? 0 : 1);
    if (projectedBytes + entryBytes > maxBytes) {
      omissions.push({ field, reason: "size-limit" });
      continue;
    }

    Object.assign(metadata, JSON.parse(serialized) as Record<string, unknown>);
    projectedBytes += entryBytes;
    projectedFields += 1;
  }

  return { metadata, omissions, projectedBytes };
}

/** Adds compact, deterministic provenance only when source metadata had to be omitted. */
export function knowledgeNodeSourceMetadataWithProjection(
  source: Readonly<Record<string, unknown>>,
  options: {
    readonly completeElement: boolean;
    readonly maxBytes?: number | undefined;
  },
): Record<string, unknown> {
  const projection = projectParseElementMetadataForKnowledgeNode(source, options);
  if (projection.omissions.length === 0) {
    return projection.metadata;
  }

  return {
    ...projection.metadata,
    sourceMetadataProjection: {
      completeElement: options.completeElement,
      maxBytes:
        options.maxBytes ??
        (options.completeElement
          ? MAX_KNOWLEDGE_NODE_SOURCE_METADATA_BYTES
          : MAX_KNOWLEDGE_NODE_FRAGMENT_SOURCE_METADATA_BYTES),
      omitted: projection.omissions.map(({ field, reason }) => ({ field, reason })),
      projectedBytes: projection.projectedBytes,
    },
  };
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}
