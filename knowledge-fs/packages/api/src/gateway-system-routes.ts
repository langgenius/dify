import { createRoute, z } from "@hono/zod-openapi";

const GatewaySystemStatusSchema = z.object({
  ok: z.boolean(),
  runtime: z.enum(["cloudflare-workers", "node-docker"]),
  components: z.record(z.string(), z.boolean()),
});

export const healthRoute = createRoute({
  method: "get",
  operationId: "getHealth",
  path: "/health",
  security: [],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GatewaySystemStatusSchema,
        },
      },
      description: "Platform component health",
    },
  },
});

export const readinessRoute = createRoute({
  method: "get",
  operationId: "getReadiness",
  path: "/ready",
  security: [],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GatewaySystemStatusSchema,
        },
      },
      description: "Deployment is ready to receive traffic",
    },
    503: {
      content: {
        "application/json": {
          schema: GatewaySystemStatusSchema,
        },
      },
      description: "Deployment is not ready to receive traffic",
    },
  },
});
