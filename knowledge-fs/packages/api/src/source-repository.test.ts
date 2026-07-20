import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  SourceCapacityExceededError,
  SourceVersionConflictError,
  createDatabaseSourceRepository,
  createInMemorySourceRepository,
} from "./source-repository";

const SPACE_A = "10000000-0000-4000-8000-000000000001";
const SPACE_B = "10000000-0000-4000-8000-000000000002";

function fixedId(seed: number): () => string {
  let index = seed;

  return () => {
    const suffix = (index++).toString(16).padStart(12, "0");

    return `00000000-0000-4000-8000-${suffix}`;
  };
}

describe("createInMemorySourceRepository", () => {
  it("creates, gets, and updates sources scoped by knowledge space", async () => {
    const repository = createInMemorySourceRepository({
      generateId: fixedId(1),
      maxSources: 10,
      now: () => "2026-07-03T00:00:00.000Z",
    });

    const created = await repository.create({
      knowledgeSpaceId: SPACE_A,
      metadata: { provider: "firecrawl" },
      name: "Docs crawl",
      type: "web",
      uri: "https://example.com",
    });

    expect(created).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      knowledgeSpaceId: SPACE_A,
      metadata: { provider: "firecrawl" },
      name: "Docs crawl",
      permissionScope: [],
      status: "active",
      type: "web",
      uri: "https://example.com",
    });

    // Cross-space isolation: not visible from another space.
    await expect(repository.get({ id: created.id, knowledgeSpaceId: SPACE_B })).resolves.toBeNull();
    await expect(
      repository.get({ id: created.id, knowledgeSpaceId: SPACE_A }),
    ).resolves.toMatchObject({ id: created.id });

    const updated = await repository.update({
      id: created.id,
      knowledgeSpaceId: SPACE_A,
      metadata: { provider: "firecrawl", sync: { lastRunAt: "2026-07-03T01:00:00.000Z" } },
      status: "syncing",
    });
    expect(updated).toMatchObject({
      metadata: { sync: { lastRunAt: "2026-07-03T01:00:00.000Z" } },
      status: "syncing",
    });
    // Update from a foreign space is a no-op returning null.
    await expect(
      repository.update({ id: created.id, knowledgeSpaceId: SPACE_B, status: "error" }),
    ).resolves.toBeNull();
  });

  it("paginates a space's sources by id cursor and enforces capacity", async () => {
    const repository = createInMemorySourceRepository({ generateId: fixedId(1), maxSources: 2 });

    await repository.create({ knowledgeSpaceId: SPACE_A, name: "One", type: "web", uri: "a" });
    await repository.create({ knowledgeSpaceId: SPACE_A, name: "Two", type: "web", uri: "b" });
    await expect(
      repository.create({ knowledgeSpaceId: SPACE_A, name: "Three", type: "web", uri: "c" }),
    ).rejects.toBeInstanceOf(SourceCapacityExceededError);

    const firstPage = await repository.list({ knowledgeSpaceId: SPACE_A, limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await repository.list({
      cursor: firstPage.nextCursor,
      knowledgeSpaceId: SPACE_A,
      limit: 1,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  });
});

describe("createDatabaseSourceRepository", () => {
  it("inserts a source row with json metadata and permission scope", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 1 };
      },
      kind: "postgres",
    });
    const repository = createDatabaseSourceRepository({
      database,
      generateId: fixedId(1),
      now: () => "2026-07-03T00:00:00.000Z",
    });

    const created = await repository.create({
      knowledgeSpaceId: SPACE_A,
      metadata: { provider: "firecrawl" },
      name: "Docs crawl",
      permissionScope: ["tenant:tenant-1"],
      type: "web",
      uri: "https://example.com",
    });

    expect(created).toMatchObject({
      knowledgeSpaceId: SPACE_A,
      name: "Docs crawl",
      permissionScope: ["tenant:tenant-1"],
      type: "web",
      uri: "https://example.com",
    });
    const insert = calls[0];
    expect(insert?.operation).toBe("insert");
    expect(insert?.sql).toContain('INSERT INTO "sources"');
    expect(insert?.params).toContain(JSON.stringify({ provider: "firecrawl" }));
    expect(insert?.params).toContain(JSON.stringify(["tenant:tenant-1"]));
    expect(insert?.params).toContain("https://example.com");
  });

  it("maps a database row back to a Source", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({
        rows: [
          {
            created_at: "2026-07-03T00:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000001",
            knowledge_space_id: SPACE_A,
            metadata: JSON.stringify({ provider: "firecrawl" }),
            name: "Docs crawl",
            permission_scope: JSON.stringify(["tenant:tenant-1"]),
            status: "active",
            type: "web",
            updated_at: "2026-07-03T00:00:00.000Z",
            uri: "https://example.com",
            version: 1,
          },
        ],
        rowsAffected: 1,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseSourceRepository({ database });

    await expect(
      repository.get({ id: "00000000-0000-4000-8000-000000000001", knowledgeSpaceId: SPACE_A }),
    ).resolves.toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      metadata: { provider: "firecrawl" },
      permissionScope: ["tenant:tenant-1"],
      status: "active",
      type: "web",
      uri: "https://example.com",
    });
    // Ordinary reads never surface a durable-deletion target.
    // The fake deliberately returns a row regardless of SQL so the assertion covers the query.
    const calls: DatabaseExecuteInput[] = [];
    const filteredRepository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return { rows: [], rowsAffected: 0 };
        },
        kind: "postgres",
      }),
    });
    await filteredRepository.get({ id: "source-1", knowledgeSpaceId: SPACE_A });
    expect(calls[0]?.sql).toContain("\"status\" <> 'deleting'");
    await filteredRepository.getForDeletion({ id: "source-1", knowledgeSpaceId: SPACE_A });
    expect(calls[1]?.params).toEqual(["source-1", SPACE_A]);
    expect(calls[1]?.sql).not.toContain("<> 'deleting'");
  });

  it.each(["postgres", "tidb"] as const)(
    "maps the lifecycle-only deleting status through getForDeletion for %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createDatabaseSourceRepository({
        database: createSchemaDatabaseAdapter({
          executor: async (input) => {
            calls.push(input);
            return {
              rows: [
                {
                  created_at: "2026-07-03T00:00:00.000Z",
                  id: "00000000-0000-4000-8000-000000000001",
                  knowledge_space_id: SPACE_A,
                  metadata: JSON.stringify({}),
                  name: "Deleting source",
                  permission_scope: JSON.stringify(["tenant:tenant-1"]),
                  status: "deleting",
                  type: "web",
                  updated_at: "2026-07-03T00:00:00.000Z",
                  uri: "https://example.com",
                  version: 2,
                },
              ],
              rowsAffected: 1,
            };
          },
          kind: dialect,
        }),
      });

      await expect(
        repository.getForDeletion({
          id: "00000000-0000-4000-8000-000000000001",
          knowledgeSpaceId: SPACE_A,
        }),
      ).resolves.toMatchObject({ status: "deleting", version: 2 });
      expect(calls[0]?.params).toEqual(["00000000-0000-4000-8000-000000000001", SPACE_A]);
      expect(calls[0]?.sql).not.toContain("<> 'deleting'");
    },
  );
});

describe("listAll", () => {
  it("pages across knowledge spaces in id order (in-memory)", async () => {
    const repository = createInMemorySourceRepository({
      generateId: fixedId(1),
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    await repository.create({ knowledgeSpaceId: SPACE_A, name: "a", type: "web", uri: "u" });
    await repository.create({ knowledgeSpaceId: SPACE_B, name: "b", type: "web", uri: "u" });
    await repository.create({ knowledgeSpaceId: SPACE_A, name: "c", type: "web", uri: "u" });

    const first = await repository.listAll({ limit: 2 });
    expect(first.items.map((source) => source.name)).toEqual(["a", "b"]);
    expect(first.nextCursor).toBeDefined();

    const second = await repository.listAll({ cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((source) => source.name)).toEqual(["c"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("issues an unscoped id-ordered SELECT (database)", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return { rows: [], rowsAffected: 0 };
        },
        kind: "postgres",
      }),
    });

    await repository.listAll({ limit: 5 });
    expect(calls[0]?.sql).toContain(
      'FROM "sources" WHERE "status" <> \'deleting\' ORDER BY "id" ASC LIMIT $1;',
    );
    expect(calls[0]?.params).toEqual([6]);

    await repository.listAll({ cursor: { id: "abc" }, limit: 5 });
    expect(calls[1]?.sql).toContain('WHERE "status" <> \'deleting\' AND "id" > $1');
    expect(calls[1]?.params).toEqual(["abc", 6]);
  });
});

describe("claimForSync", () => {
  it("claims active sources, refuses fresh syncing claims, re-claims stale ones (in-memory)", async () => {
    const repository = createInMemorySourceRepository({
      generateId: fixedId(1),
      maxSources: 10,
      now: () => "2026-07-08T02:00:00.000Z",
    });
    const source = await repository.create({
      knowledgeSpaceId: SPACE_A,
      name: "a",
      type: "web",
      uri: "u",
    });

    // Active -> claim wins and transitions to syncing.
    const claimed = await repository.claimForSync({
      id: source.id,
      knowledgeSpaceId: SPACE_A,
      now: "2026-07-08T02:00:00.000Z",
      staleBefore: "2026-07-08T01:30:00.000Z",
    });
    expect(claimed?.status).toBe("syncing");

    // Fresh syncing claim (updatedAt 02:00 >= staleBefore) -> refused.
    await expect(
      repository.claimForSync({
        id: source.id,
        knowledgeSpaceId: SPACE_A,
        now: "2026-07-08T02:01:00.000Z",
        staleBefore: "2026-07-08T01:31:00.000Z",
      }),
    ).resolves.toBeNull();

    // Stale syncing claim (staleBefore after updatedAt) -> re-claimable.
    const stolen = await repository.claimForSync({
      id: source.id,
      knowledgeSpaceId: SPACE_A,
      now: "2026-07-08T03:00:00.000Z",
      staleBefore: "2026-07-08T02:30:00.000Z",
    });
    expect(stolen?.status).toBe("syncing");
    expect(stolen?.updatedAt).toBe("2026-07-08T03:00:00.000Z");
  });

  it("claims via a single conditional UPDATE (database)", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return { rows: [], rowsAffected: 0 };
        },
        kind: "postgres",
      }),
    });

    await expect(
      repository.claimForSync({
        id: "source-1",
        knowledgeSpaceId: SPACE_A,
        now: "2026-07-08T02:00:00.000Z",
        staleBefore: "2026-07-08T01:30:00.000Z",
      }),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('UPDATE "sources" SET "status" = $1, "updated_at" = $2');
    expect(calls[0]?.sql).toContain('("status" <> $5 OR "updated_at" < $6)');
    expect(calls[0]?.sql).toContain("\"status\" <> 'deleting'");
    expect(calls[0]?.sql).toContain('"deletion_job_id" IS NULL');
    expect(calls[0]?.sql).toContain("RETURNING *");
    expect(calls[0]?.params).toEqual([
      "syncing",
      "2026-07-08T02:00:00.000Z",
      "source-1",
      SPACE_A,
      "syncing",
      "2026-07-08T01:30:00.000Z",
    ]);
  });
});

describe("repository bounds and lookup misses", () => {
  it("rejects maxSources < 1 and invalid list limits (in-memory)", async () => {
    expect(() => createInMemorySourceRepository({ maxSources: 0 })).toThrow(
      "Source repository maxSources must be at least 1",
    );

    const repository = createInMemorySourceRepository({ generateId: fixedId(1), maxSources: 2 });
    await expect(repository.list({ knowledgeSpaceId: SPACE_A, limit: 0 })).rejects.toThrow(
      "Source list limit must be at least 1",
    );
    await expect(repository.listAll({ limit: 1.5 })).rejects.toThrow(
      "Source list limit must be at least 1",
    );
  });

  it("claimForSync returns null for unknown ids and foreign spaces (in-memory)", async () => {
    const repository = createInMemorySourceRepository({
      generateId: fixedId(1),
      maxSources: 2,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    const created = await repository.create({
      knowledgeSpaceId: SPACE_A,
      name: "a",
      type: "web",
      uri: "u",
    });
    const claimWindow = {
      now: "2026-07-08T01:00:00.000Z",
      staleBefore: "2026-07-08T00:30:00.000Z",
    };

    await expect(
      repository.claimForSync({ ...claimWindow, id: "missing", knowledgeSpaceId: SPACE_A }),
    ).resolves.toBeNull();
    await expect(
      repository.claimForSync({ ...claimWindow, id: created.id, knowledgeSpaceId: SPACE_B }),
    ).resolves.toBeNull();
  });
});

function sourceRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-07-03T00:00:00.000Z",
    id,
    knowledge_space_id: SPACE_A,
    metadata: JSON.stringify({}),
    name: "a",
    permission_scope: JSON.stringify([]),
    status: "active",
    type: "web",
    updated_at: "2026-07-03T00:00:00.000Z",
    uri: "u",
    version: 1,
    ...overrides,
  };
}

describe("createDatabaseSourceRepository dialect and row-shape branches", () => {
  const ROW_ID = "00000000-0000-4000-8000-000000000001";

  it("maps the RETURNING row of a winning postgres claim", async () => {
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async () => ({
          rows: [sourceRow(ROW_ID, { status: "syncing", version: 2 })],
          rowsAffected: 1,
        }),
        kind: "postgres",
      }),
    });

    await expect(
      repository.claimForSync({
        id: ROW_ID,
        knowledgeSpaceId: SPACE_A,
        now: "2026-07-08T02:00:00.000Z",
        staleBefore: "2026-07-08T01:30:00.000Z",
      }),
    ).resolves.toMatchObject({ id: ROW_ID, status: "syncing", version: 2 });
  });

  it("claims via rowsAffected plus a follow-up get on tidb (no RETURNING)", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (input.operation === "select") {
            return {
              rows: [sourceRow(ROW_ID, { status: "syncing", version: 2 })],
              rowsAffected: 1,
            };
          }

          return { rows: [], rowsAffected: 1 };
        },
        kind: "tidb",
      }),
    });

    await expect(
      repository.claimForSync({
        id: ROW_ID,
        knowledgeSpaceId: SPACE_A,
        now: "2026-07-08T02:00:00.000Z",
        staleBefore: "2026-07-08T01:30:00.000Z",
      }),
    ).resolves.toMatchObject({ id: ROW_ID, status: "syncing" });
    expect(calls[0]?.sql).not.toContain("RETURNING");
    expect(calls[0]?.sql).toContain("?");
    expect(calls[1]?.operation).toBe("select");
  });

  it("returns null when the tidb claim loses (no rows affected)", async () => {
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [], rowsAffected: 0 }),
        kind: "tidb",
      }),
    });

    await expect(
      repository.claimForSync({
        id: ROW_ID,
        knowledgeSpaceId: SPACE_A,
        now: "2026-07-08T02:00:00.000Z",
        staleBefore: "2026-07-08T01:30:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("prefers the RETURNING row on postgres create and the local build on tidb", async () => {
    const postgresRepository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async () => ({
          rows: [sourceRow(ROW_ID, { name: "normalized-by-db" })],
          rowsAffected: 1,
        }),
        kind: "postgres",
      }),
      generateId: fixedId(1),
      now: () => "2026-07-03T00:00:00.000Z",
    });
    await expect(
      postgresRepository.create({ knowledgeSpaceId: SPACE_A, name: "a", type: "web", uri: "u" }),
    ).resolves.toMatchObject({ name: "normalized-by-db" });

    const tidbCalls: DatabaseExecuteInput[] = [];
    const tidbRepository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          tidbCalls.push(input);

          return { rows: [], rowsAffected: 1 };
        },
        kind: "tidb",
      }),
      generateId: fixedId(1),
      now: () => "2026-07-03T00:00:00.000Z",
    });
    await expect(
      tidbRepository.create({ knowledgeSpaceId: SPACE_A, name: "local", type: "web", uri: "u" }),
    ).resolves.toMatchObject({ name: "local", version: 1 });
    expect(tidbCalls[0]?.sql).not.toContain("RETURNING");
  });

  it("returns null from get when the row is missing", async () => {
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [], rowsAffected: 0 }),
        kind: "postgres",
      }),
    });

    await expect(repository.get({ id: ROW_ID, knowledgeSpaceId: SPACE_A })).resolves.toBeNull();
  });

  it("returns a nextCursor when listAll reads past the limit", async () => {
    const second = "00000000-0000-4000-8000-000000000002";
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async () => ({
          rows: [sourceRow(ROW_ID), sourceRow(second)],
          rowsAffected: 2,
        }),
        kind: "postgres",
      }),
    });

    const page = await repository.listAll({ limit: 1 });
    expect(page.items.map((source) => source.id)).toEqual([ROW_ID]);
    expect(page.nextCursor).toEqual({ id: ROW_ID });
  });

  it("updates metadata and status without a name or expectedVersion", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (input.operation === "select") {
            return { rows: [sourceRow(ROW_ID)], rowsAffected: 1 };
          }

          return { rows: [], rowsAffected: 1 };
        },
        kind: "postgres",
      }),
      now: () => "2026-07-08T00:00:00.000Z",
    });

    await expect(
      repository.update({
        id: ROW_ID,
        knowledgeSpaceId: SPACE_A,
        metadata: { note: "n" },
        status: "disabled",
      }),
    ).resolves.toMatchObject({
      metadata: { note: "n" },
      name: "a",
      status: "disabled",
      version: 2,
    });
    const update = calls.find((call) => call.operation === "update");
    expect(update?.sql).not.toContain('AND "version"');
    expect(update?.params).toEqual([
      "a",
      "disabled",
      JSON.stringify({ note: "n" }),
      2,
      "2026-07-08T00:00:00.000Z",
      ROW_ID,
      SPACE_A,
    ]);
  });

  it("returns null for a missing row and conflicts before writing on a version mismatch", async () => {
    const missingCalls: DatabaseExecuteInput[] = [];
    const missingRepository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          missingCalls.push(input);

          return { rows: [], rowsAffected: 0 };
        },
        kind: "postgres",
      }),
    });
    await expect(
      missingRepository.update({ id: ROW_ID, knowledgeSpaceId: SPACE_A, name: "b" }),
    ).resolves.toBeNull();
    expect(missingCalls).toHaveLength(1);
    expect(missingCalls[0]?.operation).toBe("select");

    const staleCalls: DatabaseExecuteInput[] = [];
    const staleRepository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          staleCalls.push(input);

          return { rows: [sourceRow(ROW_ID, { version: 4 })], rowsAffected: 1 };
        },
        kind: "postgres",
      }),
    });
    await expect(
      staleRepository.update({
        expectedVersion: 3,
        id: ROW_ID,
        knowledgeSpaceId: SPACE_A,
        name: "b",
      }),
    ).rejects.toThrow(SourceVersionConflictError);
    // The stale expectedVersion is rejected from the pre-read, before any UPDATE is issued.
    expect(staleCalls.every((call) => call.operation === "select")).toBe(true);
  });
});

describe("optimistic concurrency (version + CAS)", () => {
  it("starts at version 1 and bumps on update and claim (in-memory)", async () => {
    const repository = createInMemorySourceRepository({
      generateId: fixedId(1),
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    const created = await repository.create({
      knowledgeSpaceId: SPACE_A,
      name: "a",
      type: "web",
      uri: "u",
    });
    expect(created.version).toBe(1);

    const updated = await repository.update({
      id: created.id,
      knowledgeSpaceId: SPACE_A,
      name: "b",
    });
    expect(updated?.version).toBe(2);

    const claimed = await repository.claimForSync({
      id: created.id,
      knowledgeSpaceId: SPACE_A,
      now: "2026-07-08T01:00:00.000Z",
      staleBefore: "2026-07-08T00:30:00.000Z",
    });
    expect(claimed?.version).toBe(3);
  });

  it("throws SourceVersionConflictError on a stale expectedVersion (in-memory)", async () => {
    const repository = createInMemorySourceRepository({
      generateId: fixedId(1),
      maxSources: 10,
      now: () => "2026-07-08T00:00:00.000Z",
    });
    const created = await repository.create({
      knowledgeSpaceId: SPACE_A,
      name: "a",
      type: "web",
      uri: "u",
    });
    await repository.update({ id: created.id, knowledgeSpaceId: SPACE_A, name: "b" });

    await expect(
      repository.update({
        expectedVersion: created.version,
        id: created.id,
        knowledgeSpaceId: SPACE_A,
        name: "c",
      }),
    ).rejects.toThrow(SourceVersionConflictError);
    // Matching version succeeds.
    await expect(
      repository.update({
        expectedVersion: 2,
        id: created.id,
        knowledgeSpaceId: SPACE_A,
        name: "c",
      }),
    ).resolves.toMatchObject({ name: "c", version: 3 });
  });

  it("pins the stored version in SQL and raises a conflict on rowsAffected 0 (database)", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const row = {
      created_at: "2026-07-03T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
      knowledge_space_id: SPACE_A,
      metadata: JSON.stringify({}),
      name: "a",
      permission_scope: JSON.stringify([]),
      status: "active",
      type: "web",
      updated_at: "2026-07-03T00:00:00.000Z",
      uri: "u",
      version: 4,
    };
    const repository = createDatabaseSourceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (input.operation === "select") {
            return { rows: [row], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        },
        kind: "postgres",
      }),
      now: () => "2026-07-08T00:00:00.000Z",
    });

    await expect(
      repository.update({
        expectedVersion: 4,
        id: row.id,
        knowledgeSpaceId: SPACE_A,
        name: "b",
      }),
    ).rejects.toThrow(SourceVersionConflictError);
    const update = calls.find((call) => call.operation === "update");
    expect(update?.sql).toContain('"version" = $4');
    expect(update?.sql).toContain('AND "version" = $8');
    expect(update?.params).toContain(4);
    expect(update?.params).toContain(5);
  });

  it.each(["postgres", "tidb"] as const)(
    "does not report success when a deletion fence wins an unversioned update for %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const sourceId = "00000000-0000-4000-8000-000000000001";
      const repository = createDatabaseSourceRepository({
        database: createSchemaDatabaseAdapter({
          executor: async (input) => {
            calls.push(input);
            return input.operation === "select"
              ? { rows: [sourceRow(sourceId)], rowsAffected: 1 }
              : { rows: [], rowsAffected: 0 };
          },
          kind: dialect,
        }),
      });

      await expect(
        repository.update({ id: sourceId, knowledgeSpaceId: SPACE_A, name: "lost race" }),
      ).resolves.toBeNull();

      const update = calls.find((call) => call.operation === "update");
      expect(update?.sql).toContain(
        dialect === "postgres" ? "\"status\" <> 'deleting'" : "`status` <> 'deleting'",
      );
      expect(update?.sql).toContain(
        dialect === "postgres" ? '"deletion_job_id" IS NULL' : "`deletion_job_id` IS NULL",
      );
    },
  );
});
