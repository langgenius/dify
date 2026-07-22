import { createAdminApiClient, getAdminApiBase } from "../../../lib/api-client";
import { getAdminServerToken } from "../../../lib/server-auth";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectWithNotice(request, "error", "Golden question form data is invalid");
  }

  const token = getAdminServerToken();
  if (!token) {
    return redirectWithNotice(request, "error", "Admin API token is not configured");
  }

  const knowledgeSpaceId = stringField(formData, "knowledgeSpaceId");
  if (!knowledgeSpaceId) {
    return redirectWithNotice(request, "error", "Knowledge space is required");
  }
  if (!isUuid(knowledgeSpaceId)) {
    return redirectWithNotice(request, "error", "Knowledge space id must be a UUID");
  }

  const action = stringField(formData, "action") || "create";
  const client = createAdminApiClient({ baseUrl: getAdminApiBase() });

  try {
    if (action === "delete") {
      const questionId = stringField(formData, "questionId");
      if (!questionId) {
        return redirectWithNotice(request, "error", "Golden question id is required");
      }
      if (!isUuid(questionId)) {
        return redirectWithNotice(request, "error", "Golden question id must be a UUID");
      }

      await client.deleteGoldenQuestion({ knowledgeSpaceId, questionId, token });
      return redirectWithNotice(request, "success", "Golden question deleted");
    }

    if (action === "update") {
      const questionId = stringField(formData, "questionId");
      if (!questionId) {
        return redirectWithNotice(request, "error", "Golden question id is required");
      }
      if (!isUuid(questionId)) {
        return redirectWithNotice(request, "error", "Golden question id must be a UUID");
      }
      const expectedEvidence = await parseExpectedEvidenceField({
        client,
        formData,
        knowledgeSpaceId,
        token,
      });

      await client.updateGoldenQuestion({
        expectedEvidenceIds: expectedEvidence.ids,
        knowledgeSpaceId,
        ...(expectedEvidence.metadata ? { metadata: expectedEvidence.metadata } : {}),
        question: stringField(formData, "question") || undefined,
        questionId,
        tags: csvField(formData, "tags"),
        token,
      });
      return redirectWithNotice(request, "success", "Golden question updated");
    }

    const expectedEvidence = await parseExpectedEvidenceField({
      client,
      formData,
      knowledgeSpaceId,
      token,
    });

    await client.createGoldenQuestion({
      expectedEvidenceIds: expectedEvidence.ids,
      knowledgeSpaceId,
      ...(expectedEvidence.metadata ? { metadata: expectedEvidence.metadata } : {}),
      question: stringField(formData, "question") || "",
      tags: csvField(formData, "tags"),
      token,
    });
    return redirectWithNotice(request, "success", "Golden question created");
  } catch (error) {
    return redirectWithNotice(
      request,
      "error",
      error instanceof Error ? error.message : "Golden question action failed",
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
  url.hash = "golden-questions";

  return Response.redirect(url, 303);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function csvField(formData: FormData, name: string): string[] {
  return stringField(formData, name)
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function parseExpectedEvidenceField({
  client,
  formData,
  knowledgeSpaceId,
  token,
}: {
  readonly client: ReturnType<typeof createAdminApiClient>;
  readonly formData: FormData;
  readonly knowledgeSpaceId: string;
  readonly token: string;
}): Promise<{
  readonly ids: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}> {
  const rawInput = stringField(formData, "expectedEvidenceIds");
  const values = csvField(formData, "expectedEvidenceIds");
  const ids: string[] = [];
  const paths: string[] = [];
  const notes: string[] = [];

  for (const value of values) {
    if (isUuid(value)) {
      ids.push(value);
      continue;
    }

    if (value.startsWith("/")) {
      const resolved = await resolveKnowledgeFsEvidenceId({
        client,
        knowledgeSpaceId,
        path: value,
        token,
      });

      if (resolved && isUuid(resolved)) {
        ids.push(resolved);
        paths.push(value);
        continue;
      }
    }

    notes.push(value);
  }

  const metadata: Record<string, unknown> = {};
  if (rawInput) {
    metadata.expectedEvidenceInput = rawInput;
  }
  if (paths.length > 0) {
    metadata.expectedEvidencePaths = paths;
  }
  if (notes.length > 0) {
    metadata.expectedEvidenceNotes = notes;
  }

  return {
    ids: uniqueStrings(ids),
    ...(Object.keys(metadata).length > 0 && ids.length !== values.length ? { metadata } : {}),
  };
}

async function resolveKnowledgeFsEvidenceId({
  client,
  knowledgeSpaceId,
  path,
  token,
}: {
  readonly client: ReturnType<typeof createAdminApiClient>;
  readonly knowledgeSpaceId: string;
  readonly path: string;
  readonly token: string;
}): Promise<string | null> {
  const normalizedPath = normalizeKnowledgeFsPath(path);
  const parentPath = parentKnowledgeFsPath(normalizedPath);

  try {
    const list = await client.listKnowledgeFs({
      knowledgeSpaceId,
      limit: 100,
      path: parentPath,
      token,
    });
    const entry = list.items.find((item) => normalizeKnowledgeFsPath(item.path) === normalizedPath);

    return entry?.targetId ?? null;
  } catch {
    return null;
  }
}

function normalizeKnowledgeFsPath(path: string): string {
  const trimmed = path.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

function parentKnowledgeFsPath(path: string): string {
  const index = path.lastIndexOf("/");

  if (index <= 0) {
    return path;
  }

  return path.slice(0, index);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
