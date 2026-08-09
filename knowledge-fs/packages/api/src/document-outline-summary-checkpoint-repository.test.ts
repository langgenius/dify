import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseDocumentOutlineSummaryCheckpointRepository,
  createInMemoryDocumentOutlineSummaryCheckpointRepository,
} from "./document-outline-summary-checkpoint-repository";

const scope = {
  documentAssetId: uuid(2),
  documentVersion: 1,
  knowledgeSpaceId: uuid(1),
  publicationGenerationId: uuid(3),
  tenantId: "tenant-1",
};
const checkpoint = {
  inputFingerprint: `sha256:${"a".repeat(64)}`,
  metadata: { requestId: "request-1" },
  outlineNodeId: "node-1",
  summary: "Persisted summary",
};

describe("document outline summary checkpoints", () => {
  it("keeps the first exact-input result authoritative in memory", async () => {
    const repository = createInMemoryDocumentOutlineSummaryCheckpointRepository();

    await repository.putMany({ checkpoints: [checkpoint], scope });
    const [replayed] = await repository.putMany({
      checkpoints: [{ ...checkpoint, summary: "non-deterministic replay" }],
      scope,
    });

    expect(replayed?.summary).toBe("Persisted summary");
    await expect(
      repository.getMany({
        keys: [checkpoint],
        scope,
      }),
    ).resolves.toEqual([checkpoint]);
  });

  it.each(["postgres", "tidb"] as const)(
    "inserts idempotently and rereads the authoritative %s row",
    async (dialect) => {
      const script = scriptedDatabase(dialect, [
        { operation: "insert", rowsAffected: 1 },
        { operation: "select", rows: [checkpointRow()] },
      ]);
      const repository = createDatabaseDocumentOutlineSummaryCheckpointRepository({
        database: script.database,
        maxBatchSize: 8,
        now: () => "2026-08-09T00:00:00.000Z",
      });

      await expect(repository.putMany({ checkpoints: [checkpoint], scope })).resolves.toEqual([
        checkpoint,
      ]);
      expect(script.calls[0]?.sql).toContain(
        dialect === "postgres" ? "ON CONFLICT" : "INSERT IGNORE",
      );
      expect(script.calls[0]?.sql).toContain(
        dialect === "postgres" ? "::jsonb" : "CAST(? AS JSON)",
      );
      script.expectDone();
    },
  );

  it("validates exact fingerprints and batch bounds before querying", async () => {
    const script = scriptedDatabase("postgres", []);
    const repository = createDatabaseDocumentOutlineSummaryCheckpointRepository({
      database: script.database,
      maxBatchSize: 1,
    });

    await expect(
      repository.getMany({
        keys: [checkpoint, { ...checkpoint, outlineNodeId: "node-2" }],
        scope,
      }),
    ).rejects.toThrow("exceeds maxBatchSize=1");
    await expect(
      repository.getMany({
        keys: [{ inputFingerprint: "invalid", outlineNodeId: "node-1" }],
        scope,
      }),
    ).rejects.toThrow("inputFingerprint is invalid");
    script.expectDone();
  });
});

function checkpointRow(): DatabaseRow {
  return {
    input_fingerprint: checkpoint.inputFingerprint,
    metadata: checkpoint.metadata,
    outline_node_id: checkpoint.outlineNodeId,
    summary: checkpoint.summary,
  };
}

interface ScriptStep {
  readonly operation: DatabaseExecuteInput["operation"];
  readonly rows?: readonly DatabaseRow[] | undefined;
  readonly rowsAffected?: number | undefined;
}

function scriptedDatabase(
  dialect: DatabaseAdapter["dialect"],
  steps: readonly ScriptStep[],
): {
  readonly calls: readonly DatabaseExecuteInput[];
  readonly database: DatabaseAdapter;
  expectDone(): void;
} {
  let cursor = 0;
  const calls: DatabaseExecuteInput[] = [];
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    const expected = steps[cursor];
    if (!expected) throw new Error(`Unexpected SQL call ${input.operation} ${input.tableName}`);
    cursor += 1;
    expect(input.operation).toBe(expected.operation);
    return { rows: [...(expected.rows ?? [])], rowsAffected: expected.rowsAffected ?? 0 };
  };
  const executor: DatabaseExecutor = { execute };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (operation) => operation(executor),
  });
  return {
    calls,
    database,
    expectDone: () => expect(cursor).toBe(steps.length),
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}
