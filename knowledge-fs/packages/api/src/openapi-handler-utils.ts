import type { AuthSubject } from "@knowledge/core";
import type { KnowledgeSpaceApiKeyAuthenticationResult } from "./knowledge-space-api-key-authentication";
import type { KnowledgeSpaceCallerKind } from "./knowledge-space-authorization";

export interface LooseOpenApiContext {
  get(name: "authenticatedApiKey"): KnowledgeSpaceApiKeyAuthenticationResult["apiKey"] | undefined;
  get(name: "authenticatedApiKeyKnowledgeSpaceId"): string | undefined;
  get(name: "callerKind"): KnowledgeSpaceCallerKind | undefined;
  get(name: "subject"): AuthSubject;
  get(name: "traceId"): string;
  header(name: string, value: string): void;
  json(body: unknown, status?: number): Response;
  readonly req: {
    valid(target: "header" | "json" | "param" | "query"): unknown;
  };
}

export function asLooseOpenApiContext(context: unknown): LooseOpenApiContext {
  return context as LooseOpenApiContext;
}

export function openApiHandler(
  handler: (context: LooseOpenApiContext) => Promise<Response> | Response,
): never {
  return handler as never;
}
