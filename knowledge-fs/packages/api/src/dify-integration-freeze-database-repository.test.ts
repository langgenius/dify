import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { computeDifyIntegrationFreezeId } from "./dify-integration-freeze";
import { createDatabaseDifyIntegrationFreezeRepository } from "./dify-integration-freeze-database-repository";

const timestamp = "2026-07-21T12:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}`;
const evidence = {
  freezeRevision: 7,
  namespaceId: "tenant-a",
  sourceRevisionDigest: digest,
  sourceTaskWatermark: 12,
};
const freezeId = computeDifyIntegrationFreezeId(evidence);

describe.each(["postgres", "tidb"] as const)("database Dify integration freeze (%s)", (dialect) => {
  it("persists the first tenant freeze and reads exact evidence", async () => {
    const script = scriptedDatabase(dialect, [
      { operation: "select", rows: [] },
      { operation: "insert", rowsAffected: 1 },
      { operation: "select", rows: [stateRow()] },
    ]);
    const repository = createDatabaseDifyIntegrationFreezeRepository({
      database: script.database,
      now: () => timestamp,
    });

    await expect(repository.freeze({ ...evidence, freezeId })).resolves.toMatchObject({
      applied: true,
      replayed: false,
    });
    await expect(repository.get("tenant-a")).resolves.toMatchObject({
      freezeId,
      sourceTaskWatermark: 12,
    });
    expect(script.calls[1]?.params).toEqual([
      "tenant-a",
      freezeId,
      7,
      digest,
      12,
      timestamp,
      timestamp,
    ]);
    script.expectDone();
  });

  it("returns an exact lost-ACK replay without writing", async () => {
    const script = scriptedDatabase(dialect, [{ operation: "select", rows: [stateRow()] }]);

    await expect(
      createDatabaseDifyIntegrationFreezeRepository({ database: script.database }).freeze({
        ...evidence,
        freezeId,
      }),
    ).resolves.toMatchObject({ applied: false, replayed: true });
    script.expectDone();
  });
});

interface ScriptStep {
  readonly operation: DatabaseExecuteInput["operation"];
  readonly rows?: readonly DatabaseRow[] | undefined;
  readonly rowsAffected?: number | undefined;
}

function stateRow(): DatabaseRow {
  return {
    freeze_id: freezeId,
    freeze_revision: 7,
    frozen_at: timestamp,
    source_revision_digest: digest,
    source_task_watermark: 12,
    tenant_id: "tenant-a",
    updated_at: timestamp,
  };
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
    expect(input).toMatchObject({
      operation: expected.operation,
      tableName: "dify_integration_freezes",
    });
    return {
      rows: expected.rows ?? [],
      rowsAffected: expected.rowsAffected ?? 0,
    };
  };
  const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>): Promise<T> =>
    callback({ execute });
  return {
    calls,
    database: createSchemaDatabaseAdapter({ executor: execute, kind: dialect, transaction }),
    expectDone: () => expect(cursor).toBe(steps.length),
  };
}
