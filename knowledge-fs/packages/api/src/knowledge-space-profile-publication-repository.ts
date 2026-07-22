import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceRetrievalProfileSchema,
  ProjectionSetFingerprintSchema,
  TenantIdSchema,
  UuidSchema,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import type { KnowledgeSpaceProfileMigrationFence } from "./knowledge-space-profile-migration";
import {
  type KnowledgeSpaceProfileKind,
  KnowledgeSpaceProfileKinds,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";
import { ModelCapabilitySnapshotSchema } from "./model-capability-preflight";

export const KnowledgeSpaceProfilePublicationBindingTableName =
  "knowledge_space_profile_publication_bindings";
export const KnowledgeSpaceProfilePublicationBindingColumns = Object.freeze({
  activatedAt: "activated_at",
  bindingReason: "binding_reason",
  changedKind: "changed_kind",
  createdAt: "created_at",
  embeddingProfileKind: "embedding_profile_kind",
  embeddingProfileRevision: "embedding_profile_revision",
  embeddingProfileRevisionId: "embedding_profile_revision_id",
  embeddingProfileSnapshotDigest: "embedding_profile_snapshot_digest",
  id: "id",
  knowledgeSpaceId: "knowledge_space_id",
  publicationFingerprint: "publication_fingerprint",
  publicationId: "publication_id",
  retrievalProfileKind: "retrieval_profile_kind",
  retrievalProfileRevision: "retrieval_profile_revision",
  retrievalProfileRevisionId: "retrieval_profile_revision_id",
  retrievalProfileSnapshotDigest: "retrieval_profile_snapshot_digest",
  tenantId: "tenant_id",
  vectorSpaceId: "vector_space_id",
});

const profileRevisionTable = "knowledge_space_profile_revisions";
const profileHeadTable = "knowledge_space_profile_heads";
const manifestTable = "knowledge_space_manifests";
const publicationTable = "projection_set_publications";
const publicationHeadTable = "projection_set_publication_heads";
const legacyEmbeddingProfileMetadataKey = "__knowledgeFsEmbeddingProfile";

export interface KnowledgeSpaceProfilePublicationScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface KnowledgeSpaceProfilePublicationProfileReference {
  readonly id: string;
  readonly revision: number;
  readonly snapshotDigest: string;
}

export interface KnowledgeSpaceProfilePublicationBinding
  extends KnowledgeSpaceProfilePublicationScope {
  readonly activatedAt?: string | undefined;
  readonly bindingReason: "candidate-switch" | "content-publication" | "legacy-bootstrap";
  readonly changedKind: KnowledgeSpaceProfileKind | "bootstrap" | "content";
  readonly createdAt: string;
  readonly embeddingProfile?: KnowledgeSpaceProfilePublicationProfileReference | undefined;
  readonly id: string;
  readonly publicationFingerprint: string;
  readonly publicationId: string;
  readonly retrievalProfile: KnowledgeSpaceProfilePublicationProfileReference;
  readonly vectorSpaceId?: string | undefined;
}

export interface BindKnowledgeSpaceProfilePublicationCandidateInput
  extends KnowledgeSpaceProfilePublicationScope {
  readonly changedKind: KnowledgeSpaceProfileKind;
  readonly createdAt: string;
  readonly profileRevision: number;
  readonly publicationFingerprint: string;
}

export interface ActivateKnowledgeSpaceProfilePublicationCandidateInput
  extends KnowledgeSpaceProfilePublicationScope {
  readonly changedKind: KnowledgeSpaceProfileKind;
  readonly expectedProfileHeadRevision: number | null;
  readonly expectedPublicationHeadRevision: number;
  readonly profileRevision: number;
  readonly publicationFingerprint: string;
  /**
   * Profile migrations must carry their durable execution fence. Database activation validates
   * and completes this run in the same transaction as both mutable heads.
   */
  readonly migrationFence: KnowledgeSpaceProfileMigrationFence;
  readonly updatedAt: string;
}

export interface BindExistingKnowledgeSpaceProfilePublicationInput
  extends KnowledgeSpaceProfilePublicationScope {
  /** Null is an explicit Research-only space with no embedding head. */
  readonly embeddingProfileRevision: number | null;
  readonly expectedPublicationHeadRevision: number;
  readonly publicationFingerprint: string;
  readonly retrievalProfileRevision: number;
  readonly verifiedAt: string;
}

export interface KnowledgeSpaceProfilePublicationActivationResult {
  readonly binding: KnowledgeSpaceProfilePublicationBinding & { readonly activatedAt: string };
  readonly profileHeadRevision: number;
  readonly profileHeadRowVersion: number;
  readonly publicationHeadRevision: number;
  readonly migrationRunCompleted?: boolean | undefined;
}

export interface KnowledgeSpaceProfilePublicationRepository {
  activateCandidate(
    input: ActivateKnowledgeSpaceProfilePublicationCandidateInput,
  ): Promise<KnowledgeSpaceProfilePublicationActivationResult>;
  bindCandidate(
    input: BindKnowledgeSpaceProfilePublicationCandidateInput,
  ): Promise<KnowledgeSpaceProfilePublicationBinding>;
  bindCurrentPublished(
    input: KnowledgeSpaceProfilePublicationScope & {
      readonly verifiedAt: string;
    },
  ): Promise<KnowledgeSpaceProfilePublicationBinding & { readonly activatedAt: string }>;
  bindExistingPublished(
    input: BindExistingKnowledgeSpaceProfilePublicationInput,
  ): Promise<KnowledgeSpaceProfilePublicationBinding & { readonly activatedAt: string }>;
  requireActivatedBinding(input: {
    readonly knowledgeSpaceId: string;
    readonly publicationFingerprint: string;
    readonly publicationId: string;
    readonly tenantId: string;
  }): Promise<KnowledgeSpaceProfilePublicationBinding & { readonly activatedAt: string }>;
}

export interface DatabaseKnowledgeSpaceProfilePublicationRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateBindingId?: (() => string) | undefined;
  readonly generateProfileHeadId?: (() => string) | undefined;
  readonly generatePublicationHeadId?: (() => string) | undefined;
}

export class KnowledgeSpaceProfilePublicationTransitionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeSpaceProfilePublicationTransitionError";
    this.code = code;
  }
}

export class KnowledgeSpaceProfilePublicationProfileHeadConflictError extends KnowledgeSpaceProfilePublicationTransitionError {
  readonly actualRevision: number | null;
  readonly expectedRevision: number | null;

  constructor(expectedRevision: number | null, actualRevision: number | null) {
    super(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
      `Profile head conflict: expected=${String(expectedRevision)} actual=${String(actualRevision)}`,
    );
    this.name = "KnowledgeSpaceProfilePublicationProfileHeadConflictError";
    this.actualRevision = actualRevision;
    this.expectedRevision = expectedRevision;
  }
}

export class KnowledgeSpaceProfilePublicationHeadConflictError extends KnowledgeSpaceProfilePublicationTransitionError {
  readonly actualRevision: number;
  readonly expectedRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_CONFLICT",
      `Publication head conflict: expected=${expectedRevision} actual=${actualRevision}`,
    );
    this.name = "KnowledgeSpaceProfilePublicationHeadConflictError";
    this.actualRevision = actualRevision;
    this.expectedRevision = expectedRevision;
  }
}

export class KnowledgeSpaceProfilePublicationVectorSpaceConflictError extends KnowledgeSpaceProfilePublicationTransitionError {
  constructor() {
    super(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_VECTOR_SPACE_CONFLICT",
      "Publication dense members do not form a complete snapshot in the bound vector space",
    );
    this.name = "KnowledgeSpaceProfilePublicationVectorSpaceConflictError";
  }
}

interface ProfileRecord
  extends KnowledgeSpaceProfilePublicationProfileReference,
    KnowledgeSpaceProfilePublicationScope {
  readonly defaultMode?: "deep" | "fast" | "research" | undefined;
  readonly kind: KnowledgeSpaceProfileKind;
  readonly state: string;
  readonly vectorSpaceId?: string | undefined;
}

interface ProfileHead {
  readonly activeRevision: number;
  readonly profileRevisionId: string;
  readonly rowVersion: number;
}

interface PublicationRecord extends KnowledgeSpaceProfilePublicationScope {
  readonly fingerprint: string;
  readonly id: string;
  readonly status: string;
}

interface PublicationHead {
  readonly headRevision: number;
  readonly publicationId: string;
}

/**
 * A profile switch is published as one tuple: publication + exact embedding snapshot (optional for
 * Research-only spaces) + exact retrieval snapshot. Candidate binding happens before build;
 * activation revalidates the tuple, dense vector-space closure, both mutable heads, and deletion
 * admission in one transaction. A thrown error rolls every state/head write back together.
 */
export function createDatabaseKnowledgeSpaceProfilePublicationRepository({
  database,
  generateBindingId = randomUUID,
  generateProfileHeadId = randomUUID,
  generatePublicationHeadId = randomUUID,
}: DatabaseKnowledgeSpaceProfilePublicationRepositoryOptions): KnowledgeSpaceProfilePublicationRepository {
  return {
    bindCandidate: async (rawInput) => {
      const input = normalizeCandidateInput(rawInput);
      return database.transaction(async (tx) => {
        await requireWritableSpace(database, tx, input);
        const candidate = await requireProfileByRevision(
          database,
          tx,
          input,
          input.changedKind,
          input.profileRevision,
          true,
        );
        requireState(candidate, "candidate", "profile candidate");

        const embeddingHead = await getProfileHead(database, tx, input, "embedding", true);
        const retrievalHead = await getProfileHead(database, tx, input, "retrieval", true);
        const embedding =
          input.changedKind === "embedding"
            ? candidate
            : embeddingHead
              ? await requireHeadProfile(database, tx, input, "embedding", embeddingHead, true)
              : undefined;
        const retrieval =
          input.changedKind === "retrieval"
            ? candidate
            : retrievalHead
              ? await requireHeadProfile(database, tx, input, "retrieval", retrievalHead, true)
              : undefined;
        if (!retrieval) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_RETRIEVAL_PROFILE_REQUIRED",
            "A publication tuple always requires an exact retrieval profile",
          );
        }
        if (!embedding) await requireNoExpectedEmbeddingSource(database, tx, input);
        requireResearchOnlyWhenEmbeddingIsAbsent(embedding, retrieval);
        if (
          embedding &&
          embedding.state !== (input.changedKind === "embedding" ? "candidate" : "active")
        ) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_COMPANION_PROFILE_INVALID",
            "Embedding companion is not the expected active profile",
          );
        }
        if (retrieval.state !== (input.changedKind === "retrieval" ? "candidate" : "active")) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_COMPANION_PROFILE_INVALID",
            "Retrieval companion is not the expected active profile",
          );
        }

        const publication = await requirePublicationByFingerprint(database, tx, input, true);
        if (publication.status !== "candidate" && publication.status !== "validating") {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_CANDIDATE",
            `Publication is ${publication.status}, not candidate`,
          );
        }
        const tuple = candidateBinding(input, embedding, retrieval, publication);
        const existing = await getBindingByPublication(database, tx, publication, true);
        if (existing) {
          assertSameBinding(existing, tuple);
          return existing;
        }
        return insertBinding(database, tx, tuple, nonzeroUuid(generateBindingId(), "bindingId"));
      });
    },

    bindCurrentPublished: async (rawInput) => {
      const input = {
        ...normalizeScope(rawInput),
        verifiedAt: DateTimeSchema.parse(rawInput.verifiedAt),
      };
      return database.transaction((tx) =>
        bindCurrentPublishedTransaction(
          database,
          tx,
          input,
          nonzeroUuid(generateBindingId(), "bindingId"),
        ),
      );
    },

    bindExistingPublished: async (rawInput) => {
      const input = normalizeLegacyInput(rawInput);
      return database.transaction(async (tx) => {
        await requireWritableSpace(database, tx, input);
        const publicationHead = await getPublicationHead(database, tx, input, true);
        const actualPublicationRevision = publicationHead?.headRevision ?? 0;
        if (actualPublicationRevision !== input.expectedPublicationHeadRevision) {
          throw new KnowledgeSpaceProfilePublicationHeadConflictError(
            input.expectedPublicationHeadRevision,
            actualPublicationRevision,
          );
        }
        if (!publicationHead) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_MISSING",
            "Legacy bootstrap requires an existing published head",
          );
        }
        const publication = await requirePublicationById(
          database,
          tx,
          input,
          publicationHead.publicationId,
          true,
        );
        if (
          publication.fingerprint !== input.publicationFingerprint ||
          publication.status !== "published"
        ) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_INVALID",
            "Legacy bootstrap publication does not match the published head",
          );
        }

        const embeddingHead = await getProfileHead(database, tx, input, "embedding", true);
        if ((embeddingHead?.activeRevision ?? null) !== input.embeddingProfileRevision) {
          throw new KnowledgeSpaceProfilePublicationProfileHeadConflictError(
            input.embeddingProfileRevision,
            embeddingHead?.activeRevision ?? null,
          );
        }
        const retrievalHead = await getProfileHead(database, tx, input, "retrieval", true);
        if ((retrievalHead?.activeRevision ?? null) !== input.retrievalProfileRevision) {
          throw new KnowledgeSpaceProfilePublicationProfileHeadConflictError(
            input.retrievalProfileRevision,
            retrievalHead?.activeRevision ?? null,
          );
        }
        if (!retrievalHead) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_RETRIEVAL_PROFILE_REQUIRED",
            "Legacy bootstrap requires a retrieval profile head",
          );
        }
        const embedding = embeddingHead
          ? await requireHeadProfile(database, tx, input, "embedding", embeddingHead, true)
          : undefined;
        const retrieval = await requireHeadProfile(
          database,
          tx,
          input,
          "retrieval",
          retrievalHead,
          true,
        );
        requireState(retrieval, "active", "retrieval head profile");
        if (embedding) {
          requireState(embedding, "active", "embedding head profile");
          await assertEmbeddingPublicationVectorSpace(
            database,
            tx,
            publication,
            requireVectorSpaceId(embedding),
          );
        }
        if (!embedding) await requireNoExpectedEmbeddingSource(database, tx, input);
        requireResearchOnlyWhenEmbeddingIsAbsent(embedding, retrieval);
        const tuple = legacyBinding(input, embedding, retrieval, publication);
        const existing = await getBindingByPublication(database, tx, publication, true);
        if (existing) {
          assertSameBinding(existing, tuple);
          if (!existing.activatedAt) {
            throw transition(
              "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_NOT_ACTIVE",
              "Existing legacy binding is not activated",
            );
          }
          return { ...existing, activatedAt: existing.activatedAt };
        }
        const inserted = await insertBinding(
          database,
          tx,
          tuple,
          nonzeroUuid(generateBindingId(), "bindingId"),
        );
        return { ...inserted, activatedAt: input.verifiedAt };
      });
    },

    activateCandidate: async (rawInput) => {
      const input = normalizeActivationInput(rawInput);
      return database.transaction(async (tx) => {
        await requireWritableSpace(database, tx, input);
        const embeddingHead = await getProfileHead(database, tx, input, "embedding", true);
        const retrievalHead = await getProfileHead(database, tx, input, "retrieval", true);
        const changedHead = input.changedKind === "embedding" ? embeddingHead : retrievalHead;
        const actualChangedRevision = changedHead?.activeRevision ?? null;
        if (actualChangedRevision !== input.expectedProfileHeadRevision) {
          throw new KnowledgeSpaceProfilePublicationProfileHeadConflictError(
            input.expectedProfileHeadRevision,
            actualChangedRevision,
          );
        }
        const publicationHead = await getPublicationHead(database, tx, input, true);
        const actualPublicationRevision = publicationHead?.headRevision ?? 0;
        if (actualPublicationRevision !== input.expectedPublicationHeadRevision) {
          throw new KnowledgeSpaceProfilePublicationHeadConflictError(
            input.expectedPublicationHeadRevision,
            actualPublicationRevision,
          );
        }

        const publication = await requirePublicationByFingerprint(database, tx, input, true);
        if (publication.status !== "validating") {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_VALIDATED",
            "Candidate publication must be validating before joint activation",
          );
        }
        const binding = await getBindingByPublication(database, tx, publication, true);
        if (
          !binding ||
          binding.bindingReason !== "candidate-switch" ||
          binding.changedKind !== input.changedKind ||
          binding.activatedAt
        ) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_INVALID",
            "Candidate publication has no matching unactivated tuple binding",
          );
        }

        await requireProfileMigrationExecutionFence(
          database,
          tx,
          input,
          publication,
          input.migrationFence,
        );

        const changedReference =
          input.changedKind === "embedding" ? binding.embeddingProfile : binding.retrievalProfile;
        if (!changedReference || changedReference.revision !== input.profileRevision) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_INVALID",
            "Binding does not target the requested candidate profile revision",
          );
        }
        const candidate = await requireProfileByRevision(
          database,
          tx,
          input,
          input.changedKind,
          input.profileRevision,
          true,
        );
        requireState(candidate, "candidate", "profile candidate");
        assertProfileReference(candidate, changedReference);

        const embedding = await requireBoundProfileOrAbsence(
          database,
          tx,
          input,
          "embedding",
          binding.embeddingProfile,
          embeddingHead,
          input.changedKind,
          candidate,
        );
        const retrieval = await requireBoundProfileOrAbsence(
          database,
          tx,
          input,
          "retrieval",
          binding.retrievalProfile,
          retrievalHead,
          input.changedKind,
          candidate,
        );
        if (!retrieval) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_RETRIEVAL_PROFILE_REQUIRED",
            "Publication tuple lost its retrieval profile",
          );
        }
        if (!embedding) await requireNoExpectedEmbeddingSource(database, tx, input);
        requireResearchOnlyWhenEmbeddingIsAbsent(embedding, retrieval);
        if (embedding) {
          await assertEmbeddingPublicationVectorSpace(
            database,
            tx,
            publication,
            requireVectorSpaceId(embedding),
          );
        }

        await promoteProfileMigrationPageIndexes(database, tx, publication, input.updatedAt);

        const previousProfile = changedHead
          ? await requireHeadProfile(database, tx, input, input.changedKind, changedHead, true)
          : undefined;
        if (previousProfile) requireState(previousProfile, "active", "previous profile head");
        const previousPublication = publicationHead
          ? await requirePublicationById(database, tx, input, publicationHead.publicationId, true)
          : undefined;
        if (
          previousPublication?.status !== undefined &&
          previousPublication.status !== "published"
        ) {
          throw transition(
            "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_INVALID",
            `publication head is ${previousPublication.status}, expected published`,
          );
        }

        if (previousProfile) {
          await transitionProfile(database, tx, previousProfile, "superseded", input.updatedAt);
        }
        await transitionProfile(database, tx, candidate, "active", input.updatedAt);
        const profileHeadRowVersion = await advanceProfileHead(
          database,
          tx,
          input,
          candidate,
          changedHead,
          generateProfileHeadId,
        );
        if (previousPublication) {
          await transitionPublication(
            database,
            tx,
            previousPublication,
            "superseded",
            input.updatedAt,
            publication.fingerprint,
          );
        }
        await transitionPublication(database, tx, publication, "published", input.updatedAt, null);
        const publicationHeadRevision = await advancePublicationHead(
          database,
          tx,
          input,
          publication,
          generatePublicationHeadId,
        );
        await activateBinding(database, tx, binding, input.updatedAt);
        await completeProfileMigrationExecution(database, tx, input, input.migrationFence);
        return {
          binding: { ...binding, activatedAt: input.updatedAt },
          profileHeadRevision: candidate.revision,
          profileHeadRowVersion,
          publicationHeadRevision,
          migrationRunCompleted: true,
        };
      });
    },

    requireActivatedBinding: async (rawInput) => {
      const input = {
        ...normalizeScope(rawInput),
        publicationFingerprint: ProjectionSetFingerprintSchema.parse(
          rawInput.publicationFingerprint,
        ),
        publicationId: UuidSchema.parse(rawInput.publicationId),
      };
      const binding = await getBindingByPublication(database, database, input, false);
      if (
        !binding ||
        binding.publicationFingerprint !== input.publicationFingerprint ||
        !binding.activatedAt
      ) {
        throw transition(
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_TUPLE_NOT_PUBLISHED",
          "Published runtime tuple is missing or not activated",
        );
      }
      return { ...binding, activatedAt: binding.activatedAt };
    },
  };
}

async function bindCurrentPublishedTransaction(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: KnowledgeSpaceProfilePublicationScope & { readonly verifiedAt: string },
  bindingId: string,
): Promise<KnowledgeSpaceProfilePublicationBinding & { readonly activatedAt: string }> {
  await requireWritableSpace(database, tx, input);
  const publicationHead = await getPublicationHead(database, tx, input, true);
  if (!publicationHead) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_MISSING",
      "Current publication bootstrap requires a published head",
    );
  }
  const publication = await requirePublicationById(
    database,
    tx,
    input,
    publicationHead.publicationId,
    true,
  );
  if (publication.status !== "published") {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_INVALID",
      "Current publication head does not reference a published row",
    );
  }
  const embeddingHead = await getProfileHead(database, tx, input, "embedding", true);
  const retrievalHead = await getProfileHead(database, tx, input, "retrieval", true);
  if (!retrievalHead) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_RETRIEVAL_PROFILE_REQUIRED",
      "Current publication bootstrap requires a retrieval profile head",
    );
  }
  const embedding = embeddingHead
    ? await requireHeadProfile(database, tx, input, "embedding", embeddingHead, true)
    : undefined;
  const retrieval = await requireHeadProfile(database, tx, input, "retrieval", retrievalHead, true);
  if (embedding) {
    requireState(embedding, "active", "embedding head profile");
    await assertEmbeddingPublicationVectorSpace(
      database,
      tx,
      publication,
      requireVectorSpaceId(embedding),
    );
  }
  requireState(retrieval, "active", "retrieval head profile");
  if (!embedding) await requireNoExpectedEmbeddingSource(database, tx, input);
  requireResearchOnlyWhenEmbeddingIsAbsent(embedding, retrieval);
  const tuple = legacyBinding(input, embedding, retrieval, publication);
  const existing = await getBindingByPublication(database, tx, publication, true);
  if (existing) {
    assertSameBinding(existing, tuple);
    if (!existing.activatedAt) {
      throw transition(
        "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_NOT_ACTIVE",
        "Existing current-publication binding is not activated",
      );
    }
    return { ...existing, activatedAt: existing.activatedAt };
  }
  const inserted = await insertBinding(database, tx, tuple, bindingId);
  return { ...inserted, activatedAt: input.verifiedAt };
}

type BindingDraft = Omit<KnowledgeSpaceProfilePublicationBinding, "id">;

function normalizeScope(input: KnowledgeSpaceProfilePublicationScope) {
  return {
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeKind(kind: KnowledgeSpaceProfileKind): KnowledgeSpaceProfileKind {
  if (!KnowledgeSpaceProfileKinds.includes(kind)) throw new Error(`Invalid profile kind=${kind}`);
  return kind;
}

function normalizeCandidateInput(input: BindKnowledgeSpaceProfilePublicationCandidateInput) {
  return {
    ...normalizeScope(input),
    changedKind: normalizeKind(input.changedKind),
    createdAt: DateTimeSchema.parse(input.createdAt),
    profileRevision: positiveInteger(input.profileRevision, "profileRevision"),
    publicationFingerprint: ProjectionSetFingerprintSchema.parse(input.publicationFingerprint),
  };
}

function normalizeActivationInput(input: ActivateKnowledgeSpaceProfilePublicationCandidateInput) {
  return {
    ...normalizeScope(input),
    changedKind: normalizeKind(input.changedKind),
    expectedProfileHeadRevision:
      input.expectedProfileHeadRevision === null
        ? null
        : positiveInteger(input.expectedProfileHeadRevision, "expectedProfileHeadRevision"),
    expectedPublicationHeadRevision: nonnegativeInteger(
      input.expectedPublicationHeadRevision,
      "expectedPublicationHeadRevision",
    ),
    profileRevision: positiveInteger(input.profileRevision, "profileRevision"),
    publicationFingerprint: ProjectionSetFingerprintSchema.parse(input.publicationFingerprint),
    migrationFence: normalizeMigrationFence(input.migrationFence),
    updatedAt: DateTimeSchema.parse(input.updatedAt),
  };
}

function normalizeMigrationFence(
  fence: KnowledgeSpaceProfileMigrationFence | undefined,
): KnowledgeSpaceProfileMigrationFence {
  if (!fence) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_MIGRATION_FENCE_REQUIRED",
      "Candidate publication activation requires a durable profile migration fence",
    );
  }
  return {
    expectedRowVersion: positiveInteger(
      fence.expectedRowVersion,
      "migrationFence.expectedRowVersion",
    ),
    leaseToken: nonempty(fence.leaseToken, "migrationFence.leaseToken"),
    now: DateTimeSchema.parse(fence.now),
    runId: UuidSchema.parse(fence.runId),
  };
}

function normalizeLegacyInput(input: BindExistingKnowledgeSpaceProfilePublicationInput) {
  return {
    ...normalizeScope(input),
    embeddingProfileRevision:
      input.embeddingProfileRevision === null
        ? null
        : positiveInteger(input.embeddingProfileRevision, "embeddingProfileRevision"),
    expectedPublicationHeadRevision: positiveInteger(
      input.expectedPublicationHeadRevision,
      "expectedPublicationHeadRevision",
    ),
    publicationFingerprint: ProjectionSetFingerprintSchema.parse(input.publicationFingerprint),
    retrievalProfileRevision: positiveInteger(
      input.retrievalProfileRevision,
      "retrievalProfileRevision",
    ),
    verifiedAt: DateTimeSchema.parse(input.verifiedAt),
  };
}

async function requireWritableSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfilePublicationScope,
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, scope))) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_SPACE_NOT_WRITABLE",
      "Knowledge space is missing, deleting, or fenced by an active deletion job",
    );
  }
}

function candidateBinding(
  input: ReturnType<typeof normalizeCandidateInput>,
  embedding: ProfileRecord | undefined,
  retrieval: ProfileRecord,
  publication: PublicationRecord,
): BindingDraft {
  return {
    bindingReason: "candidate-switch",
    changedKind: input.changedKind,
    createdAt: input.createdAt,
    ...(embedding ? { embeddingProfile: profileReference(embedding) } : {}),
    knowledgeSpaceId: input.knowledgeSpaceId,
    publicationFingerprint: publication.fingerprint,
    publicationId: publication.id,
    retrievalProfile: profileReference(retrieval),
    tenantId: input.tenantId,
    ...(embedding ? { vectorSpaceId: requireVectorSpaceId(embedding) } : {}),
  };
}

function legacyBinding(
  input: KnowledgeSpaceProfilePublicationScope & { readonly verifiedAt: string },
  embedding: ProfileRecord | undefined,
  retrieval: ProfileRecord,
  publication: PublicationRecord,
): BindingDraft {
  return {
    activatedAt: input.verifiedAt,
    bindingReason: "legacy-bootstrap",
    changedKind: "bootstrap",
    createdAt: input.verifiedAt,
    ...(embedding ? { embeddingProfile: profileReference(embedding) } : {}),
    knowledgeSpaceId: input.knowledgeSpaceId,
    publicationFingerprint: publication.fingerprint,
    publicationId: publication.id,
    retrievalProfile: profileReference(retrieval),
    tenantId: input.tenantId,
    ...(embedding ? { vectorSpaceId: requireVectorSpaceId(embedding) } : {}),
  };
}

function profileReference(
  profile: ProfileRecord,
): KnowledgeSpaceProfilePublicationProfileReference {
  return { id: profile.id, revision: profile.revision, snapshotDigest: profile.snapshotDigest };
}

async function insertBinding(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  binding: BindingDraft,
  id: string,
): Promise<KnowledgeSpaceProfilePublicationBinding> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "changed_kind",
    "binding_reason",
    "embedding_profile_kind",
    "embedding_profile_revision_id",
    "embedding_profile_revision",
    "embedding_profile_snapshot_digest",
    "retrieval_profile_kind",
    "retrieval_profile_revision_id",
    "retrieval_profile_revision",
    "retrieval_profile_snapshot_digest",
    "vector_space_id",
    "publication_id",
    "publication_fingerprint",
    "created_at",
    "activated_at",
  ] as const;
  const params: readonly DatabaseQueryValue[] = [
    id,
    binding.tenantId,
    binding.knowledgeSpaceId,
    binding.changedKind,
    binding.bindingReason,
    binding.embeddingProfile ? "embedding" : null,
    binding.embeddingProfile?.id ?? null,
    binding.embeddingProfile?.revision ?? null,
    binding.embeddingProfile?.snapshotDigest ?? null,
    "retrieval",
    binding.retrievalProfile.id,
    binding.retrievalProfile.revision,
    binding.retrievalProfile.snapshotDigest,
    binding.vectorSpaceId ?? null,
    binding.publicationId,
    binding.publicationFingerprint,
    binding.createdAt,
    binding.activatedAt ?? null,
  ];
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, KnowledgeSpaceProfilePublicationBindingTableName)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")});`,
    tableName: KnowledgeSpaceProfilePublicationBindingTableName,
  });
  if (result.rowsAffected !== 1) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_CONFLICT",
      "Publication tuple binding was not inserted",
    );
  }
  return { ...binding, id };
}

async function getBindingByPublication(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceProfilePublicationScope & {
    readonly id?: string;
    readonly publicationId?: string;
  },
  forUpdate: boolean,
): Promise<KnowledgeSpaceProfilePublicationBinding | null> {
  const publicationId = input.publicationId ?? input.id;
  if (!publicationId) throw new Error("publicationId is required");
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, publicationId],
    sql: `SELECT * FROM ${q(
      database,
      KnowledgeSpaceProfilePublicationBindingTableName,
    )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 2)} AND ${q(database, "publication_id")} = ${p(
      database,
      3,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: KnowledgeSpaceProfilePublicationBindingTableName,
  });
  return result.rows[0] ? mapKnowledgeSpaceProfilePublicationBindingRow(result.rows[0]) : null;
}

export function mapKnowledgeSpaceProfilePublicationBindingRow(
  row: DatabaseRow,
): KnowledgeSpaceProfilePublicationBinding {
  const changedKind = stringColumn(row, "changed_kind");
  if (
    changedKind !== "embedding" &&
    changedKind !== "retrieval" &&
    changedKind !== "bootstrap" &&
    changedKind !== "content"
  ) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_CORRUPT",
      `Invalid binding changed_kind=${changedKind}`,
    );
  }
  const reason = stringColumn(row, "binding_reason");
  if (
    reason !== "candidate-switch" &&
    reason !== "legacy-bootstrap" &&
    reason !== "content-publication"
  ) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_CORRUPT",
      `Invalid binding_reason=${reason}`,
    );
  }
  const embeddingId = optionalStringColumn(row, "embedding_profile_revision_id");
  const embeddingRevision = optionalNumber(row, "embedding_profile_revision");
  const embeddingDigest = optionalStringColumn(row, "embedding_profile_snapshot_digest");
  const hasEmbedding =
    embeddingId !== undefined || embeddingRevision !== undefined || embeddingDigest !== undefined;
  if (hasEmbedding && (!embeddingId || !embeddingRevision || !embeddingDigest)) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_CORRUPT",
      "Embedding tuple is partially populated",
    );
  }
  const vectorSpaceId = optionalStringColumn(row, "vector_space_id");
  if ((hasEmbedding && !vectorSpaceId) || (!hasEmbedding && vectorSpaceId)) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_CORRUPT",
      "Embedding tuple and vector-space identity disagree",
    );
  }
  const embeddingProfile =
    embeddingId && embeddingRevision !== undefined && embeddingDigest
      ? {
          id: UuidSchema.parse(embeddingId),
          revision: positiveInteger(embeddingRevision, "embeddingProfileRevision"),
          snapshotDigest: digest(embeddingDigest),
        }
      : undefined;
  const activatedAt = optionalStringColumn(row, "activated_at");
  return {
    ...(activatedAt ? { activatedAt: DateTimeSchema.parse(activatedAt) } : {}),
    bindingReason: reason,
    changedKind,
    createdAt: DateTimeSchema.parse(stringColumn(row, "created_at")),
    ...(embeddingProfile ? { embeddingProfile } : {}),
    id: UuidSchema.parse(stringColumn(row, "id")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    publicationFingerprint: ProjectionSetFingerprintSchema.parse(
      stringColumn(row, "publication_fingerprint"),
    ),
    publicationId: UuidSchema.parse(stringColumn(row, "publication_id")),
    retrievalProfile: {
      id: UuidSchema.parse(stringColumn(row, "retrieval_profile_revision_id")),
      revision: positiveInteger(
        numberColumn(row, "retrieval_profile_revision"),
        "retrievalProfileRevision",
      ),
      snapshotDigest: digest(stringColumn(row, "retrieval_profile_snapshot_digest")),
    },
    tenantId: TenantIdSchema.parse(stringColumn(row, "tenant_id")),
    ...(vectorSpaceId ? { vectorSpaceId } : {}),
  };
}

async function getProfileHead(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfilePublicationScope,
  kind: KnowledgeSpaceProfileKind,
  forUpdate: boolean,
): Promise<ProfileHead | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, kind],
    sql: `SELECT * FROM ${q(database, profileHeadTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: profileHeadTable,
  });
  const row = result.rows[0];
  return row
    ? {
        activeRevision: positiveInteger(numberColumn(row, "active_revision"), "activeRevision"),
        profileRevisionId: UuidSchema.parse(stringColumn(row, "profile_revision_id")),
        rowVersion: positiveInteger(numberColumn(row, "row_version"), "profileHeadRowVersion"),
      }
    : null;
}

async function requireProfileByRevision(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfilePublicationScope,
  kind: KnowledgeSpaceProfileKind,
  revision: number,
  forUpdate: boolean,
): Promise<ProfileRecord> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, kind, revision],
    sql: `SELECT * FROM ${q(database, profileRevisionTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)} AND ${q(
      database,
      "revision",
    )} = ${p(database, 4)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: profileRevisionTable,
  });
  if (!result.rows[0]) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_NOT_FOUND",
      `${kind} profile revision=${revision} was not found`,
    );
  }
  return mapProfile(result.rows[0], scope, kind);
}

async function requireHeadProfile(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfilePublicationScope,
  kind: KnowledgeSpaceProfileKind,
  head: ProfileHead,
  forUpdate: boolean,
): Promise<ProfileRecord> {
  const profile = await requireProfileByRevision(
    database,
    executor,
    scope,
    kind,
    head.activeRevision,
    forUpdate,
  );
  if (profile.id !== head.profileRevisionId) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_INVALID",
      `${kind} profile head points to a different immutable revision`,
    );
  }
  return profile;
}

function mapProfile(
  row: DatabaseRow,
  scope: KnowledgeSpaceProfilePublicationScope,
  kind: KnowledgeSpaceProfileKind,
): ProfileRecord {
  if (
    stringColumn(row, "tenant_id") !== scope.tenantId ||
    stringColumn(row, "knowledge_space_id") !== scope.knowledgeSpaceId ||
    stringColumn(row, "kind") !== kind
  ) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT",
      "Profile revision scope does not match its lookup tuple",
    );
  }
  const snapshot = jsonObjectColumn(row, "snapshot");
  const snapshotDigest = digest(stringColumn(row, "snapshot_digest"));
  if (knowledgeSpaceProfileSnapshotDigest(snapshot) !== snapshotDigest) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT",
      "Profile revision snapshot digest is invalid",
    );
  }
  const parsed =
    kind === "embedding"
      ? KnowledgeSpaceEmbeddingProfileSchema.parse(snapshot)
      : KnowledgeSpaceRetrievalProfileSchema.parse(snapshot);
  const capabilitySnapshot = jsonObjectColumn(row, "capability_snapshot");
  const capabilityDigest = digest(stringColumn(row, "capability_snapshot_digest"));
  if (knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot) !== capabilityDigest) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_CAPABILITY_CORRUPT",
      "Profile capability snapshot digest is invalid",
    );
  }
  assertVerifiedCapability(kind, parsed, capabilitySnapshot);
  const revision = positiveInteger(numberColumn(row, "revision"), "profileRevision");
  if (parsed.revision !== revision) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT",
      "Profile snapshot revision differs from its immutable row",
    );
  }
  const vectorSpaceId = optionalStringColumn(row, "vector_space_id");
  if (
    (kind === "embedding" &&
      vectorSpaceId !== KnowledgeSpaceEmbeddingProfileSchema.parse(parsed).vectorSpaceId) ||
    (kind === "retrieval" && vectorSpaceId !== undefined)
  ) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT",
      "Profile vector-space identity differs from its immutable snapshot",
    );
  }
  return {
    ...(kind === "retrieval"
      ? { defaultMode: KnowledgeSpaceRetrievalProfileSchema.parse(parsed).defaultMode }
      : {}),
    id: UuidSchema.parse(stringColumn(row, "id")),
    kind,
    knowledgeSpaceId: scope.knowledgeSpaceId,
    revision,
    snapshotDigest,
    state: stringColumn(row, "state"),
    tenantId: scope.tenantId,
    ...(vectorSpaceId ? { vectorSpaceId } : {}),
  };
}

function assertVerifiedCapability(
  kind: KnowledgeSpaceProfileKind,
  profile:
    | ReturnType<typeof KnowledgeSpaceEmbeddingProfileSchema.parse>
    | ReturnType<typeof KnowledgeSpaceRetrievalProfileSchema.parse>,
  rawCapability: Readonly<Record<string, unknown>>,
): void {
  const sameSelection = (
    capability: ReturnType<typeof ModelCapabilitySnapshotSchema.parse>,
    selection: { readonly model: string; readonly pluginId: string; readonly provider: string },
  ) =>
    capability.selection.model === selection.model &&
    capability.selection.pluginId === selection.pluginId &&
    capability.selection.provider === selection.provider;
  if (kind === "embedding") {
    const embeddingProfile = KnowledgeSpaceEmbeddingProfileSchema.parse(profile);
    const capability = ModelCapabilitySnapshotSchema.safeParse(rawCapability);
    if (
      !capability.success ||
      capability.data.kind !== "embedding" ||
      !sameSelection(capability.data, embeddingProfile) ||
      embeddingProfile.dimension === undefined ||
      capability.data.dimension !== embeddingProfile.dimension
    ) {
      throw transition(
        "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_CAPABILITY_UNVERIFIED",
        "Embedding profile lacks an exact verified model preflight snapshot",
      );
    }
    return;
  }
  const retrievalProfile = KnowledgeSpaceRetrievalProfileSchema.parse(profile);
  const verification = rawCapability.verification;
  const reasoning = ModelCapabilitySnapshotSchema.safeParse(rawCapability.reasoning);
  const rerankRaw = rawCapability.rerank;
  const rerank = rerankRaw === null ? null : ModelCapabilitySnapshotSchema.safeParse(rerankRaw);
  if (
    verification !== "verified" ||
    !reasoning.success ||
    reasoning.data.kind !== "reasoning" ||
    !sameSelection(reasoning.data, retrievalProfile.reasoningModel) ||
    (retrievalProfile.rerank.enabled &&
      (!rerank ||
        !rerank.success ||
        rerank.data.kind !== "rerank" ||
        !retrievalProfile.rerank.model ||
        !sameSelection(rerank.data, retrievalProfile.rerank.model))) ||
    (!retrievalProfile.rerank.enabled && rerankRaw !== null)
  ) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_CAPABILITY_UNVERIFIED",
      "Retrieval profile lacks exact verified reasoning/rerank preflight snapshots",
    );
  }
}

async function getPublicationHead(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfilePublicationScope,
  forUpdate: boolean,
): Promise<PublicationHead | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId],
    sql: `SELECT * FROM ${q(database, publicationHeadTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: publicationHeadTable,
  });
  const row = result.rows[0];
  return row
    ? {
        headRevision: positiveInteger(
          numberColumn(row, "head_revision"),
          "publicationHeadRevision",
        ),
        publicationId: UuidSchema.parse(stringColumn(row, "publication_id")),
      }
    : null;
}

async function requirePublicationByFingerprint(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceProfilePublicationScope & { readonly publicationFingerprint: string },
  forUpdate: boolean,
): Promise<PublicationRecord> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.publicationFingerprint],
    sql: `SELECT ${["id", "tenant_id", "knowledge_space_id", "fingerprint", "status"]
      .map((column) => q(database, column))
      .join(", ")} FROM ${q(database, publicationTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "fingerprint")} = ${p(database, 3)} LIMIT 1${
      forUpdate ? " FOR UPDATE" : ""
    };`,
    tableName: publicationTable,
  });
  if (!result.rows[0]) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_FOUND",
      `Publication ${input.publicationFingerprint} was not found`,
    );
  }
  return mapPublication(result.rows[0]);
}

async function requirePublicationById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfilePublicationScope,
  publicationId: string,
  forUpdate: boolean,
): Promise<PublicationRecord> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, publicationId],
    sql: `SELECT ${["id", "tenant_id", "knowledge_space_id", "fingerprint", "status"]
      .map((column) => q(database, column))
      .join(", ")} FROM ${q(database, publicationTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "id")} = ${p(database, 3)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: publicationTable,
  });
  if (!result.rows[0]) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_INVALID",
      "Publication head references a missing row",
    );
  }
  return mapPublication(result.rows[0]);
}

function mapPublication(row: DatabaseRow): PublicationRecord {
  return {
    fingerprint: ProjectionSetFingerprintSchema.parse(stringColumn(row, "fingerprint")),
    id: UuidSchema.parse(stringColumn(row, "id")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    status: stringColumn(row, "status"),
    tenantId: TenantIdSchema.parse(stringColumn(row, "tenant_id")),
  };
}

async function requireBoundProfileOrAbsence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfilePublicationScope,
  kind: KnowledgeSpaceProfileKind,
  reference: KnowledgeSpaceProfilePublicationProfileReference | undefined,
  head: ProfileHead | null,
  changedKind: KnowledgeSpaceProfileKind,
  candidate: ProfileRecord,
): Promise<ProfileRecord | undefined> {
  if (kind === changedKind) {
    if (!reference) {
      throw transition(
        "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_INVALID",
        `${kind} candidate tuple is missing`,
      );
    }
    assertProfileReference(candidate, reference);
    return candidate;
  }
  if (!reference) {
    if (head) {
      throw new KnowledgeSpaceProfilePublicationProfileHeadConflictError(null, head.activeRevision);
    }
    return undefined;
  }
  if (!head || head.activeRevision !== reference.revision) {
    throw new KnowledgeSpaceProfilePublicationProfileHeadConflictError(
      reference.revision,
      head?.activeRevision ?? null,
    );
  }
  const profile = await requireHeadProfile(database, executor, scope, kind, head, true);
  requireState(profile, "active", `${kind} companion profile`);
  assertProfileReference(profile, reference);
  return profile;
}

function assertProfileReference(
  profile: ProfileRecord,
  reference: KnowledgeSpaceProfilePublicationProfileReference,
): void {
  if (
    profile.id !== reference.id ||
    profile.revision !== reference.revision ||
    profile.snapshotDigest !== reference.snapshotDigest
  ) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_INVALID",
      "Binding profile id/revision/digest does not match the locked immutable revision",
    );
  }
}

function assertSameBinding(
  actual: KnowledgeSpaceProfilePublicationBinding,
  expected: BindingDraft,
): void {
  const comparable = (binding: KnowledgeSpaceProfilePublicationBinding | BindingDraft) => ({
    bindingReason: binding.bindingReason,
    changedKind: binding.changedKind,
    embeddingProfile: binding.embeddingProfile,
    knowledgeSpaceId: binding.knowledgeSpaceId,
    publicationFingerprint: binding.publicationFingerprint,
    publicationId: binding.publicationId,
    retrievalProfile: binding.retrievalProfile,
    tenantId: binding.tenantId,
    vectorSpaceId: binding.vectorSpaceId,
  });
  if (JSON.stringify(comparable(actual)) !== JSON.stringify(comparable(expected))) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_CONFLICT",
      "Publication already has another immutable profile tuple",
    );
  }
}

function requireResearchOnlyWhenEmbeddingIsAbsent(
  embedding: ProfileRecord | undefined,
  retrieval: ProfileRecord,
): void {
  if (!embedding && retrieval.defaultMode !== "research") {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_EMBEDDING_REQUIRED",
      "A publication without an embedding profile is only valid for Research retrieval",
    );
  }
}

async function requireNoExpectedEmbeddingSource(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfilePublicationScope,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId],
    sql: `SELECT ${q(database, "metadata")} FROM ${q(
      database,
      manifestTable,
    )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
    tableName: manifestTable,
  });
  const row = result.rows[0];
  if (!row) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_MANIFEST_MISSING",
      "Cannot prove that the knowledge space intentionally has no embedding profile",
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(
      jsonObjectColumn(row, "metadata"),
      legacyEmbeddingProfileMetadataKey,
    )
  ) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_READY",
      "The manifest declares an embedding profile whose active head is not ready",
    );
  }
}

function requireState(record: { readonly state: string }, expected: string, label: string): void {
  if (record.state !== expected) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_STATE_CONFLICT",
      `${label} is ${record.state}, expected ${expected}`,
    );
  }
}

async function transitionProfile(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  profile: ProfileRecord,
  nextState: "active" | "superseded",
  now: string,
): Promise<void> {
  const expectedState = nextState === "active" ? "candidate" : "active";
  const timestampColumn = nextState === "active" ? "activated_at" : "superseded_at";
  await requireAffectedOne(
    executor,
    {
      maxRows: 0,
      operation: "update",
      params: [
        nextState,
        now,
        now,
        profile.id,
        profile.tenantId,
        profile.knowledgeSpaceId,
        profile.kind,
        profile.revision,
        expectedState,
      ],
      sql: `UPDATE ${q(database, profileRevisionTable)} SET ${q(
        database,
        "state",
      )} = ${p(database, 1)}, ${q(database, timestampColumn)} = ${p(
        database,
        2,
      )}, ${q(database, "updated_at")} = ${p(database, 3)} WHERE ${q(
        database,
        "id",
      )} = ${p(database, 4)} AND ${q(database, "tenant_id")} = ${p(
        database,
        5,
      )} AND ${q(database, "knowledge_space_id")} = ${p(
        database,
        6,
      )} AND ${q(database, "kind")} = ${p(database, 7)} AND ${q(
        database,
        "revision",
      )} = ${p(database, 8)} AND ${q(database, "state")} = ${p(database, 9)};`,
      tableName: profileRevisionTable,
    },
    "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_TRANSITION_CONFLICT",
  );
}

async function transitionPublication(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  publication: PublicationRecord,
  nextState: "published" | "superseded",
  now: string,
  supersededBy: string | null,
): Promise<void> {
  await requireAffectedOne(
    executor,
    {
      maxRows: 0,
      operation: "update",
      params: [
        nextState,
        supersededBy,
        now,
        publication.id,
        publication.tenantId,
        publication.knowledgeSpaceId,
        publication.status,
      ],
      sql: `UPDATE ${q(database, publicationTable)} SET ${q(
        database,
        "status",
      )} = ${p(database, 1)}, ${q(database, "superseded_by_fingerprint")} = ${p(
        database,
        2,
      )}, ${q(database, "updated_at")} = ${p(database, 3)} WHERE ${q(
        database,
        "id",
      )} = ${p(database, 4)} AND ${q(database, "tenant_id")} = ${p(
        database,
        5,
      )} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(
        database,
        "status",
      )} = ${p(database, 7)};`,
      tableName: publicationTable,
    },
    "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_TRANSITION_CONFLICT",
  );
}

async function advanceProfileHead(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ReturnType<typeof normalizeActivationInput>,
  profile: ProfileRecord,
  head: ProfileHead | null,
  generateId: () => string,
): Promise<number> {
  if (!head) {
    const params: readonly DatabaseQueryValue[] = [
      nonzeroUuid(generateId(), "profileHeadId"),
      input.tenantId,
      input.knowledgeSpaceId,
      input.changedKind,
      profile.id,
      profile.revision,
      1,
      input.updatedAt,
      input.updatedAt,
    ];
    await requireAffectedOne(
      executor,
      {
        maxRows: 0,
        operation: "insert",
        params,
        sql: `INSERT INTO ${q(database, profileHeadTable)} (${[
          "id",
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "profile_revision_id",
          "active_revision",
          "row_version",
          "created_at",
          "updated_at",
        ]
          .map((column) => q(database, column))
          .join(", ")}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")});`,
        tableName: profileHeadTable,
      },
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
    );
    return 1;
  }
  const nextRowVersion = head.rowVersion + 1;
  await requireAffectedOne(
    executor,
    {
      maxRows: 0,
      operation: "update",
      params: [
        profile.id,
        profile.revision,
        nextRowVersion,
        input.updatedAt,
        input.tenantId,
        input.knowledgeSpaceId,
        input.changedKind,
        head.activeRevision,
        head.rowVersion,
      ],
      sql: `UPDATE ${q(database, profileHeadTable)} SET ${q(
        database,
        "profile_revision_id",
      )} = ${p(database, 1)}, ${q(database, "active_revision")} = ${p(
        database,
        2,
      )}, ${q(database, "row_version")} = ${p(database, 3)}, ${q(
        database,
        "updated_at",
      )} = ${p(database, 4)} WHERE ${q(database, "tenant_id")} = ${p(
        database,
        5,
      )} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(
        database,
        "kind",
      )} = ${p(database, 7)} AND ${q(database, "active_revision")} = ${p(
        database,
        8,
      )} AND ${q(database, "row_version")} = ${p(database, 9)};`,
      tableName: profileHeadTable,
    },
    "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
  );
  return nextRowVersion;
}

async function advancePublicationHead(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ReturnType<typeof normalizeActivationInput>,
  publication: PublicationRecord,
  generateId: () => string,
): Promise<number> {
  const nextRevision = input.expectedPublicationHeadRevision + 1;
  if (input.expectedPublicationHeadRevision === 0) {
    const params: readonly DatabaseQueryValue[] = [
      nonzeroUuid(generateId(), "publicationHeadId"),
      input.tenantId,
      input.knowledgeSpaceId,
      publication.id,
      nextRevision,
      input.updatedAt,
      input.updatedAt,
    ];
    await requireAffectedOne(
      executor,
      {
        maxRows: 0,
        operation: "insert",
        params,
        sql: `INSERT INTO ${q(database, publicationHeadTable)} (${[
          "id",
          "tenant_id",
          "knowledge_space_id",
          "publication_id",
          "head_revision",
          "created_at",
          "updated_at",
        ]
          .map((column) => q(database, column))
          .join(", ")}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")});`,
        tableName: publicationHeadTable,
      },
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_CONFLICT",
    );
    return nextRevision;
  }
  await requireAffectedOne(
    executor,
    {
      maxRows: 0,
      operation: "update",
      params: [
        publication.id,
        nextRevision,
        input.updatedAt,
        input.tenantId,
        input.knowledgeSpaceId,
        input.expectedPublicationHeadRevision,
      ],
      sql: `UPDATE ${q(database, publicationHeadTable)} SET ${q(
        database,
        "publication_id",
      )} = ${p(database, 1)}, ${q(database, "head_revision")} = ${p(
        database,
        2,
      )}, ${q(database, "updated_at")} = ${p(database, 3)} WHERE ${q(
        database,
        "tenant_id",
      )} = ${p(database, 4)} AND ${q(database, "knowledge_space_id")} = ${p(
        database,
        5,
      )} AND ${q(database, "head_revision")} = ${p(database, 6)};`,
      tableName: publicationHeadTable,
    },
    "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_CONFLICT",
  );
  return nextRevision;
}

async function activateBinding(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  binding: KnowledgeSpaceProfilePublicationBinding,
  activatedAt: string,
): Promise<void> {
  await requireAffectedOne(
    executor,
    {
      maxRows: 0,
      operation: "update",
      params: [
        activatedAt,
        binding.id,
        binding.tenantId,
        binding.knowledgeSpaceId,
        binding.publicationId,
      ],
      sql: `UPDATE ${q(
        database,
        KnowledgeSpaceProfilePublicationBindingTableName,
      )} SET ${q(database, "activated_at")} = ${p(database, 1)} WHERE ${q(
        database,
        "id",
      )} = ${p(database, 2)} AND ${q(database, "tenant_id")} = ${p(
        database,
        3,
      )} AND ${q(database, "knowledge_space_id")} = ${p(
        database,
        4,
      )} AND ${q(database, "publication_id")} = ${p(
        database,
        5,
      )} AND ${q(database, "binding_reason")} = 'candidate-switch' AND ${q(
        database,
        "activated_at",
      )} IS NULL;`,
      tableName: KnowledgeSpaceProfilePublicationBindingTableName,
    },
    "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_ACTIVATION_CONFLICT",
  );
}

async function assertEmbeddingPublicationVectorSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  publication: PublicationRecord,
  vectorSpaceId: string,
): Promise<void> {
  const params: readonly DatabaseQueryValue[] = [
    publication.tenantId,
    publication.knowledgeSpaceId,
    publication.id,
    vectorSpaceId,
  ];
  const mismatch = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ip.${q(database, "id")} FROM ${q(
      database,
      "projection_set_publication_members",
    )} pm JOIN ${q(database, "index_projections")} ip ON ip.${q(
      database,
      "id",
    )} = pm.${q(database, "component_key")} AND ip.${q(
      database,
      "knowledge_space_id",
    )} = pm.${q(database, "knowledge_space_id")} AND ip.${q(
      database,
      "publication_generation_id",
    )} = pm.${q(database, "generation_id")} WHERE pm.${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND pm.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND pm.${q(database, "publication_id")} = ${p(database, 3)} AND pm.${q(
      database,
      "component_type",
    )} = 'index-projection' AND ip.${q(database, "type")} = 'dense-vector' AND (ip.${q(
      database,
      "status",
    )} <> 'ready' OR ip.${q(database, "model")} IS NULL OR ip.${q(
      database,
      "model",
    )} <> ${p(database, 4)} OR ip.${q(database, "dense_vector")} IS NULL) AND ip.${q(
      database,
      "visual_vector",
    )} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: "index_projections",
  });
  if (mismatch.rows[0]) throw new KnowledgeSpaceProfilePublicationVectorSpaceConflictError();

  const missing = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT fts.${q(database, "id")} FROM ${q(
      database,
      "projection_set_publication_members",
    )} fm JOIN ${q(database, "index_projections")} fts ON fts.${q(
      database,
      "id",
    )} = fm.${q(database, "component_key")} AND fts.${q(
      database,
      "knowledge_space_id",
    )} = fm.${q(database, "knowledge_space_id")} AND fts.${q(
      database,
      "publication_generation_id",
    )} = fm.${q(database, "generation_id")} WHERE fm.${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND fm.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND fm.${q(database, "publication_id")} = ${p(database, 3)} AND fm.${q(
      database,
      "component_type",
    )} = 'index-projection' AND fts.${q(database, "type")} = 'fts' AND fts.${q(
      database,
      "status",
    )} = 'ready' AND NOT EXISTS (SELECT 1 FROM ${q(
      database,
      "projection_set_publication_members",
    )} dm JOIN ${q(database, "index_projections")} dense ON dense.${q(
      database,
      "id",
    )} = dm.${q(database, "component_key")} AND dense.${q(
      database,
      "knowledge_space_id",
    )} = dm.${q(database, "knowledge_space_id")} AND dense.${q(
      database,
      "publication_generation_id",
    )} = dm.${q(database, "generation_id")} WHERE dm.${q(
      database,
      "tenant_id",
    )} = fm.${q(database, "tenant_id")} AND dm.${q(
      database,
      "knowledge_space_id",
    )} = fm.${q(database, "knowledge_space_id")} AND dm.${q(
      database,
      "publication_id",
    )} = fm.${q(database, "publication_id")} AND dm.${q(
      database,
      "component_type",
    )} = 'index-projection' AND dense.${q(database, "node_id")} = fts.${q(
      database,
      "node_id",
    )} AND dense.${q(database, "type")} = 'dense-vector' AND dense.${q(
      database,
      "status",
    )} = 'ready' AND dense.${q(database, "model")} = ${p(
      database,
      4,
    )} AND dense.${q(database, "dense_vector")} IS NOT NULL AND dense.${q(
      database,
      "visual_vector",
    )} IS NULL) LIMIT 1 FOR UPDATE;`,
    tableName: "index_projections",
  });
  if (missing.rows[0]) throw new KnowledgeSpaceProfilePublicationVectorSpaceConflictError();
}

async function requireProfileMigrationExecutionFence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ReturnType<typeof normalizeActivationInput>,
  publication: PublicationRecord,
  fence: KnowledgeSpaceProfileMigrationFence,
): Promise<void> {
  const run = "migration_run";
  const snapshot = "permission_snapshot";
  const member = "permission_member";
  const policy = "permission_policy";
  const api = "permission_api";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      fence.runId,
      input.tenantId,
      input.knowledgeSpaceId,
      input.changedKind,
      input.profileRevision,
      publication.id,
      publication.fingerprint,
      input.expectedPublicationHeadRevision,
      fence.expectedRowVersion,
      fence.leaseToken,
      fence.now,
    ],
    sql: `SELECT ${run}.${q(database, "id")}, ${run}.${q(
      database,
      "requested_by_subject_id",
    )}, ${snapshot}.${q(database, "visibility")}, ${policy}.${q(
      database,
      "id",
    )} AS ${q(database, "access_policy_id")}, ${snapshot}.${q(
      database,
      "api_key_id",
    )}, ${snapshot}.${q(database, "api_key_revision")}, ${snapshot}.${q(
      database,
      "api_key_expires_at",
    )} FROM ${q(database, "knowledge_space_profile_migration_runs")} ${run} INNER JOIN ${q(
      database,
      "knowledge_space_permission_snapshots",
    )} ${snapshot} ON ${snapshot}.${q(database, "tenant_id")} = ${run}.${q(
      database,
      "tenant_id",
    )} AND ${snapshot}.${q(database, "knowledge_space_id")} = ${run}.${q(
      database,
      "knowledge_space_id",
    )} AND ${snapshot}.${q(database, "id")} = ${run}.${q(
      database,
      "permission_snapshot_id",
    )} AND ${snapshot}.${q(database, "revision")} = ${run}.${q(
      database,
      "permission_snapshot_revision",
    )} INNER JOIN ${q(database, "knowledge_space_members")} ${member} ON ${member}.${q(
      database,
      "tenant_id",
    )} = ${snapshot}.${q(database, "tenant_id")} AND ${member}.${q(
      database,
      "knowledge_space_id",
    )} = ${snapshot}.${q(database, "knowledge_space_id")} AND ${member}.${q(
      database,
      "subject_id",
    )} = ${snapshot}.${q(database, "subject_id")} INNER JOIN ${q(
      database,
      "knowledge_space_access_policies",
    )} ${policy} ON ${policy}.${q(database, "tenant_id")} = ${snapshot}.${q(
      database,
      "tenant_id",
    )} AND ${policy}.${q(database, "knowledge_space_id")} = ${snapshot}.${q(
      database,
      "knowledge_space_id",
    )} INNER JOIN ${q(database, "knowledge_space_api_access")} ${api} ON ${api}.${q(
      database,
      "tenant_id",
    )} = ${snapshot}.${q(database, "tenant_id")} AND ${api}.${q(
      database,
      "knowledge_space_id",
    )} = ${snapshot}.${q(database, "knowledge_space_id")} WHERE ${run}.${q(
      database,
      "id",
    )} = ${p(database, 1)} AND ${run}.${q(database, "tenant_id")} = ${p(
      database,
      2,
    )} AND ${run}.${q(database, "knowledge_space_id")} = ${p(
      database,
      3,
    )} AND ${run}.${q(database, "changed_kind")} = ${p(database, 4)} AND ${run}.${q(
      database,
      "candidate_profile_revision",
    )} = ${p(database, 5)} AND ${run}.${q(database, "candidate_publication_id")} = ${p(
      database,
      6,
    )} AND ${run}.${q(database, "candidate_publication_fingerprint")} = ${p(
      database,
      7,
    )} AND ${run}.${q(database, "base_publication_head_revision")} = ${p(
      database,
      8,
    )} AND ${run}.${q(database, "row_version")} = ${p(database, 9)} AND ${run}.${q(
      database,
      "lease_token",
    )} = ${p(database, 10)} AND ${run}.${q(database, "lease_expires_at")} > ${p(
      database,
      11,
    )} AND ${run}.${q(database, "run_state")} = 'running' AND ${run}.${q(
      database,
      "active_slot",
    )} = 1 AND ${run}.${q(database, "checkpoint")} = 'evaluated' AND ${snapshot}.${q(
      database,
      "subject_id",
    )} = ${run}.${q(database, "requested_by_subject_id")} AND ${snapshot}.${q(
      database,
      "access_channel",
    )} = ${run}.${q(database, "access_channel")} AND ${snapshot}.${q(
      database,
      "status",
    )} = 'active' AND ${snapshot}.${q(database, "expires_at")} > ${p(
      database,
      11,
    )} AND ${snapshot}.${q(database, "role")} = 'owner' AND ${snapshot}.${q(
      database,
      "role",
    )} = ${member}.${q(database, "role")} AND ${snapshot}.${q(
      database,
      "member_revision",
    )} = ${member}.${q(database, "revision")} AND ${snapshot}.${q(
      database,
      "access_policy_revision",
    )} = ${policy}.${q(database, "revision")} AND ${snapshot}.${q(
      database,
      "api_access_revision",
    )} = ${api}.${q(database, "revision")} AND ${snapshot}.${q(
      database,
      "visibility",
    )} = ${policy}.${q(database, "visibility")} AND (((${snapshot}.${q(
      database,
      "api_key_id",
    )} IS NULL AND ${snapshot}.${q(database, "api_key_revision")} IS NULL AND ${snapshot}.${q(
      database,
      "api_key_expires_at",
    )} IS NULL AND ${snapshot}.${q(database, "access_channel")} <> 'service_api') OR (${snapshot}.${q(
      database,
      "api_key_id",
    )} IS NOT NULL AND ${snapshot}.${q(database, "api_key_revision")} IS NOT NULL AND ${snapshot}.${q(
      database,
      "access_channel",
    )} = 'service_api'))) AND (${snapshot}.${q(
      database,
      "access_channel",
    )} = 'interactive' OR ${api}.${q(database, "enabled")} = TRUE) AND ((${policy}.${q(
      database,
      "visibility",
    )} = 'only_me' AND ${policy}.${q(database, "owner_subject_id")} = ${snapshot}.${q(
      database,
      "subject_id",
    )}) OR ${policy}.${q(database, "visibility")} = 'all_members' OR (${policy}.${q(
      database,
      "visibility",
    )} = 'partial_members' AND EXISTS (SELECT 1 FROM ${q(
      database,
      "knowledge_space_access_policy_members",
    )} permission_target WHERE permission_target.${q(database, "tenant_id")} = ${snapshot}.${q(
      database,
      "tenant_id",
    )} AND permission_target.${q(database, "knowledge_space_id")} = ${snapshot}.${q(
      database,
      "knowledge_space_id",
    )} AND permission_target.${q(database, "access_policy_id")} = ${policy}.${q(
      database,
      "id",
    )} AND permission_target.${q(database, "subject_id")} = ${snapshot}.${q(
      database,
      "subject_id",
    )})) LIMIT 1 FOR UPDATE;`,
    tableName: "knowledge_space_profile_migration_runs",
  });
  if (result.rows.length !== 1) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_MIGRATION_FENCE_LOST",
      "Profile migration activation lost its durable run/lease fence",
    );
  }
  const permission = result.rows[0];
  const apiKeyId = permission ? optionalStringColumn(permission, "api_key_id") : undefined;
  const apiKeyRevision = permission
    ? optionalNumberColumn(permission, "api_key_revision")
    : undefined;
  const apiKeyExpiresAt = permission
    ? optionalStringColumn(permission, "api_key_expires_at")
    : undefined;
  if (permission && optionalStringColumn(permission, "visibility") === "partial_members") {
    const target = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [
        input.tenantId,
        input.knowledgeSpaceId,
        stringColumn(permission, "access_policy_id"),
        stringColumn(permission, "requested_by_subject_id"),
      ],
      sql: `SELECT ${q(database, "subject_id")} FROM ${q(
        database,
        "knowledge_space_access_policy_members",
      )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
        database,
        "knowledge_space_id",
      )} = ${p(database, 2)} AND ${q(database, "access_policy_id")} = ${p(
        database,
        3,
      )} AND ${q(database, "subject_id")} = ${p(database, 4)} LIMIT 1 FOR UPDATE;`,
      tableName: "knowledge_space_access_policy_members",
    });
    if (target.rows.length !== 1) {
      throw transition(
        "KNOWLEDGE_SPACE_PROFILE_MIGRATION_PERMISSION_INVALID",
        "Profile migration partial-member permission is no longer valid",
      );
    }
  }
  if ((apiKeyId === undefined) !== (apiKeyRevision === undefined)) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_MIGRATION_PERMISSION_INVALID",
      "Profile migration permission has invalid API-key provenance",
    );
  }
  if (permission && apiKeyId && apiKeyRevision !== undefined) {
    const requestedBySubjectId = stringColumn(permission, "requested_by_subject_id");
    const apiKey = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [
        input.tenantId,
        input.knowledgeSpaceId,
        apiKeyId,
        apiKeyRevision,
        requestedBySubjectId,
        apiKeyExpiresAt ?? null,
        fence.now,
      ],
      sql: `SELECT ${q(database, "id")} FROM ${q(
        database,
        "knowledge_space_api_keys",
      )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
        database,
        "knowledge_space_id",
      )} = ${p(database, 2)} AND ${q(database, "id")} = ${p(
        database,
        3,
      )} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(
        database,
        "principal_subject_id",
      )} = ${p(database, 5)} AND ${q(
        database,
        "status",
      )} = 'active' AND ${q(database, "revoked_at")} IS NULL AND ((${p(
        database,
        6,
      )} IS NULL AND ${q(database, "expires_at")} IS NULL) OR ${q(
        database,
        "expires_at",
      )} = ${p(database, 6)}) AND (${q(database, "expires_at")} IS NULL OR ${q(
        database,
        "expires_at",
      )} > ${p(database, 7)}) LIMIT 1 FOR UPDATE;`,
      tableName: "knowledge_space_api_keys",
    });
    if (apiKey.rows.length !== 1) {
      throw transition(
        "KNOWLEDGE_SPACE_PROFILE_MIGRATION_PERMISSION_INVALID",
        "Profile migration API-key permission is no longer valid",
      );
    }
  }
}

async function completeProfileMigrationExecution(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ReturnType<typeof normalizeActivationInput>,
  fence: KnowledgeSpaceProfileMigrationFence,
): Promise<void> {
  const completed = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      input.updatedAt,
      fence.expectedRowVersion + 1,
      fence.runId,
      fence.expectedRowVersion,
      fence.leaseToken,
    ],
    sql: `UPDATE ${q(database, "knowledge_space_profile_migration_runs")} SET ${q(
      database,
      "run_state",
    )} = 'succeeded', ${q(database, "active_slot")} = NULL, ${q(
      database,
      "checkpoint",
    )} = 'activated', ${q(database, "worker_id")} = NULL, ${q(
      database,
      "lease_token",
    )} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(
      database,
      "heartbeat_at",
    )} = NULL, ${q(database, "completed_at")} = ${p(database, 1)}, ${q(
      database,
      "updated_at",
    )} = ${p(database, 1)}, ${q(database, "row_version")} = ${p(
      database,
      2,
    )} WHERE ${q(database, "id")} = ${p(database, 3)} AND ${q(
      database,
      "row_version",
    )} = ${p(database, 4)} AND ${q(database, "lease_token")} = ${p(
      database,
      5,
    )} AND ${q(database, "run_state")} = 'running' AND ${q(database, "checkpoint")} = 'evaluated';`,
    tableName: "knowledge_space_profile_migration_runs",
  });
  if (completed.rowsAffected !== 1) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_MIGRATION_FENCE_LOST",
      "Profile migration completion lost its durable run/lease fence",
    );
  }
  const outbox = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [input.updatedAt, fence.runId, fence.leaseToken],
    sql: `UPDATE ${q(database, "knowledge_space_profile_migration_outbox")} SET ${q(
      database,
      "status",
    )} = 'completed', ${q(database, "locked_by")} = NULL, ${q(
      database,
      "lock_token",
    )} = NULL, ${q(database, "locked_until")} = NULL, ${q(
      database,
      "delivered_at",
    )} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(
      database,
      1,
    )} WHERE ${q(database, "run_id")} = ${p(database, 2)} AND ${q(
      database,
      "status",
    )} = 'leased' AND ${q(database, "lock_token")} = ${p(database, 3)};`,
    tableName: "knowledge_space_profile_migration_outbox",
  });
  if (outbox.rowsAffected !== 1) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_MIGRATION_OUTBOX_FENCE_LOST",
      "Profile migration completion lost its leased outbox delivery",
    );
  }
}

async function promoteProfileMigrationPageIndexes(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  publication: PublicationRecord,
  updatedAt: string,
): Promise<void> {
  const members = await executor.execute({
    maxRows: 100_001,
    operation: "select",
    params: [publication.tenantId, publication.knowledgeSpaceId, publication.id],
    sql: `SELECT ${q(database, "component_key")}, ${q(
      database,
      "generation_id",
    )}, ${q(database, "document_asset_id")} FROM ${q(
      database,
      "projection_set_publication_members",
    )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 2)} AND ${q(database, "publication_id")} = ${p(
      database,
      3,
    )} AND ${q(database, "component_type")} = 'document-outline' ORDER BY ${q(
      database,
      "component_key",
    )} ASC;`,
    tableName: "projection_set_publication_members",
  });
  if (members.rows.length > 100_000) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PAGE_INDEX_INVALID",
      "Candidate publication PageIndex outline snapshot exceeds the safety bound",
    );
  }
  for (const member of members.rows) {
    const outlineId = UuidSchema.parse(stringColumn(member, "component_key"));
    const generationId = UuidSchema.parse(stringColumn(member, "generation_id"));
    const documentAssetId = UuidSchema.parse(stringColumn(member, "document_asset_id"));
    const manifest = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [publication.knowledgeSpaceId, outlineId, generationId, documentAssetId],
      sql: `SELECT ${q(database, "id")}, ${q(database, "status")} FROM ${q(
        database,
        "page_index_manifests",
      )} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(
        database,
        "document_outline_id",
      )} = ${p(database, 2)} AND ${q(database, "publication_generation_id")} = ${p(
        database,
        3,
      )} AND ${q(database, "document_asset_id")} = ${p(database, 4)} LIMIT 1 FOR UPDATE;`,
      tableName: "page_index_manifests",
    });
    const row = manifest.rows[0];
    if (!row || !["building", "ready"].includes(stringColumn(row, "status"))) {
      throw transition(
        "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PAGE_INDEX_INVALID",
        `Candidate outline ${outlineId} has no complete PageIndex manifest`,
      );
    }
    if (stringColumn(row, "status") === "building") {
      const promoted = await executor.execute({
        maxRows: 0,
        operation: "update",
        params: [updatedAt, UuidSchema.parse(stringColumn(row, "id"))],
        sql: `UPDATE ${q(database, "page_index_manifests")} SET ${q(
          database,
          "status",
        )} = 'ready', ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(
          database,
          "id",
        )} = ${p(database, 2)} AND ${q(database, "status")} = 'building';`,
        tableName: "page_index_manifests",
      });
      if (promoted.rowsAffected !== 1) {
        throw transition(
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PAGE_INDEX_INVALID",
          `Candidate outline ${outlineId} PageIndex promotion lost its fence`,
        );
      }
    }
  }
}

async function requireAffectedOne(
  executor: DatabaseExecutor,
  input: Parameters<DatabaseExecutor["execute"]>[0],
  code: string,
): Promise<void> {
  const result = await executor.execute(input);
  if (result.rowsAffected !== 1) {
    throw transition(code, `${input.tableName} mutation lost its affected-row fence`);
  }
}

function requireVectorSpaceId(profile: ProfileRecord): string {
  if (!profile.vectorSpaceId) {
    throw transition(
      "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT",
      "Embedding profile has no vector-space identity",
    );
  }
  return profile.vectorSpaceId;
}

function optionalNumber(row: DatabaseRow, column: string): number | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number") throw new Error(`Expected ${column} to be a number`);
  return value;
}

function digest(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("Digest must be lowercase SHA-256 hex");
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive`);
  return value;
}

function nonnegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be non-negative`);
  return value;
}

function nonzeroUuid(value: string, field: string): string {
  const parsed = UuidSchema.parse(value);
  if (parsed === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`${field} must not be zero UUID`);
  }
  return parsed;
}

function nonempty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

function transition(
  code: string,
  message: string,
): KnowledgeSpaceProfilePublicationTransitionError {
  return new KnowledgeSpaceProfilePublicationTransitionError(code, message);
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
