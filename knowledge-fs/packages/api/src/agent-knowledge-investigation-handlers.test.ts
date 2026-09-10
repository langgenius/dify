import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import { registerAgentKnowledgeInvestigationHandlers } from "./agent-knowledge-investigation-handlers";
import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "10000000-0000-4000-8000-000000000002";

function capability(
  callerKind: DifyCapabilityV2SanitizedGrant["callerKind"] = "agent",
): DifyCapabilityV2SanitizedGrant {
  return {
    action: "queries.agent_investigation.capture",
    actor: "user-1",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "workflow-app",
    callerKind,
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds: ["tenant:tenant-1"],
    controlSpaceId: SPACE_ID,
    expiresAt: 9_999_999_999,
    grantId: "10000000-0000-4000-8000-000000000003",
    issuedAt: 1,
    jtiHash: "hash",
    namespaceId: "tenant-1",
    notBefore: 1,
    resource: { id: SPACE_ID, parent_id: null, type: "knowledge_space" },
    subject: "dify-app:workflow-app",
    traceId: "trace-1",
  };
}

function appWithGrant(grant: DifyCapabilityV2SanitizedGrant | undefined) {
  const app = new OpenAPIHono<KnowledgeGatewayEnv>();
  const capture = vi.fn(async () => ({
    traceId: EVENT_ID,
    outcome: "resolved" as const,
    records: [],
  }));
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: [],
      subjectId: "dify-app:workflow-app",
      tenantId: "tenant-1",
    });
    if (grant) context.set("capabilityV2Grant", grant);
    await next();
  });
  registerAgentKnowledgeInvestigationHandlers({
    app,
    service: { capture },
    spaces: {
      get: vi.fn(async () => ({ id: SPACE_ID, tenantId: "tenant-1" })) as never,
    },
  });
  return { app, capture };
}

function request(app: OpenAPIHono<KnowledgeGatewayEnv>, duplicate = false) {
  const attempt = {
    command_id: EVENT_ID,
    control_space_id: SPACE_ID,
    command: "search",
    query: "refund",
    path: "",
    outcome: "empty",
    code: null,
    delivered: true,
    evidence: "",
    receipt_ids: [],
    trace_id: null,
    authorization_fingerprint: "a".repeat(64),
    started_at_ms: 1,
    elapsed_ms: 3,
  };
  return app.request(`/knowledge-spaces/${SPACE_ID}/agent-investigations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      investigationId: EVENT_ID,
      status: "completed",
      query: "refund",
      answer: "unknown",
      attempts: duplicate ? [attempt, attempt] : [attempt],
    }),
  });
}

describe("Agent investigation capability boundary", () => {
  it.each(["agent", "workflow", "interactive"] as const)(
    "supports %s with the dedicated action",
    async (kind) => {
      const { app, capture } = appWithGrant(capability(kind));
      expect((await request(app)).status).toBe(200);
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateGrants: ["tenant:tenant-1"],
          actorSubjectId: "dify-app:workflow-app",
          investigationId: EVENT_ID,
        }),
      );
    },
  );
  it.each([
    undefined,
    capability("service"),
    { ...capability(), action: "queries.failed_retrieval.capture" },
    { ...capability(), namespaceId: "other-tenant" },
    { ...capability(), subject: "different" },
  ])("rejects incorrect authority", async (grant) => {
    const { app, capture } = appWithGrant(grant);
    expect((await request(app)).status).toBe(403);
    expect(capture).not.toHaveBeenCalled();
  });
  it("rejects duplicate commands at the HTTP boundary", async () => {
    const { app, capture } = appWithGrant(capability());
    expect((await request(app, true)).status).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });
});
