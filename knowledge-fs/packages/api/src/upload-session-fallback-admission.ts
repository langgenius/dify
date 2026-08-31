import {
  type BufferedUploadAdmission,
  createBufferedUploadAdmission,
} from "./buffered-upload-admission";

export type SmallFileFallbackAdmission = BufferedUploadAdmission;

export interface SmallFileFallbackAdmissionOptions {
  readonly maxConcurrency: number;
  readonly maxReservedBytes: number;
}

export const DEFAULT_SMALL_FILE_FALLBACK_MAX_CONCURRENCY = 2;
export const DEFAULT_SMALL_FILE_FALLBACK_MAX_RESERVED_BYTES = 30 * 1024 * 1024;
export const HARD_SMALL_FILE_FALLBACK_MAX_RESERVED_BYTES = 100 * 1024 * 1024;

/**
 * Process-local FIFO admission for the compatibility upload path that must buffer the request.
 * A waiter owns neither a concurrency slot nor byte reservation until its work starts.
 */
export function createSmallFileFallbackAdmission({
  maxConcurrency,
  maxReservedBytes,
}: SmallFileFallbackAdmissionOptions): SmallFileFallbackAdmission {
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 8) {
    throw new Error("Small-file fallback maxConcurrency must be a safe integer between 1 and 8");
  }
  if (!Number.isSafeInteger(maxReservedBytes) || maxReservedBytes < 1) {
    throw new Error("Small-file fallback maxReservedBytes must be a positive safe integer");
  }
  if (maxReservedBytes > HARD_SMALL_FILE_FALLBACK_MAX_RESERVED_BYTES) {
    throw new Error(
      `Small-file fallback maxReservedBytes must not exceed ${HARD_SMALL_FILE_FALLBACK_MAX_RESERVED_BYTES}`,
    );
  }

  return createBufferedUploadAdmission({
    label: "Small-file fallback",
    maxConcurrency,
    maxReservedBytes,
  });
}
