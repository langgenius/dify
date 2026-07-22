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

const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

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
