import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { KnowledgeSpaceProfileMigrationConflictError } from "./knowledge-space-profile-migration";
import {
  cancelKnowledgeSpaceProfileMigrationRoute,
  getKnowledgeSpaceProfileMigrationRoute,
  requestKnowledgeSpaceProfileMigrationRoute,
  retryKnowledgeSpaceProfileMigrationRoute,
} from "./knowledge-space-profile-migration-routes";
import type {
  KnowledgeSpaceProfileMigrationParams,
  RequestKnowledgeSpaceProfileMigrationBody,
} from "./knowledge-space-profile-migration-schemas";
import {
  type KnowledgeSpaceProfileMigrationPrincipal,
  type KnowledgeSpaceProfileMigrationService,
  KnowledgeSpaceProfileMigrationServiceError,
  toPublicKnowledgeSpaceProfileMigration,
} from "./knowledge-space-profile-migration-service";
import { type LooseOpenApiContext, openApiHandler } from "./openapi-handler-utils";

export interface RegisterKnowledgeSpaceProfileMigrationHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly service?: KnowledgeSpaceProfileMigrationService | undefined;
}

export function registerKnowledgeSpaceProfileMigrationHandlers({
  app,
  service,
}: RegisterKnowledgeSpaceProfileMigrationHandlersOptions): void {
  app.openapi(
    requestKnowledgeSpaceProfileMigrationRoute,
    openApiHandler(async (context) => {
      if (!service) return unavailable(context);
      const params = context.req.valid("param") as { readonly id: string };
      const body = context.req.valid("json") as RequestKnowledgeSpaceProfileMigrationBody;
      const headers = context.req.valid("header") as { readonly "idempotency-key": string };
      try {
        const run = await service.request({
          ...principal(context),
          candidateRevision: body.candidateRevision,
          changedKind: body.changedKind,
          idempotencyKey: headers["idempotency-key"],
          knowledgeSpaceId: params.id,
        });
        return context.json(toPublicKnowledgeSpaceProfileMigration(run), 202);
      } catch (error) {
        return migrationError(context, error);
      }
    }),
  );

  app.openapi(
    getKnowledgeSpaceProfileMigrationRoute,
    openApiHandler(async (context) => {
      if (!service) return unavailable(context);
      const params = context.req.valid("param") as KnowledgeSpaceProfileMigrationParams;
      try {
        const run = await service.get({
          ...principal(context),
          knowledgeSpaceId: params.id,
          runId: params.migrationId,
        });
        return run
          ? context.json(toPublicKnowledgeSpaceProfileMigration(run), 200)
          : context.json({ error: "Profile migration not found" }, 404);
      } catch (error) {
        return migrationError(context, error);
      }
    }),
  );

  app.openapi(
    cancelKnowledgeSpaceProfileMigrationRoute,
    openApiHandler(async (context) => {
      if (!service) return unavailable(context);
      const params = context.req.valid("param") as KnowledgeSpaceProfileMigrationParams;
      const body = context.req.valid("json") as { readonly reason?: string } | undefined;
      try {
        const run = await service.cancel({
          ...principal(context),
          knowledgeSpaceId: params.id,
          ...(body?.reason ? { reason: body.reason } : {}),
          runId: params.migrationId,
        });
        return run
          ? context.json(toPublicKnowledgeSpaceProfileMigration(run), 200)
          : context.json({ error: "Profile migration not found" }, 404);
      } catch (error) {
        return migrationError(context, error);
      }
    }),
  );

  app.openapi(
    retryKnowledgeSpaceProfileMigrationRoute,
    openApiHandler(async (context) => {
      if (!service) return unavailable(context);
      const params = context.req.valid("param") as KnowledgeSpaceProfileMigrationParams;
      try {
        const run = await service.retry({
          ...principal(context),
          knowledgeSpaceId: params.id,
          runId: params.migrationId,
        });
        return run
          ? context.json(toPublicKnowledgeSpaceProfileMigration(run), 202)
          : context.json({ error: "Profile migration not found" }, 404);
      } catch (error) {
        return migrationError(context, error);
      }
    }),
  );
}

function principal(context: LooseOpenApiContext): KnowledgeSpaceProfileMigrationPrincipal {
  const apiKey = context.get("authenticatedApiKey");
  return {
    ...(apiKey ? { apiKey } : {}),
    callerKind: context.get("callerKind") ?? "interactive",
    subject: context.get("subject"),
  };
}

function migrationError(context: LooseOpenApiContext, error: unknown) {
  if (error instanceof KnowledgeSpaceProfileMigrationServiceError) {
    if (error.code === "PROFILE_MIGRATION_FORBIDDEN") {
      return context.json({ code: error.code, error: error.message }, 403);
    }
    if (error.code.endsWith("NOT_FOUND") || error.code.endsWith("MISSING")) {
      return context.json({ code: error.code, error: error.message }, 404);
    }
    return context.json({ code: error.code, error: error.message }, 409);
  }
  if (error instanceof KnowledgeSpaceProfileMigrationConflictError) {
    return context.json({ code: error.code, error: error.message }, 409);
  }
  return context.json({ error: "Profile migration service unavailable" }, 503);
}

function unavailable(context: LooseOpenApiContext) {
  return context.json({ error: "Profile migration service unavailable" }, 503);
}
