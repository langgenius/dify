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
import { RetrievalTestStageNames } from "./retrieval-test";

export const RetrievalTestRequestSchema = z
  .object({
    mode: KnowledgeSpaceRetrievalModeSchema.optional(),
    query: z.string().trim().min(1).max(16_000),
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
  path: "/knowledge-spaces/{id}/retrieval-tests",
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
