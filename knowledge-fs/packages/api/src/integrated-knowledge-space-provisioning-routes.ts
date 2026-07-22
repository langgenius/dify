import { createRoute, z } from "@hono/zod-openapi";

import { KnowledgeSpaceCreationResponseSchema } from "./core-resource-response-schemas";
import { UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import { CreateKnowledgeSpaceSchema } from "./knowledge-space-golden-question-schemas";

export const IntegratedKnowledgeSpaceProvisioningRequestSchema =
  CreateKnowledgeSpaceSchema.required({
    idempotencyKey: true,
  });

const IntegratedKnowledgeSpaceProvisioningResponseSchema =
  KnowledgeSpaceCreationResponseSchema.extend({
    replayed: z.boolean(),
  });

export const provisionIntegratedKnowledgeSpaceRoute = createRoute({
  method: "post",
  operationId: "provisionIntegratedKnowledgeSpace",
  path: "/internal/knowledge-spaces/provision",
  request: {
    body: {
      content: {
        "application/json": { schema: IntegratedKnowledgeSpaceProvisioningRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: IntegratedKnowledgeSpaceProvisioningResponseSchema },
      },
      description: "Created or replayed a Dify-integrated technical knowledge space",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "The slug or idempotency key conflicts with another provisioning intent",
    },
    429: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space capacity exceeded",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "The atomic integrated provisioning aggregate is incomplete",
    },
    401: UnauthorizedResponse,
  },
  tags: ["Internal Knowledge Spaces"],
});
