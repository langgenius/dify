import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseTransactionCallback,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { CreateKnowledgeSpaceApiKeyInput } from "./knowledge-space-access-control";

import {
  KnowledgeSpaceAccessError,
  KnowledgeSpaceAccessRevisionConflictError,
  assertDatabaseKnowledgeSpacePermissionFence,
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
const expiresAt = "2027-01-01T00:00:00.000Z";

describe("knowledge-space access-control behavior coverage", () => {
  it("maps and paginates every database read model with scoped cursors", async () => {
    const fixture = accessDatabaseFixture({ includeViewer: true, visibility: "partial_members" });
    fixture.state.partialMembers.add("owner-a");
    fixture.state.partialMembers.add("viewer-a");
    fixture.state.apiKeys.set("key-a", apiKeyRow({ id: "key-a", name: "A" }));
    fixture.state.apiKeys.set(
      "key-b",
      apiKeyRow({ created_at: "2026-07-14T12:01:00.000Z", id: "key-b", name: "B" }),
    );

    await expect(
      fixture.repository.getAccessContext({ ...scope, subjectId: "viewer-a" }),
    ).resolves.toMatchObject({
      apiAccess: { enabled: true, revision: 2 },
      member: { role: "viewer", subjectId: "viewer-a" },
      partialMemberSubjectIds: ["owner-a", "viewer-a"],
      policy: { visibility: "partial_members" },
    });
    await expect(
      fixture.repository.getAccessContext({ ...scope, subjectId: "missing" }),
    ).resolves.toBeNull();
    await expect(fixture.repository.getAccessPolicy(scope)).resolves.toMatchObject({
      partialMemberSubjectIds: ["owner-a", "viewer-a"],
      policy: { visibility: "partial_members" },
    });
    await expect(fixture.repository.getApiAccess(scope)).resolves.toMatchObject({ enabled: true });

    const members = await fixture.repository.listMembers({ ...scope, limit: 1 });
    expect(members.items).toMatchObject([{ subjectId: "owner-a" }]);
    const memberCursor = members.nextCursor;
    expect(memberCursor).toBe("owner-a");
    if (!memberCursor) throw new Error("Expected a member cursor for the second page");
    await expect(
      fixture.repository.listMembers({ ...scope, cursor: memberCursor, limit: 2 }),
    ).resolves.toMatchObject({ items: [{ subjectId: "viewer-a" }] });

    await expect(
      fixture.repository.getActiveApiKeyById({ ...scope, id: "key-a" }),
    ).resolves.toMatchObject({ id: "key-a" });
    await expect(fixture.repository.findActiveApiKeyById({ id: "key-a" })).resolves.toMatchObject({
      id: "key-a",
    });
    const firstKeys = await fixture.repository.listApiKeys({ ...scope, limit: 1 });
    expect(firstKeys.items).toMatchObject([{ id: "key-a" }]);
    const apiKeyCursor = firstKeys.nextCursor;
    expect(apiKeyCursor).toEqual(expect.any(String));
    if (!apiKeyCursor) throw new Error("Expected an API-key cursor for the second page");
    await expect(
      fixture.repository.listApiKeys({ ...scope, cursor: apiKeyCursor, limit: 1 }),
    ).resolves.toMatchObject({ items: [{ id: "key-b" }] });

    await expect(
      fixture.repository.markApiKeyUsed({ ...scope, id: "key-a", usedAt: timestamp }),
    ).resolves.toBe(true);
    expect(fixture.state.apiKeys.get("key-a")?.last_used_at).toBe(timestamp);
    fixture.state.nextWriteRowsAffected = 0;
    await expect(
      fixture.repository.markApiKeyUsed({ ...scope, id: "key-a", usedAt: timestamp }),
    ).resolves.toBe(false);
    await expect(
      fixture.repository.markApiKeyUsed({ ...scope, id: "key-a", usedAt: "not-a-date" }),
    ).rejects.toThrow("must be an ISO timestamp");
  });

  it("creates, updates, and removes database members with permission audit events", async () => {
    const fixture = accessDatabaseFixture();
    const viewer = await fixture.repository.setMemberRole({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 0,
      role: "viewer",
      subjectId: "viewer-a",
    });
    expect(viewer).toMatchObject({ revision: 1, role: "viewer", subjectId: "viewer-a" });
    expect(fixture.state.members.get("viewer-a")).toMatchObject({ role: "viewer" });

    const editor = await fixture.repository.setMemberRole({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 1,
      role: "editor",
      subjectId: "viewer-a",
    });
    expect(editor).toMatchObject({ revision: 2, role: "editor" });
    await expect(
      fixture.repository.removeMember({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        subjectId: "missing",
      }),
    ).resolves.toBe(false);
    await expect(
      fixture.repository.removeMember({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 2,
        subjectId: "viewer-a",
      }),
    ).resolves.toBe(true);
    expect(fixture.state.members.has("viewer-a")).toBe(false);
    expect(
      fixture.calls.filter(
        (call) =>
          call.operation === "insert" && call.tableName === "knowledge_space_activity_events",
      ),
    ).toHaveLength(3);
  });

  it("updates database visibility and API admission under owner and row-version fences", async () => {
    const fixture = accessDatabaseFixture({ includeViewer: true });
    const policy = await fixture.repository.updatePolicy({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 1,
      partialMemberSubjectIds: ["viewer-a", "owner-a", "viewer-a"],
      visibility: "partial_members",
    });
    expect(policy).toMatchObject({
      partialMemberSubjectIds: ["owner-a", "viewer-a"],
      policy: { revision: 2, visibility: "partial_members" },
    });
    expect([...fixture.state.partialMembers]).toEqual(["owner-a", "viewer-a"]);

    const disabled = await fixture.repository.updateApiAccess({
      ...scope,
      actorSubjectId: "owner-a",
      enabled: false,
      expectedRevision: 2,
    });
    expect(disabled).toMatchObject({ disabledAt: timestamp, enabled: false, revision: 3 });
    fixture.state.nextWriteRowsAffected = 0;
    await expect(
      fixture.repository.updateApiAccess({
        ...scope,
        actorSubjectId: "owner-a",
        enabled: true,
        expectedRevision: 3,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceAccessRevisionConflictError);
  });

  it("creates and revokes database API keys without persisting plaintext", async () => {
    const fixture = accessDatabaseFixture();
    const service = createKnowledgeSpaceAccessService({
      generateApiKeySecret: () => "s".repeat(32),
      generateId: sequentialUuid(100),
      repository: fixture.repository,
    });
    const issued = await service.issueApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      expiresAt,
      name: "automation",
      principalSubjectId: "owner-a",
    });
    const stored = fixture.state.apiKeys.get(issued.apiKey.id);
    expect(stored?.key_hash).toBe(hashKnowledgeSpaceApiKey(issued.token));
    expect(JSON.stringify(stored)).not.toContain(issued.token);

    const revoked = await fixture.repository.revokeApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 1,
      id: issued.apiKey.id,
    });
    expect(revoked).toMatchObject({ revision: 2, status: "revoked" });
    await expect(
      fixture.repository.revokeApiKey({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 2,
        id: issued.apiKey.id,
      }),
    ).resolves.toMatchObject({ revision: 2, status: "revoked" });
    await expect(
      fixture.repository.revokeApiKey({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        id: "missing",
      }),
    ).rejects.toMatchObject({ code: "space_access_not_found" });
  });

  it("persists, revalidates, and idempotently revokes database permission snapshots", async () => {
    const fixture = accessDatabaseFixture();
    const snapshot = await fixture.repository.createPermissionSnapshot({
      ...scope,
      accessChannel: "interactive",
      expiresAt,
      id: "snapshot-a",
      subjectId: "owner-a",
    });
    expect(snapshot).toMatchObject({
      accessChannel: "interactive",
      permissionScopes: expect.arrayContaining([`tenant:${scope.tenantId}`]),
      revision: 1,
      status: "active",
    });
    await expect(
      fixture.repository.getPermissionSnapshot({ ...scope, id: snapshot.id }),
    ).resolves.toEqual(snapshot);
    await expect(
      fixture.repository.revalidatePermissionSnapshot({
        ...scope,
        expectedAccessChannel: "interactive",
        id: snapshot.id,
        subjectId: "owner-a",
      }),
    ).resolves.toEqual(snapshot);

    const revoked = await fixture.repository.revokePermissionSnapshot({
      ...scope,
      expectedRevision: 1,
      id: snapshot.id,
    });
    expect(revoked).toMatchObject({ revision: 2, status: "revoked" });
    await expect(
      fixture.repository.revokePermissionSnapshot({
        ...scope,
        expectedRevision: 2,
        id: snapshot.id,
      }),
    ).resolves.toMatchObject({ revision: 2, status: "revoked" });
  });

  it("binds database service grants to the exact locked API-key provenance", async () => {
    const fixture = accessDatabaseFixture();
    fixture.state.apiKeys.set(
      "key-a",
      apiKeyRow({ expires_at: expiresAt, id: "key-a", principal_subject_id: "owner-a" }),
    );
    const snapshot = await fixture.repository.createPermissionSnapshot({
      ...scope,
      accessChannel: "service_api",
      apiKey: { expiresAt, id: "key-a", revision: 1 },
      expiresAt: "2026-12-01T00:00:00.000Z",
      id: "snapshot-key",
      subjectId: "owner-a",
    });
    expect(snapshot).toMatchObject({
      apiKeyExpiresAt: expiresAt,
      apiKeyId: "key-a",
      apiKeyRevision: 1,
    });
    expect(
      fixture.calls.some(
        (call) => call.tableName === "knowledge_space_api_keys" && call.sql.includes("FOR UPDATE"),
      ),
    ).toBe(true);
  });

  it("deletes the complete database aggregate in dependency order and reports absence", async () => {
    const fixture = accessDatabaseFixture();
    await expect(fixture.repository.deleteAggregate(scope)).resolves.toBe(true);
    expect(
      fixture.calls.filter((call) => call.operation === "delete").map((call) => call.tableName),
    ).toEqual([
      "knowledge_space_permission_snapshots",
      "knowledge_space_api_keys",
      "knowledge_space_api_access",
      "knowledge_space_access_policy_members",
      "knowledge_space_access_policies",
      "knowledge_space_members",
    ]);
    await expect(fixture.repository.deleteAggregate(scope)).resolves.toBe(false);
  });

  it("locks and revalidates complete database permission provenance before the final act", async () => {
    const fixture = accessDatabaseFixture();
    fixture.state.snapshots.set("snapshot-a", permissionSnapshotRow());
    const fence = {
      accessChannel: "interactive" as const,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      permissionSnapshotId: "snapshot-a",
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "owner-a",
      tenantId: scope.tenantId,
    };
    await expect(
      assertDatabaseKnowledgeSpacePermissionFence({
        database: fixture.database,
        executor: fixture.database,
        fence,
        now: timestamp,
        requiredAccess: "admin",
      }),
    ).resolves.toMatchObject({ id: "snapshot-a", role: "owner" });
    expect(
      fixture.calls.filter((call) => call.sql.includes("FOR UPDATE")).map((call) => call.tableName),
    ).toEqual([
      "knowledge_space_permission_snapshots",
      "knowledge_space_members",
      "knowledge_space_access_policies",
      "knowledge_space_api_access",
    ]);

    fixture.state.snapshots.set(
      "snapshot-key",
      permissionSnapshotRow({
        access_channel: "service_api",
        api_key_id: "key-a",
        api_key_revision: 1,
        id: "snapshot-key",
      }),
    );
    fixture.state.apiKeys.set("key-a", apiKeyRow({ id: "key-a" }));
    await expect(
      assertDatabaseKnowledgeSpacePermissionFence({
        database: fixture.database,
        executor: fixture.database,
        fence: {
          ...fence,
          accessChannel: "service_api",
          permissionSnapshotId: "snapshot-key",
        },
        now: timestamp,
        requiredAccess: "read",
      }),
    ).resolves.toMatchObject({ apiKeyId: "key-a" });
    expect(
      fixture.calls.some(
        (call) => call.tableName === "knowledge_space_api_keys" && call.sql.includes("FOR UPDATE"),
      ),
    ).toBe(true);
  });

  it("rejects stale database permission identity, missing locks, and insufficient roles", async () => {
    const fence = {
      accessChannel: "interactive" as const,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      permissionSnapshotId: "snapshot-a",
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "owner-a",
      tenantId: scope.tenantId,
    };
    const missing = accessDatabaseFixture();
    await expect(
      assertDatabaseKnowledgeSpacePermissionFence({
        database: missing.database,
        executor: missing.database,
        fence,
        now: timestamp,
        requiredAccess: "read",
      }),
    ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });

    const stale = accessDatabaseFixture();
    stale.state.snapshots.set("snapshot-a", permissionSnapshotRow({ revision: 2 }));
    await expect(
      assertDatabaseKnowledgeSpacePermissionFence({
        database: stale.database,
        executor: stale.database,
        fence,
        now: timestamp,
        requiredAccess: "read",
      }),
    ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });

    for (const tableName of [
      "knowledge_space_members",
      "knowledge_space_access_policies",
      "knowledge_space_api_access",
    ]) {
      const unlocked = accessDatabaseFixture();
      unlocked.state.snapshots.set("snapshot-a", permissionSnapshotRow());
      unlocked.state.missingLockTable = tableName;
      await expect(
        assertDatabaseKnowledgeSpacePermissionFence({
          database: unlocked.database,
          executor: unlocked.database,
          fence,
          now: timestamp,
          requiredAccess: "read",
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
    }

    for (const [role, requiredAccess] of [
      ["viewer", "write"],
      ["editor", "admin"],
    ] as const) {
      const insufficient = accessDatabaseFixture();
      insufficient.state.snapshots.set("snapshot-a", permissionSnapshotRow({ role }));
      await expect(
        assertDatabaseKnowledgeSpacePermissionFence({
          database: insufficient.database,
          executor: insufficient.database,
          fence,
          now: timestamp,
          requiredAccess,
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
    }

    const invalidated = accessDatabaseFixture();
    invalidated.state.snapshots.set("snapshot-a", permissionSnapshotRow());
    invalidated.state.revalidateSnapshots = false;
    await expect(
      assertDatabaseKnowledgeSpacePermissionFence({
        database: invalidated.database,
        executor: invalidated.database,
        fence,
        now: timestamp,
        requiredAccess: "read",
      }),
    ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
  });

  it("exercises the complete in-memory service surface with member, key, and grant cursors", async () => {
    const { repository, service } = memoryHarness();
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await service.setMemberRole({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 0,
      role: "viewer",
      subjectId: "viewer-a",
    });
    await service.setMemberRole({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 0,
      role: "editor",
      subjectId: "editor-a",
    });
    await expect(
      service.getAccessContext({ ...scope, subjectId: "owner-a" }),
    ).resolves.not.toBeNull();
    await expect(service.getAccessPolicy(scope)).resolves.toMatchObject({
      policy: { visibility: "only_me" },
    });
    await expect(service.getApiAccess(scope)).resolves.toMatchObject({ enabled: false });
    const members = await service.listMembers({ ...scope, limit: 2 });
    expect(members.items.map((member) => member.subjectId)).toEqual(["editor-a", "owner-a"]);
    const memberCursor = members.nextCursor;
    expect(memberCursor).toBe("owner-a");
    if (!memberCursor) throw new Error("Expected a member cursor for the second page");
    await expect(
      service.listMembers({ ...scope, cursor: memberCursor, limit: 2 }),
    ).resolves.toMatchObject({ items: [{ subjectId: "viewer-a" }] });

    const first = await service.issueApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      name: "first",
      principalSubjectId: "owner-a",
    });
    const second = await service.issueApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      name: "second",
      principalSubjectId: "viewer-a",
    });
    await expect(
      service.getActiveApiKeyById({ ...scope, id: first.apiKey.id }),
    ).resolves.toMatchObject({ id: first.apiKey.id });
    await expect(service.findActiveApiKeyById({ id: second.apiKey.id })).resolves.toMatchObject({
      id: second.apiKey.id,
    });
    const keys = await service.listApiKeys({ ...scope, limit: 1 });
    expect(keys.items).toHaveLength(1);
    const apiKeyCursor = keys.nextCursor;
    expect(apiKeyCursor).toEqual(expect.any(String));
    if (!apiKeyCursor) throw new Error("Expected an API-key cursor for the second page");
    await expect(
      service.listApiKeys({ ...scope, cursor: apiKeyCursor, limit: 1 }),
    ).resolves.toMatchObject({ items: [{ id: second.apiKey.id }] });

    const snapshot = await service.createPermissionSnapshot({
      ...scope,
      accessChannel: "interactive",
      expiresAt,
      subjectId: "owner-a",
    });
    await expect(service.getPermissionSnapshot({ ...scope, id: snapshot.id })).resolves.toEqual(
      snapshot,
    );
    await expect(
      service.revokePermissionSnapshot({ ...scope, expectedRevision: 1, id: snapshot.id }),
    ).resolves.toMatchObject({ revision: 2, status: "revoked" });
    await expect(
      service.revokePermissionSnapshot({ ...scope, expectedRevision: 2, id: snapshot.id }),
    ).resolves.toMatchObject({ revision: 2, status: "revoked" });

    await service.updatePolicy({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 1,
      partialMemberSubjectIds: [],
      visibility: "all_members",
    });
    await expect(
      service.removeMember({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        subjectId: "viewer-a",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.getActiveApiKeyById({ ...scope, id: second.apiKey.id }),
    ).resolves.toBeNull();
  });

  it("reports in-memory capacity and cursor corruption without partial mutation", async () => {
    const { service } = memoryHarness({ maxApiKeysPerSpace: 1, maxMembersPerSpace: 1 });
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await expect(
      service.setMemberRole({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 0,
        role: "viewer",
        subjectId: "viewer-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_capacity_exceeded" });
    await service.issueApiKey({
      ...scope,
      actorSubjectId: "owner-a",
      name: "first",
      principalSubjectId: "owner-a",
    });
    await expect(
      service.issueApiKey({
        ...scope,
        actorSubjectId: "owner-a",
        name: "second",
        principalSubjectId: "owner-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_capacity_exceeded" });
    await expect(
      service.listApiKeys({ ...scope, cursor: "not-a-cursor", limit: 1 }),
    ).rejects.toThrow("cursor is invalid");
  });

  it("builds all-members grants and rejects cross-subject permission scope construction", () => {
    const context = {
      apiAccess: { enabled: true, id: "api-access-1", revision: 1 },
      member: { id: "member-a", revision: 1, role: "editor" as const, subjectId: "editor-a" },
      partialMemberSubjectIds: [],
      policy: {
        id: "policy-1",
        ownerSubjectId: "owner-a",
        revision: 1,
        visibility: "all_members" as const,
      },
    };
    expect(
      buildKnowledgeSpacePermissionScopes({
        ...scope,
        accessChannel: "agent",
        context,
        subjectId: "editor-a",
      }),
    ).toContain(`knowledge-space:${scope.knowledgeSpaceId}:visibility:all_members`);
    expect(() =>
      buildKnowledgeSpacePermissionScopes({
        ...scope,
        accessChannel: "agent",
        context,
        subjectId: "another-subject",
      }),
    ).toThrow("does not match subjectId");
  });

  it("rejects malformed public identifiers, bounds, mutations, keys, and snapshots", async () => {
    for (const token of ["short", "x".repeat(513)]) {
      expect(() => hashKnowledgeSpaceApiKey(token)).toThrow("between 32 and 512");
    }

    for (const options of [
      { maxApiKeysPerSpace: 0, maxListLimit: 10, maxMembersPerSpace: 10 },
      { maxApiKeysPerSpace: 10, maxListLimit: 1.5, maxMembersPerSpace: 10 },
      { maxApiKeysPerSpace: 10, maxListLimit: 10, maxMembersPerSpace: -1 },
    ]) {
      expect(() =>
        createInMemoryKnowledgeSpaceAccessRepository({
          ...options,
          now: () => timestamp,
        }),
      ).toThrow("must be a positive integer");
    }

    const { repository, service } = memoryHarness();
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await expect(
      service.initialize({ ...scope, tenantId: " ", ownerSubjectId: "owner-b" }),
    ).rejects.toThrow("tenantId");
    await expect(
      service.initialize({ ...scope, knowledgeSpaceId: " ", ownerSubjectId: "owner-b" }),
    ).rejects.toThrow("knowledgeSpaceId");
    await expect(
      service.setMemberRole({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 0,
        role: "viewer",
        subjectId: " ",
      }),
    ).rejects.toThrow("subjectId");
    await expect(
      service.setMemberRole({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 0,
        role: "administrator" as never,
        subjectId: "viewer-a",
      }),
    ).rejects.toThrow("role is invalid");
    for (const expectedRevision of [-1, 1.5]) {
      await expect(
        service.setMemberRole({
          ...scope,
          actorSubjectId: "owner-a",
          expectedRevision,
          role: "viewer",
          subjectId: "viewer-a",
        }),
      ).rejects.toThrow("expectedRevision must be nonnegative");
    }
    for (const limit of [0, 1.5, 11]) {
      await expect(service.listMembers({ ...scope, limit })).rejects.toThrow("between 1 and 10");
    }
    await expect(
      service.updatePolicy({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        partialMemberSubjectIds: [],
        visibility: "team" as never,
      }),
    ).rejects.toThrow("visibility is invalid");
    for (const expectedRevision of [0, 1.5]) {
      await expect(
        service.updatePolicy({
          ...scope,
          actorSubjectId: "owner-a",
          expectedRevision,
          partialMemberSubjectIds: [],
          visibility: "only_me",
        }),
      ).rejects.toThrow("expectedRevision must be positive");
    }
    await expect(
      service.updatePolicy({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        partialMemberSubjectIds: ["owner-a"],
        visibility: "all_members",
      }),
    ).rejects.toThrow("only valid for partial_members");

    for (const [overrides, message] of [
      [{ id: " " }, "id is required"],
      [{ name: " " }, "name must contain"],
      [{ name: "n".repeat(161) }, "name must contain"],
      [{ keyHash: "ABC" }, "lowercase SHA-256"],
      [{ keyPrefix: " " }, "prefix must contain"],
      [{ keyPrefix: "p".repeat(25) }, "prefix must contain"],
      [{ expiresAt: "not-a-date" }, "future ISO timestamp"],
      [{ expiresAt: timestamp }, "future ISO timestamp"],
    ] as const) {
      await expect(repository.createApiKey(directApiKeyInput(overrides))).rejects.toThrow(message);
    }

    await expect(
      repository.createPermissionSnapshot({
        ...scope,
        accessChannel: "batch" as never,
        expiresAt,
        id: "snapshot-invalid-channel",
        subjectId: "owner-a",
      }),
    ).rejects.toThrow("access channel is invalid");
    for (const invalidExpiry of ["not-a-date", timestamp]) {
      await expect(
        repository.createPermissionSnapshot({
          ...scope,
          accessChannel: "interactive",
          expiresAt: invalidExpiry,
          id: "snapshot-invalid-expiry",
          subjectId: "owner-a",
        }),
      ).rejects.toThrow("expiry must be in the future");
    }
  });

  it("fails closed for missing memory state, duplicate credentials, and invalid generators", async () => {
    const empty = memoryHarness();
    await expect(empty.service.getAccessPolicy(scope)).resolves.toBeNull();
    await expect(empty.service.getApiAccess(scope)).resolves.toBeNull();
    await expect(empty.service.listMembers({ ...scope, limit: 1 })).resolves.toEqual({ items: [] });
    await expect(empty.service.listApiKeys({ ...scope, limit: 1 })).resolves.toEqual({ items: [] });
    await expect(
      empty.service.updateApiAccess({
        ...scope,
        actorSubjectId: "owner-a",
        enabled: true,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "space_access_not_found" });

    const { repository, service } = memoryHarness();
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await expect(
      service.setMemberRole({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 2,
        role: "viewer",
        subjectId: "missing-a",
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceAccessRevisionConflictError);
    await expect(repository.createApiKey(directApiKeyInput())).resolves.toMatchObject({
      id: "key-direct-a",
    });
    await expect(
      repository.createApiKey(directApiKeyInput({ keyHash: "b".repeat(64) })),
    ).rejects.toThrow("id already exists");
    await expect(
      repository.createApiKey(directApiKeyInput({ id: "key-direct-b" })),
    ).rejects.toThrow("hash already exists");
    await expect(
      repository.createApiKey(
        directApiKeyInput({
          id: "key-direct-missing-principal",
          keyHash: "c".repeat(64),
          principalSubjectId: "missing-a",
        }),
      ),
    ).rejects.toMatchObject({ code: "space_access_partial_member_not_found" });
    await expect(
      service.markApiKeyUsed({ ...scope, id: "key-direct-a", usedAt: "not-a-date" }),
    ).rejects.toThrow("must be an ISO timestamp");
    await expect(
      service.revokeApiKey({
        ...scope,
        actorSubjectId: "owner-a",
        expectedRevision: 1,
        id: "missing-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_not_found" });
    await expect(
      service.revokePermissionSnapshot({ ...scope, expectedRevision: 1, id: "missing-a" }),
    ).rejects.toMatchObject({ code: "space_access_not_found" });

    for (const secret of ["s".repeat(31), "!".repeat(32), "s".repeat(257)]) {
      const invalidGeneratorService = createKnowledgeSpaceAccessService({
        generateApiKeySecret: () => secret,
        generateId: sequentialUuid(500),
        repository,
      });
      await expect(
        invalidGeneratorService.issueApiKey({
          ...scope,
          actorSubjectId: "owner-a",
          name: "invalid generated key",
          principalSubjectId: "owner-a",
        }),
      ).rejects.toThrow("not URL-safe");
    }
  });

  it("enforces visibility, policy-owner, and API-channel constraints in memory", async () => {
    const { service } = memoryHarness();
    await service.initialize({ ...scope, ownerSubjectId: "owner-a" });
    await service.setMemberRole({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 0,
      role: "owner",
      subjectId: "owner-b",
    });
    await service.setMemberRole({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 0,
      role: "viewer",
      subjectId: "viewer-a",
    });
    await expect(
      service.setMemberRole({
        ...scope,
        actorSubjectId: "owner-b",
        expectedRevision: 1,
        role: "viewer",
        subjectId: "owner-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_policy_owner" });
    await expect(
      service.createPermissionSnapshot({
        ...scope,
        accessChannel: "interactive",
        expiresAt,
        subjectId: "viewer-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_forbidden" });
    await expect(
      service.createPermissionSnapshot({
        ...scope,
        accessChannel: "agent",
        expiresAt,
        subjectId: "owner-a",
      }),
    ).rejects.toMatchObject({ code: "space_access_forbidden" });

    await service.updatePolicy({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 1,
      partialMemberSubjectIds: [],
      visibility: "all_members",
    });
    await expect(
      service.createPermissionSnapshot({
        ...scope,
        accessChannel: "interactive",
        expiresAt,
        subjectId: "viewer-a",
      }),
    ).resolves.toMatchObject({ subjectId: "viewer-a", visibility: "all_members" });
    await service.updateApiAccess({
      ...scope,
      actorSubjectId: "owner-a",
      enabled: true,
      expectedRevision: 1,
    });
    await service.updatePolicy({
      ...scope,
      actorSubjectId: "owner-a",
      expectedRevision: 2,
      partialMemberSubjectIds: ["owner-a", "viewer-a"],
      visibility: "partial_members",
    });
    await expect(
      service.createPermissionSnapshot({
        ...scope,
        accessChannel: "agent",
        expiresAt,
        subjectId: "viewer-a",
      }),
    ).resolves.toMatchObject({ subjectId: "viewer-a", visibility: "partial_members" });
  });

  it("fails closed on absent or corrupt database access-control rows", async () => {
    const absent = accessDatabaseFixture();
    absent.state.policyPresent = false;
    absent.state.apiAccessPresent = false;
    await expect(absent.repository.findActiveApiKeyById({ id: "missing" })).resolves.toBeNull();
    await expect(absent.repository.getAccessPolicy(scope)).resolves.toBeNull();
    await expect(absent.repository.getApiAccess(scope)).resolves.toBeNull();
    await expect(
      absent.repository.getActiveApiKeyById({ ...scope, id: "missing" }),
    ).resolves.toBeNull();
    await expect(
      absent.repository.getPermissionSnapshot({ ...scope, id: "missing" }),
    ).resolves.toBeNull();

    const memberCorruption = accessDatabaseFixture();
    memberCorruption.state.members.set("owner-a", {
      ...memberRow("owner-a", "owner"),
      role: "administrator",
    });
    await expect(memberCorruption.repository.listMembers({ ...scope, limit: 10 })).rejects.toThrow(
      "member role=administrator is invalid",
    );
    memberCorruption.state.members.set("owner-a", {
      ...memberRow("owner-a", "owner"),
      revision: 0,
    });
    await expect(memberCorruption.repository.listMembers({ ...scope, limit: 10 })).rejects.toThrow(
      "revision must be a positive integer",
    );

    const policyCorruption = accessDatabaseFixture();
    policyCorruption.state.policy.visibility = "shared" as never;
    await expect(policyCorruption.repository.getAccessPolicy(scope)).rejects.toThrow(
      "visibility=shared is invalid",
    );

    const apiAccessCorruption = accessDatabaseFixture();
    apiAccessCorruption.state.apiAccess.enabled = 1 as never;
    await expect(apiAccessCorruption.repository.getApiAccess(scope)).resolves.toMatchObject({
      enabled: true,
    });
    apiAccessCorruption.state.apiAccess.enabled = "yes" as never;
    await expect(apiAccessCorruption.repository.getApiAccess(scope)).rejects.toThrow(
      "enabled must be a boolean",
    );

    const apiKeyCorruption = accessDatabaseFixture();
    apiKeyCorruption.state.apiKeys.set("key-a", apiKeyRow({ status: "unknown" }));
    await expect(
      apiKeyCorruption.repository.getActiveApiKeyById({ ...scope, id: "key-a" }),
    ).rejects.toThrow("status=unknown is invalid");
    apiKeyCorruption.state.apiKeys.set(
      "key-a",
      apiKeyRow({
        expires_at: expiresAt,
        last_used_at: timestamp,
        revoked_at: timestamp,
        status: "revoked",
      }),
    );
    await expect(
      apiKeyCorruption.repository.listApiKeys({ ...scope, limit: 10 }),
    ).resolves.toMatchObject({
      items: [
        {
          expiresAt,
          lastUsedAt: timestamp,
          revokedAt: timestamp,
          status: "revoked",
        },
      ],
    });

    const snapshotCorruption = accessDatabaseFixture();
    snapshotCorruption.state.snapshots.set(
      "snapshot-a",
      permissionSnapshotRow({ role: "administrator" }),
    );
    await expect(
      snapshotCorruption.repository.getPermissionSnapshot({ ...scope, id: "snapshot-a" }),
    ).rejects.toThrow("enum value is invalid");
    snapshotCorruption.state.snapshots.set(
      "snapshot-a",
      permissionSnapshotRow({ status: "unknown" }),
    );
    await expect(
      snapshotCorruption.repository.getPermissionSnapshot({ ...scope, id: "snapshot-a" }),
    ).rejects.toThrow("status=unknown is invalid");
    snapshotCorruption.state.snapshots.set(
      "snapshot-a",
      permissionSnapshotRow({ permission_scopes: "not-json" }),
    );
    await expect(
      snapshotCorruption.repository.getPermissionSnapshot({ ...scope, id: "snapshot-a" }),
    ).rejects.toThrow("must be a JSON string array");
    snapshotCorruption.state.snapshots.set(
      "snapshot-a",
      permissionSnapshotRow({ permission_scopes: ["valid", 42] }),
    );
    await expect(
      snapshotCorruption.repository.getPermissionSnapshot({ ...scope, id: "snapshot-a" }),
    ).rejects.toThrow("must be a JSON string array");
    snapshotCorruption.state.snapshots.set(
      "snapshot-a",
      permissionSnapshotRow({
        access_channel: "service_api",
        api_key_expires_at: expiresAt,
        api_key_id: "key-a",
        api_key_revision: 1,
        permission_scopes: JSON.stringify(["scope-a"]),
        revoked_at: timestamp,
        status: "revoked",
      }),
    );
    await expect(
      snapshotCorruption.repository.getPermissionSnapshot({ ...scope, id: "snapshot-a" }),
    ).resolves.toMatchObject({
      apiKeyExpiresAt: expiresAt,
      apiKeyId: "key-a",
      apiKeyRevision: 1,
      permissionScopes: ["scope-a"],
      revokedAt: timestamp,
      status: "revoked",
    });
  });
});

interface AccessDatabaseFixtureOptions {
  readonly includeViewer?: boolean | undefined;
  readonly visibility?: "all_members" | "only_me" | "partial_members" | undefined;
}

interface MemoryHarnessOptions {
  readonly maxApiKeysPerSpace?: number | undefined;
  readonly maxListLimit?: number | undefined;
  readonly maxMembersPerSpace?: number | undefined;
}

function memoryHarness(options: MemoryHarnessOptions = {}) {
  const repository = createInMemoryKnowledgeSpaceAccessRepository({
    generateId: sequentialUuid(),
    maxApiKeysPerSpace: options.maxApiKeysPerSpace ?? 10,
    maxListLimit: options.maxListLimit ?? 10,
    maxMembersPerSpace: options.maxMembersPerSpace ?? 10,
    now: () => timestamp,
  });
  const service = createKnowledgeSpaceAccessService({
    generateApiKeySecret: () => "s".repeat(32),
    generateId: sequentialUuid(100),
    repository,
  });
  return { repository, service };
}

function directApiKeyInput(
  overrides: Partial<CreateKnowledgeSpaceApiKeyInput> = {},
): CreateKnowledgeSpaceApiKeyInput {
  return {
    ...scope,
    createdBySubjectId: "owner-a",
    id: "key-direct-a",
    keyHash: "a".repeat(64),
    keyPrefix: "kfs_direct",
    name: "direct key",
    principalSubjectId: "owner-a",
    ...overrides,
  };
}

function accessDatabaseFixture(options: AccessDatabaseFixtureOptions = {}) {
  const calls: DatabaseExecuteInput[] = [];
  const state = {
    activity: null as Record<string, unknown> | null,
    apiAccess: { ...apiAccessRow(true, 2) },
    apiAccessPresent: true,
    apiKeys: new Map<string, Record<string, unknown>>(),
    members: new Map<string, Record<string, unknown>>([
      ["owner-a", { ...memberRow("owner-a", "owner") }],
      ...(options.includeViewer
        ? ([["viewer-a", { ...memberRow("viewer-a", "viewer") }]] as const)
        : []),
    ]),
    missingLockTable: undefined as string | undefined,
    nextWriteRowsAffected: undefined as number | undefined,
    partialMembers: new Set<string>(),
    policy: { ...policyRow(options.visibility ?? "only_me") },
    policyPresent: true,
    revalidateSnapshots: true,
    snapshots: new Map<string, Record<string, unknown>>(),
  };
  const rowsAffected = (): number => {
    const value = state.nextWriteRowsAffected ?? 1;
    state.nextWriteRowsAffected = undefined;
    return value;
  };
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.tableName === "knowledge_space_activity_events") {
      if (input.operation === "insert") {
        state.activity = activityRowFromInsert(input);
        return result([], 1);
      }
      return result(state.activity ? [state.activity] : []);
    }
    if (input.tableName === "knowledge_space_members") {
      if (input.operation === "insert") {
        state.members.set(String(input.params[3]), {
          created_at: input.params[7],
          created_by_subject_id: input.params[6],
          id: input.params[0],
          knowledge_space_id: input.params[2],
          revision: input.params[5],
          role: input.params[4],
          subject_id: input.params[3],
          tenant_id: input.params[1],
          updated_at: input.params[8],
        });
        return result([], 1);
      }
      if (input.operation === "update") {
        const affected = rowsAffected();
        const member = state.members.get(String(input.params[5]));
        if (affected === 1 && member) {
          member.role = input.params[0];
          member.revision = input.params[1];
          member.updated_at = input.params[2];
        }
        return result([], affected);
      }
      if (input.operation === "delete") {
        const affected = rowsAffected();
        if (affected === 1) state.members.delete(String(input.params[2]));
        return result([], affected);
      }
      if (
        input.sql.includes("subject_id") &&
        input.params.length === 3 &&
        !input.sql.includes("ORDER BY")
      ) {
        if (state.missingLockTable === input.tableName && input.sql.includes("FOR UPDATE")) {
          return result([]);
        }
        const member = state.members.get(String(input.params[2]));
        return result(member ? [member] : []);
      }
      const cursor = input.params.length > 2 ? String(input.params[2]) : undefined;
      return result(
        [...state.members.values()]
          .filter((row) => !cursor || String(row.subject_id) > cursor)
          .sort((left, right) => String(left.subject_id).localeCompare(String(right.subject_id))),
      );
    }
    if (input.tableName === "knowledge_space_access_policies") {
      if (input.operation === "insert") return result([], 1);
      if (input.operation === "update") {
        const affected = rowsAffected();
        if (affected === 1) {
          state.policy.visibility = String(
            requiredParam(input, 0),
          ) as typeof state.policy.visibility;
          state.policy.owner_subject_id = String(requiredParam(input, 1));
          state.policy.revision = Number(requiredParam(input, 2));
          state.policy.updated_by_subject_id = String(requiredParam(input, 3));
          state.policy.updated_at = String(requiredParam(input, 4));
        }
        return result([], affected);
      }
      if (input.operation === "delete") {
        state.policyPresent = false;
        return result([], 1);
      }
      if (state.missingLockTable === input.tableName && input.sql.includes("FOR UPDATE")) {
        return result([]);
      }
      return result(state.policyPresent ? [state.policy] : []);
    }
    if (input.tableName === "knowledge_space_api_access") {
      if (input.operation === "insert") return result([], 1);
      if (input.operation === "update") {
        const affected = rowsAffected();
        if (affected === 1) {
          const enabled = requiredParam(input, 0);
          if (typeof enabled !== "boolean")
            throw new Error("Fixture expected a boolean enabled value");
          const disabledAt = requiredParam(input, 1);
          state.apiAccess.enabled = enabled;
          state.apiAccess.disabled_at = disabledAt === null ? null : String(disabledAt);
          state.apiAccess.revision = Number(requiredParam(input, 2));
          state.apiAccess.updated_by_subject_id = String(requiredParam(input, 3));
          state.apiAccess.updated_at = String(requiredParam(input, 4));
        }
        return result([], affected);
      }
      if (input.operation === "delete") return result([], 1);
      if (state.missingLockTable === input.tableName && input.sql.includes("FOR UPDATE")) {
        return result([]);
      }
      return result(state.apiAccessPresent ? [state.apiAccess] : []);
    }
    if (input.tableName === "knowledge_space_access_policy_members") {
      if (input.operation === "insert") {
        state.partialMembers.add(String(input.params[4]));
        return result([], 1);
      }
      if (input.operation === "delete") {
        if (input.params.length === 3 && input.sql.includes("subject_id")) {
          state.partialMembers.delete(String(input.params[2]));
        } else {
          state.partialMembers.clear();
        }
        return result([], 1);
      }
      return result(
        [...state.partialMembers].sort().map((subjectId) => ({ subject_id: subjectId })),
      );
    }
    if (input.tableName === "knowledge_space_api_keys") {
      if (input.operation === "insert") {
        const row = apiKeyRowFromInsert(input);
        state.apiKeys.set(String(row.id), row);
        return result([], 1);
      }
      if (input.operation === "update") {
        const affected = rowsAffected();
        const id = String(input.params[input.params.length === 4 ? 3 : 6]);
        const key = state.apiKeys.get(id);
        if (affected === 1 && key) {
          if (input.params.length === 4) {
            key.last_used_at = input.params[0];
            key.updated_at = input.params[0];
          } else {
            key.status = input.params[0];
            key.revision = input.params[1];
            key.revoked_at = input.params[2];
            key.updated_at = input.params[3];
          }
        }
        return result([], affected);
      }
      if (input.operation === "delete") {
        state.apiKeys.clear();
        return result([], 1);
      }
      if (input.sql.includes("ORDER BY")) {
        const cursorCreatedAt = input.params.length > 2 ? String(input.params[2]) : undefined;
        const cursorId = input.params.length > 4 ? String(input.params[4]) : undefined;
        return result(
          [...state.apiKeys.values()]
            .filter(
              (row) =>
                !cursorCreatedAt ||
                String(row.created_at) > cursorCreatedAt ||
                (row.created_at === cursorCreatedAt && String(row.id) > String(cursorId)),
            )
            .sort(
              (left, right) =>
                String(left.created_at).localeCompare(String(right.created_at)) ||
                String(left.id).localeCompare(String(right.id)),
            ),
        );
      }
      const id = String(input.params[input.params.length === 2 ? 0 : 2]);
      const key = state.apiKeys.get(id);
      return result(key ? [key] : []);
    }
    if (input.tableName === "knowledge_space_permission_snapshots") {
      if (input.operation === "insert") {
        const row = permissionSnapshotRowFromInsert(input);
        state.snapshots.set(String(row.id), row);
        return result([], 1);
      }
      if (input.operation === "update") {
        const affected = rowsAffected();
        const snapshot = state.snapshots.get(String(input.params[6]));
        if (affected === 1 && snapshot) {
          snapshot.status = input.params[0];
          snapshot.revision = input.params[1];
          snapshot.revoked_at = input.params[2];
          snapshot.updated_at = input.params[3];
        }
        return result([], affected);
      }
      if (input.operation === "delete") {
        state.snapshots.clear();
        return result([], 1);
      }
      const snapshot = state.snapshots.get(String(input.params[2]));
      return result(
        snapshot && (!input.sql.includes(" JOIN ") || state.revalidateSnapshots) ? [snapshot] : [],
      );
    }
    return result([], input.operation === "select" ? 0 : 1);
  };
  const database = createDatabase(execute);
  const repository = createDatabaseKnowledgeSpaceAccessRepository({
    database,
    generateId: sequentialUuid(),
    maxListLimit: 10,
    maxMembersPerSpace: 10,
    now: () => timestamp,
  });
  return { calls, database, repository, state };
}

function createDatabase(
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
): DatabaseAdapter {
  return {
    dialect: "postgres",
    kind: "postgres",
    checkPerformanceIndexes: async () => ({ missing: [], ok: true }),
    execute,
    getCapabilities: vi.fn(),
    getSchemaSummary: vi.fn(),
    health: async () => true,
    planBatchGetRows: vi.fn(),
    planListRows: vi.fn(),
    renderMigrationSql: async () => [],
    transaction: async <T>(callback: DatabaseTransactionCallback<T>) => callback({ execute }),
  } as unknown as DatabaseAdapter;
}

function result(rows: readonly Record<string, unknown>[], rowsAffected = 0): DatabaseExecuteResult {
  return { rows, rowsAffected };
}

function requiredParam(input: DatabaseExecuteInput, index: number) {
  const value = input.params[index];
  if (value === undefined) throw new Error(`Fixture is missing database parameter ${index}`);
  return value;
}

function sequentialUuid(start = 1): () => string {
  let value = start;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

function memberRow(subjectId: string, role: "editor" | "owner" | "viewer") {
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

function policyRow(visibility: "all_members" | "only_me" | "partial_members") {
  return {
    created_at: timestamp,
    id: "policy-1",
    knowledge_space_id: scope.knowledgeSpaceId,
    owner_subject_id: "owner-a",
    revision: 1,
    tenant_id: scope.tenantId,
    updated_at: timestamp,
    updated_by_subject_id: "owner-a",
    visibility,
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

function apiKeyRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    created_at: timestamp,
    created_by_subject_id: "owner-a",
    expires_at: null,
    id: "key-a",
    key_hash: "a".repeat(64),
    key_prefix: "kfs_key-a",
    knowledge_space_id: scope.knowledgeSpaceId,
    last_used_at: null,
    name: "key",
    principal_subject_id: "owner-a",
    revision: 1,
    revoked_at: null,
    status: "active",
    tenant_id: scope.tenantId,
    updated_at: timestamp,
    ...overrides,
  };
}

function permissionSnapshotRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 2,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: timestamp,
    expires_at: expiresAt,
    id: "snapshot-a",
    knowledge_space_id: scope.knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: [
      `knowledge-space:${scope.knowledgeSpaceId}`,
      `knowledge-space:${scope.knowledgeSpaceId}:member:owner-a`,
      `knowledge-space:${scope.knowledgeSpaceId}:role:owner`,
      `knowledge-space:${scope.knowledgeSpaceId}:visibility:only_me:owner-a`,
      `tenant:${scope.tenantId}`,
    ],
    revision: 1,
    revoked_at: null,
    role: "owner",
    status: "active",
    subject_id: "owner-a",
    tenant_id: scope.tenantId,
    updated_at: timestamp,
    visibility: "only_me",
    ...overrides,
  };
}

function apiKeyRowFromInsert(input: DatabaseExecuteInput): Record<string, unknown> {
  return Object.fromEntries(
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
}

function permissionSnapshotRowFromInsert(input: DatabaseExecuteInput): Record<string, unknown> {
  return Object.fromEntries(
    [
      "id",
      "tenant_id",
      "knowledge_space_id",
      "subject_id",
      "role",
      "visibility",
      "access_channel",
      "member_revision",
      "access_policy_revision",
      "api_access_revision",
      "api_key_id",
      "api_key_revision",
      "api_key_expires_at",
      "permission_scopes",
      "status",
      "revision",
      "expires_at",
      "revoked_at",
      "created_at",
      "updated_at",
    ].map((column, index) => [column, input.params[index]]),
  );
}

function activityRowFromInsert(input: DatabaseExecuteInput): Record<string, unknown> {
  return {
    action: input.params[5],
    actor_subject_id: input.params[4],
    actor_type: input.params[3],
    details: JSON.parse(String(input.params[10])) as unknown,
    id: input.params[0],
    knowledge_space_id: input.params[2],
    occurred_at: input.params[11],
    required_permission_scope: JSON.parse(String(input.params[9])) as unknown,
    resource_id: input.params[7],
    resource_type: input.params[6],
    result: input.params[8],
    tenant_id: input.params[1],
  };
}
