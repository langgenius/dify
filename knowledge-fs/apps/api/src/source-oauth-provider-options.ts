import type {
  SourceOAuthProvider,
  SourceOAuthProviderRegistry,
  SourceOAuthTokens,
} from "@knowledge/api";

export interface ApiSourceOAuthProviderOptions {
  readonly providerIds: ReadonlySet<string>;
  readonly registry: SourceOAuthProviderRegistry;
}

interface OAuthProviderConfiguration {
  readonly authorizationUrl: string;
  readonly clientAuthentication: "basic" | "body";
  readonly clientId: string;
  readonly clientSecret: string;
  readonly providerId: string;
  readonly refreshIdempotencySupported: true;
  readonly revokeUrl: string;
  readonly tokenUrl: string;
}

/**
 * Explicit production registry. Secrets never live in SOURCE_OAUTH_PROVIDERS_JSON: each entry
 * names a separate environment variable containing its client secret.
 */
export function createApiSourceOAuthProviderOptions(
  env: NodeJS.ProcessEnv,
): ApiSourceOAuthProviderOptions {
  const raw = env.SOURCE_OAUTH_PROVIDERS_JSON?.trim();
  if (!raw) return emptyOptions();
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("SOURCE_OAUTH_PROVIDERS_JSON must be valid JSON");
  }
  if (!Array.isArray(decoded)) {
    throw new Error("SOURCE_OAUTH_PROVIDERS_JSON must be an array");
  }
  const providers = new Map<string, SourceOAuthProvider>();
  for (const entry of decoded) {
    const configuration = readConfiguration(entry, env);
    if (providers.has(configuration.providerId)) {
      throw new Error(`Duplicate OAuth source provider ${configuration.providerId}`);
    }
    providers.set(configuration.providerId, createOAuthProvider(configuration));
  }
  return {
    providerIds: new Set(providers.keys()),
    registry: { get: (providerId) => providers.get(providerId) },
  };
}

function emptyOptions(): ApiSourceOAuthProviderOptions {
  return {
    providerIds: new Set(),
    registry: { get: () => undefined },
  };
}

function readConfiguration(value: unknown, env: NodeJS.ProcessEnv): OAuthProviderConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OAuth source provider configuration must be an object");
  }
  const record = value as Record<string, unknown>;
  const providerId = identifier(record.providerId, "providerId");
  const clientId = text(record.clientId, "clientId", 512);
  const clientSecretEnv = identifier(record.clientSecretEnv, "clientSecretEnv", true);
  const clientSecret = env[clientSecretEnv]?.trim();
  if (!clientSecret) {
    throw new Error(`OAuth source provider ${providerId} client secret is not configured`);
  }
  const clientAuthentication = record.clientAuthentication ?? "basic";
  if (clientAuthentication !== "basic" && clientAuthentication !== "body") {
    throw new Error(`OAuth source provider ${providerId} clientAuthentication is invalid`);
  }
  return {
    authorizationUrl: httpsUrl(record.authorizationUrl, "authorizationUrl"),
    clientAuthentication,
    clientId,
    clientSecret,
    providerId,
    refreshIdempotencySupported: requireTrue(record.refreshIdempotencySupported, providerId),
    revokeUrl: httpsUrl(record.revokeUrl, "revokeUrl"),
    tokenUrl: httpsUrl(record.tokenUrl, "tokenUrl"),
  };
}

function createOAuthProvider(configuration: OAuthProviderConfiguration): SourceOAuthProvider {
  const tokenRequest = async (
    fields: Readonly<Record<string, string>>,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<SourceOAuthTokens> => {
    const form = new URLSearchParams(fields);
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    });
    if (configuration.clientAuthentication === "basic") {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`, "utf8").toString("base64")}`,
      );
    } else {
      form.set("client_id", configuration.clientId);
      form.set("client_secret", configuration.clientSecret);
    }
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    const response = await fetch(configuration.tokenUrl, {
      body: form,
      headers,
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`OAuth token endpoint returned ${response.status}`);
    }
    return parseTokens(await response.json());
  };

  return {
    authorizationUrl: async ({ codeChallenge, redirectUri, scopes, state }) => {
      const url = new URL(configuration.authorizationUrl);
      url.searchParams.set("client_id", configuration.clientId);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", [...new Set(scopes)].join(" "));
      url.searchParams.set("state", state);
      return url.toString();
    },
    exchange: ({ code, codeVerifier, redirectUri, signal }) =>
      tokenRequest(
        {
          client_id: configuration.clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        },
        signal,
      ),
    refresh: ({ idempotencyKey, refreshToken, signal }) =>
      tokenRequest(
        {
          client_id: configuration.clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        },
        signal,
        idempotencyKey,
      ),
    revoke: async ({ accessToken, refreshToken, signal }) => {
      const token = refreshToken ?? accessToken;
      if (!token) return;
      const form = new URLSearchParams({
        client_id: configuration.clientId,
        token,
        token_type_hint: refreshToken ? "refresh_token" : "access_token",
      });
      const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
      if (configuration.clientAuthentication === "basic") {
        headers.set(
          "authorization",
          `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`, "utf8").toString("base64")}`,
        );
      } else {
        form.set("client_secret", configuration.clientSecret);
      }
      const response = await fetch(configuration.revokeUrl, {
        body: form,
        headers,
        method: "POST",
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error(`OAuth revoke endpoint returned ${response.status}`);
    },
  };
}

function parseTokens(value: unknown): SourceOAuthTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OAuth token response is invalid");
  }
  const record = value as Record<string, unknown>;
  const accessToken = text(record.access_token, "access_token", 16_384);
  const expiresIn = record.expires_in;
  if (
    expiresIn !== undefined &&
    (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0)
  ) {
    throw new Error("OAuth expires_in is invalid");
  }
  const scope =
    typeof record.scope === "string"
      ? record.scope.trim().split(/\s+/u).filter(Boolean)
      : undefined;
  return {
    accessToken,
    ...(typeof expiresIn === "number"
      ? { expiresAt: new Date(Date.now() + Math.floor(expiresIn * 1_000)).toISOString() }
      : {}),
    ...(typeof record.refresh_token === "string" && record.refresh_token.trim()
      ? { refreshToken: record.refresh_token }
      : {}),
    ...(scope ? { scopes: scope } : {}),
    ...(typeof record.token_type === "string" && record.token_type.trim()
      ? { tokenType: record.token_type }
      : {}),
  };
}

function httpsUrl(value: unknown, field: string): string {
  const raw = text(value, field, 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`OAuth source provider ${field} is invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(
      `OAuth source provider ${field} must be an HTTPS URL without credentials or fragment`,
    );
  }
  return url.toString();
}

function identifier(value: unknown, field: string, envName = false): string {
  const raw = text(value, field, 255);
  const pattern = envName ? /^[A-Z_][A-Z0-9_]*$/u : /^[a-z0-9][a-z0-9._-]{0,127}$/u;
  if (!pattern.test(raw)) throw new Error(`OAuth source provider ${field} is invalid`);
  return raw;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`OAuth source provider ${field} is invalid`);
  }
  return value.trim();
}

function requireTrue(value: unknown, providerId: string): true {
  if (value !== true) {
    throw new Error(`OAuth source provider ${providerId} must guarantee refresh idempotency`);
  }
  return true;
}
