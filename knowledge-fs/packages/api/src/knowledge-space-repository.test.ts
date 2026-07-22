import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  DuplicateKnowledgeSpaceSlugError,
  KnowledgeSpaceCapacityExceededError,
  KnowledgeSpaceListLimitExceededError,
  KnowledgeSpaceRevisionConflictError,
  createDatabaseKnowledgeSpaceRepository,
  createInMemoryKnowledgeSpaceRepository,
} from "./knowledge-space-repository";

interface KnowledgeSpaceRow {
  created_at: string;
  description?: null | string;
  icon_ref?: null | string;
  id: string;
  name: string;
  revision: number;
  slug: string;
  tenant_id: string;
  updated_at: string;
}

const TENANT_ID = "tenant-a";
const SPACE_ID_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const SPACE_ID_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const MUTATION_NOW = "2026-05-11T13:00:00.000Z";

function updatePermission(knowledgeSpaceId: string) {
  return {
    fence: {
      accessChannel: "interactive" as const,
      knowledgeSpaceId,
      permissionSnapshotId: SPACE_ID_A,
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "owner-1",
      tenantId: TENANT_ID,
    },
    now: MUTATION_NOW,
    requiredAccess: "write" as const,
  };
}

function permissionSnapshotRow(knowledgeSpaceId: string) {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: MUTATION_NOW,
    expires_at: "2027-01-01T00:00:00.000Z",
    id: SPACE_ID_A,
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: JSON.stringify([]),
    revision: 1,
    revoked_at: null,
    role: "owner",
    status: "active",
    subject_id: "owner-1",
    tenant_id: TENANT_ID,
    updated_at: MUTATION_NOW,
    visibility: "only_me",
  };
}

function createFakeKnowledgeSpaceExecutor(initialRows: readonly KnowledgeSpaceRow[] = []) {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map(
    initialRows.map((row) => [
      row.id,
      { deletion_job_id: null, lifecycle_state: "active", ...row },
    ]),
  );
  const activityRows = new Map<string, Record<string, unknown>>();
  let rejectNextUpdate = false;
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.tableName === "knowledge_space_activity_events") {
      if (input.operation === "insert") {
        const values = input.params;
        const id = String(values[0]);
        if (!activityRows.has(id)) {
          activityRows.set(id, {
            action: values[5],
            actor_subject_id: values[4],
            actor_type: values[3],
            details: values[10],
            id,
            knowledge_space_id: values[2],
            occurred_at: values[11],
            required_permission_scope: values[9],
            resource_id: values[7],
            resource_type: values[6],
            result: values[8],
            tenant_id: values[1],
          });
        }
        return { rows: [], rowsAffected: 1 };
      }
      const row = activityRows.get(String(input.params[2]));
      const selected =
        row && row.tenant_id === input.params[0] && row.knowledge_space_id === input.params[1]
          ? [row]
          : [];
      return { rows: selected, rowsAffected: selected.length };
    }

    if (input.tableName === "deletion_jobs") {
      return { rows: [], rowsAffected: 0 };
    }
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return {
        rows: [permissionSnapshotRow(String(input.params[1]))],
        rowsAffected: 1,
      };
    }
    if (
      input.tableName === "knowledge_space_members" ||
      input.tableName === "knowledge_space_access_policies" ||
      input.tableName === "knowledge_space_api_access"
    ) {
      return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
    }

    if (input.operation === "insert") {
      const [id, tenantId, slug, name, description, iconRef, revision, createdAt, updatedAt] =
        input.params;
      const row = {
        created_at: String(createdAt),
        deletion_job_id: null,
        description: description === null ? null : String(description),
        icon_ref: iconRef === null ? null : String(iconRef),
        id: String(id),
        name: String(name),
        lifecycle_state: "active",
        revision: Number(revision),
        slug: String(slug),
        tenant_id: String(tenantId),
        updated_at: String(updatedAt),
      };
      rows.set(row.id, row);

      return { rows: [{ ...row }], rowsAffected: 1 };
    }

    if (input.operation === "update") {
      const [
        name,
        slug,
        description,
        iconRef,
        revision,
        updatedAt,
        tenantId,
        id,
        expectedRevision,
      ] = input.params;
      const row = rows.get(String(id));

      if (
        rejectNextUpdate ||
        !row ||
        row.tenant_id !== tenantId ||
        row.revision !== expectedRevision
      ) {
        rejectNextUpdate = false;
        return { rows: [], rowsAffected: 0 };
      }

      const updated = {
        ...row,
        description: description === null ? null : String(description),
        icon_ref: iconRef === null ? null : String(iconRef),
        name: String(name),
        revision: Number(revision),
        slug: String(slug),
        updated_at: String(updatedAt),
      };
      rows.set(updated.id, updated);

      return { rows: [{ ...updated }], rowsAffected: 1 };
    }

    if (input.operation === "delete") {
      const [tenantId, id] = input.params;
      const row = rows.get(String(id));

      if (!row || row.tenant_id !== tenantId) {
        return { rows: [], rowsAffected: 0 };
      }

      rows.delete(row.id);

      return { rows: [], rowsAffected: 1 };
    }

    if (input.sql.includes("knowledge_space_members")) {
      const [tenantId, _subjectId, cursorOrLimit, maybeLimit] = input.params;
      const cursor = maybeLimit === undefined ? undefined : String(cursorOrLimit);
      const limit = Number(maybeLimit ?? cursorOrLimit);
      const selected = [...rows.values()]
        .filter((row) => row.tenant_id === tenantId)
        .filter((row) => (cursor ? row.slug > cursor : true))
        .sort((first, second) => first.slug.localeCompare(second.slug))
        .slice(0, limit)
        .map((row) => ({ ...row }));
      return { rows: selected, rowsAffected: selected.length };
    }

    if (input.sql.includes("ORDER BY")) {
      const [tenantId, cursorOrLimit, maybeLimit] = input.params;
      const cursor = maybeLimit === undefined ? undefined : String(cursorOrLimit);
      const limit = Number(maybeLimit ?? cursorOrLimit);
      const selected = [...rows.values()]
        .filter((row) => row.tenant_id === tenantId)
        .filter((row) => (cursor ? row.slug > cursor : true))
        .sort((first, second) => first.slug.localeCompare(second.slug))
        .slice(0, limit)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    if (input.sql.includes('"slug" =') || input.sql.includes("`slug` =")) {
      const [tenantId, slug] = input.params;
      const selected = [...rows.values()]
        .filter((row) => row.tenant_id === tenantId && row.slug === slug)
        .slice(0, input.maxRows)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    const [tenantId, id] = input.params;
    const row = rows.get(String(id));
    const selected = row && row.tenant_id === tenantId ? [{ ...row }] : [];

    return { rows: selected, rowsAffected: selected.length };
  };

  return {
    calls,
    executor,
    rejectNextUpdate: () => {
      rejectNextUpdate = true;
    },
    rows,
  };
}

describe("KnowledgeSpace repositories", () => {
  it("persists and CAS-clears a bounded built-in icon in memory", async () => {
    const repository = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID_A,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-11T13:00:00.000Z",
    });
    const created = await repository.create({
      iconRef: "builtin:camera",
      name: "Camera",
      slug: "camera",
      tenantId: TENANT_ID,
    });
    expect(created.iconRef).toBe("builtin:camera");
    const cleared = await repository.update({
      expectedRevision: 1,
      iconRef: null,
      id: SPACE_ID_A,
      tenantId: TENANT_ID,
    });
    expect(cleared).toMatchObject({ revision: 2 });
    expect(cleared?.iconRef).toBeUndefined();
    await expect(
      repository.update({
        expectedRevision: 1,
        iconRef: "builtin:diagram",
        id: SPACE_ID_A,
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceRevisionConflictError);
  });

  it("stores bounded in-memory spaces with tenant slug uniqueness and stable pagination", async () => {
    const repository = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID_A,
      maxListLimit: 1,
      maxSpaces: 1,
      now: () => "2026-05-11T13:00:00.000Z",
    });

    const created = await repository.create({
      description: "Primary space",
      name: "Primary",
      slug: "primary",
      tenantId: TENANT_ID,
    });
    expect(created.revision).toBe(1);
    created.name = "mutated";

    await expect(repository.get({ id: SPACE_ID_A, tenantId: TENANT_ID })).resolves.toEqual(
      expect.objectContaining({
        name: "Primary",
        slug: "primary",
      }),
    );
    await expect(
      repository.create({ name: "Duplicate", slug: "primary", tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(DuplicateKnowledgeSpaceSlugError);
    await expect(
      repository.create({ name: "Second", slug: "second", tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceCapacityExceededError);
    await expect(repository.list({ limit: 2, tenantId: TENANT_ID })).rejects.toBeInstanceOf(
      KnowledgeSpaceListLimitExceededError,
    );
    await expect(repository.list({ limit: 1, tenantId: TENANT_ID })).resolves.toEqual({
      items: [expect.objectContaining({ id: SPACE_ID_A })],
    });
    const updated = await repository.update({
      expectedRevision: 1,
      id: SPACE_ID_A,
      name: "Primary v2",
      tenantId: TENANT_ID,
    });
    expect(updated).toMatchObject({ name: "Primary v2", revision: 2 });
    await expect(
      repository.update({
        expectedRevision: 1,
        id: SPACE_ID_A,
        name: "stale",
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceRevisionConflictError);
    await expect(
      repository.rollbackCreate({
        expectedRevision: 1,
        expectedSlug: "primary",
        id: SPACE_ID_A,
        tenantId: TENANT_ID,
      }),
    ).resolves.toBe(false);
    await expect(repository.get({ id: SPACE_ID_A, tenantId: TENANT_ID })).resolves.toMatchObject({
      revision: 2,
    });
  });

  it("only rolls back the exact in-memory revision-1 create", async () => {
    const repository = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID_A,
      maxListLimit: 1,
      maxSpaces: 1,
    });
    const created = await repository.create({
      name: "Primary",
      slug: "primary",
      tenantId: TENANT_ID,
    });

    await expect(
      repository.rollbackCreate({
        expectedRevision: created.revision,
        expectedSlug: "wrong",
        id: created.id,
        tenantId: created.tenantId,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.rollbackCreate({
        expectedRevision: 2,
        expectedSlug: created.slug,
        id: created.id,
        tenantId: created.tenantId,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.rollbackCreate({
        expectedRevision: created.revision,
        expectedSlug: created.slug,
        id: created.id,
        tenantId: created.tenantId,
      }),
    ).resolves.toBe(true);
  });

  it.each(["postgres", "tidb"] as const)(
    "uses revision-CAS parameterized bounded SQL for %s database CRUD",
    async (dialect) => {
      const fake = createFakeKnowledgeSpaceExecutor();
      const repository = createDatabaseKnowledgeSpaceRepository({
        database: createSchemaDatabaseAdapter({
          executor: fake.executor,
          kind: dialect,
          transaction: async (callback) => callback({ execute: fake.executor }),
        }),
        generateId: () => SPACE_ID_B,
        maxListLimit: 2,
        now: () => "2026-05-11T13:00:00.000Z",
      });

      const created = await repository.create({
        description: "Database space",
        iconRef: "builtin:camera",
        name: "Database",
        slug: "database",
        tenantId: TENANT_ID,
      });

      expect(created).toEqual(expect.objectContaining({ id: SPACE_ID_B, slug: "database" }));
      expect(fake.calls[0]).toEqual(
        expect.objectContaining({
          maxRows: 1,
          operation: "select",
          params: [TENANT_ID, "database"],
          tableName: "knowledge_spaces",
        }),
      );
      expect(fake.calls[1]).toEqual(
        expect.objectContaining({
          maxRows: 1,
          operation: "insert",
          params: [
            SPACE_ID_B,
            TENANT_ID,
            "database",
            "Database",
            "Database space",
            "builtin:camera",
            1,
            "2026-05-11T13:00:00.000Z",
            "2026-05-11T13:00:00.000Z",
          ],
          tableName: "knowledge_spaces",
        }),
      );
      expect(fake.calls[1]?.sql).not.toContain("database");

      await expect(repository.list({ limit: 1, tenantId: TENANT_ID })).resolves.toEqual({
        items: [created],
      });
      expect(fake.calls[2]).toEqual(
        expect.objectContaining({
          maxRows: 2,
          operation: "select",
          params: [TENANT_ID, 2],
        }),
      );
      expect(fake.calls[2]?.sql).toContain(
        dialect === "postgres" ? "\"lifecycle_state\" = 'active'" : "`lifecycle_state` = 'active'",
      );

      await expect(
        repository.update({
          expectedRevision: 1,
          id: created.id,
          iconRef: "builtin:diagram",
          name: "Renamed",
          permission: updatePermission(created.id),
          slug: "renamed",
          tenantId: TENANT_ID,
        }),
      ).resolves.toEqual(
        expect.objectContaining({ iconRef: "builtin:diagram", name: "Renamed", slug: "renamed" }),
      );
      const updateCall = fake.calls.find(
        (call) => call.tableName === "knowledge_spaces" && call.operation === "update",
      );
      expect(updateCall).toEqual(
        expect.objectContaining({
          maxRows: 1,
          operation: "update",
          params: [
            "Renamed",
            "renamed",
            "Database space",
            "builtin:diagram",
            2,
            "2026-05-11T13:00:00.000Z",
            TENANT_ID,
            created.id,
            1,
          ],
        }),
      );
      expect(updateCall?.sql).toContain(
        dialect === "postgres" ? "\"lifecycle_state\" = 'active'" : "`lifecycle_state` = 'active'",
      );
      expect(updateCall?.sql).toContain(
        dialect === "postgres" ? '"deletion_job_id" IS NULL' : "`deletion_job_id` IS NULL",
      );
      expect(updateCall?.sql).toContain(
        dialect === "postgres" ? '"revision" = $9' : "`revision` = ?",
      );
      expect(
        fake.calls.some(
          (call) =>
            call.tableName === "knowledge_space_activity_events" && call.operation === "insert",
        ),
      ).toBe(true);

      await expect(
        repository.update({
          expectedRevision: 1,
          id: created.id,
          name: "Stale",
          permission: updatePermission(created.id),
          tenantId: TENANT_ID,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceRevisionConflictError);

      // Simulate durable deletion winning after the repository's active-row read but before its
      // CAS update. The lifecycle/deletion predicates make the UPDATE affect zero rows and surface
      // the same stable 409-class conflict instead of overwriting the deleting row.
      fake.rejectNextUpdate();
      await expect(
        repository.update({
          expectedRevision: 2,
          id: created.id,
          name: "Lost race",
          permission: updatePermission(created.id),
          tenantId: TENANT_ID,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceRevisionConflictError);
    },
  );

  it.each([
    {
      dialect: "postgres" as const,
      error: Object.assign(new Error("duplicate tenant slug"), {
        code: "23505",
        constraint: "knowledge_spaces_tenant_slug_uq",
      }),
    },
    {
      dialect: "tidb" as const,
      error: Object.assign(
        new Error("Duplicate entry for key 'knowledge_spaces.knowledge_spaces_tenant_slug_uq'"),
        { code: "ER_DUP_ENTRY", errno: 1062 },
      ),
    },
  ])("maps a concurrent $dialect tenant-slug insert race to the domain conflict", async (input) => {
    const repository = createDatabaseKnowledgeSpaceRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (query) => {
          if (query.operation === "insert") {
            throw input.error;
          }
          return { rows: [], rowsAffected: 0 };
        },
        kind: input.dialect,
      }),
      generateId: () => SPACE_ID_A,
      maxListLimit: 10,
    });

    await expect(
      repository.create({ name: "Concurrent", slug: "concurrent", tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(DuplicateKnowledgeSpaceSlugError);
  });

  it.each(["postgres", "tidb"] as const)(
    "requires and transactionally revalidates a durable permission for %s database updates",
    async (dialect) => {
      const row: KnowledgeSpaceRow = {
        created_at: MUTATION_NOW,
        id: SPACE_ID_A,
        name: "Before",
        revision: 1,
        slug: "before",
        tenant_id: TENANT_ID,
        updated_at: MUTATION_NOW,
      };
      const calls: DatabaseExecuteInput[] = [];
      let permissionReads = 0;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          if (input.operation === "update") {
            throw new Error("knowledge-space update must not execute after permission revocation");
          }
          return input.sql.includes("FOR UPDATE")
            ? {
                rows: [{ deletion_job_id: null, id: SPACE_ID_A, lifecycle_state: "active" }],
                rowsAffected: 1,
              }
            : { rows: [{ ...row }], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_permission_snapshots") {
          permissionReads += 1;
          return permissionReads === 1
            ? { rows: [permissionSnapshotRow(SPACE_ID_A)], rowsAffected: 1 }
            : { rows: [], rowsAffected: 0 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        throw new Error(`Unexpected ${input.operation} on ${input.tableName}`);
      };
      const repository = createDatabaseKnowledgeSpaceRepository({
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        maxListLimit: 10,
      });

      await expect(
        repository.update({
          expectedRevision: 1,
          id: SPACE_ID_A,
          name: "No fence",
          tenantId: TENANT_ID,
        }),
      ).rejects.toMatchObject({ code: "knowledge_space_permission_fence_required" });

      calls.length = 0;
      permissionReads = 0;
      await expect(
        repository.update({
          expectedRevision: 1,
          id: SPACE_ID_A,
          name: "Revoked",
          permission: updatePermission(SPACE_ID_A),
          tenantId: TENANT_ID,
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
      expect(calls.some((call) => call.operation === "update")).toBe(false);
      expect(calls.map((call) => call.tableName)).toEqual([
        "knowledge_spaces",
        "knowledge_spaces",
        "deletion_jobs",
        "knowledge_space_permission_snapshots",
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
        "knowledge_space_permission_snapshots",
      ]);
    },
  );

  it("returns the TiDB CAS result without a race-prone post-update read", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const row: KnowledgeSpaceRow = {
      created_at: "2026-05-11T13:00:00.000Z",
      description: null,
      id: SPACE_ID_A,
      name: "Before",
      revision: 1,
      slug: "before",
      tenant_id: TENANT_ID,
      updated_at: "2026-05-11T13:00:00.000Z",
    };
    const repository = createDatabaseKnowledgeSpaceRepository({
      database: createSchemaDatabaseAdapter({
        transaction: async (callback) =>
          callback({
            execute: async (input) => {
              calls.push(input);
              if (input.tableName === "knowledge_spaces" && input.operation === "select") {
                return {
                  rows: [{ deletion_job_id: null, id: SPACE_ID_A, lifecycle_state: "active" }],
                  rowsAffected: 1,
                };
              }
              if (input.tableName === "deletion_jobs") {
                return { rows: [], rowsAffected: 0 };
              }
              if (input.tableName === "knowledge_space_permission_snapshots") {
                return {
                  rows: [permissionSnapshotRow(SPACE_ID_A)],
                  rowsAffected: 1,
                };
              }
              if (
                input.tableName === "knowledge_space_members" ||
                input.tableName === "knowledge_space_access_policies" ||
                input.tableName === "knowledge_space_api_access"
              ) {
                return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
              }
              if (input.tableName === "knowledge_space_activity_events") {
                if (input.operation === "insert") return { rows: [], rowsAffected: 1 };
                return {
                  rows: [
                    {
                      action: "settings.updated",
                      actor_subject_id: null,
                      actor_type: "system",
                      details: "{}",
                      id: input.params[2],
                      knowledge_space_id: SPACE_ID_A,
                      occurred_at: "2026-05-11T14:00:00.000Z",
                      required_permission_scope: "[]",
                      resource_id: SPACE_ID_A,
                      resource_type: "knowledge-space",
                      result: "success",
                      tenant_id: TENANT_ID,
                    },
                  ],
                  rowsAffected: 1,
                };
              }
              return { rows: [], rowsAffected: 1 };
            },
          }),
        executor: async (input) => {
          calls.push(input);
          if (input.operation === "select" && input.tableName === "knowledge_spaces") {
            if (calls.filter((call) => call.tableName === "knowledge_spaces").length > 1) {
              throw new Error("unexpected post-update read");
            }
            return { rows: [{ ...row }], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 1 };
        },
        kind: "tidb",
      }),
      maxListLimit: 10,
      now: () => "2026-05-11T14:00:00.000Z",
    });

    await expect(
      repository.update({
        expectedRevision: 1,
        id: SPACE_ID_A,
        name: "After",
        permission: updatePermission(SPACE_ID_A),
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({
      name: "After",
      revision: 2,
      updatedAt: "2026-05-11T14:00:00.000Z",
    });
    expect(
      calls.filter((call) => call.tableName === "knowledge_spaces").map((call) => call.operation),
    ).toEqual(["select", "select", "update"]);
  });

  it.each(["postgres", "tidb"] as const)(
    "filters authorized spaces in SQL before pagination for %s",
    async (dialect) => {
      const row: KnowledgeSpaceRow = {
        created_at: "2026-05-11T13:00:00.000Z",
        id: SPACE_ID_A,
        name: "Visible",
        revision: 1,
        slug: "visible",
        tenant_id: TENANT_ID,
        updated_at: "2026-05-11T13:00:00.000Z",
      };
      const fake = createFakeKnowledgeSpaceExecutor([row]);
      const repository = createDatabaseKnowledgeSpaceRepository({
        database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
        maxListLimit: 10,
      });

      await expect(
        repository.listAuthorized?.({
          limit: 1,
          requireApiAccess: true,
          subjectId: "member-1",
          tenantId: TENANT_ID,
        }),
      ).resolves.toMatchObject({ items: [{ id: SPACE_ID_A }] });
      const call = fake.calls.at(-1);
      expect(call?.params).toEqual([TENANT_ID, "member-1", 2]);
      expect(call?.sql).toContain("knowledge_space_members");
      expect(call?.sql).toContain("knowledge_space_access_policies");
      expect(call?.sql).toContain("knowledge_space_access_policy_members");
      expect(call?.sql).toContain("knowledge_space_api_access");
      expect(call?.sql).toContain(
        dialect === "postgres"
          ? "space.\"lifecycle_state\" = 'active'"
          : "space.`lifecycle_state` = 'active'",
      );
      expect(call?.sql.indexOf("knowledge_space_members")).toBeLessThan(
        call?.sql.indexOf("LIMIT") ?? 0,
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "keeps ordinary reads active-only while deletion replay can read a fenced row for %s",
    async (dialect) => {
      const row: KnowledgeSpaceRow = {
        created_at: "2026-05-11T13:00:00.000Z",
        id: SPACE_ID_A,
        name: "Deleting",
        revision: 2,
        slug: "deleting",
        tenant_id: TENANT_ID,
        updated_at: "2026-05-11T13:00:00.000Z",
      };
      const fake = createFakeKnowledgeSpaceExecutor([row]);
      const repository = createDatabaseKnowledgeSpaceRepository({
        database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
        maxListLimit: 10,
      });

      await expect(repository.get({ id: SPACE_ID_A, tenantId: TENANT_ID })).resolves.toMatchObject({
        id: SPACE_ID_A,
      });
      await expect(
        repository.getForDeletion({ id: SPACE_ID_A, tenantId: TENANT_ID }),
      ).resolves.toMatchObject({ id: SPACE_ID_A });

      expect(fake.calls[0]?.params).toEqual([TENANT_ID, SPACE_ID_A]);
      expect(fake.calls[0]?.sql).toContain(
        dialect === "postgres" ? "\"lifecycle_state\" = 'active'" : "`lifecycle_state` = 'active'",
      );
      expect(fake.calls[1]?.params).toEqual([TENANT_ID, SPACE_ID_A]);
      expect(fake.calls[1]?.sql).not.toContain("lifecycle_state");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "only rolls back an exact revision-1 create before a durable deletion fence wins for %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createDatabaseKnowledgeSpaceRepository({
        database: createSchemaDatabaseAdapter({
          executor: async (input) => {
            calls.push(input);
            return { rows: [], rowsAffected: 0 };
          },
          kind: dialect,
        }),
        maxListLimit: 10,
      });

      await expect(
        repository.rollbackCreate({
          expectedRevision: 1,
          expectedSlug: "alpha",
          id: SPACE_ID_A,
          tenantId: TENANT_ID,
        }),
      ).resolves.toBe(false);
      expect(calls[0]?.params).toEqual([TENANT_ID, SPACE_ID_A, "alpha", 1]);
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? "\"lifecycle_state\" = 'active'" : "`lifecycle_state` = 'active'",
      );
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? '"revision" = $4' : "`revision` = ?",
      );
      expect(calls[0]?.sql).toContain(
        dialect === "postgres" ? '"deletion_job_id" IS NULL' : "`deletion_job_id` IS NULL",
      );
    },
  );
});
