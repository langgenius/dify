import type { DocumentOutline, DocumentOutlineNode, ParseArtifact } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createDocumentOutlineBuilder } from "./document-outline-builder";
import { createInMemoryDocumentOutlineSummaryCheckpointRepository } from "./document-outline-summary-checkpoint-repository";
import {
  type DocumentOutlineSummaryProvider,
  createDocumentOutlineSummaryEnhancer,
} from "./document-outline-summary-enhancer";

const createdAt = "2026-06-22T00:00:00.000Z";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("document outline summary enhancer", () => {
  it("replaces deterministic summaries with provider summaries and prompt metadata", async () => {
    const calls: Parameters<DocumentOutlineSummaryProvider["summarize"]>[0][] = [];
    const provider: DocumentOutlineSummaryProvider = {
      summarize: async (input) => {
        calls.push(input);

        return {
          metadata: { requestId: `summary-${calls.length}` },
          summary: `provider:${input.sectionPath.join("/")}:${input.text.slice(0, 24)}`,
        };
      },
    };
    const artifact = parseArtifact();
    const outline = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      ]),
      maxElements: 10,
      maxNodes: 10,
      maxSummaryChars: 120,
      now: () => createdAt,
    }).build({ knowledgeSpaceId, parseArtifact: artifact });
    const enhancer = createDocumentOutlineSummaryEnhancer({
      maxInputChars: 80,
      maxSummaryChars: 60,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      provider,
    });

    const enhanced = await enhancer.enhance({
      outline,
      parseArtifact: artifact,
      traceId: "trace-outline-summary-1",
    });

    expect(calls.map((call) => call.sectionPath)).toEqual([["Guide", "Refunds"], ["Guide"]]);
    expect(calls[0]).toMatchObject({
      childSummaries: [],
      maxSummaryChars: 60,
      outlineNodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      promptVersion: "document-outline-summary-v1",
      text: "Refunds\n\nRefund approvals require manager review.",
      traceId: "trace-outline-summary-1",
    });
    expect(calls[1]?.childSummaries[0]).toContain("provider:Guide/Refunds");
    expect(enhanced.metadata.summary).toEqual({
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      source: "provider",
    });
    expect(enhanced.nodes[0]?.summary).toContain("provider:Guide:Guide");
    expect(enhanced.nodes[0]?.metadata.summary).toMatchObject({
      metadata: { requestId: "summary-2" },
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      source: "provider",
    });
    expect(enhanced.nodes[0]?.children[0]?.summary).toContain("provider:Guide/Refunds");
  });

  it("validates summary provider bounds", () => {
    const provider: DocumentOutlineSummaryProvider = {
      summarize: async () => ({ summary: "unused" }),
    };

    expect(() =>
      createDocumentOutlineSummaryEnhancer({
        maxConcurrentSummaries: 0,
        maxInputChars: 10,
        maxSummaryChars: 10,
        model: "model",
        promptVersion: "prompt",
        provider,
      }),
    ).toThrow("Document outline summary maxConcurrentSummaries must be at least 1");
    expect(() =>
      createDocumentOutlineSummaryEnhancer({
        maxInputChars: 0,
        maxSummaryChars: 10,
        model: "model",
        promptVersion: "prompt",
        provider,
      }),
    ).toThrow("Document outline summary maxInputChars must be at least 1");
    expect(() =>
      createDocumentOutlineSummaryEnhancer({
        maxInputChars: 10,
        maxSummaryChars: 0,
        model: "model",
        promptVersion: "prompt",
        provider,
      }),
    ).toThrow("Document outline summary maxSummaryChars must be at least 1");
  });

  it("materializes only the admitted prefix of a large section", async () => {
    const synthetic = largeOutline(1);
    const calls: Parameters<DocumentOutlineSummaryProvider["summarize"]>[0][] = [];
    const artifact: ParseArtifact = {
      ...synthetic.artifact,
      elements: [
        {
          ...(synthetic.artifact.elements[0] as ParseArtifact["elements"][number]),
          text: "长文本".repeat(500_000),
        },
      ],
    };
    const enhancer = createDocumentOutlineSummaryEnhancer({
      maxInputChars: 80,
      maxSummaryChars: 40,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      provider: {
        summarize: async (input) => {
          calls.push(input);
          return { summary: "bounded" };
        },
      },
    });

    await enhancer.enhance({ outline: synthetic.outline, parseArtifact: artifact });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toHaveLength(80);
    expect(calls[0]?.text.endsWith("...")).toBe(true);
  });

  it("bounds provider concurrency across independent outline branches", async () => {
    let active = 0;
    let maxActive = 0;
    const artifact = parseArtifactWithSiblingSection();
    const outline = createDocumentOutlineBuilder({
      generateId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      ]),
      maxElements: 10,
      maxNodes: 10,
      maxSummaryChars: 120,
      now: () => createdAt,
    }).build({ knowledgeSpaceId, parseArtifact: artifact });
    const enhancer = createDocumentOutlineSummaryEnhancer({
      maxConcurrentSummaries: 2,
      maxInputChars: 80,
      maxSummaryChars: 60,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      provider: {
        summarize: async (input) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { summary: `provider:${input.sectionPath.join("/")}` };
        },
      },
    });

    await enhancer.enhance({ outline, parseArtifact: artifact });

    expect(maxActive).toBe(2);
  });

  it("batches a large outline by depth and preserves child summaries", async () => {
    const summarize = vi.fn(async () => ({ summary: "single fallback" }));
    const summarizeBatch = vi.fn(
      async (inputs: readonly Parameters<DocumentOutlineSummaryProvider["summarize"]>[0][]) =>
        inputs.map((input) => ({
          summary: `batch:${input.outlineNodeId}:children=${input.childSummaries.length}`,
        })),
    );
    const synthetic = largeOutline(68);
    const metrics = { record: vi.fn() };
    const enhancer = createDocumentOutlineSummaryEnhancer({
      maxBatchInputChars: 1_000_000,
      maxBatchSize: 8,
      maxConcurrentSummaries: 8,
      maxInputChars: 80,
      maxSummaryChars: 120,
      metrics,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v2",
      provider: { summarize, summarizeBatch },
    });

    const enhanced = await enhancer.enhance({
      outline: synthetic.outline,
      parseArtifact: synthetic.artifact,
    });

    expect(summarize).not.toHaveBeenCalled();
    expect(summarizeBatch).toHaveBeenCalledTimes(9);
    expect(summarizeBatch.mock.calls.every(([inputs]) => inputs.length <= 8)).toBe(true);
    expect(enhanced.nodes).toHaveLength(68);
    expect(enhanced.nodes[0]?.summary).toContain("batch:node-0");
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointHits: 0,
        nodeCount: 68,
        outcome: "succeeded",
        providerCalls: 9,
      }),
    );
  });

  it("reuses semantic leaf summaries and sends only low-quality leaves to the outline model", async () => {
    const synthetic = largeOutline(8);
    const semanticNodes = synthetic.outline.nodes.map((node, index) =>
      index < 6
        ? {
            ...node,
            metadata: { ...node.metadata, summarySource: "semantic-chunking" },
            summary: `semantic:${node.id}`,
          }
        : node,
    );
    const optimizedBatch = vi.fn(
      async (inputs: readonly Parameters<DocumentOutlineSummaryProvider["summarize"]>[0][]) =>
        inputs.map((input) => ({ summary: `model:${input.outlineNodeId}` })),
    );
    const baselineBatch = vi.fn(
      async (inputs: readonly Parameters<DocumentOutlineSummaryProvider["summarize"]>[0][]) =>
        inputs.map((input) => ({ summary: `model:${input.outlineNodeId}` })),
    );
    const create = (summarizeBatch: typeof optimizedBatch) =>
      createDocumentOutlineSummaryEnhancer({
        maxBatchSize: 2,
        maxConcurrentSummaries: 2,
        maxInputChars: 80,
        maxSummaryChars: 120,
        model: "outline-summary-model",
        promptVersion: "document-outline-summary-v2",
        provider: { summarize: async () => ({ summary: "fallback" }), summarizeBatch },
      });

    await create(baselineBatch).enhance({
      outline: synthetic.outline,
      parseArtifact: synthetic.artifact,
    });
    const optimized = await create(optimizedBatch).enhance({
      outline: { ...synthetic.outline, nodes: semanticNodes },
      parseArtifact: synthetic.artifact,
    });

    expect(baselineBatch).toHaveBeenCalledTimes(4);
    expect(optimizedBatch).toHaveBeenCalledTimes(1);
    expect(optimizedBatch.mock.calls[0]?.[0].map((input) => input.outlineNodeId)).toEqual([
      "node-6",
      "node-7",
    ]);
    expect(optimized.nodes.slice(0, 6).map((node) => node.summary)).toEqual(
      semanticNodes.slice(0, 6).map((node) => node.summary),
    );
  });

  it("keeps the measured 68-node HTML outline within ten default-size requests", async () => {
    const summarizeBatch = vi.fn(
      async (inputs: readonly Parameters<DocumentOutlineSummaryProvider["summarize"]>[0][]) =>
        inputs.map((input) => ({ summary: `summary:${input.outlineNodeId}` })),
    );
    const synthetic = measuredHtmlOutlineShape();
    const enhancer = createDocumentOutlineSummaryEnhancer({
      maxBatchInputChars: 32_000,
      maxBatchSize: 8,
      maxConcurrentSummaries: 8,
      maxInputChars: 80,
      maxSummaryChars: 120,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v2",
      provider: { summarize: async () => ({ summary: "fallback" }), summarizeBatch },
    });

    const enhanced = await enhancer.enhance({
      outline: synthetic.outline,
      parseArtifact: synthetic.artifact,
    });

    expect(summarizeBatch).toHaveBeenCalledTimes(10);
    expect(countNodes(enhanced.nodes)).toBe(68);
    expect(enhanced.nodes[0]?.children[0]?.summary).toContain("summary:node-1");
  });

  it("falls back to bounded single-node requests when a batch violates its contract", async () => {
    const summarize = vi.fn(async (input) => ({ summary: `single:${input.outlineNodeId}` }));
    const summarizeBatch = vi.fn(async () => []);
    const synthetic = largeOutline(3);
    const enhancer = createDocumentOutlineSummaryEnhancer({
      maxBatchSize: 8,
      maxConcurrentSummaries: 2,
      maxInputChars: 80,
      maxSummaryChars: 120,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v2",
      provider: { summarize, summarizeBatch },
    });

    const enhanced = await enhancer.enhance({
      outline: synthetic.outline,
      parseArtifact: synthetic.artifact,
    });

    expect(summarizeBatch).toHaveBeenCalledOnce();
    expect(summarize).toHaveBeenCalledTimes(3);
    expect(enhanced.nodes.map((node) => node.summary)).toEqual([
      "single:node-0",
      "single:node-1",
      "single:node-2",
    ]);
  });

  it("resumes only unfinished summary batches after a generation-scoped timeout", async () => {
    const checkpoints = createInMemoryDocumentOutlineSummaryCheckpointRepository();
    let shouldFail = true;
    const requestedNodeIds: string[][] = [];
    const summarizeBatch = vi.fn(
      async (inputs: readonly Parameters<DocumentOutlineSummaryProvider["summarize"]>[0][]) => {
        requestedNodeIds.push(inputs.map((input) => input.outlineNodeId));
        if (shouldFail && requestedNodeIds.length === 2) {
          shouldFail = false;
          throw new Error("Dify model runtime request timed out");
        }
        return inputs.map((input) => ({ summary: `summary:${input.outlineNodeId}` }));
      },
    );
    const synthetic = largeOutline(17, "00000000-0000-4000-8000-000000000099");
    const metrics = { record: vi.fn() };
    const enhancer = createDocumentOutlineSummaryEnhancer({
      checkpoints,
      maxBatchSize: 8,
      maxConcurrentSummaries: 1,
      maxInputChars: 80,
      maxSummaryChars: 120,
      metrics,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v2",
      provider: {
        summarize: async (input) => ({ summary: `fallback:${input.outlineNodeId}` }),
        summarizeBatch,
      },
    });

    await expect(
      enhancer.enhance({
        outline: synthetic.outline,
        parseArtifact: synthetic.artifact,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("timed out");
    const resumed = await enhancer.enhance({
      outline: synthetic.outline,
      parseArtifact: synthetic.artifact,
      tenantId: "tenant-1",
    });

    expect(resumed.nodes).toHaveLength(17);
    expect(summarizeBatch).toHaveBeenCalledTimes(4);
    expect(requestedNodeIds.filter((ids) => ids.includes("node-0"))).toHaveLength(1);
    expect(metrics.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        failureKind: "timeout",
        outcome: "failed",
        providerCalls: 2,
      }),
    );
    expect(metrics.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        checkpointHits: 8,
        outcome: "succeeded",
        providerCalls: 2,
      }),
    );
  });
});

function parseArtifact(): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt,
    documentAssetId,
    elements: [
      {
        id: "element-1",
        metadata: {},
        sectionPath: ["Guide"],
        text: "Guide",
        type: "heading",
      },
      {
        id: "element-2",
        metadata: {},
        sectionPath: ["Guide", "Refunds"],
        text: "Refunds",
        type: "heading",
      },
      {
        id: "element-3",
        metadata: {},
        sectionPath: ["Guide", "Refunds"],
        text: "Refund approvals require manager review.",
        type: "paragraph",
      },
    ],
    id: parseArtifactId,
    metadata: { parserVersion: "native-markdown@1" },
    parser: "native-markdown",
    version: 1,
  };
}

function parseArtifactWithSiblingSection(): ParseArtifact {
  const artifact = parseArtifact();
  return {
    ...artifact,
    elements: [
      ...artifact.elements,
      {
        id: "element-4",
        metadata: {},
        sectionPath: ["Shipping"],
        text: "Shipping",
        type: "heading",
      },
      {
        id: "element-5",
        metadata: {},
        sectionPath: ["Shipping"],
        text: "Shipping takes three days.",
        type: "paragraph",
      },
    ],
  };
}

function sequenceIds(ids: readonly string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];

    if (!id) {
      throw new Error("No test id left");
    }

    index += 1;
    return id;
  };
}

function largeOutline(
  count: number,
  publicationGenerationId?: string,
): {
  readonly artifact: ParseArtifact;
  readonly outline: DocumentOutline;
} {
  const nodes: DocumentOutlineNode[] = Array.from({ length: count }, (_, index) => ({
    childNodeIds: [],
    children: [],
    endOffset: index * 10 + 9,
    id: `node-${index}`,
    level: 1,
    metadata: {},
    sectionPath: [`Section ${index}`],
    sourceElementIds: [`element-${index}`],
    sourceNodeIds: [],
    startOffset: index * 10,
    summary: `Deterministic ${index}`,
    title: `Section ${index}`,
    tocSource: "parser-heading",
  }));
  const artifact: ParseArtifact = {
    artifactHash: "b".repeat(64),
    contentType: "text",
    createdAt,
    documentAssetId,
    elements: nodes.map((node, index) => ({
      id: `element-${index}`,
      metadata: {},
      sectionPath: [...node.sectionPath],
      text: `Section ${index} body`,
      type: "paragraph",
    })),
    id: parseArtifactId,
    metadata: {},
    parser: "native-markdown",
    version: 1,
  };
  return {
    artifact,
    outline: {
      artifactHash: artifact.artifactHash,
      createdAt,
      documentAssetId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
      knowledgeSpaceId,
      metadata: {},
      nodes,
      outlineVersion: "document-outline-v1",
      parseArtifactId,
      ...(publicationGenerationId ? { publicationGenerationId } : {}),
      version: 1,
    },
  };
}

function measuredHtmlOutlineShape(): {
  readonly artifact: ParseArtifact;
  readonly outline: DocumentOutline;
} {
  const grandchildren = Array.from({ length: 35 }, (_, index) => {
    const parentIndex = index % 32;
    return outlineNode(33 + index, 3, ["Document", `Section ${parentIndex}`, `Topic ${index}`]);
  });
  const children = Array.from({ length: 32 }, (_, index) => {
    const nested = grandchildren.filter((_, grandchildIndex) => grandchildIndex % 32 === index);
    return outlineNode(1 + index, 2, ["Document", `Section ${index}`], nested);
  });
  const nodes = [outlineNode(0, 1, ["Document"], children)];
  const flattened = flattenOutlineNodes(nodes);
  const artifact: ParseArtifact = {
    artifactHash: "c".repeat(64),
    contentType: "text",
    createdAt,
    documentAssetId,
    elements: flattened.map((node, index) => ({
      id: `measured-element-${index}`,
      metadata: {},
      sectionPath: [...node.sectionPath],
      text: `${node.title} body`,
      type: "paragraph",
    })),
    id: parseArtifactId,
    metadata: {},
    parser: "native-html",
    version: 1,
  };
  return {
    artifact,
    outline: {
      artifactHash: artifact.artifactHash,
      createdAt,
      documentAssetId,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      knowledgeSpaceId,
      metadata: {},
      nodes,
      outlineVersion: "document-outline-v1",
      parseArtifactId,
      version: 1,
    },
  };
}

function outlineNode(
  index: number,
  level: number,
  sectionPath: readonly string[],
  children: readonly DocumentOutlineNode[] = [],
): DocumentOutlineNode {
  return {
    childNodeIds: children.map((child) => child.id),
    children,
    endOffset: index * 10 + 9,
    id: `node-${index}`,
    level,
    metadata: {},
    sectionPath: [...sectionPath],
    sourceElementIds: [`measured-element-${index}`],
    sourceNodeIds: [],
    startOffset: index * 10,
    summary: `Deterministic ${index}`,
    title: sectionPath.at(-1) ?? `Node ${index}`,
    tocSource: "parser-heading",
  };
}

function flattenOutlineNodes(nodes: readonly DocumentOutlineNode[]): DocumentOutlineNode[] {
  return nodes.flatMap((node) => [node, ...flattenOutlineNodes(node.children)]);
}

function countNodes(nodes: readonly DocumentOutlineNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.children), 0);
}
