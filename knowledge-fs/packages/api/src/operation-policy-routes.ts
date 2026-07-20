import { createRoute } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  BulkOperationParamsSchema,
  ErrorResponseSchema,
  RetentionPolicyPatchSchema,
} from "./gateway-route-schemas";
import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";
import {
  BulkOperationProgressResponseSchema,
  RetentionPolicyResponseSchema,
} from "./operation-policy-response-schemas";

export const getBulkOperationRoute = createRoute({
  method: "get",
  path: "/bulk-jobs/{id}",
  request: {
    params: BulkOperationParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: BulkOperationProgressResponseSchema,
        },
      },
      description: "Bulk operation progress",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Bulk operation not found",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Bulk progress dependencies unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getTenantRetentionPolicyRoute = createRoute({
  method: "get",
  path: "/retention-policy",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: RetentionPolicyResponseSchema,
        },
      },
      description: "Tenant retention policy",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const updateTenantRetentionPolicyRoute = createRoute({
  method: "patch",
  path: "/retention-policy",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RetentionPolicyPatchSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: RetentionPolicyResponseSchema,
        },
      },
      description: "Updated tenant retention policy",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid retention policy",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceRetentionPolicyRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/retention-policy",
  request: {
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: RetentionPolicyResponseSchema,
        },
      },
      description: "Knowledge-space retention policy",
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

export const updateKnowledgeSpaceRetentionPolicyRoute = createRoute({
  method: "patch",
  path: "/knowledge-spaces/{id}/retention-policy",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RetentionPolicyPatchSchema,
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
          schema: RetentionPolicyResponseSchema,
        },
      },
      description: "Updated knowledge-space retention policy",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid retention policy",
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
