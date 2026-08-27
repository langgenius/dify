import { createHash } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  DateTimeSchema,
  type DocumentOutline,
  type IndexProjection,
  type KnowledgePath,
  type KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileSchema,
  ProjectionSetFingerprintSchema,
  PublicationGenerationIdSchema,
  TenantIdSchema,
  UuidSchema,
  stableJson,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import type { DocumentAssetRepository } from "./document-asset-repository";
import {
  buildDocumentOutlineKnowledgePath,
  buildDocumentSectionKnowledgePaths,
} from "./document-knowledge-paths";
import type { DocumentOutlineBuilder } from "./document-outline-builder";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { DocumentOutlineSummaryEnhancer } from "./document-outline-summary-enhancer";
import type { JointSemanticGraphMaterializer } from "./document-semantic-enrichment-processor";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { IncrementalReindexer } from "./index-reindexer";
import { isPlainObject } from "./json-utils";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import type {
  KnowledgeSpaceProfileMigrationProfileReference,
  KnowledgeSpaceProfileMigrationPublicationReference,
  KnowledgeSpaceProfileMigrationRebuildScope,
  KnowledgeSpaceProfileMigrationRun,
} from "./knowledge-space-profile-migration";
import type {
  KnowledgeSpaceProfileMigrationCandidateBuildInput,
  KnowledgeSpaceProfileMigrationCandidateBuildResult,
  KnowledgeSpaceProfileMigrationCandidateBuilder,
  KnowledgeSpaceProfileMigrationEvaluationResult,
  KnowledgeSpaceProfileMigrationEvaluator,
} from "./knowledge-space-profile-migration-runtime";
import type {
  KnowledgeSpaceProfileKind,
  KnowledgeSpaceProfileRepository,
  KnowledgeSpaceProfileRevision,
} from "./knowledge-space-profile-repository";
import type { PublishedPageIndexBuildRepository } from "./page-index-build-repository";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import {
  type ProjectionSetPublicationComponentType,
  ProjectionSetPublicationComponentTypes,
  type ProjectionSetPublicationMember,
  type ProjectionSetPublicationMemberRepository,
} from "./projection-publication-member-repository";
import type {
  ProjectionSetPublication,
  ProjectionSetPublicationRepository,
} from "./projection-publication-repository";

export interface KnowledgeSpaceProfileMigrationCandidateMemberInput {
  readonly componentKey: string;
  readonly componentType: ProjectionSetPublicationComponentType;
  readonly documentAssetId?: string | undefined;
  readonly generationId: string;
}

export interface ReplaceKnowledgeSpaceProfileMigrationCandidateSnapshotInput {
  readonly basePublication: KnowledgeSpaceProfileMigrationPublicationReference;
  readonly candidatePublicationFingerprint: string;
  readonly candidatePublicationId: string;
  readonly createdAt: string;
  readonly knowledgeSpaceId: string;
  readonly members: readonly KnowledgeSpaceProfileMigrationCandidateMemberInput[];
  readonly tenantId: string;
}

/**
 * Atomically replaces the complete immutable member snapshot of one migration candidate while
 * proving that the frozen base publication is still the published head. The migration worker may
 * create generation-scoped artifacts before this call; losing the head fence can therefore leave
 * only unreachable artifacts, never a partially visible publication.
 */
export interface KnowledgeSpaceProfileMigrationCandidateSnapshotRepository {
  replace(
    input: ReplaceKnowledgeSpaceProfileMigrationCandidateSnapshotInput,
  ): Promise<readonly ProjectionSetPublicationMember[]>;
}

export interface DatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxMembers: number;
  readonly writeBatchSize: number;
}

export function createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository({
  database,
  maxMembers,
  writeBatchSize,
}: DatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepositoryOptions): KnowledgeSpaceProfileMigrationCandidateSnapshotRepository {
  positiveInteger(maxMembers, "maxMembers");
  positiveInteger(writeBatchSize, "writeBatchSize");

  return {
    replace: async (rawInput) => {
      const input = normalizeSnapshotInput(rawInput, maxMembers);
      return database.transaction(async (transaction) => {
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, input))) {
          throw candidateError(
            "PROFILE_MIGRATION_SPACE_NOT_WRITABLE",
            "Knowledge space is missing, deleting, or deletion-fenced",
          );
        }
        const base = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.basePublication.id,
            input.basePublication.fingerprint,
            input.basePublication.headRevision,
          ],
          sql: `SELECT pub.${q(database, "id")} FROM ${q(
            database,
            "projection_set_publication_heads",
          )} head JOIN ${q(database, "projection_set_publications")} pub ON pub.${q(
            database,
            "tenant_id",
          )} = head.${q(database, "tenant_id")} AND pub.${q(
            database,
            "knowledge_space_id",
          )} = head.${q(database, "knowledge_space_id")} AND pub.${q(
            database,
            "id",
          )} = head.${q(database, "publication_id")} WHERE head.${q(
            database,
            "tenant_id",
          )} = ${p(database, 1)} AND head.${q(database, "knowledge_space_id")} = ${p(
            database,
            2,
          )} AND pub.${q(database, "id")} = ${p(database, 3)} AND pub.${q(
            database,
            "fingerprint",
          )} = ${p(database, 4)} AND head.${q(database, "head_revision")} = ${p(
            database,
            5,
          )} AND pub.${q(database, "status")} = 'published' LIMIT 1 FOR UPDATE;`,
          tableName: "projection_set_publication_heads",
        });
        if (base.rows.length !== 1) {
          throw candidateError(
            "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED",
            "Published projection head changed while building the migration candidate",
          );
        }
        const candidate = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.candidatePublicationId,
            input.candidatePublicationFingerprint,
          ],
          sql: `SELECT ${q(database, "id")} FROM ${q(
            database,
            "projection_set_publications",
          )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
            database,
            "knowledge_space_id",
          )} = ${p(database, 2)} AND ${q(database, "id")} = ${p(
            database,
            3,
          )} AND ${q(database, "fingerprint")} = ${p(database, 4)} AND ${q(
            database,
            "status",
          )} = 'candidate' LIMIT 1 FOR UPDATE;`,
          tableName: "projection_set_publications",
        });
        if (candidate.rows.length !== 1) {
          throw candidateError(
            "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_CHANGED",
            "Migration candidate publication is missing or no longer writable",
          );
        }
        await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [input.tenantId, input.knowledgeSpaceId, input.candidatePublicationId],
          sql: `DELETE FROM ${q(database, "projection_set_publication_members")} WHERE ${q(
            database,
            "tenant_id",
          )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
            database,
            2,
          )} AND ${q(database, "publication_id")} = ${p(database, 3)};`,
          tableName: "projection_set_publication_members",
        });
        for (const batch of batches(input.members, writeBatchSize)) {
          const params: DatabaseQueryValue[] = [];
          const values = batch.map((member) => {
            const row = [
              input.tenantId,
              input.knowledgeSpaceId,
              input.candidatePublicationId,
              member.componentType,
              member.componentKey,
              member.generationId,
              member.documentAssetId ?? null,
              input.createdAt,
            ];
            return `(${row
              .map((value) => {
                params.push(value);
                return p(database, params.length);
              })
              .join(", ")})`;
          });
          const inserted = await transaction.execute({
            maxRows: 0,
            operation: "insert",
            params,
            sql: `INSERT INTO ${q(database, "projection_set_publication_members")} (${[
              "tenant_id",
              "knowledge_space_id",
              "publication_id",
              "component_type",
              "component_key",
              "generation_id",
              "document_asset_id",
              "created_at",
            ]
              .map((column) => q(database, column))
              .join(", ")}) VALUES ${values.join(", ")};`,
            tableName: "projection_set_publication_members",
          });
          if (inserted.rowsAffected !== batch.length) {
            throw candidateError(
              "PROFILE_MIGRATION_CANDIDATE_MEMBER_CONFLICT",
              "Migration candidate member snapshot was not persisted completely",
            );
          }
        }

        return input.members.map((member) => ({
          ...member,
          createdAt: input.createdAt,
          knowledgeSpaceId: input.knowledgeSpaceId,
          publicationId: input.candidatePublicationId,
          tenantId: input.tenantId,
        }));
      });
    },
  };
}

export interface RepositoryKnowledgeSpaceProfileMigrationCandidateBuilderOptions {
  readonly artifacts: Pick<ParseArtifactRepository, "getById">;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly maxDocuments: number;
  readonly maxMembers: number;
  readonly maxPathReadPageSize?: number | undefined;
  readonly maxPathsPerDocument?: number | undefined;
  readonly maxProjectionBatchSize: number;
  readonly members: Pick<ProjectionSetPublicationMemberRepository, "listByFingerprint">;
  readonly now?: (() => string) | undefined;
  readonly outlineBuilder: DocumentOutlineBuilder;
  readonly outlineSummaryEnhancer: DocumentOutlineSummaryEnhancer;
  readonly outlines: Pick<DocumentOutlineRepository, "getById" | "upsert">;
  readonly pageIndexBuild: Pick<
    PublishedPageIndexBuildRepository,
    "hasCompleteBuild" | "materializeBuilding"
  >;
  readonly paths?:
    | Pick<KnowledgePathRepository, "listPhysicalDescendants" | "upsertMany">
    | undefined;
  readonly profiles: Pick<KnowledgeSpaceProfileRepository, "getRevision">;
  readonly projections: Required<Pick<IndexProjectionRepository, "getMany">>;
  readonly publications: Pick<
    ProjectionSetPublicationRepository,
    "createCandidate" | "getByFingerprint" | "getPublished" | "validate"
  >;
  readonly reindexer: Pick<IncrementalReindexer, "reindex">;
  readonly semanticGraph?: JointSemanticGraphMaterializer | undefined;
  readonly snapshots: KnowledgeSpaceProfileMigrationCandidateSnapshotRepository;
}

interface CandidateDocument {
  readonly artifact: NonNullable<Awaited<ReturnType<ParseArtifactRepository["getById"]>>>;
  readonly asset: NonNullable<Awaited<ReturnType<DocumentAssetRepository["get"]>>>;
  readonly baseOutline: NonNullable<Awaited<ReturnType<DocumentOutlineRepository["getById"]>>>;
  readonly documentAssetId: string;
}

interface FrozenBaseSnapshot {
  readonly documents: readonly CandidateDocument[];
  readonly members: readonly ProjectionSetPublicationMember[];
  readonly publication: ProjectionSetPublication & { readonly headRevision: number };
}

/**
 * Production candidate builder for all three migration scopes. It reuses the exact generation-
 * scoped reindexer, outline builder, reasoning-model summary enhancer, and PageIndex materializer
 * used by document compilation. No scope can return a proof flag without re-reading and proving
 * the complete immutable candidate member snapshot.
 */
export function createRepositoryKnowledgeSpaceProfileMigrationCandidateBuilder({
  artifacts,
  assets,
  maxDocuments,
  maxMembers,
  maxPathReadPageSize = 100,
  maxPathsPerDocument = 20_000,
  maxProjectionBatchSize,
  members,
  now = () => new Date().toISOString(),
  outlineBuilder,
  outlineSummaryEnhancer,
  outlines,
  pageIndexBuild,
  paths,
  profiles,
  projections,
  publications,
  reindexer,
  semanticGraph,
  snapshots,
}: RepositoryKnowledgeSpaceProfileMigrationCandidateBuilderOptions): KnowledgeSpaceProfileMigrationCandidateBuilder {
  positiveInteger(maxDocuments, "maxDocuments");
  positiveInteger(maxMembers, "maxMembers");
  positiveInteger(maxPathReadPageSize, "maxPathReadPageSize");
  positiveInteger(maxPathsPerDocument, "maxPathsPerDocument");
  positiveInteger(maxProjectionBatchSize, "maxProjectionBatchSize");

  const loadBase = async (
    input: KnowledgeSpaceProfileMigrationCandidateBuildInput,
  ): Promise<FrozenBaseSnapshot> => {
    const publication = await publications.getPublished(input);
    if (
      !publication ||
      publication.id !== input.basePublication.id ||
      publication.fingerprint !== input.basePublication.fingerprint ||
      publication.headRevision !== input.basePublication.headRevision
    ) {
      throw candidateError(
        "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED",
        "Published projection head no longer matches the migration snapshot",
      );
    }
    const baseMembers = await members.listByFingerprint({
      fingerprint: publication.fingerprint,
      knowledgeSpaceId: input.knowledgeSpaceId,
      tenantId: input.tenantId,
    });
    if (baseMembers.length > maxMembers) {
      throw candidateError(
        "PROFILE_MIGRATION_BASE_MEMBER_LIMIT",
        `Base publication member count exceeds ${maxMembers}`,
      );
    }
    const outlineMembers = baseMembers.filter(
      (member) => member.componentType === "document-outline",
    );
    const byDocument = groupByDocument(outlineMembers);
    if (byDocument.size > maxDocuments) {
      throw candidateError(
        "PROFILE_MIGRATION_DOCUMENT_LIMIT",
        `Profile migration document count exceeds ${maxDocuments}`,
      );
    }
    if (baseMembers.length > 0 && byDocument.size === 0) {
      throw candidateError(
        "PROFILE_MIGRATION_BASE_OUTLINE_INVALID",
        "A non-empty base publication has no document outline ownership closure",
      );
    }
    const documents: CandidateDocument[] = [];
    for (const [documentAssetId, owned] of [...byDocument].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (owned.length !== 1 || !owned[0]) {
        throw candidateError(
          "PROFILE_MIGRATION_BASE_OUTLINE_INVALID",
          `Document ${documentAssetId} must have exactly one published outline`,
        );
      }
      const baseOutline = await outlines.getById({ id: owned[0].componentKey });
      if (
        !baseOutline ||
        baseOutline.knowledgeSpaceId !== input.knowledgeSpaceId ||
        baseOutline.documentAssetId !== documentAssetId ||
        baseOutline.publicationGenerationId !== owned[0].generationId
      ) {
        throw candidateError(
          "PROFILE_MIGRATION_BASE_OUTLINE_INVALID",
          `Document ${documentAssetId} published outline lineage is invalid`,
        );
      }
      const [artifact, asset] = await Promise.all([
        artifacts.getById({ id: baseOutline.parseArtifactId }),
        assets.get({ id: documentAssetId, knowledgeSpaceId: input.knowledgeSpaceId }),
      ]);
      if (
        !artifact ||
        artifact.documentAssetId !== documentAssetId ||
        artifact.version !== baseOutline.version ||
        artifact.artifactHash !== baseOutline.artifactHash ||
        !asset ||
        asset.version !== baseOutline.version
      ) {
        throw candidateError(
          "PROFILE_MIGRATION_SOURCE_SNAPSHOT_INVALID",
          `Document ${documentAssetId} immutable source snapshot is unavailable`,
        );
      }
      documents.push({ artifact, asset, baseOutline, documentAssetId });
    }
    const documentIds = new Set(documents.map((document) => document.documentAssetId));
    if (
      baseMembers.some(
        (member) => member.documentAssetId && !documentIds.has(member.documentAssetId),
      )
    ) {
      throw candidateError(
        "PROFILE_MIGRATION_BASE_MEMBER_INVALID",
        "Base publication contains a component without an owning document outline",
      );
    }
    return { documents, members: baseMembers, publication };
  };

  const verify = async (
    input: KnowledgeSpaceProfileMigrationCandidateBuildInput & {
      readonly publicationFingerprint: string;
      readonly publicationId: string;
    },
    base: FrozenBaseSnapshot,
    requireValidating = true,
  ): Promise<KnowledgeSpaceProfileMigrationCandidateBuildResult> => {
    const candidate = await publications.getByFingerprint({
      fingerprint: input.publicationFingerprint,
      knowledgeSpaceId: input.knowledgeSpaceId,
      tenantId: input.tenantId,
    });
    if (
      !candidate ||
      candidate.id !== input.publicationId ||
      (candidate.status !== "candidate" && candidate.status !== "validating")
    ) {
      throw candidateError(
        "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_INVALID",
        "Migration candidate publication identity or state is invalid",
      );
    }
    const candidateMembers = await members.listByFingerprint({
      fingerprint: input.publicationFingerprint,
      knowledgeSpaceId: input.knowledgeSpaceId,
      tenantId: input.tenantId,
    });
    if (candidateMembers.length > maxMembers) {
      throw candidateError(
        "PROFILE_MIGRATION_CANDIDATE_MEMBER_LIMIT",
        `Candidate member count exceeds ${maxMembers}`,
      );
    }

    if (input.rebuildScope === "clone-publication") {
      assertSameMemberSnapshot(base.members, candidateMembers);
      return buildResult(candidate, { successorMembersCloned: true }, requireValidating);
    }
    if (input.rebuildScope === "full-page-index-summary-outline") {
      if (!paths) {
        throw candidateError(
          "PROFILE_MIGRATION_REASONING_REBUILD_UNAVAILABLE",
          "Reasoning migration requires outline-derived KnowledgeFS path persistence",
        );
      }
      if (!input.baseEmbeddingProfile) {
        throw candidateError(
          "PROFILE_MIGRATION_REASONING_REBUILD_UNAVAILABLE",
          "Reasoning migration requires the frozen active embedding profile",
        );
      }
      const baseProjectionMembers = base.members.filter(
        (member) => member.componentType === "index-projection",
      );
      const baseProjections = await loadProjections(
        projections,
        baseProjectionMembers.map((member) => member.componentKey),
        input.knowledgeSpaceId,
        maxProjectionBatchSize,
      );
      const preservedProjectionIds = new Set(
        baseProjections
          .filter((projection) => !isOrdinarySearchProjection(projection))
          .map((projection) => projection.id),
      );
      const baseDerivedPathIds = await resolveBaseOutlineDerivedPathIds({
        documents: base.documents,
        maxPaths: maxPathsPerDocument,
        pageSize: maxPathReadPageSize,
        paths,
        tenantId: input.tenantId,
      });
      const expectedCandidatePathGenerations = new Set(
        base.documents.map((document) =>
          migrationGenerationId(input.runId, "page-index", document.documentAssetId),
        ),
      );
      assertSameMemberSnapshot(
        base.members.filter(
          (member) =>
            member.componentType !== "document-outline" &&
            !(semanticGraph && isGraphMember(member)) &&
            !(
              member.componentType === "knowledge-path" &&
              baseDerivedPathIds.has(member.componentKey)
            ) &&
            (member.componentType !== "index-projection" ||
              preservedProjectionIds.has(member.componentKey)),
        ),
        candidateMembers.filter(
          (member) =>
            member.componentType !== "document-outline" &&
            !(semanticGraph && isGraphMember(member)) &&
            !(
              member.componentType === "knowledge-path" &&
              expectedCandidatePathGenerations.has(member.generationId)
            ) &&
            (member.componentType !== "index-projection" ||
              preservedProjectionIds.has(member.componentKey)),
        ),
        "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
        "Reasoning migration changed or dropped a preserved publication member",
      );
      const candidateOutlineMembers = candidateMembers.filter(
        (member) => member.componentType === "document-outline",
      );
      if (candidateOutlineMembers.length !== base.documents.length) {
        throw candidateError(
          "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
          "Reasoning migration has extra or missing rebuilt outline members",
        );
      }
      const retrieval = await requireProfile(
        profiles,
        input,
        "retrieval",
        input.candidateProfile,
        "candidate",
      );
      const profile = KnowledgeSpaceRetrievalProfileSchema.parse(retrieval.snapshot);
      const embedding = await requireProfile(
        profiles,
        input,
        "embedding",
        input.baseEmbeddingProfile,
        "active",
      );
      const embeddingProfile = KnowledgeSpaceEmbeddingProfileSchema.parse(embedding.snapshot);
      const outlinesByDocument = groupByDocument(
        candidateMembers.filter((member) => member.componentType === "document-outline"),
      );
      const candidateProjectionMembers = candidateMembers.filter(
        (member) => member.componentType === "index-projection",
      );
      const candidateProjections = await loadProjections(
        projections,
        candidateProjectionMembers.map((member) => member.componentKey),
        input.knowledgeSpaceId,
        maxProjectionBatchSize,
      );
      const candidateProjectionById = new Map(
        candidateProjections.map((projection) => [projection.id, projection]),
      );
      const candidateProjectionsByDocument = groupByDocument(candidateProjectionMembers);
      const candidateGraphByDocument = groupByDocument(candidateMembers.filter(isGraphMember));
      for (const document of base.documents) {
        const expectedGeneration = migrationGenerationId(
          input.runId,
          "page-index",
          document.documentAssetId,
        );
        const owned = outlinesByDocument.get(document.documentAssetId) ?? [];
        if (owned.length !== 1 || owned[0]?.generationId !== expectedGeneration) {
          throw candidateError(
            "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
            `Document ${document.documentAssetId} has no exact rebuilt outline`,
          );
        }
        const outline = await outlines.getById({ id: owned[0].componentKey });
        const summary = outline?.metadata.summary;
        if (
          !outline ||
          outline.publicationGenerationId !== expectedGeneration ||
          !isPlainObject(summary) ||
          summary.model !== profile.reasoningModel.model ||
          !(await pageIndexBuild.hasCompleteBuild({ outline, tenantId: input.tenantId }))
        ) {
          throw candidateError(
            "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
            `Document ${document.documentAssetId} PageIndex Summary/Outline rebuild is incomplete`,
          );
        }
        if (
          (candidateGraphByDocument.get(document.documentAssetId) ?? []).some(
            (member) => member.generationId !== expectedGeneration,
          )
        ) {
          throw candidateError(
            "PROFILE_MIGRATION_REASONING_REBUILD_INCOMPLETE",
            `Document ${document.documentAssetId} Graph lineage is incomplete`,
          );
        }
        const expectedPaths = buildOutlineDerivedPaths({
          asset: document.asset,
          outline,
          publicationGenerationId: expectedGeneration,
          tenantId: input.tenantId,
        });
        await assertOutlineDerivedPathClosure({
          expected: expectedPaths,
          maxPaths: maxPathsPerDocument,
          members: candidateMembers.filter(
            (member) =>
              member.componentType === "knowledge-path" &&
              expectedPaths.some((path) => path.id === member.componentKey),
          ),
          pageSize: maxPathReadPageSize,
          paths,
        });
        const ordinary = (candidateProjectionsByDocument.get(document.documentAssetId) ?? [])
          .filter((member) => !preservedProjectionIds.has(member.componentKey))
          .map((member) => {
            const projection = candidateProjectionById.get(member.componentKey);
            if (
              !projection ||
              !isOrdinarySearchProjection(projection) ||
              projection.publicationGenerationId !== expectedGeneration ||
              member.generationId !== expectedGeneration ||
              projectionDocumentAssetId(projection) !== document.documentAssetId ||
              projection.status !== "building"
            ) {
              throw candidateError(
                "PROFILE_MIGRATION_REASONING_REBUILD_INCOMPLETE",
                `Document ${document.documentAssetId} semantic projection lineage is incomplete`,
              );
            }
            return projection;
          });
        const fts = ordinary.filter((projection) => projection.type === "fts");
        const dense = ordinary.filter((projection) => projection.type === "dense-vector");
        if (
          fts.length < 1 ||
          dense.length !== fts.length ||
          dense.some((projection) => projection.model !== embeddingProfile.vectorSpaceId)
        ) {
          throw candidateError(
            "PROFILE_MIGRATION_REASONING_REBUILD_INCOMPLETE",
            `Document ${document.documentAssetId} semantic search projection closure is incomplete`,
          );
        }
      }
      const baseDocumentIds = new Set(base.documents.map((document) => document.documentAssetId));
      if (
        candidateMembers.some(
          (member) =>
            isGraphMember(member) &&
            (!member.documentAssetId || !baseDocumentIds.has(member.documentAssetId)),
        ) ||
        candidateProjectionMembers.some(
          (member) =>
            !preservedProjectionIds.has(member.componentKey) &&
            (!member.documentAssetId ||
              !baseDocumentIds.has(member.documentAssetId) ||
              !isOrdinarySearchProjection(candidateProjectionById.get(member.componentKey))),
        )
      ) {
        throw candidateError(
          "PROFILE_MIGRATION_REASONING_REBUILD_INCOMPLETE",
          "Reasoning migration candidate contains an extra or unowned search projection",
        );
      }
      return buildResult(candidate, { pageIndexSummaryOutlineRebuilt: true }, requireValidating);
    }

    const embedding = await requireProfile(
      profiles,
      input,
      "embedding",
      input.candidateProfile,
      "candidate",
    );
    const profile = KnowledgeSpaceEmbeddingProfileSchema.parse(embedding.snapshot);
    const projectionMembers = candidateMembers.filter(
      (member) => member.componentType === "index-projection",
    );
    assertSameMemberSnapshot(
      base.members.filter(
        (member) =>
          member.componentType !== "index-projection" && !(semanticGraph && isGraphMember(member)),
      ),
      candidateMembers.filter(
        (member) =>
          member.componentType !== "index-projection" && !(semanticGraph && isGraphMember(member)),
      ),
      "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
      "Embedding migration changed or dropped a non-index publication member",
    );
    const baseProjectionMembers = base.members.filter(
      (member) => member.componentType === "index-projection",
    );
    const baseLoaded = await loadProjections(
      projections,
      baseProjectionMembers.map((member) => member.componentKey),
      input.knowledgeSpaceId,
      maxProjectionBatchSize,
    );
    const baseById = new Map(baseLoaded.map((projection) => [projection.id, projection]));
    const preservedProjectionMembers = baseProjectionMembers.filter((member) => {
      const projection = baseById.get(member.componentKey);
      return projection !== undefined && !isOrdinarySearchProjection(projection);
    });
    const preservedProjectionIds = new Set(
      preservedProjectionMembers.map((member) => member.componentKey),
    );
    assertSameMemberSnapshot(
      preservedProjectionMembers,
      projectionMembers.filter((member) => preservedProjectionIds.has(member.componentKey)),
      "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
      "Embedding migration changed or dropped a preserved visual/metadata/graph projection",
    );
    const loaded = await loadProjections(
      projections,
      projectionMembers.map((member) => member.componentKey),
      input.knowledgeSpaceId,
      maxProjectionBatchSize,
    );
    const projectionsById = new Map(loaded.map((projection) => [projection.id, projection]));
    const membersByDocument = groupByDocument(projectionMembers);
    const graphByDocument = groupByDocument(candidateMembers.filter(isGraphMember));
    for (const document of base.documents) {
      const expectedGeneration = migrationGenerationId(
        input.runId,
        "vector-space",
        document.documentAssetId,
      );
      const owned = (membersByDocument.get(document.documentAssetId) ?? []).map((member) => {
        const projection = projectionsById.get(member.componentKey);
        const preserved = preservedProjectionIds.has(member.componentKey);
        if (
          !projection ||
          projection.publicationGenerationId !== member.generationId ||
          (!preserved &&
            (!isOrdinarySearchProjection(projection) ||
              member.generationId !== expectedGeneration)) ||
          projectionDocumentAssetId(projection) !== document.documentAssetId ||
          projection.status !== (preserved ? "ready" : "building")
        ) {
          throw candidateError(
            "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
            `Document ${document.documentAssetId} projection lineage is incomplete`,
          );
        }
        return projection;
      });
      if (
        (graphByDocument.get(document.documentAssetId) ?? []).some(
          (member) => member.generationId !== expectedGeneration,
        )
      ) {
        throw candidateError(
          "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
          `Document ${document.documentAssetId} Graph lineage is incomplete`,
        );
      }
      const baseOwned = baseProjectionMembers
        .filter((member) => member.documentAssetId === document.documentAssetId)
        .flatMap((member) => {
          const projection = baseById.get(member.componentKey);
          return projection ? [projection] : [];
        });
      const expectedFts = baseOwned.filter((projection) => projection.type === "fts").length;
      const baseDense = baseOwned.filter(
        (projection) => projection.type === "dense-vector" && !isVisualProjection(projection),
      ).length;
      const actualFts = owned.filter((projection) => projection.type === "fts").length;
      const actualDense = owned.filter(
        (projection) => projection.type === "dense-vector" && !isVisualProjection(projection),
      ).length;
      if (
        actualFts < 1 ||
        (expectedFts > 0 && actualFts !== expectedFts) ||
        actualDense !== (baseDense > 0 ? baseDense : actualFts) ||
        owned.some(
          (projection) =>
            projection.type === "dense-vector" &&
            !isVisualProjection(projection) &&
            projection.model !== profile.vectorSpaceId,
        )
      ) {
        throw candidateError(
          "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
          `Document ${document.documentAssetId} has no complete ${profile.vectorSpaceId} vector closure`,
        );
      }
    }
    const baseDocumentIds = new Set(base.documents.map((document) => document.documentAssetId));
    if (
      candidateMembers.some(
        (member) =>
          isGraphMember(member) &&
          (!member.documentAssetId || !baseDocumentIds.has(member.documentAssetId)),
      ) ||
      projectionMembers.some(
        (member) =>
          !preservedProjectionIds.has(member.componentKey) &&
          (!member.documentAssetId ||
            !baseDocumentIds.has(member.documentAssetId) ||
            !isOrdinarySearchProjection(projectionsById.get(member.componentKey))),
      )
    ) {
      throw candidateError(
        "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
        "Embedding migration candidate contains an extra or unowned projection member",
      );
    }
    return buildResult(candidate, { fullVectorSpaceRebuilt: true }, requireValidating);
  };

  const ensureCandidate = async (
    input: KnowledgeSpaceProfileMigrationCandidateBuildInput,
    base: FrozenBaseSnapshot,
    fingerprint: string,
    id: string,
  ): Promise<ProjectionSetPublication> => {
    const lookup = {
      fingerprint,
      knowledgeSpaceId: input.knowledgeSpaceId,
      tenantId: input.tenantId,
    };
    const existing = await publications.getByFingerprint(lookup);
    if (existing) {
      if (
        existing.id !== id ||
        (existing.status !== "candidate" && existing.status !== "validating")
      ) {
        throw candidateError(
          "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_CONFLICT",
          "Deterministic migration candidate identity is already owned by another lifecycle",
        );
      }
      return existing;
    }
    return publications.createCandidate({
      createdAt: DateTimeSchema.parse(now()),
      fingerprint,
      id,
      knowledgeSpaceId: input.knowledgeSpaceId,
      metadata: {
        basePublication: input.basePublication,
        candidateProfile: input.candidateProfile,
        changedKind: input.changedKind,
        profileMigrationRunId: input.runId,
        rebuildScope: input.rebuildScope,
      },
      projectionVersion: base.publication.projectionVersion,
      tenantId: input.tenantId,
    });
  };

  return {
    build: async (input) => {
      const base = await loadBase(input);
      const fingerprint = migrationFingerprint(input);
      const id = deterministicChildId(input.runId, "profile-migration-publication");
      const candidate = await ensureCandidate(input, base, fingerprint, id);
      if (candidate.status === "validating") {
        return verify({ ...input, publicationFingerprint: fingerprint, publicationId: id }, base);
      }

      let nextMembers: readonly KnowledgeSpaceProfileMigrationCandidateMemberInput[];
      if (input.rebuildScope === "clone-publication") {
        nextMembers = base.members.map(memberInput);
      } else if (input.rebuildScope === "full-page-index-summary-outline") {
        if (!paths) {
          throw candidateError(
            "PROFILE_MIGRATION_REASONING_REBUILD_UNAVAILABLE",
            "Reasoning migration requires outline-derived KnowledgeFS path persistence",
          );
        }
        if (!input.baseEmbeddingProfile) {
          throw candidateError(
            "PROFILE_MIGRATION_REASONING_REBUILD_UNAVAILABLE",
            "Reasoning migration requires the frozen active embedding profile",
          );
        }
        const retrieval = await requireProfile(
          profiles,
          input,
          "retrieval",
          input.candidateProfile,
          "candidate",
        );
        const retrievalProfile = KnowledgeSpaceRetrievalProfileSchema.parse(retrieval.snapshot);
        const embedding = await requireProfile(
          profiles,
          input,
          "embedding",
          input.baseEmbeddingProfile,
          "active",
        );
        const embeddingProfile = KnowledgeSpaceEmbeddingProfileSchema.parse(embedding.snapshot);
        const baseProjectionMembers = base.members.filter(
          (member) => member.componentType === "index-projection",
        );
        const baseProjections = await loadProjections(
          projections,
          baseProjectionMembers.map((member) => member.componentKey),
          input.knowledgeSpaceId,
          maxProjectionBatchSize,
        );
        const preservedProjectionIds = new Set(
          baseProjections
            .filter((projection) => !isOrdinarySearchProjection(projection))
            .map((projection) => projection.id),
        );
        const baseDerivedPathIds = await resolveBaseOutlineDerivedPathIds({
          documents: base.documents,
          maxPaths: maxPathsPerDocument,
          pageSize: maxPathReadPageSize,
          paths,
          tenantId: input.tenantId,
        });
        const rebuilt: KnowledgeSpaceProfileMigrationCandidateMemberInput[] = [];
        for (const document of base.documents) {
          await input.execution?.heartbeat();
          const generationId = migrationGenerationId(
            input.runId,
            "page-index",
            document.documentAssetId,
          );
          const reindexResult = await reindexer.reindex({
            denseModel: embeddingProfile.vectorSpaceId,
            embeddingProfile,
            enableGraph: true,
            knowledgeSpaceId: input.knowledgeSpaceId,
            parseArtifact: document.artifact,
            permissionScope: stringArray(document.asset.metadata.permissionScope),
            projectionStatus: "building",
            projectionVersion: document.asset.version,
            publicationGenerationId: generationId,
            retrievalProfile,
            skipVisual: true,
            tenantId: input.tenantId,
          });
          if (
            reindexResult.status !== "rebuilt" ||
            !reindexResult.outlineArtifact ||
            !reindexResult.projectionIds ||
            reindexResult.projectionIds.length === 0 ||
            reindexResult.projectionIds.length !== reindexResult.projectionsCreated ||
            (reindexResult.nodeIds?.length ?? 0) !== reindexResult.nodesCreated
          ) {
            throw candidateError(
              "PROFILE_MIGRATION_REASONING_REBUILD_INCOMPLETE",
              `Document ${document.documentAssetId} did not produce a complete semantic generation receipt`,
            );
          }
          const deterministicOutline = outlineBuilder.build({
            knowledgeSpaceId: input.knowledgeSpaceId,
            parseArtifact: reindexResult.outlineArtifact,
            publicationGenerationId: generationId,
          });
          const enhanced = await outlineSummaryEnhancer.enhance({
            outline: deterministicOutline,
            parseArtifact: reindexResult.outlineArtifact,
            retrievalProfile,
            tenantId: input.tenantId,
          });
          const outline = await outlines.upsert(enhanced);
          await pageIndexBuild.materializeBuilding({
            builtAt: outline.updatedAt ?? outline.createdAt,
            outline,
            tenantId: input.tenantId,
          });
          const rebuiltPaths = buildOutlineDerivedPaths({
            asset: document.asset,
            outline,
            publicationGenerationId: generationId,
            tenantId: input.tenantId,
          });
          await persistOutlineDerivedPaths({
            batchSize: maxProjectionBatchSize,
            expected: rebuiltPaths,
            paths,
          });
          rebuilt.push(
            {
              componentKey: outline.id,
              componentType: "document-outline",
              documentAssetId: document.documentAssetId,
              generationId,
            },
            ...rebuiltPaths.map((path) => ({
              componentKey: path.id,
              componentType: "knowledge-path" as const,
              documentAssetId: document.documentAssetId,
              generationId,
            })),
          );
          rebuilt.push(
            ...reindexResult.projectionIds.map((componentKey) => ({
              componentKey,
              componentType: "index-projection" as const,
              documentAssetId: document.documentAssetId,
              generationId,
            })),
          );
          if (semanticGraph) {
            const graph = await semanticGraph.materialize({
              createdAt: candidate.createdAt,
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifactId: document.artifact.id,
              publicationGenerationId: generationId,
              retrievalProfile,
            });
            rebuilt.push(
              ...graph.graphEntityIds.map((componentKey) => ({
                componentKey,
                componentType: "graph-entity" as const,
                documentAssetId: document.documentAssetId,
                generationId,
              })),
              ...graph.graphRelationIds.map((componentKey) => ({
                componentKey,
                componentType: "graph-relation" as const,
                documentAssetId: document.documentAssetId,
                generationId,
              })),
            );
          }
          await input.execution?.heartbeat();
        }
        nextMembers = [
          ...base.members
            .filter(
              (member) =>
                member.componentType !== "document-outline" &&
                !(semanticGraph && isGraphMember(member)) &&
                !(
                  member.componentType === "knowledge-path" &&
                  baseDerivedPathIds.has(member.componentKey)
                ) &&
                (member.componentType !== "index-projection" ||
                  preservedProjectionIds.has(member.componentKey)),
            )
            .map(memberInput),
          ...rebuilt,
        ];
      } else {
        const embedding = await requireProfile(
          profiles,
          input,
          "embedding",
          input.candidateProfile,
          "candidate",
        );
        const embeddingProfile = KnowledgeSpaceEmbeddingProfileSchema.parse(embedding.snapshot);
        const retrieval = await requireProfile(
          profiles,
          input,
          "retrieval",
          input.baseRetrievalProfile,
          "active",
        );
        const retrievalProfile = KnowledgeSpaceRetrievalProfileSchema.parse(retrieval.snapshot);
        const baseProjectionMembers = base.members.filter(
          (member) => member.componentType === "index-projection",
        );
        const baseProjections = await loadProjections(
          projections,
          baseProjectionMembers.map((member) => member.componentKey),
          input.knowledgeSpaceId,
          maxProjectionBatchSize,
        );
        const baseProjectionById = new Map(
          baseProjections.map((projection) => [projection.id, projection]),
        );
        const ordinaryNodeGenerationsByDocument = new Map<string, Set<string>>();
        for (const member of baseProjectionMembers) {
          if (!member.documentAssetId) continue;
          const projection = baseProjectionById.get(member.componentKey);
          if (!projection || !isOrdinarySearchProjection(projection)) continue;
          const generations =
            ordinaryNodeGenerationsByDocument.get(member.documentAssetId) ?? new Set<string>();
          generations.add(member.generationId);
          ordinaryNodeGenerationsByDocument.set(member.documentAssetId, generations);
        }
        const preservedProjectionIds = new Set(
          baseProjections
            .filter((projection) => !isOrdinarySearchProjection(projection))
            .map((projection) => projection.id),
        );
        const rebuilt: KnowledgeSpaceProfileMigrationCandidateMemberInput[] = [];
        const rebuiltGraph: KnowledgeSpaceProfileMigrationCandidateMemberInput[] = [];
        for (const document of base.documents) {
          await input.execution?.heartbeat();
          const generationId = migrationGenerationId(
            input.runId,
            "vector-space",
            document.documentAssetId,
          );
          const sourceNodeGenerations =
            ordinaryNodeGenerationsByDocument.get(document.documentAssetId) ?? new Set<string>();
          if (sourceNodeGenerations.size !== 1) {
            throw candidateError(
              "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
              `Document ${document.documentAssetId} must have exactly one reusable ordinary node generation`,
            );
          }
          const reuseNodeGenerationId = [...sourceNodeGenerations][0] as string;
          const result = await reindexer.reindex({
            denseModel: embeddingProfile.vectorSpaceId,
            embeddingProfile,
            knowledgeSpaceId: input.knowledgeSpaceId,
            parseArtifact: document.artifact,
            permissionScope: stringArray(document.asset.metadata.permissionScope),
            projectionStatus: "building",
            projectionVersion: document.asset.version,
            publicationGenerationId: generationId,
            retrievalProfile,
            reuseNodeGenerationId,
            skipVisual: true,
            tenantId: input.tenantId,
          });
          if (
            result.status !== "rebuilt" ||
            !result.projectionIds ||
            result.projectionIds.length === 0 ||
            result.projectionIds.length !== result.projectionsCreated
          ) {
            throw candidateError(
              "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
              `Document ${document.documentAssetId} did not produce a complete projection receipt`,
            );
          }
          rebuilt.push(
            ...result.projectionIds.map((componentKey) => ({
              componentKey,
              componentType: "index-projection" as const,
              documentAssetId: document.documentAssetId,
              generationId,
            })),
          );
          if (semanticGraph) {
            const graph = await semanticGraph.materialize({
              createdAt: candidate.createdAt,
              knowledgeSpaceId: input.knowledgeSpaceId,
              parseArtifactId: document.artifact.id,
              publicationGenerationId: generationId,
              retrievalProfile,
            });
            rebuiltGraph.push(
              ...graph.graphEntityIds.map((componentKey) => ({
                componentKey,
                componentType: "graph-entity" as const,
                documentAssetId: document.documentAssetId,
                generationId,
              })),
              ...graph.graphRelationIds.map((componentKey) => ({
                componentKey,
                componentType: "graph-relation" as const,
                documentAssetId: document.documentAssetId,
                generationId,
              })),
            );
          }
          await input.execution?.heartbeat();
        }
        nextMembers = [
          ...base.members
            .filter(
              (member) =>
                !(semanticGraph && isGraphMember(member)) &&
                (member.componentType !== "index-projection" ||
                  preservedProjectionIds.has(member.componentKey)),
            )
            .map(memberInput),
          ...rebuilt,
          ...rebuiltGraph,
        ];
      }
      if (nextMembers.length > maxMembers) {
        throw candidateError(
          "PROFILE_MIGRATION_CANDIDATE_MEMBER_LIMIT",
          `Candidate member count exceeds ${maxMembers}`,
        );
      }
      await input.execution?.heartbeat();
      const createdAt = DateTimeSchema.parse(now());
      await snapshots.replace({
        basePublication: input.basePublication,
        candidatePublicationFingerprint: fingerprint,
        candidatePublicationId: id,
        createdAt,
        knowledgeSpaceId: input.knowledgeSpaceId,
        members: nextMembers,
        tenantId: input.tenantId,
      });
      await verify(
        { ...input, publicationFingerprint: fingerprint, publicationId: id },
        base,
        false,
      );
      await input.execution?.heartbeat();
      await publications.validate({
        fingerprint,
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
        updatedAt: DateTimeSchema.parse(now()),
      });
      await input.execution?.heartbeat();
      return verify({ ...input, publicationFingerprint: fingerprint, publicationId: id }, base);
    },
    getBuiltCandidate: async (input) => {
      const base = await loadBase(input);
      return verify(input, base);
    },
  };
}

export interface RepositoryKnowledgeSpaceProfileMigrationEvaluatorOptions {
  readonly maxProjectionBatchSize: number;
  readonly members: Pick<ProjectionSetPublicationMemberRepository, "listByFingerprint">;
  readonly outlines: Pick<DocumentOutlineRepository, "getById">;
  readonly pageIndexBuild: Pick<PublishedPageIndexBuildRepository, "hasCompleteBuild">;
  readonly profiles: Pick<KnowledgeSpaceProfileRepository, "getRevision">;
  readonly projections: Required<Pick<IndexProjectionRepository, "getMany">>;
}

/** Candidate-only structural evaluation; it never falls back to the active publication. */
export function createRepositoryKnowledgeSpaceProfileMigrationEvaluator({
  maxProjectionBatchSize,
  members,
  outlines,
  pageIndexBuild,
  profiles,
  projections,
}: RepositoryKnowledgeSpaceProfileMigrationEvaluatorOptions): KnowledgeSpaceProfileMigrationEvaluator {
  positiveInteger(maxProjectionBatchSize, "maxProjectionBatchSize");
  return {
    evaluate: async ({ candidate, run }) => {
      try {
        const candidateMembers = await members.listByFingerprint({
          fingerprint: candidate.publicationFingerprint,
          knowledgeSpaceId: run.knowledgeSpaceId,
          tenantId: run.tenantId,
        });
        const outlinesByDocument = groupByDocument(
          candidateMembers.filter((member) => member.componentType === "document-outline"),
        );
        const projectionMembers = candidateMembers.filter(
          (member) => member.componentType === "index-projection",
        );
        const projectionsByDocument = groupByDocument(projectionMembers);
        const baseMembers = await members.listByFingerprint({
          fingerprint: run.basePublication.fingerprint,
          knowledgeSpaceId: run.knowledgeSpaceId,
          tenantId: run.tenantId,
        });
        if (run.rebuildScope === "clone-publication") {
          assertSameMemberSnapshot(baseMembers, candidateMembers);
        } else if (run.rebuildScope === "full-page-index-summary-outline") {
          assertSameMemberSnapshot(
            baseMembers.filter(
              (member) =>
                member.componentType !== "document-outline" &&
                member.componentType !== "index-projection" &&
                member.componentType !== "knowledge-path" &&
                !isGraphMember(member),
            ),
            candidateMembers.filter(
              (member) =>
                member.componentType !== "document-outline" &&
                member.componentType !== "index-projection" &&
                member.componentType !== "knowledge-path" &&
                !isGraphMember(member),
            ),
            "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
            "Reasoning evaluation found a changed or missing preserved publication member",
          );
          if (
            candidateMembers.filter((member) => member.componentType === "document-outline")
              .length !==
            baseMembers.filter((member) => member.componentType === "document-outline").length
          ) {
            return failedEvaluation(
              "reasoning candidate has an extra or missing rebuilt outline member",
            );
          }
        } else {
          assertSameMemberSnapshot(
            baseMembers.filter(
              (member) => member.componentType !== "index-projection" && !isGraphMember(member),
            ),
            candidateMembers.filter(
              (member) => member.componentType !== "index-projection" && !isGraphMember(member),
            ),
            "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
            "Embedding evaluation found a changed or missing non-index publication member",
          );
        }
        const baseDocuments = new Set(
          baseMembers
            .filter((member) => member.componentType === "document-outline")
            .flatMap((member) => (member.documentAssetId ? [member.documentAssetId] : [])),
        );
        const candidateDocuments = new Set(outlinesByDocument.keys());
        if (
          baseDocuments.size !== candidateDocuments.size ||
          [...baseDocuments].some((documentId) => !candidateDocuments.has(documentId))
        ) {
          return failedEvaluation("candidate document ownership differs from the frozen base");
        }
        if (run.rebuildScope === "full-page-index-summary-outline") {
          for (const documentAssetId of candidateDocuments) {
            const expectedGeneration = migrationGenerationId(run.id, "page-index", documentAssetId);
            if (
              !candidateMembers.some(
                (member) =>
                  member.componentType === "knowledge-path" &&
                  member.documentAssetId === documentAssetId &&
                  member.generationId === expectedGeneration,
              ) ||
              candidateMembers.some(
                (member) =>
                  isGraphMember(member) &&
                  member.documentAssetId === documentAssetId &&
                  member.generationId !== expectedGeneration,
              )
            ) {
              return failedEvaluation(
                `document ${documentAssetId} semantic path or Graph generation is incomplete`,
              );
            }
          }
        }
        if (baseMembers.length === 0 && candidateMembers.length === 0) {
          return {
            passed: true,
            summary: {
              denseProjections: 0,
              documents: 0,
              ftsProjections: 0,
              pageIndexBuilds: 0,
              rebuildScope: run.rebuildScope,
            },
          };
        }
        const embedding = await evaluationEmbeddingProfile(profiles, run);
        const reasoningProfile =
          run.rebuildScope === "full-page-index-summary-outline"
            ? KnowledgeSpaceRetrievalProfileSchema.parse(
                (
                  await requireProfile(
                    profiles,
                    run,
                    "retrieval",
                    run.candidateProfile,
                    "candidate",
                  )
                ).snapshot,
              )
            : undefined;
        const loaded = await loadProjections(
          projections,
          projectionMembers.map((member) => member.componentKey),
          run.knowledgeSpaceId,
          maxProjectionBatchSize,
        );
        const byId = new Map(loaded.map((projection) => [projection.id, projection]));
        const baseProjectionMembers = baseMembers.filter(
          (member) => member.componentType === "index-projection",
        );
        const baseLoaded = await loadProjections(
          projections,
          baseProjectionMembers.map((member) => member.componentKey),
          run.knowledgeSpaceId,
          maxProjectionBatchSize,
        );
        const baseById = new Map(baseLoaded.map((projection) => [projection.id, projection]));
        const mutableBaseByDocument = new Map<string, IndexProjection[]>();
        for (const member of baseProjectionMembers) {
          if (!member.documentAssetId) continue;
          const projection = baseById.get(member.componentKey);
          if (!projection) continue;
          const owned = mutableBaseByDocument.get(member.documentAssetId);
          if (owned) owned.push(projection);
          else mutableBaseByDocument.set(member.documentAssetId, [projection]);
        }
        const baseProjectionsByDocument: ReadonlyMap<string, readonly IndexProjection[]> =
          mutableBaseByDocument;
        let preservedProjectionIds = new Set<string>();
        if (run.rebuildScope === "full-vector-space") {
          const preservedProjectionMembers = baseProjectionMembers.filter((member) => {
            const projection = baseById.get(member.componentKey);
            return projection !== undefined && !isOrdinarySearchProjection(projection);
          });
          preservedProjectionIds = new Set(
            preservedProjectionMembers.map((member) => member.componentKey),
          );
          assertSameMemberSnapshot(
            preservedProjectionMembers,
            projectionMembers.filter((member) => preservedProjectionIds.has(member.componentKey)),
            "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
            "Embedding evaluation found a changed or missing preserved projection",
          );
          if (
            projectionMembers.some((member) => {
              if (preservedProjectionIds.has(member.componentKey)) return false;
              const projection = byId.get(member.componentKey);
              return (
                !member.documentAssetId ||
                !baseDocuments.has(member.documentAssetId) ||
                !isOrdinarySearchProjection(projection) ||
                member.generationId !==
                  migrationGenerationId(run.id, "vector-space", member.documentAssetId)
              );
            })
          ) {
            return failedEvaluation(
              "embedding candidate contains an extra, unowned, or stale projection member",
            );
          }
        }
        let pageIndexBuilds = 0;
        let ftsProjections = 0;
        let denseProjections = 0;
        for (const [documentAssetId, ownedOutlines] of outlinesByDocument) {
          if (ownedOutlines.length !== 1 || !ownedOutlines[0]) {
            return failedEvaluation(`document ${documentAssetId} has no exact outline`);
          }
          const outline = await outlines.getById({ id: ownedOutlines[0].componentKey });
          const summary = outline?.metadata.summary;
          if (
            !outline ||
            outline.documentAssetId !== documentAssetId ||
            outline.publicationGenerationId !== ownedOutlines[0].generationId ||
            (reasoningProfile !== undefined &&
              (ownedOutlines[0].generationId !==
                migrationGenerationId(run.id, "page-index", documentAssetId) ||
                !isPlainObject(summary) ||
                summary.model !== reasoningProfile.reasoningModel.model)) ||
            !(await pageIndexBuild.hasCompleteBuild({ outline, tenantId: run.tenantId }))
          ) {
            return failedEvaluation(`document ${documentAssetId} PageIndex is incomplete`);
          }
          pageIndexBuilds += 1;
          const ownedProjections = projectionsByDocument.get(documentAssetId) ?? [];
          let hasFts = false;
          let hasDense = false;
          let ftsCount = 0;
          let denseCount = 0;
          for (const member of ownedProjections) {
            const projection = byId.get(member.componentKey);
            if (
              !projection ||
              projection.publicationGenerationId !== member.generationId ||
              projectionDocumentAssetId(projection) !== documentAssetId ||
              projection.status !== expectedMigrationProjectionStatus(run, member)
            ) {
              return failedEvaluation(`projection ${member.componentKey} lineage is invalid`);
            }
            if (
              reasoningProfile !== undefined &&
              isOrdinarySearchProjection(projection) &&
              member.generationId !== migrationGenerationId(run.id, "page-index", documentAssetId)
            ) {
              return failedEvaluation(
                `document ${documentAssetId} contains a stale reasoning search projection`,
              );
            }
            if (projection.type === "fts") {
              ftsProjections += 1;
              ftsCount += 1;
              hasFts = true;
            }
            if (projection.type === "dense-vector" && !isVisualProjection(projection)) {
              denseCount += 1;
              if (embedding && projection.model !== embedding.vectorSpaceId) {
                return failedEvaluation(
                  `document ${documentAssetId} contains a dense projection from the wrong vector space`,
                );
              }
              denseProjections += 1;
              hasDense = true;
            }
          }
          if (run.rebuildScope === "full-vector-space") {
            const baseOwned = baseProjectionsByDocument.get(documentAssetId) ?? [];
            const expectedFts = baseOwned.filter((projection) => projection.type === "fts").length;
            const baseDense = baseOwned.filter(
              (projection) => projection.type === "dense-vector" && !isVisualProjection(projection),
            ).length;
            if (
              ftsCount < 1 ||
              (expectedFts > 0 && ftsCount !== expectedFts) ||
              denseCount !== (baseDense > 0 ? baseDense : ftsCount)
            ) {
              return failedEvaluation(
                `document ${documentAssetId} has an extra or missing rebuilt search projection`,
              );
            }
          }
          const baseOwned = baseProjectionsByDocument.get(documentAssetId) ?? [];
          const requiresFts =
            run.rebuildScope === "full-vector-space" ||
            baseOwned.some((projection) => projection.type === "fts");
          const requiresDense =
            run.rebuildScope === "full-vector-space" ||
            baseOwned.some(
              (projection) => projection.type === "dense-vector" && !isVisualProjection(projection),
            );
          if ((requiresFts && !hasFts) || (requiresDense && !hasDense)) {
            return failedEvaluation(
              `document ${documentAssetId} is missing a frozen-base search capability`,
            );
          }
        }
        return {
          passed: true,
          summary: {
            denseProjections,
            documents: outlinesByDocument.size,
            ftsProjections,
            pageIndexBuilds,
            rebuildScope: run.rebuildScope,
            ...(embedding ? { vectorSpaceId: embedding.vectorSpaceId } : {}),
          },
        };
      } catch (error) {
        return failedEvaluation(
          error instanceof Error ? error.message : "candidate structural evaluation failed",
        );
      }
    },
  };
}

async function evaluationEmbeddingProfile(
  profiles: Pick<KnowledgeSpaceProfileRepository, "getRevision">,
  run: KnowledgeSpaceProfileMigrationRun,
): Promise<KnowledgeSpaceEmbeddingProfile | undefined> {
  const reference =
    run.changedKind === "embedding" ? run.candidateProfile : run.baseEmbeddingProfile;
  if (!reference) return undefined;
  const revision = await requireProfile(
    profiles,
    run,
    "embedding",
    reference,
    run.changedKind === "embedding" ? "candidate" : "active",
  );
  return KnowledgeSpaceEmbeddingProfileSchema.parse(revision.snapshot);
}

async function requireProfile(
  profiles: Pick<KnowledgeSpaceProfileRepository, "getRevision">,
  scope: { readonly knowledgeSpaceId: string; readonly tenantId: string },
  kind: KnowledgeSpaceProfileKind,
  reference: KnowledgeSpaceProfileMigrationProfileReference,
  expectedState: "active" | "candidate",
): Promise<KnowledgeSpaceProfileRevision> {
  const revision = await profiles.getRevision({
    kind,
    knowledgeSpaceId: scope.knowledgeSpaceId,
    revision: reference.revision,
    tenantId: scope.tenantId,
  });
  if (
    !revision ||
    revision.id !== reference.id ||
    revision.snapshotDigest !== reference.snapshotDigest ||
    revision.state !== expectedState
  ) {
    throw candidateError(
      "PROFILE_MIGRATION_PROFILE_SNAPSHOT_INVALID",
      `Frozen ${kind} profile is missing, changed, or not ${expectedState}`,
    );
  }
  return revision;
}

function normalizeSnapshotInput(
  input: ReplaceKnowledgeSpaceProfileMigrationCandidateSnapshotInput,
  maxMembers: number,
): ReplaceKnowledgeSpaceProfileMigrationCandidateSnapshotInput {
  const members = input.members.map((member) => ({
    componentKey: UuidSchema.parse(member.componentKey),
    componentType: parseComponentType(member.componentType),
    ...(member.documentAssetId
      ? { documentAssetId: UuidSchema.parse(member.documentAssetId) }
      : {}),
    generationId: PublicationGenerationIdSchema.parse(member.generationId),
  }));
  if (members.length > maxMembers) {
    throw new Error(`Profile migration candidate members exceed ${maxMembers}`);
  }
  const identities = new Set<string>();
  for (const member of members) {
    const identity = `${member.componentType}:${member.componentKey}`;
    if (identities.has(identity)) throw new Error(`Duplicate candidate member ${identity}`);
    identities.add(identity);
  }
  return {
    basePublication: {
      fingerprint: ProjectionSetFingerprintSchema.parse(input.basePublication.fingerprint),
      headRevision: positiveInteger(input.basePublication.headRevision, "baseHeadRevision"),
      id: UuidSchema.parse(input.basePublication.id),
    },
    candidatePublicationFingerprint: ProjectionSetFingerprintSchema.parse(
      input.candidatePublicationFingerprint,
    ),
    candidatePublicationId: UuidSchema.parse(input.candidatePublicationId),
    createdAt: DateTimeSchema.parse(input.createdAt),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    members,
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function migrationFingerprint(input: KnowledgeSpaceProfileMigrationCandidateBuildInput): string {
  const digest = createHash("sha256")
    .update(
      stableJson({
        baseEmbeddingProfile: input.baseEmbeddingProfile ?? null,
        basePublication: input.basePublication,
        baseRetrievalProfile: input.baseRetrievalProfile,
        candidateProfile: input.candidateProfile,
        changedKind: input.changedKind,
        profileMigrationFormat: "profile-migration-publication-v1",
        rebuildScope: input.rebuildScope,
        runId: input.runId,
      }),
    )
    .digest("hex");
  return ProjectionSetFingerprintSchema.parse(`projection-set-sha256:${digest}`);
}

function migrationGenerationId(
  runId: string,
  scope: "page-index" | "vector-space",
  documentAssetId: string,
): string {
  return PublicationGenerationIdSchema.parse(
    deterministicChildId(runId, `profile-migration:${scope}:${documentAssetId}`),
  );
}

function memberInput(
  member: ProjectionSetPublicationMember,
): KnowledgeSpaceProfileMigrationCandidateMemberInput {
  return {
    componentKey: member.componentKey,
    componentType: member.componentType,
    ...(member.documentAssetId ? { documentAssetId: member.documentAssetId } : {}),
    generationId: member.generationId,
  };
}

function assertSameMemberSnapshot(
  expected: readonly Pick<
    ProjectionSetPublicationMember,
    "componentKey" | "componentType" | "documentAssetId" | "generationId"
  >[],
  actual: readonly Pick<
    ProjectionSetPublicationMember,
    "componentKey" | "componentType" | "documentAssetId" | "generationId"
  >[],
  errorCode = "PROFILE_MIGRATION_SUCCESSOR_INCOMPLETE",
  errorMessage = "Settings-only successor does not exactly clone the base publication membership",
): void {
  const identity = (
    member: Pick<
      ProjectionSetPublicationMember,
      "componentKey" | "componentType" | "documentAssetId" | "generationId"
    >,
  ) =>
    stableJson({
      componentKey: member.componentKey,
      componentType: member.componentType,
      documentAssetId: member.documentAssetId ?? null,
      generationId: member.generationId,
    });
  const left = expected.map(identity).sort();
  const right = actual.map(identity).sort();
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw candidateError(errorCode, errorMessage);
  }
}

function buildResult(
  candidate: ProjectionSetPublication,
  proof: Pick<
    KnowledgeSpaceProfileMigrationCandidateBuildResult,
    "fullVectorSpaceRebuilt" | "pageIndexSummaryOutlineRebuilt" | "successorMembersCloned"
  >,
  requireValidating: boolean,
): KnowledgeSpaceProfileMigrationCandidateBuildResult {
  if (requireValidating && candidate.status !== "validating") {
    throw candidateError(
      "PROFILE_MIGRATION_CANDIDATE_NOT_VALIDATING",
      "Candidate publication has not completed validation",
    );
  }
  return {
    ...proof,
    publicationFingerprint: candidate.fingerprint,
    publicationId: candidate.id,
    publicationStatus: "validating",
  };
}

function groupByDocument<T extends { readonly documentAssetId?: string | undefined }>(
  values: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    if (!value.documentAssetId) continue;
    const existing = grouped.get(value.documentAssetId);
    if (existing) existing.push(value);
    else grouped.set(value.documentAssetId, [value]);
  }
  return grouped;
}

async function loadProjections(
  projections: Required<Pick<IndexProjectionRepository, "getMany">>,
  ids: readonly string[],
  knowledgeSpaceId: string,
  batchSize: number,
): Promise<readonly IndexProjection[]> {
  const unique = [...new Set(ids)];
  const loaded: IndexProjection[] = [];
  for (const batch of batches(unique, batchSize)) {
    loaded.push(...(await projections.getMany({ ids: batch, knowledgeSpaceId })));
  }
  if (
    loaded.length !== unique.length ||
    new Set(loaded.map((item) => item.id)).size !== unique.length
  ) {
    throw candidateError(
      "PROFILE_MIGRATION_CANDIDATE_PROJECTION_INVALID",
      "Candidate projection receipt is incomplete or duplicated",
    );
  }
  return loaded;
}

function projectionDocumentAssetId(projection: IndexProjection): string | undefined {
  return typeof projection.metadata.documentAssetId === "string"
    ? projection.metadata.documentAssetId
    : undefined;
}

function isVisualProjection(projection: IndexProjection): boolean {
  const multimodal = isPlainObject(projection.metadata.multimodal)
    ? projection.metadata.multimodal
    : undefined;
  return multimodal?.vectorSpace === "visual";
}

function isOrdinarySearchProjection(projection: IndexProjection | undefined): boolean {
  return (
    projection !== undefined &&
    (projection.type === "fts" ||
      (projection.type === "dense-vector" && !isVisualProjection(projection)))
  );
}

function expectedMigrationProjectionStatus(
  run: KnowledgeSpaceProfileMigrationRun,
  member: ProjectionSetPublicationMember,
): IndexProjection["status"] {
  if (!member.documentAssetId || run.rebuildScope === "clone-publication") return "ready";
  const scope = run.rebuildScope === "full-vector-space" ? "vector-space" : "page-index";
  return member.generationId === migrationGenerationId(run.id, scope, member.documentAssetId)
    ? "building"
    : "ready";
}

function isGraphMember(member: Pick<ProjectionSetPublicationMember, "componentType">): boolean {
  return member.componentType === "graph-entity" || member.componentType === "graph-relation";
}

function buildOutlineDerivedPaths({
  asset,
  outline,
  publicationGenerationId,
  tenantId,
}: {
  readonly asset: CandidateDocument["asset"];
  readonly outline: DocumentOutline;
  readonly publicationGenerationId: string;
  readonly tenantId: string;
}): readonly KnowledgePath[] {
  let sequence = 0;
  const generateId = () =>
    deterministicChildId(publicationGenerationId, `reasoning-path-seed:${sequence++}`);
  const derived = [
    buildDocumentOutlineKnowledgePath({
      asset,
      id: generateId(),
      publicationGenerationId,
      tenantId,
    }),
    ...buildDocumentSectionKnowledgePaths({
      asset,
      generateId,
      outline,
      publicationGenerationId,
      tenantId,
    }),
  ];
  if (
    new Set(derived.map((path) => path.id)).size !== derived.length ||
    new Set(derived.map((path) => path.virtualPath)).size !== derived.length
  ) {
    throw candidateError(
      "PROFILE_MIGRATION_REASONING_PATH_REBUILD_INCOMPLETE",
      `Document ${asset.id} produced duplicate outline-derived KnowledgeFS paths`,
    );
  }
  return derived;
}

async function persistOutlineDerivedPaths({
  batchSize,
  expected,
  paths,
}: {
  readonly batchSize: number;
  readonly expected: readonly KnowledgePath[];
  readonly paths: Pick<KnowledgePathRepository, "upsertMany">;
}): Promise<void> {
  const persisted: KnowledgePath[] = [];
  for (const batch of batches(expected, batchSize)) {
    persisted.push(...(await paths.upsertMany(batch)));
  }
  assertExactKnowledgePaths(expected, persisted);
}

async function assertOutlineDerivedPathClosure({
  expected,
  maxPaths,
  members,
  pageSize,
  paths,
}: {
  readonly expected: readonly KnowledgePath[];
  readonly maxPaths: number;
  readonly members: readonly Pick<
    ProjectionSetPublicationMember,
    "componentKey" | "componentType" | "documentAssetId" | "generationId"
  >[];
  readonly pageSize: number;
  readonly paths: Pick<KnowledgePathRepository, "listPhysicalDescendants">;
}): Promise<void> {
  assertSameMemberSnapshot(
    expected.map((path) => ({
      componentKey: path.id,
      componentType: "knowledge-path" as const,
      documentAssetId: path.targetId,
      generationId: path.publicationGenerationId as string,
    })),
    members,
    "PROFILE_MIGRATION_REASONING_PATH_REBUILD_INCOMPLETE",
    `Document ${expected[0]?.targetId ?? "unknown"} outline-derived path membership is incomplete`,
  );
  const stored = await listDocumentGenerationPaths({
    anchor: expected[0] as KnowledgePath,
    maxPaths,
    pageSize,
    paths,
  });
  const expectedVirtualPaths = new Set(expected.map((path) => path.virtualPath));
  assertExactKnowledgePaths(
    expected,
    stored.filter((path) => expectedVirtualPaths.has(path.virtualPath)),
  );
}

async function listDocumentGenerationPaths({
  anchor,
  maxPaths,
  pageSize,
  paths,
}: {
  readonly anchor: KnowledgePath;
  readonly maxPaths: number;
  readonly pageSize: number;
  readonly paths: Pick<KnowledgePathRepository, "listPhysicalDescendants">;
}): Promise<readonly KnowledgePath[]> {
  const parentPath = anchor.virtualPath.replace(/\/outline\.json$/u, "");
  const matched: KnowledgePath[] = [];
  let cursor: Awaited<ReturnType<KnowledgePathRepository["listPhysicalDescendants"]>>["nextCursor"];
  do {
    const page = await paths.listPhysicalDescendants({
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId: anchor.knowledgeSpaceId,
      limit: Math.min(pageSize, maxPaths - matched.length),
      parentPath,
      publicationGenerationId: anchor.publicationGenerationId,
      viewName: anchor.viewName,
    });
    matched.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && matched.length >= maxPaths) {
      throw candidateError(
        "PROFILE_MIGRATION_REASONING_PATH_REBUILD_INCOMPLETE",
        `Document ${anchor.targetId} path count exceeds ${maxPaths}`,
      );
    }
  } while (cursor);
  return matched;
}

async function resolveBaseOutlineDerivedPathIds({
  documents,
  maxPaths,
  pageSize,
  paths,
  tenantId,
}: {
  readonly documents: readonly CandidateDocument[];
  readonly maxPaths: number;
  readonly pageSize: number;
  readonly paths: Pick<KnowledgePathRepository, "listPhysicalDescendants">;
  readonly tenantId: string;
}): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  for (const document of documents) {
    const expected = buildOutlineDerivedPaths({
      asset: document.asset,
      outline: document.baseOutline,
      publicationGenerationId: PublicationGenerationIdSchema.parse(
        document.baseOutline.publicationGenerationId,
      ),
      tenantId,
    });
    const resolved = await listDocumentGenerationPaths({
      anchor: expected[0] as KnowledgePath,
      maxPaths,
      pageSize,
      paths,
    });
    for (const path of resolved) {
      const contentKind = path.metadata.contentKind;
      if (
        path.targetId === document.documentAssetId &&
        (contentKind === "document-outline" || contentKind === "document-section")
      ) {
        ids.add(path.id);
      }
    }
  }
  return ids;
}

function assertExactKnowledgePaths(
  expected: readonly KnowledgePath[],
  actual: readonly KnowledgePath[],
): void {
  const left = expected.map((path) => stableJson(path)).sort();
  const right = actual.map((path) => stableJson(path)).sort();
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw candidateError(
      "PROFILE_MIGRATION_REASONING_PATH_REBUILD_INCOMPLETE",
      "Outline-derived KnowledgeFS path receipt is incomplete or incompatible",
    );
  }
}

function failedEvaluation(reason: string): KnowledgeSpaceProfileMigrationEvaluationResult {
  return { passed: false, summary: { reason: reason.slice(0, 512) } };
}

function parseComponentType(value: string): ProjectionSetPublicationComponentType {
  if (!(ProjectionSetPublicationComponentTypes as readonly string[]).includes(value)) {
    throw new Error(`Unsupported publication component type=${value}`);
  }
  return value as ProjectionSetPublicationComponentType;
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function batches<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

class ProfileMigrationCandidateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProfileMigrationCandidateError";
    this.code = code;
  }
}

function candidateError(code: string, message: string): ProfileMigrationCandidateError {
  return new ProfileMigrationCandidateError(code, message);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive`);
  return value;
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
