import { generateKeyPairSync } from "node:crypto";

import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { createKnowledgeGateway } from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

import { createApiCapabilityV2Assembly } from "./capability-v2-options";
import { createApiDeploymentReadinessChecks } from "./readiness-options";

function publicJwks(kid = "current-1") {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
  return {
    keys: [{ ...publicKey.export({ format: "jwk" }), alg: "RS256", kid, use: "sig" }],
  };
}

describe("createApiCapabilityV2Assembly", () => {
  it("leaves Capability v2 traffic disabled by default", () => {
    expect(createApiCapabilityV2Assembly({ audit: { record: vi.fn() }, env: {} })).toEqual({
      selected: false,
    });
  });

  it("keeps production readiness false when the selected profile is incomplete", async () => {
    const assembly = createApiCapabilityV2Assembly({
      audit: { record: vi.fn() },
      env: { KNOWLEDGE_FS_CAPABILITY_V2_ENABLED: "true" },
    });
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: assembly.authenticator !== undefined,
      env: { NODE_ENV: "production" },
    });

    expect(assembly).toEqual({ selected: true });
    expect(await checks["auth.verifier"]?.()).toBe(false);

    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      readinessChecks: checks,
    });
    const response = await app.request("/ready");
    expect(response.status).toBe(503);
  });

  it("assembles only public current/previous JWKS", () => {
    const assembly = createApiCapabilityV2Assembly({
      audit: { record: vi.fn() },
      env: {
        KNOWLEDGE_FS_CAPABILITY_V2_ENABLED: "true",
        KNOWLEDGE_FS_CAPABILITY_V2_PUBLIC_JWKS: JSON.stringify(publicJwks()),
      },
    });

    expect(assembly.selected).toBe(true);
    expect(assembly.authenticator).toBeDefined();
  });

  it("rejects private signing material instead of installing it in KnowledgeFS", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
    const privateJwk = privateKey.export({ format: "jwk" });
    const assembly = createApiCapabilityV2Assembly({
      audit: { record: vi.fn() },
      env: {
        KNOWLEDGE_FS_CAPABILITY_V2_ENABLED: "true",
        KNOWLEDGE_FS_CAPABILITY_V2_PUBLIC_JWKS: JSON.stringify({
          keys: [{ ...privateJwk, alg: "RS256", kid: "forbidden", use: "sig" }],
        }),
      },
    });

    expect(assembly).toEqual({ selected: true });
  });
});
