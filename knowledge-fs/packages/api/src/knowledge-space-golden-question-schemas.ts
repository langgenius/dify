import { z } from "@hono/zod-openapi";
import {
  KnowledgeFsGcCandidateSchema,
  KnowledgeSpaceEmbeddingSelectionSchema,
  KnowledgeSpaceRetrievalProfileInputSchema,
  KnowledgeSpaceSchema,
} from "@knowledge/core";

const MAX_GOLDEN_QUESTION_ANNOTATION_EVIDENCE = 50;
const DEFAULT_LIST_LIMIT = 100;
const BoundedListLimitSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_LIST_LIMIT : value),
  z.coerce.number().int().min(1),
);

export const CreateKnowledgeSpaceSchema = z
  .object({
    description: z.string().max(2000).optional(),
    embeddingProfile: KnowledgeSpaceEmbeddingSelectionSchema.optional(),
    iconRef: KnowledgeSpaceSchema.shape.iconRef,
    idempotencyKey: z.string().trim().min(1).max(255).optional(),
    name: z.string().trim().min(1).max(160),
    retrievalProfile: KnowledgeSpaceRetrievalProfileInputSchema.optional(),
    slug: KnowledgeSpaceSchema.shape.slug.optional(),
  })
  .strict();

export const UpdateKnowledgeSpaceSchema = z
  .object({
    description: z.string().max(2000).optional(),
    expectedRevision: z.number().int().positive(),
    iconRef: KnowledgeSpaceSchema.shape.iconRef.nullable().optional(),
    name: z.string().trim().min(1).max(160).optional(),
    slug: KnowledgeSpaceSchema.shape.slug.optional(),
  })
  .strict();

export const UpdateKnowledgeSpaceEmbeddingProfileSchema = KnowledgeSpaceEmbeddingSelectionSchema;

export const UpdateKnowledgeSpaceRetrievalProfileSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    profile: KnowledgeSpaceRetrievalProfileInputSchema,
  })
  .strict();

export const KnowledgeSpaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ListKnowledgeSpacesQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: BoundedListLimitSchema,
  })
  .strict();

export const ListStagedCommitsQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: BoundedListLimitSchema,
    status: z
      .enum([
        "received",
        "object-staged",
        "object-verified",
        "metadata-prepared",
        "artifacts-built",
        "nodes-built",
        "projections-built",
        "published",
        "failed-retryable",
        "failed-terminal",
        "canceled",
        "gc-pending",
        "gc-complete",
      ])
      .optional(),
  })
  .strict();

export const ListActiveLeasesQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: BoundedListLimitSchema,
  })
  .strict();

export const KnowledgeSpaceStatsQuerySchema = z
  .object({
    windowMinutes: z.preprocess(
      (value) => (value === undefined ? 60 : value),
      z.coerce.number().int().min(1).max(1440),
    ),
  })
  .strict();

export const KnowledgeSpaceFsckQuerySchema = z
  .object({
    check: z.enum(["raw-objects", "artifact-segments", "references"]).default("raw-objects"),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict();

export const KnowledgeSpaceGcDryRunQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    stagedObjectPrefix: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[A-Za-z0-9._=-]+(?:\/[A-Za-z0-9._=-]+)*\/?$/)
      .optional(),
  })
  .strict();

export const ExecuteKnowledgeSpaceStagedObjectGcSchema = z
  .object({
    candidates: z.array(KnowledgeFsGcCandidateSchema).max(100),
  })
  .strict();

export const GoldenQuestionParamsSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
});

export const CreateGoldenQuestionSchema = z
  .object({
    expectedEvidenceIds: z.array(z.string().uuid()).default([]),
    metadata: z.record(z.unknown()).default({}),
    question: z.string().min(1).max(4000),
    tags: z.array(z.string().min(1).max(80)).default([]),
  })
  .strict();

export const UpdateGoldenQuestionSchema = z
  .object({
    expectedEvidenceIds: z.array(z.string().uuid()).optional(),
    metadata: z.record(z.unknown()).optional(),
    question: z.string().min(1).max(4000).optional(),
    tags: z.array(z.string().min(1).max(80)).optional(),
  })
  .strict();

export const AnnotateGoldenQuestionSchema = z
  .object({
    answerCorrectness: z.enum(["correct", "incorrect", "not-answerable", "partially-correct"]),
    evidenceRelevance: z
      .array(
        z
          .object({
            evidenceId: z.string().uuid(),
            note: z.string().min(1).max(1000).optional(),
            relevant: z.boolean(),
          })
          .strict(),
      )
      .max(MAX_GOLDEN_QUESTION_ANNOTATION_EVIDENCE)
      .default([]),
    note: z.string().min(1).max(1000).optional(),
  })
  .strict();

export const ListGoldenQuestionsQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: BoundedListLimitSchema,
  })
  .strict();
