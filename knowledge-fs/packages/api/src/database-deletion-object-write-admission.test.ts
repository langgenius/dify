import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createDatabaseDeletionObjectWriteAdmission } from "./database-deletion-object-write-admission";
import { DeletionObjectWriteAdmissionError } from "./deletion-object-write-admission";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

describe("database deletion object-write admission", () => {
  for (const dialect of ["postgres", "tidb"] as const) {
    it(`holds a dialect-compatible row lock across the complete write (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return input.tableName === "knowledge_spaces"
          ? {
              rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
              rowsAffected: 0,
            }
          : { rows: [], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const admission = createDatabaseDeletionObjectWriteAdmission(database);

      await expect(
        admission.withSpaceWriteAdmission({ knowledgeSpaceId, tenantId }, async () => "stored"),
      ).resolves.toBe("stored");

      expect(calls).toHaveLength(2);
      expect(calls[0]?.params).toEqual([tenantId, knowledgeSpaceId]);
      expect(calls[0]?.sql).toContain(dialect === "postgres" ? "FOR SHARE" : "FOR UPDATE");
      expect(calls[0]?.sql).not.toContain("LOCK IN SHARE MODE");
      expect(calls[0]?.sql).not.toContain("lifecycle_state =");
      expect(calls[1]?.tableName).toBe("deletion_jobs");
      expect(calls[1]?.sql).toContain("active_slot");
      expect(calls[1]?.sql).toContain(dialect === "postgres" ? "FOR SHARE" : "FOR UPDATE");
    });

    it(`makes deletion wait for an admitted put and rejects puts admitted after deletion (${dialect})`, async () => {
      const gate = new SharedExclusiveGate();
      let deletionActive = false;
      const database = createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [], rowsAffected: 0 }),
        kind: dialect,
        transaction: async <T>(callback: (executor: DatabaseExecutor) => Promise<T>) => {
          await gate.acquireShared();
          try {
            return await callback({
              execute: async (input) =>
                input.tableName === "knowledge_spaces"
                  ? {
                      rows: [
                        {
                          deletion_job_id: deletionActive ? "deletion-job" : null,
                          id: knowledgeSpaceId,
                          lifecycle_state: "active",
                        },
                      ],
                      rowsAffected: 0,
                    }
                  : { rows: [], rowsAffected: 0 },
            });
          } finally {
            gate.releaseShared();
          }
        },
      });
      const admission = createDatabaseDeletionObjectWriteAdmission(database);
      const putStarted = deferred<void>();
      const allowPutToFinish = deferred<void>();
      const order: string[] = [];

      const put = admission.withSpaceWriteAdmission({ knowledgeSpaceId, tenantId }, async () => {
        order.push("put-start");
        putStarted.resolve();
        await allowPutToFinish.promise;
        order.push("put-end");
        return "stored";
      });
      await putStarted.promise;
      const deletion = (async () => {
        await gate.acquireExclusive();
        try {
          deletionActive = true;
          order.push("delete-admitted");
        } finally {
          gate.releaseExclusive();
        }
      })();
      await Promise.resolve();
      expect(order).toEqual(["put-start"]);

      allowPutToFinish.resolve();
      await expect(put).resolves.toBe("stored");
      await deletion;
      expect(order).toEqual(["put-start", "put-end", "delete-admitted"]);

      const lateWrite = vi.fn(async () => "late");
      await expect(
        admission.withSpaceWriteAdmission({ knowledgeSpaceId, tenantId }, lateWrite),
      ).rejects.toBeInstanceOf(DeletionObjectWriteAdmissionError);
      expect(lateWrite).not.toHaveBeenCalled();
    });
  }
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value as T),
  };
}

class SharedExclusiveGate {
  private exclusive = false;
  private exclusiveWaiters: (() => void)[] = [];
  private shared = 0;
  private sharedWaiters: (() => void)[] = [];

  async acquireShared(): Promise<void> {
    if (this.exclusive || this.exclusiveWaiters.length > 0) {
      await new Promise<void>((resolve) => this.sharedWaiters.push(resolve));
    }
    this.shared += 1;
  }

  releaseShared(): void {
    this.shared -= 1;
    if (this.shared === 0) this.exclusiveWaiters.shift()?.();
  }

  async acquireExclusive(): Promise<void> {
    if (this.exclusive || this.shared > 0) {
      await new Promise<void>((resolve) => this.exclusiveWaiters.push(resolve));
    }
    this.exclusive = true;
  }

  releaseExclusive(): void {
    this.exclusive = false;
    const nextExclusive = this.exclusiveWaiters.shift();
    if (nextExclusive) {
      nextExclusive();
      return;
    }
    for (const resolve of this.sharedWaiters.splice(0)) resolve();
  }
}
