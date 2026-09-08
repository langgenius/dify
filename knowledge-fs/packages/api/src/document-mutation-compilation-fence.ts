import type { DatabaseAdapter, DatabaseExecutor } from "@knowledge/core";

import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { lockKnowledgeSpaceForDocumentWriteAdmission } from "./knowledge-space-deletion-admission";

export interface DocumentMutationCompilationFence {
  /** Internal reconciliation fence; ordinary staging compensation does not supply this. */
  readonly expectedCompilationAttemptId?: string | undefined;
}

/** Follow retry/control lock order: space -> compilation attempt -> product intent. */
export async function lockTerminalDocumentMutationCompilation(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: DocumentMutationCompilationFence & {
    readonly tenantId: string;
    readonly knowledgeSpaceId: string;
    readonly documentId: string;
  },
): Promise<void> {
  if (!input.expectedCompilationAttemptId) return;
  if (!(await lockKnowledgeSpaceForDocumentWriteAdmission(database, executor, input))) {
    throw new Error("Document mutation reconciliation is fenced by deletion");
  }
  const q = (column: string) => quoteDatabaseIdentifier(database, column);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.expectedCompilationAttemptId],
    sql: `SELECT ${q("run_state")} FROM ${q("document_compilation_attempts")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} = ${p(3)} FOR UPDATE;`,
    tableName: "document_compilation_attempts",
  });
  if (!["failed", "canceled", "superseded"].includes(String(result.rows[0]?.run_state))) {
    throw new Error("Document mutation compilation is no longer terminal");
  }
}
