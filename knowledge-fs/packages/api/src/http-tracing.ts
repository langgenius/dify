import { randomUUID } from "node:crypto";

import type { AuthSubject } from "@knowledge/core";
import type { MiddlewareHandler } from "hono";

import { getTraceRoute } from "./route-classification";
import type { TraceAttributeValue, TraceRecorder } from "./tracing";

export function createTraceMiddleware<
  E extends { Variables: { subject: AuthSubject; traceId: string } },
>(traces: TraceRecorder): MiddlewareHandler<E> {
  return async (context, next) => {
    const traceId = normalizeTraceId(context.req.header("x-trace-id"));
    context.set("traceId", traceId);
    context.header("x-trace-id", traceId);

    const span = traces.startSpan("http.request", {
      method: context.req.method,
      route: getTraceRoute(context.req.path),
      traceId,
    });

    try {
      await next();
      const subject = context.get("subject") as AuthSubject | undefined;
      const attributes: Record<string, TraceAttributeValue> = {
        statusCode: context.res.status,
      };

      if (subject) {
        attributes.tenantId = subject.tenantId;
      }

      context.header("x-trace-id", traceId);
      span.end(context.res.status >= 500 ? "error" : "ok", attributes);
    } catch (error) {
      context.header("x-trace-id", traceId);
      span.end("error", { errorClass: getTraceErrorClass(error) });
      throw error;
    }
  };
}

export function normalizeTraceId(header: string | undefined): string {
  const value = header?.trim();

  if (value && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    return value;
  }

  return randomUUID();
}

export function getTraceErrorClass(error: unknown): string {
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return "UnknownError";
}
