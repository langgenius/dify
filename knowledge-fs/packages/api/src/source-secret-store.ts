import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { ObjectStorageAdapter } from "@knowledge/core";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const envelopeVersion = 1;
const algorithm = "aes-256-gcm";

export interface SourceSecretScope {
  readonly knowledgeSpaceId: string;
  readonly sourceId: string;
  readonly tenantId: string;
}

export interface PutSourceSecretInput extends SourceSecretScope {
  readonly credentials: Readonly<Record<string, unknown>>;
  /** Supplied by durable backfills so retries address the same object. */
  readonly ref?: string | undefined;
}

export interface StoredSourceSecret {
  readonly credentials: Record<string, unknown>;
  readonly fingerprint: string;
  readonly ref: string;
}

export interface SourceCredentialFingerprintInput extends SourceSecretScope {
  readonly credentials: Readonly<Record<string, unknown>>;
}

export type SourceCredentialFingerprinter = (input: SourceCredentialFingerprintInput) => string;

export interface SourceSecretStore {
  delete(input: SourceSecretScope & { readonly ref: string }): Promise<void>;
  /** Scope-bound keyed digest used for idempotency without exposing a password oracle. */
  readonly fingerprint: SourceCredentialFingerprinter;
  get(input: SourceSecretScope & { readonly ref: string }): Promise<StoredSourceSecret | null>;
  put(input: PutSourceSecretInput): Promise<StoredSourceSecret>;
}

export interface EncryptedObjectSourceSecretStoreOptions {
  /** Exactly 32 raw bytes. Parse/rotate this key outside request handling. */
  readonly encryptionKey: Uint8Array;
  readonly generateRef?: () => string;
  readonly maxSecretBytes?: number;
  readonly objectKeyPrefix?: string;
  readonly storage: ObjectStorageAdapter;
}

export class SourceSecretStoreConflictError extends Error {
  readonly code = "SOURCE_SECRET_REF_CONFLICT";

  constructor() {
    super("Source secret reference already contains different credentials");
    this.name = "SourceSecretStoreConflictError";
  }
}

export class SourceSecretStoreIntegrityError extends Error {
  readonly code = "SOURCE_SECRET_INTEGRITY_FAILED";

  constructor() {
    super("Source secret failed scope or integrity validation");
    this.name = "SourceSecretStoreIntegrityError";
  }
}

interface EncryptedEnvelope {
  readonly algorithm: typeof algorithm;
  readonly ciphertext: string;
  readonly fingerprint: string;
  readonly iv: string;
  readonly tag: string;
  readonly version: typeof envelopeVersion;
}

/**
 * AES-GCM SecretStore backed by the platform object store. The object key is a hash of an opaque
 * reference and the tenant/space/source binding is authenticated as AAD, so copying a reference to
 * another source cannot decrypt it. Neither object metadata nor database rows contain credentials.
 */
export function createEncryptedObjectSourceSecretStore({
  encryptionKey,
  generateRef = () => `source-secret:v1:${randomUUID()}`,
  maxSecretBytes = 64 * 1024,
  objectKeyPrefix = "__knowledge-secrets/source/v1/",
  storage,
}: EncryptedObjectSourceSecretStoreOptions): SourceSecretStore {
  if (encryptionKey.byteLength !== 32) {
    throw new Error("Source SecretStore AES-256 key must contain exactly 32 bytes");
  }
  if (!Number.isSafeInteger(maxSecretBytes) || maxSecretBytes < 1) {
    throw new Error("Source SecretStore maxSecretBytes must be a positive safe integer");
  }
  if (!objectKeyPrefix || objectKeyPrefix.length > 512) {
    throw new Error("Source SecretStore objectKeyPrefix must contain 1-512 characters");
  }
  const key = Buffer.from(encryptionKey);
  const fingerprint = createSourceCredentialFingerprinter(encryptionKey);

  const read = async (
    input: SourceSecretScope & { readonly ref: string },
  ): Promise<StoredSourceSecret | null> => {
    const scope = normalizeScope(input);
    const ref = normalizeRef(input.ref);
    const stored = await storage.getObject(objectKey(objectKeyPrefix, ref));
    if (!stored) {
      return null;
    }

    try {
      const envelope = parseEnvelope(stored);
      const decipher = createDecipheriv(algorithm, key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAAD(scopeAad(scope, ref));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]);
      if (plaintext.byteLength > maxSecretBytes) {
        throw new SourceSecretStoreIntegrityError();
      }
      const credentials = parseCredentials(plaintext, maxSecretBytes);
      const actualFingerprint = fingerprint({ ...scope, credentials });
      if (!safeFingerprintEqual(actualFingerprint, envelope.fingerprint)) {
        throw new SourceSecretStoreIntegrityError();
      }
      return { credentials, fingerprint: actualFingerprint, ref };
    } catch (error) {
      if (error instanceof SourceSecretStoreIntegrityError) {
        throw error;
      }
      throw new SourceSecretStoreIntegrityError();
    }
  };

  return {
    delete: async (input) => {
      // Validate the complete caller scope even though physical deletion is addressed by the
      // opaque ref alone. Cleanup must remain possible when the envelope cannot be decrypted (for
      // example after corruption or key rotation), so never gate deletion on a read first.
      normalizeScope(input);
      const ref = normalizeRef(input.ref);
      await storage.deleteObject(objectKey(objectKeyPrefix, ref));
    },
    fingerprint,
    get: read,
    put: async (input) => {
      const scope = normalizeScope(input);
      const ref = normalizeRef(input.ref ?? generateRef());
      const credentials = cloneCredentials(input.credentials, maxSecretBytes);
      const credentialFingerprint = fingerprint({ ...scope, credentials });
      const existing = await read({ ...scope, ref });
      if (existing) {
        if (!safeFingerprintEqual(existing.fingerprint, credentialFingerprint)) {
          throw new SourceSecretStoreConflictError();
        }
        return existing;
      }

      const plaintext = encodeCredentials(credentials, maxSecretBytes);
      const iv = randomBytes(12);
      const cipher = createCipheriv(algorithm, key, iv);
      cipher.setAAD(scopeAad(scope, ref));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope: EncryptedEnvelope = {
        algorithm,
        ciphertext: ciphertext.toString("base64url"),
        fingerprint: credentialFingerprint,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        version: envelopeVersion,
      };
      await storage.putObject({
        body: encoder.encode(JSON.stringify(envelope)),
        contentType: "application/vnd.knowledge-fs.encrypted-source-secret+json",
        key: objectKey(objectKeyPrefix, ref),
        metadata: { algorithm, version: String(envelopeVersion) },
      });
      return {
        credentials: cloneCredentials(credentials, maxSecretBytes),
        fingerprint: credentialFingerprint,
        ref,
      };
    },
  };
}

export function parseSourceSecretEncryptionKey(value: string): Uint8Array {
  const normalized = value.trim();
  const decoded = /^[a-f0-9]{64}$/iu.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64");
  if (decoded.byteLength !== 32) {
    throw new Error("KNOWLEDGE_SOURCE_SECRET_KEY must be 32 bytes encoded as hex or base64");
  }
  return new Uint8Array(decoded);
}

/**
 * Derives a dedicated MAC key from strong deployment key material. The two domain separators keep
 * this use cryptographically independent from AES-GCM and from any future HMAC use of the same
 * root key. Persisted fingerprints therefore cannot validate guesses without the deployment key.
 */
export function createSourceCredentialFingerprinter(
  keyMaterial: Uint8Array,
): SourceCredentialFingerprinter {
  if (keyMaterial.byteLength !== 32) {
    throw new Error("Source credential fingerprint key material must contain exactly 32 bytes");
  }
  const fingerprintKey = createHmac("sha256", Buffer.from(keyMaterial))
    .update("knowledge-fs/source-credential-fingerprint-key/v1", "utf8")
    .digest();
  return (input) => {
    const scope = normalizeScope(input);
    return createHmac("sha256", fingerprintKey)
      .update("knowledge-fs/source-credential-fingerprint/value/v1\0", "utf8")
      .update(
        stableJson({
          credentials: input.credentials,
          knowledgeSpaceId: scope.knowledgeSpaceId,
          sourceId: scope.sourceId,
          tenantId: scope.tenantId,
          version: 1,
        }),
        "utf8",
      )
      .digest("hex");
  };
}

function normalizeScope(scope: SourceSecretScope): SourceSecretScope {
  return {
    knowledgeSpaceId: required(scope.knowledgeSpaceId, "knowledgeSpaceId", 255),
    sourceId: required(scope.sourceId, "sourceId", 255),
    tenantId: required(scope.tenantId, "tenantId", 255),
  };
}

function normalizeRef(value: string): string {
  const ref = required(value, "ref", 255);
  if (!/^source-secret:v1:[0-9a-f-]{36}$/u.test(ref)) {
    throw new Error("Source secret ref must use source-secret:v1:<uuid>");
  }
  return ref;
}

function required(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`Source SecretStore ${name} must contain 1-${max} characters`);
  }
  return normalized;
}

function objectKey(prefix: string, ref: string): string {
  return `${prefix}${createHash("sha256").update(ref).digest("hex")}.enc`;
}

function scopeAad(scope: SourceSecretScope, ref: string): Buffer {
  return Buffer.from(
    stableJson({
      knowledgeSpaceId: scope.knowledgeSpaceId,
      ref,
      sourceId: scope.sourceId,
      tenantId: scope.tenantId,
      version: envelopeVersion,
    }),
    "utf8",
  );
}

function parseEnvelope(bytes: Uint8Array): EncryptedEnvelope {
  const parsed = JSON.parse(decoder.decode(bytes)) as Partial<EncryptedEnvelope>;
  if (
    parsed.version !== envelopeVersion ||
    parsed.algorithm !== algorithm ||
    typeof parsed.ciphertext !== "string" ||
    typeof parsed.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(parsed.fingerprint) ||
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string"
  ) {
    throw new SourceSecretStoreIntegrityError();
  }
  return parsed as EncryptedEnvelope;
}

function encodeCredentials(
  credentials: Readonly<Record<string, unknown>>,
  maxSecretBytes: number,
): Buffer {
  const encoded = Buffer.from(stableJson(credentials), "utf8");
  if (encoded.byteLength < 2 || encoded.byteLength > maxSecretBytes) {
    throw new Error(`Source credentials must encode to 2-${maxSecretBytes} bytes`);
  }
  return encoded;
}

function parseCredentials(bytes: Uint8Array, maxSecretBytes: number): Record<string, unknown> {
  if (bytes.byteLength > maxSecretBytes) {
    throw new SourceSecretStoreIntegrityError();
  }
  const parsed: unknown = JSON.parse(decoder.decode(bytes));
  if (!isPlainRecord(parsed)) {
    throw new SourceSecretStoreIntegrityError();
  }
  return cloneCredentials(parsed, maxSecretBytes);
}

function cloneCredentials(
  credentials: Readonly<Record<string, unknown>>,
  maxSecretBytes: number,
): Record<string, unknown> {
  if (!isPlainRecord(credentials)) {
    throw new Error("Source credentials must be a plain JSON object");
  }
  const encoded = encodeCredentials(credentials, maxSecretBytes);
  const parsed: unknown = JSON.parse(encoded.toString("utf8"));
  if (!isPlainRecord(parsed)) {
    throw new Error("Source credentials must be a plain JSON object");
  }
  return parsed;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  throw new Error("Source credentials must contain only finite JSON values");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeFingerprintEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}
