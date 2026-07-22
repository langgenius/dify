import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const IdSchema = z.string().uuid();

export const IntegratedKnowledgeSpaceDeletionParamsSchema = z.object({ id: IdSchema }).strict();

export const IntegratedKnowledgeSpaceDeletionRequestSchema = z
  .object({
    controlSpaceId: IdSchema,
    expectedRevision: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    idempotencyKey: z.string().trim().min(1).max(255),
    operationId: IdSchema,
    provisioningKey: z.string().trim().min(1).max(255),
  })
  .strict();

export const IntegratedKnowledgeSpaceDeletionProgressSchema = z
  .object({
    irreversibleAt: z.string().datetime().optional(),
    phase: z.enum(["accepted", "irreversible", "completed"]),
    revision: z.number().int().positive(),
  })
  .strict();

const progressResponse = {
  content: {
    "application/json": { schema: IntegratedKnowledgeSpaceDeletionProgressSchema },
  },
  description: "Current durable integrated-deletion progress",
} as const;

const conflictResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Revision, idempotency, or durable deletion state conflict",
} as const;

export const deleteIntegratedKnowledgeSpaceRoute = createRoute({
  method: "post",
  operationId: "deleteIntegratedKnowledgeSpace",
  path: "/internal/knowledge-spaces/{id}/delete",
  request: {
    body: {
      content: {
        "application/json": { schema: IntegratedKnowledgeSpaceDeletionRequestSchema },
      },
      required: true,
    },
    params: IntegratedKnowledgeSpaceDeletionParamsSchema,
  },
  responses: {
    200: progressResponse,
    202: progressResponse,
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid integrated deletion request",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    409: conflictResponse,
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Durable deletion is unavailable or terminally failed",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
  tags: ["Internal Knowledge Spaces"],
});

export type IntegratedKnowledgeSpaceDeletionRequest = z.infer<
  typeof IntegratedKnowledgeSpaceDeletionRequestSchema
>;
export type IntegratedKnowledgeSpaceDeletionProgress = z.infer<
  typeof IntegratedKnowledgeSpaceDeletionProgressSchema
>;
