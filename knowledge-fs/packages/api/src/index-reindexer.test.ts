import type { ComputeRuntime } from "@knowledge/compute";
import {
  IndexProjectionSchema,
  KnowledgeNodeSchema,
  PUBLICATION_GENERATION_ID_SENTINEL,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createFtsProjectionBuilder,
  createVisualEmbeddingProjectionBuilder,
} from "./index-projection-builders";
import type { EmbedVisualAssetsInput } from "./index-projection-builders";
import {
  type UpdateIndexProjectionStatusByIdsInput,
  createInMemoryIndexProjectionRepository,
} from "./index-projection-repository";
import { createIncrementalReindexer } from "./index-reindexer";
import { createInMemoryKnowledgeFsLeaseRepository } from "./knowledge-fs-lease-repository";
import { createKnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const DOCUMENT_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const PUBLICATION_GENERATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";

function parseArtifact(overrides: Record<string, unknown> = {}) {
  return ParseArtifactSchema.parse({
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt: "2026-05-12T12:00:00.000Z",
    documentAssetId: DOCUMENT_ASSET_ID,
    elements: [
      {
        id: "element-1",
        sectionPath: ["Policy"],
        sourceLocation: { endOffset: 20, startOffset: 0 },
        text: "Policy renewal chunk",
        type: "paragraph",
      },
    ],
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: {},
    parser: "native-markdown",
    version: 1,
    ...overrides,
  });
}

function computeRuntime(): ComputeRuntime {
  return {
    chunkParseArtifact: (input) => [
      KnowledgeNodeSchema.parse({
        artifactHash: input.parseArtifact.artifactHash,
        documentAssetId: input.parseArtifact.documentAssetId,
        endOffset: 20,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42",
        kind: "chunk",
        knowledgeSpaceId: input.knowledgeSpaceId,
        metadata: { elementIds: ["element-1"] },
        parseArtifactId: input.parseArtifact.id,
        permissionScope: input.permissionScope ? [...input.permissionScope] : undefined,
        sourceLocation: { endOffset: 20, sectionPath: ["Policy"], startOffset: 0 },
        startOffset: 0,
        text: "Policy renewal chunk",
      }),
    ],
    countApproxTokens: () => 1,
    countTokens: () => 1,
    diffText: () => ({ operations: [], stats: { delete: 0, equal: 0, insert: 0 } }),
    packEvidence: () => ({ context: "", items: [], omitted: [], tokenBudget: 1, usedTokens: 0 }),
    rrfFuse: () => [],
  };
}

describe("incremental reindexer", () => {
  it("writes generation-scoped nodes and keeps them out of legacy reads", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const builtNodeIds: string[] = [];
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
      compute: computeRuntime(),
      ftsBuilder: {
        build: async (input) => {
          builtNodeIds.push(...input.nodes.map((node) => node.id));
          return [];
        },
      },
      maxNodes: 4,
      nodes,
    });

    const first = await reindexer.reindex({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 1,
      publicationGenerationId: PUBLICATION_GENERATION_ID,
    });
    const secondGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
    const second = await reindexer.reindex({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
      projectionVersion: 1,
      publicationGenerationId: secondGenerationId,
    });

    expect(first).toMatchObject({ nodesCreated: 1, status: "rebuilt" });
    expect(second).toMatchObject({ nodesCreated: 1, status: "rebuilt" });
    if (first.status !== "rebuilt" || second.status !== "rebuilt") {
      throw new Error("Expected generation-scoped reindex to rebuild nodes");
    }
    expect(first.nodeIds).toHaveLength(1);
    expect(second.nodeIds).toHaveLength(1);
    expect(first.nodeIds?.[0]).not.toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f2d42");
    expect(second.nodeIds?.[0]).not.toBe(first.nodeIds?.[0]);
    expect(builtNodeIds).toEqual([first.nodeIds?.[0], second.nodeIds?.[0]]);
    await expect(
      nodes.listByArtifact({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 4,
        parseArtifactId: parseArtifact().id,
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      nodes.listByArtifact({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 4,
        parseArtifactId: parseArtifact().id,
        publicationGenerationId: PUBLICATION_GENERATION_ID,
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: first.nodeIds?.[0],
          publicationGenerationId: PUBLICATION_GENERATION_ID,
        }),
      ],
    });
  });

  it("applies document chunk exclusions and persists the configured language on every node", async () => {
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const artifact = parseArtifact({
      artifactHash: "9".repeat(64),
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
    });
    const baseCompute = computeRuntime();
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
      compute: {
        ...baseCompute,
        chunkParseArtifact: (input) => {
          const first = baseCompute.chunkParseArtifact(input)[0];
          if (!first) throw new Error("Expected the test runtime to produce a chunk");
          return [
            first,
            KnowledgeNodeSchema.parse({
              ...first,
              endOffset: 42,
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d43",
              sourceLocation: { endOffset: 42, startOffset: 21 },
              startOffset: 21,
              text: "Excluded second chunk",
            }),
          ];
        },
      },
      maxNodes: 4,
      nodes,
    });

    await expect(
      reindexer.reindex({
        excludedNodeOrdinals: [1],
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        language: "zh-CN",
        parseArtifact: artifact,
        projectionVersion: 1,
      }),
    ).resolves.toMatchObject({ nodesCreated: 1, status: "rebuilt" });
    await expect(
      nodes.listByArtifact({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 4,
        parseArtifactId: artifact.id,
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          metadata: expect.objectContaining({ language: "zh-CN" }),
          text: "Policy renewal chunk",
        }),
      ],
    });
  });

  it("idempotently rebuilds unchanged artifacts so partial indexes can be repaired", async () => {
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxProjections: 4,
    });
    const existingArtifact = parseArtifact();
    await artifacts.create(existingArtifact);
    const chunkCalls: unknown[] = [];
    const compute: ComputeRuntime = {
      ...computeRuntime(),
      chunkParseArtifact: (input) => {
        chunkCalls.push(input);
        return computeRuntime().chunkParseArtifact(input);
      },
    };
    const reindexer = createIncrementalReindexer({
      artifacts,
      compute,
      ftsBuilder: createFtsProjectionBuilder({
        maxBatchSize: 4,
        projections,
      }),
      maxNodes: 4,
      nodes,
      projections,
    });

    await expect(
      reindexer.reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: existingArtifact,
        projectionVersion: 1,
      }),
    ).resolves.toMatchObject({
      nodesCreated: 1,
      projectionsCreated: 1,
      status: "rebuilt",
    });
    expect(chunkCalls).toHaveLength(1);

    const changedArtifact = parseArtifact({
      artifactHash: "b".repeat(64),
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    });
    await expect(
      reindexer.reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: changedArtifact,
        permissionScope: ["tenant:tenant-1"],
        projectionStatus: "ready",
        projectionVersion: 2,
      }),
    ).resolves.toMatchObject({
      artifact: {
        artifactHash: changedArtifact.artifactHash,
        id: existingArtifact.id,
      },
      nodesCreated: 1,
      projectionsCreated: 1,
      status: "rebuilt",
    });
    expect(chunkCalls).toHaveLength(2);
    expect(chunkCalls[1]).toEqual(
      expect.objectContaining({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: expect.objectContaining({
          artifactHash: changedArtifact.artifactHash,
          id: existingArtifact.id,
        }),
        permissionScope: ["tenant:tenant-1"],
      }),
    );
  });

  it("builds visual projections when a visual builder and model are configured", async () => {
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxProjections: 4,
    });
    const visualEmbedCalls: EmbedVisualAssetsInput[] = [];
    const reindexer = createIncrementalReindexer({
      artifacts,
      compute: {
        ...computeRuntime(),
        chunkParseArtifact: (input) => [
          ...computeRuntime().chunkParseArtifact(input),
          KnowledgeNodeSchema.parse({
            artifactHash: input.parseArtifact.artifactHash,
            documentAssetId: input.parseArtifact.documentAssetId,
            endOffset: 64,
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d44",
            kind: "image",
            knowledgeSpaceId: input.knowledgeSpaceId,
            metadata: {
              assetRef: {
                contentType: "image/png",
                objectKey: "tenant/spaces/space/assets/figure.png",
              },
              boundingBox: { height: 120, width: 240, x: 10, y: 20 },
              elementIds: ["figure-1"],
              elementTypes: ["image"],
            },
            parseArtifactId: input.parseArtifact.id,
            permissionScope: input.permissionScope ? [...input.permissionScope] : undefined,
            sourceLocation: {
              endOffset: 64,
              pageNumber: 3,
              sectionPath: ["Figures"],
              startOffset: 21,
            },
            startOffset: 21,
            text: "Figure caption",
          }),
        ],
      },
      maxNodes: 4,
      nodes,
      visualBuilder: createVisualEmbeddingProjectionBuilder({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2d60",
        maxBatchSize: 4,
        projections,
        provider: {
          embedAssets: async (input) => {
            visualEmbedCalls.push(input);
            return {
              dense: [[0.25, 0.75]],
              metadata: { model: "clip@1", provider: "static-vision" },
              model: "clip@1",
            };
          },
        },
      }),
    });

    await expect(
      reindexer.reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact({ artifactHash: "e".repeat(64) }),
        projectionVersion: 4,
        visualModel: "clip",
      }),
    ).resolves.toMatchObject({
      nodesCreated: 2,
      projectionsCreated: 1,
      status: "rebuilt",
    });
    expect(visualEmbedCalls).toHaveLength(1);
    expect(visualEmbedCalls[0]?.assets[0]).toMatchObject({
      assetRef: {
        contentType: "image/png",
        objectKey: "tenant/spaces/space/assets/figure.png",
      },
      modality: "image",
      sourceText: "Figure caption",
    });
  });

  it("keeps partial projections hidden and repairs them without duplicates on retry", async () => {
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxProjections: 8,
    });
    const ftsBuilder = createFtsProjectionBuilder({ maxBatchSize: 4, projections });
    const failing = createIncrementalReindexer({
      artifacts,
      compute: computeRuntime(),
      denseBuilder: {
        build: async () => {
          throw new Error("embedding unavailable");
        },
      },
      ftsBuilder,
      maxNodes: 4,
      nodes,
      projections,
    });

    await expect(
      failing.reindex({
        denseModel: "dense-v1",
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact(),
        projectionStatus: "ready",
        projectionVersion: 1,
      }),
    ).rejects.toThrow("embedding unavailable");
    await expect(
      projections.summarizeVersion({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionVersion: 1,
        type: "fts",
      }),
    ).resolves.toMatchObject({ failed: 1, ready: 0, total: 1 });

    const repaired = createIncrementalReindexer({
      artifacts,
      compute: computeRuntime(),
      ftsBuilder,
      maxNodes: 4,
      nodes,
      projections,
    });
    await expect(
      repaired.reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact(),
        projectionStatus: "ready",
        projectionVersion: 1,
      }),
    ).resolves.toMatchObject({ projectionsCreated: 1, status: "rebuilt" });
    await expect(
      projections.summarizeVersion({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionVersion: 1,
        type: "fts",
      }),
    ).resolves.toMatchObject({ failed: 0, ready: 1, total: 1 });

    const candidate = await repaired.reindex({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact({ artifactHash: "c".repeat(64) }),
      projectionStatus: "building",
      projectionVersion: 2,
    });
    expect(candidate).toMatchObject({ projectionsCreated: 1, status: "rebuilt" });
    if (candidate.status !== "rebuilt") {
      throw new Error("Expected the candidate reindex to rebuild projections");
    }
    await expect(
      projections.summarizeVersion({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionVersion: 1,
        type: "fts",
      }),
    ).resolves.toMatchObject({ failed: 0, ready: 1, total: 1 });
    await expect(
      projections.summarizeVersion({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionVersion: 2,
        type: "fts",
      }),
    ).resolves.toMatchObject({ building: 1, ready: 0, total: 1 });

    await expect(
      repaired.publishProjections?.({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionIds: candidate.projectionIds ?? [],
      }),
    ).resolves.toBe(1);
    await expect(
      repaired.failProjections?.({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionIds: candidate.projectionIds ?? [],
      }),
    ).resolves.toBe(1);
    await expect(
      projections.summarizeVersion({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionVersion: 1,
        type: "fts",
      }),
    ).resolves.toMatchObject({ failed: 0, ready: 1, total: 1 });
    await expect(
      projections.summarizeVersion({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionVersion: 2,
        type: "fts",
      }),
    ).resolves.toMatchObject({ building: 0, failed: 1, ready: 0, total: 1 });
  });

  it("can fail the whole candidate after a batched publication throws partway through", async () => {
    const statuses = new Map([
      ["projection-a", "building"],
      ["projection-b", "building"],
    ]);
    let publishBatch = 0;
    const reindexer = createIncrementalReindexer({
      artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
      compute: computeRuntime(),
      maxNodes: 4,
      maxProjectionBatchSize: 1,
      nodes: createInMemoryKnowledgeNodeRepository({
        maxBatchSize: 4,
        maxListLimit: 4,
        maxNodes: 4,
      }),
      projections: {
        updateStatusByIds: async ({
          fromStatus,
          projectionIds,
          status,
        }: UpdateIndexProjectionStatusByIdsInput) => {
          if (status === "ready") {
            publishBatch += 1;
            if (publishBatch === 2) {
              throw new Error("publication batch failed");
            }
          }

          let updated = 0;
          for (const projectionId of projectionIds) {
            if (statuses.get(projectionId) === fromStatus) {
              statuses.set(projectionId, status);
              updated += 1;
            }
          }
          return updated;
        },
      } as unknown as Parameters<typeof createIncrementalReindexer>[0]["projections"],
    });
    const candidate = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      projectionIds: ["projection-a", "projection-b"],
    };

    await expect(reindexer.publishProjections?.(candidate)).rejects.toThrow(
      "publication batch failed",
    );
    expect(Object.fromEntries(statuses)).toEqual({
      "projection-a": "ready",
      "projection-b": "building",
    });
    await expect(reindexer.failProjections?.(candidate)).resolves.toBe(2);
    expect(Object.fromEntries(statuses)).toEqual({
      "projection-a": "failed",
      "projection-b": "failed",
    });
  });

  it("rejects a model that changes dimension between reindex batches", async () => {
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const baseNode = computeRuntime().chunkParseArtifact({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      parseArtifact: parseArtifact(),
    })[0];
    if (!baseNode) {
      throw new Error("Expected the test compute runtime to produce a node");
    }
    let buildIndex = 0;
    const reindexer = createIncrementalReindexer({
      artifacts,
      compute: {
        ...computeRuntime(),
        chunkParseArtifact: () => [
          baseNode,
          KnowledgeNodeSchema.parse({
            ...baseNode,
            endOffset: 42,
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d43",
            sourceLocation: { endOffset: 42, sectionPath: ["Policy"], startOffset: 21 },
            startOffset: 21,
            text: "Second policy chunk",
          }),
        ],
      },
      denseBuilder: {
        build: async (input) => {
          const index = buildIndex;
          buildIndex += 1;

          return [
            IndexProjectionSchema.parse({
              id:
                index === 0
                  ? "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61"
                  : "018f0d60-7a49-7cc2-9c1b-5b36f18f2d62",
              knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
              metadata: { dimension: index === 0 ? 2 : 3 },
              model: "dynamic-model@1",
              nodeId: input.nodes[0]?.id,
              projectionVersion: input.projectionVersion,
              status: input.status ?? "building",
              type: "dense-vector",
            }),
          ];
        },
      },
      maxNodes: 4,
      maxProjectionBatchSize: 1,
      nodes,
    });

    await expect(
      reindexer.reindex({
        denseModel: "dynamic-model",
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact({ artifactHash: "9".repeat(64) }),
        projectionVersion: 1,
      }),
    ).rejects.toThrow("inconsistent text embedding space");
  });

  it("validates bounded configuration, dense model requirements, and max node output", async () => {
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const compute = computeRuntime();

    expect(() =>
      createIncrementalReindexer({
        artifacts,
        compute,
        maxNodes: 0,
        nodes,
      }),
    ).toThrow("Incremental reindexer maxNodes must be at least 1");

    await expect(
      createIncrementalReindexer({
        artifacts,
        compute,
        denseBuilder: { build: async () => [] },
        maxNodes: 4,
        nodes,
      }).reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact({ artifactHash: "c".repeat(64) }),
        projectionVersion: 1,
      }),
    ).rejects.toThrow(
      "Incremental reindexer denseModel is required when denseBuilder is configured",
    );

    await expect(
      createIncrementalReindexer({
        artifacts,
        compute,
        maxNodes: 4,
        nodes,
        visualBuilder: { build: async () => [] },
      }).reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact({ artifactHash: "e".repeat(64) }),
        projectionVersion: 1,
      }),
    ).rejects.toThrow(
      "Incremental reindexer visualModel is required when visualBuilder is configured",
    );

    await expect(
      createIncrementalReindexer({
        artifacts,
        compute,
        maxNodes: 4,
        nodes,
      }).reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact({ artifactHash: "f".repeat(64) }),
        projectionVersion: 1,
        publicationGenerationId: "not-a-uuid",
      }),
    ).rejects.toThrow();

    await expect(
      createIncrementalReindexer({
        artifacts,
        compute,
        maxNodes: 4,
        nodes,
      }).reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact({ artifactHash: "0".repeat(64) }),
        projectionVersion: 1,
        publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
      }),
    ).rejects.toThrow("Publication generation ID must be a non-zero UUID");

    await expect(
      createIncrementalReindexer({
        artifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 4 }),
        compute: {
          ...compute,
          chunkParseArtifact: (input) => [
            ...compute.chunkParseArtifact(input),
            KnowledgeNodeSchema.parse({
              ...compute.chunkParseArtifact(input)[0],
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d43",
              endOffset: 42,
              sourceLocation: { endOffset: 42, startOffset: 21 },
              startOffset: 21,
              text: "Second chunk",
            }),
          ],
        },
        maxNodes: 1,
        nodes,
      }).reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: parseArtifact({ artifactHash: "d".repeat(64) }),
        projectionVersion: 1,
      }),
    ).rejects.toThrow("Incremental reindexer node count exceeds maxNodes=1");
  });

  it("wraps tenant-scoped reindex work in a reindex lease", async () => {
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    const reindexer = createIncrementalReindexer({
      artifacts,
      compute: computeRuntime(),
      maxNodes: 4,
      nodes,
      operationLeases: createKnowledgeFsOperationLeaseCoordinator({
        generateLeaseId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f5d01",
        leaseTtlMs: 60_000,
        leases,
        now: () => "2026-05-27T10:00:00.000Z",
        sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      }),
    });
    const artifact = parseArtifact({
      artifactHash: "f".repeat(64),
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
    });

    await expect(
      reindexer.reindex({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        parseArtifact: artifact,
        projectionVersion: 3,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ status: "rebuilt" });
    await expect(
      leases.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5d01",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      leaseType: "reindex",
      status: "released",
      targetId: artifact.id,
      targetVersion: 3,
      virtualPath: `/knowledge/artifacts/${artifact.id}`,
    });
  });
});
