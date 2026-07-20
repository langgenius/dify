import { createAdminApiClient, getAdminApiBase } from "../../../lib/api-client";
import { getAdminServerToken } from "../../../lib/server-auth";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectWithNotice(request, "error", "Bad-case form data is invalid");
  }

  const token = getAdminServerToken();
  if (!token) {
    return redirectWithNotice(request, "error", "Admin API token is not configured");
  }

  const knowledgeSpaceId = stringField(formData, "knowledgeSpaceId");
  const traceId = stringField(formData, "traceId");
  if (!knowledgeSpaceId || !traceId) {
    return redirectWithNotice(request, "error", "Knowledge space and trace ID are required");
  }

  try {
    const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
    await client.captureProductionBadCase({
      knowledgeSpaceId,
      reason: stringField(formData, "reason") || undefined,
      tags: csvField(formData, "tags"),
      token,
      traceId,
    });

    return redirectWithNotice(request, "success", "Bad case added to eval queue");
  } catch (error) {
    return redirectWithNotice(
      request,
      "error",
      error instanceof Error ? error.message : "Bad-case capture failed",
    );
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
  url.hash = "bad-case-capture";

  return Response.redirect(url, 303);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function csvField(formData: FormData, name: string): string[] {
  return stringField(formData, name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
