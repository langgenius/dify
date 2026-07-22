import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  DifyIntegrationFreezeConflictError,
  type DifyIntegrationFreezeRepository,
  computeDifyIntegrationFreezeId,
} from "./dify-integration-freeze";
import { freezeDifyIntegrationRoute } from "./dify-integration-freeze-routes";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

/** Register the Capability-only command that starts one Workspace maintenance freeze. */
export function registerDifyIntegrationFreezeHandlers(input: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly repository: DifyIntegrationFreezeRepository;
}): void {
  input.app.openapi(freezeDifyIntegrationRoute, async (context) => {
    const subject = context.get("subject");
    const grant = context.get("capabilityV2Grant");
    if (
      !grant ||
      grant.action !== "dify_integration.freeze" ||
      grant.callerKind !== "internal_worker" ||
      grant.namespaceId !== subject.tenantId ||
      grant.resource.type !== "namespace" ||
      grant.resource.id !== subject.tenantId
    ) {
      return context.json({ error: "Forbidden" }, 403);
    }
    const body = context.req.valid("json");
    const expectedFreezeId = computeDifyIntegrationFreezeId({
      freezeRevision: body.freezeRevision,
      namespaceId: subject.tenantId,
      sourceRevisionDigest: body.sourceRevisionDigest,
      sourceTaskWatermark: body.sourceTaskWatermark,
    });
    if (
      body.freezeId !== expectedFreezeId ||
      body.freezeId !== grant.grantId ||
      body.freezeId !== grant.traceId
    ) {
      return context.json({ error: "Forbidden" }, 403);
    }
    try {
      const result = await input.repository.freeze({
        ...body,
        namespaceId: subject.tenantId,
      });
      return context.json(
        {
          ...result.state,
          applied: result.applied,
          frozen: true as const,
          replayed: result.replayed,
        },
        200,
      );
    } catch (error) {
      if (error instanceof DifyIntegrationFreezeConflictError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }
      throw error;
    }
  });
}
