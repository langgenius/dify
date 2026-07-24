import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import {
  KnowledgeSpaceActivityResponseSchema,
  KnowledgeSpaceAttentionParamsSchema,
  KnowledgeSpaceAttentionResponseSchema,
  KnowledgeSpaceOverviewInventoryResponseSchema,
  KnowledgeSpaceOverviewParamsSchema,
  KnowledgeSpaceOverviewQueryOutcomesResponseSchema,
  KnowledgeSpaceOverviewStatsResponseSchema,
  KnowledgeSpaceOverviewWindowQuerySchema,
  KnowledgeSpaceProductHealthResponseSchema,
  ListKnowledgeSpaceActivityQuerySchema,
  ListKnowledgeSpaceAttentionQuerySchema,
  TransitionKnowledgeSpaceAttentionSchema,
} from "./knowledge-space-overview-schemas";

export const getKnowledgeSpaceOverviewStatsRoute = createRoute({
  method: "get",
  operationId: "getKnowledgeSpaceOverviewStats",
  path: "/knowledge-spaces/{id}/overview/stats",
  request: { params: KnowledgeSpaceOverviewParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceOverviewStatsResponseSchema } },
      description: "Bounded 24h, 7d and 30d product statistics",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge-space Overview backend is unavailable",
    },
  },
});

export const getKnowledgeSpaceOverviewQueryOutcomesRoute = createRoute({
  method: "get",
  operationId: "getKnowledgeSpaceOverviewQueryOutcomes",
  path: "/knowledge-spaces/{id}/overview/query-outcomes",
  request: {
    params: KnowledgeSpaceOverviewParamsSchema,
    query: KnowledgeSpaceOverviewWindowQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: KnowledgeSpaceOverviewQueryOutcomesResponseSchema },
      },
      description: "Requester-scoped query outcome totals, comparison, and bounded time series",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge-space Overview backend is unavailable",
    },
  },
});

export const getKnowledgeSpaceOverviewInventoryRoute = createRoute({
  method: "get",
  operationId: "getKnowledgeSpaceOverviewInventory",
  path: "/knowledge-spaces/{id}/overview/inventory",
  request: { params: KnowledgeSpaceOverviewParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceOverviewInventoryResponseSchema } },
      description: "Source, graph, and active index inventory",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge-space Overview backend is unavailable",
    },
  },
});

export const listKnowledgeSpaceOverviewAttentionRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaceOverviewAttention",
  path: "/knowledge-spaces/{id}/overview/attention",
  request: {
    params: KnowledgeSpaceOverviewParamsSchema,
    query: ListKnowledgeSpaceAttentionQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ items: z.array(KnowledgeSpaceAttentionResponseSchema) }),
        },
      },
      description: "Rule-backed Needs Attention findings",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid attention list request",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge-space Overview backend is unavailable",
    },
  },
});

export const transitionKnowledgeSpaceOverviewAttentionRoute = createRoute({
  method: "patch",
  operationId: "transitionKnowledgeSpaceOverviewAttention",
  path: "/knowledge-spaces/{id}/overview/attention/{issueKey}",
  request: {
    body: {
      content: { "application/json": { schema: TransitionKnowledgeSpaceAttentionSchema } },
      required: true,
    },
    params: KnowledgeSpaceAttentionParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceAttentionResponseSchema } },
      description: "CAS-updated attention state",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Attention revision conflict",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space or attention issue not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge-space Overview backend is unavailable",
    },
  },
});

export const listKnowledgeSpaceOverviewActivityRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaceOverviewActivity",
  path: "/knowledge-spaces/{id}/overview/activity",
  request: {
    params: KnowledgeSpaceOverviewParamsSchema,
    query: ListKnowledgeSpaceActivityQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(KnowledgeSpaceActivityResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Append-only product activity feed",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid activity filter or cursor",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge-space Overview backend is unavailable",
    },
  },
});

export const getKnowledgeSpaceProductHealthRoute = createRoute({
  method: "get",
  operationId: "getKnowledgeSpaceProductHealth",
  path: "/knowledge-spaces/{id}/overview/health",
  request: { params: KnowledgeSpaceOverviewParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceProductHealthResponseSchema } },
      description: "Stable product health contract",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge-space Overview backend is unavailable",
    },
  },
});
