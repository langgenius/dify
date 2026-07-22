import { createRoute } from "@hono/zod-openapi";

import {
  BulkDocumentReindexBodySchema,
  BulkDocumentUploadBodySchema,
  BulkDocumentUploadParamsSchema,
  DocumentUploadBodySchema,
  DocumentUploadParamsSchema,
} from "./document-request-schemas";
import {
  BulkDocumentReindexResponseSchema,
  BulkDocumentUploadAcceptedResponseSchema,
  DocumentAssetResponseSchema,
  DocumentUploadAcceptedResponseSchema,
} from "./document-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

export const uploadDocumentRoute = createRoute({
  method: "post",
  operationId: "uploadDocument",
  path: "/knowledge-spaces/{id}/documents",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: DocumentUploadBodySchema,
        },
      },
      required: true,
    },
    params: DocumentUploadParamsSchema,
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: DocumentAssetResponseSchema,
        },
      },
      description: "Uploaded document asset",
    },
    202: {
      content: {
        "application/json": {
          schema: DocumentUploadAcceptedResponseSchema,
        },
      },
      description: "Accepted document asset for durable compilation",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid upload request",
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
      content: { "application/json": { schema: ErrorResponseSchema } },
      description:
        "Logical document CAS conflict or knowledge space publication bootstrap is active",
    },
    413: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Upload too large",
    },
    429: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document asset capacity exceeded",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document upload failed",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Durable logical document compilation unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const bulkUploadDocumentsRoute = createRoute({
  method: "post",
  operationId: "bulkUploadDocuments",
  path: "/knowledge-spaces/{id}/documents/bulk",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: BulkDocumentUploadBodySchema,
        },
      },
      required: true,
    },
    params: BulkDocumentUploadParamsSchema,
  },
  responses: {
    202: {
      content: {
        "application/json": {
          schema: BulkDocumentUploadAcceptedResponseSchema,
        },
      },
      description: "Accepted bulk document upload for durable compilation",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid bulk upload request",
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
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space publication bootstrap is active",
    },
    413: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Bulk upload too large",
    },
    429: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document asset capacity exceeded",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Bulk document upload failed",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Durable document compilation is not configured",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const bulkReindexDocumentsRoute = createRoute({
  method: "post",
  operationId: "bulkReindexDocuments",
  path: "/knowledge-spaces/{id}/documents/bulk/reindex",
  request: {
    body: {
      content: {
        "application/json": {
          schema: BulkDocumentReindexBodySchema,
        },
      },
      required: true,
    },
    params: BulkDocumentUploadParamsSchema,
  },
  responses: {
    202: {
      content: {
        "application/json": {
          schema: BulkDocumentReindexResponseSchema,
        },
      },
      description: "Accepted bulk document reindex",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid bulk reindex request",
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
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space publication bootstrap is active",
    },
    413: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "KnowledgeSpace quota exceeded",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Durable document compilation is not configured",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
