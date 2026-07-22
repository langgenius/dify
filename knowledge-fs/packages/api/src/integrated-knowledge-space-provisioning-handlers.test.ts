import { randomUUID } from "node:crypto";

import type { AuthSubject, KnowledgeSpace } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createKnowledgeGatewayApp } from "./gateway-app";
import { registerIntegratedKnowledgeSpaceProvisioningHandlers } from "./integrated-knowledge-space-provisioning-handlers";
import {
  type IntegratedKnowledgeSpaceProvisioningRepository,
  KnowledgeSpaceProvisioningIdempotencyConflictError,
  KnowledgeSpaceProvisioningIncompleteReplayError,
  type ProvisionKnowledgeSpaceInput,
} from "./knowledge-space-provisioning-repository";
import { KnowledgeSpaceCapacityExceededError } from "./knowledge-space-repository";

const subject: AuthSubject = {
  scopes: ["knowledge-spaces:write"],
  subjectId: "dify-worker:lifecycle-a",
  tenantId: "tenant-a",
};

describe("integrated knowledge-space provisioning handlers", () => {
  it("provisions only through the branded integrated port with a stable generated slug", async () => {
    const provision = vi.fn(async (input: ProvisionKnowledgeSpaceInput) => ({
      configurationStatus: "setup-required" as const,
      replayed: false,
      space: space(input),
    }));
    const app = appWith({ provision, provisioningMode: "integrated" });

    const response = await app.request("/internal/knowledge-spaces/provision", {
      body: JSON.stringify({ idempotencyKey: "control-space-a:provision", name: "研发知识库" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      configurationStatus: "setup-required",
      replayed: false,
    });
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBySubjectId: subject.subjectId,
        idempotencyKey: "control-space-a:provision",
        slug: expect.stringMatching(/^knowledge-space-[a-f0-9]{12}$/u),
        slugSource: "generated",
        tenantId: subject.tenantId,
      }),
    );
  });

  it("requires the Dify lifecycle idempotency key", async () => {
    const app = appWith(repository());
    const response = await app.request("/internal/knowledge-spaces/provision", {
      body: JSON.stringify({ name: "Missing key" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
  });

  it.each([
    [new KnowledgeSpaceProvisioningIdempotencyConflictError(), 409],
    [new KnowledgeSpaceCapacityExceededError(10), 429],
    [new KnowledgeSpaceProvisioningIncompleteReplayError(), 503],
  ])(
    "maps a stable provisioning failure without exposing implementation detail",
    async (error, status) => {
      const app = appWith(
        repository({
          provision: vi.fn(async () => {
            throw error;
          }),
        }),
      );
      const response = await app.request("/internal/knowledge-spaces/provision", {
        body: JSON.stringify({ idempotencyKey: "operation-a", name: "Space" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(status);
    },
  );

  it("rejects accidental registration with a legacy repository", () => {
    const app = createKnowledgeGatewayApp();
    expect(() =>
      registerIntegratedKnowledgeSpaceProvisioningHandlers({
        app,
        provisioning: {
          ...repository(),
          provisioningMode: "legacy",
        } as unknown as IntegratedKnowledgeSpaceProvisioningRepository,
      }),
    ).toThrow("requires an integrated repository");
  });
});

function appWith(provisioning: IntegratedKnowledgeSpaceProvisioningRepository) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("subject", subject);
    context.set("traceId", randomUUID());
    await next();
  });
  registerIntegratedKnowledgeSpaceProvisioningHandlers({ app, provisioning });
  return app;
}

function repository(
  overrides: Partial<IntegratedKnowledgeSpaceProvisioningRepository> = {},
): IntegratedKnowledgeSpaceProvisioningRepository {
  return {
    provision: async (input) => ({
      configurationStatus: "setup-required",
      replayed: false,
      space: space(input),
    }),
    provisioningMode: "integrated",
    ...overrides,
  };
}

function space(input: ProvisionKnowledgeSpaceInput): KnowledgeSpace {
  return {
    createdAt: "2026-07-21T12:00:00.000Z",
    id: "10000000-0000-4000-8000-000000000001",
    name: input.name,
    revision: 1,
    slug: input.slug,
    tenantId: input.tenantId,
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
}
