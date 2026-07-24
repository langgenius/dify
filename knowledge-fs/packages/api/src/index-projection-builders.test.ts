import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { IndexProjection, KnowledgeNode } from "@knowledge/core";
import { KnowledgeNodeSchema, PUBLICATION_GENERATION_ID_SENTINEL } from "@knowledge/core";
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
const PUBLICATION_GENERATION_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const PUBLICATION_GENERATION_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";

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
    text: "合同ABC-123续约 terms",
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

describe("index projection builders", () => {
  it("propagates cancellation to embedding calls and never persists an aborted batch", async () => {
    const controller = new AbortController();
    const { created, repository } = createRecordingProjectionRepository();
    const builder = createDenseVectorProjectionBuilder({
      embeddings: {
        embed: async (input) => {
          expect(input.signal).toBe(controller.signal);
          controller.abort();
          return {
            dense: [[0.1, 0.2]],
            metadata: { model: "model-a@1", provider: "static" },
            model: "model-a@1",
          };
        },
        kind: "static",
        models: async () => [],
      },
      maxBatchSize: 1,
      projections: repository,
    });

    await expect(
      builder.build({
        model: "model-a",
        nodes: [knowledgeNode()],
        projectionVersion: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(created).toEqual([]);
  });

  it("scopes deterministic IDs and persisted projections to the publication generation", async () => {
    const denseRepository = createRecordingProjectionRepository();
    const ftsRepository = createRecordingProjectionRepository();
    const visualRepository = createRecordingProjectionRepository();
    const denseBuilder = createDenseVectorProjectionBuilder({
      embeddings: {
        embed: async () => ({
          dense: [[0.1, 0.2]],
          metadata: { model: "model-a@1", provider: "static" },
          model: "model-a@1",
        }),
        kind: "static",
        models: async () => [],
      },
      maxBatchSize: 1,
      projections: denseRepository.repository,
    });
    const ftsBuilder = createFtsProjectionBuilder({
      maxBatchSize: 1,
      projections: ftsRepository.repository,
    });
    const visualBuilder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 1,
      projections: visualRepository.repository,
      provider: {
        embedAssets: async () => ({
          dense: [[0.3, 0.4]],
          metadata: { model: "clip@1", provider: "static-vision" },
          model: "clip@1",
        }),
      },
    });
    const imageNode = knowledgeNode({
      kind: "image",
      metadata: {
        assetRef: { contentType: "image/png", objectKey: "assets/chart.png" },
        elementIds: ["chart-1"],
        elementTypes: ["image"],
      },
      text: "Revenue chart",
    });

    const buildForGeneration = async (publicationGenerationId?: string) => {
      const common = {
        nodes: [imageNode],
        projectionVersion: 5,
        ...(publicationGenerationId ? { publicationGenerationId } : {}),
      };
      const [dense] = await denseBuilder.build({ ...common, model: "model-a" });
      const [fts] = await ftsBuilder.build(common);
      const [visual] = await visualBuilder.build({ ...common, model: "clip" });

      if (!dense || !fts || !visual) {
        throw new Error("Expected all three projection builders to produce a projection");
      }

      return [dense, fts, visual] as const;
    };

    const firstAttempt = await buildForGeneration(PUBLICATION_GENERATION_A);
    const retry = await buildForGeneration(PUBLICATION_GENERATION_A);
    const uppercaseRetry = await buildForGeneration(PUBLICATION_GENERATION_A.toUpperCase());
    const nextGeneration = await buildForGeneration(PUBLICATION_GENERATION_B);
    const legacy = await buildForGeneration();

    expect(retry.map(({ id }) => id)).toEqual(firstAttempt.map(({ id }) => id));
    expect(uppercaseRetry.map(({ id }) => id)).toEqual(firstAttempt.map(({ id }) => id));
    expect(
      uppercaseRetry.every(
        (projection) => projection.publicationGenerationId === PUBLICATION_GENERATION_A,
      ),
    ).toBe(true);
    expect(nextGeneration.map(({ id }) => id)).not.toEqual(firstAttempt.map(({ id }) => id));
    for (const [index, projection] of firstAttempt.entries()) {
      expect(nextGeneration[index]?.id).not.toBe(projection.id);
      expect(projection.publicationGenerationId).toBe(PUBLICATION_GENERATION_A);
      expect(nextGeneration[index]?.publicationGenerationId).toBe(PUBLICATION_GENERATION_B);
    }
    expect(legacy.map(({ id }) => id)).toEqual([
      "c049f2e6-1115-58ee-8878-8048a80e5506",
      "64a5e240-5726-5b92-83a1-e4b892f373e9",
      "8292110e-b39e-5710-9937-0408085ba72d",
    ]);
    expect(legacy.every((projection) => projection.publicationGenerationId === undefined)).toBe(
      true,
    );
    expect(denseRepository.created[0]?.[0]?.publicationGenerationId).toBe(PUBLICATION_GENERATION_A);
    expect(ftsRepository.created[0]?.[0]?.publicationGenerationId).toBe(PUBLICATION_GENERATION_A);
    expect(visualRepository.created[0]?.[0]?.publicationGenerationId).toBe(
      PUBLICATION_GENERATION_A,
    );
  });

  it("builds dense projections through the embedding provider with stable metadata", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async (input) => {
        embedCalls.push(input);
        return {
          dense: [[0.1, 0.2, 0.3]],
          metadata: { model: "model-a@1", provider: "static" },
          model: "model-a@1",
        };
      },
      kind: "static",
      models: async () => [],
    };
    const { created, repository } = createRecordingProjectionRepository();
    const builder = createDenseVectorProjectionBuilder({
      embeddings,
      expectedDimension: 3,
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9000",
      maxBatchSize: 2,
      projections: repository,
    });

    const result = await builder.build({
      model: "model-a",
      nodes: [knowledgeNode()],
      projectionVersion: 2,
      status: "building",
    });

    expect(embedCalls).toEqual([
      { inputType: "search_document", model: "model-a", texts: ["合同ABC-123续约 terms"] },
    ]);
    expect(result[0]).toMatchObject({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9000",
      metadata: {
        denseVector: [0.1, 0.2, 0.3],
        dimension: 3,
        embeddingProvider: "static",
        modelVersion: "model-a@1",
      },
      model: "model-a@1",
      projectionVersion: 2,
      status: "building",
      type: "dense-vector",
    });
    expect(created[0]).toHaveLength(1);
  });

  it("resolves a space profile and persists vectorSpaceId instead of the daemon model key", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async (input) => {
        embedCalls.push(input);
        return {
          dense: [[0.1, 0.2, 0.3, 0.4]],
          metadata: { dimension: 4, model: "tenant-model", provider: "dify-model-runtime" },
          model: "tenant-model",
        };
      },
      kind: "dify-model-runtime",
      models: async () => [],
    };
    const { repository } = createRecordingProjectionRepository();
    const builder = createDenseVectorProjectionBuilder({
      embeddingResolver: {
        resolve: async (input) => {
          expect(input).toEqual({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, tenantId: "tenant-1" });
          return {
            model: "tenant-model",
            pluginId: "tenant/plugin",
            provider: "tenant-provider",
            providerInstance: embeddings,
            revision: 7,
            vectorSpaceId: "vs-tenant-model-r7",
          };
        },
      },
      maxBatchSize: 2,
      projections: repository,
    });

    const [projection] = await builder.build({
      model: "vs-tenant-model-r7",
      nodes: [knowledgeNode()],
      projectionVersion: 2,
      tenantId: "tenant-1",
    });

    expect(embedCalls).toEqual([
      {
        inputType: "search_document",
        model: "tenant-model",
        tenantId: "tenant-1",
        texts: ["合同ABC-123续约 terms"],
      },
    ]);
    expect(projection).toMatchObject({
      metadata: {
        dimension: 4,
        embeddingModel: "tenant-model",
        embeddingProfile: {
          pluginId: "tenant/plugin",
          provider: "tenant-provider",
          revision: 7,
        },
        vectorSpaceId: "vs-tenant-model-r7",
      },
      model: "vs-tenant-model-r7",
    });
  });

  it("uses a frozen candidate profile without rereading or mutating the active manifest", async () => {
    const profile = {
      dimension: 4,
      model: "candidate-model",
      pluginId: "candidate/plugin",
      provider: "candidate-provider",
      revision: 8,
      vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
    };
    const resolveInputs: unknown[] = [];
    const observations: unknown[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async () => ({
        dense: [[0.1, 0.2, 0.3, 0.4]],
        metadata: { dimension: 4, model: profile.model, provider: "dify-model-runtime" },
        model: profile.model,
      }),
      kind: "dify-model-runtime",
      models: async () => [],
    };
    const { repository } = createRecordingProjectionRepository();
    const builder = createDenseVectorProjectionBuilder({
      embeddingResolver: {
        observeDimension: async (input) => {
          observations.push(input);
        },
        resolve: async (input) => {
          resolveInputs.push(input);
          if (!input.profile) throw new Error("candidate profile was not frozen");
          return { ...input.profile, providerInstance: embeddings };
        },
      },
      maxBatchSize: 2,
      projections: repository,
    });

    const [projection] = await builder.build({
      embeddingProfile: profile,
      model: profile.vectorSpaceId,
      nodes: [knowledgeNode()],
      projectionVersion: 9,
      tenantId: "tenant-1",
    });

    expect(resolveInputs).toEqual([
      { knowledgeSpaceId: KNOWLEDGE_SPACE_ID, profile, tenantId: "tenant-1" },
    ]);
    expect(observations).toEqual([]);
    expect(projection).toMatchObject({
      metadata: {
        dimension: 4,
        embeddingProfile: {
          pluginId: profile.pluginId,
          provider: profile.provider,
          revision: 8,
        },
        vectorSpaceId: profile.vectorSpaceId,
      },
      model: profile.vectorSpaceId,
    });
  });

  it("builds FTS projections with mixed-language normalization", async () => {
    const { repository } = createRecordingProjectionRepository();
    const builder = createFtsProjectionBuilder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9001",
      maxBatchSize: 2,
      projections: repository,
    });

    const [projection] = await builder.build({
      nodes: [knowledgeNode()],
      projectionVersion: 1,
    });

    expect(projection).toMatchObject({
      metadata: {
        ftsLanguageStrategy: "mixed-cjk-latin-v1",
        ftsText: "合 同 abc 123 续 约 terms",
        parser: "database-fts",
      },
      model: "database-fts@1",
      status: "ready",
      type: "fts",
    });
  });

  it("adds multimodal linkage metadata to dense and FTS projections", async () => {
    const imageNode = knowledgeNode({
      kind: "image",
      metadata: {
        assetRef: { contentType: "image/png", objectKey: "tenant/spaces/space/assets/figure.png" },
        boundingBox: { height: 120, width: 240, x: 10, y: 20 },
        elementIds: ["figure-1"],
        elementTypes: ["image"],
        ocrText: "Revenue chart",
      },
      sourceLocation: { pageNumber: 4, sectionPath: ["Charts"] },
      text: "Revenue chart",
    });
    const embeddings: EmbeddingProvider = {
      embed: async () => ({
        dense: [[0.1, 0.2]],
        metadata: { model: "vision-text@1", provider: "static" },
        model: "vision-text@1",
      }),
      kind: "static",
      models: async () => [],
    };
    const denseRepository = createRecordingProjectionRepository();
    const ftsRepository = createRecordingProjectionRepository();

    const [dense] = await createDenseVectorProjectionBuilder({
      embeddings,
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9002",
      maxBatchSize: 2,
      projections: denseRepository.repository,
    }).build({
      model: "vision-text",
      nodes: [imageNode],
      projectionVersion: 1,
    });
    const [fts] = await createFtsProjectionBuilder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9003",
      maxBatchSize: 2,
      projections: ftsRepository.repository,
    }).build({
      nodes: [imageNode],
      projectionVersion: 1,
    });

    expect(dense?.metadata.multimodal).toEqual({
      assetRef: { contentType: "image/png", objectKey: "tenant/spaces/space/assets/figure.png" },
      boundingBox: { height: 120, width: 240, x: 10, y: 20 },
      modality: "image",
      pageNumber: 4,
      parseElementId: "figure-1",
      projectionRole: "textual-surrogate",
      sectionPath: ["Charts"],
      visualEmbeddingStatus: "missing",
    });
    expect(fts?.metadata.multimodal).toEqual(dense?.metadata.multimodal);
  });

  it("builds visual asset projections from eligible multimodal nodes", async () => {
    const embedCalls: EmbedVisualAssetsInput[] = [];
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9004",
      maxBatchSize: 3,
      projections: repository,
      provider: {
        embedAssets: async (input) => {
          embedCalls.push(input);
          return {
            dense: [[0.4, 0.6]],
            metadata: { model: "clip@1", provider: "static-vision" },
            model: "clip@1",
          };
        },
      },
    });
    const textNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a10",
      metadata: { chunkIndex: 0 },
      text: "plain text node",
    });
    const imageNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a11",
      kind: "image",
      metadata: {
        assetRef: {
          contentType: "image/png",
          objectKey: "tenant/spaces/space/assets/figure.png",
          sha256: "b".repeat(64),
        },
        boundingBox: { height: 120, width: 240, x: 10, y: 20 },
        elementIds: ["figure-1"],
        elementTypes: ["image"],
        ocrText: "Revenue chart",
      },
      sourceLocation: { pageNumber: 4, sectionPath: ["Charts"], startOffset: 0, endOffset: 12 },
      text: "Revenue chart",
    });

    const [projection] = await builder.build({
      model: "clip",
      nodes: [textNode, imageNode],
      projectionVersion: 7,
    });

    expect(embedCalls).toHaveLength(1);
    expect(embedCalls[0]).toEqual({
      assets: [
        {
          assetRef: {
            contentType: "image/png",
            objectKey: "tenant/spaces/space/assets/figure.png",
            sha256: "b".repeat(64),
          },
          documentAssetId: DOCUMENT_ASSET_ID,
          metadata: {
            artifactHash: "a".repeat(64),
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant/spaces/space/assets/figure.png",
              sha256: "b".repeat(64),
            },
            boundingBox: { height: 120, width: 240, x: 10, y: 20 },
            documentAssetId: DOCUMENT_ASSET_ID,
            modality: "image",
            ocrText: "Revenue chart",
            pageNumber: 4,
            parseArtifactId: PARSE_ARTIFACT_ID,
            parseElementId: "figure-1",
            projectionRole: "textual-surrogate",
            sectionPath: ["Charts"],
            visualEmbeddingStatus: "missing",
          },
          modality: "image",
          nodeId: imageNode.id,
          sourceText: "Revenue chart",
        },
      ],
      model: "clip",
    });
    expect(projection).toMatchObject({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      metadata: {
        artifactHash: "a".repeat(64),
        denseVector: [0.4, 0.6],
        dimension: 2,
        documentAssetId: DOCUMENT_ASSET_ID,
        embeddingProvider: "static-vision",
        modelVersion: "clip@1",
        multimodal: {
          assetRef: {
            contentType: "image/png",
            objectKey: "tenant/spaces/space/assets/figure.png",
            sha256: "b".repeat(64),
          },
          boundingBox: { height: 120, width: 240, x: 10, y: 20 },
          modality: "image",
          pageNumber: 4,
          parseElementId: "figure-1",
          projectionRole: "visual-asset",
          sectionPath: ["Charts"],
          visualEmbeddingStatus: "provided",
        },
        parseArtifactId: PARSE_ARTIFACT_ID,
      },
      model: "clip@1",
      nodeId: imageNode.id,
      projectionVersion: 7,
      status: "ready",
      type: "dense-vector",
    });
  });

  it("can build visual asset projections through a text-surrogate embedding provider", async () => {
    const embedCalls: EmbedTextsInput[] = [];
    const embeddings: EmbeddingProvider = {
      embed: async (input) => {
        embedCalls.push(input);
        return {
          dense: [[0.7, 0.3]],
          metadata: { model: "text-visual@1", provider: "static" },
          model: "text-visual@1",
        };
      },
      kind: "static",
      models: async () => [],
    };
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9005",
      maxBatchSize: 2,
      projections: repository,
      provider: createTextSurrogateVisualEmbeddingProvider({ embeddings }),
    });

    const [projection] = await builder.build({
      model: "text-visual",
      nodes: [
        knowledgeNode({
          kind: "image",
          metadata: {
            assetRef: { contentType: "image/png", objectKey: "assets/chart.png" },
            caption: "Renewal chart",
            elementIds: ["chart-1"],
            elementTypes: ["image"],
            ocrText: "Renewals increased 12%",
            title: "Q1 Renewals",
          },
          text: "A chart about renewals",
        }),
      ],
      projectionVersion: 8,
    });

    expect(embedCalls).toEqual([
      {
        inputType: "search_document",
        model: "text-visual",
        texts: ["Q1 Renewals\nRenewal chart\nRenewals increased 12%\nA chart about renewals"],
      },
    ]);
    expect(projection).toMatchObject({
      metadata: {
        denseVector: [0.7, 0.3],
        embeddingProvider: "static:text-surrogate",
        multimodal: expect.objectContaining({
          caption: "Renewal chart",
          ocrText: "Renewals increased 12%",
          projectionRole: "visual-asset",
          title: "Q1 Renewals",
        }),
      },
      model: "text-visual@1",
      type: "dense-vector",
    });
  });

  it("can build visual asset projections from object-backed image bytes", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/png",
      key: "tenant/spaces/space/assets/chart-thumbnail.png",
      metadata: {},
    });
    const imageCalls: EmbedVisualImagesInput[] = [];
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f9006",
      maxBatchSize: 2,
      projections: repository,
      provider: createObjectStorageVisualEmbeddingProvider({
        objectStorage: adapter.objectStorage,
        preferredVariant: "thumbnail",
        provider: {
          embedImages: async (input) => {
            imageCalls.push(input);

            return {
              dense: [[0.2, 0.8]],
              metadata: { model: "clip-image@1", provider: "static-image" },
              model: "clip-image@1",
            };
          },
          kind: "bytes",
        },
      }),
    });

    const [projection] = await builder.build({
      model: "clip-image",
      nodes: [
        knowledgeNode({
          kind: "image",
          metadata: {
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant/spaces/space/assets/chart.png",
              variants: {
                thumbnail: {
                  contentType: "image/png",
                  objectKey: "tenant/spaces/space/assets/chart-thumbnail.png",
                },
              },
            },
            elementIds: ["chart-1"],
            elementTypes: ["image"],
          },
          text: "Revenue chart",
        }),
      ],
      projectionVersion: 9,
    });

    expect(imageCalls).toEqual([
      {
        images: [
          expect.objectContaining({
            body: new Uint8Array([1, 2, 3, 4]),
            contentType: "image/png",
            objectKey: "tenant/spaces/space/assets/chart-thumbnail.png",
          }),
        ],
        model: "clip-image",
      },
    ]);
    expect(projection).toMatchObject({
      metadata: {
        denseVector: [0.2, 0.8],
        embeddingProvider: "static-image:bytes:image-bytes",
        multimodal: expect.objectContaining({
          projectionRole: "visual-asset",
          visualEmbeddingStatus: "provided",
        }),
      },
      model: "clip-image@1",
      type: "dense-vector",
    });
  });

  it("skips individual unreadable assets instead of failing the whole visual batch", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    // Only the first asset's object exists; the second is missing from storage.
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/png",
      key: "tenant/spaces/space/assets/chart-1.png",
      metadata: {},
    });
    const imageCalls: EmbedVisualImagesInput[] = [];
    const { repository } = createRecordingProjectionRepository();
    let generated = 0;
    const builder = createVisualEmbeddingProjectionBuilder({
      generateId: () =>
        `018f0d60-7a49-7cc2-9c1b-5b36f18f90${(generated++).toString().padStart(2, "0")}`,
      maxBatchSize: 5,
      projections: repository,
      provider: createObjectStorageVisualEmbeddingProvider({
        objectStorage: adapter.objectStorage,
        provider: {
          embedImages: async (input) => {
            imageCalls.push(input);

            return {
              dense: input.images.map(() => [0.2, 0.8]),
              metadata: { model: "clip-image@1", provider: "static-image" },
              model: "clip-image@1",
            };
          },
          kind: "bytes",
        },
      }),
    });

    const projections = await builder.build({
      model: "clip-image",
      nodes: [
        knowledgeNode({
          id: "020f0d60-7a49-7cc2-9c1b-5b36f18f9001",
          kind: "image",
          metadata: {
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant/spaces/space/assets/chart-1.png",
            },
            elementIds: ["chart-1"],
            elementTypes: ["image"],
          },
          text: "Readable chart",
        }),
        knowledgeNode({
          id: "020f0d60-7a49-7cc2-9c1b-5b36f18f9002",
          kind: "image",
          metadata: {
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant/spaces/space/assets/missing.png",
            },
            elementIds: ["chart-2"],
            elementTypes: ["image"],
          },
          text: "Missing chart",
        }),
      ],
      projectionVersion: 9,
    });

    // Only the readable asset was embedded (one image sent, one projection built).
    expect(imageCalls[0]?.images).toHaveLength(1);
    expect(projections).toHaveLength(1);
    expect(projections[0]?.nodeId).toBe("020f0d60-7a49-7cc2-9c1b-5b36f18f9001");
  });

  it("skips visual embedding when no node has an asset ref", async () => {
    const { repository } = createRecordingProjectionRepository();
    const builder = createVisualEmbeddingProjectionBuilder({
      maxBatchSize: 2,
      projections: repository,
      provider: {
        embedAssets: async () => {
          throw new Error("provider should not be called");
        },
      },
    });

    await expect(
      builder.build({ model: "clip", nodes: [knowledgeNode()], projectionVersion: 1 }),
    ).resolves.toEqual([]);
  });

  it("rejects invalid projection build inputs before persistence", async () => {
    const embeddings: EmbeddingProvider = {
      embed: async () => ({
        dense: [],
        metadata: { model: "model-a@1", provider: "static" },
        model: "model-a@1",
      }),
      kind: "static",
      models: async () => [],
    };
    const { repository } = createRecordingProjectionRepository();
    const denseBuilder = createDenseVectorProjectionBuilder({
      embeddings,
      maxBatchSize: 1,
      projections: repository,
    });

    await expect(
      denseBuilder.build({ model: "model-a", nodes: [], projectionVersion: 1 }),
    ).rejects.toThrow("batch must contain at least 1 node");
    await expect(
      denseBuilder.build({
        model: "model-a",
        nodes: [knowledgeNode(), knowledgeNode({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01" })],
        projectionVersion: 1,
      }),
    ).rejects.toThrow("batch size exceeds maxBatchSize=1");
    await expect(
      denseBuilder.build({
        model: "model-a",
        nodes: [knowledgeNode()],
        projectionVersion: 1,
        status: "failed" as never,
      }),
    ).rejects.toThrow("status must be building or ready");
    await expect(
      denseBuilder.build({ model: "model-a", nodes: [knowledgeNode()], projectionVersion: 1 }),
    ).rejects.toThrow("returned 0 vectors for 1 nodes");
    await expect(
      denseBuilder.build({
        model: "model-a",
        nodes: [knowledgeNode()],
        projectionVersion: 1,
        publicationGenerationId: "not-a-uuid",
      }),
    ).rejects.toThrow();
    await expect(
      denseBuilder.build({
        model: "model-a",
        nodes: [knowledgeNode()],
        projectionVersion: 1,
        publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
      }),
    ).rejects.toThrow("Publication generation ID must be a non-zero UUID");
    expect(() =>
      createDenseVectorProjectionBuilder({
        embeddings,
        expectedDimension: 0,
        maxBatchSize: 1,
        projections: repository,
      }),
    ).toThrow("expectedDimension must be a positive integer");

    const wrongDimension = createDenseVectorProjectionBuilder({
      embeddings: {
        ...embeddings,
        embed: async () => ({
          dense: [[0.1, 0.2]],
          metadata: { model: "model-a@1", provider: "static" },
          model: "model-a@1",
        }),
      },
      expectedDimension: 3,
      maxBatchSize: 1,
      projections: repository,
    });
    await expect(
      wrongDimension.build({
        model: "model-a",
        nodes: [knowledgeNode()],
        projectionVersion: 1,
      }),
    ).rejects.toThrow("returned dimension=2; expected 3");
  });
});
