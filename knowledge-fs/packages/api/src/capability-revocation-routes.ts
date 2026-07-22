import { createRoute, z } from "@hono/zod-openapi";

import { UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const IdSchema = z.string().uuid();
const ReasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_.:-]+$/u);
const RevokeSequenceSchema = z.number().int().positive();

const GrantRevokeParamsSchema = z.object({ grantId: IdSchema }).strict();
const SpaceFenceParamsSchema = z.object({ id: IdSchema }).strict();

const GrantRevokeRequestSchema = z
  .object({
    eventId: IdSchema,
    knowledgeSpaceId: IdSchema,
    reasonCode: ReasonCodeSchema,
    revokeSequence: RevokeSequenceSchema,
  })
  .strict();

const SpaceFenceRequestSchema = z
  .object({
    eventId: IdSchema,
    reasonCode: ReasonCodeSchema,
    revokeSequence: RevokeSequenceSchema,
    tombstoned: z.boolean(),
  })
  .strict();

const GrantRevokeResponseSchema = z
  .object({
    applied: z.boolean(),
    highestRevokeSequence: z.number().int().nonnegative(),
    state: z.enum(["active", "revoked"]),
  })
  .strict();

const SpaceFenceResponseSchema = z
  .object({
    applied: z.boolean(),
    highestRevokeSequence: z.number().int().nonnegative(),
    tombstoned: z.boolean(),
  })
  .strict();

const conflictResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "The event conflicts with prior monotonic authorization state",
} as const;

export const revokeCapabilityGrantRoute = createRoute({
  method: "post",
  operationId: "revokeCapabilityGrant",
  path: "/internal/capability-grants/{grantId}/revoke",
  request: {
    body: { content: { "application/json": { schema: GrantRevokeRequestSchema } }, required: true },
    params: GrantRevokeParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: GrantRevokeResponseSchema } },
      description: "Applied or idempotently observed a monotonic grant revoke",
    },
    409: conflictResponse,
    401: UnauthorizedResponse,
  },
  tags: ["Internal Capability Revocation"],
});

export const fenceCapabilityKnowledgeSpaceRoute = createRoute({
  method: "post",
  operationId: "fenceCapabilityKnowledgeSpace",
  path: "/internal/knowledge-spaces/{id}/capability-fence",
  request: {
    body: { content: { "application/json": { schema: SpaceFenceRequestSchema } }, required: true },
    params: SpaceFenceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SpaceFenceResponseSchema } },
      description: "Applied or idempotently observed a monotonic Space publication fence",
    },
    409: conflictResponse,
    401: UnauthorizedResponse,
  },
  tags: ["Internal Capability Revocation"],
});
