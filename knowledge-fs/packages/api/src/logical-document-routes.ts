import { createRoute } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import {
  BoundedCursorQuerySchema,
  DocumentChunkListQuerySchema,
  DocumentChunkListResponseSchema,
  DocumentChunkParamsSchema,
  DocumentChunkStateBodySchema,
  DocumentChunkStateChangeResponseSchema,
  DocumentProcessingTaskListSchema,
  DocumentProcessingTaskParamsSchema,
  DocumentProcessingTaskSchema,
  DocumentReindexAcceptedSchema,
  DocumentRevisionListResponseSchema,
  DocumentSettingsHeadSchema,
  LogicalDocumentListResponseSchema,
  LogicalDocumentParamsSchema,
  LogicalDocumentPublicSchema,
  LogicalDocumentRevisionParamsSchema,
  PatchDocumentSettingsSchema,
  PatchDocumentUserMetadataSchema,
  RollbackDocumentRevisionSchema,
} from "./logical-document-schemas";

const commonErrors = {
  401: UnauthorizedResponse,
  403: ForbiddenResponse,
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Document resource not found",
  },
} as const;

const invalidCursorError = {
  400: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Invalid pagination cursor",
  },
} as const;

export const listLogicalDocumentsRoute = createRoute({
  method: "get",
  operationId: "listLogicalDocuments",
  path: "/knowledge-spaces/{id}/logical-documents",
  request: {
    params: LogicalDocumentParamsSchema.pick({ id: true }),
    query: BoundedCursorQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: LogicalDocumentListResponseSchema } },
      description: "Logical documents",
    },
    ...invalidCursorError,
    ...commonErrors,
  },
});

export const getLogicalDocumentRoute = createRoute({
  method: "get",
  operationId: "getLogicalDocument",
  path: "/knowledge-spaces/{id}/logical-documents/{documentId}",
  request: { params: LogicalDocumentParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: LogicalDocumentPublicSchema } },
      description: "Logical document",
    },
    ...commonErrors,
  },
});

export const listDocumentRevisionsRoute = createRoute({
  method: "get",
  operationId: "listDocumentRevisions",
  path: "/knowledge-spaces/{id}/documents/{documentId}/revisions",
  request: { params: LogicalDocumentParamsSchema, query: BoundedCursorQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: DocumentRevisionListResponseSchema } },
      description: "Immutable document revision history",
    },
    ...invalidCursorError,
    ...commonErrors,
  },
});

export const rollbackDocumentRevisionRoute = createRoute({
  method: "post",
  operationId: "rollbackDocumentRevision",
  path: "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/rollback",
  request: {
    body: {
      content: { "application/json": { schema: RollbackDocumentRevisionSchema } },
      required: true,
    },
    params: LogicalDocumentRevisionParamsSchema,
  },
  responses: {
    202: {
      content: { "application/json": { schema: DocumentProcessingTaskSchema } },
      description: "Rollback candidate compilation accepted",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Document revision CAS conflict",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Rollback coordinator unavailable",
    },
    ...commonErrors,
  },
});

export const patchDocumentMetadataRoute = createRoute({
  method: "patch",
  operationId: "patchDocumentMetadata",
  path: "/knowledge-spaces/{id}/documents/{documentId}/metadata",
  request: {
    body: {
      content: { "application/json": { schema: PatchDocumentUserMetadataSchema } },
      required: true,
    },
    params: LogicalDocumentParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: LogicalDocumentPublicSchema } },
      description: "Updated user metadata",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Reserved or invalid metadata",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Metadata CAS conflict",
    },
    ...commonErrors,
  },
});

export const listDocumentChunksRoute = createRoute({
  method: "get",
  operationId: "listDocumentChunks",
  path: "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks",
  request: { params: LogicalDocumentRevisionParamsSchema, query: DocumentChunkListQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: DocumentChunkListResponseSchema } },
      description: "Revision-scoped chunks",
    },
    ...commonErrors,
  },
});

export const getDocumentChunkRoute = createRoute({
  method: "get",
  operationId: "getDocumentChunk",
  path: "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks/{chunkId}",
  request: { params: DocumentChunkParamsSchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: DocumentChunkListResponseSchema.shape.items.element },
      },
      description: "Revision-scoped chunk",
    },
    ...commonErrors,
  },
});

export const changeDocumentChunkStateRoute = createRoute({
  method: "post",
  operationId: "changeDocumentChunkState",
  path: "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks/{chunkId}/state",
  request: {
    body: {
      content: { "application/json": { schema: DocumentChunkStateBodySchema } },
      required: true,
    },
    params: DocumentChunkParamsSchema,
  },
  responses: {
    202: {
      content: { "application/json": { schema: DocumentChunkStateChangeResponseSchema } },
      description: "Candidate publication accepted",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid chunk state",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Candidate publication coordinator unavailable",
    },
    ...commonErrors,
  },
});

export const listSpaceProcessingTasksRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/processing-tasks",
  request: {
    params: LogicalDocumentParamsSchema.pick({ id: true }),
    query: BoundedCursorQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: DocumentProcessingTaskListSchema } },
      description: "Space processing tasks",
    },
    ...invalidCursorError,
    ...commonErrors,
  },
});

export const listDocumentProcessingTasksRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}/processing-tasks",
  request: { params: LogicalDocumentParamsSchema, query: BoundedCursorQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: DocumentProcessingTaskListSchema } },
      description: "Document processing tasks",
    },
    ...invalidCursorError,
    ...commonErrors,
  },
});

export const getDocumentProcessingTaskRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}",
  request: { params: DocumentProcessingTaskParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: DocumentProcessingTaskSchema } },
      description: "Processing task polling snapshot",
    },
    ...commonErrors,
  },
});

export const streamDocumentProcessingTaskRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}/events",
  request: { params: DocumentProcessingTaskParamsSchema },
  responses: {
    200: {
      content: { "text/event-stream": { schema: { type: "string" } } },
      description: "Progress SSE snapshot; reconnect using polling or Last-Event-ID",
    },
    ...commonErrors,
  },
});

export const cancelDocumentProcessingTaskRoute = createRoute({
  method: "delete",
  path: "/knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}",
  request: { params: DocumentProcessingTaskParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: DocumentProcessingTaskSchema } },
      description: "Canceled processing task",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Task cannot be canceled",
    },
    ...commonErrors,
  },
});

export const retryDocumentProcessingTaskRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}/retry",
  request: { params: DocumentProcessingTaskParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: DocumentProcessingTaskSchema } },
      description: "Retried processing task",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Task cannot be retried",
    },
    ...commonErrors,
  },
});

export const getDocumentSettingsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}/settings",
  request: { params: LogicalDocumentParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: DocumentSettingsHeadSchema } },
      description: "Active document index settings",
    },
    ...commonErrors,
  },
});

export const patchDocumentSettingsRoute = createRoute({
  method: "put",
  path: "/knowledge-spaces/{id}/documents/{documentId}/settings",
  request: {
    body: {
      content: { "application/json": { schema: PatchDocumentSettingsSchema } },
      required: true,
    },
    params: LogicalDocumentParamsSchema,
  },
  responses: {
    202: {
      content: { "application/json": { schema: DocumentReindexAcceptedSchema } },
      description: "Versioned settings reindex accepted",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Settings CAS conflict",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Settings reindex coordinator unavailable",
    },
    ...commonErrors,
  },
});
