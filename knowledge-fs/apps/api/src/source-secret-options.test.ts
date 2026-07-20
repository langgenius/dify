import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import { describe, expect, it } from "vitest";

import {
  assertApiSourceSecretDurability,
  createApiSourceSecretStore,
} from "./source-secret-options";

describe("assertApiSourceSecretDurability", () => {
  it("rejects production memory object storage when the secret store is configured", () => {
    expect(() =>
      assertApiSourceSecretDurability({
        objectStorageKind: "memory",
        production: true,
        secretStoreConfigured: true,
        usesDatabaseLifecycleLedger: true,
      }),
    ).toThrow(/durable object storage/u);
  });

  it("rejects a production in-memory lifecycle ledger", () => {
    expect(() =>
      assertApiSourceSecretDurability({
        objectStorageKind: "s3-compatible",
        production: true,
        secretStoreConfigured: true,
        usesDatabaseLifecycleLedger: false,
      }),
    ).toThrow(/database-backed source secret lifecycle ledger/u);
  });

  it("allows durable production assembly and all non-production or disabled assemblies", () => {
    expect(() =>
      assertApiSourceSecretDurability({
        objectStorageKind: "s3-compatible",
        production: true,
        secretStoreConfigured: true,
        usesDatabaseLifecycleLedger: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertApiSourceSecretDurability({
        objectStorageKind: "memory",
        production: false,
        secretStoreConfigured: true,
        usesDatabaseLifecycleLedger: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertApiSourceSecretDurability({
        objectStorageKind: "memory",
        production: true,
        secretStoreConfigured: false,
        usesDatabaseLifecycleLedger: false,
      }),
    ).not.toThrow();
  });
});

describe("createApiSourceSecretStore", () => {
  const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 128_000 });

  it("stays disabled without a key and validates configured bounds", () => {
    expect(createApiSourceSecretStore(storage, {})).toBeUndefined();
    expect(() =>
      createApiSourceSecretStore(storage, {
        KNOWLEDGE_SOURCE_SECRET_KEY: Buffer.alloc(32, 1).toString("base64"),
        KNOWLEDGE_SOURCE_SECRET_MAX_BYTES: "0",
      }),
    ).toThrow(/positive safe integer/u);
  });

  it("constructs an encrypted store from a 32-byte deployment key", async () => {
    const store = createApiSourceSecretStore(storage, {
      KNOWLEDGE_SOURCE_SECRET_KEY: Buffer.alloc(32, 2).toString("hex"),
    });
    await expect(
      store?.put({
        credentials: { token: "secret" },
        knowledgeSpaceId: "space-1",
        ref: "source-secret:v1:018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        sourceId: "source-1",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ ref: expect.stringMatching(/^source-secret:v1:/u) });
  });
});
