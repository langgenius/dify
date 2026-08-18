import { createRoute, z } from "@hono/zod-openapi";
import {
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceRetrievalModeSchema,
  KnowledgeSpaceRetrievalProfileSchema,
} from "@knowledge/core";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  ErrorResponseSchema,
  RetrievalProfileModeErrorResponseSchema,
} from "./gateway-route-schemas";
import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";
import {
  RetrievalCustomMetadataComparisonOperators,
  RetrievalCustomMetadataFieldTypes,
  normalizeRetrievalCustomMetadataFilter,
} from "./retrieval-custom-metadata";
import { RetrievalTestStageNames } from "./retrieval-test";

const RetrievalQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(32_000)
  .refine((value) => Array.from(value).length <= 16_000, "Query exceeds 16000 Unicode characters");
const RetrievalTextSchema = z
  .string()
  .max(16_384)
  .refine((value) => Array.from(value).length <= 8_192, "Text exceeds 8192 Unicode characters");
const RetrievalCustomMetadataStringValueSchema = z
  .string()
  .max(1_024)
  .refine(
    (value) => Array.from(value).length <= 512,
    "Metadata value exceeds 512 Unicode characters",
  );

const RetrievalCustomMetadataFilterSchema = z
  .object({
    conditions: z
      .array(
        z
          .object({
            comparisonOperator: z.enum(RetrievalCustomMetadataComparisonOperators),
            fieldType: z.enum(RetrievalCustomMetadataFieldTypes),
            name: z.string().regex(/^[a-z][a-z0-9_]{0,254}$/u),
            value: z
              .union([RetrievalCustomMetadataStringValueSchema, z.number().finite()])
              .optional(),
          })
          .strict()
          .superRefine((condition, context) => {
            try {
              const normalized = normalizeRetrievalCustomMetadataFilter({
                conditions: [condition],
                logicalOperator: "and",
              });
              if (!normalized) {
                context.addIssue({
                  code: "custom",
                  message: "Metadata condition value is required",
                });
              }
            } catch (error) {
              context.addIssue({
                code: "custom",
                message: error instanceof Error ? error.message : "Invalid metadata condition",
              });
            }
          }),
      )
      .max(50),
    logicalOperator: z.enum(["and", "or"]),
  })
  .strict();

export const RetrievalTestRequestSchema = z
  .object({
    filters: z
      .object({
        createdAfter: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
        createdBefore: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
        customMetadata: RetrievalCustomMetadataFilterSchema,
        documentTypes: z.array(z.string().trim().min(1).max(512)).max(100),
        entities: z.array(z.string().trim().min(1).max(512)).max(100),
        freshnessStatuses: z.array(z.string().trim().min(1).max(512)).max(100),
        languages: z.array(z.string().trim().min(1).max(512)).max(100),
        nodeKinds: z.array(z.enum(["chunk", "section", "table", "image", "summary"])).max(100),
        sourceIds: z.array(z.string().trim().min(1).max(512)).max(100),
        tags: z.array(z.string().trim().min(1).max(512)).max(100),
      })
      .partial()
      .strict()
      .optional(),
    includeText: z.boolean().default(false),
    mode: KnowledgeSpaceRetrievalModeSchema.optional(),
    query: RetrievalQuerySchema,
  })
  .strict();

const BoundedIdentifierSchema = z.string().min(1).max(512);
const CandidateCountSchema = z.number().int().nonnegative();
const DurationSchema = z.number().nonnegative();

export const RetrievalTestStageSchema = z
  .object({
    candidateCount: CandidateCountSchema.optional(),
    durationMs: DurationSchema.optional(),
    filteredCount: CandidateCountSchema.optional(),
    name: z.enum(RetrievalTestStageNames),
    status: z.enum(["executed", "skipped"]),
  })
  .strict();

export const RetrievalTestMetricsSchema = z
  .object({
    degradationFlags: z.array(z.string().max(256)).max(32).readonly().optional(),
    denseCandidates: CandidateCountSchema,
    denseMs: DurationSchema,
    documentOutlineMatchedItems: CandidateCountSchema.optional(),
    ftsCandidates: CandidateCountSchema,
    ftsMs: DurationSchema,
    fusedCandidates: CandidateCountSchema,
    fusionMs: DurationSchema,
    graphExpansionCandidates: CandidateCountSchema.optional(),
    graphExpansionMs: DurationSchema.optional(),
    graphExpansionRelations: CandidateCountSchema.optional(),
    graphExpansionSeeds: CandidateCountSchema.optional(),
    graphExpansionTimedOut: z.boolean().optional(),
    graphExpansionTraversedEntities: CandidateCountSchema.optional(),
    imageCandidates: CandidateCountSchema.optional(),
    metadataFilteredCandidates: CandidateCountSchema.optional(),
    multimodalCandidates: CandidateCountSchema.optional(),
    pageIndexCandidateTruncated: z.boolean().optional(),
    pageIndexMatchedNodes: CandidateCountSchema.optional(),
    pageIndexOpenedRanges: CandidateCountSchema.optional(),
    pageIndexScannedNodes: CandidateCountSchema.optional(),
    pageIndexScannedOutlines: CandidateCountSchema.optional(),
    pageIndexScoreVersion: z.string().max(256).optional(),
    permissionFilteredCandidates: CandidateCountSchema.optional(),
    projectionFilteredCandidates: CandidateCountSchema.optional(),
    reasoningTreeSearchNodes: CandidateCountSchema.optional(),
    rerankCandidates: CandidateCountSchema.optional(),
    rerankMs: DurationSchema.optional(),
    scoreThresholdFilteredCandidates: CandidateCountSchema.optional(),
    summaryCandidates: CandidateCountSchema.optional(),
    summarySelectedSections: CandidateCountSchema.optional(),
    tableCandidates: CandidateCountSchema.optional(),
    totalMs: DurationSchema,
    visualEmbeddingCandidates: CandidateCountSchema.optional(),
  })
  .strict();

export const RetrievalTestResponseSchema = z
  .object({
    capabilityStatus: z
      .object({
        embedding: z.enum(["not-required", "verified"]),
        reasoning: z.literal("verified"),
        rerank: z.enum(["disabled", "not-required", "verified"]),
      })
      .strict(),
    embeddingProfile: KnowledgeSpaceEmbeddingProfileSchema.optional(),
    items: z
      .array(
        z
          .object({
            citation: z
              .object({
                artifactHash: z.string().min(1).max(128),
                documentAssetId: BoundedIdentifierSchema,
                documentVersion: z.number().int().positive(),
                endOffset: z.number().int().nonnegative().optional(),
                pageNumber: z.number().int().nonnegative().optional(),
                sectionPath: z.array(z.string().max(512)).max(64).readonly(),
                startOffset: z.number().int().nonnegative().optional(),
              })
              .strict(),
            nodeId: BoundedIdentifierSchema,
            projectionIds: z.array(BoundedIdentifierSchema).max(128).readonly(),
            score: z.number(),
            sources: z
              .array(z.enum(["dense", "fts", "pageindex", "visual"]))
              .max(4)
              .readonly(),
            text: RetrievalTextSchema.optional(),
          })
          .strict(),
      )
      .max(100)
      .readonly(),
    metrics: RetrievalTestMetricsSchema,
    mode: KnowledgeSpaceRetrievalModeSchema,
    plan: z
      .object({
        denseTopK: z.number().int().nonnegative(),
        ftsTopK: z.number().int().nonnegative(),
        fusionLimit: z.number().int().nonnegative(),
        queryLanguage: z.enum(["cjk", "latin", "mixed-cjk-latin", "other"]),
        requestedMode: KnowledgeSpaceRetrievalModeSchema,
        rerankCandidateLimit: z.number().int().nonnegative(),
        resolvedMode: KnowledgeSpaceRetrievalModeSchema,
        strategyVersion: z.literal("retrieval-planner-v1"),
        topK: z.number().int().min(1).max(100),
      })
      .strict(),
    projectionSnapshot: z
      .object({
        fingerprint: z.string().min(1).max(512),
        headRevision: z.number().int().nonnegative(),
        projectionVersion: z.number().int().nonnegative(),
        publicationId: BoundedIdentifierSchema,
      })
      .strict(),
    retrievalProfile: KnowledgeSpaceRetrievalProfileSchema,
    stages: z.array(RetrievalTestStageSchema).max(RetrievalTestStageNames.length).readonly(),
    traceId: z.string().min(1).max(512),
  })
  .strict();

const RetrievalTestConflictResponseSchema = ErrorResponseSchema.extend({
  code: z.string().optional(),
});

export const runRetrievalTestRoute = createRoute({
  method: "post",
  operationId: "runRetrievalTest",
  path: "/knowledge-spaces/{id}/retrieval-tests",
  "x-knowledge-fs-max-response-bytes": 4 * 1024 * 1024,
  request: {
    body: {
      content: {
        "application/json": {
          schema: RetrievalTestRequestSchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: RetrievalTestResponseSchema,
        },
      },
      description: "Bounded retrieval-stage diagnostics without answer generation",
    },
    400: {
      content: {
        "application/json": {
          schema: z.union([RetrievalProfileModeErrorResponseSchema, ErrorResponseSchema]),
        },
      },
      description: "Invalid retrieval test request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    409: {
      content: {
        "application/json": {
          schema: RetrievalTestConflictResponseSchema,
        },
      },
      description: "Retrieval blocked by knowledge-space deletion",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Published retrieval test capability unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
