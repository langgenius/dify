import {
  type AdminAnswerCorrectness,
  createAdminApiClient,
  getAdminApiBase,
} from "../../../lib/api-client";
import { getAdminServerToken } from "../../../lib/server-auth";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectWithNotice(request, "error", "Annotation form data is invalid");
  }

  const token = getAdminServerToken();
  if (!token) {
    return redirectWithNotice(request, "error", "Admin API token is not configured");
  }

  const knowledgeSpaceId = stringField(formData, "knowledgeSpaceId");
  const questionId = stringField(formData, "questionId");
  const answerCorrectness = parseAnswerCorrectness(stringField(formData, "answerCorrectness"));
  if (!knowledgeSpaceId || !questionId || !answerCorrectness) {
    return redirectWithNotice(request, "error", "Annotation request is invalid");
  }
  if (!isUuid(knowledgeSpaceId)) {
    return redirectWithNotice(request, "error", "Knowledge space id must be a UUID");
  }
  if (!isUuid(questionId)) {
    return redirectWithNotice(request, "error", "Golden question id must be a UUID");
  }

  try {
    const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
    const evidenceRelevance = await parseEvidenceRelevance({
      client,
      knowledgeSpaceId,
      token,
      value: stringField(formData, "evidenceRelevance"),
    });
    await client.annotateGoldenQuestion({
      answerCorrectness,
      evidenceRelevance: evidenceRelevance.items,
      knowledgeSpaceId,
      note: annotationNote({
        note: stringField(formData, "note"),
        relevanceNotes: evidenceRelevance.notes,
        rawEvidenceRelevance: stringField(formData, "evidenceRelevance"),
      }),
      questionId,
      token,
    });

    return redirectWithNotice(request, "success", "Annotation submitted");
  } catch (error) {
    return redirectWithNotice(
      request,
      "error",
      error instanceof Error ? error.message : "Annotation failed",
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

function parseAnswerCorrectness(value: string): AdminAnswerCorrectness | null {
  if (
    value === "correct" ||
    value === "incorrect" ||
    value === "not-answerable" ||
    value === "partially-correct"
  ) {
    return value;
  }

  return null;
}

async function parseEvidenceRelevance({
  client,
  knowledgeSpaceId,
  token,
  value,
}: {
  readonly client: ReturnType<typeof createAdminApiClient>;
  readonly knowledgeSpaceId: string;
  readonly token: string;
  readonly value: string;
}): Promise<{
  readonly items: readonly { readonly evidenceId: string; readonly relevant: boolean }[];
  readonly notes: readonly string[];
}> {
  const items: Array<{ readonly evidenceId: string; readonly relevant: boolean }> = [];
  const notes: string[] = [];

  for (const rawItem of csvItems(value)) {
    const [rawEvidenceId, rawRelevant] = rawItem.split("=").map((part) => part.trim());
    const evidenceId = rawEvidenceId ?? "";
    const relevant = parseRelevant(rawRelevant);

    if (isUuid(evidenceId)) {
      items.push({ evidenceId, relevant });
      continue;
    }

    if (evidenceId.startsWith("/")) {
      const resolved = await resolveKnowledgeFsEvidenceId({
        client,
        knowledgeSpaceId,
        path: evidenceId,
        token,
      });

      if (resolved && isUuid(resolved)) {
        items.push({ evidenceId: resolved, relevant });
        continue;
      }
    }

    notes.push(rawItem);
  }

  return {
    items: uniqueEvidenceRelevance(items),
    notes,
  };
}

function parseRelevant(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === undefined || normalized === "true" || normalized === "1" || normalized === "yes";
}

function annotationNote({
  note,
  rawEvidenceRelevance,
  relevanceNotes,
}: {
  readonly note: string;
  readonly rawEvidenceRelevance: string;
  readonly relevanceNotes: readonly string[];
}): string | undefined {
  const parts = [
    note,
    ...(relevanceNotes.length > 0
      ? [`Evidence relevance notes: ${relevanceNotes.join(", ")}`]
      : []),
    ...(rawEvidenceRelevance && relevanceNotes.length > 0
      ? [`Raw evidence relevance: ${rawEvidenceRelevance}`]
      : []),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("\n") : undefined;
}

function csvItems(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

function uniqueEvidenceRelevance(
  values: readonly { readonly evidenceId: string; readonly relevant: boolean }[],
): readonly { readonly evidenceId: string; readonly relevant: boolean }[] {
  const seen = new Set<string>();
  const unique: Array<{ readonly evidenceId: string; readonly relevant: boolean }> = [];

  for (const value of values) {
    if (seen.has(value.evidenceId)) {
      continue;
    }

    seen.add(value.evidenceId);
    unique.push(value);
  }

  return unique;
}
