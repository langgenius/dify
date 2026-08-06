import { DocumentOutlineSchema, GoldenQuestionSchema } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  createPageIndexFindabilityEvaluator,
  mapExpectedEvidenceToOutlineNodes,
} from "./page-index-findability-evaluation";
import type {
  PageIndexLayeredTreeCheckpoint,
  PageIndexLayeredTreeSearch,
} from "./page-index-layered-tree-search";
import { PageIndexLayeredTreeSearchContractError } from "./page-index-layered-tree-search";

const DOCUMENT_ID = "10000000-0000-4000-8000-000000000001";
const SPACE_ID = "30000000-0000-4000-8000-000000000001";

describe("PageIndex human-golden findability evaluation", () => {
  it("reports not-evaluated without calling a selector or creating questions when labels are absent", async () => {
    const step = vi.fn();
    const enqueue = vi.fn();
    const evaluator = evaluatorWith({ step }, enqueue);

    const result = await evaluator.evaluate({
      evidenceRanges: [],
      outline: fixtureOutline(),
      questions: [],
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({
      recommendedRoute: "unchanged",
      sampleCount: 0,
      status: "not-evaluated",
      summaryRepairRequested: false,
    });
    expect(step).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("measures Recall@K, reciprocal rank, path recall, and abstention from human labels", async () => {
    const selector = layeredSearchForQuestion({
      "Where is the invoice number?": [
        { nodeId: "tax", reason: "secondary", score: 0.8 },
        { nodeId: "invoice", reason: "direct", score: 0.9 },
      ],
      "Where is the tax rate?": [{ nodeId: "finance", reason: "parent path", score: 0.9 }],
    });
    const evaluator = evaluatorWith(selector);

    const result = await evaluator.evaluate({
      evidenceRanges: [
        range("60000000-0000-4000-8000-000000000001", 110, 150),
        range("60000000-0000-4000-8000-000000000002", 210, 250),
      ],
      outline: fixtureOutline(),
      questions: [
        question(
          "70000000-0000-4000-8000-000000000001",
          "Where is the invoice number?",
          "60000000-0000-4000-8000-000000000001",
        ),
        question(
          "70000000-0000-4000-8000-000000000002",
          "Where is the tax rate?",
          "60000000-0000-4000-8000-000000000002",
        ),
      ],
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({
      abstentionRate: 0,
      meanReciprocalRank: 0.5,
      pathRecallAtK: 1,
      recallAtK: 0.5,
      recommendedRoute: "layered",
      sampleCount: 2,
      status: "passed",
    });
  });

  it("routes sufficiently sampled low-findability documents to hybrid and requests bounded repair", async () => {
    const enqueue = vi.fn(async () => undefined);
    const evaluator = evaluatorWith(layeredSearchForQuestion({}), enqueue);
    const result = await evaluator.evaluate({
      evidenceRanges: [
        range("60000000-0000-4000-8000-000000000001", 110, 150),
        range("60000000-0000-4000-8000-000000000002", 210, 250),
      ],
      outline: fixtureOutline(),
      questions: [
        question(
          "70000000-0000-4000-8000-000000000001",
          "Invoice?",
          "60000000-0000-4000-8000-000000000001",
        ),
        question(
          "70000000-0000-4000-8000-000000000002",
          "Tax?",
          "60000000-0000-4000-8000-000000000002",
        ),
      ],
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({
      abstentionRate: 1,
      recommendedRoute: "hybrid",
      status: "failed",
      summaryRepairRequested: true,
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        documentAssetId: DOCUMENT_ID,
        reason: "low-findability",
      }),
    );
  });

  it("maps expected evidence ranges to the deepest covering outline nodes", () => {
    const mapping = mapExpectedEvidenceToOutlineNodes({
      evidenceRanges: [range("60000000-0000-4000-8000-000000000001", 120, 160)],
      outline: fixtureOutline(),
    });

    expect(mapping.get("60000000-0000-4000-8000-000000000001")).toBe("invoice");
  });

  it("treats recoverable navigation errors and unknown selections as abstentions", async () => {
    let calls = 0;
    const evaluator = evaluatorWith({
      step: async (input) => {
        calls += 1;
        if (calls === 1) {
          throw new Error("provider unavailable");
        }
        return {
          checkpoint: {
            ...input.checkpoint,
            completed: true,
            depth: input.checkpoint.depth + 1,
            frontier: [],
            modelCalls: input.checkpoint.modelCalls + 1,
            openSelections: [{ nodeId: "unknown", reason: "bad id", score: 0.5 }],
            visitedNodeIds: [],
          },
          estimatedPromptTokens: 10,
          flattenedNodeIds: [],
          visibleNodeIds: [],
        };
      },
    });
    const result = await evaluator.evaluate({
      evidenceRanges: [
        range("60000000-0000-4000-8000-000000000001", 110, 150),
        range("60000000-0000-4000-8000-000000000002", 210, 250),
      ],
      outline: fixtureOutline(),
      questions: [
        question(
          "70000000-0000-4000-8000-000000000001",
          "Invoice?",
          "60000000-0000-4000-8000-000000000001",
        ),
        question(
          "70000000-0000-4000-8000-000000000002",
          "Tax?",
          "60000000-0000-4000-8000-000000000002",
        ),
      ],
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({ abstentionRate: 0.5, recallAtK: 0, status: "failed" });
  });

  it("fails closed on an integrity navigation contract error", async () => {
    const integrityError = new PageIndexLayeredTreeSearchContractError("tampered response", {
      failureKind: "integrity",
    });
    const evaluator = evaluatorWith({
      step: async () => {
        throw integrityError;
      },
    });

    await expect(
      evaluator.evaluate({
        evidenceRanges: [
          range("60000000-0000-4000-8000-000000000001", 110, 150),
          range("60000000-0000-4000-8000-000000000002", 210, 250),
        ],
        outline: fixtureOutline(),
        questions: [
          question(
            "70000000-0000-4000-8000-000000000001",
            "Invoice?",
            "60000000-0000-4000-8000-000000000001",
          ),
          question(
            "70000000-0000-4000-8000-000000000002",
            "Tax?",
            "60000000-0000-4000-8000-000000000002",
          ),
        ],
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      }),
    ).rejects.toBe(integrityError);
  });

  it("rejects invalid evaluator options", () => {
    const options = {
      evaluatorVersion: "findability-v1",
      layeredTreeSearch: layeredSearchForQuestion({}),
      maxQuestions: 2,
      maxTreeDepth: 2,
      minMeanReciprocalRank: 0.5,
      minPathRecallAtK: 0.5,
      minQuestions: 1,
      minRecallAtK: 0.5,
      topK: 1,
    };
    expect(() =>
      createPageIndexFindabilityEvaluator({ ...options, evaluatorVersion: "   " }),
    ).toThrow("evaluatorVersion is required");
    expect(() => createPageIndexFindabilityEvaluator({ ...options, minQuestions: 3 })).toThrow(
      "minQuestions must not exceed maxQuestions",
    );
    expect(() =>
      createPageIndexFindabilityEvaluator({ ...options, minRecallAtK: Number.NaN }),
    ).toThrow("minRecallAtK must be within [0, 1]");
    expect(() => createPageIndexFindabilityEvaluator({ ...options, minRecallAtK: -1 })).toThrow(
      "minRecallAtK must be within [0, 1]",
    );
    expect(() => createPageIndexFindabilityEvaluator({ ...options, topK: 0 })).toThrow(
      "topK must be a positive integer",
    );
    expect(() => createPageIndexFindabilityEvaluator({ ...options, topK: 0.5 })).toThrow(
      "topK must be a positive integer",
    );
  });

  it("ignores malformed, foreign, and uncovered evidence ranges", () => {
    const validId = "60000000-0000-4000-8000-000000000001";
    const mapping = mapExpectedEvidenceToOutlineNodes({
      evidenceRanges: [
        { ...range("foreign", 110, 150), documentAssetId: "foreign-document" },
        range("   ", 110, 150),
        range("fractional", 110.5, 150),
        range("negative", -1, 10),
        range("reversed", 150, 110),
        range("uncovered", 400, 500),
        range(validId, 110, 150),
      ],
      outline: fixtureOutline(),
    });

    expect([...mapping]).toEqual([[validId, "invoice"]]);
  });
});

function evaluatorWith(
  layeredTreeSearch: PageIndexLayeredTreeSearch,
  enqueue?: (input: {
    readonly documentAssetId: string;
    readonly reason: "low-findability";
  }) => Promise<void>,
) {
  return createPageIndexFindabilityEvaluator({
    evaluatorVersion: "findability-v1",
    layeredTreeSearch,
    maxQuestions: 10,
    maxTreeDepth: 8,
    minMeanReciprocalRank: 0.4,
    minPathRecallAtK: 0.8,
    minQuestions: 2,
    minRecallAtK: 0.5,
    ...(enqueue ? { summaryRepair: { enqueue } } : {}),
    topK: 2,
  });
}

function layeredSearchForQuestion(
  byQuestion: Readonly<
    Record<
      string,
      readonly {
        readonly nodeId: string;
        readonly reason: string;
        readonly score: number;
      }[]
    >
  >,
): PageIndexLayeredTreeSearch {
  return {
    step: async (input) => {
      const selections = byQuestion[input.query] ?? [];
      return {
        checkpoint: {
          ...input.checkpoint,
          completed: true,
          depth: input.checkpoint.depth + 1,
          frontier: [],
          modelCalls: input.checkpoint.modelCalls + 1,
          openSelections: selections,
          visitedNodeIds: input.checkpoint.frontier.map((entry) => entry.nodeId),
        } satisfies PageIndexLayeredTreeCheckpoint,
        estimatedPromptTokens: 100,
        flattenedNodeIds: [],
        visibleNodeIds: input.checkpoint.frontier.map((entry) => entry.nodeId),
      };
    },
  };
}

function reasoningModel() {
  return { model: "reasoner-v1", pluginId: "plugin-1", provider: "provider-1" };
}

function question(id: string, text: string, expectedEvidenceId: string) {
  return GoldenQuestionSchema.parse({
    createdAt: "2026-08-05T00:00:00.000Z",
    expectedEvidenceIds: [expectedEvidenceId],
    id,
    knowledgeSpaceId: SPACE_ID,
    metadata: { source: "human" },
    question: text,
    tags: ["manual"],
    updatedAt: "2026-08-05T00:00:00.000Z",
  });
}

function range(evidenceId: string, startOffset: number, endOffset: number) {
  return { documentAssetId: DOCUMENT_ID, endOffset, evidenceId, startOffset };
}

function fixtureOutline() {
  const leaf = (id: string, startOffset: number, endOffset: number) => ({
    childNodeIds: [],
    children: [],
    endOffset,
    id,
    level: 3,
    metadata: {},
    sectionPath: ["Finance", id],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset,
    summary: `${id} summary`,
    title: id,
    tocSource: "parser-heading",
  });
  const invoice = leaf("invoice", 100, 200);
  const tax = leaf("tax", 200, 300);
  const finance = {
    childNodeIds: ["invoice", "tax"],
    children: [invoice, tax],
    endOffset: 300,
    id: "finance",
    level: 2,
    metadata: {},
    sectionPath: ["Finance"],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: 0,
    summary: "Finance summary",
    title: "Finance",
    tocSource: "parser-heading",
  };
  return DocumentOutlineSchema.parse({
    artifactHash: "a".repeat(64),
    createdAt: "2026-08-05T00:00:00.000Z",
    documentAssetId: DOCUMENT_ID,
    id: "20000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    nodes: [
      {
        childNodeIds: ["finance"],
        children: [finance],
        endOffset: 300,
        id: "root",
        level: 1,
        metadata: {},
        sectionPath: ["Document"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: "Document summary",
        title: "Document",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "outline-v1",
    parseArtifactId: "40000000-0000-4000-8000-000000000001",
    publicationGenerationId: "50000000-0000-4000-8000-000000000001",
    version: 1,
  });
}
