import type { AuthSubject, KnowledgeSpaceRetrievalProfile } from "@knowledge/core";

import type { DeletionLifecycleFenceGuard } from "./deletion-lifecycle-fence";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import type {
  KnowledgeSpaceAccessService,
  KnowledgeSpaceApiKeyPermissionBinding,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceCallerKind,
  knowledgeSpaceAccessChannelForCallerKind,
} from "./knowledge-space-authorization";
import {
  KnowledgeSpaceProfileMigrationConflictError,
  type KnowledgeSpaceProfileMigrationRebuildScope,
  type KnowledgeSpaceProfileMigrationRepository,
  type KnowledgeSpaceProfileMigrationRun,
} from "./knowledge-space-profile-migration";
import type {
  KnowledgeSpaceProfileKind,
  KnowledgeSpaceProfileRepository,
  KnowledgeSpaceProfileRevision,
} from "./knowledge-space-profile-repository";
import type { ProjectionSetPublicationRepository } from "./projection-publication-repository";

export interface KnowledgeSpaceProfileMigrationPrincipal {
  readonly apiKey?: KnowledgeSpaceApiKeyPermissionBinding | undefined;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly capabilityGrantId?: string | undefined;
  readonly subject: AuthSubject;
}

export interface RequestKnowledgeSpaceProfileMigrationInput
  extends KnowledgeSpaceProfileMigrationPrincipal {
  readonly candidateRevision: number;
  readonly changedKind: KnowledgeSpaceProfileKind;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
}

export interface KnowledgeSpaceProfileMigrationService {
  cancel(
    input: KnowledgeSpaceProfileMigrationPrincipal & {
      readonly knowledgeSpaceId: string;
      readonly reason?: string | undefined;
      readonly runId: string;
    },
  ): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  get(
    input: KnowledgeSpaceProfileMigrationPrincipal & {
      readonly knowledgeSpaceId: string;
      readonly runId: string;
    },
  ): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  requiresMigration(input: {
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  }): Promise<boolean>;
  request(
    input: RequestKnowledgeSpaceProfileMigrationInput,
  ): Promise<KnowledgeSpaceProfileMigrationRun>;
  retry(
    input: KnowledgeSpaceProfileMigrationPrincipal & {
      readonly knowledgeSpaceId: string;
      readonly runId: string;
    },
  ): Promise<KnowledgeSpaceProfileMigrationRun | null>;
}

export interface CreateKnowledgeSpaceProfileMigrationServiceOptions {
  readonly access: Pick<
    KnowledgeSpaceAccessService,
    "createPermissionSnapshot" | "getPermissionSnapshot"
  >;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly maxExecutionAttempts?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly permissionSnapshotTtlMs?: number | undefined;
  readonly profiles: KnowledgeSpaceProfileRepository;
  readonly publications: Pick<ProjectionSetPublicationRepository, "getPublished">;
  readonly repository: KnowledgeSpaceProfileMigrationRepository;
}

export function createKnowledgeSpaceProfileMigrationService({
  access,
  authorization,
  deletionFence,
  maxExecutionAttempts = 3,
  now = Date.now,
  permissionSnapshotTtlMs = 60 * 60_000,
  profiles,
  publications,
  repository,
}: CreateKnowledgeSpaceProfileMigrationServiceOptions): KnowledgeSpaceProfileMigrationService {
  if (!Number.isSafeInteger(maxExecutionAttempts) || maxExecutionAttempts < 1) {
    throw new Error("Profile migration maxExecutionAttempts must be positive");
  }
  if (!Number.isSafeInteger(permissionSnapshotTtlMs) || permissionSnapshotTtlMs < 1) {
    throw new Error("Profile migration permissionSnapshotTtlMs must be positive");
  }

  const authorize = async (
    principal: KnowledgeSpaceProfileMigrationPrincipal,
    knowledgeSpaceId: string,
  ) => {
    if (principal.capabilityGrantId) return;
    try {
      await authorization.authorize({
        callerKind: principal.callerKind,
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject: principal.subject,
      });
    } catch (error) {
      if (error instanceof KnowledgeSpaceAuthorizationError) {
        throw new KnowledgeSpaceProfileMigrationServiceError(
          "PROFILE_MIGRATION_FORBIDDEN",
          "Knowledge-space admin access is required",
        );
      }
      throw error;
    }
  };

  const getAuthorized = async (
    principal: KnowledgeSpaceProfileMigrationPrincipal,
    knowledgeSpaceId: string,
    runId: string,
  ) => {
    const run = await repository.get(runId);
    if (
      !run ||
      run.tenantId !== principal.subject.tenantId ||
      run.knowledgeSpaceId !== knowledgeSpaceId
    ) {
      return null;
    }
    await authorize(principal, knowledgeSpaceId);
    return run;
  };

  return {
    requiresMigration: async (input) => (await publications.getPublished(input)) !== null,
    request: async (input) => {
      await authorize(input, input.knowledgeSpaceId);
      const replay = await repository.findByRequest({
        ...(input.capabilityGrantId ? { capabilityGrantId: input.capabilityGrantId } : {}),
        idempotencyKey: input.idempotencyKey,
        knowledgeSpaceId: input.knowledgeSpaceId,
        ...(input.capabilityGrantId ? {} : { requestedBySubjectId: input.subject.subjectId }),
        tenantId: input.subject.tenantId,
      });
      if (replay) {
        if (
          replay.changedKind !== input.changedKind ||
          replay.candidateProfile.revision !== input.candidateRevision
        ) {
          throw new KnowledgeSpaceProfileMigrationConflictError(
            "PROFILE_MIGRATION_IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different candidate profile",
          );
        }
        return replay;
      }
      await deletionFence?.captureDeletionFence({
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.subject.tenantId,
      });
      const scope = {
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.subject.tenantId,
      };
      const [candidate, embeddingHead, retrievalHead, publication] = await Promise.all([
        profiles.getRevision({
          ...scope,
          kind: input.changedKind,
          revision: input.candidateRevision,
        }),
        profiles.getHead({ ...scope, kind: "embedding" }),
        profiles.getHead({ ...scope, kind: "retrieval" }),
        publications.getPublished(scope),
      ]);
      if (!candidate || candidate.state !== "candidate") {
        throw new KnowledgeSpaceProfileMigrationServiceError(
          "PROFILE_MIGRATION_CANDIDATE_NOT_FOUND",
          "Immutable candidate profile revision was not found",
        );
      }
      if (!retrievalHead || !publication) {
        throw new KnowledgeSpaceProfileMigrationServiceError(
          "PROFILE_MIGRATION_BASE_NOT_PUBLISHED",
          "Profile migrations require an active retrieval profile and published projection head",
        );
      }
      const timestamp = now();
      const createdAt = new Date(timestamp).toISOString();
      const permission = input.capabilityGrantId
        ? undefined
        : await issueKnowledgeSpaceDurablePermission({
            access,
            ...(input.apiKey ? { apiKey: input.apiKey } : {}),
            authorization,
            callerKind: input.callerKind,
            expiresAt: new Date(
              permissionExpiry(timestamp, permissionSnapshotTtlMs, input.apiKey),
            ).toISOString(),
            knowledgeSpaceId: input.knowledgeSpaceId,
            requiredAccess: "admin",
            subject: input.subject,
          });

      return repository.start({
        ...(input.capabilityGrantId
          ? { capabilityGrantId: input.capabilityGrantId }
          : permission
            ? {
                accessChannel: permission.accessChannel,
                permissionSnapshotId: permission.id,
                permissionSnapshotRevision: permission.revision,
                requestedBySubjectId: input.subject.subjectId,
              }
            : {}),
        ...(embeddingHead ? { baseEmbeddingProfile: reference(embeddingHead.profile) } : {}),
        basePublication: {
          fingerprint: publication.fingerprint,
          headRevision: publication.headRevision,
          id: publication.id,
        },
        baseRetrievalProfile: reference(retrievalHead.profile),
        candidateProfile: reference(candidate),
        changedKind: input.changedKind,
        createdAt,
        idempotencyKey: input.idempotencyKey,
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxExecutionAttempts,
        rebuildScope: classifyRebuildScope(input.changedKind, candidate, retrievalHead.profile),
        tenantId: input.subject.tenantId,
      });
    },
    get: (input) => getAuthorized(input, input.knowledgeSpaceId, input.runId),
    cancel: async (input) => {
      const run = await getAuthorized(input, input.knowledgeSpaceId, input.runId);
      if (!run) return null;
      const timestamp = now();
      const canceledAt = new Date(timestamp).toISOString();
      const permission = input.capabilityGrantId
        ? undefined
        : await issueKnowledgeSpaceDurablePermission({
            access,
            ...(input.apiKey ? { apiKey: input.apiKey } : {}),
            authorization,
            callerKind: input.callerKind,
            expiresAt: new Date(
              permissionExpiry(timestamp, permissionSnapshotTtlMs, input.apiKey),
            ).toISOString(),
            knowledgeSpaceId: input.knowledgeSpaceId,
            requiredAccess: "admin",
            subject: input.subject,
          });
      const canceled = await repository.cancel({
        ...(input.capabilityGrantId
          ? { capabilityGrantId: input.capabilityGrantId }
          : permission
            ? {
                accessChannel: permission.accessChannel,
                permissionSnapshotId: permission.id,
                permissionSnapshotRevision: permission.revision,
                requestedBySubjectId: input.subject.subjectId,
              }
            : {}),
        now: canceledAt,
        reason: input.reason ?? "Canceled by knowledge-space administrator",
        runId: run.id,
      });
      if (canceled?.runState === "canceled") {
        const candidate = await profiles.getRevision({
          kind: canceled.changedKind,
          knowledgeSpaceId: canceled.knowledgeSpaceId,
          revision: canceled.candidateProfile.revision,
          tenantId: canceled.tenantId,
        });
        if (
          candidate?.id === canceled.candidateProfile.id &&
          candidate.snapshotDigest === canceled.candidateProfile.snapshotDigest &&
          candidate.state === "candidate"
        ) {
          await profiles.failCandidate({
            errorCode: "PROFILE_MIGRATION_CANCELED",
            errorMessage: "Profile migration was canceled by a knowledge-space administrator",
            kind: canceled.changedKind,
            knowledgeSpaceId: canceled.knowledgeSpaceId,
            now: canceledAt,
            revision: canceled.candidateProfile.revision,
            tenantId: canceled.tenantId,
          });
        }
      }
      return canceled;
    },
    retry: async (input) => {
      const run = await getAuthorized(input, input.knowledgeSpaceId, input.runId);
      if (!run) return null;
      if (run.capabilityGrantId) {
        if (!input.capabilityGrantId) return null;
        await deletionFence?.captureDeletionFence({
          knowledgeSpaceId: run.knowledgeSpaceId,
          tenantId: run.tenantId,
        });
        return repository.retry({
          capabilityGrantId: input.capabilityGrantId,
          expectedCapabilityGrantId: run.capabilityGrantId,
          now: new Date(now()).toISOString(),
          runId: run.id,
        });
      }
      if (run.requestedBySubjectId !== input.subject.subjectId) return null;
      await deletionFence?.captureDeletionFence({
        knowledgeSpaceId: run.knowledgeSpaceId,
        tenantId: run.tenantId,
      });
      if (
        !run.permissionSnapshotId ||
        !run.permissionSnapshotRevision ||
        !run.requestedBySubjectId ||
        !run.accessChannel
      ) {
        return null;
      }
      const previousPermission = await access.getPermissionSnapshot({
        id: run.permissionSnapshotId,
        knowledgeSpaceId: run.knowledgeSpaceId,
        tenantId: run.tenantId,
      });
      const currentChannel = knowledgeSpaceAccessChannelForCallerKind(input.callerKind);
      if (
        !previousPermission ||
        previousPermission.revision !== run.permissionSnapshotRevision ||
        previousPermission.subjectId !== run.requestedBySubjectId ||
        previousPermission.accessChannel !== run.accessChannel ||
        currentChannel !== run.accessChannel ||
        !sameApiKeyProvenance(previousPermission, input.apiKey)
      ) {
        throw new KnowledgeSpaceProfileMigrationServiceError(
          "PROFILE_MIGRATION_PERMISSION_PROVENANCE_MISMATCH",
          "Retry must use the original subject, access channel, and API-key provenance",
        );
      }
      const timestamp = now();
      const permission = await issueKnowledgeSpaceDurablePermission({
        access,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        authorization,
        callerKind: input.callerKind,
        expiresAt: new Date(
          permissionExpiry(timestamp, permissionSnapshotTtlMs, input.apiKey),
        ).toISOString(),
        knowledgeSpaceId: run.knowledgeSpaceId,
        requiredAccess: "admin",
        subject: input.subject,
      });
      return repository.retry({
        expectedPermissionSnapshotId: run.permissionSnapshotId,
        expectedPermissionSnapshotRevision: run.permissionSnapshotRevision,
        now: new Date(timestamp).toISOString(),
        permissionSnapshotId: permission.id,
        permissionSnapshotRevision: permission.revision,
        requestedBySubjectId: input.subject.subjectId,
        runId: run.id,
      });
    },
  };
}

function sameApiKeyProvenance(
  snapshot: Awaited<ReturnType<KnowledgeSpaceAccessService["getPermissionSnapshot"]>>,
  apiKey?: KnowledgeSpaceApiKeyPermissionBinding,
): boolean {
  if (!snapshot) return false;
  if (!snapshot.apiKeyId) return apiKey === undefined;
  return apiKey?.id === snapshot.apiKeyId && apiKey.revision === snapshot.apiKeyRevision;
}

export class KnowledgeSpaceProfileMigrationServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeSpaceProfileMigrationServiceError";
    this.code = code;
  }
}

function classifyRebuildScope(
  changedKind: KnowledgeSpaceProfileKind,
  candidate: KnowledgeSpaceProfileRevision,
  activeRetrieval: KnowledgeSpaceProfileRevision,
): KnowledgeSpaceProfileMigrationRebuildScope {
  if (changedKind === "embedding") return "full-vector-space";
  const next = candidate.snapshot as KnowledgeSpaceRetrievalProfile;
  const current = activeRetrieval.snapshot as KnowledgeSpaceRetrievalProfile;
  return sameModelSelection(next.reasoningModel, current.reasoningModel)
    ? "clone-publication"
    : "full-page-index-summary-outline";
}

function sameModelSelection(
  left: { readonly model: string; readonly pluginId: string; readonly provider: string },
  right: { readonly model: string; readonly pluginId: string; readonly provider: string },
): boolean {
  return (
    left.model === right.model &&
    left.pluginId === right.pluginId &&
    left.provider === right.provider
  );
}

function reference(profile: KnowledgeSpaceProfileRevision) {
  return { id: profile.id, revision: profile.revision, snapshotDigest: profile.snapshotDigest };
}

function permissionExpiry(
  timestamp: number,
  ttlMs: number,
  apiKey?: KnowledgeSpaceApiKeyPermissionBinding,
): number {
  return Math.min(
    timestamp + ttlMs,
    apiKey?.expiresAt ? Date.parse(apiKey.expiresAt) : Number.POSITIVE_INFINITY,
  );
}

export function toPublicKnowledgeSpaceProfileMigration(run: KnowledgeSpaceProfileMigrationRun) {
  return Object.freeze({
    ...(run.candidatePublicationFingerprint
      ? { candidatePublicationFingerprint: run.candidatePublicationFingerprint }
      : {}),
    changedKind: run.changedKind,
    checkpoint: run.checkpoint,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    createdAt: run.createdAt,
    ...(run.evaluationSummary
      ? { evaluationSummary: publicEvaluationSummary(run.evaluationSummary) }
      : {}),
    id: run.id,
    knowledgeSpaceId: run.knowledgeSpaceId,
    ...(run.lastErrorCode ? { errorCode: run.lastErrorCode } : {}),
    rebuildScope: run.rebuildScope,
    runState: run.runState,
    updatedAt: run.updatedAt,
  });
}

function publicEvaluationSummary(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, boolean | number | string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        typeof item === "boolean" || typeof item === "number" || typeof item === "string"
          ? [[key, item]]
          : [],
      ),
    ),
  );
}

export function isKnowledgeSpaceProfileMigrationConflict(error: unknown): boolean {
  return error instanceof KnowledgeSpaceProfileMigrationConflictError;
}
