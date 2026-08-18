import {
  DocumentOutlineSchema,
  KnowledgeNodeSchema,
  type KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { PageIndexFindabilityRepository } from "./page-index-findability-repository";
import {
  type PageIndexLayeredTreeSearch,
  PageIndexLayeredTreeSearchContractError,
  createPageIndexLayeredTreeSearch,
} from "./page-index-layered-tree-search";
import type { PageIndexSemanticTreeSearch } from "./page-index-semantic-tree-search";
import {
  PageIndexWholeTreeSelectionContractError,
  type PageIndexWholeTreeSelector,
} from "./page-index-whole-tree-selection";
import type {
  PublishedPageIndexOutlineItem,
  PublishedPageIndexRepository,
} from "./published-page-index-repository";
import {
  PublishedPageIndexCapabilityUnavailableError,
  createPublishedPageIndexRetrievalPath,
} from "./published-page-index-retrieval";
import { DurableResearchRetrievalPolicy } from "./research-retrieval-policy";
import type { HybridRetrievalRepository, RetrievalCandidate } from "./retrieval-candidates";
import { createRetrievalPlanner } from "./retrieval-planner";
import type {
  BasicHybridRetriever,
  ResearchRetrievalRoundCheckpoint,
  ResearchRetrievalSearchCheckpointBoundary,
  RetrieveHybridInput,
} from "./retrieval-types";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const PUBLICATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const GENERATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const FINANCE_DOCUMENT_ID = "10000000-0000-4000-8000-000000000001";
const LEGAL_DOCUMENT_ID = "10000000-0000-4000-8000-000000000002";

describe("published PageIndex Research V2 retrieval", () => {
  it("uses bounded layer-wise navigation as the production PageIndex path", async () => {
    const item = nestedOutlineItem();
    const pageIndex = pageIndexHarness([item]);
    const generate = vi.fn(
      async (providerInput: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        const payload = JSON.parse(providerInput.messages[1]?.content ?? "{}") as {
          readonly candidates: readonly { readonly nodeId: string }[];
        };
        const ids = payload.candidates.map((candidate) => candidate.nodeId);
        const nodeId = ids.includes("book")
          ? "book"
          : ids.includes("retention")
            ? "retention"
            : "invoice-period";
        return {
          model: "reasoning-model",
          text: JSON.stringify({
            decisions: [
              {
                action: nodeId === "invoice-period" ? "open" : "expand",
                nodeId,
                reason: "follow the relevant chapter",
                score: 0.92,
              },
            ],
          }),
        };
      },
    );
    const layeredTreeSearch = createPageIndexLayeredTreeSearch({
      maxFrontierNodes: 20,
      maxOutputTokens: 512,
      maxPromptTokens: 8_000,
      maxResponseChars: 8_000,
      maxSelectedNodesPerStep: 4,
      maxSummaryChars: 500,
      maxTitleChars: 200,
      maxTreeNodes: 1_000,
      providerFactory: () => ({ generate }),
      timeoutMs: 5_000,
    });
    const wholeTreeSelector = selectorStub(() => []);
    const retriever = configuredRetriever({
      layeredTreeSearch,
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, [
          "Book",
          "Retention",
          "Invoice period",
        ]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector,
    });

    const result = await retriever.retrieve(input());

    expect(generate).toHaveBeenCalledTimes(3);
    expect(wholeTreeSelector.select).not.toHaveBeenCalled();
    expect(pageIndex.openLeafEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ outlineNodeId: "invoice-period" }),
    );
    expect(result.metrics).toMatchObject({
      pageIndexLayeredDocuments: 1,
      pageIndexLayeredSteps: 3,
      pageIndexWholeTreeDocuments: 0,
    });
  });

  it("resumes the remaining layered frontier without repeating completed chapter decisions", async () => {
    const pageIndex = pageIndexHarness([nestedOutlineItem()]);
    const frontiers: string[][] = [];
    const generate = vi.fn(
      async (providerInput: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        const payload = JSON.parse(providerInput.messages[1]?.content ?? "{}") as {
          readonly candidates: readonly { readonly nodeId: string }[];
        };
        const ids = payload.candidates.map((candidate) => candidate.nodeId);
        frontiers.push(ids);
        const nodeId = ids.includes("book")
          ? "book"
          : ids.includes("retention")
            ? "retention"
            : "invoice-period";
        return {
          model: "reasoning-model",
          text: JSON.stringify({
            decisions: [
              {
                action: nodeId === "invoice-period" ? "open" : "expand",
                nodeId,
                reason: "continue relevant branch",
                score: 0.9,
              },
            ],
          }),
        };
      },
    );
    const layeredTreeSearch = createPageIndexLayeredTreeSearch({
      maxFrontierNodes: 20,
      maxOutputTokens: 512,
      maxPromptTokens: 8_000,
      maxResponseChars: 8_000,
      maxSelectedNodesPerStep: 4,
      maxSummaryChars: 500,
      maxTitleChars: 200,
      maxTreeNodes: 1_000,
      providerFactory: () => ({ generate }),
      timeoutMs: 5_000,
    });
    const retriever = configuredRetriever({
      layeredTreeSearch,
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, [
          "Book",
          "Retention",
          "Invoice period",
        ]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });
    let persisted: ResearchRetrievalSearchCheckpointBoundary | undefined;

    await expect(
      retriever.retrieve(
        input({
          onResearchSearchCheckpoint: async (boundary) => {
            persisted = boundary;
            throw new Error("simulated worker loss after first chapter");
          },
          researchExecutionPolicy: DurableResearchRetrievalPolicy,
          traceId: "a0000000-0000-4000-8000-000000000001",
        }),
      ),
    ).rejects.toThrow("simulated worker loss");
    if (!persisted) throw new Error("missing durable search checkpoint fixture");

    const resumed = await retriever.retrieve(
      input({
        onResearchSearchCheckpoint: async () => undefined,
        researchExecutionPolicy: DurableResearchRetrievalPolicy,
        researchSearchCheckpoint: persisted.checkpoint,
        researchSearchCheckpointResult: persisted.result,
        traceId: "a0000000-0000-4000-8000-000000000001",
      }),
    );

    expect(frontiers).toEqual([["book"], ["retention"], ["invoice-period"]]);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(resumed.items).toHaveLength(1);
    expect(resumed.metrics).toMatchObject({
      pageIndexLayeredSteps: 3,
      researchModelCalls: 3,
    });
  });

  it("routes a failed exact-generation findability score to bounded hybrid fallback", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const step = vi.fn();
    const semanticTreeSearch = semanticStub(0.91);
    const getManyRoutes = vi.fn(async () => [
      {
        documentAssetId: FINANCE_DOCUMENT_ID,
        generationId: GENERATION_ID,
        recommendedRoute: "hybrid" as const,
        status: "failed" as const,
      },
    ]);
    const retriever = configuredRetriever({
      findability: { getManyRoutes },
      layeredTreeSearch: { step },
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch,
      wholeTreeSelector: selectorStub(() => []),
    });

    const result = await retriever.retrieve(input());

    expect(getManyRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [{ documentAssetId: FINANCE_DOCUMENT_ID, generationId: GENERATION_ID }],
      }),
    );
    expect(step).not.toHaveBeenCalled();
    expect(semanticTreeSearch.score).toHaveBeenCalledOnce();
    expect(result.items).toHaveLength(1);
    expect(result.metrics?.degradationFlags).toContain("pageindex-findability-hybrid");
  });

  it("shortlists documents, loads outlines once, and lets whole-tree scores determine final rank", async () => {
    const searchDense = vi.fn(async () => [
      candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.99, ["Finance"]),
      candidate(LEGAL_DOCUMENT_ID, "60000000-0000-4000-8000-000000000002", 0.8, ["Legal"]),
    ]);
    const pageIndex = pageIndexHarness([
      outlineItem(FINANCE_DOCUMENT_ID, "finance", 1),
      outlineItem(LEGAL_DOCUMENT_ID, "legal", 2),
    ]);
    const wholeTreeSelector = selectorStub((outline) => [
      {
        nodeId: outline.documentAssetId === LEGAL_DOCUMENT_ID ? "legal" : "finance",
        reason:
          outline.documentAssetId === LEGAL_DOCUMENT_ID
            ? "direct retention evidence"
            : "invoice metadata only",
        score: outline.documentAssetId === LEGAL_DOCUMENT_ID ? 0.95 : 0.2,
      },
    ]);
    const semanticTreeSearch = semanticStub();
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense,
      semanticTreeSearch,
      wholeTreeSelector,
    });

    const result = await retriever.retrieve(input({ limit: 2, topK: 3 }));

    expect(searchDense).toHaveBeenCalledWith(
      expect.objectContaining({
        projectionSetPublicationId: PUBLICATION_ID,
        tenantId: "tenant-1",
        topK: 30,
      }),
    );
    expect(pageIndex.listOutlines).toHaveBeenCalledOnce();
    expect(pageIndex.listOutlines).toHaveBeenCalledWith(
      expect.objectContaining({
        documentAssetIds: [FINANCE_DOCUMENT_ID, LEGAL_DOCUMENT_ID],
      }),
    );
    expect(wholeTreeSelector.select).toHaveBeenCalledTimes(2);
    expect(semanticTreeSearch.score).not.toHaveBeenCalled();
    expect(result.items.map((item) => [item.nodeId, item.score])).toEqual([
      ["90000000-0000-4000-8000-000000000002", 0.95],
      ["90000000-0000-4000-8000-000000000001", 0.2],
    ]);
    expect(result.metrics).toMatchObject({
      denseCandidates: 2,
      ftsCandidates: 0,
      pageIndexOpenedRanges: 2,
      pageIndexSelectedDocuments: 2,
      pageIndexWholeTreeDocuments: 2,
      researchExecutionKind: "interactive",
    });
  });

  it("uses bounded candidate flattening only when the compact tree requests fallback", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const wholeTreeSelector: PageIndexWholeTreeSelector & {
      readonly select: ReturnType<typeof vi.fn>;
    } = {
      select: vi.fn(async () => ({
        estimatedPromptTokens: 20_000,
        fallbackReason: "tree-token-budget-exceeded" as const,
        nodeCount: 1,
        selections: [],
        strategy: "fallback" as const,
        summaryCoverage: 1,
      })),
    };
    const semanticTreeSearch = semanticStub(0.83);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch,
      wholeTreeSelector,
    });

    const result = await retriever.retrieve(input());

    expect(semanticTreeSearch.score).toHaveBeenCalledOnce();
    expect(result.items[0]?.score).toBe(0.83);
    expect(result.metrics).toMatchObject({
      pageIndexFallbackDocuments: 1,
      pageIndexSerializedTreeTokens: 20_000,
      pageIndexWholeTreeDocuments: 0,
    });
  });

  it("retries a recoverable selector failure then degrades to safe Value evidence", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const select = vi.fn(async () => {
      throw new PageIndexWholeTreeSelectionContractError("malformed provider output");
    });
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: { select },
    });

    const result = await retriever.retrieve(input());

    expect(select).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.sources).toEqual(["pageindex", "dense"]);
    expect(result.metrics?.degradationFlags).toContain("pageindex-whole-tree-provider-failed");
  });

  it("keeps model identity and publication prerequisites fail-closed", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: {
        select: async () => {
          throw new PageIndexWholeTreeSelectionContractError("model identity drift", {
            failureKind: "integrity",
          });
        },
      },
    });

    await expect(retriever.retrieve(input())).rejects.toMatchObject({
      failureKind: "integrity",
    });
    await expect(
      retriever.retrieve(input({ projectionSnapshot: undefined })),
    ).rejects.toBeInstanceOf(PublishedPageIndexCapabilityUnavailableError);
  });

  it("applies metadata, permission, and mode-final score filters before returning evidence", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"], {
          documentType: "invoice",
        }),
        {
          ...candidate(LEGAL_DOCUMENT_ID, "60000000-0000-4000-8000-000000000002", 0.8, ["Legal"], {
            documentType: "memo",
          }),
          permissionScope: ["document:private"],
        },
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => [
        { nodeId: "finance", reason: "below threshold", score: 0.59 },
      ]),
    });

    const result = await retriever.retrieve(
      input({
        filters: { documentTypes: ["invoice"] },
        retrievalProfile: profile({
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.6 },
        }),
      }),
    );

    expect(result.items).toEqual([]);
    expect(result.metrics).toMatchObject({
      metadataFilteredCandidates: 1,
      scoreThresholdFilteredCandidates: 1,
    });
  });

  it("returns without model or outline I/O when Value Search has no hits", async () => {
    const pageIndex = pageIndexHarness([]);
    const wholeTreeSelector = selectorStub(() => []);
    const semanticTreeSearch = semanticStub();
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => []),
      semanticTreeSearch,
      wholeTreeSelector,
    });

    const result = await retriever.retrieve(input());

    expect(result.items).toEqual([]);
    expect(pageIndex.listOutlines).not.toHaveBeenCalled();
    expect(wholeTreeSelector.select).not.toHaveBeenCalled();
    expect(semanticTreeSearch.score).not.toHaveBeenCalled();
  });

  it("opens durable evidence in bounded sufficiency rounds and checkpoints each safe boundary", async () => {
    const thirdDocumentId = "10000000-0000-4000-8000-000000000003";
    const pageIndex = pageIndexHarness([
      outlineItem(FINANCE_DOCUMENT_ID, "finance", 1),
      outlineItem(LEGAL_DOCUMENT_ID, "legal", 2),
      outlineItem(thirdDocumentId, "operations", 3),
    ]);
    const checkpoints = vi.fn(async (_checkpoint: ResearchRetrievalRoundCheckpoint) => undefined);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
        candidate(LEGAL_DOCUMENT_ID, "60000000-0000-4000-8000-000000000002", 0.8, ["Legal"]),
        candidate(thirdDocumentId, "60000000-0000-4000-8000-000000000003", 0.7, ["Operations"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub((outline) => {
        const selectedNode = outline.nodes[0];
        if (!selectedNode) throw new Error("missing outline node fixture");
        return [
          {
            nodeId: selectedNode.id,
            reason: "candidate evidence",
            score: 0.9,
          },
        ];
      }),
    });

    const result = await retriever.retrieve(
      input({
        limit: 3,
        onResearchRound: checkpoints,
        researchExecutionPolicy: DurableResearchRetrievalPolicy,
        topK: 3,
      }),
    );

    expect(checkpoints).toHaveBeenCalledTimes(3);
    expect(checkpoints.mock.calls.map(([checkpoint]) => checkpoint)).toEqual([
      expect.objectContaining({ round: 1, terminal: false }),
      expect.objectContaining({ round: 2, terminal: false }),
      expect.objectContaining({ round: 3, terminal: true }),
    ]);
    expect(pageIndex.openLeafEvidence).toHaveBeenCalledTimes(3);
    expect(result.items).toHaveLength(3);
    expect(result.metrics).toMatchObject({
      researchRounds: 3,
      researchSufficiencyReached: true,
      researchSupplementalSearches: 2,
    });
  });

  it("resumes directly from the durable evidence-opening checkpoint", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => [
        { nodeId: "finance", reason: "resume this range", score: 0.9 },
      ]),
    });
    let persisted: ResearchRetrievalSearchCheckpointBoundary | undefined;

    await expect(
      retriever.retrieve(
        input({
          onResearchSearchCheckpoint: async (boundary) => {
            if (boundary.checkpoint.phase === "evidence") {
              persisted = boundary;
              throw new Error("simulated worker loss before opening evidence");
            }
          },
          researchExecutionPolicy: DurableResearchRetrievalPolicy,
          traceId: "a0000000-0000-4000-8000-000000000002",
        }),
      ),
    ).rejects.toThrow("simulated worker loss before opening evidence");
    if (!persisted) throw new Error("missing evidence checkpoint fixture");

    const onResearchSearchCheckpoint = vi.fn(async () => undefined);
    const onResearchRound = vi.fn(async () => undefined);
    const resumed = await retriever.retrieve(
      input({
        onResearchRound,
        onResearchSearchCheckpoint,
        researchExecutionPolicy: DurableResearchRetrievalPolicy,
        researchSearchCheckpoint: persisted.checkpoint,
        traceId: "a0000000-0000-4000-8000-000000000002",
      }),
    );

    expect(resumed.items).toHaveLength(1);
    expect(pageIndex.openLeafEvidence).toHaveBeenCalledOnce();
    expect(onResearchSearchCheckpoint).toHaveBeenCalledOnce();
    expect(onResearchRound).toHaveBeenCalledWith(
      expect.objectContaining({ round: 1, terminal: true }),
    );
  });

  it("rejects mismatched, stale, and unsupported layered navigation checkpoints", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const layeredTreeSearch: PageIndexLayeredTreeSearch = {
      step: async (stepInput) => ({
        checkpoint: {
          ...stepInput.checkpoint,
          completed: true,
          depth: stepInput.checkpoint.depth + 1,
          frontier: [],
          modelCalls: stepInput.checkpoint.modelCalls + 1,
          openSelections: [{ nodeId: "finance", reason: "open", score: 0.9 }],
          visitedNodeIds: ["finance"],
        },
        estimatedPromptTokens: 50,
        flattenedNodeIds: [],
        visibleNodeIds: ["finance"],
      }),
    };
    const dependencies = {
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    };
    const retriever = configuredRetriever({ ...dependencies, layeredTreeSearch });
    let persisted: ResearchRetrievalSearchCheckpointBoundary | undefined;
    await expect(
      retriever.retrieve(
        input({
          onResearchSearchCheckpoint: async (boundary) => {
            persisted = boundary;
            throw new Error("capture navigation checkpoint");
          },
          researchExecutionPolicy: DurableResearchRetrievalPolicy,
          traceId: "a0000000-0000-4000-8000-000000000003",
        }),
      ),
    ).rejects.toThrow("capture navigation checkpoint");
    if (!persisted) throw new Error("missing navigation checkpoint fixture");
    if (persisted.checkpoint.version !== "research-retrieval-checkpoint-v2") {
      throw new Error("expected V2 navigation checkpoint fixture");
    }
    const navigation = persisted.checkpoint.navigation[0];
    if (!navigation) throw new Error("missing navigation state fixture");
    const resumeInput = input({
      researchExecutionPolicy: DurableResearchRetrievalPolicy,
      traceId: "a0000000-0000-4000-8000-000000000003",
    });

    await expect(
      configuredRetriever(dependencies).retrieve({
        ...resumeInput,
        researchSearchCheckpoint: persisted.checkpoint,
      }),
    ).rejects.toThrow("requires layered tree search");
    await expect(
      retriever.retrieve({
        ...resumeInput,
        researchSearchCheckpoint: {
          ...persisted.checkpoint,
          navigation: [
            {
              ...navigation,
              documentAssetId: LEGAL_DOCUMENT_ID,
              layeredCheckpoint: {
                ...navigation.layeredCheckpoint,
                documentAssetId: LEGAL_DOCUMENT_ID,
              },
            },
          ],
        },
      }),
    ).rejects.toThrow("navigation scope mismatch");
    await expect(
      retriever.retrieve({
        ...resumeInput,
        researchSearchCheckpoint: {
          ...persisted.checkpoint,
          navigation: [
            navigation,
            {
              ...navigation,
              layeredCheckpoint: {
                ...navigation.layeredCheckpoint,
                outlineId: "20000000-0000-4000-8000-000000000099",
              },
              outlineId: "20000000-0000-4000-8000-000000000099",
            },
          ],
        },
      }),
    ).rejects.toThrow("stale navigation state");
  });

  it("requires a trace id whenever durable checkpoint state is read or written", async () => {
    const pageIndex = pageIndexHarness([]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => []),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });

    await expect(
      retriever.retrieve(
        input({
          onResearchSearchCheckpoint: async () => undefined,
          researchExecutionPolicy: DurableResearchRetrievalPolicy,
        }),
      ),
    ).rejects.toThrow("checkpoints require a trace id");
  });

  it("stops before outline I/O when the bounded retrieval-step budget is exhausted", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });

    const result = await retriever.retrieve(
      input({
        researchExecutionPolicy: {
          ...DurableResearchRetrievalPolicy,
          maxRetrievalSteps: 1,
        },
      }),
    );

    expect(result.items).toEqual([]);
    expect(result.metrics?.degradationFlags).toContain("research-budget-exhausted");
    expect(pageIndex.listOutlines).not.toHaveBeenCalled();
  });

  it("degrades safely when a selected document has no published outline", async () => {
    const pageIndex = pageIndexHarness([]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });

    const result = await retriever.retrieve(input());

    expect(result.items).toEqual([]);
    expect(result.metrics?.degradationFlags).toContain("pageindex-outline-missing");
    expect(pageIndex.listOutlines).toHaveBeenCalledOnce();
  });

  it("retries layered navigation failures before falling back to Value-opened evidence", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const step = vi.fn(async () => {
      throw new Error("temporary model failure");
    });
    const retriever = configuredRetriever({
      layeredTreeSearch: { step },
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });

    const result = await retriever.retrieve(input());

    expect(step).toHaveBeenCalledTimes(2);
    expect(result.items[0]?.sources).toEqual(["pageindex", "dense"]);
    expect(result.metrics?.degradationFlags).toContain("pageindex-layered-provider-failed");
  });

  it("enforces the layered model-call and tree-depth bounds independently", async () => {
    const pageIndex = pageIndexHarness([nestedOutlineItem()]);
    const step: PageIndexLayeredTreeSearch["step"] = async (stepInput) => ({
      checkpoint: {
        ...stepInput.checkpoint,
        completed: false,
        depth: stepInput.checkpoint.depth + 1,
        frontier: stepInput.checkpoint.frontier,
        modelCalls: stepInput.checkpoint.modelCalls + 1,
        visitedNodeIds: stepInput.checkpoint.frontier.map((entry) => entry.nodeId),
      },
      estimatedPromptTokens: 50,
      flattenedNodeIds: [],
      visibleNodeIds: stepInput.checkpoint.frontier.map((entry) => entry.nodeId),
    });
    const retriever = configuredRetriever({
      layeredTreeSearch: { step },
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, [
          "Book",
          "Retention",
          "Invoice period",
        ]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });

    const depthBounded = await retriever.retrieve(
      input({
        researchExecutionPolicy: {
          ...DurableResearchRetrievalPolicy,
          maxTreeDepth: 1,
        },
      }),
    );
    expect(depthBounded.metrics?.degradationFlags).toContain("pageindex-layered-depth-exhausted");

    const modelBounded = await retriever.retrieve(
      input({
        researchExecutionPolicy: {
          ...DurableResearchRetrievalPolicy,
          maxModelCalls: 1,
          maxTreeDepth: 3,
        },
      }),
    );
    expect(modelBounded.metrics?.degradationFlags).toContain("research-budget-exhausted");
  });

  it("reports a truncated layered frontier and rejects integrity failures", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const searchDense = vi.fn(async () => [
      candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
    ]);
    const truncated = configuredRetriever({
      layeredTreeSearch: {
        step: async (stepInput) => ({
          checkpoint: {
            ...stepInput.checkpoint,
            completed: true,
            depth: stepInput.checkpoint.depth + 1,
            frontier: [],
            frontierTruncated: true,
            modelCalls: stepInput.checkpoint.modelCalls + 1,
            openSelections: [{ nodeId: "finance", reason: "open", score: 0.8 }],
            visitedNodeIds: ["finance"],
          },
          estimatedPromptTokens: 50,
          flattenedNodeIds: [],
          visibleNodeIds: ["finance"],
        }),
      },
      pageIndex: pageIndex.repository,
      searchDense,
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });
    const truncatedResult = await truncated.retrieve(input());
    expect(truncatedResult.metrics?.degradationFlags).toContain(
      "pageindex-layered-frontier-truncated",
    );

    const integrityError = new PageIndexLayeredTreeSearchContractError("identity drift", {
      failureKind: "integrity",
    });
    const integrity = configuredRetriever({
      layeredTreeSearch: {
        step: async () => {
          throw integrityError;
        },
      },
      pageIndex: pageIndex.repository,
      searchDense,
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });
    await expect(integrity.retrieve(input())).rejects.toBe(integrityError);
  });

  it("uses Value-only decisions after the whole-tree model-call budget is consumed", async () => {
    const pageIndex = pageIndexHarness([
      outlineItem(FINANCE_DOCUMENT_ID, "finance", 1),
      outlineItem(LEGAL_DOCUMENT_ID, "legal", 2),
    ]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
        candidate(LEGAL_DOCUMENT_ID, "60000000-0000-4000-8000-000000000002", 0.8, ["Legal"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub((outline) => [
        { nodeId: outline.nodes[0]?.id ?? "missing", reason: "first model decision", score: 0.8 },
      ]),
    });

    const result = await retriever.retrieve(
      input({
        limit: 2,
        researchExecutionPolicy: {
          ...DurableResearchRetrievalPolicy,
          maxConcurrentTreeSelections: 1,
          maxModelCalls: 1,
        },
      }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.metrics?.degradationFlags).toContain("research-budget-exhausted");
  });

  it("degrades a compact-tree fallback with no mappable candidates without semantic I/O", async () => {
    const base = fixtureOutline(FINANCE_DOCUMENT_ID, "unrelated", 1);
    const root = base.nodes[0];
    if (!root) throw new Error("missing root fixture");
    const { endOffset: _endOffset, startOffset: _startOffset, ...headingOnly } = root;
    const item: PublishedPageIndexOutlineItem = {
      documentAssetId: FINANCE_DOCUMENT_ID,
      generationId: GENERATION_ID,
      outline: DocumentOutlineSchema.parse({
        ...base,
        nodes: [{ ...headingOnly, sectionPath: ["Unrelated"] }],
      }),
      publicationId: PUBLICATION_ID,
    };
    const pageIndex = pageIndexHarness([item]);
    const semanticTreeSearch = semanticStub();
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch,
      wholeTreeSelector: fallbackSelector(),
    });

    const result = await retriever.retrieve(input());

    expect(result.items).toEqual([]);
    expect(result.metrics?.degradationFlags).toContain("pageindex-tree-fallback-empty");
    expect(semanticTreeSearch.score).not.toHaveBeenCalled();
  });

  it("degrades recoverably when semantic fallback omits a candidate", async () => {
    const pageIndex = pageIndexHarness([outlineItem(FINANCE_DOCUMENT_ID, "finance", 1)]);
    const semanticTreeSearch: PageIndexSemanticTreeSearch = { score: async () => [] };
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
      ]),
      semanticTreeSearch,
      wholeTreeSelector: fallbackSelector(),
    });

    const result = await retriever.retrieve(input());

    expect(result.items[0]?.sources).toEqual(["pageindex", "dense"]);
    expect(result.metrics?.degradationFlags).toContain("pageindex-tree-fallback-provider-failed");
  });

  it("falls back to Value evidence when semantic fallback calls exceed the model budget", async () => {
    const pageIndex = pageIndexHarness([
      outlineItem(FINANCE_DOCUMENT_ID, "finance", 1),
      outlineItem(LEGAL_DOCUMENT_ID, "legal", 2),
    ]);
    const semanticTreeSearch = semanticStub();
    const retriever = configuredRetriever({
      maxSemanticCandidatesPerCall: 1,
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
        candidate(LEGAL_DOCUMENT_ID, "60000000-0000-4000-8000-000000000002", 0.8, ["Legal"]),
      ]),
      semanticTreeSearch,
      wholeTreeSelector: fallbackSelector(),
    });

    const result = await retriever.retrieve(
      input({
        researchExecutionPolicy: {
          ...DurableResearchRetrievalPolicy,
          maxConcurrentTreeSelections: 1,
          maxModelCalls: 1,
        },
      }),
    );

    expect(semanticTreeSearch.score).not.toHaveBeenCalled();
    expect(result.items[0]?.sources).toEqual(["pageindex", "dense"]);
    expect(result.metrics?.degradationFlags).toContain("research-budget-exhausted");
  });

  it("applies independent evidence-round budget stops", async () => {
    const thirdDocumentId = "10000000-0000-4000-8000-000000000003";
    const pageIndex = pageIndexHarness([
      outlineItem(FINANCE_DOCUMENT_ID, "finance", 1),
      outlineItem(LEGAL_DOCUMENT_ID, "legal", 2),
      outlineItem(thirdDocumentId, "operations", 3),
    ]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => [
        candidate(FINANCE_DOCUMENT_ID, "60000000-0000-4000-8000-000000000001", 0.9, ["Finance"]),
        candidate(LEGAL_DOCUMENT_ID, "60000000-0000-4000-8000-000000000002", 0.8, ["Legal"]),
        candidate(thirdDocumentId, "60000000-0000-4000-8000-000000000003", 0.7, ["Operations"]),
      ]),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub((outline) => [
        { nodeId: outline.nodes[0]?.id ?? "missing", reason: "open", score: 0.9 },
      ]),
    });
    const retrievalStepBounded = await retriever.retrieve(
      input({
        limit: 3,
        researchExecutionPolicy: {
          ...DurableResearchRetrievalPolicy,
          maxRetrievalSteps: 2,
        },
      }),
    );
    expect(retrievalStepBounded.items).toEqual([]);
    expect(retrievalStepBounded.metrics?.degradationFlags).toContain("research-budget-exhausted");

    const supplementalBounded = await retriever.retrieve(
      input({
        limit: 3,
        researchExecutionPolicy: {
          ...DurableResearchRetrievalPolicy,
          maxSupplementalSearches: 0,
        },
      }),
    );
    expect(supplementalBounded.items).toHaveLength(1);
    expect(supplementalBounded.metrics?.degradationFlags).toContain("research-budget-exhausted");

    const openBounded = await retriever.retrieve(
      input({
        limit: 3,
        researchExecutionPolicy: {
          ...DurableResearchRetrievalPolicy,
          maxOpenedResources: 1,
        },
      }),
    );
    expect(openBounded.items).toHaveLength(1);
    expect(openBounded.metrics?.degradationFlags).toContain("research-budget-exhausted");
  });

  it.each(["fast", "deep"] as const)("leaves %s on the ordinary retrieval stack", async (mode) => {
    const base = vi.fn(async () => ({ items: [] }));
    const pageIndex = pageIndexHarness([]);
    const searchDense = vi.fn(async () => []);
    const retriever = createPublishedPageIndexRetrievalPath({
      maxSemanticCandidates: 20,
      pageIndex: pageIndex.repository,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: { retrieve: base },
      semanticTreeSearch: semanticStub(),
      valueSearch: { publishedMembershipEnforced: true, searchDense },
      wholeTreeSelector: selectorStub(() => []),
    });

    await retriever.retrieve(input({ mode }));

    expect(base).toHaveBeenCalledOnce();
    expect(searchDense).not.toHaveBeenCalled();
  });

  it("fails closed when semantic Value Search prerequisites are absent", async () => {
    const pageIndex = pageIndexHarness([]);
    const retriever = configuredRetriever({
      pageIndex: pageIndex.repository,
      searchDense: vi.fn(async () => []),
      semanticTreeSearch: semanticStub(),
      wholeTreeSelector: selectorStub(() => []),
    });

    await expect(retriever.retrieve(input({ permissionScope: undefined }))).rejects.toThrow(
      "server-issued permission scope",
    );
    await expect(retriever.retrieve(input({ denseProjectionModel: undefined }))).rejects.toThrow(
      "frozen embedding vector space",
    );
    await expect(retriever.retrieve(input({ queryVector: [] }))).rejects.toThrow(
      "finite query embedding",
    );
    await expect(retriever.retrieve(input({ queryVector: [Number.NaN] }))).rejects.toThrow(
      "finite query embedding",
    );
    await expect(retriever.retrieve(input({ retrievalProfile: undefined }))).rejects.toThrow(
      "frozen retrieval profile",
    );
    await expect(
      retriever.retrieve(
        input({
          projectionSnapshot: {
            ...input().projectionSnapshot,
            knowledgeSpaceId: "different-space",
          } as NonNullable<RetrieveHybridInput["projectionSnapshot"]>,
        }),
      ),
    ).rejects.toThrow("snapshot does not match the query scope");

    const unsafe = createPublishedPageIndexRetrievalPath({
      maxSemanticCandidates: 20,
      pageIndex: pageIndex.repository,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: emptyRetriever(),
      semanticTreeSearch: semanticStub(),
      valueSearch: { searchDense: vi.fn(async () => []) },
      wholeTreeSelector: selectorStub(() => []),
    });
    await expect(unsafe.retrieve(input())).rejects.toThrow(
      "authoritative published-membership filtering",
    );
  });

  it("rejects invalid retrieval construction bounds", () => {
    const pageIndex = pageIndexHarness([]);
    const options = {
      maxSemanticCandidates: 20,
      pageIndex: pageIndex.repository,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: emptyRetriever(),
      semanticTreeSearch: semanticStub(),
      valueSearch: {
        publishedMembershipEnforced: true as const,
        searchDense: vi.fn(async () => []),
      },
      wholeTreeSelector: selectorStub(() => []),
    };
    expect(() =>
      createPublishedPageIndexRetrievalPath({ ...options, maxSemanticCandidates: 0 }),
    ).toThrow("maxSemanticCandidates must be a positive integer");
    expect(() =>
      createPublishedPageIndexRetrievalPath({
        ...options,
        maxSemanticCandidatesPerCall: 0.5,
      }),
    ).toThrow("maxSemanticCandidatesPerCall must be a positive integer");
  });
});

function configuredRetriever({
  findability,
  layeredTreeSearch,
  pageIndex,
  searchDense,
  semanticTreeSearch,
  wholeTreeSelector,
  maxSemanticCandidates = 20,
  maxSemanticCandidatesPerCall,
}: {
  readonly findability?: Pick<PageIndexFindabilityRepository, "getManyRoutes"> | undefined;
  readonly layeredTreeSearch?: PageIndexLayeredTreeSearch | undefined;
  readonly pageIndex: Pick<PublishedPageIndexRepository, "listOutlines" | "openLeafEvidence">;
  readonly searchDense: HybridRetrievalRepository["searchDense"];
  readonly semanticTreeSearch: PageIndexSemanticTreeSearch;
  readonly wholeTreeSelector: PageIndexWholeTreeSelector;
  readonly maxSemanticCandidates?: number | undefined;
  readonly maxSemanticCandidatesPerCall?: number | undefined;
}): BasicHybridRetriever {
  return createPublishedPageIndexRetrievalPath({
    ...(findability ? { findability } : {}),
    ...(layeredTreeSearch ? { layeredTreeSearch } : {}),
    maxSemanticCandidates,
    ...(maxSemanticCandidatesPerCall === undefined ? {} : { maxSemanticCandidatesPerCall }),
    pageIndex,
    planner: createRetrievalPlanner({ maxTopK: 100 }),
    retriever: emptyRetriever(),
    semanticTreeSearch,
    valueSearch: { publishedMembershipEnforced: true, searchDense },
    wholeTreeSelector,
  });
}

function fallbackSelector(): PageIndexWholeTreeSelector & {
  readonly select: ReturnType<typeof vi.fn>;
} {
  return {
    select: vi.fn(async () => ({
      estimatedPromptTokens: 20_000,
      fallbackReason: "tree-token-budget-exceeded" as const,
      nodeCount: 1,
      selections: [],
      strategy: "fallback" as const,
      summaryCoverage: 1,
    })),
  };
}

function nestedOutlineItem(): PublishedPageIndexOutlineItem {
  const leaf = {
    childNodeIds: [],
    children: [],
    endOffset: 300,
    id: "invoice-period",
    level: 3,
    metadata: {},
    sectionPath: ["Book", "Retention", "Invoice period"],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: 200,
    summary: "Invoice retention period evidence",
    title: "Invoice period",
    tocSource: "parser-heading" as const,
  };
  const chapter = {
    childNodeIds: [leaf.id],
    children: [leaf],
    endOffset: 300,
    id: "retention",
    level: 2,
    metadata: {},
    sectionPath: ["Book", "Retention"],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: 100,
    summary: "Retention rules",
    title: "Retention",
    tocSource: "parser-heading" as const,
  };
  const outline = DocumentOutlineSchema.parse({
    ...fixtureOutline(FINANCE_DOCUMENT_ID, "unused", 1),
    nodes: [
      {
        childNodeIds: [chapter.id],
        children: [chapter],
        endOffset: 300,
        id: "book",
        level: 1,
        metadata: {},
        sectionPath: ["Book"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: "Finance handbook",
        title: "Book",
        tocSource: "parser-heading",
      },
    ],
  });
  return {
    documentAssetId: FINANCE_DOCUMENT_ID,
    generationId: GENERATION_ID,
    outline,
    publicationId: PUBLICATION_ID,
  };
}

function selectorStub(
  selections: (outline: ReturnType<typeof fixtureOutline>) => readonly {
    readonly nodeId: string;
    readonly reason: string;
    readonly score: number;
  }[],
): PageIndexWholeTreeSelector & { readonly select: ReturnType<typeof vi.fn> } {
  return {
    select: vi.fn(async (input) => ({
      estimatedPromptTokens: 500,
      nodeCount: input.outline.nodes.length,
      selections: selections(input.outline),
      strategy: "whole-tree" as const,
      summaryCoverage: 1,
    })),
  };
}

function semanticStub(
  score = 0.8,
): PageIndexSemanticTreeSearch & { readonly score: ReturnType<typeof vi.fn> } {
  return {
    score: vi.fn(async (input: Parameters<PageIndexSemanticTreeSearch["score"]>[0]) =>
      input.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        reason: "flattened semantic match",
        score,
      })),
    ),
  };
}

function pageIndexHarness(items: readonly PublishedPageIndexOutlineItem[]) {
  const byDocumentId = new Map(items.map((item) => [item.documentAssetId, item]));
  const listOutlines = vi.fn(
    async (input: Parameters<PublishedPageIndexRepository["listOutlines"]>[0]) => ({
      items: (input.documentAssetIds ?? [])
        .map((documentAssetId) => byDocumentId.get(documentAssetId))
        .filter((item): item is PublishedPageIndexOutlineItem => item !== undefined),
    }),
  );
  const openLeafEvidence = vi.fn(
    async (input: Parameters<PublishedPageIndexRepository["openLeafEvidence"]>[0]) => {
      const item = byDocumentId.get(input.documentAssetId);
      if (!item) throw new Error("missing outline fixture");
      const selectedNode = item.outline.nodes[0];
      if (!selectedNode) throw new Error("missing outline node fixture");
      const index = Number(item.outline.id.at(-1) ?? "1");
      const node = KnowledgeNodeSchema.parse({
        artifactHash: "a".repeat(64),
        documentAssetId: input.documentAssetId,
        endOffset: 100,
        id: `90000000-0000-4000-8000-00000000000${index}`,
        kind: "chunk",
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        parseArtifactId: item.outline.parseArtifactId,
        permissionScope: ["document:read"],
        publicationGenerationId: GENERATION_ID,
        sourceLocation: { sectionPath: [input.outlineNodeId] },
        startOffset: 0,
        text: `Evidence from ${input.outlineNodeId}`,
      });
      return {
        items: [
          {
            citation: {
              artifactHash: node.artifactHash,
              documentAssetId: input.documentAssetId,
              documentVersion: 1,
              sectionPath: [input.outlineNodeId],
            },
            node,
            outlineId: item.outline.id,
            outlineNodeId: input.outlineNodeId,
            projections: [
              {
                id: `80000000-0000-4000-8000-00000000000${index}`,
                type: "dense-vector" as const,
              },
            ],
          },
        ],
        openedRange: { endOffset: 100, startOffset: 0 },
        outline: item.outline,
        selectedNode,
        truncated: false,
      };
    },
  );
  return {
    listOutlines,
    openLeafEvidence,
    repository: { listOutlines, openLeafEvidence },
  };
}

function outlineItem(
  documentAssetId: string,
  nodeId: string,
  fixtureIndex: number,
): PublishedPageIndexOutlineItem {
  return {
    documentAssetId,
    generationId: GENERATION_ID,
    outline: fixtureOutline(documentAssetId, nodeId, fixtureIndex),
    publicationId: PUBLICATION_ID,
  };
}

function fixtureOutline(documentAssetId: string, nodeId: string, fixtureIndex: number) {
  return DocumentOutlineSchema.parse({
    artifactHash: "a".repeat(64),
    createdAt: "2026-08-05T00:00:00.000Z",
    documentAssetId,
    id: `20000000-0000-4000-8000-00000000000${fixtureIndex}`,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    nodes: [
      {
        childNodeIds: [],
        children: [],
        endOffset: 100,
        id: nodeId,
        level: 1,
        metadata: {},
        sectionPath: [nodeId[0]?.toUpperCase() + nodeId.slice(1)],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: `${nodeId} summary`,
        title: nodeId,
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "outline-v1",
    parseArtifactId: `40000000-0000-4000-8000-00000000000${fixtureIndex}`,
    publicationGenerationId: GENERATION_ID,
    version: 1,
  });
}

function candidate(
  documentAssetId: string,
  nodeId: string,
  score: number,
  sectionPath: readonly string[],
  metadata: Record<string, unknown> = {},
): RetrievalCandidate {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId,
      documentVersion: 1,
      endOffset: 100,
      sectionPath: [...sectionPath],
      startOffset: 0,
    },
    metadata: { text: `Evidence for ${nodeId}`, ...metadata },
    nodeId,
    permissionScope: ["document:read"],
    projectionId: nodeId.replace(/^6/, "7"),
    score,
    source: "dense",
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
