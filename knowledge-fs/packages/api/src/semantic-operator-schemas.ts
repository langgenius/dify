import { z } from "@hono/zod-openapi";

const OperatorLimitSchema = z.preprocess(
  (value) => (value === undefined ? 50 : value),
  z.coerce.number().int().min(1).max(100),
);

export const MaterializeTopicViewBodySchema = z
  .object({
    generatedVersion: z.string().min(1).max(120).optional(),
    limit: OperatorLimitSchema.optional(),
    topicName: z.string().min(1).max(120).optional(),
    topicSlug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
  })
  .strict();

export const ExtractSemanticEntitiesBodySchema = z
  .object({
    limit: OperatorLimitSchema.optional(),
  })
  .strict();

export const MaterializeSemanticCommunitiesBodySchema = z
  .object({
    generatedVersion: z.string().min(1).max(120).optional(),
  })
  .strict();

export const TopicViewMaterializationResponseSchema = z
  .object({
    documentCount: z.number().int().nonnegative(),
    generatedVersion: z.string().min(1),
    knowledgeSpaceId: z.string().uuid(),
    pathCount: z.number().int().nonnegative(),
    topicName: z.string().min(1),
    topicSlug: z.string().min(1),
  })
  .openapi("TopicViewMaterializationResult");

export const SemanticEntityExtractionResponseSchema = z
  .object({
    entitiesExtracted: z.number().int().nonnegative(),
    extractionMode: z.enum(["provider"]),
    graphEntitiesIndexed: z.number().int().nonnegative(),
    graphRelationsIndexed: z.number().int().nonnegative(),
    knowledgeSpaceId: z.string().uuid(),
    nodesScanned: z.number().int().nonnegative(),
    nodesUpdated: z.number().int().nonnegative(),
  })
  .openapi("SemanticEntityExtractionResult");

export const SemanticCommunityMaterializationResponseSchema = z
  .object({
    communityCount: z.number().int().nonnegative(),
    documentCount: z.number().int().nonnegative(),
    entityCount: z.number().int().nonnegative(),
    generatedVersion: z.string().min(1),
    knowledgeSpaceId: z.string().uuid(),
    pathCount: z.number().int().nonnegative(),
  })
  .openapi("SemanticCommunityMaterializationResult");

export type MaterializeTopicViewBody = z.infer<typeof MaterializeTopicViewBodySchema>;
export type ExtractSemanticEntitiesBody = z.infer<typeof ExtractSemanticEntitiesBodySchema>;
export type MaterializeSemanticCommunitiesBody = z.infer<
  typeof MaterializeSemanticCommunitiesBodySchema
>;
