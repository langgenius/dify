import type { OpenAPIHono } from "@hono/zod-openapi";

import { type KnowledgeSpaceScope, getRequiredScope } from "./auth";

type OpenApiDocument = ReturnType<OpenAPIHono["getOpenAPI31Document"]>;

const OPENAPI_METHODS = [
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
] as const;

const MEBIBYTE = 1024 * 1024;
const DEFAULT_BUFFERED_RESPONSE_BYTES = MEBIBYTE;
const DEFAULT_BINARY_RESPONSE_BYTES = 25 * MEBIBYTE;
const DEFAULT_STREAM_RESPONSE_BYTES = 64 * MEBIBYTE;

export const knowledgeGatewayBearerSecurityScheme = {
  bearerFormat: "JWT or API token",
  scheme: "bearer",
  type: "http",
} as const;

const knowledgeGatewayTraceRequestHeader = {
  description: "Optional caller trace identifier; invalid values are replaced by the gateway",
  in: "header",
  name: "x-trace-id",
  required: false,
  schema: { type: "string" },
} as const;

const knowledgeGatewayTraceResponseHeader = {
  description: "Trace identifier assigned to the request",
  schema: { type: "string" },
} as const;

export const knowledgeGatewayOpenApiDocument = {
  openapi: "3.1.0" as const,
  info: {
    title: "Knowledge Platform API",
    version: "0.1.0",
  },
  security: [{ bearerAuth: [] }],
};

/** Add transport metadata shared by generated clients and Dify's contract validator. */
export function completeKnowledgeGatewayOpenApiDocument<T extends OpenApiDocument>(document: T): T {
  document.servers = [{ url: "/" }];

  const operationIds = new Set<string>();
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of OPENAPI_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      operation.operationId ??= operationIdFor(method, path);
      addTraceHeaderContract(operation);
      const operationWithTransport = operation as typeof operation & {
        "x-knowledge-fs-max-response-bytes"?: number;
        "x-knowledge-fs-required-scope"?: KnowledgeSpaceScope;
      };
      operationWithTransport["x-knowledge-fs-max-response-bytes"] = maxResponseBytes(operation);
      if (operation.security === undefined || operation.security.length > 0) {
        operationWithTransport["x-knowledge-fs-required-scope"] = getRequiredScope(
          method.toUpperCase(),
          path,
        );
      }
      if (operationIds.has(operation.operationId)) {
        throw new Error(`Duplicate OpenAPI operationId: ${operation.operationId}`);
      }
      operationIds.add(operation.operationId);
    }
  }

  return document;
}

function addTraceHeaderContract(
  operation: NonNullable<OpenApiDocument["paths"]>[string]["get"],
): void {
  if (!operation) return;

  operation.parameters ??= [];
  if (
    !operation.parameters.some(
      (parameter) =>
        "name" in parameter &&
        parameter.in === "header" &&
        parameter.name.toLowerCase() === "x-trace-id",
    )
  ) {
    operation.parameters.push(knowledgeGatewayTraceRequestHeader);
  }

  for (const response of Object.values(operation.responses ?? {})) {
    if ("$ref" in response) continue;
    response.headers ??= {};
    if (!Object.keys(response.headers).some((name) => name.toLowerCase() === "x-trace-id")) {
      response.headers["x-trace-id"] = knowledgeGatewayTraceResponseHeader;
    }
  }
}

function maxResponseBytes(operation: unknown): number {
  const mediaTypes = responseMediaTypes(operation);
  if (mediaTypes.includes("text/event-stream")) {
    return DEFAULT_STREAM_RESPONSE_BYTES;
  }
  if (mediaTypes.includes("application/octet-stream")) {
    return DEFAULT_BINARY_RESPONSE_BYTES;
  }
  return DEFAULT_BUFFERED_RESPONSE_BYTES;
}

function responseMediaTypes(operation: unknown): string[] {
  if (!isRecord(operation) || !isRecord(operation.responses)) {
    return [];
  }
  return Object.values(operation.responses).flatMap((response) => {
    if (!isRecord(response) || !isRecord(response.content)) {
      return [];
    }
    return Object.keys(response.content);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function operationIdFor(method: (typeof OPENAPI_METHODS)[number], path: string): string {
  const resource = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        return `By${pascalCase(segment.slice(1, -1))}`;
      }
      return pascalCase(segment);
    })
    .join("");

  return `${method}${resource || "Root"}`;
}

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}
