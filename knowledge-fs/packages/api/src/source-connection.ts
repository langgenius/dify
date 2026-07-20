import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Source } from "@knowledge/core";
import type { AuthSubject } from "@knowledge/core";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import type {
  KnowledgeSpaceAccessChannel,
  KnowledgeSpaceAccessService,
  KnowledgeSpaceApiKeyPermissionBinding,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceCallerKind,
  revalidateKnowledgeSpaceDurablePermission,
} from "./knowledge-space-authorization";
import type {
  SourceProviderAuthKind,
  SourceProviderCatalog,
  SourceProviderConfigurationField,
} from "./source-provider-catalog";
import { requireAvailableSourceProvider } from "./source-provider-catalog";
import type { SourceSecretStore } from "./source-secret-store";

export type SourceConnectionStatus = "provisioning" | "active" | "expired" | "error" | "revoked";

export interface SourceConnection {
  readonly authKind: SourceProviderAuthKind;
  readonly configuration: Readonly<Record<string, boolean | number | string>>;
  readonly createdAt: string;
  readonly credentialRef?: string | undefined;
  readonly expiresAt?: string | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly name: string;
  readonly providerId: string;
  readonly scopes: readonly string[];
  readonly status: SourceConnectionStatus;
  readonly tenantId: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface PublicSourceConnection
  extends Omit<SourceConnection, "credentialRef" | "lastErrorCode" | "tenantId"> {
  readonly errorCode?: string | undefined;
}

export interface SourceConnectionPage<T = SourceConnection> {
  readonly items: readonly T[];
  readonly nextCursor?: string | undefined;
}

export interface SourceOAuthTransaction {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly apiKeyId?: string | undefined;
  readonly connectionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly redirectUri: string;
  readonly requestedBySubjectId: string;
  readonly stateHash: string;
  readonly status: "pending" | "exchanging" | "completed" | "failed";
  readonly tenantId: string;
  readonly verifierRef: string;
}

export interface SourceConnectionSecretRef {
  readonly connectionId: string;
  readonly credentialRef: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly providerId: string;
  readonly purpose: "connection-credential" | "oauth-pkce";
  readonly remoteRevokeRequired: boolean;
  readonly rowVersion: number;
  readonly state: "staged" | "active" | "retired" | "deleting" | "deleted";
  readonly tenantId: string;
  readonly workerId?: string | undefined;
}

/** Durable caller provenance revalidated inside the final database mutation transaction. */
export interface SourceConnectionPermissionFence {
  readonly accessChannel: KnowledgeSpaceAccessChannel;
  readonly knowledgeSpaceId: string;
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly requestedBySubjectId: string;
  readonly tenantId: string;
}

export interface SourceConnectionRepository {
  activate(input: {
    readonly connectionId: string;
    readonly expectedVersion: number;
    readonly expiresAt?: string | undefined;
    readonly now: string;
    readonly permissionFence: SourceConnectionPermissionFence;
    readonly scopes: readonly string[];
  }): Promise<SourceConnection>;
  begin(
    input: Omit<SourceConnection, "createdAt" | "status" | "updatedAt" | "version"> & {
      readonly createdAt: string;
      readonly permissionFence: SourceConnectionPermissionFence;
    },
  ): Promise<SourceConnection>;
  beginOAuth(input: SourceOAuthTransaction): Promise<void>;
  claimOAuthCallback(input: {
    readonly accessChannel: KnowledgeSpaceAccessChannel;
    readonly apiKeyId?: string | undefined;
    readonly now: string;
    readonly requestedBySubjectId: string;
    readonly stateHash: string;
    readonly tenantId: string;
  }): Promise<SourceOAuthTransaction | null>;
  completeOAuth(input: {
    readonly connectionId: string;
    readonly credentialRef: string;
    readonly expectedVersion: number;
    readonly expiresAt?: string | undefined;
    readonly now: string;
    readonly scopes: readonly string[];
    readonly transactionId: string;
  }): Promise<SourceConnection>;
  claimSecretCleanup(input: {
    readonly leaseExpiresAt: string;
    readonly limit: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<readonly SourceConnectionSecretRef[]>;
  completeSecretCleanup(input: {
    readonly leaseToken: string;
    readonly now: string;
    readonly refId: string;
    readonly rowVersion: number;
    readonly workerId: string;
  }): Promise<void>;
  failSecretCleanup(input: {
    readonly errorCode: string;
    readonly leaseToken: string;
    readonly nextAttemptAt: string;
    readonly now: string;
    readonly refId: string;
    readonly rowVersion: number;
    readonly workerId: string;
  }): Promise<void>;
  fail(input: {
    readonly connectionId: string;
    readonly errorCode: string;
    readonly expectedVersion: number;
    readonly now: string;
  }): Promise<SourceConnection>;
  get(input: {
    readonly connectionId: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  }): Promise<SourceConnection | null>;
  list(input: {
    readonly cursor?: string | undefined;
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly tenantId: string;
  }): Promise<SourceConnectionPage>;
  revoke(input: {
    readonly connectionId: string;
    readonly expectedVersion: number;
    readonly now: string;
    readonly permissionFence: SourceConnectionPermissionFence;
  }): Promise<SourceConnection>;
  reserveCredential(input: {
    readonly connectionId: string;
    readonly credentialRef: string;
    readonly expectedVersion: number;
    readonly now: string;
    readonly permissionFence: SourceConnectionPermissionFence;
    readonly recoverAfter: string;
  }): Promise<void>;
  rotateCredential(input: {
    readonly connectionId: string;
    readonly expectedCredentialRef: string;
    readonly expectedVersion: number;
    readonly expiresAt?: string | undefined;
    readonly newCredentialRef: string;
    readonly now: string;
    readonly permissionFence: SourceConnectionPermissionFence;
    readonly scopes: readonly string[];
  }): Promise<SourceConnection>;
}

export interface SourceOAuthTokens {
  readonly accessToken: string;
  readonly expiresAt?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly scopes?: readonly string[] | undefined;
  readonly tokenType?: string | undefined;
}

export interface SourceOAuthProvider {
  authorizationUrl(input: {
    readonly codeChallenge: string;
    readonly redirectUri: string;
    readonly scopes: readonly string[];
    readonly state: string;
  }): Promise<string>;
  exchange(input: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
    readonly signal?: AbortSignal | undefined;
  }): Promise<SourceOAuthTokens>;
  refresh(input: {
    readonly idempotencyKey: string;
    readonly refreshToken: string;
    readonly signal?: AbortSignal | undefined;
  }): Promise<SourceOAuthTokens>;
  revoke(input: {
    readonly accessToken?: string;
    readonly refreshToken?: string;
    readonly signal?: AbortSignal | undefined;
  }): Promise<void>;
}

export interface SourceOAuthProviderRegistry {
  get(providerId: string): SourceOAuthProvider | undefined;
}

export class SourceConnectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceConnectionError";
  }
}

export interface SourceConnectionService {
  callback(input: {
    readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
    readonly callerKind: KnowledgeSpaceCallerKind;
    readonly code: string;
    readonly state: string;
    readonly subject: AuthSubject;
  }): Promise<PublicSourceConnection>;
  create(input: {
    readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
    readonly authKind: Exclude<SourceProviderAuthKind, "oauth2">;
    readonly callerKind: KnowledgeSpaceCallerKind;
    readonly configuration?: Readonly<Record<string, boolean | number | string>> | undefined;
    readonly credentials: Readonly<Record<string, unknown>>;
    readonly knowledgeSpaceId: string;
    readonly name: string;
    readonly providerId: string;
    readonly tenantId: string;
    readonly subject: AuthSubject;
  }): Promise<PublicSourceConnection>;
  get(input: {
    readonly connectionId: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  }): Promise<PublicSourceConnection | null>;
  list(input: {
    readonly cursor?: string | undefined;
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly tenantId: string;
  }): Promise<SourceConnectionPage<PublicSourceConnection>>;
  refresh(input: {
    readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
    readonly callerKind: KnowledgeSpaceCallerKind;
    readonly connectionId: string;
    readonly expectedVersion: number;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
    readonly subject: AuthSubject;
  }): Promise<PublicSourceConnection>;
  /** Resolves an active connection into an ephemeral connector-only source clone. */
  resolve(input: {
    readonly source: Source;
    readonly tenantId: string;
  }): Promise<Source>;
  revoke(input: {
    readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
    readonly callerKind: KnowledgeSpaceCallerKind;
    readonly connectionId: string;
    readonly expectedVersion: number;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
    readonly subject: AuthSubject;
  }): Promise<PublicSourceConnection>;
  startOAuth(input: {
    readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
    readonly callerKind: KnowledgeSpaceCallerKind;
    readonly configuration?: Readonly<Record<string, boolean | number | string>> | undefined;
    readonly knowledgeSpaceId: string;
    readonly name: string;
    readonly providerId: string;
    readonly redirectUri: string;
    readonly scopes: readonly string[];
    readonly tenantId: string;
    readonly subject: AuthSubject;
  }): Promise<{ readonly authorizationUrl: string; readonly connection: PublicSourceConnection }>;
}

export function createSourceConnectionService(input: {
  readonly access: Pick<
    KnowledgeSpaceAccessService,
    "createPermissionSnapshot" | "revalidatePermissionSnapshot"
  >;
  readonly allowDevelopmentLoopbackOAuthRedirects?: boolean | undefined;
  readonly allowedOAuthRedirectUris?: readonly string[] | undefined;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly catalog: SourceProviderCatalog;
  readonly generateConnectionId?: (() => string) | undefined;
  readonly generateCredentialRef?: (() => string) | undefined;
  readonly generateOAuthTransactionId?: (() => string) | undefined;
  readonly generatePkceVerifier?: (() => string) | undefined;
  readonly generateState?: (() => string) | undefined;
  readonly now?: (() => string) | undefined;
  readonly oauth: SourceOAuthProviderRegistry;
  readonly oauthStateTtlMs?: number | undefined;
  readonly oauthOperationTimeoutMs?: number | undefined;
  readonly mutationPermissionTtlMs?: number | undefined;
  readonly repository: SourceConnectionRepository;
  readonly secrets: SourceSecretStore;
}): SourceConnectionService {
  const generateConnectionId = input.generateConnectionId ?? randomUUID;
  const generateCredentialRef =
    input.generateCredentialRef ?? (() => `source-secret:v1:${randomUUID()}`);
  const generateOAuthTransactionId = input.generateOAuthTransactionId ?? randomUUID;
  const generatePkceVerifier = input.generatePkceVerifier ?? (() => randomToken(64));
  const generateState = input.generateState ?? (() => randomToken(32));
  const now = input.now ?? (() => new Date().toISOString());
  const oauthStateTtlMs = input.oauthStateTtlMs ?? 10 * 60_000;
  const oauthOperationTimeoutMs = input.oauthOperationTimeoutMs ?? 2 * 60_000;
  const mutationPermissionTtlMs = input.mutationPermissionTtlMs ?? 10 * 60_000;
  const allowedOAuthRedirectUris = new Set(
    (input.allowedOAuthRedirectUris ?? []).map((value) => normalizeRedirectUri(value)),
  );
  const allowDevelopmentLoopbackOAuthRedirects =
    input.allowDevelopmentLoopbackOAuthRedirects ?? false;

  const scope = (connection: SourceConnection) => ({
    knowledgeSpaceId: connection.knowledgeSpaceId,
    sourceId: connection.id,
    tenantId: connection.tenantId,
  });

  const getRequired = async (request: {
    connectionId: string;
    knowledgeSpaceId: string;
    tenantId: string;
  }) => {
    const connection = await input.repository.get(request);
    if (!connection)
      throw new SourceConnectionError("SOURCE_CONNECTION_NOT_FOUND", "Source connection not found");
    return connection;
  };

  const issueMutationPermission = async (request: {
    readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
    readonly callerKind: KnowledgeSpaceCallerKind;
    readonly knowledgeSpaceId: string;
    readonly subject: AuthSubject;
    readonly tenantId: string;
  }) => {
    if (request.subject.tenantId !== request.tenantId) {
      throw new SourceConnectionError(
        "SOURCE_CONNECTION_SCOPE_MISMATCH",
        "Source connection tenant scope is invalid",
      );
    }
    const issuedAt = now();
    return issueKnowledgeSpaceDurablePermission({
      access: input.access,
      ...(request.apiKey ? { apiKey: request.apiKey } : {}),
      authorization: input.authorization,
      callerKind: request.callerKind,
      expiresAt: new Date(Date.parse(issuedAt) + mutationPermissionTtlMs).toISOString(),
      knowledgeSpaceId: request.knowledgeSpaceId,
      requiredAccess: "write",
      subject: request.subject,
    });
  };

  const revalidateMutationPermission = async (
    request: {
      readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
      readonly callerKind: KnowledgeSpaceCallerKind;
      readonly knowledgeSpaceId: string;
      readonly subject: AuthSubject;
    },
    permission: KnowledgeSpacePermissionSnapshot,
  ) => {
    await revalidateKnowledgeSpaceDurablePermission({
      access: input.access,
      callerKind: request.callerKind,
      currentApiKeyId: request.apiKey?.id,
      knowledgeSpaceId: request.knowledgeSpaceId,
      permissionSnapshot: {
        accessChannel: permission.accessChannel,
        id: permission.id,
        revision: permission.revision,
      },
      subject: request.subject,
    });
    await input.authorization.authorize({
      callerKind: request.callerKind,
      knowledgeSpaceId: request.knowledgeSpaceId,
      requiredAccess: "write",
      subject: request.subject,
    });
  };

  const permissionFence = (
    permission: KnowledgeSpacePermissionSnapshot,
  ): SourceConnectionPermissionFence => ({
    accessChannel: permission.accessChannel,
    knowledgeSpaceId: permission.knowledgeSpaceId,
    permissionSnapshotId: permission.id,
    permissionSnapshotRevision: permission.revision,
    requestedBySubjectId: permission.subjectId,
    tenantId: permission.tenantId,
  });

  return {
    create: async (request) => {
      const provider = await requireAvailableSourceProvider(input.catalog, request.providerId);
      if (!provider.authKinds.includes(request.authKind)) {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_AUTH_UNSUPPORTED",
          "Provider does not support the requested authentication kind",
        );
      }
      validatePublicConfiguration(provider.configuration, request.configuration ?? {});
      validateCredentials(provider.configuration, request.credentials);
      const permission = await issueMutationPermission(request);
      const createdAt = now();
      const connection = await input.repository.begin({
        authKind: request.authKind,
        configuration: { ...(request.configuration ?? {}) },
        createdAt,
        credentialRef: generateCredentialRef(),
        id: generateConnectionId(),
        knowledgeSpaceId: request.knowledgeSpaceId,
        name: bounded(request.name, "connection name", 160),
        permissionFence: permissionFence(permission),
        providerId: provider.id,
        scopes: [],
        tenantId: request.tenantId,
      });
      try {
        await input.secrets.put({
          ...scope(connection),
          credentials: request.credentials,
          ref: requiredCredentialRef(connection),
        });
        await revalidateMutationPermission(request, permission);
        return toPublicSourceConnection(
          await input.repository.activate({
            connectionId: connection.id,
            expectedVersion: connection.version,
            now: now(),
            permissionFence: permissionFence(permission),
            scopes: [],
          }),
        );
      } catch (error) {
        await input.repository
          .fail({
            connectionId: connection.id,
            errorCode: safeConnectionErrorCode(error),
            expectedVersion: connection.version,
            now: now(),
          })
          .catch(() => undefined);
        if (error instanceof KnowledgeSpaceAuthorizationError) throw error;
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_SECRET_PERSIST_FAILED",
          "Source connection could not be activated",
        );
      }
    },
    startOAuth: async (request) => {
      const provider = await requireAvailableSourceProvider(input.catalog, request.providerId);
      if (!provider.authKinds.includes("oauth2")) {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_AUTH_UNSUPPORTED",
          "Provider does not support OAuth",
        );
      }
      validatePublicConfiguration(provider.configuration, request.configuration ?? {});
      const oauth = input.oauth.get(provider.id);
      if (!oauth) {
        throw new SourceConnectionError(
          "SOURCE_OAUTH_PROVIDER_UNAVAILABLE",
          "OAuth provider is unavailable",
        );
      }
      const createdAt = now();
      const expiresAt = new Date(Date.parse(createdAt) + oauthStateTtlMs).toISOString();
      const permission = await issueKnowledgeSpaceDurablePermission({
        access: input.access,
        ...(request.apiKey ? { apiKey: request.apiKey } : {}),
        authorization: input.authorization,
        callerKind: request.callerKind,
        expiresAt,
        knowledgeSpaceId: request.knowledgeSpaceId,
        requiredAccess: "write",
        subject: request.subject,
      });
      const connection = await input.repository.begin({
        authKind: "oauth2",
        configuration: { ...(request.configuration ?? {}) },
        createdAt,
        id: generateConnectionId(),
        knowledgeSpaceId: request.knowledgeSpaceId,
        name: bounded(request.name, "connection name", 160),
        permissionFence: permissionFence(permission),
        providerId: provider.id,
        scopes: normalizeScopes(request.scopes),
        tenantId: request.tenantId,
      });
      const state = generateState();
      const verifier = generatePkceVerifier();
      assertPkceToken(verifier, "PKCE verifier", 43, 128);
      assertPkceToken(state, "OAuth state", 32, 256);
      const verifierRef = generateCredentialRef();
      const transaction: SourceOAuthTransaction = {
        accessChannel: permission.accessChannel,
        ...(permission.apiKeyId ? { apiKeyId: permission.apiKeyId } : {}),
        connectionId: connection.id,
        createdAt,
        expiresAt,
        id: generateOAuthTransactionId(),
        knowledgeSpaceId: connection.knowledgeSpaceId,
        permissionSnapshotId: permission.id,
        permissionSnapshotRevision: permission.revision,
        redirectUri: validateRedirectUri(
          request.redirectUri,
          allowedOAuthRedirectUris,
          allowDevelopmentLoopbackOAuthRedirects,
        ),
        requestedBySubjectId: request.subject.subjectId,
        stateHash: hashToken(state),
        status: "pending",
        tenantId: connection.tenantId,
        verifierRef,
      };
      await input.repository.beginOAuth(transaction);
      try {
        await input.secrets.put({
          ...scope(connection),
          credentials: { pkceVerifier: verifier },
          ref: verifierRef,
        });
        const authorizationUrl = await oauth.authorizationUrl({
          codeChallenge: pkceChallenge(verifier),
          redirectUri: transaction.redirectUri,
          scopes: connection.scopes,
          state,
        });
        return { authorizationUrl, connection: toPublicSourceConnection(connection) };
      } catch (error) {
        await input.repository
          .fail({
            connectionId: connection.id,
            errorCode: safeConnectionErrorCode(error),
            expectedVersion: connection.version,
            now: now(),
          })
          .catch(() => undefined);
        throw new SourceConnectionError(
          "SOURCE_OAUTH_START_FAILED",
          "OAuth authorization could not be started",
        );
      }
    },
    callback: async ({ apiKey, callerKind, code, state, subject }) => {
      const timestamp = now();
      const transaction = await input.repository.claimOAuthCallback({
        accessChannel: callerKind === "api_key" ? "service_api" : callerKind,
        ...(apiKey ? { apiKeyId: apiKey.id } : {}),
        now: timestamp,
        requestedBySubjectId: subject.subjectId,
        stateHash: hashToken(assertPkceToken(state, "OAuth state", 32, 256)),
        tenantId: subject.tenantId,
      });
      if (!transaction) {
        throw new SourceConnectionError(
          "SOURCE_OAUTH_STATE_INVALID",
          "OAuth state is invalid, expired, or already consumed",
        );
      }
      const connection = await getRequired({
        connectionId: transaction.connectionId,
        knowledgeSpaceId: transaction.knowledgeSpaceId,
        tenantId: transaction.tenantId,
      });
      const revalidate = async () => {
        await revalidateKnowledgeSpaceDurablePermission({
          access: input.access,
          callerKind,
          currentApiKeyId: apiKey?.id,
          knowledgeSpaceId: transaction.knowledgeSpaceId,
          permissionSnapshot: {
            accessChannel: transaction.accessChannel,
            id: transaction.permissionSnapshotId,
            revision: transaction.permissionSnapshotRevision,
          },
          subject,
        });
        await input.authorization.authorize({
          callerKind,
          knowledgeSpaceId: transaction.knowledgeSpaceId,
          requiredAccess: "write",
          subject,
        });
      };
      await revalidate();
      const oauth = input.oauth.get(connection.providerId);
      try {
        if (!oauth) {
          throw new SourceConnectionError(
            "SOURCE_OAUTH_PROVIDER_UNAVAILABLE",
            "OAuth provider is unavailable",
          );
        }
        const verifierSecret = await input.secrets.get({
          ...scope(connection),
          ref: transaction.verifierRef,
        });
        const verifier = verifierSecret?.credentials.pkceVerifier;
        if (typeof verifier !== "string") {
          throw new SourceConnectionError(
            "SOURCE_OAUTH_PKCE_UNAVAILABLE",
            "OAuth PKCE verifier is unavailable",
          );
        }
        const credentialRef = generateCredentialRef();
        await input.repository.reserveCredential({
          connectionId: connection.id,
          credentialRef,
          expectedVersion: connection.version,
          now: timestamp,
          permissionFence: {
            accessChannel: transaction.accessChannel,
            knowledgeSpaceId: transaction.knowledgeSpaceId,
            permissionSnapshotId: transaction.permissionSnapshotId,
            permissionSnapshotRevision: transaction.permissionSnapshotRevision,
            requestedBySubjectId: transaction.requestedBySubjectId,
            tenantId: transaction.tenantId,
          },
          recoverAfter: new Date(Date.parse(timestamp) + 5 * 60_000).toISOString(),
        });
        const tokens = await boundedOAuthOperation(oauthOperationTimeoutMs, (signal) =>
          oauth.exchange({
            code: bounded(code, "authorization code", 8192),
            codeVerifier: verifier,
            redirectUri: transaction.redirectUri,
            signal,
          }),
        );
        await revalidate();
        await input.secrets.put({
          ...scope(connection),
          credentials: tokenCredentials(tokens),
          ref: credentialRef,
        });
        const activated = await input.repository.completeOAuth({
          connectionId: connection.id,
          credentialRef,
          expectedVersion: connection.version,
          ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
          now: timestamp,
          scopes: normalizeScopes(tokens.scopes ?? connection.scopes),
          transactionId: transaction.id,
        });
        return toPublicSourceConnection(activated);
      } catch (error) {
        await input.repository
          .fail({
            connectionId: connection.id,
            errorCode: safeConnectionErrorCode(error),
            expectedVersion: connection.version,
            now: timestamp,
          })
          .catch(() => undefined);
        throw error instanceof SourceConnectionError
          ? error
          : new SourceConnectionError(
              "SOURCE_OAUTH_CALLBACK_FAILED",
              "OAuth callback could not be completed",
            );
      }
    },
    get: async (request) => {
      const connection = await input.repository.get(request);
      return connection ? toPublicSourceConnection(connection) : null;
    },
    list: async (request) => {
      const page = await input.repository.list(request);
      return {
        items: page.items.map(toPublicSourceConnection),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
    refresh: async (request) => {
      const permission = await issueMutationPermission(request);
      const connection = await getRequired(request);
      const newRef = deterministicRefreshCredentialRef(connection.id, request.expectedVersion);
      if (
        connection.version === request.expectedVersion + 1 &&
        connection.credentialRef === newRef &&
        connection.status === "active"
      ) {
        return toPublicSourceConnection(connection);
      }
      if (connection.version !== request.expectedVersion || connection.status === "revoked") {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_VERSION_CONFLICT",
          "Source connection changed concurrently",
        );
      }
      const oldRef = requiredCredentialRef(connection);
      const secret = await input.secrets.get({ ...scope(connection), ref: oldRef });
      const refreshToken = secret?.credentials.refreshToken;
      if (typeof refreshToken !== "string") {
        throw new SourceConnectionError(
          "SOURCE_OAUTH_REFRESH_UNAVAILABLE",
          "OAuth refresh token is unavailable",
        );
      }
      const oauth = input.oauth.get(connection.providerId);
      if (!oauth)
        throw new SourceConnectionError(
          "SOURCE_OAUTH_PROVIDER_UNAVAILABLE",
          "OAuth provider is unavailable",
        );
      const refreshNow = now();
      await input.repository.reserveCredential({
        connectionId: connection.id,
        credentialRef: newRef,
        expectedVersion: connection.version,
        now: refreshNow,
        permissionFence: permissionFence(permission),
        // The staged ref is the durable refresh operation. Keep it well beyond an HTTP retry
        // window so a restarted instance can promote an already-written rotated token.
        recoverAfter: new Date(Date.parse(refreshNow) + 7 * 24 * 60 * 60_000).toISOString(),
      });
      const staged = await input.secrets.get({ ...scope(connection), ref: newRef });
      let credentials = staged?.credentials;
      if (!credentials) {
        const tokens = await boundedOAuthOperation(oauthOperationTimeoutMs, (signal) =>
          oauth.refresh({
            idempotencyKey: `source-refresh:${connection.id}:${request.expectedVersion}`,
            refreshToken,
            signal,
          }),
        );
        credentials = tokenCredentials(tokens, refreshToken);
        await input.secrets.put({
          ...scope(connection),
          credentials,
          ref: newRef,
        });
      }
      const recoveredExpiresAt = optionalCredentialString(credentials, "expiresAt");
      const recoveredScopes = credentialScopes(credentials, connection.scopes);
      await revalidateMutationPermission(request, permission);
      const rotated = await input.repository.rotateCredential({
        connectionId: connection.id,
        expectedCredentialRef: oldRef,
        expectedVersion: connection.version,
        ...(recoveredExpiresAt ? { expiresAt: recoveredExpiresAt } : {}),
        newCredentialRef: newRef,
        now: refreshNow,
        permissionFence: permissionFence(permission),
        scopes: recoveredScopes,
      });
      return toPublicSourceConnection(rotated);
    },
    resolve: async ({ source, tenantId }) => {
      if (!source.connectionId) return source;
      const connection = await getRequired({
        connectionId: source.connectionId,
        knowledgeSpaceId: source.knowledgeSpaceId,
        tenantId,
      });
      if (connection.status !== "active" || !connection.credentialRef) {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_CREDENTIAL_UNAVAILABLE",
          "Source connection is not active",
        );
      }
      const stored = await input.secrets.get({
        knowledgeSpaceId: connection.knowledgeSpaceId,
        ref: connection.credentialRef,
        sourceId: connection.id,
        tenantId: connection.tenantId,
      });
      if (!stored) {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_CREDENTIAL_UNAVAILABLE",
          "Source connection credentials are unavailable",
        );
      }
      return {
        ...source,
        metadata: {
          ...source.metadata,
          ...connection.configuration,
          credentials: JSON.parse(JSON.stringify(stored.credentials)) as Record<string, unknown>,
        },
      };
    },
    revoke: async (request) => {
      const permission = await issueMutationPermission(request);
      const connection = await getRequired(request);
      if (connection.status === "revoked") return toPublicSourceConnection(connection);
      if (connection.version !== request.expectedVersion) {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_VERSION_CONFLICT",
          "Source connection changed concurrently",
        );
      }
      await revalidateMutationPermission(request, permission);
      const revoked = await input.repository.revoke({
        connectionId: connection.id,
        expectedVersion: connection.version,
        now: now(),
        permissionFence: permissionFence(permission),
      });
      return toPublicSourceConnection(revoked);
    },
  };
}

export function createInMemorySourceConnectionRepository(): SourceConnectionRepository {
  const connections = new Map<string, SourceConnection>();
  const transactions = new Map<string, SourceOAuthTransaction>();
  const secretRefs = new Map<
    string,
    SourceConnectionSecretRef & {
      readonly nextAttemptAt?: string | undefined;
      readonly recoverAfter: string;
    }
  >();
  const idempotentScope = (connection: SourceConnection) =>
    `${connection.tenantId}\0${connection.knowledgeSpaceId}\0${connection.id}`;

  const requiredConnection = (id: string) => {
    const value = connections.get(id);
    if (!value)
      throw new SourceConnectionError("SOURCE_CONNECTION_NOT_FOUND", "Source connection not found");
    return value;
  };
  const replace = (current: SourceConnection, patch: Partial<SourceConnection>) => {
    const next = cloneConnection({ ...current, ...patch, version: current.version + 1 });
    connections.set(current.id, next);
    return cloneConnection(next);
  };
  const assertVersion = (connection: SourceConnection, expectedVersion: number) => {
    if (connection.version !== expectedVersion) {
      throw new SourceConnectionError(
        "SOURCE_CONNECTION_VERSION_CONFLICT",
        "Source connection changed concurrently",
      );
    }
  };

  return {
    begin: async ({ permissionFence: _permissionFence, ...raw }) => {
      if (connections.has(raw.id))
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_ID_CONFLICT",
          "Source connection id exists",
        );
      const connection: SourceConnection = cloneConnection({
        ...raw,
        status: "provisioning",
        updatedAt: raw.createdAt,
        version: 1,
      });
      connections.set(connection.id, connection);
      if (connection.credentialRef) {
        secretRefs.set(connection.credentialRef, {
          connectionId: connection.id,
          credentialRef: connection.credentialRef,
          id: connection.credentialRef,
          knowledgeSpaceId: connection.knowledgeSpaceId,
          providerId: connection.providerId,
          purpose: "connection-credential",
          recoverAfter: new Date(Date.parse(connection.createdAt) + 5 * 60_000).toISOString(),
          remoteRevokeRequired: false,
          rowVersion: 1,
          state: "staged",
          tenantId: connection.tenantId,
        });
      }
      return cloneConnection(connection);
    },
    activate: async ({ connectionId, expectedVersion, expiresAt, now, scopes }) => {
      const current = requiredConnection(connectionId);
      assertVersion(current, expectedVersion);
      if (current.credentialRef) {
        const lifecycle = secretRefs.get(current.credentialRef);
        if (!lifecycle || (lifecycle.state !== "staged" && lifecycle.state !== "active")) {
          throw new SourceConnectionError(
            "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT",
            "Connection credential has no activatable lifecycle reservation",
          );
        }
        secretRefs.set(lifecycle.id, {
          ...lifecycle,
          rowVersion: lifecycle.rowVersion + 1,
          state: "active",
        });
      }
      return replace(current, {
        ...(expiresAt ? { expiresAt } : {}),
        lastErrorCode: undefined,
        scopes: [...scopes],
        status: "active",
        updatedAt: now,
      });
    },
    beginOAuth: async (transaction) => {
      if (transactions.has(transaction.id))
        throw new SourceConnectionError("SOURCE_OAUTH_ID_CONFLICT", "OAuth transaction id exists");
      if (
        Array.from(transactions.values()).some((item) => item.stateHash === transaction.stateHash)
      ) {
        throw new SourceConnectionError(
          "SOURCE_OAUTH_STATE_CONFLICT",
          "OAuth state already exists",
        );
      }
      const connection = requiredConnection(transaction.connectionId);
      if (
        idempotentScope(connection) !==
        `${transaction.tenantId}\0${transaction.knowledgeSpaceId}\0${transaction.connectionId}`
      ) {
        throw new SourceConnectionError(
          "SOURCE_OAUTH_SCOPE_MISMATCH",
          "OAuth transaction scope mismatch",
        );
      }
      transactions.set(transaction.id, { ...transaction });
      secretRefs.set(transaction.verifierRef, {
        connectionId: connection.id,
        credentialRef: transaction.verifierRef,
        id: transaction.verifierRef,
        knowledgeSpaceId: connection.knowledgeSpaceId,
        providerId: connection.providerId,
        purpose: "oauth-pkce",
        recoverAfter: transaction.expiresAt,
        remoteRevokeRequired: false,
        rowVersion: 1,
        state: "staged",
        tenantId: connection.tenantId,
      });
    },
    claimOAuthCallback: async ({
      accessChannel,
      apiKeyId,
      now,
      requestedBySubjectId,
      stateHash,
      tenantId,
    }) => {
      const transaction = Array.from(transactions.values()).find(
        (item) =>
          item.stateHash === stateHash &&
          item.tenantId === tenantId &&
          item.requestedBySubjectId === requestedBySubjectId &&
          item.accessChannel === accessChannel &&
          item.apiKeyId === apiKeyId &&
          item.status === "pending" &&
          Date.parse(item.expiresAt) > Date.parse(now),
      );
      if (!transaction) return null;
      const claimed = { ...transaction, status: "exchanging" as const };
      transactions.set(claimed.id, claimed);
      const verifier = secretRefs.get(transaction.verifierRef);
      if (verifier?.state === "staged") {
        secretRefs.set(verifier.id, {
          ...verifier,
          recoverAfter: new Date(Date.parse(now) + 5 * 60_000).toISOString(),
        });
      }
      return { ...claimed };
    },
    completeOAuth: async ({
      connectionId,
      credentialRef,
      expectedVersion,
      expiresAt,
      now,
      scopes,
      transactionId,
    }) => {
      const current = transactions.get(transactionId);
      const connection = requiredConnection(connectionId);
      assertVersion(connection, expectedVersion);
      if (!current || current.status !== "exchanging" || current.connectionId !== connectionId) {
        throw new SourceConnectionError(
          "SOURCE_OAUTH_STATE_CONFLICT",
          "OAuth transaction is not exchanging",
        );
      }
      const credential = secretRefs.get(credentialRef);
      if (
        !credential ||
        credential.connectionId !== connection.id ||
        credential.purpose !== "connection-credential" ||
        credential.state !== "staged"
      ) {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT",
          "OAuth credential has no activatable lifecycle reservation",
        );
      }
      transactions.set(transactionId, { ...current, status: "completed" });
      const lifecycle = secretRefs.get(current.verifierRef);
      if (lifecycle && lifecycle.state !== "deleted") {
        secretRefs.set(lifecycle.id, {
          ...lifecycle,
          recoverAfter: new Date(0).toISOString(),
          rowVersion: lifecycle.rowVersion + 1,
          state: "retired",
        });
      }
      secretRefs.set(credential.id, {
        ...credential,
        rowVersion: credential.rowVersion + 1,
        state: "active",
      });
      return replace(connection, {
        credentialRef,
        ...(expiresAt ? { expiresAt } : {}),
        lastErrorCode: undefined,
        scopes: [...scopes],
        status: "active",
        updatedAt: now,
      });
    },
    fail: async ({ connectionId, errorCode, expectedVersion, now }) => {
      const current = requiredConnection(connectionId);
      assertVersion(current, expectedVersion);
      for (const lifecycle of secretRefs.values()) {
        if (lifecycle.connectionId === connectionId && lifecycle.state === "staged") {
          secretRefs.set(lifecycle.id, {
            ...lifecycle,
            recoverAfter: now,
            rowVersion: lifecycle.rowVersion + 1,
            state: "retired",
          });
        }
      }
      return replace(current, { lastErrorCode: errorCode, status: "error", updatedAt: now });
    },
    get: async ({ connectionId, knowledgeSpaceId, tenantId }) => {
      const connection = connections.get(connectionId);
      return connection?.knowledgeSpaceId === knowledgeSpaceId && connection.tenantId === tenantId
        ? cloneConnection(connection)
        : null;
    },
    list: async ({ cursor, knowledgeSpaceId, limit, tenantId }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_LIST_LIMIT_INVALID",
          "Source connection list limit must be 1-200",
        );
      }
      const after = cursor ? decodeConnectionCursor(cursor) : undefined;
      const values = Array.from(connections.values())
        .filter((item) => item.knowledgeSpaceId === knowledgeSpaceId && item.tenantId === tenantId)
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        )
        .filter(
          (item) =>
            !after ||
            item.createdAt > after.createdAt ||
            (item.createdAt === after.createdAt && item.id > after.id),
        );
      const page = values.slice(0, limit);
      const next = values.length > limit ? page.at(-1) : undefined;
      return {
        items: page.map(cloneConnection),
        ...(next ? { nextCursor: encodeConnectionCursor(next) } : {}),
      };
    },
    revoke: async ({ connectionId, expectedVersion, now }) => {
      const current = requiredConnection(connectionId);
      if (current.status === "revoked") return cloneConnection(current);
      assertVersion(current, expectedVersion);
      if (current.credentialRef) {
        const lifecycle = secretRefs.get(current.credentialRef);
        if (lifecycle) {
          secretRefs.set(lifecycle.id, {
            ...lifecycle,
            recoverAfter: now,
            remoteRevokeRequired: current.authKind === "oauth2",
            rowVersion: lifecycle.rowVersion + 1,
            state: "retired",
          });
        }
      }
      return replace(current, {
        credentialRef: undefined,
        expiresAt: undefined,
        status: "revoked",
        updatedAt: now,
      });
    },
    reserveCredential: async ({
      connectionId,
      credentialRef,
      expectedVersion,
      now,
      recoverAfter,
    }) => {
      const connection = requiredConnection(connectionId);
      assertVersion(connection, expectedVersion);
      const prior = secretRefs.get(credentialRef);
      if (prior) {
        if (prior.connectionId !== connectionId || prior.purpose !== "connection-credential") {
          throw new SourceConnectionError(
            "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT",
            "Credential reservation scope mismatch",
          );
        }
        return;
      }
      secretRefs.set(credentialRef, {
        connectionId,
        credentialRef,
        id: credentialRef,
        knowledgeSpaceId: connection.knowledgeSpaceId,
        providerId: connection.providerId,
        purpose: "connection-credential",
        recoverAfter,
        remoteRevokeRequired: false,
        rowVersion: 1,
        state: "staged",
        tenantId: connection.tenantId,
      });
      void now;
    },
    rotateCredential: async ({
      connectionId,
      expectedCredentialRef,
      expectedVersion,
      expiresAt,
      newCredentialRef,
      now,
      scopes,
    }) => {
      const current = requiredConnection(connectionId);
      assertVersion(current, expectedVersion);
      if (current.credentialRef !== expectedCredentialRef || current.status === "revoked") {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_VERSION_CONFLICT",
          "Source connection credential changed concurrently",
        );
      }
      const candidate = secretRefs.get(newCredentialRef);
      const previous = secretRefs.get(expectedCredentialRef);
      if (!candidate || candidate.state !== "staged" || !previous || previous.state !== "active") {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT",
          "Credential rotation lifecycle is incomplete",
        );
      }
      secretRefs.set(candidate.id, {
        ...candidate,
        rowVersion: candidate.rowVersion + 1,
        state: "active",
      });
      secretRefs.set(previous.id, {
        ...previous,
        recoverAfter: now,
        rowVersion: previous.rowVersion + 1,
        state: "retired",
      });
      return replace(current, {
        credentialRef: newCredentialRef,
        ...(expiresAt ? { expiresAt } : {}),
        scopes: [...scopes],
        status: "active",
        updatedAt: now,
      });
    },
    claimSecretCleanup: async ({ leaseExpiresAt, limit, now, workerId }) => {
      for (const transaction of transactions.values()) {
        const verifier = secretRefs.get(transaction.verifierRef);
        if (
          (transaction.status === "pending" || transaction.status === "exchanging") &&
          verifier !== undefined &&
          verifier.recoverAfter <= now
        ) {
          transactions.set(transaction.id, { ...transaction, status: "failed" });
        }
      }
      const candidates = Array.from(secretRefs.values())
        .filter(
          (ref) =>
            ((ref.state === "retired" || ref.state === "staged") &&
              (ref.nextAttemptAt ?? ref.recoverAfter) <= now) ||
            (ref.state === "deleting" && (ref.leaseExpiresAt ?? "") <= now),
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit);
      return candidates.map((ref) => {
        const claimed: SourceConnectionSecretRef & {
          readonly nextAttemptAt?: string | undefined;
          readonly recoverAfter: string;
        } = {
          ...ref,
          leaseExpiresAt,
          leaseToken: randomUUID(),
          rowVersion: ref.rowVersion + 1,
          state: "deleting",
          workerId,
        };
        secretRefs.set(ref.id, claimed);
        return { ...claimed };
      });
    },
    completeSecretCleanup: async ({ leaseToken, now, refId, rowVersion, workerId }) => {
      const ref = secretRefs.get(refId);
      assertSecretCleanupFence(ref, { leaseToken, rowVersion, workerId });
      secretRefs.set(refId, {
        ...ref,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        recoverAfter: now,
        rowVersion: ref.rowVersion + 1,
        state: "deleted",
        workerId: undefined,
      });
    },
    failSecretCleanup: async ({ leaseToken, nextAttemptAt, now, refId, rowVersion, workerId }) => {
      const ref = secretRefs.get(refId);
      assertSecretCleanupFence(ref, { leaseToken, rowVersion, workerId });
      secretRefs.set(refId, {
        ...ref,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        nextAttemptAt,
        recoverAfter: now,
        rowVersion: ref.rowVersion + 1,
        state: "retired",
        workerId: undefined,
      });
    },
  };
}

export function toPublicSourceConnection(connection: SourceConnection): PublicSourceConnection {
  return {
    authKind: connection.authKind,
    configuration: { ...connection.configuration },
    createdAt: connection.createdAt,
    ...(connection.lastErrorCode ? { errorCode: connection.lastErrorCode } : {}),
    ...(connection.expiresAt ? { expiresAt: connection.expiresAt } : {}),
    id: connection.id,
    knowledgeSpaceId: connection.knowledgeSpaceId,
    name: connection.name,
    providerId: connection.providerId,
    scopes: [...connection.scopes],
    status: connection.status,
    updatedAt: connection.updatedAt,
    version: connection.version,
  };
}

function cloneConnection(connection: SourceConnection): SourceConnection {
  return {
    ...connection,
    configuration: { ...connection.configuration },
    scopes: [...connection.scopes],
  };
}

export function encodeConnectionCursor(input: {
  readonly createdAt: string;
  readonly id: string;
}): string {
  return Buffer.from(JSON.stringify([input.createdAt, input.id]), "utf8").toString("base64url");
}

export function decodeConnectionCursor(cursor: string): {
  readonly createdAt: string;
  readonly id: string;
} {
  try {
    if (!cursor || cursor.length > 4_096) throw new Error("invalid cursor length");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "string" ||
      !Number.isFinite(Date.parse(value[0])) ||
      typeof value[1] !== "string" ||
      !value[1]
    ) {
      throw new Error("invalid cursor payload");
    }
    return { createdAt: value[0], id: value[1] };
  } catch {
    throw new SourceConnectionError(
      "SOURCE_CONNECTION_CURSOR_INVALID",
      "Source connection cursor is invalid",
    );
  }
}

function tokenCredentials(tokens: SourceOAuthTokens, retainedRefreshToken?: string) {
  return {
    accessToken: bounded(tokens.accessToken, "access token", 65_536),
    ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
    ...((tokens.refreshToken ?? retainedRefreshToken)
      ? { refreshToken: tokens.refreshToken ?? retainedRefreshToken }
      : {}),
    ...(tokens.scopes ? { scopes: normalizeScopes(tokens.scopes) } : {}),
    ...(tokens.tokenType ? { tokenType: tokens.tokenType } : {}),
  };
}

function deterministicRefreshCredentialRef(connectionId: string, expectedVersion: number): string {
  const bytes = createHash("sha256")
    .update(`source-refresh\0${connectionId}\0${expectedVersion}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `source-secret:v1:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function optionalCredentialString(
  credentials: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = credentials[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 65_536) {
    throw new SourceConnectionError(
      "SOURCE_OAUTH_REFRESH_RECOVERY_INVALID",
      "Staged OAuth refresh credentials are invalid",
    );
  }
  if (key === "expiresAt" && !Number.isFinite(Date.parse(value))) {
    throw new SourceConnectionError(
      "SOURCE_OAUTH_REFRESH_RECOVERY_INVALID",
      "Staged OAuth refresh expiry is invalid",
    );
  }
  return value;
}

function credentialScopes(
  credentials: Readonly<Record<string, unknown>>,
  fallback: readonly string[],
): readonly string[] {
  const scopes = credentials.scopes;
  if (scopes === undefined) return normalizeScopes(fallback);
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) {
    throw new SourceConnectionError(
      "SOURCE_OAUTH_REFRESH_RECOVERY_INVALID",
      "Staged OAuth refresh scopes are invalid",
    );
  }
  return normalizeScopes(scopes as string[]);
}

function validatePublicConfiguration(
  fields: readonly SourceProviderConfigurationField[],
  configuration: Readonly<Record<string, boolean | number | string>>,
): void {
  const allowed = new Set(fields.filter((field) => !field.secret).map((field) => field.name));
  for (const field of fields) {
    if (!field.secret && field.required && configuration[field.name] === undefined) {
      throw new SourceConnectionError(
        "SOURCE_CONNECTION_CONFIGURATION_INVALID",
        `Required source connection field ${field.name} is missing`,
      );
    }
  }
  for (const key of Object.keys(configuration)) {
    if (!allowed.has(key)) {
      throw new SourceConnectionError(
        "SOURCE_CONNECTION_CONFIGURATION_INVALID",
        "Source connection configuration contains an unknown or secret field",
      );
    }
  }
  for (const field of fields.filter((candidate) => !candidate.secret)) {
    if (configuration[field.name] !== undefined) {
      validateConfigurationField(field, configuration[field.name]);
    }
  }
}

function validateCredentials(
  fields: readonly {
    format?: "password" | "uri" | undefined;
    name: string;
    required: boolean;
    secret: boolean;
    type: "boolean" | "integer" | "string";
  }[],
  credentials: Readonly<Record<string, unknown>>,
): void {
  const secretFields = fields.filter((field) => field.secret);
  const allowed = new Map(secretFields.map((field) => [field.name, field]));
  for (const field of secretFields) {
    if (field.required && credentials[field.name] === undefined) {
      throw new SourceConnectionError(
        "SOURCE_CONNECTION_CREDENTIALS_INVALID",
        `Required source credential ${field.name} is missing`,
      );
    }
  }
  for (const [key, value] of Object.entries(credentials)) {
    const field = allowed.get(key);
    if (!field) {
      throw new SourceConnectionError(
        "SOURCE_CONNECTION_CREDENTIALS_INVALID",
        "Source credentials contain an unknown or public configuration field",
      );
    }
    validateConfigurationField(field, value);
  }
}

function validateConfigurationField(
  field: {
    format?: "password" | "uri" | undefined;
    name: string;
    type: "boolean" | "integer" | "string";
  },
  value: unknown,
): void {
  const validType =
    (field.type === "string" &&
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 65_536) ||
    (field.type === "boolean" && typeof value === "boolean") ||
    (field.type === "integer" && typeof value === "number" && Number.isSafeInteger(value));
  if (!validType) {
    throw new SourceConnectionError(
      "SOURCE_CONNECTION_CONFIGURATION_INVALID",
      `Source connection field ${field.name} has an invalid type or value`,
    );
  }
  if (field.format === "uri" && typeof value === "string") {
    let uri: URL;
    try {
      uri = new URL(value);
    } catch {
      throw new SourceConnectionError(
        "SOURCE_CONNECTION_CONFIGURATION_INVALID",
        `Source connection field ${field.name} must be a valid URI`,
      );
    }
    if (uri.protocol !== "https:") {
      throw new SourceConnectionError(
        "SOURCE_CONNECTION_CONFIGURATION_INVALID",
        `Source connection field ${field.name} must use HTTPS`,
      );
    }
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function assertPkceToken(value: string, name: string, min: number, max: number): string {
  if (value.length < min || value.length > max || !/^[A-Za-z0-9._~-]+$/u.test(value)) {
    throw new SourceConnectionError("SOURCE_OAUTH_INPUT_INVALID", `${name} is invalid`);
  }
  return value;
}

function validateRedirectUri(
  value: string,
  allowed: ReadonlySet<string>,
  allowDevelopmentLoopback: boolean,
): string {
  const normalized = normalizeRedirectUri(value);
  const uri = new URL(normalized);
  const isLocalDevelopment =
    uri.protocol === "http:" && ["127.0.0.1", "localhost"].includes(uri.hostname);
  if (!allowed.has(normalized) && !(allowDevelopmentLoopback && isLocalDevelopment)) {
    throw new SourceConnectionError(
      "SOURCE_OAUTH_REDIRECT_INVALID",
      "OAuth redirect URI is not an allowed callback",
    );
  }
  return normalized;
}

function normalizeRedirectUri(value: string): string {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new SourceConnectionError(
      "SOURCE_OAUTH_REDIRECT_INVALID",
      "OAuth redirect URI is invalid",
    );
  }
  if (uri.username || uri.password || uri.hash) {
    throw new SourceConnectionError(
      "SOURCE_OAUTH_REDIRECT_INVALID",
      "OAuth redirect URI must not contain userinfo or a fragment",
    );
  }
  if (
    uri.protocol !== "https:" &&
    !(uri.protocol === "http:" && ["127.0.0.1", "localhost"].includes(uri.hostname))
  ) {
    throw new SourceConnectionError(
      "SOURCE_OAUTH_REDIRECT_INVALID",
      "OAuth redirect URI must use HTTPS (localhost HTTP is allowed for development)",
    );
  }
  return uri.toString();
}

async function boundedOAuthOperation<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 10 * 60_000) {
    throw new SourceConnectionError(
      "SOURCE_OAUTH_TIMEOUT_INVALID",
      "OAuth operation timeout is invalid",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () =>
            reject(
              new SourceConnectionError(
                "SOURCE_OAUTH_PROVIDER_TIMEOUT",
                "OAuth provider operation timed out",
              ),
            ),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeScopes(scopes: readonly string[]): readonly string[] {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
  if (normalized.length > 100 || normalized.some((scope) => scope.length > 255)) {
    throw new SourceConnectionError("SOURCE_OAUTH_SCOPES_INVALID", "OAuth scopes are invalid");
  }
  return normalized;
}

function bounded(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new SourceConnectionError("SOURCE_CONNECTION_INPUT_INVALID", `${name} is invalid`);
  }
  return normalized;
}

function requiredCredentialRef(connection: SourceConnection): string {
  if (!connection.credentialRef) {
    throw new SourceConnectionError(
      "SOURCE_CONNECTION_CREDENTIAL_UNAVAILABLE",
      "Source connection credential is unavailable",
    );
  }
  return connection.credentialRef;
}

function safeConnectionErrorCode(error: unknown): string {
  return error instanceof SourceConnectionError ? error.code : "SOURCE_CONNECTION_PROVIDER_FAILED";
}

function assertSecretCleanupFence(
  ref: SourceConnectionSecretRef | undefined,
  fence: { readonly leaseToken: string; readonly rowVersion: number; readonly workerId: string },
): asserts ref is SourceConnectionSecretRef {
  if (
    !ref ||
    ref.state !== "deleting" ||
    ref.leaseToken !== fence.leaseToken ||
    ref.rowVersion !== fence.rowVersion ||
    ref.workerId !== fence.workerId
  ) {
    throw new SourceConnectionError(
      "SOURCE_CONNECTION_SECRET_CLEANUP_FENCE_LOST",
      "Connection secret cleanup fence was lost",
    );
  }
}
