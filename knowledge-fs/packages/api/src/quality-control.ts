import { randomUUID } from "node:crypto";

import type {
  AuthSubject,
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { AnswerTraceSchema } from "@knowledge/core";

import type { AnswerTraceRepository } from "./answer-trace-repository";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import type {
  PublishedKnowledgeSpaceRuntimeSnapshot,
  PublishedKnowledgeSpaceRuntimeSnapshotResolver,
} from "./published-knowledge-space-runtime-snapshot";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import {
  type RetrievalTestExecutor,
  assertRetrievalTestRuntimeCapabilities,
} from "./retrieval-test";

export const QUALITY_REPLAY_STATES = ["queued", "running", "passed", "failed", "canceled"] as const;
export type QualityReplayState = (typeof QUALITY_REPLAY_STATES)[number];

export const QUALITY_BAD_CASE_STATES = ["open", "replaying", "fixed", "dismissed"] as const;
export type QualityBadCaseState = (typeof QUALITY_BAD_CASE_STATES)[number];

export interface QualityPermissionBinding {
  readonly accessChannel: "interactive" | "service_api" | "mcp" | "agent";
  readonly candidateGrants: readonly string[];
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly requestedBySubjectId: string;
}

export interface FrozenQualityRuntimeSnapshot {
  readonly embeddingCapabilitySnapshot?: Readonly<Record<string, unknown>> | undefined;
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly projectionSnapshot: PublishedProjectionReadSnapshot;
  readonly retrievalCapabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
}

export interface QualityAnswerTraceSummary {
  readonly completed: boolean;
  readonly createdAt: string;
  readonly evidenceBundleId?: string | undefined;
  readonly evidenceState?: string | undefined;
  readonly finalScore?: number | undefined;
  readonly id: string;
  readonly mode: "auto" | "deep" | "fast" | "research";
  readonly profile: {
    readonly embeddingModel?: string | undefined;
    readonly embeddingVectorSpaceId?: string | undefined;
    readonly projectionPublicationId?: string | undefined;
    readonly projectionVersion?: number | undefined;
    readonly reasoningModel?: string | undefined;
    readonly rerankModel?: string | undefined;
    readonly retrievalProfileRevision?: number | undefined;
  };
  readonly query: string;
  readonly scores: {
    readonly final?: number | undefined;
    readonly rerank?: number | undefined;
    readonly retrieval?: number | undefined;
  };
  readonly stages: readonly {
    readonly candidateCount?: number | undefined;
    readonly name: string;
    readonly status: "error" | "ok" | "skipped";
  }[];
}

export interface QualityAnswerTraceHistoryInput {
  readonly candidateGrants: readonly string[];
  readonly cursor?: { readonly createdAt: string; readonly id: string } | undefined;
  readonly from?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly mode?: "auto" | "deep" | "fast" | "research" | undefined;
  readonly query?: string | undefined;
  readonly status?: "completed" | "failed" | undefined;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly to?: string | undefined;
}

export interface QualityAnswerTraceHistoryResult {
  readonly items: readonly QualityAnswerTraceSummary[];
  readonly nextCursor?: { readonly createdAt: string; readonly id: string } | undefined;
}

export interface MissingEvidenceReview {
  readonly actorSubjectId: string;
  readonly createdAt: string;
  readonly id: string;
  readonly itemKey: string;
  readonly knowledgeSpaceId: string;
  readonly reason?: string | undefined;
  readonly revision: number;
  readonly status: "active" | "dismissed";
  readonly traceId: string;
  readonly updatedAt: string;
}

export interface QualityHistoryEvent {
  readonly action: string;
  readonly actorSubjectId: string;
  readonly createdAt: string;
  readonly fromStatus?: string | undefined;
  readonly id: string;
  readonly reason?: string | undefined;
  readonly revision: number;
  readonly toStatus: string;
}

export interface ProductionBadCase {
  readonly actorSubjectId: string;
  readonly createdAt: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly reason: string;
  readonly replayRunId?: string | undefined;
  readonly revision: number;
  readonly status: QualityBadCaseState;
  readonly tags: readonly string[];
  readonly traceId: string;
  readonly updatedAt: string;
}

export interface QualityReplayItem {
  readonly expectedEvidenceIds: readonly string[];
  readonly goldenQuestionId: string;
  readonly id: string;
  readonly ordinal: number;
  readonly question: string;
  readonly result?: Readonly<Record<string, unknown>> | undefined;
  readonly state: QualityReplayState;
  readonly traceId?: string | undefined;
}

export interface QualityReplayRun {
  readonly attempt: number;
  readonly createdAt: string;
  readonly error?: string | undefined;
  readonly frozenSnapshot: FrozenQualityRuntimeSnapshot;
  readonly id: string;
  readonly items: readonly QualityReplayItem[];
  readonly knowledgeSpaceId: string;
  readonly mode: "deep" | "fast" | "research";
  readonly permission: QualityPermissionBinding;
  readonly revision: number;
  readonly state: QualityReplayState;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface QualityGoldenQuestionSnapshot {
  readonly expectedEvidenceIds: readonly string[];
  readonly id: string;
  readonly question: string;
}

export interface QualityTrendReport {
  readonly baseline: {
    readonly failedQueries: number;
    readonly passRate: number;
    readonly totalReplays: number;
  };
  readonly current: {
    readonly badCases: Readonly<Record<QualityBadCaseState, number>>;
    readonly failedQueries: number;
    readonly passRate: number;
    readonly totalReplays: number;
  };
  readonly from: string;
  readonly slices: readonly {
    readonly failedQueries: number;
    readonly mode: string;
    readonly model: string;
    readonly passRate: number;
    readonly profileRevision: number;
    readonly replayRuns: number;
  }[];
  readonly to: string;
  readonly topUnanswered: readonly { readonly count: number; readonly query: string }[];
}

export interface QualityControlRepository {
  cancelReplay(input: {
    readonly actorSubjectId: string;
    readonly expectedRevision: number;
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly permission: QualityPermissionBinding;
    readonly tenantId: string;
  }): Promise<QualityReplayRun | null>;
  claimReplay(input: {
    readonly leaseMs: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<QualityReplayRun | null>;
  completeReplay(input: {
    readonly error?: string | undefined;
    readonly expectedLeaseToken: string;
    readonly id: string;
    readonly now: string;
    /** Diagnostic intent only; repositories must still enforce the current durable permission. */
    readonly permissionRevoked?: boolean | undefined;
    readonly state: "failed" | "passed";
  }): Promise<QualityReplayRun | null>;
  createBadCase(input: {
    readonly actorSubjectId: string;
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly permission: QualityPermissionBinding;
    readonly reason: string;
    readonly tags: readonly string[];
    readonly tenantId: string;
    readonly traceId: string;
  }): Promise<ProductionBadCase>;
  createReplay(input: {
    readonly frozenSnapshot: FrozenQualityRuntimeSnapshot;
    readonly idempotencyKey: string;
    readonly knowledgeSpaceId: string;
    readonly mode: "deep" | "fast" | "research";
    readonly permission: QualityPermissionBinding;
    readonly questions: readonly QualityGoldenQuestionSnapshot[];
    readonly requestFingerprint: string;
    readonly tenantId: string;
  }): Promise<QualityReplayRun>;
  getBadCase(input: {
    readonly candidateGrants: readonly string[];
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<ProductionBadCase | null>;
  getMissingReview(input: {
    readonly candidateGrants: readonly string[];
    readonly itemKey: string;
    readonly knowledgeSpaceId: string;
    readonly subjectId: string;
    readonly tenantId: string;
    readonly traceId: string;
  }): Promise<MissingEvidenceReview | null>;
  getReplay(input: {
    readonly candidateGrants: readonly string[];
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<QualityReplayRun | null>;
  listBadCases(input: {
    readonly candidateGrants: readonly string[];
    readonly cursor?: { readonly createdAt: string; readonly id: string } | undefined;
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly status?: QualityBadCaseState | undefined;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<{
    readonly items: readonly ProductionBadCase[];
    readonly nextCursor?: { readonly createdAt: string; readonly id: string };
  }>;
  listHistory(input: {
    readonly aggregateId: string;
    readonly aggregateType: "bad-case" | "missing-evidence";
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<readonly QualityHistoryEvent[]>;
  listReplays(input: {
    readonly candidateGrants: readonly string[];
    readonly cursor?: { readonly createdAt: string; readonly id: string } | undefined;
    readonly from?: string | undefined;
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly mode?: "deep" | "fast" | "research" | undefined;
    readonly state?: QualityReplayState | undefined;
    readonly subjectId: string;
    readonly tenantId: string;
    readonly to?: string | undefined;
  }): Promise<{
    readonly items: readonly QualityReplayRun[];
    readonly nextCursor?: { readonly createdAt: string; readonly id: string } | undefined;
  }>;
  listTraces(input: QualityAnswerTraceHistoryInput): Promise<QualityAnswerTraceHistoryResult>;
  recordReplayItem(input: {
    readonly expectedLeaseToken: string;
    readonly itemId: string;
    readonly now: string;
    readonly result: Readonly<Record<string, unknown>>;
    readonly runId: string;
    readonly state: "failed" | "passed";
    readonly traceId: string;
  }): Promise<boolean>;
  retryReplay(input: {
    readonly actorSubjectId: string;
    readonly expectedRevision: number;
    readonly frozenSnapshot: FrozenQualityRuntimeSnapshot;
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly permission: QualityPermissionBinding;
    readonly tenantId: string;
  }): Promise<QualityReplayRun | null>;
  trends(input: {
    readonly candidateGrants: readonly string[];
    readonly from: string;
    readonly knowledgeSpaceId: string;
    readonly subjectId: string;
    readonly tenantId: string;
    readonly to: string;
    readonly topLimit: number;
  }): Promise<QualityTrendReport>;
  updateBadCase(input: {
    readonly actorSubjectId: string;
    readonly candidateGrants: readonly string[];
    readonly expectedRevision: number;
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly permission: QualityPermissionBinding;
    readonly reason?: string | undefined;
    readonly replayRunId?: string | undefined;
    readonly status: QualityBadCaseState;
    readonly tags?: readonly string[] | undefined;
    readonly tenantId: string;
  }): Promise<ProductionBadCase | null>;
  upsertMissingReview(input: {
    readonly actorSubjectId: string;
    readonly candidateGrants: readonly string[];
    readonly expectedRevision: number;
    readonly itemKey: string;
    readonly knowledgeSpaceId: string;
    readonly permission: QualityPermissionBinding;
    readonly reason?: string | undefined;
    readonly status: "active" | "dismissed";
    readonly tenantId: string;
    readonly traceId: string;
  }): Promise<MissingEvidenceReview | null>;
}

export interface QualityReplayRuntimeOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly answerTraces: Pick<AnswerTraceRepository, "create">;
  readonly executor: RetrievalTestExecutor;
  readonly generateTraceId?: (() => string) | undefined;
  readonly intervalMs?: number | undefined;
  readonly leaseMs?: number | undefined;
  readonly now?: (() => string) | undefined;
  readonly repository: QualityControlRepository;
  readonly runtimeSnapshots: PublishedKnowledgeSpaceRuntimeSnapshotResolver;
  readonly workerId: string;
}

export interface QualityReplayRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<boolean>;
}

export class QualityReplayPermissionRevokedError extends Error {
  constructor() {
    super("Quality replay permission was revoked");
    this.name = "QualityReplayPermissionRevokedError";
  }
}

/**
 * Durable replay worker. The repository owns outbox claiming, leases, checkpoints, and the final
 * transaction-level permission/deletion fence; this runtime owns the real published retrieval
 * execution and revalidates the server-issued permission before every golden question.
 */
export function createQualityReplayRuntime({
  access,
  answerTraces,
  executor,
  generateTraceId = randomUUID,
  intervalMs = 1_000,
  leaseMs = 30_000,
  now = () => new Date().toISOString(),
  repository,
  runtimeSnapshots,
  workerId,
}: QualityReplayRuntimeOptions): QualityReplayRuntime {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 10) {
    throw new Error("Quality replay intervalMs must be at least 10");
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = async () => {
    const run = await repository.claimReplay({ leaseMs, now: now(), workerId });
    if (!run) return false;
    const leaseToken = replayLeaseToken(run);
    let anyFailed = false;
    try {
      assertRetrievalTestRuntimeCapabilities({
        ...(run.frozenSnapshot.embeddingCapabilitySnapshot
          ? { embeddingCapabilitySnapshot: run.frozenSnapshot.embeddingCapabilitySnapshot }
          : {}),
        ...(run.frozenSnapshot.embeddingProfile
          ? { embeddingProfile: run.frozenSnapshot.embeddingProfile }
          : {}),
        mode: run.mode,
        retrievalCapabilitySnapshot: run.frozenSnapshot.retrievalCapabilitySnapshot,
        retrievalProfile: run.frozenSnapshot.retrievalProfile,
      });

      for (const item of run.items.filter((candidate) => candidate.state === "queued")) {
        await revalidateReplayPermission(access, run);
        await runtimeSnapshots.assertReady({
          knowledgeSpaceId: run.knowledgeSpaceId,
          resolvedMode: run.mode,
          tenantId: run.tenantId,
        });
        const traceId = generateTraceId();
        const result = await executor.execute({
          ...(run.frozenSnapshot.embeddingProfile
            ? { embeddingProfile: run.frozenSnapshot.embeddingProfile }
            : {}),
          knowledgeSpaceId: run.knowledgeSpaceId,
          mode: run.mode,
          permissionScope: run.permission.candidateGrants,
          projectionSnapshot: run.frozenSnapshot.projectionSnapshot,
          query: item.question,
          retrievalProfile: run.frozenSnapshot.retrievalProfile,
          subject: replaySubject(run),
          traceId,
        });
        const retrievedEvidenceIds = new Set(
          result.items.flatMap((candidate) => [candidate.nodeId, ...candidate.projectionIds]),
        );
        const missingEvidenceIds = item.expectedEvidenceIds.filter(
          (expected) => !retrievedEvidenceIds.has(expected),
        );
        const state = missingEvidenceIds.length === 0 ? "passed" : "failed";
        anyFailed ||= state === "failed";
        const traceTimestamp = now();
        await answerTraces.create(
          AnswerTraceSchema.parse({
            createdAt: traceTimestamp,
            id: traceId,
            knowledgeSpaceId: run.knowledgeSpaceId,
            mode: run.mode,
            permissionSnapshot: {
              accessChannel: run.permission.accessChannel,
              id: run.permission.permissionSnapshotId,
              revision: run.permission.permissionSnapshotRevision,
            },
            query: item.question,
            steps: result.stages.map((stage, index) => ({
              endedAt: traceTimestamp,
              metadata: {
                ...(stage.candidateCount === undefined
                  ? {}
                  : { candidateCount: stage.candidateCount }),
                ...(stage.durationMs === undefined ? {} : { durationMs: stage.durationMs }),
                ...(stage.filteredCount === undefined
                  ? {}
                  : { filteredCount: stage.filteredCount }),
                ...(index === 0
                  ? {
                      ...(run.frozenSnapshot.embeddingProfile
                        ? {
                            ...(run.frozenSnapshot.embeddingProfile.dimension === undefined
                              ? {}
                              : {
                                  dimension: run.frozenSnapshot.embeddingProfile.dimension,
                                }),
                            model: run.frozenSnapshot.embeddingProfile.model,
                            vectorSpaceId: run.frozenSnapshot.embeddingProfile.vectorSpaceId,
                          }
                        : {}),
                      plan: result.plan,
                      projectionSnapshot: run.frozenSnapshot.projectionSnapshot,
                      qualityReplay: {
                        goldenQuestionId: item.goldenQuestionId,
                        itemId: item.id,
                        runId: run.id,
                      },
                      retrievalProfile: run.frozenSnapshot.retrievalProfile,
                    }
                  : {}),
              },
              name: stage.name,
              startedAt: traceTimestamp,
              status: stage.status === "executed" ? "ok" : "skipped",
            })),
            subjectId: run.permission.requestedBySubjectId,
          }),
        );
        const persisted = await repository.recordReplayItem({
          expectedLeaseToken: leaseToken,
          itemId: item.id,
          now: traceTimestamp,
          result: Object.freeze({
            evidenceDiff: {
              missingEvidenceIds,
              retrievedEvidenceIds: [...retrievedEvidenceIds].sort(),
            },
            metrics: result.metrics,
            plan: result.plan,
            stages: result.stages,
          }),
          runId: run.id,
          state,
          traceId,
        });
        if (!persisted) throw new Error("Quality replay lease was lost");
      }

      await revalidateReplayPermission(access, run);
      const completed = await repository.completeReplay({
        expectedLeaseToken: leaseToken,
        id: run.id,
        now: now(),
        state: anyFailed ? "failed" : "passed",
      });
      if (!completed) throw new Error("Quality replay final fence was lost");
    } catch (error) {
      await repository.completeReplay({
        error:
          error instanceof QualityReplayPermissionRevokedError
            ? "PERMISSION_REVOKED"
            : "REPLAY_EXECUTION_FAILED",
        expectedLeaseToken: leaseToken,
        id: run.id,
        now: now(),
        ...(error instanceof QualityReplayPermissionRevokedError
          ? { permissionRevoked: true }
          : {}),
        state: "failed",
      });
    }
    return true;
  };
  return {
    start: () => {
      if (timer) return;
      timer = setInterval(() => void tick().catch(() => undefined), intervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}

export function freezeQualityRuntimeSnapshot(
  snapshot: PublishedKnowledgeSpaceRuntimeSnapshot,
): FrozenQualityRuntimeSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as FrozenQualityRuntimeSnapshot;
}

function replayLeaseToken(run: QualityReplayRun): string {
  const value = (run as QualityReplayRun & { readonly leaseToken?: string }).leaseToken;
  if (!value) throw new Error("Quality replay claim is missing its lease token");
  return value;
}

function replaySubject(run: QualityReplayRun): AuthSubject {
  return {
    scopes: [],
    subjectId: run.permission.requestedBySubjectId,
    tenantId: run.tenantId,
  };
}

async function revalidateReplayPermission(
  access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">,
  run: QualityReplayRun,
): Promise<void> {
  const permission = await access.revalidatePermissionSnapshot({
    expectedAccessChannel: run.permission.accessChannel,
    id: run.permission.permissionSnapshotId,
    knowledgeSpaceId: run.knowledgeSpaceId,
    subjectId: run.permission.requestedBySubjectId,
    tenantId: run.tenantId,
  });
  if (
    permission.revision !== run.permission.permissionSnapshotRevision ||
    permission.role === "viewer"
  ) {
    throw new QualityReplayPermissionRevokedError();
  }
}
