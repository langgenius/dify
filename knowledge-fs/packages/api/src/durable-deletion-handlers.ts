import type { OpenAPIHono } from "@hono/zod-openapi";

import type {
  BulkDeleteDocumentsBody,
  DeleteDocumentBody,
  DeleteDocumentParams,
  DeleteKnowledgeSpaceBody,
  DeleteKnowledgeSpaceParams,
  DeleteSourceBody,
  DeleteSourceParams,
  DeleteSourceQuery,
  DurableDeletionIdempotencyHeaders,
  DurableDeletionJobParams,
} from "./durable-deletion-request-schemas";
import {
  getDurableDeletionJobRoute,
  requestBulkDocumentDeletionRoute,
  requestDocumentDeletionRoute,
  requestKnowledgeSpaceDeletionRoute,
  requestLogicalDocumentDeletionRoute,
  requestSourceDeletionRoute,
  retryDurableDeletionJobRoute,
} from "./durable-deletion-routes";
import {
  type DurableDeletionRequestPrincipal,
  type DurableDeletionService,
  DurableDeletionServiceError,
} from "./durable-deletion-service";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { openApiHandler } from "./openapi-handler-utils";

export interface RegisterDurableDeletionHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly maxBulkDeleteDocuments: number;
  readonly service?: DurableDeletionService | undefined;
}

export function registerDurableDeletionHandlers({
  app,
  maxBulkDeleteDocuments,
  service,
}: RegisterDurableDeletionHandlersOptions): void {
  if (!Number.isSafeInteger(maxBulkDeleteDocuments) || maxBulkDeleteDocuments < 1) {
    throw new Error("Durable deletion maxBulkDeleteDocuments must be a positive integer");
  }

  app.openapi(
    requestKnowledgeSpaceDeletionRoute,
    openApiHandler(async (context) => {
      if (!service) {
        return unavailable(context);
      }
      const principal = deletionPrincipal(context);
      if (principal.callerKind !== "interactive") {
        return context.json(
          { error: "Knowledge space deletion requires an interactive owner" },
          403,
        );
      }
      const params = context.req.valid("param") as DeleteKnowledgeSpaceParams;
      const body = context.req.valid("json") as DeleteKnowledgeSpaceBody;
      const headers = context.req.valid("header") as DurableDeletionIdempotencyHeaders;
      try {
        const accepted = await service.requestKnowledgeSpaceDeletion({
          ...principal,
          challenge: body.challenge,
          expectedRevision: body.expectedRevision,
          idempotencyKey: headers["idempotency-key"],
          knowledgeSpaceId: params.id,
        });
        context.header("Location", accepted.statusUrl);
        return context.json(accepted, 202);
      } catch (error) {
        return handleRequestError(context, error);
      }
    }),
  );

  app.openapi(
    requestSourceDeletionRoute,
    openApiHandler(async (context) => {
      if (!service) {
        return unavailable(context);
      }
      const params = context.req.valid("param") as DeleteSourceParams;
      const body = context.req.valid("json") as DeleteSourceBody;
      const query = context.req.valid("query") as DeleteSourceQuery;
      const headers = context.req.valid("header") as DurableDeletionIdempotencyHeaders;
      try {
        const accepted = await service.requestSourceDeletion({
          ...deletionPrincipal(context),
          deleteMode: query.documents,
          expectedRevision: body.expectedRevision,
          idempotencyKey: headers["idempotency-key"],
          knowledgeSpaceId: params.id,
          sourceId: params.sourceId,
        });
        context.header("Location", accepted.statusUrl);
        return context.json(accepted, 202);
      } catch (error) {
        return handleRequestError(context, error);
      }
    }),
  );

  app.openapi(
    requestBulkDocumentDeletionRoute,
    openApiHandler(async (context) => {
      if (!service) {
        return unavailable(context);
      }
      const params = context.req.valid("param") as DeleteKnowledgeSpaceParams;
      const body = context.req.valid("json") as BulkDeleteDocumentsBody;
      const headers = context.req.valid("header") as DurableDeletionIdempotencyHeaders;
      if (body.documents.length > maxBulkDeleteDocuments) {
        return context.json(
          {
            error: `Bulk document delete maxBulkDeleteDocuments=${maxBulkDeleteDocuments} exceeded`,
          },
          400,
        );
      }
      if (
        new Set(body.documents.map((document) => document.documentId)).size !==
        body.documents.length
      ) {
        return context.json({ error: "Bulk document delete contains duplicate documentId" }, 400);
      }
      try {
        const accepted = await service.requestBulkDocumentDeletion({
          ...deletionPrincipal(context),
          documents: body.documents,
          idempotencyKey: headers["idempotency-key"],
          knowledgeSpaceId: params.id,
        });
        const firstStatusUrl = accepted.items[0]?.statusUrl;
        if (firstStatusUrl) {
          context.header("Location", firstStatusUrl);
        }
        return context.json(accepted, 202);
      } catch (error) {
        return handleRequestError(context, error);
      }
    }),
  );

  app.openapi(
    requestDocumentDeletionRoute,
    openApiHandler(async (context) => {
      if (!service) {
        return unavailable(context);
      }
      const params = context.req.valid("param") as DeleteDocumentParams;
      const body = context.req.valid("json") as DeleteDocumentBody;
      const headers = context.req.valid("header") as DurableDeletionIdempotencyHeaders;
      try {
        const accepted = await service.requestDocumentDeletion({
          ...deletionPrincipal(context),
          documentId: params.documentId,
          expectedRevision: body.expectedRevision,
          idempotencyKey: headers["idempotency-key"],
          knowledgeSpaceId: params.id,
        });
        context.header("Location", accepted.statusUrl);
        return context.json(accepted, 202);
      } catch (error) {
        return handleRequestError(context, error);
      }
    }),
  );

  app.openapi(
    requestLogicalDocumentDeletionRoute,
    openApiHandler(async (context) => {
      if (!service) {
        return unavailable(context);
      }
      const params = context.req.valid("param") as DeleteDocumentParams;
      const body = context.req.valid("json") as DeleteDocumentBody;
      const headers = context.req.valid("header") as DurableDeletionIdempotencyHeaders;
      try {
        const accepted = await service.requestLogicalDocumentDeletion({
          ...deletionPrincipal(context),
          documentId: params.documentId,
          expectedRevision: body.expectedRevision,
          idempotencyKey: headers["idempotency-key"],
          knowledgeSpaceId: params.id,
        });
        context.header("Location", accepted.statusUrl);
        return context.json(accepted, 202);
      } catch (error) {
        return handleRequestError(context, error);
      }
    }),
  );

  app.openapi(
    getDurableDeletionJobRoute,
    openApiHandler(async (context) => {
      if (!service) {
        return unavailable(context);
      }
      const params = context.req.valid("param") as DurableDeletionJobParams;
      const job = await service.get({ ...deletionPrincipal(context), jobId: params.jobId });
      return job ? context.json(job, 200) : context.json({ error: "Deletion job not found" }, 404);
    }),
  );

  app.openapi(
    retryDurableDeletionJobRoute,
    openApiHandler(async (context) => {
      if (!service) {
        return unavailable(context);
      }
      const params = context.req.valid("param") as DurableDeletionJobParams;
      const headers = context.req.valid("header") as DurableDeletionIdempotencyHeaders;
      try {
        const accepted = await service.retry({
          ...deletionPrincipal(context),
          idempotencyKey: headers["idempotency-key"],
          jobId: params.jobId,
        });
        if (!accepted) {
          return context.json({ error: "Deletion job not found" }, 404);
        }
        context.header("Location", accepted.statusUrl);
        return context.json(accepted, 202);
      } catch (error) {
        return handleRequestError(context, error);
      }
    }),
  );
}

function deletionPrincipal(context: {
  get(name: "authenticatedApiKey"): DurableDeletionRequestPrincipal["apiKey"];
  get(name: "callerKind"): DurableDeletionRequestPrincipal["callerKind"] | undefined;
  get(name: "subject"): DurableDeletionRequestPrincipal["subject"];
}): DurableDeletionRequestPrincipal {
  const apiKey = context.get("authenticatedApiKey");
  return {
    ...(apiKey ? { apiKey } : {}),
    callerKind: context.get("callerKind") ?? "interactive",
    subject: context.get("subject"),
  };
}

function unavailable(context: { json(body: unknown, status?: number): Response }): Response {
  return context.json(
    { code: "DURABLE_DELETION_UNAVAILABLE", error: "Durable deletion service is unavailable" },
    503,
  );
}

function handleRequestError(
  context: { json(body: unknown, status?: number): Response },
  error: unknown,
): Response {
  if (!(error instanceof DurableDeletionServiceError)) {
    throw error;
  }
  const status =
    error.code === "DURABLE_DELETION_UNAVAILABLE"
      ? 503
      : error.code === "DURABLE_DELETION_FORBIDDEN"
        ? 403
        : error.code === "DURABLE_DELETION_NOT_FOUND"
          ? 404
          : 409;
  return context.json({ code: error.code, error: error.message }, status);
}
