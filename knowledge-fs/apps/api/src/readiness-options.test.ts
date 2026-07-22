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
    expect(await checks["plugin-daemon.configuration"]?.()).toBe(false);
  });

  it("accepts the production deployment inputs only when both are explicitly assembled", async () => {
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: true,
      env: {
        NODE_ENV: "production",
        DIFY_INNER_API_KEY: "inner-key",
        DIFY_INNER_API_URL: "http://api:5001",
        PLUGIN_DAEMON_KEY: "server-key",
        PLUGIN_DAEMON_URL: "http://plugin_daemon:5002",
      },
    });

    expect(await checks["auth.verifier"]?.()).toBe(true);
    expect(await checks["dify-model-runtime.configuration"]?.()).toBe(true);
    expect(await checks["plugin-daemon.configuration"]?.()).toBe(true);
  });

  it("uses Dify as the sole datasource runtime in integrated production mode", async () => {
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: true,
      env: {
        NODE_ENV: "production",
        DIFY_INNER_API_KEY: "inner-key",
        DIFY_INNER_API_URL: "http://api:5001",
        KNOWLEDGE_INTEGRATED_MODE_ENABLED: "true",
      },
    });

    expect(await checks["dify-model-runtime.configuration"]?.()).toBe(true);
    expect(await checks["dify-datasource-runtime.configuration"]?.()).toBe(true);
    expect(checks["plugin-daemon.configuration"]).toBeUndefined();
  });

  it("fails the integrated datasource check when Dify inner API wiring is absent", async () => {
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: true,
      env: { KNOWLEDGE_INTEGRATED_MODE_ENABLED: "true", NODE_ENV: "production" },
    });

    expect(await checks["dify-datasource-runtime.configuration"]?.()).toBe(false);
    expect(checks["plugin-daemon.configuration"]).toBeUndefined();
  });

  it("does not require internal transport wiring for the standalone development profile", async () => {
    const checks = createApiDeploymentReadinessChecks({
      authVerifierConfigured: true,
      env: { NODE_ENV: "development" },
    });

    expect(await checks["dify-model-runtime.configuration"]?.()).toBe(true);
    expect(await checks["plugin-daemon.configuration"]?.()).toBe(true);
  });
});
