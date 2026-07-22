import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseDocumentProcessingTaskRepository,
  createInMemoryDocumentProcessingTaskRepository,
  documentTaskSseEvents,
} from "./document-processing-task-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";

describe("document processing task repository", () => {
  it("filters hidden tasks before applying the page limit", async () => {
    const hidden = task("task-hidden", "2026-07-14T12:00:00.000Z");
    const visible = task("task-visible", "2026-07-14T12:01:00.000Z");
    const repository = createInMemoryDocumentProcessingTaskRepository({
      canReadTask: ({ candidateGrants, task: candidate }) =>
        candidateGrants.includes("document:read") && candidate.id !== hidden.id,
      tasks: () => [hidden, visible],
    });

    await expect(
      repository.list({
        candidateGrants: ["document:read"],
        knowledgeSpaceId,
        limit: 1,
        tenantId,
      }),
    ).resolves.toMatchObject({ items: [{ id: "task-visible" }] });
    await expect(
      repository.list({ candidateGrants: [], knowledgeSpaceId, limit: 1, tenantId }),
    ).resolves.toEqual({ items: [] });
  });

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`joins the exact revision asset and applies candidate ACL before LIMIT (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          return { rows: [taskRow()], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const repository = createDatabaseDocumentProcessingTaskRepository({
        database,
        maxListLimit: 100,
      });

      await expect(
        repository.list({
          candidateGrants: ["document:read"],
          documentId,
          knowledgeSpaceId,
          limit: 1,
          tenantId,
        }),
      ).resolves.toMatchObject({ items: [{ documentId, id: "task-visible" }] });

      const query = calls.at(-1);
      expect(query?.params).toEqual([
        tenantId,
        knowledgeSpaceId,
        JSON.stringify(["document:read"]),
        documentId,
        2,
      ]);
      expect(query?.sql).toContain("document_revisions");
      expect(query?.sql).toContain("document_assets");
      expect(query?.sql).toContain("permissionScope");
      expect(query?.sql.indexOf("permissionScope")).toBeLessThan(
        query?.sql.lastIndexOf("LIMIT") ?? -1,
      );
      expectAssetDeletionVisibilityBeforeLimit(query?.sql, dialect);
    });
  }

  it("emits one progress event and exactly one terminal event", () => {
    const events = documentTaskSseEvents({
      ...task("task-terminal", "2026-07-14T12:00:00.000Z"),
      completedAt: "2026-07-14T12:02:00.000Z",
      errorCode: "PARSER_FAILED",
      progressPercent: 20,
      stage: "parsed",
      state: "failed",
      updatedAt: "2026-07-14T12:02:00.000Z",
    });
    expect(events).toEqual([
      expect.objectContaining({ event: "progress", id: "task-terminal:2026-07-14T12:02:00.000Z" }),
      expect.objectContaining({
        data: { errorCode: "PARSER_FAILED", state: "failed" },
        event: "terminal",
        id: "task-terminal:terminal",
      }),
    ]);
  });

  it("gets exact in-memory tasks, paginates ties, and applies document cursors", async () => {
    const first = task("task-a", "2026-07-14T12:00:00.000Z");
    const second = task("task-b", "2026-07-14T12:00:00.000Z");
    const otherDocument = { ...task("task-c", "2026-07-14T12:01:00.000Z"), documentId: "other" };
    const repository = createInMemoryDocumentProcessingTaskRepository({
      canReadTask: async () => true,
      tasks: async () => [otherDocument, second, first],
    });

    await expect(
      repository.get({ documentId, knowledgeSpaceId, taskId: first.id, tenantId }),
    ).resolves.toEqual(expect.not.objectContaining({ tenantId: expect.anything() }));
    await expect(
      repository.get({ documentId, knowledgeSpaceId, taskId: "missing", tenantId }),
    ).resolves.toBeNull();
    const page = await repository.list({
      candidateGrants: [],
      documentId,
      knowledgeSpaceId,
      limit: 1,
      tenantId,
    });
    expect(page).toMatchObject({
      items: [{ id: "task-a" }],
      nextCursor: { createdAt: first.createdAt, id: first.id },
    });
    await expect(
      repository.list({
        candidateGrants: [],
        cursor: page.nextCursor,
        documentId,
        knowledgeSpaceId,
        limit: 2,
        tenantId,
      }),
    ).resolves.toMatchObject({ items: [{ id: "task-b" }] });
  });

  it("validates in-memory and database list bounds", async () => {
    const memory = createInMemoryDocumentProcessingTaskRepository({
      canReadTask: () => true,
      tasks: () => [],
    });
    for (const limit of [0, 1.5, 101]) {
      await expect(
        memory.list({ candidateGrants: [], knowledgeSpaceId, limit, tenantId }),
      ).rejects.toThrow("Task list limit must be between 1 and 100");
    }
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({ rows: [], rowsAffected: 0 }),
      kind: "postgres",
    });
    for (const maxListLimit of [0, 1.5]) {
      expect(() =>
        createDatabaseDocumentProcessingTaskRepository({ database, maxListLimit }),
      ).toThrow("maxListLimit must be positive");
    }
    const repository = createDatabaseDocumentProcessingTaskRepository({
      database,
      maxListLimit: 2,
    });
    await expect(
      repository.list({ candidateGrants: [], knowledgeSpaceId, limit: 3, tenantId }),
    ).rejects.toThrow("Task list limit must be between 1 and 2");
  });

  it("maps every task state, optional database field, and invalid enum", async () => {
    for (const state of [
      "dispatch_pending",
      "queued",
      "running",
      "retry_wait",
      "succeeded",
      "failed",
      "canceled",
      "superseded",
    ] as const) {
      const database = createSchemaDatabaseAdapter({
        executor: async () => ({
          rows: [
            taskRow({
              completed_at: "2026-07-14T12:02:00.000Z",
              last_error_code: "FAILED",
              last_error_message: "failure",
              retry_at: "2026-07-14T12:03:00.000Z",
              run_state: state,
            }),
          ],
          rowsAffected: 1,
        }),
        kind: "postgres",
      });
      await expect(
        createDatabaseDocumentProcessingTaskRepository({ database, maxListLimit: 10 }).get({
          documentId,
          knowledgeSpaceId,
          taskId: "task-visible",
          tenantId,
        }),
      ).resolves.toMatchObject({
        completedAt: "2026-07-14T12:02:00.000Z",
        errorCode: "FAILED",
        errorMessage: "failure",
        retryAt: "2026-07-14T12:03:00.000Z",
        state,
      });
    }

    for (const row of [taskRow({ run_state: "invalid" }), taskRow({ checkpoint: "invalid" })]) {
      const database = createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [row], rowsAffected: 1 }),
        kind: "postgres",
      });
      await expect(
        createDatabaseDocumentProcessingTaskRepository({ database, maxListLimit: 10 }).get({
          documentId,
          knowledgeSpaceId,
          taskId: "task-visible",
          tenantId,
        }),
      ).rejects.toThrow("Invalid processing task");
    }
  });

  it("returns null database gets and paginates a cursor-only list", async () => {
    const emptyDatabase = createSchemaDatabaseAdapter({
      executor: async () => ({ rows: [], rowsAffected: 0 }),
      kind: "postgres",
    });
    await expect(
      createDatabaseDocumentProcessingTaskRepository({
        database: emptyDatabase,
        maxListLimit: 10,
      }).get({ documentId, knowledgeSpaceId, taskId: "missing", tenantId }),
    ).resolves.toBeNull();

    const calls: DatabaseExecuteInput[] = [];
    const rows = [taskRow(), taskRow({ created_at: "2026-07-14T12:01:00.000Z", id: "task-next" })];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return { rows, rowsAffected: 0 };
      },
      kind: "postgres",
    });
    const page = await createDatabaseDocumentProcessingTaskRepository({
      database,
      maxListLimit: 10,
    }).list({
      candidateGrants: [],
      cursor: { createdAt: "2026-07-14T11:00:00.000Z", id: "before" },
      knowledgeSpaceId,
      limit: 1,
      tenantId,
    });
    expect(page.nextCursor).toEqual({
      createdAt: "2026-07-14T12:00:00.000Z",
      id: "task-visible",
    });
    expect(calls[0]?.params).toEqual([
      tenantId,
      knowledgeSpaceId,
      "[]",
      "2026-07-14T11:00:00.000Z",
      "before",
      2,
    ]);
  });

  it("emits nonterminal and error-free terminal state variants", () => {
    expect(documentTaskSseEvents(task("running", NOW))).toHaveLength(1);
    for (const state of ["succeeded", "canceled", "superseded"] as const) {
      const events = documentTaskSseEvents({ ...task(state, NOW), state });
      expect(events).toHaveLength(2);
      expect(events[1]?.data).toEqual({ state });
    }
  });
});

function expectAssetDeletionVisibilityBeforeLimit(
  sql: string | undefined,
  dialect: "postgres" | "tidb",
): void {
  expect(sql).toBeDefined();
  const identifier = (value: string) => (dialect === "postgres" ? `"${value}"` : `\`${value}\``);
  const limit = sql?.lastIndexOf("LIMIT") ?? -1;
  for (const predicate of [
    `asset.${identifier("lifecycle_state")} = 'active'`,
    `asset.${identifier("deletion_job_id")} IS NULL`,
    `task_list_parent_source.${identifier("status")} <> 'deleting'`,
    `task_list_parent_source.${identifier("deletion_job_id")} IS NULL`,
  ]) {
    expect(sql).toContain(predicate);
    expect(sql?.indexOf(predicate)).toBeLessThan(limit);
  }
}

function task(id: string, createdAt: string) {
  return {
    createdAt,
    documentId,
    documentRevision: 1,
    id,
    knowledgeSpaceId,
    progressPercent: 0,
    stage: "queued" as const,
    state: "queued" as const,
    tenantId,
    updatedAt: createdAt,
  };
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    checkpoint: "queued",
    completed_at: null,
    created_at: "2026-07-14T12:00:00.000Z",
    id: "task-visible",
    knowledge_space_id: knowledgeSpaceId,
    last_error_code: null,
    last_error_message: null,
    logical_document_id: documentId,
    logical_document_revision: 1,
    retry_at: null,
    run_state: "queued",
    updated_at: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}

const NOW = "2026-07-14T12:00:00.000Z";
