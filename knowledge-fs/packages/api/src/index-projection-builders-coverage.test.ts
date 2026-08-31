import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import type { IndexProjection, KnowledgeNode } from "@knowledge/core";
import { KnowledgeNodeSchema } from "@knowledge/core";
import type { EmbedTextsInput, EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it } from "vitest";

import { createDocumentModelBudget } from "./document-model-budget";
import {
  createDenseVectorProjectionBuilder,
  createFtsProjectionBuilder,
  createObjectStorageVisualEmbeddingProvider,
  createTextSurrogateVisualEmbeddingProvider,
  createVisualEmbeddingProjectionBuilder,
} from "./index-projection-builders";
import type { EmbedVisualAssetsInput, EmbedVisualImagesInput } from "./index-projection-builders";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { IngestionModelCallOperationalMetric } from "./ingestion-model-observability";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const DOCUMENT_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const PARSE_ARTIFACT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

function createTestPlatformAdapter() {
  return {
    objectStorage: createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 128 * 1024 * 1024,
    }),
  };
}

function knowledgeNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: DOCUMENT_ASSET_ID,
    endOffset: 12,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a00",
    kind: "chunk",
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    metadata: { chunkIndex: 0 },
    parseArtifactId: PARSE_ARTIFACT_ID,
    permissionScope: ["tenant:tenant-1"],
    sourceLocation: { endOffset: 12, sectionPath: ["Intro"], startOffset: 0 },
    startOffset: 0,
    text: "coverage node text",
    ...overrides,
  });
}

function createRecordingProjectionRepository() {
  const created: IndexProjection[][] = [];
  const repository: IndexProjectionRepository = {
    createMany: async (projections) => {
      created.push(projections.map((projection) => ({ ...projection })));
      return projections.map((projection) => ({ ...projection }));
    },
    deleteByNodeIds: async () => 0,
    listReadyBySpace: async () => ({ items: [] }),
    pruneInactiveVersions: async () => 0,
    publishVersion: async () => ({ published: 0, staled: 0 }),
    rollbackVersion: async () => ({ failed: 0 }),
    summarizeVersion: async () => ({ building: 0, failed: 0, ready: 0, stale: 0, total: 0 }),
  };

  return { created, repository };
}

function staticEmbeddings(record?: EmbedTextsInput[]): EmbeddingProvider {
  return {
    embed: async (input) => {
      record?.push(input);
      return {
        dense: input.texts.map(() => [0.5, 0.5]),
        metadata: { model: "model-a@1", provider: "static" },
        model: "model-a@1",
      };
    },
    kind: "static",
    models: async () => [],
  };
}

function imageNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return knowledgeNode({
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a20",
    kind: "image",
    metadata: {
      assetRef: { contentType: "image/png", objectKey: "tenant/spaces/space/assets/figure.png" },
      elementIds: ["figure-1"],
      elementTypes: ["image"],
    },
    text: "Revenue chart",
    ...overrides,
  });
}

function visualImageAsset(objectKey: string, nodeId: string) {
  return {
    assetRef: { objectKey },
    documentAssetId: DOCUMENT_ASSET_ID,
    metadata: {},
    modality: "image",
    nodeId,
    sourceText: nodeId,
  };
}

describe("index projection builders coverage", () => {
  it("rejects sparse dense vectors from the embedding provider", async () => {
    const { repository } = createRecordingProjectionRepository();
    const builder = createDenseVectorProjectionBuilder({
      embeddings: {
        embed: async () => ({
          dense: new Array<number[]>(1),
          metadata: { model: "model-a@1", provider: "static" },
          model: "model-a@1",
        }),
        kind: "static",
        models: async () => [],
      },
      maxBatchSize: 2,
      projections: repository,
    });

    await expect(
      builder.build({ model: "model-a", nodes: [knowledgeNode()], projectionVersion: 1 }),
    ).rejects.toThrow("Embedding provider returned an invalid dense vector");
  });

  it("rejects invalid FTS projection versions", async () => {
    const { repository } = createRecordingProjectionRepository();
    const builder = createFtsProjectionBuilder({ maxBatchSize: 2, projections: repository });

    await expect(builder.build({ nodes: [knowledgeNode()], projectionVersion: 0 })).rejects.toThrow(
      "FTS projection version must be a positive integer",
    );
    await expect(builder.build({ nodes: [], projectionVersion: 1 })).rejects.toThrow(
      "FTS projection batch must contain at least 1 node",
    );
    await expect(
      builder.build({
        nodes: [
          knowledgeNode(),
          knowledgeNode({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01" }),
          knowledgeNode({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02" }),
        ],
        projectionVersion: 1,
      }),
    ).rejects.toThrow("FTS projection batch size exceeds maxBatchSize=2");
  });

  it("validates visual embedding projection build inputs", async () => {
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 1,
      projections: repository,
      provider: {
        embedAssets: async () => {
          throw new Error("provider should not be called");
        },
      },
    });

    await expect(
      builder.build({ model: "  ", nodes: [knowledgeNode()], projectionVersion: 1 }),
    ).rejects.toThrow("Visual embedding projection model is required");
    await expect(
      builder.build({ model: "clip", nodes: [knowledgeNode()], projectionVersion: 1.5 }),
    ).rejects.toThrow("Visual embedding projection version must be a positive integer");
    await expect(builder.build({ model: "clip", nodes: [], projectionVersion: 1 })).rejects.toThrow(
      "Visual embedding projection batch must contain at least 1 node",
    );
    await expect(
      builder.build({
        model: "clip",
        nodes: [knowledgeNode(), knowledgeNode({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01" })],
        projectionVersion: 1,
      }),
    ).rejects.toThrow("Visual embedding projection batch size exceeds maxBatchSize=1");
  });

  it("passes tenantId through the visual builder and text-surrogate provider", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 2,
      projections: repository,
      provider: createTextSurrogateVisualEmbeddingProvider({
        embeddings: staticEmbeddings(embedCalls),
      }),
    });

    const projections = await builder.build({
      model: "model-a",
      nodes: [imageNode()],
      projectionVersion: 1,
      tenantId: "tenant-42",
    });

    expect(embedCalls).toEqual([
      expect.objectContaining({ model: "model-a", tenantId: "tenant-42" }),
    ]);
    expect(projections).toHaveLength(1);
  });

  it("rejects strict visual providers returning a mismatched vector count", async () => {
    const metrics: IngestionModelCallOperationalMetric[] = [];
    const { created, repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 2,
      metrics: {
        record: (metric) => {
          metrics.push(metric);
        },
      },
      projections: repository,
      provider: {
        embedAssets: async () => ({
          dense: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
          metadata: { model: "clip@1", provider: "static-vision" },
          model: "clip@1",
        }),
      },
    });

    await expect(
      builder.build({ model: "clip", nodes: [imageNode()], projectionVersion: 1 }),
    ).rejects.toThrow("Visual embedding provider returned 2 vectors for 1 assets");
    expect(created).toEqual([]);
    expect(metrics).toMatchObject([{ outcome: "failed", stage: "visual-embedding" }]);
  });

  it("reports failed instead of succeeded when visual projection persistence fails", async () => {
    const metrics: IngestionModelCallOperationalMetric[] = [];
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 1,
      metrics: {
        record: (metric) => {
          metrics.push(metric);
        },
      },
      projections: {
        ...repository,
        createMany: async () => {
          throw new Error("visual projection persistence failed");
        },
      },
      provider: {
        embedAssets: async () => ({
          dense: [[0.1, 0.9]],
          metadata: { model: "clip@1", provider: "static-vision" },
          model: "clip@1",
        }),
      },
    });

    await expect(
      builder.build({ model: "clip", nodes: [imageNode()], projectionVersion: 1 }),
    ).rejects.toThrow("visual projection persistence failed");
    expect(metrics).toMatchObject([{ outcome: "failed", stage: "visual-embedding" }]);
  });

  it("returns no projections when a partial provider embeds zero assets", async () => {
    const { created, repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 2,
      projections: repository,
      provider: {
        embedAssets: async () => ({
          dense: [],
          embeddedNodeIds: [],
          metadata: { model: "clip@1", provider: "static-vision" },
          model: "clip@1",
        }),
      },
    });

    await expect(
      builder.build({ model: "clip", nodes: [imageNode()], projectionVersion: 1 }),
    ).resolves.toEqual([]);
    expect(created).toHaveLength(0);
  });

  it("rejects partial providers that report an embedded node without a vector", async () => {
    const { repository } = createRecordingProjectionRepository();
    const node = imageNode();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 2,
      projections: repository,
      provider: {
        embedAssets: async ({ assets }) => ({
          dense: new Array<number[]>(assets.length),
          embeddedNodeIds: assets.map((asset) => asset.nodeId),
          metadata: { model: "clip@1", provider: "static-vision" },
          model: "clip@1",
        }),
      },
    });

    await expect(
      builder.build({ model: "clip", nodes: [node], projectionVersion: 1 }),
    ).rejects.toThrow("Visual embedding provider returned an invalid dense vector");
  });

  it("falls back to a modality surrogate for assets without any text", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const provider = createTextSurrogateVisualEmbeddingProvider({
      embeddings: staticEmbeddings(embedCalls),
    });

    await provider.embedAssets({
      assets: [
        {
          assetRef: {},
          documentAssetId: DOCUMENT_ASSET_ID,
          metadata: { caption: "   " },
          modality: "image",
          nodeId: "node-9",
          sourceText: "   ",
        },
      ],
      model: "model-a",
    });

    expect(embedCalls[0]?.texts).toEqual(["image asset node-9"]);
    expect(embedCalls[0]).not.toHaveProperty("tenantId");
  });

  it("validates object-storage visual embedding provider options", () => {
    const adapter = createTestPlatformAdapter();
    const baseOptions = {
      objectStorage: adapter.objectStorage,
      provider: {
        embedImages: async () => {
          throw new Error("unused");
        },
      },
    };

    expect(() =>
      createObjectStorageVisualEmbeddingProvider({
        maxAssetBytes: 0,
        ...baseOptions,
      }),
    ).toThrow("Object-storage visual embedding maxAssetBytes must be at least 1");
    expect(() =>
      createObjectStorageVisualEmbeddingProvider({
        maxBatchAssetCount: 0,
        ...baseOptions,
      }),
    ).toThrow("Object-storage visual embedding maxBatchAssetCount must be at least 1");
    expect(() =>
      createObjectStorageVisualEmbeddingProvider({
        maxBatchBytes: 0,
        ...baseOptions,
      }),
    ).toThrow("Object-storage visual embedding maxBatchBytes must be at least 1");
    expect(() =>
      createObjectStorageVisualEmbeddingProvider({
        maxAssetBytes: 8,
        maxBatchBytes: 7,
        ...baseOptions,
      }),
    ).toThrow("Object-storage visual embedding maxBatchBytes must be at least maxAssetBytes=8");
  });

  it("bounds image-byte requests by asset count and total bytes while preserving result order", async () => {
    const adapter = createTestPlatformAdapter();
    const sizes = [3, 3, 5, 2, 4];
    for (const [index, size] of sizes.entries()) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array(size).fill(index + 1),
        contentType: "image/png",
        key: `assets/image-${index + 1}.png`,
        metadata: {},
      });
    }
    const requestNodeIds: string[][] = [];
    const requestByteCounts: number[] = [];
    let residentImageBytes = 0;
    let peakResidentImageBytes = 0;
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 6,
      maxBatchAssetCount: 2,
      maxBatchBytes: 10,
      objectStorage: {
        ...adapter.objectStorage,
        getObjectStream: async (key) => {
          const stream = await adapter.objectStorage.getObjectStream(key);
          if (!stream) return null;
          const reader = stream.getReader();
          return new ReadableStream<Uint8Array>({
            cancel: (reason) => reader.cancel(reason),
            pull: async (controller) => {
              const chunk = await reader.read();
              if (chunk.done) {
                controller.close();
                return;
              }
              residentImageBytes += chunk.value.byteLength;
              peakResidentImageBytes = Math.max(peakResidentImageBytes, residentImageBytes);
              controller.enqueue(chunk.value);
            },
          });
        },
      },
      provider: {
        embedImages: async (input) => {
          requestNodeIds.push(input.images.map((image) => image.nodeId));
          const requestBytes = input.images.reduce(
            (total, image) => total + image.body.byteLength,
            0,
          );
          requestByteCounts.push(requestBytes);
          residentImageBytes -= requestBytes;
          return {
            dense: input.images.map((image) => [Number(image.nodeId.slice(5)), 0.5]),
            metadata: {
              model: "clip-image@1",
              provider: "static-image",
              usage: { totalTokens: input.images.length },
            },
            model: "clip-image@1",
          };
        },
        kind: "bytes",
      },
    });

    const result = await provider.embedAssets({
      assets: sizes.map((_, index) => ({
        assetRef: { objectKey: `assets/image-${index + 1}.png` },
        documentAssetId: DOCUMENT_ASSET_ID,
        metadata: {},
        modality: "image",
        nodeId: `node-${index + 1}`,
        sourceText: `image ${index + 1}`,
      })),
      model: "clip-image",
    });

    expect(requestNodeIds).toEqual([["node-1", "node-2"], ["node-3"], ["node-4", "node-5"]]);
    expect(requestByteCounts).toEqual([6, 5, 6]);
    expect(requestNodeIds.every((batch) => batch.length <= 2)).toBe(true);
    expect(requestByteCounts.every((bytes) => bytes <= 10)).toBe(true);
    expect(peakResidentImageBytes).toBeLessThanOrEqual(10);
    expect(residentImageBytes).toBe(0);
    expect(result).toEqual({
      dense: [
        [1, 0.5],
        [2, 0.5],
        [3, 0.5],
        [4, 0.5],
        [5, 0.5],
      ],
      embeddedNodeIds: ["node-1", "node-2", "node-3", "node-4", "node-5"],
      metadata: {
        model: "clip-image@1",
        provider: "static-image:bytes:image-bytes",
        providerCalls: 3,
        usage: { totalTokens: 5 },
      },
      model: "clip-image@1",
    });
  });

  it("accounts for visual microbatches in the document model budget and stage metrics", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2, 3]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/budget-${index}.png`,
        metadata: {},
      });
    }
    const metrics: IngestionModelCallOperationalMetric[] = [];
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 3,
      metrics: {
        record: (metric) => {
          metrics.push(metric);
        },
      },
      projections: repository,
      provider: createObjectStorageVisualEmbeddingProvider({
        maxAssetBytes: 1,
        maxBatchAssetCount: 2,
        maxBatchBytes: 2,
        objectStorage: adapter.objectStorage,
        provider: {
          embedImages: async (input) => ({
            dense: input.images.map(() => [0.2, 0.8]),
            metadata: { model: "clip-image@1", provider: "static-image" },
            model: "clip-image@1",
          }),
        },
      }),
    });
    const budget = createDocumentModelBudget({ maxEstimatedTokens: 1, maxRequests: 2 });

    const projections = await builder.build({
      model: "clip-image",
      modelBudget: budget,
      nodes: [1, 2, 3].map((index) =>
        imageNode({
          id: `018f0d60-7a49-7cc2-9c1b-5b36f18f8a2${index}`,
          metadata: {
            assetRef: { objectKey: `assets/budget-${index}.png` },
            elementIds: [`figure-${index}`],
            elementTypes: ["image"],
          },
        }),
      ),
      projectionVersion: 1,
    });

    expect(projections).toHaveLength(3);
    expect(budget.snapshot()).toMatchObject({
      requestsReserved: 2,
      stageRequests: { "visual-embedding": 2 },
    });
    expect(metrics).toMatchObject([{ itemCount: 3, providerCalls: 2, stage: "visual-embedding" }]);
  });

  it("stops before the next visual microbatch when the caller aborts", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/abort-${index}.png`,
        metadata: {},
      });
    }
    const controller = new AbortController();
    let providerCalls = 0;
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 1,
      maxBatchAssetCount: 1,
      maxBatchBytes: 1,
      objectStorage: adapter.objectStorage,
      provider: {
        embedImages: async () => {
          providerCalls += 1;
          controller.abort();
          return {
            dense: [[0.2, 0.8]],
            metadata: { model: "clip-image@1", provider: "static-image" },
            model: "clip-image@1",
          };
        },
      },
    });

    await expect(
      provider.embedAssets({
        assets: [1, 2].map((index) => ({
          assetRef: { objectKey: `assets/abort-${index}.png` },
          documentAssetId: DOCUMENT_ASSET_ID,
          metadata: {},
          modality: "image",
          nodeId: `node-${index}`,
          sourceText: `image ${index}`,
        })),
        model: "clip-image",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(providerCalls).toBe(1);
  });

  it("rejects vector-dimension drift between visual microbatches", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/dimension-${index}.png`,
        metadata: {},
      });
    }
    let providerCalls = 0;
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 1,
      maxBatchAssetCount: 1,
      maxBatchBytes: 1,
      objectStorage: adapter.objectStorage,
      provider: {
        embedImages: async () => {
          providerCalls += 1;
          return {
            dense: [providerCalls === 1 ? [0.2, 0.8] : [0.1, 0.2, 0.7]],
            metadata: { model: "clip-image@1", provider: "static-image" },
            model: "clip-image@1",
          };
        },
      },
    });

    await expect(
      provider.embedAssets({
        assets: [1, 2].map((index) => ({
          assetRef: { objectKey: `assets/dimension-${index}.png` },
          documentAssetId: DOCUMENT_ASSET_ID,
          metadata: {},
          modality: "image",
          nodeId: `node-${index}`,
          sourceText: `image ${index}`,
        })),
        model: "clip-image",
      }),
    ).rejects.toThrow(
      "Visual embedding image provider returned dimension=3; expected dimension=2 across batches",
    );
  });

  it("rejects model or provider identity drift between visual microbatches", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/identity-${index}.png`,
        metadata: {},
      });
    }
    let providerCalls = 0;
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 1,
      maxBatchAssetCount: 1,
      maxBatchBytes: 1,
      objectStorage: adapter.objectStorage,
      provider: {
        embedImages: async () => {
          providerCalls += 1;
          return {
            dense: [[0.2, 0.8]],
            metadata: {
              model: providerCalls === 1 ? "clip-image@1" : "clip-image@2",
              provider: "static-image",
            },
            model: providerCalls === 1 ? "clip-image@1" : "clip-image@2",
          };
        },
      },
    });

    await expect(
      provider.embedAssets({
        assets: [1, 2].map((index) => ({
          assetRef: { objectKey: `assets/identity-${index}.png` },
          documentAssetId: DOCUMENT_ASSET_ID,
          metadata: {},
          modality: "image",
          nodeId: `node-${index}`,
          sourceText: `image ${index}`,
        })),
        model: "clip-image",
      }),
    ).rejects.toThrow("Visual embedding image provider returned inconsistent batch identities");
  });

  it("rejects hidden nested provider calls at the image-byte request boundary", async () => {
    const adapter = createTestPlatformAdapter();
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1]),
      contentType: "image/png",
      key: "assets/nested-calls.png",
      metadata: {},
    });
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 1,
      maxBatchBytes: 1,
      objectStorage: adapter.objectStorage,
      provider: {
        embedImages: async () => ({
          dense: [[0.2, 0.8]],
          metadata: {
            model: "clip-image@1",
            provider: "static-image",
            providerCalls: 2,
          },
          model: "clip-image@1",
        }),
      },
    });

    await expect(
      provider.embedAssets({
        assets: [
          {
            assetRef: { objectKey: "assets/nested-calls.png" },
            documentAssetId: DOCUMENT_ASSET_ID,
            metadata: {},
            modality: "image",
            nodeId: "node-1",
            sourceText: "image 1",
          },
        ],
        model: "clip-image",
      }),
    ).rejects.toThrow(
      "Visual embedding image provider must issue exactly one physical request per embedImages call",
    );
  });

  it("restores original asset order when an image provider returns a partial reordered batch", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2, 3]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/partial-${index}.png`,
        metadata: {},
      });
    }
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 1,
      maxBatchAssetCount: 3,
      maxBatchBytes: 3,
      objectStorage: adapter.objectStorage,
      provider: {
        embedImages: async () => ({
          dense: [
            [3, 0.5],
            [1, 0.5],
          ],
          embeddedNodeIds: ["node-3", "node-1"],
          metadata: { model: "clip-image@1", provider: "static-image" },
          model: "clip-image@1",
        }),
      },
    });

    await expect(
      provider.embedAssets({
        assets: [1, 2, 3].map((index) => ({
          assetRef: { objectKey: `assets/partial-${index}.png` },
          documentAssetId: DOCUMENT_ASSET_ID,
          metadata: {},
          modality: "image",
          nodeId: `node-${index}`,
          sourceText: `image ${index}`,
        })),
        model: "clip-image",
      }),
    ).resolves.toMatchObject({
      dense: [
        [1, 0.5],
        [3, 0.5],
      ],
      embeddedNodeIds: ["node-1", "node-3"],
    });
  });

  it("reports attempted visual provider calls and persists nothing after a later batch fails", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/failure-${index}.png`,
        metadata: {},
      });
    }
    const metrics: IngestionModelCallOperationalMetric[] = [];
    const { created, repository } = createRecordingProjectionRepository();
    let providerCalls = 0;
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 2,
      metrics: {
        record: (metric) => {
          metrics.push(metric);
        },
      },
      projections: repository,
      provider: createObjectStorageVisualEmbeddingProvider({
        maxAssetBytes: 1,
        maxBatchAssetCount: 1,
        maxBatchBytes: 1,
        objectStorage: adapter.objectStorage,
        provider: {
          embedImages: async () => {
            providerCalls += 1;
            if (providerCalls === 2) throw new Error("second request failed");
            return {
              dense: [[0.2, 0.8]],
              metadata: { model: "clip-image@1", provider: "static-image" },
              model: "clip-image@1",
            };
          },
        },
      }),
    });

    await expect(
      builder.build({
        model: "clip-image",
        nodes: [1, 2].map((index) =>
          imageNode({
            id: `018f0d60-7a49-7cc2-9c1b-5b36f18f8b2${index}`,
            metadata: {
              assetRef: { objectKey: `assets/failure-${index}.png` },
              elementIds: [`figure-${index}`],
              elementTypes: ["image"],
            },
          }),
        ),
        projectionVersion: 1,
      }),
    ).rejects.toThrow("second request failed");
    expect(created).toEqual([]);
    expect(metrics).toMatchObject([
      { outcome: "failed", providerCalls: 2, stage: "visual-embedding" },
    ]);
  });

  it("rejects per-call providers whose reported calls bypassed the admission hook", async () => {
    const { created, repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 1,
      projections: repository,
      provider: {
        embedAssets: async () => ({
          dense: [[0.2, 0.8]],
          metadata: {
            model: "clip-image@1",
            provider: "static-image",
            providerCalls: 1,
          },
          model: "clip-image@1",
        }),
        providerCallAdmission: "per-provider-call",
      },
    });

    await expect(
      builder.build({ model: "clip-image", nodes: [imageNode()], projectionVersion: 1 }),
    ).rejects.toThrow("Visual embedding provider reported providerCalls=1 after admitting 0 calls");
    expect(created).toEqual([]);
  });

  it("rejects hidden calls from providers without per-call budget admission", async () => {
    const { created, repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 1,
      projections: repository,
      provider: {
        embedAssets: async () => ({
          dense: [[0.2, 0.8]],
          metadata: {
            model: "clip-image@1",
            provider: "static-image",
            providerCalls: 2,
          },
          model: "clip-image@1",
        }),
      },
    });

    await expect(
      builder.build({ model: "clip-image", nodes: [imageNode()], projectionVersion: 1 }),
    ).rejects.toThrow(
      "Visual embedding provider without per-call admission must issue exactly one provider call",
    );
    expect(created).toEqual([]);
  });

  it("returns an empty embedding batch when every asset is unreadable", async () => {
    const adapter = createTestPlatformAdapter();
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/png",
      key: "tenant/spaces/space/assets/oversized.png",
      metadata: {},
    });
    let embedImagesCalls = 0;
    const assets = [
      {
        // No objectKey at all: skipped before reading object storage.
        assetRef: { note: "no object key" },
        documentAssetId: DOCUMENT_ASSET_ID,
        metadata: {},
        modality: "image",
        nodeId: "node-1",
        sourceText: "a",
      },
      {
        // Exists but larger than maxAssetBytes: skipped.
        assetRef: { objectKey: "tenant/spaces/space/assets/oversized.png" },
        documentAssetId: DOCUMENT_ASSET_ID,
        metadata: {},
        modality: "image",
        nodeId: "node-2",
        sourceText: "b",
      },
    ];
    const withKind = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 2,
      objectStorage: adapter.objectStorage,
      provider: {
        embedImages: async () => {
          embedImagesCalls += 1;
          throw new Error("should not be called");
        },
        kind: "bytes",
      },
    });
    const withoutKind = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 2,
      objectStorage: adapter.objectStorage,
      provider: {
        embedImages: async () => {
          embedImagesCalls += 1;
          throw new Error("should not be called");
        },
      },
    });

    await expect(withKind.embedAssets({ assets, model: "clip-image" })).resolves.toEqual({
      dense: [],
      embeddedNodeIds: [],
      metadata: { model: "clip-image", provider: "bytes:image-bytes", providerCalls: 0 },
      model: "clip-image",
    });
    await expect(withoutKind.embedAssets({ assets, model: "clip-image" })).resolves.toEqual({
      dense: [],
      embeddedNodeIds: [],
      metadata: { model: "clip-image", provider: "image-bytes", providerCalls: 0 },
      model: "clip-image",
    });
    expect(embedImagesCalls).toBe(0);
  });

  it("cancels an oversized image stream without issuing HEAD or buffered GET requests", async () => {
    const adapter = createTestPlatformAdapter();
    let getObjectCalls = 0;
    let headObjectCalls = 0;
    let getObjectStreamCalls = 0;
    let streamCancelCalls = 0;
    let embedImagesCalls = 0;
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 2,
      objectStorage: {
        ...adapter.objectStorage,
        getObject: async () => {
          getObjectCalls += 1;
          throw new Error("buffered GET must not be used");
        },
        getObjectStream: async () => {
          getObjectStreamCalls += 1;
          return new ReadableStream<Uint8Array>({
            cancel: () => {
              streamCancelCalls += 1;
            },
            start: (controller) => {
              controller.enqueue(new Uint8Array([1, 2]));
              controller.enqueue(new Uint8Array([3]));
            },
          });
        },
        headObject: async () => {
          headObjectCalls += 1;
          throw new Error("HEAD must not be used");
        },
      },
      provider: {
        embedImages: async () => {
          embedImagesCalls += 1;
          throw new Error("should not be called");
        },
      },
    });

    await expect(
      provider.embedAssets({
        assets: [visualImageAsset("assets/oversized-stream.png", "node-oversized")],
        model: "clip-image",
      }),
    ).resolves.toMatchObject({ dense: [], embeddedNodeIds: [] });

    expect(headObjectCalls).toBe(0);
    expect(getObjectCalls).toBe(0);
    expect(getObjectStreamCalls).toBe(1);
    expect(streamCancelCalls).toBe(1);
    expect(embedImagesCalls).toBe(0);
  });

  it("reads valid image streams sequentially without one HEAD round trip per image", async () => {
    const adapter = createTestPlatformAdapter();
    const bodies = new Map([
      ["assets/stream-1.png", new Uint8Array([1])],
      ["assets/stream-2.png", new Uint8Array([2])],
    ]);
    const headKeys: string[] = [];
    const getKeys: string[] = [];
    const streamKeys: string[] = [];
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 2,
      objectStorage: {
        ...adapter.objectStorage,
        getObject: async (key) => {
          getKeys.push(key);
          throw new Error("buffered GET must not be used");
        },
        getObjectStream: async (key) => {
          streamKeys.push(key);
          const body = bodies.get(key);
          if (!body) return null;
          return new ReadableStream<Uint8Array>({
            start: (controller) => {
              controller.enqueue(body);
              controller.close();
            },
          });
        },
        headObject: async (key) => {
          headKeys.push(key);
          throw new Error("HEAD must not be used");
        },
      },
      provider: {
        embedImages: async (input) => ({
          dense: input.images.map((image) => [image.body[0] ?? 0, 0.5]),
          metadata: { model: "clip-image@1", provider: "static-image" },
          model: "clip-image@1",
        }),
      },
    });

    const result = await provider.embedAssets({
      assets: [
        visualImageAsset("assets/stream-1.png", "node-stream-1"),
        visualImageAsset("assets/stream-2.png", "node-stream-2"),
      ],
      model: "clip-image",
    });

    expect(headKeys).toEqual([]);
    expect(getKeys).toEqual([]);
    expect(streamKeys).toEqual(["assets/stream-1.png", "assets/stream-2.png"]);
    expect(result.embeddedNodeIds).toEqual(["node-stream-1", "node-stream-2"]);
  });

  it("skips missing and failed image streams without falling back to buffered GET", async () => {
    const adapter = createTestPlatformAdapter();
    let getObjectCalls = 0;
    let getObjectStreamCalls = 0;
    let embedImagesCalls = 0;
    const provider = createObjectStorageVisualEmbeddingProvider({
      maxAssetBytes: 2,
      objectStorage: {
        ...adapter.objectStorage,
        getObject: async () => {
          getObjectCalls += 1;
          throw new Error("buffered GET must not be used");
        },
        getObjectStream: async (key) => {
          getObjectStreamCalls += 1;
          if (key.endsWith("missing.png")) return null;
          return new ReadableStream<Uint8Array>({
            start: (controller) => controller.error(new Error("stream unavailable")),
          });
        },
      },
      provider: {
        embedImages: async () => {
          embedImagesCalls += 1;
          throw new Error("should not be called");
        },
      },
    });

    await expect(
      provider.embedAssets({
        assets: [
          visualImageAsset("assets/missing.png", "node-missing"),
          visualImageAsset("assets/failed.png", "node-failed"),
        ],
        model: "clip-image",
      }),
    ).resolves.toMatchObject({ dense: [], embeddedNodeIds: [] });
    expect(getObjectCalls).toBe(0);
    expect(getObjectStreamCalls).toBe(2);
    expect(embedImagesCalls).toBe(0);
  });

  it("reads image bytes with variant fallbacks and forwards tenantId", async () => {
    const adapter = createTestPlatformAdapter();
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2]),
      contentType: "application/octet-stream",
      key: "tenant/spaces/space/assets/plain.png",
      metadata: {},
    });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([3, 4]),
      contentType: "image/png",
      key: "tenant/spaces/space/assets/thumb.png",
      metadata: {},
    });
    const imageCalls: EmbedVisualImagesInput[] = [];
    const provider = createObjectStorageVisualEmbeddingProvider({
      objectStorage: adapter.objectStorage,
      preferredVariant: "thumbnail",
      provider: {
        embedImages: async (input) => {
          imageCalls.push(input);
          return {
            dense: input.images.map(() => [0.1, 0.9]),
            metadata: { model: "clip-image@1", provider: "static-image" },
            model: "clip-image@1",
          };
        },
      },
    });

    const result = await provider.embedAssets({
      assets: [
        {
          // No contentType anywhere and no variants: image has no contentType.
          assetRef: { objectKey: "tenant/spaces/space/assets/plain.png" },
          documentAssetId: DOCUMENT_ASSET_ID,
          metadata: {},
          modality: "image",
          nodeId: "node-1",
          sourceText: "plain",
        },
        {
          // Variant without contentType: falls back to the top-level assetRef contentType.
          assetRef: {
            contentType: "image/png",
            objectKey: "tenant/spaces/space/assets/unused.png",
            variants: { thumbnail: { objectKey: "tenant/spaces/space/assets/thumb.png" } },
          },
          documentAssetId: DOCUMENT_ASSET_ID,
          metadata: {},
          modality: "image",
          nodeId: "node-2",
          sourceText: "thumb",
        },
      ],
      model: "clip-image",
      tenantId: "tenant-7",
    });

    expect(imageCalls).toHaveLength(1);
    expect(imageCalls[0]?.tenantId).toBe("tenant-7");
    expect(imageCalls[0]?.images[0]).toMatchObject({
      body: new Uint8Array([1, 2]),
      objectKey: "tenant/spaces/space/assets/plain.png",
    });
    expect(imageCalls[0]?.images[0]).not.toHaveProperty("contentType");
    expect(imageCalls[0]?.images[1]).toMatchObject({
      body: new Uint8Array([3, 4]),
      contentType: "image/png",
      objectKey: "tenant/spaces/space/assets/thumb.png",
    });
    // Provider without a kind gets the plain image-bytes suffix.
    expect(result.metadata.provider).toBe("static-image:image-bytes");
    expect(result.embeddedNodeIds).toEqual(["node-1", "node-2"]);
  });

  it("includes table metadata in visual embedding asset candidates", async () => {
    const assetCalls: EmbedVisualAssetsInput[] = [];
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 2,
      projections: repository,
      provider: {
        embedAssets: async (input) => {
          assetCalls.push(input);
          return {
            dense: input.assets.map(() => [0.2, 0.8]),
            metadata: { model: "clip@1", provider: "static-vision" },
            model: "clip@1",
          };
        },
      },
    });

    await builder.build({
      model: "clip",
      nodes: [
        knowledgeNode({
          kind: "table",
          metadata: {
            assetRef: { objectKey: "tenant/spaces/space/assets/table.png" },
            table: { columns: ["metric", "value"] },
          },
          text: "metric | value",
        }),
      ],
      projectionVersion: 1,
    });

    expect(assetCalls[0]?.assets[0]?.metadata.table).toEqual({ columns: ["metric", "value"] });
    expect(assetCalls[0]?.assets[0]?.modality).toBe("table");
  });

  it("builds multimodal metadata for modality-only and bounding-box-only nodes", async () => {
    const { repository } = createRecordingProjectionRepository();
    const builder = createFtsProjectionBuilder({ maxBatchSize: 2, projections: repository });

    // Image node without assetRef, elementIds, or pageNumber.
    const [bare] = await builder.build({
      nodes: [
        knowledgeNode({
          kind: "image",
          metadata: {},
          sourceLocation: { sectionPath: [] },
        }),
      ],
      projectionVersion: 1,
    });
    const bareMultimodal = bare?.metadata.multimodal as Record<string, unknown>;
    expect(bareMultimodal).toMatchObject({
      modality: "image",
      projectionRole: "textual-surrogate",
      visualEmbeddingStatus: "missing",
    });
    expect(bareMultimodal).not.toHaveProperty("assetRef");
    expect(bareMultimodal).not.toHaveProperty("parseElementId");
    expect(bareMultimodal).not.toHaveProperty("pageNumber");

    // Chunk node with only a bounding box: multimodal metadata without a modality.
    const [boxed] = await builder.build({
      nodes: [
        knowledgeNode({
          metadata: { boundingBox: { height: 10, width: 20, x: 1, y: 2 } },
        }),
      ],
      projectionVersion: 1,
    });
    const boxedMultimodal = boxed?.metadata.multimodal as Record<string, unknown>;
    expect(boxedMultimodal).toMatchObject({
      boundingBox: { height: 10, width: 20, x: 1, y: 2 },
    });
    expect(boxedMultimodal).not.toHaveProperty("modality");
  });

  it("derives modalities from element types on chunk nodes", async () => {
    const { repository } = createRecordingProjectionRepository();
    const builder = createFtsProjectionBuilder({ maxBatchSize: 1, projections: repository });
    const modalityOf = async (elementTypes: readonly string[]) => {
      const [projection] = await builder.build({
        nodes: [knowledgeNode({ metadata: { elementTypes: [...elementTypes] } })],
        projectionVersion: 1,
      });

      return (projection?.metadata.multimodal as Record<string, unknown>).modality;
    };

    await expect(modalityOf(["image"])).resolves.toBe("image");
    await expect(modalityOf(["table"])).resolves.toBe("table");
    await expect(modalityOf(["code"])).resolves.toBe("code");
    await expect(modalityOf(["page-break"])).resolves.toBe("page");
  });

  it("resolves parse element ids from direct values and mixed arrays", async () => {
    const { repository } = createRecordingProjectionRepository();
    const builder = createFtsProjectionBuilder({ maxBatchSize: 1, projections: repository });

    const [direct] = await builder.build({
      nodes: [knowledgeNode({ kind: "image", metadata: { parseElementId: "direct-el" } })],
      projectionVersion: 1,
    });
    expect((direct?.metadata.multimodal as Record<string, unknown>).parseElementId).toBe(
      "direct-el",
    );

    const [mixed] = await builder.build({
      nodes: [knowledgeNode({ kind: "image", metadata: { elementIds: [42, "   ", "real-el"] } })],
      projectionVersion: 1,
    });
    expect((mixed?.metadata.multimodal as Record<string, unknown>).parseElementId).toBe("real-el");

    const [nonArray] = await builder.build({
      nodes: [knowledgeNode({ kind: "image", metadata: { elementIds: "not-an-array" } })],
      projectionVersion: 1,
    });
    expect(nonArray?.metadata.multimodal as Record<string, unknown>).not.toHaveProperty(
      "parseElementId",
    );
  });
});
