import { createHash } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type KnowledgeSpace,
  type KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpaceManifest,
  type KnowledgeSpacePendingModelConfiguration,
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileSchema,
  KnowledgeSpaceSchema,
  createDefaultKnowledgeSpaceManifest,
  stableJson,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonArrayColumn, jsonObjectColumn } from "./json-utils";
import {
  MAX_GENERATED_KNOWLEDGE_SPACE_SLUG_ATTEMPTS,
  generateKnowledgeSpaceSlug,
} from "./knowledge-space-creation";
import { deterministicKnowledgeSpaceActivityId } from "./knowledge-space-overview";
import { knowledgeSpaceProfileSnapshotDigest } from "./knowledge-space-profile-repository";
import { DuplicateKnowledgeSpaceSlugError } from "./knowledge-space-repository";

const PROVISIONING_METADATA_KEY = "__knowledgeFsProvisioning";
const EMBEDDING_PROFILE_METADATA_KEY = "__knowledgeFsEmbeddingProfile";
const PENDING_MODEL_CONFIGURATION_METADATA_KEY = "__knowledgeFsPendingModelConfiguration";
const RETRIEVAL_PROFILE_METADATA_KEY = "__knowledgeFsRetrievalProfile";

export type KnowledgeSpaceConfigurationStatus =
  | "pending-validation"
  | "ready"
  | "setup-required"
  | "validation-failed";

export interface KnowledgeSpaceProvisioningProfile<TProfile> {
  readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly profile: TProfile;
}

export interface ProvisionKnowledgeSpaceInput {
  readonly createdBySubjectId: string;
  readonly description?: string | undefined;
  readonly embedding?:
    | KnowledgeSpaceProvisioningProfile<KnowledgeSpaceEmbeddingProfile>
    | undefined;
  readonly iconRef?: string | undefined;
  /** A client key or one request-local UUID; stable across generated-slug retries. */
  readonly idempotencyKey: string;
  readonly name: string;
  readonly pendingModelConfiguration?: KnowledgeSpacePendingModelConfiguration | undefined;
  readonly retrieval?:
    | KnowledgeSpaceProvisioningProfile<KnowledgeSpaceRetrievalProfile>
    | undefined;
  readonly slug: string;
  /** Generated candidates are intentionally excluded from the idempotency intent. */
  readonly slugSource: "explicit" | "generated";
  readonly tenantId: string;
}

export interface ProvisionKnowledgeSpaceResult {
  readonly configurationStatus: KnowledgeSpaceConfigurationStatus;
  readonly replayed: boolean;
  readonly space: KnowledgeSpace;
}

/**
 * Production creation port. Implementations publish the entire initially visible aggregate in one
 * transaction. Unverified model selections are persisted as a pending configuration; active
 * profiles are reserved for model configurations that already crossed the capability boundary.
 */
export interface KnowledgeSpaceProvisioningRepository {
  provision(input: ProvisionKnowledgeSpaceInput): Promise<ProvisionKnowledgeSpaceResult>;
}

export interface DatabaseKnowledgeSpaceProvisioningRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly now?: (() => string) | undefined;
}

export class KnowledgeSpaceProvisioningIdempotencyConflictError extends Error {
  readonly code = "KNOWLEDGE_SPACE_PROVISIONING_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("Knowledge-space idempotency key was already used with a different create request");
    this.name = "KnowledgeSpaceProvisioningIdempotencyConflictError";
  }
}

export class KnowledgeSpaceProvisioningIncompleteReplayError extends Error {
  readonly code = "KNOWLEDGE_SPACE_PROVISIONING_INCOMPLETE_REPLAY";

  constructor() {
    super("Knowledge-space provisioning replay found an incomplete or corrupt aggregate");
    this.name = "KnowledgeSpaceProvisioningIncompleteReplayError";
  }
}

interface ProvisioningDraft {
  readonly activityId: string;
  readonly apiAccessId: string;
  readonly configurationStatus: KnowledgeSpaceConfigurationStatus;
  readonly embeddingCapabilitySemanticsDigest?: string | undefined;
  readonly embeddingHeadId?: string | undefined;
  readonly embeddingRevisionId?: string | undefined;
  readonly intentDigest: string;
  readonly keyDigest: string;
  readonly manifest: KnowledgeSpaceManifest;
  readonly memberId: string;
  readonly policyId: string;
  readonly retrievalHeadId?: string | undefined;
  readonly retrievalCapabilitySemanticsDigest?: string | undefined;
  readonly retrievalRevisionId?: string | undefined;
  readonly space: KnowledgeSpace;
}

export function createDatabaseKnowledgeSpaceProvisioningRepository({
  database,
  now = () => new Date().toISOString(),
}: DatabaseKnowledgeSpaceProvisioningRepositoryOptions): KnowledgeSpaceProvisioningRepository {
  return {
    provision: async (input) => {
      const draft = createProvisioningDraft(input, now());
      try {
        return await database.transaction((transaction) =>
          provisionWithExecutor(database, transaction, input, draft),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        // A concurrent identical request may have committed after our initial absence read. Replay
        // by deterministic id before classifying the unique error as a tenant-slug conflict.
        const replay = await database.transaction((transaction) =>
          replayProvisioning(database, transaction, input, draft, true),
        );
        if (replay) return replay;
        throw new DuplicateKnowledgeSpaceSlugError();
      }
    },
  };
}

async function provisionWithExecutor(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
): Promise<ProvisionKnowledgeSpaceResult> {
  const replay = await replayProvisioning(database, executor, input, draft, true);
  if (replay) return replay;

  await insertRow(database, executor, "knowledge_spaces", [
    ["id", draft.space.id],
    ["tenant_id", draft.space.tenantId],
    ["slug", draft.space.slug],
    ["name", draft.space.name],
    ["description", draft.space.description ?? null],
    ["icon_ref", draft.space.iconRef ?? null],
    ["revision", draft.space.revision],
    ["lifecycle_state", "active"],
    ["deletion_job_id", null],
    ["deleting_at", null],
    ["created_at", draft.space.createdAt],
    ["updated_at", draft.space.updatedAt],
  ]);
  await insertManifest(database, executor, input, draft);

  if (input.embedding && draft.embeddingRevisionId && draft.embeddingHeadId) {
    await insertActiveProfile(
      database,
      executor,
      input,
      draft,
      "embedding",
      input.embedding,
      draft.embeddingRevisionId,
      draft.embeddingHeadId,
    );
  }
  if (input.retrieval && draft.retrievalRevisionId && draft.retrievalHeadId) {
    await insertActiveProfile(
      database,
      executor,
      input,
      draft,
      "retrieval",
      input.retrieval,
      draft.retrievalRevisionId,
      draft.retrievalHeadId,
    );
  }

  await insertRow(database, executor, "knowledge_space_members", [
    ["id", draft.memberId],
    ["tenant_id", input.tenantId],
    ["knowledge_space_id", draft.space.id],
    ["subject_id", input.createdBySubjectId],
    ["role", "owner"],
    ["revision", 1],
    ["created_by_subject_id", input.createdBySubjectId],
    ["created_at", draft.space.createdAt],
    ["updated_at", draft.space.updatedAt],
  ]);
  await insertRow(database, executor, "knowledge_space_access_policies", [
    ["id", draft.policyId],
    ["tenant_id", input.tenantId],
    ["knowledge_space_id", draft.space.id],
    ["visibility", "only_me"],
    ["owner_subject_id", input.createdBySubjectId],
    ["revision", 1],
    ["updated_by_subject_id", input.createdBySubjectId],
    ["created_at", draft.space.createdAt],
    ["updated_at", draft.space.updatedAt],
  ]);
  await insertRow(database, executor, "knowledge_space_api_access", [
    ["id", draft.apiAccessId],
    ["tenant_id", input.tenantId],
    ["knowledge_space_id", draft.space.id],
    ["enabled", false],
    ["disabled_at", draft.space.createdAt],
    ["revision", 1],
    ["updated_by_subject_id", input.createdBySubjectId],
    ["created_at", draft.space.createdAt],
    ["updated_at", draft.space.updatedAt],
  ]);
  await insertRow(
    database,
    executor,
    "knowledge_space_activity_events",
    [
      ["id", draft.activityId],
      ["tenant_id", input.tenantId],
      ["knowledge_space_id", draft.space.id],
      ["actor_type", "member"],
      ["actor_subject_id", input.createdBySubjectId],
      ["action", "settings.updated"],
      ["resource_type", "knowledge-space"],
      ["resource_id", draft.space.id],
      ["result", "success"],
      ["required_permission_scope", JSON.stringify([])],
      [
        "details",
        JSON.stringify({
          configurationStatus: draft.configurationStatus,
          operation: "created",
        }),
      ],
      ["occurred_at", draft.space.createdAt],
    ],
    new Set(["details", "required_permission_scope"]),
  );

  return {
    configurationStatus: draft.configurationStatus,
    replayed: false,
    space: draft.space,
  };
}

async function replayProvisioning(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
  lock: boolean,
): Promise<ProvisionKnowledgeSpaceResult | null> {
  const spaceResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, draft.space.id],
    sql: `SELECT * FROM ${q(database, "knowledge_spaces")} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)}${
      lock ? " FOR UPDATE" : ""
    };`,
    tableName: "knowledge_spaces",
  });
  const row = spaceResult.rows[0];
  if (!row) return null;

  const manifestResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, draft.space.id],
    sql: `SELECT * FROM ${q(database, "knowledge_space_manifests")} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)};`,
    tableName: "knowledge_space_manifests",
  });
  const manifestRow = manifestResult.rows[0];
  if (!manifestRow) throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  const replayContext = resolveProvisioningReplayContext(manifestRow, input, draft);
  const replayInput = replayContext.input;
  const replayDraft = replayContext.draft;
  const space = verifyProvisionedSpace(row, replayInput, replayDraft);
  verifyProvisionedManifest(
    manifestRow,
    replayContext.metadata,
    replayInput,
    replayDraft,
    space.createdAt,
  );

  await verifyInitialAccessAggregate(database, executor, replayInput, replayDraft, space.createdAt);
  await verifyProfileReplay(
    database,
    executor,
    replayInput,
    replayDraft,
    "embedding",
    replayInput.embedding,
    space.createdAt,
  );
  await verifyProfileReplay(
    database,
    executor,
    replayInput,
    replayDraft,
    "retrieval",
    replayInput.retrieval,
    space.createdAt,
  );

  return {
    configurationStatus: replayDraft.configurationStatus,
    replayed: true,
    space,
  };
}

async function selectExactAggregateRow(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tableName: string,
  input: { readonly id: string; readonly knowledgeSpaceId: string; readonly tenantId: string },
): Promise<DatabaseRow | null> {
  const result = await executor.execute({
    maxRows: 2,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.id],
    sql: `SELECT * FROM ${q(database, tableName)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "id")} = ${p(database, 3)};`,
    tableName,
  });
  if (result.rows.length > 1) throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  return result.rows[0] ?? null;
}

async function verifyProfileReplay(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
  kind: "embedding" | "retrieval",
  profile:
    | KnowledgeSpaceProvisioningProfile<
        KnowledgeSpaceEmbeddingProfile | KnowledgeSpaceRetrievalProfile
      >
    | undefined,
  createdAt: string,
): Promise<void> {
  const expectedHeadId = kind === "embedding" ? draft.embeddingHeadId : draft.retrievalHeadId;
  const expectedRevisionId =
    kind === "embedding" ? draft.embeddingRevisionId : draft.retrievalRevisionId;
  const expectedCapabilitySemanticsDigest =
    kind === "embedding"
      ? draft.embeddingCapabilitySemanticsDigest
      : draft.retrievalCapabilitySemanticsDigest;
  const heads = await executor.execute({
    maxRows: 2,
    operation: "select",
    params: [input.tenantId, draft.space.id, kind],
    sql: `SELECT * FROM ${q(database, "knowledge_space_profile_heads")} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)};`,
    tableName: "knowledge_space_profile_heads",
  });
  const revisions = await executor.execute({
    maxRows: 2,
    operation: "select",
    params: [input.tenantId, draft.space.id, kind],
    sql: `SELECT * FROM ${q(database, "knowledge_space_profile_revisions")} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)};`,
    tableName: "knowledge_space_profile_revisions",
  });
  if (!profile) {
    if (heads.rows.length !== 0 || revisions.rows.length !== 0) {
      throw new KnowledgeSpaceProvisioningIncompleteReplayError();
    }
    return;
  }
  if (
    !expectedHeadId ||
    !expectedRevisionId ||
    !expectedCapabilitySemanticsDigest ||
    heads.rows.length !== 1 ||
    revisions.rows.length !== 1
  ) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
  const head = heads.rows[0];
  const revision = revisions.rows[0];
  if (!head || !revision) throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  assertExactFields(head, {
    active_revision: 1,
    created_at: createdAt,
    id: expectedHeadId,
    kind,
    knowledge_space_id: draft.space.id,
    profile_revision_id: expectedRevisionId,
    row_version: 1,
    tenant_id: input.tenantId,
    updated_at: createdAt,
  });
  const snapshot = safeJsonObjectColumn(revision, "snapshot");
  const capabilitySnapshot = safeJsonObjectColumn(revision, "capability_snapshot");
  const snapshotDigest = revision.snapshot_digest;
  const capabilitySnapshotDigest = revision.capability_snapshot_digest;
  const selection =
    kind === "embedding" ? input.embedding?.profile : input.retrieval?.profile.reasoningModel;
  if (!selection) throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  assertExactFields(revision, {
    activated_at: createdAt,
    created_at: createdAt,
    created_by_subject_id: input.createdBySubjectId,
    failed_at: null,
    failure_code: null,
    failure_message: null,
    id: expectedRevisionId,
    kind,
    knowledge_space_id: draft.space.id,
    model: selection.model,
    plugin_id: selection.pluginId,
    provider: selection.provider,
    revision: 1,
    state: "active",
    superseded_at: null,
    tenant_id: input.tenantId,
    updated_at: createdAt,
  });
  if (
    typeof snapshotDigest !== "string" ||
    typeof capabilitySnapshotDigest !== "string" ||
    stableJson(snapshot) !== stableJson(profile.profile) ||
    snapshotDigest !== knowledgeSpaceProfileSnapshotDigest(snapshot) ||
    snapshotDigest !== knowledgeSpaceProfileSnapshotDigest(profile.profile) ||
    capabilitySnapshotDigest !== knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot) ||
    stableCapabilitySemanticsDigest(capabilitySnapshot) !== expectedCapabilitySemanticsDigest
  ) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
  if (kind === "embedding") {
    if (!input.embedding) throw new KnowledgeSpaceProvisioningIncompleteReplayError();
    const dimension = input.embedding.profile.dimension;
    if (dimension === undefined) {
      throw new KnowledgeSpaceProvisioningIncompleteReplayError();
    }
    assertExactFields(revision, {
      dimension,
      vector_space_id: input.embedding.profile.vectorSpaceId,
    });
  } else {
    assertExactFields(revision, { dimension: null, vector_space_id: null });
  }
}

async function verifyInitialAccessAggregate(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
  createdAt: string,
): Promise<void> {
  const [member, policy, apiAccess, activity] = await Promise.all([
    selectExactAggregateRow(database, executor, "knowledge_space_members", {
      id: draft.memberId,
      knowledgeSpaceId: draft.space.id,
      tenantId: input.tenantId,
    }),
    selectExactAggregateRow(database, executor, "knowledge_space_access_policies", {
      id: draft.policyId,
      knowledgeSpaceId: draft.space.id,
      tenantId: input.tenantId,
    }),
    selectExactAggregateRow(database, executor, "knowledge_space_api_access", {
      id: draft.apiAccessId,
      knowledgeSpaceId: draft.space.id,
      tenantId: input.tenantId,
    }),
    selectExactAggregateRow(database, executor, "knowledge_space_activity_events", {
      id: draft.activityId,
      knowledgeSpaceId: draft.space.id,
      tenantId: input.tenantId,
    }),
  ]);
  if (!member || !policy || !apiAccess || !activity) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
  assertExactFields(member, {
    created_at: createdAt,
    created_by_subject_id: input.createdBySubjectId,
    id: draft.memberId,
    knowledge_space_id: draft.space.id,
    revision: 1,
    role: "owner",
    subject_id: input.createdBySubjectId,
    tenant_id: input.tenantId,
    updated_at: createdAt,
  });
  assertExactFields(policy, {
    created_at: createdAt,
    id: draft.policyId,
    knowledge_space_id: draft.space.id,
    owner_subject_id: input.createdBySubjectId,
    revision: 1,
    tenant_id: input.tenantId,
    updated_at: createdAt,
    updated_by_subject_id: input.createdBySubjectId,
    visibility: "only_me",
  });
  assertExactFields(apiAccess, {
    created_at: createdAt,
    disabled_at: createdAt,
    id: draft.apiAccessId,
    knowledge_space_id: draft.space.id,
    revision: 1,
    tenant_id: input.tenantId,
    updated_at: createdAt,
    updated_by_subject_id: input.createdBySubjectId,
  });
  if (booleanDatabaseValue(apiAccess.enabled) !== false) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
  assertExactFields(activity, {
    action: "settings.updated",
    actor_subject_id: input.createdBySubjectId,
    actor_type: "member",
    id: draft.activityId,
    knowledge_space_id: draft.space.id,
    occurred_at: createdAt,
    resource_id: draft.space.id,
    resource_type: "knowledge-space",
    result: "success",
    tenant_id: input.tenantId,
  });
  if (
    stableJson(safeJsonArrayColumn(activity, "required_permission_scope")) !== stableJson([]) ||
    stableJson(safeJsonObjectColumn(activity, "details")) !==
      stableJson({ configurationStatus: draft.configurationStatus, operation: "created" })
  ) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
}

function verifyProvisionedSpace(
  row: DatabaseRow,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
): KnowledgeSpace {
  assertExactFields(row, {
    deletion_job_id: null,
    deleting_at: null,
    description: input.description ?? null,
    icon_ref: input.iconRef ?? null,
    id: draft.space.id,
    lifecycle_state: "active",
    name: input.name,
    revision: 1,
    tenant_id: input.tenantId,
  });
  const persistedSlug = row.slug;
  if (
    typeof persistedSlug !== "string" ||
    (input.slugSource === "explicit"
      ? persistedSlug !== input.slug
      : !isValidGeneratedSlug(input.name, persistedSlug))
  ) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
  let space: KnowledgeSpace;
  try {
    space = mapSpace(row);
  } catch {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
  if (space.updatedAt !== space.createdAt) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
  return space;
}

interface ProvisioningReplayContext {
  readonly draft: ProvisioningDraft;
  readonly input: ProvisionKnowledgeSpaceInput;
  readonly metadata: Readonly<Record<string, unknown>>;
}

function resolveProvisioningReplayContext(
  manifestRow: DatabaseRow,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
): ProvisioningReplayContext {
  const metadata = safeJsonObjectColumn(manifestRow, "metadata");
  const marker = metadata[PROVISIONING_METADATA_KEY];
  if (!isProvisioningMarker(marker)) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
  if (marker.keyDigest !== draft.keyDigest) {
    throw new KnowledgeSpaceProvisioningIdempotencyConflictError();
  }
  if (marker.intentDigest === draft.intentDigest) {
    return { draft, input, metadata };
  }
  const legacyReplay = legacyV2ReplayContext(input, draft, metadata, marker);
  if (!legacyReplay) {
    throw new KnowledgeSpaceProvisioningIdempotencyConflictError();
  }
  return { ...legacyReplay, metadata };
}

/**
 * Reconstructs the old v2 aggregate for an acknowledgement lost across the pending-config deploy.
 * The v2 intent is recomputed from the exact persisted active profiles and current create fields;
 * the normal replay verifier then checks every manifest field, profile row, capability digest,
 * owner/access row, and activity event against this reconstructed aggregate.
 */
function legacyV2ReplayContext(
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
  metadata: Readonly<Record<string, unknown>>,
  marker: ProvisioningMarker,
): Pick<ProvisioningReplayContext, "draft" | "input"> | null {
  const pending = input.pendingModelConfiguration;
  if (!pending || pending.state !== "pending-validation" || pending.revision !== 1) return null;
  if (marker.schemaVersion !== 2) return null;

  const embeddingResult = KnowledgeSpaceEmbeddingProfileSchema.safeParse(
    metadata[EMBEDDING_PROFILE_METADATA_KEY],
  );
  const retrievalResult = KnowledgeSpaceRetrievalProfileSchema.safeParse(
    metadata[RETRIEVAL_PROFILE_METADATA_KEY],
  );
  const embedding = embeddingResult.success ? embeddingResult.data : undefined;
  const retrieval = retrievalResult.success ? retrievalResult.data : undefined;
  if (
    (metadata[EMBEDDING_PROFILE_METADATA_KEY] !== undefined && !embedding) ||
    (metadata[RETRIEVAL_PROFILE_METADATA_KEY] !== undefined && !retrieval) ||
    (embedding !== undefined && (embedding.revision !== 1 || embedding.dimension === undefined)) ||
    (retrieval !== undefined && retrieval.revision !== 1)
  ) {
    return null;
  }

  const persistedEmbeddingSelection = embedding
    ? { model: embedding.model, pluginId: embedding.pluginId, provider: embedding.provider }
    : null;
  const persistedRetrievalSelection = retrieval
    ? {
        defaultMode: retrieval.defaultMode,
        reasoningModel: retrieval.reasoningModel,
        rerank: retrieval.rerank,
        scoreThreshold: retrieval.scoreThreshold,
        topK: retrieval.topK,
      }
    : null;
  if (
    stableJson(pending.embeddingSelection ?? null) !== stableJson(persistedEmbeddingSelection) ||
    stableJson(pending.retrievalProfile ?? null) !== stableJson(persistedRetrievalSelection)
  ) {
    return null;
  }

  const embeddingCapabilitySemanticsDigest = marker.capabilitySemanticsDigests.embedding;
  const retrievalCapabilitySemanticsDigest = marker.capabilitySemanticsDigests.retrieval;
  if (
    Boolean(embedding) !== Boolean(embeddingCapabilitySemanticsDigest) ||
    Boolean(retrieval) !== Boolean(retrievalCapabilitySemanticsDigest) ||
    marker.configurationStatus !== configurationStatusFor(embedding, retrieval)
  ) {
    return null;
  }

  const legacyInput: ProvisionKnowledgeSpaceInput = {
    createdBySubjectId: input.createdBySubjectId,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(embedding ? { embedding: { capabilitySnapshot: {}, profile: embedding } } : {}),
    ...(input.iconRef === undefined ? {} : { iconRef: input.iconRef }),
    idempotencyKey: input.idempotencyKey,
    name: input.name,
    ...(retrieval ? { retrieval: { capabilitySnapshot: {}, profile: retrieval } } : {}),
    slug: input.slug,
    slugSource: input.slugSource,
    tenantId: input.tenantId,
  };
  const legacyIntentDigest = provisioningIntentDigest(legacyInput, {
    embedding: embeddingCapabilitySemanticsDigest,
    retrieval: retrievalCapabilitySemanticsDigest,
  });
  if (legacyIntentDigest !== marker.intentDigest) return null;

  const legacyDraft: ProvisioningDraft = {
    ...draft,
    configurationStatus: marker.configurationStatus,
    ...(embeddingCapabilitySemanticsDigest
      ? {
          embeddingCapabilitySemanticsDigest,
          embeddingHeadId: deterministicUuid(input.tenantId, draft.keyDigest, "embedding-head"),
          embeddingRevisionId: deterministicUuid(
            input.tenantId,
            draft.keyDigest,
            "embedding-revision",
          ),
        }
      : {}),
    intentDigest: marker.intentDigest,
    ...(retrievalCapabilitySemanticsDigest
      ? {
          retrievalCapabilitySemanticsDigest,
          retrievalHeadId: deterministicUuid(input.tenantId, draft.keyDigest, "retrieval-head"),
          retrievalRevisionId: deterministicUuid(
            input.tenantId,
            draft.keyDigest,
            "retrieval-revision",
          ),
        }
      : {}),
  };
  return { draft: legacyDraft, input: legacyInput };
}

function verifyProvisionedManifest(
  row: DatabaseRow,
  metadata: Readonly<Record<string, unknown>>,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
  createdAt: string,
): void {
  assertExactFields(row, {
    created_at: createdAt,
    id: draft.manifest.id,
    knowledge_space_id: draft.space.id,
    manifest_version: draft.manifest.manifestVersion,
    metadata_dialect: draft.manifest.metadataDialect,
    min_client_version: draft.manifest.minClientVersion,
    node_schema_version: draft.manifest.nodeSchemaVersion,
    object_key_prefix: draft.manifest.objectKeyPrefix,
    parser_policy_version: draft.manifest.parserPolicyVersion,
    projection_set_version: draft.manifest.projectionSetVersion,
    storage_provider: draft.manifest.storageProvider,
    tenant_id: input.tenantId,
    updated_at: createdAt,
  });
  if (
    stableJson(metadata) !== stableJson(provisioningManifestMetadata(input, draft)) ||
    stableJson(safeJsonObjectColumn(row, "retention_policy")) !==
      stableJson(draft.manifest.retentionPolicy) ||
    stableJson(safeJsonObjectColumn(row, "quota_policy")) !==
      stableJson(draft.manifest.quotaPolicy) ||
    stableJson(safeJsonObjectColumn(row, "consistency_policy")) !==
      stableJson(draft.manifest.consistencyPolicy) ||
    stableJson(safeJsonObjectColumn(row, "encryption_policy")) !==
      stableJson(draft.manifest.encryptionPolicy)
  ) {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
}

async function insertManifest(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
): Promise<void> {
  const metadata = provisioningManifestMetadata(input, draft);
  await insertRow(
    database,
    executor,
    "knowledge_space_manifests",
    [
      ["id", draft.manifest.id],
      ["tenant_id", draft.manifest.tenantId],
      ["knowledge_space_id", draft.manifest.knowledgeSpaceId],
      ["manifest_version", draft.manifest.manifestVersion],
      ["storage_provider", draft.manifest.storageProvider],
      ["object_key_prefix", draft.manifest.objectKeyPrefix],
      ["metadata_dialect", draft.manifest.metadataDialect],
      ["parser_policy_version", draft.manifest.parserPolicyVersion],
      ["node_schema_version", draft.manifest.nodeSchemaVersion],
      ["projection_set_version", draft.manifest.projectionSetVersion],
      ["min_client_version", draft.manifest.minClientVersion],
      ["retention_policy", JSON.stringify(draft.manifest.retentionPolicy)],
      ["quota_policy", JSON.stringify(draft.manifest.quotaPolicy)],
      ["consistency_policy", JSON.stringify(draft.manifest.consistencyPolicy)],
      ["encryption_policy", JSON.stringify(draft.manifest.encryptionPolicy)],
      ["metadata", JSON.stringify(metadata)],
      ["created_at", draft.manifest.createdAt],
      ["updated_at", draft.manifest.updatedAt],
    ],
    new Set([
      "consistency_policy",
      "encryption_policy",
      "metadata",
      "quota_policy",
      "retention_policy",
    ]),
  );
}

async function insertActiveProfile(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
  kind: "embedding" | "retrieval",
  provisioned: KnowledgeSpaceProvisioningProfile<
    KnowledgeSpaceEmbeddingProfile | KnowledgeSpaceRetrievalProfile
  >,
  revisionId: string,
  headId: string,
): Promise<void> {
  const profile = provisioned.profile;
  const selection =
    kind === "embedding" ? input.embedding?.profile : input.retrieval?.profile.reasoningModel;
  if (!selection) throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  const embedding = kind === "embedding" ? input.embedding?.profile : undefined;
  await insertRow(
    database,
    executor,
    "knowledge_space_profile_revisions",
    [
      ["id", revisionId],
      ["tenant_id", input.tenantId],
      ["knowledge_space_id", draft.space.id],
      ["kind", kind],
      ["revision", profile.revision],
      ["state", "active"],
      ["snapshot", JSON.stringify(profile)],
      ["snapshot_digest", knowledgeSpaceProfileSnapshotDigest(profile)],
      ["capability_snapshot", JSON.stringify(provisioned.capabilitySnapshot)],
      [
        "capability_snapshot_digest",
        knowledgeSpaceProfileSnapshotDigest(provisioned.capabilitySnapshot),
      ],
      ["plugin_id", selection.pluginId],
      ["provider", selection.provider],
      ["model", selection.model],
      ["vector_space_id", embedding?.vectorSpaceId ?? null],
      ["dimension", embedding?.dimension ?? null],
      ["created_by_subject_id", input.createdBySubjectId],
      ["failure_code", null],
      ["failure_message", null],
      ["created_at", draft.space.createdAt],
      ["updated_at", draft.space.updatedAt],
      ["activated_at", draft.space.createdAt],
      ["superseded_at", null],
      ["failed_at", null],
    ],
    new Set(["capability_snapshot", "snapshot"]),
  );
  await insertRow(database, executor, "knowledge_space_profile_heads", [
    ["id", headId],
    ["tenant_id", input.tenantId],
    ["knowledge_space_id", draft.space.id],
    ["kind", kind],
    ["profile_revision_id", revisionId],
    ["active_revision", profile.revision],
    ["row_version", 1],
    ["created_at", draft.space.createdAt],
    ["updated_at", draft.space.updatedAt],
  ]);
}

async function insertRow(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tableName: string,
  fields: readonly (readonly [string, DatabaseQueryValue])[],
  jsonColumns: ReadonlySet<string> = new Set(),
): Promise<void> {
  const params = fields.map(([, value]) => value);
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, tableName)} (${fields
      .map(([column]) => q(database, column))
      .join(", ")}) VALUES (${fields
      .map(([column], index) => {
        const placeholder = p(database, index + 1);
        if (!jsonColumns.has(column)) return placeholder;
        return database.dialect === "postgres"
          ? `${placeholder}::jsonb`
          : `CAST(${placeholder} AS JSON)`;
      })
      .join(", ")});`,
    tableName,
  });
  if (result.rowsAffected !== 1) {
    throw new Error(`Knowledge-space provisioning failed to insert ${tableName}`);
  }
}

function createProvisioningDraft(
  input: ProvisionKnowledgeSpaceInput,
  timestamp: string,
): ProvisioningDraft {
  if (input.pendingModelConfiguration && (input.embedding || input.retrieval)) {
    throw new Error(
      "Pending knowledge-space model configuration cannot be mixed with active profiles",
    );
  }
  assertPendingModelConfigurationDigest(input.pendingModelConfiguration);
  assertInitialProfileRevision(input.embedding?.profile, "embedding");
  assertInitialProfileRevision(input.retrieval?.profile, "retrieval");
  if (input.embedding && input.embedding.profile.dimension === undefined) {
    throw new Error("Initial knowledge-space embedding profile dimension must be resolved");
  }
  const keyDigest = sha256(input.idempotencyKey);
  const stableId = (purpose: string) => deterministicUuid(input.tenantId, keyDigest, purpose);
  const spaceId = stableId("space");
  const embeddingCapabilitySemanticsDigest = input.embedding
    ? stableCapabilitySemanticsDigest(input.embedding.capabilitySnapshot)
    : undefined;
  const retrievalCapabilitySemanticsDigest = input.retrieval
    ? stableCapabilitySemanticsDigest(input.retrieval.capabilitySnapshot)
    : undefined;
  const configurationStatus = configurationStatusFor(
    input.embedding?.profile,
    input.retrieval?.profile,
    input.pendingModelConfiguration,
  );
  const space = KnowledgeSpaceSchema.parse({
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.iconRef === undefined ? {} : { iconRef: input.iconRef }),
    createdAt: timestamp,
    id: spaceId,
    name: input.name,
    revision: 1,
    slug: input.slug,
    tenantId: input.tenantId,
    updatedAt: timestamp,
  });
  const manifest = createDefaultKnowledgeSpaceManifest({
    createdAt: timestamp,
    ...(input.embedding ? { embeddingProfile: input.embedding.profile } : {}),
    id: stableId("manifest"),
    knowledgeSpaceId: spaceId,
    ...(input.pendingModelConfiguration
      ? { pendingModelConfiguration: input.pendingModelConfiguration }
      : {}),
    ...(input.retrieval ? { retrievalProfile: input.retrieval.profile } : {}),
    tenantId: input.tenantId,
    updatedAt: timestamp,
  });
  const intentDigest = provisioningIntentDigest(input, {
    embedding: embeddingCapabilitySemanticsDigest,
    retrieval: retrievalCapabilitySemanticsDigest,
  });
  return {
    activityId: deterministicKnowledgeSpaceActivityId(
      "settings.updated",
      input.tenantId,
      spaceId,
      "created",
    ),
    apiAccessId: stableId("api-access"),
    configurationStatus,
    ...(embeddingCapabilitySemanticsDigest ? { embeddingCapabilitySemanticsDigest } : {}),
    ...(input.embedding
      ? {
          embeddingHeadId: stableId("embedding-head"),
          embeddingRevisionId: stableId("embedding-revision"),
        }
      : {}),
    intentDigest,
    keyDigest,
    manifest,
    memberId: stableId("owner-member"),
    policyId: stableId("access-policy"),
    ...(retrievalCapabilitySemanticsDigest ? { retrievalCapabilitySemanticsDigest } : {}),
    ...(input.retrieval
      ? {
          retrievalHeadId: stableId("retrieval-head"),
          retrievalRevisionId: stableId("retrieval-revision"),
        }
      : {}),
    space,
  };
}

export function configurationStatusFor(
  embedding: KnowledgeSpaceEmbeddingProfile | undefined,
  retrieval: KnowledgeSpaceRetrievalProfile | undefined,
  pendingModelConfiguration?: KnowledgeSpacePendingModelConfiguration | undefined,
): KnowledgeSpaceConfigurationStatus {
  if (pendingModelConfiguration) {
    if (!pendingModelConfiguration.retrievalProfile) return "setup-required";
    return pendingModelConfiguration.state;
  }
  if (!retrieval) return "setup-required";
  return retrieval.defaultMode === "research" || embedding ? "ready" : "setup-required";
}

function provisioningIntentDigest(
  input: ProvisionKnowledgeSpaceInput,
  capabilitySemanticsDigests: {
    readonly embedding?: string | null | undefined;
    readonly retrieval?: string | null | undefined;
  },
): string {
  return sha256(
    stableJson({
      createdBySubjectId: input.createdBySubjectId,
      description: input.description ?? null,
      embeddingCapabilitySemanticsDigest: capabilitySemanticsDigests.embedding ?? null,
      embedding: input.embedding?.profile ?? null,
      iconRef: input.iconRef ?? null,
      name: input.name,
      pendingModelConfiguration: input.pendingModelConfiguration ?? null,
      retrievalCapabilitySemanticsDigest: capabilitySemanticsDigests.retrieval ?? null,
      retrieval: input.retrieval?.profile ?? null,
      ...(input.slugSource === "explicit" ? { slug: input.slug } : {}),
      slugSource: input.slugSource,
      tenantId: input.tenantId,
    }),
  );
}

function assertPendingModelConfigurationDigest(
  pending: KnowledgeSpacePendingModelConfiguration | undefined,
): void {
  if (!pending) return;
  const expectedDigest = sha256(
    stableJson({
      embeddingSelection: pending.embeddingSelection ?? null,
      retrievalProfile: pending.retrievalProfile ?? null,
      revision: pending.revision,
      schemaVersion: 1,
    }),
  );
  if (pending.digest !== expectedDigest) {
    throw new Error("Pending knowledge-space model configuration digest is invalid");
  }
}

function assertInitialProfileRevision(
  profile: KnowledgeSpaceEmbeddingProfile | KnowledgeSpaceRetrievalProfile | undefined,
  kind: "embedding" | "retrieval",
): void {
  if (profile && profile.revision !== 1) {
    throw new Error(`Initial knowledge-space ${kind} profile revision must be 1`);
  }
}

function mapSpace(row: DatabaseRow): KnowledgeSpace {
  const description = optionalStringColumn(row, "description");
  const iconRef = optionalStringColumn(row, "icon_ref");
  return KnowledgeSpaceSchema.parse({
    createdAt: stringColumn(row, "created_at"),
    ...(description ? { description } : {}),
    ...(iconRef ? { iconRef } : {}),
    id: stringColumn(row, "id"),
    name: stringColumn(row, "name"),
    revision: numberColumn(row, "revision"),
    slug: stringColumn(row, "slug"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function isProvisioningMarker(value: unknown): value is ProvisioningMarker {
  if (!isPlainObject(value)) return false;
  const capabilitySemanticsDigests = value.capabilitySemanticsDigests;
  const hasSupportedStatus =
    (value.schemaVersion === 2 &&
      (value.configurationStatus === "ready" || value.configurationStatus === "setup-required")) ||
    (value.schemaVersion === 3 &&
      (value.configurationStatus === "pending-validation" ||
        value.configurationStatus === "ready" ||
        value.configurationStatus === "setup-required" ||
        value.configurationStatus === "validation-failed"));
  return (
    hasSupportedStatus &&
    isSha256Hex(value.intentDigest) &&
    isSha256Hex(value.keyDigest) &&
    isPlainObject(capabilitySemanticsDigests) &&
    isOptionalSha256Hex(capabilitySemanticsDigests.embedding) &&
    isOptionalSha256Hex(capabilitySemanticsDigests.retrieval)
  );
}

interface ProvisioningMarker {
  readonly capabilitySemanticsDigests: {
    readonly embedding: string | null;
    readonly retrieval: string | null;
  };
  readonly configurationStatus: KnowledgeSpaceConfigurationStatus;
  readonly intentDigest: string;
  readonly keyDigest: string;
  readonly schemaVersion: 2 | 3;
}

function provisioningManifestMetadata(
  input: ProvisionKnowledgeSpaceInput,
  draft: ProvisioningDraft,
): Readonly<Record<string, unknown>> {
  return {
    ...draft.manifest.metadata,
    ...(input.embedding ? { [EMBEDDING_PROFILE_METADATA_KEY]: input.embedding.profile } : {}),
    ...(input.pendingModelConfiguration
      ? { [PENDING_MODEL_CONFIGURATION_METADATA_KEY]: input.pendingModelConfiguration }
      : {}),
    ...(input.retrieval ? { [RETRIEVAL_PROFILE_METADATA_KEY]: input.retrieval.profile } : {}),
    [PROVISIONING_METADATA_KEY]: {
      capabilitySemanticsDigests: {
        embedding: draft.embeddingCapabilitySemanticsDigest ?? null,
        retrieval: draft.retrievalCapabilitySemanticsDigest ?? null,
      },
      configurationStatus: draft.configurationStatus,
      intentDigest: draft.intentDigest,
      keyDigest: draft.keyDigest,
      schemaVersion: input.pendingModelConfiguration ? 3 : 2,
    } satisfies ProvisioningMarker,
  };
}

function stableCapabilitySemanticsDigest(value: Readonly<Record<string, unknown>>): string {
  return sha256(stableJson(withoutEphemeralCapabilityMetadata(value)));
}

function withoutEphemeralCapabilityMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutEphemeralCapabilityMetadata);
  }
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "checkedAt")
      .map(([key, nested]) => [key, withoutEphemeralCapabilityMetadata(nested)]),
  );
}

function assertExactFields(
  row: DatabaseRow,
  expected: Readonly<Record<string, DatabaseQueryValue>>,
): void {
  for (const [column, value] of Object.entries(expected)) {
    if (!Object.hasOwn(row, column) || row[column] !== value) {
      throw new KnowledgeSpaceProvisioningIncompleteReplayError();
    }
  }
}

function safeJsonObjectColumn(row: DatabaseRow, column: string): Record<string, unknown> {
  try {
    return jsonObjectColumn(row, column);
  } catch {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
}

function safeJsonArrayColumn(row: DatabaseRow, column: string): unknown[] {
  try {
    return jsonArrayColumn(row, column);
  } catch {
    throw new KnowledgeSpaceProvisioningIncompleteReplayError();
  }
}

function booleanDatabaseValue(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  throw new KnowledgeSpaceProvisioningIncompleteReplayError();
}

function isValidGeneratedSlug(name: string, persistedSlug: string): boolean {
  const baseSlug = generateKnowledgeSpaceSlug(name);
  for (let attempt = 0; attempt < MAX_GENERATED_KNOWLEDGE_SPACE_SLUG_ATTEMPTS; attempt += 1) {
    if (persistedSlug === generatedSlugCandidate(baseSlug, attempt)) return true;
  }
  return false;
}

function generatedSlugCandidate(baseSlug: string, attempt: number): string {
  if (attempt === 0) return baseSlug;
  const suffix = `-${attempt + 1}`;
  const truncatedBase = baseSlug.slice(0, 160 - suffix.length).replace(/-+$/gu, "");
  return `${truncatedBase}${suffix}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isOptionalSha256Hex(value: unknown): value is string | null {
  return value === null || isSha256Hex(value);
}

function deterministicUuid(tenantId: string, keyDigest: string, purpose: string): string {
  const hex = createHash("sha256")
    .update(stableJson({ keyDigest, purpose, tenantId }))
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(
    16,
    20,
  )}-${compact.slice(20)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  return (
    candidate.code === "23505" ||
    candidate.code === 1062 ||
    candidate.code === "ER_DUP_ENTRY" ||
    (typeof candidate.message === "string" &&
      /duplicate|unique constraint|already exists/iu.test(candidate.message))
  );
}
