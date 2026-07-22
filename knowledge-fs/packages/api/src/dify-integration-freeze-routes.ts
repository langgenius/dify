import { createRoute, z } from "@hono/zod-openapi";

import { UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const DifyIntegrationFreezeRequestSchema = z
  .object({
    freezeId: Sha256DigestSchema,
    freezeRevision: z.number().int().positive().safe(),
    sourceRevisionDigest: Sha256DigestSchema,
    sourceTaskWatermark: z.number().int().nonnegative().safe(),
  })
  .strict();

const DifyIntegrationFreezeResponseSchema = DifyIntegrationFreezeRequestSchema.extend({
  applied: z.boolean(),
  frozen: z.literal(true),
  frozenAt: z.string().datetime(),
  namespaceId: z.string().min(1).max(255),
  replayed: z.boolean(),
  updatedAt: z.string().datetime(),
});

export const freezeDifyIntegrationRoute = createRoute({
  method: "post",
  operationId: "freezeDifyWorkspaceIntegration",
  path: "/internal/dify-integration/freeze",
  request: {
    body: {
      content: {
        "application/json": { schema: DifyIntegrationFreezeRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: DifyIntegrationFreezeResponseSchema } },
      description: "Persisted or replayed Dify Workspace maintenance freeze",
    },
    401: UnauthorizedResponse,
    403: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "The Capability is not the exact internal freeze grant",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "The freeze revision or evidence conflicts with durable state",
    },
  },
  tags: ["Internal Dify Integration"],
});
