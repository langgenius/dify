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

  it("deduplicates in-memory promotion retries by source bad case", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa";
    const repository = createInMemoryGoldenQuestionRepository({
      generateId: nextId([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f7001",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f7002",
      ]),
      maxListLimit: 10,
      maxQuestions: 10,
    });
    const input = {
      knowledgeSpaceId,
      metadata: { sourceBadCaseId: "bad-case-1" },
      permission: guardedPermission(),
      requiredPermissionScope: [],
    } as const;

    const first = await repository.create({ ...input, question: "Original question" });
    const retried = await repository.create({ ...input, question: "Changed retry payload" });

    expect(retried).toEqual(first);
    await expect(
      repository.list({ ...goldenReadScope(), knowledgeSpaceId, limit: 10 }),
    ).resolves.toMatchObject({ items: [{ id: first.id }] });
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
      expect(call.sql).toContain("target_type");
      expect(call.sql).toContain("knowledge_space");
    }
  });

  it.each(["postgres", "tidb"] as const)(
    "persists a golden-question batch with one insert on %s",
    async (dialect) => {
      const fake = createFakeGoldenQuestionExecutor();
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({
          executor: fake.executor,
          kind: dialect,
          transaction: async (callback) => callback({ execute: fake.executor }),
        }),
        generateId: nextId([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7101",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7102",
        ]),
        maxListLimit: 10,
        now: () => "2026-05-12T16:18:00.000Z",
      });
      const common = {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        permission: guardedPermission(),
        requiredPermissionScope: [],
      } as const;

      const created = await repository.createMany([
        { ...common, question: "First imported question" },
        { ...common, question: "Second imported question" },
      ]);

      expect(created.map((question) => question.question)).toEqual([
        "First imported question",
        "Second imported question",
      ]);
      const inserts = fake.calls.filter((call) => call.operation === "insert");
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({ maxRows: 2, tableName: "golden_questions" });
      expect(inserts[0]?.params).toHaveLength(20);
      expect(inserts[0]?.sql).toContain(") VALUES (");
      expect(inserts[0]?.sql).toContain("), (");
    },
  );

  for (const dialect of ["postgres", "tidb"] as const) {
    for (const targetType of ["source", "logical_document", "document_asset"] as const) {
      it(`hides only Golden Questions overlapping an active ${targetType} deletion (${dialect})`, async () => {
        const fake = createGoldenQuestionDeletionReadExecutor(dialect, {
          deleteMode: "cascade",
          targetType,
        });
        const repository = createDatabaseGoldenQuestionRepository({
          database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
          maxListLimit: 10,
        });
        const scope = goldenReadScope();

        const target = await repository.get({
          ...scope,
          id: goldenQuestionTargetId,
          knowledgeSpaceId: goldenQuestionReadSpaceId,
        });
        const unrelated = await repository.get({
          ...scope,
          id: goldenQuestionUnrelatedId,
          knowledgeSpaceId: goldenQuestionReadSpaceId,
        });
        const trustedTarget = await repository.getTrusted({
          id: goldenQuestionTargetId,
          knowledgeSpaceId: goldenQuestionReadSpaceId,
        });
        const page = await repository.list({
          ...scope,
          knowledgeSpaceId: goldenQuestionReadSpaceId,
          limit: 2,
        });
        const trustedPage = await repository.listTrusted({
          knowledgeSpaceId: goldenQuestionReadSpaceId,
          limit: 2,
        });

        expect({
          databaseReads: fake.calls.length,
          pageIds: page.items.map((question) => question.id),
          standaloneDeletionReads: fake.calls.filter((call) => call.tableName === "deletion_jobs")
            .length,
          target,
          trustedPageIds: trustedPage.items.map((question) => question.id),
          trustedTarget,
          unrelatedId: unrelated?.id,
        }).toEqual({
          databaseReads: 5,
          pageIds: [goldenQuestionUnrelatedId],
          standaloneDeletionReads: 0,
          target: null,
          trustedPageIds: [goldenQuestionUnrelatedId],
          trustedTarget: null,
          unrelatedId: goldenQuestionUnrelatedId,
        });
        for (const call of fake.calls) {
          expect(call.sql).toContain("active_slot");
          expect(call.sql).toContain(`'${targetType}'`);
          expect(call.sql).toContain("expected_evidence_ids");
          expect(call.sql).toContain("evidenceContext");
          if (dialect === "tidb") {
            expect((call.sql.match(/\?/g) ?? []).length).toBe(call.params.length);
          }
        }
      });

      it(`hides evidenceMatch-only Golden Questions during an active ${targetType} deletion (${dialect})`, async () => {
        const fake = createGoldenQuestionDeletionReadExecutor(dialect, {
          deleteMode: "cascade",
          linkage: "evidence_match",
          targetType,
        });
        const repository = createDatabaseGoldenQuestionRepository({
          database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
          maxListLimit: 10,
        });

        const target = await repository.get({
          ...goldenReadScope(),
          id: goldenQuestionTargetId,
          knowledgeSpaceId: goldenQuestionReadSpaceId,
        });
        const page = await repository.list({
          ...goldenReadScope(),
          knowledgeSpaceId: goldenQuestionReadSpaceId,
          limit: 2,
        });

        expect({
          pageIds: page.items.map((question) => question.id),
          target,
        }).toEqual({ pageIds: [goldenQuestionUnrelatedId], target: null });
        for (const call of fake.calls) {
          expect(call.sql).toContain("evidenceMatch");
          expect(call.sql).toContain("documentAssetId");
          expect(call.sql).toContain("nodeId");
          expect(call.sql).toContain("knowledge_nodes");
          if (dialect === "tidb") {
            expect((call.sql.match(/\?/g) ?? []).length).toBe(call.params.length);
          }
        }
      });
    }
  }

  it.each(["postgres", "tidb"] as const)(
    "keeps target Golden Questions readable when a Source is detached with documents kept (%s)",
    async (dialect) => {
      const fake = createGoldenQuestionDeletionReadExecutor(dialect, {
        deleteMode: "keep",
        targetType: "source",
      });
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
        maxListLimit: 10,
      });

      await expect(
        repository.list({
          ...goldenReadScope(),
          knowledgeSpaceId: goldenQuestionReadSpaceId,
          limit: 2,
        }),
      ).resolves.toMatchObject({
        items: [{ id: goldenQuestionTargetId }, { id: goldenQuestionUnrelatedId }],
      });
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "fails closed when an active Source deletion has legacy null delete mode (%s)",
    async (dialect) => {
      const fake = createGoldenQuestionDeletionReadExecutor(dialect, {
        deleteMode: null,
        targetType: "source",
      });
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
        maxListLimit: 10,
      });

      await expect(
        repository.list({
          ...goldenReadScope(),
          knowledgeSpaceId: goldenQuestionReadSpaceId,
          limit: 2,
        }),
      ).resolves.toMatchObject({ items: [{ id: goldenQuestionUnrelatedId }] });
      const deleteMode =
        dialect === "postgres"
          ? 'COALESCE(active_golden_deletion."delete_mode"'
          : "COALESCE(active_golden_deletion.`delete_mode`";
      expect(fake.calls[0]?.sql).toContain(deleteMode);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "deduplicates database promotion retries under the space lock on %s",
    async (dialect) => {
      const fake = createFakeGoldenQuestionExecutor();
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({
          executor: fake.executor,
          kind: dialect,
          transaction: async (callback) => callback({ execute: fake.executor }),
        }),
        generateId: nextId([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7101",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7102",
        ]),
        maxListLimit: 10,
        now: () => "2026-05-12T16:18:00.000Z",
      });
      const input = {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        metadata: { sourceBadCaseId: "bad-case-1" },
        permission: guardedPermission(),
        requiredPermissionScope: [],
      } as const;

      const first = await repository.create({ ...input, question: "Original question" });
      const retried = await repository.create({ ...input, question: "Changed retry payload" });

      expect(retried).toEqual(first);
      expect(fake.calls.filter((call) => call.operation === "insert")).toHaveLength(1);
      const idempotencyLookup = fake.calls.find(
        (call) =>
          call.operation === "select" &&
          call.tableName === "golden_questions" &&
          call.sql.includes("sourceBadCaseId"),
      );
      expect(idempotencyLookup?.params.at(-1)).toBe("bad-case-1");
      expect(idempotencyLookup?.sql).toContain(
        dialect === "postgres" ? "->> 'sourceBadCaseId'" : "JSON_EXTRACT",
      );
    },
  );

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
    "allows unrelated child deletion but fences a matching Golden Question create (%s)",
    async (dialect) => {
      const fake = createFakeGoldenQuestionExecutor();
      const calls: DatabaseExecuteInput[] = [];
      let candidateMatches = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push({ ...input, params: [...input.params] });
        if (input.tableName === "deletion_jobs") {
          if (!input.sql.includes("golden_candidate")) {
            return { rows: [], rowsAffected: 0 };
          }
          if (dialect === "tidb") {
            expect((input.sql.match(/\?/g) ?? []).length).toBe(input.params.length);
          }
          return candidateMatches
            ? { rows: [{ matched: 1 }], rowsAffected: 1 }
            : { rows: [], rowsAffected: 0 };
        }
        return fake.executor(input);
      };
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        generateId: nextId([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7101",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7102",
        ]),
        maxListLimit: 2,
      });
      const common = {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        permission: guardedPermission(),
        requiredPermissionScope: [],
      } as const;

      await expect(
        repository.create({
          ...common,
          expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7210"],
          question: "Unrelated evidence remains writable",
        }),
      ).resolves.toMatchObject({ question: "Unrelated evidence remains writable" });

      candidateMatches = true;
      await expect(
        repository.create({
          ...common,
          expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7209"],
          question: "Target evidence is fenced",
        }),
      ).rejects.toBeInstanceOf(GoldenQuestionDeletionFenceActiveError);
      expect(fake.calls.filter((call) => call.operation === "insert")).toHaveLength(1);
      expect(
        calls.filter(
          (call) => call.tableName === "deletion_jobs" && call.sql.includes("golden_candidate"),
        ),
      ).toHaveLength(2);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "checks every Golden Question batch candidate against active deletions in one query (%s)",
    async (dialect) => {
      const fake = createFakeGoldenQuestionExecutor();
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push({ ...input, params: [...input.params] });
        if (input.tableName === "deletion_jobs") {
          if (!input.sql.includes("golden_candidate")) {
            return { rows: [], rowsAffected: 0 };
          }
          if (dialect === "tidb") {
            expect((input.sql.match(/\?/g) ?? []).length).toBe(input.params.length);
          }
          return { rows: [], rowsAffected: 0 };
        }
        return fake.executor(input);
      };
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        generateId: nextId([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7101",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f7102",
        ]),
        maxListLimit: 2,
      });
      const common = {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
        permission: guardedPermission(),
        requiredPermissionScope: [],
      } as const;

      await expect(
        repository.createMany([
          { ...common, question: "First unrelated question" },
          { ...common, question: "Second unrelated question" },
        ]),
      ).resolves.toHaveLength(2);
      expect(
        calls.filter(
          (call) => call.tableName === "deletion_jobs" && call.sql.includes("golden_candidate"),
        ),
      ).toHaveLength(1);
      const candidates = JSON.parse(
        String(
          calls.find(
            (call) => call.tableName === "deletion_jobs" && call.sql.includes("golden_candidate"),
          )?.params[0],
        ),
      ) as unknown[];
      expect(candidates).toHaveLength(2);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "does not fence Golden Questions when a source is detached with documents kept (%s)",
    async (dialect) => {
      const fake = createFakeGoldenQuestionExecutor();
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push({ ...input, params: [...input.params] });
        if (input.tableName === "deletion_jobs") {
          return isGoldenQuestionTargetDeletionRead(input)
            ? {
                rows: [
                  {
                    delete_mode: "keep",
                    target_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7209",
                    target_type: "source",
                  },
                ],
                rowsAffected: 1,
              }
            : { rows: [], rowsAffected: 0 };
        }
        return fake.executor(input);
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
          knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa",
          permission: guardedPermission(),
          question: "Preserved source evidence",
          requiredPermissionScope: [],
        }),
      ).resolves.toMatchObject({ question: "Preserved source evidence" });
      expect(
        calls.some(
          (call) => call.tableName === "golden_questions" && call.sql.includes("golden_candidate"),
        ),
      ).toBe(false);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects create when a matching deletion follows an active Source keep job (%s)",
    async (dialect) => {
      const fake = createMultipleActiveGoldenDeletionExecutor(dialect, "source_keep");
      const repository = createDatabaseGoldenQuestionRepository({
        database: fake.database,
        maxListLimit: 2,
      });

      await expect(
        repository.create({
          expectedEvidenceIds: [multipleDeletionMatchingAssetId],
          knowledgeSpaceId: goldenQuestionReadSpaceId,
          permission: guardedPermission(),
          question: "Must not revive target evidence after cleanup drained",
          requiredPermissionScope: [],
        }),
      ).rejects.toBeInstanceOf(GoldenQuestionDeletionFenceActiveError);

      expect(fake.storageCalls.filter((call) => call.operation === "insert")).toHaveLength(0);
      assertBatchedActiveGoldenDeletionCheck(dialect, fake.calls, 1);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects a Golden Question batch when a matching deletion follows an unrelated job (%s)",
    async (dialect) => {
      const fake = createMultipleActiveGoldenDeletionExecutor(dialect, "unrelated_asset");
      const repository = createDatabaseGoldenQuestionRepository({
        database: fake.database,
        maxListLimit: 2,
      });
      const common = {
        knowledgeSpaceId: goldenQuestionReadSpaceId,
        permission: guardedPermission(),
        requiredPermissionScope: [],
      } as const;

      await expect(
        repository.createMany([
          { ...common, question: "Unrelated candidate" },
          {
            ...common,
            expectedEvidenceIds: [multipleDeletionMatchingAssetId],
            question: "Matching candidate",
          },
        ]),
      ).rejects.toBeInstanceOf(GoldenQuestionDeletionFenceActiveError);

      expect(fake.storageCalls.filter((call) => call.operation === "insert")).toHaveLength(0);
      assertBatchedActiveGoldenDeletionCheck(dialect, fake.calls, 2);
    },
  );

  it.each([
    ["postgres", "source_keep"],
    ["postgres", "unrelated_asset"],
    ["tidb", "source_keep"],
    ["tidb", "unrelated_asset"],
  ] as const)(
    "rejects update after cleanup drained when a matching deletion follows %s on %s",
    async (dialect, firstJob) => {
      const fake = createMultipleActiveGoldenDeletionExecutor(dialect, firstJob, false);
      const repository = createDatabaseGoldenQuestionRepository({
        database: fake.database,
        generateId: () => goldenQuestionTargetId,
        maxListLimit: 2,
      });
      const created = await repository.create({
        expectedEvidenceIds: [multipleDeletionMatchingAssetId],
        knowledgeSpaceId: goldenQuestionReadSpaceId,
        permission: guardedPermission(),
        question: "Created before deletion",
        requiredPermissionScope: [],
      });
      fake.setDeletionActive(true);
      fake.resetCalls();

      await expect(
        repository.update({
          id: created.id,
          knowledgeSpaceId: goldenQuestionReadSpaceId,
          permission: guardedPermission(),
          question: "Must not be written after target cleanup",
        }),
      ).rejects.toBeInstanceOf(GoldenQuestionDeletionFenceActiveError);

      expect(fake.storageCalls.filter((call) => call.operation === "update")).toHaveLength(0);
      assertBatchedActiveGoldenDeletionCheck(dialect, fake.calls, 1);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "fences update and delete when the stored Golden Question references the child target (%s)",
    async (dialect) => {
      const fake = createFakeGoldenQuestionExecutor();
      let childDeletionActive = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "deletion_jobs") {
          if (!childDeletionActive || !input.sql.includes("golden_candidate")) {
            return { rows: [], rowsAffected: 0 };
          }
          if (dialect === "tidb") {
            expect((input.sql.match(/\?/g) ?? []).length).toBe(input.params.length);
          }
          return { rows: [{ id: "matching-delete" }], rowsAffected: 1 };
        }
        return fake.executor(input);
      };
      const repository = createDatabaseGoldenQuestionRepository({
        database: createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        }),
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7101",
        maxListLimit: 2,
      });
      const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa";
      const created = await repository.create({
        expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7209"],
        knowledgeSpaceId,
        permission: guardedPermission(),
        question: "Target evidence",
        requiredPermissionScope: [],
      });

      childDeletionActive = true;
      await expect(
        repository.update({
          id: created.id,
          knowledgeSpaceId,
          permission: guardedPermission(),
          question: "Must remain fenced",
        }),
      ).rejects.toBeInstanceOf(GoldenQuestionDeletionFenceActiveError);
      await expect(
        repository.delete({
          id: created.id,
          knowledgeSpaceId,
          permission: guardedPermission(),
        }),
      ).rejects.toBeInstanceOf(GoldenQuestionDeletionFenceActiveError);
      expect(fake.calls.filter((call) => call.operation === "update")).toHaveLength(0);
      expect(fake.calls.filter((call) => call.operation === "delete")).toHaveLength(0);
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

function isGoldenQuestionTargetDeletionRead(input: DatabaseExecuteInput): boolean {
  return input.sql.includes('SELECT "target_type"') || input.sql.includes("SELECT `target_type`");
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

function createGoldenQuestionDeletionReadExecutor(
  dialect: "postgres" | "tidb",
  deletion: {
    readonly deleteMode: "cascade" | "keep" | null;
    readonly linkage?: "evidence_match" | "expected" | undefined;
    readonly targetType: "document_asset" | "logical_document" | "source";
  },
) {
  const calls: DatabaseExecuteInput[] = [];
  const targetEvidenceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7209";
  const evidenceMatchOnly = deletion.linkage === "evidence_match";
  const targetRow = goldenQuestionReadRow({
    evidenceId: evidenceMatchOnly ? undefined : targetEvidenceId,
    id: goldenQuestionTargetId,
    metadata: evidenceMatchOnly
      ? {
          evidenceMatch: {
            documentAssetId: targetEvidenceId,
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7219",
          },
          evidenceText: "sensitive evidence text from the deleting target",
        }
      : {
          evidenceContext: { expectedEvidenceIds: [targetEvidenceId] },
          evidenceText: "sensitive evidence text from the deleting target",
        },
  });
  const unrelatedRow = goldenQuestionReadRow({
    evidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7210",
    id: goldenQuestionUnrelatedId,
    metadata: { evidenceText: "unrelated evidence text" },
  });
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });
    if (input.operation !== "select" || input.tableName !== "golden_questions") {
      return { rows: [], rowsAffected: 0 };
    }
    const queryScopesChildDeletion =
      input.sql.includes(`'${deletion.targetType}'`) &&
      (evidenceMatchOnly
        ? input.sql.includes("evidenceMatch") &&
          input.sql.includes("documentAssetId") &&
          input.sql.includes("nodeId")
        : input.sql.includes("expected_evidence_ids") && input.sql.includes("evidenceContext"));
    const targetIsVisible = deletion.deleteMode === "keep" || !queryScopesChildDeletion;
    const visibleRows = [
      ...(targetIsVisible ? [targetRow] : []),
      unrelatedRow,
    ] satisfies readonly DatabaseRow[];
    if (input.sql.includes("ORDER BY")) {
      return {
        rows: visibleRows.slice(0, Number(input.params.at(-1))),
        rowsAffected: 0,
      };
    }
    const selected = visibleRows.find((row) => input.params.includes(String(row.id)));
    return { rows: selected ? [selected] : [], rowsAffected: 0 };
  };
  return { calls, executor };
}

function goldenQuestionReadRow(input: {
  readonly evidenceId?: string | undefined;
  readonly id: string;
  readonly metadata: Record<string, unknown>;
}): DatabaseRow {
  return {
    created_at:
      input.id === goldenQuestionTargetId ? "2026-07-14T14:00:00.000Z" : "2026-07-14T14:01:00.000Z",
    expected_evidence_ids: input.evidenceId ? [input.evidenceId] : [],
    id: input.id,
    knowledge_space_id: goldenQuestionReadSpaceId,
    metadata: input.metadata,
    question: `Question ${input.id}`,
    required_permission_scope: [],
    tags: [],
    tenant_id: "tenant-1",
    updated_at: "2026-07-14T14:01:00.000Z",
  };
}

const goldenQuestionReadSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f72aa";
const goldenQuestionTargetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7109";
const goldenQuestionUnrelatedId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7110";

function createMultipleActiveGoldenDeletionExecutor(
  dialect: "postgres" | "tidb",
  firstJob: "source_keep" | "unrelated_asset",
  initiallyActive = true,
) {
  const storage = createFakeGoldenQuestionExecutor();
  const calls: DatabaseExecuteInput[] = [];
  let deletionActive = initiallyActive;
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });
    if (input.tableName === "deletion_jobs") {
      if (!deletionActive) return { rows: [], rowsAffected: 0 };
      if (input.sql.includes("golden_candidate")) {
        return { rows: [{ id: "matching-delete" }], rowsAffected: 1 };
      }
      if (!isGoldenQuestionTargetDeletionRead(input)) {
        return { rows: [], rowsAffected: 0 };
      }
      const first =
        firstJob === "source_keep"
          ? {
              delete_mode: "keep",
              target_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7298",
              target_type: "source",
            }
          : {
              delete_mode: "cascade",
              target_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7298",
              target_type: "document_asset",
            };
      return {
        // The legacy LIMIT 1 lookup observes only this first active job. The executor's batched
        // conflict branch above models the matching second job returned by the joined ANY query.
        rows: [first],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "golden_questions" && input.sql.includes("golden_candidate")) {
      return { rows: [], rowsAffected: 0 };
    }
    return storage.executor(input);
  };
  return {
    calls,
    database: createSchemaDatabaseAdapter({
      executor: execute,
      kind: dialect,
      transaction: async (callback) => callback({ execute }),
    }),
    setDeletionActive: (active: boolean) => {
      deletionActive = active;
    },
    resetCalls: () => {
      calls.length = 0;
    },
    storageCalls: storage.calls,
  };
}

function assertBatchedActiveGoldenDeletionCheck(
  dialect: "postgres" | "tidb",
  calls: readonly DatabaseExecuteInput[],
  candidateCount: number,
): void {
  const conflictChecks = calls.filter(
    (call) => call.tableName === "deletion_jobs" && call.sql.includes("golden_candidate"),
  );
  expect(conflictChecks).toHaveLength(1);
  const check = conflictChecks[0];
  expect(check?.params.slice(1)).toEqual(["tenant-1", goldenQuestionReadSpaceId]);
  const candidates = JSON.parse(String(check?.params[0])) as unknown[];
  expect(candidates).toHaveLength(candidateCount);
  expect(check?.sql).not.toContain("SELECT `target_type`");
  expect(check?.sql).not.toContain('SELECT "target_type"');
  if (dialect === "tidb") {
    expect((check?.sql.match(/\?/g) ?? []).length).toBe(check?.params.length);
  }
}

const multipleDeletionMatchingAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7299";

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
      const insertedRows: DatabaseRow[] = [];
      for (let offset = 0; offset < input.params.length; offset += 10) {
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
        ] = input.params.slice(offset, offset + 10);
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
        insertedRows.push(row);
      }

      return { rows: insertedRows.map((row) => ({ ...row })), rowsAffected: insertedRows.length };
    }

    if (input.operation === "select") {
      if (input.sql.includes("sourceBadCaseId")) {
        const [, knowledgeSpaceId, , sourceBadCaseId] = input.params;
        const row = [...rows.values()].find(
          (candidate) =>
            candidate.knowledge_space_id === String(knowledgeSpaceId) &&
            (candidate.metadata as Record<string, unknown>).sourceBadCaseId === sourceBadCaseId,
        );
        return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
      }
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
