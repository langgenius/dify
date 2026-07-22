import { createRoute } from "@hono/zod-openapi";

import {
  BulkDeleteDocumentsBodySchema,
  DeleteDocumentBodySchema,
  DeleteDocumentParamsSchema,
  DeleteKnowledgeSpaceBodySchema,
  DeleteKnowledgeSpaceParamsSchema,
  DeleteSourceBodySchema,
  DeleteSourceParamsSchema,
  DurableDeleteSourceQuerySchema,
  DurableDeletionIdempotencyHeadersSchema,
  DurableDeletionJobParamsSchema,
} from "./durable-deletion-request-schemas";
import {
  DurableBulkDeletionAcceptedResponseSchema,
  DurableDeletionAcceptedResponseSchema,
  DurableDeletionJobResponseSchema,
} from "./durable-deletion-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const AcceptedDeletionResponse = {
  content: {
    "application/json": {
      schema: DurableDeletionAcceptedResponseSchema,
    },
  },
  description: "Durable deletion accepted",
} as const;

const NotFoundResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Deletion target or job not found",
} as const;

const ConflictResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Challenge, revision, idempotency, or job-state conflict",
} as const;

const UnavailableResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Durable deletion service unavailable",
} as const;

export const requestKnowledgeSpaceDeletionRoute = createRoute({
  method: "delete",
  operationId: "requestKnowledgeSpaceDeletion",
  path: "/knowledge-spaces/{id}",
  request: {
    body: {
      content: { "application/json": { schema: DeleteKnowledgeSpaceBodySchema } },
      required: true,
    },
    headers: DurableDeletionIdempotencyHeadersSchema,
    params: DeleteKnowledgeSpaceParamsSchema,
  },
  responses: {
    202: AcceptedDeletionResponse,
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid deletion request",
    },
    404: NotFoundResponse,
    409: ConflictResponse,
    503: UnavailableResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const requestSourceDeletionRoute = createRoute({
  method: "delete",
  operationId: "requestSourceDeletion",
  path: "/knowledge-spaces/{id}/sources/{sourceId}",
  request: {
    body: {
      content: { "application/json": { schema: DeleteSourceBodySchema } },
      required: true,
    },
    headers: DurableDeletionIdempotencyHeadersSchema,
    params: DeleteSourceParamsSchema,
    query: DurableDeleteSourceQuerySchema,
  },
  responses: {
    202: AcceptedDeletionResponse,
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid deletion request",
    },
    404: NotFoundResponse,
    409: ConflictResponse,
    503: UnavailableResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const requestDocumentDeletionRoute = createRoute({
  method: "delete",
  operationId: "requestDocumentDeletion",
  path: "/knowledge-spaces/{id}/documents/{documentId}",
  request: {
    body: {
      content: { "application/json": { schema: DeleteDocumentBodySchema } },
      required: true,
    },
    headers: DurableDeletionIdempotencyHeadersSchema,
    params: DeleteDocumentParamsSchema,
  },
  responses: {
    202: AcceptedDeletionResponse,
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid deletion request",
    },
    404: NotFoundResponse,
    409: ConflictResponse,
    503: UnavailableResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const requestLogicalDocumentDeletionRoute = createRoute({
  method: "delete",
  operationId: "requestLogicalDocumentDeletion",
  path: "/knowledge-spaces/{id}/logical-documents/{documentId}",
  request: {
    body: {
      content: { "application/json": { schema: DeleteDocumentBodySchema } },
      required: true,
    },
    headers: DurableDeletionIdempotencyHeadersSchema,
    params: DeleteDocumentParamsSchema,
  },
  responses: {
    202: AcceptedDeletionResponse,
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid logical document deletion request",
    },
    404: NotFoundResponse,
    409: ConflictResponse,
    503: UnavailableResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const requestBulkDocumentDeletionRoute = createRoute({
  method: "delete",
  operationId: "requestBulkDocumentDeletion",
  path: "/knowledge-spaces/{id}/documents/bulk",
  request: {
    body: {
      content: { "application/json": { schema: BulkDeleteDocumentsBodySchema } },
      required: true,
    },
    headers: DurableDeletionIdempotencyHeadersSchema,
    params: DeleteKnowledgeSpaceParamsSchema,
  },
  responses: {
    202: {
      content: {
        "application/json": {
          schema: DurableBulkDeletionAcceptedResponseSchema,
        },
      },
      description: "Per-document durable deletions accepted",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid bulk deletion request",
    },
    404: NotFoundResponse,
    409: ConflictResponse,
    503: UnavailableResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getDurableDeletionJobRoute = createRoute({
  method: "get",
  operationId: "getDurableDeletionJob",
  path: "/deletion-jobs/{jobId}",
  request: { params: DurableDeletionJobParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: DurableDeletionJobResponseSchema } },
      description: "Durable deletion status",
    },
    404: NotFoundResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const retryDurableDeletionJobRoute = createRoute({
  method: "post",
  operationId: "retryDurableDeletionJob",
  path: "/deletion-jobs/{jobId}/retry",
  request: {
    headers: DurableDeletionIdempotencyHeadersSchema,
    params: DurableDeletionJobParamsSchema,
  },
  responses: {
    202: AcceptedDeletionResponse,
    404: NotFoundResponse,
    409: ConflictResponse,
    503: UnavailableResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
