import { createRoute } from "@hono/zod-openapi";

import { AnswerTraceResponseSchema } from "./core-resource-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  AnswerTraceParamsSchema,
  ErrorResponseSchema,
  QueryVirtualTreeListQuerySchema,
} from "./gateway-route-schemas";
import { KnowledgeFsListResponseSchema } from "./knowledge-fs-response-schemas";

export const getAnswerTraceRoute = createRoute({
  method: "get",
  path: "/queries/{traceId}",
  request: {
    params: AnswerTraceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: AnswerTraceResponseSchema,
        },
      },
      description: "Answer trace",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Answer trace not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listQueryEvidenceRoute = createRoute({
  method: "get",
  path: "/queries/{traceId}/evidence",
  request: {
    params: AnswerTraceParamsSchema,
    query: QueryVirtualTreeListQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsListResponseSchema,
        },
      },
      description: "Query evidence virtual tree",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid query evidence request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Answer trace not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listQueryConflictsRoute = createRoute({
  method: "get",
  path: "/queries/{traceId}/conflicts",
  request: {
    params: AnswerTraceParamsSchema,
    query: QueryVirtualTreeListQuerySchema,
  },
  responses: listQueryEvidenceRoute.responses,
});

export const listQueryMissingRoute = createRoute({
  method: "get",
  path: "/queries/{traceId}/missing",
  request: {
    params: AnswerTraceParamsSchema,
    query: QueryVirtualTreeListQuerySchema,
  },
  responses: listQueryEvidenceRoute.responses,
});
