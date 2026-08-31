export type UnstructuredWorkloadKind = "heavy" | "rejected" | "standard";

export interface UnstructuredWorkloadClassification {
  readonly kind: UnstructuredWorkloadKind;
  readonly reason:
    | "archive-expansion-limit"
    | "archive-invalid"
    | "archive-structure"
    | "format-conflict"
    | "input-bytes"
    | "opaque-format"
    | "ordinary-document"
    | "pdf-format";
}

export interface UnstructuredWorkloadInput {
  readonly body: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
}

export interface KnownHeavyUnstructuredWorkloadInput {
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface KnownHeavyUnstructuredWorkloadClassification {
  readonly kind: "heavy";
  readonly reason: "format-conflict" | "input-bytes" | "opaque-format" | "pdf-format";
}

const heavyInputBytes = 8 * 1024 * 1024;
const heavyArchiveEntryCount = 512;
const heavyArchiveUncompressedBytes = 64 * 1024 * 1024;
const heavyArchiveMarkupBytes = 16 * 1024 * 1024;
const heavyPresentationSlideCount = 80;
const heavySpreadsheetSheetCount = 32;
const maxArchiveCentralDirectoryBytes = 4 * 1024 * 1024;
const maxArchiveEntryCount = 4_096;
const maxArchiveEntryNameBytes = 1_024;
const maxArchiveUncompressedBytes = 512 * 1024 * 1024;
const maxArchiveCompressionRatio = 200;
const zipEndOfCentralDirectoryMinimumBytes = 22;
const zipMaximumCommentBytes = 65_535;

type RemoteFormat =
  | "doc"
  | "docx"
  | "eml"
  | "epub"
  | "msg"
  | "odt"
  | "pdf"
  | "ppt"
  | "pptx"
  | "rtf"
  | "xls"
  | "xlsx"
  | "unknown";

interface ArchiveSignals {
  readonly entryCount: number;
  readonly highCompressionRatio: boolean;
  readonly markupBytes: number;
  readonly presentationSlideCount: number;
  readonly spreadsheetSheetCount: number;
  readonly totalUncompressedBytes: number;
}

type ArchiveInspection =
  | { readonly kind: "hazardous" }
  | { readonly kind: "invalid-or-unsupported" }
  | { readonly kind: "valid"; readonly signals: ArchiveSignals };

type ZipEndRecordSearch =
  | { readonly kind: "ambiguous" }
  | { readonly canonical: boolean; readonly kind: "found"; readonly offset: number }
  | { readonly kind: "missing" };

/**
 * Selects execution resource policy without changing parser output or provider request semantics.
 *
 * The classifier only inspects bytes already admitted by the parser. ZIP containers are evaluated
 * from their bounded central directory; their entries are never inflated here.
 */
export function classifyUnstructuredWorkload(
  input: UnstructuredWorkloadInput,
): UnstructuredWorkloadClassification {
  const formats = remoteFormats(input);
  const zipFormatClaimed = formats.some(isZipContainerFormat);
  // Search every remote body, not only metadata-declared ZIP formats. Self-extracting archives may
  // carry a legal preamble, while filename and MIME type are caller-controlled. The scan is always
  // bounded to the final classic-ZIP EOCD window and does not inflate any entries.
  const zipEndRecord = findZipEndOfCentralDirectory(input.body);
  const discoverableZip = hasZipContainerSignature(input.body) || zipEndRecord.kind !== "missing";
  let validArchiveInspected = false;

  // A ZIP signature is a stronger workload signal than caller-controlled metadata. Inspect every
  // apparent ZIP before choosing a gate so a mislabeled OOXML/ODF/EPUB body cannot bypass the
  // central-directory expansion limits.
  if (discoverableZip) {
    const archive = inspectZipCentralDirectory(input.body);
    if (archive.kind === "hazardous") {
      return { kind: "rejected", reason: "archive-expansion-limit" };
    }
    if (archive.kind === "invalid-or-unsupported") {
      // Preserve provider compatibility for repairable Office archives, but never let an archive
      // whose expansion cannot be proven bounded use the standard lane.
      return { kind: "heavy", reason: "archive-invalid" };
    }
    if (archiveSignalsAreHeavy(archive.signals)) {
      return { kind: "heavy", reason: "archive-structure" };
    }
    validArchiveInspected = archive.signals.entryCount > 0;
  }

  // PDF object streams can hide page-tree markers, so a bounded byte scan cannot reliably prove a
  // PDF is small. Preserve the established PDF gate/deadline for every PDF rather than allowing a
  // compact 200-page report to fall back to the ordinary ten-minute policy. Treat the bounded PDF
  // magic and either caller-provided format signal conservatively; neither MIME nor filename is a
  // trusted source on its own.
  if (hasPdfSignature(input.body)) {
    return { kind: "heavy", reason: "pdf-format" };
  }
  const knownHeavy = knownHeavyUnstructuredWorkload(formats, input.body.byteLength);
  if (knownHeavy) return { kind: "heavy", reason: knownHeavy };

  if (zipFormatClaimed && !validArchiveInspected) {
    return { kind: "heavy", reason: "archive-invalid" };
  }

  return { kind: "standard", reason: "ordinary-document" };
}

/**
 * Returns only workload decisions that can be made before loading source bytes. Callers may use
 * this to queue known-heavy work before acquiring a broader memory/materialization slot. Archive
 * structure and content signatures still require the full classifier above.
 */
export function classifyKnownHeavyUnstructuredWorkload(
  input: KnownHeavyUnstructuredWorkloadInput,
): KnownHeavyUnstructuredWorkloadClassification | null {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new Error("Unstructured workload sizeBytes must be a non-negative safe integer");
  }
  // The router always sends these filename extensions to Unstructured. MIME-only signals and
  // otherwise-large native inputs still need the already-loaded body classifier so this fast path
  // cannot unnecessarily serialize an 8--10 MiB Markdown/HTML/structured document that remains
  // on a native parser.
  const filenameFormat = remoteFormatFromFilename(input.filename);
  if (filenameFormat === "unknown") return null;
  const reason = knownHeavyUnstructuredWorkload(remoteFormats(input), input.sizeBytes);
  return reason ? { kind: "heavy", reason } : null;
}

function knownHeavyUnstructuredWorkload(
  formats: readonly Exclude<RemoteFormat, "unknown">[],
  sizeBytes: number,
): KnownHeavyUnstructuredWorkloadClassification["reason"] | null {
  if (formats.includes("pdf")) return "pdf-format";

  // Known but conflicting filename/MIME signals may indicate a renamed legacy/OOXML document.
  // Route it through the bounded heavy lane instead of trusting whichever user-controlled field
  // happened to be evaluated first.
  if (formats.length > 1) return "format-conflict";

  if (sizeBytes > heavyInputBytes) return "input-bytes";

  // Legacy compound binaries, RTF, and mail containers do not expose a bounded page/slide/sheet
  // directory that can prove a compact upload is cheap. Keep them in the isolated heavy lane even
  // when compressed bytes are small; otherwise a hundreds-page legacy document inherits the
  // ordinary ten-minute deadline solely because its binary representation is compact.
  if (formats.some((format) => opaqueRemoteFormats.has(format))) return "opaque-format";

  return null;
}

function remoteFormats(
  input: Pick<UnstructuredWorkloadInput, "filename" | "mimeType">,
): readonly Exclude<RemoteFormat, "unknown">[] {
  const mimeType = normalizedMimeType(input.mimeType);
  const mimeFormat = remoteFormatFromMimeType(mimeType);
  const filenameFormat = remoteFormatFromFilename(input.filename);
  const formats = new Set<Exclude<RemoteFormat, "unknown">>();
  if (mimeFormat !== "unknown") formats.add(mimeFormat);
  if (filenameFormat !== "unknown") formats.add(filenameFormat);
  return [...formats];
}

function remoteFormatFromFilename(filename: string): RemoteFormat {
  const match = /\.([^.]+)$/u.exec(filename.trim().toLowerCase());
  const extension = match?.[1] ?? "";
  return remoteFormatExtensions.has(extension)
    ? (extension as Exclude<RemoteFormat, "unknown">)
    : "unknown";
}

const remoteFormatExtensions = new Set([
  "doc",
  "docx",
  "eml",
  "epub",
  "msg",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "xls",
  "xlsx",
]);

const opaqueRemoteFormats = new Set<Exclude<RemoteFormat, "unknown">>([
  "doc",
  "eml",
  "msg",
  "ppt",
  "rtf",
  "xls",
]);

const zipContainerFormats = new Set<Exclude<RemoteFormat, "unknown">>([
  "docx",
  "epub",
  "odt",
  "pptx",
  "xlsx",
]);

function isZipContainerFormat(format: Exclude<RemoteFormat, "unknown">): boolean {
  return zipContainerFormats.has(format);
}

function remoteFormatFromMimeType(mimeType: string): RemoteFormat {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/msword") return "doc";
  if (mimeType.includes("wordprocessingml")) return "docx";
  if (mimeType === "application/vnd.ms-powerpoint") return "ppt";
  if (mimeType.includes("presentationml")) return "pptx";
  if (mimeType === "application/vnd.ms-excel") return "xls";
  if (mimeType.includes("spreadsheetml")) return "xlsx";
  if (mimeType === "application/vnd.oasis.opendocument.text") return "odt";
  if (mimeType === "application/rtf" || mimeType === "text/rtf") return "rtf";
  if (mimeType === "message/rfc822") return "eml";
  if (mimeType === "application/vnd.ms-outlook") return "msg";
  if (mimeType === "application/epub+zip") return "epub";
  return "unknown";
}

function normalizedMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function hasZipContainerSignature(body: Uint8Array): boolean {
  return (
    body.byteLength >= 4 &&
    body[0] === 0x50 &&
    body[1] === 0x4b &&
    ((body[2] === 0x03 && body[3] === 0x04) ||
      (body[2] === 0x05 && body[3] === 0x06) ||
      (body[2] === 0x07 && body[3] === 0x08))
  );
}

function hasPdfSignature(body: Uint8Array): boolean {
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
  const searchBytes = Math.min(body.byteLength, 1_024);
  for (let offset = 0; offset <= searchBytes - signature.length; offset += 1) {
    if (signature.every((byte, index) => body[offset + index] === byte)) return true;
  }
  return false;
}

function inspectZipCentralDirectory(body: Uint8Array): ArchiveInspection {
  const endRecord = findZipEndOfCentralDirectory(body);
  if (endRecord.kind === "missing") return { kind: "invalid-or-unsupported" };
  if (endRecord.kind === "ambiguous") return { kind: "hazardous" };
  const endOffset = endRecord.offset;

  const diskNumber = readUint16Le(body, endOffset + 4);
  const centralDirectoryDisk = readUint16Le(body, endOffset + 6);
  const entryCountOnDisk = readUint16Le(body, endOffset + 8);
  const entryCount = readUint16Le(body, endOffset + 10);
  const centralDirectoryBytes = readUint32Le(body, endOffset + 12);
  const centralDirectoryOffset = readUint32Le(body, endOffset + 16);
  if (
    diskNumber === null ||
    centralDirectoryDisk === null ||
    entryCountOnDisk === null ||
    entryCount === null ||
    centralDirectoryBytes === null ||
    centralDirectoryOffset === null
  ) {
    return { kind: "invalid-or-unsupported" };
  }

  // ZIP64 and multi-disk containers can conceal counts outside this bounded classic directory.
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entryCountOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralDirectoryBytes === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    entryCount > maxArchiveEntryCount ||
    centralDirectoryBytes > maxArchiveCentralDirectoryBytes
  ) {
    return { kind: "hazardous" };
  }

  // ZIP readers permit a prepended self-extracting stub. EOCD offsets remain relative to the
  // original ZIP payload, so derive the bounded prefix length from the physical EOCD position and
  // inspect the adjusted central directory instead of assuming offset zero.
  const relativeCentralDirectoryEnd = centralDirectoryOffset + centralDirectoryBytes;
  const archivePrefixBytes = endOffset - relativeCentralDirectoryEnd;
  const adjustedCentralDirectoryOffset = centralDirectoryOffset + archivePrefixBytes;
  const centralDirectoryEnd = adjustedCentralDirectoryOffset + centralDirectoryBytes;
  if (
    archivePrefixBytes < 0 ||
    !Number.isSafeInteger(adjustedCentralDirectoryOffset) ||
    !Number.isSafeInteger(centralDirectoryEnd) ||
    adjustedCentralDirectoryOffset > endOffset ||
    centralDirectoryEnd > endOffset
  ) {
    return { kind: "invalid-or-unsupported" };
  }
  if (centralDirectoryEnd !== endOffset) return { kind: "hazardous" };

  let cursor = adjustedCentralDirectoryOffset;
  let highCompressionRatio = false;
  let markupBytes = 0;
  let presentationSlideCount = 0;
  let spreadsheetSheetCount = 0;
  let totalUncompressedBytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: false });

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32Le(body, cursor) !== 0x02014b50 || cursor + 46 > centralDirectoryEnd) {
      return { kind: "invalid-or-unsupported" };
    }
    const compressedBytes = readUint32Le(body, cursor + 20);
    const uncompressedBytes = readUint32Le(body, cursor + 24);
    const nameBytes = readUint16Le(body, cursor + 28);
    const extraBytes = readUint16Le(body, cursor + 30);
    const commentBytes = readUint16Le(body, cursor + 32);
    if (
      compressedBytes === null ||
      uncompressedBytes === null ||
      nameBytes === null ||
      extraBytes === null ||
      commentBytes === null
    ) {
      return { kind: "invalid-or-unsupported" };
    }
    if (nameBytes > maxArchiveEntryNameBytes) return { kind: "hazardous" };

    const entryEnd = cursor + 46 + nameBytes + extraBytes + commentBytes;
    if (entryEnd > centralDirectoryEnd) return { kind: "invalid-or-unsupported" };

    totalUncompressedBytes += uncompressedBytes;
    const entryHasHighCompressionRatio =
      uncompressedBytes > 1024 * 1024 &&
      uncompressedBytes / Math.max(1, compressedBytes) > maxArchiveCompressionRatio;
    if (
      totalUncompressedBytes > maxArchiveUncompressedBytes ||
      (entryHasHighCompressionRatio && uncompressedBytes > heavyArchiveUncompressedBytes)
    ) {
      return { kind: "hazardous" };
    }
    highCompressionRatio ||= entryHasHighCompressionRatio;

    const entryName = decoder.decode(body.subarray(cursor + 46, cursor + 46 + nameBytes));
    const normalizedName = entryName.replaceAll("\\", "/").toLowerCase();
    if (/\.(?:htm|html|xhtml|xml)$/u.test(normalizedName)) {
      markupBytes += uncompressedBytes;
    }
    if (/^ppt\/slides\/slide\d+\.xml$/u.test(normalizedName)) {
      presentationSlideCount += 1;
    }
    if (/^xl\/worksheets\/sheet\d+\.xml$/u.test(normalizedName)) {
      spreadsheetSheetCount += 1;
    }
    cursor = entryEnd;
  }

  // Do not trust an EOCD entry count that leaves additional central records uninspected.
  if (cursor !== centralDirectoryEnd) return { kind: "hazardous" };
  // Common ZIP readers tolerate bytes after EOCD. We still inspect a non-canonical directory so
  // trailing garbage cannot hide a proven expansion hazard, but never grant that archive the
  // standard lane because its end record did not account for the complete body.
  if (!endRecord.canonical) return { kind: "invalid-or-unsupported" };
  return {
    kind: "valid",
    signals: {
      entryCount,
      highCompressionRatio,
      markupBytes,
      presentationSlideCount,
      spreadsheetSheetCount,
      totalUncompressedBytes,
    },
  };
}

function archiveSignalsAreHeavy(signals: ArchiveSignals): boolean {
  return (
    signals.entryCount > heavyArchiveEntryCount ||
    signals.highCompressionRatio ||
    signals.totalUncompressedBytes > heavyArchiveUncompressedBytes ||
    signals.markupBytes > heavyArchiveMarkupBytes ||
    signals.presentationSlideCount > heavyPresentationSlideCount ||
    signals.spreadsheetSheetCount > heavySpreadsheetSheetCount
  );
}

function findZipEndOfCentralDirectory(body: Uint8Array): ZipEndRecordSearch {
  if (body.byteLength < zipEndOfCentralDirectoryMinimumBytes) return { kind: "missing" };
  const minimumOffset = Math.max(
    0,
    body.byteLength - zipEndOfCentralDirectoryMinimumBytes - zipMaximumCommentBytes,
  );
  let found: { readonly canonical: boolean; readonly offset: number } | undefined;

  for (
    let offset = body.byteLength - zipEndOfCentralDirectoryMinimumBytes;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (readUint32Le(body, offset) !== 0x06054b50) continue;
    const commentBytes = readUint16Le(body, offset + 20);
    if (commentBytes === null) continue;
    const declaredEnd = offset + zipEndOfCentralDirectoryMinimumBytes + commentBytes;
    if (declaredEnd > body.byteLength) continue;
    if (found !== undefined) return { kind: "ambiguous" };
    found = { canonical: declaredEnd === body.byteLength, offset };
  }
  return found === undefined ? { kind: "missing" } : { kind: "found", ...found };
}

function readUint16Le(body: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > body.byteLength) return null;
  return (body[offset] as number) | ((body[offset + 1] as number) << 8);
}

function readUint32Le(body: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > body.byteLength) return null;
  return (
    ((body[offset] as number) |
      ((body[offset + 1] as number) << 8) |
      ((body[offset + 2] as number) << 16) |
      ((body[offset + 3] as number) << 24)) >>>
    0
  );
}
