import { describe, expect, it } from "vitest";

import { createApiDeploymentReadinessChecks } from "./readiness-options";

describe("createApiDeploymentReadinessChecks", () => {
  it("fails production readiness without auth and explicit internal transports", async () => {
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: false,
      env: { NODE_ENV: "production" },
    });

    expect(await checks["auth.verifier"]?.()).toBe(false);
    expect(await checks["dify-model-runtime.configuration"]?.()).toBe(false);
    expect(await checks["dify-datasource-runtime.configuration"]?.()).toBe(false);
    expect(await checks["dify-object-storage.configuration"]?.()).toBe(false);
    expect(checks["plugin-daemon.configuration"]).toBeUndefined();
  });

  it("accepts production only when the Dify dependency is explicitly assembled", async () => {
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: true,
      env: {
        NODE_ENV: "production",
        DIFY_INNER_API_KEY: "inner-key",
        DIFY_INNER_API_URL: "http://api:5001",
      },
    });

    expect(await checks["auth.verifier"]?.()).toBe(true);
    expect(await checks["dify-model-runtime.configuration"]?.()).toBe(true);
    expect(await checks["dify-datasource-runtime.configuration"]?.()).toBe(true);
    expect(await checks["dify-object-storage.configuration"]?.()).toBe(true);
    expect(checks["plugin-daemon.configuration"]).toBeUndefined();
  });

  it("uses Dify as the sole runtime even when rollout mode is disabled", async () => {
    const env = {
      NODE_ENV: "production",
      DIFY_INNER_API_KEY: "inner-key",
      DIFY_INNER_API_URL: "http://api:5001",
      KNOWLEDGE_INTEGRATED_MODE_ENABLED: "false",
    };
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: true,
      env,
    });

    expect(await checks["dify-model-runtime.configuration"]?.()).toBe(true);
    expect(await checks["dify-datasource-runtime.configuration"]?.()).toBe(true);
    expect(await checks["dify-object-storage.configuration"]?.()).toBe(true);
    expect(checks["plugin-daemon.configuration"]).toBeUndefined();
  });

  it("fails every Dify dependency check when inner API wiring is absent", async () => {
    const env = { KNOWLEDGE_INTEGRATED_MODE_ENABLED: "false", NODE_ENV: "production" };
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: true,
      env,
    });

    expect(await checks["dify-model-runtime.configuration"]?.()).toBe(false);
    expect(await checks["dify-datasource-runtime.configuration"]?.()).toBe(false);
    expect(await checks["dify-object-storage.configuration"]?.()).toBe(false);
    expect(checks["plugin-daemon.configuration"]).toBeUndefined();
  });

  it("allows default loopback Dify wiring in development", async () => {
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: true,
      env: { NODE_ENV: "development" },
    });

    expect(await checks["dify-model-runtime.configuration"]?.()).toBe(true);
    expect(await checks["dify-datasource-runtime.configuration"]?.()).toBe(true);
    expect(await checks["dify-object-storage.configuration"]?.()).toBe(true);
  });
});
