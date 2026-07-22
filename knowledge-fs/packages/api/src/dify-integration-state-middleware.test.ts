import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2";
import {
  type DifyIntegrationStateRepository,
  createDifyIntegrationStateMiddleware,
} from "./dify-integration-state";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

describe("Dify Workspace integration admission", () => {
  it("allows Capability v2 product traffic only after its Workspace is active", async () => {
    const repository = stateRepository(true);
    const app = appWith(repository, { capability: productGrant() });

    expect((await app.request("/product")).status).toBe(204);
    expect(repository.get).toHaveBeenCalledWith("tenant-a");
  });

  it("fails closed for Capability v2 product traffic before activation", async () => {
    const app = appWith(stateRepository(false), { capability: productGrant() });

    const response = await app.request("/product");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "DIFY_INTEGRATION_NOT_ACTIVE",
      error: "Forbidden",
    });
  });

  it.each([
    ["activate", internalGrant("dify_integration.activate")],
    ["freeze", internalGrant("dify_integration.freeze")],
    ["provision", internalGrant("knowledge_spaces.provision")],
    ["delete", internalGrant("knowledge_spaces.delete")],
    ["revoke", internalGrant("capability_grants.revoke")],
    ["reconcile", internalGrant("knowledge_spaces.list")],
  ])("allows inactive internal-worker %s recovery traffic", async (_name, capability) => {
    const repository = stateRepository(false);
    const app = appWith(repository, { capability });

    expect((await app.request("/product")).status).toBe(204);
    expect(repository.get).not.toHaveBeenCalled();
  });

  it("does not let an interactive caller use an internal action as a bypass", async () => {
    const app = appWith(stateRepository(false), {
      capability: { ...productGrant(), action: "knowledge_spaces.list" },
    });

    expect((await app.request("/product")).status).toBe(403);
  });

  it("rejects a Capability whose namespace differs from the authenticated subject", async () => {
    const repository = stateRepository(true);
    const app = appWith(repository, {
      capability: { ...productGrant(), namespaceId: "tenant-b" },
    });

    expect((await app.request("/product")).status).toBe(403);
    expect(repository.get).not.toHaveBeenCalled();
  });

  it("allows legacy traffic only while its Workspace remains inactive", async () => {
    expect((await appWith(stateRepository(false)).request("/product")).status).toBe(204);
    expect((await appWith(stateRepository(true)).request("/product")).status).toBe(403);
  });

  it("fails closed instead of falling back when the activation store is unavailable", async () => {
    const app = appWith({
      activate: vi.fn(),
      get: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    expect((await app.request("/product")).status).toBe(500);
  });

  it("does not consult activation state for unauthenticated system routes", async () => {
    const repository = stateRepository(true);
    const app = new Hono<KnowledgeGatewayEnv>();
    app.use("*", createDifyIntegrationStateMiddleware(repository));
    app.get("/health", (context) => context.body(null, 204));

    expect((await app.request("/health")).status).toBe(204);
    expect(repository.get).not.toHaveBeenCalled();
  });
});

function appWith(
  repository: DifyIntegrationStateRepository,
  options: { readonly capability?: ReturnType<typeof productGrant> | undefined } = {},
) {
  const app = new Hono<KnowledgeGatewayEnv>();
  app.onError(() => new Response(null, { status: 500 }));
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: ["knowledge-spaces:read"],
      subjectId: options.capability?.subject ?? "legacy-user",
      tenantId: "tenant-a",
    });
    context.set(
      "callerKind",
      options.capability?.callerKind === "internal_worker" ? "service_api" : "interactive",
    );
    if (options.capability) context.set("capabilityV2Grant", options.capability);
    await next();
  });
  app.use("*", createDifyIntegrationStateMiddleware(repository));
  app.get("/product", (context) => context.body(null, 204));
  return app;
}

function stateRepository(active: boolean): DifyIntegrationStateRepository & {
  readonly get: ReturnType<typeof vi.fn>;
} {
  return {
    activate: vi.fn(),
    get: vi.fn(async () =>
      active
        ? {
            activatedAt: "2026-07-21T12:00:00.000Z",
            activationId: "activation-1",
            activationRevision: 1,
            namespaceId: "tenant-a",
            sourceRevisionDigest: `sha256:${"a".repeat(64)}`,
            updatedAt: "2026-07-21T12:00:00.000Z",
          }
        : null,
    ),
  };
}

function productGrant(): DifyCapabilityV2SanitizedGrant {
  return {
    action: "knowledge_spaces.read",
    actor: "dify-account:actor-a",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "dify-console",
    callerKind: "interactive" as const,
    capVersion: 2 as const,
    contentPolicyRevision: 1,
    contentScopeIds: [],
    controlSpaceId: "control-a",
    expiresAt: 2,
    grantId: "grant-a",
    issuedAt: 1,
    jtiHash: `sha256:${"f".repeat(64)}`,
    namespaceId: "tenant-a",
    notBefore: 1,
    resource: { id: "space-a", parent_id: null, type: "knowledge_space" as const },
    subject: "dify-account:user-a",
    traceId: "trace-a",
  };
}

function internalGrant(action: string): DifyCapabilityV2SanitizedGrant {
  return {
    ...productGrant(),
    action,
    actor: "dify-worker:lifecycle",
    azp: "dify-worker",
    callerKind: "internal_worker",
    resource: { id: "tenant-a", parent_id: null, type: "namespace" },
    subject: "dify-worker:lifecycle",
  };
}
