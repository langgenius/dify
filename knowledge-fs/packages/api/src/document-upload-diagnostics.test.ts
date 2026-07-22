import { describe, expect, it, vi } from "vitest";

import {
  documentUploadDiagnosticEvent,
  logDocumentUploadDiagnostic,
} from "./document-upload-diagnostics";

describe("document upload diagnostics", () => {
  it("creates bounded diagnostic events without document body content", () => {
    const error = Object.assign(new Error(`bad\n${"x".repeat(600)}`), {
      code: "provider_request_failed",
      status: 502,
    });

    const event = documentUploadDiagnosticEvent({
      asset: {
        filename: "report.pdf",
        id: "asset-1",
        mimeType: "application/pdf",
        sizeBytes: 1234,
        version: 2,
      },
      error,
      knowledgeSpaceId: "space-1",
      stage: "upload",
      traceId: "trace-1",
    });

    expect(event).toMatchObject({
      assetId: "asset-1",
      errorClass: "Error",
      errorCode: "provider_request_failed",
      filename: "report.pdf",
      knowledgeSpaceId: "space-1",
      mimeType: "application/pdf",
      parserStatus: "failed",
      providerStatus: 502,
      sizeBytes: 1234,
      stage: "upload",
      traceId: "trace-1",
      version: 2,
    });
    expect(event.errorMessage).not.toContain("\n");
    expect(event.errorMessage.length).toBeLessThanOrEqual(503);
  });

  it("logs the same bounded diagnostic event", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      logDocumentUploadDiagnostic({
        error: new TypeError("parser exploded"),
        knowledgeSpaceId: "space-1",
        stage: "compilation",
      });

      expect(errorSpy).toHaveBeenCalledWith(
        "Document parsing failed",
        expect.objectContaining({
          errorClass: "TypeError",
          errorMessage: "parser exploded",
          knowledgeSpaceId: "space-1",
          parserStatus: "failed",
          stage: "compilation",
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
