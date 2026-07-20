import type { TidbFtsPostingBackfillRepository } from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

import { createApiTidbFtsPostingBackfillAssembly } from "./tidb-fts-posting-backfill-options";

describe("API TiDB FTS posting backfill assembly", () => {
  it("does not install a runtime or in-memory fallback without a TiDB database repository", () => {
    expect(createApiTidbFtsPostingBackfillAssembly({})).toBeUndefined();
  });

  it("validates bounded worker configuration and exposes the durable service", async () => {
    const repository = {
      get: vi.fn(async () => null),
    } as unknown as TidbFtsPostingBackfillRepository;
    expect(() =>
      createApiTidbFtsPostingBackfillAssembly({
        env: { KNOWLEDGE_TIDB_FTS_BACKFILL_CLAIM_BATCH: "0" },
        repository,
      }),
    ).toThrow("KNOWLEDGE_TIDB_FTS_BACKFILL_CLAIM_BATCH");

    const assembly = createApiTidbFtsPostingBackfillAssembly({
      env: {
        KNOWLEDGE_TIDB_FTS_BACKFILL_CLAIM_BATCH: "2",
        KNOWLEDGE_TIDB_FTS_BACKFILL_DISCOVERY_BATCH: "3",
        KNOWLEDGE_TIDB_FTS_BACKFILL_INTERVAL_MS: "1000",
        KNOWLEDGE_TIDB_FTS_BACKFILL_LEASE_MS: "30000",
        KNOWLEDGE_TIDB_FTS_BACKFILL_PROJECTIONS_PER_TICK: "4",
      },
      repository,
    });
    expect(assembly).toBeDefined();
    await expect(
      assembly?.service.get({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    assembly?.start();
    assembly?.start();
    assembly?.stop();
    assembly?.stop();
  });
});
