import { createRoute, z } from "@hono/zod-openapi";

import { UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const DifyIntegrationActivationRequestSchema = z
  .object({
    activationId: Sha256DigestSchema,
    activationRevision: z.number().int().positive().safe(),
    sourceRevisionDigest: Sha256DigestSchema,
  })
  .strict();

const DifyIntegrationActivationResponseSchema = DifyIntegrationActivationRequestSchema.extend({
  activatedAt: z.string().datetime(),
  active: z.literal(true),
  applied: z.boolean(),
  namespaceId: z.string().min(1).max(255),
  replayed: z.boolean(),
  updatedAt: z.string().datetime(),
});

export const activateDifyIntegrationRoute = createRoute({
  method: "post",
  operationId: "activateDifyWorkspaceIntegration",
  path: "/internal/dify-integration/activate",
  request: {
    body: {
      content: {
        "application/json": { schema: DifyIntegrationActivationRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: DifyIntegrationActivationResponseSchema } },
      description: "Persisted or replayed monotonic Dify Workspace integration activation",
    },
    401: UnauthorizedResponse,
    403: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "The Capability is not the exact internal activation grant",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "The activation revision or evidence conflicts with durable state",
    },
  },
  tags: ["Internal Dify Integration"],
});
