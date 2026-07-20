import { createRoute, z } from "@hono/zod-openapi";

import { FailedQueryResponseSchema } from "./core-resource-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const DEFAULT_FAILED_QUERY_LIST_LIMIT = 50;

export const FailedQuerySpaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const FailedQueryParamsSchema = z.object({
  failedQueryId: z.string().uuid(),
  id: z.string().uuid(),
});

export const AnnotateFailedQuerySchema = z
  .object({
    expectedEvidenceIds: z.array(z.string().uuid()).max(100).optional(),
    note: z.string().max(2000).optional(),
    verdict: z.enum(["retrieval-miss", "coverage-gap", "irrelevant"]),
  })
  .strict();

export const annotateFailedQueryRoute = createRoute({
  method: "patch",
  path: "/knowledge-spaces/{id}/failed-queries/{failedQueryId}",
  request: {
    body: {
      content: { "application/json": { schema: AnnotateFailedQuerySchema } },
      required: true,
    },
    params: FailedQueryParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: FailedQueryResponseSchema } },
      description: "Annotated failed query (promoted to a golden question for retrieval-miss)",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space or failed query not found",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Failed query was already promoted with different annotation input",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const ListFailedQueriesQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.preprocess(
      (value) => (value === undefined ? DEFAULT_FAILED_QUERY_LIST_LIMIT : value),
      z.coerce.number().int().min(1).max(200),
    ),
    status: z
      .enum([
        "pending-triage",
        "triaged",
        "pending-annotation",
        "annotated",
        "dismissed",
        "promoted",
      ])
      .optional(),
  })
  .strict();

const FailedQueryMetricsResponseSchema = z
  .object({
    byStatus: z.object({
      annotated: z.number(),
      dismissed: z.number(),
      "pending-annotation": z.number(),
      "pending-triage": z.number(),
      promoted: z.number(),
      triaged: z.number(),
    }),
    promotionRate: z.number(),
    total: z.number(),
  })
  .openapi("FailedQueryMetrics");

export const metricsFailedQueriesRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/failed-queries/metrics",
  request: {
    params: FailedQuerySpaceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: FailedQueryMetricsResponseSchema } },
      description: "Failed-query counts by status and the golden-question promotion rate",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const ClusterFailedQueriesQuerySchema = z
  .object({
    limit: z.preprocess(
      (value) => (value === undefined ? 200 : value),
      z.coerce.number().int().min(1).max(1000),
    ),
    status: z
      .enum([
        "pending-triage",
        "triaged",
        "pending-annotation",
        "annotated",
        "dismissed",
        "promoted",
      ])
      .optional(),
  })
  .strict();

const FailedQueryClusterSchema = z.object({
  clusterKey: z.string(),
  count: z.number(),
  failedQueryIds: z.array(z.string()),
  representative: FailedQueryResponseSchema,
});

export const clusterFailedQueriesRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/failed-queries/clusters",
  request: {
    params: FailedQuerySpaceParamsSchema,
    query: ClusterFailedQueriesQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z
            .object({ clusters: z.array(FailedQueryClusterSchema) })
            .openapi("FailedQueryClusters"),
        },
      },
      description: "Failed queries grouped into clusters, most frequent first",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const TriageFailedQueriesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

const TriageFailedQueriesResponseSchema = z
  .object({
    triaged: z.number(),
    verdicts: z.object({
      "coverage-gap": z.number(),
      irrelevant: z.number(),
      "retrieval-miss": z.number(),
      uncertain: z.number(),
    }),
  })
  .openapi("FailedQueryTriageResult");

export const triageFailedQueriesRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/failed-queries/triage",
  request: {
    params: FailedQuerySpaceParamsSchema,
    query: TriageFailedQueriesQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: TriageFailedQueriesResponseSchema } },
      description: "Triaged a batch of pending failed queries",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    501: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Relevance triage is not configured",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listFailedQueriesRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/failed-queries",
  request: {
    params: FailedQuerySpaceParamsSchema,
    query: ListFailedQueriesQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(FailedQueryResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Knowledge space failed queries",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid failed-query list request",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
