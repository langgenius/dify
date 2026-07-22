import { createAdminApiClient, getAdminApiBase } from "../../../lib/api-client";
import { getAdminServerToken } from "../../../lib/server-auth";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectWithNotice(request, "error", "KnowledgeFS write form data is invalid");
  }

  const token = getAdminServerToken();
  if (!token) {
    return redirectWithNotice(request, "error", "Admin API token is not configured");
  }

  const knowledgeSpaceId =
    stringField(formData, "spaceId") || stringField(formData, "knowledgeSpaceId");
  const command = stringField(formData, "fsCommand");
  const path = stringField(formData, "fsPath");
  const text = textField(formData, "fsWriteText");

  if (!knowledgeSpaceId) {
    return redirectWithNotice(request, "error", "Knowledge space is required");
  }

  if (command !== "write" && command !== "append") {
    return redirectWithNotice(request, "error", "KnowledgeFS write command must be write or append");
  }

  if (!path.startsWith("/")) {
    return redirectWithNotice(request, "error", "KnowledgeFS write path must be absolute");
  }

  const client = createAdminApiClient({ baseUrl: getAdminApiBase() });

  try {
    const result =
      command === "write"
        ? await client.writeKnowledgeFs({ knowledgeSpaceId, path, text, token })
        : await client.appendKnowledgeFs({ knowledgeSpaceId, path, text, token });

    return redirectWithKnowledgeFsResult({
      bytesWritten: result.bytesWritten,
      command,
      knowledgeSpaceId,
      path: result.path,
      request,
    });
  } catch (error) {
    return redirectWithNotice(
      request,
      "error",
      error instanceof Error ? error.message : "KnowledgeFS write action failed",
    );
  }
}

function redirectWithKnowledgeFsResult({
  bytesWritten,
  command,
  knowledgeSpaceId,
  path,
  request,
}: {
  readonly bytesWritten: number;
  readonly command: "append" | "write";
  readonly knowledgeSpaceId: string;
  readonly path: string;
  readonly request: Request;
}): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("spaceId", knowledgeSpaceId);
  url.searchParams.set("fsCommand", "cat");
  url.searchParams.set("fsPath", path);
  url.searchParams.set("fsLimit", "12");
  url.searchParams.set("adminStatus", "success");
  url.searchParams.set("adminMessage", `KnowledgeFS ${command} wrote ${bytesWritten} bytes`);
  url.hash = "knowledge-fs";

  return Response.redirect(url, 303);
}

function redirectWithNotice(
  request: Request,
  status: "error" | "success",
  message: string,
): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("adminStatus", status);
  url.searchParams.set("adminMessage", message);
  url.hash = "knowledge-fs";

  return Response.redirect(url, 303);
}

function stringField(formData: FormData, name: string): string {
  return textField(formData, name).trim();
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
