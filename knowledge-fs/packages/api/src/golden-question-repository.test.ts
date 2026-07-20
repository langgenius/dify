import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult, DatabaseRow } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  GoldenQuestionCapacityExceededError,
  GoldenQuestionDeletionFenceActiveError,
  createDatabaseGoldenQuestionRepository,
  createInMemoryGoldenQuestionRepository,
} from "./golden-question-repository";

describe("golden question repositories", () => {
  it("stores clone-isolated questions with bounded in-memory capacity and stable pagination", async () => {
    const repository = createInMemoryGoldenQuestionRepository({
      generateId: nextId([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f7001",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f7002",
      ]),
      maxListLimit: 1,
      maxQuestions: 2,
      now: nextNow(["2026-05-12T16:18:00.000Z", "2026-05-12T16:18:00.000Z"]),
    });

    const first = await repository.createTrusted({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7201"],
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
      metadata: { priority: "high" },
      question: "What is first?",
      tags: ["contract"],
    });
    await repository.createTrusted({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
      question: "What is second?",
    });

    first.metadata.priority = "mutated";
    first.tags.push("mutated");

    await expect(
      repository.getTrusted({
        id: first.id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7201"],
        metadata: { priority: "high" },
        tags: ["contract"],
      }),
    );

    const firstPage = await repository.listTrusted({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
      limit: 1,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual({
      createdAt: "2026-05-12T16:18:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7001",
    });

    await expect(
      repository.listTrusted({
        cursor: firstPage.nextCursor,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        limit: 1,
      }),
    ).resolves.toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7002" }],
    });

    await expect(
      repository.createTrusted({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        question: "What is third?",
      }),
    ).rejects.toBeInstanceOf(GoldenQuestionCapacityExceededError);
  });

  it("rejects invalid bounds and unbounded list reads", async () => {
    expect(() =>
      createInMemoryGoldenQuestionRepository({ maxListLimit: 1, maxQuestions: 0 }),
    ).toThrow("Golden question repository maxQuestions must be at least 1");
    expect(() =>
      createInMemoryGoldenQuestionRepository({ maxListLimit: 0, maxQuestions: 1 }),
    ).toThrow("Golden question repository maxListLimit must be at least 1");

    const repository = createInMemoryGoldenQuestionRepository({
      maxListLimit: 1,
      maxQuestions: 1,
    });

    await expect(
      repository.listTrusted({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        limit: 2,
      }),
    ).rejects.toThrow("Golden question list limit exceeds maxListLimit=1");
  });

  it("fails closed for legacy and narrowed-grant in-memory reads before pagination", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa";
    const repository = createInMemoryGoldenQuestionRepository({
      maxListLimit: 10,
      maxQuestions: 10,
    });
    await repository.createTrusted({
      knowledgeSpaceId,
      question: "Legacy question",
    });
    const protectedQuestion = await repository.create({
      knowledgeSpaceId,
      permission: {
        ...guardedPermission(),
        candidateGrants: ["tenant:tenant-1", "team:camera"],
      },
      question: "Team-only question",
      requiredPermissionScope: ["team:camera"],
    });

    await expect(
      repository.list({
        candidateGrants: ["tenant:tenant-1"],
        knowledgeSpaceId,
        limit: 10,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({ items: [] });
    await expect(
      repository.get({
        candidateGrants: ["tenant:tenant-1", "team:camera"],
        id: protectedQuestion.id,
        knowledgeSpaceId,
        tenantId: "tenant-2",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.list({
        candidateGrants: ["tenant:tenant-1", "team:camera"],
        knowledgeSpaceId,
        limit: 1,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ items: [{ id: protectedQuestion.id }] });
  });

  it.each(["postgres", "tidb"] as const)(
    "binds tenant and candidate grants before golden-question LIMIT on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({
          executor: async (input) => {
            calls.push(input);
            return { rows: [], rowsAffected: 0 };
          },
          kind: dialect,
        }),
        maxListLimit: 10,
      });

      await repository.list({
        candidateGrants: ["tenant:tenant-1", "team:camera"],
        knowledgeSpaceId: "space-1",
        limit: 5,
        tenantId: "tenant-1",
      });
      const call = calls[0];
      expect(call?.params.slice(0, 3)).toEqual([
        "tenant-1",
        "space-1",
        JSON.stringify(["tenant:tenant-1", "team:camera"]),
      ]);
      expect(call?.sql).toContain("tenant_id");
      expect(call?.sql).toContain("required_permission_scope");
      const acl = dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS";
      expect(call?.sql).toContain(acl);
      expect(call?.sql.indexOf(acl)).toBeLessThan(call?.sql.indexOf("LIMIT") ?? 0);
    },
  );

  it("uses parameterized database SQL and maps rows to domain models", async () => {
    const fake = createFakeGoldenQuestionExecutor();
    const repository = createDatabaseGoldenQuestionRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7101",
      maxListLimit: 2,
      now: () => "2026-05-12T16:18:00.000Z",
    });

    const created = await repository.create({
      expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7201"],
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
      metadata: { priority: "high" },
      permission: guardedPermission(),
      question: "What is persisted?",
      requiredPermissionScope: [],
      tags: ["db"],
    });

    await expect(
      repository.get({
        ...goldenReadScope(),
        id: created.id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
      }),
    ).resolves.toEqual(created);
    await expect(
      repository.list({
        ...goldenReadScope(),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        limit: 2,
      }),
    ).resolves.toEqual({ items: [created] });
    await expect(
      repository.update({
        id: created.id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        metadata: { priority: "medium" },
        permission: guardedPermission(),
        question: "What changed?",
      }),
    ).resolves.toMatchObject({
      metadata: { priority: "medium" },
      question: "What changed?",
    });
    await expect(
      repository.delete({
        id: created.id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        permission: guardedPermission(),
      }),
    ).resolves.toBe(true);

    const insert = fake.calls.find((call) => call.operation === "insert");
    expect(insert).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "golden_questions",
      }),
    );
    expect(insert?.sql).not.toContain("What is persisted?");
    expect(fake.calls.some((call) => call.sql.includes("FOR UPDATE"))).toBe(true);
    expect(
      fake.calls.some(
        (call) => call.tableName === "deletion_jobs" && call.sql.includes("active_slot"),
      ),
    ).toBe(true);
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [
          "tenant-1",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
          created.id,
          JSON.stringify(guardedPermission().candidateGrants),
        ],
        tableName: "golden_questions",
      }),
    );
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 3,
        operation: "select",
        params: [
          "tenant-1",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
          JSON.stringify(guardedPermission().candidateGrants),
          3,
        ],
        tableName: "golden_questions",
      }),
    );
    for (const call of fake.calls.filter(
      (candidate) => candidate.operation === "select" && candidate.tableName === "golden_questions",
    )) {
      expect(call.sql).toContain("deletion_jobs");
      expect(call.sql).toContain("active_slot");
    }
  });

  it.each(["postgres", "tidb"] as const)(
    "atomically rejects create when a deletion is active (%s)",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces" && input.params.length === 1) {
          return { rows: [{ tenant_id: "tenant-1" }], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: "space-1", lifecycle_state: "active" }],
            rowsAffected: 0,
          };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [{ id: "active-delete" }], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 0 };
      };
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        maxListLimit: 2,
      });

      await expect(
        repository.create({
          knowledgeSpaceId: "space-1",
          permission: guardedPermission(),
          question: "blocked",
          requiredPermissionScope: [],
        }),
      ).rejects.toBeInstanceOf(GoldenQuestionDeletionFenceActiveError);
      expect(calls.find((call) => call.sql.includes("FOR UPDATE"))?.sql).toContain(
        "lifecycle_state",
      );
      expect(calls.find((call) => call.tableName === "deletion_jobs")?.sql).toContain(
        "active_slot",
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "atomically rejects update and delete before permission/resource access when deletion is active (%s)",
    async (dialect) => {
      for (const operation of ["update", "delete"] as const) {
        const calls: DatabaseExecuteInput[] = [];
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (input.tableName === "knowledge_spaces") {
            return {
              rows: [{ deletion_job_id: null, id: "space-1", lifecycle_state: "active" }],
              rowsAffected: 1,
            };
          }
          if (input.tableName === "deletion_jobs") {
            return { rows: [{ id: "active-delete" }], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        };
        const repository = createDatabaseGoldenQuestionRepository({
          database: createSchemaDatabaseAdapter({
            executor: execute,
            kind: dialect,
            transaction: async (callback) => callback({ execute }),
          }),
          maxListLimit: 2,
        });
        const mutation =
          operation === "update"
            ? repository.update({
                id: "question-1",
                knowledgeSpaceId: "space-1",
                permission: guardedPermission(),
                question: "blocked",
              })
            : repository.delete({
                id: "question-1",
                knowledgeSpaceId: "space-1",
                permission: guardedPermission(),
              });

        await expect(mutation).rejects.toBeInstanceOf(GoldenQuestionDeletionFenceActiveError);
        expect(calls.map((call) => call.tableName)).toEqual(["knowledge_spaces", "deletion_jobs"]);
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects a guarded create before insert when its fresh permission is revoked (%s)",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: "space-1", lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (
          input.tableName === "knowledge_space_permission_snapshots" &&
          input.sql.includes("LIMIT 1 FOR UPDATE")
        ) {
          return { rows: [permissionSnapshotRow()], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: input.tableName }], rowsAffected: 1 };
        }
        // The final joined revalidation observes the revocation and returns no row.
        return { rows: [], rowsAffected: 0 };
      };
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        maxListLimit: 2,
        now: () => "2026-07-14T14:00:00.000Z",
      });

      await expect(
        repository.create({
          knowledgeSpaceId: "space-1",
          permission: guardedPermission(),
          question: "must not be persisted",
          requiredPermissionScope: [],
        }),
      ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
      expect(calls.some((call) => call.operation === "insert")).toBe(false);
      expect(calls.at(0)).toMatchObject({ tableName: "knowledge_spaces" });
      expect(calls.at(1)).toMatchObject({ tableName: "deletion_jobs" });
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects guarded update and delete before resource access when fresh permission is revoked (%s)",
    async (dialect) => {
      for (const operation of ["update", "delete"] as const) {
        const calls: DatabaseExecuteInput[] = [];
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (input.tableName === "knowledge_spaces") {
            return {
              rows: [{ deletion_job_id: null, id: "space-1", lifecycle_state: "active" }],
              rowsAffected: 1,
            };
          }
          if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
          if (
            input.tableName === "knowledge_space_permission_snapshots" &&
            input.sql.includes("LIMIT 1 FOR UPDATE")
          ) {
            return { rows: [permissionSnapshotRow()], rowsAffected: 1 };
          }
          if (
            input.tableName === "knowledge_space_members" ||
            input.tableName === "knowledge_space_access_policies" ||
            input.tableName === "knowledge_space_api_access"
          ) {
            return { rows: [{ id: input.tableName }], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        };
        const repository = createDatabaseGoldenQuestionRepository({
          database: createSchemaDatabaseAdapter({
            executor: execute,
            kind: dialect,
            transaction: async (callback) => callback({ execute }),
          }),
          maxListLimit: 2,
          now: () => "2026-07-14T14:00:00.000Z",
        });
        const mutation =
          operation === "update"
            ? repository.update({
                id: "question-1",
                knowledgeSpaceId: "space-1",
                permission: guardedPermission(),
                question: "must not change",
              })
            : repository.delete({
                id: "question-1",
                knowledgeSpaceId: "space-1",
                permission: guardedPermission(),
              });

        await expect(mutation).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
        expect(calls.some((call) => call.tableName === "golden_questions")).toBe(false);
        expect(calls.some((call) => call.operation === operation)).toBe(false);
        expect(calls.at(0)).toMatchObject({ tableName: "knowledge_spaces" });
        expect(calls.at(1)).toMatchObject({ tableName: "deletion_jobs" });
      }
    },
  );
});

function guardedPermission() {
  return {
    accessChannel: "interactive" as const,
    candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
    permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7301",
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-1",
    tenantId: "tenant-1",
  };
}

function goldenReadScope() {
  return {
    candidateGrants: guardedPermission().candidateGrants,
    tenantId: guardedPermission().tenantId,
  };
}

function permissionSnapshotRow(knowledgeSpaceId = "space-1") {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: "2026-07-14T14:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    id: guardedPermission().permissionSnapshotId,
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: [...guardedPermission().candidateGrants],
    revision: 1,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: "editor-1",
    tenant_id: "tenant-1",
    updated_at: "2026-07-14T14:00:00.000Z",
    visibility: "all_members",
  };
}

function nextId(ids: readonly string[]) {
  let index = 0;

  return () => ids[index++] ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f7fff";
}

function nextNow(times: readonly string[]) {
  let index = 0;

  return () => times[index++] ?? times.at(-1) ?? "2026-05-12T16:18:00.000Z";
}

function createFakeGoldenQuestionExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, DatabaseRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });

    if (input.operation === "select" && input.tableName === "knowledge_spaces") {
      return input.params.length === 1
        ? { rows: [{ tenant_id: "tenant-1" }], rowsAffected: 0 }
        : {
            rows: [{ deletion_job_id: null, id: input.params[1], lifecycle_state: "active" }],
            rowsAffected: 0,
          };
    }
    if (input.operation === "select" && input.tableName === "deletion_jobs") {
      return { rows: [], rowsAffected: 0 };
    }
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return {
        rows: [
          permissionSnapshotRow(String(input.params[1] ?? "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa")),
        ],
        rowsAffected: 1,
      };
    }
    if (
      input.tableName === "knowledge_space_members" ||
      input.tableName === "knowledge_space_access_policies" ||
      input.tableName === "knowledge_space_api_access"
    ) {
      return { rows: [{ id: input.tableName }], rowsAffected: 1 };
    }

    if (input.operation === "insert") {
      const [
        id,
        tenantId,
        knowledgeSpaceId,
        question,
        expectedEvidenceIds,
        tags,
        metadata,
        requiredPermissionScope,
        createdAt,
      ] = input.params;
      const row = {
        created_at: String(createdAt),
        expected_evidence_ids:
          typeof expectedEvidenceIds === "string"
            ? JSON.parse(expectedEvidenceIds)
            : expectedEvidenceIds,
        id: String(id),
        knowledge_space_id: String(knowledgeSpaceId),
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
        question: String(question),
        required_permission_scope:
          typeof requiredPermissionScope === "string"
            ? JSON.parse(requiredPermissionScope)
            : requiredPermissionScope,
        tags: typeof tags === "string" ? JSON.parse(tags) : tags,
        tenant_id: String(tenantId),
        updated_at: String(createdAt),
      } satisfies DatabaseRow;

      rows.set(`${row.knowledge_space_id}:${row.id}`, row);

      return { rows: [{ ...row }], rowsAffected: 1 };
    }

    if (input.operation === "select") {
      if (input.sql.includes("ORDER BY")) {
        const [, knowledgeSpaceId, , cursorCreatedAt, cursorId, possibleLimit] = input.params;
        const hasCursor = typeof possibleLimit === "number";
        const limit = Number(hasCursor ? possibleLimit : cursorCreatedAt);
        return {
          rows: [...rows.values()]
            .filter((row) => row.knowledge_space_id === String(knowledgeSpaceId))
            .filter((row) =>
              hasCursor
                ? String(row.created_at) > String(cursorCreatedAt) ||
                  (String(row.created_at) === String(cursorCreatedAt) &&
                    String(row.id) > String(cursorId))
                : true,
            )
            .slice(0, limit),
          rowsAffected: 1,
        };
      }

      const [, knowledgeSpaceId, id] = input.params;
      const row = rows.get(`${String(knowledgeSpaceId)}:${String(id)}`);

      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.operation === "update") {
      const [
        question,
        expectedEvidenceIds,
        tags,
        metadata,
        requiredPermissionScope,
        updatedAt,
        ,
        knowledgeSpaceId,
        id,
      ] = input.params;
      const row = rows.get(`${String(knowledgeSpaceId)}:${String(id)}`);

      if (!row) {
        return { rows: [], rowsAffected: 0 };
      }

      const updated: DatabaseRow = {
        ...row,
        expected_evidence_ids:
          typeof expectedEvidenceIds === "string"
            ? JSON.parse(expectedEvidenceIds)
            : expectedEvidenceIds,
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
        question: String(question),
        required_permission_scope:
          typeof requiredPermissionScope === "string"
            ? JSON.parse(requiredPermissionScope)
            : requiredPermissionScope,
        tags: typeof tags === "string" ? JSON.parse(tags) : tags,
        updated_at: String(updatedAt),
      } satisfies DatabaseRow;
      rows.set(`${updated.knowledge_space_id}:${updated.id}`, updated);

      return { rows: [{ ...updated }], rowsAffected: 1 };
    }

    if (input.operation === "delete") {
      const [, knowledgeSpaceId, id] = input.params;
      const deleted = rows.delete(`${String(knowledgeSpaceId)}:${String(id)}`);

      return { rows: [], rowsAffected: deleted ? 1 : 0 };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor };
}
