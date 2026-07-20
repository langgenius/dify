import { createAdminApiClient, getAdminApiBase } from "../../../lib/api-client";
import { getAdminServerToken } from "../../../lib/server-auth";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectWithNotice(request, "error", "Semantic view form data is invalid");
  }

  const token = getAdminServerToken();
  if (!token) {
    return redirectWithNotice(request, "error", "Admin API token is not configured");
  }

  const knowledgeSpaceId = stringField(formData, "knowledgeSpaceId");
  if (!knowledgeSpaceId) {
    return redirectWithNotice(request, "error", "Knowledge space is required");
  }

  const action = stringField(formData, "action");
  const limit = numberField(formData, "limit");
  const client = createAdminApiClient({ baseUrl: getAdminApiBase() });

  try {
    if (action === "materialize-topic") {
      const result = await client.materializeSemanticTopicView({
        ...(limit ? { limit } : {}),
        generatedVersion: stringField(formData, "generatedVersion") || undefined,
        knowledgeSpaceId,
        topicName: stringField(formData, "topicName") || undefined,
        topicSlug: stringField(formData, "topicSlug") || undefined,
        token,
      });

      return redirectWithNotice(
        request,
        "success",
        `Topic view materialized ${result.pathCount} path(s) for ${result.documentCount} document(s)`,
      );
    }

    if (action === "extract-entities") {
      const extraction = await client.extractSemanticEntities({
        ...(limit ? { limit } : {}),
        knowledgeSpaceId,
        token,
      });
      const communities = await client.materializeSemanticCommunities({
        generatedVersion: stringField(formData, "generatedVersion") || undefined,
        knowledgeSpaceId,
        token,
      });
      const message = [
        `Entity extraction (${extraction.extractionMode}) indexed ${extraction.graphEntitiesIndexed} entity/entities`,
        `and ${extraction.graphRelationsIndexed} relation(s) from ${extraction.nodesUpdated} node(s).`,
        `Community view materialized ${communities.communityCount} community/communities`,
        `across ${communities.documentCount} document(s)`,
      ].join(" ");

      return redirectWithNotice(request, "success", message);
    }

    if (action === "materialize-communities") {
      const result = await client.materializeSemanticCommunities({
        generatedVersion: stringField(formData, "generatedVersion") || undefined,
        knowledgeSpaceId,
        token,
      });

      return redirectWithNotice(
        request,
        "success",
        `Community view materialized ${result.communityCount} community/communities across ${result.documentCount} document(s)`,
      );
    }

    return redirectWithNotice(request, "error", "Semantic view action is invalid");
  } catch (error) {
    return redirectWithNotice(
      request,
      "error",
      error instanceof Error ? error.message : "Semantic view action failed",
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
  url.hash = "semantic-views";

  return Response.redirect(url, 303);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function numberField(formData: FormData, name: string): number | undefined {
  const value = Number(stringField(formData, name));

  return Number.isInteger(value) && value > 0 ? value : undefined;
}
