import type {
  SourceCredentialBackfillRepository,
  SourceRepository,
  SourceSecretStore,
} from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

import { createApiSourceCredentialBackfillAssembly } from "./source-credential-backfill-options";

describe("API source credential backfill assembly", () => {
  it("does not install a replica-local fallback when any durable boundary is absent", () => {
    const dependencies = stubs();
    expect(createApiSourceCredentialBackfillAssembly({})).toBeUndefined();
    expect(
      createApiSourceCredentialBackfillAssembly({
        repository: dependencies.repository,
        secretStore: dependencies.secretStore,
      }),
    ).toBeUndefined();
    expect(
      createApiSourceCredentialBackfillAssembly({
        repository: dependencies.repository,
        sources: dependencies.sources,
      }),
    ).toBeUndefined();
    expect(
      createApiSourceCredentialBackfillAssembly({
        secretStore: dependencies.secretStore,
        sources: dependencies.sources,
      }),
    ).toBeUndefined();
  });

  it("validates bounded worker settings and starts idempotently", () => {
    const dependencies = stubs();
    expect(() =>
      createApiSourceCredentialBackfillAssembly({
        ...dependencies,
        env: { KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_CLAIM_BATCH: "0" },
      }),
    ).toThrow("KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_CLAIM_BATCH");
    expect(() =>
      createApiSourceCredentialBackfillAssembly({
        ...dependencies,
        env: { KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_MAX_RETRIES: "-1" },
      }),
    ).toThrow("KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_MAX_RETRIES");

    const assembly = createApiSourceCredentialBackfillAssembly({
      ...dependencies,
      env: {
        KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_CLAIM_BATCH: "2",
        KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_DISCOVERY_BATCH: "3",
        KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_INTERVAL_MS: "1000",
        KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_LEASE_MS: "30000",
        KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_MAX_RETRIES: "5",
      },
    });
    expect(assembly).toBeDefined();
    assembly?.start();
    assembly?.start();
    assembly?.stop();
    assembly?.stop();
  });
});

function stubs(): {
  repository: SourceCredentialBackfillRepository;
  secretStore: SourceSecretStore;
  sources: Pick<SourceRepository, "get" | "update">;
} {
  return {
    repository: {
      claim: vi.fn(async () => []),
      complete: vi.fn(),
      discover: vi.fn(async () => ({ created: 0, scanned: 0 })),
      fail: vi.fn(),
      get: vi.fn(async () => null),
      heartbeat: vi.fn(),
      refresh: vi.fn(),
      release: vi.fn(),
      retryableFailure: vi.fn(),
      retry: vi.fn(async () => null),
    } as unknown as SourceCredentialBackfillRepository,
    secretStore: {
      delete: vi.fn(),
      get: vi.fn(async () => null),
      put: vi.fn(),
    } as unknown as SourceSecretStore,
    sources: {
      get: vi.fn(async () => null),
      update: vi.fn(async () => null),
    },
  };
}
