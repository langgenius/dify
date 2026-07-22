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
const secondConnectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const transactionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const permissionSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const oldCredentialRef = "source-secret:v1:credential-old";
const newCredentialRef = "source-secret:v1:credential-new";
const verifierRef = "source-secret:v1:verifier-a";
const now = "2026-07-14T12:00:00.000Z";
const later = "2026-07-14T13:00:00.000Z";
const permissionFence = {
  accessChannel: "interactive" as const,
  knowledgeSpaceId,
  permissionSnapshotId,
  permissionSnapshotRevision: 1,
  requestedBySubjectId: "editor-a",
  tenantId,
};

describe("database source-connection repository behavior", () => {
  it("persists, scopes, and cursor-paginates new connections and staged credentials", async () => {
    const fixture = databaseFixture();
    const repository = createDatabaseSourceConnectionRepository({
      database: fixture.database,
      maxListLimit: 10,
    });

    const first = await repository.begin({
      authKind: "api-key",
      configuration: { folder: "root", recursive: true },
      createdAt: now,
      credentialRef: oldCredentialRef,
      id: connectionId,
      knowledgeSpaceId,
      name: "Drive A",
      permissionFence,
      providerId: "drive-a",
      scopes: ["files.read"],
      tenantId,
    });
    const second = await repository.begin({
      authKind: "endpoint",
      configuration: { endpoint: "https://source.example.test" },
      createdAt: later,
      id: secondConnectionId,
      knowledgeSpaceId,
      name: "Drive B",
      permissionFence,
      providerId: "drive-b",
      scopes: [],
      tenantId,
    });

    expect(first).toMatchObject({ status: "provisioning", version: 1 });
    expect(second).not.toHaveProperty("credentialRef");
    expect(fixture.state.secrets.get(oldCredentialRef)).toMatchObject({
      purpose: "connection-credential",
      state: "staged",
    });
    await expect(
      repository.get({ connectionId, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({
      configuration: { folder: "root", recursive: true },
      credentialRef: oldCredentialRef,
      scopes: ["files.read"],
    });
    await expect(
      repository.get({ connectionId, knowledgeSpaceId: "another-space", tenantId }),
    ).resolves.toBeNull();

    const firstPage = await repository.list({ knowledgeSpaceId, limit: 1, tenantId });
    expect(firstPage.items).toMatchObject([{ id: connectionId }]);
    const cursor = firstPage.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    if (!cursor) throw new Error("Expected a cursor for the second source-connection page");
    await expect(
      repository.list({ cursor, knowledgeSpaceId, limit: 1, tenantId }),
    ).resolves.toMatchObject({ items: [{ id: secondConnectionId }] });
    for (const limit of [0, 1.5, 11]) {
      await expect(repository.list({ knowledgeSpaceId, limit, tenantId })).rejects.toMatchObject({
        code: "SOURCE_CONNECTION_LIST_LIMIT_INVALID",
      });
    }
  });

  it("activates, reserves, rotates, fails, and revokes credentials under version fences", async () => {
    const fixture = databaseFixture();
    const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });
    await repository.begin({
      authKind: "oauth2",
      configuration: {},
      createdAt: now,
      credentialRef: oldCredentialRef,
      id: connectionId,
      knowledgeSpaceId,
      name: "Drive",
      permissionFence,
      providerId: "drive-a",
      scopes: ["files.read"],
      tenantId,
    });

    const active = await repository.activate({
      connectionId,
      expectedVersion: 1,
      expiresAt: later,
      now,
      permissionFence,
      scopes: ["files.read", "files.write"],
    });
    expect(active).toMatchObject({ expiresAt: later, status: "active", version: 2 });
    expect(fixture.state.secrets.get(oldCredentialRef)).toMatchObject({ state: "active" });

    await repository.reserveCredential({
      connectionId,
      credentialRef: newCredentialRef,
      expectedVersion: 2,
      now,
      permissionFence,
      recoverAfter: later,
    });
    await repository.reserveCredential({
      connectionId,
      credentialRef: newCredentialRef,
      expectedVersion: 2,
      now,
      permissionFence,
      recoverAfter: later,
    });
    expect(fixture.state.secrets.get(newCredentialRef)).toMatchObject({ state: "staged" });

    const rotated = await repository.rotateCredential({
      connectionId,
      expectedCredentialRef: oldCredentialRef,
      expectedVersion: 2,
      newCredentialRef,
      now: later,
      permissionFence,
      scopes: ["files.read"],
    });
    expect(rotated).toMatchObject({
      credentialRef: newCredentialRef,
      status: "active",
      version: 3,
    });
    expect(fixture.state.secrets.get(oldCredentialRef)).toMatchObject({ state: "retired" });
    expect(fixture.state.secrets.get(newCredentialRef)).toMatchObject({ state: "active" });

    const failed = await repository.fail({
      connectionId,
      errorCode: "PROVIDER_UNAVAILABLE",
      expectedVersion: 3,
      now: later,
    });
    expect(failed).toMatchObject({
      lastErrorCode: "PROVIDER_UNAVAILABLE",
      status: "error",
      version: 4,
    });

    const revoked = await repository.revoke({
      connectionId,
      expectedVersion: 4,
      now: later,
      permissionFence,
    });
    expect(revoked).toMatchObject({ status: "revoked", version: 5 });
    expect(revoked.credentialRef).toBeUndefined();
    expect(fixture.state.secrets.get(newCredentialRef)).toMatchObject({
      remote_revoke_required: true,
      state: "retired",
    });
    await expect(
      repository.revoke({
        connectionId,
        expectedVersion: 5,
        now: later,
        permissionFence,
      }),
    ).resolves.toMatchObject({ status: "revoked", version: 5 });
  });

  it("binds OAuth callback claiming and completion to its durable connection provenance", async () => {
    const fixture = databaseFixture();
    const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });
    await repository.begin({
      authKind: "oauth2",
      configuration: {},
      createdAt: now,
      id: connectionId,
      knowledgeSpaceId,
      name: "Drive",
      permissionFence,
      providerId: "drive-a",
      scopes: ["files.read"],
      tenantId,
    });
    await repository.beginOAuth(oauthTransactionRowInput());
    expect(fixture.state.oauth.get(transactionId)).toMatchObject({ status: "pending" });
    expect(fixture.state.secrets.get(verifierRef)).toMatchObject({
      purpose: "oauth-pkce",
      state: "staged",
    });

    await expect(
      repository.claimOAuthCallback({
        accessChannel: "interactive",
        now,
        requestedBySubjectId: "another-subject",
        stateHash: "a".repeat(64),
        tenantId,
      }),
    ).resolves.toBeNull();
    const claimed = await repository.claimOAuthCallback({
      accessChannel: "interactive",
      now,
      requestedBySubjectId: "editor-a",
      stateHash: "a".repeat(64),
      tenantId,
    });
    expect(claimed).toMatchObject({ id: transactionId, status: "exchanging" });

    await repository.reserveCredential({
      connectionId,
      credentialRef: newCredentialRef,
      expectedVersion: 1,
      now,
      permissionFence,
      recoverAfter: later,
    });
    await expect(
      repository.completeOAuth({
        connectionId,
        credentialRef: newCredentialRef,
        expectedVersion: 1,
        expiresAt: later,
        now,
        scopes: ["files.read"],
        transactionId,
      }),
    ).resolves.toMatchObject({
      credentialRef: newCredentialRef,
      status: "active",
      version: 2,
    });
    expect(fixture.state.oauth.get(transactionId)).toMatchObject({ status: "completed" });
    expect(fixture.state.secrets.get(newCredentialRef)).toMatchObject({ state: "active" });
    expect(fixture.state.secrets.get(verifierRef)).toMatchObject({ state: "retired" });
  });

  it("leases cleanup work, expires stale OAuth exchanges, and enforces cleanup CAS fences", async () => {
    const fixture = databaseFixture();
    const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });
    fixture.state.oauth.set(transactionId, oauthRow({ status: "exchanging" }));
    fixture.state.cleanupOauthIds.push(transactionId);
    fixture.state.secrets.set(verifierRef, secretRefRow(verifierRef, "oauth-pkce", "staged"));
    fixture.state.secrets.set(
      oldCredentialRef,
      secretRefRow(oldCredentialRef, "connection-credential", "retired"),
    );
    fixture.state.cleanupSecretRefs.push(verifierRef, oldCredentialRef);

    for (const limit of [0, 1.5, 101]) {
      await expect(
        repository.claimSecretCleanup({
          leaseExpiresAt: later,
          limit,
          now,
          workerId: "cleanup-a",
        }),
      ).rejects.toThrow("limit must be 1-100");
    }
    const claimed = await repository.claimSecretCleanup({
      leaseExpiresAt: later,
      limit: 10,
      now,
      workerId: "cleanup-a",
    });
    expect(claimed).toHaveLength(2);
    expect(claimed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ credentialRef: verifierRef, state: "deleting" }),
        expect.objectContaining({ credentialRef: oldCredentialRef, state: "deleting" }),
      ]),
    );
    expect(fixture.state.oauth.get(transactionId)).toMatchObject({ status: "failed" });

    const first = claimed[0];
    const second = claimed[1];
    if (!first || !second || !first.leaseToken || !second.leaseToken) {
      throw new Error("Expected two cleanup leases with tokens");
    }
    await repository.completeSecretCleanup({
      leaseToken: first.leaseToken,
      now,
      refId: first.id,
      rowVersion: first.rowVersion,
      workerId: "cleanup-a",
    });
    await repository.failSecretCleanup({
      errorCode: "REMOTE_REVOKE_FAILED",
      leaseToken: second.leaseToken,
      nextAttemptAt: later,
      now,
      refId: second.id,
      rowVersion: second.rowVersion,
      workerId: "cleanup-a",
    });
    expect(secretById(fixture.state.secrets, first.id)).toMatchObject({ state: "deleted" });
    expect(secretById(fixture.state.secrets, second.id)).toMatchObject({
      last_error_code: "REMOTE_REVOKE_FAILED",
      next_attempt_at: later,
      state: "retired",
    });

    fixture.state.nextRowsAffected = 0;
    await expect(
      repository.completeSecretCleanup({
        leaseToken: first.leaseToken,
        now,
        refId: first.id,
        rowVersion: first.rowVersion,
        workerId: "cleanup-a",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_CLEANUP_FENCE_CONFLICT" });
    fixture.state.nextRowsAffected = 0;
    await expect(
      repository.failSecretCleanup({
        errorCode: "REMOTE_REVOKE_FAILED",
        leaseToken: second.leaseToken,
        nextAttemptAt: later,
        now,
        refId: second.id,
        rowVersion: second.rowVersion,
        workerId: "cleanup-a",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_CLEANUP_FENCE_CONFLICT" });
  });

  it("rejects missing, fenced, stale, and inconsistent connection mutations", async () => {
    const missingFixture = databaseFixture();
    const missing = createDatabaseSourceConnectionRepository({ database: missingFixture.database });
    await expect(
      missing.revoke({ connectionId, expectedVersion: 1, now, permissionFence }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_NOT_FOUND" });
    await expect(
      missing.fail({ connectionId, errorCode: "FAILED", expectedVersion: 1, now }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_NOT_FOUND" });
    await expect(
      missing.reserveCredential({
        connectionId,
        credentialRef: newCredentialRef,
        expectedVersion: 1,
        now,
        permissionFence,
        recoverAfter: later,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_NOT_FOUND" });
    await expect(
      missing.completeOAuth({
        connectionId,
        credentialRef: newCredentialRef,
        expectedVersion: 1,
        now,
        scopes: [],
        transactionId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_VERSION_CONFLICT" });
    await expect(missing.beginOAuth(oauthTransactionRowInput())).rejects.toMatchObject({
      code: "SOURCE_CONNECTION_NOT_FOUND",
    });

    const fencedFixture = databaseFixture();
    fencedFixture.state.connections.set(connectionId, storedConnectionRow());
    fencedFixture.state.admissionAvailable = false;
    const fenced = createDatabaseSourceConnectionRepository({ database: fencedFixture.database });
    await expect(
      fenced.fail({ connectionId, errorCode: "FAILED", expectedVersion: 1, now }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_DELETION_FENCED" });

    const staleFixture = databaseFixture();
    staleFixture.state.connections.set(connectionId, storedConnectionRow());
    const stale = createDatabaseSourceConnectionRepository({ database: staleFixture.database });
    await expect(
      stale.fail({ connectionId, errorCode: "FAILED", expectedVersion: 2, now }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_VERSION_CONFLICT" });
    staleFixture.state.rowsAffectedQueue.push(0);
    await expect(
      stale.fail({ connectionId, errorCode: "FAILED", expectedVersion: 1, now }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_VERSION_CONFLICT" });
    await expect(
      stale.activate({
        connectionId,
        expectedVersion: 1,
        now,
        permissionFence,
        scopes: [],
      }),
    ).resolves.toMatchObject({ status: "active", version: 2 });

    const missingLifecycleFixture = databaseFixture();
    missingLifecycleFixture.state.connections.set(
      connectionId,
      storedConnectionRow({ credential_ref: oldCredentialRef }),
    );
    const missingLifecycle = createDatabaseSourceConnectionRepository({
      database: missingLifecycleFixture.database,
    });
    await expect(
      missingLifecycle.activate({
        connectionId,
        expectedVersion: 1,
        now,
        permissionFence,
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });

    const rotateFixture = databaseFixture();
    rotateFixture.state.connections.set(
      connectionId,
      storedConnectionRow({ credential_ref: oldCredentialRef, status: "active" }),
    );
    rotateFixture.state.secrets.set(
      oldCredentialRef,
      secretRefRow(oldCredentialRef, "connection-credential", "active"),
    );
    const rotate = createDatabaseSourceConnectionRepository({ database: rotateFixture.database });
    await expect(
      rotate.rotateCredential({
        connectionId,
        expectedCredentialRef: "another-ref",
        expectedVersion: 1,
        newCredentialRef,
        now,
        permissionFence,
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_VERSION_CONFLICT" });
    await expect(
      rotate.rotateCredential({
        connectionId,
        expectedCredentialRef: oldCredentialRef,
        expectedVersion: 1,
        newCredentialRef,
        now,
        permissionFence,
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });

    const deletingFixture = databaseFixture();
    deletingFixture.state.connections.set(
      connectionId,
      storedConnectionRow({ credential_ref: oldCredentialRef, status: "active" }),
    );
    deletingFixture.state.secrets.set(
      oldCredentialRef,
      secretRefRow(oldCredentialRef, "connection-credential", "deleting"),
    );
    const deleting = createDatabaseSourceConnectionRepository({
      database: deletingFixture.database,
    });
    await expect(
      deleting.revoke({ connectionId, expectedVersion: 1, now, permissionFence }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });

    const activeCasFixture = databaseFixture();
    activeCasFixture.state.connections.set(
      connectionId,
      storedConnectionRow({ credential_ref: oldCredentialRef }),
    );
    activeCasFixture.state.secrets.set(
      oldCredentialRef,
      secretRefRow(oldCredentialRef, "connection-credential", "staged"),
    );
    activeCasFixture.state.rowsAffectedQueue.push(1, 0);
    const activeCas = createDatabaseSourceConnectionRepository({
      database: activeCasFixture.database,
    });
    await expect(
      activeCas.activate({
        connectionId,
        expectedVersion: 1,
        now,
        permissionFence,
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });

    const retireCasFixture = databaseFixture();
    retireCasFixture.state.connections.set(connectionId, storedConnectionRow());
    retireCasFixture.state.secrets.set(
      oldCredentialRef,
      secretRefRow(oldCredentialRef, "connection-credential", "staged"),
    );
    retireCasFixture.state.rowsAffectedQueue.push(1, 0);
    const retireCas = createDatabaseSourceConnectionRepository({
      database: retireCasFixture.database,
    });
    await expect(
      retireCas.fail({ connectionId, errorCode: "FAILED", expectedVersion: 1, now }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });
  });

  it("rejects corrupt persisted connection, OAuth, and secret lifecycle rows", async () => {
    for (const overrides of [{ auth_kind: "password" }, { status: "unknown" }]) {
      const fixture = databaseFixture();
      fixture.state.connections.set(connectionId, storedConnectionRow(overrides));
      const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });
      await expect(repository.get({ connectionId, knowledgeSpaceId, tenantId })).rejects.toThrow(
        "Stored source connection",
      );
    }

    for (const overrides of [{ status: "unknown" }, { access_channel: "batch" }]) {
      const fixture = databaseFixture();
      fixture.state.oauth.set(transactionId, oauthRow(overrides));
      const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });
      await expect(
        repository.completeOAuth({
          connectionId,
          credentialRef: newCredentialRef,
          expectedVersion: 1,
          now,
          scopes: [],
          transactionId,
        }),
      ).rejects.toThrow("Stored OAuth");
    }

    for (const [accessChannel, apiKeyId] of [
      ["service_api", "key-a"],
      ["mcp", undefined],
      ["agent", undefined],
    ] as const) {
      const fixture = databaseFixture();
      fixture.state.oauth.set(
        transactionId,
        oauthRow({ access_channel: accessChannel, api_key_id: apiKeyId ?? null }),
      );
      const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });
      const claimed = await repository.claimOAuthCallback({
        accessChannel,
        ...(apiKeyId ? { apiKeyId } : {}),
        now,
        requestedBySubjectId: "editor-a",
        stateHash: "a".repeat(64),
        tenantId,
      });
      expect(claimed).toMatchObject({ accessChannel, ...(apiKeyId ? { apiKeyId } : {}) });
    }

    for (const overrides of [
      { purpose: "password" },
      { state: "unknown" },
      { remote_revoke_required: "yes" },
    ]) {
      const fixture = databaseFixture();
      fixture.state.secrets.set(
        oldCredentialRef,
        secretRefRow(oldCredentialRef, "connection-credential", "retired"),
      );
      Object.assign(fixture.state.secrets.get(oldCredentialRef) ?? {}, overrides);
      fixture.state.cleanupSecretRefs.push(oldCredentialRef);
      const repository = createDatabaseSourceConnectionRepository({ database: fixture.database });
      await expect(
        repository.claimSecretCleanup({
          leaseExpiresAt: later,
          limit: 1,
          now,
          workerId: "cleanup-a",
        }),
      ).rejects.toThrow("Stored source connection");
    }

    const optionalFixture = databaseFixture("tidb");
    optionalFixture.state.secrets.set(oldCredentialRef, {
      ...secretRefRow(oldCredentialRef, "connection-credential", "deleting"),
      lease_expires_at: now,
      lease_token: "lease-a",
      remote_revoke_required: 1,
      worker_id: "prior-worker",
    });
    optionalFixture.state.cleanupSecretRefs.push(oldCredentialRef);
    const optional = createDatabaseSourceConnectionRepository({
      database: optionalFixture.database,
    });
    await expect(
      optional.claimSecretCleanup({
        leaseExpiresAt: later,
        limit: 1,
        now,
        workerId: "cleanup-a",
      }),
    ).resolves.toMatchObject([
      { credentialRef: oldCredentialRef, remoteRevokeRequired: true, state: "deleting" },
    ]);
  });
});

function oauthTransactionRowInput() {
  return {
    accessChannel: "interactive" as const,
    connectionId,
    createdAt: now,
    expiresAt: later,
    id: transactionId,
    knowledgeSpaceId,
    permissionSnapshotId,
    permissionSnapshotRevision: 1,
    redirectUri: "https://api.example.test/source-oauth/callback",
    requestedBySubjectId: "editor-a",
    stateHash: "a".repeat(64),
    status: "pending" as const,
    tenantId,
    verifierRef,
  };
}

function databaseFixture(dialect: DatabaseAdapter["dialect"] = "postgres") {
  const calls: DatabaseExecuteInput[] = [];
  const state = {
    admissionAvailable: true,
    cleanupOauthIds: [] as string[],
    cleanupSecretRefs: [] as string[],
    connections: new Map<string, DatabaseRow>(),
    nextRowsAffected: undefined as number | undefined,
    oauth: new Map<string, DatabaseRow>(),
    rowsAffectedQueue: [] as number[],
    secrets: new Map<string, DatabaseRow>(),
  };
  const rowsAffected = () => {
    const affected = state.rowsAffectedQueue.shift() ?? state.nextRowsAffected ?? 1;
    state.nextRowsAffected = undefined;
    return affected;
  };
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.tableName === "knowledge_spaces") {
      return result(
        state.admissionAvailable
          ? [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }]
          : [],
      );
    }
    if (input.tableName === "deletion_jobs") return result([]);
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return result([permissionRow()]);
    }
    if (
      input.tableName === "knowledge_space_members" ||
      input.tableName === "knowledge_space_access_policies" ||
      input.tableName === "knowledge_space_api_access"
    ) {
      return result([{ id: `${input.tableName}-a` }]);
    }
    if (input.tableName === "source_connections") {
      return executeConnection(input, state.connections, rowsAffected);
    }
    if (input.tableName === "source_oauth_transactions") {
      return executeOAuth(input, state.oauth, state.cleanupOauthIds, rowsAffected);
    }
    if (input.tableName === "source_connection_secret_refs") {
      return executeSecretRef(input, state.secrets, state.cleanupSecretRefs, rowsAffected);
    }
    return result([], input.operation === "select" ? 0 : rowsAffected());
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
  return { calls, database, state };
}

function executeConnection(
  input: DatabaseExecuteInput,
  connections: Map<string, DatabaseRow>,
  rowsAffected: () => number,
): DatabaseExecuteResult {
  if (input.operation === "insert") {
    const row = rowFromParams(input, [
      "id",
      "tenant_id",
      "knowledge_space_id",
      "provider_id",
      "name",
      "auth_kind",
      "status",
      "configuration",
      "credential_ref",
      "scopes",
      "version",
      "created_at",
      "updated_at",
    ]);
    connections.set(String(row.id), row);
    return result([], 1);
  }
  if (input.operation === "select") {
    if (input.sql.includes("ORDER BY")) {
      const afterCreatedAt = input.params.length === 5 ? String(input.params[2]) : undefined;
      const afterId = input.params.length === 5 ? String(input.params[3]) : undefined;
      return result(
        [...connections.values()]
          .filter(
            (row) =>
              row.tenant_id === input.params[0] &&
              row.knowledge_space_id === input.params[1] &&
              (!afterCreatedAt ||
                String(row.created_at) > afterCreatedAt ||
                (row.created_at === afterCreatedAt && String(row.id) > String(afterId))),
          )
          .sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          ),
      );
    }
    const row = connections.get(String(input.params[0]));
    if (
      row &&
      (input.params.length === 1 ||
        (row.tenant_id === input.params[1] && row.knowledge_space_id === input.params[2]))
    ) {
      return result([row]);
    }
    return result([]);
  }
  const affected = rowsAffected();
  if (affected !== 1) return result([], affected);
  const completeOAuth = typeof input.params[0] === "string" && input.params[0].startsWith("[");
  const id = String(input.params[completeOAuth ? 5 : 7]);
  const expectedVersion = Number(input.params[completeOAuth ? 6 : 8]);
  const current = connections.get(id);
  if (!current || current.version !== expectedVersion) return result([], 0);
  const next = completeOAuth
    ? {
        ...current,
        credential_ref: input.params[2],
        expires_at: input.params[1],
        last_error_code: null,
        scopes: input.params[0],
        status: "active",
        updated_at: input.params[4],
        version: input.params[3],
      }
    : {
        ...current,
        credential_ref: input.params[2],
        expires_at: input.params[3],
        last_error_code: input.params[4],
        scopes: input.params[1],
        status: input.params[0],
        updated_at: input.params[6],
        version: input.params[5],
      };
  connections.set(id, next);
  return result([], 1);
}

function executeOAuth(
  input: DatabaseExecuteInput,
  oauth: Map<string, DatabaseRow>,
  cleanupIds: readonly string[],
  rowsAffected: () => number,
): DatabaseExecuteResult {
  if (input.operation === "insert") {
    const row = rowFromParams(input, [
      "id",
      "tenant_id",
      "knowledge_space_id",
      "connection_id",
      "requested_by_subject_id",
      "access_channel",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "api_key_id",
      "state_hash",
      "verifier_ref",
      "redirect_uri",
      "status",
      "created_at",
      "expires_at",
    ]);
    oauth.set(String(row.id), row);
    return result([], 1);
  }
  if (input.operation === "select") {
    if (input.sql.includes("ORDER BY")) {
      return result(
        cleanupIds.flatMap((id) => {
          const row = oauth.get(id);
          return row ? [{ id: row.id, verifier_ref: row.verifier_ref }] : [];
        }),
      );
    }
    if (input.sql.includes("state_hash")) {
      const row = [...oauth.values()].find((candidate) => candidate.state_hash === input.params[0]);
      return result(row ? [row] : []);
    }
    const row = oauth.get(String(input.params[0]));
    return result(row ? [row] : []);
  }
  const affected = rowsAffected();
  if (affected !== 1) return result([], affected);
  const id = String(input.params[1]);
  const current = oauth.get(id);
  if (!current) return result([], 0);
  if (input.sql.includes("'completed'")) {
    oauth.set(id, { ...current, completed_at: input.params[0], status: "completed" });
  } else if (input.sql.includes("'failed'")) {
    oauth.set(id, { ...current, consumed_at: input.params[0], status: "failed" });
  } else if (input.sql.includes("'exchanging'")) {
    oauth.set(id, { ...current, consumed_at: input.params[0], status: "exchanging" });
  }
  return result([], 1);
}

function executeSecretRef(
  input: DatabaseExecuteInput,
  secrets: Map<string, DatabaseRow>,
  cleanupRefs: readonly string[],
  rowsAffected: () => number,
): DatabaseExecuteResult {
  if (input.operation === "insert") {
    const credentialRef = String(input.params[5]);
    const row = {
      ...rowFromParams(input, [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "connection_id",
        "provider_id",
        "credential_ref",
        "purpose",
        "state",
        "remote_revoke_required",
        "recover_after",
        "row_version",
        "created_at",
        "updated_at",
      ]),
      lease_expires_at: null,
      lease_token: null,
      worker_id: null,
    };
    secrets.set(credentialRef, row);
    return result([], 1);
  }
  if (input.operation === "select") {
    if (input.sql.includes("ORDER BY COALESCE")) {
      return result(
        cleanupRefs.flatMap((ref) => {
          const row = secrets.get(ref);
          return row ? [row] : [];
        }),
      );
    }
    if (
      input.sql.includes("connection_id") &&
      input.sql.includes("state") &&
      input.params.length === 1
    ) {
      return result(
        [...secrets.values()].filter(
          (row) => row.connection_id === input.params[0] && row.state === "staged",
        ),
      );
    }
    const row = secrets.get(String(input.params[0]));
    return result(row ? [row] : []);
  }
  const affected = rowsAffected();
  if (affected !== 1) return result([], affected);
  if (
    input.sql.includes("recover_after") &&
    !input.sql.includes("state") &&
    input.params.length === 3
  ) {
    const ref = String(input.params[2]);
    const current = secrets.get(ref);
    if (current)
      secrets.set(ref, { ...current, recover_after: input.params[0], updated_at: input.params[1] });
    return result([], 1);
  }
  if (input.sql.includes("last_error_code")) {
    const current = secretById(secrets, String(input.params[4]));
    if (current) {
      secrets.set(String(current.credential_ref), {
        ...current,
        last_error_code: input.params[1],
        lease_expires_at: null,
        lease_token: null,
        next_attempt_at: input.params[0],
        row_version: input.params[2],
        state: "retired",
        updated_at: input.params[3],
        worker_id: null,
      });
    }
    return result([], 1);
  }
  if (input.sql.includes("'deleted'")) {
    const current = secretById(secrets, String(input.params[3]));
    if (current) {
      secrets.set(String(current.credential_ref), {
        ...current,
        deleted_at: input.params[2],
        lease_expires_at: null,
        lease_token: null,
        row_version: input.params[0],
        state: "deleted",
        updated_at: input.params[1],
        worker_id: null,
      });
    }
    return result([], 1);
  }
  if (input.sql.includes("state") && input.sql.includes("'deleting'")) {
    const current = secretById(secrets, String(input.params[5]));
    if (current) {
      secrets.set(String(current.credential_ref), {
        ...current,
        lease_expires_at: input.params[2],
        lease_token: input.params[1],
        row_version: input.params[3],
        state: "deleting",
        updated_at: input.params[4],
        worker_id: input.params[0],
      });
    }
    return result([], 1);
  }
  if (input.sql.includes("'retired'")) {
    const current = secretById(secrets, String(input.params[4]));
    if (current) {
      secrets.set(String(current.credential_ref), {
        ...current,
        next_attempt_at: null,
        recover_after: input.params[1],
        remote_revoke_required: current.remote_revoke_required === true || input.params[0] === true,
        row_version: input.params[2],
        state: "retired",
        updated_at: input.params[3],
      });
    }
    return result([], 1);
  }
  if (input.sql.includes("'active'")) {
    const current = secretById(secrets, String(input.params[2]));
    if (current) {
      secrets.set(String(current.credential_ref), {
        ...current,
        row_version: input.params[0],
        state: "active",
        updated_at: input.params[1],
      });
    }
  }
  return result([], 1);
}

function rowFromParams(input: DatabaseExecuteInput, columns: readonly string[]): DatabaseRow {
  return Object.fromEntries(columns.map((column, index) => [column, input.params[index]]));
}

function result(rows: readonly DatabaseRow[], rowsAffected = 0): DatabaseExecuteResult {
  return { rows, rowsAffected };
}

function secretById(
  secrets: ReadonlyMap<string, DatabaseRow>,
  id: string,
): DatabaseRow | undefined {
  return [...secrets.values()].find((row) => row.id === id);
}

function storedConnectionRow(overrides: Readonly<Record<string, unknown>> = {}): DatabaseRow {
  return {
    auth_kind: "oauth2",
    configuration: "{}",
    created_at: now,
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
    updated_at: now,
    version: 1,
    ...overrides,
  };
}

function oauthRow(overrides: Readonly<Record<string, unknown>> = {}): DatabaseRow {
  return {
    access_channel: "interactive",
    api_key_id: null,
    connection_id: connectionId,
    consumed_at: "2026-07-14T11:00:00.000Z",
    created_at: "2026-07-14T10:00:00.000Z",
    expires_at: later,
    id: transactionId,
    knowledge_space_id: knowledgeSpaceId,
    permission_snapshot_id: permissionSnapshotId,
    permission_snapshot_revision: 1,
    redirect_uri: "https://api.example.test/source-oauth/callback",
    requested_by_subject_id: "editor-a",
    state_hash: "a".repeat(64),
    status: "pending",
    tenant_id: tenantId,
    verifier_ref: verifierRef,
    ...overrides,
  };
}

function secretRefRow(
  ref: string,
  purpose: "connection-credential" | "oauth-pkce",
  state: "active" | "deleted" | "deleting" | "retired" | "staged",
): DatabaseRow {
  return {
    connection_id: connectionId,
    credential_ref: ref,
    id: `${purpose}-${ref}`,
    knowledge_space_id: knowledgeSpaceId,
    lease_expires_at: null,
    lease_token: null,
    provider_id: "drive-a",
    purpose,
    remote_revoke_required: false,
    row_version: 1,
    state,
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
