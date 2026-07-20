import { randomUUID } from "node:crypto";

import {
  DateTimeSchema,
  type KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileSchema,
  TenantIdSchema,
  UuidSchema,
} from "@knowledge/core";

import {
  type ActivateKnowledgeSpaceProfileCandidateInput,
  type CreateKnowledgeSpaceProfileCandidateInput,
  type FailKnowledgeSpaceProfileCandidateInput,
  type KnowledgeSpaceProfileHead,
  KnowledgeSpaceProfileHeadConflictError,
  type KnowledgeSpaceProfileKind,
  KnowledgeSpaceProfileKinds,
  type KnowledgeSpaceProfileRepository,
  type KnowledgeSpaceProfileRevision,
  type KnowledgeSpaceProfileScope,
  type KnowledgeSpaceProfileSnapshot,
  KnowledgeSpaceProfileTransitionError,
  type ListKnowledgeSpaceProfileRevisionsInput,
  type ListKnowledgeSpaceProfileRevisionsResult,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";

export interface InMemoryKnowledgeSpaceProfileRepositoryOptions {
  readonly generateHeadId?: (() => string) | undefined;
  readonly generateRevisionId?: (() => string) | undefined;
  readonly maxListLimit: number;
  /** Total immutable revision capacity across every tenant, space, and profile kind. */
  readonly maxRevisions: number;
}

export class KnowledgeSpaceProfileCapacityExceededError extends KnowledgeSpaceProfileTransitionError {
  readonly maxRevisions: number;

  constructor(maxRevisions: number) {
    super(
      "KNOWLEDGE_SPACE_PROFILE_CAPACITY_EXCEEDED",
      `Knowledge-space profile revision capacity exceeded maxRevisions=${maxRevisions}`,
    );
    this.name = "KnowledgeSpaceProfileCapacityExceededError";
    this.maxRevisions = maxRevisions;
  }
}

interface StoredHead extends KnowledgeSpaceProfileScope {
  readonly activeRevision: number;
  readonly createdAt: string;
  readonly id: string;
  readonly profileRevisionId: string;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

interface NormalizedCandidate extends KnowledgeSpaceProfileScope {
  readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly capabilitySnapshotDigest: string;
  readonly createdBySubjectId: string;
  readonly dimension?: number | undefined;
  readonly model: string;
  readonly now: string;
  readonly pluginId: string;
  readonly preserveLegacyInitialRevision: boolean;
  readonly provider: string;
  readonly snapshot: KnowledgeSpaceProfileSnapshot;
  readonly snapshotDigest: string;
  readonly vectorSpaceId?: string | undefined;
}

/**
 * Clone-isolated in-memory implementation of the durable profile state machine. Each public call
 * validates and completes synchronously before its promise resolves, so CAS checks and mutations
 * cannot interleave inside one JavaScript isolate.
 */
export function createInMemoryKnowledgeSpaceProfileRepository({
  generateHeadId = randomUUID,
  generateRevisionId = randomUUID,
  maxListLimit,
  maxRevisions,
}: InMemoryKnowledgeSpaceProfileRepositoryOptions): KnowledgeSpaceProfileRepository {
  positiveInteger(maxListLimit, "maxListLimit");
  positiveInteger(maxRevisions, "maxRevisions");

  const revisions = new Map<string, Map<number, KnowledgeSpaceProfileRevision>>();
  const heads = new Map<string, StoredHead>();
  const revisionIds = new Set<string>();
  const headIds = new Set<string>();
  let revisionCount = 0;

  return {
    activateCandidate: async (rawInput) => {
      const input = normalizeActivation(rawInput);
      const key = scopeKey(input);
      const scopedRevisions = revisions.get(key);
      const currentHead = heads.get(key);
      const actualActiveRevision = currentHead?.activeRevision ?? null;
      if (actualActiveRevision !== input.expectedActiveRevision) {
        throw new KnowledgeSpaceProfileHeadConflictError(
          input.expectedActiveRevision,
          actualActiveRevision,
        );
      }

      const candidate = scopedRevisions?.get(input.revision);
      if (!candidate) {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_REVISION_NOT_FOUND",
          `Knowledge-space profile candidate revision=${input.revision} was not found`,
        );
      }
      assertStoredRevision(candidate);
      if (candidate.state !== "candidate") {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_NOT_CANDIDATE",
          `Knowledge-space profile revision=${input.revision} is ${candidate.state}, not candidate`,
        );
      }

      let previous: KnowledgeSpaceProfileRevision | undefined;
      if (currentHead) {
        previous = scopedRevisions?.get(currentHead.activeRevision);
        if (
          !previous ||
          previous.id !== currentHead.profileRevisionId ||
          previous.state !== "active" ||
          previous.revision !== currentHead.activeRevision
        ) {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
            "Knowledge-space profile head does not reference its scoped active revision",
          );
        }
        assertStoredRevision(previous);
      }

      let newHeadId: string | undefined;
      if (!currentHead) {
        newHeadId = nonzeroUuid(generateHeadId(), "headId");
        if (headIds.has(newHeadId)) {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_HEAD_ID_CONFLICT",
            `Knowledge-space profile head id=${newHeadId} already exists`,
          );
        }
      }

      const supersededPrevious = previous
        ? freezeRevision({
            ...previous,
            state: "superseded",
            supersededAt: input.now,
            updatedAt: input.now,
          })
        : undefined;
      const activeCandidate = freezeRevision({
        ...candidate,
        activatedAt: input.now,
        state: "active",
        updatedAt: input.now,
      });
      const nextHead = Object.freeze<StoredHead>(
        currentHead
          ? {
              ...currentHead,
              activeRevision: candidate.revision,
              profileRevisionId: candidate.id,
              rowVersion: currentHead.rowVersion + 1,
              updatedAt: input.now,
            }
          : {
              activeRevision: candidate.revision,
              createdAt: input.now,
              id: requiredValue(newHeadId, "Generated profile head id is missing"),
              kind: input.kind,
              knowledgeSpaceId: input.knowledgeSpaceId,
              profileRevisionId: candidate.id,
              rowVersion: 1,
              tenantId: input.tenantId,
              updatedAt: input.now,
            },
      );

      if (supersededPrevious) {
        scopedRevisions?.set(supersededPrevious.revision, supersededPrevious);
      }
      scopedRevisions?.set(candidate.revision, activeCandidate);
      heads.set(key, nextHead);
      if (newHeadId) headIds.add(newHeadId);
      return materializeHead(nextHead, activeCandidate);
    },

    createCandidate: async (rawInput) => {
      const input = normalizeCandidate(rawInput);
      const key = scopeKey(input);
      const scopedRevisions =
        revisions.get(key) ?? new Map<number, KnowledgeSpaceProfileRevision>();
      const candidate = [...scopedRevisions.values()].find(
        (revision) => revision.state === "candidate",
      );
      if (candidate) {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_EXISTS",
          `Knowledge-space ${input.kind} profile already has a candidate revision`,
        );
      }
      const latestRevision = [...scopedRevisions.keys()].sort((left, right) => right - left)[0];
      const expectedRevision =
        latestRevision === undefined && input.preserveLegacyInitialRevision
          ? input.snapshot.revision
          : (latestRevision ?? 0) + 1;
      if (input.snapshot.revision !== expectedRevision) {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_REVISION_CONFLICT",
          `Profile snapshot revision=${input.snapshot.revision} must be next revision=${expectedRevision}`,
        );
      }
      if (revisionCount >= maxRevisions) {
        throw new KnowledgeSpaceProfileCapacityExceededError(maxRevisions);
      }
      const id = nonzeroUuid(generateRevisionId(), "revisionId");
      if (revisionIds.has(id)) {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_REVISION_ID_CONFLICT",
          `Knowledge-space profile revision id=${id} already exists`,
        );
      }

      const created = freezeRevision({
        capabilitySnapshot: input.capabilitySnapshot,
        capabilitySnapshotDigest: input.capabilitySnapshotDigest,
        createdAt: input.now,
        createdBySubjectId: input.createdBySubjectId,
        ...(input.dimension === undefined ? {} : { dimension: input.dimension }),
        id,
        kind: input.kind,
        knowledgeSpaceId: input.knowledgeSpaceId,
        model: input.model,
        pluginId: input.pluginId,
        provider: input.provider,
        revision: input.snapshot.revision,
        snapshot: input.snapshot,
        snapshotDigest: input.snapshotDigest,
        state: "candidate",
        tenantId: input.tenantId,
        updatedAt: input.now,
        ...(input.vectorSpaceId === undefined ? {} : { vectorSpaceId: input.vectorSpaceId }),
      });
      scopedRevisions.set(created.revision, created);
      revisions.set(key, scopedRevisions);
      revisionIds.add(id);
      revisionCount += 1;
      return cloneRevision(created);
    },

    failCandidate: async (rawInput) => {
      const input = normalizeFailure(rawInput);
      const scopedRevisions = revisions.get(scopeKey(input));
      const current = scopedRevisions?.get(input.revision);
      if (!current) {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_REVISION_NOT_FOUND",
          `Knowledge-space profile candidate revision=${input.revision} was not found`,
        );
      }
      assertStoredRevision(current);
      if (current.state === "failed") return cloneRevision(current);
      if (current.state !== "candidate") {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_NOT_CANDIDATE",
          `Only a candidate profile can fail; revision=${input.revision} is ${current.state}`,
        );
      }
      const failed = freezeRevision({
        ...current,
        failedAt: input.now,
        failureCode: input.errorCode,
        failureMessage: input.errorMessage,
        state: "failed",
        updatedAt: input.now,
      });
      scopedRevisions?.set(failed.revision, failed);
      return cloneRevision(failed);
    },

    getHead: async (rawScope) => {
      const scope = normalizeScope(rawScope);
      const key = scopeKey(scope);
      const head = heads.get(key);
      if (!head) return null;
      const profile = revisions.get(key)?.get(head.activeRevision);
      if (
        !profile ||
        profile.id !== head.profileRevisionId ||
        profile.state !== "active" ||
        profile.revision !== head.activeRevision
      ) {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
          "Knowledge-space profile head does not reference its scoped active revision",
        );
      }
      assertStoredRevision(profile);
      return materializeHead(head, profile);
    },

    getRevision: async (rawInput) => {
      const input = {
        ...normalizeScope(rawInput),
        revision: positiveInteger(rawInput.revision, "revision"),
      };
      const revision = revisions.get(scopeKey(input))?.get(input.revision);
      if (!revision) return null;
      assertStoredRevision(revision);
      return cloneRevision(revision);
    },

    listRevisions: async (rawInput) => {
      const input = normalizeList(rawInput, maxListLimit);
      const scoped = revisions.get(scopeKey(input));
      const ordered = [...(scoped?.values() ?? [])]
        .filter((revision) =>
          input.afterRevision === undefined ? true : revision.revision > input.afterRevision,
        )
        .sort((left, right) => left.revision - right.revision)
        .slice(0, input.limit + 1);
      const visible = ordered.slice(0, input.limit);
      for (const revision of visible) assertStoredRevision(revision);
      return {
        items: visible.map(cloneRevision),
        ...(ordered.length > input.limit
          ? { nextRevision: requiredValue(visible.at(-1), "Profile page is empty").revision }
          : {}),
      } satisfies ListKnowledgeSpaceProfileRevisionsResult;
    },
  };
}

function normalizeCandidate(input: CreateKnowledgeSpaceProfileCandidateInput): NormalizedCandidate {
  const scope = normalizeScope(input);
  const snapshot = parseSnapshot(scope.kind, input.snapshot);
  const capabilitySnapshot = cloneJsonObject(input.capabilitySnapshot, "capabilitySnapshot");
  const createdBySubjectId = requiredText(input.createdBySubjectId, "createdBySubjectId", 255);
  const now = DateTimeSchema.parse(input.now);
  if (scope.kind === "embedding") {
    const embedding = KnowledgeSpaceEmbeddingProfileSchema.parse(snapshot);
    const dimension = positiveInteger(
      embedding.dimension ?? Number.NaN,
      "embedding profile dimension",
    );
    return {
      ...scope,
      capabilitySnapshot,
      capabilitySnapshotDigest: knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot),
      createdBySubjectId,
      dimension,
      model: embedding.model,
      now,
      pluginId: embedding.pluginId,
      preserveLegacyInitialRevision: input.preserveLegacyInitialRevision === true,
      provider: embedding.provider,
      snapshot: embedding,
      snapshotDigest: knowledgeSpaceProfileSnapshotDigest(embedding),
      vectorSpaceId: embedding.vectorSpaceId,
    };
  }
  const retrieval = KnowledgeSpaceRetrievalProfileSchema.parse(snapshot);
  return {
    ...scope,
    capabilitySnapshot,
    capabilitySnapshotDigest: knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot),
    createdBySubjectId,
    model: retrieval.reasoningModel.model,
    now,
    pluginId: retrieval.reasoningModel.pluginId,
    preserveLegacyInitialRevision: input.preserveLegacyInitialRevision === true,
    provider: retrieval.reasoningModel.provider,
    snapshot: retrieval,
    snapshotDigest: knowledgeSpaceProfileSnapshotDigest(retrieval),
  };
}

function normalizeActivation(
  input: ActivateKnowledgeSpaceProfileCandidateInput,
): ActivateKnowledgeSpaceProfileCandidateInput {
  return {
    ...normalizeScope(input),
    expectedActiveRevision:
      input.expectedActiveRevision === null
        ? null
        : positiveInteger(input.expectedActiveRevision, "expectedActiveRevision"),
    now: DateTimeSchema.parse(input.now),
    revision: positiveInteger(input.revision, "revision"),
  };
}

function normalizeFailure(
  input: FailKnowledgeSpaceProfileCandidateInput,
): FailKnowledgeSpaceProfileCandidateInput {
  return {
    ...normalizeScope(input),
    errorCode: requiredText(input.errorCode, "errorCode", 64),
    errorMessage: requiredText(input.errorMessage, "errorMessage", 16_384),
    now: DateTimeSchema.parse(input.now),
    revision: positiveInteger(input.revision, "revision"),
  };
}

function normalizeList(
  input: ListKnowledgeSpaceProfileRevisionsInput,
  maxListLimit: number,
): ListKnowledgeSpaceProfileRevisionsInput {
  const limit = positiveInteger(input.limit, "limit");
  if (limit > maxListLimit) {
    throw new Error(`Knowledge-space profile list limit exceeds maxListLimit=${maxListLimit}`);
  }
  return {
    ...normalizeScope(input),
    ...(input.afterRevision === undefined
      ? {}
      : { afterRevision: positiveInteger(input.afterRevision, "afterRevision") }),
    limit,
  };
}

function normalizeScope(input: KnowledgeSpaceProfileScope): KnowledgeSpaceProfileScope {
  if (!KnowledgeSpaceProfileKinds.includes(input.kind)) {
    throw new Error(`Invalid knowledge-space profile kind=${String(input.kind)}`);
  }
  return {
    kind: input.kind,
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function parseSnapshot(
  kind: KnowledgeSpaceProfileKind,
  value: unknown,
): KnowledgeSpaceProfileSnapshot {
  return kind === "embedding"
    ? KnowledgeSpaceEmbeddingProfileSchema.parse(value)
    : KnowledgeSpaceRetrievalProfileSchema.parse(value);
}

function materializeHead(
  head: StoredHead,
  profile: KnowledgeSpaceProfileRevision,
): KnowledgeSpaceProfileHead {
  return {
    activeRevision: head.activeRevision,
    createdAt: head.createdAt,
    id: head.id,
    kind: head.kind,
    knowledgeSpaceId: head.knowledgeSpaceId,
    profile: cloneRevision(profile),
    profileRevisionId: head.profileRevisionId,
    rowVersion: head.rowVersion,
    tenantId: head.tenantId,
    updatedAt: head.updatedAt,
  };
}

function cloneRevision(revision: KnowledgeSpaceProfileRevision): KnowledgeSpaceProfileRevision {
  return {
    ...(revision.activatedAt === undefined ? {} : { activatedAt: revision.activatedAt }),
    capabilitySnapshot: cloneJsonObject(revision.capabilitySnapshot, "capabilitySnapshot"),
    capabilitySnapshotDigest: revision.capabilitySnapshotDigest,
    createdAt: revision.createdAt,
    createdBySubjectId: revision.createdBySubjectId,
    ...(revision.dimension === undefined ? {} : { dimension: revision.dimension }),
    ...(revision.failedAt === undefined ? {} : { failedAt: revision.failedAt }),
    ...(revision.failureCode === undefined ? {} : { failureCode: revision.failureCode }),
    ...(revision.failureMessage === undefined ? {} : { failureMessage: revision.failureMessage }),
    id: revision.id,
    kind: revision.kind,
    knowledgeSpaceId: revision.knowledgeSpaceId,
    model: revision.model,
    pluginId: revision.pluginId,
    provider: revision.provider,
    revision: revision.revision,
    snapshot: cloneSnapshot(revision.kind, revision.snapshot),
    snapshotDigest: revision.snapshotDigest,
    state: revision.state,
    ...(revision.supersededAt === undefined ? {} : { supersededAt: revision.supersededAt }),
    tenantId: revision.tenantId,
    updatedAt: revision.updatedAt,
    ...(revision.vectorSpaceId === undefined ? {} : { vectorSpaceId: revision.vectorSpaceId }),
  };
}

function cloneSnapshot(
  kind: KnowledgeSpaceProfileKind,
  snapshot: KnowledgeSpaceProfileSnapshot,
): KnowledgeSpaceProfileSnapshot {
  return kind === "embedding"
    ? KnowledgeSpaceEmbeddingProfileSchema.parse(snapshot)
    : KnowledgeSpaceRetrievalProfileSchema.parse(snapshot);
}

function freezeRevision(revision: KnowledgeSpaceProfileRevision): KnowledgeSpaceProfileRevision {
  return deepFreeze(cloneRevision(revision));
}

function assertStoredRevision(revision: KnowledgeSpaceProfileRevision): void {
  if (
    knowledgeSpaceProfileSnapshotDigest(revision.snapshot) !== revision.snapshotDigest ||
    knowledgeSpaceProfileSnapshotDigest(revision.capabilitySnapshot) !==
      revision.capabilitySnapshotDigest
  ) {
    throw new Error(`Knowledge-space profile revision ${revision.id} is corrupt`);
  }
}

function cloneJsonObject(
  value: Readonly<Record<string, unknown>>,
  name: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Knowledge-space profile ${name} must be a JSON object`);
  }
  let cloned: unknown;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") throw new Error("JSON serialization returned no value");
    cloned = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error(`Knowledge-space profile ${name} must be JSON serializable`);
  }
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new Error(`Knowledge-space profile ${name} must be a JSON object`);
  }
  return cloned as Readonly<Record<string, unknown>>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function scopeKey(scope: KnowledgeSpaceProfileScope): string {
  return JSON.stringify([scope.tenantId, scope.knowledgeSpaceId, scope.kind]);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Knowledge-space profile ${name} must be a positive safe integer`);
  }
  return value;
}

function requiredText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`Knowledge-space profile ${name} must contain 1-${max} characters`);
  }
  return normalized;
}

function nonzeroUuid(value: string, name: string): string {
  const id = UuidSchema.parse(value);
  if (id === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`Knowledge-space profile ${name} must not be the zero UUID`);
  }
  return id;
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
