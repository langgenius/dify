import type { AuthSubject } from "@knowledge/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createCapabilityGrantAdmissionMiddleware } from "./capability-grant-admission-middleware";
import { createInMemoryCapabilityGrantProvenanceRepository } from "./capability-grant-provenance";
import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
const grantId = "20000000-0000-4000-8000-000000000001";
const subject: AuthSubject = {
  scopes: ["knowledge-spaces:write"],
  subjectId: "dify-account:user-a",
  tenantId: "tenant-a",
};

describe("capability grant admission middleware", () => {
  it("persists only the sanitized claims summary before a data-plane handler runs", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    const app = appWith(repository, grant());
    const response = await app.request("/work");
    expect(response.status).toBe(200);
    await expect(
      repository.get({ grantId, knowledgeSpaceId, tenantId: subject.tenantId }),
    ).resolves.toMatchObject({
      callerKind: "interactive",
      jtiHash: `sha256:${"a".repeat(64)}`,
      resource: { id: "document-a", parentId: knowledgeSpaceId, type: "document" },
      state: "active",
    });
  });

  it("idempotently admits repeated requests for the same immutable grant", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    const app = appWith(repository, grant());
    expect((await app.request("/work")).status).toBe(200);
    expect((await app.request("/work")).status).toBe(200);
    await expect(
      repository.get({ grantId, knowledgeSpaceId, tenantId: subject.tenantId }),
    ).resolves.toMatchObject({ revision: 1 });
  });

  it("fails closed when one grant id is reused with different immutable claims", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    expect((await appWith(repository, grant()).request("/work")).status).toBe(200);
    const changed = grant({ action: "documents.delete" });
    const response = await appWith(repository, changed).request("/work");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("does not persist namespace provisioning before the Space FK exists", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    const namespaceGrant = grant({
      action: "knowledge_spaces.provision",
      resource: { id: subject.tenantId, parent_id: null, type: "namespace" },
    });
    const response = await appWith(repository, namespaceGrant).request("/work");
    expect(response.status).toBe(200);
    await expect(
      repository.get({ grantId, knowledgeSpaceId, tenantId: subject.tenantId }),
    ).resolves.toBeNull();
  });
});

function appWith(
  repository: ReturnType<typeof createInMemoryCapabilityGrantProvenanceRepository>,
  capabilityV2Grant: DifyCapabilityV2SanitizedGrant,
) {
  const app = new Hono<KnowledgeGatewayEnv>();
  app.use("*", async (context, next) => {
    context.set("subject", subject);
    context.set("capabilityV2Grant", capabilityV2Grant);
    await next();
  });
  app.use("*", createCapabilityGrantAdmissionMiddleware(repository));
  app.get("/work", (context) => context.json({ ok: true }));
  return app;
}

function grant(
  overrides: Partial<DifyCapabilityV2SanitizedGrant> = {},
): DifyCapabilityV2SanitizedGrant {
  return {
    action: "documents.create",
    actor: "dify-account:actor-a",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 4,
      membership_epoch: 2,
      space_acl_epoch: 3,
    },
    azp: "dify-console",
    callerKind: "interactive",
    capVersion: 2,
    contentPolicyRevision: 6,
    contentScopeIds: ["source-a"],
    controlSpaceId: "control-space-a",
    expiresAt: 1_785_152_860,
    grantId,
    issuedAt: 1_785_152_800,
    jtiHash: `sha256:${"a".repeat(64)}`,
    namespaceId: subject.tenantId,
    notBefore: 1_785_152_800,
    resource: { id: "document-a", parent_id: knowledgeSpaceId, type: "document" },
    subject: subject.subjectId,
    traceId: "30000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}
