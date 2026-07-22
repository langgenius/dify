/** Canonical document coordinates are half-open UTF-8 byte ranges. */
export const DOCUMENT_OFFSET_ENCODING = "utf-8-bytes";
export const DOCUMENT_ELEMENT_SEPARATOR = "\n";
export const DOCUMENT_ELEMENT_TEXT_NORMALIZATION = "unicode-whitespace-trim";

const encoder = new TextEncoder();
const edgeUnicodeWhitespace = /^\p{White_Space}+|\p{White_Space}+$/gu;
const separatorByteLength = encoder.encode(DOCUMENT_ELEMENT_SEPARATOR).byteLength;

export interface DocumentElementByteSpan {
  readonly endOffset: number;
  readonly nextOffset: number;
  readonly startOffset: number;
  readonly text: string;
}

/**
 * Normalizes one parser element and locates it in the canonical text formed by joining all
 * non-empty normalized elements with a single LF. Empty elements occupy no bytes or separator.
 */
export function materializeDocumentElementByteSpan(
  text: string | undefined,
  startOffset: number,
): DocumentElementByteSpan | null {
  const normalized = normalizeDocumentElementText(text);

  if (!normalized) {
    return null;
  }

  const endOffset = startOffset + encoder.encode(normalized).byteLength;

  return {
    endOffset,
    nextOffset: endOffset + separatorByteLength,
    startOffset,
    text: normalized,
  };
}

export function normalizeDocumentElementText(text: string | undefined): string {
  return text?.replace(edgeUnicodeWhitespace, "") ?? "";
}
