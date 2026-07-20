import { createHash } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  DateTimeSchema,
  type IndexProjection,
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
import type { DocumentOutlineBuilder } from "./document-outline-builder";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { DocumentOutlineSummaryEnhancer } from "./document-outline-summary-enhancer";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { IncrementalReindexer } from "./index-reindexer";
import { isPlainObject } from "./json-utils";
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
  readonly profiles: Pick<KnowledgeSpaceProfileRepository, "getRevision">;
  readonly projections: Required<Pick<IndexProjectionRepository, "getMany">>;
  readonly publications: Pick<
    ProjectionSetPublicationRepository,
    "createCandidate" | "getByFingerprint" | "getPublished" | "validate"
  >;
  readonly reindexer: Pick<IncrementalReindexer, "reindex">;
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
  maxProjectionBatchSize,
  members,
  now = () => new Date().toISOString(),
  outlineBuilder,
  outlineSummaryEnhancer,
  outlines,
  pageIndexBuild,
  profiles,
  projections,
  publications,
  reindexer,
  snapshots,
}: RepositoryKnowledgeSpaceProfileMigrationCandidateBuilderOptions): KnowledgeSpaceProfileMigrationCandidateBuilder {
  positiveInteger(maxDocuments, "maxDocuments");
  positiveInteger(maxMembers, "maxMembers");
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
      assertSameMemberSnapshot(
        base.members.filter((member) => member.componentType !== "document-outline"),
        candidateMembers.filter((member) => member.componentType !== "document-outline"),
        "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
        "Reasoning migration changed or dropped a non-outline publication member",
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
      const outlinesByDocument = groupByDocument(
        candidateMembers.filter((member) => member.componentType === "document-outline"),
      );
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
      base.members.filter((member) => member.componentType !== "index-projection"),
      candidateMembers.filter((member) => member.componentType !== "index-projection"),
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
          projection.status !== "ready"
        ) {
          throw candidateError(
            "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
            `Document ${document.documentAssetId} projection lineage is incomplete`,
          );
        }
        return projection;
      });
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
        const retrieval = await requireProfile(
          profiles,
          input,
          "retrieval",
          input.candidateProfile,
          "candidate",
        );
        const retrievalProfile = KnowledgeSpaceRetrievalProfileSchema.parse(retrieval.snapshot);
        const rebuilt: KnowledgeSpaceProfileMigrationCandidateMemberInput[] = [];
        for (const document of base.documents) {
          await input.execution?.heartbeat();
          const generationId = migrationGenerationId(
            input.runId,
            "page-index",
            document.documentAssetId,
          );
          const deterministicOutline = outlineBuilder.build({
            knowledgeSpaceId: input.knowledgeSpaceId,
            parseArtifact: document.artifact,
            publicationGenerationId: generationId,
          });
          const enhanced = await outlineSummaryEnhancer.enhance({
            outline: deterministicOutline,
            parseArtifact: document.artifact,
            retrievalProfile,
            tenantId: input.tenantId,
          });
          const outline = await outlines.upsert(enhanced);
          await pageIndexBuild.materializeBuilding({
            builtAt: outline.updatedAt ?? outline.createdAt,
            outline,
            tenantId: input.tenantId,
          });
          rebuilt.push({
            componentKey: outline.id,
            componentType: "document-outline",
            documentAssetId: document.documentAssetId,
            generationId,
          });
          await input.execution?.heartbeat();
        }
        nextMembers = [
          ...base.members
            .filter((member) => member.componentType !== "document-outline")
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
        const rebuilt: KnowledgeSpaceProfileMigrationCandidateMemberInput[] = [];
        for (const document of base.documents) {
          await input.execution?.heartbeat();
          const generationId = migrationGenerationId(
            input.runId,
            "vector-space",
            document.documentAssetId,
          );
          const result = await reindexer.reindex({
            denseModel: embeddingProfile.vectorSpaceId,
            embeddingProfile,
            knowledgeSpaceId: input.knowledgeSpaceId,
            parseArtifact: document.artifact,
            permissionScope: stringArray(document.asset.metadata.permissionScope),
            projectionStatus: "ready",
            projectionVersion: document.asset.version,
            publicationGenerationId: generationId,
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
          await input.execution?.heartbeat();
        }
        nextMembers = [
          ...base.members
            .filter(
              (member) =>
                member.componentType !== "index-projection" ||
                preservedProjectionIds.has(member.componentKey),
            )
            .map(memberInput),
          ...rebuilt,
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
            baseMembers.filter((member) => member.componentType !== "document-outline"),
            candidateMembers.filter((member) => member.componentType !== "document-outline"),
            "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
            "Reasoning evaluation found a changed or missing non-outline publication member",
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
            baseMembers.filter((member) => member.componentType !== "index-projection"),
            candidateMembers.filter((member) => member.componentType !== "index-projection"),
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
              projection.status !== "ready"
            ) {
              return failedEvaluation(`projection ${member.componentKey} lineage is invalid`);
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
