import { createRoute, z } from "@hono/zod-openapi";

import { SourceResponseSchema } from "./core-resource-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  CandidateVisibilityScanBudgetExceededResponseSchema,
  ErrorResponseSchema,
} from "./gateway-route-schemas";
import {
  BrowseSourceFilesQuerySchema,
  CreateSourceSchema,
  ImportSourceFilesSchema,
  ImportSourcePagesSchema,
  ListSourcePagesQuerySchema,
  ListSourcesQuerySchema,
  RevokeSourceCredentialsQuerySchema,
  RotateSourceCredentialsSchema,
  SourceParamsSchema,
  SourceSpaceParamsSchema,
  UpdateSourceSchema,
} from "./source-request-schemas";

const NotFoundResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Knowledge space or source not found",
} as const;

const InvalidRequestResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Invalid request",
} as const;

const SourceVersionConflictResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Source was modified concurrently (expectedVersion mismatch)",
} as const;

export const SourceWorkflowRunResponseSchema = z
  .object({
    canceledAt: z.string().optional(),
    checkpoint: z.string(),
    completedAt: z.string().optional(),
    createdAt: z.string(),
    cursor: z.string().optional(),
    executionAttempts: z.number().int(),
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    kind: z.string(),
    lastErrorCode: z.string().optional(),
    maxExecutionAttempts: z.number().int(),
    progressCompleted: z.number().int(),
    progressFailed: z.number().int(),
    progressSkipped: z.number().int(),
    progressTotal: z.number().int().optional(),
    sourceId: z.string().uuid().optional(),
    state: z.string(),
    updatedAt: z.string(),
  })
  .openapi("SourceWorkflowRun");

export const createSourceRoute = createRoute({
  method: "post",
  operationId: "createKnowledgeSpaceSource",
  path: "/knowledge-spaces/{id}/sources",
  tags: ["Sources"],
  request: {
    body: { content: { "application/json": { schema: CreateSourceSchema } }, required: true },
    params: SourceSpaceParamsSchema,
  },
  responses: {
    201: {
      content: { "application/json": { schema: SourceResponseSchema } },
      description: "Created source",
    },
    400: InvalidRequestResponse,
    404: NotFoundResponse,
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Source connection is not active or input bindings conflict",
    },
    429: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Source capacity exceeded",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Source SecretStore is required for credential-bearing writes",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listSourcesRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaceSources",
  path: "/knowledge-spaces/{id}/sources",
  tags: ["Sources"],
  request: {
    params: SourceSpaceParamsSchema,
    query: ListSourcesQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(SourceResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Knowledge space sources",
    },
    400: InvalidRequestResponse,
    404: NotFoundResponse,
    503: {
      content: {
        "application/json": { schema: CandidateVisibilityScanBudgetExceededResponseSchema },
      },
      description: "Candidate visibility scan budget exceeded",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getSourceRoute = createRoute({
  method: "get",
  operationId: "getKnowledgeSpaceSource",
  path: "/knowledge-spaces/{id}/sources/{sourceId}",
  request: {
    params: SourceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SourceResponseSchema } },
      description: "Source",
    },
    404: NotFoundResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const updateSourceRoute = createRoute({
  method: "patch",
  operationId: "updateKnowledgeSpaceSource",
  path: "/knowledge-spaces/{id}/sources/{sourceId}",
  request: {
    body: { content: { "application/json": { schema: UpdateSourceSchema } }, required: true },
    params: SourceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SourceResponseSchema } },
      description: "Updated source",
    },
    400: InvalidRequestResponse,
    404: NotFoundResponse,
    409: SourceVersionConflictResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const rotateSourceCredentialsRoute = createRoute({
  method: "put",
  operationId: "rotateKnowledgeSpaceSourceCredentials",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/credentials",
  request: {
    body: {
      content: { "application/json": { schema: RotateSourceCredentialsSchema } },
      required: true,
    },
    params: SourceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SourceResponseSchema } },
      description: "Rotated source credentials; secret bytes are returned neither here nor later",
    },
    404: NotFoundResponse,
    409: SourceVersionConflictResponse,
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Source SecretStore is not configured or unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const revokeSourceCredentialsRoute = createRoute({
  method: "delete",
  operationId: "revokeKnowledgeSpaceSourceCredentials",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/credentials",
  request: {
    params: SourceParamsSchema,
    query: RevokeSourceCredentialsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SourceResponseSchema } },
      description: "Revoked source credentials",
    },
    404: NotFoundResponse,
    409: SourceVersionConflictResponse,
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Source SecretStore is not configured or unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

const CrawledPageSchema = z.object({
  content: z.string(),
  description: z.string().optional(),
  sourceUrl: z.string(),
  title: z.string().optional(),
});

const WebsiteCrawlResponseSchema = z
  .object({
    completed: z.number().optional(),
    failed: z.number().optional(),
    imported: z.number().optional(),
    pages: z.array(CrawledPageSchema),
    /** Superseded documents of changed pages that were cascade-deleted. */
    replaced: z.number().optional(),
    /** Pages skipped because their content hash is unchanged since the last crawl. */
    skipped: z.number().optional(),
    status: z.string().optional(),
    total: z.number().optional(),
  })
  .openapi("WebsiteCrawlResult");

export const crawlSourceRoute = createRoute({
  method: "post",
  operationId: "crawlKnowledgeSpaceSource",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/crawl",
  request: {
    params: SourceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: WebsiteCrawlResponseSchema } },
      description: "Website crawl result",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Source is not a website crawl source",
    },
    404: NotFoundResponse,
    409: SourceVersionConflictResponse,
    501: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Website crawl connector is not configured",
    },
    502: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Website crawl failed",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

const OnlineDocumentPageSchema = z.object({
  lastEditedTime: z.string().optional(),
  pageId: z.string(),
  pageName: z.string(),
  parentId: z.string().optional(),
  type: z.string(),
});

const OnlineDocumentPagesResponseSchema = z
  .object({
    nextCursor: z.string().optional(),
    workspaces: z.array(
      z.object({
        pages: z.array(OnlineDocumentPageSchema),
        total: z.number().optional(),
        workspaceId: z.string().optional(),
        workspaceName: z.string().optional(),
      }),
    ),
  })
  .openapi("OnlineDocumentPages");

const SourceImportResponseSchema = z
  .object({
    documents: z.array(z.object({ documentAssetId: z.string(), filename: z.string() })),
    failed: z.array(z.object({ code: z.string(), error: z.string(), filename: z.string() })),
    skipped: z.array(z.string()),
  })
  .openapi("SourceImportResult");

const NotConfiguredResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Online-document connector is not configured",
} as const;

const NotConnectorResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Source is not an online-document connector",
} as const;

const UpstreamFailureResponse = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Online-document provider request failed",
} as const;

export const listSourcePagesRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaceSourcePages",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/pages",
  request: {
    params: SourceParamsSchema,
    query: ListSourcePagesQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: OnlineDocumentPagesResponseSchema } },
      description: "Authorized online-document pages",
    },
    400: NotConnectorResponse,
    404: NotFoundResponse,
    501: NotConfiguredResponse,
    502: UpstreamFailureResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

const SourceCredentialTestResponseSchema = z
  .object({
    code: z.string().optional(),
    error: z.string().optional(),
    valid: z.boolean(),
  })
  .openapi("SourceCredentialTest");

export const testSourceCredentialsRoute = createRoute({
  method: "post",
  operationId: "testKnowledgeSpaceSource",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/test",
  request: {
    params: SourceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SourceCredentialTestResponseSchema } },
      description: "Source credential validation result",
    },
    404: NotFoundResponse,
    501: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Source credential tester is not configured",
    },
    502: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Source credential provider request failed",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const importSourcePagesRoute = createRoute({
  method: "post",
  operationId: "importKnowledgeSpaceSourcePages",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/import",
  request: {
    body: { content: { "application/json": { schema: ImportSourcePagesSchema } }, required: true },
    params: SourceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SourceImportResponseSchema } },
      description: "Imported online-document pages",
    },
    400: NotConnectorResponse,
    404: NotFoundResponse,
    409: SourceVersionConflictResponse,
    501: NotConfiguredResponse,
    502: UpstreamFailureResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

const OnlineDriveBrowseResponseSchema = z
  .object({
    buckets: z.array(
      z.object({
        bucket: z.string().optional(),
        continuationToken: z.string().optional(),
        files: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            size: z.number().optional(),
            type: z.string(),
          }),
        ),
        isTruncated: z.boolean().optional(),
      }),
    ),
  })
  .openapi("OnlineDriveFiles");

export const browseSourceFilesRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaceSourceFiles",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/files",
  request: {
    params: SourceParamsSchema,
    query: BrowseSourceFilesQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: OnlineDriveBrowseResponseSchema } },
      description: "Online-drive files",
    },
    400: NotConnectorResponse,
    404: NotFoundResponse,
    501: NotConfiguredResponse,
    502: UpstreamFailureResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const importSourceFilesRoute = createRoute({
  method: "post",
  operationId: "importKnowledgeSpaceSourceFiles",
  path: "/knowledge-spaces/{id}/sources/{sourceId}/import-files",
  request: {
    body: { content: { "application/json": { schema: ImportSourceFilesSchema } }, required: true },
    params: SourceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: SourceImportResponseSchema } },
      description: "Imported online-drive files",
    },
    400: NotConnectorResponse,
    404: NotFoundResponse,
    409: SourceVersionConflictResponse,
    501: NotConfiguredResponse,
    502: UpstreamFailureResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
