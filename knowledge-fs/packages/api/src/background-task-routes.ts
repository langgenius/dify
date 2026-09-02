import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema, KnowledgeFsPublicFailureSchema } from "./gateway-route-schemas";

export const BackgroundTaskKindSchema = z.enum(["document", "document_bulk", "source"]);
export const BackgroundTaskStateSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export const BackgroundTaskOperationSchema = z.enum([
  "document_processing",
  "document_upload",
  "document_delete",
  "document_reindex",
  "source_crawl_preview",
  "source_crawl_import",
  "source_online_document_import",
  "source_online_drive_import",
  "source_sync",
  "source_bulk",
]);
export const BackgroundTaskSchema = z.object({
  activeOperations: z
    .array(
      z.enum([
        "parse",
        "outline_summary",
        "chunk",
        "fts_index",
        "embedding",
        "graph_admission",
        "publication",
      ]),
    )
    .optional(),
  canCancel: z.boolean(),
  canRetry: z.boolean(),
  completedAt: z.string().optional(),
  createdAt: z.string(),
  documentId: z.string().uuid().optional(),
  documentTitle: z.string().min(1).optional(),
  documentRevision: z.number().int().positive().optional(),
  errorCode: KnowledgeFsPublicFailureSchema.shape.code.optional(),
  errorMessage: KnowledgeFsPublicFailureSchema.shape.message.optional(),
  failure: KnowledgeFsPublicFailureSchema.optional(),
  failures: z
    .array(
      z
        .object({
          documentId: z.string().uuid(),
          documentTitle: z.string().optional(),
          errorCode: KnowledgeFsPublicFailureSchema.shape.code,
          errorMessage: KnowledgeFsPublicFailureSchema.shape.message,
          failure: KnowledgeFsPublicFailureSchema,
          jobId: z.string().uuid().optional(),
        })
        .strict(),
    )
    .optional(),
  id: z.string().uuid(),
  knowledgeSpaceId: z.string().uuid(),
  operation: BackgroundTaskOperationSchema,
  phase: z
    .enum([
      "queued",
      "parsing",
      "outline_summary",
      "chunking_indexing",
      "graph_admission",
      "publication",
      "complete",
    ])
    .optional(),
  progressCompleted: z.number().int().nonnegative(),
  progressFailed: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
  progressTotal: z.number().int().nonnegative(),
  sourceId: z.string().uuid().optional(),
  sourceTitle: z.string().min(1).optional(),
  state: BackgroundTaskStateSchema,
  semanticEnrichment: z
    .object({
      errorCode: KnowledgeFsPublicFailureSchema.shape.code.optional(),
      errorMessage: KnowledgeFsPublicFailureSchema.shape.message.optional(),
      failure: KnowledgeFsPublicFailureSchema.optional(),
      nodesCompleted: z.number().int().nonnegative(),
      nodesTotal: z.number().int().nonnegative().optional(),
      providerCalls: z.number().int().nonnegative().optional(),
      providerCallsMaximum: z.number().int().nonnegative().optional(),
      state: z.enum(["not_scheduled", "pending", "running", "ready", "failed", "disabled"]),
      updatedAt: z.string().optional(),
    })
    .strict()
    .optional(),
  taskKind: BackgroundTaskKindSchema,
  updatedAt: z.string(),
});

const SpaceParams = z.object({ id: z.string().uuid() });
const TaskParams = SpaceParams.extend({
  taskId: z.string().uuid(),
  taskKind: BackgroundTaskKindSchema,
});
const errors = {
  400: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Invalid background task request",
  },
  401: UnauthorizedResponse,
  403: ForbiddenResponse,
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Background task not found",
  },
  409: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Background task cannot perform this transition",
  },
} as const;

export const listBackgroundTasksRoute = createRoute({
  method: "get",
  operationId: "listBackgroundTasks",
  path: "/knowledge-spaces/{id}/background-tasks",
  request: {
    params: SpaceParams,
    query: z
      .object({
        cursor: z.string().max(8192).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict(),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(BackgroundTaskSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Newest durable document and source background tasks",
    },
    ...errors,
  },
});

export const cancelBackgroundTaskRoute = createRoute({
  method: "post",
  operationId: "cancelBackgroundTask",
  path: "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/cancel",
  request: { params: TaskParams },
  responses: {
    200: {
      content: { "application/json": { schema: BackgroundTaskSchema } },
      description: "Canceled background task",
    },
    ...errors,
  },
});

export const retryBackgroundTaskRoute = createRoute({
  method: "post",
  operationId: "retryBackgroundTask",
  path: "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/retry",
  request: { params: TaskParams },
  responses: {
    200: {
      content: { "application/json": { schema: BackgroundTaskSchema } },
      description: "Retried background task",
    },
    ...errors,
  },
});
