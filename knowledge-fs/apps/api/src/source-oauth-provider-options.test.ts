import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiSourceOAuthProviderOptions } from "./source-oauth-provider-options";

const providerConfig = {
  authorizationUrl: "https://accounts.example.test/oauth/authorize",
  clientAuthentication: "basic",
  clientId: "client-a",
  clientSecretEnv: "OAUTH_CLIENT_SECRET_A",
  providerId: "plugin-daemon-online-document",
  refreshIdempotencySupported: true,
  revokeUrl: "https://accounts.example.test/oauth/revoke",
  tokenUrl: "https://accounts.example.test/oauth/token",
};

afterEach(() => vi.unstubAllGlobals());

describe("source OAuth provider options", () => {
  it("is unavailable unless an explicit provider registry is configured", () => {
    const options = createApiSourceOAuthProviderOptions({});
    expect(options.providerIds.size).toBe(0);
    expect(options.registry.get("plugin-daemon-online-document")).toBeUndefined();
  });

  it("fails closed for inline/missing secrets, insecure endpoints, and non-idempotent refresh", () => {
    expect(() =>
      createApiSourceOAuthProviderOptions({
        SOURCE_OAUTH_PROVIDERS_JSON: JSON.stringify([providerConfig]),
      }),
    ).toThrow(/client secret is not configured/u);
    expect(() =>
      createApiSourceOAuthProviderOptions({
        OAUTH_CLIENT_SECRET_A: "secret",
        SOURCE_OAUTH_PROVIDERS_JSON: JSON.stringify([
          { ...providerConfig, tokenUrl: "http://accounts.example.test/oauth/token" },
        ]),
      }),
    ).toThrow(/HTTPS URL/u);
    expect(() =>
      createApiSourceOAuthProviderOptions({
        OAUTH_CLIENT_SECRET_A: "secret",
        SOURCE_OAUTH_PROVIDERS_JSON: JSON.stringify([
          { ...providerConfig, refreshIdempotencySupported: false },
        ]),
      }),
    ).toThrow(/guarantee refresh idempotency/u);
  });

  it("implements PKCE exchange, stable refresh idempotency, and durable revoke calls", async () => {
    const calls: Array<{ body: string; headers: Headers; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          body: String(init.body),
          headers: init.headers as Headers,
          url,
        });
        return new Response(
          JSON.stringify({
            access_token: "access-a",
            expires_in: 3600,
            refresh_token: "refresh-a",
            scope: "read write",
            token_type: "Bearer",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }),
    );
    const options = createApiSourceOAuthProviderOptions({
      OAUTH_CLIENT_SECRET_A: "secret-a",
      SOURCE_OAUTH_PROVIDERS_JSON: JSON.stringify([providerConfig]),
    });
    const provider = options.registry.get(providerConfig.providerId);
    expect(provider).toBeDefined();
    const authorization = await provider?.authorizationUrl({
      codeChallenge: "challenge-a",
      redirectUri: "https://api.example.test/source-oauth/callback",
      scopes: ["read", "write"],
      state: "state-a",
    });
    expect(authorization).toContain("code_challenge_method=S256");
    expect(authorization).toContain("state=state-a");

    await provider?.exchange({
      code: "code-a",
      codeVerifier: "verifier-a",
      redirectUri: "https://api.example.test/source-oauth/callback",
    });
    await provider?.refresh({
      idempotencyKey: "source-refresh:connection-a:3",
      refreshToken: "refresh-a",
    });
    await provider?.revoke({ refreshToken: "refresh-a" });

    expect(calls[0]?.body).toContain("code_verifier=verifier-a");
    expect(calls[1]?.headers.get("idempotency-key")).toBe("source-refresh:connection-a:3");
    expect(calls[2]?.url).toBe(providerConfig.revokeUrl);
    expect(calls[2]?.body).toContain("token_type_hint=refresh_token");
    expect(calls.every((call) => call.headers.get("authorization")?.startsWith("Basic "))).toBe(
      true,
    );
  });
});
