import type { CapabilityGrantProvenanceRepository } from "./capability-grant-provenance";
import type {
  DeletionLifecycleFenceGuard,
  DeletionLifecycleFenceToken,
} from "./deletion-lifecycle-fence";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import type {
  KnowledgeSpaceProfileMigrationFence,
  KnowledgeSpaceProfileMigrationRebuildScope,
  KnowledgeSpaceProfileMigrationRepository,
  KnowledgeSpaceProfileMigrationRun,
} from "./knowledge-space-profile-migration";
import { isTerminalKnowledgeSpaceProfileMigrationError } from "./knowledge-space-profile-migration";
import type { KnowledgeSpaceProfilePublicationRepository } from "./knowledge-space-profile-publication-repository";

export interface KnowledgeSpaceProfileMigrationCandidateBuildInput {
  readonly baseEmbeddingProfile?: KnowledgeSpaceProfileMigrationRun["baseEmbeddingProfile"];
  readonly basePublication: KnowledgeSpaceProfileMigrationRun["basePublication"];
  readonly baseRetrievalProfile: KnowledgeSpaceProfileMigrationRun["baseRetrievalProfile"];
  readonly candidateProfile: KnowledgeSpaceProfileMigrationRun["candidateProfile"];
  readonly changedKind: KnowledgeSpaceProfileMigrationRun["changedKind"];
  /** Cooperative durable fence used by long per-document rebuilds. */
  readonly execution?:
    | {
        heartbeat(): Promise<void>;
      }
    | undefined;
  readonly knowledgeSpaceId: string;
  readonly rebuildScope: KnowledgeSpaceProfileMigrationRebuildScope;
  readonly runId: string;
  readonly tenantId: string;
}

export interface KnowledgeSpaceProfileMigrationCandidateBuildResult {
  /** All documents and all dense members were rebuilt in the candidate vector space. */
  readonly fullVectorSpaceRebuilt?: boolean | undefined;
  /** All PageIndex nodes plus their Summary/Outline inputs were rebuilt. */
  readonly pageIndexSummaryOutlineRebuilt?: boolean | undefined;
  readonly publicationFingerprint: string;
  readonly publicationId: string;
  /** The successor publication is complete and already transitioned to `validating`. */
  readonly publicationStatus: "validating";
  /** All immutable members of the base publication were cloned into the successor. */
  readonly successorMembersCloned?: boolean | undefined;
}

export interface KnowledgeSpaceProfileMigrationCandidateBuilder {
  build(
    input: KnowledgeSpaceProfileMigrationCandidateBuildInput,
  ): Promise<KnowledgeSpaceProfileMigrationCandidateBuildResult>;
  /** Resolve an already-built immutable candidate after a process restart. */
  getBuiltCandidate(
    input: KnowledgeSpaceProfileMigrationCandidateBuildInput & {
      readonly publicationFingerprint: string;
      readonly publicationId: string;
    },
  ): Promise<KnowledgeSpaceProfileMigrationCandidateBuildResult>;
}

export interface KnowledgeSpaceProfileMigrationEvaluationResult {
  readonly passed: boolean;
  /** Bounded scalar metrics only; handlers never expose provider payloads or prompts. */
  readonly summary: Readonly<Record<string, boolean | number | string>>;
}

export interface KnowledgeSpaceProfileMigrationEvaluator {
  evaluate(input: {
    readonly candidate: KnowledgeSpaceProfileMigrationCandidateBuildResult;
    readonly run: KnowledgeSpaceProfileMigrationRun;
  }): Promise<KnowledgeSpaceProfileMigrationEvaluationResult>;
}

export interface KnowledgeSpaceProfileMigrationRuntimeOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly bindings: KnowledgeSpaceProfilePublicationRepository;
  readonly builder: KnowledgeSpaceProfileMigrationCandidateBuilder;
  readonly capabilityGrants?:
    | Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed">
    | undefined;
  readonly claimLimit: number;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly evaluator: KnowledgeSpaceProfileMigrationEvaluator;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly leaseMs: number;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: {
        readonly error: unknown;
        readonly run?: KnowledgeSpaceProfileMigrationRun;
      }) => void)
    | undefined;
  readonly repository: KnowledgeSpaceProfileMigrationRepository;
  readonly workerId: string;
}

export interface KnowledgeSpaceProfileMigrationRuntimeResult {
  readonly claimed: number;
  readonly failed: number;
  readonly stale: number;
  readonly succeeded: number;
}

export interface KnowledgeSpaceProfileMigrationRuntime {
  tick(): Promise<KnowledgeSpaceProfileMigrationRuntimeResult>;
}

/**
 * Bounded durable processor. Candidate construction and evaluation are injected infrastructure
 * boundaries; there is deliberately no default/placeholder builder that could claim success
 * without creating a complete immutable successor publication.
 */
export function createKnowledgeSpaceProfileMigrationRuntime({
  access,
  bindings,
  builder,
  capabilityGrants,
  claimLimit,
  deletionFence,
  evaluator,
  heartbeatIntervalMs,
  leaseMs,
  now = Date.now,
  onError,
  repository,
  workerId,
}: KnowledgeSpaceProfileMigrationRuntimeOptions): KnowledgeSpaceProfileMigrationRuntime {
  positiveInteger(claimLimit, "claimLimit");
  positiveInteger(leaseMs, "leaseMs");
  const heartbeatEvery = heartbeatIntervalMs ?? Math.max(1, Math.floor(leaseMs / 3));
  positiveInteger(heartbeatEvery, "heartbeatIntervalMs");
  if (heartbeatEvery >= leaseMs) throw new Error("Profile migration heartbeat must be below lease");
  if (!workerId.trim()) throw new Error("Profile migration workerId must not be empty");

  let active: Promise<KnowledgeSpaceProfileMigrationRuntimeResult> | undefined;

  const processRun = async (
    claimed: KnowledgeSpaceProfileMigrationRun,
  ): Promise<"failed" | "stale" | "succeeded"> => {
    let current = claimed;
    let deletionToken: DeletionLifecycleFenceToken | undefined;
    let fatalHeartbeatError: unknown;
    let lane: Promise<void> = Promise.resolve();
    const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
      const run = lane.then(operation);
      lane = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
    const assertNotDeleting = async () => {
      if (deletionToken) await deletionFence?.assertDeletionFenceUnchanged(deletionToken);
    };
    const revalidatePermission = async () => {
      if (current.capabilityGrantId) {
        try {
          await capabilityGrants?.assertPublicationAllowed({
            grantId: current.capabilityGrantId,
            knowledgeSpaceId: current.knowledgeSpaceId,
            tenantId: current.tenantId,
          });
        } catch {
          throw runtimeError(
            "PROFILE_MIGRATION_PERMISSION_INVALID",
            "Capability grant is no longer active",
          );
        }
        if (!capabilityGrants) {
          throw runtimeError(
            "PROFILE_MIGRATION_PERMISSION_INVALID",
            "Capability grant repository is unavailable",
          );
        }
        return;
      }
      if (
        !current.accessChannel ||
        !current.permissionSnapshotId ||
        !current.permissionSnapshotRevision ||
        !current.requestedBySubjectId
      ) {
        throw runtimeError(
          "PROFILE_MIGRATION_PERMISSION_INVALID",
          "Durable admin permission provenance is incomplete",
        );
      }
      let permission: Awaited<ReturnType<typeof access.revalidatePermissionSnapshot>>;
      try {
        permission = await access.revalidatePermissionSnapshot({
          expectedAccessChannel: current.accessChannel,
          id: current.permissionSnapshotId,
          knowledgeSpaceId: current.knowledgeSpaceId,
          subjectId: current.requestedBySubjectId,
          tenantId: current.tenantId,
        });
      } catch {
        throw runtimeError(
          "PROFILE_MIGRATION_PERMISSION_INVALID",
          "Durable admin permission is no longer valid",
        );
      }
      if (
        permission.revision !== current.permissionSnapshotRevision ||
        permission.role !== "owner"
      ) {
        throw runtimeError(
          "PROFILE_MIGRATION_PERMISSION_INVALID",
          "Durable admin permission is no longer valid",
        );
      }
    };
    const heartbeat = async () => {
      if (fatalHeartbeatError) throw fatalHeartbeatError;
      await serialize(async () => {
        if (fatalHeartbeatError) throw fatalHeartbeatError;
        await assertNotDeleting();
        await revalidatePermission();
        const heartbeatNow = now();
        const updated = await repository.heartbeat({
          ...fence(current, iso(heartbeatNow)),
          leaseExpiresAt: iso(heartbeatNow + leaseMs),
          workerId,
        });
        if (!updated) throw new Error("Profile migration heartbeat lost its execution fence");
        current = updated;
      });
    };

    const timer = setInterval(() => {
      void heartbeat().catch((error) => {
        fatalHeartbeatError ??= error;
        onError?.({ error, run: current });
      });
    }, heartbeatEvery);
    timer.unref?.();

    try {
      deletionToken = await deletionFence?.captureDeletionFence({
        knowledgeSpaceId: current.knowledgeSpaceId,
        tenantId: current.tenantId,
      });
      await serialize(revalidatePermission);

      let candidate: KnowledgeSpaceProfileMigrationCandidateBuildResult;
      if (current.checkpoint === "queued") {
        candidate = await builder.build({
          ...(current.baseEmbeddingProfile
            ? { baseEmbeddingProfile: current.baseEmbeddingProfile }
            : {}),
          basePublication: current.basePublication,
          baseRetrievalProfile: current.baseRetrievalProfile,
          candidateProfile: current.candidateProfile,
          changedKind: current.changedKind,
          execution: { heartbeat },
          knowledgeSpaceId: current.knowledgeSpaceId,
          rebuildScope: current.rebuildScope,
          runId: current.id,
          tenantId: current.tenantId,
        });
        assertBuildProof(current.rebuildScope, candidate);
        await assertNotDeleting();
        const checkpointed = await serialize(() =>
          repository.checkpoint({
            ...fence(current, iso(now())),
            candidatePublicationFingerprint: candidate.publicationFingerprint,
            candidatePublicationId: candidate.publicationId,
            checkpoint: "candidate-built",
          }),
        );
        if (!checkpointed) return "stale";
        current = checkpointed;
      } else {
        if (!current.candidatePublicationFingerprint || !current.candidatePublicationId) {
          throw runtimeError(
            "PROFILE_MIGRATION_CHECKPOINT_CORRUPT",
            "Durable checkpoint has no exact candidate publication",
          );
        }
        candidate = await builder.getBuiltCandidate({
          ...(current.baseEmbeddingProfile
            ? { baseEmbeddingProfile: current.baseEmbeddingProfile }
            : {}),
          basePublication: current.basePublication,
          baseRetrievalProfile: current.baseRetrievalProfile,
          candidateProfile: current.candidateProfile,
          changedKind: current.changedKind,
          execution: { heartbeat },
          knowledgeSpaceId: current.knowledgeSpaceId,
          publicationFingerprint: current.candidatePublicationFingerprint,
          publicationId: current.candidatePublicationId,
          rebuildScope: current.rebuildScope,
          runId: current.id,
          tenantId: current.tenantId,
        });
        assertBuildProof(current.rebuildScope, candidate);
      }

      if (current.checkpoint === "candidate-built") {
        await heartbeat();
        const evaluation = await evaluator.evaluate({ candidate, run: current });
        await heartbeat();
        if (!evaluation.passed) {
          throw runtimeError(
            "PROFILE_MIGRATION_EVALUATION_FAILED",
            "Candidate retrieval evaluation did not pass",
          );
        }
        await heartbeat();
        await bindings.bindCandidate({
          changedKind: current.changedKind,
          createdAt: iso(now()),
          knowledgeSpaceId: current.knowledgeSpaceId,
          profileRevision: current.candidateProfile.revision,
          publicationFingerprint: candidate.publicationFingerprint,
          tenantId: current.tenantId,
        });
        await heartbeat();
        const evaluated = await serialize(() =>
          repository.checkpoint({
            ...fence(current, iso(now())),
            candidatePublicationFingerprint: candidate.publicationFingerprint,
            candidatePublicationId: candidate.publicationId,
            checkpoint: "evaluated",
            evaluationSummary: evaluation.summary,
          }),
        );
        if (!evaluated) return "stale";
        current = evaluated;
      }

      if (current.checkpoint !== "evaluated") {
        throw runtimeError(
          "PROFILE_MIGRATION_CHECKPOINT_CORRUPT",
          `Cannot activate migration checkpoint=${current.checkpoint}`,
        );
      }
      await heartbeat();
      let alreadyActivated = false;
      try {
        const binding = await bindings.requireActivatedBinding({
          knowledgeSpaceId: current.knowledgeSpaceId,
          publicationFingerprint: candidate.publicationFingerprint,
          publicationId: candidate.publicationId,
          tenantId: current.tenantId,
        });
        const changed =
          current.changedKind === "embedding" ? binding.embeddingProfile : binding.retrievalProfile;
        alreadyActivated =
          changed?.id === current.candidateProfile.id &&
          changed.revision === current.candidateProfile.revision &&
          changed.snapshotDigest === current.candidateProfile.snapshotDigest;
      } catch {
        // An absent binding is the expected first-attempt path; joint CAS below remains authoritative.
      }
      let migrationRunCompleted = false;
      if (!alreadyActivated) {
        await heartbeat();
        const activation = await serialize(() => {
          const activatedAt = iso(now());
          return bindings.activateCandidate({
            changedKind: current.changedKind,
            expectedProfileHeadRevision:
              current.changedKind === "embedding"
                ? (current.baseEmbeddingProfile?.revision ?? null)
                : current.baseRetrievalProfile.revision,
            expectedPublicationHeadRevision: current.basePublication.headRevision,
            knowledgeSpaceId: current.knowledgeSpaceId,
            migrationFence: fence(current, activatedAt),
            profileRevision: current.candidateProfile.revision,
            publicationFingerprint: candidate.publicationFingerprint,
            tenantId: current.tenantId,
            updatedAt: activatedAt,
          });
        });
        migrationRunCompleted = activation.migrationRunCompleted === true;
      }
      if (migrationRunCompleted) return "succeeded";
      const succeeded = await serialize(() => repository.succeed(fence(current, iso(now()))));
      return succeeded ? "succeeded" : "stale";
    } catch (error) {
      onError?.({ error, run: current });
      try {
        const code = errorCode(error);
        const failed = await serialize(() =>
          repository.fail({
            ...fence(current, iso(now())),
            errorCode: code,
            errorMessage: errorMessage(error),
            terminal: isTerminalKnowledgeSpaceProfileMigrationError(code),
          }),
        );
        return failed ? "failed" : "stale";
      } catch (recordError) {
        onError?.({ error: recordError, run: current });
        return "stale";
      }
    } finally {
      clearInterval(timer);
      await lane;
    }
  };

  const tick = async (): Promise<KnowledgeSpaceProfileMigrationRuntimeResult> => {
    const timestamp = now();
    const claimed = await repository.claim({
      leaseExpiresAt: iso(timestamp + leaseMs),
      limit: claimLimit,
      now: iso(timestamp),
      workerId,
    });
    const result: { claimed: number; failed: number; stale: number; succeeded: number } = {
      claimed: claimed.length,
      failed: 0,
      stale: 0,
      succeeded: 0,
    };
    for (const run of claimed) result[await processRun(run)] += 1;
    return result;
  };

  return {
    tick: () => {
      active ??= tick().finally(() => {
        active = undefined;
      });
      return active;
    },
  };
}

class ProfileMigrationRuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProfileMigrationRuntimeError";
    this.code = code;
  }
}

function runtimeError(code: string, message: string): ProfileMigrationRuntimeError {
  return new ProfileMigrationRuntimeError(code, message);
}

function assertBuildProof(
  scope: KnowledgeSpaceProfileMigrationRebuildScope,
  candidate: KnowledgeSpaceProfileMigrationCandidateBuildResult,
): void {
  if (!candidate.publicationId || !candidate.publicationFingerprint) {
    throw runtimeError(
      "PROFILE_MIGRATION_CANDIDATE_INVALID",
      "Candidate builder did not return an exact publication identity",
    );
  }
  if (candidate.publicationStatus !== "validating") {
    throw runtimeError(
      "PROFILE_MIGRATION_CANDIDATE_NOT_VALIDATING",
      "Candidate publication is not ready for joint activation",
    );
  }
  if (scope === "full-vector-space" && candidate.fullVectorSpaceRebuilt !== true) {
    throw runtimeError(
      "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
      "Embedding profile migration requires full vector-space rebuild proof",
    );
  }
  if (
    scope === "full-page-index-summary-outline" &&
    candidate.pageIndexSummaryOutlineRebuilt !== true
  ) {
    throw runtimeError(
      "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
      "Reasoning profile migration requires full PageIndex Summary/Outline rebuild proof",
    );
  }
  if (scope === "clone-publication" && candidate.successorMembersCloned !== true) {
    throw runtimeError(
      "PROFILE_MIGRATION_SUCCESSOR_INCOMPLETE",
      "Settings-only profile migration requires a complete successor publication",
    );
  }
}

function fence(
  run: KnowledgeSpaceProfileMigrationRun,
  now: string,
): KnowledgeSpaceProfileMigrationFence {
  if (!run.leaseToken) throw new Error("Profile migration has no execution lease token");
  return {
    expectedRowVersion: run.rowVersion,
    leaseToken: run.leaseToken,
    now,
    runId: run.id,
  };
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 64);
  }
  return "PROFILE_MIGRATION_UNEXPECTED";
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unexpected profile migration failure")
    .replaceAll(/[\r\n\t]+/g, " ")
    .slice(0, 2_000);
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive`);
}

function iso(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new Error("Profile migration clock must be finite");
  return new Date(timestamp).toISOString();
}
