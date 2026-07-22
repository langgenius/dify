import { z } from "@hono/zod-openapi";
import {
  DocumentAssetSchema,
  DocumentMultimodalManifestSchema,
  PublicationGenerationIdSchema,
  TenantIdSchema,
} from "@knowledge/core";

export const DocumentAssetResponseSchema = DocumentAssetSchema.openapi("DocumentAsset");
export const DocumentMultimodalManifestResponseSchema = DocumentMultimodalManifestSchema.openapi(
  "DocumentMultimodalManifest",
);
export const DocumentOutlineNodeResponseSchema = z
  .object({
    childNodeIds: z.array(z.string()).default([]),
    children: z.array(z.record(z.unknown())).default([]),
    endOffset: z.number().int().nonnegative().optional(),
    endPage: z.number().int().positive().optional(),
    id: z.string(),
    level: z.number().int().positive(),
    metadata: z.record(z.unknown()),
    sectionPath: z.array(z.string()).default([]),
    sourceElementIds: z.array(z.string()).default([]),
    sourceNodeIds: z.array(z.string()).default([]),
    startOffset: z.number().int().nonnegative().optional(),
    startPage: z.number().int().positive().optional(),
    summary: z.string().optional(),
    title: z.string(),
    titleLocation: z.record(z.unknown()).optional(),
    tocSource: z.string(),
  })
  .openapi("DocumentOutlineNode");
export const DocumentOutlineResponseSchema = z
  .object({
    artifactHash: z.string(),
    createdAt: z.string(),
    documentAssetId: z.string().uuid(),
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    metadata: z.record(z.unknown()),
    nodes: z.array(DocumentOutlineNodeResponseSchema),
    outlineVersion: z.string(),
    parseArtifactId: z.string().uuid(),
    updatedAt: z.string().optional(),
    version: z.number().int().positive(),
  })
  .openapi("DocumentOutline");

export const DocumentAssetListResponseSchema = z
  .object({
    items: z.array(DocumentAssetResponseSchema),
    nextCursor: z.string().uuid().optional(),
  })
  .openapi("DocumentAssetList");

export const DocumentUploadAcceptedResponseSchema = z
  .object({
    asset: DocumentAssetResponseSchema,
    assetStatusUrl: z.string().min(1).optional(),
    compilationJob: z.object({
      id: z.string().min(1),
      stage: z.literal("queued"),
    }),
    logicalDocument: z.object({
      id: z.string().uuid(),
      revision: z.number().int().positive(),
    }),
    logicalDocumentId: z.string().uuid(),
    documentRevision: z.number().int().positive(),
    statusUrl: z.string().min(1),
    status: z.literal("accepted").optional(),
  })
  .openapi("DocumentUploadAccepted");

export const BulkDocumentUploadAcceptedResponseSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    bulkJobId: z.string().min(1),
    excluded: z.number().int().nonnegative(),
    items: z.array(
      z.union([
        DocumentUploadAcceptedResponseSchema,
        z.object({
          filename: z.string(),
          index: z.number().int().nonnegative(),
          mimeType: z.string(),
          reason: z.enum([
            "batch_byte_limit_exceeded",
            "document_not_found",
            "file_count_limit_exceeded",
            "file_too_large",
            "invalid_file",
            "invalid_target",
            "processing_failed",
            "quota_exceeded",
            "revision_conflict",
            "unsupported_mime_type",
          ]),
          sizeBytes: z.number().int().nonnegative(),
          status: z.literal("excluded"),
        }),
      ]),
    ),
    total: z.number().int().nonnegative(),
  })
  .openapi("BulkDocumentUploadAccepted");

export const BulkDocumentDeleteResponseSchema = z
  .object({
    bulkJobId: z.string().min(1),
    items: z.array(
      z.object({
        artifactsDeleted: z.number().int().nonnegative(),
        documentId: z.string().uuid(),
        nodesDeleted: z.number().int().nonnegative(),
        objectDeleted: z.boolean(),
        projectionsDeleted: z.number().int().nonnegative(),
        status: z.enum(["deleted", "not_found"]),
      }),
    ),
    total: z.number().int().nonnegative(),
  })
  .openapi("BulkDocumentDeleteResult");

export const BulkDocumentReindexQueuedItemSchema = z.object({
  asset: DocumentAssetResponseSchema,
  compilationJob: z.object({
    id: z.string().min(1),
    stage: z.literal("queued"),
  }),
  status: z.literal("queued"),
  statusUrl: z.string().min(1),
});

export const BulkDocumentReindexResponseSchema = z
  .object({
    bulkJobId: z.string().min(1),
    items: z.array(
      z.union([
        BulkDocumentReindexQueuedItemSchema,
        z.object({
          documentId: z.string().uuid(),
          status: z.literal("not_found"),
        }),
      ]),
    ),
    total: z.number().int().nonnegative(),
  })
  .openapi("BulkDocumentReindexResult");

export const DocumentCompilationJobResponseSchema = z
  .object({
    baseHeadRevision: z.number().int().nonnegative().optional(),
    candidateFingerprint: z.string().min(1).optional(),
    candidatePublicationId: z.string().uuid().optional(),
    completedAt: z.number().optional(),
    createdAt: z.number(),
    documentAssetId: z.string().min(1),
    error: z.string().optional(),
    executionAttempts: z.number().int().nonnegative().optional(),
    id: z.string().min(1),
    knowledgeSpaceId: z.string().min(1),
    leaseExpiresAt: z.number().optional(),
    maxExecutionAttempts: z.number().int().positive().optional(),
    publicationGenerationId: PublicationGenerationIdSchema.optional(),
    queueJobId: z.string().min(1).optional(),
    retryAt: z.number().optional(),
    runState: z
      .enum([
        "dispatch_pending",
        "queued",
        "running",
        "retry_wait",
        "succeeded",
        "failed",
        "canceled",
        "superseded",
      ])
      .optional(),
    stage: z.enum([
      "queued",
      "parsed",
      "outline_built",
      "nodes_generated",
      "projection_built",
      "smoke_eval_passed",
      "published",
      "failed",
      "canceled",
    ]),
    tenantId: TenantIdSchema,
    updatedAt: z.number(),
    version: z.number().int().positive(),
  })
  .openapi("DocumentCompilationJob");
