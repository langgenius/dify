import { createRoute, z } from "@hono/zod-openapi";

import { GoldenQuestionResponseSchema } from "./core-resource-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { CreateProductionBadCaseSchema, ErrorResponseSchema } from "./gateway-route-schemas";
import {
  AnnotateGoldenQuestionSchema,
  BulkImportGoldenQuestionsResponseSchema,
  BulkImportGoldenQuestionsSchema,
  CreateGoldenQuestionSchema,
  GoldenQuestionParamsSchema,
  KnowledgeSpaceParamsSchema,
  ListGoldenQuestionsQuerySchema,
  MatchGoldenQuestionEvidenceResponseSchema,
  MatchGoldenQuestionEvidenceSchema,
  UpdateGoldenQuestionSchema,
} from "./knowledge-space-golden-question-schemas";

export const createGoldenQuestionRoute = createRoute({
  method: "post",
  operationId: "createGoldenQuestion",
  path: "/knowledge-spaces/{id}/golden-questions",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateGoldenQuestionSchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: GoldenQuestionResponseSchema,
        },
      },
      description: "Created golden question",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    429: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Golden question capacity exceeded",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const matchGoldenQuestionEvidenceRoute = createRoute({
  method: "post",
  operationId: "matchGoldenQuestionEvidence",
  path: "/knowledge-spaces/{id}/golden-questions/evidence-matches",
  request: {
    body: {
      content: {
        "application/json": {
          schema: MatchGoldenQuestionEvidenceSchema,
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
          schema: MatchGoldenQuestionEvidenceResponseSchema,
        },
      },
      description: "Evidence candidates for golden questions",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Evidence matching unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const bulkImportGoldenQuestionsRoute = createRoute({
  method: "post",
  operationId: "bulkImportGoldenQuestions",
  path: "/knowledge-spaces/{id}/golden-questions/bulk-import",
  request: {
    body: {
      content: {
        "application/json": {
          schema: BulkImportGoldenQuestionsSchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: BulkImportGoldenQuestionsResponseSchema,
        },
      },
      description: "Imported golden questions",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    429: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Golden question capacity exceeded",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Evidence matching unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listGoldenQuestionsRoute = createRoute({
  method: "get",
  operationId: "listGoldenQuestions",
  path: "/knowledge-spaces/{id}/golden-questions",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: ListGoldenQuestionsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(GoldenQuestionResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Knowledge space golden questions",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid golden question list request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getGoldenQuestionRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/golden-questions/{questionId}",
  request: {
    params: GoldenQuestionParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GoldenQuestionResponseSchema,
        },
      },
      description: "Golden question",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Golden question not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const updateGoldenQuestionRoute = createRoute({
  method: "patch",
  operationId: "updateGoldenQuestion",
  path: "/knowledge-spaces/{id}/golden-questions/{questionId}",
  request: {
    body: {
      content: {
        "application/json": {
          schema: UpdateGoldenQuestionSchema,
        },
      },
      required: true,
    },
    params: GoldenQuestionParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GoldenQuestionResponseSchema,
        },
      },
      description: "Updated golden question",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Golden question not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const annotateGoldenQuestionRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/golden-questions/{questionId}/annotations",
  request: {
    body: {
      content: {
        "application/json": {
          schema: AnnotateGoldenQuestionSchema,
        },
      },
      required: true,
    },
    params: GoldenQuestionParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GoldenQuestionResponseSchema,
        },
      },
      description: "Annotated golden question",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid annotation request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Golden question not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const deleteGoldenQuestionRoute = createRoute({
  method: "delete",
  operationId: "deleteGoldenQuestion",
  path: "/knowledge-spaces/{id}/golden-questions/{questionId}",
  request: {
    params: GoldenQuestionParamsSchema,
  },
  responses: {
    204: {
      description: "Deleted golden question",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Golden question not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const createProductionBadCaseRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/production-bad-cases",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateProductionBadCaseSchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: GoldenQuestionResponseSchema,
        },
      },
      description: "Captured production bad case queued for evaluation review",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space or answer trace not found",
    },
    429: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Golden question capacity exceeded",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
