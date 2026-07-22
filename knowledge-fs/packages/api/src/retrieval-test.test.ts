import type {
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceModelSelection,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import type { ModelCapabilitySnapshot } from "./model-capability-preflight";
import { createRetrievalPlanner } from "./retrieval-planner";
import {
  RetrievalTestUnavailableError,
  assertRetrievalTestRuntimeCapabilities,
  createRetrievalTestExecutor,
} from "./retrieval-test";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  RetrieveHybridInput,
} from "./retrieval-types";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const embeddingSelection = {
  model: "embed-3",
  pluginId: "plugin/embed",
  provider: "provider-a",
} as const;
const reasoningSelection = {
  model: "reasoning-1",
  pluginId: "plugin/reasoning",
  provider: "provider-a",
} as const;
const rerankSelection = {
  model: "rerank-1",
  pluginId: "plugin/rerank",
  provider: "provider-a",
} as const;
const embeddingProfile: KnowledgeSpaceEmbeddingProfile = {
  ...embeddingSelection,
  dimension: 3,
  revision: 2,
  vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
};
const retrievalProfile: KnowledgeSpaceRetrievalProfile = {
  defaultMode: "fast",
  reasoningModel: reasoningSelection,
  rerank: { enabled: true, model: rerankSelection },
  revision: 4,
  scoreThreshold: { enabled: true, stage: "mode-final", value: 0.5 },
  topK: 3,
};
const projectionSnapshot = {
  fingerprint: `sha256:${"b".repeat(64)}`,
  headRevision: 7,
  knowledgeSpaceId: SPACE_ID,
  projectionVersion: 5,
  publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
  tenantId: "tenant-1",
};
const subject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "owner-1",
  tenantId: "tenant-1",
};

describe("createRetrievalTestExecutor", () => {
  it("runs Fast with the frozen embedding/profile, server ACL, threshold, and one final rerank", async () => {
    const embeddingCalls: unknown[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async (input) => {
        embeddingCalls.push(input);
        return {
          dense: [[0.1, 0.2, 0.3]],
          metadata: {
            dimension: 3,
            model: embeddingSelection.model,
            provider: "dify-model-runtime",
          },
          model: embeddingSelection.model,
        };
      },
      kind: "dify-model-runtime",
      models: async () => [],
    };
    const calls: RetrieveHybridInput[] = [];
    const retriever = recordingRetriever("fast", calls, ordinaryMetrics({ rerank: true }));
    const executor = createRetrievalTestExecutor({
      embeddingModel: embeddingSelection.model,
      embeddings,
      retriever,
    });

    const result = await executor.execute({
      embeddingProfile,
      knowledgeSpaceId: SPACE_ID,
      mode: "fast",
      permissionScope: ["tenant:tenant-1", "subject:owner-1"],
      projectionSnapshot,
      query: "camera sensor evidence",
      retrievalProfile,
      subject,
      traceId: "trace-fast",
    });

    expect(embeddingCalls).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      denseProjectionModel: embeddingProfile.vectorSpaceId,
      mode: "fast",
      permissionScope: ["tenant:tenant-1", "subject:owner-1"],
      projectionSnapshot,
      retrievalProfile,
      topK: retrievalProfile.topK,
    });
    expect(result.items).toEqual([
      {
        citation: {
          artifactHash: "a".repeat(64),
          documentAssetId: "document-1",
          documentVersion: 1,
          sectionPath: ["Sensor"],
        },
        nodeId: "node-1",
        projectionIds: ["projection-1"],
        score: 0.8,
        sources: ["dense", "fts"],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret candidate text");
    expect(stageStatuses(result)).toMatchObject({
      dense: "executed",
      fts: "executed",
      graph: "skipped",
      pageindex: "skipped",
      rerank: "executed",
      threshold: "executed",
    });
  });

  it("runs Research through Summary/Outline/PageIndex without embedding, ordinary recall, Graph, or rerank", async () => {
    const embed = vi.fn();
    const calls: RetrieveHybridInput[] = [];
    const executor = createRetrievalTestExecutor({
      embeddings: { embed, kind: "static", models: async () => [] },
      retriever: recordingRetriever("research", calls, researchMetrics()),
    });

    const result = await executor.execute({
      knowledgeSpaceId: SPACE_ID,
      mode: "research",
      permissionScope: ["tenant:tenant-1"],
      projectionSnapshot,
      query: "Summarize the camera outline",
      retrievalProfile,
      subject,
      traceId: "trace-research",
    });

    expect(embed).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ mode: "research", queryVector: [0] });
    expect(result.plan).toMatchObject({
      denseTopK: 0,
      ftsTopK: 0,
      fusionLimit: 0,
      rerankCandidateLimit: 0,
      resolvedMode: "research",
    });
    expect(stageStatuses(result)).toMatchObject({
      dense: "skipped",
      fts: "skipped",
      graph: "skipped",
      outline: "executed",
      pageindex: "executed",
      rerank: "skipped",
      summary: "executed",
    });
  });

  it("requires Deep to report ordinary hybrid plus Graph before the shared final rerank", async () => {
    const calls: RetrieveHybridInput[] = [];
    const executor = createRetrievalTestExecutor({
      embeddingModel: embeddingSelection.model,
      embeddings: embeddingProvider(),
      retriever: recordingRetriever("deep", calls, ordinaryMetrics({ graph: true, rerank: true })),
    });

    const result = await executor.execute({
      embeddingProfile,
      knowledgeSpaceId: SPACE_ID,
      mode: "deep",
      permissionScope: ["tenant:tenant-1"],
      projectionSnapshot,
      query: "Compare camera graph evidence",
      retrievalProfile,
      subject,
      traceId: "trace-deep",
    });

    expect(calls).toHaveLength(1);
    expect(stageStatuses(result)).toMatchObject({
      dense: "executed",
      fts: "executed",
      graph: "executed",
      pageindex: "skipped",
      rerank: "executed",
    });
  });

  it("fails closed when production metrics reveal a degraded or wrong mode path", async () => {
    const executor = createRetrievalTestExecutor({
      embeddingModel: embeddingSelection.model,
      embeddings: embeddingProvider(),
      retriever: recordingRetriever("fast", [], {
        ...ordinaryMetrics({ rerank: true }),
        graphExpansionCandidates: 0,
      }),
    });

    await expect(
      executor.execute({
        embeddingProfile,
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionScope: ["tenant:tenant-1"],
        projectionSnapshot,
        query: "camera",
        retrievalProfile,
        subject,
        traceId: "trace-invalid",
      }),
    ).rejects.toThrow("Fast retrieval unexpectedly used Graph expansion");
  });

  it("fails closed when a candidate falls below the active threshold", async () => {
    const executor = createRetrievalTestExecutor({
      embeddingModel: embeddingSelection.model,
      embeddings: embeddingProvider(),
      retriever: recordingRetriever("fast", [], ordinaryMetrics({ rerank: true })),
    });

    await expect(
      executor.execute({
        embeddingProfile,
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionScope: ["tenant:tenant-1"],
        projectionSnapshot,
        query: "camera",
        retrievalProfile: {
          ...retrievalProfile,
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.9 },
        },
        subject,
        traceId: "trace-threshold",
      }),
    ).rejects.toThrow("invalid mode-final candidate score");
  });

  it("fails closed when the retriever returns a candidate outside the server-issued ACL", async () => {
    const base = recordingRetriever("fast", [], ordinaryMetrics({ rerank: true }));
    const executor = createRetrievalTestExecutor({
      embeddingModel: embeddingSelection.model,
      embeddings: embeddingProvider(),
      retriever: {
        retrieve: async (input) => {
          const result = await base.retrieve(input);
          return {
            ...result,
            items: result.items.map((item) => ({
              ...item,
              permissionScope: ["tenant:other-tenant"],
            })),
          };
        },
      },
    });

    await expect(
      executor.execute({
        embeddingProfile,
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permissionScope: ["tenant:tenant-1"],
        projectionSnapshot,
        query: "camera",
        retrievalProfile,
        subject,
        traceId: "trace-acl",
      }),
    ).rejects.toThrow("outside the server-issued permission scope");
  });
});

describe("assertRetrievalTestRuntimeCapabilities", () => {
  it("binds active model selections and embedding dimension to verified snapshots", () => {
    expect(() =>
      assertRetrievalTestRuntimeCapabilities({
        embeddingCapabilitySnapshot: capability("embedding", embeddingSelection, 3),
        embeddingProfile,
        mode: "deep",
        retrievalCapabilitySnapshot: {
          reasoning: capability("reasoning", reasoningSelection),
          rerank: capability("rerank", rerankSelection),
          verification: "verified",
        },
        retrievalProfile,
      }),
    ).not.toThrow();

    expect(() =>
      assertRetrievalTestRuntimeCapabilities({
        embeddingCapabilitySnapshot: capability("embedding", embeddingSelection, 2),
        embeddingProfile,
        mode: "fast",
        retrievalCapabilitySnapshot: {
          reasoning: capability("reasoning", reasoningSelection),
          rerank: capability("rerank", rerankSelection),
          verification: "verified",
        },
        retrievalProfile,
      }),
    ).toThrow(RetrievalTestUnavailableError);
  });

  it("lets Research omit embedding and rerank capabilities but still requires reasoning", () => {
    expect(() =>
      assertRetrievalTestRuntimeCapabilities({
        mode: "research",
        retrievalCapabilitySnapshot: {
          reasoning: capability("reasoning", reasoningSelection),
          rerank: null,
          verification: "verified",
        },
        retrievalProfile,
      }),
    ).not.toThrow();

    expect(() =>
      assertRetrievalTestRuntimeCapabilities({
        mode: "research",
        retrievalCapabilitySnapshot: { verification: "verified" },
        retrievalProfile,
      }),
    ).toThrow("reasoning capability");
  });
});

function recordingRetriever(
  mode: "deep" | "fast" | "research",
  calls: RetrieveHybridInput[],
  metrics: HybridRetrievalMetrics,
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
              sectionPath: ["Sensor"],
            },
            metadata: { text: "secret candidate text" },
            nodeId: "node-1",
            permissionScope: ["tenant:tenant-1"],
            projectionIds: ["projection-1"],
            score: 0.8,
            sources: mode === "research" ? ["pageindex"] : ["dense", "fts"],
          },
        ],
        metrics,
        plan: planner.plan({ mode, query: input.query, topK: input.topK }),
      };
    },
  };
}

function ordinaryMetrics({
  graph = false,
  rerank = false,
}: {
  readonly graph?: boolean;
  readonly rerank?: boolean;
}): HybridRetrievalMetrics {
  return {
    denseCandidates: 3,
    denseMs: 2,
    ftsCandidates: 2,
    ftsMs: 1,
    fusedCandidates: 4,
    fusionMs: 1,
    ...(graph ? { graphExpansionCandidates: 2, graphExpansionMs: 3 } : {}),
    permissionFilteredCandidates: 1,
    projectionFilteredCandidates: 1,
    ...(rerank ? { rerankCandidates: 4, rerankMs: 2 } : {}),
    scoreThresholdFilteredCandidates: 1,
    totalMs: 9,
  };
}

function researchMetrics(): HybridRetrievalMetrics {
  return {
    denseCandidates: 0,
    denseMs: 0,
    documentOutlineMatchedItems: 1,
    ftsCandidates: 0,
    ftsMs: 0,
    fusedCandidates: 1,
    fusionMs: 0,
    pageIndexMatchedNodes: 4,
    pageIndexOpenedRanges: 1,
    pageIndexScoreVersion: "pageindex-score-v1",
    scoreThresholdFilteredCandidates: 2,
    summaryCandidates: 3,
    summarySelectedSections: 1,
    totalMs: 5,
  };
}

function embeddingProvider(): EmbeddingProvider {
  return {
    embed: async () => ({
      dense: [[0.1, 0.2, 0.3]],
      metadata: {
        dimension: 3,
        model: embeddingSelection.model,
        provider: "dify-model-runtime",
      },
      model: embeddingSelection.model,
    }),
    kind: "dify-model-runtime",
    models: async () => [],
  };
}

function capability(
  kind: "embedding" | "reasoning" | "rerank",
  selection: KnowledgeSpaceModelSelection,
  dimension?: number,
): ModelCapabilitySnapshot {
  return {
    capabilityDigest: `sha256:${kind.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}`,
    checkedAt: "2026-07-14T12:00:00.000Z",
    ...(dimension === undefined ? {} : { dimension, distanceMetric: "cosine" as const }),
    kind,
    pluginUniqueIdentifier: `${selection.pluginId}:1@installed`,
    schemaFingerprint: `sha256:${"c".repeat(64)}`,
    selection,
  };
}

function stageStatuses(
  result: Awaited<ReturnType<ReturnType<typeof createRetrievalTestExecutor>["execute"]>>,
) {
  return Object.fromEntries(result.stages.map((stage) => [stage.name, stage.status]));
}
