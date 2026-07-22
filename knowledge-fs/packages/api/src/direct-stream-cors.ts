import type { MiddlewareHandler } from "hono";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

export function createDirectStreamCorsMiddleware({
  allowedHeaders = ["Authorization", "Last-Event-ID"],
  allowedMethods = ["GET"],
  allowedOrigins,
}: {
  readonly allowedHeaders?: readonly string[] | undefined;
  readonly allowedMethods?: readonly string[] | undefined;
  readonly allowedOrigins: readonly string[];
}): MiddlewareHandler<KnowledgeGatewayEnv> {
  const origins = normalizeOrigins(allowedOrigins);
  const headers = normalizeHeaders(allowedHeaders);
  const methods = normalizeMethods(allowedMethods);
  return async (context, next) => {
    const origin = context.req.header("origin");
    if (!origin) {
      await next();
      return;
    }
    if (!origins.has(origin)) {
      return context.json({ error: "Forbidden" }, 403);
    }
    if (context.req.header("cookie")) {
      return context.json({ error: "Forbidden" }, 403);
    }

    if (context.req.method === "OPTIONS") {
      if (!methods.has(context.req.header("access-control-request-method")?.toUpperCase() ?? "")) {
        return context.json({ error: "Forbidden" }, 403);
      }
      const requestedHeaders = (context.req.header("access-control-request-headers") ?? "")
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      if (requestedHeaders.some((header) => !headers.normalized.has(header))) {
        return context.json({ error: "Forbidden" }, 403);
      }
      setCorsHeaders(context, origin);
      context.header("access-control-allow-headers", headers.serialized);
      context.header("access-control-allow-methods", `${[...methods].join(", ")}, OPTIONS`);
      context.header("access-control-max-age", "600");
      return context.body(null, 204);
    }
    if (!methods.has(context.req.method.toUpperCase())) {
      return context.json({ error: "Forbidden" }, 403);
    }

    await next();
    setCorsHeaders(context, origin);
    context.header("access-control-expose-headers", "X-Trace-ID");
  };
}

function normalizeHeaders(values: readonly string[]): {
  readonly normalized: ReadonlySet<string>;
  readonly serialized: string;
} {
  if (values.length === 0) throw new Error("Direct stream CORS requires allowed headers");
  const normalized = new Set<string>();
  const serialized: string[] = [];
  for (const value of values) {
    const header = value.trim();
    if (!/^[A-Za-z0-9-]+$/.test(header)) {
      throw new Error("Direct stream CORS headers must be valid header names");
    }
    const key = header.toLowerCase();
    if (!normalized.has(key)) serialized.push(header);
    normalized.add(key);
  }
  return { normalized, serialized: serialized.join(", ") };
}

function normalizeMethods(values: readonly string[]): ReadonlySet<string> {
  if (values.length === 0) throw new Error("Direct stream CORS requires allowed methods");
  const methods = new Set(values.map((value) => value.trim().toUpperCase()));
  if ([...methods].some((method) => method !== "GET" && method !== "POST")) {
    throw new Error("Direct stream CORS supports only GET and POST");
  }
  return methods;
}

function normalizeOrigins(values: readonly string[]): ReadonlySet<string> {
  if (values.length === 0) throw new Error("Direct stream CORS requires at least one origin");
  const origins = new Set<string>();
  for (const value of values) {
    const origin = value.trim();
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("Direct stream CORS origins must be absolute HTTP(S) origins");
    }
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("Direct stream CORS origins must be absolute HTTP(S) origins");
    }
    origins.add(origin);
  }
  return origins;
}

function setCorsHeaders(
  context: Parameters<MiddlewareHandler<KnowledgeGatewayEnv>>[0],
  origin: string,
): void {
  context.header("access-control-allow-origin", origin);
  context.header("vary", "Origin");
}
