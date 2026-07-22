import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { IndexProjection, KnowledgeNode } from "@knowledge/core";
import { KnowledgeNodeSchema } from "@knowledge/core";
import type { EmbedTextsInput, EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it } from "vitest";

import {
  createDenseVectorProjectionBuilder,
  createFtsProjectionBuilder,
  createObjectStorageVisualEmbeddingProvider,
  createTextSurrogateVisualEmbeddingProvider,
  createVisualEmbeddingProjectionBuilder,
} from "./index-projection-builders";
import type { EmbedVisualAssetsInput, EmbedVisualImagesInput } from "./index-projection-builders";
import type { IndexProjectionRepository } from "./index-projection-repository";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const DOCUMENT_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const PARSE_ARTIFACT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

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
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 2,
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
    const adapter = createNodePlatformAdapter({ env: {} });

    expect(() =>
      createObjectStorageVisualEmbeddingProvider({
        maxAssetBytes: 0,
        objectStorage: adapter.objectStorage,
        provider: {
          embedImages: async () => {
            throw new Error("unused");
          },
        },
      }),
    ).toThrow("Object-storage visual embedding maxAssetBytes must be at least 1");
  });

  it("returns an empty embedding batch when every asset is unreadable", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
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
      metadata: { model: "clip-image", provider: "bytes:image-bytes" },
      model: "clip-image",
    });
    await expect(withoutKind.embedAssets({ assets, model: "clip-image" })).resolves.toEqual({
      dense: [],
      embeddedNodeIds: [],
      metadata: { model: "clip-image", provider: "image-bytes" },
      model: "clip-image",
    });
    expect(embedImagesCalls).toBe(0);
  });

  it("reads image bytes with variant fallbacks and forwards tenantId", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
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
