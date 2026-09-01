import { DocumentOutlineSchema, KnowledgeNodeSchema } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createConcurrencyGate } from "./bounded-concurrency";
import { buildPageIndexNodeQueue, openPageIndexEvidenceQueue } from "./page-index-node-queue";
import type { PageIndexNodeQueueOutlineInput } from "./page-index-node-queue";
import type { PageIndexWholeTreeNodeSelection } from "./page-index-whole-tree-selection";
import type { PublishedPageIndexRepository } from "./published-page-index-repository";

const DOCUMENT_ID = "10000000-0000-4000-8000-000000000001";
const OUTLINE_ID = "20000000-0000-4000-8000-000000000001";
const SPACE_ID = "30000000-0000-4000-8000-000000000001";
const GENERATION_ID = "50000000-0000-4000-8000-000000000001";

describe("PageIndex node queue", () => {
  it("merges LLM and Value decisions by outline-node identity with deterministic priority", () => {
    const outline = fixtureOutline();
    const llmSelections: readonly PageIndexWholeTreeNodeSelection[] = [
      { nodeId: "invoice", reason: "direct section", score: 0.9 },
      { nodeId: "tax", reason: "supporting section", score: 0.6 },
    ];
    const queue = buildPageIndexNodeQueue({
      maxQueueItems: 3,
      maxValueNodesPerOutline: 2,
      outlines: [
        {
          documentScore: 0.8,
          generationId: GENERATION_ID,
          llmSelections,
          outline,
          rankedValueNodeIds: ["invoice", "fees"],
          valuesByNodeId: new Map([
            ["invoice", { breadthValue: 0.7, peakValue: 0.8 }],
            ["fees", { breadthValue: 0.5, peakValue: 0.7 }],
          ]),
        },
      ],
    });

    expect(queue.map((item) => item.outlineNodeId)).toEqual(["invoice", "fees", "tax"]);
    expect(queue[0]).toMatchObject({
      llmScore: 0.9,
      priorityScore: 0.9,
      valuePeakScore: 0.8,
    });
    expect(queue[0]?.contributions).toEqual(["llm", "value"]);
  });

  it("opens only queued ranges and deduplicates overlapping evidence and projections", async () => {
    const outline = fixtureOutline();
    const queue = buildPageIndexNodeQueue({
      maxQueueItems: 2,
      maxValueNodesPerOutline: 2,
      outlines: [
        {
          documentScore: 1,
          generationId: GENERATION_ID,
          llmSelections: [
            { nodeId: "invoice", reason: "invoice evidence", score: 0.9 },
            { nodeId: "fees", reason: "fee evidence", score: 0.8 },
          ],
          outline,
          rankedValueNodeIds: ["invoice", "fees"],
          valuesByNodeId: new Map([
            ["invoice", { breadthValue: 0.7, peakValue: 0.9 }],
            ["fees", { breadthValue: 0.6, peakValue: 0.8 }],
          ]),
        },
      ],
    });
    const shared = knowledgeNode("60000000-0000-4000-8000-000000000001", "shared evidence");
    const selectedNode = outline.nodes[0];
    if (!selectedNode) throw new Error("missing outline node fixture");
    const openLeafEvidence = vi.fn(async (input) => ({
      items: [
        {
          citation: {
            artifactHash: "a".repeat(64),
            documentAssetId: DOCUMENT_ID,
            documentVersion: 1,
            sectionPath: ["Finance", input.outlineNodeId],
          },
          node: shared,
          outlineId: OUTLINE_ID,
          outlineNodeId: input.outlineNodeId,
          projections: [
            {
              id:
                input.outlineNodeId === "invoice"
                  ? "70000000-0000-4000-8000-000000000001"
                  : "70000000-0000-4000-8000-000000000002",
              type: "dense-vector" as const,
            },
          ],
        },
      ],
      openedRange: { endOffset: 100, startOffset: 0 },
      outline,
      selectedNode,
    }));
    const repository: Pick<PublishedPageIndexRepository, "openLeafEvidence"> = {
      openLeafEvidence,
    };

    const result = await openPageIndexEvidenceQueue({
      maxConcurrentOpens: 2,
      maxEvidencePerRange: 5,
      maxFinalItems: 5,
      permissionScope: ["document:read"],
      queue,
      repository,
      scope: {
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        knowledgeSpaceId: SPACE_ID,
        publicationId: "80000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      },
    });

    expect(openLeafEvidence).toHaveBeenCalledTimes(2);
    expect(result.openedRangeCount).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ nodeId: shared.id, score: 0.9 });
    expect(result.items[0]?.projectionIds).toEqual([
      "70000000-0000-4000-8000-000000000001",
      "70000000-0000-4000-8000-000000000002",
    ]);
  });

  it("skips unknown and unusable nodes while retaining the strongest duplicate LLM decision", () => {
    const outline = fixtureOutline();
    const queue = buildPageIndexNodeQueue({
      maxQueueItems: 5,
      maxValueNodesPerOutline: 5,
      outlines: [
        {
          documentScore: 0.5,
          generationId: GENERATION_ID,
          llmSelections: [
            { nodeId: "unknown", reason: "not published", score: 1 },
            { nodeId: "invoice", reason: "strong", score: 0.8 },
            { nodeId: "invoice", reason: "weak", score: 0.2 },
          ],
          outline,
          rankedValueNodeIds: ["unknown", "tax", "fees", "invoice"],
          valuesByNodeId: new Map([
            ["tax", { breadthValue: 0.2, peakValue: 0 }],
            ["fees", { breadthValue: 0.4, peakValue: 0.6 }],
          ]),
        },
      ],
    });

    expect(queue.map((item) => item.outlineNodeId)).toEqual(["invoice", "fees"]);
    expect(queue[0]).toMatchObject({ llmReason: "strong", llmScore: 0.8 });
  });

  it("handles an empty queue without opening publication ranges", async () => {
    const openLeafEvidence = vi.fn();
    const result = await openPageIndexEvidenceQueue({
      maxConcurrentOpens: 1,
      maxEvidencePerRange: 1,
      maxFinalItems: 1,
      permissionScope: [],
      queue: [],
      repository: { openLeafEvidence },
      scope: {
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        knowledgeSpaceId: SPACE_ID,
        publicationId: "80000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      },
    });

    expect(result).toEqual({ items: [], openedRangeCount: 0, truncated: false });
    expect(openLeafEvidence).not.toHaveBeenCalled();
  });

  it("enforces a request-wide open reservation before physical I/O", async () => {
    const outline = fixtureOutline();
    const queue = buildPageIndexNodeQueue({
      maxQueueItems: 2,
      maxValueNodesPerOutline: 2,
      outlines: [
        {
          documentScore: 1,
          generationId: GENERATION_ID,
          llmSelections: [],
          outline,
          rankedValueNodeIds: ["invoice", "fees"],
          valuesByNodeId: new Map([
            ["invoice", { breadthValue: 1, peakValue: 1 }],
            ["fees", { breadthValue: 0.9, peakValue: 0.9 }],
          ]),
        },
      ],
    });
    const selectedNode = outline.nodes[0];
    if (!selectedNode) throw new Error("missing selected node");
    const openLeafEvidence = vi.fn(async () => ({
      items: [],
      openedRange: { endOffset: 100, startOffset: 0 },
      outline,
      selectedNode,
    }));
    let remaining = 1;

    const result = await openPageIndexEvidenceQueue({
      maxConcurrentOpens: 2,
      maxEvidencePerRange: 1,
      maxFinalItems: 2,
      permissionScope: [],
      queue,
      repository: { openLeafEvidence },
      reserveOpen: () => remaining-- > 0,
      scope: {
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        knowledgeSpaceId: SPACE_ID,
        publicationId: "80000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      },
    });

    expect(openLeafEvidence).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ openedRangeCount: 1, truncated: true });
  });

  it("stops awaiting an admitted range open when its owner is cancelled", async () => {
    const outline = fixtureOutline();
    const queue = buildPageIndexNodeQueue({
      maxQueueItems: 1,
      maxValueNodesPerOutline: 1,
      outlines: [
        {
          documentScore: 1,
          generationId: GENERATION_ID,
          llmSelections: [],
          outline,
          rankedValueNodeIds: ["invoice"],
          valuesByNodeId: new Map([["invoice", { breadthValue: 1, peakValue: 1 }]]),
        },
      ],
    });
    const controller = new AbortController();
    const cancellation = new Error("lease lost");
    const openLeafEvidence = vi.fn(async () => new Promise<never>(() => undefined));
    const opening = openPageIndexEvidenceQueue({
      maxConcurrentOpens: 1,
      maxEvidencePerRange: 1,
      maxFinalItems: 1,
      permissionScope: [],
      queue,
      repository: { openLeafEvidence },
      signal: controller.signal,
      scope: {
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        knowledgeSpaceId: SPACE_ID,
        publicationId: "80000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      },
    });
    await vi.waitFor(() => expect(openLeafEvidence).toHaveBeenCalledOnce());

    controller.abort(cancellation);

    await expect(opening).rejects.toBe(cancellation);
  });

  it("does not reserve an open budget unit for work cancelled in the shared gate", async () => {
    const outline = fixtureOutline();
    const queue = buildPageIndexNodeQueue({
      maxQueueItems: 1,
      maxValueNodesPerOutline: 1,
      outlines: [
        {
          documentScore: 1,
          generationId: GENERATION_ID,
          llmSelections: [],
          outline,
          rankedValueNodeIds: ["invoice"],
          valuesByNodeId: new Map([["invoice", { breadthValue: 1, peakValue: 1 }]]),
        },
      ],
    });
    const gate = createConcurrencyGate(1);
    let releaseGate: (() => void) | undefined;
    const occupied = gate.run(
      async () =>
        new Promise<void>((resolve) => {
          releaseGate = resolve;
        }),
    );
    await vi.waitFor(() => expect(releaseGate).toBeDefined());
    const controller = new AbortController();
    const reserveOpen = vi.fn(() => true);
    const opening = openPageIndexEvidenceQueue({
      maxConcurrentOpens: 1,
      maxEvidencePerRange: 1,
      maxFinalItems: 1,
      openGate: gate,
      permissionScope: [],
      queue,
      repository: { openLeafEvidence: vi.fn() },
      reserveOpen,
      signal: controller.signal,
      scope: {
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        knowledgeSpaceId: SPACE_ID,
        publicationId: "80000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      },
    });
    await Promise.resolve();
    expect(reserveOpen).not.toHaveBeenCalled();

    const cancellation = new Error("request cancelled while queued");
    controller.abort(cancellation);
    await expect(opening).rejects.toBe(cancellation);
    expect(reserveOpen).not.toHaveBeenCalled();

    releaseGate?.();
    await occupied;
  });

  it("marks range and item truncation and preserves LLM-only evidence metadata", async () => {
    const outline = fixtureOutline();
    const queue = buildPageIndexNodeQueue({
      maxQueueItems: 2,
      maxValueNodesPerOutline: 1,
      outlines: [
        {
          documentScore: 1,
          generationId: GENERATION_ID,
          llmSelections: [
            { nodeId: "invoice", reason: "z reason", score: 0.8 },
            { nodeId: "fees", reason: "a reason", score: 0.8 },
          ],
          outline,
          rankedValueNodeIds: [],
          valuesByNodeId: new Map(),
        },
      ],
    });
    let call = 0;
    const result = await openPageIndexEvidenceQueue({
      maxConcurrentOpens: 1,
      maxEvidencePerRange: 2,
      maxFinalItems: 1,
      permissionScope: ["document:read"],
      queue,
      repository: {
        openLeafEvidence: async (input) => {
          call += 1;
          const node = knowledgeNode(
            `60000000-0000-4000-8000-00000000000${call}`,
            `evidence ${call}`,
          );
          const selectedNode = outline.nodes.find((entry) => entry.id === input.outlineNodeId);
          if (!selectedNode) throw new Error("missing selected node");
          return {
            items: [
              {
                citation: {
                  artifactHash: "a".repeat(64),
                  documentAssetId: DOCUMENT_ID,
                  documentVersion: 1,
                  sectionPath: [input.outlineNodeId],
                },
                node,
                outlineId: OUTLINE_ID,
                outlineNodeId: input.outlineNodeId,
                projections: [],
              },
            ],
            openedRange: { endOffset: 100, startOffset: 0 },
            outline,
            selectedNode,
            truncated: call === 1,
          };
        },
      },
      scope: {
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        knowledgeSpaceId: SPACE_ID,
        publicationId: "80000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      },
    });

    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      metadata: {
        pageIndex: { contributions: ["llm"], llmReason: "a reason" },
      },
      sources: ["pageindex"],
    });
  });

  it("rejects invalid queue limits and scores", async () => {
    const outline = fixtureOutline();
    const context: PageIndexNodeQueueOutlineInput = {
      documentScore: 1,
      generationId: GENERATION_ID,
      llmSelections: [],
      outline,
      rankedValueNodeIds: [],
      valuesByNodeId: new Map(),
    };
    const input = {
      maxQueueItems: 1,
      maxValueNodesPerOutline: 1,
      outlines: [context],
    };
    expect(() => buildPageIndexNodeQueue({ ...input, maxQueueItems: 0 })).toThrow(
      "maxQueueItems must be a positive integer",
    );
    expect(() => buildPageIndexNodeQueue({ ...input, maxValueNodesPerOutline: 0.5 })).toThrow(
      "maxValueNodesPerOutline must be a positive integer",
    );
    expect(() =>
      buildPageIndexNodeQueue({
        ...input,
        outlines: [{ ...context, documentScore: Number.NaN }],
      }),
    ).toThrow("documentScore must be within [0, 1]");
    expect(() =>
      buildPageIndexNodeQueue({
        ...input,
        outlines: [
          {
            ...context,
            llmSelections: [{ nodeId: "invoice", reason: "invalid", score: -1 }],
          },
        ],
      }),
    ).toThrow("llm selection score must be within [0, 1]");
    expect(() =>
      buildPageIndexNodeQueue({
        ...input,
        outlines: [
          {
            ...context,
            rankedValueNodeIds: ["invoice"],
            valuesByNodeId: new Map([["invoice", { breadthValue: 2, peakValue: 0.5 }]]),
          },
        ],
      }),
    ).toThrow("value breadth score must be within [0, 1]");

    const openInput = {
      maxConcurrentOpens: 1,
      maxEvidencePerRange: 1,
      maxFinalItems: 1,
      permissionScope: [] as string[],
      queue: [],
      repository: { openLeafEvidence: vi.fn() },
      scope: {
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        knowledgeSpaceId: SPACE_ID,
        publicationId: "80000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      },
    };
    await expect(
      openPageIndexEvidenceQueue({ ...openInput, maxConcurrentOpens: 0 }),
    ).rejects.toThrow("maxConcurrentOpens must be a positive integer");
    await expect(openPageIndexEvidenceQueue({ ...openInput, maxFinalItems: 0.5 })).rejects.toThrow(
      "maxFinalItems must be a positive integer",
    );
  });
});

function fixtureOutline() {
  const leaf = (id: string, startOffset: number, endOffset: number) => ({
    childNodeIds: [],
    children: [],
    endOffset,
    id,
    level: 2,
    metadata: {},
    sectionPath: ["Finance", id],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset,
    summary: `${id} summary`,
    title: id,
    tocSource: "parser-heading",
  });
  return DocumentOutlineSchema.parse({
    artifactHash: "a".repeat(64),
    createdAt: "2026-08-05T00:00:00.000Z",
    documentAssetId: DOCUMENT_ID,
    id: OUTLINE_ID,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    nodes: [leaf("invoice", 0, 100), leaf("fees", 100, 200), leaf("tax", 200, 300)],
    outlineVersion: "outline-v1",
    parseArtifactId: "40000000-0000-4000-8000-000000000001",
    publicationGenerationId: GENERATION_ID,
    version: 1,
  });
}

function knowledgeNode(id: string, text: string) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: DOCUMENT_ID,
    endOffset: 100,
    id,
    kind: "chunk",
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    parseArtifactId: "40000000-0000-4000-8000-000000000001",
    permissionScope: ["document:read"],
    publicationGenerationId: GENERATION_ID,
    sourceLocation: { sectionPath: ["Finance"] },
    startOffset: 0,
    text,
  });
}
