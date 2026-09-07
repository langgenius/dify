import { Unzip, type UnzipFileInfo, UnzipInflate, unzipSync } from "fflate";
import { Parser } from "htmlparser2";

import { classifyUnstructuredWorkload } from "./unstructured-workload-policy";

export interface OfficeArchivePreflightInput {
  readonly body: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
  readonly signal?: AbortSignal;
}

export interface OfficeArchivePreflightLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxXmlBytes: number;
  readonly maxXmlEntryBytes: number;
  readonly maxXmlDepth: number;
  readonly maxXmlNodes: number;
  readonly maxSheetRows: number;
  readonly maxSheetColumns: number;
  readonly maxSheetCellSpan: number;
  readonly maxWorkbookCellSpan: number;
  readonly maxWorkbookCells: number;
  readonly maxSharedStrings: number;
  readonly maxWorksheets: number;
  readonly timeoutMs: number;
}

/**
 * The cell-span caps bound the *dense* Pandas/NetworkX work in the pinned provider. They are not
 * Excel format limits. A very sparse or unusually large valid workbook can intentionally fail
 * admission; no cells are silently discarded and the original document is never rewritten.
 */
export const defaultOfficeArchivePreflightLimits: OfficeArchivePreflightLimits = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 4096,
  maxXmlBytes: 64 * 1024 * 1024,
  maxXmlEntryBytes: 16 * 1024 * 1024,
  maxXmlDepth: 128,
  maxXmlNodes: 1_000_000,
  maxSheetRows: 100_000,
  maxSheetColumns: 16_384,
  maxSheetCellSpan: 250_000,
  maxWorkbookCellSpan: 500_000,
  maxWorkbookCells: 500_000,
  maxSharedStrings: 200_000,
  maxWorksheets: 256,
  timeoutMs: 30_000,
});

export class OfficeArchiveAdmissionError extends Error {
  readonly code = "office_archive_input";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OfficeArchiveAdmissionError";
  }
}

interface ArchiveBudget {
  bytes: number;
  cells: number;
  sharedStrings: number;
  workbookCellSpan: number;
  xmlBytes: number;
  xmlNodes: number;
  worksheets: number;
  readonly worksheetAreas: Map<string, number>;
  readonly worksheetReferences: { readonly source: string; readonly id: string }[];
  readonly worksheetRelationships: Map<string, Map<string, string>>;
}

const compressedChunkBytes = 1024;
const cooperativeYieldBytes = 64 * 1024;
const maxXmlAttributes = 128;
const maxXmlAttributeChars = 16 * 1024;

/**
 * Resource admission for OOXML/ODF/EPUB; not a document parser or a general-purpose ZIP validator.
 * The existing bounded classifier establishes a classic central-directory bound. fflate reads
 * that directory without inflating, then streams actual members in small compressed chunks.
 * Local names/sizes must match the directory and actual expansion is counted before XML parsing.
 * No expanded archive or XML DOM is retained, and no external entities/resources are loaded.
 */
export async function assertOfficeArchiveSafe(
  input: OfficeArchivePreflightInput,
  options: Partial<OfficeArchivePreflightLimits> = {},
): Promise<void> {
  const claimedOffice = claimsOfficeArchive(input);
  if (!claimedOffice && !hasZipSignature(input.body)) return;
  input.signal?.throwIfAborted();
  const limits = { ...defaultOfficeArchivePreflightLimits, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Office archive preflight ${name} must be a positive safe integer`);
    }
  }

  const start = Date.now();
  const assertActive = () => {
    input.signal?.throwIfAborted();
    if (Date.now() - start > limits.timeoutMs) {
      reject("Office archive inspection exceeded its bounded processing time");
    }
  };

  try {
    const classification = classifyUnstructuredWorkload(input);
    if (classification.kind === "rejected" || classification.reason === "archive-invalid") {
      // Non-Office archives retain their existing router policy. The outer classifier still
      // rejects proven ZIP expansion hazards, independently of this Office-specific check.
      if (!claimedOffice) return;
      reject("Office archive metadata is unsafe or cannot be inspected safely");
    }
    const directory = new Map<string, UnzipFileInfo>();
    unzipSync(input.body, {
      filter: (entry) => {
        if (directory.size >= limits.maxEntries) reject("Office archive has too many entries");
        if (directory.has(entry.name)) reject("Office archive contains duplicate entry names");
        directory.set(entry.name, entry);
        return false;
      },
    });
    if (!claimedOffice && ![...directory.keys()].some(isOfficePart)) return;
    if (directory.size === 0) reject("Office archive contains no inspectable entries");

    const normalizedNames = new Set<string>();
    for (const entry of directory.values()) {
      assertActive();
      const normalizedName = entry.name.toLowerCase();
      if (!safeArchivePath(entry.name) || normalizedNames.has(normalizedName)) {
        reject("Office archive contains ambiguous or unsafe entry names");
      }
      normalizedNames.add(normalizedName);
      if (entry.compression !== 0 && entry.compression !== 8) {
        reject("Office archive compression is unsupported for safe inspection");
      }
      if (entry.originalSize > limits.maxArchiveBytes)
        reject("Office archive expansion is too large");
      if (isXmlPart(entry.name) && entry.originalSize > limits.maxXmlEntryBytes) {
        reject("Office XML part exceeds the inspection byte limit");
      }
    }

    const budget: ArchiveBudget = {
      bytes: 0,
      cells: 0,
      sharedStrings: 0,
      workbookCellSpan: 0,
      xmlBytes: 0,
      xmlNodes: 0,
      worksheets: 0,
      worksheetAreas: new Map(),
      worksheetReferences: [],
      worksheetRelationships: new Map(),
    };
    const observed = new Set<string>();
    const completed = new Set<string>();
    const unzip = new Unzip((file) => {
      assertActive();
      const expected = directory.get(file.name);
      if (
        !expected ||
        observed.has(file.name) ||
        file.compression !== expected.compression ||
        (file.size !== undefined && file.size !== expected.size) ||
        (file.originalSize !== undefined && file.originalSize !== expected.originalSize)
      ) {
        reject("Office archive local entries disagree with its central directory");
      }
      observed.add(file.name);
      let entryBytes = 0;
      // OPC relationships may target XML parts without a conventional path or extension. Sniff
      // each member's prefix while streaming; never let a renamed worksheet bypass cell budgets.
      const xml = createXmlInspector(file.name, limits, budget);
      file.ondata = (error, chunk, final) => {
        assertActive();
        if (error) throw error;
        entryBytes += chunk.byteLength;
        budget.bytes += chunk.byteLength;
        if (entryBytes > expected.originalSize || budget.bytes > limits.maxArchiveBytes) {
          reject("Office archive actual expansion exceeds its declared size or byte limit");
        }
        xml.push(chunk, final);
        if (final) {
          if (entryBytes !== expected.originalSize) {
            reject("Office archive actual entry size disagrees with its central directory");
          }
          completed.add(file.name);
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    let lastYieldAt = start;
    for (let offset = 0; offset < input.body.byteLength; offset += compressedChunkBytes) {
      assertActive();
      const end = Math.min(input.body.byteLength, offset + compressedChunkBytes);
      unzip.push(input.body.subarray(offset, end), end === input.body.byteLength);
      if (end % cooperativeYieldBytes === 0 || Date.now() - lastYieldAt >= 8) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldAt = Date.now();
      }
    }
    assertActive();
    if (observed.size !== directory.size || completed.size !== directory.size) {
      reject("Office archive has incomplete or inconsistent local entries");
    }
    let referencedCellSpan = 0;
    for (const reference of budget.worksheetReferences) {
      const target = budget.worksheetRelationships.get(reference.source)?.get(reference.id);
      const area = target === undefined ? undefined : budget.worksheetAreas.get(target);
      if (area === undefined)
        reject("Spreadsheet worksheet relationship is missing or unsupported");
      referencedCellSpan += area;
      if (referencedCellSpan > limits.maxWorkbookCellSpan) {
        reject(
          "Spreadsheet workbook exceeds the safe dense-cell budget through worksheet references",
        );
      }
    }
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason;
    if (error instanceof OfficeArchiveAdmissionError) throw error;
    throw new OfficeArchiveAdmissionError(
      "Office archive is invalid or cannot be inspected safely",
      {
        cause: error,
      },
    );
  }
}

function claimsOfficeArchive(input: OfficeArchivePreflightInput): boolean {
  const filename = input.filename.trim().toLowerCase();
  const mime = input.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    /\.(?:docx|pptx|xlsx|odt|epub)$/u.test(filename) ||
    /(?:wordprocessingml|presentationml|spreadsheetml)/u.test(mime) ||
    mime === "application/vnd.oasis.opendocument.text" ||
    mime === "application/epub+zip"
  );
}

function hasZipSignature(body: Uint8Array): boolean {
  return body[0] === 0x50 && body[1] === 0x4b;
}

function isOfficePart(name: string): boolean {
  return /^(?:word\/document\.xml|ppt\/presentation\.xml|xl\/workbook\.xml|xl\/worksheets\/[^/]+\.xml|meta-inf\/container\.xml|content\.xml)$/iu.test(
    name,
  );
}

function isXmlPart(name: string): boolean {
  return /\.(?:xml|rels|opf|ncx|xhtml)$/iu.test(name);
}

function safeArchivePath(name: string): boolean {
  return (
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !name.split("/").some((part) => part === ".." || part === ".")
  );
}

function reject(message: string): never {
  throw new OfficeArchiveAdmissionError(message);
}

function localXmlName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1);
}

function isAllowedHtmlDoctype(path: string, declaration: string): boolean {
  if (!/\.(?:xhtml|html|htm)$/iu.test(path)) return false;
  if (/^!DOCTYPE\s+html\s*$/iu.test(declaration)) return true;
  // EPUB 2 uses these standard XHTML declarations. They identify vocabulary only: this SAX
  // inspector never resolves DTDs, and EPUB chapter content is passed to Pandoc's HTML reader.
  // Full matching deliberately excludes internal subsets, entities, and custom external DTDs.
  const match = /^!DOCTYPE\s+html\s+PUBLIC\s+(["'])([^"']+)\1\s+(["'])([^"']+)\3\s*$/iu.exec(
    declaration,
  );
  if (!match) return false;
  const standardDtds: Readonly<Record<string, string>> = {
    "-//W3C//DTD XHTML 1.0 Strict//EN": "www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd",
    "-//W3C//DTD XHTML 1.0 Transitional//EN": "www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd",
    "-//W3C//DTD XHTML 1.0 Frameset//EN": "www.w3.org/TR/xhtml1/DTD/xhtml1-frameset.dtd",
    "-//W3C//DTD XHTML 1.1//EN": "www.w3.org/TR/xhtml11/DTD/xhtml11.dtd",
  };
  const expected = standardDtds[match[2] ?? ""];
  return (
    expected !== undefined &&
    /^https?:\/\//u.test(match[4] ?? "") &&
    match[4]?.replace(/^https?:\/\//u, "") === expected
  );
}

function createXmlInspector(
  path: string,
  limits: OfficeArchivePreflightLimits,
  budget: ArchiveBudget,
): { push(chunk: Uint8Array, final: boolean): void } {
  let worksheet = /^xl\/worksheets\/[^/]+\.xml$/iu.test(path);
  let sharedStrings = /^xl\/sharedstrings\.xml$/iu.test(path);
  let workbook = false;
  const relationshipSource = sourcePartForRelationshipFile(path);
  let activeXml = isXmlPart(path);
  let ignoredBinary = false;
  let memberBytes = 0;
  let countedXmlBytes = 0;
  let decoder: TextDecoder | undefined;
  let pendingPrefix = new Uint8Array(0);
  let depth = 0;
  let roots = 0;
  let attributeCount = 0;
  let lastOpenEndIndex = -1;
  let row = 0;
  let column = 0;
  let maxRow = 0;
  let maxColumn = 0;
  let inRow = false;

  const useCoordinate = (nextRow: number, nextColumn: number) => {
    maxRow = Math.max(maxRow, nextRow);
    maxColumn = Math.max(maxColumn, nextColumn);
    if (
      maxRow > limits.maxSheetRows ||
      maxColumn > limits.maxSheetColumns ||
      maxRow * maxColumn > limits.maxSheetCellSpan
    ) {
      reject("Spreadsheet worksheet dimensions exceed the safe dense-cell budget");
    }
  };
  const useRange = (value: string) => {
    const parts = value.split(":");
    if (parts.length > 2) reject("Spreadsheet contains an invalid cell range");
    for (const part of parts) {
      const coordinate = cellCoordinate(part);
      useCoordinate(coordinate.row, coordinate.column);
    }
  };

  const parser = new Parser(
    {
      onopentagname() {
        depth += 1;
        if (depth === 1) roots += 1;
        budget.xmlNodes += 1;
        attributeCount = 0;
        if (depth > limits.maxXmlDepth || budget.xmlNodes > limits.maxXmlNodes || roots > 1) {
          reject("Office XML exceeds its structural complexity budget");
        }
      },
      onattribute(_name, value) {
        attributeCount += 1;
        if (attributeCount > maxXmlAttributes || value.length > maxXmlAttributeChars) {
          reject("Office XML attributes exceed their inspection budget");
        }
      },
      onprocessinginstruction(name, data) {
        if (name.startsWith("!") && !isAllowedHtmlDoctype(path, data)) {
          reject("Office XML declarations and external entities are not allowed");
        }
        if (name === "?xml") {
          const encoding = /\bencoding\s*=\s*["']([^"']+)["']/iu.exec(data)?.[1];
          if (encoding && !/^(?:utf-?8|utf-?16(?:le|be)?)$/iu.test(encoding)) {
            reject("Office XML encoding is unsupported for safe inspection");
          }
        }
      },
      onopentag(name, attributes) {
        lastOpenEndIndex = parser.endIndex;
        const tag = localXmlName(name);
        if (depth === 1) {
          worksheet ||= tag === "worksheet";
          sharedStrings ||= tag === "sst";
          workbook = tag === "workbook";
        }
        if (workbook && tag === "sheet") {
          budget.worksheets += 1;
          if (budget.worksheets > limits.maxWorksheets)
            reject("Spreadsheet has too many worksheets");
          const ids = Object.entries(attributes).filter(([key]) => localXmlName(key) === "id");
          if (ids.length > 1) reject("Spreadsheet worksheet references are ambiguous");
          const id = ids[0]?.[1];
          if (id) budget.worksheetReferences.push({ id, source: path });
        }
        if (
          relationshipSource !== undefined &&
          tag === "Relationship" &&
          attributes.Type?.endsWith("/relationships/worksheet")
        ) {
          const id = attributes.Id;
          const target = attributes.Target;
          if (!id || !target || attributes.TargetMode?.toLowerCase() === "external") {
            reject("Spreadsheet worksheet relationship is missing or external");
          }
          const resolved = resolveInternalPartTarget(relationshipSource, target);
          const relations =
            budget.worksheetRelationships.get(relationshipSource) ?? new Map<string, string>();
          if (relations.has(id) || relations.size >= limits.maxWorksheets) {
            reject("Spreadsheet worksheet relationships are ambiguous or excessive");
          }
          relations.set(id, resolved);
          budget.worksheetRelationships.set(relationshipSource, relations);
        }
        if (sharedStrings && tag === "si") {
          budget.sharedStrings += 1;
          if (budget.sharedStrings > limits.maxSharedStrings) {
            reject("Spreadsheet shared strings exceed the safe item budget");
          }
        }
        if (!worksheet) return;
        if ((tag === "dimension" || tag === "mergeCell") && attributes.ref !== undefined) {
          useRange(attributes.ref);
        } else if (tag === "row") {
          if (inRow) reject("Spreadsheet contains nested rows");
          const nextRow = attributes.r === undefined ? row + 1 : positiveXmlInteger(attributes.r);
          if (nextRow <= row) reject("Spreadsheet row coordinates must be strictly increasing");
          row = nextRow;
          inRow = true;
          column = 0;
          useCoordinate(row, 0);
        } else if (tag === "c") {
          if (!inRow) reject("Spreadsheet contains a cell outside a row");
          budget.cells += 1;
          if (budget.cells > limits.maxWorkbookCells) reject("Spreadsheet has too many cells");
          if (attributes.r === undefined) {
            column += 1;
          } else {
            const coordinate = cellCoordinate(attributes.r);
            if (coordinate.row !== row) reject("Spreadsheet cell and row coordinates disagree");
            if (coordinate.column <= column)
              reject("Spreadsheet cell coordinates must be strictly increasing");
            column = coordinate.column;
          }
          useCoordinate(row, column);
        } else if (tag === "col") {
          // Column formatting does not make otherwise empty columns part of Pandas' data frame.
          // Validate its indices without increasing the occupied rectangular cell span.
          for (const value of [attributes.min, attributes.max]) {
            if (value !== undefined && positiveXmlInteger(value) > limits.maxSheetColumns) {
              reject("Spreadsheet column formatting exceeds the safe column budget");
            }
          }
        }
      },
      onclosetag(name, implied) {
        if (implied && parser.endIndex !== lastOpenEndIndex) {
          reject("Office XML contains unbalanced elements");
        }
        if (worksheet && localXmlName(name) === "row") inRow = false;
        depth -= 1;
      },
    },
    { decodeEntities: true, xmlMode: true },
  );

  return {
    push(chunk, final) {
      if (ignoredBinary) return;
      memberBytes += chunk.byteLength;
      let bytes = chunk;
      if (!decoder) {
        if (pendingPrefix.byteLength > 0) {
          bytes = new Uint8Array(pendingPrefix.byteLength + chunk.byteLength);
          bytes.set(pendingPrefix);
          bytes.set(chunk, pendingPrefix.byteLength);
        }
        if (bytes.byteLength < 4 && !final) {
          pendingPrefix = bytes.slice();
          return;
        }
        pendingPrefix = new Uint8Array(0);
        if (!activeXml && !couldBeXmlPrefix(bytes)) {
          ignoredBinary = true;
          return;
        }
        const encoding =
          (bytes[0] === 0xff && bytes[1] === 0xfe) || (isAsciiXmlPrefix(bytes[0]) && bytes[1] === 0)
            ? "utf-16le"
            : (bytes[0] === 0xfe && bytes[1] === 0xff) ||
                (bytes[0] === 0 && isAsciiXmlPrefix(bytes[1]))
              ? "utf-16be"
              : "utf-8";
        decoder = new TextDecoder(encoding, { fatal: true });
      }
      let text: string;
      try {
        text = decoder.decode(bytes, { stream: !final });
      } catch (error) {
        if (activeXml) throw error;
        ignoredBinary = true;
        return;
      }
      if (!activeXml) {
        text = text.replace(/^[\t\r\n ]+/u, "");
        if (!text) return;
        if (!text.startsWith("<")) {
          ignoredBinary = true;
          return;
        }
        activeXml = true;
      }
      budget.xmlBytes += memberBytes - countedXmlBytes;
      countedXmlBytes = memberBytes;
      if (memberBytes > limits.maxXmlEntryBytes || budget.xmlBytes > limits.maxXmlBytes) {
        reject("Office XML expansion exceeds the inspection byte limit");
      }
      if (text.includes("\0"))
        reject("Office XML contains an unsupported encoding or NUL character");
      parser.write(text);
      if (final) {
        if (depth !== 0 || roots !== 1)
          reject("Office XML is incomplete or has no document element");
        parser.end();
        if (worksheet) {
          budget.worksheetAreas.set(path, maxRow * maxColumn);
          budget.workbookCellSpan += maxRow * maxColumn;
          if (budget.workbookCellSpan > limits.maxWorkbookCellSpan) {
            reject("Spreadsheet workbook exceeds the safe dense-cell budget");
          }
        }
      }
    },
  };
}

function couldBeXmlPrefix(bytes: Uint8Array): boolean {
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    (bytes[0] === 0 && isAsciiXmlPrefix(bytes[1])) ||
    (isAsciiXmlPrefix(bytes[0]) && bytes[1] === 0)
  )
    return true;
  for (const byte of bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    return byte === 0x3c;
  }
  return bytes.byteLength > 0;
}

function isAsciiXmlPrefix(byte: number | undefined): boolean {
  return byte === 0x3c || byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function sourcePartForRelationshipFile(path: string): string | undefined {
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/u.exec(path);
  return match ? `${match[1] ?? ""}${match[2]}` : undefined;
}

function resolveInternalPartTarget(source: string, target: string): string {
  if (!target || /[\\\0?#]/u.test(target) || /^[a-z][a-z0-9+.-]*:/iu.test(target))
    reject("Spreadsheet worksheet target is not a safe internal part");
  const segments = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) reject("Spreadsheet worksheet target escapes the archive");
      segments.pop();
    } else segments.push(segment);
  }
  const resolved = segments.join("/");
  if (!resolved) reject("Spreadsheet worksheet target is empty");
  return resolved;
}

function positiveXmlInteger(value: string): number {
  if (!/^\d+$/u.test(value)) reject("Spreadsheet contains an invalid positive coordinate");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    reject("Spreadsheet contains an invalid positive coordinate");
  }
  return parsed;
}

function cellCoordinate(value: string): { row: number; column: number } {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/u.exec(value);
  if (!match) reject("Spreadsheet contains an invalid cell coordinate");
  let column = 0;
  for (const letter of match[1] as string) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column, row: positiveXmlInteger(match[2] as string) };
}
