import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type {
  PageIndexSemanticScore,
  PageIndexSemanticTreeSearch,
  ScorePageIndexSemanticCandidatesInput,
} from "./page-index-semantic-tree-search";
import {
  PublishedPageIndexCapabilityUnavailableError,
  createPublishedPageIndexRetrievalPath,
} from "./published-page-index-retrieval";
import type { HybridRetrievalRepository, RetrievalCandidate } from "./retrieval-candidates";
import { createRetrievalPlanner } from "./retrieval-planner";
import type { BasicHybridRetriever, RetrieveHybridInput } from "./retrieval-types";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const PUBLICATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";

describe("published PageIndex semantic retrieval", () => {
  it("uses published dense Value Search and lets the LLM score determine final rank", async () => {
    const base = vi.fn(async () => {
      throw new Error("ordinary hybrid retrieval must not run");
    });
    const searchDense = vi.fn(async () => [
      candidate({
        nodeId: "finance-primary",
        score: 0.99,
        sectionPath: ["Finance", "Invoice"],
        text: "The invoice includes the tax identifier.",
      }),
      candidate({
        nodeId: "legal-direct",
        score: 0.8,
        sectionPath: ["Legal", "Billing"],
        text: "Invoices must be retained for seven years.",
      }),
      candidate({
        nodeId: "finance-secondary",
        score: 0.7,
        sectionPath: ["Finance", "Invoice"],
        text: "General invoice metadata.",
      }),
    ]);
    const semanticTreeSearch = createSemanticTreeSearchStub({
      c1: { reason: "mentions an identifier, not retention", score: 0.2 },
      c2: { reason: "directly answers the retention period", score: 0.95 },
      c3: { reason: "related invoice context", score: 0.6 },
    });
    const retriever = createPublishedPageIndexRetrievalPath({
      maxSemanticCandidates: 20,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: { retrieve: base },
      semanticTreeSearch,
      valueSearch: {
        publishedMembershipEnforced: true,
        searchDense,
      },
    });

    const result = await retriever.retrieve(input({ limit: 2, topK: 3 }));

    expect(base).not.toHaveBeenCalled();
    expect(searchDense).toHaveBeenCalledWith(
      expect.objectContaining({
        denseProjectionModel: "embedding-space-v1",
        permissionScope: ["document:read"],
        projectionSetPublicationId: PUBLICATION_ID,
        queryVector: [0.1, 0.2],
        tenantId: "tenant-1",
        topK: 30,
      }),
    );
    expect(semanticTreeSearch.score).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "How long must invoices be retained?",
        reasoningModel: profile().reasoningModel,
        tenantId: "tenant-1",
      }),
    );
    const scoredInput = vi.mocked(semanticTreeSearch.score).mock.calls[0]?.[0] as
      | ScorePageIndexSemanticCandidatesInput
      | undefined;
    expect(scoredInput?.candidates.map((entry) => entry.nodeId)).toEqual([
      "finance-primary",
      "legal-direct",
      "finance-secondary",
    ]);
    expect(result.items.map((item) => [item.nodeId, item.score])).toEqual([
      ["legal-direct", 0.95],
      ["finance-secondary", 0.6],
    ]);
    expect(result.items[0]?.metadata.pageIndex).toEqual(
      expect.objectContaining({
        llmReason: "directly answers the retention period",
        normalizedScore: 0.95,
        scoreVersion: "pageindex-semantic-llm-v1",
      }),
    );
    expect(result.metrics).toMatchObject({
      denseCandidates: 3,
      ftsCandidates: 0,
      pageIndexMatchedNodes: 3,
      pageIndexScoreVersion: "pageindex-semantic-llm-v1",
      reasoningTreeSearchNodes: 3,
    });
    expect(result.plan).toMatchObject({
      denseTopK: 30,
      ftsTopK: 0,
      fusionLimit: 0,
      rerankCandidateLimit: 0,
      resolvedMode: "research",
    });
  });

  it("applies permission and metadata filters before LLM scoring", async () => {
    const searchDense = vi.fn(async () => [
      candidate({
        metadata: { documentType: "invoice", text: "Readable invoice evidence" },
        nodeId: "allowed",
        score: 1,
      }),
      candidate({
        metadata: { documentType: "memo", text: "Wrong document type" },
        nodeId: "wrong-type",
        score: 0.9,
      }),
      candidate({
        metadata: { documentType: "invoice", text: "Private invoice evidence" },
        nodeId: "private",
        permissionScope: ["document:private"],
        score: 0.8,
      }),
    ]);
    const semanticTreeSearch = createSemanticTreeSearchStub({
      c1: { reason: "direct evidence", score: 0.8 },
    });
    const retriever = configuredRetriever({ searchDense, semanticTreeSearch });

    const result = await retriever.retrieve(
      input({ filters: { documentTypes: ["invoice"] }, limit: 5, topK: 5 }),
    );

    const scoredInput = vi.mocked(semanticTreeSearch.score).mock.calls[0]?.[0] as
      | ScorePageIndexSemanticCandidatesInput
      | undefined;
    expect(scoredInput?.candidates.map((entry) => entry.nodeId)).toEqual(["allowed"]);
    expect(result.items.map((item) => item.nodeId)).toEqual(["allowed"]);
    expect(result.metrics).toMatchObject({
      metadataFilteredCandidates: 1,
      permissionFilteredCandidates: 1,
    });
  });

  it("applies the profile score threshold inclusively before final Top K", async () => {
    const semanticTreeSearch = createSemanticTreeSearchStub({
      c1: { reason: "at threshold", score: 0.6 },
      c2: { reason: "below threshold", score: 0.59 },
    });
    const retriever = configuredRetriever({
      searchDense: vi.fn(async () => [
        candidate({ nodeId: "included", score: 0.9 }),
        candidate({ nodeId: "excluded", score: 0.8 }),
      ]),
      semanticTreeSearch,
    });

    const result = await retriever.retrieve(
      input({
        retrievalProfile: profile({
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.6 },
        }),
      }),
    );

    expect(result.items.map((item) => item.nodeId)).toEqual(["included"]);
    expect(result.metrics?.scoreThresholdFilteredCandidates).toBe(1);
  });

  it("returns an empty semantic result without calling the LLM when Value Search has no hits", async () => {
    const semanticTreeSearch = createSemanticTreeSearchStub({});
    const retriever = configuredRetriever({
      searchDense: vi.fn(async () => []),
      semanticTreeSearch,
    });

    const result = await retriever.retrieve(input());

    expect(result.items).toEqual([]);
    expect(semanticTreeSearch.score).not.toHaveBeenCalled();
    expect(result.metrics).toMatchObject({
      denseCandidates: 0,
      pageIndexMatchedNodes: 0,
    });
  });

  it.each(["fast", "deep"] as const)("leaves %s on the ordinary retrieval stack", async (mode) => {
    const base = vi.fn(async () => ({ items: [] }));
    const searchDense = vi.fn(async () => []);
    const semanticTreeSearch = createSemanticTreeSearchStub({});
    const retriever = createPublishedPageIndexRetrievalPath({
      maxSemanticCandidates: 20,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: { retrieve: base },
      semanticTreeSearch,
      valueSearch: {
        publishedMembershipEnforced: true,
        searchDense,
      },
    });

    await retriever.retrieve(input({ mode }));

    expect(base).toHaveBeenCalledOnce();
    expect(searchDense).not.toHaveBeenCalled();
    expect(semanticTreeSearch.score).not.toHaveBeenCalled();
  });

  it("fails closed when semantic Value Search prerequisites are absent", async () => {
    const retriever = configuredRetriever({
      searchDense: vi.fn(async () => []),
      semanticTreeSearch: createSemanticTreeSearchStub({}),
    });

    await expect(
      retriever.retrieve(input({ projectionSnapshot: undefined })),
    ).rejects.toBeInstanceOf(PublishedPageIndexCapabilityUnavailableError);
    await expect(retriever.retrieve(input({ permissionScope: undefined }))).rejects.toBeInstanceOf(
      PublishedPageIndexCapabilityUnavailableError,
    );
    await expect(retriever.retrieve(input({ denseProjectionModel: undefined }))).rejects.toThrow(
      "frozen embedding vector space",
    );
    await expect(retriever.retrieve(input({ queryVector: [] }))).rejects.toThrow(
      "finite query embedding",
    );
    await expect(retriever.retrieve(input({ retrievalProfile: undefined }))).rejects.toThrow(
      "frozen retrieval profile",
    );

    const unsafe = createPublishedPageIndexRetrievalPath({
      maxSemanticCandidates: 20,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: emptyRetriever(),
      semanticTreeSearch: createSemanticTreeSearchStub({}),
      valueSearch: {
        searchDense: vi.fn(async () => []),
      },
    });
    await expect(unsafe.retrieve(input())).rejects.toThrow(
      "authoritative published-membership filtering",
    );
  });
});

function configuredRetriever({
  searchDense,
  semanticTreeSearch,
}: {
  readonly searchDense: HybridRetrievalRepository["searchDense"];
  readonly semanticTreeSearch: PageIndexSemanticTreeSearch;
}): BasicHybridRetriever {
  return createPublishedPageIndexRetrievalPath({
    maxSemanticCandidates: 20,
    planner: createRetrievalPlanner({ maxTopK: 100 }),
    retriever: emptyRetriever(),
    semanticTreeSearch,
    valueSearch: {
      publishedMembershipEnforced: true,
      searchDense,
    },
  });
}

function createSemanticTreeSearchStub(
  scores: Readonly<Record<string, Omit<PageIndexSemanticScore, "candidateId">>>,
): PageIndexSemanticTreeSearch & { readonly score: ReturnType<typeof vi.fn> } {
  return {
    score: vi.fn(async (input: ScorePageIndexSemanticCandidatesInput) =>
      input.candidates.map((candidate) => {
        const score = scores[candidate.candidateId];
        if (!score) {
          throw new Error(`missing test score for ${candidate.candidateId}`);
        }
        return { candidateId: candidate.candidateId, ...score };
      }),
    ),
  };
}

function candidate(
  overrides: Partial<RetrievalCandidate> & {
    readonly nodeId: string;
    readonly sectionPath?: readonly string[];
    readonly score: number;
    readonly text?: string;
  },
): RetrievalCandidate {
  const { metadata, sectionPath, text, ...candidateOverrides } = overrides;
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: `document-${overrides.nodeId}`,
      documentVersion: 1,
      sectionPath: sectionPath ? [...sectionPath] : ["Invoices"],
    },
    metadata: metadata ?? { text: text ?? `Evidence for ${overrides.nodeId}` },
    permissionScope: ["document:read"],
    projectionId: `projection-${overrides.nodeId}`,
    source: "dense",
    ...candidateOverrides,
  };
}

function input(overrides: Partial<RetrieveHybridInput> = {}): RetrieveHybridInput {
  return {
    denseProjectionModel: "embedding-space-v1",
    knowledgeSpaceId: SPACE_ID,
    limit: 5,
    mode: "research",
    permissionScope: ["document:read"],
    projectionSnapshot: {
      fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
      headRevision: 3,
      knowledgeSpaceId: SPACE_ID,
      projectionVersion: 2,
      publicationId: PUBLICATION_ID,
      tenantId: "tenant-1",
    },
    query: "How long must invoices be retained?",
    queryVector: [0.1, 0.2],
    retrievalProfile: profile(),
    tenantId: "tenant-1",
    topK: 5,
    ...overrides,
  };
}

function profile(
  overrides: Partial<KnowledgeSpaceRetrievalProfile> = {},
): KnowledgeSpaceRetrievalProfile {
  return {
    defaultMode: "research",
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "vendor/reasoning",
      provider: "vendor",
    },
    rerank: { enabled: false },
    revision: 1,
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 5,
    ...overrides,
  };
}

function emptyRetriever(): BasicHybridRetriever {
  return { retrieve: async () => ({ items: [] }) };
}
