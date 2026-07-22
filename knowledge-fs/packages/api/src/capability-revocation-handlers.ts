import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  type CapabilityGrantProvenanceRepository,
  CapabilityPublicationFencedError,
  CapabilityRevokeEventConflictError,
} from "./capability-grant-provenance";
import {
  fenceCapabilityKnowledgeSpaceRoute,
  revokeCapabilityGrantRoute,
} from "./capability-revocation-routes";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

const REVOKE_CONFLICT_CODE = "CAPABILITY_REVOKE_CONFLICT";

export function registerCapabilityRevocationHandlers(input: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly grants: CapabilityGrantProvenanceRepository;
}): void {
  input.app.openapi(revokeCapabilityGrantRoute, async (context) => {
    try {
      const body = context.req.valid("json");
      const result = await input.grants.applyGrantRevoke({
        ...body,
        grantId: context.req.valid("param").grantId,
        tenantId: context.get("subject").tenantId,
      });
      return context.json(result, 200);
    } catch (error) {
      return capabilityRevokeConflict(context, error);
    }
  });

  input.app.openapi(fenceCapabilityKnowledgeSpaceRoute, async (context) => {
    try {
      const result = await input.grants.applySpaceFence({
        ...context.req.valid("json"),
        knowledgeSpaceId: context.req.valid("param").id,
        tenantId: context.get("subject").tenantId,
      });
      return context.json(result, 200);
    } catch (error) {
      return capabilityRevokeConflict(context, error);
    }
  });
}

function capabilityRevokeConflict(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  error: unknown,
) {
  if (
    error instanceof CapabilityRevokeEventConflictError ||
    error instanceof CapabilityPublicationFencedError
  ) {
    return context.json(
      { code: REVOKE_CONFLICT_CODE, error: "Capability revoke conflicts with durable state" },
      409,
    );
  }
  throw error;
}
