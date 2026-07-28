import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { CapabilityPublicationFencedError } from "./capability-grant-provenance";
import { createDatabaseSourceConnectionRepository } from "./source-connection-database-repository";

const tenantId = "tenant-capability";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21";
const connectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d22";
const grantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d23";
const otherGrantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d24";
const now = "2026-07-28T10:00:00.000Z";

const capabilityFence = {
  capabilityAction: "source_connections.create" as const,
  capabilityGrantId: grantId,
  knowledgeSpaceId,
  tenantId,
};

describe.each(["postgres", "tidb"] as const)(
  "database source connection Capability fence (%s)",
  (dialect) => {
    it("locks an active Capability grant and persists only its locator", async () => {
      const fixture = capabilityDatabase(dialect);
      const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });

      const connection = await repository.begin({
        authKind: "endpoint",
        configuration: {},
        createdAt: now,
        id: connectionId,
        knowledgeSpaceId,
        name: "Notion",
        permissionFence: capabilityFence,
        providerId: "plugin-daemon-online-document",
        scopes: [],
        tenantId,
      });

      expect(connection).toMatchObject({ capabilityGrantId: grantId, status: "provisioning" });
      expect(
        fixture.calls.some((call) => call.tableName === "knowledge_space_permission_snapshots"),
      ).toBe(false);
      expect(fixture.calls.some((call) => call.tableName === "knowledge_space_members")).toBe(
        false,
      );
      expect(fixture.calls.find((call) => call.tableName === "capability_grants")?.sql).toContain(
        "FOR UPDATE",
      );
      const insert = fixture.calls.find(
        (call) => call.tableName === "source_connections" && call.operation === "insert",
      );
      expect(insert?.sql).toContain("capability_grant_id");
      expect(insert?.params).toContain(grantId);
    });

    it("fails before inserting when the Capability grant is absent or fenced", async () => {
      const fixture = capabilityDatabase(dialect, { grantActive: false });
      const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });

      await expect(
        repository.begin({
          authKind: "endpoint",
          configuration: {},
          createdAt: now,
          id: connectionId,
          knowledgeSpaceId,
          name: "Notion",
          permissionFence: capabilityFence,
          providerId: "plugin-daemon-online-document",
          scopes: [],
          tenantId,
        }),
      ).rejects.toBeInstanceOf(CapabilityPublicationFencedError);
      expect(
        fixture.calls.some(
          (call) => call.tableName === "source_connections" && call.operation === "insert",
        ),
      ).toBe(false);
    });

    it("rejects a mutation fence from a different Capability grant", async () => {
      const fixture = capabilityDatabase(dialect, {
        storedCapabilityGrantId: grantId,
      });
      const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });

      await expect(
        repository.activate({
          connectionId,
          expectedVersion: 1,
          now,
          permissionFence: {
            capabilityAction: "source_connections.create",
            capabilityGrantId: otherGrantId,
            knowledgeSpaceId,
            tenantId,
          },
          scopes: [],
        }),
      ).rejects.toMatchObject({
        code: "SOURCE_CONNECTION_PERMISSION_PROVENANCE_CONFLICT",
      });
      expect(
        fixture.calls.some(
          (call) => call.tableName === "source_connections" && call.operation === "update",
        ),
      ).toBe(false);
    });

    it("allows a later refresh grant while preserving the connection's create provenance", async () => {
      const fixture = capabilityDatabase(dialect, {
        grantAction: "source_connections.refresh",
        storedCapabilityGrantId: grantId,
      });
      const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });

      await expect(
        repository.reserveCredential({
          connectionId,
          credentialRef: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d25",
          expectedVersion: 1,
          now,
          permissionFence: {
            capabilityAction: "source_connections.refresh",
            capabilityGrantId: otherGrantId,
            knowledgeSpaceId,
            tenantId,
          },
          recoverAfter: "2026-08-04T10:00:00.000Z",
        }),
      ).resolves.toBeUndefined();
      expect(
        fixture.calls.some(
          (call) =>
            call.tableName === "source_connection_secret_refs" && call.operation === "insert",
        ),
      ).toBe(true);
    });
  },
);

function capabilityDatabase(
  dialect: DatabaseAdapter["dialect"],
  options: {
    readonly grantAction?: "source_connections.create" | "source_connections.refresh" | undefined;
    readonly grantActive?: boolean | undefined;
    readonly storedCapabilityGrantId?: string | undefined;
  } = {},
) {
  const calls: DatabaseExecuteInput[] = [];
  const storedConnection = options.storedCapabilityGrantId
    ? connectionRow(options.storedCapabilityGrantId)
    : undefined;
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.tableName === "knowledge_spaces") {
      return result([{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }]);
    }
    if (input.tableName === "deletion_jobs") return result([]);
    if (input.tableName === "capability_grants") {
      return options.grantActive === false
        ? result([])
        : result([
            {
              action: options.grantAction ?? "source_connections.create",
              grant_id: input.params[2],
              resource_id: knowledgeSpaceId,
              resource_parent_id: null,
              resource_type: "knowledge_space",
              space_tombstoned: false,
            },
          ]);
    }
    if (input.tableName === "source_connections") {
      if (input.operation === "select") return result(storedConnection ? [storedConnection] : []);
      return result([], 1);
    }
    return result([], input.operation === "select" ? 0 : 1);
  };
  const schema = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  const database = {
    ...schema,
    execute,
    transaction: async <T>(callback: Parameters<DatabaseAdapter["transaction"]>[0]) =>
      callback({ execute }) as Promise<T>,
  } as DatabaseAdapter;
  return { calls, database };
}

function connectionRow(capabilityGrantId: string): DatabaseRow {
  return {
    auth_kind: "endpoint",
    capability_grant_id: capabilityGrantId,
    configuration: "{}",
    created_at: now,
    credential_ref: null,
    expires_at: null,
    id: connectionId,
    knowledge_space_id: knowledgeSpaceId,
    last_error_code: null,
    name: "Notion",
    provider_id: "plugin-daemon-online-document",
    scopes: "[]",
    status: "provisioning",
    tenant_id: tenantId,
    updated_at: now,
    version: 1,
  };
}

function result(rows: readonly DatabaseRow[], rowsAffected = 0): DatabaseExecuteResult {
  return { rows, rowsAffected };
}
