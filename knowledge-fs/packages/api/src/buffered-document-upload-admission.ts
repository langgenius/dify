import {
  type BufferedUploadAdmission,
  createBufferedUploadAdmission,
} from "./buffered-upload-admission";
import { HARD_BULK_DOCUMENT_UPLOAD_MAX_BYTES } from "./document-upload-utils";

export type BufferedDocumentUploadAdmission = BufferedUploadAdmission;

export interface BufferedDocumentUploadAdmissionOptions {
  readonly maxConcurrency: number;
  readonly maxReservedBytes: number;
}

export const DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY = 2;
export const DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES = 192 * 1024 * 1024;
export const HARD_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES =
  3 * (HARD_BULK_DOCUMENT_UPLOAD_MAX_BYTES + 4 * 1024 * 1024);

export function createBufferedDocumentUploadAdmission({
  maxConcurrency,
  maxReservedBytes,
}: BufferedDocumentUploadAdmissionOptions): BufferedDocumentUploadAdmission {
  if (maxReservedBytes > HARD_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES) {
    throw new Error(
      `Buffered document upload maxReservedBytes must not exceed ${HARD_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES}`,
    );
  }
  return createBufferedUploadAdmission({
    label: "Buffered document upload",
    maxConcurrency,
    maxReservedBytes,
  });
}
