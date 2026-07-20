import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type KnowledgeFsLease,
  KnowledgeFsLeaseSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeFsLeaseCapacityExceededError,
  KnowledgeFsLeaseConflictError,
  KnowledgeFsLeaseDeletionFenceActiveError,
  KnowledgeFsLeaseListLimitExceededError,
  createDatabaseKnowledgeFsLeaseRepository,
  createInMemoryKnowledgeFsLeaseRepository,
} from "./knowledge-fs-lease-repository";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SESSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
const TARGET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("createInMemoryKnowledgeFsLeaseRepository", () => {
  it("acquires clone-isolated leases and updates heartbeat by tenant scope", async () => {
    const repository = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    const created = await repository.acquire(lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"));
    created.metadata.mutated = true;

    await expect(
      repository.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      metadata: {},
    });
    await expect(
      repository.heartbeat({
        expiresAt: "2026-05-27T10:10:00.000Z",
        heartbeatAt: "2026-05-27T10:05:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T10:05:00.000Z",
      }),
    ).resolves.toMatchObject({
      expiresAt: "2026-05-27T10:10:00.000Z",
      heartbeatAt: "2026-05-27T10:05:00.000Z",
      updatedAt: "2026-05-27T10:05:00.000Z",
    });
    await expect(
      repository.heartbeat({
        expiresAt: "2026-05-27T10:20:00.000Z",
        heartbeatAt: "2026-05-27T10:15:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01",
        tenantId: "tenant-2",
        updatedAt: "2026-05-27T10:15:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("rejects conflicting active mutation leases while allowing read leases", async () => {
    const repository = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a01", {
        leaseType: "publish",
        virtualPath: "/sources/uploads/architecture.md",
      }),
    );
    await expect(
      repository.acquire(
        lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a02", {
          leaseType: "read",
          virtualPath: "/sources/uploads/architecture.md",
        }),
      ),
    ).resolves.toMatchObject({ leaseType: "read" });
    await expect(
      repository.acquire(
        lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a03", {
          leaseType: "delete",
          virtualPath: "/sources/uploads/architecture.md",
        }),
      ),
    ).rejects.toBeInstanceOf(KnowledgeFsLeaseConflictError);
    await expect(
      repository.acquire(
        lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a04", {
          leaseType: "reindex",
          virtualPath: "/sources/uploads/architecture-v2.md",
        }),
      ),
    ).resolves.toMatchObject({ leaseType: "reindex" });
  });

  it("releases leases and ignores expired or released mutation leases for conflicts", async () => {
    const repository = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a01", {
        expiresAt: "2026-05-27T09:59:00.000Z",
        leaseType: "publish",
      }),
    );
    await expect(
      repository.acquire(
        lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a02", {
          acquiredAt: "2026-05-27T10:00:00.000Z",
          leaseType: "delete",
        }),
      ),
    ).resolves.toMatchObject({ leaseType: "delete" });
    await expect(
      repository.release({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a02",
        status: "released",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T10:01:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "released" });
    await expect(
      repository.acquire(
        lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a03", {
          acquiredAt: "2026-05-27T10:02:00.000Z",
          leaseType: "publish",
        }),
      ),
    ).resolves.toMatchObject({ leaseType: "publish" });
  });

  it("lists expired leases with stable cursors and tenant scoping", async () => {
    const repository = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 2,
    });
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a01", {
        expiresAt: "2026-05-27T10:00:00.000Z",
      }),
    );
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a02", {
        expiresAt: "2026-05-27T10:01:00.000Z",
        virtualPath: "/sources/uploads/design.md",
      }),
    );
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a03", {
        expiresAt: "2026-05-27T10:02:00.000Z",
        virtualPath: "/sources/uploads/roadmap.md",
      }),
    );
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a04", {
        expiresAt: "2026-05-27T09:00:00.000Z",
        tenantId: "tenant-2",
        virtualPath: "/sources/uploads/other.md",
      }),
    );

    const first = await repository.listExpired({
      limit: 1,
      now: "2026-05-27T10:03:00.000Z",
      tenantId: "tenant-1",
    });
    expect(first.items.map((item) => item.id)).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"]);
    expect(first.nextCursor).toBeDefined();
    await expect(
      repository.listExpired({
        cursor: first.nextCursor,
        limit: 2,
        now: "2026-05-27T10:03:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [
        { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a02" },
        { id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a03" },
      ],
    });
  });

  it("lists active leases by knowledge space and skips released or expired leases", async () => {
    const repository = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 2,
    });
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a01", {
        expiresAt: "2026-05-27T10:30:00.000Z",
      }),
    );
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a02", {
        expiresAt: "2026-05-27T10:31:00.000Z",
        virtualPath: "/sources/uploads/design.md",
      }),
    );
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a03", {
        expiresAt: "2026-05-27T09:30:00.000Z",
        virtualPath: "/sources/uploads/expired.md",
      }),
    );
    await repository.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a04", {
        expiresAt: "2026-05-27T10:32:00.000Z",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        virtualPath: "/sources/uploads/other-space.md",
      }),
    );
    await repository.release({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a02",
      status: "released",
      tenantId: "tenant-1",
      updatedAt: "2026-05-27T10:00:00.000Z",
    });

    await expect(
      repository.listActive({
        knowledgeSpaceId: SPACE_ID,
        limit: 2,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01" }],
    });
  });

  it("rejects invalid bounds, list limits, capacity overflow, and invalid cursors", async () => {
    expect(() =>
      createInMemoryKnowledgeFsLeaseRepository({ maxLeases: 0, maxListLimit: 1 }),
    ).toThrow("KnowledgeFS lease repository maxLeases must be at least 1");

    const repository = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 1,
      maxListLimit: 1,
    });
    await expect(
      repository.listExpired({
        limit: 2,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(KnowledgeFsLeaseListLimitExceededError);
    await expect(
      repository.listExpired({
        cursor: "not-base64-json",
        limit: 1,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("KnowledgeFS lease cursor is invalid");
    await repository.acquire(lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"));
    await expect(
      repository.acquire(
        lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4a02", {
          virtualPath: "/sources/uploads/design.md",
        }),
      ),
    ).rejects.toBeInstanceOf(KnowledgeFsLeaseCapacityExceededError);
  });
});

describe.each(["postgres", "tidb"] as const)(
  "createDatabaseKnowledgeFsLeaseRepository (%s)",
  (dialect) => {
    it("binds acquisition to a durable session and atomically rejects active deletion", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "insert" ? 1 : 0 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeFsLeaseRepository({
        database,
        maxListLimit: 10,
      });
      const input = lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4b01");

      await expect(repository.acquire(input)).resolves.toEqual(input);
      const insert = calls.find((call) => call.operation === "insert");
      expect(insert?.sql).toContain("knowledge_fs_sessions");
      expect(insert?.sql).toContain("deletion_jobs");
      expect(insert?.sql).toContain("active_slot");
      expect(insert?.sql).toContain("lifecycle_state");
      expect(calls.find((call) => call.sql.includes("FOR UPDATE"))?.tableName).toBe(
        "knowledge_spaces",
      );

      const blocked = createDatabaseKnowledgeFsLeaseRepository({
        database: createSchemaDatabaseAdapter({
          executor: async () => ({ rows: [], rowsAffected: 0 }),
          kind: dialect,
          transaction: async (callback) =>
            callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
        }),
        maxListLimit: 10,
      });
      await expect(blocked.acquire(input)).rejects.toBeInstanceOf(
        KnowledgeFsLeaseDeletionFenceActiveError,
      );
    });
  },
);

function lease(id: string, overrides: Partial<KnowledgeFsLease> = {}): KnowledgeFsLease {
  return KnowledgeFsLeaseSchema.parse({
    acquiredAt: "2026-05-27T09:55:00.000Z",
    expiresAt: "2026-05-27T10:05:00.000Z",
    heartbeatAt: "2026-05-27T09:55:00.000Z",
    id,
    knowledgeSpaceId: SPACE_ID,
    leaseType: "publish",
    metadata: {},
    sessionId: SESSION_ID,
    status: "active",
    targetId: TARGET_ID,
    targetType: "document-asset",
    targetVersion: 1,
    tenantId: "tenant-1",
    updatedAt: "2026-05-27T09:55:00.000Z",
    virtualPath: "/sources/uploads/architecture.md",
    ...overrides,
  });
}
