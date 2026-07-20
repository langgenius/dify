import { z } from "@hono/zod-openapi";

export const LogicalDocumentParamsSchema = z.object({
  documentId: z.string().uuid(),
  id: z.string().uuid(),
});

export const LogicalDocumentRevisionParamsSchema = LogicalDocumentParamsSchema.extend({
  revision: z.coerce.number().int().positive(),
});

export const DocumentChunkParamsSchema = LogicalDocumentRevisionParamsSchema.extend({
  chunkId: z.string().uuid(),
});

export const DocumentProcessingTaskParamsSchema = LogicalDocumentParamsSchema.extend({
  taskId: z.string().uuid(),
});

export const BoundedCursorQuerySchema = z
  .object({
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.preprocess(
      (value) => (value === undefined ? 50 : value),
      z.coerce.number().int().min(1).max(100),
    ),
  })
  .strict();

export const DocumentChunkListQuerySchema = BoundedCursorQuerySchema.extend({
  query: z.string().min(1).max(512).optional(),
}).strict();

export const LogicalDocumentActiveRevisionSchema = z
  .object({
    activatedAt: z.string().optional(),
    contentHash: z.string().length(64),
    createdAt: z.string(),
    documentAssetId: z.string().uuid(),
    documentAssetVersion: z.number().int().positive(),
    documentId: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    mimeType: z.string(),
    revision: z.number().int().positive(),
    sizeBytes: z.number().int().nonnegative(),
    state: z.enum(["candidate", "active", "superseded", "failed"]),
  })
  .strict()
  .openapi("LogicalDocumentRevision");

export const LogicalDocumentPublicSchema = z
  .object({
    active: LogicalDocumentActiveRevisionSchema.nullable(),
    activeRevision: z.number().int().positive().optional(),
    createdAt: z.string(),
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    providerItemId: z.string().optional(),
    rowVersion: z.number().int().nonnegative(),
    sourceId: z.string().uuid().optional(),
    status: z.enum(["pending", "ready", "failed", "deleting"]),
    title: z.string(),
    updatedAt: z.string(),
    userMetadata: z.record(z.unknown()),
  })
  .strict()
  .openapi("LogicalDocument");

export const LogicalDocumentListResponseSchema = z
  .object({
    items: z.array(LogicalDocumentPublicSchema),
    nextCursor: z.string().optional(),
  })
  .strict()
  .openapi("LogicalDocumentList");

export const DocumentRevisionListResponseSchema = z
  .object({
    items: z.array(LogicalDocumentActiveRevisionSchema),
    nextCursor: z.string().optional(),
  })
  .strict()
  .openapi("DocumentRevisionList");

export const PatchDocumentUserMetadataSchema = z
  .object({
    expectedRowVersion: z.number().int().nonnegative(),
    patch: z.record(z.unknown()),
  })
  .strict();

export const RollbackDocumentRevisionSchema = z
  .object({
    expectedActiveRevision: z.number().int().positive(),
    expectedRowVersion: z.number().int().nonnegative(),
  })
  .strict();

export const DocumentRevisionChunkSchema = z
  .object({
    createdAt: z.string(),
    documentId: z.string().uuid(),
    documentRevision: z.number().int().positive(),
    enabled: z.boolean(),
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    ordinal: z.number().int().nonnegative(),
    parentChunkId: z.string().uuid().optional(),
    text: z.string(),
    tokenCount: z.number().int().nonnegative(),
    userMetadata: z.record(z.unknown()),
  })
  .strict()
  .openapi("DocumentRevisionChunk");

export const DocumentChunkListResponseSchema = z
  .object({
    items: z.array(DocumentRevisionChunkSchema),
    nextCursor: z.string().optional(),
  })
  .strict()
  .openapi("DocumentChunkList");

export const DocumentChunkStateBodySchema = z.object({ enabled: z.boolean() }).strict();

export const DocumentChunkStateChangeResponseSchema = z
  .object({
    candidateFingerprint: z.string().optional(),
    candidatePublicationId: z.string().uuid().optional(),
    chunkId: z.string().uuid(),
    compilationAttemptId: z.string().uuid(),
    createdAt: z.string(),
    documentId: z.string().uuid(),
    documentRevision: z.number().int().positive(),
    enabled: z.boolean(),
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    state: z.literal("candidate"),
    statusUrl: z.string().min(1),
  })
  .strict()
  .openapi("DocumentChunkStateChangeAccepted");

export const DocumentProcessingTaskSchema = z
  .object({
    completedAt: z.string().optional(),
    createdAt: z.string(),
    documentId: z.string().uuid(),
    documentRevision: z.number().int().positive(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    progressPercent: z.number().int().min(0).max(100),
    retryAt: z.string().optional(),
    stage: z.enum([
      "queued",
      "parsed",
      "outline_built",
      "nodes_generated",
      "projection_built",
      "smoke_eval_passed",
      "published",
    ]),
    state: z.enum([
      "dispatch_pending",
      "queued",
      "running",
      "retry_wait",
      "succeeded",
      "failed",
      "canceled",
      "superseded",
    ]),
    updatedAt: z.string(),
  })
  .strict()
  .openapi("DocumentProcessingTask");

export const DocumentProcessingTaskListSchema = z
  .object({
    items: z.array(DocumentProcessingTaskSchema),
    nextCursor: z.string().optional(),
  })
  .strict()
  .openapi("DocumentProcessingTaskList");

export const DocumentIndexSettingsSchema = z
  .object({
    chunkOverlap: z.number().int().min(0).max(8191),
    chunkSize: z.number().int().min(128).max(8192),
    enableGraph: z.boolean(),
    enablePageIndex: z.boolean(),
    language: z.string().min(2).max(64).optional(),
  })
  .strict()
  .refine((value) => value.chunkOverlap < value.chunkSize, {
    message: "chunkOverlap must be less than chunkSize",
  });

export const PatchDocumentSettingsSchema = z
  .object({
    expectedSettingsHeadRevision: z.number().int().positive().nullable(),
    settings: DocumentIndexSettingsSchema,
  })
  .strict();

export const DocumentSettingsHeadSchema = z
  .object({
    activeRevision: z.number().int().positive(),
    profile: z.object({
      activatedAt: z.string().optional(),
      createdAt: z.string(),
      revision: z.number().int().positive(),
      settings: DocumentIndexSettingsSchema,
      state: z.literal("active"),
    }),
    rowVersion: z.number().int().nonnegative(),
    updatedAt: z.string(),
  })
  .strict()
  .openapi("DocumentSettingsHead");

export const DocumentReindexAcceptedSchema = z
  .object({
    attemptId: z.string().uuid(),
    compilationAttemptId: z.string().uuid(),
    settingsRevision: z.number().int().positive(),
    state: z.literal("running"),
    statusUrl: z.string(),
  })
  .strict()
  .openapi("DocumentReindexAccepted");
