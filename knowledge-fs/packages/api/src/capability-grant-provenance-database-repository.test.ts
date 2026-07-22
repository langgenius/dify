import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { capabilityGrantClaimsDigest } from "./capability-grant-provenance";
import { createDatabaseCapabilityGrantProvenanceRepository } from "./capability-grant-provenance-database-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
const grantId = "20000000-0000-4000-8000-000000000001";
const timestamp = "2026-07-21T12:00:00.000Z";

interface ScriptStep {
  readonly operation: DatabaseExecuteInput["operation"];
  readonly rows: readonly DatabaseRow[];
  readonly tableName: string;
}

describe.each(["postgres", "tidb"] as const)(
  "database capability grant provenance (%s)",
  (dialect) => {
    it("admits and idempotently replays the immutable claims summary", async () => {
      const first = scriptedDatabase(dialect, [
        step("capability_grants", "select", []),
        step("capability_grants", "insert", []),
      ]);
      const repository = createDatabaseCapabilityGrantProvenanceRepository({
        database: first.database,
        now: () => timestamp,
      });

      await expect(repository.admit(grantInput())).resolves.toMatchObject({
        grantId,
        highestRevokeSequence: 0,
        revision: 1,
        state: "active",
      });
      const insert = first.calls[1];
      expect(insert?.params).not.toContain("Bearer secret");
      expect(insert?.sql.toLowerCase()).not.toContain("token");
      expect(insert?.sql).toContain(dialect === "postgres" ? "::jsonb" : " AS JSON");
      first.expectDone();

      const replay = scriptedDatabase(dialect, [step("capability_grants", "select", [grantRow()])]);
      await expect(
        createDatabaseCapabilityGrantProvenanceRepository({ database: replay.database }).admit(
          grantInput(),
        ),
      ).resolves.toMatchObject({ grantId, state: "active" });
      replay.expectDone();
    });

    it("applies only a higher grant revoke sequence and records stale delivery", async () => {
      const applied = scriptedDatabase(dialect, [
        step("capability_revoke_receipts", "select", []),
        step("capability_grants", "select", [grantRow()]),
        step("capability_grants", "update", []),
        step("capability_revoke_receipts", "insert", []),
      ]);
      const repository = createDatabaseCapabilityGrantProvenanceRepository({
        database: applied.database,
        now: () => timestamp,
      });

      await expect(
        repository.applyGrantRevoke({
          eventId: "event-3",
          grantId,
          knowledgeSpaceId,
          reasonCode: "permission_revoked",
          revokeSequence: 3,
          tenantId,
        }),
      ).resolves.toEqual({ applied: true, highestRevokeSequence: 3, state: "revoked" });
      expect(applied.calls[2]?.sql).toContain("highest_revoke_sequence");
      expect(applied.calls[2]?.sql).toContain("revision");
      applied.expectDone();

      const stale = scriptedDatabase(dialect, [
        step("capability_revoke_receipts", "select", []),
        step("capability_grants", "select", [
          grantRow({ highest_revoke_sequence: 3, state: "revoked" }),
        ]),
        step("capability_revoke_receipts", "insert", []),
      ]);
      await expect(
        createDatabaseCapabilityGrantProvenanceRepository({
          database: stale.database,
        }).applyGrantRevoke({
          eventId: "event-2",
          grantId,
          knowledgeSpaceId,
          reasonCode: "stale",
          revokeSequence: 2,
          tenantId,
        }),
      ).resolves.toEqual({ applied: false, highestRevokeSequence: 3, state: "revoked" });
      stale.expectDone();
    });

    it("creates a monotonic space tombstone and checks both fences before publication", async () => {
      const script = scriptedDatabase(dialect, [
        step("capability_revoke_receipts", "select", []),
        step("capability_space_fences", "select", []),
        step("capability_space_fences", "insert", []),
        step("capability_revoke_receipts", "insert", []),
        step("capability_grants", "select", []),
      ]);
      const repository = createDatabaseCapabilityGrantProvenanceRepository({
        database: script.database,
        now: () => timestamp,
      });

      await expect(
        repository.applySpaceFence({
          eventId: "space-delete-5",
          knowledgeSpaceId,
          reasonCode: "space_deleting",
          revokeSequence: 5,
          tenantId,
          tombstoned: true,
        }),
      ).resolves.toEqual({ applied: true, highestRevokeSequence: 5, tombstoned: true });
      await expect(
        repository.assertPublicationAllowed({ grantId, knowledgeSpaceId, tenantId }),
      ).rejects.toThrow("publication is fenced");
      const fenceRead = script.calls.at(-1);
      expect(fenceRead?.sql).toContain("capability_space_fences");
      expect(fenceRead?.params).toEqual([tenantId, knowledgeSpaceId, grantId]);
      script.expectDone();
    });

    it("rejects an event id replayed for a different revoke command", async () => {
      const script = scriptedDatabase(dialect, [
        step("capability_revoke_receipts", "select", [
          {
            applied: true,
            event_id: "event-reused",
            grant_id: "20000000-0000-4000-8000-000000000099",
            knowledge_space_id: knowledgeSpaceId,
            reason_code: "permission_revoked",
            received_at: timestamp,
            revoke_sequence: 3,
            target_kind: "grant",
            tenant_id: tenantId,
          },
        ]),
      ]);

      await expect(
        createDatabaseCapabilityGrantProvenanceRepository({
          database: script.database,
        }).applyGrantRevoke({
          eventId: "event-reused",
          grantId,
          knowledgeSpaceId,
          reasonCode: "permission_revoked",
          revokeSequence: 3,
          tenantId,
        }),
      ).rejects.toThrow("event id was reused");
      script.expectDone();
    });

    it("rejects a space event replayed with a different tombstone command", async () => {
      const script = scriptedDatabase(dialect, [
        step("capability_revoke_receipts", "select", [
          {
            applied: true,
            event_id: "space-event-reused",
            grant_id: null,
            knowledge_space_id: knowledgeSpaceId,
            reason_code: "space_deleting",
            received_at: timestamp,
            revoke_sequence: 7,
            target_kind: "space",
            tenant_id: tenantId,
            tombstoned: true,
          },
        ]),
      ]);

      await expect(
        createDatabaseCapabilityGrantProvenanceRepository({
          database: script.database,
        }).applySpaceFence({
          eventId: "space-event-reused",
          knowledgeSpaceId,
          reasonCode: "space_deleting",
          revokeSequence: 7,
          tenantId,
          tombstoned: false,
        }),
      ).rejects.toThrow("event id was reused");
      script.expectDone();
    });
  },
);

function grantInput() {
  return {
    action: "documents.create",
    actorId: "dify-account:actor-a",
    authzRevision: {
      credentialRevision: null,
      externalAccessEpoch: 4,
      membershipEpoch: 2,
      spaceAclEpoch: 3,
    },
    callerKind: "interactive" as const,
    contentPolicyRevision: 6,
    contentScopeIds: ["source-a"],
    expiresAt: "2026-07-21T12:01:00.000Z",
    grantId,
    issuedAt: timestamp,
    jtiHash: `sha256:${"a".repeat(64)}`,
    knowledgeSpaceId,
    resource: { id: "document-a", parentId: knowledgeSpaceId, type: "document" },
    subjectId: "dify-account:user-a",
    tenantId,
    traceId: "30000000-0000-4000-8000-000000000001",
  };
}

function grantRow(overrides: Partial<DatabaseRow> = {}): DatabaseRow {
  const input = grantInput();
  return {
    action: input.action,
    actor_id: input.actorId,
    admitted_at: timestamp,
    authz_revision: input.authzRevision,
    caller_kind: input.callerKind,
    claims_digest: capabilityGrantClaimsDigest(input),
    content_policy_revision: input.contentPolicyRevision,
    content_scope_ids: input.contentScopeIds,
    expires_at: input.expiresAt,
    grant_id: grantId,
    highest_revoke_sequence: 0,
    issued_at: input.issuedAt,
    jti_hash: input.jtiHash,
    knowledge_space_id: knowledgeSpaceId,
    resource_id: input.resource.id,
    resource_parent_id: input.resource.parentId,
    resource_type: input.resource.type,
    revision: 1,
    revoke_reason_code: null,
    revoked_at: null,
    state: "active",
    subject_id: input.subjectId,
    tenant_id: tenantId,
    trace_id: input.traceId,
    updated_at: timestamp,
    ...overrides,
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
    expect(input).toMatchObject({ operation: expected.operation, tableName: expected.tableName });
    return { rows: expected.rows, rowsAffected: input.operation === "select" ? 0 : 1 };
  };
  const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>): Promise<T> =>
    callback({ execute });
  return {
    calls,
    database: createSchemaDatabaseAdapter({ executor: execute, kind: dialect, transaction }),
    expectDone: () => expect(cursor).toBe(steps.length),
  };
}

function step(
  tableName: string,
  operation: DatabaseExecuteInput["operation"],
  rows: readonly DatabaseRow[],
): ScriptStep {
  return { operation, rows, tableName };
}
