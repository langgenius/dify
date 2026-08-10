import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

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
  return context.json({ error: "Internal server error" }, 500);
}

export function handleGatewayNotFound(context: Context): Response {
  return context.json({ error: "Not found" }, 404);
}
