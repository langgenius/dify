import { z } from "@hono/zod-openapi";

export const BulkOperationProgressResponseSchema = z
  .object({
    canceledItems: z.number().int().nonnegative(),
    completedItems: z.number().int().nonnegative(),
    createdAt: z.string(),
    failedItemIds: z.array(z.string().min(1)),
    failedItems: z.number().int().nonnegative(),
    id: z.string().min(1),
    knowledgeSpaceId: z.string().min(1),
    status: z.enum(["running", "completed", "failed", "canceled"]),
    totalItems: z.number().int().nonnegative(),
    type: z.enum(["document_upload", "document_delete", "document_reindex"]),
    updatedAt: z.string(),
  })
  .openapi("BulkOperationProgress");

export const RetentionPolicyResponseSchema = z
  .object({
    answerTraceRetentionDays: z.number().int().positive(),
    createdAt: z.string(),
    evidenceCacheRetentionDays: z.number().int().positive(),
    id: z.string().min(1),
    inactiveProjectionRetentionDays: z.number().int().positive(),
    knowledgeSpaceId: z.string().uuid().nullable(),
    parseArtifactVersions: z.number().int().positive(),
    rawDocumentRetentionDays: z.number().int().positive().nullable(),
    scope: z.enum(["tenant", "knowledge_space"]),
    sessionInactivityMinutes: z.number().int().positive(),
    tenantId: z.string().min(1),
    updatedAt: z.string(),
  })
  .openapi("RetentionPolicy");
