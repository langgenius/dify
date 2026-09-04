import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { registerNamespaceSourcePreviewHandlers } from "./namespace-source-preview-handlers";

const knowledgeSpaceId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const previewJobId = "33333333-3333-4333-8333-333333333333";
const workflowId = "44444444-4444-4444-8444-444444444444";

describe("namespace website source preview handlers", () => {
  it("forwards the admitted capability principal to the import workflow", async () => {
    const consume = vi.fn(async () => workflowId);
    const app = new OpenAPIHono<KnowledgeGatewayEnv>();
    app.use("*", async (context, next) => {
      context.set("subject", {
        scopes: [],
        subjectId: "account-1",
        tenantId: "tenant-1",
      });
      context.set("callerKind", "interactive");
      context.set("capabilityV2Grant", {
        contentScopeIds: ["tenant:tenant-1", `source:${sourceId}`],
        grantId: "capability-grant-1",
      } as never);
      await next();
    });
    registerNamespaceSourcePreviewHandlers({
      app,
      service: { consume } as never,
    });

    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/sources/${sourceId}/namespace-preview-import`,
      {
        body: JSON.stringify({
          configurationFingerprint: "f".repeat(64),
          pageIds: ["page-1"],
          previewJobId,
        }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "preview-import-1",
        },
        method: "POST",
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ workflowId });
    expect(consume).toHaveBeenCalledWith(
      {
        callerKind: "interactive",
        capability: {
          contentScopeIds: ["tenant:tenant-1", `source:${sourceId}`],
          grantId: "capability-grant-1",
        },
        subject: {
          scopes: [],
          subjectId: "account-1",
          tenantId: "tenant-1",
        },
      },
      {
        configurationFingerprint: "f".repeat(64),
        idempotencyKey: "preview-import-1",
        jobId: previewJobId,
        knowledgeSpaceId,
        pageIds: ["page-1"],
        sourceId,
      },
    );
  });
});
