import { type AdminSseEvent, createAdminApiClient, getAdminApiBase } from "./api-client";
import { getAdminServerToken } from "./server-auth";

const DEFAULT_MAX_QUERY_REDIRECT_ANSWER_BYTES = 2_000;
const textEncoder = new TextEncoder();

export interface RunQueryRedirectHandlerOptions {
  readonly apiBaseUrl?: string | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly maxAnswerBytes?: number | undefined;
}

export interface RunQueryRedirectHandler {
  handle(request: Request): Promise<Response>;
}

type QueryMode = "deep" | "fast" | "research";

interface QueryRedirectResult {
  readonly answer: string;
  readonly citations: readonly string[];
  readonly confidence: string;
  readonly freshness: string;
  readonly traceId: string;
}

export function createRunQueryRedirectHandler(
  options: RunQueryRedirectHandlerOptions = {},
): RunQueryRedirectHandler {
  const maxAnswerBytes = options.maxAnswerBytes ?? DEFAULT_MAX_QUERY_REDIRECT_ANSWER_BYTES;

  if (!Number.isInteger(maxAnswerBytes) || maxAnswerBytes < 1) {
    throw new Error("Query redirect maxAnswerBytes must be a positive integer");
  }

  return {
    async handle(request) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return redirectWithError(request, "Query form data is invalid");
      }

      const knowledgeSpaceId = stringField(formData, "knowledgeSpaceId");
      if (!knowledgeSpaceId) {
        return redirectWithError(request, "Knowledge space is required");
      }

      const query = stringField(formData, "query");
      if (!query) {
        return redirectWithError(request, "Query is required");
      }

      const mode = parseQueryMode(stringField(formData, "mode") || "fast");
      if (!mode) {
        return redirectWithError(request, "Query mode is invalid");
      }

      const token = getAdminServerToken();
      if (!token) {
        return redirectWithError(request, "Admin API token is not configured");
      }

      try {
        const client = createAdminApiClient({
          baseUrl: options.apiBaseUrl ?? getAdminApiBase(),
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
        const events = await client.streamQuery({
          knowledgeSpaceId,
          mode,
          query,
          token,
        });

        return redirectWithQueryResult(
          request,
          query,
          summarizeQueryEvents(events, maxAnswerBytes),
        );
      } catch (error) {
        return redirectWithError(request, error instanceof Error ? error.message : "Query failed");
      }
    },
  };
}

function redirectWithQueryResult(
  request: Request,
  query: string,
  result: QueryRedirectResult,
): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("queryStatus", "success");
  url.searchParams.set("query", query);
  url.searchParams.set("answer", result.answer);
  url.searchParams.set("citations", result.citations.join(","));
  url.searchParams.set("confidence", result.confidence);
  url.searchParams.set("freshness", result.freshness);
  if (result.traceId) {
    url.searchParams.set("traceId", result.traceId);
  }

  return Response.redirect(url, 303);
}

function redirectWithError(request: Request, message: string): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("queryStatus", "error");
  url.searchParams.set("queryError", message);

  return Response.redirect(url, 303);
}

function summarizeQueryEvents(
  events: readonly AdminSseEvent[],
  maxAnswerBytes: number,
): QueryRedirectResult {
  const answerParts: string[] = [];
  const citations = new Set<string>();
  let traceId = "";

  for (const event of events) {
    if (!event.data || typeof event.data !== "object") {
      continue;
    }

    const data = event.data as Record<string, unknown>;
    if (typeof data.traceId === "string" && data.traceId.trim()) {
      traceId = traceId || data.traceId.trim();
      citations.add(data.traceId.trim());
    }

    if (event.event === "answer.delta" && typeof data.delta === "string") {
      appendBoundedAnswer(answerParts, data.delta, maxAnswerBytes);
      continue;
    }

    if (event.event === "answer.done" && data.metadata && typeof data.metadata === "object") {
      collectMetadataCitations(data.metadata as Record<string, unknown>, citations);
    }
  }

  return {
    answer: answerParts.join("").trim() || "No answer chunks returned.",
    citations: [...citations].slice(0, 8),
    confidence: "Generated",
    freshness: "Live query",
    traceId,
  };
}

function appendBoundedAnswer(parts: string[], delta: string, maxAnswerBytes: number): void {
  const current = parts.join("");
  const remaining = maxAnswerBytes - textEncoder.encode(current).byteLength;
  if (remaining <= 0) {
    return;
  }

  let next = "";
  for (const char of delta) {
    const candidate = `${next}${char}`;
    if (textEncoder.encode(candidate).byteLength > remaining) {
      break;
    }
    next = candidate;
  }
  parts.push(next);
}

function collectMetadataCitations(metadata: Record<string, unknown>, citations: Set<string>): void {
  const sessionId = metadata.sessionId;
  if (typeof sessionId === "string" && sessionId.trim()) {
    citations.add(sessionId.trim());
  }

  const rawCitations = metadata.citations;
  if (!Array.isArray(rawCitations)) {
    return;
  }

  for (const citation of rawCitations) {
    if (!citation || typeof citation !== "object") {
      continue;
    }
    const label = (citation as { readonly label?: unknown }).label;
    if (typeof label === "string" && label.trim()) {
      citations.add(label.trim());
    }
  }
}

function parseQueryMode(value: string): QueryMode | null {
  return value === "fast" || value === "deep" || value === "research" ? value : null;
}

function stringField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}
