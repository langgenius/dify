import {
  type AdminKnowledgeFsGcCandidate,
  createAdminApiClient,
  getAdminApiBase,
} from "../../../lib/api-client";
import { getAdminServerToken } from "../../../lib/server-auth";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectWithNotice(request, "error", "GC form data is invalid");
  }

  const token = getAdminServerToken();
  if (!token) {
    return redirectWithNotice(request, "error", "Admin API token is not configured");
  }

  const knowledgeSpaceId = stringField(formData, "knowledgeSpaceId");
  const dryRunId = stringField(formData, "dryRunId");
  const idempotencyKey = stringField(formData, "idempotencyKey");
  if (!knowledgeSpaceId || !dryRunId || !idempotencyKey) {
    return redirectWithNotice(
      request,
      "error",
      "Knowledge space, dry-run id, and idempotency key are required",
    );
  }

  const candidate = parseCandidate(stringField(formData, "candidateJson"));
  if (!candidate || candidate.idempotencyKey !== idempotencyKey) {
    return redirectWithNotice(request, "error", "GC candidate idempotency key is invalid");
  }

  try {
    const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
    const result = await client.executeStagedObjectGc({
      candidates: [candidate],
      dryRunId,
      idempotencyKey,
      knowledgeSpaceId,
      token,
    });

    return redirectWithNotice(request, "success", `GC deleted ${result.deleted} item(s)`);
  } catch (error) {
    return redirectWithNotice(
      request,
      "error",
      error instanceof Error ? error.message : "GC execution failed",
    );
  }
}

function parseCandidate(value: string): AdminKnowledgeFsGcCandidate | null {
  try {
    const candidate = JSON.parse(value) as Partial<AdminKnowledgeFsGcCandidate>;
    if (
      typeof candidate.candidateType !== "string" ||
      typeof candidate.count !== "number" ||
      typeof candidate.estimatedBytes !== "number" ||
      typeof candidate.idempotencyKey !== "string" ||
      typeof candidate.reason !== "string" ||
      !candidate.target ||
      typeof candidate.target !== "object"
    ) {
      return null;
    }

    return {
      candidateType: candidate.candidateType,
      count: candidate.count,
      estimatedBytes: candidate.estimatedBytes,
      idempotencyKey: candidate.idempotencyKey,
      reason: candidate.reason,
      target: candidate.target,
    };
  } catch {
    return null;
  }
}

function redirectWithNotice(
  request: Request,
  status: "error" | "success",
  message: string,
): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("adminStatus", status);
  url.searchParams.set("adminMessage", message);
  url.hash = "gc-staged-objects";

  return Response.redirect(url, 303);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
