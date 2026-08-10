import { z } from "@hono/zod-openapi";

export const KnowledgeSpaceMetadataParamsSchema = z.object({
  id: z.string().uuid(),
});

export const KnowledgeSpaceMetadataFieldParamsSchema = KnowledgeSpaceMetadataParamsSchema.extend({
  fieldId: z.string().uuid(),
});

export const KnowledgeSpaceMetadataFieldTypeSchema = z.enum(["string", "number", "time"]);

export const KnowledgeSpaceMetadataFieldSchema = z
  .object({
    count: z.number().int().nonnegative(),
    createdAt: z.string(),
    id: z.string().uuid(),
    name: z.string().min(1).max(255),
    rowVersion: z.number().int().nonnegative(),
    type: KnowledgeSpaceMetadataFieldTypeSchema,
    updatedAt: z.string(),
  })
  .strict()
  .openapi("KnowledgeSpaceMetadataField");

export const KnowledgeSpaceMetadataFieldListSchema = z
  .object({
    items: z.array(KnowledgeSpaceMetadataFieldSchema),
    nextCursor: z.string().optional(),
  })
  .strict()
  .openapi("KnowledgeSpaceMetadataFieldList");

export const ListKnowledgeSpaceMetadataFieldsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.preprocess(
      (value) => (value === undefined ? 100 : value),
      z.coerce.number().int().min(1).max(100),
    ),
  })
  .strict();

export const CreateKnowledgeSpaceMetadataFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    type: KnowledgeSpaceMetadataFieldTypeSchema,
  })
  .strict();

export const UpdateKnowledgeSpaceMetadataFieldSchema = z
  .object({
    expectedRowVersion: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(255),
  })
  .strict();

export const DeleteKnowledgeSpaceMetadataFieldQuerySchema = z
  .object({ expectedRowVersion: z.coerce.number().int().nonnegative() })
  .strict();

export const DeleteKnowledgeSpaceMetadataFieldResponseSchema = z
  .object({ deleted: z.literal(true) })
  .strict();
