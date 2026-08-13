import type { KnowledgeNode } from "@knowledge/core";
import { KnowledgeNodeSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type KnowledgeNodeGenerationReceipt,
  KnowledgeNodeGenerationReceiptConflictError,
  createInMemoryKnowledgeNodeRepository,
} from "./knowledge-node-repository";
import {
  MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES,
  knowledgeNodeGenerationReceiptSerializedBytes,
  llmSemanticCompletionFingerprint,
  maximumKnowledgeNodeGenerationReceiptSerializedBytes,
} from "./semantic-generation-receipt";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const DOCUMENT_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const PARSE_ARTIFACT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const PUBLICATION_GENERATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca1";

interface ReceiptPatch {
  readonly path: readonly string[];
  readonly value: unknown;
}

function knowledgeNode(chunkIndex: number): KnowledgeNode {
  const startOffset = chunkIndex * 20;
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: DOCUMENT_ASSET_ID,
    endOffset: startOffset + 12,
    id: `018f0d60-7a49-7cc2-9c1b-${(0x5b36f18f8a00 + chunkIndex).toString(16).padStart(12, "0")}`,
    kind: "chunk",
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    metadata: { chunkIndex },
    parseArtifactId: PARSE_ARTIFACT_ID,
    permissionScope: ["tenant:tenant-1"],
    publicationGenerationId: PUBLICATION_GENERATION_ID,
    sourceLocation: { endOffset: startOffset + 12, sectionPath: [], startOffset },
    startOffset,
    text: `chunk ${chunkIndex}`,
  });
}

function semanticGenerationReceipt(
  overrides: Partial<KnowledgeNodeGenerationReceipt> = {},
): KnowledgeNodeGenerationReceipt {
  const completion = {
    actualModel: "reasoning-v1",
    actualProvider: "plugin-daemon",
    finishReason: "stop",
    transportProvider: "plugin-daemon",
  };
  return {
    artifactHash: "a".repeat(64),
    completionCatalog: [
      { ...completion, fingerprint: llmSemanticCompletionFingerprint(completion) },
    ],
    documentAssetId: DOCUMENT_ASSET_ID,
    documentChunkCount: 1,
    excludedNodeOrdinals: [0],
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    modelSelection: {
      model: "reasoning-v1",
      pluginId: "reasoning-plugin",
      provider: "plugin-daemon",
    },
    parseArtifactId: PARSE_ARTIFACT_ID,
    permissionScope: ["tenant:tenant-1"],
    promptResponseFingerprint: `sha256:${"b".repeat(64)}`,
    publicationGenerationId: PUBLICATION_GENERATION_ID,
    requestFingerprint: `sha256:${"c".repeat(64)}`,
    responseFingerprint: `sha256:${"d".repeat(64)}`,
    schemaVersion: 1,
    semanticConfig: {
      maxChunkChars: 1_200,
      maxNodes: 20_000,
      maxWindowChars: 4_800,
      overlapChars: 0,
      promptVersion: "semantic-v2",
    },
    storedNodeCount: 0,
    storedResponseFingerprint: `sha256:${"e".repeat(64)}`,
    windowManifest: [
      {
        chunkRanges: [["u-000000-000000", "u-000000-000000"]],
        committedUnitRange: ["u-000000-000000", "u-000000-000000"],
        completionIndex: 0,
        coreUnitRange: ["u-000000-000000", "u-000000-000000"],
        firstChunkIndex: 0,
        inputFingerprint: `sha256:${"1".repeat(64)}`,
        responseFingerprint: `sha256:${"2".repeat(64)}`,
        windowId: "window-000000",
      },
    ],
    ...overrides,
  };
}

function patch(path: string, value: unknown): ReceiptPatch {
  return { path: path.split("."), value };
}

function applyReceiptPatch(target: Record<string, unknown>, input: ReceiptPatch): void {
  const finalSegment = input.path.at(-1);
  if (!finalSegment) throw new Error("Receipt patch path is required");
  let cursor: unknown = target;
  for (const segment of input.path.slice(0, -1)) {
    cursor = Array.isArray(cursor)
      ? cursor[Number(segment)]
      : isMutableRecord(cursor)
        ? cursor[segment]
        : undefined;
    if (cursor === undefined) throw new Error(`Receipt patch path is invalid: ${input.path}`);
  }
  if (Array.isArray(cursor)) {
    cursor[Number(finalSegment)] = input.value;
    return;
  }
  if (!isMutableRecord(cursor)) {
    throw new Error(`Receipt patch target is invalid: ${input.path}`);
  }
  cursor[finalSegment] = input.value;
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

describe("KnowledgeNode semantic generation receipts", () => {
  it("persists an all-excluded generation and replays it without node rows", async () => {
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 2,
    });
    const receipt = semanticGenerationReceipt();

    await expect(
      repository.completeGenerationAtomically?.({ nodes: [], receipt }),
    ).resolves.toEqual({ nodes: [], receipt });
    await expect(
      repository.getGenerationReceipt?.({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifactId: PARSE_ARTIFACT_ID,
        publicationGenerationId: PUBLICATION_GENERATION_ID,
      }),
    ).resolves.toEqual(receipt);
    await expect(
      repository.completeGenerationAtomically?.({ nodes: [], receipt }),
    ).resolves.toEqual({ nodes: [], receipt });
  });

  it("rejects a conflicting replay for the same immutable generation", async () => {
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 2,
    });
    await repository.completeGenerationAtomically?.({
      nodes: [],
      receipt: semanticGenerationReceipt(),
    });

    await expect(
      repository.completeGenerationAtomically?.({
        nodes: [],
        receipt: semanticGenerationReceipt({ language: "zh-CN" }),
      }),
    ).rejects.toBeInstanceOf(KnowledgeNodeGenerationReceiptConflictError);
  });

  it("atomically persists a complete immutable generation beyond ordinary batch size", async () => {
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 2,
      maxNodes: 2,
    });
    const nodes = [knowledgeNode(0), knowledgeNode(1)];
    const baseWindow = semanticGenerationReceipt().windowManifest[0];
    if (!baseWindow) throw new Error("semantic receipt fixture requires one window");
    const receipt = semanticGenerationReceipt({
      documentChunkCount: 2,
      excludedNodeOrdinals: [],
      storedNodeCount: 2,
      windowManifest: [
        {
          ...baseWindow,
          chunkRanges: [
            ["u-000000-000000", "u-000000-000000"],
            ["u-000000-000001", "u-000000-000001"],
          ],
        },
      ],
    });

    await expect(repository.upsertMany(nodes)).rejects.toThrow("maxBatchSize=1");
    await expect(repository.completeGenerationAtomically?.({ nodes, receipt })).resolves.toEqual({
      nodes,
      receipt,
    });
  });

  it("rejects receipts whose node count or identity does not match persisted nodes", async () => {
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 2,
    });

    await expect(
      repository.completeGenerationAtomically?.({
        nodes: [knowledgeNode(0)],
        receipt: semanticGenerationReceipt(),
      }),
    ).rejects.toThrow("storedNodeCount does not match nodes");

    const storedReceipt = semanticGenerationReceipt({
      documentChunkCount: 1,
      excludedNodeOrdinals: [],
      storedNodeCount: 1,
    });
    for (const node of [
      KnowledgeNodeSchema.parse({ ...knowledgeNode(0), artifactHash: "b".repeat(64) }),
      KnowledgeNodeSchema.parse({
        ...knowledgeNode(0),
        metadata: { ...knowledgeNode(0).metadata, chunkIndex: "invalid" },
      }),
    ]) {
      await expect(
        repository.completeGenerationAtomically?.({ nodes: [node], receipt: storedReceipt }),
      ).rejects.toThrow("identity does not match nodes");
    }
    await expect(
      repository.completeGenerationAtomically?.({
        nodes: [KnowledgeNodeSchema.parse({ ...knowledgeNode(0), metadata: { chunkIndex: 1 } })],
        receipt: storedReceipt,
      }),
    ).rejects.toThrow("chunk indexes do not match nodes");
  });

  it("round-trips minimal terminal identity and a manifest without look-ahead", async () => {
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 2,
    });
    const baseWindow = semanticGenerationReceipt().windowManifest[0];
    if (!baseWindow) throw new Error("semantic receipt fixture requires one window");
    const completion = {};
    const receipt = semanticGenerationReceipt({
      completionCatalog: [
        { fingerprint: llmSemanticCompletionFingerprint(completion), ...completion },
      ],
      windowManifest: [{ ...baseWindow, lookAheadUnitRange: undefined }],
    });

    await expect(
      repository.completeGenerationAtomically?.({ nodes: [], receipt }),
    ).resolves.toEqual({ nodes: [], receipt });
    await expect(
      repository.getGenerationReceipt?.({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifactId: PARSE_ARTIFACT_ID,
        publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca2",
      }),
    ).resolves.toBeNull();
  });

  it("enforces the durable receipt byte limit before persistence", async () => {
    const base = semanticGenerationReceipt({ permissionScope: ["x"] });
    const baseBytes = knowledgeNodeGenerationReceiptSerializedBytes(base);
    const oversized = semanticGenerationReceipt({
      permissionScope: [
        `x${"y".repeat(MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES + 1 - baseBytes)}`,
      ],
    });
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 2,
    });

    await expect(
      repository.completeGenerationAtomically?.({ nodes: [], receipt: oversized }),
    ).rejects.toThrow(`exceeds maxBytes=${MAX_KNOWLEDGE_NODE_GENERATION_RECEIPT_BYTES}`);
  });

  it("fails closed for malformed receipt envelopes, identities, windows, and ranges", async () => {
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxNodes: 4,
    });
    const valid = semanticGenerationReceipt();
    const invalidCases: Array<{
      readonly expected: string;
      readonly patches: readonly ReceiptPatch[];
    }> = [
      { expected: "schemaVersion must be 1", patches: [patch("schemaVersion", 2)] },
      { expected: "artifactHash is invalid", patches: [patch("artifactHash", "bad")] },
      {
        expected: "maxChunkChars must be at least 1",
        patches: [patch("semanticConfig.maxChunkChars", 0)],
      },
      {
        expected: "maxNodes must be at least 1",
        patches: [patch("semanticConfig.maxNodes", 0)],
      },
      {
        expected: "maxWindowChars must be at least 1",
        patches: [patch("semanticConfig.maxWindowChars", 0)],
      },
      {
        expected: "overlapChars is invalid",
        patches: [patch("semanticConfig.overlapChars", -1)],
      },
      {
        expected: "overlapChars is invalid",
        patches: [patch("semanticConfig.overlapChars", 1_200)],
      },
      {
        expected: "semantic config is invalid",
        patches: [patch("semanticConfig.maxWindowChars", 1_199)],
      },
      {
        expected: "semantic config is invalid",
        patches: [patch("semanticConfig.promptVersion", " ")],
      },
      {
        expected: "node counts are invalid",
        patches: [patch("documentChunkCount", -1)],
      },
      {
        expected: "node counts are invalid",
        patches: [patch("storedNodeCount", 2)],
      },
      {
        expected: "exclusions are invalid",
        patches: [patch("excludedNodeOrdinals", [-1])],
      },
      {
        expected: "exclusions are invalid",
        patches: [patch("excludedNodeOrdinals", [1])],
      },
      {
        expected: "exclusions are invalid",
        patches: [patch("documentChunkCount", 2), patch("excludedNodeOrdinals", [1, 0])],
      },
      {
        expected: "fingerprint is invalid",
        patches: [patch("requestFingerprint", "sha256:bad")],
      },
      {
        expected: "permissionScope is invalid",
        patches: [patch("permissionScope", [" "])],
      },
      { expected: "language is invalid", patches: [patch("language", " ")] },
      {
        expected: "completion catalog is invalid",
        patches: [patch("completionCatalog", "not-an-array")],
      },
      {
        expected: "completion identity is invalid",
        patches: [patch("completionCatalog", [null])],
      },
      {
        expected: "actualModel is invalid",
        patches: [patch("completionCatalog.0.actualModel", " ")],
      },
      {
        expected: "actualProvider is invalid",
        patches: [patch("completionCatalog.0.actualProvider", "x".repeat(256))],
      },
      {
        expected: "finishReason is invalid",
        patches: [patch("completionCatalog.0.finishReason", "x".repeat(65))],
      },
      {
        expected: "transportProvider is invalid",
        patches: [patch("completionCatalog.0.transportProvider", 42)],
      },
      {
        expected: "completion identity is invalid",
        patches: [patch("completionCatalog.0.fingerprint", `sha256:${"0".repeat(64)}`)],
      },
      {
        expected: "completion identity is invalid",
        patches: [
          patch("completionCatalog", [valid.completionCatalog[0], valid.completionCatalog[0]]),
        ],
      },
      {
        expected: "window manifest is incomplete",
        patches: [patch("windowManifest", [])],
      },
      {
        expected: "window manifest is incomplete",
        patches: [patch("completionCatalog", [])],
      },
      {
        expected: "window manifest is invalid",
        patches: [patch("windowManifest", [null])],
      },
      {
        expected: "window manifest is invalid",
        patches: [patch("windowManifest.0.windowId", "window-x")],
      },
      {
        expected: "window manifest is invalid",
        patches: [patch("windowManifest.0.inputFingerprint", "bad")],
      },
      {
        expected: "window manifest is invalid",
        patches: [patch("windowManifest.0.responseFingerprint", "bad")],
      },
      {
        expected: "window manifest is invalid",
        patches: [patch("windowManifest.0.completionIndex", -1)],
      },
      {
        expected: "window manifest is invalid",
        patches: [patch("windowManifest.0.firstChunkIndex", 1)],
      },
      {
        expected: "window manifest is invalid",
        patches: [patch("windowManifest.0.chunkRanges", [])],
      },
      {
        expected: "window unit range is invalid",
        patches: [patch("windowManifest.0.coreUnitRange", ["bad", "bad"])],
      },
      {
        expected: "window unit range is invalid",
        patches: [patch("windowManifest.0.chunkRanges", [["u-000000-000000"]])],
      },
      {
        expected: "window chunks do not cover the document",
        patches: [
          patch("documentChunkCount", 2),
          patch("storedNodeCount", 1),
          patch("excludedNodeOrdinals", [1]),
        ],
      },
    ];

    for (const { expected, patches } of invalidCases) {
      const receipt = structuredClone(valid) as unknown as Record<string, unknown>;
      for (const receiptPatch of patches) applyReceiptPatch(receipt, receiptPatch);
      await expect(
        repository.completeGenerationAtomically?.({
          nodes: [],
          receipt: receipt as unknown as KnowledgeNodeGenerationReceipt,
        }),
      ).rejects.toThrow(expected);
    }
  });

  it("computes exact empty and bounded receipt admission sizes", () => {
    const empty = semanticGenerationReceipt({
      completionCatalog: [],
      documentChunkCount: 0,
      excludedNodeOrdinals: [],
      storedNodeCount: 0,
      windowManifest: [],
    });

    expect(
      maximumKnowledgeNodeGenerationReceiptSerializedBytes({
        emptyReceipt: empty,
        maximumChunkCount: 0,
        maximumWindowCount: 0,
      }),
    ).toBe(knowledgeNodeGenerationReceiptSerializedBytes(empty));
    expect(
      maximumKnowledgeNodeGenerationReceiptSerializedBytes({
        emptyReceipt: empty,
        maximumChunkCount: 2,
        maximumWindowCount: 1,
      }),
    ).toBeGreaterThan(knowledgeNodeGenerationReceiptSerializedBytes(empty));
    expect(() =>
      maximumKnowledgeNodeGenerationReceiptSerializedBytes({
        emptyReceipt: semanticGenerationReceipt(),
        maximumChunkCount: 1,
        maximumWindowCount: 1,
      }),
    ).toThrow("requires empty dynamic arrays");
    for (const [maximumChunkCount, maximumWindowCount] of [
      [-1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      expect(() =>
        maximumKnowledgeNodeGenerationReceiptSerializedBytes({
          emptyReceipt: empty,
          maximumChunkCount,
          maximumWindowCount,
        }),
      ).toThrow("admission bounds are invalid");
    }
  });
});
