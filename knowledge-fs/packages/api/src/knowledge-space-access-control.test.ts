import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseTransactionCallback,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeSpaceAccessError,
  buildKnowledgeSpacePermissionScopes,
  createDatabaseKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceAccessRepository,
  createKnowledgeSpaceAccessService,
  hashKnowledgeSpaceApiKey,
} from "./knowledge-space-access-control";

const scope = {
  knowledgeSpaceId: "00000000-0000-4000-8000-000000000001",
  tenantId: "tenant-a",
} as const;
const timestamp = "2026-07-14T12:00:00.000Z";

describe("knowledge-space access-control foundation", () => {
  it("atomically initializes an isolated owner, only-me policy, and disabled API access", async () => {
    const { repository } = createMemoryHarness();

    const initialized = await repository.initialize({ ...scope, ownerSubjectId: "owner-a" });

    expect(initialized.member).toMatchObject({ revision: 1, role: "owner", subjectId: "owner-a" });
    expect(initialized.policy).toMatchObject({
      ownerSubjectId: "owner-a",
      revision: 1,
      visibility: "only_me",
    });
    expect(initialized.apiAccess).toMatchObject({ enabled: false, revision: 1 });
    await expect(
      repository.getAccessContext({ ...scope, subjectId: "owner-a" }),
    ).resolves.not.toBeNull();
    await expect(
      repository.getAccessContext({ ...scope, subjectId: "unknown" }),
    ).resolves.toBeNull();
    await expect(
      repository.getAccessContext({ ...scope, tenantId: "tenant-b", subjectId: "owner-a" }),
    ).resolves.toBeNull();
    await expect(repository.getApiAccess(scope)).resolves.toMatchObject({
      disabledAt: timestamp,
      enabled: false,
    });
    await expect(
      repository.initialize({ ...scope, ownerSubjectId: "other" }),
    ).rejects.toMatchObject({
      code: "space_access_already_initialized",
    });
  });

  it("enforces owner-only mutations, last-owner safety, and member CAS", async () => {
    const { repository } = createMemoryHarness();
    await repository.initialize({ ...scope, ownerSubjectId: "owner-a" });
    const viewer = await repository.setMemberRole({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 0,
      role: "viewer",
      subjectId: "viewer-a",
    });

    await expect(
      repository.updateApiAccess({
        ...scope,
        actorSubjectId: viewer.subjectId,
        enabled: true,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "space_access_forbidden" });
    await expect(
      repository.setMemberRole({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 2,
        role: "editor",
        subjectId: viewer.subjectId,
      }),
    ).rejects.toMatchObject({
      actualRevision: 1,
      code: "space_access_revision_conflict",
      expectedRevision: 2,
    });
    await expect(
      repository.setMemberRole({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        role: "viewer",
        subjectId: "owner-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_last_owner" });
  });

  it("keeps partial visibility nonempty, owner-reachable, member-bound, and CAS-versioned", async () => {
    const { repository } = createMemoryHarness();
    await repository.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await repository.setMemberRole({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 0,
      role: "viewer",
      subjectId: "viewer-a",
    });

    await expect(
      repository.updatePolicy({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        partialMemberSubjectIds: [],
        visibility: "partial_members",
      }),
    ).rejects.toMatchObject({ code: "space_access_partial_members_required" });
    await expect(
      repository.updatePolicy({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        partialMemberSubjectIds: ["viewer-a"],
        visibility: "partial_members",
      }),
    ).rejects.toMatchObject({ code: "space_access_policy_owner" });
    await expect(
      repository.updatePolicy({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        partialMemberSubjectIds: ["owner-a", "missing"],
        visibility: "partial_members",
      }),
    ).rejects.toMatchObject({ code: "space_access_partial_member_not_found" });

    const updated = await repository.updatePolicy({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 1,
      partialMemberSubjectIds: ["viewer-a", "owner-a", "viewer-a"],
      visibility: "partial_members",
    });
    expect(updated).toMatchObject({
      partialMemberSubjectIds: ["owner-a", "viewer-a"],
      policy: { ownerSubjectId: "owner-a", revision: 2, visibility: "partial_members" },
    });
    await expect(
      repository.updatePolicy({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        partialMemberSubjectIds: [],
        visibility: "all_members",
      }),
    ).rejects.toMatchObject({ code: "space_access_revision_conflict" });
  });

  it("stores only API-key hashes, returns plaintext once, tracks use, and revokes with CAS", async () => {
    const { repository, service } = createMemoryHarness();
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });
    const enabled = await service.updateApiAccess({
      ...scope,
      actorSubjectId: "owner-a",
      enabled: true,
      expectedRevision: 1,
    });
    expect(enabled).toMatchObject({ enabled: true, revision: 2 });
    expect(enabled).not.toHaveProperty("disabledAt");

    const issued = await service.issueApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      expiresAt: "2027-01-01T00:00:00.000Z",
      name: "automation",
      principalSubjectId: "owner-a",
    });
    expect(issued.token).toMatch(/^kfs_[0-9a-f-]{36}_[A-Za-z0-9_-]{32,}$/u);
    expect(issued.apiKey).not.toHaveProperty("keyHash");
    const stored = await repository.findActiveApiKeyById({ id: issued.apiKey.id });
    expect(stored?.keyHash).toBe(hashKnowledgeSpaceApiKey(issued.token));
    expect(JSON.stringify(stored)).not.toContain(issued.token);
    await expect(service.listApiKeys({ ...scope, limit: 10 })).resolves.not.toHaveProperty(
      "items.0.keyHash",
    );
    await expect(
      service.markApiKeyUsed({ ...scope, id: issued.apiKey.id, usedAt: "2026-08-01T00:00:00Z" }),
    ).resolves.toBe(true);

    const revoked = await service.revokeApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 1,
      id: issued.apiKey.id,
    });
    expect(revoked).toMatchObject({ revision: 2, status: "revoked" });
    await expect(repository.findActiveApiKeyById({ id: issued.apiKey.id })).resolves.toBeNull();
  });

  it("rejects already-expired keys using real instants rather than lexical timestamps", async () => {
    const repository = createInMemoryKnowledgeSpaceAccessRepository({
      generateId: sequentialUuid(),
      maxApiKeysPerSpace: 10,
      maxListLimit: 10,
      maxMembersPerSpace: 10,
      now: () => "2026-01-01T00:00:00-05:00",
    });
    const service = createKnowledgeSpaceAccessService({
      generateApiKeySecret: () => "s".repeat(32),
      generateId: sequentialUuid(100),
      repository,
    });
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });

    await expect(
      service.issueApiKey({
        ...scope,
        actorSubjectId: "owner-a",
        expiresAt: "2026-01-01T04:30:00Z",
        name: "already expired",
        principalSubjectId: "owner-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_invalid_request" });
  });

  it("issues server-owned durable grants and invalidates snapshots after ACL revision changes", async () => {
    const { service } = createMemoryHarness();
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await service.updateApiAccess({
      ...scope,
      actorSubjectId: "owner-a",
      enabled: true,
      expectedRevision: 1,
    });

    const snapshot = await service.createPermissionSnapshot({
      ...scope,
      accessChannel: "service_api",
      expiresAt: "2027-01-01T00:00:00.000Z",
      permissionScopes: ["attacker:forged"],
      subjectId: "owner-a",
    } as Parameters<typeof service.createPermissionSnapshot>[0] & {
      permissionScopes: readonly string[];
    });
    expect(snapshot.permissionScopes).toEqual([
      `knowledge-space:${scope.knowledgeSpaceId}`,
      `knowledge-space:${scope.knowledgeSpaceId}:member:owner-a`,
      `knowledge-space:${scope.knowledgeSpaceId}:role:owner`,
      `knowledge-space:${scope.knowledgeSpaceId}:visibility:only_me:owner-a`,
      "tenant:tenant-a",
    ]);
    expect(snapshot.permissionScopes).not.toContain("attacker:forged");
    await expect(
      service.revalidatePermissionSnapshot({
        ...scope,
        expectedAccessChannel: "service_api",
        id: snapshot.id,
        subjectId: "owner-a",
      }),
    ).resolves.toMatchObject({ id: snapshot.id, status: "active" });

    const disabled = await service.updateApiAccess({
      ...scope,
      actorSubjectId: "owner-a",
      enabled: false,
      expectedRevision: 2,
    });
    expect(disabled).toMatchObject({ disabledAt: timestamp, enabled: false, revision: 3 });
    await expect(
      service.revalidatePermissionSnapshot({
        ...scope,
        expectedAccessChannel: "service_api",
        id: snapshot.id,
        subjectId: "owner-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
  });

  it("binds durable grants to API-key revision, revocation, and expiry", async () => {
    let currentTime = "2026-07-14T12:00:00.000Z";
    const repository = createInMemoryKnowledgeSpaceAccessRepository({
      generateId: sequentialUuid(),
      maxApiKeysPerSpace: 10,
      maxListLimit: 10,
      maxMembersPerSpace: 10,
      now: () => currentTime,
    });
    const service = createKnowledgeSpaceAccessService({
      generateApiKeySecret: () => "s".repeat(32),
      generateId: sequentialUuid(100),
      repository,
    });
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await service.updateApiAccess({
      ...scope,
      actorSubjectId: "owner-a",
      enabled: true,
      expectedRevision: 1,
    });
    const issue = (name: string) =>
      service.issueApiKey({
        ...scope,
        actorSubjectId: "owner-a",
        expiresAt: "2026-07-14T13:00:00.000Z",
        name,
        principalSubjectId: "owner-a",
      });
    const revokedKey = await issue("revoked");
    const revokedSnapshot = await service.createPermissionSnapshot({
      ...scope,
      accessChannel: "service_api",
      apiKey: revokedKey.apiKey,
      expiresAt: "2026-07-14T12:30:00.000Z",
      subjectId: "owner-a",
    });
    expect(revokedSnapshot).toMatchObject({
      apiKeyId: revokedKey.apiKey.id,
      apiKeyRevision: 1,
    });
    await service.revokeApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 1,
      id: revokedKey.apiKey.id,
    });
    await expect(
      service.revalidatePermissionSnapshot({
        ...scope,
        expectedAccessChannel: "service_api",
        id: revokedSnapshot.id,
        subjectId: "owner-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });

    const expiringKey = await issue("expiring");
    const expiringSnapshot = await service.createPermissionSnapshot({
      ...scope,
      accessChannel: "service_api",
      apiKey: expiringKey.apiKey,
      expiresAt: "2026-07-14T12:30:00.000Z",
      subjectId: "owner-a",
    });
    currentTime = "2026-07-14T13:00:00.000Z";
    await expect(
      service.revalidatePermissionSnapshot({
        ...scope,
        expectedAccessChannel: "service_api",
        id: expiringSnapshot.id,
        subjectId: "owner-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
  });

  it("supports maximum-length subjects without rejecting canonical grants", async () => {
    const subjectId = "s".repeat(255);
    const { service } = createMemoryHarness();
    const context = await service.initialize({ ...scope, ownerSubjectId: subjectId });
    const grants = buildKnowledgeSpacePermissionScopes({
      accessChannel: "interactive",
      context,
      subjectId,
      ...scope,
    });
    expect(Math.max(...grants.map((grant) => grant.length))).toBeLessThanOrEqual(512);
    await expect(
      service.createPermissionSnapshot({
        ...scope,
        accessChannel: "interactive",
        expiresAt: "2027-01-01T00:00:00.000Z",
        subjectId,
      }),
    ).resolves.toMatchObject({ permissionScopes: grants });
  });

  it("deletes an aggregate for create-flow compensation without crossing tenants", async () => {
    const { repository } = createMemoryHarness();
    await repository.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await expect(repository.deleteAggregate({ ...scope, tenantId: "tenant-b" })).resolves.toBe(
      false,
    );
    await expect(repository.deleteAggregate(scope)).resolves.toBe(true);
    await expect(repository.getApiAccess(scope)).resolves.toBeNull();
  });
});

describe("database knowledge-space access repository", () => {
  it.each(["postgres", "tidb"] as const)(
    "initializes the owner, policy, and API switch in one %s transaction",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const transaction = vi.fn();
      const database = createDatabase(
        dialect,
        async (input) => {
          calls.push(input);
          if (input.tableName === "knowledge_spaces" && input.operation === "select") {
            return result([{ id: scope.knowledgeSpaceId }]);
          }
          if (
            input.tableName === "knowledge_space_access_policies" &&
            input.operation === "select"
          ) {
            return result([]);
          }
          return result([], 1);
        },
        transaction,
      );
      const repository = createDatabaseKnowledgeSpaceAccessRepository({
        database,
        generateId: sequentialUuid(),
        maxListLimit: 10,
        maxMembersPerSpace: 10,
        now: () => timestamp,
      });

      const initialized = await repository.initialize({ ...scope, ownerSubjectId: "owner-a" });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(initialized).toMatchObject({
        apiAccess: { enabled: false },
        member: { role: "owner" },
        policy: { visibility: "only_me" },
      });
      expect(
        calls.filter((call) => call.operation === "insert").map((call) => call.tableName),
      ).toEqual([
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
      ]);
      const apiInsert = calls.find(
        (call) => call.operation === "insert" && call.tableName === "knowledge_space_api_access",
      );
      expect(apiInsert?.params).toContain(timestamp);
      expect(apiInsert?.params).toContain(false);
      expect(apiInsert?.sql).toContain(dialect === "postgres" ? '"disabled_at"' : "`disabled_at`");
    },
  );

  it("fails closed when a tenant does not own the requested space", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createDatabase("postgres", async (input) => {
      calls.push(input);
      return result([]);
    });
    const repository = createDatabaseKnowledgeSpaceAccessRepository({
      database,
      maxListLimit: 10,
      maxMembersPerSpace: 10,
    });

    await expect(
      repository.initialize({ ...scope, tenantId: "tenant-b", ownerSubjectId: "owner-a" }),
    ).rejects.toMatchObject({ code: "space_access_not_found" });
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("persists only the API-key digest and resolves authentication globally by key id", async () => {
    const calls: DatabaseExecuteInput[] = [];
    let storedApiKeyRow: Record<string, unknown> | undefined;
    const database = createDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "knowledge_space_members" && input.operation === "select") {
        return result([memberRow("owner-a", "owner")]);
      }
      if (input.tableName === "knowledge_space_access_policies" && input.operation === "select") {
        return result([policyRow()]);
      }
      if (input.tableName === "knowledge_space_api_access" && input.operation === "select") {
        return result([apiAccessRow(true, 2)]);
      }
      if (input.tableName === "knowledge_space_access_policy_members") {
        return result([]);
      }
      if (input.tableName === "knowledge_space_api_keys" && input.operation === "insert") {
        storedApiKeyRow = Object.fromEntries(
          [
            "id",
            "tenant_id",
            "knowledge_space_id",
            "name",
            "key_prefix",
            "key_hash",
            "principal_subject_id",
            "status",
            "revision",
            "created_by_subject_id",
            "last_used_at",
            "expires_at",
            "revoked_at",
            "created_at",
            "updated_at",
          ].map((column, index) => [column, input.params[index]]),
        );
        return result([], 1);
      }
      if (input.tableName === "knowledge_space_api_keys" && input.operation === "select") {
        return result(storedApiKeyRow ? [storedApiKeyRow] : []);
      }
      return result([], 1);
    });
    const repository = createDatabaseKnowledgeSpaceAccessRepository({
      database,
      generateId: sequentialUuid(),
      maxListLimit: 10,
      maxMembersPerSpace: 10,
      now: () => timestamp,
    });
    const service = createKnowledgeSpaceAccessService({
      generateApiKeySecret: () => "z".repeat(32),
      generateId: sequentialUuid(500),
      repository,
    });

    const issued = await service.issueApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      name: "service",
      principalSubjectId: "owner-a",
    });
    const insert = calls.find(
      (call) => call.tableName === "knowledge_space_api_keys" && call.operation === "insert",
    );
    expect(insert?.params).not.toContain(issued.token);
    expect(insert?.params).toContain(hashKnowledgeSpaceApiKey(issued.token));

    const authenticated = await repository.findActiveApiKeyById({ id: issued.apiKey.id });
    expect(authenticated).toMatchObject({
      id: issued.apiKey.id,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      tenantId: scope.tenantId,
    });
    const globalLookup = calls.at(-1);
    expect(globalLookup?.params).toEqual([issued.apiKey.id, timestamp]);
    expect(globalLookup?.sql).not.toContain('tenant_id" =');
  });
});

function createMemoryHarness() {
  const repository = createInMemoryKnowledgeSpaceAccessRepository({
    generateId: sequentialUuid(),
    maxApiKeysPerSpace: 10,
    maxListLimit: 10,
    maxMembersPerSpace: 10,
    now: () => timestamp,
  });
  const service = createKnowledgeSpaceAccessService({
    generateApiKeySecret: () => "x".repeat(32),
    generateId: sequentialUuid(100),
    repository,
  });
  return { repository, service };
}

function sequentialUuid(start = 1): () => string {
  let value = start;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

function result(rows: readonly Record<string, unknown>[], rowsAffected = 0): DatabaseExecuteResult {
  return { rows, rowsAffected };
}

function createDatabase(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  transactionSpy = vi.fn(),
): DatabaseAdapter {
  return {
    dialect,
    kind: dialect,
    checkPerformanceIndexes: async () => ({ missing: [], ok: true }),
    execute,
    getCapabilities: vi.fn(),
    getSchemaSummary: vi.fn(),
    health: async () => true,
    planBatchGetRows: vi.fn(),
    planListRows: vi.fn(),
    renderMigrationSql: async () => [],
    transaction: async <T>(callback: DatabaseTransactionCallback<T>) => {
      transactionSpy();
      return callback({ execute });
    },
  } as unknown as DatabaseAdapter;
}

function memberRow(subjectId: string, role: "owner" | "editor" | "viewer") {
  return {
    created_at: timestamp,
    created_by_subject_id: "owner-a",
    id: `member-${subjectId}`,
    knowledge_space_id: scope.knowledgeSpaceId,
    revision: 1,
    role,
    subject_id: subjectId,
    tenant_id: scope.tenantId,
    updated_at: timestamp,
  };
}

function policyRow() {
  return {
    created_at: timestamp,
    id: "policy-1",
    knowledge_space_id: scope.knowledgeSpaceId,
    owner_subject_id: "owner-a",
    revision: 1,
    tenant_id: scope.tenantId,
    updated_at: timestamp,
    updated_by_subject_id: "owner-a",
    visibility: "only_me",
  };
}

function apiAccessRow(enabled: boolean, revision: number) {
  return {
    created_at: timestamp,
    disabled_at: enabled ? null : timestamp,
    enabled,
    id: "api-access-1",
    knowledge_space_id: scope.knowledgeSpaceId,
    revision,
    tenant_id: scope.tenantId,
    updated_at: timestamp,
    updated_by_subject_id: "owner-a",
  };
}
