import { createRoute } from "@hono/zod-openapi";

import { DocumentCompilationJobParamsSchema } from "./document-request-schemas";
import { DocumentCompilationJobResponseSchema } from "./document-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

export const getDocumentCompilationJobRoute = createRoute({
  method: "get",
  path: "/jobs/{id}",
  request: {
    params: DocumentCompilationJobParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DocumentCompilationJobResponseSchema,
        },
      },
      description: "Document compilation job status",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document compilation job not found",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document compilation jobs unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const cancelDocumentCompilationJobRoute = createRoute({
  method: "delete",
  path: "/jobs/{id}",
  request: {
    params: DocumentCompilationJobParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DocumentCompilationJobResponseSchema,
        },
      },
      description: "Canceled document compilation job",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document compilation job not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document compilation job cannot be canceled",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document compilation jobs unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const retryDocumentCompilationJobRoute = createRoute({
  method: "post",
  path: "/jobs/{id}/retry",
  request: {
    params: DocumentCompilationJobParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DocumentCompilationJobResponseSchema,
        },
      },
      description: "Reactivated document compilation attempt",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document compilation job not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document compilation job cannot be retried",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document compilation jobs unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
