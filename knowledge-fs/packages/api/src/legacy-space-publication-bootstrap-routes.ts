import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

export const LegacySpacePublicationBootstrapParamsSchema = z.object({
  id: z.string().uuid(),
});

export const LegacySpacePublicationBootstrapResponseSchema = z.object({
  checkpoint: z.enum([
    "pending_snapshot",
    "snapshot_captured",
    "rebuilding",
    "verifying",
    "published",
  ]),
  completedAt: z.string().datetime().optional(),
  completedDocuments: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
  knowledgeSpaceId: z.string().uuid(),
  lastErrorCode: z.string().optional(),
  lastErrorMessage: z.string().optional(),
  publishedFingerprint: z.string().optional(),
  publishedHeadRevision: z.number().int().positive().optional(),
  publishedPublicationId: z.string().uuid().optional(),
  rowVersion: z.number().int().nonnegative(),
  runState: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
  tenantId: z.string().min(1),
  totalDocuments: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

const commonResponses = {
  401: UnauthorizedResponse,
  403: ForbiddenResponse,
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Knowledge space or bootstrap not found",
  },
  409: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Bootstrap lifecycle conflict",
  },
  503: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Legacy publication bootstrap unavailable",
  },
} as const;

export const startLegacySpacePublicationBootstrapRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/publication-bootstrap",
  request: { params: LegacySpacePublicationBootstrapParamsSchema },
  responses: {
    202: {
      content: { "application/json": { schema: LegacySpacePublicationBootstrapResponseSchema } },
      description: "Durable whole-space publication bootstrap accepted",
    },
    401: commonResponses[401],
    403: commonResponses[403],
    404: commonResponses[404],
    409: commonResponses[409],
    503: commonResponses[503],
  },
});

export const getLegacySpacePublicationBootstrapRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/publication-bootstrap",
  request: { params: LegacySpacePublicationBootstrapParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: LegacySpacePublicationBootstrapResponseSchema } },
      description: "Whole-space publication bootstrap status",
    },
    401: commonResponses[401],
    403: commonResponses[403],
    404: commonResponses[404],
    409: commonResponses[409],
    503: commonResponses[503],
  },
});

export const retryLegacySpacePublicationBootstrapRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/publication-bootstrap/retry",
  request: { params: LegacySpacePublicationBootstrapParamsSchema },
  responses: {
    202: {
      content: { "application/json": { schema: LegacySpacePublicationBootstrapResponseSchema } },
      description: "Failed whole-space bootstrap requeued",
    },
    401: commonResponses[401],
    403: commonResponses[403],
    404: commonResponses[404],
    409: commonResponses[409],
    503: commonResponses[503],
  },
});
