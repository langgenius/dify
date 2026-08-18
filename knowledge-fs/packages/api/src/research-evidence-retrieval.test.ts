import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";
import type { RerankerProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import { createResearchEvidenceRetrieval } from "./research-evidence-retrieval";
import { ResearchEvidenceRetrievalCheckpointVersion } from "./research-retrieval-checkpoint";
import { DurableResearchEvidenceRetrievalPolicy } from "./research-retrieval-policy";
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
    const retrieve = vi.fn(async (input: RetrieveHybridInput) => ({
      items: [item(`node-${slug(input.query)}`, input.query)],
      metrics: {
        denseCandidates: 1,
        denseMs: 1,
        ftsCandidates: 1,
        ftsMs: 1,
        fusedCandidates: 1,
        fusionMs: 1,
        totalMs: 3,
      },
    }));
    const vectorize = vi
      .fn()
      .mockResolvedValueOnce([
        [0.2, 0.3],
        [0.4, 0.5],
      ])
      .mockResolvedValueOnce([[0.6, 0.7]]);
    const judge = vi
      .fn()
      .mockResolvedValueOnce({
        coverage: 0.5,
        coveredDimensions: ["renewal"],
        missingDimensions: ["termination"],
        sufficient: false,
        supplementalQuery: "termination notice",
      })
      .mockResolvedValueOnce({
        coverage: 1,
        coveredDimensions: ["renewal", "termination"],
        missingDimensions: [],
        sufficient: true,
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
    const retriever = createResearchEvidenceRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      queryVectorizer: { vectorize },
      reasoning: {
        judge,
        plan: vi.fn(async () => ({
          evidenceDimensions: ["renewal", "termination"],
          intent: "comparison" as const,
          modelCalled: true,
          subqueries: ["renewal terms", "termination terms"],
          useGraph: true,
        })),
      },
      rerankerFactory: () => ({ kind: "static", models: async () => [], rerank }),
      retriever: { retrieve },
    });

    const result = await retriever.retrieve({
      ...researchInput(),
      onResearchRound,
      onResearchSearchCheckpoint,
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
    expect(rerank).toHaveBeenCalledTimes(2);
    expect(judge).toHaveBeenCalledOnce();
    expect(result.metrics).toMatchObject({
      researchCandidateLists: 4,
      researchModelCalls: 2,
      researchRounds: 2,
      researchStrategyVersion: "research-evidence-v3",
      researchSufficiencyReached: false,
      researchSupplementalSearches: 1,
    });
    expect(result.items.every((evidence) => evidence.metadata.rerankScore !== undefined)).toBe(
      true,
    );
    expect(onResearchRound).toHaveBeenCalledTimes(2);
    expect(onResearchRound.mock.calls[0]?.[0]).toMatchObject({ round: 1, terminal: false });
    expect(onResearchRound.mock.calls[1]?.[0]).toMatchObject({ round: 2, terminal: true });
    expect(
      onResearchSearchCheckpoint.mock.calls.map(([boundary]) => boundary.checkpoint.phase),
    ).toEqual(["planned", "initial", "supplemental", "complete"]);
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
      "node-initial",
      "node-supplemental",
    ]);
    expect(onResearchSearchCheckpoint.mock.calls[0]?.[0].checkpoint).toMatchObject({
      phase: "complete",
      version: ResearchEvidenceRetrievalCheckpointVersion,
    });
  });

  it("resumes an initial rerank boundary by running only the evidence judge", async () => {
    const retrieve = vi.fn();
    const vectorize = vi.fn();
    const plan = vi.fn();
    const judge = vi.fn(async () => ({
      coverage: 1,
      coveredDimensions: ["renewal"],
      missingDimensions: [],
      modelCalled: true,
      sufficient: true,
    }));
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
    expect(judge).toHaveBeenCalledOnce();
    expect(vectorize).not.toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledOnce();
    expect(result.items).toEqual([]);
    expect(result.metrics).toMatchObject({
      researchModelCalls: 0,
      researchRounds: 1,
      researchSupplementalSearches: 0,
    });
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
