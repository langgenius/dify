import { Buffer } from "node:buffer";

import {
  ParserResourceLimitError,
  assertJsonDepth,
  assertParserResourceBudget,
  parserResourceLimits,
} from "./parser-resource-budget";

class DocumentJsonNumber {
  constructor(readonly source: string) {}
}

export function parseDocumentJson(text: string): unknown {
  assertJsonDepth(text);
  // Node 22 (the deployed runtime) supplies the original primitive token. Native JSON.parse
  // also defines __proto__ as ordinary own data, unlike assignment-based JSON decoders.
  const value: unknown = JSON.parse(
    text,
    (_key, current: unknown, context?: { source?: string }) => {
      if (typeof current !== "number") return current;
      if (context?.source === undefined)
        throw new Error("Document JSON parsing requires Node.js 22 or newer");
      return new DocumentJsonNumber(context.source);
    },
  );
  assertParserResourceBudget(value);
  return value;
}

export function isDocumentRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof DocumentJsonNumber)
  );
}

export function documentJsonRootType(value: unknown): string {
  return value instanceof DocumentJsonNumber
    ? "number"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}

/**
 * Only actual numeric wrappers are special, never user-controlled isLosslessNumber/toJSON keys.
 * Bounded depth plus a single output sink avoids quadratic pretty-printing intermediates.
 */
export function stringifyDocumentJson(value: unknown, pretty = false): string {
  assertParserResourceBudget(value);
  const chunks: string[] = [];
  let bytes = 0;
  const append = (text: string) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > parserResourceLimits.maxOutputBytes)
      throw new ParserResourceLimitError("structured output bytes");
    chunks.push(text);
  };
  const visit = (current: unknown, depth: number): void => {
    if (current instanceof DocumentJsonNumber) {
      append(current.source);
      return;
    }
    if (current !== null && typeof current === "object") {
      const array = Array.isArray(current);
      const keys = Object.keys(current);
      append(array ? "[" : "{");
      for (const [index, key] of keys.entries()) {
        if (index > 0) append(",");
        if (pretty) append(`\n${"  ".repeat(depth + 1)}`);
        if (!array) append(JSON.stringify(key) + (pretty ? ": " : ":"));
        visit((current as Record<string, unknown>)[key], depth + 1);
      }
      if (pretty && keys.length > 0) append(`\n${"  ".repeat(depth)}`);
      append(array ? "]" : "}");
    } else {
      append(typeof current === "bigint" ? String(current) : (JSON.stringify(current) ?? "null"));
    }
  };
  visit(value, 0);
  return chunks.join("");
}
