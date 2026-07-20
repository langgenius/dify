import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import {
  KnowledgeSpaceProfileAuditListResponseSchema,
  KnowledgeSpaceProfileAuditParamsSchema,
  KnowledgeSpaceProfileAuditQuerySchema,
} from "./knowledge-space-profile-audit-schemas";

export const KnowledgeSpaceProfileAuditUnavailableResponseSchema = z
  .object({
    code: z.literal("KNOWLEDGE_SPACE_PROFILE_AUDIT_UNAVAILABLE"),
    error: z.literal("Knowledge-space profile audit is unavailable"),
    retryable: z.literal(true),
  })
  .strict();

export const listKnowledgeSpaceProfileRevisionsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/profiles/{kind}/revisions",
  request: {
    params: KnowledgeSpaceProfileAuditParamsSchema,
    query: KnowledgeSpaceProfileAuditQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceProfileAuditListResponseSchema,
        },
      },
      description: "Bounded immutable knowledge-space profile revision audit history",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid profile kind, revision cursor, or list limit",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceProfileAuditUnavailableResponseSchema,
        },
      },
      description: "Profile audit repository is unavailable or returned invalid data",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
