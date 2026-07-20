import { z } from "@hono/zod-openapi";

const ExpectedRevisionSchema = z.number().int().positive();

export const DurableDeletionIdempotencyHeadersSchema = z
  .object({
    "idempotency-key": z.string().trim().min(8).max(255),
  })
  .passthrough();

export const DurableDeletionJobParamsSchema = z.object({
  jobId: z.string().uuid(),
});

export const DeleteKnowledgeSpaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const DeleteKnowledgeSpaceBodySchema = z
  .object({
    challenge: z.string().trim().min(1).max(160),
    expectedRevision: ExpectedRevisionSchema,
  })
  .strict();

export const DeleteSourceParamsSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
});

export const DurableDeleteSourceQuerySchema = z
  .object({
    documents: z.enum(["cascade", "keep"]).default("cascade"),
  })
  .strict();

export const DeleteSourceBodySchema = z
  .object({
    expectedRevision: ExpectedRevisionSchema,
  })
  .strict();

export const DeleteDocumentParamsSchema = z.object({
  documentId: z.string().uuid(),
  id: z.string().uuid(),
});

export const DeleteDocumentBodySchema = z
  .object({
    expectedRevision: ExpectedRevisionSchema,
  })
  .strict();

export const BulkDeleteDocumentsBodySchema = z
  .object({
    documents: z
      .array(
        z
          .object({
            documentId: z.string().uuid(),
            expectedRevision: ExpectedRevisionSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type DeleteKnowledgeSpaceBody = z.infer<typeof DeleteKnowledgeSpaceBodySchema>;
export type DeleteKnowledgeSpaceParams = z.infer<typeof DeleteKnowledgeSpaceParamsSchema>;
export type DeleteSourceBody = z.infer<typeof DeleteSourceBodySchema>;
export type DeleteSourceParams = z.infer<typeof DeleteSourceParamsSchema>;
export type DeleteSourceQuery = z.infer<typeof DurableDeleteSourceQuerySchema>;
export type DeleteDocumentBody = z.infer<typeof DeleteDocumentBodySchema>;
export type DeleteDocumentParams = z.infer<typeof DeleteDocumentParamsSchema>;
export type BulkDeleteDocumentsBody = z.infer<typeof BulkDeleteDocumentsBodySchema>;
export type DurableDeletionIdempotencyHeaders = z.infer<
  typeof DurableDeletionIdempotencyHeadersSchema
>;
export type DurableDeletionJobParams = z.infer<typeof DurableDeletionJobParamsSchema>;
