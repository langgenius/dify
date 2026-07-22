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

  it("deletes and releases by tenant while paginating active leases with stable cursors", async () => {
    expect(() =>
      createInMemoryKnowledgeFsLeaseRepository({ maxLeases: 1, maxListLimit: 0 }),
    ).toThrow("KnowledgeFS lease repository maxListLimit must be at least 1");

    const repository = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 4,
      maxListLimit: 2,
    });
    const firstId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01";
    const secondId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a02";
    await repository.acquire(
      lease(firstId, {
        expiresAt: "2026-05-27T10:30:00.000Z",
        virtualPath: "/sources/uploads/first.md",
      }),
    );
    await repository.acquire(
      lease(secondId, {
        expiresAt: "2026-05-27T10:31:00.000Z",
        virtualPath: "/sources/uploads/second.md",
      }),
    );

    const firstPage = await repository.listActive({
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      now: "2026-05-27T10:00:00.000Z",
      tenantId: "tenant-1",
    });
    expect(firstPage).toMatchObject({ items: [{ id: firstId }] });
    expect(firstPage.nextCursor).toBeDefined();
    await expect(
      repository.listActive({
        cursor: firstPage.nextCursor,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ items: [{ id: secondId }] });
    await expect(
      repository.listActive({
        knowledgeSpaceId: SPACE_ID,
        limit: 3,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(KnowledgeFsLeaseListLimitExceededError);

    await expect(
      repository.release({
        id: firstId,
        status: "failed",
        tenantId: "tenant-2",
        updatedAt: "2026-05-27T10:01:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(repository.delete({ id: firstId, tenantId: "tenant-2" })).resolves.toBeNull();
    await expect(repository.delete({ id: firstId, tenantId: "tenant-1" })).resolves.toMatchObject({
      id: firstId,
    });
    await expect(repository.get({ id: firstId, tenantId: "tenant-1" })).resolves.toBeNull();
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

    it("persists heartbeat/release/delete and paginates active and expired leases", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const firstId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4b01";
      const secondId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4b02";
      let current: Record<string, unknown> | null = leaseRow(firstId);
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName !== "knowledge_fs_leases") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "delete") {
          current = null;
          return { rows: [], rowsAffected: 1 };
        }
        if (input.operation === "update") {
          if (!current) return { rows: [], rowsAffected: 0 };
          if (input.sql.includes("expires_at")) {
            current = {
              ...current,
              expires_at: input.params[0],
              heartbeat_at: input.params[1],
              updated_at: input.params[2],
            };
          } else {
            current = {
              ...current,
              status: input.params[0],
              updated_at: input.params[1],
            };
          }
          return {
            rows: dialect === "postgres" ? [current] : [],
            rowsAffected: 1,
          };
        }
        if (input.sql.includes("ORDER BY")) {
          const active = input.sql.includes("status") && input.sql.includes("active");
          return {
            rows: [
              leaseRow(firstId, {
                expiresAt: active ? "2026-05-27T10:30:00.000Z" : "2026-05-27T09:30:00.000Z",
              }),
              leaseRow(secondId, {
                expiresAt: active ? "2026-05-27T10:31:00.000Z" : "2026-05-27T09:31:00.000Z",
                targetVersion: null,
                virtualPath: "/sources/uploads/second.md",
              }),
            ],
            rowsAffected: 0,
          };
        }
        if (
          input.sql.startsWith("SELECT") &&
          !input.sql.startsWith("SELECT *") &&
          input.sql.includes("knowledge_space_id")
        ) {
          return {
            rows: current ? [{ knowledge_space_id: current.knowledge_space_id }] : [],
            rowsAffected: 0,
          };
        }
        return { rows: current ? [current] : [], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeFsLeaseRepository({
        database,
        maxListLimit: 2,
      });

      await expect(repository.get({ id: firstId, tenantId: "tenant-1" })).resolves.toMatchObject({
        id: firstId,
      });
      await expect(
        repository.heartbeat({
          expiresAt: "2026-05-27T10:45:00.000Z",
          heartbeatAt: "2026-05-27T10:05:00.000Z",
          id: firstId,
          tenantId: "tenant-1",
          updatedAt: "2026-05-27T10:05:00.000Z",
        }),
      ).resolves.toMatchObject({ expiresAt: "2026-05-27T10:45:00.000Z" });
      await expect(
        repository.release({
          id: firstId,
          status: "released",
          tenantId: "tenant-1",
          updatedAt: "2026-05-27T10:06:00.000Z",
        }),
      ).resolves.toMatchObject({ status: "released" });

      const active = await repository.listActive({
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      });
      expect(active.items).toHaveLength(1);
      expect(active.nextCursor).toBeDefined();
      await expect(
        repository.listActive({
          cursor: active.nextCursor,
          knowledgeSpaceId: SPACE_ID,
          limit: 1,
          now: "2026-05-27T10:00:00.000Z",
          tenantId: "tenant-1",
        }),
      ).resolves.toMatchObject({ items: [{ id: firstId }] });
      const expired = await repository.listExpired({
        limit: 1,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      });
      expect(expired.nextCursor).toBeDefined();
      await expect(
        repository.listExpired({
          cursor: expired.nextCursor,
          limit: 1,
          now: "2026-05-27T10:00:00.000Z",
          tenantId: "tenant-1",
        }),
      ).resolves.toMatchObject({ items: [{ id: firstId }] });
      await expect(
        repository.listExpired({
          limit: 3,
          now: "2026-05-27T10:00:00.000Z",
          tenantId: "tenant-1",
        }),
      ).rejects.toBeInstanceOf(KnowledgeFsLeaseListLimitExceededError);

      await expect(repository.delete({ id: firstId, tenantId: "tenant-1" })).resolves.toMatchObject(
        {
          id: firstId,
        },
      );
      await expect(repository.delete({ id: firstId, tenantId: "tenant-1" })).resolves.toBeNull();
      await expect(
        repository.heartbeat({
          expiresAt: "2026-05-27T11:00:00.000Z",
          heartbeatAt: "2026-05-27T11:00:00.000Z",
          id: firstId,
          tenantId: "tenant-1",
          updatedAt: "2026-05-27T11:00:00.000Z",
        }),
      ).resolves.toBeNull();
      expect(calls.some((call) => call.sql.includes("deletion_jobs"))).toBe(true);
    });

    it("rejects a conflicting database mutation lease while allowing a read lease", async () => {
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (
          input.tableName === "knowledge_fs_leases" &&
          input.operation === "select" &&
          input.sql.includes("id") &&
          input.sql.includes("<>")
        ) {
          return {
            rows: [
              leaseRow("018f0d60-7a49-7cc2-9c1b-5b36f18f4b09", {
                leaseType: "delete",
              }),
            ],
            rowsAffected: 0,
          };
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
        maxListLimit: 2,
      });

      await expect(
        repository.acquire(lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4b01", { leaseType: "publish" })),
      ).rejects.toBeInstanceOf(KnowledgeFsLeaseConflictError);
      await expect(
        repository.acquire(lease("018f0d60-7a49-7cc2-9c1b-5b36f18f4b02", { leaseType: "read" })),
      ).resolves.toMatchObject({ leaseType: "read" });
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

function leaseRow(
  id: string,
  overrides: {
    readonly expiresAt?: string;
    readonly leaseType?: KnowledgeFsLease["leaseType"];
    readonly targetVersion?: number | null;
    readonly virtualPath?: string;
  } = {},
): Record<string, unknown> {
  return {
    acquired_at: "2026-05-27T09:55:00.000Z",
    expires_at: overrides.expiresAt ?? "2026-05-27T10:05:00.000Z",
    heartbeat_at: "2026-05-27T09:55:00.000Z",
    id,
    knowledge_space_id: SPACE_ID,
    lease_type: overrides.leaseType ?? "publish",
    metadata: {},
    session_id: SESSION_ID,
    status: "active",
    target_id: TARGET_ID,
    target_type: "document-asset",
    target_version: "targetVersion" in overrides ? overrides.targetVersion : 1,
    tenant_id: "tenant-1",
    updated_at: "2026-05-27T09:55:00.000Z",
    virtual_path: overrides.virtualPath ?? "/sources/uploads/architecture.md",
  };
}
