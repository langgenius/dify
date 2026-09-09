import { createHash } from "node:crypto";
import type { Source } from "@knowledge/core";

/** Optional provider metadata. A version/ETag is opaque, never a content checksum. */
export interface OnlineDriveRemoteMetadata {
  readonly version?: string | undefined;
  readonly etag?: string | undefined;
  readonly checksum?: { readonly algorithm: "md5" | "sha256"; readonly value: string } | undefined;
  readonly modifiedTime?: string | undefined;
}

export interface SourceFileVerification {
  readonly strategyVersion: "source-file-verification-v1";
  readonly sourceFingerprint: string;
  readonly contentHash: string;
  readonly md5: string;
  readonly sizeBytes: number;
  /** Only metadata returned WITH the downloaded bytes, not from an earlier listing. */
  readonly remoteMetadata?: OnlineDriveRemoteMetadata | undefined;
}

export const SOURCE_FILE_VERIFICATION_KEY = "sourceFileVerification";

/** Parse the optional plugin wire extension; malformed hints must not break old plugins. */
export function parseOnlineDriveRemoteMetadata(
  raw: unknown,
): OnlineDriveRemoteMetadata | undefined {
  const record = object(raw);
  if (!record) return undefined;
  const version = token(record.version_id);
  const etag = token(record.etag);
  const checksumRecord = object(record.checksum);
  const algorithm = checksumRecord?.algorithm;
  const value = checksumRecord?.value;
  const checksum: OnlineDriveRemoteMetadata["checksum"] =
    (algorithm === "md5" || algorithm === "sha256") &&
    typeof value === "string" &&
    new RegExp(`^[a-fA-F0-9]{${algorithm === "md5" ? 32 : 64}}$`, "u").test(value)
      ? { algorithm, value: value.toLowerCase() }
      : undefined;
  const modifiedTime =
    typeof record.modified_time === "string" &&
    record.modified_time.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      record.modified_time,
    ) &&
    Number.isFinite(Date.parse(record.modified_time))
      ? new Date(record.modified_time).toISOString()
      : undefined;
  const metadata: OnlineDriveRemoteMetadata = {
    ...(version && version !== "null" ? { version } : {}),
    ...(etag && !/^W\//iu.test(etag) ? { etag } : {}),
    ...(checksum ? { checksum } : {}),
    ...(modifiedTime ? { modifiedTime } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function sourceFileVerificationFingerprint(source: Source): string {
  // Do not persist credentials. Configuration changes invalidate a version-only shortcut even
  // when the provider reuses item IDs/ETags in another account or bucket.
  return sha256(
    JSON.stringify([
      source.knowledgeSpaceId,
      source.id,
      source.version,
      source.uri,
      source.connectionId ?? null,
      source.credentialRef ?? null,
      ...[
        "pluginId",
        "provider",
        "providerId",
        "datasource",
        "credentialId",
        "_sourceConnectionVersion",
      ].map((key) => source.metadata[key] ?? null),
    ]),
  );
}

export function readSourceFileVerification(raw: unknown): SourceFileVerification | undefined {
  const value = object(raw);
  if (
    value?.strategyVersion !== "source-file-verification-v1" ||
    !hex(value.sourceFingerprint, 64) ||
    !hex(value.contentHash, 64) ||
    !hex(value.md5, 32) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 0
  )
    return undefined;
  const remote = object(value.remoteMetadata);
  const remoteMetadata = remote
    ? parseOnlineDriveRemoteMetadata({
        version_id: remote.version,
        etag: remote.etag,
        checksum: remote.checksum,
        modified_time: remote.modifiedTime,
      })
    : undefined;
  return {
    strategyVersion: "source-file-verification-v1",
    sourceFingerprint: value.sourceFingerprint,
    contentHash: value.contentHash,
    md5: value.md5,
    sizeBytes: value.sizeBytes as number,
    ...(remoteMetadata ? { remoteMetadata } : {}),
  };
}

export function canSkipSourceFileDownload(input: {
  readonly contentHash: string;
  readonly metadata?: OnlineDriveRemoteMetadata | undefined;
  readonly size?: number | undefined;
  readonly sourceFingerprint: string;
  readonly verification?: unknown;
}): boolean {
  const metadata = input.metadata;
  if (!metadata) return false;
  // SHA-256 can be compared directly with the already published document, including legacy
  // documents which do not yet have a verification record.
  if (metadata.checksum?.algorithm === "sha256") {
    return metadata.checksum.value === input.contentHash;
  }
  const prior = readSourceFileVerification(input.verification);
  if (
    !prior ||
    prior.contentHash !== input.contentHash ||
    prior.sourceFingerprint !== input.sourceFingerprint ||
    (input.size !== undefined && input.size !== prior.sizeBytes)
  )
    return false;
  if (metadata.checksum?.algorithm === "md5") return metadata.checksum.value === prior.md5;
  const receipt = prior.remoteMetadata;
  if (!receipt) return false;
  // A contradictory strong marker always forces a download. Modification time/size alone are
  // deliberately insufficient: preserved/coarse timestamps can hide an equal-size edit.
  if (metadata.version && receipt.version && metadata.version !== receipt.version) return false;
  if (metadata.etag && receipt.etag && metadata.etag !== receipt.etag) return false;
  return Boolean(
    (metadata.version && metadata.version === receipt.version) ||
      (metadata.etag && metadata.etag === receipt.etag),
  );
}

export function createSourceFileVerification(input: {
  readonly body: Uint8Array;
  readonly sourceFingerprint: string;
  readonly downloadMetadata?: OnlineDriveRemoteMetadata | undefined;
}): SourceFileVerification {
  const contentHash = sha256(input.body);
  const md5 = createHash("md5").update(input.body).digest("hex");
  const checksum = input.downloadMetadata?.checksum;
  if (checksum && checksum.value !== (checksum.algorithm === "sha256" ? contentHash : md5)) {
    throw Object.assign(new Error("Downloaded source file does not match its response checksum"), {
      code: "SOURCE_DOWNLOAD_CHECKSUM_MISMATCH",
    });
  }
  return {
    strategyVersion: "source-file-verification-v1",
    sourceFingerprint: input.sourceFingerprint,
    contentHash,
    md5,
    sizeBytes: input.body.byteLength,
    ...(input.downloadMetadata ? { remoteMetadata: input.downloadMetadata } : {}),
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function token(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 1_024 &&
    value.trim() &&
    [...value].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    )
    ? value
    : undefined;
}

function hex(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
