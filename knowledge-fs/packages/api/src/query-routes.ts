import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  ErrorResponseSchema,
  QueryStreamRequestSchema,
  RetrievalProfileModeErrorResponseSchema,
} from "./gateway-route-schemas";

const QueryUnavailableResponseSchema = ErrorResponseSchema.extend({
  code: z.string().optional(),
  runState: z.enum(["queued", "running", "succeeded", "failed", "unregistered"]).optional(),
});

export const streamQueryRoute = createRoute({
  method: "post",
  path: "/queries",
  request: {
    body: {
      content: {
        "application/json": {
          schema: QueryStreamRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
      description:
        "Streaming generated answer. SSE data.traceId and x-query-run-id identify the durable AnswerTrace; x-trace-id is transport correlation.",
      headers: {
        "x-query-run-id": {
          description: "Server-generated durable query-run and AnswerTrace UUID",
          schema: { format: "uuid", type: "string" },
        },
        "x-session-id": {
          description: "Generated or reused query session UUID",
          schema: { format: "uuid", type: "string" },
        },
        "x-trace-id": {
          description: "HTTP transport correlation ID; not the AnswerTrace resource ID",
          schema: { type: "string" },
        },
      },
    },
    400: {
      content: {
        "application/json": {
          schema: z.union([RetrievalProfileModeErrorResponseSchema, ErrorResponseSchema]),
        },
      },
      description: "Invalid query request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Query admission rejected while knowledge deletion is active",
    },
    503: {
      content: {
        "application/json": {
          schema: QueryUnavailableResponseSchema,
        },
      },
      description: "Query generation unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
