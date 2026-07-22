import { createRoute, z } from "@hono/zod-openapi";

import { UuidSchema } from "@knowledge/core";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

const UploadSessionIdParamsSchema = z.object({ id: UuidSchema }).strict();
const UploadSessionPartParamsSchema = z
  .object({ id: UuidSchema, partNumber: z.coerce.number().int().min(1).max(10_000) })
  .strict();
const UploadSessionParentSchema = z.object({ knowledgeSpaceId: UuidSchema }).strict();

export const CreateUploadSessionRequestSchema = z
  .object({
    checksumSha256Base64: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(255),
    expectedSizeBytes: z.number().int().positive(),
    fileName: z.string().trim().min(1).max(512),
    idempotencyKey: z.string().trim().min(1).max(255),
  })
  .strict();

const PresignedUploadSchema = z
  .object({
    expiresAt: z.number().int().nonnegative(),
    headers: z.record(z.string()),
    method: z.literal("PUT"),
    url: z.string().url(),
  })
  .strict();

const PublicUploadSessionSchema = z
  .object({
    compilationJobId: z.string().optional(),
    completedAt: z.number().int().nonnegative().optional(),
    documentAssetId: z.string().optional(),
    expectedSizeBytes: z.number().int().positive(),
    expiresAt: z.number().int().nonnegative(),
    id: UuidSchema,
    mode: z.enum(["single", "multipart", "small_fallback"]),
    multipartPartCount: z.number().int().min(1).max(10_000).optional(),
    multipartPartSizeBytes: z.number().int().positive().optional(),
    status: z.enum([
      "creating",
      "ready",
      "completing",
      "completed",
      "aborting",
      "aborted",
      "expired",
      "failed",
    ]),
  })
  .strict();

const CreateUploadSessionResponseSchema = z
  .object({
    session: PublicUploadSessionSchema,
    upload: PresignedUploadSchema.optional(),
  })
  .strict();

const PresignUploadPartRequestSchema = UploadSessionParentSchema.extend({
  checksumSha256Base64: z.string().trim().min(1).max(255),
  contentLength: z.number().int().positive(),
}).strict();

const MultipartPartSchema = z
  .object({
    checksumSha256Base64: z.string().trim().min(1).max(255).optional(),
    etag: z.string().trim().min(1).max(255),
    partNumber: z.number().int().min(1).max(10_000),
  })
  .strict();

const CompleteUploadSessionRequestSchema = UploadSessionParentSchema.extend({
  parts: z.array(MultipartPartSchema).max(10_000).optional(),
}).strict();

const UploadSessionResponseSchema = z.object({ session: PublicUploadSessionSchema }).strict();

const SmallFileUploadBodySchema = z.any().openapi({ format: "binary", type: "string" });

const UploadSessionErrors = {
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Upload session not found",
  },
  409: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Upload session state or idempotency conflict",
  },
  413: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Upload exceeds the configured bound or quota",
  },
  422: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Uploaded object failed integrity verification",
  },
  503: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Direct object upload is unavailable",
  },
  401: UnauthorizedResponse,
  403: ForbiddenResponse,
} as const;

export const createUploadSessionRoute = createRoute({
  method: "post",
  operationId: "createUploadSession",
  path: "/knowledge-spaces/{id}/upload-sessions",
  request: {
    body: {
      content: { "application/json": { schema: CreateUploadSessionRequestSchema } },
      required: true,
    },
    params: UploadSessionIdParamsSchema,
  },
  responses: {
    201: {
      content: { "application/json": { schema: CreateUploadSessionResponseSchema } },
      description: "Created or replayed a quota-reserved upload session",
    },
    401: UploadSessionErrors[401],
    403: UploadSessionErrors[403],
    404: UploadSessionErrors[404],
    409: UploadSessionErrors[409],
    413: UploadSessionErrors[413],
    422: UploadSessionErrors[422],
    503: UploadSessionErrors[503],
  },
  tags: ["Upload Sessions"],
});

export const presignUploadSessionPartRoute = createRoute({
  method: "post",
  operationId: "presignUploadSessionPart",
  path: "/upload-sessions/{id}/parts/{partNumber}/presign",
  request: {
    body: {
      content: { "application/json": { schema: PresignUploadPartRequestSchema } },
      required: true,
    },
    params: UploadSessionPartParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: PresignedUploadSchema } },
      description: "Short-lived URL for one deterministic multipart part",
    },
    401: UploadSessionErrors[401],
    403: UploadSessionErrors[403],
    404: UploadSessionErrors[404],
    409: UploadSessionErrors[409],
    413: UploadSessionErrors[413],
    422: UploadSessionErrors[422],
    503: UploadSessionErrors[503],
  },
  tags: ["Upload Sessions"],
});

export const uploadSmallFileRoute = createRoute({
  method: "post",
  operationId: "uploadSmallFile",
  path: "/upload-sessions/{id}/small-file",
  request: {
    body: {
      content: { "application/octet-stream": { schema: SmallFileUploadBodySchema } },
      required: true,
    },
    params: UploadSessionIdParamsSchema,
    query: UploadSessionParentSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: UploadSessionResponseSchema } },
      description: "Uploaded and completed a strictly bounded small-file fallback",
    },
    401: UploadSessionErrors[401],
    403: UploadSessionErrors[403],
    404: UploadSessionErrors[404],
    409: UploadSessionErrors[409],
    413: UploadSessionErrors[413],
    422: UploadSessionErrors[422],
    503: UploadSessionErrors[503],
  },
  tags: ["Upload Sessions"],
});

export const completeUploadSessionRoute = createRoute({
  method: "post",
  operationId: "completeUploadSession",
  path: "/upload-sessions/{id}/complete",
  request: {
    body: {
      content: { "application/json": { schema: CompleteUploadSessionRequestSchema } },
      required: true,
    },
    params: UploadSessionIdParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: UploadSessionResponseSchema } },
      description: "Verified upload and idempotent document compilation publication",
    },
    401: UploadSessionErrors[401],
    403: UploadSessionErrors[403],
    404: UploadSessionErrors[404],
    409: UploadSessionErrors[409],
    413: UploadSessionErrors[413],
    422: UploadSessionErrors[422],
    503: UploadSessionErrors[503],
  },
  tags: ["Upload Sessions"],
});

export const abortUploadSessionRoute = createRoute({
  method: "post",
  operationId: "abortUploadSession",
  path: "/upload-sessions/{id}/abort",
  request: {
    body: {
      content: { "application/json": { schema: UploadSessionParentSchema } },
      required: true,
    },
    params: UploadSessionIdParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: UploadSessionResponseSchema } },
      description: "Aborted or replayed an upload-session abort",
    },
    401: UploadSessionErrors[401],
    403: UploadSessionErrors[403],
    404: UploadSessionErrors[404],
    409: UploadSessionErrors[409],
    413: UploadSessionErrors[413],
    422: UploadSessionErrors[422],
    503: UploadSessionErrors[503],
  },
  tags: ["Upload Sessions"],
});
