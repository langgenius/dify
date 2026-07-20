import {
  type KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileSchema,
} from "@knowledge/core";

import type { DocumentCompilationProfileReference } from "./document-compilation-attempt-repository";
import type {
  KnowledgeSpaceProfileRepository,
  KnowledgeSpaceProfileRevision,
} from "./knowledge-space-profile-repository";

export interface DocumentCompilationFrozenProfileScope {
  readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
  readonly knowledgeSpaceId: string;
  readonly retrievalProfile?: DocumentCompilationProfileReference | undefined;
  readonly tenantId: string;
}

export interface DocumentCompilationFrozenProfiles {
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
}

export class DocumentCompilationProfileSnapshotError extends Error {
  readonly code = "DOCUMENT_COMPILATION_PROFILE_SNAPSHOT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "DocumentCompilationProfileSnapshotError";
  }
}

/**
 * Loads exactly the immutable revisions frozen on an attempt. Head state is deliberately ignored:
 * a worker retry must keep using the original snapshots, while publication performs the final
 * active-head comparison in its own transaction.
 */
export async function loadDocumentCompilationFrozenProfiles(
  profiles: Pick<KnowledgeSpaceProfileRepository, "getRevision">,
  scope: DocumentCompilationFrozenProfileScope,
): Promise<DocumentCompilationFrozenProfiles> {
  const embeddingReference = optionalReference(scope.embeddingProfile, "embedding");
  const retrievalReference = requireReference(scope.retrievalProfile, "retrieval");
  const [embeddingRevision, retrievalRevision] = await Promise.all([
    embeddingReference
      ? profiles.getRevision({
          kind: "embedding",
          knowledgeSpaceId: scope.knowledgeSpaceId,
          revision: embeddingReference.revision,
          tenantId: scope.tenantId,
        })
      : null,
    profiles.getRevision({
      kind: "retrieval",
      knowledgeSpaceId: scope.knowledgeSpaceId,
      revision: retrievalReference.revision,
      tenantId: scope.tenantId,
    }),
  ]);

  if (embeddingReference) {
    assertRevisionIdentity(embeddingRevision, embeddingReference, scope);
  }
  assertRevisionIdentity(retrievalRevision, retrievalReference, scope);

  return {
    ...(embeddingReference && embeddingRevision
      ? { embeddingProfile: KnowledgeSpaceEmbeddingProfileSchema.parse(embeddingRevision.snapshot) }
      : {}),
    retrievalProfile: KnowledgeSpaceRetrievalProfileSchema.parse(retrievalRevision.snapshot),
  };
}

function optionalReference(
  reference: DocumentCompilationProfileReference | undefined,
  kind: DocumentCompilationProfileReference["kind"],
): DocumentCompilationProfileReference | undefined {
  if (reference && reference.kind !== kind) {
    throw new DocumentCompilationProfileSnapshotError(
      `Document compilation attempt has an invalid frozen ${kind} profile reference`,
    );
  }
  return reference;
}

function requireReference(
  reference: DocumentCompilationProfileReference | undefined,
  kind: DocumentCompilationProfileReference["kind"],
): DocumentCompilationProfileReference {
  if (!reference || reference.kind !== kind) {
    throw new DocumentCompilationProfileSnapshotError(
      `Document compilation attempt has no frozen ${kind} profile reference`,
    );
  }
  return reference;
}

function assertRevisionIdentity(
  revision: KnowledgeSpaceProfileRevision | null,
  reference: DocumentCompilationProfileReference,
  scope: Pick<DocumentCompilationFrozenProfileScope, "knowledgeSpaceId" | "tenantId">,
): asserts revision is KnowledgeSpaceProfileRevision {
  if (
    !revision ||
    revision.id !== reference.revisionId ||
    revision.revision !== reference.revision ||
    revision.snapshotDigest !== reference.snapshotDigest ||
    revision.kind !== reference.kind ||
    (revision.state !== "active" && revision.state !== "superseded") ||
    revision.knowledgeSpaceId !== scope.knowledgeSpaceId ||
    revision.tenantId !== scope.tenantId
  ) {
    throw new DocumentCompilationProfileSnapshotError(
      `Document compilation frozen ${reference.kind} profile revision is unavailable or mismatched`,
    );
  }
}
