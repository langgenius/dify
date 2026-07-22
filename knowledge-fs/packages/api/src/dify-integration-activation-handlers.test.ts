import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { registerDifyIntegrationActivationHandlers } from "./dify-integration-activation-handlers";
import type { DifyIntegrationFreezeRepository } from "./dify-integration-freeze";
import type { DifyIntegrationStateRepository } from "./dify-integration-state";
import { createKnowledgeGatewayApp } from "./gateway-app";

const digest = `sha256:${"a".repeat(64)}`;
const activationId = canonicalActivationId(7, "tenant-a", digest);

describe("Dify integration activation handler", () => {
  it("persists the verified Capability namespace and returns replay evidence", async () => {
    const repository = repositoryWith({ applied: false, replayed: true });
    const app = appWith(repository);

    const response = await app.request("/internal/dify-integration/activate", {
      body: JSON.stringify({
        activationId,
        activationRevision: 7,
        sourceRevisionDigest: digest,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      active: true,
      applied: false,
      replayed: true,
      activationId,
      activationRevision: 7,
      namespaceId: "tenant-a",
      sourceRevisionDigest: digest,
    });
    expect(repository.activate).toHaveBeenCalledWith({
      activationId,
      activationRevision: 7,
      namespaceId: "tenant-a",
      sourceRevisionDigest: digest,
    });
  });

  it("rejects a caller that did not receive the exact activation grant", async () => {
    const repository = repositoryWith({ applied: true, replayed: false });
    const app = appWith(repository, "knowledge_spaces.provision");

    const response = await app.request("/internal/dify-integration/activate", {
      body: JSON.stringify({
        activationId,
        activationRevision: 7,
        sourceRevisionDigest: digest,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(repository.activate).not.toHaveBeenCalled();
  });

  it("rejects activation evidence that is not bound to the signed grant", async () => {
    const repository = repositoryWith({ applied: true, replayed: false });
    const app = appWith(repository);

    const response = await app.request("/internal/dify-integration/activate", {
      body: JSON.stringify({
        activationId: `sha256:${"f".repeat(64)}`,
        activationRevision: 7,
        sourceRevisionDigest: digest,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(repository.activate).not.toHaveBeenCalled();
  });

  it("fails closed when the Workspace has no durable remote freeze", async () => {
    const repository = repositoryWith({ applied: true, replayed: false });
    const app = appWith(repository, "dify_integration.activate", activationId, false);

    const response = await app.request("/internal/dify-integration/activate", {
      body: JSON.stringify({ activationId, activationRevision: 7, sourceRevisionDigest: digest }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "DIFY_INTEGRATION_FREEZE_REQUIRED",
      error: "Conflict",
    });
    expect(repository.activate).not.toHaveBeenCalled();
  });

  it.each([
    [8, digest],
    [7, `sha256:${"b".repeat(64)}`],
  ])(
    "rejects revision/digest mutation under the same signed activation token",
    async (activationRevision, sourceRevisionDigest) => {
      const repository = repositoryWith({ applied: true, replayed: false });
      const app = appWith(repository);

      const response = await app.request("/internal/dify-integration/activate", {
        body: JSON.stringify({ activationId, activationRevision, sourceRevisionDigest }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(403);
      expect(repository.activate).not.toHaveBeenCalled();
    },
  );

  it("maps stale or conflicting activation evidence to 409", async () => {
    const repository: DifyIntegrationStateRepository = {
      activate: vi.fn(async () => {
        const { DifyIntegrationActivationConflictError } = await import("./dify-integration-state");
        throw new DifyIntegrationActivationConflictError();
      }),
      get: vi.fn(),
    };
    const staleActivationId = canonicalActivationId(6, "tenant-a", digest);
    const app = appWith(repository, "dify_integration.activate", staleActivationId);

    expect(
      (
        await app.request("/internal/dify-integration/activate", {
          body: JSON.stringify({
            activationId: staleActivationId,
            activationRevision: 6,
            sourceRevisionDigest: digest,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(409);
  });
});

function appWith(
  repository: DifyIntegrationStateRepository,
  action = "dify_integration.activate",
  signedActivationId = activationId,
  frozen = true,
) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: ["knowledge-spaces:write"],
      subjectId: "dify-worker:lifecycle",
      tenantId: "tenant-a",
    });
    context.set("callerKind", "service_api");
    context.set("capabilityV2Grant", {
      action,
      actor: "dify-worker:lifecycle",
      authzRevision: {
        credential_revision: null,
        external_access_epoch: 0,
        membership_epoch: 0,
        space_acl_epoch: 0,
      },
      azp: "dify-worker",
      callerKind: "internal_worker",
      capVersion: 2,
      contentPolicyRevision: 0,
      contentScopeIds: [],
      controlSpaceId: "control-a",
      expiresAt: 2,
      grantId: signedActivationId,
      issuedAt: 1,
      jtiHash: `sha256:${"f".repeat(64)}`,
      namespaceId: "tenant-a",
      notBefore: 1,
      resource: { id: "tenant-a", parent_id: null, type: "namespace" },
      subject: "dify-worker:lifecycle",
      traceId: signedActivationId,
    });
    await next();
  });
  registerDifyIntegrationActivationHandlers({ app, freezes: freezeRepository(frozen), repository });
  return app;
}

function freezeRepository(frozen: boolean): DifyIntegrationFreezeRepository {
  return {
    freeze: vi.fn(),
    get: vi.fn(async () =>
      frozen
        ? {
            freezeId: `sha256:${"b".repeat(64)}`,
            freezeRevision: 6,
            frozenAt: "2026-07-21T11:55:00.000Z",
            namespaceId: "tenant-a",
            sourceRevisionDigest: digest,
            sourceTaskWatermark: 3,
            updatedAt: "2026-07-21T11:55:00.000Z",
          }
        : null,
    ),
  };
}

function repositoryWith(result: { readonly applied: boolean; readonly replayed: boolean }) {
  const state = {
    activatedAt: "2026-07-21T12:00:00.000Z",
    activationId,
    activationRevision: 7,
    namespaceId: "tenant-a",
    sourceRevisionDigest: digest,
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
  return {
    activate: vi.fn(async () => ({ ...result, state })),
    get: vi.fn(async () => state),
  } satisfies DifyIntegrationStateRepository;
}

function canonicalActivationId(
  activationRevision: number,
  namespaceId: string,
  sourceRevisionDigest: string,
): string {
  const canonicalJson = JSON.stringify({
    activationRevision,
    namespaceId,
    sourceRevisionDigest,
  });
  return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
}
