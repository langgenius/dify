import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseSourceConnectionRepository } from "./source-connection-database-repository";

const tenantId = "tenant-source";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const connectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const transactionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const permissionSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const credentialRef = "source-secret:v1:credential-a";
const verifierRef = "source-secret:v1:verifier-a";
const now = "2026-07-14T12:00:00.000Z";

describe.each(["postgres", "tidb"] as const)(
  "database source connection repository (%s)",
  (dialect) => {
    it("locks space and authorization before connection, OAuth, and secret lifecycle rows", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = connectionDatabase(dialect, calls, false);
      const repository = createDatabaseSourceConnectionRepository({ database });

      await expect(
        repository.completeOAuth({
          connectionId,
          credentialRef,
          expectedVersion: 1,
          now,
          scopes: ["files.read"],
          transactionId,
        }),
      ).resolves.toMatchObject({
        credentialRef,
        status: "active",
        version: 2,
      });

      const locks = calls
        .filter((call) => call.operation === "select" && call.sql.includes("FOR UPDATE"))
        .map((call) => call.tableName);
      expect(locks.slice(0, 10)).toEqual([
        "knowledge_spaces",
        "deletion_jobs",
        "knowledge_space_permission_snapshots",
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
        "source_connections",
        "source_oauth_transactions",
        "source_connection_secret_refs",
        "source_connection_secret_refs",
      ]);
    });

    it("rejects revoked permission before locking or mutating connection state", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = connectionDatabase(dialect, calls, true);
      const repository = createDatabaseSourceConnectionRepository({ database });

      await expect(
        repository.completeOAuth({
          connectionId,
          credentialRef,
          expectedVersion: 1,
          now,
          scopes: ["files.read"],
          transactionId,
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
      expect(
        calls.some(
          (call) => call.tableName === "source_connections" && call.sql.includes("FOR UPDATE"),
        ),
      ).toBe(false);
      expect(calls.some((call) => call.operation === "update")).toBe(false);
    });
  },
);

function connectionDatabase(
  dialect: DatabaseAdapter["dialect"],
  calls: DatabaseExecuteInput[],
  revoked: boolean,
): DatabaseAdapter {
  return testDatabase(dialect, async (input) => {
    calls.push(input);
    if (input.tableName === "source_oauth_transactions" && input.operation === "select") {
      return { rows: [oauthRow()], rowsAffected: 1 };
    }
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
    if (input.tableName === "source_connections" && input.operation === "select") {
      return { rows: [connectionRow()], rowsAffected: 1 };
    }
    if (input.tableName === "source_connection_secret_refs" && input.operation === "select") {
      return {
        rows: [
          input.params[0] === verifierRef
            ? secretRefRow(verifierRef, "oauth-pkce")
            : secretRefRow(credentialRef, "connection-credential"),
        ],
        rowsAffected: 1,
      };
    }
    return { rows: [], rowsAffected: 1 };
  });
}

function connectionRow(): DatabaseRow {
  return {
    auth_kind: "oauth2",
    configuration: "{}",
    created_at: "2026-07-14T10:00:00.000Z",
    credential_ref: null,
    expires_at: null,
    id: connectionId,
    knowledge_space_id: knowledgeSpaceId,
    last_error_code: null,
    name: "Drive",
    provider_id: "drive-a",
    scopes: "[]",
    status: "provisioning",
    tenant_id: tenantId,
    updated_at: "2026-07-14T10:00:00.000Z",
    version: 1,
  };
}

function oauthRow(): DatabaseRow {
  return {
    access_channel: "interactive",
    api_key_id: null,
    connection_id: connectionId,
    created_at: "2026-07-14T10:00:00.000Z",
    expires_at: "2026-07-14T13:00:00.000Z",
    id: transactionId,
    knowledge_space_id: knowledgeSpaceId,
    permission_snapshot_id: permissionSnapshotId,
    permission_snapshot_revision: 1,
    redirect_uri: "https://api.example.test/source-oauth/callback",
    requested_by_subject_id: "editor-a",
    state_hash: "a".repeat(64),
    status: "exchanging",
    tenant_id: tenantId,
    verifier_ref: verifierRef,
  };
}

function secretRefRow(ref: string, purpose: "connection-credential" | "oauth-pkce"): DatabaseRow {
  return {
    connection_id: connectionId,
    credential_ref: ref,
    id: `${purpose}-a`,
    knowledge_space_id: knowledgeSpaceId,
    lease_expires_at: null,
    lease_token: null,
    provider_id: "drive-a",
    purpose,
    remote_revoke_required: false,
    row_version: 1,
    state: "staged",
    tenant_id: tenantId,
    worker_id: null,
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
    permission_scopes: "[]",
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

function testDatabase(
  dialect: DatabaseAdapter["dialect"],
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
): DatabaseAdapter {
  const schema = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { ...schema, execute, transaction: async (callback) => callback({ execute }) };
}
