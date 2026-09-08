import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";
import { createDatabaseDocumentChunkRepository } from "./document-chunk-repository";
import { lockTerminalDocumentMutationCompilation } from "./document-mutation-compilation-fence";
import { createDatabaseDocumentSettingsRepository } from "./document-settings-repository";
import { createDatabaseLogicalDocumentRepository } from "./logical-document-repository";

describe("document mutation compilation fence", () => {
  it.each(["postgres", "tidb"] as const)(
    "all three repositories recheck a retried attempt inside the mutation transaction (%s)",
    async (dialect) => {
      const queries: DatabaseExecuteInput[] = [];
      let transactions = 0;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        queries.push(input);
        if (input.tableName === "knowledge_spaces")
          return {
            rows: [{ id: "space", lifecycle_state: "active", deletion_job_id: null }],
            rowsAffected: 0,
          };
        if (input.tableName === "document_compilation_attempts")
          return { rows: [{ run_state: "queued" }], rowsAffected: 0 };
        return { rows: [], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({
        kind: dialect,
        executor: execute,
        transaction: async (callback) => {
          transactions += 1;
          return callback({ execute });
        },
      });
      const scope = {
        tenantId: "tenant",
        knowledgeSpaceId: "space",
        documentId: "document",
        expectedCompilationAttemptId: "attempt",
        now: "2026-09-08T00:00:00Z",
      };
      const mutations = [
        () =>
          createDatabaseLogicalDocumentRepository({ database, maxListLimit: 100 }).failCandidate({
            ...scope,
            revision: 1,
          }),
        () =>
          createDatabaseDocumentSettingsRepository({ database }).fail({
            ...scope,
            attemptId: "settings",
            errorCode: "MODEL_RUNTIME_RESPONSE_INVALID",
            errorMessage: "Invalid response",
            expectedRowVersion: 1,
          }),
        () =>
          createDatabaseDocumentChunkRepository({
            database,
            maxBatchSize: 100,
            maxListLimit: 100,
          }).failStateChange({ ...scope, changeId: "chunk" }),
      ];
      for (const mutate of mutations) await expect(mutate()).rejects.toThrow("no longer terminal");
      expect(transactions).toBe(3);
      expect(queries.every((query) => query.operation === "select")).toBe(true);
    },
  );
  it.each(["postgres", "tidb"] as const)(
    "rejects restarted, succeeded and missing attempts under a current locking read (%s)",
    async (dialect) => {
      for (const state of [
        "queued",
        "running",
        "succeeded",
        undefined,
        "failed",
        "canceled",
        "superseded",
      ]) {
        const queries: string[] = [];
        const database = createSchemaDatabaseAdapter({
          kind: dialect,
          executor: async (input) => {
            queries.push(input.sql);
            if (input.tableName === "knowledge_spaces")
              return {
                rows: [{ id: "space", lifecycle_state: "active", deletion_job_id: null }],
                rowsAffected: 0,
              };
            if (input.tableName === "document_compilation_attempts")
              return { rows: state ? [{ run_state: state }] : [], rowsAffected: 0 };
            return { rows: [], rowsAffected: 0 };
          },
        });
        const result = lockTerminalDocumentMutationCompilation(database, database, {
          tenantId: "tenant",
          knowledgeSpaceId: "space",
          documentId: "document",
          expectedCompilationAttemptId: "attempt",
        });
        if (state && ["failed", "canceled", "superseded"].includes(state))
          await expect(result).resolves.toBeUndefined();
        else await expect(result).rejects.toThrow("no longer terminal");
        expect(queries[0]).toContain("knowledge_spaces");
        expect(queries.at(-1)).toContain("FOR UPDATE");
      }
    },
  );

  it("does not touch attempts or product state while the document is being deleted", async () => {
    const tables: string[] = [];
    const database = createSchemaDatabaseAdapter({
      kind: "postgres",
      executor: async (input) => {
        tables.push(input.tableName);
        return {
          rows:
            input.tableName === "knowledge_spaces"
              ? [{ id: "space", lifecycle_state: "deleting", deletion_job_id: "deletion" }]
              : [],
          rowsAffected: 0,
        };
      },
    });
    await expect(
      lockTerminalDocumentMutationCompilation(database, database, {
        tenantId: "tenant",
        knowledgeSpaceId: "space",
        documentId: "document",
        expectedCompilationAttemptId: "attempt",
      }),
    ).rejects.toThrow("fenced by deletion");
    expect(tables).toEqual(["knowledge_spaces"]);
  });
});
