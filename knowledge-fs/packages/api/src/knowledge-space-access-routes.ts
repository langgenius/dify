import { createRoute, z } from "@hono/zod-openapi";

import { UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";

const RevisionSchema = z.number().int().positive();
const SubjectIdSchema = z.string().trim().min(1).max(255);
const RoleSchema = z.enum(["owner", "editor", "viewer"]);
const VisibilitySchema = z.enum(["only_me", "all_members", "partial_members"]);
const DateTimeSchema = z.string().datetime();
const FutureDateTimeSchema = DateTimeSchema.refine(
  (value) => Date.parse(value) > Date.now(),
  "API key expiry must be in the future",
);

const AccessErrorResponseSchema = ErrorResponseSchema.extend({
  code: z.string().optional(),
});

export const KnowledgeSpaceAccessPolicyResponseSchema = z.object({
  id: z.string().min(1),
  ownerSubjectId: SubjectIdSchema,
  partialMemberSubjectIds: z.array(SubjectIdSchema),
  revision: RevisionSchema,
  visibility: VisibilitySchema,
});

export const KnowledgeSpaceMemberResponseSchema = z.object({
  id: z.string().min(1),
  revision: RevisionSchema,
  role: RoleSchema,
  subjectId: SubjectIdSchema,
});

export const KnowledgeSpaceApiAccessResponseSchema = z.object({
  enabled: z.boolean(),
  id: z.string().min(1),
  revision: RevisionSchema,
});

/** The public shape intentionally has no keyHash or plaintext token. */
export const KnowledgeSpaceApiKeyResponseSchema = z.object({
  createdAt: DateTimeSchema,
  expiresAt: DateTimeSchema.optional(),
  id: z.string().min(1),
  lastUsedAt: DateTimeSchema.optional(),
  name: z.string().min(1).max(160),
  prefix: z.string().min(1).max(64),
  principalSubjectId: SubjectIdSchema,
  revision: RevisionSchema,
  revokedAt: DateTimeSchema.optional(),
  status: z.enum(["active", "revoked"]),
  updatedAt: DateTimeSchema,
});

export const KnowledgeSpaceApiKeyIssuedResponseSchema = z.object({
  apiKey: KnowledgeSpaceApiKeyResponseSchema,
  /** Returned exactly once by the create endpoint and never persisted as plaintext. */
  token: z.string().regex(/^kfs_[0-9a-f-]{36}_[A-Za-z0-9_-]{32,256}$/i),
});

export const KnowledgeSpaceAccessBootstrapRequestSchema = z
  .object({ ownerSubjectId: SubjectIdSchema })
  .strict();

const CursorQuerySchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const SubjectParamsSchema = KnowledgeSpaceParamsSchema.extend({
  subjectId: SubjectIdSchema,
});

const ApiKeyParamsSchema = KnowledgeSpaceParamsSchema.extend({
  keyId: z.string().min(1),
});

const ExpectedRevisionQuerySchema = z.object({
  expectedRevision: z.coerce.number().int().positive(),
});

const standardAccessResponses = {
  400: {
    content: { "application/json": { schema: AccessErrorResponseSchema } },
    description: "Invalid access-control request",
  },
  401: UnauthorizedResponse,
  403: {
    content: { "application/json": { schema: AccessErrorResponseSchema } },
    description: "Knowledge-space access denied",
  },
  404: {
    content: { "application/json": { schema: AccessErrorResponseSchema } },
    description: "Knowledge space or access-control resource not found",
  },
  409: {
    content: { "application/json": { schema: AccessErrorResponseSchema } },
    description: "Access-control revision conflict or invariant violation",
  },
  429: {
    content: { "application/json": { schema: AccessErrorResponseSchema } },
    description: "Knowledge-space access-control capacity exceeded",
  },
} as const;

export const getKnowledgeSpaceAccessPolicyRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/access-policy",
  request: { params: KnowledgeSpaceParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceAccessPolicyResponseSchema } },
      description: "Knowledge space visibility policy",
    },
    ...standardAccessResponses,
  },
});

export const bootstrapKnowledgeSpaceAccessRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/access-bootstrap",
  request: {
    body: {
      content: {
        "application/json": { schema: KnowledgeSpaceAccessBootstrapRequestSchema },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    201: {
      content: { "application/json": { schema: KnowledgeSpaceAccessPolicyResponseSchema } },
      description: "Initialized access state for a legacy knowledge space",
    },
    ...standardAccessResponses,
  },
});

export const updateKnowledgeSpaceAccessPolicyRoute = createRoute({
  method: "patch",
  path: "/knowledge-spaces/{id}/access-policy",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            expectedRevision: RevisionSchema,
            partialMemberSubjectIds: z.array(SubjectIdSchema).max(500).default([]),
            visibility: VisibilitySchema,
          }),
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceAccessPolicyResponseSchema } },
      description: "Updated knowledge space visibility policy",
    },
    ...standardAccessResponses,
  },
});

export const listKnowledgeSpaceMembersRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/members",
  request: { params: KnowledgeSpaceParamsSchema, query: CursorQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(KnowledgeSpaceMemberResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Knowledge space members",
    },
    ...standardAccessResponses,
  },
});

export const addKnowledgeSpaceMemberRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/members",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ role: RoleSchema, subjectId: SubjectIdSchema }),
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    201: {
      content: { "application/json": { schema: KnowledgeSpaceMemberResponseSchema } },
      description: "Added knowledge space member",
    },
    ...standardAccessResponses,
  },
});

export const updateKnowledgeSpaceMemberRoute = createRoute({
  method: "patch",
  path: "/knowledge-spaces/{id}/members/{subjectId}",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ expectedRevision: RevisionSchema, role: RoleSchema }),
        },
      },
      required: true,
    },
    params: SubjectParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceMemberResponseSchema } },
      description: "Updated knowledge space member",
    },
    ...standardAccessResponses,
  },
});

export const deleteKnowledgeSpaceMemberRoute = createRoute({
  method: "delete",
  path: "/knowledge-spaces/{id}/members/{subjectId}",
  request: { params: SubjectParamsSchema, query: ExpectedRevisionQuerySchema },
  responses: {
    204: { description: "Removed knowledge space member" },
    ...standardAccessResponses,
  },
});

export const getKnowledgeSpaceApiAccessRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/api-access",
  request: { params: KnowledgeSpaceParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceApiAccessResponseSchema } },
      description: "Knowledge space API access policy",
    },
    ...standardAccessResponses,
  },
});

export const updateKnowledgeSpaceApiAccessRoute = createRoute({
  method: "patch",
  path: "/knowledge-spaces/{id}/api-access",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ enabled: z.boolean(), expectedRevision: RevisionSchema }),
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceApiAccessResponseSchema } },
      description: "Updated knowledge space API access policy",
    },
    ...standardAccessResponses,
  },
});

export const listKnowledgeSpaceApiKeysRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/api-keys",
  request: { params: KnowledgeSpaceParamsSchema, query: CursorQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(KnowledgeSpaceApiKeyResponseSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Knowledge space API keys without secret hashes",
    },
    ...standardAccessResponses,
  },
});

export const issueKnowledgeSpaceApiKeyRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/api-keys",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            expiresAt: FutureDateTimeSchema.optional(),
            name: z.string().trim().min(1).max(160),
            principalSubjectId: SubjectIdSchema,
          }),
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    201: {
      content: { "application/json": { schema: KnowledgeSpaceApiKeyIssuedResponseSchema } },
      description: "Issued API key; plaintext token is returned once",
    },
    ...standardAccessResponses,
  },
});

export const revokeKnowledgeSpaceApiKeyRoute = createRoute({
  method: "delete",
  path: "/knowledge-spaces/{id}/api-keys/{keyId}",
  request: { params: ApiKeyParamsSchema, query: ExpectedRevisionQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: KnowledgeSpaceApiKeyResponseSchema } },
      description: "Revoked knowledge space API key",
    },
    ...standardAccessResponses,
  },
});
