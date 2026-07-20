import { describe, expect, it } from "vitest";

import {
  BulkDocumentUploadTooLargeError,
  BulkDocumentUploadValidationError,
  DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_BYTES,
  DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_FILES,
  DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
  DocumentUploadTooLargeError,
  DocumentUploadValidationError,
  HARD_BULK_DOCUMENT_UPLOAD_MAX_BYTES,
  HARD_BULK_DOCUMENT_UPLOAD_MAX_FILES,
  HARD_DOCUMENT_UPLOAD_MAX_BYTES,
  createDocumentAssetStatusUrl,
  createLogicalDocumentTaskStatusUrl,
  readBulkDocumentUpload,
  readBulkDocumentUploadWithAdmission,
  readDocumentUpload,
  sha256Hex,
} from "./document-upload-utils";

describe("document upload utilities", () => {
  it("reads a single multipart file with bounded bytes and optional source id", async () => {
    const file = new File(["hello"], "note.md", { type: "text/markdown" });

    const upload = await readDocumentUpload(
      {
        parseBody: async () => ({ file, sourceId: "source-1" }),
      },
      10,
    );

    expect(upload.file).toBe(file);
    expect(upload.mimeType).toBe("text/markdown");
    expect(upload.sourceId).toBe("source-1");
    expect(new TextDecoder().decode(upload.body)).toBe("hello");
  });

  it("rejects malformed or oversized single uploads", async () => {
    await expect(readDocumentUpload({ parseBody: async () => ({}) }, 10)).rejects.toThrow(
      DocumentUploadValidationError,
    );

    await expect(
      readDocumentUpload(
        {
          parseBody: async () => ({ file: new File(["too large"], "large.txt") }),
        },
        3,
      ),
    ).rejects.toThrow(DocumentUploadTooLargeError);
  });

  it("requires the complete explicit CAS tuple for a single-file revision upload", async () => {
    const file = new File(["revision"], "revision.md", { type: "text/markdown" });
    const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
    await expect(
      readDocumentUpload(
        {
          parseBody: async () => ({
            documentId,
            expectedActiveRevision: "2",
            expectedDocumentRowVersion: "3",
            file,
          }),
        },
        20,
      ),
    ).resolves.toMatchObject({
      documentId,
      expectedActiveRevision: 2,
      expectedDocumentRowVersion: 3,
    });

    await expect(
      readDocumentUpload(
        { parseBody: async () => ({ documentId, expectedActiveRevision: "2", file }) },
        20,
      ),
    ).rejects.toThrow(
      "Document revision upload requires expectedActiveRevision and expectedDocumentRowVersion",
    );
  });

  it("reads bulk uploads, computes hashes, and enforces aggregate limits", async () => {
    const first = new File(["a"], "a.txt", { type: "text/plain" });
    const second = new File(["bc"], "b.txt", { type: "text/plain" });

    const uploads = await readBulkDocumentUpload(
      { parseBody: async () => ({ files: [first, second] }) },
      10,
      2,
      3,
    );

    expect(uploads.map((upload) => upload.sha256)).toEqual([
      await sha256Hex(new TextEncoder().encode("a")),
      await sha256Hex(new TextEncoder().encode("bc")),
    ]);

    await expect(
      readBulkDocumentUpload({ parseBody: async () => ({ files: [first, second] }) }, 10, 2, 2),
    ).rejects.toThrow(BulkDocumentUploadTooLargeError);
  });

  it("rejects malformed bulk uploads and builds document status urls", async () => {
    await expect(
      readBulkDocumentUpload({ parseBody: async () => ({ files: [] }) }, 10, 2, 10),
    ).rejects.toThrow(BulkDocumentUploadValidationError);

    expect(
      createDocumentAssetStatusUrl({
        documentAssetId: "doc-1",
        knowledgeSpaceId: "space-1",
      }),
    ).toBe("/knowledge-spaces/space-1/documents/doc-1");
    expect(
      createLogicalDocumentTaskStatusUrl({
        documentId: "logical-1",
        knowledgeSpaceId: "space-1",
        taskId: "task-1",
      }),
    ).toBe("/knowledge-spaces/space-1/documents/logical-1/processing-tasks/task-1");
  });

  it("keeps product defaults below the explicit hard upload boundaries", () => {
    expect(DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES).toBe(15 * 1024 * 1024);
    expect(DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_FILES).toBe(20);
    expect(HARD_DOCUMENT_UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(HARD_BULK_DOCUMENT_UPLOAD_MAX_FILES).toBe(25);
    expect(HARD_BULK_DOCUMENT_UPLOAD_MAX_BYTES).toBe(
      HARD_DOCUMENT_UPLOAD_MAX_BYTES * HARD_BULK_DOCUMENT_UPLOAD_MAX_FILES,
    );
  });

  it("admits valid files independently from malformed, unsupported, and over-limit entries", async () => {
    const result = await readBulkDocumentUploadWithAdmission(
      {
        parseBody: async () => ({
          files: [
            new File(["good"], "good.md", { type: "text/markdown" }),
            "not-a-file",
            new File(["bad"], "bad.exe", { type: "application/octet-stream" }),
            new File(["large"], "large.txt", { type: "text/plain" }),
          ],
        }),
      },
      {
        maxAcceptedBytesByQuota: null,
        maxBulkUploadBytes: 100,
        maxBulkUploadFiles: 20,
        maxUploadBytes: 4,
      },
    );

    expect(result.accepted.map((item) => item.filename)).toEqual(["good.md"]);
    expect(result.items.map((item) => item.status)).toEqual([
      "accepted",
      "excluded",
      "excluded",
      "excluded",
    ]);
    expect(result.excluded.map((item) => item.reason)).toEqual([
      "invalid_file",
      "unsupported_mime_type",
      "file_too_large",
    ]);
  });

  it("maps bulk revision targets only by original file index and carries the complete CAS tuple", async () => {
    const first = new File(["new"], "same-name.md", { type: "text/markdown" });
    const second = new File(["revision"], "same-name.md", { type: "text/markdown" });
    const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
    const result = await readBulkDocumentUploadWithAdmission(
      {
        parseBody: async () => ({
          files: [first, second],
          targets: JSON.stringify([
            {
              documentId,
              expectedActiveRevision: 4,
              expectedDocumentRowVersion: 5,
              index: 1,
            },
          ]),
        }),
      },
      {
        maxAcceptedBytesByQuota: null,
        maxBulkUploadBytes: 100,
        maxBulkUploadFiles: 20,
        maxUploadBytes: 100,
      },
    );

    expect(result.accepted[0]?.upload).not.toHaveProperty("documentId");
    expect(result.accepted[1]?.upload).toMatchObject({
      documentId,
      expectedActiveRevision: 4,
      expectedDocumentRowVersion: 5,
    });
  });

  it("rejects duplicate, ambiguous, incomplete, and out-of-range bulk revision targets", async () => {
    const files = [
      new File(["one"], "one.md", { type: "text/markdown" }),
      new File(["two"], "two.md", { type: "text/markdown" }),
    ];
    const firstDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
    const secondDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
    const target = {
      documentId: firstDocumentId,
      expectedActiveRevision: 1,
      expectedDocumentRowVersion: 1,
      index: 0,
    };
    const invalidBodies: ReadonlyArray<{
      readonly body: Record<string, unknown>;
      readonly message: string;
    }> = [
      {
        body: {
          files,
          targets: JSON.stringify([target, { ...target, documentId: secondDocumentId }]),
        },
        message: "duplicate index 0",
      },
      {
        body: { files, targets: JSON.stringify([target, { ...target, index: 1 }]) },
        message: `duplicate documentId ${firstDocumentId}`,
      },
      {
        body: { files, targets: JSON.stringify([{ ...target, index: 2 }]) },
        message: "index 2 is outside the files sequence",
      },
      {
        body: {
          files,
          targets: JSON.stringify([
            { documentId: firstDocumentId, expectedActiveRevision: 1, index: 0 },
          ]),
        },
        message:
          "requires index, documentId, expectedActiveRevision, and expectedDocumentRowVersion",
      },
      {
        body: {
          documentId: firstDocumentId,
          expectedActiveRevision: "1",
          expectedDocumentRowVersion: "1",
          files,
          targets: JSON.stringify([target]),
        },
        message: "top-level document CAS is ambiguous",
      },
      {
        body: { files, targets: [JSON.stringify([target]), JSON.stringify([target])] },
        message: "targets must be provided exactly once",
      },
    ];

    for (const invalid of invalidBodies) {
      await expect(
        readBulkDocumentUploadWithAdmission(
          { parseBody: async () => invalid.body },
          {
            maxAcceptedBytesByQuota: null,
            maxBulkUploadBytes: 100,
            maxBulkUploadFiles: 20,
            maxUploadBytes: 100,
          },
        ),
      ).rejects.toThrow(invalid.message);
    }
  });

  it("accepts JSONL MIME aliases and extension inference", async () => {
    for (const type of [
      "application/x-ndjson",
      "application/jsonl",
      "application/ndjson",
      "application/octet-stream",
    ]) {
      const result = await readBulkDocumentUploadWithAdmission(
        {
          parseBody: async () => ({
            files: [new File(['{"id":1}\n'], "events.jsonl", { type })],
          }),
        },
        {
          maxAcceptedBytesByQuota: null,
          maxBulkUploadBytes: 100,
          maxBulkUploadFiles: 20,
          maxUploadBytes: 100,
        },
      );
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]?.mimeType).toBe(
        type === "application/octet-stream" ? "application/x-ndjson" : type,
      );
    }
  });

  it("reports quota, aggregate-byte, and count exclusions without discarding earlier files", async () => {
    const files = [
      new File(["aa"], "a.txt", { type: "text/plain" }),
      new File(["bb"], "b.txt", { type: "text/plain" }),
      new File(["cc"], "c.txt", { type: "text/plain" }),
    ];
    const quota = await readBulkDocumentUploadWithAdmission(
      { parseBody: async () => ({ files }) },
      {
        maxAcceptedBytesByQuota: 3,
        maxBulkUploadBytes: 100,
        maxBulkUploadFiles: 20,
        maxUploadBytes: 10,
      },
    );
    expect(quota.items.map((item) => item.reason ?? "accepted")).toEqual([
      "accepted",
      "quota_exceeded",
      "quota_exceeded",
    ]);

    const aggregate = await readBulkDocumentUploadWithAdmission(
      { parseBody: async () => ({ files }) },
      {
        maxAcceptedBytesByQuota: null,
        maxBulkUploadBytes: 3,
        maxBulkUploadFiles: 20,
        maxUploadBytes: 10,
      },
    );
    expect(aggregate.items.map((item) => item.reason ?? "accepted")).toEqual([
      "accepted",
      "batch_byte_limit_exceeded",
      "batch_byte_limit_exceeded",
    ]);

    const count = await readBulkDocumentUploadWithAdmission(
      { parseBody: async () => ({ files }) },
      {
        maxAcceptedBytesByQuota: null,
        maxBulkUploadBytes: 100,
        maxBulkUploadFiles: 1,
        maxUploadBytes: 10,
      },
    );
    expect(count.items.map((item) => item.reason ?? "accepted")).toEqual([
      "accepted",
      "file_count_limit_exceeded",
      "file_count_limit_exceeded",
    ]);
  });
});
