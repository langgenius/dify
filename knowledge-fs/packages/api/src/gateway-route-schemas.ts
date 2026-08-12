import { z } from "@hono/zod-openapi";
import {
  KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_CODE,
  KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_MESSAGE,
  KnowledgeSpaceRetrievalModeSchema,
} from "@knowledge/core";

import {
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED,
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
} from "./candidate-content-authorization";
import {
  KnowledgeFsErrorCategoryValues,
  KnowledgeFsErrorCodeValues,
  KnowledgeFsFailureParameterKeyValues,
  KnowledgeFsRecoveryActionValues,
  KnowledgeFsRetryPolicyValues,
} from "./knowledge-fs-errors";
import { QueryImageReferencesSchema, hasQueryInput } from "./query-images";

export const KnowledgeFsPublicFailureSchema = z
  .object({
    action: z.enum(KnowledgeFsRecoveryActionValues).optional(),
    category: z.enum(KnowledgeFsErrorCategoryValues),
    code: z.enum(KnowledgeFsErrorCodeValues),
    message: z.string().min(1).max(1_024),
    parameters: z
      .record(
        z.enum(KnowledgeFsFailureParameterKeyValues),
        z.union([z.string().max(256), z.number().finite(), z.boolean()]),
      )
      .optional(),
    retryPolicy: z.enum(KnowledgeFsRetryPolicyValues),
    stage: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9_.-]{0,127}$/u)
      .optional(),
    traceId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]{1,128}$/u)
      .optional(),
  })
  .strict();

export const ErrorResponseSchema = z.object({
  code: z.string().optional(),
  error: z.string(),
  failure: KnowledgeFsPublicFailureSchema.optional(),
});

export const CandidateVisibilityScanBudgetExceededResponseSchema = z
  .object({
    code: z.literal(CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED),
    error: z.literal(CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE),
  })
  .strict();

export const RetrievalProfileModeErrorResponseSchema = z
  .object({
    code: z.literal(KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_CODE),
    error: z.literal(KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_MESSAGE),
    mode: KnowledgeSpaceRetrievalModeSchema,
  })
  .strict();

export const RetentionPolicyPatchSchema = z
  .object({
    answerTraceRetentionDays: z.number().int().positive().optional(),
    evidenceCacheRetentionDays: z.number().int().positive().optional(),
    inactiveProjectionRetentionDays: z.number().int().positive().optional(),
    parseArtifactVersions: z.number().int().positive().optional(),
    rawDocumentRetentionDays: z.number().int().positive().nullable().optional(),
    sessionInactivityMinutes: z.number().int().positive().optional(),
  })
  .strict();

export const GraphTraverseQuerySchema = z
  .object({
    depth: z.coerce.number().int().min(1).max(2).default(2),
    entityId: z.string().uuid(),
    fanout: z.coerce.number().int().min(1).max(50).default(20),
    maxNodes: z.coerce.number().int().min(1).max(200).default(50),
    timeoutMs: z.coerce.number().int().min(1).max(5_000).default(250),
  })
  .strict();

export const BulkOperationParamsSchema = z.object({
  id: z.string().min(1),
});

export const BulkOperationQuerySchema = z
  .object({
    knowledgeSpaceId: z.string().uuid().optional(),
  })
  .strict();

export const AnswerTraceParamsSchema = z.object({
  traceId: z.string().uuid(),
});

export const AnswerTraceParentQuerySchema = z
  .object({
    knowledgeSpaceId: z.string().uuid().optional(),
  })
  .strict();

export const QueryVirtualTreeListQuerySchema = z
  .object({
    cursor: z.string().optional(),
    knowledgeSpaceId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const QueryStreamRequestSchema = z
  .object({
    activeDocumentIds: z.array(z.string().uuid()).max(100).default([]),
    activeEntityIds: z.array(z.string().min(1).max(200)).max(100).default([]),
    knowledgeSpaceId: z.string().uuid(),
    mode: z
      .enum(["auto", "deep", "fast", "research"])
      .optional()
      .describe(
        "Explicit auto invokes the knowledge space reasoning model once to select fast, deep, or research; omission uses the published defaultMode.",
      ),
    query: z.string().max(16_000).optional(),
    queryImages: QueryImageReferencesSchema.default([]),
    sessionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasQueryInput(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one of query or queryImages is required",
        path: ["query"],
      });
    }
  });

export const CreateProductionBadCaseSchema = z
  .object({
    reason: z.string().min(1).max(1000).optional(),
    tags: z.array(z.string().min(1).max(80)).max(20).default([]),
    traceId: z.string().uuid(),
  })
  .strict();
