import { createRoute } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import {
  CancelKnowledgeSpaceProfileMigrationBodySchema,
  KnowledgeSpaceProfileMigrationIdempotencyHeadersSchema,
  KnowledgeSpaceProfileMigrationParamsSchema,
  KnowledgeSpaceProfileMigrationResponseSchema,
  KnowledgeSpaceProfileMigrationSpaceParamsSchema,
  RequestKnowledgeSpaceProfileMigrationBodySchema,
} from "./knowledge-space-profile-migration-schemas";

const migrationResponse = {
  content: { "application/json": { schema: KnowledgeSpaceProfileMigrationResponseSchema } },
  description: "Durable profile migration",
} as const;
const notFound = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Profile migration not found",
} as const;
const conflict = {
  content: { "application/json": { schema: ErrorResponseSchema } },
  description: "Profile migration state, idempotency, or active-run conflict",
} as const;

export const requestKnowledgeSpaceProfileMigrationRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/profile-migrations",
  request: {
    body: {
      content: { "application/json": { schema: RequestKnowledgeSpaceProfileMigrationBodySchema } },
      required: true,
    },
    headers: KnowledgeSpaceProfileMigrationIdempotencyHeadersSchema,
    params: KnowledgeSpaceProfileMigrationSpaceParamsSchema,
  },
  responses: {
    202: migrationResponse,
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid profile migration request",
    },
    404: notFound,
    409: conflict,
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Profile migration service unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getKnowledgeSpaceProfileMigrationRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/profile-migrations/{migrationId}",
  request: { params: KnowledgeSpaceProfileMigrationParamsSchema },
  responses: {
    200: migrationResponse,
    404: notFound,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const cancelKnowledgeSpaceProfileMigrationRoute = createRoute({
  method: "delete",
  path: "/knowledge-spaces/{id}/profile-migrations/{migrationId}",
  request: {
    body: {
      content: { "application/json": { schema: CancelKnowledgeSpaceProfileMigrationBodySchema } },
      required: false,
    },
    params: KnowledgeSpaceProfileMigrationParamsSchema,
  },
  responses: {
    200: migrationResponse,
    404: notFound,
    409: conflict,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const retryKnowledgeSpaceProfileMigrationRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/profile-migrations/{migrationId}/retry",
  request: {
    headers: KnowledgeSpaceProfileMigrationIdempotencyHeadersSchema,
    params: KnowledgeSpaceProfileMigrationParamsSchema,
  },
  responses: {
    202: migrationResponse,
    404: notFound,
    409: conflict,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
