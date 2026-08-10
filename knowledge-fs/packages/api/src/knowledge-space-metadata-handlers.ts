import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceAuthorizationGuard } from "./knowledge-space-authorization";
import {
  KnowledgeSpaceMetadataConflictError,
  type KnowledgeSpaceMetadataField,
  KnowledgeSpaceMetadataNotFoundError,
  type KnowledgeSpaceMetadataRepository,
  KnowledgeSpaceMetadataValidationError,
} from "./knowledge-space-metadata-repository";
import {
  createKnowledgeSpaceMetadataFieldRoute,
  deleteKnowledgeSpaceMetadataFieldRoute,
  listKnowledgeSpaceMetadataFieldsRoute,
  updateKnowledgeSpaceMetadataFieldRoute,
} from "./knowledge-space-metadata-routes";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";

export interface RegisterKnowledgeSpaceMetadataHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly metadataFields?: KnowledgeSpaceMetadataRepository | undefined;
  readonly now?: (() => string) | undefined;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerKnowledgeSpaceMetadataHandlers({
  app,
  authorization,
  metadataFields,
  now = () => new Date().toISOString(),
  spaces,
}: RegisterKnowledgeSpaceMetadataHandlersOptions): void {
  const register = app.openapi.bind(app) as (
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI route adapter
    route: any,
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
    handler: (context: any) => unknown,
  ) => void;

  register(listKnowledgeSpaceMetadataFieldsRoute, async (context) => {
    if (!metadataFields) return context.json({ error: "Metadata fields unavailable" }, 503);
    const params = context.req.valid("param");
    if (!(await authorize(context, spaces, authorization, params.id, "read"))) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    try {
      const query = context.req.valid("query");
      const result = await metadataFields.list({
        ...(query.cursor ? { cursor: decodeCursor(query.cursor) } : {}),
        knowledgeSpaceId: params.id,
        limit: query.limit,
        tenantId: context.get("subject").tenantId,
      });
      return context.json(
        {
          items: result.items.map(toPublicField),
          ...(result.nextCursor ? { nextCursor: encodeCursor(result.nextCursor) } : {}),
        },
        200,
      );
    } catch (error) {
      return metadataError(context, error);
    }
  });

  register(createKnowledgeSpaceMetadataFieldRoute, async (context) => {
    if (!metadataFields) return context.json({ error: "Metadata fields unavailable" }, 503);
    const params = context.req.valid("param");
    if (!(await authorize(context, spaces, authorization, params.id, "write"))) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    try {
      const body = context.req.valid("json");
      const field = await metadataFields.create({
        knowledgeSpaceId: params.id,
        name: body.name,
        now: now(),
        subjectId: context.get("subject").subjectId,
        tenantId: context.get("subject").tenantId,
        type: body.type,
      });
      return context.json(toPublicField(field), 201);
    } catch (error) {
      return metadataError(context, error);
    }
  });

  register(updateKnowledgeSpaceMetadataFieldRoute, async (context) => {
    if (!metadataFields) return context.json({ error: "Metadata fields unavailable" }, 503);
    const params = context.req.valid("param");
    if (!(await authorize(context, spaces, authorization, params.id, "write"))) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    try {
      const body = context.req.valid("json");
      const field = await metadataFields.updateName({
        expectedRowVersion: body.expectedRowVersion,
        fieldId: params.fieldId,
        knowledgeSpaceId: params.id,
        name: body.name,
        now: now(),
        subjectId: context.get("subject").subjectId,
        tenantId: context.get("subject").tenantId,
      });
      return context.json(toPublicField(field), 200);
    } catch (error) {
      return metadataError(context, error);
    }
  });

  register(deleteKnowledgeSpaceMetadataFieldRoute, async (context) => {
    if (!metadataFields) return context.json({ error: "Metadata fields unavailable" }, 503);
    const params = context.req.valid("param");
    if (!(await authorize(context, spaces, authorization, params.id, "write"))) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    try {
      await metadataFields.delete({
        expectedRowVersion: context.req.valid("query").expectedRowVersion,
        fieldId: params.fieldId,
        knowledgeSpaceId: params.id,
        now: now(),
        tenantId: context.get("subject").tenantId,
      });
      return context.json({ deleted: true as const }, 200);
    } catch (error) {
      return metadataError(context, error);
    }
  });
}

function toPublicField(field: KnowledgeSpaceMetadataField) {
  return {
    count: field.count,
    createdAt: field.createdAt,
    id: field.id,
    name: field.name,
    rowVersion: field.rowVersion,
    type: field.type,
    updatedAt: field.updatedAt,
  };
}

function encodeCursor(cursor: { readonly id: string; readonly name: string }): string {
  return `${encodeURIComponent(cursor.name)}|${encodeURIComponent(cursor.id)}`;
}

function decodeCursor(cursor: string): { readonly id: string; readonly name: string } {
  const [name, id, ...rest] = cursor.split("|");
  if (!name || !id || rest.length > 0) {
    throw new KnowledgeSpaceMetadataValidationError("Metadata field cursor is invalid");
  }
  try {
    return { id: decodeURIComponent(id), name: decodeURIComponent(name) };
  } catch {
    throw new KnowledgeSpaceMetadataValidationError("Metadata field cursor is invalid");
  }
}

async function authorize(
  // biome-ignore lint/suspicious/noExplicitAny: bounded Hono context adapter
  context: any,
  spaces: KnowledgeSpaceRepository,
  authorization: KnowledgeSpaceAuthorizationGuard,
  knowledgeSpaceId: string,
  requiredAccess: "read" | "write",
): Promise<boolean> {
  const subject = context.get("subject");
  if (!(await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId }))) return false;
  const capabilityGrant = context.get("capabilityV2Grant");
  const capabilitySpaceId =
    capabilityGrant?.resource.type === "knowledge_space"
      ? capabilityGrant.resource.id
      : capabilityGrant?.resource.parent_id;
  if (
    capabilityGrant?.namespaceId === subject.tenantId &&
    capabilityGrant.subject === subject.subjectId &&
    capabilitySpaceId === knowledgeSpaceId
  ) {
    return true;
  }
  try {
    const decision = await authorization.authorize({
      callerKind: context.get("callerKind") ?? "interactive",
      knowledgeSpaceId,
      requiredAccess,
      subject,
    });
    context.set("authorizationDecision", decision);
    return true;
  } catch {
    return false;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: bounded Hono response adapter
function metadataError(context: any, error: unknown) {
  if (error instanceof KnowledgeSpaceMetadataValidationError) {
    return context.json({ error: error.message }, 400);
  }
  if (error instanceof KnowledgeSpaceMetadataNotFoundError) {
    return context.json({ error: error.message }, 404);
  }
  if (error instanceof KnowledgeSpaceMetadataConflictError) {
    return context.json({ error: error.message }, 409);
  }
  throw error;
}
