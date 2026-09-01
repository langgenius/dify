import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";
import type { RerankerProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import { createResearchEvidenceRetrieval } from "./research-evidence-retrieval";
import { ResearchEvidenceRetrievalCheckpointVersion } from "./research-retrieval-checkpoint";
import {
  DurableResearchEvidenceRetrievalPolicy,
  InteractiveResearchEvidenceRetrievalPolicy,
} from "./research-retrieval-policy";
import { createRetrievalPlanner } from "./retrieval-planner";
import type { BasicHybridRetriever, RetrieveHybridInput } from "./retrieval-types";

const embeddingProfile = {
  dimension: 2,
  model: "embedding-model",
  pluginId: "plugin/embedding",
  provider: "embedding",
  revision: 1,
  vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
};

describe("Research evidence retrieval V3", () => {
  it("runs bounded query recall, one set judge, and at most one supplemental round", async () => {
    let recallSequence = 0;
    const retrieve = vi.fn(async (input: RetrieveHybridInput) => {
      recallSequence += 1;
      return {
        items: [item(`node-${slug(input.query)}`, input.query)],
        metrics: {
          denseCandidates: 100,
          denseMs: recallSequence * 10,
          ftsCandidates: 100,
          ftsMs: recallSequence * 5,
          fusedCandidates: 1,
          fusionMs: recallSequence,
          totalMs: recallSequence * 12,
        },
      };
    });
    const vectorize = vi
      .fn()
      .mockResolvedValueOnce([
        [0.2, 0.3],
        [0.4, 0.5],
      ])
      .mockResolvedValueOnce([[0.6, 0.7]]);
    const judge = vi.fn(async (input: { readonly reserveModelCall?: (() => void) | undefined }) => {
      input.reserveModelCall?.();
      return {
        coverage: 0.5,
        coveredDimensions: ["renewal"],
        missingDimensions: ["termination"],
        sufficient: false,
        supplementalQuery: "termination notice",
      };
    });
    const rerank = vi.fn(async (input: Parameters<RerankerProvider["rerank"]>[0]) => ({
      items: input.documents.map((document, index) => ({
        document: { ...document, metadata: { ...(document.metadata ?? {}) } },
        index,
        score: 0.95 - index * 0.05,
      })),
      metadata: { model: input.model, provider: "static" as const },
      model: input.model,
    }));
    const onResearchRound = vi.fn();
    const onResearchSearchCheckpoint = vi.fn();
    const onResearchStageChange = vi.fn();
    const retriever = createResearchEvidenceRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: { vectorize },
      reasoning: {
        judge,
        plan: vi.fn(async (input: { readonly reserveModelCall?: (() => void) | undefined }) => {
          input.reserveModelCall?.();
          return {
            evidenceDimensions: ["renewal", "termination"],
            intent: "comparison" as const,
            modelCalled: true,
            subqueries: ["renewal terms", "termination terms"],
            useGraph: true,
          };
        }),
      },
      rerankerFactory: () => ({ kind: "static", models: async () => [], rerank }),
      retriever: { retrieve },
    });

    const result = await retriever.retrieve({
      ...researchInput(),
      onResearchRound,
      onResearchSearchCheckpoint,
      onResearchStageChange,
      projectionSnapshot: {
        fingerprint: "fingerprint-1",
        headRevision: 1,
        knowledgeSpaceId: "space-1",
        projectionVersion: 1,
        publicationId: "publication-1",
        tenantId: "tenant-1",
      },
      researchExecutionPolicy: DurableResearchEvidenceRetrievalPolicy,
    });

    expect(retrieve.mock.calls.map(([input]) => input.query)).toEqual([
      "compare renewal and termination",
      "renewal terms",
      "termination terms",
      "termination notice",
    ]);
    expect(retrieve.mock.calls.map(([input]) => input.researchGraphEnabled)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(vectorize).toHaveBeenCalledTimes(2);
    expect(rerank.mock.calls.map(([input]) => input.query)).toEqual([
      "compare renewal and termination",
      "renewal terms",
      "termination terms",
      "termination notice",
    ]);
    expect(judge).toHaveBeenCalledOnce();
    expect(result.metrics).toMatchObject({
      denseCandidates: 100,
      denseMs: 40,
      ftsCandidates: 100,
      ftsMs: 20,
      researchCandidateLists: 4,
      researchModelCalls: 2,
      researchRecallDenseCandidates: 400,
      researchRecallFtsCandidates: 400,
      researchRounds: 2,
      researchStrategyVersion: "research-evidence-v3",
      researchSufficiencyReached: false,
      researchSupplementalSearches: 1,
    });
    expect(result.metrics?.graphExpansionCandidates).toBeUndefined();
    expect(result.metrics?.totalMs).toBeGreaterThanOrEqual(result.metrics?.denseMs ?? 0);
    expect(result.metrics?.totalMs).toBeGreaterThanOrEqual(result.metrics?.rerankMs ?? 0);
    expect(result.items.every((evidence) => evidence.metadata.rerankScore !== undefined)).toBe(
      true,
    );
    expect(onResearchRound).toHaveBeenCalledTimes(2);
    expect(onResearchRound.mock.calls[0]?.[0]).toMatchObject({ round: 1, terminal: false });
    expect(onResearchRound.mock.calls[1]?.[0]).toMatchObject({ round: 2, terminal: true });
    expect(
      onResearchSearchCheckpoint.mock.calls.map(([boundary]) => boundary.checkpoint.phase),
    ).toEqual(["planned", "initial", "supplemental", "complete"]);
    const supplementalBoundary = onResearchSearchCheckpoint.mock.calls.find(
      ([boundary]) => boundary.checkpoint.phase === "supplemental",
    )?.[0];
    expect(supplementalBoundary?.result.metrics).toMatchObject({
      researchRecallDenseCandidates: 300,
      researchRecallFtsCandidates: 300,
      researchRerankListCandidates: [1, 1, 1],
    });
    expect(onResearchStageChange.mock.calls.map(([stage]) => stage)).toEqual([
      "retrieving",
      "analyzing",
    ]);
    expect(onResearchStageChange.mock.calls[0]?.[1]).toMatchObject({
      questions: ["compare renewal and termination", "renewal terms", "termination terms"],
    });
    expect(onResearchStageChange.mock.calls[1]?.[1]).toMatchObject({
      results: [{ chunkCount: 3, question: "compare renewal and termination" }],
      retrievalCount: 3,
    });
  });

  it("reports the score-threshold stage when the frozen profile enables it", async () => {
    const retrieve = vi.fn(async (input: RetrieveHybridInput) => ({
      items: [
        item(`keep-${slug(input.query)}`, input.query),
        item(`drop-${slug(input.query)}`, input.query),
      ],
      metrics: {
        denseCandidates: 2,
        denseMs: 1,
        ftsCandidates: 2,
        ftsMs: 1,
        fusedCandidates: 2,
        fusionMs: 1,
        totalMs: 3,
      },
    }));
    const rerank = vi.fn(async (input: Parameters<RerankerProvider["rerank"]>[0]) => ({
      items: input.documents.map((document, index) => ({
        document: { ...document, metadata: { ...(document.metadata ?? {}) } },
        index,
        score: index === 0 ? 0.91 : 0.11,
      })),
      metadata: { model: input.model, provider: "static" as const },
      model: input.model,
    }));
    const retriever = createResearchEvidenceRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: { vectorize: async () => [] },
      reasoning: {
        judge: async () => ({
          coverage: 1,
          coveredDimensions: ["renewal"],
          missingDimensions: [],
          sufficient: true,
        }),
        plan: async () => ({
          evidenceDimensions: ["renewal"],
          intent: "direct" as const,
          modelCalled: true,
          subqueries: [],
          useGraph: false,
        }),
      },
      rerankerFactory: () => ({ kind: "static", models: async () => [], rerank }),
      retriever: { retrieve },
    });

    const result = await retriever.retrieve({
      ...researchInput(),
      retrievalProfile: {
        ...retrievalProfile(),
        scoreThreshold: { enabled: true, stage: "rerank", value: 0.8 },
      },
    });

    expect(result.metrics).toMatchObject({
      researchStrategyVersion: "research-evidence-v3",
      scoreThresholdFilteredCandidates: 1,
    });
    expect(result.items).toHaveLength(1);
  });

  it("keeps the strongest query-specific rerank score for evidence shared across intents", async () => {
    const shared = item(
      "shared-node",
      "Dify supports self-hosted deployment and model credentials",
    );
    const rerank = vi.fn(async (input: Parameters<RerankerProvider["rerank"]>[0]) => ({
      items: input.documents.map((document, index) => ({
        document: { ...document, metadata: { ...(document.metadata ?? {}) } },
        index,
        score: input.query === "Dify deployment management" ? 0.93 : 0.0005295,
      })),
      metadata: { model: input.model, provider: "static" as const },
      model: input.model,
    }));
    const retriever = createResearchEvidenceRetrieval({
      queryVectorizer: { vectorize: async () => [[0.2, 0.3]] },
      reasoning: {
        judge: async () => ({
          coverage: 1,
          coveredDimensions: ["deployment"],
          missingDimensions: [],
          sufficient: true,
        }),
        plan: async () => ({
          evidenceDimensions: ["models", "deployment"],
          intent: "multi-hop" as const,
          modelCalled: true,
          subqueries: ["Dify deployment management"],
          useGraph: false,
        }),
      },
      rerankerFactory: () => ({ kind: "static", models: async () => [], rerank }),
      retriever: { retrieve: async () => ({ items: [shared] }) },
    });

    const result = await retriever.retrieve({
      ...researchInput(),
      query: "How does Dify manage models and deployment?",
    });

    expect(rerank.mock.calls.map(([input]) => input.query)).toEqual([
      "How does Dify manage models and deployment?",
      "Dify deployment management",
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      metadata: {
        rerankScore: 0.93,
        researchRerank: {
          query: "Dify deployment management",
          score: 0.93,
          version: "query-aware-max-v1",
        },
      },
      nodeId: "shared-node",
      score: 0.93,
    });
  });

  it("uses RRF only as a tie-break so supplemental high rerank scores survive the fusion window", async () => {
    const rerank = vi.fn(async (input: Parameters<RerankerProvider["rerank"]>[0]) => ({
      items: input.documents.map((document, index) => ({
        document: { ...document, metadata: { ...(document.metadata ?? {}) } },
        index,
        score:
          input.query === "missing termination evidence"
            ? index === 1
              ? 0.99
              : 0.3
            : index === 0
              ? 0.2
              : 0.1,
      })),
      metadata: { model: input.model, provider: "static" as const },
      model: input.model,
    }));
    const retriever = createResearchEvidenceRetrieval({
      maxRerankCandidates: 2,
      queryVectorizer: { vectorize: async () => [[0.2, 0.3]] },
      reasoning: {
        judge: async () => ({
          coverage: 0.5,
          coveredDimensions: ["renewal"],
          missingDimensions: ["termination"],
          modelCalled: true,
          sufficient: false,
          supplementalQuery: "missing termination evidence",
        }),
        plan: async () => ({
          evidenceDimensions: ["renewal", "termination"],
          intent: "comparison" as const,
          modelCalled: false,
          subqueries: [],
          useGraph: false,
        }),
      },
      rerankerFactory: () => ({ kind: "static", models: async () => [], rerank }),
      retriever: {
        retrieve: async (input) => ({
          items:
            input.query === "missing termination evidence"
              ? [item("supplemental-first", "weak"), item("supplemental-best", "strong")]
              : [item("initial-first", "initial one"), item("initial-second", "initial two")],
        }),
      },
    });

    const result = await retriever.retrieve({
      ...researchInput(),
      limit: 1,
      researchExecutionPolicy: DurableResearchEvidenceRetrievalPolicy,
      topK: 1,
    });

    expect(result.items[0]).toMatchObject({ nodeId: "supplemental-best", score: 0.99 });
    expect(result.metrics).toMatchObject({
      researchSupplementalSearches: 1,
    });
    expect(result.metrics?.researchRrfCandidates).toBeGreaterThan(2);
  });

  it("uses the configured total rerank pool across intents instead of silently dividing Top K depth", async () => {
    const rerank = vi.fn(async (input: Parameters<RerankerProvider["rerank"]>[0]) => ({
      items: input.documents.map((document, index) => ({
        document: { ...document, metadata: { ...(document.metadata ?? {}) } },
        index,
        score: 0.9 - index * 0.01,
      })),
      metadata: { model: input.model, provider: "static" as const },
      model: input.model,
    }));
    const retriever = createResearchEvidenceRetrieval({
      maxRerankCandidates: 12,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: {
        vectorize: async () => [
          [0.2, 0.3],
          [0.4, 0.5],
        ],
      },
      reasoning: {
        judge: async () => ({
          coverage: 1,
          coveredDimensions: ["models", "deployment"],
          missingDimensions: [],
          sufficient: true,
        }),
        plan: async () => ({
          evidenceDimensions: ["models", "deployment"],
          intent: "comparison" as const,
          modelCalled: true,
          subqueries: ["model management", "deployment management"],
          useGraph: false,
        }),
      },
      rerankerFactory: () => ({ kind: "static", models: async () => [], rerank }),
      retriever: {
        retrieve: async (input) => ({
          items: Array.from({ length: input.limit }, (_, index) =>
            item(`${slug(input.query)}-${index}`, `${input.query} evidence ${index}`),
          ),
        }),
      },
    });

    const result = await retriever.retrieve({ ...researchInput(), limit: 1, topK: 1 });

    expect(rerank.mock.calls.map(([input]) => input.documents.length)).toEqual([4, 4, 4]);
    expect(rerank.mock.calls.reduce((total, [input]) => total + input.documents.length, 0)).toBe(
      12,
    );
    expect(result.metrics).toMatchObject({
      rerankCandidates: 12,
      researchRerankCandidateBudget: 12,
      researchRerankListCandidates: [4, 4, 4],
    });
  });

  it("routes a retained V2 tree checkpoint only to the compatibility retriever", async () => {
    const legacy = vi.fn(async () => ({ items: [] }));
    const online = vi.fn(async () => ({ items: [] }));
    const retriever = createResearchEvidenceRetrieval({
      legacyResearchRetriever: { retrieve: legacy },
      queryVectorizer: { vectorize: vi.fn() },
      reasoning: { judge: vi.fn(), plan: vi.fn() },
      rerankerFactory: vi.fn(),
      retriever: { retrieve: online },
    });
    const checkpoint = {
      budget: {
        elapsedMs: 0,
        exhaustedReasons: [],
        modelCalls: 0,
        openedResources: 0,
        retrievalSteps: 0,
        rounds: 0,
        supplementalSearches: 0,
      },
      fingerprint: "a".repeat(64),
      knowledgeSpaceId: "space-1",
      metrics: {
        candidateTruncated: false,
        degradationFlags: [],
        denseCandidates: 0,
        fallbackDocuments: 0,
        flattenedLevels: 0,
        layeredDocuments: 0,
        layeredSteps: 0,
        metadataFilteredCandidates: 0,
        openedRanges: 0,
        permissionFilteredCandidates: 0,
        scannedNodes: 0,
        selectedDocuments: 0,
        serializedTreeTokens: 0,
        valueMs: 0,
        wholeTreeDocuments: 0,
      },
      missingAspects: [],
      navigation: [],
      openedRangeCount: 0,
      openedTruncated: false,
      phase: "navigation" as const,
      publicationId: "publication-1",
      query: "compare renewal and termination",
      queue: [],
      queueOffset: 0,
      researchSufficiencyReached: false,
      sequence: 0,
      tenantId: "tenant-1",
      traceId: "trace-1",
      version: "research-retrieval-checkpoint-v2" as const,
    };

    await retriever.retrieve({ ...researchInput(), researchSearchCheckpoint: checkpoint });

    expect(legacy).toHaveBeenCalledOnce();
    expect(online).not.toHaveBeenCalled();
  });

  it("resumes a V3 supplemental boundary without repeating planning or initial recall", async () => {
    const retrieve = vi.fn(async (input: RetrieveHybridInput) => ({
      items: [item("node-supplemental", input.query)],
      metrics: {
        denseCandidates: 100,
        denseMs: 10,
        ftsCandidates: 100,
        ftsMs: 5,
        fusedCandidates: 1,
        fusionMs: 1,
        totalMs: 12,
      },
    }));
    const vectorize = vi.fn(async () => [[0.8, 0.9]]);
    const plan = vi.fn();
    const judge = vi.fn(async () => ({
      coverage: 1,
      coveredDimensions: ["renewal", "termination"],
      missingDimensions: [],
      sufficient: true,
    }));
    const onResearchSearchCheckpoint = vi.fn();
    const retriever = createResearchEvidenceRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: { vectorize },
      reasoning: { judge, plan },
      rerankerFactory: () => passThroughReranker(),
      retriever: { retrieve },
    });
    const input = {
      ...researchInput(),
      onResearchSearchCheckpoint,
      projectionSnapshot: {
        fingerprint: "fingerprint-1",
        headRevision: 1,
        knowledgeSpaceId: "space-1",
        projectionVersion: 1,
        publicationId: "publication-1",
        tenantId: "tenant-1",
      },
      researchSearchCheckpoint: {
        budget: {
          elapsedMs: 5,
          exhaustedReasons: [],
          modelCalls: 2,
          openedResources: 0,
          retrievalSteps: 1,
          rounds: 0,
          supplementalSearches: 0,
        },
        fingerprint: "fingerprint-1",
        judgement: {
          coverage: 0.5,
          coveredDimensions: ["renewal"],
          missingDimensions: ["termination"],
          sufficient: false,
          supplementalQuery: "termination notice",
        },
        knowledgeSpaceId: "space-1",
        phase: "supplemental" as const,
        publicationId: "publication-1",
        query: "compare renewal and termination",
        queryPlan: {
          evidenceDimensions: ["renewal", "termination"],
          intent: "comparison" as const,
          subqueries: ["renewal terms", "termination terms"],
          useGraph: true,
        },
        sequence: 1,
        tenantId: "tenant-1",
        traceId: "trace-1",
        version: ResearchEvidenceRetrievalCheckpointVersion,
      },
      researchSearchCheckpointResult: {
        items: [item("node-initial", "renewal terms")],
        metrics: {
          denseCandidates: 100,
          denseMs: 30,
          ftsCandidates: 100,
          ftsMs: 15,
          fusedCandidates: 3,
          fusionMs: 3,
          rerankCandidates: 3,
          rerankMs: 10,
          researchQueryEmbeddingMs: 4,
          researchRecallDenseCandidates: 300,
          researchRecallFtsCandidates: 300,
          researchRerankCandidateBudget: 200,
          researchRerankListCandidates: [1, 1, 1],
          totalMs: 40,
        },
      },
      researchExecutionPolicy: DurableResearchEvidenceRetrievalPolicy,
    };

    const result = await retriever.retrieve(input);

    expect(plan).not.toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledOnce();
    expect(retrieve.mock.calls[0]?.[0].query).toBe("termination notice");
    expect(vectorize).toHaveBeenCalledOnce();
    expect(judge).not.toHaveBeenCalled();
    expect(result.items.map((evidence) => evidence.nodeId)).toEqual([
      "node-supplemental",
      "node-initial",
    ]);
    expect(result.items[0]?.metadata.researchRerank).toMatchObject({
      query: "termination notice",
      score: 0.95,
    });
    expect(result.metrics).toMatchObject({
      denseCandidates: 100,
      denseMs: 30,
      researchRecallDenseCandidates: 400,
      researchRecallFtsCandidates: 400,
      researchRerankListCandidates: [1, 1, 1, 1],
    });
    expect(onResearchSearchCheckpoint.mock.calls[0]?.[0].checkpoint).toMatchObject({
      phase: "complete",
      version: ResearchEvidenceRetrievalCheckpointVersion,
    });
  });

  it("checkpoints the bounded rerank tail instead of only the public Top K", async () => {
    const boundaries = vi.fn();
    const retriever = createResearchEvidenceRetrieval({
      maxRerankCandidates: 50,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: { vectorize: async () => [] },
      reasoning: {
        judge: async () => ({
          coverage: 1,
          coveredDimensions: [],
          missingDimensions: [],
          sufficient: true,
        }),
        plan: async () => ({
          evidenceDimensions: [],
          intent: "direct" as const,
          modelCalled: false,
          subqueries: [],
          useGraph: false,
        }),
      },
      rerankerFactory: () => ({
        kind: "static",
        models: async () => [],
        rerank: async (input) => ({
          items: input.documents.map((document, index) => ({
            document: { ...document, metadata: { ...(document.metadata ?? {}) } },
            index,
            score: 1 - index / 100,
          })),
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        }),
      }),
      retriever: {
        retrieve: async () => ({
          items: Array.from({ length: 50 }, (_, index) =>
            item(`initial-${index}`, `initial evidence ${index}`),
          ),
          metrics: {
            denseCandidates: 50,
            denseMs: 1,
            ftsCandidates: 50,
            ftsMs: 1,
            fusedCandidates: 50,
            fusionMs: 1,
            totalMs: 3,
          },
        }),
      },
    });

    await retriever.retrieve({
      ...researchInput(),
      limit: 2,
      onResearchSearchCheckpoint: boundaries,
      projectionSnapshot: {
        fingerprint: "fingerprint-1",
        headRevision: 1,
        knowledgeSpaceId: "space-1",
        projectionVersion: 1,
        publicationId: "publication-1",
        tenantId: "tenant-1",
      },
      researchExecutionPolicy: DurableResearchEvidenceRetrievalPolicy,
      topK: 10,
    });

    const initial = boundaries.mock.calls.find(
      ([boundary]) => boundary.checkpoint.phase === "initial",
    )?.[0];
    expect(initial?.result.items).toHaveLength(50);
    expect(initial?.result.metrics).toMatchObject({
      researchRerankCandidateBudget: 50,
      researchRerankListCandidates: [50],
    });
  });

  it("rejects rerank pools larger than the durable checkpoint envelope", () => {
    expect(() =>
      createResearchEvidenceRetrieval({
        maxRerankCandidates: 201,
        queryVectorizer: { vectorize: async () => [] },
        reasoning: { judge: vi.fn(), plan: vi.fn() },
        rerankerFactory: () => passThroughReranker(),
        retriever: { retrieve: vi.fn() },
      }),
    ).toThrow("maxRerankCandidates must not exceed 200");
  });

  it("resumes an initial rerank boundary by running only the evidence judge", async () => {
    const retrieve = vi.fn();
    const vectorize = vi.fn();
    const plan = vi.fn();
    const judge = vi.fn(async (input: { readonly reserveModelCall?: (() => void) | undefined }) => {
      input.reserveModelCall?.();
      return {
        coverage: 1,
        coveredDimensions: ["renewal"],
        missingDimensions: [],
        modelCalled: true,
        sufficient: true,
      };
    });
    const reranker = passThroughReranker();
    const rerank = vi.spyOn(reranker, "rerank");
    const checkpoints = vi.fn();
    const retriever = createResearchEvidenceRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: { vectorize },
      reasoning: { judge, plan },
      rerankerFactory: () => reranker,
      retriever: { retrieve },
    });

    const result = await retriever.retrieve({
      ...researchInput(),
      onResearchSearchCheckpoint: checkpoints,
      projectionSnapshot: {
        fingerprint: "fingerprint-1",
        headRevision: 1,
        knowledgeSpaceId: "space-1",
        projectionVersion: 1,
        publicationId: "publication-1",
        tenantId: "tenant-1",
      },
      researchExecutionPolicy: DurableResearchEvidenceRetrievalPolicy,
      researchSearchCheckpoint: {
        budget: {
          elapsedMs: 5,
          exhaustedReasons: [],
          modelCalls: 1,
          openedResources: 0,
          retrievalSteps: 3,
          rounds: 1,
          supplementalSearches: 0,
        },
        fingerprint: "fingerprint-1",
        knowledgeSpaceId: "space-1",
        phase: "initial",
        publicationId: "publication-1",
        query: "compare renewal and termination",
        queryPlan: {
          evidenceDimensions: ["renewal"],
          intent: "comparison",
          subqueries: ["renewal terms"],
          useGraph: false,
        },
        sequence: 1,
        tenantId: "tenant-1",
        traceId: "trace-1",
        version: ResearchEvidenceRetrievalCheckpointVersion,
      },
      researchSearchCheckpointResult: {
        items: [item("node-initial", "renewal terms")],
      },
    });

    expect(plan).not.toHaveBeenCalled();
    expect(vectorize).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
    expect(judge).toHaveBeenCalledOnce();
    expect(result.items.map((evidence) => evidence.nodeId)).toEqual(["node-initial"]);
    expect(result.metrics).toMatchObject({ researchModelCalls: 2, researchRounds: 1 });
    expect(checkpoints.mock.calls[0]?.[0].checkpoint.phase).toBe("complete");
  });

  it("delegates non-Research requests and validates V3 assembly bounds", async () => {
    const delegated = { items: [item("fast-node", "fast evidence")] };
    const retrieve = vi.fn(async () => delegated);
    const options = {
      queryVectorizer: { vectorize: vi.fn() },
      reasoning: { judge: vi.fn(), plan: vi.fn() },
      rerankerFactory: vi.fn(),
      retriever: { retrieve },
    };
    const retriever = createResearchEvidenceRetrieval(options);

    await expect(retriever.retrieve({ ...researchInput(), mode: "fast" })).resolves.toBe(delegated);
    expect(retrieve).toHaveBeenCalledOnce();
    expect(() => createResearchEvidenceRetrieval({ ...options, maxCandidateLists: 0 })).toThrow(
      "maxCandidateLists must be at least 1",
    );
  });

  it("fails closed when frozen Research model and embedding identities are unavailable", async () => {
    const retriever = createResearchEvidenceRetrieval({
      queryVectorizer: { vectorize: vi.fn() },
      reasoning: { judge: vi.fn(), plan: vi.fn() },
      rerankerFactory: vi.fn(),
      retriever: { retrieve: vi.fn() },
    });
    const input = researchInput();

    await expect(retriever.retrieve({ ...input, retrievalProfile: undefined })).rejects.toThrow(
      "frozen retrieval profile",
    );
    await expect(retriever.retrieve({ ...input, embeddingProfile: undefined })).rejects.toThrow(
      "frozen embedding profile",
    );
    await expect(
      retriever.retrieve({ ...input, denseProjectionModel: "another-vector-space" }),
    ).rejects.toThrow("does not match the query vector space");
  });

  it("returns a completed V3 checkpoint without repeating retrieval or model work", async () => {
    const retrieve = vi.fn();
    const plan = vi.fn();
    const judge = vi.fn();
    const vectorize = vi.fn();
    const rerankerFactory = vi.fn();
    const retriever = createResearchEvidenceRetrieval({
      queryVectorizer: { vectorize },
      reasoning: { judge, plan },
      rerankerFactory,
      retriever: { retrieve },
    });
    const completedResult = {
      items: [item("completed-node", "completed evidence")],
      metrics: {
        denseCandidates: 0,
        denseMs: 0,
        ftsCandidates: 0,
        ftsMs: 0,
        fusedCandidates: 1,
        fusionMs: 0,
        researchStrategyVersion: "research-evidence-v3" as const,
        totalMs: 10,
      },
    };

    await expect(
      retriever.retrieve({
        ...researchInput(),
        projectionSnapshot: {
          fingerprint: "fingerprint-1",
          headRevision: 1,
          knowledgeSpaceId: "space-1",
          projectionVersion: 1,
          publicationId: "publication-1",
          tenantId: "tenant-1",
        },
        researchSearchCheckpoint: {
          budget: {
            elapsedMs: 10,
            exhaustedReasons: [],
            modelCalls: 1,
            openedResources: 1,
            retrievalSteps: 1,
            rounds: 1,
            supplementalSearches: 0,
          },
          fingerprint: "fingerprint-1",
          judgement: {
            coverage: 1,
            coveredDimensions: ["renewal"],
            missingDimensions: [],
            sufficient: true,
          },
          knowledgeSpaceId: "space-1",
          phase: "complete",
          publicationId: "publication-1",
          query: "compare renewal and termination",
          queryPlan: {
            evidenceDimensions: ["renewal"],
            intent: "comparison",
            subqueries: [],
            useGraph: false,
          },
          sequence: 2,
          tenantId: "tenant-1",
          traceId: "trace-1",
          version: ResearchEvidenceRetrievalCheckpointVersion,
        },
        researchSearchCheckpointResult: completedResult,
      }),
    ).resolves.toBe(completedResult);

    expect(retrieve).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
    expect(vectorize).not.toHaveBeenCalled();
    expect(rerankerFactory).not.toHaveBeenCalled();
  });

  it("keeps an empty direct lookup bounded without planner, judge, or rewrite model cost", async () => {
    const retrieve = vi.fn(async () => ({ items: [] }));
    const vectorize = vi.fn();
    const plan = vi.fn(async () => ({
      evidenceDimensions: [],
      intent: "direct" as const,
      modelCalled: false,
      subqueries: [],
      useGraph: false,
    }));
    const judge = vi.fn(async () => ({
      coverage: 0,
      coveredDimensions: [],
      missingDimensions: [],
      modelCalled: false,
      sufficient: false,
      supplementalQuery: "invoice number",
    }));
    const retriever = createResearchEvidenceRetrieval({
      queryVectorizer: { vectorize },
      reasoning: { judge, plan },
      rerankerFactory: () => passThroughReranker(),
      retriever: { retrieve },
    });

    const result = await retriever.retrieve({
      ...researchInput(),
      query: "invoice number",
    });

    expect(plan).toHaveBeenCalledOnce();
    expect(judge).not.toHaveBeenCalled();
    expect(vectorize).not.toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledOnce();
    expect(result.items).toEqual([]);
    expect(result.metrics).toMatchObject({
      researchModelCalls: 0,
      researchRounds: 1,
      researchSupplementalSearches: 0,
    });
    expect(result.metrics?.researchSufficiencyReached).toBeUndefined();
    expect(Object.hasOwn(result.metrics ?? {}, "researchSufficiencyReached")).toBe(false);
    expect(Object.hasOwn(result.metrics ?? {}, "researchExecutionKind")).toBe(false);
  });

  it("counts a physical judgement recovery instead of hiding it behind one semantic step", async () => {
    const retriever = createResearchEvidenceRetrieval({
      queryVectorizer: { vectorize: vi.fn() },
      reasoning: {
        judge: vi.fn(async (input: { readonly reserveModelCall?: (() => void) | undefined }) => {
          input.reserveModelCall?.();
          input.reserveModelCall?.();
          return {
            coverage: 1,
            coveredDimensions: [],
            missingDimensions: [],
            modelCalled: true,
            sufficient: true,
          };
        }),
        plan: vi.fn(async () => ({
          evidenceDimensions: [],
          intent: "direct" as const,
          modelCalled: false,
          subqueries: [],
          useGraph: false,
        })),
      },
      rerankerFactory: () => passThroughReranker(),
      retriever: { retrieve: async () => ({ items: [item("node-1", "direct evidence")] }) },
    });

    const result = await retriever.retrieve({
      ...researchInput(),
      query: "direct fact",
      researchExecutionPolicy: DurableResearchEvidenceRetrievalPolicy,
    });

    expect(result.metrics).toMatchObject({ researchModelCalls: 2 });
  });

  it("cancels every parallel recall leg when the retrieval owner is lost", async () => {
    const controller = new AbortController();
    const cancellation = new Error("retrieval lease lost");
    const retrieve = vi.fn(
      async (_input: RetrieveHybridInput) => new Promise<never>(() => undefined),
    );
    const retriever = createResearchEvidenceRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: {
        vectorize: async () => [
          [0.2, 0.3],
          [0.4, 0.5],
        ],
      },
      reasoning: {
        judge: vi.fn(),
        plan: async () => ({
          evidenceDimensions: ["renewal", "termination"],
          intent: "comparison",
          modelCalled: false,
          subqueries: ["renewal terms", "termination terms"],
          useGraph: false,
        }),
      },
      rerankerFactory: () => passThroughReranker(),
      retriever: { retrieve },
    });
    const pending = retriever.retrieve({ ...researchInput(), signal: controller.signal });
    await vi.waitFor(() => expect(retrieve).toHaveBeenCalledTimes(3));
    const forwardedSignals = retrieve.mock.calls.map(([input]) => input.signal);
    expect(forwardedSignals.every(Boolean)).toBe(true);

    controller.abort(cancellation);

    await expect(pending).rejects.toBe(cancellation);
    expect(forwardedSignals.every((signal) => signal?.aborted)).toBe(true);
  });

  it("enforces the request-wide wall-clock deadline against an ignoring retriever", async () => {
    const retrieve = vi.fn(
      async (_input: RetrieveHybridInput) => new Promise<never>(() => undefined),
    );
    const retriever = createResearchEvidenceRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: { vectorize: async () => [] },
      reasoning: {
        judge: vi.fn(),
        plan: async () => ({
          evidenceDimensions: [],
          intent: "direct",
          modelCalled: false,
          subqueries: [],
          useGraph: false,
        }),
      },
      rerankerFactory: () => passThroughReranker(),
      retriever: { retrieve },
    });
    const pending = retriever.retrieve({
      ...researchInput(),
      researchExecutionPolicy: {
        ...InteractiveResearchEvidenceRetrievalPolicy,
        wallClockMs: 25,
      },
    });

    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(retrieve).toHaveBeenCalledOnce();
    expect(retrieve.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });

  it("rejects incompatible checkpoints and invalid rewrite embeddings before recall", async () => {
    const retrieve = vi.fn();
    const plan = vi.fn(async () => ({
      evidenceDimensions: ["renewal"],
      intent: "comparison" as const,
      modelCalled: true,
      subqueries: ["renewal terms"],
      useGraph: false,
    }));
    const retriever = createResearchEvidenceRetrieval({
      queryVectorizer: { vectorize: async () => [] },
      reasoning: { judge: vi.fn(), plan },
      rerankerFactory: () => passThroughReranker(),
      retriever: { retrieve },
    });

    await expect(
      retriever.retrieve({
        ...researchInput(),
        researchSearchCheckpoint: {
          budget: {
            elapsedMs: 0,
            exhaustedReasons: [],
            modelCalls: 0,
            openedResources: 0,
            retrievalSteps: 0,
            rounds: 0,
            supplementalSearches: 0,
          },
          fingerprint: "a".repeat(64),
          knowledgeSpaceId: "space-1",
          metrics: {
            candidateTruncated: false,
            degradationFlags: [],
            denseCandidates: 0,
            fallbackDocuments: 0,
            flattenedLevels: 0,
            layeredDocuments: 0,
            layeredSteps: 0,
            metadataFilteredCandidates: 0,
            openedRanges: 0,
            permissionFilteredCandidates: 0,
            scannedNodes: 0,
            selectedDocuments: 0,
            serializedTreeTokens: 0,
            valueMs: 0,
            wholeTreeDocuments: 0,
          },
          missingAspects: [],
          navigation: [],
          openedRangeCount: 0,
          openedTruncated: false,
          phase: "navigation",
          publicationId: "publication-1",
          query: "compare renewal and termination",
          queue: [],
          queueOffset: 0,
          researchSufficiencyReached: false,
          sequence: 0,
          tenantId: "tenant-1",
          traceId: "trace-1",
          version: "research-retrieval-checkpoint-v2",
        },
      }),
    ).rejects.toThrow("without the V2 retriever");

    await expect(retriever.retrieve(researchInput())).rejects.toThrow(
      "returned 0 vectors for 1 queries",
    );
    expect(retrieve).not.toHaveBeenCalled();
  });
});

function researchInput(): RetrieveHybridInput {
  return {
    denseProjectionModel: embeddingProfile.vectorSpaceId,
    embeddingProfile,
    knowledgeSpaceId: "space-1",
    limit: 5,
    mode: "research",
    permissionScope: [],
    query: "compare renewal and termination",
    queryVector: [0.1, 0.2],
    retrievalProfile: retrievalProfile(),
    tenantId: "tenant-1",
    topK: 5,
    traceId: "trace-1",
  };
}

function retrievalProfile(): KnowledgeSpaceRetrievalProfile {
  return {
    defaultMode: "fast",
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "plugin/reasoning",
      provider: "reasoning",
    },
    rerank: {
      enabled: true,
      model: { model: "reranker", pluginId: "plugin/rerank", provider: "rerank" },
    },
    revision: 1,
    scoreThreshold: { enabled: false, stage: "rerank" },
    topK: 5,
  };
}

function item(nodeId: string, text: string) {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: `document-${nodeId}`,
      documentVersion: 1,
      sectionPath: [text],
    },
    metadata: { text },
    nodeId,
    permissionScope: [] as string[],
    projectionIds: [`projection-${nodeId}`],
    score: 0.8,
    sources: ["dense" as const],
  };
}

function passThroughReranker(): RerankerProvider {
  return {
    kind: "static",
    models: async () => [],
    rerank: async (input) => ({
      items: input.documents.map((document, index) => ({
        document: { ...document, metadata: { ...(document.metadata ?? {}) } },
        index,
        score: 0.95 - index * 0.05,
      })),
      metadata: { model: input.model, provider: "static" },
      model: input.model,
    }),
  };
}

function slug(value: string): string {
  return value.replace(/\s+/gu, "-").toLowerCase();
}
