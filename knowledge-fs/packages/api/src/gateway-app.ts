import { OpenAPIHono } from "@hono/zod-openapi";

import { handleGatewayError, handleGatewayNotFound } from "./gateway-error-handlers";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { knowledgeGatewayBearerSecurityScheme } from "./gateway-openapi-document";

export function createKnowledgeGatewayApp(): OpenAPIHono<KnowledgeGatewayEnv> {
  const app = new OpenAPIHono<KnowledgeGatewayEnv>();
  app.openAPIRegistry.registerComponent(
    "securitySchemes",
    "bearerAuth",
    knowledgeGatewayBearerSecurityScheme,
  );
  app.onError(handleGatewayError);
  app.notFound(handleGatewayNotFound);
  return app;
}
