import { createRoute, z } from "@hono/zod-openapi";
import { KnowledgeSpaceModelSelectionSchema } from "@knowledge/core";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";
import {
  ModelCapabilityKindSchema,
  ModelCapabilitySnapshotSchema,
  ModelCatalogEntrySchema,
} from "./model-capability-preflight";

const ModelCapabilityErrorResponseSchema = ErrorResponseSchema.extend({
  code: z.string().min(1),
  retryable: z.boolean().optional(),
});

export const listKnowledgeSpaceModelCatalogRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/model-catalog",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: z
      .object({
        cursor: z.string().min(1).max(1024).optional(),
        kind: ModelCapabilityKindSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict(),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(ModelCatalogEntrySchema).max(100),
            nextCursor: z.string().min(1).max(1024).optional(),
          }),
        },
      },
      description: "Tenant-installed plugin-daemon model catalog",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ModelCapabilityErrorResponseSchema } },
      description: "Model catalog unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const preflightKnowledgeSpaceModelRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/model-preflights",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              kind: ModelCapabilityKindSchema,
              selection: KnowledgeSpaceModelSelectionSchema,
            })
            .strict(),
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: ModelCapabilitySnapshotSchema } },
      description: "Observed model capability snapshot",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    422: {
      content: { "application/json": { schema: ModelCapabilityErrorResponseSchema } },
      description: "Model selection or observed capability is invalid",
    },
    503: {
      content: { "application/json": { schema: ModelCapabilityErrorResponseSchema } },
      description: "Model capability preflight unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
