import type { AuthSubject } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  CapabilityRevokeEventConflictError,
  createInMemoryCapabilityGrantProvenanceRepository,
} from "./capability-grant-provenance";
import { registerCapabilityRevocationHandlers } from "./capability-revocation-handlers";
import { createKnowledgeGatewayApp } from "./gateway-app";

const tenantId = "tenant-a";
const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
const grantId = "20000000-0000-4000-8000-000000000001";
const eventId = "30000000-0000-4000-8000-000000000001";
const subject: AuthSubject = {
  scopes: ["knowledge-spaces:write"],
  subjectId: "dify-worker:lifecycle-a",
  tenantId,
};

describe("capability revocation handlers", () => {
  it("scopes a grant revoke to the authenticated tenant and path grant", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    await repository.admit(grantInput());
    const applyGrantRevoke = vi.spyOn(repository, "applyGrantRevoke");
    const app = appWith(repository);

    const response = await app.request(`/internal/capability-grants/${grantId}/revoke`, {
      body: JSON.stringify({
        eventId,
        knowledgeSpaceId,
        reasonCode: "permission_revoked",
        revokeSequence: 4,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applied: true,
      highestRevokeSequence: 4,
      state: "revoked",
    });
    expect(applyGrantRevoke).toHaveBeenCalledWith(expect.objectContaining({ grantId, tenantId }));
  });

  it("applies a monotonic Space tombstone without accepting tenant input", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    const applySpaceFence = vi.spyOn(repository, "applySpaceFence");
    const app = appWith(repository);
    const response = await app.request(
      `/internal/knowledge-spaces/${knowledgeSpaceId}/capability-fence`,
      {
        body: JSON.stringify({
          eventId,
          reasonCode: "space_deleting",
          revokeSequence: 8,
          tombstoned: true,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applied: true,
      highestRevokeSequence: 8,
      tombstoned: true,
    });
    expect(applySpaceFence).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeSpaceId, tenantId }),
    );
  });

  it("returns one non-enumerating conflict for reused or unknown revoke state", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    repository.applyGrantRevoke = vi.fn(async () => {
      throw new CapabilityRevokeEventConflictError();
    });
    const response = await appWith(repository).request(
      `/internal/capability-grants/${grantId}/revoke`,
      {
        body: JSON.stringify({
          eventId,
          knowledgeSpaceId,
          reasonCode: "permission_revoked",
          revokeSequence: 4,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "CAPABILITY_REVOKE_CONFLICT",
      error: "Capability revoke conflicts with durable state",
    });
  });

  it("rejects malformed sequence and reason before repository mutation", async () => {
    const repository = createInMemoryCapabilityGrantProvenanceRepository();
    const applySpaceFence = vi.spyOn(repository, "applySpaceFence");
    const response = await appWith(repository).request(
      `/internal/knowledge-spaces/${knowledgeSpaceId}/capability-fence`,
      {
        body: JSON.stringify({
          eventId,
          reasonCode: "not allowed!",
          revokeSequence: 0,
          tombstoned: true,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(response.status).toBe(400);
    expect(applySpaceFence).not.toHaveBeenCalled();
  });
});

function appWith(grants: ReturnType<typeof createInMemoryCapabilityGrantProvenanceRepository>) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("subject", subject);
    await next();
  });
  registerCapabilityRevocationHandlers({ app, grants });
  return app;
}

function grantInput() {
  return {
    action: "documents.create",
    actorId: "dify-account:actor-a",
    authzRevision: {
      credentialRevision: null,
      externalAccessEpoch: 4,
      membershipEpoch: 2,
      spaceAclEpoch: 3,
    },
    callerKind: "interactive" as const,
    contentPolicyRevision: 6,
    contentScopeIds: ["source-a"],
    expiresAt: "2026-07-21T12:01:00.000Z",
    grantId,
    issuedAt: "2026-07-21T12:00:00.000Z",
    jtiHash: `sha256:${"a".repeat(64)}`,
    knowledgeSpaceId,
    resource: { id: "document-a", parentId: knowledgeSpaceId, type: "document" },
    subjectId: "dify-account:user-a",
    tenantId,
    traceId: "40000000-0000-4000-8000-000000000001",
  };
}
