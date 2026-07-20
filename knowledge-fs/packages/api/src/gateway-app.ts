import { OpenAPIHono } from "@hono/zod-openapi";

import { handleGatewayError, handleGatewayNotFound } from "./gateway-error-handlers";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

export function createKnowledgeGatewayApp(): OpenAPIHono<KnowledgeGatewayEnv> {
  const app = new OpenAPIHono<KnowledgeGatewayEnv>();
  app.onError(handleGatewayError);
  app.notFound(handleGatewayNotFound);
  return app;
}
