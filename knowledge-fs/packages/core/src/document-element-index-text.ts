import type { ParseArtifact } from "./models";

type ParseArtifactElement = ParseArtifact["elements"][number];

/**
 * Supplies the smallest searchable surrogate for an otherwise textless image element.
 *
 * Requiring an object-backed asset keeps decorative/parser-only empty elements out of the index.
 * Existing textual elements are deliberately left to each chunker's normal normalization path.
 */
export function emptyImageElementIndexText(element: ParseArtifactElement): string | undefined {
  if (element.type !== "image" || !isRecord(element.metadata.assetRef)) {
    return undefined;
  }

  const descriptiveText = ["title", "caption", "ocrText"]
    .map((key) => metadataString(element.metadata, key))
    .filter((value): value is string => value !== undefined)
    .join("\n");

  return descriptiveText || "Image";
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
