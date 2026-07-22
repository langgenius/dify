import { createHash } from "node:crypto";

import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import { describe, expect, it } from "vitest";

import {
  SourceSecretStoreConflictError,
  SourceSecretStoreIntegrityError,
  createEncryptedObjectSourceSecretStore,
  createSourceCredentialFingerprinter,
  parseSourceSecretEncryptionKey,
} from "./source-secret-store";

const scope = {
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
  tenantId: "tenant-1",
};
const ref = "source-secret:v1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("encrypted object SourceSecretStore", () => {
  it("stores only ciphertext, authenticates scope, and returns a defensive copy", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 128_000 });
    const store = createEncryptedObjectSourceSecretStore({
      encryptionKey: new Uint8Array(32).fill(7),
      generateRef: () => ref,
      storage,
    });
    const credentials = { apiKey: "super-secret", nested: { token: "refresh-secret" } };

    const written = await store.put({ ...scope, credentials });
    expect(written).toMatchObject({
      fingerprint: store.fingerprint({ ...scope, credentials }),
      ref,
    });
    written.credentials.apiKey = "mutated";

    const objects = await storage.listObjects({ limit: 10, prefix: "__knowledge-secrets/" });
    expect(objects.objects).toHaveLength(1);
    const bytes = await storage.getObject(objects.objects[0]?.key ?? "");
    if (!bytes) {
      throw new Error("encrypted source secret missing");
    }
    const serialized = new TextDecoder().decode(bytes);
    const rawSha256 = createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("refresh-secret");
    expect(JSON.parse(serialized)).toMatchObject({
      fingerprint: store.fingerprint({ ...scope, credentials }),
    });
    expect(JSON.parse(serialized)).not.toMatchObject({ fingerprint: rawSha256 });
    expect(objects.objects[0]?.metadata).toEqual({ algorithm: "aes-256-gcm", version: "1" });

    await expect(store.get({ ...scope, ref })).resolves.toMatchObject({ credentials, ref });
    await expect(
      store.get({ ...scope, ref, sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99" }),
    ).rejects.toBeInstanceOf(SourceSecretStoreIntegrityError);
  });

  it("uses a stable, domain-separated keyed fingerprint instead of a raw credential hash", () => {
    const credentials = { password: "password" };
    const first = createSourceCredentialFingerprinter(new Uint8Array(32).fill(1));
    const sameKey = createSourceCredentialFingerprinter(new Uint8Array(32).fill(1));
    const differentKey = createSourceCredentialFingerprinter(new Uint8Array(32).fill(2));
    const rawSha256 = createHash("sha256").update(JSON.stringify(credentials)).digest("hex");

    const scopedInput = { ...scope, credentials };
    expect(first(scopedInput)).toBe(sameKey(scopedInput));
    expect(first(scopedInput)).not.toBe(differentKey(scopedInput));
    expect(first(scopedInput)).not.toBe(first({ ...scopedInput, tenantId: "tenant-2" }));
    expect(first(scopedInput)).not.toBe(
      first({ ...scopedInput, sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99" }),
    );
    expect(first(scopedInput)).not.toBe(rawSha256);
    expect(() => createSourceCredentialFingerprinter(new Uint8Array(31))).toThrow(/32 bytes/u);
  });

  it("makes same-ref retries idempotent and rejects a different secret", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 128_000 });
    const store = createEncryptedObjectSourceSecretStore({
      encryptionKey: new Uint8Array(32).fill(9),
      storage,
    });

    const first = await store.put({ ...scope, credentials: { token: "one" }, ref });
    await expect(store.put({ ...scope, credentials: { token: "one" }, ref })).resolves.toEqual(
      first,
    );
    await expect(
      store.put({ ...scope, credentials: { token: "two" }, ref }),
    ).rejects.toBeInstanceOf(SourceSecretStoreConflictError);
  });

  it("detects ciphertext tampering but can still delete the corrupted object", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 128_000 });
    const store = createEncryptedObjectSourceSecretStore({
      encryptionKey: new Uint8Array(32).fill(11),
      storage,
    });
    await store.put({ ...scope, credentials: { password: "hidden" }, ref });
    const objects = await storage.listObjects({ limit: 10, prefix: "__knowledge-secrets/" });
    const key = objects.objects[0]?.key ?? "";
    const bytes = await storage.getObject(key);
    if (!bytes) {
      throw new Error("test secret object missing");
    }
    const tampered = new Uint8Array(bytes);
    tampered[tampered.length - 2] = (tampered[tampered.length - 2] ?? 0) ^ 1;
    await storage.putObject({ body: tampered, key });

    await expect(store.get({ ...scope, ref })).rejects.toBeInstanceOf(
      SourceSecretStoreIntegrityError,
    );
    await expect(store.delete({ ...scope, knowledgeSpaceId: "", ref })).rejects.toThrow(
      /knowledgeSpaceId/u,
    );
    await expect(store.delete({ ...scope, sourceId: "", ref })).rejects.toThrow(/sourceId/u);
    await expect(store.delete({ ...scope, tenantId: "", ref })).rejects.toThrow(/tenantId/u);
    await expect(store.delete({ ...scope, ref: "invalid-ref" })).rejects.toThrow(
      /source-secret:v1/u,
    );
    await expect(storage.getObject(key)).resolves.toBeTruthy();

    await expect(store.delete({ ...scope, ref })).resolves.toBeUndefined();
    await expect(storage.getObject(key)).resolves.toBeNull();
    await expect(store.delete({ ...scope, ref })).resolves.toBeUndefined();
  });

  it("deletes idempotently and validates configuration and JSON values", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 128_000 });
    const store = createEncryptedObjectSourceSecretStore({
      encryptionKey: parseSourceSecretEncryptionKey(Buffer.alloc(32, 3).toString("base64")),
      storage,
    });
    await store.put({ ...scope, credentials: { token: "one" }, ref });
    await store.delete({ ...scope, ref });
    await store.delete({ ...scope, ref });
    await expect(store.get({ ...scope, ref })).resolves.toBeNull();

    expect(() => parseSourceSecretEncryptionKey("short")).toThrow(/32 bytes/u);
    await expect(
      store.put({ ...scope, credentials: { invalid: Number.NaN }, ref }),
    ).rejects.toThrow(/finite JSON/u);
  });
});
