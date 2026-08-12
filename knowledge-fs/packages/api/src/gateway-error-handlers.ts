import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { knowledgeFsErrorContractRequested } from "./gateway-error-envelope-middleware";
import { KnowledgeFsError, knowledgeFsFailureFromError } from "./knowledge-fs-errors";

export function handleGatewayError(error: Error, context: Context): Response {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  const errorCode = (error as Error & { code?: unknown }).code;
  const traceId = (context.var as Record<string, unknown>).traceId;
  console.error("Unhandled gateway error", {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : undefined,
    stack: error instanceof Error ? error.stack : undefined,
    code: typeof errorCode === "string" || typeof errorCode === "number" ? errorCode : undefined,
    traceId: typeof traceId === "string" ? traceId : undefined,
    method: context.req.method,
    path: context.req.path,
  });
  if (!knowledgeFsErrorContractRequested(context)) {
    return context.json({ error: "Internal server error" }, 500);
  }
  const failure = knowledgeFsFailureFromError(error, {
    ...(typeof traceId === "string" ? { traceId } : {}),
  });
  const status = (
    error instanceof KnowledgeFsError ? error.httpStatus : 500
  ) as ContentfulStatusCode;
  return context.json({ code: failure.code, error: failure.message, failure }, status);
}

export function handleGatewayNotFound(context: Context): Response {
  if (!knowledgeFsErrorContractRequested(context)) {
    return context.json({ error: "Not found" }, 404);
  }
  const traceId = (context.var as Record<string, unknown>).traceId;
  const failure = knowledgeFsFailureFromError(
    new KnowledgeFsError("Route not found", {
      code: "KNOWLEDGE_FS_NOT_FOUND",
    }),
    { ...(typeof traceId === "string" ? { traceId } : {}) },
  );
  return context.json({ code: failure.code, error: failure.message, failure }, 404);
}
