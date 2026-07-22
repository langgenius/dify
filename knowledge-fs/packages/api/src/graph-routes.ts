import { createRoute } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema, GraphTraverseQuerySchema } from "./gateway-route-schemas";
import { GraphTraversalResponseSchema } from "./graph-traversal-responses";
import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";

export const traverseGraphRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/graph/traverse",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: GraphTraverseQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GraphTraversalResponseSchema,
        },
      },
      description: "Bounded graph traversal result",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space or graph entity not found",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Immutable published graph traversal is unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
