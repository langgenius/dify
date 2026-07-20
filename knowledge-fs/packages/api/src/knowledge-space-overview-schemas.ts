import { z } from "@hono/zod-openapi";

import {
  KnowledgeSpaceActivityActions,
  KnowledgeSpaceActivityResourceTypes,
  KnowledgeSpaceActivityResults,
  KnowledgeSpaceAttentionRuleIds,
  KnowledgeSpaceHealthStates,
} from "./knowledge-space-overview";

const BoundedOverviewLimitSchema = z.preprocess(
  (value) => (value === undefined ? 50 : value),
  z.coerce.number().int().min(1).max(100),
);
const IsoDateTimeSchema = z.string().datetime();

export const KnowledgeSpaceOverviewParamsSchema = z.object({ id: z.string().uuid() });
export const KnowledgeSpaceAttentionParamsSchema = z.object({
  id: z.string().uuid(),
  issueKey: z.string().min(1).max(255),
});

export const ListKnowledgeSpaceActivityQuerySchema = z
  .object({
    action: z.enum(KnowledgeSpaceActivityActions).optional(),
    cursor: z.string().min(1).max(512).optional(),
    from: IsoDateTimeSchema.optional(),
    limit: BoundedOverviewLimitSchema,
    resourceType: z.enum(KnowledgeSpaceActivityResourceTypes).optional(),
    result: z.enum(KnowledgeSpaceActivityResults).optional(),
    to: IsoDateTimeSchema.optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must not be after to",
  });

export const ListKnowledgeSpaceAttentionQuerySchema = z
  .object({
    includeDismissed: z.preprocess(
      (value) => (value === "true" ? true : value === "false" ? false : value),
      z.boolean().default(false),
    ),
    limit: BoundedOverviewLimitSchema,
  })
  .strict();

export const TransitionKnowledgeSpaceAttentionSchema = z
  .object({
    dismissedUntil: IsoDateTimeSchema.optional(),
    expectedRevision: z.number().int().positive(),
    status: z.enum(["active", "dismissed", "resolved"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "dismissed" && !value.dismissedUntil) {
      context.addIssue({ code: "custom", message: "dismissedUntil is required when dismissing" });
    }
    if (value.status !== "dismissed" && value.dismissedUntil) {
      context.addIssue({
        code: "custom",
        message: "dismissedUntil is only allowed when dismissing",
      });
    }
  });

export const KnowledgeSpaceActivityResponseSchema = z
  .object({
    action: z.enum(KnowledgeSpaceActivityActions),
    actor: z.object({ id: z.string().optional(), type: z.enum(["member", "system"]) }).strict(),
    details: z.record(z.union([z.boolean(), z.number(), z.string()])),
    id: z.string().uuid(),
    occurredAt: IsoDateTimeSchema,
    resource: z
      .object({
        id: z.string().optional(),
        type: z.enum(KnowledgeSpaceActivityResourceTypes),
      })
      .strict(),
    result: z.enum(KnowledgeSpaceActivityResults),
  })
  .strict();

export const KnowledgeSpaceAttentionResponseSchema = z
  .object({
    action: z
      .object({
        kind: z.enum(["open-resource", "review-permissions", "review-models"]),
        resourceId: z.string().optional(),
        resourceType: z.enum(["knowledge-space", "document", "source", "failed-query"]),
      })
      .strict(),
    dismissedUntil: IsoDateTimeSchema.optional(),
    evidence: z.array(
      z
        .object({
          code: z.string(),
          observedAt: IsoDateTimeSchema,
          value: z.union([z.number(), z.string()]).optional(),
        })
        .strict(),
    ),
    issueKey: z.string(),
    knowledgeSpaceId: z.string().uuid(),
    resource: z
      .object({
        id: z.string(),
        type: z.enum(["knowledge-space", "document", "source", "failed-query"]),
      })
      .strict(),
    revision: z.number().int().positive(),
    ruleId: z.enum(KnowledgeSpaceAttentionRuleIds),
    severity: z.enum(["critical", "warning", "info"]),
    status: z.enum(["active", "dismissed", "resolved"]),
    title: z.string(),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

const KnowledgeSpaceOverviewStatsWindowResponseSchema = z
  .object({
    answerRate: z.number().min(0).max(1),
    answeredQueryCount: z.number().int().nonnegative(),
    queryCount: z.number().int().nonnegative(),
    since: IsoDateTimeSchema,
  })
  .strict();

export const KnowledgeSpaceOverviewStatsResponseSchema = z
  .object({
    current: z
      .object({
        freshSourceCount: z.number().int().nonnegative(),
        knowledgeCount: z.number().int().nonnegative(),
        latestSourceSyncAt: IsoDateTimeSchema.optional(),
        linkedAppCount: z.number().int().nonnegative(),
        sourceCount: z.number().int().nonnegative(),
        staleSourceCount: z.number().int().nonnegative(),
      })
      .strict(),
    generatedAt: IsoDateTimeSchema,
    knowledgeSpaceId: z.string().uuid(),
    windows: z
      .object({
        "24h": KnowledgeSpaceOverviewStatsWindowResponseSchema,
        "30d": KnowledgeSpaceOverviewStatsWindowResponseSchema,
        "7d": KnowledgeSpaceOverviewStatsWindowResponseSchema,
      })
      .strict(),
  })
  .strict();

const HealthComponentSchema = z
  .object({ codes: z.array(z.string()), state: z.enum(KnowledgeSpaceHealthStates) })
  .strict();
export const KnowledgeSpaceProductHealthResponseSchema = z
  .object({
    components: z
      .object({
        index: HealthComponentSchema,
        ingestion: HealthComponentSchema,
        profilePublication: HealthComponentSchema,
        queryAvailability: HealthComponentSchema,
        sourceFreshness: HealthComponentSchema,
        workerReadiness: HealthComponentSchema,
      })
      .strict(),
    generatedAt: IsoDateTimeSchema,
    knowledgeSpaceId: z.string().uuid(),
    state: z.enum(KnowledgeSpaceHealthStates),
  })
  .strict();
