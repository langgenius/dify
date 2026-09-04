import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const ErrorResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Request failed",
} as const;
const JobParams = z.object({ jobId: z.string().uuid() });
const Job = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "canceled", "consumed"]),
  configurationFingerprint: z.string(),
  expiresAt: z.string(),
  errorCode: z.string().optional(),
  importWorkflowId: z.string().uuid().optional(),
});
const Page = z.object({
  pageId: z.string(),
  sourceUrl: z.string().url(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const createNamespaceSourcePreviewRoute = createRoute({
  method: "post",
  operationId: "createNamespaceSourcePreview",
  path: "/namespace/source-preview-jobs",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              credentialId: z.string().min(1).max(255),
              pluginId: z.string().min(1).max(1024),
              provider: z.string().min(1).max(255),
              datasource: z.string().min(1).max(255),
              parameters: z.record(z.unknown()),
              rootUrl: z.string().url().max(4096),
              configurationFingerprint: z.string().min(1).max(128),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    202: {
      content: { "application/json": { schema: Job } },
      description: "Website preview queued",
    },
    400: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
export const getNamespaceSourcePreviewRoute = createRoute({
  method: "get",
  operationId: "getNamespaceSourcePreview",
  path: "/namespace/source-preview-jobs/{jobId}",
  request: { params: JobParams },
  responses: {
    200: {
      content: { "application/json": { schema: Job.extend({ pages: z.array(Page) }) } },
      description: "Website preview status",
    },
    404: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
export const cancelNamespaceSourcePreviewRoute = createRoute({
  method: "delete",
  operationId: "cancelNamespaceSourcePreview",
  path: "/namespace/source-preview-jobs/{jobId}",
  request: { params: JobParams },
  responses: {
    200: {
      content: { "application/json": { schema: Job } },
      description: "Website preview canceled",
    },
    404: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
export const consumeNamespaceSourcePreviewRoute = createRoute({
  method: "post",
  operationId: "consumeNamespaceSourcePreview",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/namespace-preview-import",
  request: {
    params: z.object({ id: z.string().uuid(), sourceId: z.string().uuid() }),
    headers: z.object({ "Idempotency-Key": z.string().min(8).max(255) }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              previewJobId: z.string().uuid(),
              pageIds: z.array(z.string().min(1).max(128)).min(1).max(200),
              configurationFingerprint: z.string().min(1).max(128),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    202: {
      content: { "application/json": { schema: z.object({ workflowId: z.string().uuid() }) } },
      description: "Preview import accepted",
    },
    400: ErrorResponse,
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
