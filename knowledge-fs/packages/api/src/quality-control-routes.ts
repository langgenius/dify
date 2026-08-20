import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const SpaceParams = z.object({ id: z.string().uuid() });
const TraceParams = SpaceParams.extend({ traceId: z.string().uuid() });
const MissingParams = TraceParams.extend({ itemKey: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
const BadCaseParams = SpaceParams.extend({ badCaseId: z.string().uuid() });
const ReplayParams = SpaceParams.extend({ runId: z.string().uuid() });
const DateTime = z.string().datetime();

const ReplayEvidenceItemSchema = z.object({
  available: z.boolean(),
  documentName: z.string().optional(),
  matched: z.boolean(),
  ordinal: z.number().int().positive(),
  pageNumber: z.number().int().positive().optional(),
  sectionPath: z.array(z.string()),
  text: z.string().optional(),
});

export const QualityTraceHistoryQuerySchema = z
  .object({
    cursor: z.string().max(1000).optional(),
    from: DateTime.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    mode: z.enum(["auto", "deep", "fast", "research"]).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    status: z.enum(["completed", "failed"]).optional(),
    to: DateTime.optional(),
  })
  .strict();

const ScoreSchema = z.number().min(0).max(1).optional();
export const QualityTraceSummarySchema = z
  .object({
    completed: z.boolean(),
    createdAt: DateTime,
    durationMs: z.number().int().nonnegative().optional(),
    evidenceBundleId: z.string().uuid().optional(),
    evidenceState: z.string().optional(),
    finalScore: ScoreSchema,
    id: z.string().uuid(),
    mode: z.enum(["auto", "deep", "fast", "research"]),
    profile: z.object({
      embeddingModel: z.string().optional(),
      embeddingVectorSpaceId: z.string().optional(),
      projectionPublicationId: z.string().uuid().optional(),
      projectionVersion: z.number().int().positive().optional(),
      reasoningModel: z.string().optional(),
      rerankModel: z.string().optional(),
      retrievalProfileRevision: z.number().int().positive().optional(),
    }),
    query: z.string(),
    resultCount: z.number().int().nonnegative(),
    scores: z.object({ final: ScoreSchema, rerank: ScoreSchema, retrieval: ScoreSchema }),
    stages: z.array(
      z.object({
        candidateCount: z.number().int().nonnegative().optional(),
        name: z.string(),
        status: z.enum(["error", "ok", "skipped"]),
      }),
    ),
  })
  .openapi("QualityAnswerTraceSummary");

export const MissingEvidenceReviewSchema = z
  .object({
    actorSubjectId: z.string(),
    createdAt: DateTime,
    id: z.string().uuid(),
    itemKey: z.string(),
    knowledgeSpaceId: z.string().uuid(),
    reason: z.string().optional(),
    revision: z.number().int().positive(),
    status: z.enum(["active", "dismissed"]),
    updatedAt: DateTime,
  })
  .openapi("MissingEvidenceReview");

export const QualityHistoryEventSchema = z.object({
  action: z.string(),
  actorSubjectId: z.string(),
  createdAt: DateTime,
  fromStatus: z.string().optional(),
  id: z.string().uuid(),
  reason: z.string().optional(),
  revision: z.number().int().positive(),
  toStatus: z.string(),
});

export const BadCaseSchema = z
  .object({
    actorSubjectId: z.string(),
    createdAt: DateTime,
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    query: z.string().optional(),
    reason: z.string(),
    replayRunId: z.string().uuid().optional(),
    revision: z.number().int().positive(),
    status: z.enum(["open", "replaying", "fixed", "dismissed"]),
    tags: z.array(z.string()),
    updatedAt: DateTime,
  })
  .openapi("ProductionBadCase");

export const ReplayRunSchema = z
  .object({
    attempt: z.number().int().nonnegative(),
    createdAt: DateTime,
    error: z.string().optional(),
    id: z.string().uuid(),
    items: z.array(
      z.object({
        goldenQuestionId: z.string().uuid(),
        id: z.string().uuid(),
        matchPolicy: z.enum(["all", "any"]),
        ordinal: z.number().int().positive(),
        question: z.string(),
        result: z
          .object({
            evidenceDiff: z.object({
              evidenceItems: z.array(ReplayEvidenceItemSchema).optional(),
              expectedCount: z.number().int().nonnegative(),
              matchedCount: z.number().int().nonnegative(),
              missingCount: z.number().int().nonnegative(),
              retrievedCount: z.number().int().nonnegative(),
            }),
            metrics: z.object({
              denseCandidates: z.number().int().nonnegative().optional(),
              ftsCandidates: z.number().int().nonnegative().optional(),
              fusedCandidates: z.number().int().nonnegative().optional(),
              graphExpansionCandidates: z.number().int().nonnegative().optional(),
              pageIndexMatchedNodes: z.number().int().nonnegative().optional(),
              permissionFilteredCandidates: z.number().int().nonnegative().optional(),
              rerankCandidates: z.number().int().nonnegative().optional(),
              scoreThresholdFilteredCandidates: z.number().int().nonnegative().optional(),
              summaryCandidates: z.number().int().nonnegative().optional(),
              totalMs: z.number().nonnegative().optional(),
            }),
            passed: z.boolean(),
          })
          .optional(),
        state: z.enum(["queued", "running", "passed", "failed", "canceled"]),
      }),
    ),
    knowledgeSpaceId: z.string().uuid(),
    mode: z.enum(["deep", "fast", "research"]),
    provenance: z.object({
      embedding: z
        .object({
          dimension: z.number().int().positive(),
          model: z.string(),
          vectorSpaceId: z.string(),
        })
        .optional(),
      projection: z.object({
        projectionVersion: z.number().int().positive(),
      }),
      retrieval: z.object({
        profileRevision: z.number().int().positive(),
        reasoningModel: z.string(),
        rerankModel: z.string().optional(),
      }),
    }),
    revision: z.number().int().positive(),
    state: z.enum(["queued", "running", "passed", "failed", "canceled"]),
    summary: z.object({
      completed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      hitRate: z.number().min(0).max(1),
      passed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    updatedAt: DateTime,
  })
  .openapi("QualityReplayRun");

const TrendsSchema = z
  .object({
    baseline: z.object({
      failedQueries: z.number(),
      passRate: z.number(),
      totalReplays: z.number(),
    }),
    current: z.object({
      badCases: z.object({
        dismissed: z.number(),
        fixed: z.number(),
        open: z.number(),
        replaying: z.number(),
      }),
      failedQueries: z.number(),
      passRate: z.number(),
      totalReplays: z.number(),
    }),
    from: DateTime,
    slices: z.array(
      z.object({
        failedQueries: z.number(),
        mode: z.string(),
        model: z.string(),
        passRate: z.number(),
        profileRevision: z.number(),
        replayRuns: z.number(),
      }),
    ),
    to: DateTime,
    topUnanswered: z.array(z.object({ count: z.number(), query: z.string() })),
  })
  .openapi("QualityTrendReport");

const commonErrors = {
  400: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Invalid request",
  },
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Quality resource not found",
  },
  409: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Revision conflict",
  },
  503: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Quality runtime unavailable",
  },
  401: UnauthorizedResponse,
  403: ForbiddenResponse,
} as const;

export const listQualityTracesRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaceQualityTraces",
  path: "/knowledge-spaces/{id}/quality/traces",
  tags: ["Quality"],
  request: { params: SpaceParams, query: QualityTraceHistoryQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(QualityTraceSummarySchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Subject-owned, candidate-authorized answer trace history",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const reviewMissingEvidenceRoute = createRoute({
  method: "patch",
  path: "/knowledge-spaces/{id}/quality/traces/{traceId}/missing/{itemKey}",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              expectedRevision: z.number().int().nonnegative(),
              reason: z.string().trim().min(1).max(2000).optional(),
              status: z.enum(["active", "dismissed"]),
            })
            .strict(),
        },
      },
      required: true,
    },
    params: MissingParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: MissingEvidenceReviewSchema } },
      description: "Updated missing-evidence review",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const missingEvidenceHistoryRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/quality/traces/{traceId}/missing/{itemKey}/history",
  request: { params: MissingParams },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ items: z.array(QualityHistoryEventSchema) }) },
      },
      description: "Missing-evidence review history",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const createQualityBadCaseRoute = createRoute({
  method: "post",
  operationId: "createQualityBadCase",
  path: "/knowledge-spaces/{id}/quality/bad-cases",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              reason: z.string().trim().min(1).max(4000),
              tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
              traceId: z.string().uuid(),
            })
            .strict(),
        },
      },
      required: true,
    },
    params: SpaceParams,
  },
  responses: {
    201: {
      content: { "application/json": { schema: BadCaseSchema } },
      description: "Captured production bad case",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const listQualityBadCasesRoute = createRoute({
  method: "get",
  operationId: "listQualityBadCases",
  path: "/knowledge-spaces/{id}/quality/bad-cases",
  request: {
    params: SpaceParams,
    query: z
      .object({
        cursor: z.string().max(1000).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        status: z.enum(["open", "replaying", "fixed", "dismissed"]).optional(),
      })
      .strict(),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ items: z.array(BadCaseSchema), nextCursor: z.string().optional() }),
        },
      },
      description: "Production bad cases",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const getQualityBadCaseRoute = createRoute({
  method: "get",
  operationId: "getQualityBadCase",
  path: "/knowledge-spaces/{id}/quality/bad-cases/{badCaseId}",
  request: { params: BadCaseParams },
  responses: {
    200: {
      content: { "application/json": { schema: BadCaseSchema } },
      description: "Production bad case",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const getQualityBadCaseTraceReferenceRoute = createRoute({
  method: "get",
  operationId: "getQualityBadCaseTraceReference",
  path: "/knowledge-spaces/{id}/quality/bad-cases/{badCaseId}/trace-reference",
  request: { params: BadCaseParams },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ traceId: z.string().uuid() }) } },
      description: "Authorized trace reference for a production bad case",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const updateQualityBadCaseRoute = createRoute({
  method: "patch",
  operationId: "updateQualityBadCase",
  path: "/knowledge-spaces/{id}/quality/bad-cases/{badCaseId}",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              expectedRevision: z.number().int().positive(),
              reason: z.string().trim().min(1).max(4000).optional(),
              replayRunId: z.string().uuid().optional(),
              status: z.enum(["open", "replaying", "fixed", "dismissed"]),
              tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
            })
            .strict(),
        },
      },
      required: true,
    },
    params: BadCaseParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: BadCaseSchema } },
      description: "Updated production bad case",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const badCaseHistoryRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/quality/bad-cases/{badCaseId}/history",
  request: { params: BadCaseParams },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ items: z.array(QualityHistoryEventSchema) }) },
      },
      description: "Production bad-case history",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const createQualityReplayRoute = createRoute({
  method: "post",
  operationId: "createQualityReplay",
  path: "/knowledge-spaces/{id}/quality/replay-runs",
  "x-knowledge-fs-max-response-bytes": 4 * 1024 * 1024,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.union([
            z
              .object({
                goldenQuestionIds: z.array(z.string().uuid()).min(1).max(1000),
                mode: z.enum(["deep", "fast", "research"]).optional(),
              })
              .strict(),
            z
              .object({
                mode: z.enum(["deep", "fast", "research"]).optional(),
                selection: z.literal("all-active"),
              })
              .strict(),
          ]),
        },
      },
      required: true,
    },
    headers: z.object({ "idempotency-key": z.string().trim().min(8).max(255) }),
    params: SpaceParams,
  },
  responses: {
    202: {
      content: { "application/json": { schema: ReplayRunSchema } },
      description: "Durable replay queued",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const getQualityReplayRoute = createRoute({
  method: "get",
  operationId: "getQualityReplay",
  path: "/knowledge-spaces/{id}/quality/replay-runs/{runId}",
  "x-knowledge-fs-max-response-bytes": 4 * 1024 * 1024,
  request: {
    params: ReplayParams,
    query: z.object({ evidenceItemId: z.string().uuid().optional() }).strict(),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ReplayRunSchema } },
      description: "Durable replay run",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const listQualityReplaysRoute = createRoute({
  method: "get",
  operationId: "listQualityReplays",
  path: "/knowledge-spaces/{id}/quality/replay-runs",
  "x-knowledge-fs-max-response-bytes": 4 * 1024 * 1024,
  request: {
    params: SpaceParams,
    query: z
      .object({
        cursor: z.string().max(1000).optional(),
        from: DateTime.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        mode: z.enum(["deep", "fast", "research"]).optional(),
        state: z.enum(["queued", "running", "passed", "failed", "canceled"]).optional(),
        to: DateTime.optional(),
      })
      .strict(),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ items: z.array(ReplayRunSchema), nextCursor: z.string().optional() }),
        },
      },
      description: "Bounded durable replay history",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const cancelQualityReplayRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/quality/replay-runs/{runId}/cancel",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ expectedRevision: z.number().int().positive() }).strict(),
        },
      },
      required: true,
    },
    params: ReplayParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: ReplayRunSchema } },
      description: "Canceled replay run",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const retryQualityReplayRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/quality/replay-runs/{runId}/retry",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ expectedRevision: z.number().int().positive() }).strict(),
        },
      },
      required: true,
    },
    params: ReplayParams,
  },
  responses: {
    202: {
      content: { "application/json": { schema: ReplayRunSchema } },
      description: "Replay requeued with fresh permission/profile snapshot",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export const qualityTrendsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/quality/trends",
  request: {
    params: SpaceParams,
    query: z
      .object({
        from: DateTime.optional(),
        to: DateTime.optional(),
        window: z.enum(["24h", "7d", "30d"]).default("7d"),
      })
      .strict(),
  },
  responses: {
    200: {
      content: { "application/json": { schema: TrendsSchema } },
      description: "Bounded quality trends and baseline comparison",
    },
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
    409: commonErrors[409],
    503: commonErrors[503],
  },
});

export function decodeQualityCursor(value: string | undefined) {
  if (!value) return undefined;
  const parsed = z
    .object({ createdAt: DateTime, id: z.string().uuid() })
    .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown);
  return parsed;
}

export function encodeQualityCursor(value: { readonly createdAt: string; readonly id: string }) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
