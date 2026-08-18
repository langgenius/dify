import type { ComputeRuntime } from "@knowledge/compute";
import { KnowledgeNodeSchema, ParseArtifactSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createIncrementalReindexer } from "./index-reindexer";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createLlmSemanticChunker } from "./llm-semantic-chunker";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const DOCUMENT_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const PARSE_ARTIFACT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const GENERATION_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca1";
const GENERATION_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca2";

function parseArtifact() {
  return ParseArtifactSchema.parse({
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt: "2026-08-13T12:00:00.000Z",
    documentAssetId: DOCUMENT_ASSET_ID,
    elements: [
      {
        id: "element-1",
        sectionPath: ["Invoice"],
        sourceLocation: { endOffset: 18, startOffset: 0 },
        text: "Invoice buyer amount",
        type: "paragraph",
      },
    ],
    id: PARSE_ARTIFACT_ID,
    metadata: {},
    parser: "native-markdown",
    version: 1,
  });
}

function computeRuntime(onChunk?: () => void): ComputeRuntime {
  return {
    chunkParseArtifact: (input) => {
      onChunk?.();
      return [
        KnowledgeNodeSchema.parse({
          artifactHash: input.parseArtifact.artifactHash,
          documentAssetId: input.parseArtifact.documentAssetId,
          endOffset: 18,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42",
          kind: "chunk",
          knowledgeSpaceId: input.knowledgeSpaceId,
          metadata: { chunkIndex: 0, elementIds: ["element-1"] },
          parseArtifactId: input.parseArtifact.id,
          permissionScope: input.permissionScope ? [...input.permissionScope] : undefined,
          sourceLocation: { endOffset: 18, sectionPath: ["Invoice"], startOffset: 0 },
          startOffset: 0,
          text: "Invoice buyer amount",
        }),
      ];
    },
    countApproxTokens: () => 1,
    countTokens: () => 1,
    diffText: () => ({ operations: [], stats: { delete: 0, equal: 0, insert: 0 } }),
    packEvidence: () => ({ context: "", items: [], omitted: [], tokenBudget: 1, usedTokens: 0 }),
    rrfFuse: () => [],
  };
}

function retrievalProfile() {
  return {
    defaultMode: "research" as const,
    reasoningModel: {
      model: "reasoning-v1",
      pluginId: "reasoning-plugin",
      provider: "plugin-daemon",
    },
    rerank: { enabled: false as const },
    revision: 1,
    scoreThreshold: { enabled: false as const, stage: "mode-final" as const },
    topK: 10,
  };
}

function semanticChunker(onCall: () => void) {
  return createLlmSemanticChunker({
    maxChunkChars: 512,
    maxWindowChars: 600,
    now: () => "2026-08-13T12:00:00.000Z",
    promptVersion: "semantic-reindex-v1",
    reasoningProviderFactory: () => ({
      kind: "plugin-daemon",
      async *stream(input) {
        onCall();
        const user = input.messages.find((message) => message.role === "user");
        const payload = JSON.parse(user?.content ?? "{}") as {
          units: Array<{ id: string }>;
        };
        yield {
          delta: JSON.stringify({
            chunks: [
              {
                endUnitId: payload.units.at(-1)?.id,
                entities: [
                  {
                    confidence: 0.99,
                    id: "invoice",
                    text: "Invoice",
                    type: "policy",
                  },
                ],
                relations: [],
                sectionPath: ["Invoice", "Buyer and amount"],
                sectionSummary: "Invoice identity, buyer, and amount details.",
                startUnitId: payload.units[0]?.id,
              },
            ],
          }),
          type: "delta" as const,
        };
        yield {
          finishReason: "stop",
          metadata: { model: input.model, provider: "plugin-daemon" },
          type: "done" as const,
        };
      },
    }),
  });
}

function echoSemanticChunker(onCall: () => void, promptVersion = "semantic-reindex-v1") {
  return createLlmSemanticChunker({
    maxChunkChars: 512,
    maxWindowChars: 600,
    now: () => "2026-08-13T12:00:00.000Z",
    promptVersion,
    reasoningProviderFactory: () => ({
      kind: "plugin-daemon",
      async *stream(input) {
        onCall();
        const user = input.messages.find((message) => message.role === "user");
        const payload = JSON.parse(user?.content ?? "{}") as {
          sectionPath: string[];
          units: Array<{ id: string; type: string }>;
        };
        yield {
          delta: JSON.stringify({
            chunks: [
              {
                endUnitId: payload.units.at(-1)?.id,
                entities: [],
                relations: [],
                sectionPath: payload.sectionPath,
                ...(payload.units[0]?.type === "paragraph"
                  ? { sectionSummary: "Semantic paragraph summary." }
                  : {}),
                startUnitId: payload.units[0]?.id,
              },
            ],
          }),
          type: "delta" as const,
        };
        yield {
          finishReason: "stop",
          metadata: { model: input.model, provider: "plugin-daemon" },
          type: "done" as const,
        };
      },
    }),
  });
}

function richParseArtifact() {
  return ParseArtifactSchema.parse({
    artifactHash: "b".repeat(64),
    contentType: "structured",
    createdAt: "2026-08-13T12:00:00.000Z",
    documentAssetId: DOCUMENT_ASSET_ID,
    elements: [
      {
        id: "paragraph",
        metadata: {},
        pageNumber: 1,
        sectionPath: ["Rich"],
        text: "Paragraph content.",
        type: "paragraph",
      },
      {
        id: "table",
        metadata: { title: "Amounts" },
        pageNumber: 2,
        sectionPath: ["Rich"],
        text: "Item | Amount",
        type: "table",
      },
      {
        id: "image",
        metadata: { caption: "Receipt" },
        sectionPath: ["Rich"],
        text: "Receipt image",
        type: "image",
      },
    ],
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
    metadata: {},
    parser: "native-structured",
    version: 1,
  });
}

function compactCompletionSemanticChunker(onCall: () => void) {
  return createLlmSemanticChunker({
    maxChunkChars: 512,
    maxWindowChars: 600,
    reasoningProviderFactory: () => ({
      async *stream(input) {
        onCall();
        const user = input.messages.find((message) => message.role === "user");
        const payload = JSON.parse(user?.content ?? "{}") as {
          units: Array<{ id: string }>;
        };
        yield {
          delta: JSON.stringify({
            chunks: payload.units.map((unit) => ({
              endUnitId: unit.id,
              entities: [],
              relations: [],
              startUnitId: unit.id,
            })),
          }),
          type: "delta" as const,
        };
        yield { type: "done" as const };
      },
    }),
  });
}

describe("incremental reindexer semantic generations", () => {
  it("uses the frozen reasoning model and replays the durable generation without another call", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 1,
      maxNodes: 4,
    });
    let llmCalls = 0;
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
      compute: {
        ...computeRuntime(),
        chunkParseArtifact: () => {
          throw new Error("deterministic chunker must not run");
        },
      },
      maxNodeReplayPageSize: 1,
      maxNodes: 4,
      nodes,
      semanticChunker: semanticChunker(() => llmCalls++),
    });
    const input = {
      chunkConfig: { maxChunkChars: 512 },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 1,
      publicationGenerationId: GENERATION_A,
      retrievalProfile: retrievalProfile(),
      tenantId: "tenant-1",
    } as const;

    const first = await reindexer.reindex(input);
    const replay = await reindexer.reindex(input);

    expect(first).toMatchObject({ nodesCreated: 1, status: "rebuilt" });
    expect(first).toMatchObject({
      outlineArtifact: {
        elements: [
          expect.objectContaining({
            sectionPath: ["Invoice", "Buyer and amount"],
            text: "Invoice buyer amount",
          }),
        ],
        metadata: expect.objectContaining({ semanticCompilation: expect.any(Object) }),
      },
    });
    expect(replay).toMatchObject({
      nodeIds: first.status === "rebuilt" ? first.nodeIds : undefined,
      nodesCreated: 1,
      status: "rebuilt",
    });
    expect(llmCalls).toBe(1);
    await expect(
      nodes.getGenerationReceipt?.({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifactId: PARSE_ARTIFACT_ID,
        publicationGenerationId: GENERATION_A,
      }),
    ).resolves.toMatchObject({
      documentChunkCount: 1,
      storedNodeCount: 1,
      windowManifest: [expect.objectContaining({ windowId: "window-000000" })],
    });
  });

  it("replays legacy v3 nodes without a generation receipt under the current v4 runtime", async () => {
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    let legacyCalls = 0;
    const input = {
      chunkConfig: { maxChunkChars: 512 },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 1,
      publicationGenerationId: GENERATION_A,
      retrievalProfile: retrievalProfile(),
      tenantId: "tenant-1",
    } as const;
    await createIncrementalReindexer({
      artifacts,
      compute: computeRuntime(),
      maxNodes: 4,
      nodes,
      semanticChunker: echoSemanticChunker(() => legacyCalls++, "semantic-chunking-v3"),
    }).reindex(input);

    let currentCalls = 0;
    const nodesWithoutHistoricalReceipt = {
      ...nodes,
      getGenerationReceipt: async () => null,
    };
    await expect(
      createIncrementalReindexer({
        artifacts,
        compute: computeRuntime(),
        maxNodes: 4,
        nodes: nodesWithoutHistoricalReceipt,
        semanticChunker: echoSemanticChunker(() => currentCalls++, "semantic-chunking-v4"),
      }).reindex(input),
    ).resolves.toMatchObject({ nodesCreated: 1, status: "rebuilt" });
    expect(legacyCalls).toBe(1);
    expect(currentCalls).toBe(0);
  });

  it("persists and replays a fully excluded semantic result", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 1,
      maxNodes: 4,
    });
    let llmCalls = 0;
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
      compute: computeRuntime(),
      maxNodeReplayPageSize: 1,
      maxNodes: 4,
      nodes,
      semanticChunker: semanticChunker(() => llmCalls++),
    });
    const input = {
      chunkConfig: { maxChunkChars: 512 },
      excludedNodeOrdinals: [0],
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 1,
      publicationGenerationId: GENERATION_A,
      retrievalProfile: retrievalProfile(),
      tenantId: "tenant-1",
    } as const;

    await expect(reindexer.reindex(input)).resolves.toMatchObject({
      nodeIds: [],
      nodesCreated: 0,
      status: "rebuilt",
    });
    await expect(reindexer.reindex(input)).resolves.toMatchObject({ nodesCreated: 0 });
    expect(llmCalls).toBe(1);
  });

  it("clones an existing semantic node generation for projection-only migration", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    let deterministicCalls = 0;
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
      compute: computeRuntime(() => deterministicCalls++),
      maxNodeReplayPageSize: 1,
      maxNodes: 4,
      nodes,
    });

    const source = await reindexer.reindex({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 1,
      publicationGenerationId: GENERATION_A,
    });
    const target = await reindexer.reindex({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 2,
      publicationGenerationId: GENERATION_B,
      reuseNodeGenerationId: GENERATION_A,
    });
    const targetReplay = await reindexer.reindex({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 2,
      publicationGenerationId: GENERATION_B,
      reuseNodeGenerationId: GENERATION_A,
    });

    expect(source).toMatchObject({ nodesCreated: 1 });
    expect(target).toMatchObject({ nodesCreated: 1 });
    expect(targetReplay).toMatchObject({
      nodeIds: target.status === "rebuilt" ? target.nodeIds : undefined,
      nodesCreated: 1,
    });
    expect(deterministicCalls).toBe(1);
  });

  it("requires tenant and durable receipt capabilities for profile-scoped semantic generations", async () => {
    const durableNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const baseOptions = {
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
      compute: computeRuntime(),
      maxNodes: 4,
      semanticChunker: semanticChunker(() => undefined),
    };
    await expect(
      createIncrementalReindexer({ ...baseOptions, nodes: durableNodes }).reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact(),
        projectionVersion: 1,
        publicationGenerationId: GENERATION_A,
        retrievalProfile: retrievalProfile(),
      }),
    ).rejects.toThrow("tenantId is required");

    const {
      completeGenerationAtomically: _completeGenerationAtomically,
      getGenerationReceipt: _getGenerationReceipt,
      ...nodesWithoutReceipts
    } = durableNodes;
    await expect(
      createIncrementalReindexer({ ...baseOptions, nodes: nodesWithoutReceipts }).reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact(),
        projectionVersion: 1,
        publicationGenerationId: GENERATION_A,
        retrievalProfile: retrievalProfile(),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("requires durable generation receipts");
  });

  it("persists complete semantic options and builds a typed outline across layout elements", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    let llmCalls = 0;
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
      compute: computeRuntime(),
      maxNodes: 10,
      nodes,
      semanticChunker: echoSemanticChunker(() => llmCalls++),
    });
    const input = {
      chunkConfig: {
        maxChunkChars: 512,
        maxNodes: 10,
        maxWindowChars: 600,
        overlapChars: 0,
      },
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      language: "zh-CN",
      parseArtifact: richParseArtifact(),
      permissionScope: ["tenant:one"],
      projectionVersion: 1,
      publicationGenerationId: GENERATION_A,
      retrievalProfile: retrievalProfile(),
      tenantId: "tenant-1",
    } as const;

    const first = await reindexer.reindex(input);
    const replay = await reindexer.reindex(input);

    expect(first).toMatchObject({
      nodesCreated: 3,
      outlineArtifact: {
        elements: [
          expect.objectContaining({
            metadata: expect.objectContaining({
              semanticSectionSummary: "Semantic paragraph summary.",
            }),
            pageNumber: 1,
            type: "paragraph",
          }),
          expect.objectContaining({ pageNumber: 2, type: "table" }),
          expect.objectContaining({ type: "image" }),
        ],
      },
      status: "rebuilt",
    });
    expect(
      first.status === "rebuilt" ? first.outlineArtifact?.elements[2]?.pageNumber : 0,
    ).toBeUndefined();
    expect(replay).toMatchObject({ nodesCreated: 3, status: "rebuilt" });
    expect(llmCalls).toBe(3);
    await expect(
      nodes.getGenerationReceipt?.({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifactId: richParseArtifact().id,
        publicationGenerationId: GENERATION_A,
      }),
    ).resolves.toMatchObject({
      language: "zh-CN",
      permissionScope: ["tenant:one"],
      semanticConfig: { maxNodes: 10, overlapChars: 0 },
    });
  });

  it("supports semantic compilation without a publication generation", async () => {
    let llmCalls = 0;
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 2 }),
      compute: computeRuntime(),
      maxNodes: 4,
      nodes: createInMemoryKnowledgeNodeRepository({
        maxBatchSize: 4,
        maxListLimit: 4,
        maxNodes: 4,
      }),
      semanticChunker: echoSemanticChunker(() => llmCalls++),
    });

    await expect(
      reindexer.reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact(),
        projectionVersion: 1,
        retrievalProfile: retrievalProfile(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ nodesCreated: 1, outlineArtifact: expect.any(Object) });
    expect(llmCalls).toBe(1);
  });

  it("fails closed when durable semantic receipt capabilities are incomplete", async () => {
    const durableNodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const baseInput = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 1,
      publicationGenerationId: GENERATION_A,
      retrievalProfile: retrievalProfile(),
      tenantId: "tenant-1",
    } as const;
    await expect(
      createIncrementalReindexer({
        artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 2 }),
        compute: computeRuntime(),
        maxNodes: 4,
        nodes: durableNodes,
        semanticChunker: {
          chunk: async () => [],
        },
      }).reindex(baseInput),
    ).rejects.toThrow("must expose replay defaults");

    const nodesWithoutAtomicPersistence = {
      ...durableNodes,
      completeGenerationAtomically: async () => undefined,
    } as unknown as typeof durableNodes;
    await expect(
      createIncrementalReindexer({
        artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 2 }),
        compute: computeRuntime(),
        maxNodes: 4,
        nodes: nodesWithoutAtomicPersistence,
        semanticChunker: echoSemanticChunker(() => undefined),
      }).reindex(baseInput),
    ).rejects.toThrow("requires atomic semantic generation receipts");
  });

  it("rejects semantic exclusions outside the canonical upper bound before model invocation", async () => {
    let llmCalls = 0;
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 2 }),
      compute: computeRuntime(),
      maxNodes: 4,
      nodes: createInMemoryKnowledgeNodeRepository({
        maxBatchSize: 4,
        maxListLimit: 4,
        maxNodes: 4,
      }),
      semanticChunker: echoSemanticChunker(() => llmCalls++),
    });

    await expect(
      reindexer.reindex({
        excludedNodeOrdinals: [-1],
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact(),
        projectionVersion: 1,
        publicationGenerationId: GENERATION_A,
        retrievalProfile: retrievalProfile(),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("exclusions exceed the canonical chunk upper bound");
    expect(llmCalls).toBe(0);
  });

  it("builds a multi-chunk receipt with a compact optional completion identity", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    let llmCalls = 0;
    const source = ParseArtifactSchema.parse({
      ...parseArtifact(),
      artifactHash: "c".repeat(64),
      elements: [
        {
          id: "two-sentences",
          metadata: {},
          sectionPath: ["Receipt"],
          text: "First sentence. Second sentence.",
          type: "paragraph",
        },
      ],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    });
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 2 }),
      compute: computeRuntime(),
      maxNodes: 4,
      nodes,
      semanticChunker: compactCompletionSemanticChunker(() => llmCalls++),
    });

    await expect(
      reindexer.reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: source,
        projectionVersion: 1,
        publicationGenerationId: GENERATION_A,
        retrievalProfile: retrievalProfile(),
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ nodesCreated: 2 });
    expect(llmCalls).toBe(1);
    await expect(
      nodes.getGenerationReceipt?.({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifactId: source.id,
        publicationGenerationId: GENERATION_A,
      }),
    ).resolves.toMatchObject({
      completionCatalog: [{ fingerprint: expect.stringMatching(/^sha256:/u) }],
      documentChunkCount: 2,
      windowManifest: [expect.objectContaining({ chunkRanges: expect.any(Array) })],
    });
  });

  it("fails closed when a semantic chunker returns corrupt receipt markers", async () => {
    const baseInput = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 1,
      publicationGenerationId: GENERATION_A,
      retrievalProfile: retrievalProfile(),
      tenantId: "tenant-1",
    } as const;
    const cases: Array<{
      error: string;
      mutate: (
        node: ReturnType<typeof KnowledgeNodeSchema.parse>,
      ) => ReturnType<typeof KnowledgeNodeSchema.parse>;
    }> = [
      {
        error: "cannot build semantic window receipt from node marker",
        mutate: (node) =>
          KnowledgeNodeSchema.parse({
            ...node,
            metadata: { ...node.metadata, semanticChunking: null },
          }),
      },
      {
        error: "cannot build semantic window receipt from node marker",
        mutate: (node) => {
          const marker = node.metadata.semanticChunking as Record<string, unknown>;
          return KnowledgeNodeSchema.parse({
            ...node,
            metadata: { ...node.metadata, semanticChunking: { ...marker, unitRange: null } },
          });
        },
      },
      {
        error: "cannot build semantic window receipt from node marker",
        mutate: (node) => {
          const marker = node.metadata.semanticChunking as Record<string, unknown>;
          return KnowledgeNodeSchema.parse({
            ...node,
            metadata: { ...node.metadata, semanticChunking: { ...marker, windowId: " " } },
          });
        },
      },
      {
        error: "cannot build semantic window receipt from node marker",
        mutate: (node) => {
          const marker = node.metadata.semanticChunking as Record<string, unknown>;
          return KnowledgeNodeSchema.parse({
            ...node,
            metadata: {
              ...node.metadata,
              semanticChunking: { ...marker, inputFingerprint: "invalid" },
            },
          });
        },
      },
      {
        error: "cannot build semantic window receipt from node marker",
        mutate: (node) =>
          KnowledgeNodeSchema.parse({
            ...node,
            metadata: { ...node.metadata, chunkIndex: 1 },
          }),
      },
      {
        error: "semantic completion identity is missing",
        mutate: (node) => {
          const marker = node.metadata.semanticChunking as Record<string, unknown>;
          return KnowledgeNodeSchema.parse({
            ...node,
            metadata: { ...node.metadata, semanticChunking: { ...marker, completion: null } },
          });
        },
      },
      {
        error: "semantic completion actualModel is invalid",
        mutate: (node) => {
          const marker = node.metadata.semanticChunking as Record<string, unknown>;
          const completion = marker.completion as Record<string, unknown>;
          return KnowledgeNodeSchema.parse({
            ...node,
            metadata: {
              ...node.metadata,
              semanticChunking: {
                ...marker,
                completion: { ...completion, actual: { model: " " } },
              },
            },
          });
        },
      },
    ];

    for (const testCase of cases) {
      const base = echoSemanticChunker(() => undefined);
      const corruptingChunker = {
        ...base,
        chunk: async (input: Parameters<typeof base.chunk>[0]) =>
          (await base.chunk(input)).map(testCase.mutate),
      };
      await expect(
        createIncrementalReindexer({
          artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 2 }),
          compute: computeRuntime(),
          maxNodes: 4,
          nodes: createInMemoryKnowledgeNodeRepository({
            maxBatchSize: 4,
            maxListLimit: 4,
            maxNodes: 4,
          }),
          semanticChunker: corruptingChunker,
        }).reindex(baseInput),
      ).rejects.toThrow(testCase.error);
    }
  });
});
