import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseSourceRepository } from "./source-repository";

const tenantId = "tenant-source";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const permissionSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const now = "2026-07-14T12:00:00.000Z";

describe.each(["postgres", "tidb"] as const)(
  "source permission-fenced mutation (%s)",
  (dialect) => {
    it("serializes space, authorization, and source before the disable CAS", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createDatabaseSourceRepository({
        database: databaseFixture(dialect, calls, false),
      });

      await expect(
        repository.disableWithPermissionFence({
          expectedVersion: 1,
          id: sourceId,
          knowledgeSpaceId,
          now,
          permissionFence: permissionFence(),
        }),
      ).resolves.toMatchObject({ status: "disabled", version: 2 });

      const locks = calls
        .filter((call) => call.operation === "select" && call.sql.includes("FOR UPDATE"))
        .map((call) => call.tableName);
      expect(locks).toEqual([
        "knowledge_spaces",
        "deletion_jobs",
        "knowledge_space_permission_snapshots",
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
        "sources",
      ]);
      expect(
        calls.some(
          (call) =>
            call.tableName === "sources" &&
            call.operation === "update" &&
            call.params.includes("disabled") &&
            call.params.includes(1),
        ),
      ).toBe(true);
    });

    it("does not lock or update the source after permission revocation", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createDatabaseSourceRepository({
        database: databaseFixture(dialect, calls, true),
      });

      await expect(
        repository.disableWithPermissionFence({
          expectedVersion: 1,
          id: sourceId,
          knowledgeSpaceId,
          now,
          permissionFence: permissionFence(),
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
      expect(calls.some((call) => call.tableName === "sources")).toBe(false);
      expect(calls.some((call) => call.operation === "update")).toBe(false);
    });
  },
);

function databaseFixture(
  dialect: DatabaseAdapter["dialect"],
  calls: DatabaseExecuteInput[],
  revoked: boolean,
): DatabaseAdapter {
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "deletion_jobs") return empty();
    if (input.tableName === "knowledge_space_permission_snapshots") {
      if (revoked && input.sql.includes("INNER JOIN")) return empty();
      return { rows: [permissionRow()], rowsAffected: 1 };
    }
    if (
      input.tableName === "knowledge_space_members" ||
      input.tableName === "knowledge_space_access_policies" ||
      input.tableName === "knowledge_space_api_access"
    ) {
      return { rows: [{ id: `${input.tableName}-a` }], rowsAffected: 1 };
    }
    if (input.tableName === "sources" && input.operation === "select") {
      return { rows: [sourceRow()], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: 1 };
  };
  const schema = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { ...schema, execute, transaction: async (callback) => callback({ execute }) };
}

function permissionFence() {
  return {
    accessChannel: "interactive" as const,
    knowledgeSpaceId,
    permissionSnapshotId,
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-a",
    tenantId,
  };
}

function sourceRow(): DatabaseRow {
  return {
    connection_id: null,
    created_at: "2026-07-14T10:00:00.000Z",
    credential_ref: null,
    deletion_job_id: null,
    id: sourceId,
    knowledge_space_id: knowledgeSpaceId,
    metadata: "{}",
    name: "Drive",
    permission_scope: JSON.stringify(["team:camera"]),
    status: "active",
    type: "connector",
    updated_at: "2026-07-14T10:00:00.000Z",
    uri: "https://example.test/drive",
    version: 1,
  };
}

function permissionRow(): DatabaseRow {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: "2026-07-14T10:00:00.000Z",
    expires_at: "2026-07-15T10:00:00.000Z",
    id: permissionSnapshotId,
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: JSON.stringify(["team:camera"]),
    revision: 1,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: "editor-a",
    tenant_id: tenantId,
    updated_at: "2026-07-14T10:00:00.000Z",
    visibility: "all_members",
  };
}

function empty(): DatabaseExecuteResult {
  return { rows: [], rowsAffected: 0 };
}
