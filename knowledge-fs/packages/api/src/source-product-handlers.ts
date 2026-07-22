import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";
import type { LooseOpenApiContext } from "./openapi-handler-utils";
import { SourceConnectionError, type SourceConnectionService } from "./source-connection";
import type { PublicSourceConnection } from "./source-connection";
import {
  cancelSourceWorkflowRoute,
  completeSourceOAuthRoute,
  createSourceBulkWorkflowRoute,
  createSourceConnectionRoute,
  createSourceCrawlPreviewWorkflowRoute,
  createSourceImportWorkflowRoute,
  createSourceSyncWorkflowRoute,
  getSourceConnectionRoute,
  getSourceSyncPolicyRoute,
  getSourceWorkflowRoute,
  listCrawlPreviewPagesRoute,
  listSourceBulkWorkflowItemsRoute,
  listSourceConnectionsRoute,
  listSourceProvidersRoute,
  listSourceWorkflowsRoute,
  putSourceSyncPolicyRoute,
  refreshSourceConnectionRoute,
  retrySourceWorkflowRoute,
  revokeSourceConnectionRoute,
  selectCrawlPreviewPagesRoute,
  startSourceOAuthRoute,
} from "./source-product-routes";
import {
  type SourceProductWorkflowRepository,
  type SourceProductWorkflowService,
  SourceWorkflowError,
  toPublicSourceWorkflowRun,
} from "./source-product-workflow";
import type { SourceProviderCatalog } from "./source-provider-catalog";
import { SourceProviderUnavailableError } from "./source-provider-catalog";

export function registerSourceProductHandlers(input: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly connections: SourceConnectionService;
  readonly providers: SourceProviderCatalog;
  readonly repository: SourceProductWorkflowRepository;
  readonly workflows: SourceProductWorkflowService;
}): void {
  // Hono's route-union inference becomes impractically deep on this composed surface. The
  // route schemas still perform the same runtime validation; this adapter only bounds the
  // registration type, matching the rest of the gateway's large OpenAPI surfaces.
  const register = input.app.openapi.bind(input.app) as (
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI registration adapter
    route: any,
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI registration adapter
    handler: (context: any) => unknown,
  ) => void;

  register(listSourceProvidersRoute, async (context) =>
    context.json(
      {
        items: (await input.providers.list()).map((provider) => ({
          ...provider,
          authKinds: [...provider.authKinds],
          capabilities: [...provider.capabilities],
          configuration: provider.configuration.map((field) => ({ ...field })),
        })),
      },
      200,
    ),
  );

  register(createSourceConnectionRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const denied = await authorize(input.authorization, context, params.id, "write");
    if (denied) return context.json(denied, 403);
    try {
      return context.json(
        publicConnection(
          await input.connections.create({
            ...principal(context),
            authKind: body.authKind,
            ...(body.configuration ? { configuration: body.configuration } : {}),
            credentials: body.credentials,
            knowledgeSpaceId: params.id,
            name: body.name,
            providerId: body.providerId,
            tenantId: context.get("subject").tenantId,
          }),
        ),
        201,
      );
    } catch (error) {
      return connectionFailure(context, error);
    }
  });

  register(startSourceOAuthRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const denied = await authorize(input.authorization, context, params.id, "write");
    if (denied) return context.json(denied, 403);
    try {
      const result = await input.connections.startOAuth({
        ...principal(context),
        ...(body.configuration ? { configuration: body.configuration } : {}),
        knowledgeSpaceId: params.id,
        name: body.name,
        providerId: body.providerId,
        redirectUri: body.redirectUri,
        scopes: body.scopes,
        tenantId: context.get("subject").tenantId,
      });
      return context.json({ ...result, connection: publicConnection(result.connection) }, 201);
    } catch (error) {
      return connectionFailure(context, error);
    }
  });

  register(completeSourceOAuthRoute, async (context) => {
    const body = context.req.valid("json");
    try {
      return context.json(
        publicConnection(await input.connections.callback({ ...body, ...principal(context) })),
        200,
      );
    } catch (error) {
      return connectionFailure(context, error);
    }
  });

  register(listSourceConnectionsRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const denied = await authorize(input.authorization, context, params.id, "read");
    if (denied) return context.json(denied, 403);
    try {
      const page = await input.connections.list({
        ...(query.cursor ? { cursor: query.cursor } : {}),
        knowledgeSpaceId: params.id,
        limit: query.limit,
        tenantId: context.get("subject").tenantId,
      });
      return context.json(
        {
          items: page.items.map(publicConnection),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        200,
      );
    } catch (error) {
      return connectionFailure(context, error);
    }
  });

  register(getSourceConnectionRoute, async (context) => {
    const params = context.req.valid("param");
    const denied = await authorize(input.authorization, context, params.id, "read");
    if (denied) return context.json(denied, 403);
    const connection = await input.connections.get({
      connectionId: params.connectionId,
      knowledgeSpaceId: params.id,
      tenantId: context.get("subject").tenantId,
    });
    return connection
      ? context.json(publicConnection(connection), 200)
      : context.json({ error: "Source connection not found" }, 404);
  });

  register(refreshSourceConnectionRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const denied = await authorize(input.authorization, context, params.id, "write");
    if (denied) return context.json(denied, 403);
    try {
      return context.json(
        publicConnection(
          await input.connections.refresh({
            ...principal(context),
            connectionId: params.connectionId,
            expectedVersion: body.expectedVersion,
            knowledgeSpaceId: params.id,
            tenantId: context.get("subject").tenantId,
          }),
        ),
        200,
      );
    } catch (error) {
      return connectionFailure(context, error);
    }
  });

  register(revokeSourceConnectionRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const denied = await authorize(input.authorization, context, params.id, "write");
    if (denied) return context.json(denied, 403);
    try {
      return context.json(
        publicConnection(
          await input.connections.revoke({
            ...principal(context),
            connectionId: params.connectionId,
            expectedVersion: query.expectedVersion,
            knowledgeSpaceId: params.id,
            tenantId: context.get("subject").tenantId,
          }),
        ),
        200,
      );
    } catch (error) {
      return connectionFailure(context, error);
    }
  });

  register(createSourceSyncWorkflowRoute, async (context) => {
    const params = context.req.valid("param");
    const headers = context.req.valid("header");
    try {
      return context.json(
        toPublicSourceWorkflowRun(
          await input.workflows.createSync({
            ...principal(context),
            idempotencyKey: headers["Idempotency-Key"],
            knowledgeSpaceId: params.id,
            sourceId: params.sourceId,
          }),
        ),
        202,
      );
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(createSourceCrawlPreviewWorkflowRoute, async (context) => {
    const params = context.req.valid("param");
    const headers = context.req.valid("header");
    try {
      return context.json(
        toPublicSourceWorkflowRun(
          await input.workflows.createPreview({
            ...principal(context),
            idempotencyKey: headers["Idempotency-Key"],
            knowledgeSpaceId: params.id,
            sourceId: params.sourceId,
          }),
        ),
        202,
      );
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(createSourceImportWorkflowRoute, async (context) => {
    const params = context.req.valid("param");
    const headers = context.req.valid("header");
    const body = context.req.valid("json");
    try {
      return context.json(
        toPublicSourceWorkflowRun(
          await input.workflows.createImport({
            ...principal(context),
            idempotencyKey: headers["Idempotency-Key"],
            items: body.items,
            kind: body.kind,
            knowledgeSpaceId: params.id,
            sourceId: params.sourceId,
          }),
        ),
        202,
      );
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(getSourceSyncPolicyRoute, async (context) => {
    const params = context.req.valid("param");
    try {
      const policy = await input.workflows.getSyncPolicy({
        ...principal(context),
        knowledgeSpaceId: params.id,
        sourceId: params.sourceId,
      });
      return policy
        ? context.json(publicSyncPolicy(policy), 200)
        : context.json({ error: "Source sync policy not found" }, 404);
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(putSourceSyncPolicyRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    try {
      return context.json(
        publicSyncPolicy(
          await input.workflows.putSyncPolicy({
            ...principal(context),
            ...(body.customIntervalSeconds === undefined
              ? {}
              : { customIntervalSeconds: body.customIntervalSeconds }),
            enabled: body.enabled,
            expectedRevision: body.expectedRevision,
            expectedSourceVersion: body.expectedSourceVersion,
            knowledgeSpaceId: params.id,
            mode: body.mode,
            sourceId: params.sourceId,
          }),
        ),
        200,
      );
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(createSourceBulkWorkflowRoute, async (context) => {
    const params = context.req.valid("param");
    const headers = context.req.valid("header");
    const body = context.req.valid("json");
    try {
      return context.json(
        toPublicSourceWorkflowRun(
          await input.workflows.createBulk({
            ...principal(context),
            action: body.action,
            idempotencyKey: headers["Idempotency-Key"],
            knowledgeSpaceId: params.id,
            sourceIds: body.sourceIds,
          }),
        ),
        202,
      );
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(listSourceWorkflowsRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    try {
      const page = await input.workflows.list({
        ...principal(context),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        knowledgeSpaceId: params.id,
        limit: query.limit,
        ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      });
      return context.json(
        {
          items: page.items.map(toPublicSourceWorkflowRun),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        200,
      );
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(getSourceWorkflowRoute, async (context) => {
    const params = context.req.valid("param");
    try {
      const run = await input.workflows.get({
        ...principal(context),
        knowledgeSpaceId: params.id,
        runId: params.runId,
      });
      return run
        ? context.json(toPublicSourceWorkflowRun(run), 200)
        : context.json({ error: "Source workflow not found" }, 404);
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(listSourceBulkWorkflowItemsRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    try {
      const page = await input.workflows.listBulkItems({
        ...principal(context),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        knowledgeSpaceId: params.id,
        limit: query.limit,
        runId: params.runId,
      });
      if (!page) return context.json({ error: "Source workflow not found" }, 404);
      return context.json(
        {
          items: page.items.map((item) => ({
            action: item.action,
            ...(item.errorCode ? { errorCode: item.errorCode } : {}),
            id: item.id,
            ...(item.reason ? { reason: item.reason } : {}),
            sourceId: item.sourceId,
            status: item.status,
            updatedAt: item.updatedAt,
          })),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        200,
      );
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(cancelSourceWorkflowRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    try {
      const run = await input.workflows.cancel({
        ...principal(context),
        knowledgeSpaceId: params.id,
        ...(body.reason ? { reason: body.reason } : {}),
        runId: params.runId,
      });
      return run
        ? context.json(toPublicSourceWorkflowRun(run), 200)
        : context.json({ error: "Source workflow not found" }, 404);
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(retrySourceWorkflowRoute, async (context) => {
    const params = context.req.valid("param");
    try {
      const run = await input.workflows.retry({
        ...principal(context),
        knowledgeSpaceId: params.id,
        runId: params.runId,
      });
      return run
        ? context.json(toPublicSourceWorkflowRun(run), 200)
        : context.json({ error: "Source workflow not found" }, 404);
    } catch (error) {
      return workflowFailure(context, error);
    }
  });

  register(listCrawlPreviewPagesRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const run = await input.workflows.get({
      ...principal(context),
      knowledgeSpaceId: params.id,
      runId: params.runId,
    });
    if (!run) return context.json({ error: "Source workflow not found" }, 404);
    const page = await input.repository.listCrawlPages({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
      runId: run.id,
    });
    return context.json(
      {
        items: page.items.map((item) => ({
          ...(item.description ? { description: item.description } : {}),
          ...(item.etag ? { etag: item.etag } : {}),
          pageId: item.pageId,
          sourceUrl: item.sourceUrl,
          ...(item.title ? { title: item.title } : {}),
        })),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
      200,
    );
  });

  register(selectCrawlPreviewPagesRoute, async (context) => {
    const params = context.req.valid("param");
    const headers = context.req.valid("header");
    const body = context.req.valid("json");
    try {
      return context.json(
        toPublicSourceWorkflowRun(
          await input.workflows.selectCrawlPages({
            ...principal(context),
            idempotencyKey: headers["Idempotency-Key"],
            knowledgeSpaceId: params.id,
            pageIds: body.pageIds,
            runId: params.runId,
          }),
        ),
        202,
      );
    } catch (error) {
      return workflowFailure(context, error);
    }
  });
}

function publicConnection(connection: PublicSourceConnection) {
  return {
    authKind: connection.authKind,
    configuration: { ...connection.configuration },
    createdAt: connection.createdAt,
    ...(connection.errorCode === undefined ? {} : { errorCode: connection.errorCode }),
    ...(connection.expiresAt === undefined ? {} : { expiresAt: connection.expiresAt }),
    id: connection.id,
    knowledgeSpaceId: connection.knowledgeSpaceId,
    name: connection.name,
    providerId: connection.providerId,
    scopes: [...connection.scopes],
    status: connection.status,
    updatedAt: connection.updatedAt,
    version: connection.version,
  };
}

function publicSyncPolicy(
  policy: Awaited<ReturnType<SourceProductWorkflowService["putSyncPolicy"]>>,
) {
  return {
    createdAt: policy.createdAt,
    ...(policy.customIntervalSeconds === undefined
      ? {}
      : { customIntervalSeconds: policy.customIntervalSeconds }),
    enabled: policy.enabled,
    expectedSourceVersion: policy.expectedSourceVersion,
    id: policy.id,
    knowledgeSpaceId: policy.knowledgeSpaceId,
    mode: policy.mode,
    ...(policy.nextRunAt ? { nextRunAt: policy.nextRunAt } : {}),
    revision: policy.revision,
    sourceId: policy.sourceId,
    updatedAt: policy.updatedAt,
  };
}

function principal(context: Pick<LooseOpenApiContext, "get">) {
  const apiKey = context.get("authenticatedApiKey");
  const capabilityGrant = context.get("capabilityV2Grant");
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(capabilityGrant
      ? {
          capability: {
            contentScopeIds: capabilityGrant.contentScopeIds,
            grantId: capabilityGrant.grantId,
          },
        }
      : {}),
    callerKind: context.get("callerKind") ?? "interactive",
    subject: context.get("subject"),
  } as const;
}

async function authorize(
  authorization: KnowledgeSpaceAuthorizationGuard,
  context: Pick<LooseOpenApiContext, "get">,
  knowledgeSpaceId: string,
  requiredAccess: "read" | "write",
): Promise<{ code: string; error: string } | null> {
  try {
    await authorization.authorize({
      callerKind: context.get("callerKind") ?? "interactive",
      knowledgeSpaceId,
      requiredAccess,
      subject: context.get("subject"),
    });
    return null;
  } catch (error) {
    if (error instanceof KnowledgeSpaceAuthorizationError)
      return { code: error.code, error: error.message };
    throw error;
  }
}

function connectionFailure(context: LooseOpenApiContext, error: unknown) {
  if (error instanceof KnowledgeSpaceAuthorizationError) {
    return context.json({ code: error.code, error: error.message }, 403);
  }
  if (error instanceof SourceProviderUnavailableError) {
    return context.json({ code: error.code, error: error.message }, 503);
  }
  if (error instanceof SourceConnectionError) {
    const status = error.code.includes("NOT_FOUND")
      ? 404
      : error.code.includes("CONFLICT")
        ? 409
        : error.code.includes("UNAVAILABLE") && !error.code.includes("CREDENTIAL")
          ? 503
          : error.code.includes("PROVIDER") ||
              error.code.includes("PERSIST") ||
              error.code.includes("START_FAILED") ||
              error.code.includes("CALLBACK_FAILED")
            ? 502
            : 400;
    return context.json({ code: error.code, error: error.message }, status);
  }
  throw error;
}

function workflowFailure(context: LooseOpenApiContext, error: unknown) {
  if (error instanceof KnowledgeSpaceAuthorizationError)
    return context.json({ code: error.code, error: error.message }, 403);
  if (error instanceof SourceWorkflowError) {
    const status = error.code.includes("NOT_FOUND")
      ? 404
      : error.code.includes("CONFLICT") || error.code.includes("EXHAUSTED")
        ? 409
        : 400;
    return context.json({ code: error.code, error: error.message }, status);
  }
  throw error;
}
