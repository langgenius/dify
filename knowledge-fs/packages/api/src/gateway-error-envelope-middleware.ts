import type { MiddlewareHandler } from "hono";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { isRegisteredKnowledgeFsErrorCode, knowledgeFsFailureForCode } from "./knowledge-fs-errors";

export const KNOWLEDGE_FS_ERROR_CONTRACT_HEADER = "x-knowledgefs-error-contract";
export const KNOWLEDGE_FS_ERROR_CONTRACT_VERSION = "2";

/**
 * Adds the stable public failure contract to JSON errors emitted by legacy route handlers.
 * Existing `code` and `error` fields remain available while 5xx messages are masked because they
 * may contain provider responses, signed URLs, connection strings, or other runtime diagnostics.
 */
export function createKnowledgeFsErrorEnvelopeMiddleware(): MiddlewareHandler<KnowledgeGatewayEnv> {
  return async (context, next) => {
    await next();

    if (!knowledgeFsErrorContractRequested(context)) return;

    const response = context.res;
    if (response.status < 400 || !isJsonResponse(response)) return;

    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return;

    const record = body as Record<string, unknown>;
    const rawFailure = isRecord(record.failure) ? record.failure : undefined;
    const legacyCode = typeof record.code === "string" ? record.code : undefined;
    const failureCode = typeof rawFailure?.code === "string" ? rawFailure.code : undefined;
    const candidateCode = failureCode ?? legacyCode;
    const traceId = context.get("traceId");
    const structuredCode =
      candidateCode && isRegisteredKnowledgeFsErrorCode(candidateCode)
        ? candidateCode
        : fallbackCodeForStatus(response.status);
    const failure = knowledgeFsFailureForCode(structuredCode, {
      ...(isRecord(rawFailure?.parameters)
        ? {
            parameters: rawFailure.parameters as Readonly<
              Record<string, boolean | number | string>
            >,
          }
        : {}),
      ...(typeof rawFailure?.stage === "string" ? { stage: rawFailure.stage } : {}),
      ...(typeof traceId === "string"
        ? { traceId }
        : typeof rawFailure?.traceId === "string"
          ? { traceId: rawFailure.traceId }
          : {}),
    });
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    context.res = new Response(
      JSON.stringify({
        ...record,
        code: legacyCode ?? failure.code,
        error: failure.message,
        failure,
      }),
      { headers, status: response.status },
    );
  };
}

export function knowledgeFsErrorContractRequested(context: {
  readonly req: { header(name: string): string | undefined };
}): boolean {
  return (
    context.req.header(KNOWLEDGE_FS_ERROR_CONTRACT_HEADER) === KNOWLEDGE_FS_ERROR_CONTRACT_VERSION
  );
}

function isJsonResponse(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fallbackCodeForStatus(status: number): string {
  if (status === 400 || status === 413 || status === 422) return "KNOWLEDGE_FS_INVALID_REQUEST";
  if (status === 401 || status === 403) return "KNOWLEDGE_FS_ACCESS_DENIED";
  if (status === 404) return "KNOWLEDGE_FS_NOT_FOUND";
  if (status === 409) return "KNOWLEDGE_FS_CONFLICT";
  if (status === 429) return "KNOWLEDGE_FS_RATE_LIMITED";
  if (status === 504) return "KNOWLEDGE_FS_TIMEOUT";
  if (status === 502 || status === 503) return "KNOWLEDGE_FS_UNAVAILABLE";
  return "KNOWLEDGE_FS_INTERNAL_ERROR";
}
