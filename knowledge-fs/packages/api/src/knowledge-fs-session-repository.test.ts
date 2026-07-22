import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type KnowledgeFsSession,
  KnowledgeFsSessionSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeFsSessionCapacityExceededError,
  KnowledgeFsSessionDeletionFenceActiveError,
  KnowledgeFsSessionListLimitExceededError,
  createDatabaseKnowledgeFsSessionRepository,
  createInMemoryKnowledgeFsSessionRepository,
} from "./knowledge-fs-session-repository";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

describe("createInMemoryKnowledgeFsSessionRepository", () => {
  it("creates clone-isolated sessions and updates heartbeat by tenant scope", async () => {
    const repository = createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 10,
      maxSessions: 10,
    });
    const created = await repository.create(session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a01"));
    created.metadata.mutated = true;

    await expect(
      repository.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      metadata: {},
    });
    await expect(
      repository.heartbeat({
        expiresAt: "2026-05-27T10:10:00.000Z",
        heartbeatAt: "2026-05-27T10:05:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
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
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
        tenantId: "tenant-2",
        updatedAt: "2026-05-27T10:15:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("lists expired sessions with stable cursors and tenant scoping", async () => {
    const repository = createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 2,
      maxSessions: 10,
    });
    await repository.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a01", {
        expiresAt: "2026-05-27T10:00:00.000Z",
      }),
    );
    await repository.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a02", {
        expiresAt: "2026-05-27T10:01:00.000Z",
      }),
    );
    await repository.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a03", {
        expiresAt: "2026-05-27T10:02:00.000Z",
      }),
    );
    await repository.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a04", {
        expiresAt: "2026-05-27T09:00:00.000Z",
        tenantId: "tenant-2",
      }),
    );

    const first = await repository.listExpired({
      limit: 2,
      now: "2026-05-27T10:01:30.000Z",
      tenantId: "tenant-1",
    });
    expect(first.items.map((item) => item.id)).toEqual([
      "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02",
    ]);
    expect(first.nextCursor).toBeUndefined();

    const all = await repository.listExpired({
      limit: 1,
      now: "2026-05-27T10:03:00.000Z",
      tenantId: "tenant-1",
    });
    expect(all.nextCursor).toBeDefined();
    await expect(
      repository.listExpired({
        cursor: all.nextCursor,
        limit: 1,
        now: "2026-05-27T10:03:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02" }],
    });
  });

  it("lists active sessions by knowledge space with explicit bounds", async () => {
    const repository = createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 2,
      maxSessions: 10,
    });
    await repository.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a01", {
        expiresAt: "2026-05-27T10:30:00.000Z",
      }),
    );
    await repository.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a02", {
        expiresAt: "2026-05-27T10:31:00.000Z",
      }),
    );
    await repository.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a03", {
        expiresAt: "2026-05-27T10:32:00.000Z",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      }),
    );

    const first = await repository.listActive({
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      now: "2026-05-27T10:00:00.000Z",
      tenantId: "tenant-1",
    });

    expect(first.items.map((item) => item.id)).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f3a01"]);
    expect(first.nextCursor).toBeDefined();
    await expect(
      repository.listActive({
        cursor: first.nextCursor,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a02" }],
    });
  });

  it("rejects invalid bounds, list limits, and capacity overflow", async () => {
    expect(() =>
      createInMemoryKnowledgeFsSessionRepository({ maxListLimit: 1, maxSessions: 0 }),
    ).toThrow("KnowledgeFS session repository maxSessions must be at least 1");

    const repository = createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 1,
      maxSessions: 1,
    });
    await expect(
      repository.listExpired({
        limit: 2,
        now: "2026-05-27T10:00:00.000Z",
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(KnowledgeFsSessionListLimitExceededError);
    await repository.create(session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a01"));
    await expect(
      repository.create(session("018f0d60-7a49-7cc2-9c1b-5b36f18f3a02")),
    ).rejects.toBeInstanceOf(KnowledgeFsSessionCapacityExceededError);
  });
});

describe.each(["postgres", "tidb"] as const)(
  "createDatabaseKnowledgeFsSessionRepository (%s)",
  (dialect) => {
    it("atomically rejects active deletion and hides reads while a deletion is active", async () => {
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
      const repository = createDatabaseKnowledgeFsSessionRepository({
        database,
        maxListLimit: 10,
      });
      const input = session("018f0d60-7a49-7cc2-9c1b-5b36f18f3b01");

      await expect(repository.create(input)).resolves.toEqual(input);
      await expect(repository.get({ id: input.id, tenantId: input.tenantId })).resolves.toBeNull();
      const insert = calls.find((call) => call.operation === "insert");
      expect(insert?.sql).toContain("VALUES");
      expect(calls.find((call) => call.sql.includes("FOR UPDATE"))?.sql).toContain(
        "lifecycle_state",
      );
      expect(calls.find((call) => call.tableName === "deletion_jobs")?.sql).toContain(
        "active_slot",
      );
      const read = calls.find(
        (call) => call.operation === "select" && call.tableName === "knowledge_fs_sessions",
      );
      expect(read?.sql).toContain("NOT EXISTS");
      expect(read?.sql).toContain("active_slot");

      const blocked = createDatabaseKnowledgeFsSessionRepository({
        database: createSchemaDatabaseAdapter({
          executor: async () => ({ rows: [], rowsAffected: 0 }),
          kind: dialect,
          transaction: async (callback) =>
            callback({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
        }),
        maxListLimit: 10,
      });
      await expect(blocked.create(input)).rejects.toBeInstanceOf(
        KnowledgeFsSessionDeletionFenceActiveError,
      );
    });
  },
);

function session(id: string, overrides: Partial<KnowledgeFsSession> = {}): KnowledgeFsSession {
  return KnowledgeFsSessionSchema.parse({
    clientKind: "api",
    clientVersion: "1.0.0",
    consistencyClass: "path-consistent",
    createdAt: "2026-05-27T09:55:00.000Z",
    expiresAt: "2026-05-27T10:00:00.000Z",
    heartbeatAt: "2026-05-27T09:55:00.000Z",
    id,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    permissionSnapshot: ["knowledge-spaces:read"],
    subject: {
      scopes: ["knowledge-spaces:read"],
      subjectId: "subject-1",
      tenantId: overrides.tenantId ?? "tenant-1",
    },
    tenantId: "tenant-1",
    updatedAt: "2026-05-27T09:55:00.000Z",
    ...overrides,
  });
}
