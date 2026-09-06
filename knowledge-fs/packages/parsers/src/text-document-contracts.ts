import type { ParseElement } from "@knowledge/core";
import { DomUtils, parseDocument } from "htmlparser2";

/** Classified input errors remain terminal across the isolated parser IPC boundary. */
export class TextDocumentInputError extends Error {
  readonly code = "provider_input";
  readonly retryable = false;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TextDocumentInputError";
  }
}

export function decodeDocumentText(bytes: Uint8Array): {
  readonly text: string;
  readonly encoding: "utf-8" | "utf-16le" | "utf-16be";
} {
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  )
    throw new TextDocumentInputError("UTF-32 text is not supported; convert to UTF-8 or UTF-16");
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("Text contains NUL characters");
    return { encoding, text };
  } catch (cause) {
    throw new TextDocumentInputError(`Invalid ${encoding} text; use UTF-8 or BOM-marked UTF-16`, {
      cause,
    });
  }
}

type Element = Omit<ParseElement, "id">;

export function propertiesElements(text: string, maxElements: number): Element[] {
  const lines = text.split(/\r\n|\r|\n/u);
  const elements: Element[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = (lines[index] ?? "").replace(/^[ \t\f]+/u, "");
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const sourceLine = index + 1;
    const fragments: string[] = [];
    while (true) {
      let trailing = 0;
      for (let cursor = line.length - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1)
        trailing += 1;
      const continued = trailing % 2 === 1;
      fragments.push(continued ? line.slice(0, -1) : line);
      if (!continued || index + 1 >= lines.length) break;
      index += 1;
      line = (lines[index] ?? "").replace(/^[ \t\f]+/u, "");
    }
    const logicalLine = fragments.join("");
    let separator = 0;
    for (; separator < logicalLine.length; separator += 1) {
      if (logicalLine[separator] === "\\") separator += 1;
      else if (/[=: \t\f]/u.test(logicalLine[separator] ?? "")) break;
    }
    let valueStart = separator;
    while (/[ \t\f]/u.test(logicalLine[valueStart] ?? "")) valueStart += 1;
    if (logicalLine[valueStart] === "=" || logicalLine[valueStart] === ":") valueStart += 1;
    while (/[ \t\f]/u.test(logicalLine[valueStart] ?? "")) valueStart += 1;
    const key = decodePropertyEscapes(logicalLine.slice(0, separator));
    const value = decodePropertyEscapes(logicalLine.slice(valueStart));
    assertElementCapacity(elements, maxElements);
    elements.push({
      metadata: { format: "properties", propertyKey: key, propertyValue: value, sourceLine },
      sectionPath: [],
      text: `${key} = ${value}`,
      type: "paragraph",
    });
  }
  return elements;
}

function decodePropertyEscapes(value: string): string {
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      output.push(character ?? "");
      continue;
    }
    index += 1;
    const escaped = value[index];
    if (escaped === "u") {
      const hex = value.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/iu.test(hex))
        throw new TextDocumentInputError("Malformed properties Unicode escape");
      output.push(String.fromCharCode(Number.parseInt(hex, 16)));
      index += 4;
    } else {
      output.push(
        escaped === "t"
          ? "\t"
          : escaped === "n"
            ? "\n"
            : escaped === "r"
              ? "\r"
              : escaped === "f"
                ? "\f"
                : (escaped ?? ""),
      );
    }
  }
  const decoded = output.join("");
  for (let index = 0; index < decoded.length; index += 1) {
    const code = decoded.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = decoded.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff))
        throw new TextDocumentInputError("Malformed properties Unicode surrogate");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff)
      throw new TextDocumentInputError("Malformed properties Unicode surrogate");
  }
  return decoded;
}

export function vttElements(text: string, maxElements: number): Element[] {
  const normalized = text.replace(/\r\n|\r/gu, "\n");
  const blocks = normalized.split(/\n[ \t]*\n/u);
  const header = blocks.shift() ?? "";
  if (!/^WEBVTT(?:[ \t][^\n]*)?(?:\n[^\n]*)*$/u.test(header) || header.includes("-->")) {
    throw new TextDocumentInputError("WebVTT requires a valid WEBVTT header");
  }
  const elements: Element[] = [];
  for (const block of blocks) {
    if (!block.trim() || /^(?:NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/u.test(block))
      continue;
    const lines = block.split("\n");
    const identified = !lines[0]?.includes("-->");
    const cueId = identified ? lines.shift() : undefined;
    const timings = lines.shift() ?? "";
    const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/u.exec(timings);
    if (!match || lines.some((line) => line.includes("-->")))
      throw new TextDocumentInputError("Malformed WebVTT cue");
    const startTimeMs = vttTimestamp(match[1] ?? "");
    const endTimeMs = vttTimestamp(match[2] ?? "");
    if (endTimeMs <= startTimeMs)
      throw new TextDocumentInputError("WebVTT cue end must follow its start");
    const payload = lines.join("\n");
    const document = parseDocument(payload);
    const cueText = DomUtils.textContent(document).trim();
    assertElementCapacity(elements, maxElements);
    elements.push({
      metadata: {
        ...(cueId ? { cueId } : {}),
        cuePayload: payload,
        endTimeMs,
        format: "vtt",
        settings: match[3] ?? "",
        startTimeMs,
      },
      sectionPath: [],
      text: cueText,
      type: "paragraph",
    });
  }
  return elements;
}

function vttTimestamp(value: string): number {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/u.exec(value);
  if (!match) throw new TextDocumentInputError("Invalid WebVTT cue timestamp");
  const result =
    ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 +
    Number(match[4]);
  if (!Number.isSafeInteger(result))
    throw new TextDocumentInputError("WebVTT cue timestamp is too large");
  return result;
}

function assertElementCapacity(elements: readonly Element[], limit: number): void {
  if (elements.length >= limit)
    throw new TextDocumentInputError(`Text parser output exceeds maxElements=${limit}`);
}
