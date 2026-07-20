import type { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessPolicyState,
  type KnowledgeSpaceAccessService,
  type KnowledgeSpaceApiAccess,
  type KnowledgeSpaceApiKeySummary,
  type KnowledgeSpaceMember,
} from "./knowledge-space-access-control";
import {
  addKnowledgeSpaceMemberRoute,
  bootstrapKnowledgeSpaceAccessRoute,
  deleteKnowledgeSpaceMemberRoute,
  getKnowledgeSpaceAccessPolicyRoute,
  getKnowledgeSpaceApiAccessRoute,
  issueKnowledgeSpaceApiKeyRoute,
  listKnowledgeSpaceApiKeysRoute,
  listKnowledgeSpaceMembersRoute,
  revokeKnowledgeSpaceApiKeyRoute,
  updateKnowledgeSpaceAccessPolicyRoute,
  updateKnowledgeSpaceApiAccessRoute,
  updateKnowledgeSpaceMemberRoute,
} from "./knowledge-space-access-routes";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";

export interface RegisterKnowledgeSpaceAccessHandlersOptions {
  readonly access: KnowledgeSpaceAccessService;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerKnowledgeSpaceAccessHandlers({
  access,
  app,
  authorization,
  spaces,
}: RegisterKnowledgeSpaceAccessHandlersOptions): void {
  app.openapi(bootstrapKnowledgeSpaceAccessRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const body = context.req.valid("json");
    if (!subject.scopes.includes("knowledge-spaces:admin")) {
      throwHttpError(
        403,
        "space_access_bootstrap_forbidden",
        "Deployment-admin scope is required to bootstrap legacy access state",
      );
    }

    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    if (!space) {
      throwHttpError(404, "space_access_not_found", "Knowledge space not found");
    }

    try {
      await access.initialize({
        knowledgeSpaceId,
        ownerSubjectId: body.ownerSubjectId,
        tenantId: subject.tenantId,
      });
      const state = await access.getAccessPolicy({
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
      if (!state) {
        throw new Error("Knowledge-space access bootstrap did not persist an access policy");
      }
      return context.json(toAccessPolicyResponse(state), 201);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(getKnowledgeSpaceAccessPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      const state = await access.getAccessPolicy({ knowledgeSpaceId, tenantId: subject.tenantId });
      if (!state) {
        throwHttpError(404, "space_access_not_found", "Knowledge space access policy not found");
      }
      return context.json(toAccessPolicyResponse(state), 200);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(updateKnowledgeSpaceAccessPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const body = context.req.valid("json");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      const state = await access.updatePolicy({
        actorSubjectId: subject.subjectId,
        expectedRevision: body.expectedRevision,
        knowledgeSpaceId,
        partialMemberSubjectIds: body.partialMemberSubjectIds,
        tenantId: subject.tenantId,
        visibility: body.visibility,
      });
      return context.json(toAccessPolicyResponse(state), 200);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(listKnowledgeSpaceMembersRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const query = context.req.valid("query");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      const page = await access.listMembers({
        ...(query.cursor ? { cursor: query.cursor } : {}),
        knowledgeSpaceId,
        limit: query.limit,
        tenantId: subject.tenantId,
      });
      return context.json(
        {
          items: page.items.map(toMemberResponse),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        200,
      );
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(addKnowledgeSpaceMemberRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const body = context.req.valid("json");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      const member = await access.setMemberRole({
        actorSubjectId: subject.subjectId,
        expectedRevision: 0,
        knowledgeSpaceId,
        role: body.role,
        subjectId: body.subjectId,
        tenantId: subject.tenantId,
      });
      return context.json(toMemberResponse(member), 201);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(updateKnowledgeSpaceMemberRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId: params.id,
        requiredAccess: "admin",
        subject,
      });
      const member = await access.setMemberRole({
        actorSubjectId: subject.subjectId,
        expectedRevision: body.expectedRevision,
        knowledgeSpaceId: params.id,
        role: body.role,
        subjectId: params.subjectId,
        tenantId: subject.tenantId,
      });
      return context.json(toMemberResponse(member), 200);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(deleteKnowledgeSpaceMemberRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId: params.id,
        requiredAccess: "admin",
        subject,
      });
      const removed = await access.removeMember({
        actorSubjectId: subject.subjectId,
        expectedRevision: query.expectedRevision,
        knowledgeSpaceId: params.id,
        subjectId: params.subjectId,
        tenantId: subject.tenantId,
      });
      if (!removed) {
        return context.json({ error: "Knowledge space member not found" }, 404);
      }
      return context.body(null, 204);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(getKnowledgeSpaceApiAccessRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      const apiAccess = await access.getApiAccess({
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
      if (!apiAccess) {
        throwHttpError(
          404,
          "space_access_not_found",
          "Knowledge space API access policy not found",
        );
      }
      return context.json(toApiAccessResponse(apiAccess), 200);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(updateKnowledgeSpaceApiAccessRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const body = context.req.valid("json");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      const apiAccess = await access.updateApiAccess({
        actorSubjectId: subject.subjectId,
        enabled: body.enabled,
        expectedRevision: body.expectedRevision,
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
      return context.json(toApiAccessResponse(apiAccess), 200);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(listKnowledgeSpaceApiKeysRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const query = context.req.valid("query");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      const page = await access.listApiKeys({
        ...(query.cursor ? { cursor: query.cursor } : {}),
        knowledgeSpaceId,
        limit: query.limit,
        tenantId: subject.tenantId,
      });
      return context.json(
        {
          items: page.items.map(toApiKeyResponse),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        200,
      );
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(issueKnowledgeSpaceApiKeyRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const body = context.req.valid("json");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      const issued = await access.issueApiKey({
        actorSubjectId: subject.subjectId,
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
        knowledgeSpaceId,
        name: body.name,
        principalSubjectId: body.principalSubjectId,
        tenantId: subject.tenantId,
      });
      return context.json({ apiKey: toApiKeyResponse(issued.apiKey), token: issued.token }, 201);
    } catch (error) {
      throwAccessError(error);
    }
  });

  app.openapi(revokeKnowledgeSpaceApiKeyRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    try {
      await authorization.authorize({
        callerKind: "interactive",
        knowledgeSpaceId: params.id,
        requiredAccess: "admin",
        subject,
      });
      const apiKey = await access.revokeApiKey({
        actorSubjectId: subject.subjectId,
        expectedRevision: query.expectedRevision,
        id: params.keyId,
        knowledgeSpaceId: params.id,
        tenantId: subject.tenantId,
      });
      return context.json(toApiKeyResponse(apiKey), 200);
    } catch (error) {
      throwAccessError(error);
    }
  });
}

export function toAccessPolicyResponse(state: KnowledgeSpaceAccessPolicyState) {
  return {
    id: state.policy.id,
    ownerSubjectId: state.policy.ownerSubjectId,
    partialMemberSubjectIds: [...state.partialMemberSubjectIds],
    revision: state.policy.revision,
    visibility: state.policy.visibility,
  };
}

export function toMemberResponse(member: KnowledgeSpaceMember) {
  return {
    id: member.id,
    revision: member.revision,
    role: member.role,
    subjectId: member.subjectId,
  };
}

export function toApiAccessResponse(apiAccess: KnowledgeSpaceApiAccess) {
  return {
    enabled: apiAccess.enabled,
    id: apiAccess.id,
    revision: apiAccess.revision,
  };
}

export function toApiKeyResponse(apiKey: KnowledgeSpaceApiKeySummary) {
  return {
    createdAt: apiKey.createdAt,
    ...(apiKey.expiresAt ? { expiresAt: apiKey.expiresAt } : {}),
    id: apiKey.id,
    ...(apiKey.lastUsedAt ? { lastUsedAt: apiKey.lastUsedAt } : {}),
    name: apiKey.name,
    prefix: apiKey.keyPrefix,
    principalSubjectId: apiKey.principalSubjectId,
    revision: apiKey.revision,
    ...(apiKey.revokedAt ? { revokedAt: apiKey.revokedAt } : {}),
    status: apiKey.status,
    updatedAt: apiKey.updatedAt,
  };
}

function throwAccessError(error: unknown): never {
  if (error instanceof KnowledgeSpaceAuthorizationError) {
    throwHttpError(403, error.code, error.message);
  }
  if (!(error instanceof KnowledgeSpaceAccessError)) {
    throw error;
  }

  switch (error.code) {
    case "space_access_invalid_request":
      return throwHttpError(400, error.code, error.message);
    case "space_access_not_found":
      return throwHttpError(404, error.code, error.message);
    case "space_access_forbidden":
      return throwHttpError(403, error.code, error.message);
    case "space_access_capacity_exceeded":
      return throwHttpError(429, error.code, error.message);
    case "space_access_already_initialized":
    case "space_access_last_owner":
    case "space_access_partial_member_not_found":
    case "space_access_partial_members_required":
    case "space_access_policy_owner":
    case "space_access_revision_conflict":
      return throwHttpError(409, error.code, error.message);
    case "space_access_permission_snapshot_invalid":
      return throwHttpError(403, error.code, error.message);
  }
  throw error;
}

function throwHttpError(status: 400 | 403 | 404 | 409 | 429, code: string, message: string): never {
  throw new HTTPException(status, {
    res: Response.json({ code, error: message }, { status }),
  });
}
