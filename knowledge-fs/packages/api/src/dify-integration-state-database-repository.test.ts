import { createHash } from "node:crypto";

import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseDifyIntegrationStateRepository } from "./dify-integration-state-database-repository";

const timestamp = "2026-07-21T12:00:00.000Z";
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const activationIdA = canonicalActivationId(7, "tenant-a", digestA);

interface ScriptStep {
  readonly operation: DatabaseExecuteInput["operation"];
  readonly rows?: readonly DatabaseRow[] | undefined;
  readonly rowsAffected?: number | undefined;
}

describe.each(["postgres", "tidb"] as const)("database Dify integration state (%s)", (dialect) => {
  it("inserts the first tenant-scoped activation", async () => {
    const script = scriptedDatabase(dialect, [
      { operation: "select", rows: [] },
      { operation: "insert", rowsAffected: 1 },
    ]);
    const repository = createDatabaseDifyIntegrationStateRepository({
      database: script.database,
      now: () => timestamp,
    });

    await expect(repository.activate(activation())).resolves.toMatchObject({
      applied: true,
      replayed: false,
      state: { activationRevision: 7, namespaceId: "tenant-a" },
    });
    expect(script.calls[0]?.params).toEqual(["tenant-a"]);
    expect(script.calls[0]?.sql).toContain("FOR UPDATE");
    expect(script.calls[1]?.params).toEqual([
      "tenant-a",
      activationIdA,
      7,
      digestA,
      timestamp,
      timestamp,
    ]);
    script.expectDone();
  });

  it("returns an exact lost-ACK replay without writing", async () => {
    const script = scriptedDatabase(dialect, [{ operation: "select", rows: [stateRow()] }]);

    await expect(
      createDatabaseDifyIntegrationStateRepository({ database: script.database }).activate(
        activation(),
      ),
    ).resolves.toMatchObject({ applied: false, replayed: true });
    script.expectDone();
  });

  it("converges when an identical first activation commits concurrently", async () => {
    const script = scriptedDatabase(dialect, [
      { operation: "select", rows: [] },
      { operation: "insert", rowsAffected: 0 },
      { operation: "select", rows: [stateRow()] },
    ]);

    await expect(
      createDatabaseDifyIntegrationStateRepository({ database: script.database }).activate(
        activation(),
      ),
    ).resolves.toMatchObject({ applied: false, replayed: true });
    script.expectDone();
  });

  it("fails closed if a suppressed concurrent insert has no durable row", async () => {
    const script = scriptedDatabase(dialect, [
      { operation: "select", rows: [] },
      { operation: "insert", rowsAffected: 0 },
      { operation: "select", rows: [] },
    ]);

    await expect(
      createDatabaseDifyIntegrationStateRepository({ database: script.database }).activate(
        activation(),
      ),
    ).rejects.toThrow("conflicts with durable state");
    script.expectDone();
  });

  it("CAS-updates a higher activation revision", async () => {
    const script = scriptedDatabase(dialect, [
      { operation: "select", rows: [stateRow()] },
      { operation: "update", rowsAffected: 1 },
    ]);
    const repository = createDatabaseDifyIntegrationStateRepository({
      database: script.database,
      now: () => "2026-07-21T12:01:00.000Z",
    });

    await expect(
      repository.activate(
        activation({
          activationRevision: 8,
          sourceRevisionDigest: digestB,
        }),
      ),
    ).resolves.toMatchObject({ applied: true, state: { activationRevision: 8 } });
    expect(script.calls[1]?.params).toEqual([
      canonicalActivationId(8, "tenant-a", digestB),
      8,
      digestB,
      "2026-07-21T12:01:00.000Z",
      "tenant-a",
      7,
    ]);
    script.expectDone();
  });

  it("fails closed when a concurrent activation wins the CAS", async () => {
    const script = scriptedDatabase(dialect, [
      { operation: "select", rows: [stateRow()] },
      { operation: "update", rowsAffected: 0 },
    ]);

    await expect(
      createDatabaseDifyIntegrationStateRepository({ database: script.database }).activate(
        activation({ activationRevision: 8 }),
      ),
    ).rejects.toThrow("conflicts with durable state");
    script.expectDone();
  });

  it("reads only the requested namespace without a fallback scan", async () => {
    const script = scriptedDatabase(dialect, [{ operation: "select", rows: [stateRow()] }]);

    await expect(
      createDatabaseDifyIntegrationStateRepository({ database: script.database }).get("tenant-a"),
    ).resolves.toMatchObject({ namespaceId: "tenant-a", activationRevision: 7 });
    expect(script.calls[0]?.params).toEqual(["tenant-a"]);
    expect(script.calls[0]?.maxRows).toBe(1);
    expect(script.calls[0]?.sql).not.toContain("FOR UPDATE");
    script.expectDone();
  });

  it("fails closed when durable activation evidence is corrupt", async () => {
    const script = scriptedDatabase(dialect, [
      {
        operation: "select",
        rows: [{ ...stateRow(), source_revision_digest: "sha256:invalid" }],
      },
    ]);

    await expect(
      createDatabaseDifyIntegrationStateRepository({ database: script.database }).get("tenant-a"),
    ).rejects.toThrow("lowercase SHA-256 digest");
    script.expectDone();
  });

  it("rejects an unnormalized namespace before issuing SQL", async () => {
    const script = scriptedDatabase(dialect, []);

    await expect(
      createDatabaseDifyIntegrationStateRepository({ database: script.database }).get(" tenant-a"),
    ).rejects.toThrow(TypeError);
    script.expectDone();
  });
});

function activation(
  overrides: Partial<{
    activationId: string;
    activationRevision: number;
    namespaceId: string;
    sourceRevisionDigest: string;
  }> = {},
) {
  const activationRevision = overrides.activationRevision ?? 7;
  const namespaceId = overrides.namespaceId ?? "tenant-a";
  const sourceRevisionDigest = overrides.sourceRevisionDigest ?? digestA;
  return {
    activationId:
      overrides.activationId ??
      canonicalActivationId(activationRevision, namespaceId, sourceRevisionDigest),
    activationRevision,
    namespaceId,
    sourceRevisionDigest,
  };
}

function stateRow(): DatabaseRow {
  return {
    activated_at: timestamp,
    activation_id: activationIdA,
    activation_revision: 7,
    source_revision_digest: digestA,
    tenant_id: "tenant-a",
    updated_at: timestamp,
  };
}

function canonicalActivationId(
  activationRevision: number,
  namespaceId: string,
  sourceRevisionDigest: string,
): string {
  const canonicalJson = JSON.stringify({
    activationRevision,
    namespaceId,
    sourceRevisionDigest,
  });
  return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
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
      tableName: "dify_integration_states",
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
