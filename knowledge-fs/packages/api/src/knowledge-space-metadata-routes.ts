import { createRoute } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import {
  CreateKnowledgeSpaceMetadataFieldSchema,
  DeleteKnowledgeSpaceMetadataFieldQuerySchema,
  DeleteKnowledgeSpaceMetadataFieldResponseSchema,
  KnowledgeSpaceMetadataFieldListSchema,
  KnowledgeSpaceMetadataFieldParamsSchema,
  KnowledgeSpaceMetadataFieldSchema,
  KnowledgeSpaceMetadataParamsSchema,
  ListKnowledgeSpaceMetadataFieldsQuerySchema,
  UpdateKnowledgeSpaceMetadataFieldSchema,
} from "./knowledge-space-metadata-schemas";

const commonErrors = {
  400: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Invalid metadata field",
  },
  401: UnauthorizedResponse,
  403: ForbiddenResponse,
  404: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Metadata field or knowledge space not found",
  },
  409: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Metadata field name or row-version conflict",
  },
  503: {
    content: { "application/json": { schema: ErrorResponseSchema } },
    description: "Metadata field repository unavailable",
  },
} as const;

export const listKnowledgeSpaceMetadataFieldsRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaceMetadataFields",
  path: "/knowledge-spaces/{id}/metadata-fields",
  request: {
    params: KnowledgeSpaceMetadataParamsSchema,
    query: ListKnowledgeSpaceMetadataFieldsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceMetadataFieldListSchema } },
      description: "Knowledge-space custom metadata field catalog",
    },
    ...commonErrors,
  },
});

export const createKnowledgeSpaceMetadataFieldRoute = createRoute({
  method: "post",
  operationId: "createKnowledgeSpaceMetadataField",
  path: "/knowledge-spaces/{id}/metadata-fields",
  request: {
    body: {
      content: { "application/json": { schema: CreateKnowledgeSpaceMetadataFieldSchema } },
      required: true,
    },
    params: KnowledgeSpaceMetadataParamsSchema,
  },
  responses: {
    201: {
      content: { "application/json": { schema: KnowledgeSpaceMetadataFieldSchema } },
      description: "Created metadata field",
    },
    ...commonErrors,
  },
});

export const updateKnowledgeSpaceMetadataFieldRoute = createRoute({
  method: "patch",
  operationId: "updateKnowledgeSpaceMetadataField",
  path: "/knowledge-spaces/{id}/metadata-fields/{fieldId}",
  request: {
    body: {
      content: { "application/json": { schema: UpdateKnowledgeSpaceMetadataFieldSchema } },
      required: true,
    },
    params: KnowledgeSpaceMetadataFieldParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceMetadataFieldSchema } },
      description: "Renamed metadata field and all bound document values",
    },
    ...commonErrors,
  },
});

export const deleteKnowledgeSpaceMetadataFieldRoute = createRoute({
  method: "delete",
  operationId: "deleteKnowledgeSpaceMetadataField",
  path: "/knowledge-spaces/{id}/metadata-fields/{fieldId}",
  request: {
    params: KnowledgeSpaceMetadataFieldParamsSchema,
    query: DeleteKnowledgeSpaceMetadataFieldQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: DeleteKnowledgeSpaceMetadataFieldResponseSchema },
      },
      description: "Deleted metadata field and all bound document values",
    },
    ...commonErrors,
  },
});
