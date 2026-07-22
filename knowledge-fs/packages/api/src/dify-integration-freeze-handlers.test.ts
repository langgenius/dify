import { describe, expect, it, vi } from "vitest";

import {
  type DifyIntegrationFreezeRepository,
  computeDifyIntegrationFreezeId,
} from "./dify-integration-freeze";
import { registerDifyIntegrationFreezeHandlers } from "./dify-integration-freeze-handlers";
import { createKnowledgeGatewayApp } from "./gateway-app";

const digest = `sha256:${"a".repeat(64)}`;
const evidence = {
  freezeRevision: 7,
  namespaceId: "tenant-a",
  sourceRevisionDigest: digest,
  sourceTaskWatermark: 12,
};
const freezeId = computeDifyIntegrationFreezeId(evidence);

describe("Dify integration freeze handler", () => {
  it("persists exact signed freeze evidence and returns its durable acknowledgement", async () => {
    const repository = repositoryWith();
    const app = appWith(repository);

    const response = await app.request("/internal/dify-integration/freeze", {
      body: JSON.stringify({
        freezeId,
        freezeRevision: 7,
        sourceRevisionDigest: digest,
        sourceTaskWatermark: 12,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      applied: true,
      freezeId,
      freezeRevision: 7,
      frozen: true,
      namespaceId: "tenant-a",
      replayed: false,
      sourceTaskWatermark: 12,
    });
    expect(repository.freeze).toHaveBeenCalledWith({ ...evidence, freezeId });
  });

  it("rejects evidence that is not bound to the signed internal-worker grant", async () => {
    const repository = repositoryWith();
    const app = appWith(repository, `sha256:${"f".repeat(64)}`);

    expect(
      (
        await app.request("/internal/dify-integration/freeze", {
          body: JSON.stringify({
            freezeId,
            freezeRevision: 7,
            sourceRevisionDigest: digest,
            sourceTaskWatermark: 12,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(repository.freeze).not.toHaveBeenCalled();
  });
});

function appWith(repository: DifyIntegrationFreezeRepository, signedFreezeId = freezeId) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: ["knowledge-spaces:write"],
      subjectId: "dify-worker:lifecycle",
      tenantId: "tenant-a",
    });
    context.set("callerKind", "service_api");
    context.set("capabilityV2Grant", {
      action: "dify_integration.freeze",
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
      grantId: signedFreezeId,
      issuedAt: 1,
      jtiHash: `sha256:${"f".repeat(64)}`,
      namespaceId: "tenant-a",
      notBefore: 1,
      resource: { id: "tenant-a", parent_id: null, type: "namespace" },
      subject: "dify-worker:lifecycle",
      traceId: signedFreezeId,
    });
    await next();
  });
  registerDifyIntegrationFreezeHandlers({ app, repository });
  return app;
}

function repositoryWith(): DifyIntegrationFreezeRepository {
  const state = {
    ...evidence,
    freezeId,
    frozenAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
  return {
    freeze: vi.fn(async () => ({ applied: true, replayed: false, state })),
    get: vi.fn(async () => state),
  };
}
