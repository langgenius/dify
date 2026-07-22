import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

export const TidbFtsPostingBackfillParamsSchema = z.object({ id: z.string().uuid() });

export const TidbFtsPostingBackfillResponseSchema = z.object({
  completedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  cursorProjectionId: z.string().uuid().optional(),
  heartbeatAt: z.string().datetime().optional(),
  id: z.string().uuid(),
  knowledgeSpaceId: z.string().uuid(),
  lastErrorCode: z.string().optional(),
  lastErrorMessage: z.string().optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  retryCount: z.number().int().nonnegative(),
  rowVersion: z.number().int().nonnegative(),
  runState: z.enum(["queued", "running", "succeeded", "failed"]),
  scannedProjections: z.number().int().nonnegative(),
  tenantId: z.string().min(1),
  tokenizerVersion: z.string().min(1),
  updatedAt: z.string().datetime(),
  workerId: z.string().optional(),
  writtenPostings: z.number().int().nonnegative(),
});

const common = {
  401: UnauthorizedResponse,
  403: ForbiddenResponse,
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Knowledge space or TiDB FTS posting backfill not found",
  },
  409: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "TiDB FTS posting backfill lifecycle conflict",
  },
  503: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "TiDB FTS posting backfill control plane unavailable",
  },
} as const;

export const getTidbFtsPostingBackfillRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/tidb-fts-posting-backfill",
  request: { params: TidbFtsPostingBackfillParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: TidbFtsPostingBackfillResponseSchema } },
      description: "Current TiDB lexical-posting repair status",
    },
    401: common[401],
    403: common[403],
    404: common[404],
    409: common[409],
    503: common[503],
  },
});

export const startTidbFtsPostingBackfillRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/tidb-fts-posting-backfill",
  request: { params: TidbFtsPostingBackfillParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: TidbFtsPostingBackfillResponseSchema } },
      description: "Existing TiDB lexical-posting repair",
    },
    202: {
      content: { "application/json": { schema: TidbFtsPostingBackfillResponseSchema } },
      description: "TiDB lexical-posting repair accepted",
    },
    204: { description: "Knowledge space already has complete TiDB lexical postings" },
    401: common[401],
    403: common[403],
    404: common[404],
    409: common[409],
    503: common[503],
  },
});

export const retryTidbFtsPostingBackfillRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/tidb-fts-posting-backfill/retry",
  request: { params: TidbFtsPostingBackfillParamsSchema },
  responses: {
    202: {
      content: { "application/json": { schema: TidbFtsPostingBackfillResponseSchema } },
      description: "Failed TiDB lexical-posting repair requeued from its durable cursor",
    },
    401: common[401],
    403: common[403],
    404: common[404],
    409: common[409],
    503: common[503],
  },
});
