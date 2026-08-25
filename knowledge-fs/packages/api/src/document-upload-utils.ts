export interface ParsedDocumentUpload {
  readonly body: Uint8Array;
  readonly documentId?: string;
  readonly expectedActiveRevision?: number | null;
  readonly expectedDocumentRowVersion?: number;
  readonly file: File;
  readonly mimeType: string;
  readonly sourceId?: string;
}

export interface ParsedBulkDocumentUpload extends Omit<ParsedDocumentUpload, "sourceId"> {
  readonly sha256: string;
}

export interface BulkDocumentRevisionTarget {
  /** Zero-based index in the original multipart `files` sequence. */
  readonly index: number;
  readonly documentId: string;
  readonly expectedActiveRevision: number | null;
  readonly expectedDocumentRowVersion: number;
}

const DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION = {
  csv: ["text/csv", "application/vnd.ms-excel"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  eml: ["message/rfc822"],
  epub: ["application/epub+zip"],
  htm: ["text/html"],
  html: ["text/html"],
  json: ["application/json"],
  jsonl: ["application/x-ndjson", "application/jsonl", "application/ndjson", "application/json"],
  markdown: ["text/markdown", "text/x-markdown", "text/plain"],
  md: ["text/markdown", "text/x-markdown", "text/plain"],
  mdx: ["text/mdx", "text/markdown", "text/plain"],
  msg: ["application/vnd.ms-outlook", "application/x-msg"],
  odt: ["application/vnd.oasis.opendocument.text"],
  pdf: ["application/pdf"],
  ppt: ["application/vnd.ms-powerpoint", "application/mspowerpoint", "application/x-mspowerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  properties: ["text/x-java-properties", "text/plain"],
  rtf: ["application/rtf", "text/rtf", "application/x-rtf"],
  text: ["text/plain"],
  txt: ["text/plain"],
  vtt: ["text/vtt", "text/plain"],
  xls: [
    "application/vnd.ms-excel",
    "application/excel",
    "application/x-excel",
    "application/x-msexcel",
  ],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xml: ["application/xml", "text/xml"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export const SUPPORTED_DOCUMENT_UPLOAD_MIME_TYPES = new Set(
  Object.values(DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION).flat(),
);

export const DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_FILES = 20;
export const HARD_DOCUMENT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const HARD_BULK_DOCUMENT_UPLOAD_MAX_FILES = 25;
export const HARD_BULK_DOCUMENT_UPLOAD_MAX_BYTES =
  HARD_DOCUMENT_UPLOAD_MAX_BYTES * HARD_BULK_DOCUMENT_UPLOAD_MAX_FILES;

export const SUPPORTED_DOCUMENT_UPLOAD_EXTENSIONS = new Set(
  Object.keys(DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION),
);

export type DocumentUploadExclusionReason =
  | "batch_byte_limit_exceeded"
  | "file_count_limit_exceeded"
  | "file_too_large"
  | "document_not_found"
  | "invalid_file"
  | "invalid_target"
  | "processing_failed"
  | "quota_exceeded"
  | "revision_conflict"
  | "unsupported_mime_type";

export interface BulkDocumentUploadAdmissionItem {
  readonly filename: string;
  readonly index: number;
  readonly mimeType: string;
  readonly reason?: DocumentUploadExclusionReason | undefined;
  readonly sizeBytes: number;
  readonly status: "accepted" | "excluded";
  readonly upload?: ParsedBulkDocumentUpload | undefined;
}

export interface BulkDocumentUploadAdmissionResult {
  readonly accepted: readonly BulkDocumentUploadAdmissionItem[];
  readonly excluded: readonly BulkDocumentUploadAdmissionItem[];
  readonly items: readonly BulkDocumentUploadAdmissionItem[];
}

export class DocumentUploadValidationError extends Error {}

export class DocumentUploadTooLargeError extends Error {
  constructor(maxUploadBytes: number) {
    super(`Document upload exceeds maxUploadBytes=${maxUploadBytes}`);
  }
}

export class BulkDocumentUploadTooLargeError extends Error {
  constructor(maxBulkUploadBytes: number) {
    super(`Bulk document upload exceeds maxBulkUploadBytes=${maxBulkUploadBytes}`);
  }
}

export class BulkDocumentUploadValidationError extends Error {}

export async function readDocumentUpload(
  request: { parseBody(): Promise<Record<string, unknown>> },
  maxUploadBytes: number,
): Promise<ParsedDocumentUpload> {
  let body: Record<string, unknown>;

  try {
    body = await request.parseBody();
    /* v8 ignore next 3 -- Hono's route validator rejects malformed multipart before this helper. */
  } catch {
    throw new DocumentUploadValidationError("Document upload requires multipart/form-data");
  }

  const file = body.file;

  if (!(file instanceof File)) {
    throw new DocumentUploadValidationError("Document upload file is required");
  }

  if (file.size > maxUploadBytes) {
    throw new DocumentUploadTooLargeError(maxUploadBytes);
  }
  const mimeType = normalizeDocumentMimeType(file);
  if (!isSupportedDocumentUpload(file, mimeType)) {
    throw new DocumentUploadValidationError("Document upload file type is not supported");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  /* v8 ignore next 3 -- File.size is checked before buffering; this is a defensive runtime guard. */
  if (bytes.byteLength > maxUploadBytes) {
    throw new DocumentUploadTooLargeError(maxUploadBytes);
  }

  const sourceIdValue = body.sourceId;
  const sourceId =
    typeof sourceIdValue === "string" && sourceIdValue.length > 0 ? sourceIdValue : undefined;
  const documentIdValue = body.documentId;
  const documentId =
    typeof documentIdValue === "string" && documentIdValue.length > 0 ? documentIdValue : undefined;
  const expectedActiveRevision = optionalMultipartInteger(
    body.expectedActiveRevision,
    "expectedActiveRevision",
    true,
  );
  const expectedDocumentRowVersion = optionalMultipartInteger(
    body.expectedDocumentRowVersion,
    "expectedDocumentRowVersion",
    false,
  );
  if (
    documentId === undefined &&
    (expectedActiveRevision !== undefined || expectedDocumentRowVersion !== undefined)
  ) {
    throw new DocumentUploadValidationError("Document revision upload CAS requires documentId");
  }
  if (
    documentId !== undefined &&
    (expectedActiveRevision === undefined || expectedDocumentRowVersion === undefined)
  ) {
    throw new DocumentUploadValidationError(
      "Document revision upload requires expectedActiveRevision and expectedDocumentRowVersion",
    );
  }

  return {
    body: bytes,
    ...(documentId ? { documentId } : {}),
    ...(expectedActiveRevision !== undefined ? { expectedActiveRevision } : {}),
    ...(expectedDocumentRowVersion !== undefined ? { expectedDocumentRowVersion } : {}),
    file,
    mimeType,
    ...(sourceId ? { sourceId } : {}),
  };
}

function optionalMultipartInteger(
  value: unknown,
  label: string,
  nullable: true,
): number | null | undefined;
function optionalMultipartInteger(
  value: unknown,
  label: string,
  nullable: false,
): number | undefined;
function optionalMultipartInteger(
  value: unknown,
  label: string,
  nullable: boolean,
): number | null | undefined {
  if (value === undefined || value === "") return undefined;
  if (nullable && (value === "null" || value === null)) return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  const minimum = nullable ? 1 : 0;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new DocumentUploadValidationError(
      `${label} must be ${nullable ? "a positive integer or null" : "a non-negative integer"}`,
    );
  }
  return parsed;
}

export async function readBulkDocumentUpload(
  request: { parseBody(options?: { readonly all?: boolean }): Promise<Record<string, unknown>> },
  maxUploadBytes: number,
  maxBulkUploadFiles: number,
  maxBulkUploadBytes: number,
): Promise<ParsedBulkDocumentUpload[]> {
  let body: Record<string, unknown>;

  try {
    body = await request.parseBody({ all: true });
    /* v8 ignore next 3 -- Hono's route validator rejects malformed multipart before this helper. */
  } catch {
    throw new BulkDocumentUploadValidationError(
      "Bulk document upload requires multipart/form-data",
    );
  }

  const rawFiles = body.files;
  const files = Array.isArray(rawFiles) ? rawFiles : rawFiles instanceof File ? [rawFiles] : [];

  if (files.length === 0) {
    throw new BulkDocumentUploadValidationError("Bulk document upload requires at least one file");
  }

  if (files.length > maxBulkUploadFiles) {
    throw new BulkDocumentUploadValidationError(
      `Bulk document upload maxBulkUploadFiles=${maxBulkUploadFiles} exceeded`,
    );
  }

  const targets = readBulkDocumentRevisionTargets(body, files);

  const uploads: ParsedBulkDocumentUpload[] = [];
  let totalBytes = 0;

  for (const [index, file] of files.entries()) {
    /* v8 ignore next 3 -- route validation and File checks reject non-file multipart entries. */
    if (!(file instanceof File)) {
      throw new BulkDocumentUploadValidationError("Bulk document upload files must be files");
    }

    if (file.size > maxUploadBytes) {
      throw new DocumentUploadTooLargeError(maxUploadBytes);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    /* v8 ignore next 3 -- File.size is checked before buffering; this is a defensive runtime guard. */
    if (bytes.byteLength > maxUploadBytes) {
      throw new DocumentUploadTooLargeError(maxUploadBytes);
    }

    totalBytes += bytes.byteLength;

    if (totalBytes > maxBulkUploadBytes) {
      throw new BulkDocumentUploadTooLargeError(maxBulkUploadBytes);
    }

    uploads.push(
      withBulkDocumentRevisionTarget(
        {
          body: bytes,
          file,
          mimeType: file.type || "application/octet-stream",
          sha256: await sha256Hex(bytes),
        },
        targets.get(index),
      ),
    );
  }

  return uploads;
}

/**
 * Product-level per-file admission. Invalid members are reported, never thrown as a batch error;
 * only a malformed multipart body or a body containing no entries is a request-level failure.
 */
export async function readBulkDocumentUploadWithAdmission(
  request: { parseBody(options?: { readonly all?: boolean }): Promise<Record<string, unknown>> },
  options: {
    readonly maxAcceptedBytesByQuota: number | null;
    readonly maxBulkUploadBytes: number;
    readonly maxBulkUploadFiles: number;
    readonly maxUploadBytes: number;
    readonly supportedMimeTypes?: ReadonlySet<string> | undefined;
  },
): Promise<BulkDocumentUploadAdmissionResult> {
  let body: Record<string, unknown>;
  try {
    body = await request.parseBody({ all: true });
  } catch {
    throw new BulkDocumentUploadValidationError(
      "Bulk document upload requires multipart/form-data",
    );
  }
  const rawFiles = body.files;
  const entries = Array.isArray(rawFiles) ? rawFiles : rawFiles === undefined ? [] : [rawFiles];
  if (entries.length === 0) {
    throw new BulkDocumentUploadValidationError("Bulk document upload requires at least one file");
  }
  const targets = readBulkDocumentRevisionTargets(body, entries);
  const supported = options.supportedMimeTypes ?? SUPPORTED_DOCUMENT_UPLOAD_MIME_TYPES;
  const items: BulkDocumentUploadAdmissionItem[] = [];
  let acceptedBytes = 0;
  let acceptedCount = 0;

  for (const [index, entry] of entries.entries()) {
    if (!(entry instanceof File)) {
      items.push({
        filename: `entry-${index + 1}`,
        index,
        mimeType: "application/octet-stream",
        reason: "invalid_file",
        sizeBytes: 0,
        status: "excluded",
      });
      continue;
    }
    const mimeType = normalizeDocumentMimeType(entry);
    const base = {
      filename: entry.name,
      index,
      mimeType,
      sizeBytes: entry.size,
    };
    const exclusion =
      acceptedCount >= options.maxBulkUploadFiles
        ? "file_count_limit_exceeded"
        : !supported.has(mimeType) || !isSupportedDocumentUpload(entry, mimeType)
          ? "unsupported_mime_type"
          : entry.size > options.maxUploadBytes
            ? "file_too_large"
            : acceptedBytes > options.maxBulkUploadBytes - entry.size
              ? "batch_byte_limit_exceeded"
              : options.maxAcceptedBytesByQuota !== null &&
                  acceptedBytes > options.maxAcceptedBytesByQuota - entry.size
                ? "quota_exceeded"
                : undefined;
    if (exclusion) {
      items.push({ ...base, reason: exclusion, status: "excluded" });
      continue;
    }
    const bytes = new Uint8Array(await entry.arrayBuffer());
    // File.size is checked before buffering; preserve a defensive post-read check for adapters
    // whose File implementation reports an inconsistent size.
    if (bytes.byteLength > options.maxUploadBytes) {
      items.push({ ...base, reason: "file_too_large", status: "excluded" });
      continue;
    }
    const upload = withBulkDocumentRevisionTarget(
      {
        body: bytes,
        file: entry,
        mimeType,
        sha256: await sha256Hex(bytes),
      },
      targets.get(index),
    );
    acceptedBytes += bytes.byteLength;
    acceptedCount += 1;
    items.push({ ...base, sizeBytes: bytes.byteLength, status: "accepted", upload });
  }

  return {
    accepted: items.filter((item) => item.status === "accepted"),
    excluded: items.filter((item) => item.status === "excluded"),
    items,
  };
}

const BULK_TARGET_FIELDS = new Set([
  "documentId",
  "expectedActiveRevision",
  "expectedDocumentRowVersion",
  "index",
]);
const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Bulk revision grouping is explicit and index based. A missing `targets` field means every file
 * creates a new logical document; filenames are deliberately never used as a merge key.
 */
function readBulkDocumentRevisionTargets(
  body: Readonly<Record<string, unknown>>,
  entries: readonly unknown[],
): ReadonlyMap<number, BulkDocumentRevisionTarget> {
  if (
    body.documentId !== undefined ||
    body.expectedActiveRevision !== undefined ||
    body.expectedDocumentRowVersion !== undefined
  ) {
    throw new BulkDocumentUploadValidationError(
      "Bulk document revision uploads require per-file targets; top-level document CAS is ambiguous",
    );
  }

  if (body.targets === undefined) return new Map();
  if (Array.isArray(body.targets)) {
    throw new BulkDocumentUploadValidationError(
      "Bulk document upload targets must be provided exactly once",
    );
  }
  if (typeof body.targets !== "string" || body.targets.length === 0) {
    throw new BulkDocumentUploadValidationError(
      "Bulk document upload targets must be a JSON array",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.targets);
  } catch {
    throw new BulkDocumentUploadValidationError("Bulk document upload targets must be valid JSON");
  }
  if (!Array.isArray(decoded)) {
    throw new BulkDocumentUploadValidationError(
      "Bulk document upload targets must be a JSON array",
    );
  }

  const targets = new Map<number, BulkDocumentRevisionTarget>();
  const targetedDocumentIds = new Set<string>();
  for (const [ordinal, value] of decoded.entries()) {
    if (!isJsonObject(value)) {
      throw invalidBulkTarget(ordinal, "must be an object");
    }
    const unknownField = Object.keys(value).find((field) => !BULK_TARGET_FIELDS.has(field));
    if (unknownField) {
      throw invalidBulkTarget(ordinal, `contains unsupported field ${unknownField}`);
    }
    if (
      !("index" in value) ||
      !("documentId" in value) ||
      !("expectedActiveRevision" in value) ||
      !("expectedDocumentRowVersion" in value)
    ) {
      throw invalidBulkTarget(
        ordinal,
        "requires index, documentId, expectedActiveRevision, and expectedDocumentRowVersion",
      );
    }
    if (typeof value.index !== "number" || !Number.isSafeInteger(value.index) || value.index < 0) {
      throw invalidBulkTarget(ordinal, "index must be a non-negative integer");
    }
    const index = value.index;
    if (index >= entries.length) {
      throw invalidBulkTarget(ordinal, `index ${index} is outside the files sequence`);
    }
    if (!(entries[index] instanceof File)) {
      throw invalidBulkTarget(ordinal, `index ${index} does not reference a file`);
    }
    if (targets.has(index)) {
      throw new BulkDocumentUploadValidationError(
        `Bulk document upload targets contain duplicate index ${index}`,
      );
    }
    if (typeof value.documentId !== "string" || !DOCUMENT_ID_PATTERN.test(value.documentId)) {
      throw invalidBulkTarget(ordinal, "documentId must be a UUID");
    }
    const normalizedDocumentId = value.documentId.toLocaleLowerCase();
    if (targetedDocumentIds.has(normalizedDocumentId)) {
      throw new BulkDocumentUploadValidationError(
        `Bulk document upload targets contain duplicate documentId ${value.documentId}`,
      );
    }
    const expectedActiveRevision = value.expectedActiveRevision;
    if (
      expectedActiveRevision !== null &&
      (typeof expectedActiveRevision !== "number" ||
        !Number.isSafeInteger(expectedActiveRevision) ||
        expectedActiveRevision < 1)
    ) {
      throw invalidBulkTarget(ordinal, "expectedActiveRevision must be a positive integer or null");
    }
    const expectedDocumentRowVersion = value.expectedDocumentRowVersion;
    if (
      typeof expectedDocumentRowVersion !== "number" ||
      !Number.isSafeInteger(expectedDocumentRowVersion) ||
      expectedDocumentRowVersion < 0
    ) {
      throw invalidBulkTarget(ordinal, "expectedDocumentRowVersion must be a non-negative integer");
    }

    const target: BulkDocumentRevisionTarget = {
      documentId: value.documentId,
      expectedActiveRevision,
      expectedDocumentRowVersion,
      index,
    };
    targets.set(index, target);
    targetedDocumentIds.add(normalizedDocumentId);
  }
  return targets;
}

function withBulkDocumentRevisionTarget(
  upload: ParsedBulkDocumentUpload,
  target: BulkDocumentRevisionTarget | undefined,
): ParsedBulkDocumentUpload {
  return target
    ? {
        ...upload,
        documentId: target.documentId,
        expectedActiveRevision: target.expectedActiveRevision,
        expectedDocumentRowVersion: target.expectedDocumentRowVersion,
      }
    : upload;
}

function invalidBulkTarget(ordinal: number, message: string): BulkDocumentUploadValidationError {
  return new BulkDocumentUploadValidationError(
    `Bulk document upload target at position ${ordinal} ${message}`,
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeDocumentMimeType(file: File): string {
  const declared = file.type.trim().toLocaleLowerCase();
  const extension = documentExtension(file.name);
  const inferred = extension
    ? (DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION as Readonly<Record<string, readonly string[]>>)[
        extension
      ]?.[0]
    : undefined;
  return !declared || declared === "application/octet-stream"
    ? (inferred ?? "application/octet-stream")
    : declared;
}

function isSupportedDocumentUpload(file: File, mimeType: string): boolean {
  const extension = documentExtension(file.name);
  if (extension === undefined) return false;
  const allowedMimeTypes = (
    DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION as Readonly<Record<string, readonly string[]>>
  )[extension];
  return allowedMimeTypes?.includes(mimeType) === true;
}

function documentExtension(filename: string): string | undefined {
  const normalized = filename.trim().toLocaleLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot >= 0 && dot < normalized.length - 1 ? normalized.slice(dot + 1) : undefined;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createDocumentAssetStatusUrl({
  documentAssetId,
  knowledgeSpaceId,
}: {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
}): string {
  return `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentAssetId}`;
}

export function createLogicalDocumentTaskStatusUrl({
  documentId,
  knowledgeSpaceId,
  taskId,
}: {
  readonly documentId: string;
  readonly knowledgeSpaceId: string;
  readonly taskId: string;
}): string {
  return `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}`;
}
