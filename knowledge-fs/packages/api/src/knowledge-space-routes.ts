import { createRoute, z } from "@hono/zod-openapi";
import {
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceEmbeddingSelectionSchema,
  KnowledgeSpacePendingModelConfigurationSchema,
  KnowledgeSpaceRetrievalProfileInputSchema,
  KnowledgeSpaceRetrievalProfileSchema,
  UuidSchema,
} from "@knowledge/core";

import {
  KnowledgeFsGcDryRunReportResponseSchema,
  KnowledgeFsLeaseResponseSchema,
  KnowledgeFsStagedObjectGcExecuteResponseSchema,
  KnowledgeFsckReportResponseSchema,
  KnowledgeSpaceCreationResponseSchema,
  KnowledgeSpaceEmbeddingProfileResponseSchema,
  KnowledgeSpaceManifestResponseSchema,
  KnowledgeSpacePendingModelConfigurationResponseSchema,
  KnowledgeSpaceResponseSchema,
  KnowledgeSpaceRetrievalProfileResponseSchema,
  KnowledgeSpaceStagedCommitResponseSchema,
  KnowledgeSpaceStatsResponseSchema,
  KnowledgeSpaceStatusResponseSchema,
} from "./core-resource-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  ErrorResponseSchema,
  RetrievalProfileModeErrorResponseSchema,
} from "./gateway-route-schemas";
import {
  CreateKnowledgeSpaceSchema,
  ExecuteKnowledgeSpaceStagedObjectGcSchema,
  KnowledgeSpaceFsckQuerySchema,
  KnowledgeSpaceGcDryRunQuerySchema,
  KnowledgeSpaceParamsSchema,
  KnowledgeSpaceStatsQuerySchema,
  ListActiveLeasesQuerySchema,
  ListKnowledgeSpacesQuerySchema,
  ListStagedCommitsQuerySchema,
  UpdateKnowledgeSpaceEmbeddingProfileSchema,
  UpdateKnowledgeSpaceRetrievalProfileSchema,
  UpdateKnowledgeSpaceSchema,
} from "./knowledge-space-golden-question-schemas";
import { KnowledgeSpaceProfileMigrationResponseSchema } from "./knowledge-space-profile-migration-schemas";

export const KnowledgeSpaceListResponseSchema = z
  .object({
    items: z.array(KnowledgeSpaceResponseSchema),
    nextCursor: z.string().optional(),
  })
  .openapi("KnowledgeSpaceList");

export const MAX_BATCH_KNOWLEDGE_SPACE_PRODUCT_SUMMARIES = 100;

export const BatchKnowledgeSpaceProductSummariesRequestSchema = z
  .object({
    knowledgeSpaceIds: z
      .array(UuidSchema)
      .min(1)
      .max(MAX_BATCH_KNOWLEDGE_SPACE_PRODUCT_SUMMARIES)
      .refine((ids) => new Set(ids).size === ids.length, "Knowledge space IDs must be unique"),
  })
  .strict()
  .openapi("BatchKnowledgeSpaceProductSummariesRequest");

export const KnowledgeSpaceProductModelProfileSchema = z
  .object({
    embeddingProfile: KnowledgeSpaceEmbeddingProfileSchema.nullable(),
    pendingModelConfiguration: KnowledgeSpacePendingModelConfigurationSchema.nullable(),
    retrievalProfile: KnowledgeSpaceRetrievalProfileSchema.nullable(),
  })
  .strict()
  .openapi("KnowledgeSpaceProductModelProfile");

export const KnowledgeSpaceProductSummarySchema = z
  .object({
    description: z.string().max(2_000).nullable(),
    documentCount: z.number().int().nonnegative(),
    icon: z.string().max(72).nullable(),
    indexState: z.string().max(64).nullable(),
    knowledgeSpaceId: UuidSchema,
    lastJobState: z.string().max(64).nullable(),
    modelProfile: KnowledgeSpaceProductModelProfileSchema.nullable(),
    name: z.string().min(1).max(160),
    revision: z.number().int().positive(),
    slug: z.string().min(1).max(160),
  })
  .strict()
  .openapi("KnowledgeSpaceProductSummary");

export const BatchKnowledgeSpaceProductSummariesResponseSchema = z
  .object({
    items: z
      .array(KnowledgeSpaceProductSummarySchema)
      .max(MAX_BATCH_KNOWLEDGE_SPACE_PRODUCT_SUMMARIES),
  })
  .strict()
  .openapi("BatchKnowledgeSpaceProductSummariesResponse");

export const KnowledgeSpaceProductSettingsSchema = z
  .object({
    configurationState: z.enum([
      "active",
      "pending-validation",
      "setup-required",
      "validation-failed",
    ]),
    embedding: z
      .union([KnowledgeSpaceEmbeddingSelectionSchema, KnowledgeSpaceEmbeddingProfileSchema])
      .nullable(),
    retrieval: z
      .union([KnowledgeSpaceRetrievalProfileInputSchema, KnowledgeSpaceRetrievalProfileSchema])
      .nullable(),
    revision: z.number().int().positive(),
  })
  .strict()
  .openapi("KnowledgeSpaceProductSettings");

export const UpdateKnowledgeSpaceProductSettingsSchema = z
  .object({
    embedding: KnowledgeSpaceEmbeddingSelectionSchema.optional(),
    expectedRevision: z.number().int().positive(),
    retrieval: KnowledgeSpaceRetrievalProfileInputSchema.optional(),
  })
  .strict()
  .refine((value) => value.embedding !== undefined || value.retrieval !== undefined, {
    message: "At least one product setting must be supplied",
  })
  .openapi("UpdateKnowledgeSpaceProductSettings");

export const batchKnowledgeSpaceProductSummariesRoute = createRoute({
  method: "post",
  operationId: "batchKnowledgeSpaceProductSummaries",
  path: "/internal/knowledge-spaces/product-summaries/batch",
  tags: ["Knowledge Spaces"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: BatchKnowledgeSpaceProductSummariesRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: BatchKnowledgeSpaceProductSummariesResponseSchema,
        },
      },
      description: "Explicit Capability-scoped knowledge-space product summaries",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid or oversized batch request",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceProductSettingsRoute = createRoute({
  method: "get",
  operationId: "getKnowledgeSpaceProductSettings",
  path: "/knowledge-spaces/{id}/product-settings",
  tags: ["Knowledge Spaces"],
  request: {
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceProductSettingsSchema } },
      description: "Effective product model settings for the knowledge space",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const updateKnowledgeSpaceProductSettingsRoute = createRoute({
  method: "patch",
  operationId: "updateKnowledgeSpaceProductSettings",
  path: "/knowledge-spaces/{id}/product-settings",
  tags: ["Knowledge Spaces"],
  request: {
    body: {
      content: { "application/json": { schema: UpdateKnowledgeSpaceProductSettingsSchema } },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceProductSettingsSchema } },
      description: "Pending model settings accepted for first-document asynchronous validation",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description:
        "Settings revision conflict or an active profile requires the migration workflow",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const createKnowledgeSpaceRoute = createRoute({
  method: "post",
  operationId: "createKnowledgeSpace",
  path: "/knowledge-spaces",
  tags: ["Knowledge Spaces"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateKnowledgeSpaceSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceCreationResponseSchema,
        },
      },
      description: "Created knowledge space",
    },
    400: {
      content: {
        "application/json": {
          schema: RetrievalProfileModeErrorResponseSchema,
        },
      },
      description: "Invalid knowledge space configuration",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Tenant slug conflict",
    },
    422: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "A selected model failed capability validation",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Model capability preflight or atomic provisioning is unavailable",
    },
    429: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space capacity exceeded",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listKnowledgeSpacesRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaces",
  path: "/knowledge-spaces",
  tags: ["Knowledge Spaces"],
  request: {
    query: ListKnowledgeSpacesQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceListResponseSchema,
        },
      },
      description: "Tenant knowledge spaces",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid list request",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceRoute = createRoute({
  method: "get",
  operationId: "getKnowledgeSpace",
  path: "/knowledge-spaces/{id}",
  request: {
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceResponseSchema,
        },
      },
      description: "Knowledge space",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceManifestRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/manifest",
  request: {
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceManifestResponseSchema,
        },
      },
      description: "KnowledgeSpace control-plane manifest",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const updateKnowledgeSpaceEmbeddingProfileRoute = createRoute({
  method: "put",
  path: "/knowledge-spaces/{id}/embedding-profile",
  request: {
    body: {
      content: {
        "application/json": {
          schema: UpdateKnowledgeSpaceEmbeddingProfileSchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    202: {
      content: {
        "application/json": {
          schema: z.union([
            KnowledgeSpacePendingModelConfigurationResponseSchema,
            KnowledgeSpaceProfileMigrationResponseSchema,
          ]),
        },
      },
      description: "Initial validation or a published-space embedding migration was accepted",
    },
    200: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceEmbeddingProfileResponseSchema,
        },
      },
      description: "Active embedding profile for the knowledge space",
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
          schema: ErrorResponseSchema,
        },
      },
      description: "Embedding ingestion was admitted; profile change requires a reindex workflow",
    },
    422: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "The embedding model failed capability validation",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Embedding model preflight is temporarily unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const updateKnowledgeSpaceRetrievalProfileRoute = createRoute({
  method: "put",
  path: "/knowledge-spaces/{id}/retrieval-profile",
  request: {
    body: {
      content: {
        "application/json": {
          schema: UpdateKnowledgeSpaceRetrievalProfileSchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    202: {
      content: {
        "application/json": {
          schema: z.union([
            KnowledgeSpacePendingModelConfigurationResponseSchema,
            KnowledgeSpaceProfileMigrationResponseSchema,
          ]),
        },
      },
      description: "Initial validation or a published-space retrieval migration was accepted",
    },
    200: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceRetrievalProfileResponseSchema,
        },
      },
      description: "Versioned retrieval profile for the knowledge space",
    },
    400: {
      content: {
        "application/json": {
          schema: RetrievalProfileModeErrorResponseSchema,
        },
      },
      description: "Retrieval profile is incompatible with its default mode",
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
          schema: ErrorResponseSchema,
        },
      },
      description: "Retrieval profile revision conflict",
    },
    422: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "A retrieval model failed capability validation",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Retrieval model preflight is temporarily unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceStatusRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/status",
  request: {
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceStatusResponseSchema,
        },
      },
      description:
        "Bounded KnowledgeSpace control-plane status, including safe model-configuration validation state",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceStatsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/stats",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeSpaceStatsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeSpaceStatsResponseSchema,
        },
      },
      description: "Low-cardinality KnowledgeSpace statistics",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid stats request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceFsckRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fsck",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeSpaceFsckQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsckReportResponseSchema,
        },
      },
      description: "Bounded KnowledgeSpace fsck diagnostics",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid fsck request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceStagedObjectGcDryRunRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/gc/staged-objects",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeSpaceGcDryRunQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsGcDryRunReportResponseSchema,
        },
      },
      description: "Bounded staged object GC dry-run",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid GC dry-run request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const executeKnowledgeSpaceStagedObjectGcRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/gc/staged-objects/execute",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ExecuteKnowledgeSpaceStagedObjectGcSchema,
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
          schema: KnowledgeFsStagedObjectGcExecuteResponseSchema,
        },
      },
      description: "Execute staged object GC candidates",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid GC execute request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listKnowledgeSpaceStagedCommitsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/staged-commits",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: ListStagedCommitsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(KnowledgeSpaceStagedCommitResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Read-only staged commit diagnostics",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid staged commit diagnostic list request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listKnowledgeSpaceActiveLeasesRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/leases/active",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: ListActiveLeasesQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(KnowledgeFsLeaseResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Read-only active KnowledgeFS lease diagnostics",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid active lease diagnostic list request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const updateKnowledgeSpaceRoute = createRoute({
  method: "patch",
  operationId: "updateKnowledgeSpace",
  path: "/knowledge-spaces/{id}",
  request: {
    body: {
      content: {
        "application/json": {
          schema: UpdateKnowledgeSpaceSchema,
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
          schema: KnowledgeSpaceResponseSchema,
        },
      },
      description: "Updated knowledge space",
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
          schema: ErrorResponseSchema,
        },
      },
      description: "Tenant slug or knowledge-space revision conflict",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
