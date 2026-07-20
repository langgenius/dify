import { z } from "@hono/zod-openapi";
import { EvidenceBundleSchema } from "@knowledge/core";

export const ResearchTaskJobResponseSchema = z
  .object({
    budgetUsd: z.number().nonnegative().optional(),
    completedAt: z.number().optional(),
    cost: z.object({
      budgetExceeded: z.boolean().optional(),
      budgetUsd: z.number().nonnegative().optional(),
      entries: z.array(
        z.object({
          costUsd: z.number().nonnegative(),
          provider: z.string().min(1),
          recordedAt: z.number(),
          step: z.string().min(1),
          usage: z.record(z.any()),
        }),
      ),
      totalUsd: z.number().nonnegative(),
    }),
    createdAt: z.number(),
    error: z.string().optional(),
    id: z.string().min(1),
    knowledgeSpaceId: z.string().min(1),
    limits: z
      .object({
        maxRetrievalSteps: z.number().int().positive().optional(),
        maxScannedResources: z.number().int().positive().optional(),
        maxToolCalls: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .optional(),
    metadata: z.record(z.any()),
    mode: z.enum(["auto", "deep", "fast", "research"]).optional(),
    query: z.string().min(1),
    stage: z.enum([
      "queued",
      "planning",
      "retrieving",
      "analyzing",
      "generating",
      "paused",
      "completed",
      "failed",
      "canceled",
    ]),
    topK: z.number().int().positive().optional(),
    updatedAt: z.number(),
  })
  .openapi("ResearchTaskJob");

export const ResearchTaskPartialResultResponseSchema = z
  .object({
    evidenceBundle: EvidenceBundleSchema,
    knowledgeSpaceId: z.string().min(1),
    researchTaskJobId: z.string().min(1),
    sequence: z.number().int().positive(),
    tenantId: z.string().min(1),
  })
  .openapi("ResearchTaskPartialResult");

export const ResearchTaskPartialResultListResponseSchema = z
  .object({
    items: z.array(ResearchTaskPartialResultResponseSchema),
    nextCursor: z.string().optional(),
  })
  .openapi("ResearchTaskPartialResultList");

export const ResearchTaskDryRunPlanResponseSchema = z
  .object({
    budget: z.object({
      budgetUsd: z.number().nonnegative().optional(),
      exceedsBudget: z.boolean(),
      remainingBudgetUsd: z.number().optional(),
    }),
    estimates: z.object({
      cacheHitProbability: z.number().min(0).max(1),
      costUsd: z.object({
        currency: z.literal("USD"),
        estimated: z.number().nonnegative(),
        max: z.number().nonnegative(),
        min: z.number().nonnegative(),
      }),
      inputTokens: z.number().int().nonnegative(),
      latencyMs: z.object({
        p50: z.number().int().nonnegative(),
        p95: z.number().int().nonnegative(),
      }),
      outputTokens: z.number().int().nonnegative(),
      retrievalSteps: z.number().int().nonnegative(),
      scannedResources: z.number().int().nonnegative(),
      toolCalls: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }),
    knowledgeSpaceId: z.string().uuid(),
    query: z.string().min(1),
    retrievalPlan: z.object({
      denseTopK: z.number().int().nonnegative(),
      ftsTopK: z.number().int().nonnegative(),
      fusionLimit: z.number().int().nonnegative(),
      queryLanguage: z.enum(["cjk", "latin", "mixed-cjk-latin", "other"]),
      requestedMode: z.enum(["auto", "deep", "fast", "research"]),
      rerankCandidateLimit: z.number().int().nonnegative(),
      resolvedMode: z.enum(["deep", "fast", "research"]),
      strategyVersion: z.string().min(1),
      topK: z.number().int().positive(),
    }),
    steps: z.array(
      z.object({
        estimatedCostUsd: z.number().nonnegative(),
        estimatedInputTokens: z.number().int().nonnegative(),
        estimatedLatencyMs: z.number().int().nonnegative(),
        estimatedOutputTokens: z.number().int().nonnegative(),
        estimatedToolCalls: z.number().int().nonnegative(),
        name: z.enum(["analyze", "generate", "inspect", "plan", "retrieve"]),
      }),
    ),
    strategyVersion: z.literal("research-dry-run-planner-v1"),
  })
  .openapi("ResearchTaskDryRunPlan");
