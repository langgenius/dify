import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ParseDocumentInput, ProviderInputError } from "@knowledge/parsers";

const RASTER_DPI = 350;
const MAX_PAGE_PIXELS = 25_000_000;
const MAX_PAGE_EDGE_PIXELS = 10_000;
const MAX_PAGES = 10_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

interface PdfinfoExecutionInput {
  readonly path: string;
  readonly signal?: AbortSignal;
}

interface PdfParserPreflightOptions {
  /** Substitute only the bounded subprocess boundary; useful for deterministic geometry tests. */
  readonly executePdfinfo?: (input: PdfinfoExecutionInput) => Promise<string>;
  readonly maxOutputBytes?: number;
  readonly pdfinfoExecutable?: string;
  readonly temporaryDirectory?: string;
  readonly timeoutMs?: number;
}

export interface PdfParserPreflight {
  readonly policyFingerprint: string;
  check(input: ParseDocumentInput): Promise<void>;
}

/**
 * Metadata-only admission prevents huge pages from reaching rasterization. Poppler resolves
 * inherited boxes without decoding page images. The provider's own pre-render pixel guard is
 * still required: PDF engines can disagree on malformed objects and features such as UserUnit.
 */
export function createPdfParserPreflight(
  options: PdfParserPreflightOptions = {},
): PdfParserPreflight {
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  const maxOutputBytes = positiveInteger(
    options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    "maxOutputBytes",
  );
  const executePdfinfo =
    options.executePdfinfo ??
    ((input: PdfinfoExecutionInput) =>
      runPdfinfo(input, {
        executable: options.pdfinfoExecutable ?? "pdfinfo",
        maxOutputBytes,
        timeoutMs,
      }));

  return {
    policyFingerprint: `pdf-raster-preflight-v1:dpi=${RASTER_DPI}:pixels=${MAX_PAGE_PIXELS}:edge=${MAX_PAGE_EDGE_PIXELS}:pages=${MAX_PAGES}`,
    async check(input) {
      if (!isPdf(input)) {
        return;
      }
      input.signal?.throwIfAborted();
      const directory = await mkdtemp(
        join(options.temporaryDirectory ?? tmpdir(), "knowledge-fs-pdf-"),
      );
      try {
        input.signal?.throwIfAborted();
        const path = join(directory, "input.pdf");
        await writeFile(path, input.body, {
          flag: "wx",
          mode: 0o600,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        input.signal?.throwIfAborted();
        const output = await executePdfinfo({
          path,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        input.signal?.throwIfAborted();
        assertSafeGeometry(output);
      } catch (error) {
        if (input.signal?.aborted) {
          throw input.signal.reason;
        }
        throw error;
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  };
}

function isPdf(input: ParseDocumentInput): boolean {
  return (
    input.mimeType.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf" ||
    input.filename.toLowerCase().endsWith(".pdf") ||
    Buffer.from(
      input.body.buffer,
      input.body.byteOffset,
      Math.min(input.body.byteLength, 1024),
    ).indexOf("%PDF-") !== -1
  );
}

function runPdfinfo(
  input: PdfinfoExecutionInput,
  options: {
    readonly executable: string;
    readonly maxOutputBytes: number;
    readonly timeoutMs: number;
  },
): Promise<string> {
  input.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile(
      options.executable,
      ["-f", "1", "-l", String(MAX_PAGES + 1), "-box", input.path],
      {
        encoding: "utf8",
        env: { ...process.env, LANG: "C", LC_ALL: "C" },
        killSignal: "SIGKILL",
        maxBuffer: options.maxOutputBytes,
        timeout: options.timeoutMs,
      },
      (error, stdout) => {
        input.signal?.removeEventListener("abort", cancel);
        if (input.signal?.aborted) {
          reject(input.signal.reason);
        } else if (error?.code === "ENOENT") {
          reject(
            new Error("PDF safety inspection requires the pdfinfo executable (poppler-utils)."),
          );
        } else if (error) {
          // stderr can contain document content; do not include it in errors or their causes.
          reject(
            new ProviderInputError(
              "Unable to safely inspect PDF page geometry within the inspection limits.",
            ),
          );
        } else {
          resolve(stdout);
        }
      },
    );
    // Wait for the execFile callback after termination so temporary input is not removed while
    // a child still uses it, and callers never continue while abandoned work is still running.
    const cancel = () => child.kill("SIGKILL");
    input.signal?.addEventListener("abort", cancel, { once: true });
    if (input.signal?.aborted) {
      cancel();
    }
  });
}

type PageGeometry = Map<"size" | "MediaBox" | "CropBox", readonly [number, number]>;

function assertSafeGeometry(output: string): void {
  const pageCounts = [...output.matchAll(/^Pages:\s*(.*?)\s*$/gm)];
  const rawPageCount = pageCounts[0]?.[1] ?? "";
  if (pageCounts.length !== 1 || !/^\d+$/.test(rawPageCount)) {
    throw invalidGeometry();
  }
  const pageCount = Number(rawPageCount);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
    throw new ProviderInputError(
      `PDF safety inspection supports between 1 and ${MAX_PAGES} pages.`,
    );
  }
  const pages = new Map<number, PageGeometry>();
  for (const match of output.matchAll(/^Page\s+(\d+)\s+(size|MediaBox|CropBox):\s*(.*?)\s*$/gm)) {
    const pageNumber = Number(match[1]);
    const kind = match[2] as "size" | "MediaBox" | "CropBox";
    const value = match[3] ?? "";
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw invalidGeometry();
    }
    const page = pages.get(pageNumber) ?? new Map();
    if (page.has(kind)) {
      throw invalidGeometry();
    }
    const dimensions = kind === "size" ? parsePageSize(value) : parseBox(value);
    page.set(kind, dimensions);
    pages.set(pageNumber, page);
  }
  if (pages.size !== pageCount) {
    throw invalidGeometry();
  }
  for (const [pageNumber, geometry] of pages) {
    if (geometry.size !== 3) {
      throw invalidGeometry();
    }
    for (const [width, height] of geometry.values()) {
      const rasterWidth = Math.ceil((width / 72) * RASTER_DPI);
      const rasterHeight = Math.ceil((height / 72) * RASTER_DPI);
      if (
        rasterWidth > MAX_PAGE_EDGE_PIXELS ||
        rasterHeight > MAX_PAGE_EDGE_PIXELS ||
        rasterWidth * rasterHeight > MAX_PAGE_PIXELS
      ) {
        throw new ProviderInputError(
          `PDF page ${pageNumber} exceeds the safe rasterization budget (${MAX_PAGE_PIXELS} pixels per page, ${MAX_PAGE_EDGE_PIXELS} pixels per edge at ${RASTER_DPI} DPI). Resize the page before importing.`,
        );
      }
    }
  }
}

function parsePageSize(value: string): readonly [number, number] {
  const match = /^(\S+)\s+x\s+(\S+)\s+pts(?:\s+\([^\r\n]*\))?$/.exec(value);
  if (!match) {
    throw invalidGeometry();
  }
  return positiveDimensions(finiteNumber(match[1] ?? ""), finiteNumber(match[2] ?? ""));
}

function parseBox(value: string): readonly [number, number] {
  const coordinates = value.trim().split(/\s+/);
  if (coordinates.length !== 4) {
    throw invalidGeometry();
  }
  const [left = 0, bottom = 0, right = 0, top = 0] = coordinates.map(finiteNumber);
  return positiveDimensions(right - left, top - bottom);
}

function finiteNumber(value: string): number {
  const number = Number(value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(number)) {
    throw invalidGeometry();
  }
  return number;
}

function positiveDimensions(width: number, height: number): readonly [number, number] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw invalidGeometry();
  }
  return [width, height];
}

function invalidGeometry(): ProviderInputError {
  return new ProviderInputError(
    "Unable to safely inspect PDF: page geometry is incomplete or invalid.",
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PDF preflight ${name} must be a positive safe integer.`);
  }
  return value;
}
