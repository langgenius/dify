import type { OpenAPIHono } from "@hono/zod-openapi";

import { activateDifyIntegrationRoute } from "./dify-integration-activation-routes";
import type { DifyIntegrationFreezeRepository } from "./dify-integration-freeze";
import {
  DifyIntegrationActivationConflictError,
  type DifyIntegrationStateRepository,
  computeDifyIntegrationActivationId,
} from "./dify-integration-state";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

export function registerDifyIntegrationActivationHandlers(input: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly freezes: DifyIntegrationFreezeRepository;
  readonly repository: DifyIntegrationStateRepository;
}): void {
  input.app.openapi(activateDifyIntegrationRoute, async (context) => {
    const subject = context.get("subject");
    const grant = context.get("capabilityV2Grant");
    if (
      !grant ||
      grant.action !== "dify_integration.activate" ||
      grant.callerKind !== "internal_worker" ||
      grant.namespaceId !== subject.tenantId ||
      grant.resource.type !== "namespace" ||
      grant.resource.id !== subject.tenantId
    ) {
      return context.json({ error: "Forbidden" }, 403);
    }
    const body = context.req.valid("json");
    const expectedActivationId = computeDifyIntegrationActivationId({
      activationRevision: body.activationRevision,
      namespaceId: subject.tenantId,
      sourceRevisionDigest: body.sourceRevisionDigest,
    });
    if (
      body.activationId !== expectedActivationId ||
      body.activationId !== grant.grantId ||
      body.activationId !== grant.traceId
    ) {
      return context.json({ error: "Forbidden" }, 403);
    }
    const freeze = await input.freezes.get(subject.tenantId);
    if (!freeze) {
      return context.json({ code: "DIFY_INTEGRATION_FREEZE_REQUIRED", error: "Conflict" }, 409);
    }
    try {
      const result = await input.repository.activate({
        ...body,
        namespaceId: subject.tenantId,
      });
      return context.json(
        {
          ...result.state,
          active: true as const,
          applied: result.applied,
          replayed: result.replayed,
        },
        200,
      );
    } catch (error) {
      if (error instanceof DifyIntegrationActivationConflictError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }
      throw error;
    }
  });
}
