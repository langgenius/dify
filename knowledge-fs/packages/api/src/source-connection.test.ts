import { describe, expect, it, vi } from "vitest";

import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import {
  SourceConnectionError,
  type SourceConnectionRepository,
  type SourceOAuthProvider,
  createInMemorySourceConnectionRepository,
  createSourceConnectionService,
} from "./source-connection";
import { createStaticSourceProviderCatalog } from "./source-provider-catalog";
import type { SourceSecretStore } from "./source-secret-store";

const tenantId = "tenant-a";
const knowledgeSpaceId = "space-a";
const subject = { scopes: [], subjectId: "user-a", tenantId };
const permissionFence = {
  accessChannel: "interactive" as const,
  knowledgeSpaceId,
  permissionSnapshotId: "00000000-0000-4000-8000-000000000099",
  permissionSnapshotRevision: 1,
  requestedBySubjectId: subject.subjectId,
  tenantId,
};

describe("source connections", () => {
  it("binds OAuth state to subject/channel, consumes it once, and redacts secret provenance", async () => {
    const repository = createInMemorySourceConnectionRepository();
    const secrets = memorySecrets();
    const oauth: SourceOAuthProvider = {
      authorizationUrl: async ({ state }) => `https://accounts.example.test/auth?state=${state}`,
      exchange: vi.fn(async () => ({ accessToken: "access-a", refreshToken: "refresh-a" })),
      refresh: vi.fn(async () => ({ accessToken: "access-b", refreshToken: "refresh-b" })),
      revoke: vi.fn(async () => undefined),
    };
    const service = serviceFixture({ oauth, repository, secrets });
    const started = await service.startOAuth({
      callerKind: "interactive",
      knowledgeSpaceId,
      name: "Documents",
      providerId: "documents-a",
      redirectUri: "https://api.example.test/source-oauth/callback",
      scopes: ["read"],
      subject,
      tenantId,
    });
    expect(started.authorizationUrl).toContain(`state=${"s".repeat(32)}`);

    await expect(
      service.callback({
        callerKind: "interactive",
        code: "code-a",
        state: "s".repeat(32),
        subject: { ...subject, subjectId: "user-b" },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_STATE_INVALID" });
    const completed = await service.callback({
      callerKind: "interactive",
      code: "code-a",
      state: "s".repeat(32),
      subject,
    });
    expect(completed).not.toHaveProperty("credentialRef");
    expect(completed).not.toHaveProperty("tenantId");
    await expect(
      service.callback({
        callerKind: "interactive",
        code: "code-a",
        state: "s".repeat(32),
        subject,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_STATE_INVALID" });
    expect(oauth.exchange).toHaveBeenCalledTimes(1);
  });

  it("recovers refresh after secret staging and makes the completed retry idempotent", async () => {
    const base = createInMemorySourceConnectionRepository();
    const secrets = memorySecrets();
    const oauth: SourceOAuthProvider = {
      authorizationUrl: async () => "https://accounts.example.test/auth",
      exchange: async () => ({ accessToken: "unused" }),
      refresh: vi.fn(async ({ idempotencyKey }) => ({
        accessToken: `access:${idempotencyKey}`,
        expiresAt: "2030-01-01T00:00:00.000Z",
        refreshToken: "refresh-new",
        scopes: ["read", "write"],
      })),
      revoke: vi.fn(async () => undefined),
    };
    const oldRef = "source-secret:v1:00000000-0000-4000-8000-000000000001";
    const created = await base.begin({
      authKind: "oauth2",
      configuration: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      credentialRef: oldRef,
      id: "00000000-0000-4000-8000-000000000010",
      knowledgeSpaceId,
      name: "Documents",
      permissionFence,
      providerId: "documents-a",
      scopes: ["read"],
      tenantId,
    });
    await secrets.put({
      credentials: { accessToken: "access-old", refreshToken: "refresh-old" },
      knowledgeSpaceId,
      ref: oldRef,
      sourceId: created.id,
      tenantId,
    });
    const active = await base.activate({
      connectionId: created.id,
      expectedVersion: created.version,
      now: created.createdAt,
      permissionFence,
      scopes: ["read"],
    });
    let crashOnce = true;
    const repository: SourceConnectionRepository = {
      ...base,
      rotateCredential: async (input) => {
        if (crashOnce) {
          crashOnce = false;
          throw new Error("simulated crash after staged secret put");
        }
        return base.rotateCredential(input);
      },
    };
    const service = serviceFixture({ oauth, repository, secrets });
    const request = {
      callerKind: "interactive" as const,
      connectionId: active.id,
      expectedVersion: active.version,
      knowledgeSpaceId,
      subject,
      tenantId,
    };
    await expect(service.refresh(request)).rejects.toThrow(/simulated crash/u);
    const recovered = await service.refresh(request);
    expect(recovered.status).toBe("active");
    expect(recovered.version).toBe(active.version + 1);
    expect(oauth.refresh).toHaveBeenCalledTimes(1);
    await expect(service.refresh(request)).resolves.toMatchObject({ version: recovered.version });
    expect(oauth.refresh).toHaveBeenCalledTimes(1);
  });

  it("fails closed when create permission is revoked after the secret write", async () => {
    const repository = createInMemorySourceConnectionRepository();
    const secrets = memorySecrets();
    const service = serviceFixture({
      denyOnRevalidate: true,
      oauth: oauthFixture(),
      repository,
      secrets,
    });
    await expect(
      service.create({
        authKind: "api-key",
        callerKind: "interactive",
        credentials: { apiKey: "secret-a" },
        knowledgeSpaceId,
        name: "Documents",
        providerId: "documents-a",
        subject,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_ACCESS_DENIED" });
    await expect(
      repository.get({
        connectionId: "00000000-0000-4000-8000-000000000020",
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ status: "error" });
  });

  it("does not commit refresh or revoke after permission revocation", async () => {
    const repository = createInMemorySourceConnectionRepository();
    const secrets = memorySecrets();
    const active = await seedActiveOAuth(repository, secrets);
    const oauth = oauthFixture();
    const service = serviceFixture({ denyOnRevalidate: true, oauth, repository, secrets });
    const principal = { callerKind: "interactive" as const, subject };

    await expect(
      service.refresh({
        ...principal,
        connectionId: active.id,
        expectedVersion: active.version,
        knowledgeSpaceId,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_ACCESS_DENIED" });
    expect(oauth.refresh).toHaveBeenCalledTimes(1);
    await expect(
      repository.get({ connectionId: active.id, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({
      credentialRef: active.credentialRef,
      status: "active",
      version: active.version,
    });

    await expect(
      service.revoke({
        ...principal,
        connectionId: active.id,
        expectedVersion: active.version,
        knowledgeSpaceId,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_ACCESS_DENIED" });
    await expect(
      repository.get({ connectionId: active.id, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({
      credentialRef: active.credentialRef,
      status: "active",
      version: active.version,
    });
  });

  it("does not persist OAuth tokens when permission is revoked after provider exchange", async () => {
    const repository = createInMemorySourceConnectionRepository();
    const secrets = memorySecrets();
    const oauth = oauthFixture();
    oauth.exchange = vi.fn(async () => ({
      accessToken: "must-not-persist",
      refreshToken: "refresh-a",
    }));
    const service = serviceFixture({
      denyOnRevalidateAt: 2,
      oauth,
      repository,
      secrets,
    });
    await service.startOAuth({
      callerKind: "interactive",
      knowledgeSpaceId,
      name: "Documents",
      providerId: "documents-a",
      redirectUri: "https://api.example.test/source-oauth/callback",
      scopes: ["read"],
      subject,
      tenantId,
    });

    await expect(
      service.callback({
        callerKind: "interactive",
        code: "code-a",
        state: "s".repeat(32),
        subject,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_OAUTH_CALLBACK_FAILED" });
    expect(oauth.exchange).toHaveBeenCalledTimes(1);
    await expect(
      secrets.get({
        knowledgeSpaceId,
        ref: "source-secret:v1:00000000-0000-4000-8000-000000000031",
        sourceId: "00000000-0000-4000-8000-000000000020",
        tenantId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.get({
        connectionId: "00000000-0000-4000-8000-000000000020",
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ status: "error" });
  });

  it("stores only an opaque Dify credential binding in dify-managed mode", async () => {
    const repository = createInMemorySourceConnectionRepository();
    const service = serviceFixture({
      credentialMode: "dify-managed",
      oauth: oauthFixture(),
      providerConfiguration: [
        { name: "credentialId", required: true, secret: false, type: "string" },
        { name: "datasource", required: true, secret: false, type: "string" },
        { name: "pluginId", required: true, secret: false, type: "string" },
        { name: "provider", required: true, secret: false, type: "string" },
        { name: "providerKind", required: true, secret: false, type: "string" },
      ],
      repository,
    });
    const configuration = {
      credentialId: "dify-credential-1",
      datasource: "notion_datasource",
      pluginId: "langgenius/notion_datasource",
      provider: "notion_datasource",
      providerKind: "online-document",
    };

    const connection = await service.create({
      authKind: "endpoint",
      callerKind: "interactive",
      configuration,
      credentials: {},
      knowledgeSpaceId,
      name: "Dify Notion",
      providerId: "documents-a",
      subject,
      tenantId,
    });

    expect(connection).not.toHaveProperty("credentialRef");
    await expect(
      service.resolve({
        source: {
          connectionId: connection.id,
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000021",
          knowledgeSpaceId,
          metadata: {},
          name: "Source",
          permissionScope: [],
          status: "active",
          type: "connector",
          updatedAt: "2026-01-01T00:00:00.000Z",
          uri: "notion://workspace",
          version: 1,
        },
        tenantId,
      }),
    ).resolves.toMatchObject({ metadata: configuration });
    await expect(
      service.refresh({
        callerKind: "interactive",
        connectionId: connection.id,
        expectedVersion: connection.version,
        knowledgeSpaceId,
        subject,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CONNECTION_MANAGED_BY_DIFY" });
  });
});

function serviceFixture(input: {
  credentialMode?: "dify-managed" | "local";
  denyOnRevalidate?: boolean;
  denyOnRevalidateAt?: number;
  oauth: SourceOAuthProvider;
  providerConfiguration?: readonly {
    format?: "password" | "uri";
    name: string;
    required: boolean;
    secret: boolean;
    type: "boolean" | "integer" | "string";
  }[];
  repository: SourceConnectionRepository;
  secrets?: SourceSecretStore;
}) {
  const snapshots = new Map<string, Record<string, unknown>>();
  let revalidationCount = 0;
  return createSourceConnectionService({
    access: {
      createPermissionSnapshot: async (request) => {
        const snapshot = {
          accessChannel: request.accessChannel,
          apiAccessRevision: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: request.expiresAt,
          id: "00000000-0000-4000-8000-000000000099",
          knowledgeSpaceId: request.knowledgeSpaceId,
          memberRevision: 1,
          permissionScopes: [],
          policyRevision: 1,
          revision: 1,
          role: "editor",
          status: "active",
          subjectId: request.subjectId,
          tenantId: request.tenantId,
          updatedAt: "2026-01-01T00:00:00.000Z",
          visibility: "all_members",
        };
        snapshots.set(snapshot.id, snapshot);
        return snapshot as never;
      },
      revalidatePermissionSnapshot: async (request) => {
        revalidationCount += 1;
        if (
          input.denyOnRevalidate ||
          (input.denyOnRevalidateAt !== undefined && revalidationCount === input.denyOnRevalidateAt)
        ) {
          throw new KnowledgeSpaceAccessError(
            "space_access_permission_snapshot_invalid",
            "permission revoked",
          );
        }
        const snapshot = snapshots.get(request.id);
        if (!snapshot || snapshot.subjectId !== request.subjectId) throw new Error("revoked");
        return snapshot as never;
      },
    },
    allowedOAuthRedirectUris: ["https://api.example.test/source-oauth/callback"],
    authorization: {
      authorize: async (request) =>
        ({
          accessContext: {},
          permissionSnapshot: {
            apiAccessRevision: 1,
            callerKind: request.callerKind,
            candidateGrants: [],
            issuedAt: "2026-01-01T00:00:00.000Z",
            knowledgeSpaceId: request.knowledgeSpaceId,
            memberRevision: 1,
            memberRole: "editor",
            policyRevision: 1,
            subjectId: request.subject.subjectId,
            tenantId: request.subject.tenantId,
          },
        }) as never,
    },
    catalog: createStaticSourceProviderCatalog([
      {
        authKinds:
          input.credentialMode === "dify-managed"
            ? (["endpoint"] as const)
            : (["api-key", "oauth2"] as const),
        available: true,
        capabilities: ["online-document"],
        configuration: input.providerConfiguration ?? [
          { format: "password", name: "apiKey", required: true, secret: true, type: "string" },
        ],
        displayName: "Documents",
        id: "documents-a",
      },
    ]),
    ...(input.credentialMode ? { credentialMode: input.credentialMode } : {}),
    generateConnectionId: () => "00000000-0000-4000-8000-000000000020",
    generateCredentialRef: (() => {
      let sequence = 30;
      return () =>
        `source-secret:v1:00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
    })(),
    generateOAuthTransactionId: () => "00000000-0000-4000-8000-000000000040",
    generatePkceVerifier: () => "v".repeat(64),
    generateState: () => "s".repeat(32),
    now: () => "2026-01-01T00:00:00.000Z",
    oauth: { get: (providerId) => (providerId === "documents-a" ? input.oauth : undefined) },
    repository: input.repository,
    ...(input.secrets ? { secrets: input.secrets } : {}),
  });
}

function oauthFixture(): SourceOAuthProvider & { refresh: ReturnType<typeof vi.fn> } {
  return {
    authorizationUrl: async () => "https://accounts.example.test/auth",
    exchange: async () => ({ accessToken: "access-a", refreshToken: "refresh-a" }),
    refresh: vi.fn(async () => ({ accessToken: "access-b", refreshToken: "refresh-b" })),
    revoke: vi.fn(async () => undefined),
  };
}

async function seedActiveOAuth(repository: SourceConnectionRepository, secrets: SourceSecretStore) {
  const credentialRef = "source-secret:v1:00000000-0000-4000-8000-000000000001";
  const created = await repository.begin({
    authKind: "oauth2",
    configuration: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    credentialRef,
    id: "00000000-0000-4000-8000-000000000010",
    knowledgeSpaceId,
    name: "Documents",
    permissionFence,
    providerId: "documents-a",
    scopes: ["read"],
    tenantId,
  });
  await secrets.put({
    credentials: { accessToken: "access-old", refreshToken: "refresh-old" },
    knowledgeSpaceId,
    ref: credentialRef,
    sourceId: created.id,
    tenantId,
  });
  return repository.activate({
    connectionId: created.id,
    expectedVersion: created.version,
    now: created.createdAt,
    permissionFence,
    scopes: created.scopes,
  });
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
      const prior = values.get(ref);
      if (prior && JSON.stringify(prior) !== JSON.stringify(cloned))
        throw new Error("secret conflict");
      values.set(ref, cloned);
      return { credentials: cloned, fingerprint: JSON.stringify(cloned), ref };
    },
  };
}
