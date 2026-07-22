import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import type {
  DifyCapabilityV2GatewayAuthenticator,
  DifyCapabilityV2SanitizedGrant,
} from "./dify-capability-v2";
import { createInMemoryKnowledgeSpaceRepository, createKnowledgeGateway } from "./index";

describe("integrated Capability handler regressions", () => {
  it("lists tenant-scoped integrated spaces without requiring legacy member or policy rows", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 10, maxSpaces: 10 });
    const integrated = await spaces.create({
      name: "Integrated",
      slug: "integrated",
      tenantId: "tenant-1",
    });
    await spaces.create({ name: "Other tenant", slug: "other", tenantId: "tenant-2" });
    const grant = capabilityGrant({
      action: "knowledge_spaces.list",
      callerKind: "internal_worker",
      resource: { id: "tenant-1", parent_id: null, type: "namespace" },
    });
    const authenticate = vi.fn<DifyCapabilityV2GatewayAuthenticator["authenticate"]>(async () =>
      capabilityPrincipal(grant),
    );
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      difyCapabilityV2Auth: { authenticate },
      knowledgeSpaces: spaces,
    });

    const response = await app.request("/knowledge-spaces?limit=10", {
      headers: { authorization: "Bearer capability" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [integrated] });
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it("rejects a non-list or cross-namespace grant before tenant-scoped listing", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 10, maxSpaces: 10 });
    await spaces.create({ name: "Integrated", slug: "integrated", tenantId: "tenant-1" });
    const grant = capabilityGrant({
      action: "research_tasks.plan",
      callerKind: "workflow",
      namespaceId: "tenant-2",
      resource: { id: "tenant-2", parent_id: null, type: "namespace" },
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      difyCapabilityV2Auth: {
        authenticate: async () => ({
          ...capabilityPrincipal(grant),
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: grant.subject,
            tenantId: "tenant-1",
          },
        }),
      },
      knowledgeSpaces: spaces,
    });

    const response = await app.request("/knowledge-spaces?limit=10", {
      headers: { authorization: "Bearer capability" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("plans Research for an integrated Space without falling back to legacy ACL", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 10, maxSpaces: 10 });
    const integrated = await spaces.create({
      name: "Integrated",
      slug: "integrated",
      tenantId: "tenant-1",
    });
    const grant = capabilityGrant({
      action: "research_tasks.plan",
      callerKind: "workflow",
      resource: { id: integrated.id, parent_id: null, type: "knowledge_space" },
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      allowLegacyResearchTaskProfileFallback: true,
      difyCapabilityV2Auth: {
        authenticate: async () => capabilityPrincipal(grant),
      },
      knowledgeSpaces: spaces,
    });

    const response = await app.request("/research-tasks/plan", {
      body: JSON.stringify({
        knowledgeSpaceId: integrated.id,
        mode: "fast",
        query: "Plan against the integrated Space",
      }),
      headers: {
        authorization: "Bearer capability",
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      retrievalPlan: {
        requestedMode: "fast",
        resolvedMode: "fast",
      },
    });
  });
});

function capabilityGrant({
  action,
  callerKind,
  namespaceId = "tenant-1",
  resource,
}: {
  readonly action: string;
  readonly callerKind: DifyCapabilityV2SanitizedGrant["callerKind"];
  readonly namespaceId?: string;
  readonly resource: DifyCapabilityV2SanitizedGrant["resource"];
}): DifyCapabilityV2SanitizedGrant {
  return {
    action,
    actor: "dify-app:app-1",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: callerKind === "internal_worker" ? "dify-worker" : "dify-workflow",
    callerKind,
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds: [],
    controlSpaceId: "control-space-1",
    expiresAt: 2_000_000_060,
    grantId: "grant-1",
    issuedAt: 2_000_000_000,
    jtiHash: `sha256:${"a".repeat(64)}`,
    namespaceId,
    notBefore: 2_000_000_000,
    resource,
    subject: callerKind === "internal_worker" ? "dify-worker:lifecycle" : "dify-app:app-1",
    traceId: "trace-1",
  };
}

function capabilityPrincipal(grant: DifyCapabilityV2SanitizedGrant) {
  return {
    callerKind: grant.callerKind,
    claims: {} as never,
    grant,
    subject: {
      scopes: ["knowledge-spaces:read"],
      subjectId: grant.subject,
      tenantId: grant.namespaceId,
    },
  };
}
