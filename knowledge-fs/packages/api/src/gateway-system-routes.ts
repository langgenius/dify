import { createRoute, z } from "@hono/zod-openapi";

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean(),
            runtime: z.enum(["cloudflare-workers", "node-docker"]),
            components: z.record(z.string(), z.boolean()),
          }),
        },
      },
      description: "Platform component health",
    },
  },
});
