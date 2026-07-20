import {
  type IndexProjection,
  type ProjectionSetFingerprintMaterial,
  ProjectionSetFingerprintMaterialSchema,
  PublicationGenerationIdSchema,
  UuidSchema,
  stableJson,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { attemptToCompilationJob } from "./document-compilation-attempt-job";
import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import type { DocumentCompilationInitialProfileCoordinator } from "./document-compilation-initial-profile-coordinator";
import type {
  DocumentCompilationJobStage,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import { loadDocumentCompilationFrozenProfiles } from "./document-compilation-profile-snapshot";
import type {
  DocumentCompilationCandidateComponentReceipt,
  DocumentCompilationCandidateEvaluator,
  DocumentCompilationPublicationCoordinator,
} from "./document-compilation-publication-coordinator";
import type {
  DocumentCompilationAttemptProcessor,
  DocumentCompilationExecutionContext,
} from "./document-compilation-runtime";
import type {
  DocumentCompilationIndexOverrideResolver,
  DocumentCompilationWorker,
  DocumentCompilationWorkerCandidateComposer,
} from "./document-compilation-worker";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { IndexProjectionRepository } from "./index-projection-repository";
import { isPlainObject } from "./json-utils";
import type { KnowledgeSpaceProfileRepository } from "./knowledge-space-profile-repository";
import type { PublishedPageIndexBuildRepository } from "./page-index-build-repository";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import type {
  ProjectionSetPublicationMember,
  ProjectionSetPublicationMemberRepository,
} from "./projection-publication-member-repository";
import type { ProjectionSetPublicationRepository } from "./projection-publication-repository";

export interface DocumentCompilationFingerprintVersions {
  readonly chunkerVersion: string;
  readonly indexVersion: string;
  readonly nodeSchemaVersion: number;
  readonly parserPolicyVersion: string;
  readonly projectionSetVersion: string;
}

export interface ResolveDocumentCompilationFingerprintMaterialInput {
  readonly attempt: DocumentCompilationAttempt;
  readonly componentReceipt: DocumentCompilationCandidateComponentReceipt;
}

export interface ResolvedDocumentCompilationFingerprintMaterial {
  readonly material: ProjectionSetFingerprintMaterial;
  readonly projectionVersion: number;
}

export interface DocumentCompilationFingerprintMaterialResolver {
  resolve(
    input: ResolveDocumentCompilationFingerprintMaterialInput,
  ): Promise<ResolvedDocumentCompilationFingerprintMaterial>;
}

export interface RepositoryDocumentCompilationFingerprintMaterialResolverOptions {
  readonly artifacts: Pick<ParseArtifactRepository, "getByDocumentVersion">;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly maxComponents: number;
  readonly maxProjectionBatchSize: number;
  readonly members: Pick<ProjectionSetPublicationMemberRepository, "listByFingerprint">;
  readonly outlines: Pick<DocumentOutlineRepository, "getById">;
  readonly projections: Required<Pick<IndexProjectionRepository, "getMany">>;
  readonly publications: Pick<ProjectionSetPublicationRepository, "getPublished">;
  readonly versions: DocumentCompilationFingerprintVersions;
}

export class DocumentCompilationCandidateSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentCompilationCandidateSnapshotError";
  }
}

/**
 * Derives the fingerprint from the exact candidate snapshot, not merely the document currently
 * being rebuilt. The current published members are frozen at the attempt's base head revision,
 * the owner document is completely replaced by the worker receipt, and every source/projection
 * fact is re-read from its immutable generation-scoped repository row.
 */
export function createRepositoryDocumentCompilationFingerprintMaterialResolver({
  artifacts,
  assets,
  maxComponents,
  maxProjectionBatchSize,
  members,
  outlines,
  projections,
  publications,
  versions,
}: RepositoryDocumentCompilationFingerprintMaterialResolverOptions): DocumentCompilationFingerprintMaterialResolver {
  positiveInteger(maxComponents, "maxComponents");
  positiveInteger(maxProjectionBatchSize, "maxProjectionBatchSize");
  validateFingerprintVersions(versions);

  return {
    resolve: async ({ attempt, componentReceipt }) => {
      const generationId = PublicationGenerationIdSchema.parse(attempt.publicationGenerationId);
      const ownerDocumentAssetId = UuidSchema.parse(attempt.documentAssetId);
      const current = await publications.getPublished({
        knowledgeSpaceId: attempt.knowledgeSpaceId,
        tenantId: attempt.tenantId,
      });
      if ((current?.headRevision ?? 0) !== attempt.baseHeadRevision) {
        throw snapshotError(
          `publication head changed: expected=${attempt.baseHeadRevision} actual=${current?.headRevision ?? 0}`,
        );
      }

      const inherited = current
        ? await members.listByFingerprint({
            fingerprint: current.fingerprint,
            knowledgeSpaceId: attempt.knowledgeSpaceId,
            tenantId: attempt.tenantId,
          })
        : [];
      const replacements = flattenReceipt(componentReceipt, {
        documentAssetId: ownerDocumentAssetId,
        generationId,
        knowledgeSpaceId: attempt.knowledgeSpaceId,
        tenantId: attempt.tenantId,
      });
      const effectiveMembers = normalizeEffectiveMembers(
        [
          ...inherited.filter((member) => member.documentAssetId !== ownerDocumentAssetId),
          ...replacements,
        ],
        maxComponents,
        attempt,
      );

      const outlineMembers = effectiveMembers.filter(
        (member) => member.componentType === "document-outline",
      );
      const outlinesByDocument = groupMembersByDocument(outlineMembers);
      const documentIds = uniqueDocumentIds(effectiveMembers);
      const sourceSnapshots: ProjectionSetFingerprintMaterial["sourceSnapshots"] = [];
      for (const documentAssetId of documentIds) {
        const ownedOutlines = outlinesByDocument.get(documentAssetId) ?? [];
        if (ownedOutlines.length !== 1 || !ownedOutlines[0]) {
          throw snapshotError(
            `document ${documentAssetId} must have exactly one outline in the candidate`,
          );
        }
        const outlineMember = ownedOutlines[0];
        const outline = await outlines.getById({ id: outlineMember.componentKey });
        if (
          !outline ||
          outline.id !== outlineMember.componentKey ||
          outline.documentAssetId !== documentAssetId ||
          outline.knowledgeSpaceId !== attempt.knowledgeSpaceId ||
          outline.publicationGenerationId !== outlineMember.generationId
        ) {
          throw snapshotError(`document ${documentAssetId} outline escaped the candidate snapshot`);
        }
        const [asset, artifact] = await Promise.all([
          assets.get({ id: documentAssetId, knowledgeSpaceId: attempt.knowledgeSpaceId }),
          artifacts.getByDocumentVersion({
            documentAssetId,
            version: outline.version,
          }),
        ]);
        if (!asset || asset.id !== documentAssetId || asset.version !== outline.version) {
          throw snapshotError(`document ${documentAssetId} asset version is unavailable`);
        }
        if (
          !artifact ||
          artifact.documentAssetId !== documentAssetId ||
          artifact.version !== outline.version ||
          artifact.artifactHash !== outline.artifactHash
        ) {
          throw snapshotError(`document ${documentAssetId} parse artifact lineage is unavailable`);
        }
        sourceSnapshots.push({
          artifactHash: artifact.artifactHash,
          documentAssetId,
          sha256: asset.sha256,
          version: outline.version,
        });
      }

      const projectionMembers = effectiveMembers.filter(
        (member) => member.componentType === "index-projection",
      );
      const loadedProjections = await loadProjections(
        projections,
        projectionMembers.map((member) => member.componentKey),
        attempt.knowledgeSpaceId,
        maxProjectionBatchSize,
      );
      const projectionsById = new Map(
        loadedProjections.map((projection) => [projection.id, projection]),
      );
      const projectionConfigs = new Map<
        string,
        ProjectionSetFingerprintMaterial["projections"][number]
      >();
      for (const member of projectionMembers) {
        const projection = projectionsById.get(member.componentKey);
        if (
          !projection ||
          projection.knowledgeSpaceId !== attempt.knowledgeSpaceId ||
          projection.publicationGenerationId !== member.generationId ||
          (projection.status !== "building" && projection.status !== "ready") ||
          projectionDocumentAssetId(projection) !== member.documentAssetId
        ) {
          throw snapshotError(
            `projection ${member.componentKey} escaped its candidate generation or owner`,
          );
        }
        const config = projectionFingerprintConfig(projection);
        projectionConfigs.set(stableJson(config), config);
      }
      if (projectionConfigs.size === 0) {
        throw snapshotError("candidate contains no index projections");
      }

      const material = ProjectionSetFingerprintMaterialSchema.parse({
        ...versions,
        knowledgeSpaceId: attempt.knowledgeSpaceId,
        projections: [...projectionConfigs.values()],
        sourceSnapshots,
      });
      return {
        material,
        projectionVersion: Math.max(
          ...material.projections.map((projection) => projection.projectionVersion),
        ),
      };
    },
  };
}

export interface RepositoryDocumentCompilationCandidateEvaluatorOptions {
  readonly indexOverrides?: DocumentCompilationIndexOverrideResolver | undefined;
  readonly maxProjectionBatchSize: number;
  readonly outlines: Pick<DocumentOutlineRepository, "getById">;
  readonly pageIndexBuild: Pick<PublishedPageIndexBuildRepository, "hasCompleteBuild">;
  readonly profiles: Pick<KnowledgeSpaceProfileRepository, "getRevision">;
  readonly projections: Required<Pick<IndexProjectionRepository, "getMany">>;
}

/**
 * Candidate-only structural smoke gate. It consumes solely the coordinator's immutable member
 * snapshot, verifies that every document has PageIndex + FTS (and the selected dense vector space
 * when configured). Projection promotion remains part of the publication/head-CAS database
 * transaction; this evaluator is deliberately read-only. It never accepts a knowledge-space id as
 * a retrieval fallback and therefore cannot query the published corpus.
 */
export function createRepositoryDocumentCompilationCandidateEvaluator({
  indexOverrides,
  maxProjectionBatchSize,
  outlines,
  pageIndexBuild,
  profiles,
  projections,
}: RepositoryDocumentCompilationCandidateEvaluatorOptions): DocumentCompilationCandidateEvaluator {
  positiveInteger(maxProjectionBatchSize, "maxProjectionBatchSize");

  return {
    evaluate: async (snapshot) => {
      try {
        const members = normalizeEvaluationMembers(snapshot.members, snapshot);
        const documentIds = uniqueDocumentIds(members);
        const outlineMembers = members.filter(
          (member) => member.componentType === "document-outline",
        );
        const projectionMembers = members.filter(
          (member) => member.componentType === "index-projection",
        );
        const outlinesByDocument = groupMembersByDocument(outlineMembers);
        const projectionsByDocument = groupMembersByDocument(projectionMembers);
        if (documentIds.length === 0 || projectionMembers.length === 0) {
          return { decision: "failed", reason: "candidate has no document projections" };
        }

        for (const documentAssetId of documentIds) {
          const documentOverrides =
            indexOverrides && snapshot.compilationAttemptId
              ? await indexOverrides.resolve({
                  compilationAttemptId: snapshot.compilationAttemptId,
                  documentAssetId,
                  knowledgeSpaceId: snapshot.knowledgeSpaceId,
                  tenantId: snapshot.tenantId,
                })
              : {};
          const owned = outlinesByDocument.get(documentAssetId) ?? [];
          if (owned.length !== 1 || !owned[0]) {
            return {
              decision: "failed",
              reason: `candidate document ${documentAssetId} has no exact PageIndex outline`,
            };
          }
          const outline = await outlines.getById({ id: owned[0].componentKey });
          if (
            !outline ||
            outline.documentAssetId !== documentAssetId ||
            outline.publicationGenerationId !== owned[0].generationId
          ) {
            return {
              decision: "failed",
              reason: `candidate document ${documentAssetId} PageIndex lineage is invalid`,
            };
          }
          if (
            documentOverrides.enablePageIndex !== false &&
            !(await pageIndexBuild.hasCompleteBuild({ outline, tenantId: snapshot.tenantId }))
          ) {
            return {
              decision: "failed",
              reason: `candidate document ${documentAssetId} flattened PageIndex is incomplete`,
            };
          }
        }

        const loaded = await loadProjections(
          projections,
          projectionMembers.map((member) => member.componentKey),
          snapshot.knowledgeSpaceId,
          maxProjectionBatchSize,
        );
        const byId = new Map(loaded.map((projection) => [projection.id, projection]));
        const { embeddingProfile } = await loadDocumentCompilationFrozenProfiles(
          profiles,
          snapshot,
        );

        for (const documentAssetId of documentIds) {
          const ownedMembers = projectionsByDocument.get(documentAssetId) ?? [];
          const owned: IndexProjection[] = [];
          for (const member of ownedMembers) {
            const projection = byId.get(member.componentKey);
            if (
              !projection ||
              projection.publicationGenerationId !== member.generationId ||
              projectionDocumentAssetId(projection) !== documentAssetId ||
              (projection.status !== "building" && projection.status !== "ready")
            ) {
              return {
                decision: "failed",
                reason: `candidate projection ${member.componentKey} lineage is invalid`,
              };
            }
            owned.push(projection);
          }
          if (!owned.some((projection) => projection.type === "fts")) {
            return {
              decision: "failed",
              reason: `candidate document ${documentAssetId} has no FTS projection`,
            };
          }
          if (
            embeddingProfile &&
            !owned.some(
              (projection) =>
                projection.type === "dense-vector" &&
                !isVisualProjection(projection) &&
                projection.model === embeddingProfile.vectorSpaceId,
            )
          ) {
            return {
              decision: "failed",
              reason: `candidate document ${documentAssetId} has no selected dense vector space`,
            };
          }
        }

        return { decision: "passed" };
      } catch (error) {
        return {
          decision: "failed",
          reason: error instanceof Error ? error.message : "candidate-only evaluation failed",
        };
      }
    },
  };
}

export interface DocumentCompilationWorkerAttemptProcessorOptions {
  readonly coordinator: Pick<DocumentCompilationPublicationCoordinator, "composeCandidate">;
  readonly createWorker: (input: {
    readonly candidateComposer: DocumentCompilationWorkerCandidateComposer;
    readonly frozenEmbeddingProfile?:
      | Awaited<ReturnType<typeof loadDocumentCompilationFrozenProfiles>>["embeddingProfile"]
      | undefined;
    readonly frozenRetrievalProfile?:
      | Awaited<ReturnType<typeof loadDocumentCompilationFrozenProfiles>>["retrievalProfile"]
      | undefined;
    readonly jobs: DocumentCompilationJobStateMachine;
  }) => DocumentCompilationWorker | Promise<DocumentCompilationWorker>;
  readonly fingerprintMaterial: DocumentCompilationFingerprintMaterialResolver;
  readonly initialProfiles?: DocumentCompilationInitialProfileCoordinator | undefined;
  readonly now?: (() => string) | undefined;
  /** Production runtime dependency. When present, missing/mismatched attempt refs fail closed. */
  readonly profiles?: Pick<KnowledgeSpaceProfileRepository, "getRevision"> | undefined;
}

/** Binds the legacy worker's checkpoint callbacks to one leased durable execution. */
export function createDocumentCompilationWorkerAttemptProcessor({
  coordinator,
  createWorker,
  fingerprintMaterial,
  initialProfiles,
  now = () => new Date().toISOString(),
  profiles,
}: DocumentCompilationWorkerAttemptProcessorOptions): DocumentCompilationAttemptProcessor {
  return async (execution) => {
    // No parser, embedding provider, index writer, or publication code may run until this durable
    // attempt has frozen a verified profile tuple. Existing spaces are a constant-time no-op.
    await initialProfiles?.ensureReady(execution);
    const jobs = executionBoundCompilationJobs(execution);
    const candidateComposer: DocumentCompilationWorkerCandidateComposer = {
      compose: async (input) => {
        assertWorkerScope(execution.attempt, input);
        const resolved = await fingerprintMaterial.resolve({
          attempt: execution.attempt,
          componentReceipt: input.componentReceipt,
        });
        await coordinator.composeCandidate({
          candidateId:
            execution.attempt.candidatePublicationId ??
            deterministicChildId(execution.attempt.id, "projection-publication-candidate"),
          componentReceipt: input.componentReceipt,
          createdAt: now(),
          execution,
          fingerprintMaterial: resolved.material,
          metadata: { projectionSetFingerprintMaterial: resolved.material },
          projectionVersion: resolved.projectionVersion,
        });
      },
    };
    const frozenProfiles = profiles
      ? await loadDocumentCompilationFrozenProfiles(profiles, execution.attempt)
      : undefined;
    const worker = await createWorker({
      candidateComposer,
      ...(frozenProfiles
        ? {
            frozenEmbeddingProfile: frozenProfiles.embeddingProfile,
            frozenRetrievalProfile: frozenProfiles.retrievalProfile,
          }
        : {}),
      jobs,
    });
    await worker.process({
      documentAssetId: execution.attempt.documentAssetId,
      documentCompilationJobId: execution.attempt.id,
      knowledgeSpaceId: execution.attempt.knowledgeSpaceId,
      publicationGenerationId: execution.attempt.publicationGenerationId,
      tenantId: execution.attempt.tenantId,
      version: execution.attempt.documentVersion,
    });
    if (execution.attempt.checkpoint !== "projection_built") {
      throw snapshotError(
        `worker stopped at checkpoint=${execution.attempt.checkpoint} before candidate composition`,
      );
    }
  };
}

function executionBoundCompilationJobs(
  execution: DocumentCompilationExecutionContext,
): DocumentCompilationJobStateMachine {
  return {
    advance: async (id, stage) => {
      if (id !== execution.attempt.id) {
        throw snapshotError("worker attempted to advance another compilation attempt");
      }
      const checkpoint = stageCheckpoint(stage);
      if (checkpointOrder(execution.attempt.checkpoint) < checkpointOrder(checkpoint)) {
        await execution.advance({ checkpoint });
      }
      return attemptToCompilationJob(execution.attempt);
    },
    cancel: async () => unsupportedWorkerControl("cancel"),
    fail: async () => unsupportedWorkerControl("fail"),
    get: async (id) =>
      id === execution.attempt.id ? attemptToCompilationJob(execution.attempt) : null,
    getMany: async (ids) =>
      ids.includes(execution.attempt.id) ? [attemptToCompilationJob(execution.attempt)] : [],
    retry: async () => unsupportedWorkerControl("retry"),
    start: async () => unsupportedWorkerControl("start"),
  };
}

function unsupportedWorkerControl(operation: string): never {
  throw new Error(`Leased document compilation worker cannot ${operation} attempts`);
}

const checkpoints = [
  "queued",
  "parsed",
  "outline_built",
  "nodes_generated",
  "projection_built",
  "smoke_eval_passed",
  "published",
] as const;

function stageCheckpoint(stage: DocumentCompilationJobStage): (typeof checkpoints)[number] {
  if (stage === "failed" || stage === "canceled") {
    throw new Error(`Leased document compilation worker cannot advance to ${stage}`);
  }
  return stage;
}

function checkpointOrder(checkpoint: (typeof checkpoints)[number]): number {
  return checkpoints.indexOf(checkpoint);
}

function flattenReceipt(
  receipt: DocumentCompilationCandidateComponentReceipt,
  scope: {
    readonly documentAssetId: string;
    readonly generationId: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  },
): ProjectionSetPublicationMember[] {
  const fields = [
    ["indexProjections", "index-projection"],
    ["documentOutlines", "document-outline"],
    ["multimodalManifests", "multimodal-manifest"],
    ["knowledgePaths", "knowledge-path"],
    ["graphEntities", "graph-entity"],
    ["graphRelations", "graph-relation"],
  ] as const;
  return fields.flatMap(([field, componentType]) =>
    receipt[field].map((component) => ({
      componentKey: UuidSchema.parse(component.componentKey),
      componentType,
      createdAt: "1970-01-01T00:00:00.000Z",
      documentAssetId: scope.documentAssetId,
      generationId: PublicationGenerationIdSchema.parse(component.generationId),
      knowledgeSpaceId: scope.knowledgeSpaceId,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18fffff",
      tenantId: scope.tenantId,
    })),
  );
}

function normalizeEffectiveMembers(
  members: readonly ProjectionSetPublicationMember[],
  maxComponents: number,
  attempt: DocumentCompilationAttempt,
): readonly ProjectionSetPublicationMember[] {
  if (members.length === 0 || members.length > maxComponents) {
    throw snapshotError(`candidate component count must be between 1 and ${maxComponents}`);
  }
  const identities = new Set<string>();
  return members.map((member) => {
    if (
      member.tenantId !== attempt.tenantId ||
      member.knowledgeSpaceId !== attempt.knowledgeSpaceId ||
      !member.documentAssetId
    ) {
      throw snapshotError("candidate member escaped the attempt tenant, space, or document owner");
    }
    const identity = `${member.componentType}:${member.componentKey}`;
    if (identities.has(identity)) {
      throw snapshotError(`candidate component identity is duplicated: ${identity}`);
    }
    identities.add(identity);
    return member;
  });
}

function normalizeEvaluationMembers(
  members: readonly ProjectionSetPublicationMember[],
  snapshot: {
    readonly candidatePublicationId: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  },
): readonly ProjectionSetPublicationMember[] {
  return members.map((member) => {
    if (
      member.publicationId !== snapshot.candidatePublicationId ||
      member.knowledgeSpaceId !== snapshot.knowledgeSpaceId ||
      member.tenantId !== snapshot.tenantId ||
      !member.documentAssetId
    ) {
      throw snapshotError("evaluation member escaped the immutable candidate snapshot");
    }
    return member;
  });
}

async function loadProjections(
  projections: Required<Pick<IndexProjectionRepository, "getMany">>,
  ids: readonly string[],
  knowledgeSpaceId: string,
  batchSize: number,
): Promise<readonly IndexProjection[]> {
  const uniqueIds = [...new Set(ids)];
  const loaded: IndexProjection[] = [];
  for (const batch of chunks(uniqueIds, batchSize)) {
    loaded.push(...(await projections.getMany({ ids: batch, knowledgeSpaceId })));
  }
  if (
    loaded.length !== uniqueIds.length ||
    new Set(loaded.map((item) => item.id)).size !== uniqueIds.length
  ) {
    throw snapshotError("candidate projection receipt is incomplete or duplicated");
  }
  return loaded;
}

function projectionFingerprintConfig(
  projection: IndexProjection,
): ProjectionSetFingerprintMaterial["projections"][number] {
  const visual = isVisualProjection(projection);
  const strategy =
    projection.type === "fts"
      ? "mixed-cjk-latin-fts-v1"
      : visual
        ? "visual-dense-v1"
        : projection.type === "dense-vector"
          ? "text-dense-v1"
          : `${projection.type}-v1`;
  return {
    indexVersion:
      projection.type === "fts"
        ? "database-fts-v1"
        : visual
          ? "visual-embedding-v1"
          : projection.type === "dense-vector"
            ? "plugin-daemon-embedding-v1"
            : "index-projection-v1",
    ...(projection.model ? { model: projection.model } : {}),
    projectionVersion: projection.projectionVersion,
    strategy,
    type: projection.type,
  };
}

function projectionDocumentAssetId(projection: IndexProjection): string | undefined {
  const value = projection.metadata.documentAssetId;
  return typeof value === "string" ? value : undefined;
}

function isVisualProjection(projection: IndexProjection): boolean {
  const multimodal = isPlainObject(projection.metadata.multimodal)
    ? projection.metadata.multimodal
    : undefined;
  return multimodal?.vectorSpace === "visual";
}

function uniqueDocumentIds(members: readonly ProjectionSetPublicationMember[]): readonly string[] {
  return [...new Set(members.map((member) => member.documentAssetId).filter(isString))].sort();
}

function groupMembersByDocument(
  members: readonly ProjectionSetPublicationMember[],
): ReadonlyMap<string, readonly ProjectionSetPublicationMember[]> {
  const grouped = new Map<string, ProjectionSetPublicationMember[]>();
  for (const member of members) {
    if (!member.documentAssetId) {
      continue;
    }
    const existing = grouped.get(member.documentAssetId);
    if (existing) {
      existing.push(member);
    } else {
      grouped.set(member.documentAssetId, [member]);
    }
  }
  return grouped;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function assertWorkerScope(
  attempt: DocumentCompilationAttempt,
  input: {
    readonly documentAssetId: string;
    readonly documentVersion: number;
    readonly knowledgeSpaceId: string;
    readonly publicationGenerationId: string;
    readonly tenantId: string;
  },
): void {
  if (
    input.documentAssetId !== attempt.documentAssetId ||
    input.documentVersion !== attempt.documentVersion ||
    input.knowledgeSpaceId !== attempt.knowledgeSpaceId ||
    input.publicationGenerationId !== attempt.publicationGenerationId ||
    input.tenantId !== attempt.tenantId
  ) {
    throw snapshotError("worker candidate receipt escaped its leased attempt scope");
  }
}

function validateFingerprintVersions(versions: DocumentCompilationFingerprintVersions): void {
  ProjectionSetFingerprintMaterialSchema.pick({
    chunkerVersion: true,
    indexVersion: true,
    nodeSchemaVersion: true,
    parserPolicyVersion: true,
    projectionSetVersion: true,
  }).parse(versions);
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Document compilation candidate runtime ${field} must be a positive integer`);
  }
}

function snapshotError(message: string): DocumentCompilationCandidateSnapshotError {
  return new DocumentCompilationCandidateSnapshotError(message);
}
