import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { registerWorkflowFailedRetrievalHandlers } from "./workflow-failed-retrieval-handlers";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "10000000-0000-4000-8000-000000000002";

function capability(
  callerKind: DifyCapabilityV2SanitizedGrant["callerKind"] = "workflow",
): DifyCapabilityV2SanitizedGrant {
  return {
    action: "queries.failed_retrieval.capture",
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
  const capture = vi.fn(async () => ({ failedQueryId: EVENT_ID, verdict: "irrelevant" as const }));
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: [],
      subjectId: "dify-app:workflow-app",
      tenantId: "tenant-1",
    });
    if (grant) context.set("capabilityV2Grant", grant);
    await next();
  });
  registerWorkflowFailedRetrievalHandlers({
    app,
    service: { capture },
    spaces: {
      get: vi.fn(async () => ({ id: SPACE_ID, tenantId: "tenant-1" })) as never,
    },
  });
  return { app, capture };
}

function request(app: OpenAPIHono<KnowledgeGatewayEnv>, retrievalTraceId = "retrieval-trace-1") {
  return app.request(`/knowledge-spaces/${SPACE_ID}/failed-queries/workflow-retrieval-misses`, {
    body: JSON.stringify({
      eventId: EVENT_ID,
      mode: "deep",
      query: "发票号码在哪里？",
      retrievalTraceId,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("workflow failed-retrieval handlers", () => {
  it("accepts only the exact workflow Capability and forwards its durable grant", async () => {
    const { app, capture } = appWithGrant(capability());
    const response = await request(app);

    expect(response.status).toBe(200);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityGrantId: "10000000-0000-4000-8000-000000000003",
        eventId: EVENT_ID,
        knowledgeSpaceId: SPACE_ID,
      }),
    );
  });

  it.each([undefined, capability("interactive")])(
    "rejects missing or non-workflow Capability provenance",
    async (grant) => {
      const { app, capture } = appWithGrant(grant);
      const response = await request(app);

      expect(response.status).toBe(403);
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it("accepts the full retrieval response trace-id contract", async () => {
    const { app, capture } = appWithGrant(capability());
    const accepted = await request(app, `追踪-${"x".repeat(509)}`);
    const rejected = await request(app, "x".repeat(513));

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
