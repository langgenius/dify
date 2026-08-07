import { DocumentOutlineSchema, type KnowledgeSpaceModelSelection } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { GeneratePageIndexSemanticScoreInput } from "./page-index-semantic-tree-search";
import {
  PageIndexWholeTreeSelectionContractError,
  createPageIndexWholeTreeSelector,
  estimatePageIndexPromptTokens,
} from "./page-index-whole-tree-selection";
import type { PageIndexWholeTreeSelectorOptions } from "./page-index-whole-tree-selection";

describe("PageIndex whole-tree selection", () => {
  it("selects from a depth-four compact tree with one model call and no body text", async () => {
    const generate = vi.fn(async (input: GeneratePageIndexSemanticScoreInput) => {
      const payload = input.messages.map((message) => message.content).join("\n");
      expect(payload).toContain('"id":"node-4"');
      expect(payload).toContain('"summary":"level 4 summary"');
      expect(payload).not.toContain("SECRET BODY TEXT");
      return {
        model: "reasoner-v1",
        text: JSON.stringify({
          selectedNodes: [
            {
              nodeId: "node-4",
              reason: "direct evidence section",
              score: 0.95,
            },
          ],
        }),
      };
    });
    const selector = createPageIndexWholeTreeSelector({
      maxOutputTokens: 512,
      maxPromptTokens: 8_000,
      maxResponseChars: 8_000,
      maxSelectedNodes: 3,
      maxSummaryChars: 500,
      maxTitleChars: 200,
      maxTreeNodes: 100,
      minimumSummaryCoverage: 0.5,
      providerFactory: () => ({ generate }),
      timeoutMs: 5_000,
    });

    const result = await selector.select({
      outline: outlineWithDepth(4),
      query: "Where is the answer?",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
      valuesByNodeId: new Map([["node-4", { breadthValue: 0.6, peakValue: 0.9 }]]),
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      nodeCount: 4,
      selections: [{ nodeId: "node-4", score: 0.95 }],
      strategy: "whole-tree",
    });
    expect(result.estimatedPromptTokens).toBeGreaterThan(0);
  });

  it("returns explicit fallbacks without calling the model for oversized or low-quality trees", async () => {
    const generate = vi.fn();
    const base = {
      maxOutputTokens: 128,
      maxResponseChars: 2_000,
      maxSelectedNodes: 2,
      maxSummaryChars: 2_000,
      maxTitleChars: 200,
      providerFactory: () => ({ generate }),
      timeoutMs: 1_000,
    } as const;
    const tooLarge = createPageIndexWholeTreeSelector({
      ...base,
      maxPromptTokens: 100,
      maxTreeNodes: 100,
      minimumSummaryCoverage: 0,
    });
    const lowQuality = createPageIndexWholeTreeSelector({
      ...base,
      maxPromptTokens: 10_000,
      maxTreeNodes: 100,
      minimumSummaryCoverage: 1,
    });

    await expect(
      tooLarge.select({
        outline: outlineWithDepth(4, { summarySuffix: "x".repeat(1_000) }),
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      fallbackReason: "tree-token-budget-exceeded",
      strategy: "fallback",
    });
    await expect(
      lowQuality.select({
        outline: outlineWithDepth(2, { omitSummaryAt: 2 }),
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      fallbackReason: "tree-quality-insufficient",
      strategy: "fallback",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("fails closed on malformed selected-node contracts and model identity drift", async () => {
    const selector = (text: string, model = "reasoner-v1") =>
      createPageIndexWholeTreeSelector({
        maxOutputTokens: 128,
        maxPromptTokens: 10_000,
        maxResponseChars: 2_000,
        maxSelectedNodes: 2,
        maxSummaryChars: 500,
        maxTitleChars: 200,
        maxTreeNodes: 100,
        minimumSummaryCoverage: 0,
        providerFactory: () => ({ generate: async () => ({ model, text }) }),
        timeoutMs: 1_000,
      });
    const input = {
      outline: outlineWithDepth(2),
      query: "query",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    } as const;

    const malformed = selector(
      JSON.stringify({
        selectedNodes: [{ nodeId: "unknown", reason: "invalid", score: 1 }],
      }),
    ).select(input);
    await expect(malformed).rejects.toMatchObject({
      failureKind: "recoverable",
      name: "PageIndexWholeTreeSelectionContractError",
    });
    const identityDrift = selector(JSON.stringify({ selectedNodes: [] }), "other-model").select(
      input,
    );
    await expect(identityDrift).rejects.toMatchObject({
      failureKind: "integrity",
    });
    await expect(identityDrift).rejects.toThrow("did not match the selected reasoning model");
  });

  it("uses a conservative estimator for both ASCII and CJK prompt content", () => {
    expect(estimatePageIndexPromptTokens("a".repeat(100))).toBeGreaterThanOrEqual(50);
    expect(estimatePageIndexPromptTokens("发票".repeat(50))).toBeGreaterThanOrEqual(100);
  });

  it("validates selector settings and required request scope", async () => {
    const generate = async () => ({ text: '{"selectedNodes":[]}' });
    for (const option of [
      "maxOutputTokens",
      "maxPromptTokens",
      "maxResponseChars",
      "maxSelectedNodes",
      "maxSummaryChars",
      "maxTitleChars",
      "maxTreeNodes",
      "timeoutMs",
    ] as const) {
      expect(() => wholeTreeSelector(generate, { [option]: 0 })).toThrow(
        "must be a positive integer",
      );
    }
    for (const minimumSummaryCoverage of [-1, Number.POSITIVE_INFINITY, 2]) {
      expect(() => wholeTreeSelector(generate, { minimumSummaryCoverage })).toThrow(
        "must be within [0, 1]",
      );
    }
    const input = {
      outline: outlineWithDepth(1),
      query: "query",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    };
    await expect(wholeTreeSelector(generate).select({ ...input, query: " " })).rejects.toThrow(
      "query is required",
    );
    await expect(wholeTreeSelector(generate).select({ ...input, tenantId: " " })).rejects.toThrow(
      "tenantId is required",
    );
  });

  it("falls back for empty and node-limited trees and rejects duplicate node ids", async () => {
    const generate = vi.fn(async () => ({ text: '{"selectedNodes":[]}' }));
    await expect(
      wholeTreeSelector(generate).select({
        outline: DocumentOutlineSchema.parse({ ...outlineWithDepth(1), nodes: [] }),
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      fallbackReason: "tree-quality-insufficient",
      nodeCount: 0,
      summaryCoverage: 0,
    });
    await expect(
      wholeTreeSelector(generate, { maxTreeNodes: 1 }).select({
        outline: outlineWithDepth(4),
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ fallbackReason: "tree-node-limit-exceeded" });

    const duplicate = DocumentOutlineSchema.parse({
      ...outlineWithDepth(2),
      nodes: [
        {
          ...outlineWithDepth(2).nodes[0],
          childNodeIds: ["node-1"],
          children: [{ ...outlineWithDepth(2).nodes[0]?.children[0], id: "node-1" }],
        },
      ],
    });
    await expect(
      wholeTreeSelector(generate).select({
        outline: duplicate,
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ failureKind: "integrity" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("validates values, metadata identity, response size, and strict JSON output", async () => {
    const input = {
      outline: outlineWithDepth(2),
      query: "query",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    };
    await expect(
      wholeTreeSelector(async () => ({ text: '{"selectedNodes":[]}' })).select({
        ...input,
        valuesByNodeId: new Map([["node-1", { breadthValue: -1, peakValue: 0 }]]),
      }),
    ).rejects.toMatchObject({ failureKind: "integrity" });
    await expect(
      wholeTreeSelector(async () => ({
        metadata: { model: "other" },
        text: '{"selectedNodes":[]}',
      })).select(input),
    ).rejects.toMatchObject({ failureKind: "integrity" });
    await expect(
      wholeTreeSelector(async () => ({ text: "x".repeat(101) }), {
        maxResponseChars: 100,
      }).select(input),
    ).rejects.toThrow("response exceeded");

    for (const [text, message] of [
      ["not-json", "non-JSON output"],
      ["```json\n{bad}\n```", "invalid JSON"],
      ['{"selectedNodes":"bad"}', "invalid selection payload"],
      [
        '{"selectedNodes":[{"nodeId":"node-1","reason":"a","score":1},{"nodeId":"node-1","reason":"b","score":0.5}]}',
        "duplicate nodeId=node-1",
      ],
    ] as const) {
      await expect(wholeTreeSelector(async () => ({ text })).select(input)).rejects.toThrow(
        message,
      );
    }
    await expect(
      wholeTreeSelector(async () => ({ text: '```json\n{"selectedNodes":[]}\n```' })).select(input),
    ).resolves.toMatchObject({ strategy: "whole-tree" });
  });

  it("wraps provider failures, preserves contract errors, and times out", async () => {
    const input = {
      outline: outlineWithDepth(1),
      query: "query",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    };
    await expect(
      wholeTreeSelector(async () => Promise.reject(new Error("provider"))).select(input),
    ).rejects.toThrow("selection failed");
    const contract = new PageIndexWholeTreeSelectionContractError("provider contract");
    await expect(
      wholeTreeSelector(async () => Promise.reject(contract)).select(input),
    ).rejects.toBe(contract);
    await expect(
      wholeTreeSelector(async () => new Promise(() => undefined), { timeoutMs: 1 }).select(input),
    ).rejects.toThrow("selection timed out");
  });
});

function wholeTreeSelector(
  generate: (input: GeneratePageIndexSemanticScoreInput) => Promise<{
    readonly metadata?: unknown;
    readonly model?: string;
    readonly text: string;
  }>,
  overrides: Partial<PageIndexWholeTreeSelectorOptions> = {},
) {
  return createPageIndexWholeTreeSelector({
    maxOutputTokens: 128,
    maxPromptTokens: 10_000,
    maxResponseChars: 2_000,
    maxSelectedNodes: 2,
    maxSummaryChars: 500,
    maxTitleChars: 200,
    maxTreeNodes: 100,
    minimumSummaryCoverage: 0,
    providerFactory: () => ({ generate }),
    timeoutMs: 1_000,
    ...overrides,
  });
}

function reasoningModel(): KnowledgeSpaceModelSelection {
  return {
    model: "reasoner-v1",
    pluginId: "plugin-1",
    provider: "provider-1",
  };
}

function outlineWithDepth(
  depth: number,
  options: {
    readonly omitSummaryAt?: number;
    readonly summarySuffix?: string;
  } = {},
) {
  const node = (level: number): Record<string, unknown> => ({
    childNodeIds: level < depth ? [`node-${level + 1}`] : [],
    children: level < depth ? [node(level + 1)] : [],
    endOffset: level * 100,
    id: `node-${level}`,
    level,
    metadata: { parserBody: "SECRET BODY TEXT" },
    sectionPath: Array.from({ length: level }, (_, index) => `Level ${index + 1}`),
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: (level - 1) * 100,
    ...(options.omitSummaryAt === level
      ? {}
      : { summary: `level ${level} summary${options.summarySuffix ?? ""}` }),
    title: `Level ${level}`,
    tocSource: "llm-inferred",
  });

  return DocumentOutlineSchema.parse({
    artifactHash: "a".repeat(64),
    createdAt: "2026-08-05T00:00:00.000Z",
    documentAssetId: "10000000-0000-4000-8000-000000000001",
    id: "20000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "30000000-0000-4000-8000-000000000001",
    metadata: {},
    nodes: [node(1)],
    outlineVersion: "outline-v1",
    parseArtifactId: "40000000-0000-4000-8000-000000000001",
    publicationGenerationId: "50000000-0000-4000-8000-000000000001",
    version: 1,
  });
}
