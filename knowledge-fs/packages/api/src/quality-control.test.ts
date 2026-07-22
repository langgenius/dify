import type { AnswerTrace } from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import type { AnswerTraceRepository } from "./answer-trace-repository";
import type { KnowledgeSpacePermissionSnapshot } from "./knowledge-space-access-control";
import {
  type QualityControlRepository,
  type QualityReplayRun,
  createQualityReplayRuntime,
} from "./quality-control";
import { createRetrievalPlanner } from "./retrieval-planner";
import type { RetrievalTestExecutor, RetrievalTestResult } from "./retrieval-test";
import { createRetrievalTestExecutor } from "./retrieval-test";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  RetrieveHybridInput,
} from "./retrieval-types";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const RUN_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const ITEM_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const PERMISSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const GOLDEN_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const PUBLICATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const CAPABILITY_GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49";
const NOW = "2026-07-14T15:00:00.000Z";

describe("quality replay runtime", () => {
  it.each(["fast", "research", "deep"] as const)(
    "executes %s through the real retrieval-test executor with the frozen snapshot",
    async (mode) => {
      const run = replayRun(mode);
      const retrievalCalls: RetrieveHybridInput[] = [];
      const embed = vi.fn(async () => ({
        dense: [Array.from({ length: 3072 }, () => 0.01)],
        metadata: {
          dimension: 3072,
          model: "user-selected-embedding",
          provider: "dify-model-runtime",
        },
        model: "user-selected-embedding",
      }));
      const executor = createRetrievalTestExecutor({
        embeddingModel: "user-selected-embedding",
        embeddings: {
          embed,
          kind: "dify-model-runtime",
          models: async () => [],
        } as unknown as EmbeddingProvider,
        retriever: runtimeRetriever(mode, retrievalCalls),
      });
      const createdTraces: AnswerTrace[] = [];
      const repository = repositoryStub(run);
      const revalidatePermissionSnapshot = vi.fn(async () => permissionSnapshot("editor"));
      const assertReady = vi.fn(async () => undefined);
      const runtime = createQualityReplayRuntime({
        access: { revalidatePermissionSnapshot },
        answerTraces: {
          create: async (trace) => {
            createdTraces.push(trace);
            return trace;
          },
        } satisfies Pick<AnswerTraceRepository, "create">,
        executor,
        generateTraceId: () => TRACE_ID,
        now: () => NOW,
        repository,
        runtimeSnapshots: {
          assertReady,
          resolve: vi.fn(async () => run.frozenSnapshot),
        },
        workerId: "quality-worker-1",
      });

      await expect(runtime.tick()).resolves.toBe(true);

      expect(retrievalCalls).toHaveLength(1);
      const permission = run.permission;
      if (!permission) throw new Error("Expected a legacy replay permission binding");
      expect(retrievalCalls[0]).toMatchObject({
        mode,
        permissionScope: permission.candidateGrants,
        projectionSnapshot: run.frozenSnapshot.projectionSnapshot,
        retrievalProfile: run.frozenSnapshot.retrievalProfile,
        traceId: TRACE_ID,
      });
      expect(embed).toHaveBeenCalledTimes(mode === "research" ? 0 : 1);
      expect(revalidatePermissionSnapshot).toHaveBeenCalledTimes(2);
      expect(assertReady).toHaveBeenCalledWith({
        knowledgeSpaceId: SPACE_ID,
        resolvedMode: mode,
        tenantId: "tenant-1",
      });
      expect(createdTraces).toHaveLength(1);
      expect(createdTraces[0]).toMatchObject({
        id: TRACE_ID,
        mode,
        permissionSnapshot: { id: PERMISSION_ID, revision: 3 },
        subjectId: "editor-1",
      });
      expect(createdTraces[0]?.steps[0]).toMatchObject({
        metadata: {
          dimension: 3072,
          model: "user-selected-embedding",
          projectionSnapshot: run.frozenSnapshot.projectionSnapshot,
          retrievalProfile: run.frozenSnapshot.retrievalProfile,
          vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
        },
      });
      expect(repository.recordReplayItem).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedLeaseToken: "lease-1",
          itemId: ITEM_ID,
          runId: RUN_ID,
          state: "passed",
          traceId: TRACE_ID,
        }),
      );
      expect(repository.completeReplay).toHaveBeenCalledWith({
        expectedLeaseToken: "lease-1",
        id: RUN_ID,
        now: NOW,
        state: "passed",
      });
    },
  );

  it("fails terminally with a permission-revoked code before executing an item", async () => {
    const run = replayRun();
    const execute = vi.fn();
    const repository = repositoryStub(run);
    const runtime = createQualityReplayRuntime({
      access: {
        revalidatePermissionSnapshot: vi.fn(async () => permissionSnapshot("viewer")),
      },
      answerTraces: { create: vi.fn() },
      executor: { execute } as unknown as RetrievalTestExecutor,
      generateTraceId: () => TRACE_ID,
      now: () => NOW,
      repository,
      runtimeSnapshots: { assertReady: vi.fn(), resolve: vi.fn(async () => run.frozenSnapshot) },
      workerId: "quality-worker-1",
    });

    await expect(runtime.tick()).resolves.toBe(true);

    expect(execute).not.toHaveBeenCalled();
    expect(repository.recordReplayItem).not.toHaveBeenCalled();
    expect(repository.completeReplay).toHaveBeenCalledWith({
      error: "PERMISSION_REVOKED",
      expectedLeaseToken: "lease-1",
      id: RUN_ID,
      now: NOW,
      permissionRevoked: true,
      state: "failed",
    });
  });

  it("resumes a capability replay without reconstructing a legacy permission snapshot", async () => {
    const legacyRun = replayRun();
    const { permission: _permission, ...withoutPermission } = legacyRun;
    const run: QualityReplayRun = {
      ...withoutPermission,
      capabilityGrantId: CAPABILITY_GRANT_ID,
      executionCandidateGrants: ["tenant:tenant-1", "source:camera"],
      executionSubjectId: "editor-1",
    };
    const repository = repositoryStub(run);
    const revalidatePermissionSnapshot = vi.fn();
    const assertPublicationAllowed = vi.fn(async () => undefined);
    const get = vi.fn(async () => ({
      contentScopeIds: ["tenant:tenant-1", "source:camera"],
      state: "active",
      subjectId: "editor-1",
    }));
    const createTrace = vi.fn(async (trace: AnswerTrace) => trace);
    const runtime = createQualityReplayRuntime({
      access: { revalidatePermissionSnapshot },
      answerTraces: { create: createTrace },
      capabilityGrants: { assertPublicationAllowed, get } as never,
      executor: {
        execute: vi.fn(async () => retrievalResult()),
      } as unknown as RetrievalTestExecutor,
      generateTraceId: () => TRACE_ID,
      now: () => NOW,
      repository,
      runtimeSnapshots: {
        assertReady: vi.fn(async () => undefined),
        resolve: vi.fn(async () => run.frozenSnapshot),
      },
      workerId: "quality-worker-1",
    });

    await expect(runtime.tick()).resolves.toBe(true);

    expect(revalidatePermissionSnapshot).not.toHaveBeenCalled();
    expect(assertPublicationAllowed).toHaveBeenCalledWith({
      grantId: CAPABILITY_GRANT_ID,
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
    });
    expect(createTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityGrantId: CAPABILITY_GRANT_ID,
        tenantId: "tenant-1",
      }),
    );
    expect(createTrace.mock.calls[0]?.[0]).not.toHaveProperty("permissionSnapshot");
    expect(createTrace.mock.calls[0]?.[0]).not.toHaveProperty("subjectId");
    expect(repository.completeReplay).toHaveBeenCalledWith({
      expectedLeaseToken: "lease-1",
      id: RUN_ID,
      now: NOW,
      state: "passed",
    });
  });

  it("does not report success after losing the durable item checkpoint lease", async () => {
    const repository = repositoryStub(replayRun());
    vi.mocked(repository.recordReplayItem).mockResolvedValue(false);
    const runtime = createQualityReplayRuntime({
      access: { revalidatePermissionSnapshot: vi.fn(async () => permissionSnapshot("editor")) },
      answerTraces: { create: async (trace) => trace },
      executor: {
        execute: vi.fn(async () => retrievalResult()),
      } as unknown as RetrievalTestExecutor,
      generateTraceId: () => TRACE_ID,
      now: () => NOW,
      repository,
      runtimeSnapshots: {
        assertReady: vi.fn(async () => undefined),
        resolve: vi.fn(async () => replayRun().frozenSnapshot),
      },
      workerId: "quality-worker-1",
    });

    await expect(runtime.tick()).resolves.toBe(true);

    expect(repository.completeReplay).toHaveBeenCalledTimes(1);
    expect(repository.completeReplay).toHaveBeenCalledWith({
      error: "REPLAY_EXECUTION_FAILED",
      expectedLeaseToken: "lease-1",
      id: RUN_ID,
      now: NOW,
      state: "failed",
    });
  });
});

function replayRun(mode: "deep" | "fast" | "research" = "deep"): QualityReplayRun {
  const embeddingSelection = {
    model: "user-selected-embedding",
    pluginId: "plugin-embedding",
    provider: "dify-model-runtime",
  };
  const reasoningSelection = {
    model: "reasoning-model",
    pluginId: "plugin-reasoning",
    provider: "dify-model-runtime",
  };
  const rerankSelection = {
    model: "rerank-model",
    pluginId: "plugin-rerank",
    provider: "dify-model-runtime",
  };
  return {
    attempt: 1,
    createdAt: NOW,
    frozenSnapshot: {
      embeddingCapabilitySnapshot: {
        capabilityDigest: `sha256:${"b".repeat(64)}`,
        checkedAt: NOW,
        dimension: 3072,
        distanceMetric: "cosine",
        kind: "embedding",
        pluginUniqueIdentifier: "plugin-embedding:1@sha256:installed",
        schemaFingerprint: `sha256:${"c".repeat(64)}`,
        selection: embeddingSelection,
      },
      embeddingProfile: {
        ...embeddingSelection,
        dimension: 3072,
        revision: 8,
        vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
      },
      projectionSnapshot: {
        fingerprint: `sha256:${"d".repeat(64)}`,
        headRevision: 9,
        knowledgeSpaceId: SPACE_ID,
        projectionVersion: 6,
        publicationId: PUBLICATION_ID,
        tenantId: "tenant-1",
      },
      retrievalCapabilitySnapshot: {
        reasoning: {
          capabilityDigest: `sha256:${"e".repeat(64)}`,
          checkedAt: NOW,
          kind: "reasoning",
          pluginUniqueIdentifier: "plugin-reasoning:1@sha256:installed",
          schemaFingerprint: `sha256:${"f".repeat(64)}`,
          selection: reasoningSelection,
        },
        rerank: {
          capabilityDigest: `sha256:${"1".repeat(64)}`,
          checkedAt: NOW,
          kind: "rerank",
          pluginUniqueIdentifier: "plugin-rerank:1@sha256:installed",
          schemaFingerprint: `sha256:${"2".repeat(64)}`,
          selection: rerankSelection,
        },
        verification: "verified",
      },
      retrievalProfile: {
        defaultMode: mode,
        reasoningModel: reasoningSelection,
        rerank: { enabled: true, model: rerankSelection },
        revision: 4,
        scoreThreshold: { enabled: true, stage: "mode-final", value: 0.4 },
        topK: 5,
      },
    },
    id: RUN_ID,
    items: [
      {
        expectedEvidenceIds: ["node-1"],
        goldenQuestionId: GOLDEN_ID,
        id: ITEM_ID,
        ordinal: 1,
        question: "Which camera sensor is supported?",
        state: "queued",
      },
    ],
    knowledgeSpaceId: SPACE_ID,
    mode,
    permission: {
      accessChannel: "interactive",
      candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
      permissionSnapshotId: PERMISSION_ID,
      permissionSnapshotRevision: 3,
      requestedBySubjectId: "editor-1",
    },
    revision: 2,
    state: "running",
    tenantId: "tenant-1",
    updatedAt: NOW,
    ...({ leaseToken: "lease-1" } as object),
  };
}

function repositoryStub(run: QualityReplayRun): QualityControlRepository {
  return {
    claimReplay: vi.fn(async () => run),
    completeReplay: vi.fn(async () => run),
    recordReplayItem: vi.fn(async () => true),
  } as unknown as QualityControlRepository;
}

function permissionSnapshot(role: "editor" | "viewer"): KnowledgeSpacePermissionSnapshot {
  return { revision: 3, role } as unknown as KnowledgeSpacePermissionSnapshot;
}

function retrievalResult(): RetrievalTestResult {
  return {
    items: [
      {
        citation: {
          artifactHash: "a".repeat(64),
          documentAssetId: "document-1",
          documentVersion: 1,
          sectionPath: ["Camera"],
        },
        nodeId: "node-1",
        projectionIds: ["projection-1"],
        score: 0.9,
        sources: ["dense", "fts", "graph"],
      },
    ],
    metrics: { totalMs: 12 },
    plan: { requestedMode: "deep", resolvedMode: "deep" },
    stages: [{ candidateCount: 1, durationMs: 5, name: "dense", status: "executed" }],
  } as unknown as RetrievalTestResult;
}

function runtimeRetriever(
  mode: "deep" | "fast" | "research",
  calls: RetrieveHybridInput[],
): BasicHybridRetriever {
  const planner = createRetrievalPlanner({ maxTopK: 100 });
  return {
    retrieve: async (input) => {
      calls.push(input);
      return {
        items: [
          {
            citation: {
              artifactHash: "a".repeat(64),
              documentAssetId: "document-1",
              documentVersion: 1,
              sectionPath: ["Camera"],
            },
            metadata: {},
            nodeId: "node-1",
            permissionScope: ["tenant:tenant-1"],
            projectionIds: ["projection-1"],
            score: 0.9,
            sources:
              mode === "research"
                ? (["pageindex"] as const)
                : mode === "deep"
                  ? (["dense", "fts", "graph"] as const)
                  : (["dense", "fts"] as const),
          },
        ],
        metrics: runtimeMetrics(mode),
        plan: planner.plan({ mode, query: input.query, topK: input.topK }),
      } as Awaited<ReturnType<BasicHybridRetriever["retrieve"]>>;
    },
  };
}

function runtimeMetrics(mode: "deep" | "fast" | "research"): HybridRetrievalMetrics {
  if (mode === "research") {
    return {
      denseCandidates: 0,
      denseMs: 0,
      documentOutlineMatchedItems: 1,
      ftsCandidates: 0,
      ftsMs: 0,
      fusedCandidates: 1,
      fusionMs: 0,
      pageIndexMatchedNodes: 2,
      pageIndexOpenedRanges: 1,
      pageIndexScoreVersion: "pageindex-score-v1",
      scoreThresholdFilteredCandidates: 0,
      summaryCandidates: 1,
      summarySelectedSections: 1,
      totalMs: 5,
    };
  }
  return {
    denseCandidates: 2,
    denseMs: 2,
    ftsCandidates: 2,
    ftsMs: 1,
    fusedCandidates: 2,
    fusionMs: 1,
    ...(mode === "deep" ? { graphExpansionCandidates: 1, graphExpansionMs: 1 } : {}),
    permissionFilteredCandidates: 0,
    projectionFilteredCandidates: 0,
    rerankCandidates: 2,
    rerankMs: 1,
    scoreThresholdFilteredCandidates: 0,
    totalMs: 7,
  };
}
