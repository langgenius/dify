import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER_MAX_BYTES,
  QUERY_IMAGE_EXPANSION_METADATA_KEY,
  QUERY_IMAGE_REFERENCES_METADATA_KEY,
  QueryImageReferencesSchema,
  QueryImageResolutionError,
  assertResolvedQueryImages,
  hasQueryInput,
  queryImageExpansionFromMetadata,
  queryImageReferencesFromMetadata,
  queryImageResolutionReferencesFromHeader,
} from "./query-images";

const IMAGE_ID = "00000000-0000-4000-8000-000000000001";

describe("query image contracts", () => {
  it("accepts either text or images and permits an intentional mixed query", () => {
    expect(hasQueryInput({ query: "find this" })).toBe(true);
    expect(hasQueryInput({ queryImages: [{ uploadFileId: IMAGE_ID }] })).toBe(true);
    expect(hasQueryInput({ query: "find this", queryImages: [{ uploadFileId: IMAGE_ID }] })).toBe(
      true,
    );
    expect(hasQueryInput({ query: "  ", queryImages: [] })).toBe(false);
    expect(hasQueryInput({})).toBe(false);
  });

  it("rejects malformed, duplicate, and over-count references", () => {
    expect(() => QueryImageReferencesSchema.parse([{ uploadFileId: "not-a-uuid" }])).toThrow();
    expect(() =>
      QueryImageReferencesSchema.parse([{ uploadFileId: IMAGE_ID }, { uploadFileId: IMAGE_ID }]),
    ).toThrow("duplicate");
    expect(() =>
      QueryImageReferencesSchema.parse(
        Array.from({ length: 5 }, (_, index) => ({
          uploadFileId: `00000000-0000-4000-8000-00000000000${index}`,
        })),
      ),
    ).toThrow();
  });

  it("enforces per-image and aggregate resolved-byte bounds", () => {
    const nineMiB = new Uint8Array(9 * 1024 * 1024);
    expect(() =>
      assertResolvedQueryImages(
        Array.from({ length: 4 }, (_, index) => ({
          body: nineMiB,
          byteSize: nineMiB.byteLength,
          mimeType: "image/png" as const,
          sha256: `${index}`.repeat(64),
          uploadFileId: `00000000-0000-4000-8000-00000000000${index}`,
        })),
      ),
    ).toThrow(QueryImageResolutionError);

    expect(() =>
      assertResolvedQueryImages([
        {
          body: new Uint8Array([1]),
          byteSize: 2,
          mimeType: "image/png",
          sha256: "a".repeat(64),
          uploadFileId: IMAGE_ID,
        },
      ]),
    ).toThrow("byte size is invalid");

    expect(() =>
      assertResolvedQueryImages(
        Array.from({ length: 5 }, (_, index) => ({
          body: new Uint8Array([index]),
          byteSize: 1,
          mimeType: "image/png" as const,
          sha256: `${index}`.repeat(64),
          uploadFileId: `00000000-0000-4000-8000-00000000000${index}`,
        })),
      ),
    ).toThrow("max count");

    const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(() =>
      assertResolvedQueryImages([
        {
          body: tooLarge,
          byteSize: tooLarge.byteLength,
          mimeType: "image/webp",
          sha256: "b".repeat(64),
          uploadFileId: IMAGE_ID,
        },
      ]),
    ).toThrow("max bytes");

    const valid = {
      body: new Uint8Array([1, 2]),
      byteSize: 2,
      mimeType: "image/jpeg" as const,
      sha256: "c".repeat(64),
      uploadFileId: IMAGE_ID,
    };
    expect(assertResolvedQueryImages([valid])).toEqual([valid]);
  });

  it("round-trips only validated durable references and normalized expansion text", () => {
    const metadata = {
      [QUERY_IMAGE_EXPANSION_METADATA_KEY]: "  visible invoice  ",
      [QUERY_IMAGE_REFERENCES_METADATA_KEY]: [{ uploadFileId: IMAGE_ID }],
    };
    expect(queryImageReferencesFromMetadata(metadata)).toEqual([{ uploadFileId: IMAGE_ID }]);
    expect(queryImageExpansionFromMetadata(metadata)).toBe("visible invoice");
    expect(
      queryImageExpansionFromMetadata({ [QUERY_IMAGE_EXPANSION_METADATA_KEY]: "   " }),
    ).toBeUndefined();
    expect(
      queryImageReferencesFromMetadata({ [QUERY_IMAGE_REFERENCES_METADATA_KEY]: "invalid" }),
    ).toEqual([]);
  });

  it("keeps workflow grants in one bounded app-only transport header", () => {
    const encoded = Buffer.from(
      JSON.stringify({ g: ["short-lived-grant"], v: 1 }),
      "utf8",
    ).toString("base64url");
    expect(
      queryImageResolutionReferencesFromHeader({
        encodedGrants: encoded,
        references: [{ uploadFileId: IMAGE_ID }],
        subjectId: "dify-app:app-1",
      }),
    ).toEqual([{ accessGrant: "short-lived-grant", uploadFileId: IMAGE_ID }]);
    expect(
      queryImageResolutionReferencesFromHeader({
        references: [{ uploadFileId: IMAGE_ID }],
        subjectId: "dify-account:actor-1",
      }),
    ).toEqual([{ uploadFileId: IMAGE_ID }]);

    for (const invalid of [
      {
        encodedGrants: encoded,
        references: [{ uploadFileId: IMAGE_ID }],
        subjectId: "dify-account:actor-1",
      },
      {
        encodedGrants: encoded,
        references: [],
        subjectId: "dify-app:app-1",
      },
      {
        encodedGrants: "!not-base64url!",
        references: [{ uploadFileId: IMAGE_ID }],
        subjectId: "dify-app:app-1",
      },
      {
        encodedGrants: "a".repeat(KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER_MAX_BYTES + 1),
        references: [{ uploadFileId: IMAGE_ID }],
        subjectId: "dify-app:app-1",
      },
    ]) {
      expect(() => queryImageResolutionReferencesFromHeader(invalid)).toThrow(
        QueryImageResolutionError,
      );
    }
  });
});
