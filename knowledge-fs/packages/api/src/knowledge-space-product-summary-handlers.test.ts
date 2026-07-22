import type { AuthSubject, KnowledgeSpace } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import { createKnowledgeGatewayApp } from "./gateway-app";
import { registerKnowledgeSpaceProductSummaryHandlers } from "./knowledge-space-product-summary-handlers";

const TENANT_ID = "tenant-a";
const SPACE_A = "10000000-0000-4000-8000-000000000001";
const MISSING_SPACE = "10000000-0000-4000-8000-000000000002";

describe("knowledge-space product summary handlers", () => {
  it("returns only requested tenant-owned spaces after exact Capability scope admission", async () => {
    const get = vi.fn(
      async ({ id, tenantId }: { readonly id: string; readonly tenantId: string }) =>
        id === SPACE_A && tenantId === TENANT_ID ? space() : null,
    );
    const getStorageUsage = vi.fn(async () => ({ documentCount: 3, rawDocumentBytes: 42 }));
    const getManifest = vi.fn(async () => null);
    const app = appWith({
      assets: { getStorageUsage },
      grant: grant([SPACE_A, MISSING_SPACE]),
      manifests: { get: getManifest },
      spaces: { get },
    });

    const response = await request(app, [MISSING_SPACE, SPACE_A]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          description: "Product description",
          documentCount: 3,
          icon: "builtin:book",
          indexState: null,
          knowledgeSpaceId: SPACE_A,
          lastJobState: null,
          modelProfile: null,
          name: "Product space",
          revision: 2,
          slug: "product-space",
        },
      ],
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith({ id: SPACE_A, tenantId: TENANT_ID });
    expect(getStorageUsage).toHaveBeenCalledTimes(1);
    expect(getManifest).toHaveBeenCalledWith({ knowledgeSpaceId: SPACE_A, tenantId: TENANT_ID });
  });

  it.each([
    ["missing grant", undefined, [SPACE_A]],
    ["scope mismatch", grant([MISSING_SPACE]), [SPACE_A]],
    ["namespace mismatch", grant([SPACE_A], "tenant-b"), [SPACE_A]],
  ])("fails closed before repository reads for %s", async (_label, capability, ids) => {
    const get = vi.fn(async () => space());
    const getStorageUsage = vi.fn(async () => ({ documentCount: 0, rawDocumentBytes: 0 }));
    const getManifest = vi.fn(async () => null);
    const app = appWith({
      assets: { getStorageUsage },
      grant: capability,
      manifests: { get: getManifest },
      spaces: { get },
    });

    const response = await request(app, ids);

    expect(response.status).toBe(403);
    expect(get).not.toHaveBeenCalled();
    expect(getStorageUsage).not.toHaveBeenCalled();
    expect(getManifest).not.toHaveBeenCalled();
  });

  it("rejects an oversized batch before any repository read", async () => {
    const ids = Array.from(
      { length: 101 },
      (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const get = vi.fn(async () => space());
    const app = appWith({
      assets: { getStorageUsage: vi.fn(async () => ({ documentCount: 0, rawDocumentBytes: 0 })) },
      grant: grant(ids),
      manifests: { get: vi.fn(async () => null) },
      spaces: { get },
    });

    const response = await request(app, ids);

    expect(response.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
});

function appWith({
  assets,
  grant: capability,
  manifests,
  spaces,
}: {
  readonly assets: Parameters<typeof registerKnowledgeSpaceProductSummaryHandlers>[0]["assets"];
  readonly grant?: DifyCapabilityV2SanitizedGrant | undefined;
  readonly manifests: Parameters<
    typeof registerKnowledgeSpaceProductSummaryHandlers
  >[0]["manifests"];
  readonly spaces: Parameters<typeof registerKnowledgeSpaceProductSummaryHandlers>[0]["spaces"];
}) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("subject", subject());
    context.set("traceId", "trace-a");
    if (capability) context.set("capabilityV2Grant", capability);
    await next();
  });
  registerKnowledgeSpaceProductSummaryHandlers({ app, assets, manifests, spaces });
  return app;
}

function request(app: ReturnType<typeof appWith>, knowledgeSpaceIds: readonly string[]) {
  return app.request("/internal/knowledge-spaces/product-summaries/batch", {
    body: JSON.stringify({ knowledgeSpaceIds }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function subject(): AuthSubject {
  return {
    scopes: ["knowledge-spaces:read"],
    subjectId: "dify-account:account-a",
    tenantId: TENANT_ID,
  };
}

function grant(
  contentScopeIds: readonly string[],
  namespaceId = TENANT_ID,
): DifyCapabilityV2SanitizedGrant {
  return {
    action: "knowledge_spaces.status.batch",
    actor: "dify-account:account-a",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "dify-console",
    callerKind: "interactive",
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds,
    controlSpaceId: "control-a",
    expiresAt: 1_800_000_060,
    grantId: "grant-a",
    issuedAt: 1_800_000_000,
    jtiHash: "sha256:jti",
    namespaceId,
    notBefore: 1_800_000_000,
    resource: { id: namespaceId, parent_id: null, type: "namespace" },
    subject: "dify-account:account-a",
    traceId: "trace-a",
  };
}

function space(): KnowledgeSpace {
  return {
    createdAt: "2026-07-21T12:00:00.000Z",
    description: "Product description",
    iconRef: "builtin:book",
    id: SPACE_A,
    name: "Product space",
    revision: 2,
    slug: "product-space",
    tenantId: TENANT_ID,
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
}
