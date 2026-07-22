import { z } from "@hono/zod-openapi";

import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";

export const DocumentUploadParamsSchema = KnowledgeSpaceParamsSchema;
export const BulkDocumentUploadParamsSchema = KnowledgeSpaceParamsSchema;

export const ListDocumentAssetsQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.preprocess(
      (value) => (value === undefined ? 50 : value),
      z.coerce.number().int().min(1).max(100),
    ),
  })
  .strict();

export const DocumentAssetParamsSchema = z.object({
  documentId: z.string().uuid(),
  id: z.string().uuid(),
});

export const DocumentMultimodalAssetParamsSchema = DocumentAssetParamsSchema.extend({
  itemId: z.string().min(1).max(1024),
});

export const DocumentMultimodalAssetQuerySchema = z
  .object({
    variant: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._=-]+$/u)
      .optional(),
  })
  .strict()
  .openapi("DocumentMultimodalAssetQuery");

export const ParseArtifactParamsSchema = DocumentAssetParamsSchema.extend({
  version: z.coerce.number().int().positive(),
});

export const DocumentCompilationJobParamsSchema = z.object({
  id: z.string().min(1),
});

export const DocumentCompilationJobQuerySchema = z
  .object({
    knowledgeSpaceId: z.string().uuid().optional(),
  })
  .strict();

export const DocumentUploadBodySchema = z.object({
  documentId: z.string().uuid().optional(),
  expectedActiveRevision: z
    .union([z.coerce.number().int().positive(), z.literal("null")])
    .optional(),
  expectedDocumentRowVersion: z.coerce.number().int().nonnegative().optional(),
  file: z.any().openapi({ format: "binary", type: "string" }),
  sourceId: z.string().uuid().optional(),
});

export const BulkDocumentUploadBodySchema = z.object({
  files: z.any().openapi({
    items: { format: "binary", type: "string" },
    type: "array",
  }),
  targets: z.string().optional().openapi({
    description:
      "JSON array of explicit per-file revision targets: {index, documentId, expectedActiveRevision, expectedDocumentRowVersion}. Omitted indexes create new logical documents; filenames are never merge keys.",
    example:
      '[{"index":0,"documentId":"00000000-0000-4000-8000-000000000001","expectedActiveRevision":2,"expectedDocumentRowVersion":2}]',
  }),
});

export const BulkDocumentDeleteBodySchema = z
  .object({
    documentIds: z.array(z.string().uuid()).min(1),
  })
  .strict();

export const BulkDocumentReindexBodySchema = z
  .object({
    all: z.boolean().optional(),
    documentIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.all) !== Boolean(input.documentIds), {
    message: "Bulk document reindex requires either all=true or documentIds",
  });
