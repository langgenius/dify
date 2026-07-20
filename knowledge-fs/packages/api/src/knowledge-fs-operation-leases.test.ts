import { describe, expect, it } from "vitest";

import { createInMemoryKnowledgeFsLeaseRepository } from "./knowledge-fs-lease-repository";
import { createKnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";

describe("createKnowledgeFsOperationLeaseCoordinator", () => {
  it("acquires, heartbeats, and releases operation leases around successful work", async () => {
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    const coordinator = createKnowledgeFsOperationLeaseCoordinator({
      generateLeaseId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f5a01",
      leaseTtlMs: 60_000,
      leases,
      now: (() => {
        const times = [
          "2026-05-27T10:00:00.000Z",
          "2026-05-27T10:00:10.000Z",
          "2026-05-27T10:00:20.000Z",
        ];
        return () => times.shift() ?? "2026-05-27T10:00:30.000Z";
      })(),
      sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
    });

    await expect(
      coordinator.withLease(
        {
          knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
          leaseType: "publish",
          metadata: { jobId: "job-1" },
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          targetType: "document-asset",
          targetVersion: 1,
          tenantId: "tenant-1",
          virtualPath: "/sources/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        },
        async () => "done",
      ),
    ).resolves.toBe("done");
    await expect(
      leases.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5a01",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      expiresAt: "2026-05-27T10:01:10.000Z",
      heartbeatAt: "2026-05-27T10:00:10.000Z",
      status: "released",
      updatedAt: "2026-05-27T10:00:20.000Z",
    });
  });

  it("marks operation leases failed when work throws", async () => {
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    const coordinator = createKnowledgeFsOperationLeaseCoordinator({
      generateLeaseId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f5a02",
      leaseTtlMs: 60_000,
      leases,
      now: () => "2026-05-27T10:00:00.000Z",
      sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
    });

    await expect(
      coordinator.withLease(
        {
          knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
          leaseType: "delete",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          targetType: "document-asset",
          tenantId: "tenant-1",
          virtualPath: "/sources/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        },
        async () => {
          throw new Error("delete failed");
        },
      ),
    ).rejects.toThrow("delete failed");
    await expect(
      leases.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5a02",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      status: "failed",
    });
  });
});
