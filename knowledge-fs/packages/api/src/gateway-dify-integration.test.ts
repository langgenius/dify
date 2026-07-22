import { createHash } from "node:crypto";

import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DifyCapabilityV2GatewayAuthenticator,
  DifyCapabilityV2SanitizedGrant,
} from "./dify-capability-v2";
import type { DifyIntegrationFreezeRepository } from "./dify-integration-freeze";
import type { DifyIntegrationStateRepository } from "./dify-integration-state";
import { createDifyCapabilityV2OrLegacyApiKeyMiddleware, createKnowledgeGateway } from "./index";

const originalNodeEnv = process.env.NODE_ENV;
const digest = `sha256:${"a".repeat(64)}`;
const activationId = canonicalActivationId(7, "tenant-a", digest);

afterEach(() => {
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("gateway Dify Workspace activation", () => {
  it.each([
    ["legacy API key", "Bearer kfs_key_secret", "legacy"],
    ["Capability v2", "Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature", "v2"],
    ["missing credential", undefined, "v2"],
  ])(
    "selects %s without accepting a broad legacy bearer",
    async (_name, authorization, expected) => {
      const app = new Hono();
      app.use(
        "*",
        createDifyCapabilityV2OrLegacyApiKeyMiddleware(
          async (context) => context.text("v2"),
          async (context) => context.text("legacy"),
        ),
      );

      const response = await app.request("/", {
        ...(authorization ? { headers: { authorization } } : {}),
      });
      expect(await response.text()).toBe(expected);
    },
  );

  it("registers the activation command and admits it before product traffic", async () => {
    const repository = repositoryWith(false);
    const grant = activationGrant();
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      difyCapabilityV2Auth: {
        authenticate: vi.fn<DifyCapabilityV2GatewayAuthenticator["authenticate"]>(async () => ({
          callerKind: grant.callerKind,
          claims: {} as never,
          grant,
          subject: {
            scopes: ["knowledge-spaces:write"],
            subjectId: grant.subject,
            tenantId: grant.namespaceId,
          },
        })),
      },
      difyIntegrationFreezes: freezeRepository(),
      difyIntegrationStates: repository,
    });

    const response = await app.request("/internal/dify-integration/activate", {
      body: JSON.stringify({
        activationId,
        activationRevision: 7,
        sourceRevisionDigest: digest,
      }),
      headers: {
        authorization: "Bearer capability",
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.activate).toHaveBeenCalledOnce();
  });

  it("blocks an inactive Workspace before a Capability v2 product handler runs", async () => {
    const repository = repositoryWith(false);
    const grant: DifyCapabilityV2SanitizedGrant = {
      ...activationGrant(),
      action: "knowledge_spaces.list",
      callerKind: "interactive",
      subject: "dify-account:user-a",
    };
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      difyCapabilityV2Auth: {
        authenticate: vi.fn<DifyCapabilityV2GatewayAuthenticator["authenticate"]>(async () => ({
          callerKind: "interactive",
          claims: {} as never,
          grant,
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "dify-account:user-a",
            tenantId: "tenant-a",
          },
        })),
      },
      difyIntegrationFreezes: freezeRepository(),
      difyIntegrationStates: repository,
    });

    expect(
      (
        await app.request("/knowledge-spaces", {
          headers: { authorization: "Bearer capability" },
        })
      ).status,
    ).toBe(403);
  });

  it("uses Capability-only auth and omits legacy ACL routes in the final P9 profile", async () => {
    const grant: DifyCapabilityV2SanitizedGrant = {
      ...activationGrant(),
      action: "knowledge_spaces.list",
      callerKind: "interactive",
      subject: "dify-account:user-a",
    };
    const authenticate = vi.fn<DifyCapabilityV2GatewayAuthenticator["authenticate"]>(
      async ({ token }) => {
        if (token.startsWith("kfs_")) throw new Error("legacy key rejected");
        return {
          callerKind: "interactive",
          claims: {} as never,
          grant,
          subject: {
            scopes: ["knowledge-spaces:read"],
            subjectId: grant.subject,
            tenantId: grant.namespaceId,
          },
        };
      },
    );
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      difyCapabilityV2Auth: { authenticate },
      difyIntegrationFreezes: freezeRepository(),
      difyIntegrationStates: repositoryWith(true),
      legacyAccessMutationsReadOnly: true,
      legacyAuthorizationRemoved: true,
    });

    expect(
      (
        await app.request("/knowledge-spaces", {
          headers: { authorization: "Bearer kfs_legacy_secret" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/knowledge-spaces", {
          headers: { authorization: "Bearer capability" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/knowledge-spaces/space-a/access-policy", {
          headers: { authorization: "Bearer capability" },
        })
      ).status,
    ).toBe(404);
  });

  it("rejects a partial legacy-authorization removal profile", () => {
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        difyCapabilityV2Auth: { authenticate: vi.fn() },
        difyIntegrationFreezes: freezeRepository(),
        difyIntegrationStates: repositoryWith(true),
        legacyAuthorizationRemoved: true,
      }),
    ).toThrow("Legacy authorization removal requires Capability v2");
  });

  it("requires durable activation for production Capability v2", () => {
    process.env.NODE_ENV = "production";

    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        capabilityGrantProvenance: {
          admit: vi.fn(),
          applyGrantRevoke: vi.fn(),
          applySpaceFence: vi.fn(),
          assertPublicationAllowed: vi.fn(),
          get: vi.fn(),
        },
        difyCapabilityV2Auth: { authenticate: vi.fn() },
        knowledgeSpaceProvisioning: { provision: vi.fn() },
      }),
    ).toThrow("Durable per-Workspace integration activation is required");
  });

  it("will not expose integrated provisioning without the per-Workspace gate", () => {
    expect(() =>
      createKnowledgeGateway({
        adapter: createNodePlatformAdapter({ env: {} }),
        difyCapabilityV2Auth: { authenticate: vi.fn() },
        integratedKnowledgeSpaceProvisioning: {
          provision: vi.fn(),
          provisioningMode: "integrated",
        },
      }),
    ).toThrow(
      "Integrated provisioning requires Capability v2, durable freeze, and per-Workspace activation",
    );
  });
});

function repositoryWith(active: boolean) {
  const state = {
    activatedAt: "2026-07-21T12:00:00.000Z",
    activationId,
    activationRevision: 7,
    namespaceId: "tenant-a",
    sourceRevisionDigest: digest,
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
  return {
    activate: vi.fn(async () => ({ applied: true, replayed: false, state })),
    get: vi.fn(async () => (active ? state : null)),
  } satisfies DifyIntegrationStateRepository;
}

function freezeRepository(): DifyIntegrationFreezeRepository {
  return {
    freeze: vi.fn(),
    get: vi.fn(async () => ({
      freezeId: `sha256:${"b".repeat(64)}`,
      freezeRevision: 6,
      frozenAt: "2026-07-21T11:55:00.000Z",
      namespaceId: "tenant-a",
      sourceRevisionDigest: digest,
      sourceTaskWatermark: 3,
      updatedAt: "2026-07-21T11:55:00.000Z",
    })),
  };
}

function activationGrant(): DifyCapabilityV2SanitizedGrant {
  return {
    action: "dify_integration.activate",
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
    grantId: activationId,
    issuedAt: 1,
    jtiHash: `sha256:${"f".repeat(64)}`,
    namespaceId: "tenant-a",
    notBefore: 1,
    resource: { id: "tenant-a", parent_id: null, type: "namespace" },
    subject: "dify-worker:lifecycle",
    traceId: activationId,
  };
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
