import { z } from "@hono/zod-openapi";
import {
  GoldenQuestionSchema,
  KnowledgeFsGcCandidateSchema,
  KnowledgeSpaceEmbeddingSelectionSchema,
  KnowledgeSpaceRetrievalProfileInputSchema,
  KnowledgeSpaceSchema,
} from "@knowledge/core";

const MAX_GOLDEN_QUESTION_ANNOTATION_EVIDENCE = 50;
export const MAX_GOLDEN_QUESTION_BULK_IMPORT_ROWS = 500;
export const MAX_GOLDEN_QUESTION_EVIDENCE_MATCH_TEXTS = 500;
export const MAX_GOLDEN_QUESTION_EXPECTED_EVIDENCE_IDS = 50;
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
    name: z.string().trim().min(1).max(40),
    retrievalProfile: KnowledgeSpaceRetrievalProfileInputSchema.optional(),
    slug: KnowledgeSpaceSchema.shape.slug.optional(),
  })
  .strict();

export const UpdateKnowledgeSpaceSchema = z
  .object({
    description: z.string().max(2000).optional(),
    expectedRevision: z.number().int().positive(),
    iconRef: KnowledgeSpaceSchema.shape.iconRef.nullable().optional(),
    name: z.string().trim().min(1).max(40).optional(),
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

export const GoldenQuestionMatchPolicySchema = z.enum(["all", "any"]);

const GoldenQuestionEvidenceTextSchema = z.string().trim().min(1).max(8_000);
const GoldenQuestionMinimumSimilaritySchema = z.number().min(0).max(1).default(0.7);
const GoldenQuestionEvidenceTopKSchema = z.number().int().min(1).max(10).default(5);

export const MatchGoldenQuestionEvidenceSchema = z
  .object({
    evidenceTexts: z
      .array(GoldenQuestionEvidenceTextSchema)
      .min(1)
      .max(MAX_GOLDEN_QUESTION_EVIDENCE_MATCH_TEXTS)
      .optional(),
    minimumSimilarity: GoldenQuestionMinimumSimilaritySchema,
    nodeIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_GOLDEN_QUESTION_EXPECTED_EVIDENCE_IDS)
      .optional(),
    topK: GoldenQuestionEvidenceTopKSchema,
  })
  .strict()
  .refine((value) => Boolean(value.evidenceTexts) !== Boolean(value.nodeIds), {
    message: "Provide exactly one of evidenceTexts or nodeIds",
  });

export const GoldenQuestionEvidenceCandidateSchema = z
  .object({
    documentAssetId: z.string().uuid(),
    nodeId: z.string().uuid(),
    pageNumber: z.number().int().positive().optional(),
    projectionId: z.string().uuid(),
    score: z.number().min(0).max(1),
    sectionPath: z.array(z.string()),
    text: z.string(),
  })
  .strict();

export const GoldenQuestionEvidenceMatchSchema = z
  .object({
    candidates: z.array(GoldenQuestionEvidenceCandidateSchema),
    evidenceText: GoldenQuestionEvidenceTextSchema,
    matched: z.boolean(),
  })
  .strict();

export const GoldenQuestionResolvedEvidenceSchema = z
  .object({
    documentAssetId: z.string().uuid(),
    nodeId: z.string().uuid(),
    pageNumber: z.number().int().positive().optional(),
    sectionPath: z.array(z.string()),
    text: z.string(),
  })
  .strict();

export const MatchGoldenQuestionEvidenceResponseSchema = z
  .object({
    items: z.array(GoldenQuestionEvidenceMatchSchema),
    resolvedEvidence: z.array(GoldenQuestionResolvedEvidenceSchema).optional(),
  })
  .strict();

export const BulkImportGoldenQuestionsSchema = z
  .object({
    matchPolicy: GoldenQuestionMatchPolicySchema.default("all"),
    minimumSimilarity: GoldenQuestionMinimumSimilaritySchema,
    rows: z
      .array(
        z
          .object({
            evidence: GoldenQuestionEvidenceTextSchema,
            metadata: z.record(z.unknown()).default({}),
            question: z.string().trim().min(1).max(4_000),
            tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_GOLDEN_QUESTION_BULK_IMPORT_ROWS),
  })
  .strict();

export const BulkImportGoldenQuestionsResponseSchema = z
  .object({
    activeCount: z.number().int().nonnegative(),
    draftCount: z.number().int().nonnegative(),
    items: z.array(
      z
        .object({
          expectedEvidenceId: z.string().uuid().optional(),
          questionId: GoldenQuestionSchema.shape.id,
          rowIndex: z.number().int().nonnegative(),
          similarity: z.number().min(0).max(1).optional(),
          status: z.enum(["active", "draft"]),
        })
        .strict(),
    ),
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
