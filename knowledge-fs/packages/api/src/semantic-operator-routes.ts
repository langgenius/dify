import { createRoute } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";
import {
  ExtractSemanticEntitiesBodySchema,
  MaterializeSemanticCommunitiesBodySchema,
  MaterializeTopicViewBodySchema,
  SemanticCommunityMaterializationResponseSchema,
  SemanticEntityExtractionResponseSchema,
  TopicViewMaterializationResponseSchema,
} from "./semantic-operator-schemas";

export const materializeTopicViewRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/semantic-views/topic/materialize",
  request: {
    body: {
      content: {
        "application/json": {
          schema: MaterializeTopicViewBodySchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: TopicViewMaterializationResponseSchema,
        },
      },
      description: "Materialized KnowledgeFS topic view",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid topic materialization request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Server-issued semantic authorization context is unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const extractSemanticEntitiesRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/semantic-views/entities/extract",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ExtractSemanticEntitiesBodySchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SemanticEntityExtractionResponseSchema,
        },
      },
      description: "Extracted and indexed semantic entities",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid entity extraction request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Server-issued semantic authorization context is unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const materializeSemanticCommunitiesRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/semantic-views/communities/materialize",
  request: {
    body: {
      content: {
        "application/json": {
          schema: MaterializeSemanticCommunitiesBodySchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SemanticCommunityMaterializationResponseSchema,
        },
      },
      description: "Materialized KnowledgeFS community view",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid community materialization request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Server-issued semantic authorization context is unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
