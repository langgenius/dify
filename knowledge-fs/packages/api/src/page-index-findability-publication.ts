import {
  KnowledgeSpaceRetrievalProfileSchema,
  ProjectionSetFingerprintSchema,
} from "@knowledge/core";

import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { GoldenQuestionRepository } from "./golden-question-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgeSpaceProfileRepository } from "./knowledge-space-profile-repository";
import type { PageIndexFindabilityEvaluator } from "./page-index-findability-evaluation";
import type {
  PageIndexFindabilityEvaluationRecord,
  PageIndexFindabilityRepository,
} from "./page-index-findability-repository";

export interface PageIndexFindabilityPublicationEvaluator {
  evaluatePublished(input: {
    readonly attempt: DocumentCompilationAttempt;
    readonly publicationFingerprint: string;
  }): Promise<PageIndexFindabilityEvaluationRecord>;
}

export interface PageIndexFindabilityPublicationEvaluatorOptions {
  readonly evaluator: PageIndexFindabilityEvaluator;
  readonly findability: Pick<PageIndexFindabilityRepository, "persist">;
  readonly goldenQuestions: Pick<GoldenQuestionRepository, "listTrusted">;
  readonly maxEvidenceIds: number;
  readonly maxQuestions: number;
  readonly nodes: Pick<KnowledgeNodeRepository, "getManyByIdsAcrossGenerations">;
  readonly now?: (() => string) | undefined;
  readonly outlines: Pick<DocumentOutlineRepository, "getByDocumentVersion">;
  readonly profiles: Pick<KnowledgeSpaceProfileRepository, "getRevision">;
}

/**
 * Evaluates the exact outline generation after publication. It consumes only existing Golden
 * Questions and never owns a question writer. A failed, sufficiently sampled score is persisted
 * as a hybrid routing decision and may queue one bounded summary repair for the document version.
 */
export function createPageIndexFindabilityPublicationEvaluator({
  evaluator,
  findability,
  goldenQuestions,
  maxEvidenceIds,
  maxQuestions,
  nodes,
  now = () => new Date().toISOString(),
  outlines,
  profiles,
}: PageIndexFindabilityPublicationEvaluatorOptions): PageIndexFindabilityPublicationEvaluator {
  validatePositiveInteger(maxEvidenceIds, "maxEvidenceIds");
  validatePositiveInteger(maxQuestions, "maxQuestions");
  return {
    evaluatePublished: async ({ attempt, publicationFingerprint }) => {
      const fingerprint = ProjectionSetFingerprintSchema.parse(publicationFingerprint);
      const profileReference = attempt.retrievalProfile;
      if (!profileReference) {
        throw new Error("Findability evaluation requires a frozen retrieval profile");
      }
      const [outline, profileRevision, questionPage] = await Promise.all([
        outlines.getByDocumentVersion({
          documentAssetId: attempt.documentAssetId,
          publicationGenerationId: attempt.publicationGenerationId,
          version: attempt.documentVersion,
        }),
        profiles.getRevision({
          kind: "retrieval",
          knowledgeSpaceId: attempt.knowledgeSpaceId,
          revision: profileReference.revision,
          tenantId: attempt.tenantId,
        }),
        goldenQuestions.listTrusted({
          knowledgeSpaceId: attempt.knowledgeSpaceId,
          limit: maxQuestions,
        }),
      ]);
      if (!outline || outline.publicationGenerationId !== attempt.publicationGenerationId) {
        throw new Error("Findability evaluation exact outline generation is unavailable");
      }
      if (
        !profileRevision ||
        profileRevision.id !== profileReference.revisionId ||
        profileRevision.snapshotDigest !== profileReference.snapshotDigest ||
        profileRevision.kind !== "retrieval"
      ) {
        throw new Error("Findability evaluation frozen retrieval profile identity changed");
      }
      const retrievalProfile = KnowledgeSpaceRetrievalProfileSchema.parse(profileRevision.snapshot);
      const questions = questionPage.items.slice(0, maxQuestions);
      const evidenceIds = [
        ...new Set(questions.flatMap((question) => question.expectedEvidenceIds)),
      ].sort();
      if (evidenceIds.length > maxEvidenceIds) {
        throw new Error(`Findability expected evidence exceeds maxEvidenceIds=${maxEvidenceIds}`);
      }
      const evidenceNodes =
        evidenceIds.length === 0
          ? []
          : await nodes.getManyByIdsAcrossGenerations({
              ids: evidenceIds,
              knowledgeSpaceId: attempt.knowledgeSpaceId,
            });
      const evidenceRanges = evidenceNodes
        .filter(
          (node) =>
            node.documentAssetId === attempt.documentAssetId &&
            node.publicationGenerationId === attempt.publicationGenerationId,
        )
        .map((node) => ({
          documentAssetId: node.documentAssetId,
          endOffset: node.endOffset,
          evidenceId: node.id,
          startOffset: node.startOffset,
        }));
      const evaluation = await evaluator.evaluate({
        evidenceRanges,
        outline,
        questions,
        reasoningModel: retrievalProfile.reasoningModel,
        tenantId: attempt.tenantId,
      });
      return findability.persist({
        compilationAttemptId: attempt.id,
        documentAssetId: attempt.documentAssetId,
        documentVersion: attempt.documentVersion,
        evaluatedAt: now(),
        evaluation,
        generationId: attempt.publicationGenerationId,
        knowledgeSpaceId: attempt.knowledgeSpaceId,
        outlineId: outline.id,
        publicationFingerprint: fingerprint,
        requestSummaryRepair: evaluation.status === "failed",
        tenantId: attempt.tenantId,
      });
    },
  };
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Findability publication ${label} must be a positive integer`);
  }
}
