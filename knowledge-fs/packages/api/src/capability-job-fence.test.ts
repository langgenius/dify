import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseTransactionCallback,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { CapabilityPublicationFencedError } from "./capability-grant-provenance";
import {
  assertCapabilityJobPublicationAllowed,
  resolveCapabilityJobPublicationGrant,
} from "./capability-job-fence";

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
      return {
        rows: [{ grant_id: scope.capabilityGrantId, space_tombstoned: false }],
        rowsAffected: 0,
      };
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
    expect(calls[0]?.sql).toContain("state");
    expect(calls[0]?.sql).toContain("capability_space_fences");
    expect(calls[0]?.sql).toContain("tombstoned");
    expect(calls[0]?.sql).toContain("FOR UPDATE");
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

  it("fails closed when the locked space fence is tombstoned", async () => {
    const database = adapter(dialect, async () => ({
      rows: [{ grant_id: scope.capabilityGrantId, space_tombstoned: true }],
      rowsAffected: 0,
    }));

    await expect(
      database.transaction((transaction) =>
        assertCapabilityJobPublicationAllowed(database, transaction, scope),
      ),
    ).rejects.toBeInstanceOf(CapabilityPublicationFencedError);
  });

  it("enforces an exact durable action and resource binding when requested", async () => {
    const expectedBinding = {
      action: "source_sync_policies.update",
      resource: {
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e12",
        parentId: scope.knowledgeSpaceId,
        type: "source",
      },
    } as const;
    const row = {
      action: expectedBinding.action,
      content_scope_ids: JSON.stringify(["team:camera"]),
      resource_id: expectedBinding.resource.id,
      resource_parent_id: expectedBinding.resource.parentId,
      resource_type: expectedBinding.resource.type,
      space_tombstoned: false,
      subject_id: "editor-a",
    };
    const resolve = (patch: Record<string, unknown> = {}) => {
      const database = adapter(dialect, async () => ({
        rows: [{ ...row, ...patch }],
        rowsAffected: 0,
      }));
      return database.transaction((transaction) =>
        resolveCapabilityJobPublicationGrant(database, transaction, {
          ...scope,
          expectedBinding,
        }),
      );
    };

    await expect(resolve()).resolves.toEqual({
      contentScopeIds: ["team:camera"],
      subjectId: "editor-a",
    });
    for (const patch of [
      { action: "source_workflows.sync.create" },
      { resource_type: "document" },
      { resource_id: "another-source" },
      { resource_parent_id: "another-space" },
    ]) {
      await expect(resolve(patch)).rejects.toBeInstanceOf(CapabilityPublicationFencedError);
    }
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
