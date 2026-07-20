import { createRoute } from "@hono/zod-openapi";

import { ParseArtifactResponseSchema } from "./core-resource-response-schemas";
import {
  DocumentAssetParamsSchema,
  DocumentMultimodalAssetParamsSchema,
  DocumentMultimodalAssetQuerySchema,
  ListDocumentAssetsQuerySchema,
  ParseArtifactParamsSchema,
} from "./document-request-schemas";
import {
  DocumentAssetListResponseSchema,
  DocumentAssetResponseSchema,
  DocumentMultimodalManifestResponseSchema,
  DocumentOutlineResponseSchema,
} from "./document-response-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  CandidateVisibilityScanBudgetExceededResponseSchema,
  ErrorResponseSchema,
} from "./gateway-route-schemas";

export const listDocumentAssetsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents",
  request: {
    params: DocumentAssetParamsSchema.pick({ id: true }),
    query: ListDocumentAssetsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DocumentAssetListResponseSchema,
        },
      },
      description: "Document assets",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: {
      content: {
        "application/json": {
          schema: CandidateVisibilityScanBudgetExceededResponseSchema,
        },
      },
      description: "Candidate visibility scan budget exceeded",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getDocumentAssetRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}",
  request: {
    params: DocumentAssetParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DocumentAssetResponseSchema,
        },
      },
      description: "Document asset",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document asset not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getParseArtifactRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}/parse-artifacts/{version}",
  request: {
    params: ParseArtifactParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ParseArtifactResponseSchema,
        },
      },
      description: "Parse artifact",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Parse artifact not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getDocumentOutlineRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}/outline",
  request: {
    params: DocumentAssetParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DocumentOutlineResponseSchema,
        },
      },
      description: "Document outline",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document outline not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getDocumentMultimodalManifestRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}/multimodal",
  request: {
    params: DocumentAssetParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DocumentMultimodalManifestResponseSchema,
        },
      },
      description: "Document multimodal manifest",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document multimodal manifest not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getDocumentMultimodalAssetRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/documents/{documentId}/multimodal/{itemId}/asset",
  request: {
    params: DocumentMultimodalAssetParamsSchema,
    query: DocumentMultimodalAssetQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/octet-stream": {
          schema: {
            format: "binary",
            type: "string",
          },
        },
      },
      description: "Document multimodal item asset",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document multimodal item asset not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document multimodal item references an external asset",
    },
    413: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Document multimodal item asset exceeds the maximum readable size",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
