import type { DocumentAsset } from "@knowledge/core";

export interface DocumentUploadDiagnosticInput {
  readonly asset?: Pick<DocumentAsset, "filename" | "id" | "mimeType" | "sizeBytes" | "version">;
  readonly error: unknown;
  readonly knowledgeSpaceId: string;
  readonly stage: "compilation" | "upload";
  readonly traceId?: string | undefined;
}

export interface DocumentUploadDiagnosticEvent {
  readonly assetId?: string | undefined;
  readonly errorClass: string;
  readonly errorCode?: string | undefined;
  readonly errorMessage: string;
  readonly filename?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly mimeType?: string | undefined;
  readonly parserStatus: "failed";
  readonly providerStatus?: number | undefined;
  readonly sizeBytes?: number | undefined;
  readonly stage: "compilation" | "upload";
  readonly traceId?: string | undefined;
  readonly version?: number | undefined;
}

const maxDiagnosticMessageLength = 500;

export function documentUploadDiagnosticEvent({
  asset,
  error,
  knowledgeSpaceId,
  stage,
  traceId,
}: DocumentUploadDiagnosticInput): DocumentUploadDiagnosticEvent {
  const record = isRecord(error) ? error : {};
  const message = error instanceof Error ? error.message : String(error);
  const status = record.status;
  const code = record.code;

  return {
    ...(asset ? { assetId: asset.id } : {}),
    errorClass: error instanceof Error && error.name ? error.name : typeof error,
    ...(typeof code === "string" && code.trim() ? { errorCode: boundMessage(code) } : {}),
    errorMessage: boundMessage(message),
    ...(asset ? { filename: asset.filename } : {}),
    knowledgeSpaceId,
    ...(asset ? { mimeType: asset.mimeType } : {}),
    parserStatus: "failed",
    ...(typeof status === "number" && Number.isFinite(status) ? { providerStatus: status } : {}),
    ...(asset ? { sizeBytes: asset.sizeBytes, version: asset.version } : {}),
    stage,
    ...(traceId ? { traceId } : {}),
  };
}

export function logDocumentUploadDiagnostic(input: DocumentUploadDiagnosticInput): void {
  console.error("Document parsing failed", documentUploadDiagnosticEvent(input));
}

function boundMessage(value: string): string {
  const normalized = [...value]
    .map((char) => {
      const codePoint = char.codePointAt(0) ?? 0;

      return codePoint < 32 || codePoint === 127 ? " " : char;
    })
    .join("")
    .trim();

  return normalized.length > maxDiagnosticMessageLength
    ? `${normalized.slice(0, maxDiagnosticMessageLength)}...`
    : normalized;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === "object";
}
