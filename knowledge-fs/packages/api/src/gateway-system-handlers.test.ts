import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { createKnowledgeGateway } from "./index";

describe("gateway deployment readiness", () => {
  it("keeps liveness healthy while an explicit deployment check fails readiness", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      readinessChecks: {
        "auth.verifier": () => false,
        "plugin-daemon.configuration": () => true,
      },
    });

    const healthResponse = await app.request("/health");
    const readinessResponse = await app.request("/ready");

    expect(healthResponse.status).toBe(200);
    expect(readinessResponse.status).toBe(503);
    await expect(readinessResponse.json()).resolves.toMatchObject({
      components: {
        "auth.verifier": false,
        "plugin-daemon.configuration": true,
        compute: true,
        database: true,
        objectStorage: true,
        parser: true,
      },
      ok: false,
      runtime: "node-docker",
    });
  });

  it("opens readiness only when platform and every explicit deployment check pass", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      readinessChecks: {
        "auth.verifier": () => true,
        "plugin-daemon.configuration": async () => true,
      },
    });

    const response = await app.request("/ready");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      components: {
        "auth.verifier": true,
        "plugin-daemon.configuration": true,
      },
      ok: true,
    });
  });

  it("fails readiness closed when an explicit deployment check throws", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      readinessChecks: {
        "auth.verifier": () => {
          throw new Error("verifier probe failed");
        },
      },
    });

    const response = await app.request("/ready");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      components: { "auth.verifier": false },
      ok: false,
    });
  });

  it("fails readiness when the platform reports unhealthy without component details", async () => {
    const healthyAdapter = createNodePlatformAdapter({ env: {} });
    const app = createKnowledgeGateway({
      adapter: {
        ...healthyAdapter,
        health: async () => ({
          components: {},
          ok: false,
          runtime: "node-docker",
        }),
      },
      readinessChecks: {
        "auth.verifier": () => true,
        "plugin-daemon.configuration": () => true,
      },
    });

    const response = await app.request("/ready");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      components: {
        "auth.verifier": true,
        "plugin-daemon.configuration": true,
        compute: true,
        parser: true,
      },
      ok: false,
    });
  });
});
