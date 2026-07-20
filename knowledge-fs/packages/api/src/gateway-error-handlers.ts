import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export function handleGatewayError(error: Error, context: Context): Response {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  console.error("Unhandled gateway error", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return context.json({ error: "Internal server error" }, 500);
}

export function handleGatewayNotFound(context: Context): Response {
  return context.json({ error: "Not found" }, 404);
}
