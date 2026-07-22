import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseTransactionCallback,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { CapabilityPublicationFencedError } from "./capability-grant-provenance";
import { assertCapabilityJobPublicationAllowed } from "./capability-job-fence";

const scope = {
  capabilityGrantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e10",
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e11",
  tenantId: "tenant-1",
};

describe.each(["postgres", "tidb"] as const)("capability job fence (%s)", (dialect) => {
  it("checks active grant and the monotonic space fence inside the caller transaction", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = adapter(dialect, async (input) => {
      calls.push(input);
      return { rows: [{ grant_id: scope.capabilityGrantId }], rowsAffected: 0 };
    });

    await database.transaction(async (transaction) => {
      await expect(
        assertCapabilityJobPublicationAllowed(database, transaction, scope),
      ).resolves.toBeUndefined();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      operation: "select",
      params: [scope.tenantId, scope.knowledgeSpaceId, scope.capabilityGrantId],
      tableName: "capability_grants",
    });
    expect(calls[0]?.sql).toContain("capability_space_fences");
    expect(calls[0]?.sql).toContain("state");
    expect(calls[0]?.sql).toContain("tombstoned");
    expect(calls[0]?.sql).toContain("highest_revoke_sequence");
    expect(calls[0]?.sql.toLowerCase()).not.toContain("bearer");
    expect(calls[0]?.sql.toLowerCase()).not.toContain("jti");
    assertPlaceholderArity(calls[0] as DatabaseExecuteInput, dialect);
  });

  it("fails closed when revoke or a space tombstone removes the active row", async () => {
    const database = adapter(dialect, async () => ({ rows: [], rowsAffected: 0 }));

    await expect(
      database.transaction((transaction) =>
        assertCapabilityJobPublicationAllowed(database, transaction, scope),
      ),
    ).rejects.toBeInstanceOf(CapabilityPublicationFencedError);
  });
});

function adapter(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
): DatabaseAdapter {
  return {
    dialect,
    execute,
    kind: dialect,
    transaction: async <T>(callback: DatabaseTransactionCallback<T>) => callback({ execute }),
  } as unknown as DatabaseAdapter;
}

function assertPlaceholderArity(call: DatabaseExecuteInput, dialect: "postgres" | "tidb"): void {
  if (dialect === "tidb") {
    expect(call.sql.match(/\?/gu) ?? []).toHaveLength(call.params.length);
    return;
  }
  const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
  expect(Math.max(0, ...positions)).toBe(call.params.length);
}
