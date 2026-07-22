import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  FailedQueryCapacityExceededError,
  FailedQueryPromotionConflictError,
  createDatabaseFailedQueryRepository,
  createInMemoryFailedQueryRepository,
} from "./failed-query-repository";
import {
  createInMemoryGoldenQuestionRepository,
  inMemoryGoldenQuestionPromotionParticipant,
} from "./golden-question-repository";

const SPACE_A = "10000000-0000-4000-8000-000000000001";
const SPACE_B = "10000000-0000-4000-8000-000000000002";
const TENANT_ID = "tenant-1";
const SUBJECT_ID = "editor-1";
const CANDIDATE_GRANTS = ["subject:editor-1", "tenant:tenant-1"] as const;

function fixedId(seed: number): () => string {
  let index = seed;

  return () => `00000000-0000-4000-8000-${(index++).toString(16).padStart(12, "0")}`;
}

function readAuth() {
  return {
    candidateGrants: CANDIDATE_GRANTS,
    subjectId: SUBJECT_ID,
    tenantId: TENANT_ID,
  } as const;
}

function permissionBinding() {
  return {
    accessChannel: "interactive" as const,
    candidateGrants: CANDIDATE_GRANTS,
    permissionSnapshotId: "10000000-0000-4000-8000-000000000099",
    permissionSnapshotRevision: 1,
    requestedBySubjectId: SUBJECT_ID,
  };
}

function captureAuth() {
  return { permission: permissionBinding(), tenantId: TENANT_ID } as const;
}

function mutationAuth() {
  return { ...readAuth(), permission: permissionBinding() } as const;
}

describe("createInMemoryFailedQueryRepository", () => {
  it("creates, gets, filters by status, and updates failed queries", async () => {
    const repository = createInMemoryFailedQueryRepository({
      generateId: fixedId(1),
      maxFailedQueries: 10,
      now: () => "2026-07-06T00:00:00.000Z",
    });

    const created = await repository.create({
      ...captureAuth(),
      answerTraceId: "trace-1",
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "what is x",
      trigger: "no-retrieval-evidence",
    });
    expect(created).toMatchObject({
      answerTraceId: "trace-1",
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "what is x",
      status: "pending-triage",
      trigger: "no-retrieval-evidence",
    });

    await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "deep",
      query: "another",
      status: "dismissed",
      trigger: "no-retrieval-evidence",
    });
    // Cross-space isolation.
    await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_B,
      mode: "fast",
      query: "b space",
      trigger: "no-retrieval-evidence",
    });

    const pending = await repository.list({
      ...readAuth(),
      knowledgeSpaceId: SPACE_A,
      limit: 10,
      status: "pending-triage",
    });
    expect(pending.items.map((item) => item.query)).toEqual(["what is x"]);

    const all = await repository.list({ ...readAuth(), knowledgeSpaceId: SPACE_A, limit: 10 });
    expect(all.items).toHaveLength(2);

    const triaged = await repository.update({
      ...mutationAuth(),
      id: created.id,
      knowledgeSpaceId: SPACE_A,
      status: "triaged",
    });
    expect(triaged?.status).toBe("triaged");
    await expect(
      repository.update({
        ...mutationAuth(),
        id: created.id,
        knowledgeSpaceId: SPACE_B,
        status: "dismissed",
      }),
    ).resolves.toBeNull();
  });

  it("counts by status within a space", async () => {
    const repository = createInMemoryFailedQueryRepository({ maxFailedQueries: 10 });
    await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "a",
      trigger: "no-retrieval-evidence",
    });
    await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "b",
      status: "promoted",
      trigger: "no-retrieval-evidence",
    });
    await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_B,
      mode: "fast",
      query: "c",
      trigger: "no-retrieval-evidence",
    });

    await expect(
      repository.countByStatus({ ...readAuth(), knowledgeSpaceId: SPACE_A }),
    ).resolves.toEqual({
      "pending-triage": 1,
      promoted: 1,
    });
  });

  it("isolates exact subjects and requires every captured permission grant", async () => {
    const repository = createInMemoryFailedQueryRepository({ maxFailedQueries: 10 });
    const required = ["subject:editor-1", "team:camera", "tenant:tenant-1"] as const;
    await repository.create({
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      permission: {
        ...permissionBinding(),
        candidateGrants: required,
      },
      query: "private camera question",
      tenantId: TENANT_ID,
      trigger: "no-retrieval-evidence",
    });

    await expect(
      repository.list({
        candidateGrants: required,
        knowledgeSpaceId: SPACE_A,
        limit: 10,
        subjectId: "editor-2",
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      repository.list({
        candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
        knowledgeSpaceId: SPACE_A,
        limit: 10,
        subjectId: SUBJECT_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ items: [] });
  });

  it("paginates by id cursor and enforces capacity", async () => {
    const repository = createInMemoryFailedQueryRepository({
      generateId: fixedId(1),
      maxFailedQueries: 2,
    });

    await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "one",
      trigger: "no-retrieval-evidence",
    });
    await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "two",
      trigger: "no-retrieval-evidence",
    });
    await expect(
      repository.create({
        ...captureAuth(),
        knowledgeSpaceId: SPACE_A,
        mode: "fast",
        query: "three",
        trigger: "no-retrieval-evidence",
      }),
    ).rejects.toBeInstanceOf(FailedQueryCapacityExceededError);

    const first = await repository.list({ ...readAuth(), knowledgeSpaceId: SPACE_A, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeDefined();
    const second = await repository.list({
      ...readAuth(),
      cursor: first.nextCursor,
      knowledgeSpaceId: SPACE_A,
      limit: 1,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
  });

  it("atomically promotes once and replays the same durable promotion without duplicates", async () => {
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: fixedId(500),
      maxListLimit: 20,
      maxQuestions: 20,
      now: () => "2026-07-06T01:00:00.000Z",
    });
    const repository = createInMemoryFailedQueryRepository({
      generateId: fixedId(1),
      goldenQuestions,
      maxFailedQueries: 10,
    });
    const failed = await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "What is the camera sensor size?",
      trigger: "no-retrieval-evidence",
    });
    const input = {
      ...mutationAuth(),
      expectedEvidenceIds: ["10000000-0000-4000-8000-000000000088"],
      expectedEvidencePermissionScope: [],
      id: failed.id,
      knowledgeSpaceId: SPACE_A,
      note: "Known retrieval miss",
      promotedAt: "2026-07-06T01:00:00.000Z",
    } as const;

    const first = await repository.promote(input);
    const replay = await repository.promote({
      ...input,
      promotedAt: "2026-07-06T02:00:00.000Z",
    });
    expect(replay).toEqual(first);
    expect(first?.failedQuery).toMatchObject({
      metadata: {
        annotation: {
          annotatedAt: "2026-07-06T01:00:00.000Z",
          goldenQuestionId: first?.goldenQuestion.id,
          verdict: "retrieval-miss",
        },
      },
      status: "promoted",
    });
    await expect(
      goldenQuestions.listTrusted({ knowledgeSpaceId: SPACE_A, limit: 20 }),
    ).resolves.toMatchObject({ items: [{ id: first?.goldenQuestion.id }] });
    await expect(
      repository.promote({
        ...input,
        expectedEvidenceIds: ["10000000-0000-4000-8000-000000000089"],
      }),
    ).rejects.toBeInstanceOf(FailedQueryPromotionConflictError);
  });

  it("validates repository bounds and list limits", async () => {
    expect(() => createInMemoryFailedQueryRepository({ maxFailedQueries: 0 })).toThrow(
      "maxFailedQueries must be at least 1",
    );
    const repository = createInMemoryFailedQueryRepository({ maxFailedQueries: 1 });
    await expect(
      repository.list({ ...readAuth(), knowledgeSpaceId: SPACE_A, limit: 0 }),
    ).rejects.toThrow("list limit must be at least 1");
    await expect(
      repository.list({ ...readAuth(), knowledgeSpaceId: SPACE_A, limit: 1.5 }),
    ).rejects.toThrow("list limit must be at least 1");
  });

  it("covers hidden gets, missing promotions, and metadata-only updates", async () => {
    const repository = createInMemoryFailedQueryRepository({
      generateId: fixedId(20),
      maxFailedQueries: 3,
    });
    const created = await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "metadata update",
      trigger: "no-retrieval-evidence",
    });
    await expect(
      repository.get({ ...readAuth(), id: "missing", knowledgeSpaceId: SPACE_A }),
    ).resolves.toBeNull();
    await expect(
      repository.get({ ...readAuth(), id: created.id, knowledgeSpaceId: SPACE_B }),
    ).resolves.toBeNull();
    await expect(
      repository.get({
        ...readAuth(),
        id: created.id,
        knowledgeSpaceId: SPACE_A,
        tenantId: "another-tenant",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.promote({
        ...mutationAuth(),
        expectedEvidencePermissionScope: [],
        id: "missing",
        knowledgeSpaceId: SPACE_A,
        promotedAt: "2026-07-06T03:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.update({
        ...mutationAuth(),
        id: created.id,
        knowledgeSpaceId: SPACE_A,
        metadata: { reviewed: true },
      }),
    ).resolves.toMatchObject({ metadata: { reviewed: true }, status: "pending-triage" });
  });

  it("requires an atomic in-memory golden-question participant", async () => {
    const repository = createInMemoryFailedQueryRepository({ maxFailedQueries: 2 });
    const failed = await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "cannot promote",
      trigger: "no-retrieval-evidence",
    });
    await expect(
      repository.promote({
        ...mutationAuth(),
        expectedEvidencePermissionScope: [],
        id: failed.id,
        knowledgeSpaceId: SPACE_A,
        promotedAt: "2026-07-06T03:00:00.000Z",
      }),
    ).rejects.toThrow("Atomic in-memory failed-query promotion is unavailable");
  });

  it("promotes without optional annotations and detects a dangling replay target", async () => {
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: fixedId(700),
      maxListLimit: 10,
      maxQuestions: 10,
    });
    const participant = goldenQuestions[inMemoryGoldenQuestionPromotionParticipant];
    let hideGoldenQuestion = false;
    const repository = createInMemoryFailedQueryRepository({
      generateId: fixedId(30),
      goldenQuestions: {
        ...goldenQuestions,
        [inMemoryGoldenQuestionPromotionParticipant]: participant,
        get: async (input: Parameters<typeof goldenQuestions.get>[0]) =>
          hideGoldenQuestion ? null : goldenQuestions.get(input),
      } as never,
      maxFailedQueries: 2,
    });
    const failed = await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "optional annotation",
      trigger: "no-retrieval-evidence",
    });
    const input = {
      ...mutationAuth(),
      expectedEvidencePermissionScope: [],
      id: failed.id,
      knowledgeSpaceId: SPACE_A,
      promotedAt: "2026-07-06T03:00:00.000Z",
    } as const;
    await expect(repository.promote(input)).resolves.toMatchObject({
      failedQuery: { status: "promoted" },
    });
    hideGoldenQuestion = true;
    await expect(repository.promote(input)).rejects.toThrow(
      "promotion state does not match its golden question",
    );
  });

  it("rejects malformed or mismatched permission bindings", async () => {
    const repository = createInMemoryFailedQueryRepository({ maxFailedQueries: 10 });
    const failed = await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "invalid evidence scope",
      trigger: "no-retrieval-evidence",
    });
    for (const [permission, subjectId, candidateGrants] of [
      [permissionBinding(), "another-subject", CANDIDATE_GRANTS],
      [
        { ...permissionBinding(), candidateGrants: [" duplicate", "tenant:tenant-1"] },
        SUBJECT_ID,
        CANDIDATE_GRANTS,
      ],
      [permissionBinding(), SUBJECT_ID, ["subject:editor-1", "different"]],
      [permissionBinding(), SUBJECT_ID, ["subject:editor-1"]],
      [{ ...permissionBinding(), candidateGrants: ["same", "same"] }, SUBJECT_ID, ["same", "same"]],
    ] as const) {
      await expect(
        repository.update({
          candidateGrants,
          id: failed.id,
          knowledgeSpaceId: SPACE_A,
          permission: permission as never,
          status: "dismissed",
          subjectId,
          tenantId: TENANT_ID,
        }),
      ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    }

    await expect(
      repository.promote({
        ...mutationAuth(),
        candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
        expectedEvidencePermissionScope: ["private"],
        id: failed.id,
        knowledgeSpaceId: SPACE_A,
        promotedAt: "2026-07-06T03:00:00.000Z",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    await expect(
      repository.promote({
        ...mutationAuth(),
        expectedEvidencePermissionScope: [" invalid"],
        id: failed.id,
        knowledgeSpaceId: SPACE_A,
        promotedAt: "2026-07-06T03:00:00.000Z",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
  });
});

describe("createDatabaseFailedQueryRepository", () => {
  it.each(["postgres", "tidb"] as const)(
    "applies tenant, exact subject, complete provenance and candidate ACL before LIMIT/GROUP BY on %s",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({ executor, kind });
      const repository = createDatabaseFailedQueryRepository({ database });

      await repository.list({
        ...readAuth(),
        cursor: { id: "00000000-0000-4000-8000-000000000001" },
        knowledgeSpaceId: SPACE_A,
        limit: 5,
      });
      await repository.countByStatus({ ...readAuth(), knowledgeSpaceId: SPACE_A });

      const [list, counts] = calls;
      expect(list?.params.slice(0, 4)).toEqual([
        TENANT_ID,
        SPACE_A,
        SUBJECT_ID,
        JSON.stringify(CANDIDATE_GRANTS),
      ]);
      const acl = kind === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS";
      for (const call of [list, counts]) {
        expect(call?.sql).toContain("requested_by_subject_id");
        expect(call?.sql).toContain("permission_snapshot_id");
        expect(call?.sql).toContain("permission_snapshot_revision");
        expect(call?.sql).toContain("revision");
        expect(call?.sql).toContain(acl);
      }
      expect(list?.sql.indexOf(acl)).toBeLessThan(list?.sql.indexOf("LIMIT") ?? 0);
      expect(counts?.sql.indexOf(acl)).toBeLessThan(counts?.sql.indexOf("GROUP BY") ?? 0);
    },
  );

  it("inserts a failed-query row and filters by status", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return {
          rows: [{ deletion_job_id: null, id: SPACE_A, lifecycle_state: "active" }],
          rowsAffected: 1,
        };
      }
      const fence = permissionFenceResult(input);
      if (fence) return fence;
      return { rows: [], rowsAffected: 1 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: executor }),
    });
    const repository = createDatabaseFailedQueryRepository({
      database,
      generateId: fixedId(1),
      now: () => "2026-07-06T00:00:00.000Z",
    });

    await repository.create({
      ...captureAuth(),
      knowledgeSpaceId: SPACE_A,
      mode: "fast",
      query: "what is x",
      trigger: "no-retrieval-evidence",
    });
    const lock = calls[0];
    expect(lock).toMatchObject({ operation: "select", tableName: "knowledge_spaces" });
    expect(lock?.sql).toContain("FOR UPDATE");
    expect(lock?.sql).toContain("lifecycle_state");
    expect(lock?.sql).toContain("deletion_job_id");
    const insert = calls.find(
      (call) => call.tableName === "failed_queries" && call.operation === "insert",
    );
    expect(insert?.operation).toBe("insert");
    expect(insert?.sql).toContain('INSERT INTO "failed_queries"');
    expect(insert?.sql).toContain("deletion_jobs");
    expect(insert?.sql).toContain("active_slot");
    expect(insert?.sql).toContain("answer_traces");
    expect(insert?.sql).toContain("permission_snapshot_revision");
    expect(insert?.params).toContain("no-retrieval-evidence");
    expect(insert?.params).toContain("pending-triage");
    expect(insert?.params.slice(9, 15)).toEqual([
      SUBJECT_ID,
      "interactive",
      permissionBinding().permissionSnapshotId,
      1,
      JSON.stringify(CANDIDATE_GRANTS),
      1,
    ]);
    const permissionFence = calls.find(
      (call) => call.tableName === "knowledge_space_permission_snapshots",
    );
    expect(permissionFence?.sql).toContain("FOR UPDATE");
    expect(calls.indexOf(permissionFence as DatabaseExecuteInput)).toBeLessThan(
      calls.indexOf(insert as DatabaseExecuteInput),
    );

    await repository.list({
      ...readAuth(),
      knowledgeSpaceId: SPACE_A,
      limit: 5,
      status: "pending-triage",
    });
    const select = calls.at(-1);
    expect(select?.sql).toContain('"status" =');
    expect(select?.params).toContain("pending-triage");
  });

  it.each(["postgres", "tidb"] as const)(
    "rolls back %s create when deletion is active or the answer trace is absent/cross-space",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      let rolledBack = false;
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: SPACE_A, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        const fence = permissionFenceResult(input);
        if (fence) return fence;
        return { rows: [], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({
        executor,
        kind,
        transaction: async (callback) => {
          try {
            return await callback({ execute: executor });
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        },
      });
      const repository = createDatabaseFailedQueryRepository({ database });

      await expect(
        repository.create({
          ...captureAuth(),
          answerTraceId: "10000000-0000-4000-8000-000000000099",
          knowledgeSpaceId: SPACE_A,
          mode: "deep",
          query: "must not dangle",
          trigger: "no-retrieval-evidence",
        }),
      ).rejects.toThrow(
        "Failed query creation rejected by deletion fence or missing same-space answer trace",
      );
      expect(rolledBack).toBe(true);
      expect(calls[0]).toMatchObject({ operation: "select", tableName: "knowledge_spaces" });
      const insert = calls.find(
        (call) => call.operation === "insert" && call.tableName === "failed_queries",
      ) as DatabaseExecuteInput;
      expect(insert.sql).toContain("NOT EXISTS");
      expect(insert.sql).toContain("answer_trace_id");
      expect(insert.sql).toContain("knowledge_space_id");
      assertPlaceholderArity(insert, kind);
    },
  );

  it("rejects an unavailable space before attempting a failed-query write", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return { rows: [], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: executor }),
    });

    await expect(
      createDatabaseFailedQueryRepository({ database }).create({
        ...captureAuth(),
        knowledgeSpaceId: SPACE_A,
        mode: "fast",
        query: "blocked",
        trigger: "no-retrieval-evidence",
      }),
    ).rejects.toThrow("Failed query write rejected because knowledge space is unavailable");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ operation: "select", tableName: "knowledge_spaces" });
  });

  it("rejects an active deletion job before permission or failed-query writes", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return {
          rows: [{ deletion_job_id: null, id: SPACE_A, lifecycle_state: "active" }],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "deletion_jobs") {
        return { rows: [{ id: "active-delete" }], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: executor }),
    });

    await expect(
      createDatabaseFailedQueryRepository({ database }).create({
        ...captureAuth(),
        knowledgeSpaceId: SPACE_A,
        mode: "fast",
        query: "blocked by deletion",
        trigger: "no-retrieval-evidence",
      }),
    ).rejects.toThrow("Failed query write rejected because knowledge space is unavailable");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.sql).toContain("active_slot");
    expect(calls[1]?.sql).toContain("FOR UPDATE");
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
    expect(calls.some((call) => call.tableName === "knowledge_space_permission_snapshots")).toBe(
      false,
    );
  });

  it("rejects a mutation before row selection when its fresh permission is revoked", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return {
          rows: [{ deletion_job_id: null, id: SPACE_A, lifecycle_state: "active" }],
          rowsAffected: 1,
        };
      }
      return { rows: [], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: executor }),
    });

    await expect(
      createDatabaseFailedQueryRepository({ database }).update({
        ...mutationAuth(),
        id: "00000000-0000-4000-8000-000000000001",
        knowledgeSpaceId: SPACE_A,
        status: "dismissed",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    expect(calls.some((call) => call.operation === "update")).toBe(false);
    expect(
      calls.some((call) => call.tableName === "failed_queries" && call.operation === "select"),
    ).toBe(false);
  });

  it.each(["postgres", "tidb"] as const)(
    "rolls back the golden insert when promotion CAS fails and retries idempotently on %s",
    async (kind) => {
      const failedId = "10000000-0000-4000-8000-000000000077";
      let failPromotionCas = true;
      let durable = {
        failed: {
          access_channel: "interactive",
          answer_trace_id: null,
          created_at: "2026-07-06T00:00:00.000Z",
          id: failedId,
          knowledge_space_id: SPACE_A,
          metadata: {},
          mode: "fast",
          permission_snapshot_id: permissionBinding().permissionSnapshotId,
          permission_snapshot_revision: 1,
          query: "What is the camera sensor size?",
          requested_by_subject_id: SUBJECT_ID,
          required_permission_scope: [...CANDIDATE_GRANTS],
          revision: 1,
          status: "pending-annotation",
          tenant_id: TENANT_ID,
          trigger: "no-retrieval-evidence",
          updated_at: "2026-07-06T00:00:00.000Z",
        },
        golden: [] as Record<string, unknown>[],
      };
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (
        input: DatabaseExecuteInput,
        staged: typeof durable,
      ): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: SPACE_A, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        const fence = permissionFenceResult(input);
        if (fence) return fence;
        if (input.tableName === "failed_queries" && input.operation === "select") {
          return { rows: [staged.failed], rowsAffected: 1 };
        }
        if (input.tableName === "golden_questions" && input.operation === "insert") {
          staged.golden.push({
            created_at: input.params[8],
            expected_evidence_ids: input.params[4],
            id: input.params[0],
            knowledge_space_id: input.params[2],
            metadata: input.params[6],
            question: input.params[3],
            required_permission_scope: input.params[7],
            tags: input.params[5],
            tenant_id: input.params[1],
            updated_at: input.params[9],
          });
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "failed_queries" && input.operation === "update") {
          if (failPromotionCas) return { rows: [], rowsAffected: 0 };
          staged.failed = {
            ...staged.failed,
            metadata: JSON.parse(String(input.params[1])) as Record<string, unknown>,
            revision: Number(staged.failed.revision) + 1,
            status: String(input.params[0]),
            updated_at: String(input.params[2]),
          };
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "golden_questions" && input.operation === "select") {
          return {
            rows: staged.golden.filter(
              (row) =>
                row.tenant_id === input.params[0] &&
                row.knowledge_space_id === input.params[1] &&
                row.id === input.params[2],
            ),
            rowsAffected: 0,
          };
        }
        throw new Error(`Unexpected promotion query: ${input.tableName}/${input.operation}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: async () => {
          throw new Error("Promotion must stay inside one database transaction");
        },
        kind,
        transaction: async (callback) => {
          const staged = structuredClone(durable);
          const result = await callback({ execute: (input) => execute(input, staged) });
          durable = staged;
          return result;
        },
      });
      const repository = createDatabaseFailedQueryRepository({
        database,
        generateGoldenQuestionId: fixedId(900),
      });
      const input = {
        ...mutationAuth(),
        expectedEvidenceIds: ["10000000-0000-4000-8000-000000000088"],
        expectedEvidencePermissionScope: [],
        id: failedId,
        knowledgeSpaceId: SPACE_A,
        note: "Known retrieval miss",
        promotedAt: "2026-07-06T01:00:00.000Z",
      } as const;

      await expect(repository.promote(input)).rejects.toThrow(
        "Failed-query promotion lost its revision fence",
      );
      expect(durable.golden).toHaveLength(0);
      expect(durable.failed.status).toBe("pending-annotation");
      const firstLockedFailed = calls.find(
        (call) => call.tableName === "failed_queries" && call.operation === "select",
      );
      const firstGoldenInsert = calls.find(
        (call) => call.tableName === "golden_questions" && call.operation === "insert",
      );
      const firstPermissionFence = calls.find(
        (call) => call.tableName === "knowledge_space_permission_snapshots",
      );
      expect(firstLockedFailed?.sql).toContain("requested_by_subject_id");
      expect(firstLockedFailed?.sql).toContain("FOR UPDATE");
      expect(firstLockedFailed?.sql).toContain(
        kind === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS",
      );
      expect(calls.indexOf(firstPermissionFence as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(firstLockedFailed as DatabaseExecuteInput),
      );
      expect(calls.indexOf(firstLockedFailed as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(firstGoldenInsert as DatabaseExecuteInput),
      );

      failPromotionCas = false;
      const committed = await repository.promote(input);
      const replayed = await repository.promote({
        ...input,
        promotedAt: "2026-07-06T02:00:00.000Z",
      });
      expect(replayed).toEqual(committed);
      expect(durable.golden).toHaveLength(1);
      expect(durable.failed.status).toBe("promoted");
      expect(
        calls.filter(
          (call) => call.tableName === "golden_questions" && call.operation === "insert",
        ),
      ).toHaveLength(2);
      const successfulInsert = calls.filter(
        (call) => call.tableName === "golden_questions" && call.operation === "insert",
      )[1];
      const successfulUpdate = calls.filter(
        (call) => call.tableName === "failed_queries" && call.operation === "update",
      )[1];
      expect(calls.indexOf(successfulInsert as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(successfulUpdate as DatabaseExecuteInput),
      );
      assertPlaceholderArity(successfulInsert as DatabaseExecuteInput, kind);
      assertPlaceholderArity(successfulUpdate as DatabaseExecuteInput, kind);
    },
  );

  it("aggregates counts by status via GROUP BY", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({
        rows: [
          { count: 3, status: "pending-triage" },
          { count: 2, status: "promoted" },
        ],
        rowsAffected: 0,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseFailedQueryRepository({ database });

    await expect(
      repository.countByStatus({ ...readAuth(), knowledgeSpaceId: SPACE_A }),
    ).resolves.toEqual({
      "pending-triage": 3,
      promoted: 2,
    });
  });
});

function permissionFenceResult(input: DatabaseExecuteInput): DatabaseExecuteResult | undefined {
  if (input.operation !== "select") return undefined;
  if (input.tableName === "knowledge_space_permission_snapshots") {
    return {
      rows: [
        {
          access_channel: "interactive",
          access_policy_revision: 1,
          api_access_revision: 1,
          api_key_expires_at: null,
          api_key_id: null,
          api_key_revision: null,
          created_at: "2026-07-06T00:00:00.000Z",
          expires_at: "2099-01-01T00:00:00.000Z",
          id: permissionBinding().permissionSnapshotId,
          knowledge_space_id: SPACE_A,
          member_revision: 1,
          permission_scopes: [...CANDIDATE_GRANTS],
          revision: 1,
          revoked_at: null,
          role: "editor",
          status: "active",
          subject_id: SUBJECT_ID,
          tenant_id: TENANT_ID,
          updated_at: "2026-07-06T00:00:00.000Z",
          visibility: "all_members",
        },
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
  return undefined;
}

function assertPlaceholderArity(call: DatabaseExecuteInput, dialect: "postgres" | "tidb"): void {
  if (dialect === "tidb") {
    expect(call.sql.match(/\?/g) ?? []).toHaveLength(call.params.length);
    return;
  }
  const positions = [...call.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  expect(Math.max(0, ...positions)).toBe(call.params.length);
}
