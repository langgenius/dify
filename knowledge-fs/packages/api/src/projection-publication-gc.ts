import type { KnowledgeFsSessionRepository } from "./knowledge-fs-session-repository";
import type {
  ProjectionSetPublication,
  ProjectionSetPublicationRepository,
} from "./projection-publication-repository";

export interface ProjectionPublicationGcOptions {
  readonly maxActiveSessions: number;
  readonly publications: ProjectionSetPublicationRepository;
  readonly sessions: KnowledgeFsSessionRepository;
}

export interface ProjectionPublicationGcInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly now: string;
  readonly olderThan: string;
  readonly tenantId: string;
}

export interface ProjectionPublicationGcCandidate {
  readonly fingerprint: string;
  readonly projectionVersion: number;
  readonly reason: "inactive-retention" | "superseded-retention";
  readonly status: ProjectionSetPublication["status"];
}

export interface ProjectionPublicationGcReport {
  readonly candidates: readonly ProjectionPublicationGcCandidate[];
  readonly nextCursor?: string | undefined;
  readonly skippedActiveSessionFingerprints: readonly string[];
}

export interface ProjectionPublicationGcExecuteResult extends ProjectionPublicationGcReport {
  readonly deleted: number;
}

export function createProjectionPublicationGc({
  maxActiveSessions,
  publications,
  sessions,
}: ProjectionPublicationGcOptions) {
  if (!Number.isSafeInteger(maxActiveSessions) || maxActiveSessions < 1) {
    throw new Error("Projection publication GC maxActiveSessions must be at least 1");
  }

  return {
    execute: async (
      input: ProjectionPublicationGcInput,
    ): Promise<ProjectionPublicationGcExecuteResult> => {
      const report = await previewProjectionPublicationGc({
        input,
        maxActiveSessions,
        publications,
        sessions,
      });
      let deleted = 0;

      for (const candidate of report.candidates) {
        const removed = await publications.delete({
          fingerprint: candidate.fingerprint,
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId: input.tenantId,
        });

        if (removed) {
          deleted += 1;
        }
      }

      return {
        ...report,
        deleted,
      };
    },
    preview: (input: ProjectionPublicationGcInput): Promise<ProjectionPublicationGcReport> =>
      previewProjectionPublicationGc({
        input,
        maxActiveSessions,
        publications,
        sessions,
      }),
  };
}

async function previewProjectionPublicationGc({
  input,
  maxActiveSessions,
  publications,
  sessions,
}: {
  readonly input: ProjectionPublicationGcInput;
  readonly maxActiveSessions: number;
  readonly publications: ProjectionSetPublicationRepository;
  readonly sessions: KnowledgeFsSessionRepository;
}): Promise<ProjectionPublicationGcReport> {
  const [candidatePage, activeSessionPage] = await Promise.all([
    publications.listGcCandidates(input),
    sessions.listActive({
      knowledgeSpaceId: input.knowledgeSpaceId,
      limit: maxActiveSessions,
      now: input.now,
      tenantId: input.tenantId,
    }),
  ]);
  const activeFingerprints = new Set(
    activeSessionPage.items
      .map((session) => session.metadata.projectionSetFingerprint)
      .filter((fingerprint): fingerprint is string => typeof fingerprint === "string"),
  );
  const candidates: ProjectionPublicationGcCandidate[] = [];
  const skippedActiveSessionFingerprints: string[] = [];

  for (const publication of candidatePage.items) {
    if (activeFingerprints.has(publication.fingerprint)) {
      skippedActiveSessionFingerprints.push(publication.fingerprint);
      continue;
    }

    candidates.push({
      fingerprint: publication.fingerprint,
      projectionVersion: publication.projectionVersion,
      reason: publication.status === "inactive" ? "inactive-retention" : "superseded-retention",
      status: publication.status,
    });
  }

  return {
    candidates,
    ...(candidatePage.nextCursor ? { nextCursor: candidatePage.nextCursor } : {}),
    skippedActiveSessionFingerprints,
  };
}
