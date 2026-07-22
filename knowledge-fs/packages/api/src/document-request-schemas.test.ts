import { describe, expect, it } from "vitest";

import {
  BulkDocumentDeleteBodySchema,
  BulkDocumentReindexBodySchema,
  BulkDocumentUploadBodySchema,
  BulkDocumentUploadParamsSchema,
  DocumentAssetParamsSchema,
  DocumentCompilationJobParamsSchema,
  DocumentUploadBodySchema,
  DocumentUploadParamsSchema,
  ParseArtifactParamsSchema,
} from "./document-request-schemas";

const SPACE_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";

describe("document-request-schemas", () => {
  it("validates document upload, asset, artifact, and compilation params", () => {
    expect(DocumentUploadParamsSchema.parse({ id: SPACE_ID })).toEqual({ id: SPACE_ID });
    expect(BulkDocumentUploadParamsSchema.parse({ id: SPACE_ID })).toEqual({ id: SPACE_ID });
    expect(DocumentAssetParamsSchema.parse({ documentId: DOCUMENT_ID, id: SPACE_ID })).toEqual({
      documentId: DOCUMENT_ID,
      id: SPACE_ID,
    });
    expect(
      ParseArtifactParamsSchema.parse({ documentId: DOCUMENT_ID, id: SPACE_ID, version: "2" }),
    ).toEqual({
      documentId: DOCUMENT_ID,
      id: SPACE_ID,
      version: 2,
    });
    expect(DocumentCompilationJobParamsSchema.parse({ id: "job-1" })).toEqual({ id: "job-1" });
  });

  it("validates upload and bulk operation request bodies", () => {
    const file = new File(["hello"], "hello.md", { type: "text/markdown" });

    expect(DocumentUploadBodySchema.parse({ file, sourceId: DOCUMENT_ID })).toMatchObject({
      sourceId: DOCUMENT_ID,
    });
    expect(BulkDocumentUploadBodySchema.parse({ files: [file] })).toEqual({ files: [file] });
    expect(BulkDocumentDeleteBodySchema.parse({ documentIds: [DOCUMENT_ID] })).toEqual({
      documentIds: [DOCUMENT_ID],
    });
    expect(BulkDocumentReindexBodySchema.parse({ all: true })).toEqual({ all: true });
    expect(BulkDocumentReindexBodySchema.parse({ documentIds: [DOCUMENT_ID] })).toEqual({
      documentIds: [DOCUMENT_ID],
    });
  });

  it("rejects empty bulk delete bodies and invalid artifact versions", () => {
    expect(() => BulkDocumentDeleteBodySchema.parse({ documentIds: [] })).toThrow();
    expect(() =>
      ParseArtifactParamsSchema.parse({ documentId: DOCUMENT_ID, id: SPACE_ID, version: "0" }),
    ).toThrow();
  });
});
