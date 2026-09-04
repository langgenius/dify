import type { OpenAPIHono } from "@hono/zod-openapi";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type {
  NamespaceSourcePreviewJob,
  NamespaceSourcePreviewPage,
  createNamespaceSourcePreviewService,
} from "./namespace-source-preview";
import { NamespaceSourcePreviewError } from "./namespace-source-preview";
import {
  cancelNamespaceSourcePreviewRoute,
  consumeNamespaceSourcePreviewRoute,
  createNamespaceSourcePreviewRoute,
  getNamespaceSourcePreviewRoute,
} from "./namespace-source-preview-routes";
import type { LooseOpenApiContext } from "./openapi-handler-utils";

type Service = ReturnType<typeof createNamespaceSourcePreviewService>;
export function registerNamespaceSourcePreviewHandlers(input: {
  app: OpenAPIHono<KnowledgeGatewayEnv>;
  service: Service;
}): void {
  const register = input.app.openapi.bind(input.app) as (
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI registration adapter
    route: any,
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI registration adapter
    handler: (context: any) => unknown,
  ) => void;
  const present = (
    job: NamespaceSourcePreviewJob,
    pages: readonly NamespaceSourcePreviewPage[] = [],
  ) => ({
    jobId: job.id,
    status: job.status,
    configurationFingerprint: job.configurationFingerprint,
    expiresAt: job.expiresAt,
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.importWorkflowId ? { importWorkflowId: job.importWorkflowId } : {}),
    pages: pages.map((p) => ({
      pageId: p.pageId,
      sourceUrl: p.sourceUrl,
      ...(p.title ? { title: p.title } : {}),
      ...(p.description ? { description: p.description } : {}),
    })),
  });
  register(createNamespaceSourcePreviewRoute, async (context) => {
    try {
      const body = context.req.valid("json");
      return context.json(
        present(
          await input.service.create(
            context.get("subject"),
            {
              credentialId: body.credentialId,
              pluginId: body.pluginId,
              provider: body.provider,
              datasource: body.datasource,
              parameters: body.parameters,
              rootUrl: body.rootUrl,
            },
            body.configurationFingerprint,
          ),
        ),
        202,
      );
    } catch (e) {
      return failure(context, e);
    }
  });
  register(getNamespaceSourcePreviewRoute, async (context) => {
    try {
      const job = await input.service.get(context.get("subject"), context.req.valid("param").jobId);
      return context.json(
        present(job, await input.service.pages(context.get("subject"), job.id)),
        200,
      );
    } catch (e) {
      return failure(context, e);
    }
  });
  register(cancelNamespaceSourcePreviewRoute, async (context) => {
    try {
      return context.json(
        present(
          await input.service.cancel(context.get("subject"), context.req.valid("param").jobId),
        ),
        200,
      );
    } catch (e) {
      return failure(context, e);
    }
  });
  register(consumeNamespaceSourcePreviewRoute, async (context) => {
    try {
      const params = context.req.valid("param");
      const body = context.req.valid("json");
      const headers = context.req.valid("header");
      return context.json(
        {
          workflowId: await input.service.consume(context.get("subject"), {
            jobId: body.previewJobId,
            pageIds: body.pageIds,
            configurationFingerprint: body.configurationFingerprint,
            knowledgeSpaceId: params.id,
            sourceId: params.sourceId,
            idempotencyKey: headers["Idempotency-Key"],
          }),
        },
        202,
      );
    } catch (e) {
      return failure(context, e);
    }
  });
}
function failure(context: LooseOpenApiContext, error: unknown) {
  if (error instanceof NamespaceSourcePreviewError) {
    const status = error.code.includes("NOT_FOUND")
      ? 404
      : error.code.includes("EXPIRED") || error.code.includes("MISMATCH")
        ? 409
        : 400;
    return context.json({ code: error.code, error: error.message }, status as 400);
  }
  throw error;
}
