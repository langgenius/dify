import type { Source } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  type SourceConnectionRepository,
  type SourceOAuthProvider,
  createInMemorySourceConnectionRepository,
  createSourceConnectionService,
  decodeConnectionCursor,
  encodeConnectionCursor,
} from "./source-connection";
import { createStaticSourceProviderCatalog } from "./source-provider-catalog";
import type { SourceSecretStore } from "./source-secret-store";

const tenantId = "tenant-a";
const knowledgeSpaceId = "00000000-0000-4000-8000-000000000001";
const firstConnectionId = "00000000-0000-4000-8000-000000000010";
const secondConnectionId = "00000000-0000-4000-8000-000000000011";
const transactionId = "00000000-0000-4000-8000-000000000020";
const oldCredentialRef = "source-secret:v1:credential-old";
const newCredentialRef = "source-secret:v1:credential-new";
const oauthCredentialRef = "source-secret:v1:credential-oauth";
const verifierRef = "source-secret:v1:verifier-a";
const now = "2026-01-01T00:00:00.000Z";
const later = "2027-01-01T00:00:00.000Z";
const subject = { scopes: [], subjectId: "user-a", tenantId };
const permissionFence = {
  accessChannel: "interactive" as const,
  knowledgeSpaceId,
  permissionSnapshotId: "00000000-0000-4000-8000-000000000099",
  permissionSnapshotRevision: 1,
  requestedBySubjectId: subject.subjectId,
  tenantId,
};

describe("source-connection behavior coverage", () => {
  it("enforces in-memory identity, cursor, OAuth, credential, and cleanup fences", async () => {
    const repository = createInMemorySourceConnectionRepository();
    const first = await repository.begin(
      connectionInput(firstConnectionId, now, { credentialRef: oldCredentialRef }),
    );
    const activeFirst = await repository.activate({
      connectionId: first.id,
      expectedVersion: 1,
      now,
      permissionFence,
      scopes: ["read"],
    });
    await repository.begin(connectionInput(secondConnectionId, later));
    await expect(repository.begin(connectionInput(firstConnectionId, now))).rejects.toMatchObject({
      code: "SOURCE_CONNECTION_ID_CONFLICT",
    });
    await expect(
      repository.get({ connectionId: firstConnectionId, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ id: firstConnectionId });
    await expect(
      repository.get({
        connectionId: firstConnectionId,
        knowledgeSpaceId,
        tenantId: "another-tenant",
      }),
    ).resolves.toBeNull();

    const page = await repository.list({ knowledgeSpaceId, limit: 1, tenantId });
    expect(page.items).toMatchObject([{ id: firstConnectionId }]);
    const cursor = page.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    if (!cursor) throw new Error("Expected a cursor for the second in-memory page");
    await expect(
      repository.list({ cursor, knowledgeSpaceId, limit: 1, tenantId }),
    ).resolves.toMatchObject({ items: [{ id: secondConnectionId }] });
    for (const limit of [0, 1.5, 201]) {
      await expect(repository.list({ knowledgeSpaceId, limit, tenantId })).rejects.toMatchObject({
        code: "SOURCE_CONNECTION_LIST_LIMIT_INVALID",
      });
    }

    const encoded = encodeConnectionCursor({ createdAt: now, id: firstConnectionId });
    expect(decodeConnectionCursor(encoded)).toEqual({ createdAt: now, id: firstConnectionId });
    for (const invalidCursor of [
      "",
      "x".repeat(4_097),
      Buffer.from(JSON.stringify({ createdAt: now, id: firstConnectionId })).toString("base64url"),
      Buffer.from(JSON.stringify(["not-a-date", firstConnectionId])).toString("base64url"),
      Buffer.from(JSON.stringify([now, ""])).toString("base64url"),
    ]) {
      expect(() => decodeConnectionCursor(invalidCursor)).toThrow("cursor is invalid");
    }

    const transaction = oauthTransaction();
    await repository.beginOAuth(transaction);
    await expect(repository.beginOAuth(transaction)).rejects.toMatchObject({
      code: "SOURCE_OAUTH_ID_CONFLICT",
    });
    await expect(
      repository.beginOAuth({
        ...transaction,
        id: "00000000-0000-4000-8000-000000000021",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_STATE_CONFLICT" });
    await expect(
      repository.beginOAuth({
        ...transaction,
        id: "00000000-0000-4000-8000-000000000022",
        stateHash: "b".repeat(64),
        tenantId: "another-tenant",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_SCOPE_MISMATCH" });
    await expect(
      repository.claimOAuthCallback({
        accessChannel: "interactive",
        now,
        requestedBySubjectId: "another-subject",
        stateHash: transaction.stateHash,
        tenantId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.claimOAuthCallback({
        accessChannel: "interactive",
        now,
        requestedBySubjectId: subject.subjectId,
        stateHash: transaction.stateHash,
        tenantId,
      }),
    ).resolves.toMatchObject({ status: "exchanging" });
    await expect(
      repository.completeOAuth({
        connectionId: secondConnectionId,
        credentialRef: oauthCredentialRef,
        expectedVersion: 1,
        now,
        scopes: ["read"],
        transactionId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });
    await repository.reserveCredential({
      connectionId: secondConnectionId,
      credentialRef: oauthCredentialRef,
      expectedVersion: 1,
      now,
      permissionFence,
      recoverAfter: later,
    });
    await expect(
      repository.completeOAuth({
        connectionId: secondConnectionId,
        credentialRef: oauthCredentialRef,
        expectedVersion: 1,
        expiresAt: later,
        now,
        scopes: ["read"],
        transactionId,
      }),
    ).resolves.toMatchObject({ status: "active", version: 2 });

    await repository.reserveCredential({
      connectionId: firstConnectionId,
      credentialRef: newCredentialRef,
      expectedVersion: activeFirst.version,
      now,
      permissionFence,
      recoverAfter: later,
    });
    await repository.reserveCredential({
      connectionId: firstConnectionId,
      credentialRef: newCredentialRef,
      expectedVersion: activeFirst.version,
      now,
      permissionFence,
      recoverAfter: later,
    });
    await expect(
      repository.reserveCredential({
        connectionId: secondConnectionId,
        credentialRef: newCredentialRef,
        expectedVersion: 2,
        now,
        permissionFence,
        recoverAfter: later,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });
    await expect(
      repository.rotateCredential({
        connectionId: firstConnectionId,
        expectedCredentialRef: "wrong-ref",
        expectedVersion: activeFirst.version,
        newCredentialRef,
        now,
        permissionFence,
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_VERSION_CONFLICT" });
    const rotated = await repository.rotateCredential({
      connectionId: firstConnectionId,
      expectedCredentialRef: oldCredentialRef,
      expectedVersion: activeFirst.version,
      newCredentialRef,
      now,
      permissionFence,
      scopes: ["read", "write"],
    });
    const revoked = await repository.revoke({
      connectionId: firstConnectionId,
      expectedVersion: rotated.version,
      now,
      permissionFence,
    });
    await expect(
      repository.revoke({
        connectionId: firstConnectionId,
        expectedVersion: revoked.version,
        now,
        permissionFence,
      }),
    ).resolves.toMatchObject({ status: "revoked", version: revoked.version });

    await repository.beginOAuth({
      ...transaction,
      connectionId: secondConnectionId,
      expiresAt: now,
      id: "00000000-0000-4000-8000-000000000023",
      stateHash: "c".repeat(64),
      verifierRef: "source-secret:v1:verifier-cleanup",
    });
    const claimedCleanup = await repository.claimSecretCleanup({
      leaseExpiresAt: later,
      limit: 20,
      now: later,
      workerId: "cleanup-a",
    });
    expect(claimedCleanup.length).toBeGreaterThanOrEqual(2);
    const firstCleanup = claimedCleanup[0];
    const secondCleanup = claimedCleanup[1];
    if (!firstCleanup || !secondCleanup || !firstCleanup.leaseToken || !secondCleanup.leaseToken) {
      throw new Error("Expected two in-memory cleanup leases");
    }
    await expect(
      repository.completeSecretCleanup({
        leaseToken: "wrong-token",
        now: later,
        refId: firstCleanup.id,
        rowVersion: firstCleanup.rowVersion,
        workerId: "cleanup-a",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_CLEANUP_FENCE_LOST" });
    await repository.completeSecretCleanup({
      leaseToken: firstCleanup.leaseToken,
      now: later,
      refId: firstCleanup.id,
      rowVersion: firstCleanup.rowVersion,
      workerId: "cleanup-a",
    });
    await repository.failSecretCleanup({
      errorCode: "REMOTE_REVOKE_FAILED",
      leaseToken: secondCleanup.leaseToken,
      nextAttemptAt: later,
      now: later,
      refId: secondCleanup.id,
      rowVersion: secondCleanup.rowVersion,
      workerId: "cleanup-a",
    });
  });

  it("validates provider configuration, credentials, names, and supported auth kinds", async () => {
    const { service } = serviceHarness();
    const validConfiguration = {
      batchSize: 10,
      endpoint: "https://source.example.test/",
      recursive: true,
    };
    const validRequest = {
      authKind: "api-key" as const,
      callerKind: "interactive" as const,
      configuration: validConfiguration,
      credentials: { apiKey: "secret-a" },
      knowledgeSpaceId,
      name: "Configured source",
      providerId: "configured-a",
      subject,
      tenantId,
    };

    for (const configuration of [
      {},
      { ...validConfiguration, unknown: "value" },
      { ...validConfiguration, apiKey: "must-remain-secret" },
      { ...validConfiguration, endpoint: 42 },
      { ...validConfiguration, endpoint: "not-a-uri" },
      { ...validConfiguration, endpoint: "http://source.example.test/" },
      { ...validConfiguration, recursive: "yes" },
      { ...validConfiguration, batchSize: 1.5 },
    ]) {
      await expect(
        service.create({ ...validRequest, configuration } as never),
      ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_CONFIGURATION_INVALID" });
    }
    for (const credentials of [{}, { apiKey: "secret-a", unknown: true }, { apiKey: 42 }]) {
      await expect(service.create({ ...validRequest, credentials })).rejects.toMatchObject({
        code: expect.stringMatching(/SOURCE_CONNECTION_(CREDENTIALS|CONFIGURATION)_INVALID/u),
      });
    }
    for (const name of [" ", "n".repeat(161)]) {
      await expect(service.create({ ...validRequest, name })).rejects.toMatchObject({
        code: "SOURCE_CONNECTION_INPUT_INVALID",
      });
    }
    await expect(service.create({ ...validRequest, authKind: "endpoint" })).rejects.toMatchObject({
      code: "SOURCE_CONNECTION_AUTH_UNSUPPORTED",
    });
    await expect(
      service.startOAuth({
        callerKind: "interactive",
        configuration: validConfiguration,
        knowledgeSpaceId,
        name: "OAuth source",
        providerId: "configured-a",
        redirectUri: "https://api.example.test/source-oauth/callback",
        scopes: [],
        subject,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_AUTH_UNSUPPORTED" });

    const created = await service.create(validRequest);
    expect(created).toMatchObject({ status: "active", version: 2 });
  });

  it("validates OAuth provider availability, PKCE tokens, scopes, redirects, and timeout bounds", async () => {
    const missingProvider = serviceHarness({ oauthAvailable: false });
    await expect(missingProvider.service.startOAuth(oauthStartRequest())).rejects.toMatchObject({
      code: "SOURCE_OAUTH_PROVIDER_UNAVAILABLE",
    });

    for (const [overrides, code] of [
      [{ generateState: () => "short" }, "SOURCE_OAUTH_INPUT_INVALID"],
      [
        { generatePkceVerifier: () => "invalid verifier with spaces" },
        "SOURCE_OAUTH_INPUT_INVALID",
      ],
      [
        { scopes: Array.from({ length: 101 }, (_, index) => `scope-${index}`) },
        "SOURCE_OAUTH_SCOPES_INVALID",
      ],
      [{ scopes: ["s".repeat(256)] }, "SOURCE_OAUTH_SCOPES_INVALID"],
    ] as const) {
      const harness = serviceHarness(overrides);
      await expect(harness.service.startOAuth(oauthStartRequest(overrides))).rejects.toMatchObject({
        code,
      });
    }

    for (const redirectUri of [
      "not-a-uri",
      "https://user:password@api.example.test/callback",
      "https://api.example.test/callback#fragment",
      "ftp://api.example.test/callback",
      "https://unapproved.example.test/callback",
    ]) {
      const harness = serviceHarness();
      await expect(
        harness.service.startOAuth(oauthStartRequest({ redirectUri })),
      ).rejects.toMatchObject({ code: "SOURCE_OAUTH_REDIRECT_INVALID" });
    }

    const loopback = serviceHarness({ allowDevelopmentLoopbackOAuthRedirects: true });
    await expect(
      loopback.service.startOAuth(
        oauthStartRequest({ redirectUri: "http://localhost:3000/source-oauth/callback" }),
      ),
    ).resolves.toMatchObject({ authorizationUrl: expect.stringContaining("state=") });

    const timeout = serviceHarness({ oauthOperationTimeoutMs: 500 });
    await timeout.service.startOAuth(oauthStartRequest());
    await expect(
      timeout.service.callback({
        callerKind: "interactive",
        code: "authorization-code",
        state: "s".repeat(32),
        subject,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_TIMEOUT_INVALID" });
  });

  it("redacts reads, hydrates connector-only sources, and revokes idempotently", async () => {
    const harness = serviceHarness();
    const created = await harness.service.create({
      authKind: "api-key",
      callerKind: "interactive",
      configuration: {
        batchSize: 10,
        endpoint: "https://source.example.test/",
        recursive: true,
      },
      credentials: { apiKey: "secret-a" },
      knowledgeSpaceId,
      name: "Configured source",
      providerId: "configured-a",
      subject,
      tenantId,
    });
    await expect(
      harness.service.get({ connectionId: created.id, knowledgeSpaceId, tenantId }),
    ).resolves.toEqual(created);
    await expect(
      harness.service.get({ connectionId: "missing", knowledgeSpaceId, tenantId }),
    ).resolves.toBeNull();

    await harness.repository.begin(
      connectionInput(secondConnectionId, later, { name: "Second source" }),
    );
    const page = await harness.service.list({ knowledgeSpaceId, limit: 1, tenantId });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual(expect.any(String));

    const unbound = sourceRecord();
    await expect(harness.service.resolve({ source: unbound, tenantId })).resolves.toEqual(unbound);
    const bound = sourceRecord({ connectionId: created.id });
    await expect(harness.service.resolve({ source: bound, tenantId })).resolves.toMatchObject({
      metadata: {
        batchSize: 10,
        credentials: { apiKey: "secret-a" },
        endpoint: "https://source.example.test/",
        preserved: true,
        recursive: true,
      },
    });

    const inactive = await harness.repository.begin(
      connectionInput("00000000-0000-4000-8000-000000000012", later),
    );
    await expect(
      harness.service.resolve({ source: sourceRecord({ connectionId: inactive.id }), tenantId }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_CREDENTIAL_UNAVAILABLE" });
    const missingSecret = await harness.repository.begin(
      connectionInput("00000000-0000-4000-8000-000000000013", later, {
        credentialRef: "source-secret:v1:missing-secret",
      }),
    );
    await harness.repository.activate({
      connectionId: missingSecret.id,
      expectedVersion: 1,
      now,
      permissionFence,
      scopes: [],
    });
    await expect(
      harness.service.resolve({
        source: sourceRecord({ connectionId: missingSecret.id }),
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_CREDENTIAL_UNAVAILABLE" });

    await expect(
      harness.service.revoke({
        callerKind: "interactive",
        connectionId: created.id,
        expectedVersion: 99,
        knowledgeSpaceId,
        subject,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_VERSION_CONFLICT" });
    const revoked = await harness.service.revoke({
      callerKind: "interactive",
      connectionId: created.id,
      expectedVersion: created.version,
      knowledgeSpaceId,
      subject,
      tenantId,
    });
    await expect(
      harness.service.revoke({
        callerKind: "interactive",
        connectionId: created.id,
        expectedVersion: revoked.version,
        knowledgeSpaceId,
        subject,
        tenantId,
      }),
    ).resolves.toEqual(revoked);
    await expect(
      harness.service.revoke({
        callerKind: "interactive",
        connectionId: created.id,
        expectedVersion: revoked.version,
        knowledgeSpaceId,
        subject: { ...subject, tenantId: "another-tenant" },
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SCOPE_MISMATCH" });
  });

  it("fails closed on missing, stale, and incomplete in-memory lifecycle state", async () => {
    const repository = createInMemorySourceConnectionRepository();
    await expect(
      repository.fail({
        connectionId: "missing",
        errorCode: "FAILED",
        expectedVersion: 1,
        now,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_NOT_FOUND" });

    const expiring = await repository.begin(
      connectionInput(firstConnectionId, now, { credentialRef: oldCredentialRef }),
    );
    await expect(
      repository.fail({
        connectionId: expiring.id,
        errorCode: "FAILED",
        expectedVersion: 2,
        now,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_VERSION_CONFLICT" });
    const cleanup = await repository.claimSecretCleanup({
      leaseExpiresAt: later,
      limit: 1,
      now: later,
      workerId: "cleanup-a",
    });
    const expiredCredential = cleanup[0];
    if (!expiredCredential?.leaseToken) throw new Error("Expected the staged credential cleanup");
    await repository.completeSecretCleanup({
      leaseToken: expiredCredential.leaseToken,
      now: later,
      refId: expiredCredential.id,
      rowVersion: expiredCredential.rowVersion,
      workerId: "cleanup-a",
    });
    await expect(
      repository.activate({
        connectionId: expiring.id,
        expectedVersion: 1,
        now,
        permissionFence,
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });

    const oauthConnection = await repository.begin(connectionInput(secondConnectionId, later));
    const pending = oauthTransaction();
    await repository.beginOAuth(pending);
    await repository.reserveCredential({
      connectionId: oauthConnection.id,
      credentialRef: oauthCredentialRef,
      expectedVersion: 1,
      now,
      permissionFence,
      recoverAfter: later,
    });
    await expect(
      repository.completeOAuth({
        connectionId: oauthConnection.id,
        credentialRef: oauthCredentialRef,
        expectedVersion: 1,
        now,
        scopes: [],
        transactionId: pending.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_STATE_CONFLICT" });

    const active = await repository.begin(
      connectionInput("00000000-0000-4000-8000-000000000014", now, {
        credentialRef: "source-secret:v1:active-old",
      }),
    );
    const activated = await repository.activate({
      connectionId: active.id,
      expectedVersion: 1,
      now,
      permissionFence,
      scopes: [],
    });
    await expect(
      repository.rotateCredential({
        connectionId: active.id,
        expectedCredentialRef: "source-secret:v1:active-old",
        expectedVersion: activated.version,
        newCredentialRef: "source-secret:v1:not-reserved",
        now,
        permissionFence,
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT" });
    const firstLease = await repository.claimSecretCleanup({
      leaseExpiresAt: later,
      limit: 10,
      now: later,
      workerId: "cleanup-a",
    });
    expect(firstLease.length).toBeGreaterThan(0);
    await expect(
      repository.claimSecretCleanup({
        leaseExpiresAt: later,
        limit: 10,
        now,
        workerId: "cleanup-b",
      }),
    ).resolves.toEqual([]);
  });

  it("reports service refresh and OAuth callback failures without leaking provider errors", async () => {
    const missing = serviceHarness();
    await expect(
      missing.service.revoke({
        callerKind: "interactive",
        connectionId: "missing",
        expectedVersion: 1,
        knowledgeSpaceId,
        subject,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_NOT_FOUND" });

    const refresh = serviceHarness();
    const noCredential = await refresh.repository.begin(
      connectionInput(firstConnectionId, now, { providerId: "oauth-a" }),
    );
    const activeWithoutCredential = await refresh.repository.activate({
      connectionId: noCredential.id,
      expectedVersion: 1,
      now,
      permissionFence,
      scopes: [],
    });
    await expect(
      refresh.service.refresh(refreshRequest(activeWithoutCredential.id, 1)),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_VERSION_CONFLICT" });
    await expect(
      refresh.service.refresh(refreshRequest(activeWithoutCredential.id, 2)),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_CREDENTIAL_UNAVAILABLE" });

    const missingToken = serviceHarness();
    const missingTokenConnection = await seedActiveRefreshConnection(
      missingToken.repository,
      missingToken.secrets,
      { accessToken: "access-only" },
    );
    await expect(
      missingToken.service.refresh(refreshRequest(missingTokenConnection.id, 2)),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_REFRESH_UNAVAILABLE" });

    const missingOAuth = serviceHarness();
    const missingOAuthConnection = await seedActiveRefreshConnection(
      missingOAuth.repository,
      missingOAuth.secrets,
      { accessToken: "access-a", refreshToken: "refresh-a" },
    );
    missingOAuth.setOAuthAvailable(false);
    await expect(
      missingOAuth.service.refresh(refreshRequest(missingOAuthConnection.id, 2)),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_PROVIDER_UNAVAILABLE" });

    const authorizationFailure = serviceHarness();
    authorizationFailure.oauth.authorizationUrl = async () => {
      throw new Error("provider rejected authorization start");
    };
    await expect(
      authorizationFailure.service.startOAuth(oauthStartRequest()),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_START_FAILED" });

    const callbackProvider = serviceHarness();
    await callbackProvider.service.startOAuth(oauthStartRequest());
    callbackProvider.setOAuthAvailable(false);
    await expect(
      callbackProvider.service.callback({
        callerKind: "interactive",
        code: "authorization-code",
        state: "s".repeat(32),
        subject,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_PROVIDER_UNAVAILABLE" });

    const missingVerifier = serviceHarness();
    const started = await missingVerifier.service.startOAuth(oauthStartRequest());
    await missingVerifier.secrets.delete({
      knowledgeSpaceId,
      ref: "source-secret:v1:00000000-0000-4000-8000-000000000200",
      sourceId: started.connection.id,
      tenantId,
    });
    await expect(
      missingVerifier.service.callback({
        callerKind: "interactive",
        code: "authorization-code",
        state: "s".repeat(32),
        subject,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_PKCE_UNAVAILABLE" });

    const tokenVariants = serviceHarness();
    tokenVariants.oauth.exchange = async () => ({
      accessToken: "access-a",
      expiresAt: later,
      refreshToken: "refresh-a",
      scopes: ["write", "read", "read"],
      tokenType: "Bearer",
    });
    await tokenVariants.service.startOAuth(oauthStartRequest());
    await expect(
      tokenVariants.service.callback({
        callerKind: "interactive",
        code: "authorization-code",
        state: "s".repeat(32),
        subject,
      }),
    ).resolves.toMatchObject({ expiresAt: later, scopes: ["read", "write"] });
    await expect(
      tokenVariants.service.callback({
        callerKind: "interactive",
        code: "authorization-code",
        state: "short",
        subject,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_INPUT_INVALID" });
  });
});

function connectionInput(
  id: string,
  createdAt: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    authKind: "oauth2" as const,
    configuration: {},
    createdAt,
    id,
    knowledgeSpaceId,
    name: "Documents",
    permissionFence,
    providerId: "oauth-a",
    scopes: ["read"],
    tenantId,
    ...overrides,
  } as Parameters<SourceConnectionRepository["begin"]>[0];
}

function oauthTransaction() {
  return {
    accessChannel: "interactive" as const,
    connectionId: secondConnectionId,
    createdAt: now,
    expiresAt: later,
    id: transactionId,
    knowledgeSpaceId,
    permissionSnapshotId: permissionFence.permissionSnapshotId,
    permissionSnapshotRevision: 1,
    redirectUri: "https://api.example.test/source-oauth/callback",
    requestedBySubjectId: subject.subjectId,
    stateHash: "a".repeat(64),
    status: "pending" as const,
    tenantId,
    verifierRef,
  };
}

interface ServiceHarnessOptions {
  readonly allowDevelopmentLoopbackOAuthRedirects?: boolean | undefined;
  readonly generatePkceVerifier?: (() => string) | undefined;
  readonly generateState?: (() => string) | undefined;
  readonly oauthAvailable?: boolean | undefined;
  readonly oauthOperationTimeoutMs?: number | undefined;
  readonly scopes?: readonly string[] | undefined;
}

function serviceHarness(options: ServiceHarnessOptions = {}) {
  const repository = createInMemorySourceConnectionRepository();
  const secrets = memorySecrets();
  let connectionSequence = 100;
  let credentialSequence = 200;
  let transactionSequence = 300;
  let oauthAvailable = options.oauthAvailable !== false;
  const oauth: SourceOAuthProvider = {
    authorizationUrl: async ({ state }) => `https://accounts.example.test/auth?state=${state}`,
    exchange: async () => ({ accessToken: "access-a", refreshToken: "refresh-a" }),
    refresh: async () => ({ accessToken: "access-b", refreshToken: "refresh-b" }),
    revoke: async () => undefined,
  };
  const service = createSourceConnectionService({
    access: {
      createPermissionSnapshot: async (request) =>
        ({
          accessChannel: request.accessChannel,
          apiAccessRevision: 1,
          createdAt: now,
          expiresAt: request.expiresAt,
          id: permissionFence.permissionSnapshotId,
          knowledgeSpaceId: request.knowledgeSpaceId,
          memberRevision: 1,
          permissionScopes: [],
          revision: 1,
          role: "editor",
          status: "active",
          subjectId: request.subjectId,
          tenantId: request.tenantId,
          updatedAt: now,
          visibility: "all_members",
        }) as never,
      revalidatePermissionSnapshot: async (request) =>
        ({
          accessChannel: request.expectedAccessChannel,
          id: request.id,
          revision: 1,
          subjectId: request.subjectId,
        }) as never,
    },
    allowDevelopmentLoopbackOAuthRedirects: options.allowDevelopmentLoopbackOAuthRedirects,
    allowedOAuthRedirectUris: ["https://api.example.test/source-oauth/callback"],
    authorization: {
      authorize: async () => ({ accessContext: {}, permissionSnapshot: {} }) as never,
    },
    catalog: createStaticSourceProviderCatalog([
      {
        authKinds: ["api-key"],
        available: true,
        capabilities: ["online-document"],
        configuration: [
          { format: "uri", name: "endpoint", required: true, secret: false, type: "string" },
          { name: "recursive", required: false, secret: false, type: "boolean" },
          { name: "batchSize", required: false, secret: false, type: "integer" },
          { format: "password", name: "apiKey", required: true, secret: true, type: "string" },
        ],
        displayName: "Configured",
        id: "configured-a",
      },
      {
        authKinds: ["oauth2"],
        available: true,
        capabilities: ["online-document"],
        configuration: [],
        displayName: "OAuth",
        id: "oauth-a",
      },
    ]),
    generateConnectionId: () =>
      `00000000-0000-4000-8000-${String(connectionSequence++).padStart(12, "0")}`,
    generateCredentialRef: () =>
      `source-secret:v1:00000000-0000-4000-8000-${String(credentialSequence++).padStart(12, "0")}`,
    generateOAuthTransactionId: () =>
      `00000000-0000-4000-8000-${String(transactionSequence++).padStart(12, "0")}`,
    generatePkceVerifier: options.generatePkceVerifier ?? (() => "v".repeat(64)),
    generateState: options.generateState ?? (() => "s".repeat(32)),
    now: () => now,
    oauth: { get: () => (oauthAvailable ? oauth : undefined) },
    oauthOperationTimeoutMs: options.oauthOperationTimeoutMs,
    repository,
    secrets,
  });
  return {
    oauth,
    repository,
    secrets,
    service,
    setOAuthAvailable: (available: boolean) => {
      oauthAvailable = available;
    },
  };
}

function oauthStartRequest(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    callerKind: "interactive" as const,
    knowledgeSpaceId,
    name: "OAuth source",
    providerId: "oauth-a",
    redirectUri: "https://api.example.test/source-oauth/callback",
    scopes: ["read"],
    subject,
    tenantId,
    ...overrides,
  } as Parameters<ReturnType<typeof serviceHarness>["service"]["startOAuth"]>[0];
}

function refreshRequest(connectionId: string, expectedVersion: number) {
  return {
    callerKind: "interactive" as const,
    connectionId,
    expectedVersion,
    knowledgeSpaceId,
    subject,
    tenantId,
  };
}

async function seedActiveRefreshConnection(
  repository: SourceConnectionRepository,
  secrets: SourceSecretStore,
  credentials: Readonly<Record<string, unknown>>,
) {
  const created = await repository.begin(
    connectionInput(firstConnectionId, now, {
      credentialRef: oldCredentialRef,
      providerId: "oauth-a",
    }),
  );
  await secrets.put({
    credentials,
    knowledgeSpaceId,
    ref: oldCredentialRef,
    sourceId: created.id,
    tenantId,
  });
  return repository.activate({
    connectionId: created.id,
    expectedVersion: 1,
    now,
    permissionFence,
    scopes: [],
  });
}

function sourceRecord(overrides: Partial<Source> = {}): Source {
  return {
    createdAt: now,
    id: "00000000-0000-4000-8000-000000000050",
    knowledgeSpaceId,
    metadata: { preserved: true },
    name: "Connector source",
    permissionScope: ["tenant"],
    status: "active",
    type: "connector",
    updatedAt: now,
    uri: "connector://documents",
    version: 1,
    ...overrides,
  };
}

function memorySecrets(): SourceSecretStore {
  const values = new Map<string, Record<string, unknown>>();
  return {
    delete: async ({ ref }) => {
      values.delete(ref);
    },
    fingerprint: ({ credentials }) => JSON.stringify(credentials),
    get: async ({ ref }) => {
      const credentials = values.get(ref);
      return credentials
        ? {
            credentials: structuredClone(credentials),
            fingerprint: JSON.stringify(credentials),
            ref,
          }
        : null;
    },
    put: async ({ credentials, ref }) => {
      if (!ref) throw new Error("test secret ref is required");
      const cloned = structuredClone(credentials) as Record<string, unknown>;
      values.set(ref, cloned);
      return { credentials: cloned, fingerprint: JSON.stringify(cloned), ref };
    },
  };
}
