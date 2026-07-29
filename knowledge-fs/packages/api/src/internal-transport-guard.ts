import type { MiddlewareHandler } from "hono";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

/**
 * Reject browser-shaped requests on routes that are reachable only through the Dify API BFF.
 * Capability authentication remains the resource-level authorization boundary.
 */
export function createInternalTransportGuardMiddleware(): MiddlewareHandler<KnowledgeGatewayEnv> {
  return async (context, next) => {
    if (
      context.req.method === "OPTIONS" ||
      context.req.header("origin") !== undefined ||
      context.req.header("cookie") !== undefined
    ) {
      return context.json({ error: "Forbidden" }, 403);
    }
    await next();
  };
}
