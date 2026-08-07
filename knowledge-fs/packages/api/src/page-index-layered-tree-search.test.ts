import { DocumentOutlineSchema, type KnowledgeSpaceModelSelection } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  PageIndexLayeredTreeSearchContractError,
  createInitialPageIndexLayeredTreeCheckpoint,
  createPageIndexLayeredTreeSearch,
  parsePageIndexLayeredTreeCheckpoint,
} from "./page-index-layered-tree-search";
import type { PageIndexLayeredTreeSearchOptions } from "./page-index-layered-tree-search";
import type { GeneratePageIndexSemanticScoreInput } from "./page-index-semantic-tree-search";

describe("PageIndex layered tree search", () => {
  it("descends root to chapter to evidence leaf like reading a book", async () => {
    const visitedFrontiers: string[][] = [];
    const generate = vi.fn(async (input: GeneratePageIndexSemanticScoreInput) => {
      const payload = JSON.parse(input.messages[1]?.content ?? "{}") as {
        candidates: readonly { readonly nodeId: string }[];
      };
      const nodeIds = payload.candidates.map((candidate) => candidate.nodeId);
      visitedFrontiers.push(nodeIds);
      const selectedNodeId = nodeIds.includes("book")
        ? "book"
        : nodeIds.includes("chapter-b")
          ? "chapter-b"
          : "leaf-b2";
      return {
        model: "reasoner-v1",
        text: JSON.stringify({
          decisions: [
            {
              action: selectedNodeId === "leaf-b2" ? "open" : "expand",
              nodeId: selectedNodeId,
              reason: "best matching branch",
              score: 0.9,
            },
          ],
        }),
      };
    });
    const search = layeredSearch(generate);
    const outline = bookOutline();
    let checkpoint = createInitialPageIndexLayeredTreeCheckpoint({
      outline,
      query: "What is the cancellation period?",
    });

    while (!checkpoint.completed) {
      checkpoint = (
        await search.step({
          checkpoint,
          outline,
          query: "What is the cancellation period?",
          reasoningModel: reasoningModel(),
          tenantId: "tenant-1",
        })
      ).checkpoint;
    }

    expect(generate).toHaveBeenCalledTimes(3);
    expect(visitedFrontiers).toEqual([
      ["book"],
      ["chapter-a", "chapter-b"],
      ["leaf-b1", "leaf-b2"],
    ]);
    expect(checkpoint.openSelections).toEqual([
      expect.objectContaining({ nodeId: "leaf-b2", score: 0.9 }),
    ]);
    expect(checkpoint.visitedNodeIds).toEqual([
      "book",
      "chapter-a",
      "chapter-b",
      "leaf-b1",
      "leaf-b2",
    ]);
  });

  it("flattens a meaningless single-child parser level before prompting", async () => {
    const generate = vi.fn(async (input: GeneratePageIndexSemanticScoreInput) => {
      const payload = input.messages[1]?.content ?? "";
      expect(payload).not.toContain('"title":"买"');
      expect(payload).toContain('"nodeId":"invoice-details"');
      return {
        model: "reasoner-v1",
        text: JSON.stringify({
          decisions: [
            {
              action: "open",
              nodeId: "invoice-details",
              reason: "invoice evidence",
              score: 0.88,
            },
          ],
        }),
      };
    });
    const outline = outlineWithMeaninglessWrapper();
    const initial = createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "invoice" });

    const result = await layeredSearch(generate).step({
      checkpoint: initial,
      outline,
      query: "invoice",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });

    expect(result.checkpoint.completed).toBe(true);
    expect(result.checkpoint.openSelections).toEqual([
      expect.objectContaining({ nodeId: "invoice-details" }),
    ]);
    expect(result.flattenedNodeIds).toEqual(["noise-wrapper"]);
  });

  it("resumes from a serialized frontier without repeating completed levels", async () => {
    const firstGenerate = vi.fn(async () => ({
      model: "reasoner-v1",
      text: JSON.stringify({
        decisions: [{ action: "expand", nodeId: "book", reason: "open the book", score: 0.95 }],
      }),
    }));
    const outline = bookOutline();
    const first = await layeredSearch(firstGenerate).step({
      checkpoint: createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "cancellation" }),
      outline,
      query: "cancellation",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });
    const persisted = JSON.parse(JSON.stringify(first.checkpoint));
    const resumeGenerate = vi.fn(async (input: GeneratePageIndexSemanticScoreInput) => {
      expect(input.messages[1]?.content).not.toContain('"nodeId":"book"');
      expect(input.messages[1]?.content).toContain('"nodeId":"chapter-b"');
      return {
        model: "reasoner-v1",
        text: JSON.stringify({ decisions: [] }),
      };
    });

    const resumed = await layeredSearch(resumeGenerate).step({
      checkpoint: persisted,
      outline,
      query: "cancellation",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });

    expect(firstGenerate).toHaveBeenCalledOnce();
    expect(resumeGenerate).toHaveBeenCalledOnce();
    expect(resumed.checkpoint.completed).toBe(true);
    expect(resumed.checkpoint.modelCalls).toBe(2);
  });

  it("rejects unknown nodes recoverably and model identity drift as integrity failure", async () => {
    const outline = bookOutline();
    const checkpoint = createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "query" });
    const invalidNode = layeredSearch(async () => ({
      model: "reasoner-v1",
      text: JSON.stringify({
        decisions: [{ action: "open", nodeId: "unknown", reason: "bad", score: 1 }],
      }),
    })).step({
      checkpoint,
      outline,
      query: "query",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });
    await expect(invalidNode).rejects.toMatchObject({
      failureKind: "recoverable",
      name: "PageIndexLayeredTreeSearchContractError",
    });

    const drift = layeredSearch(async () => ({
      model: "other-model",
      text: JSON.stringify({ decisions: [] }),
    })).step({
      checkpoint,
      outline,
      query: "query",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });
    await expect(drift).rejects.toBeInstanceOf(PageIndexLayeredTreeSearchContractError);
    await expect(drift).rejects.toMatchObject({ failureKind: "integrity" });
  });

  it("validates construction, initial input, and serialized checkpoint scope", async () => {
    const generate = async () => ({ text: '{"decisions":[]}' });
    for (const option of [
      "maxFrontierNodes",
      "maxOutputTokens",
      "maxPromptTokens",
      "maxResponseChars",
      "maxSelectedNodesPerStep",
      "maxSummaryChars",
      "maxTitleChars",
      "maxTreeNodes",
      "timeoutMs",
    ] as const) {
      expect(() => layeredSearch(generate, { [option]: 0 })).toThrow("must be a positive integer");
    }
    expect(() =>
      createInitialPageIndexLayeredTreeCheckpoint({ outline: bookOutline(), query: " " }),
    ).toThrow("query is required");
    expect(() => parsePageIndexLayeredTreeCheckpoint({})).toThrow("checkpoint is invalid");

    const outline = bookOutline();
    const checkpoint = createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "query" });
    await expect(
      layeredSearch(generate).step({
        checkpoint,
        outline,
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: " ",
      }),
    ).rejects.toThrow("tenantId is required");
    await expect(
      layeredSearch(generate).step({
        checkpoint: { ...checkpoint, outlineId: "other-outline" },
        outline,
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ failureKind: "integrity" });
    await expect(
      layeredSearch(generate).step({
        checkpoint,
        outline,
        query: "other-query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("checkpoint query mismatch");
  });

  it("returns completed checkpoints without invoking a provider", async () => {
    const outline = DocumentOutlineSchema.parse({ ...bookOutline(), nodes: [] });
    const checkpoint = createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "query" });
    const generate = vi.fn();

    const result = await layeredSearch(generate).step({
      checkpoint,
      outline,
      query: "query",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });

    expect(result).toMatchObject({
      checkpoint: { completed: true },
      estimatedPromptTokens: 0,
      flattenedNodeIds: [],
      visibleNodeIds: [],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("bounds and value-ranks each sibling frontier before prompting", async () => {
    const outline = bookOutline();
    const first = await layeredSearch(async () => ({
      model: "reasoner-v1",
      text: '{"decisions":[{"action":"expand","nodeId":"book","reason":"book","score":1}]}',
    })).step({
      checkpoint: createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "cancellation" }),
      outline,
      query: "cancellation",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    });
    const generate = vi.fn(async (input: GeneratePageIndexSemanticScoreInput) => {
      expect(input.messages[1]?.content).toContain('"nodeId":"chapter-b"');
      expect(input.messages[1]?.content).not.toContain('"nodeId":"chapter-a"');
      return { metadata: { model: "reasoner-v1" }, text: '{"decisions":[]}' };
    });
    const result = await layeredSearch(generate, { maxFrontierNodes: 1 }).step({
      checkpoint: first.checkpoint,
      outline,
      query: "cancellation",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
      valuesByNodeId: new Map([
        ["chapter-a", { breadthValue: 0.1, peakValue: 0.1 }],
        ["chapter-b", { breadthValue: 0.8, peakValue: 0.9 }],
      ]),
    });

    expect(result.checkpoint.frontierTruncated).toBe(true);
    expect(result.providerMetadata).toEqual({ model: "reasoner-v1" });
    expect(result).not.toHaveProperty("responseModel");
  });

  it("enforces prompt, tree, response, value, and model metadata contracts", async () => {
    const outline = bookOutline();
    const checkpoint = createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "query" });
    const step = (
      generate: Parameters<typeof layeredSearch>[0],
      options: Partial<PageIndexLayeredTreeSearchOptions> = {},
    ) =>
      layeredSearch(generate, options).step({
        checkpoint,
        outline,
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      });

    await expect(
      step(async () => ({ text: '{"decisions":[]}' }), { maxPromptTokens: 1 }),
    ).rejects.toThrow("exceeded maxPromptTokens=1");
    await expect(
      step(async () => ({ text: '{"decisions":[]}' }), { maxTreeNodes: 1 }),
    ).rejects.toThrow("exceeded maxTreeNodes=1");
    await expect(
      step(async () => ({ text: "x".repeat(101) }), { maxResponseChars: 100 }),
    ).rejects.toThrow("response exceeded");
    await expect(
      step(async () => ({ text: '{"decisions":[]}', metadata: { model: "other" } })),
    ).rejects.toMatchObject({ failureKind: "integrity" });
    await expect(
      layeredSearch(async () => ({ text: '{"decisions":[]}' })).step({
        checkpoint,
        outline,
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
        valuesByNodeId: new Map([["book", { breadthValue: 0, peakValue: 2 }]]),
      }),
    ).rejects.toMatchObject({ failureKind: "integrity" });
  });

  it("rejects malformed decision payloads and accepts fenced JSON", async () => {
    const outline = bookOutline();
    const checkpoint = createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "query" });
    const step = (text: string) =>
      layeredSearch(async () => ({ model: "reasoner-v1", text })).step({
        checkpoint,
        outline,
        query: "query",
        reasoningModel: reasoningModel(),
        tenantId: "tenant-1",
      });

    for (const [text, message] of [
      ["", "empty response"],
      ["not-json", "non-JSON output"],
      ["```json\n{bad}\n```", "invalid JSON"],
      ['{"decisions":"invalid"}', "invalid decision payload"],
      [
        '{"decisions":[{"action":"open","nodeId":"book","reason":"a","score":1},{"action":"open","nodeId":"book","reason":"b","score":0.5}]}',
        "duplicate nodeId=book",
      ],
    ] as const) {
      await expect(step(text)).rejects.toThrow(message);
    }
    await expect(step('```json\n{"decisions":[]}\n```')).resolves.toMatchObject({
      checkpoint: { completed: true },
    });
  });

  it("wraps provider failures, preserves contract failures, and times out bounded calls", async () => {
    const outline = bookOutline();
    const checkpoint = createInitialPageIndexLayeredTreeCheckpoint({ outline, query: "query" });
    const input = {
      checkpoint,
      outline,
      query: "query",
      reasoningModel: reasoningModel(),
      tenantId: "tenant-1",
    };

    await expect(
      layeredSearch(async () => Promise.reject(new Error("provider"))).step(input),
    ).rejects.toThrow("search step failed");
    const contractError = new PageIndexLayeredTreeSearchContractError("provider contract");
    await expect(layeredSearch(async () => Promise.reject(contractError)).step(input)).rejects.toBe(
      contractError,
    );
    await expect(
      layeredSearch(async () => new Promise(() => undefined), { timeoutMs: 1 }).step(input),
    ).rejects.toThrow("step timed out");
  });
});

function layeredSearch(
  generate: (input: GeneratePageIndexSemanticScoreInput) => Promise<{
    readonly metadata?: unknown;
    readonly model?: string;
    readonly text: string;
  }>,
  overrides: Partial<PageIndexLayeredTreeSearchOptions> = {},
) {
  return createPageIndexLayeredTreeSearch({
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
    ...overrides,
  });
}

function reasoningModel(): KnowledgeSpaceModelSelection {
  return { model: "reasoner-v1", pluginId: "plugin-1", provider: "provider-1" };
}

function bookOutline() {
  const leaf = (id: string, title: string, startOffset: number, endOffset: number) => ({
    childNodeIds: [],
    children: [],
    endOffset,
    id,
    level: 3,
    metadata: {},
    sectionPath: ["Book", id.startsWith("leaf-a") ? "General" : "Cancellation", title],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset,
    summary: `${title} evidence`,
    title,
    tocSource: "parser-heading" as const,
  });
  const chapter = (id: string, title: string, children: readonly ReturnType<typeof leaf>[]) => ({
    childNodeIds: children.map((child) => child.id),
    children,
    endOffset: children.at(-1)?.endOffset,
    id,
    level: 2,
    metadata: {},
    sectionPath: ["Book", title],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: children[0]?.startOffset,
    summary: `${title} chapter summary`,
    title,
    tocSource: "parser-heading" as const,
  });
  const chapterA = chapter("chapter-a", "General", [leaf("leaf-a1", "Scope", 0, 100)]);
  const chapterB = chapter("chapter-b", "Cancellation", [
    leaf("leaf-b1", "Fees", 100, 200),
    leaf("leaf-b2", "Cancellation period", 200, 300),
  ]);
  return DocumentOutlineSchema.parse({
    artifactHash: "a".repeat(64),
    createdAt: "2026-08-06T00:00:00.000Z",
    documentAssetId: "10000000-0000-4000-8000-000000000001",
    id: "20000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "30000000-0000-4000-8000-000000000001",
    metadata: {},
    nodes: [
      {
        childNodeIds: [chapterA.id, chapterB.id],
        children: [chapterA, chapterB],
        endOffset: 300,
        id: "book",
        level: 1,
        metadata: {},
        sectionPath: ["Book"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: "Contract handbook",
        title: "Book",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "outline-v1",
    parseArtifactId: "40000000-0000-4000-8000-000000000001",
    publicationGenerationId: "50000000-0000-4000-8000-000000000001",
    version: 1,
  });
}

function outlineWithMeaninglessWrapper() {
  return DocumentOutlineSchema.parse({
    ...bookOutline(),
    nodes: [
      {
        childNodeIds: ["invoice-details"],
        children: [
          {
            childNodeIds: [],
            children: [],
            endOffset: 100,
            id: "invoice-details",
            level: 2,
            metadata: {},
            sectionPath: ["Invoice details"],
            sourceElementIds: [],
            sourceNodeIds: [],
            startOffset: 0,
            summary: "Invoice number, seller and buyer details",
            title: "Invoice details",
            tocSource: "parser-heading",
          },
        ],
        endOffset: 100,
        id: "noise-wrapper",
        level: 1,
        metadata: {},
        sectionPath: ["买"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        title: "买",
        tocSource: "fallback",
      },
    ],
  });
}
