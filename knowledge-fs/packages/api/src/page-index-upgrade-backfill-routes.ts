import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

export const PageIndexUpgradeBackfillParamsSchema = z.object({ id: z.string().uuid() });

export const PageIndexUpgradeBackfillResponseSchema = z.object({
  completedAt: z.string().datetime().optional(),
  completedItems: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  headRevision: z.number().int().positive(),
  id: z.string().uuid(),
  knowledgeSpaceId: z.string().uuid(),
  lastErrorCode: z.string().optional(),
  lastErrorMessage: z.string().optional(),
  publicationFingerprint: z.string().min(1),
  publicationId: z.string().uuid(),
  retryCount: z.number().int().nonnegative(),
  rowVersion: z.number().int().nonnegative(),
  runState: z.enum(["queued", "running", "succeeded", "failed", "superseded"]),
  tenantId: z.string().min(1),
  totalItems: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

const common = {
  401: UnauthorizedResponse,
  403: ForbiddenResponse,
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Knowledge space or PageIndex upgrade backfill not found",
  },
  409: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "PageIndex upgrade lifecycle conflict",
  },
  503: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "PageIndex upgrade control plane unavailable",
  },
} as const;

export const getPageIndexUpgradeBackfillRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/page-index-upgrade",
  request: { params: PageIndexUpgradeBackfillParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: PageIndexUpgradeBackfillResponseSchema } },
      description: "Current head PageIndex upgrade status",
    },
    401: common[401],
    403: common[403],
    404: common[404],
    409: common[409],
    503: common[503],
  },
});

export const startPageIndexUpgradeBackfillRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/page-index-upgrade",
  request: { params: PageIndexUpgradeBackfillParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: PageIndexUpgradeBackfillResponseSchema } },
      description: "Existing current-head PageIndex upgrade",
    },
    202: {
      content: { "application/json": { schema: PageIndexUpgradeBackfillResponseSchema } },
      description: "Current-head PageIndex upgrade accepted",
    },
    204: { description: "Current head is already fully PageIndex-ready" },
    401: common[401],
    403: common[403],
    404: common[404],
    409: common[409],
    503: common[503],
  },
});

export const retryPageIndexUpgradeBackfillRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/page-index-upgrade/retry",
  request: { params: PageIndexUpgradeBackfillParamsSchema },
  responses: {
    202: {
      content: { "application/json": { schema: PageIndexUpgradeBackfillResponseSchema } },
      description: "Failed current-head PageIndex upgrade requeued",
    },
    401: common[401],
    403: common[403],
    404: common[404],
    409: common[409],
    503: common[503],
  },
});
