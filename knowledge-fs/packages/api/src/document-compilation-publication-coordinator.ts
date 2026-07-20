import {
  DateTimeSchema,
  type ProjectionSetFingerprintMaterial,
  ProjectionSetFingerprintMaterialSchema,
  PublicationGenerationIdSchema,
  TenantIdSchema,
  UuidSchema,
  buildProjectionSetFingerprint,
  stableJson,
} from "@knowledge/core";

import {
  DeletionLifecycleFenceActiveError,
  type DeletionLifecycleFenceGuard,
  type DeletionLifecycleFenceToken,
} from "./deletion-lifecycle-fence";
import type {
  DocumentCompilationAttempt,
  DocumentCompilationProfileReference,
} from "./document-compilation-attempt-repository";
import type { DocumentCompilationCandidateValidator } from "./document-compilation-candidate-validator";
import type {
  AdvanceDocumentCompilationExecutionInput,
  DocumentCompilationExecutionContext,
} from "./document-compilation-runtime";
import type { DocumentRevisionPublicationFenceResolver } from "./logical-document-repository";
import {
  ProjectionSetPublicationComponentTypes,
  type ProjectionSetPublicationDocumentComponentInput,
  type ProjectionSetPublicationMember,
  ProjectionSetPublicationMemberAttemptFenceConflictError,
  type ProjectionSetPublicationMemberRepository,
} from "./projection-publication-member-repository";
import {
  DuplicateProjectionSetPublicationError,
  type ProjectionSetPublication,
  ProjectionSetPublicationAttemptFenceConflictError,
  ProjectionSetPublicationDeletionFenceConflictError,
  ProjectionSetPublicationHeadConflictError,
  type ProjectionSetPublicationRepository,
  type PublishProjectionSetResult,
} from "./projection-publication-repository";

export const DocumentCompilationCandidateMetadataKey = "documentCompilationCandidate";

export interface DocumentCompilationPublicationCoordinator {
  composeCandidate(
    input: ComposeDocumentCompilationCandidateInput,
  ): Promise<ComposeDocumentCompilationCandidateResult>;
  evaluateAndPublishCandidate(
    input: EvaluateAndPublishDocumentCompilationCandidateInput,
  ): Promise<EvaluateAndPublishDocumentCompilationCandidateResult>;
}

export interface DocumentCompilationPublicationCoordinatorOptions {
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly maxComponents: number;
  readonly logicalDocumentFences?: DocumentRevisionPublicationFenceResolver | undefined;
  readonly members: Pick<
    ProjectionSetPublicationMemberRepository,
    "composeDocumentCandidate" | "listByFingerprint"
  >;
  readonly publications: Pick<
    ProjectionSetPublicationRepository,
    | "createCandidate"
    | "deactivate"
    | "getByFingerprint"
    | "getPublished"
    | "publishDocumentCompilationCandidate"
  >;
  readonly validator: DocumentCompilationCandidateValidator;
}

export interface DocumentCompilationCandidateEvaluationSnapshot {
  readonly compilationAttemptId?: string | undefined;
  readonly candidateFingerprint: string;
  readonly candidatePublicationId: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
  readonly expectedHeadRevision: number;
  readonly knowledgeSpaceId: string;
  readonly members: readonly ProjectionSetPublicationMember[];
  readonly publicationGenerationId: string;
  readonly retrievalProfile?: DocumentCompilationProfileReference | undefined;
  readonly tenantId: string;
}

export type DocumentCompilationCandidateEvaluationResult =
  | { readonly decision: "passed" }
  | { readonly decision: "failed"; readonly reason: string };

/** Candidate evaluators receive an exact member snapshot and have no unscoped fallback input. */
export interface DocumentCompilationCandidateEvaluator {
  evaluate(
    snapshot: DocumentCompilationCandidateEvaluationSnapshot,
  ): Promise<DocumentCompilationCandidateEvaluationResult>;
}

export interface EvaluateAndPublishDocumentCompilationCandidateInput {
  readonly evaluator: DocumentCompilationCandidateEvaluator;
  readonly execution: Pick<
    DocumentCompilationExecutionContext,
    "advance" | "attempt" | "heartbeat" | "signal" | "withLeaseSnapshot"
  >;
  readonly updatedAt: string;
}

export interface EvaluateAndPublishDocumentCompilationCandidateResult {
  readonly attempt: DocumentCompilationAttempt;
  readonly evaluation: "passed" | "previously-passed";
  readonly publication: PublishProjectionSetResult;
}

export interface ComposeDocumentCompilationCandidateInput {
  readonly candidateId: string;
  readonly componentReceipt: DocumentCompilationCandidateComponentReceipt;
  readonly createdAt: string;
  readonly execution: Pick<
    DocumentCompilationExecutionContext,
    "advance" | "attempt" | "heartbeat" | "signal" | "withLeaseSnapshot"
  >;
  readonly fingerprintMaterial: ProjectionSetFingerprintMaterial;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly projectionVersion: number;
}

export interface DocumentCompilationCandidateComponentReference {
  readonly componentKey: string;
  readonly generationId: string;
}

/** Every key is required so an omitted builder receipt cannot be mistaken for an empty result. */
export interface DocumentCompilationCandidateComponentReceipt {
  readonly documentOutlines: readonly DocumentCompilationCandidateComponentReference[];
  readonly graphEntities: readonly DocumentCompilationCandidateComponentReference[];
  readonly graphRelations: readonly DocumentCompilationCandidateComponentReference[];
  readonly indexProjections: readonly DocumentCompilationCandidateComponentReference[];
  readonly knowledgePaths: readonly DocumentCompilationCandidateComponentReference[];
  readonly multimodalManifests: readonly DocumentCompilationCandidateComponentReference[];
  readonly schemaVersion: 1;
}

export interface ComposeDocumentCompilationCandidateResult {
  readonly attempt: DocumentCompilationAttempt;
  readonly candidate: ProjectionSetPublication;
  readonly inheritedMemberCount: number;
  readonly replacedMemberCount: number;
}

export class DocumentCompilationCandidateIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentCompilationCandidateIdentityConflictError";
  }
}

export class DocumentCompilationCandidateComponentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentCompilationCandidateComponentError";
  }
}

export class DocumentCompilationCandidateLeaseLostError extends Error {
  constructor() {
    super("Document compilation candidate composition lost its execution fence");
    this.name = "DocumentCompilationCandidateLeaseLostError";
  }
}

export class DocumentCompilationCandidateEvaluationError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Document compilation candidate evaluation failed: ${reason}`, options);
    this.name = "DocumentCompilationCandidateEvaluationError";
  }
}

const receiptComponentFields = [
  ["indexProjections", ProjectionSetPublicationComponentTypes[0]],
  ["documentOutlines", ProjectionSetPublicationComponentTypes[1]],
  ["multimodalManifests", ProjectionSetPublicationComponentTypes[2]],
  ["knowledgePaths", ProjectionSetPublicationComponentTypes[3]],
  ["graphEntities", ProjectionSetPublicationComponentTypes[4]],
  ["graphRelations", ProjectionSetPublicationComponentTypes[5]],
] as const;
const receiptKeys = new Set<string>([
  "schemaVersion",
  ...receiptComponentFields.map(([field]) => field),
]);

/**
 * Composes the immutable member snapshot owned by one durable attempt. The candidate is bound to
 * the attempt before member writes, and the member repository performs inherit + complete owner
 * replacement as one transaction-local operation. A retry reuses only the exact same candidate.
 */
export function createDocumentCompilationPublicationCoordinator({
  deletionFence,
  logicalDocumentFences,
  maxComponents,
  members,
  publications,
  validator,
}: DocumentCompilationPublicationCoordinatorOptions): DocumentCompilationPublicationCoordinator {
  positiveInteger(maxComponents, "maxComponents");

  return {
    composeCandidate: async (input) => {
      assertExecutionFence(input.execution);
      const initialAttempt = validateAttempt(input.execution.attempt);
      const deletionToken = await captureCompilationDeletionFence(deletionFence, initialAttempt);
      const assertWritable = () => assertCompilationDeletionFence(deletionFence, deletionToken);
      const candidateId = normalizeUuid(input.candidateId);
      const createdAt = DateTimeSchema.parse(input.createdAt);
      const projectionVersion = positiveInteger(input.projectionVersion, "projectionVersion");
      const fingerprintMaterial = ProjectionSetFingerprintMaterialSchema.parse(
        input.fingerprintMaterial,
      );
      validateFingerprintMaterial(fingerprintMaterial, initialAttempt);
      const fingerprint = await buildProjectionSetFingerprint(fingerprintMaterial);
      const components = flattenComponentReceipt(
        input.componentReceipt,
        initialAttempt,
        maxComponents,
      );
      assertAttemptCandidateBinding(initialAttempt, candidateId, fingerprint);
      const metadata = candidateMetadata(initialAttempt, input.metadata);

      await assertWritable();
      await input.execution.heartbeat();
      assertExecutionFence(input.execution);
      await validator.validate({
        attempt: initialAttempt,
        components,
        fingerprintMaterial,
      });
      await assertWritable();
      assertExecutionFence(input.execution);
      await assertWritable();
      await input.execution.heartbeat();
      assertExecutionFence(input.execution);
      await assertWritable();
      const candidate = await ensureExclusiveCandidate(publications, {
        createdAt,
        fingerprint,
        id: candidateId,
        knowledgeSpaceId: initialAttempt.knowledgeSpaceId,
        metadata,
        projectionVersion,
        tenantId: initialAttempt.tenantId,
      });
      assertCandidateIdentity(candidate, {
        attempt: initialAttempt,
        candidateId,
        fingerprint,
        projectionVersion,
      });

      let attempt = validateAttempt(input.execution.attempt);
      assertSameAttemptScope(attempt, initialAttempt);
      if (!attempt.candidatePublicationId) {
        await assertWritable();
        attempt = await bindCandidate(input.execution, attempt, candidateId, fingerprint);
      } else {
        assertAttemptCandidateBinding(attempt, candidateId, fingerprint);
      }

      assertExecutionFence(input.execution);
      await assertWritable();
      attempt = validateAttempt(await input.execution.heartbeat());
      assertSameAttemptScope(attempt, initialAttempt);
      assertAttemptCandidateBinding(attempt, candidateId, fingerprint);
      assertExecutionFence(input.execution);
      let composition: Awaited<
        ReturnType<ProjectionSetPublicationMemberRepository["composeDocumentCandidate"]>
      >;
      try {
        composition = await input.execution.withLeaseSnapshot(async (leaseSnapshot) => {
          const fencedAttempt = validateAttempt(leaseSnapshot);
          assertSameAttemptScope(fencedAttempt, initialAttempt);
          assertAttemptCandidateBinding(fencedAttempt, candidateId, fingerprint);
          assertExecutionFence(input.execution);
          await assertWritable();
          return members.composeDocumentCandidate({
            attemptFence: compilationAttemptFence(fencedAttempt, candidateId, fingerprint),
            candidateFingerprint: fingerprint,
            components,
            createdAt,
            documentAssetId: initialAttempt.documentAssetId,
            expectedHeadRevision: initialAttempt.baseHeadRevision,
            knowledgeSpaceId: initialAttempt.knowledgeSpaceId,
            tenantId: initialAttempt.tenantId,
          });
        });
      } catch (error) {
        if (error instanceof ProjectionSetPublicationMemberAttemptFenceConflictError) {
          throw new DocumentCompilationCandidateLeaseLostError();
        }
        throw error;
      }
      if (composition.replaced !== components.length) {
        throw new DocumentCompilationCandidateComponentError(
          `Candidate member replacement count mismatch: expected=${components.length} actual=${composition.replaced}`,
        );
      }

      assertExecutionFence(input.execution);
      await assertWritable();
      await input.execution.heartbeat();
      attempt = validateAttempt(input.execution.attempt);
      assertSameAttemptScope(attempt, initialAttempt);
      assertAttemptCandidateBinding(attempt, candidateId, fingerprint);
      if (attempt.checkpoint === "nodes_generated") {
        await assertWritable();
        attempt = await input.execution.advance({
          candidateFingerprint: fingerprint,
          candidatePublicationId: candidateId,
          checkpoint: "projection_built",
        });
      }

      return {
        attempt,
        candidate,
        inheritedMemberCount: composition.inherited,
        replacedMemberCount: composition.replaced,
      };
    },
    evaluateAndPublishCandidate: async ({ evaluator, execution, updatedAt: rawUpdatedAt }) => {
      assertExecutionFence(execution);
      const updatedAt = DateTimeSchema.parse(rawUpdatedAt);
      const initialAttempt = validatePublicationAttempt(execution.attempt);
      const deletionToken = await captureCompilationDeletionFence(deletionFence, initialAttempt);
      const assertWritable = () => assertCompilationDeletionFence(deletionFence, deletionToken);
      const candidatePublicationId = requireBoundCandidateId(initialAttempt);
      const candidateFingerprint = requireBoundCandidateFingerprint(initialAttempt);
      const lookup = {
        fingerprint: candidateFingerprint,
        knowledgeSpaceId: initialAttempt.knowledgeSpaceId,
        tenantId: initialAttempt.tenantId,
      };
      const candidate = await publications.getByFingerprint(lookup);
      if (!candidate) {
        throw new DocumentCompilationCandidateIdentityConflictError(
          "Document compilation candidate publication was not found",
        );
      }
      assertCandidateIdentity(candidate, {
        allowedStatuses: ["candidate", "published"],
        attempt: initialAttempt,
        candidateId: candidatePublicationId,
        fingerprint: candidateFingerprint,
        projectionVersion: candidate.projectionVersion,
      });

      try {
        if (candidate.status === "published") {
          const published = await publications.getPublished(lookup);
          if (
            !published ||
            published.id !== candidatePublicationId ||
            published.fingerprint !== candidateFingerprint ||
            published.headRevision !== initialAttempt.baseHeadRevision + 1
          ) {
            throw new DocumentCompilationCandidateIdentityConflictError(
              "Published document compilation candidate is not the expected publication head",
            );
          }
          const attempt =
            initialAttempt.checkpoint === "projection_built"
              ? await (async () => {
                  await assertWritable();
                  return execution.advance({ checkpoint: "smoke_eval_passed" });
                })()
              : initialAttempt;
          return {
            attempt,
            evaluation: "previously-passed",
            publication: { headRevision: published.headRevision, published },
          };
        }
        if (candidate.status !== "candidate") {
          throw new DocumentCompilationCandidateIdentityConflictError(
            `Document compilation candidate cannot evaluate from status=${candidate.status}`,
          );
        }

        const candidateMembersForPublication = await members.listByFingerprint(lookup);
        if (candidateMembersForPublication.length === 0) {
          await assertWritable();
          await deactivateCandidate(publications, lookup, updatedAt);
          throw new DocumentCompilationCandidateEvaluationError(
            "candidate member snapshot is empty",
          );
        }

        let attempt = initialAttempt;
        let evaluation: "passed" | "previously-passed" = "previously-passed";
        if (attempt.checkpoint === "projection_built") {
          let result: DocumentCompilationCandidateEvaluationResult;
          try {
            result = await evaluator.evaluate(
              freezeEvaluationSnapshot({
                candidateFingerprint,
                candidatePublicationId,
                compilationAttemptId: attempt.id,
                documentAssetId: attempt.documentAssetId,
                documentVersion: attempt.documentVersion,
                ...(attempt.embeddingProfile ? { embeddingProfile: attempt.embeddingProfile } : {}),
                expectedHeadRevision: attempt.baseHeadRevision,
                knowledgeSpaceId: attempt.knowledgeSpaceId,
                members: candidateMembersForPublication,
                publicationGenerationId: attempt.publicationGenerationId,
                ...(attempt.retrievalProfile ? { retrievalProfile: attempt.retrievalProfile } : {}),
                tenantId: attempt.tenantId,
              }),
            );
          } catch (error) {
            await assertWritable();
            await deactivateCandidate(publications, lookup, updatedAt);
            throw new DocumentCompilationCandidateEvaluationError(
              error instanceof Error ? error.message : "candidate evaluator failed",
              { cause: error },
            );
          }
          if (result.decision === "failed") {
            await assertWritable();
            await deactivateCandidate(publications, lookup, updatedAt);
            throw new DocumentCompilationCandidateEvaluationError(
              requiredReason(result.reason, "candidate evaluation reason"),
            );
          }
          if (result.decision !== "passed") {
            await assertWritable();
            await deactivateCandidate(publications, lookup, updatedAt);
            throw new DocumentCompilationCandidateEvaluationError(
              "candidate evaluator returned an invalid decision",
            );
          }

          assertExecutionFence(execution);
          await assertWritable();
          attempt = validatePublicationAttempt(await execution.heartbeat());
          assertSameAttemptScope(attempt, initialAttempt);
          assertAttemptCandidateBinding(attempt, candidatePublicationId, candidateFingerprint);
          await assertWritable();
          attempt = validatePublicationAttempt(
            await execution.advance({ checkpoint: "smoke_eval_passed" }),
          );
          evaluation = "passed";
        }

        assertExecutionFence(execution);
        await assertWritable();
        let publication: PublishProjectionSetResult;
        try {
          publication = await execution.withLeaseSnapshot(async (leaseSnapshot) => {
            const fencedAttempt = validatePublicationAttempt(leaseSnapshot);
            assertSameAttemptScope(fencedAttempt, initialAttempt);
            assertAttemptCandidateBinding(
              fencedAttempt,
              candidatePublicationId,
              candidateFingerprint,
            );
            assertExecutionFence(execution);
            await assertWritable();
            const logicalDocumentFence = logicalDocumentFences
              ? await logicalDocumentFences.resolve({
                  attemptId: fencedAttempt.id,
                  documentAssetId: fencedAttempt.documentAssetId,
                  documentAssetVersion: fencedAttempt.documentVersion,
                  knowledgeSpaceId: fencedAttempt.knowledgeSpaceId,
                  tenantId: fencedAttempt.tenantId,
                })
              : null;
            return publications.publishDocumentCompilationCandidate({
              attemptFence: compilationPublicationFence(
                fencedAttempt,
                candidatePublicationId,
                candidateFingerprint,
              ),
              expectedHeadRevision: initialAttempt.baseHeadRevision,
              expectedMembers: candidateMembersForPublication,
              fingerprint: candidateFingerprint,
              knowledgeSpaceId: initialAttempt.knowledgeSpaceId,
              ...(logicalDocumentFence ? { logicalDocumentFence } : {}),
              tenantId: initialAttempt.tenantId,
              updatedAt,
            });
          });
        } catch (error) {
          if (error instanceof ProjectionSetPublicationAttemptFenceConflictError) {
            throw new DocumentCompilationCandidateLeaseLostError();
          }
          if (error instanceof ProjectionSetPublicationHeadConflictError) {
            await assertWritable();
            await deactivateCandidate(publications, lookup, updatedAt);
          }
          throw error;
        }

        return { attempt, evaluation, publication };
      } catch (error) {
        if (
          (error instanceof DeletionLifecycleFenceActiveError ||
            error instanceof ProjectionSetPublicationDeletionFenceConflictError) &&
          candidate.status === "candidate"
        ) {
          await deactivateCandidate(publications, lookup, updatedAt).catch(() => undefined);
        }
        throw error;
      }
    },
  };
}

async function ensureExclusiveCandidate(
  publications: Pick<ProjectionSetPublicationRepository, "createCandidate" | "getByFingerprint">,
  input: Parameters<ProjectionSetPublicationRepository["createCandidate"]>[0],
): Promise<ProjectionSetPublication> {
  const lookup = {
    fingerprint: input.fingerprint,
    knowledgeSpaceId: input.knowledgeSpaceId,
    tenantId: input.tenantId,
  };
  const existing = await publications.getByFingerprint(lookup);
  if (existing) {
    return existing;
  }

  try {
    return await publications.createCandidate(input);
  } catch (error) {
    if (!(error instanceof DuplicateProjectionSetPublicationError)) {
      throw error;
    }
    const concurrent = await publications.getByFingerprint(lookup);
    if (!concurrent) {
      throw error;
    }
    return concurrent;
  }
}

async function bindCandidate(
  execution: Pick<DocumentCompilationExecutionContext, "advance">,
  attempt: DocumentCompilationAttempt,
  candidatePublicationId: string,
  candidateFingerprint: string,
): Promise<DocumentCompilationAttempt> {
  const input: AdvanceDocumentCompilationExecutionInput = {
    candidateFingerprint,
    candidatePublicationId,
    checkpoint: attempt.checkpoint,
  };
  const bound = await execution.advance(input);
  assertAttemptCandidateBinding(bound, candidatePublicationId, candidateFingerprint);
  return bound;
}

function validateAttempt(attempt: DocumentCompilationAttempt): DocumentCompilationAttempt {
  if (attempt.runState !== "running") {
    throw new DocumentCompilationCandidateLeaseLostError();
  }
  if (attempt.checkpoint !== "nodes_generated" && attempt.checkpoint !== "projection_built") {
    throw new DocumentCompilationCandidateComponentError(
      `Document compilation candidate cannot compose from checkpoint=${attempt.checkpoint}`,
    );
  }
  TenantIdSchema.parse(attempt.tenantId);
  normalizeUuid(attempt.id);
  normalizeUuid(attempt.knowledgeSpaceId);
  normalizeUuid(attempt.documentAssetId);
  PublicationGenerationIdSchema.parse(attempt.publicationGenerationId);
  nonnegativeInteger(attempt.baseHeadRevision, "baseHeadRevision");
  positiveInteger(attempt.documentVersion, "documentVersion");
  return attempt;
}

function validatePublicationAttempt(
  attempt: DocumentCompilationAttempt,
): DocumentCompilationAttempt {
  if (attempt.runState !== "running") {
    throw new DocumentCompilationCandidateLeaseLostError();
  }
  if (attempt.checkpoint !== "projection_built" && attempt.checkpoint !== "smoke_eval_passed") {
    throw new DocumentCompilationCandidateComponentError(
      `Document compilation candidate cannot publish from checkpoint=${attempt.checkpoint}`,
    );
  }
  TenantIdSchema.parse(attempt.tenantId);
  normalizeUuid(attempt.id);
  normalizeUuid(attempt.knowledgeSpaceId);
  normalizeUuid(attempt.documentAssetId);
  PublicationGenerationIdSchema.parse(attempt.publicationGenerationId);
  nonnegativeInteger(attempt.baseHeadRevision, "baseHeadRevision");
  positiveInteger(attempt.documentVersion, "documentVersion");
  nonnegativeInteger(attempt.rowVersion, "rowVersion");
  return attempt;
}

function requireBoundCandidateId(attempt: DocumentCompilationAttempt): string {
  if (!attempt.candidatePublicationId) {
    throw new DocumentCompilationCandidateIdentityConflictError(
      "Document compilation attempt has no candidate publication id",
    );
  }
  return normalizeUuid(attempt.candidatePublicationId);
}

function requireBoundCandidateFingerprint(attempt: DocumentCompilationAttempt): string {
  if (!attempt.candidateFingerprint) {
    throw new DocumentCompilationCandidateIdentityConflictError(
      "Document compilation attempt has no candidate fingerprint",
    );
  }
  return attempt.candidateFingerprint;
}

function validateFingerprintMaterial(
  material: ProjectionSetFingerprintMaterial,
  attempt: DocumentCompilationAttempt,
): void {
  if (normalizeUuid(material.knowledgeSpaceId) !== normalizeUuid(attempt.knowledgeSpaceId)) {
    throw new DocumentCompilationCandidateIdentityConflictError(
      "Projection fingerprint material belongs to another knowledge space",
    );
  }
  const ownerSnapshots = material.sourceSnapshots.filter(
    (snapshot) =>
      normalizeUuid(snapshot.documentAssetId) === normalizeUuid(attempt.documentAssetId),
  );
  if (ownerSnapshots.length !== 1 || ownerSnapshots[0]?.version !== attempt.documentVersion) {
    throw new DocumentCompilationCandidateIdentityConflictError(
      "Projection fingerprint material must contain exactly the attempt owner document version",
    );
  }
}

function flattenComponentReceipt(
  receipt: DocumentCompilationCandidateComponentReceipt,
  attempt: DocumentCompilationAttempt,
  maxComponents: number,
): readonly ProjectionSetPublicationDocumentComponentInput[] {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new DocumentCompilationCandidateComponentError(
      "Candidate component receipt must be an object",
    );
  }
  const actualKeys = Object.keys(receipt);
  if (
    actualKeys.length !== receiptKeys.size ||
    actualKeys.some((key) => !receiptKeys.has(key)) ||
    receipt.schemaVersion !== 1
  ) {
    throw new DocumentCompilationCandidateComponentError(
      "Candidate component receipt must contain schemaVersion=1 and all six component arrays",
    );
  }

  const expectedGeneration = PublicationGenerationIdSchema.parse(attempt.publicationGenerationId);
  const identities = new Set<string>();
  const components: ProjectionSetPublicationDocumentComponentInput[] = [];

  for (const [field, componentType] of receiptComponentFields) {
    const references = receipt[field];
    if (!Array.isArray(references)) {
      throw new DocumentCompilationCandidateComponentError(
        `Candidate component receipt ${field} must be an array`,
      );
    }
    if (components.length + references.length > maxComponents) {
      throw new DocumentCompilationCandidateComponentError(
        `Candidate component receipt exceeds maxComponents=${maxComponents}`,
      );
    }

    for (const reference of references) {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        throw new DocumentCompilationCandidateComponentError(
          `Candidate component receipt ${field} contains an invalid reference`,
        );
      }
      const referenceKeys = Object.keys(reference);
      if (
        referenceKeys.length !== 2 ||
        !referenceKeys.includes("componentKey") ||
        !referenceKeys.includes("generationId")
      ) {
        throw new DocumentCompilationCandidateComponentError(
          `Candidate component receipt ${field} reference must contain only componentKey and generationId`,
        );
      }
      const componentKey = normalizeUuid(reference.componentKey);
      const generationId = PublicationGenerationIdSchema.parse(reference.generationId);
      if (generationId !== expectedGeneration) {
        throw new DocumentCompilationCandidateComponentError(
          `Candidate component=${componentKey} generation does not match its attempt`,
        );
      }
      const identity = `${componentType}:${componentKey}`;
      if (identities.has(identity)) {
        throw new DocumentCompilationCandidateComponentError(
          `Candidate component identity is duplicated: ${identity}`,
        );
      }
      identities.add(identity);
      components.push({ componentKey, componentType, generationId });
    }
  }

  return components;
}

function candidateMetadata(
  attempt: DocumentCompilationAttempt,
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    [DocumentCompilationCandidateMetadataKey]: {
      attemptId: normalizeUuid(attempt.id),
      baseHeadRevision: attempt.baseHeadRevision,
      ownerDocumentAssetId: normalizeUuid(attempt.documentAssetId),
      ownerDocumentVersion: attempt.documentVersion,
      publicationGenerationId: PublicationGenerationIdSchema.parse(attempt.publicationGenerationId),
      ...(attempt.embeddingProfile ? { embeddingProfile: attempt.embeddingProfile } : {}),
      ...(attempt.retrievalProfile ? { retrievalProfile: attempt.retrievalProfile } : {}),
      schemaVersion: 1,
    },
  };
}

function compilationAttemptFence(
  attempt: DocumentCompilationAttempt,
  candidatePublicationId: string,
  candidateFingerprint: string,
) {
  assertAttemptCandidateBinding(attempt, candidatePublicationId, candidateFingerprint);
  if (!attempt.leaseToken) {
    throw new DocumentCompilationCandidateLeaseLostError();
  }
  return {
    attemptId: normalizeUuid(attempt.id),
    candidatePublicationId,
    documentVersion: positiveInteger(attempt.documentVersion, "documentVersion"),
    expectedRowVersion: nonnegativeInteger(attempt.rowVersion, "rowVersion"),
    leaseToken: normalizeUuid(attempt.leaseToken),
    publicationGenerationId: PublicationGenerationIdSchema.parse(attempt.publicationGenerationId),
  };
}

function compilationPublicationFence(
  attempt: DocumentCompilationAttempt,
  candidatePublicationId: string,
  candidateFingerprint: string,
) {
  const fence = compilationAttemptFence(attempt, candidatePublicationId, candidateFingerprint);
  return {
    ...fence,
    documentAssetId: normalizeUuid(attempt.documentAssetId),
  };
}

function freezeEvaluationSnapshot(
  snapshot: DocumentCompilationCandidateEvaluationSnapshot,
): DocumentCompilationCandidateEvaluationSnapshot {
  const members = snapshot.members.map((member) => Object.freeze({ ...member }));
  return Object.freeze({
    ...snapshot,
    ...(snapshot.embeddingProfile
      ? { embeddingProfile: Object.freeze({ ...snapshot.embeddingProfile }) }
      : {}),
    members: Object.freeze(members),
    ...(snapshot.retrievalProfile
      ? { retrievalProfile: Object.freeze({ ...snapshot.retrievalProfile }) }
      : {}),
  });
}

async function deactivateCandidate(
  publications: Pick<ProjectionSetPublicationRepository, "deactivate">,
  lookup: {
    readonly fingerprint: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  },
  updatedAt: string,
): Promise<void> {
  await publications.deactivate({ ...lookup, updatedAt });
}

function requiredReason(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new DocumentCompilationCandidateEvaluationError(`${label} must not be empty`);
  }
  return normalized;
}

function assertCandidateIdentity(
  candidate: ProjectionSetPublication,
  expected: {
    readonly allowedStatuses?: readonly ProjectionSetPublication["status"][] | undefined;
    readonly attempt: DocumentCompilationAttempt;
    readonly candidateId: string;
    readonly fingerprint: string;
    readonly projectionVersion: number;
  },
): void {
  const identity = candidate.metadata[DocumentCompilationCandidateMetadataKey];
  const expectedIdentity = candidateMetadata(expected.attempt, {})[
    DocumentCompilationCandidateMetadataKey
  ];
  if (
    normalizeUuid(candidate.id) !== expected.candidateId ||
    candidate.fingerprint !== expected.fingerprint ||
    normalizeUuid(candidate.knowledgeSpaceId) !==
      normalizeUuid(expected.attempt.knowledgeSpaceId) ||
    candidate.tenantId !== expected.attempt.tenantId ||
    candidate.projectionVersion !== expected.projectionVersion ||
    !(expected.allowedStatuses ?? ["candidate"]).includes(candidate.status) ||
    stableJson(identity) !== stableJson(expectedIdentity)
  ) {
    throw new DocumentCompilationCandidateIdentityConflictError(
      "Projection candidate is not exclusively owned by this compilation attempt",
    );
  }
}

function assertAttemptCandidateBinding(
  attempt: Pick<DocumentCompilationAttempt, "candidateFingerprint" | "candidatePublicationId">,
  candidatePublicationId: string,
  candidateFingerprint: string,
): void {
  const hasId = attempt.candidatePublicationId !== undefined;
  const hasFingerprint = attempt.candidateFingerprint !== undefined;
  if (hasId !== hasFingerprint) {
    throw new DocumentCompilationCandidateIdentityConflictError(
      "Document compilation attempt has a partial candidate binding",
    );
  }
  if (
    (attempt.candidatePublicationId &&
      normalizeUuid(attempt.candidatePublicationId) !== candidatePublicationId) ||
    (attempt.candidateFingerprint && attempt.candidateFingerprint !== candidateFingerprint)
  ) {
    throw new DocumentCompilationCandidateIdentityConflictError(
      "Document compilation attempt is already bound to another candidate",
    );
  }
}

function assertSameAttemptScope(
  current: DocumentCompilationAttempt,
  initial: DocumentCompilationAttempt,
): void {
  if (
    normalizeUuid(current.id) !== normalizeUuid(initial.id) ||
    normalizeUuid(current.knowledgeSpaceId) !== normalizeUuid(initial.knowledgeSpaceId) ||
    normalizeUuid(current.documentAssetId) !== normalizeUuid(initial.documentAssetId) ||
    current.documentVersion !== initial.documentVersion ||
    current.tenantId !== initial.tenantId ||
    current.baseHeadRevision !== initial.baseHeadRevision ||
    current.publicationGenerationId !== initial.publicationGenerationId ||
    stableJson(current.embeddingProfile ?? null) !== stableJson(initial.embeddingProfile ?? null) ||
    stableJson(current.retrievalProfile ?? null) !== stableJson(initial.retrievalProfile ?? null)
  ) {
    throw new DocumentCompilationCandidateIdentityConflictError(
      "Document compilation execution scope changed during candidate composition",
    );
  }
}

function assertExecutionFence(
  execution: Pick<DocumentCompilationExecutionContext, "signal">,
): void {
  if (execution.signal.aborted) {
    throw new DocumentCompilationCandidateLeaseLostError();
  }
}

async function captureCompilationDeletionFence(
  guard: DeletionLifecycleFenceGuard | undefined,
  attempt: DocumentCompilationAttempt,
): Promise<DeletionLifecycleFenceToken | undefined> {
  return guard?.captureDeletionFence({
    documentAssetId: attempt.documentAssetId,
    knowledgeSpaceId: attempt.knowledgeSpaceId,
    tenantId: attempt.tenantId,
  });
}

async function assertCompilationDeletionFence(
  guard: DeletionLifecycleFenceGuard | undefined,
  token: DeletionLifecycleFenceToken | undefined,
): Promise<void> {
  if (token) {
    await guard?.assertDeletionFenceUnchanged(token);
  }
}

function normalizeUuid(value: string): string {
  return UuidSchema.parse(value).toLowerCase();
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Document compilation candidate ${field} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Document compilation candidate ${field} must be a non-negative integer`);
  }
  return value;
}
