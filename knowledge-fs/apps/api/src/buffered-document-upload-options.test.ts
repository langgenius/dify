import {
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES,
  bufferedDocumentUploadReservationBytes,
} from "@knowledge/api";
import { describe, expect, it } from "vitest";

import {
  createApiBufferedDocumentUploadAdmission,
  createApiBufferedDocumentUploadOptions,
} from "./buffered-document-upload-options";

describe("API buffered document upload options", () => {
  it("uses a safe default for the always-on legacy and capability multipart routes", () => {
    expect(createApiBufferedDocumentUploadOptions({})).toEqual({
      idleTimeoutMs: 30_000,
      maxConcurrency: 2,
      maxReservedBytes: DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES,
      totalTimeoutMs: 600_000,
    });
    expect(createApiBufferedDocumentUploadAdmission({})).toEqual(expect.any(Object));
  });

  it("parses explicit bounded process limits", () => {
    expect(
      createApiBufferedDocumentUploadOptions({
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS: "45000",
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY: "3",
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES: "201326592",
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS: "900000",
      }),
    ).toEqual({
      idleTimeoutMs: 45_000,
      maxConcurrency: 3,
      maxReservedBytes: 201_326_592,
      totalTimeoutMs: 900_000,
    });
  });

  it("rejects count, hard-cap, and route-envelope underconfiguration", () => {
    expect(() =>
      createApiBufferedDocumentUploadOptions({
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY: "0",
      }),
    ).toThrow("KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY");
    expect(() =>
      createApiBufferedDocumentUploadOptions({
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES: "1",
      }),
    ).toThrow(`must be at least ${bufferedDocumentUploadReservationBytes(50 * 1024 * 1024, 20)}`);
    expect(() =>
      createApiBufferedDocumentUploadOptions({
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES: String(Number.MAX_SAFE_INTEGER),
      }),
    ).toThrow("KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES");
    expect(() =>
      createApiBufferedDocumentUploadOptions({
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS: "30001",
        KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS: "30000",
      }),
    ).toThrow("TOTAL_TIMEOUT_MS must be at least");
  });
});
