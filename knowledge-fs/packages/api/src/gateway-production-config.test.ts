import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createKnowledgeGateway } from "./index";

describe("knowledge gateway production configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects the unscoped local query fallback in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        allowLocalQueryFallback: true,
      }),
    ).toThrow("Local query fallback is forbidden in production");
  });

  it("rejects deployment-level Research profile defaults in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        allowLegacyResearchTaskProfileFallback: true,
      }),
    ).toThrow("Legacy Research profile fallback is forbidden in production");
  });

  it("requires atomic knowledge-space provisioning in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
      }),
    ).toThrow("Atomic knowledge-space provisioning is required in production");
  });

  it("rejects the legacy Source scheduler beside durable Source product workflows", () => {
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        sourceProduct: {} as never,
        sourceSync: {} as never,
      }),
    ).toThrow("Legacy Source sync scheduler cannot run alongside durable Source product workflows");
  });
});
