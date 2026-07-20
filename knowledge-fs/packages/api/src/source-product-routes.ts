import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import { SourceWorkflowRunResponseSchema } from "./source-routes";

const SpaceParams = z.object({ id: z.string().uuid() });
const ConnectionParams = z.object({ id: z.string().uuid(), connectionId: z.string().uuid() });
const WorkflowParams = z.object({ id: z.string().uuid(), runId: z.string().uuid() });
const SourceParams = z.object({ id: z.string().uuid(), sourceId: z.string().uuid() });
const IdempotencyHeader = z.object({ "Idempotency-Key": z.string().min(1).max(255) });
const ErrorResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Request failed",
} as const;

const ProviderField = z.object({
  description: z.string().optional(),
  format: z.enum(["password", "uri"]).optional(),
  name: z.string(),
  required: z.boolean(),
  secret: z.boolean(),
  type: z.enum(["boolean", "integer", "string"]),
});
const Provider = z.object({
  authKinds: z.array(z.enum(["api-key", "endpoint", "oauth2"])),
  available: z.boolean(),
  capabilities: z.array(z.enum(["website-crawl", "online-document", "online-drive"])),
  configuration: z.array(ProviderField),
  displayName: z.string(),
  id: z.string(),
  unavailableReason: z.string().optional(),
});
const Connection = z.object({
  authKind: z.enum(["api-key", "endpoint", "oauth2"]),
  configuration: z.record(z.union([z.boolean(), z.number(), z.string()])),
  createdAt: z.string(),
  errorCode: z.string().optional(),
  expiresAt: z.string().optional(),
  id: z.string().uuid(),
  knowledgeSpaceId: z.string().uuid(),
  name: z.string(),
  providerId: z.string(),
  scopes: z.array(z.string()),
  status: z.enum(["provisioning", "active", "expired", "error", "revoked"]),
  updatedAt: z.string(),
  version: z.number().int(),
});
const SyncPolicy = z.object({
  createdAt: z.string(),
  customIntervalSeconds: z.number().int().optional(),
  enabled: z.boolean(),
  expectedSourceVersion: z.number().int().min(1),
  id: z.string().uuid(),
  knowledgeSpaceId: z.string().uuid(),
  mode: z.enum(["provider", "manual", "interval", "custom"]),
  nextRunAt: z.string().optional(),
  revision: z.number().int().min(1),
  sourceId: z.string().uuid(),
  updatedAt: z.string(),
});
const BulkWorkflowItem = z.object({
  action: z.enum(["sync", "disable", "remove"]),
  errorCode: z.string().optional(),
  id: z.string().uuid(),
  reason: z.string().optional(),
  sourceId: z.string().uuid(),
  status: z.enum(["eligible", "running", "skipped", "failed", "completed"]),
  updatedAt: z.string(),
});

export const listSourceProvidersRoute = createRoute({
  method: "get",
  path: "/source-providers",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ items: z.array(Provider) }) } },
      description: "Source provider capability catalog",
    },
    401: UnauthorizedResponse,
  },
});

export const createSourceConnectionRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/source-connections",
  request: {
    params: SpaceParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              authKind: z.enum(["api-key", "endpoint"]),
              configuration: z.record(z.union([z.boolean(), z.number(), z.string()])).optional(),
              credentials: z.record(z.unknown()),
              name: z.string().min(1).max(160),
              providerId: z.string().min(1).max(128),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: Connection } },
      description: "Source connection created",
    },
    400: ErrorResponse,
    404: ErrorResponse,
    409: ErrorResponse,
    502: ErrorResponse,
    503: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const startSourceOAuthRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/source-connections/oauth",
  request: {
    params: SpaceParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              configuration: z.record(z.union([z.boolean(), z.number(), z.string()])).optional(),
              name: z.string().min(1).max(160),
              providerId: z.string().min(1).max(128),
              redirectUri: z.string().min(1).max(2048),
              scopes: z.array(z.string().min(1).max(255)).max(100).default([]),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({ authorizationUrl: z.string(), connection: Connection }),
        },
      },
      description: "OAuth authorization started",
    },
    400: ErrorResponse,
    404: ErrorResponse,
    502: ErrorResponse,
    503: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const completeSourceOAuthRoute = createRoute({
  method: "post",
  path: "/source-oauth/callback",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ code: z.string().min(1).max(8192), state: z.string().min(32).max(256) })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: Connection } },
      description: "OAuth connection activated",
    },
    400: ErrorResponse,
    403: ForbiddenResponse,
    409: ErrorResponse,
    502: ErrorResponse,
    503: ErrorResponse,
    401: UnauthorizedResponse,
  },
});

export const listSourceConnectionsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/source-connections",
  request: {
    params: SpaceParams,
    query: z
      .object({
        cursor: z.string().max(4096).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict(),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ items: z.array(Connection), nextCursor: z.string().optional() }),
        },
      },
      description: "Source connections",
    },
    400: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getSourceConnectionRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/source-connections/{connectionId}",
  request: { params: ConnectionParams },
  responses: {
    200: {
      content: { "application/json": { schema: Connection } },
      description: "Source connection",
    },
    404: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const refreshSourceConnectionRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/source-connections/{connectionId}/refresh",
  request: {
    params: ConnectionParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ expectedVersion: z.number().int().min(1) }).strict(),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: Connection } },
      description: "Source connection refreshed",
    },
    404: ErrorResponse,
    409: ErrorResponse,
    502: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const revokeSourceConnectionRoute = createRoute({
  method: "delete",
  path: "/knowledge-spaces/{id}/source-connections/{connectionId}",
  request: {
    params: ConnectionParams,
    query: z.object({ expectedVersion: z.coerce.number().int().min(1) }).strict(),
  },
  responses: {
    200: {
      content: { "application/json": { schema: Connection } },
      description: "Source connection locally revoked",
    },
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const createSourceSyncWorkflowRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/sync",
  request: { params: SourceParams, headers: IdempotencyHeader },
  responses: {
    202: {
      content: { "application/json": { schema: SourceWorkflowRunResponseSchema } },
      description: "Durable source sync accepted",
    },
    400: ErrorResponse,
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const createSourceCrawlPreviewWorkflowRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/crawl-preview",
  request: { params: SourceParams, headers: IdempotencyHeader },
  responses: {
    202: {
      content: { "application/json": { schema: SourceWorkflowRunResponseSchema } },
      description: "Durable crawl preview accepted",
    },
    400: ErrorResponse,
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

const OnlineDocumentImportItem = z
  .object({
    etag: z.string().max(2048).optional(),
    lastEditedTime: z.string().max(2048).optional(),
    name: z.string().max(500).optional(),
    pageId: z.string().min(1).max(2048),
    providerItemId: z.string().min(1).max(2048),
    type: z.string().min(1).max(128),
    workspaceId: z.string().min(1).max(2048),
  })
  .strict();
const OnlineDriveImportItem = z
  .object({
    bucket: z.string().max(2048).optional(),
    etag: z.string().max(2048).optional(),
    id: z.string().min(1).max(2048),
    mimeType: z.string().max(255).optional(),
    name: z.string().min(1).max(500),
    providerItemId: z.string().min(1).max(2048),
  })
  .strict();

export const createSourceImportWorkflowRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/workflow-imports",
  request: {
    params: SourceParams,
    headers: IdempotencyHeader,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.discriminatedUnion("kind", [
            z
              .object({
                items: z.array(OnlineDocumentImportItem).min(1).max(200),
                kind: z.literal("online-document-import"),
              })
              .strict(),
            z
              .object({
                items: z.array(OnlineDriveImportItem).min(1).max(200),
                kind: z.literal("online-drive-import"),
              })
              .strict(),
          ]),
        },
      },
    },
  },
  responses: {
    202: {
      content: { "application/json": { schema: SourceWorkflowRunResponseSchema } },
      description: "Durable provider import accepted",
    },
    400: ErrorResponse,
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getSourceSyncPolicyRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/sync-policy",
  request: { params: SourceParams },
  responses: {
    200: {
      content: { "application/json": { schema: SyncPolicy } },
      description: "Source sync policy",
    },
    404: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const putSourceSyncPolicyRoute = createRoute({
  method: "put",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/sync-policy",
  request: {
    params: SourceParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              customIntervalSeconds: z.number().int().min(3_600).max(2_592_000).optional(),
              enabled: z.boolean(),
              expectedRevision: z.number().int().min(0),
              expectedSourceVersion: z.number().int().min(1),
              mode: z.enum(["provider", "manual", "interval", "custom"]),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SyncPolicy } },
      description: "Source sync policy updated",
    },
    400: ErrorResponse,
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const createSourceBulkWorkflowRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/sources/bulk",
  request: {
    params: SpaceParams,
    headers: IdempotencyHeader,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              action: z.enum(["sync", "disable", "remove"]),
              sourceIds: z.array(z.string().uuid()).min(1).max(200),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    202: {
      content: { "application/json": { schema: SourceWorkflowRunResponseSchema } },
      description: "Durable bulk source workflow accepted",
    },
    400: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listSourceWorkflowsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/source-workflows",
  request: {
    params: SpaceParams,
    query: z
      .object({
        cursor: z.string().max(4096).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        sourceId: z.string().uuid().optional(),
      })
      .strict(),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(SourceWorkflowRunResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Source workflow history",
    },
    400: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getSourceWorkflowRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/source-workflows/{runId}",
  request: { params: WorkflowParams },
  responses: {
    200: {
      content: { "application/json": { schema: SourceWorkflowRunResponseSchema } },
      description: "Source workflow",
    },
    404: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listSourceBulkWorkflowItemsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/source-workflows/{runId}/bulk-items",
  request: {
    params: WorkflowParams,
    query: z
      .object({
        cursor: z.string().max(4096).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict(),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(BulkWorkflowItem),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Per-source bulk workflow results",
    },
    404: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const cancelSourceWorkflowRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/source-workflows/{runId}/cancel",
  request: {
    params: WorkflowParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ reason: z.string().max(1000).optional() }).strict(),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SourceWorkflowRunResponseSchema } },
      description: "Source workflow canceled",
    },
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const retrySourceWorkflowRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/source-workflows/{runId}/retry",
  request: { params: WorkflowParams },
  responses: {
    200: {
      content: { "application/json": { schema: SourceWorkflowRunResponseSchema } },
      description: "Source workflow retried",
    },
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listCrawlPreviewPagesRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/source-workflows/{runId}/pages",
  request: {
    params: WorkflowParams,
    query: z
      .object({
        cursor: z.string().max(4096).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict(),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                description: z.string().optional(),
                etag: z.string().optional(),
                pageId: z.string(),
                sourceUrl: z.string(),
                title: z.string().optional(),
              }),
            ),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Crawl preview pages (content excluded)",
    },
    404: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const selectCrawlPreviewPagesRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/source-workflows/{runId}/selection",
  request: {
    params: WorkflowParams,
    headers: IdempotencyHeader,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ pageIds: z.array(z.string().min(1).max(128)).min(1).max(200) })
            .strict(),
        },
      },
    },
  },
  responses: {
    202: {
      content: { "application/json": { schema: SourceWorkflowRunResponseSchema } },
      description: "Crawl import selection accepted",
    },
    400: ErrorResponse,
    404: ErrorResponse,
    409: ErrorResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
