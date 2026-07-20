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

function taskRow() {
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
  };
}
