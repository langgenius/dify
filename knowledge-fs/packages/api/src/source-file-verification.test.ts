import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canSkipSourceFileDownload,
  createSourceFileVerification,
  parseOnlineDriveRemoteMetadata,
  readSourceFileVerification,
  sourceFileVerificationFingerprint,
} from "./source-file-verification";

const body = new TextEncoder().encode("published content");
const fingerprint = "a".repeat(64);
const verification = createSourceFileVerification({
  body,
  sourceFingerprint: fingerprint,
  downloadMetadata: { version: "900719925474099312345", etag: '"multipart-tag-2"' },
});
const base = {
  contentHash: verification.contentHash,
  sourceFingerprint: fingerprint,
  verification,
};

describe("source file verification", () => {
  it("keeps provider tokens opaque, normalizes full-content checksums and timestamps", () => {
    expect(
      parseOnlineDriveRemoteMetadata({
        version_id: "900719925474099312345",
        etag: '"multipart-tag-2"',
        checksum: { algorithm: "md5", value: "A".repeat(32) },
        modified_time: "2026-09-09T12:00:00+08:00",
        credentials: "never retained",
      }),
    ).toEqual({
      version: "900719925474099312345",
      etag: '"multipart-tag-2"',
      checksum: { algorithm: "md5", value: "a".repeat(32) },
      modifiedTime: "2026-09-09T04:00:00.000Z",
    });
  });

  it.each([
    undefined,
    null,
    [],
    "bad",
    {},
    {
      version_id: "null",
      etag: 'W/"weak"',
      checksum: { algorithm: "crc32c", value: "1234" },
      modified_time: "not a timestamp",
    },
    { version_id: 9007199254740992, etag: "bad\nheader" },
    {
      version_id: "x".repeat(1025),
      checksum: { algorithm: "sha256", value: "bad" },
    },
  ])("ignores unusable optional metadata: %j", (raw) => {
    expect(parseOnlineDriveRemoteMetadata(raw)).toBeUndefined();
  });

  it("compares a provider SHA-256 directly to an existing legacy published hash", () => {
    expect(
      canSkipSourceFileDownload({
        contentHash: verification.contentHash,
        sourceFingerprint: fingerprint,
        metadata: { checksum: { algorithm: "sha256", value: verification.contentHash } },
      }),
    ).toBe(true);
  });

  it("uses MD5 only as an explicit same-algorithm checksum, not an ETag", () => {
    expect(
      canSkipSourceFileDownload({
        ...base,
        metadata: { checksum: { algorithm: "md5", value: verification.md5 } },
      }),
    ).toBe(true);
    expect(canSkipSourceFileDownload({ ...base, metadata: { etag: verification.md5 } })).toBe(
      false,
    );
  });

  it("uses only version markers attested by the downloaded response", () => {
    expect(
      canSkipSourceFileDownload({ ...base, metadata: { version: "900719925474099312345" } }),
    ).toBe(true);
    const unbound = createSourceFileVerification({ body, sourceFingerprint: fingerprint });
    expect(
      canSkipSourceFileDownload({
        ...base,
        verification: unbound,
        metadata: { version: "900719925474099312345", etag: '"multipart-tag-2"' },
      }),
    ).toBe(false);
  });

  it("does not rely on modification time and size, even when both match", () => {
    expect(
      canSkipSourceFileDownload({
        ...base,
        size: body.byteLength,
        metadata: { modifiedTime: "2026-09-09T00:00:00.000Z" },
      }),
    ).toBe(false);
  });

  it.each([
    { sourceFingerprint: "b".repeat(64) },
    { contentHash: "b".repeat(64) },
    { size: body.byteLength + 1 },
    { verification: undefined },
    { verification: { ...verification, strategyVersion: "unknown" } },
  ])("invalidates stale or incompatible baseline: %j", (override) => {
    expect(
      canSkipSourceFileDownload({ ...base, ...override, metadata: { etag: '"multipart-tag-2"' } }),
    ).toBe(false);
  });

  it("downloads on conflicting markers or a changed checksum", () => {
    for (const metadata of [
      { version: "new", etag: '"multipart-tag-2"' },
      { version: "900719925474099312345", etag: '"new"' },
      { checksum: { algorithm: "sha256" as const, value: "b".repeat(64) } },
      { checksum: { algorithm: "md5" as const, value: "b".repeat(32) } },
    ])
      expect(canSkipSourceFileDownload({ ...base, metadata })).toBe(false);
  });

  it("rejects an authoritative download checksum mismatch before publication", () => {
    expect(() =>
      createSourceFileVerification({
        body,
        sourceFingerprint: fingerprint,
        downloadMetadata: { checksum: { algorithm: "sha256", value: "b".repeat(64) } },
      }),
    ).toThrow("response checksum");
    const md5 = createHash("md5").update(body).digest("hex");
    expect(
      createSourceFileVerification({
        body,
        sourceFingerprint: fingerprint,
        downloadMetadata: { checksum: { algorithm: "md5", value: md5 } },
      }).contentHash,
    ).toBe(verification.contentHash);
  });

  it("bounds persisted records and ignores arbitrary metadata", () => {
    expect(readSourceFileVerification({ ...verification, secret: "not copied" })).toEqual(
      verification,
    );
    expect(readSourceFileVerification({ ...verification, sizeBytes: -1 })).toBeUndefined();
    expect(readSourceFileVerification({ ...verification, md5: "invalid" })).toBeUndefined();
  });

  it("invalidates markers when the source/connection identity changes", () => {
    const source = {
      id: "source",
      knowledgeSpaceId: "space",
      uri: "bucket",
      version: 1,
      name: "Drive",
      type: "connector",
      status: "active",
      permissionScope: [],
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      metadata: { _sourceConnectionVersion: 1, credentialId: "credential" },
    } satisfies Parameters<typeof sourceFileVerificationFingerprint>[0];
    const original = sourceFileVerificationFingerprint(source);
    expect(sourceFileVerificationFingerprint({ ...source, version: 2 })).not.toBe(original);
    expect(
      sourceFileVerificationFingerprint({
        ...source,
        metadata: { ...source.metadata, _sourceConnectionVersion: 2 },
      }),
    ).not.toBe(original);
    expect(sourceFileVerificationFingerprint({ ...source, uri: "another-bucket" })).not.toBe(
      original,
    );
  });
});
