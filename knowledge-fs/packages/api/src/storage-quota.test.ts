import { describe, expect, it } from "vitest";

import {
  StorageQuotaExceededError,
  createStaticStorageQuotaRepository,
  enforceStorageQuota,
} from "./storage-quota";

describe("storage quota utilities", () => {
  it("returns a static quota policy and rejects invalid bounds", async () => {
    const repository = createStaticStorageQuotaRepository({ maxRawDocumentBytes: 10 });

    await expect(
      repository.get({ knowledgeSpaceId: "space-1", tenantId: "tenant-1" }),
    ).resolves.toEqual({
      maxRawDocumentBytes: 10,
    });

    expect(() => createStaticStorageQuotaRepository({ maxRawDocumentBytes: 0 })).toThrow(
      "Storage quota maxRawDocumentBytes must be null or at least 1",
    );
  });

  it("skips usage reads when raw document quota is disabled", async () => {
    let usageReads = 0;

    await enforceStorageQuota({
      assets: {
        getStorageUsage: async () => {
          usageReads += 1;
          return { rawDocumentBytes: 100 };
        },
      },
      incomingBytes: 10,
      knowledgeSpaceId: "space-1",
      quotas: createStaticStorageQuotaRepository({ maxRawDocumentBytes: null }),
      tenantId: "tenant-1",
    });

    expect(usageReads).toBe(0);
  });

  it("rejects uploads that would exceed configured raw document bytes", async () => {
    await expect(
      enforceStorageQuota({
        assets: {
          getStorageUsage: async () => ({ rawDocumentBytes: 8 }),
        },
        incomingBytes: 3,
        knowledgeSpaceId: "space-1",
        quotas: createStaticStorageQuotaRepository({ maxRawDocumentBytes: 10 }),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow(StorageQuotaExceededError);
  });
});
