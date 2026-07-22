import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  type ModelCapabilityCatalog,
  type ModelCapabilityPreflight,
  ModelCapabilityPreflightError,
  ModelCatalogEntrySchema,
} from "./model-capability-preflight";
import {
  listKnowledgeSpaceModelCatalogRoute,
  preflightKnowledgeSpaceModelRoute,
} from "./model-capability-routes";

export interface RegisterModelCapabilityHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly catalog?: ModelCapabilityCatalog | undefined;
  readonly preflight?: ModelCapabilityPreflight | undefined;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerModelCapabilityHandlers({
  app,
  catalog,
  preflight,
  spaces,
}: RegisterModelCapabilityHandlersOptions): void {
  app.openapi(listKnowledgeSpaceModelCatalogRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    if (!catalog) {
      return context.json(
        {
          code: "MODEL_CATALOG_UNAVAILABLE",
          error: "Model capability catalog is unavailable",
          retryable: true,
        },
        503,
      );
    }
    const query = context.req.valid("query");
    try {
      const result = await catalog.list({
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        limit: query.limit,
        tenantId: subject.tenantId,
      });
      if (result.items.length > query.limit) {
        throw new Error("Model catalog returned more entries than requested");
      }
      const items = result.items.map((item) => ModelCatalogEntrySchema.parse(item));
      if (query.kind && items.some((item) => !item.kinds.includes(query.kind as never))) {
        throw new Error("Model catalog returned an entry outside the requested capability");
      }
      if (result.nextCursor && result.nextCursor.length > 1024) {
        throw new Error("Model catalog returned an invalid cursor");
      }
      return context.json(
        {
          items,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
        200,
      );
    } catch {
      return context.json(
        {
          code: "MODEL_CATALOG_UNAVAILABLE",
          error: "Model capability catalog is unavailable",
          retryable: true,
        },
        503,
      );
    }
  });

  app.openapi(preflightKnowledgeSpaceModelRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    if (!preflight) {
      return context.json(
        {
          code: "MODEL_PREFLIGHT_UNAVAILABLE",
          error: "Model capability preflight is unavailable",
          retryable: true,
        },
        503,
      );
    }
    const body = context.req.valid("json");
    try {
      const snapshot = await preflight.verify({
        kind: body.kind,
        selection: body.selection,
        tenantId: subject.tenantId,
      });
      return context.json(snapshot, 200);
    } catch (error) {
      if (error instanceof ModelCapabilityPreflightError) {
        return context.json(
          { code: error.code, error: error.message, retryable: error.retryable },
          error.retryable ? 503 : 422,
        );
      }
      return context.json(
        {
          code: "MODEL_PREFLIGHT_FAILED",
          error: "The selected model failed its capability preflight",
          retryable: true,
        },
        503,
      );
    }
  });
}
