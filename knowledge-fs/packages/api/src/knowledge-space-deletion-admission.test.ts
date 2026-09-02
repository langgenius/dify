import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeFsSessionDeletionFenceActiveError,
  createDatabaseKnowledgeFsSessionRepository,
} from "./knowledge-fs-session-repository";
import {
  lockKnowledgeSpaceForDocumentWriteAdmission,
  lockKnowledgeSpaceForRetrievalAdmission,
  lockKnowledgeSpaceForSourceWorkflowAdmission,
  lockKnowledgeSpaceForWholeSpaceDeletionAdmission,
} from "./knowledge-space-deletion-admission";

const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";

describe.each(["postgres", "tidb"] as const)(
  "knowledge-space deletion admission serialization (%s)",
  (dialect) => {
    it("orders a writer before deletion or rejects it after deletion without a late row", async () => {
      let activeDeletion = false;
      let lockOwner: number | undefined;
      let transactionSequence = 0;
      let inserted = 0;
      const waiters: Array<() => void> = [];
      const writerReachedInsert = deferred<void>();
      const allowWriterInsert = deferred<void>();
      const events: string[] = [];

      const acquireSpaceLock = async (transactionId: number) => {
        while (lockOwner !== undefined && lockOwner !== transactionId) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        lockOwner = transactionId;
      };
      const releaseSpaceLock = (transactionId: number) => {
        if (lockOwner !== transactionId) return;
        lockOwner = undefined;
        for (const resolve of waiters.splice(0)) resolve();
      };
      const execute =
        (transactionId: number) =>
        async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          if (input.tableName === "knowledge_spaces" && input.sql.includes("FOR UPDATE")) {
            await acquireSpaceLock(transactionId);
            events.push(`space-lock:${transactionId}`);
            return {
              rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "deletion_jobs" && input.operation === "select") {
            return {
              // A plain TiDB RR read would still see the pre-deletion snapshot here. Only a
              // current locking read is allowed to observe the job installed while waiting.
              rows:
                activeDeletion && input.sql.includes("FOR UPDATE")
                  ? [{ id: "active-deletion" }]
                  : [],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "knowledge_fs_sessions" && input.operation === "insert") {
            writerReachedInsert.resolve();
            await allowWriterInsert.promise;
            inserted += 1;
            events.push("writer-insert");
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        };
      const database = createSchemaDatabaseAdapter({
        executor: execute(0),
        kind: dialect,
        transaction: async <T>(callback: (executor: DatabaseExecutor) => Promise<T>) => {
          const transactionId = ++transactionSequence;
          try {
            return await callback({ execute: execute(transactionId) });
          } finally {
            releaseSpaceLock(transactionId);
          }
        },
      });
      const sessions = createDatabaseKnowledgeFsSessionRepository({
        database,
        maxListLimit: 10,
      });

      const writer = sessions.create(sessionInput());
      await writerReachedInsert.promise;
      let deletionAcquired = false;
      const deletion = database.transaction(async (transaction) => {
        await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: ["tenant-1", spaceId],
          sql: "SELECT id FROM knowledge_spaces WHERE tenant_id = ? AND id = ? FOR UPDATE;",
          tableName: "knowledge_spaces",
        });
        deletionAcquired = true;
        activeDeletion = true;
        events.push("deletion-active");
      });
      await Promise.resolve();
      expect(deletionAcquired).toBe(false);

      allowWriterInsert.resolve();
      await expect(writer).resolves.toMatchObject({ id: sessionInput().id });
      await deletion;
      expect(events.indexOf("writer-insert")).toBeLessThan(events.indexOf("deletion-active"));
      expect(inserted).toBe(1);

      await expect(
        sessions.create({ ...sessionInput(), id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3b02" }),
      ).rejects.toBeInstanceOf(KnowledgeFsSessionDeletionFenceActiveError);
      expect(inserted).toBe(1);
    });
  },
);

describe.each(["postgres", "tidb"] as const)(
  "document-scoped deletion admission (%s)",
  (dialect) => {
    it("checks only space and matching document hierarchy deletions", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (input.tableName === "knowledge_spaces") {
            return {
              rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });

      await expect(
        lockKnowledgeSpaceForDocumentWriteAdmission(database, database, {
          documentAssetId: assetId,
          documentId,
          knowledgeSpaceId: spaceId,
          sourceId,
          tenantId: "tenant-1",
        }),
      ).resolves.toBe(true);

      const deletionRead = calls.find((call) => call.tableName === "deletion_jobs");
      if (dialect === "postgres") {
        expect(deletionRead?.params).toEqual(["tenant-1", spaceId, sourceId, documentId, assetId]);
      } else {
        expect(deletionRead?.params.slice(0, 2)).toEqual(["tenant-1", spaceId]);
        expect(deletionRead?.params).toEqual(
          expect.arrayContaining([sourceId, documentId, assetId]),
        );
      }
      expect(deletionRead?.sql).toContain("target_type");
      expect(deletionRead?.sql).toContain("'knowledge_space'");
      expect(deletionRead?.sql).toContain("'source'");
      expect(deletionRead?.sql).toContain("'logical_document'");
      expect(deletionRead?.sql).toContain("'document_asset'");
      expect(deletionRead?.sql).toContain("logical_documents");
      expect(deletionRead?.sql).toContain("document_revisions");
      expect(deletionRead?.sql).toContain("document_assets");
      expect(deletionRead?.sql).not.toContain("<> 'source'");
      expect(deletionRead?.sql).toContain("FOR UPDATE");
      assertSqlPlaceholderArity(deletionRead, dialect);
    });

    it("binds every TiDB placeholder for retrieval and Source workflow scopes", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          if (input.tableName === "knowledge_spaces") {
            return {
              rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });

      await expect(
        lockKnowledgeSpaceForRetrievalAdmission(database, database, {
          knowledgeSpaceId: spaceId,
          tenantId: "tenant-1",
        }),
      ).resolves.toBe(true);
      await expect(
        lockKnowledgeSpaceForSourceWorkflowAdmission(database, database, {
          knowledgeSpaceId: spaceId,
          sourceId,
          tenantId: "tenant-1",
          workflowId: "workflow-1",
        }),
      ).resolves.toBe(true);
      await expect(
        lockKnowledgeSpaceForWholeSpaceDeletionAdmission(database, database, {
          knowledgeSpaceId: spaceId,
          tenantId: "tenant-1",
        }),
      ).resolves.toBe(true);

      const deletionReads = calls.filter((call) => call.tableName === "deletion_jobs");
      expect(deletionReads).toHaveLength(3);
      for (const deletionRead of deletionReads) {
        assertSqlPlaceholderArity(deletionRead, dialect);
      }
      for (const deletionRead of [deletionReads[0], deletionReads[2]]) {
        expect(deletionRead?.sql).toContain("'knowledge_space'");
        expect(deletionRead?.sql).not.toContain("'source'");
        expect(deletionRead?.sql).not.toContain("'logical_document'");
        expect(deletionRead?.sql).not.toContain("'document_asset'");
      }
      expect(deletionReads[1]?.sql).toContain("idempotency_key");
      expect(deletionReads[1]?.params).toContain("source-remote-missing:workflow-1:%");
    });

    it("keeps a space deletion as a hard blocker", async () => {
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          if (input.tableName === "knowledge_spaces") {
            return {
              rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "deletion_jobs") {
            return { rows: [{ id: "space-deletion" }], rowsAffected: 0 };
          }
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });

      await expect(
        lockKnowledgeSpaceForDocumentWriteAdmission(database, database, {
          documentAssetId: assetId,
          knowledgeSpaceId: spaceId,
          tenantId: "tenant-1",
        }),
      ).resolves.toBe(false);
    });
  },
);

function sessionInput() {
  return {
    clientKind: "api" as const,
    clientVersion: "1.0.0",
    consistencyClass: "path-consistent" as const,
    createdAt: "2026-07-14T12:00:00.000Z",
    expiresAt: "2026-07-14T12:05:00.000Z",
    heartbeatAt: "2026-07-14T12:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3b01",
    knowledgeSpaceId: spaceId,
    metadata: {},
    permissionSnapshot: ["knowledge-spaces:read"],
    subject: {
      scopes: ["knowledge-spaces:read"],
      subjectId: "subject-1",
      tenantId: "tenant-1",
    },
    tenantId: "tenant-1",
    updatedAt: "2026-07-14T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function assertSqlPlaceholderArity(
  call: DatabaseExecuteInput | undefined,
  dialect: "postgres" | "tidb",
): void {
  expect(call).toBeDefined();
  if (!call) return;
  if (dialect === "tidb") {
    expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
    return;
  }
  const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
  expect(Math.max(0, ...positions)).toBe(call.params.length);
}
