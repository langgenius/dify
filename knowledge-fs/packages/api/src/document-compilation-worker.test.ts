import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { ParseArtifactSchema } from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";
import { describe, expect, it } from "vitest";

import {
  DeletionLifecycleFenceActiveError,
  createDeletionLifecycleFenceGuard,
  createInMemoryDeletionLifecycleFenceReader,
} from "./deletion-lifecycle-fence";

import {
  createDocumentCompilationJobStateMachine,
  createDocumentCompilationWorker,
  createDocumentOutlineBuilder,
  createDocumentOutlineSummaryEnhancer,
  createInMemoryDocumentAssetRepository,
  createInMemoryDocumentCompilationJobRepository,
  createInMemoryDocumentMultimodalManifestRepository,
  createInMemoryDocumentOutlineRepository,
  createInMemoryKnowledgeFsLeaseRepository,
  createInMemoryKnowledgePathRepository,
  createInMemoryParseArtifactRepository,
  createKnowledgeFsOperationLeaseCoordinator,
} from "./index";

describe("createDocumentCompilationWorker lease integration", () => {
  it("fails closed instead of silently writing a generation payload as legacy", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Candidate.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a11",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Candidate.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6a12";
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-generation-1",
      generatePublicationGenerationId: () => generationId,
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 1,
      }),
      objectStorage: adapter.objectStorage,
      parser: parser(),
      reindexer: {
        reindex: async () => {
          throw new Error("generation payload must fail before reindex");
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        publicationGenerationId: generationId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toThrow("Generation-scoped document compilation requires a publication coordinator");
    await expect(compilationJobs.get(compilationJob.id)).resolves.toMatchObject({
      stage: "failed",
    });
  });

  it("does not persist compilation progress after a document deletion fence appears", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Stale.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c11",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Stale.md",
      sha256: "a".repeat(64),
      sizeBytes: 7,
      sourceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c12",
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Stale"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-stale-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    let reindexCalls = 0;
    const baseParser = parser();
    const worker = createDocumentCompilationWorker({
      assets,
      deletionFence: createDeletionLifecycleFenceGuard(fences),
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: adapter.objectStorage,
      parser: {
        ...baseParser,
        parse: async (input) => {
          const parsed = await baseParser.parse(input);
          await fences.activateFence({
            id: "fence-stale-1",
            knowledgeSpaceId: asset.knowledgeSpaceId,
            targetId: asset.id,
            targetType: "document",
            tenantId: "tenant-1",
          });
          return parsed;
        },
      },
      reindexer: {
        reindex: async () => {
          reindexCalls += 1;
          throw new Error("stale worker reached reindex");
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toBeInstanceOf(DeletionLifecycleFenceActiveError);
    expect(reindexCalls).toBe(0);
    await expect(compilationJobs.get(compilationJob.id)).resolves.toMatchObject({
      stage: "queued",
    });
    await expect(
      assets.get({ id: asset.id, knowledgeSpaceId: asset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ parserStatus: "pending" });
  });

  it("compensates a multimodal object written after deletion inventory has passed", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Late-image.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c21",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Late-image.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Late image"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-late-object-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    let latePutCount = 0;
    const admittedScopes: { knowledgeSpaceId: string; tenantId: string }[] = [];
    const objectStorage = {
      ...adapter.objectStorage,
      putObject: async (input: Parameters<typeof adapter.objectStorage.putObject>[0]) => {
        const stored = await adapter.objectStorage.putObject(input);
        if (input.key.includes("/assets/")) {
          latePutCount += 1;
          // The delete worker already inventoried this prefix before the expired compiler writes.
          await fences.activateFence({
            id: "fence-late-object-1",
            knowledgeSpaceId: asset.knowledgeSpaceId,
            targetId: asset.id,
            targetType: "document",
            tenantId: "tenant-1",
          });
        }
        return stored;
      },
    };
    const worker = createDocumentCompilationWorker({
      assets,
      deletionFence: createDeletionLifecycleFenceGuard(fences),
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage,
      objectWriteAdmission: {
        withSpaceWriteAdmission: async (scope, write) => {
          admittedScopes.push({ ...scope });
          return write();
        },
      },
      parser: parser(),
      reindexer: {
        reindex: async () => {
          throw new Error("late multimodal writer reached reindex");
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toBeInstanceOf(DeletionLifecycleFenceActiveError);
    expect(latePutCount).toBe(1);
    expect(admittedScopes).toEqual([
      { knowledgeSpaceId: asset.knowledgeSpaceId, tenantId: "tenant-1" },
    ]);
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${asset.knowledgeSpaceId}/documents/${asset.id}/assets/`,
      }),
    ).resolves.toMatchObject({ objects: [] });
    await expect(compilationJobs.get(compilationJob.id)).resolves.toMatchObject({
      stage: "queued",
    });
  });

  it("converts an in-flight compilation failure to the deletion fence and compensates objects", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Fence-on-error.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c22",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Fence-on-error.md",
      sha256: "a".repeat(64),
      sizeBytes: 16,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Fence on error"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-fence-on-error-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const worker = createDocumentCompilationWorker({
      assets,
      deletionFence: createDeletionLifecycleFenceGuard(fences),
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: adapter.objectStorage,
      parser: parser(),
      reindexer: {
        reindex: async () => {
          await fences.activateFence({
            id: "fence-on-error-1",
            knowledgeSpaceId: asset.knowledgeSpaceId,
            targetId: asset.id,
            targetType: "document",
            tenantId: "tenant-1",
          });
          throw new Error("original compilation failure");
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toBeInstanceOf(DeletionLifecycleFenceActiveError);
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${asset.knowledgeSpaceId}/documents/${asset.id}/assets/`,
      }),
    ).resolves.toMatchObject({ objects: [] });
    await expect(compilationJobs.get(compilationJob.id)).resolves.toMatchObject({
      stage: "outline_built",
    });
  });

  it("composes a complete generation receipt and stops before evaluation or publication", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-07-13T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Shadow.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a31",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Shadow.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Shadow"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6a32";
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-generation-shadow-1",
      generatePublicationGenerationId: () => generationId,
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const receipts: unknown[] = [];
    const reindexInputs: unknown[] = [];
    let mutableEmbeddingReads = 0;
    let pageIndexBuildCalls = 0;
    let publishCalls = 0;
    let semanticCalls = 0;
    let smokeCalls = 0;
    const worker = createDocumentCompilationWorker({
      assets,
      candidateComposer: {
        compose: async (input) => {
          receipts.push(input);
        },
      },
      denseEmbeddingModel: "legacy-dense-model-must-not-escape-the-frozen-attempt",
      embeddingResolver: {
        resolve: async () => {
          mutableEmbeddingReads += 1;
          throw new Error("Research-only frozen attempt must not read a mutable embedding profile");
        },
      },
      failureManagement: "caller",
      frozenRetrievalProfile: {
        defaultMode: "research",
        reasoningModel: {
          model: "frozen-reasoning",
          pluginId: "reasoning/plugin",
          provider: "reasoning-provider",
        },
        rerank: { enabled: false },
        revision: 4,
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 8,
      },
      indexOverrides: {
        resolve: async () => ({
          enableGraph: false,
          enablePageIndex: false,
          language: "zh-CN",
        }),
      },
      generateKnowledgePathId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a33",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a34",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a35",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a36",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a37",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a38",
      ]),
      jobs: compilationJobs,
      knowledgePaths: createInMemoryKnowledgePathRepository({
        maxBatchSize: 10,
        maxListLimit: 10,
        maxPaths: 10,
      }),
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 2,
      }),
      objectStorage: adapter.objectStorage,
      outlineBuilder: createDocumentOutlineBuilder({
        maxElements: 10,
        maxNodes: 10,
        maxSummaryChars: 200,
      }),
      outlines: createInMemoryDocumentOutlineRepository({ maxOutlines: 2 }),
      pageIndexBuild: {
        materializeBuilding: async ({ outline }) => {
          pageIndexBuildCalls += 1;
          return {
            checksum: "a".repeat(64),
            documentAssetId: outline.documentAssetId,
            documentOutlineId: outline.id,
            documentVersion: outline.version,
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6aff",
            knowledgeSpaceId: outline.knowledgeSpaceId,
            nodeCount: 1,
            publicationGenerationId: generationId,
            status: "building" as const,
            termCount: 1,
            tokenizerVersion: "pageindex-nfkc-exact-v1" as const,
          };
        },
      },
      parser: parser(),
      reindexer: {
        failProjections: async () => 0,
        publishProjections: async () => {
          publishCalls += 1;
          return 0;
        },
        reindex: async (input) => {
          reindexInputs.push(input);
          return {
            artifact: input.parseArtifact,
            nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f6a39"],
            nodesCreated: 1,
            projectionIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f6a3a"],
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
      semanticPostProcessor: {
        process: async () => {
          semanticCalls += 1;
          return {
            entitiesExtracted: 0,
            graphEntityIds: [],
            graphEntitiesIndexed: 0,
            graphRelationIds: [],
            graphRelationsIndexed: 0,
            nodesScanned: 0,
            nodesUpdated: 0,
            parseArtifactId: "unused",
            semanticCommunitiesMaterialized: 0,
          };
        },
      },
      smokeEvaluation: {
        evaluate: async () => {
          smokeCalls += 1;
          throw new Error("generation candidate must not run legacy smoke evaluation");
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        publicationGenerationId: generationId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).resolves.toMatchObject({ stage: "projection_built" });
    expect(receipts).toEqual([
      expect.objectContaining({
        componentReceipt: {
          documentOutlines: [expect.objectContaining({ generationId })],
          graphEntities: [],
          graphRelations: [],
          indexProjections: [
            {
              componentKey: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a3a",
              generationId,
            },
          ],
          knowledgePaths: expect.arrayContaining([expect.objectContaining({ generationId })]),
          multimodalManifests: [expect.objectContaining({ generationId })],
          schemaVersion: 1,
        },
        publicationGenerationId: generationId,
      }),
    ]);
    expect(publishCalls).toBe(0);
    expect(smokeCalls).toBe(0);
    expect(mutableEmbeddingReads).toBe(0);
    expect(pageIndexBuildCalls).toBe(0);
    expect(semanticCalls).toBe(0);
    expect(reindexInputs[0]).toEqual(expect.objectContaining({ language: "zh-CN" }));
    expect(reindexInputs[0]).not.toHaveProperty("denseModel");
    expect(reindexInputs[0]).not.toHaveProperty("embeddingProfile");
    await expect(
      assets.get({ id: asset.id, knowledgeSpaceId: asset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ parserStatus: "pending" });
  });

  it("leaves transient status transitions to a durable caller", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-07-13T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Candidate.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a21",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Candidate.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6a22";
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-generation-2",
      generatePublicationGenerationId: () => generationId,
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 1,
      }),
      objectStorage: adapter.objectStorage,
      parser: parser(),
      reindexer: {
        reindex: async () => {
          throw new Error("generation payload must fail before reindex");
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        publicationGenerationId: generationId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toThrow("Generation-scoped document compilation requires a publication coordinator");
    await expect(compilationJobs.get(compilationJob.id)).resolves.toMatchObject({
      stage: "queued",
    });
    await expect(
      assets.get({ id: asset.id, knowledgeSpaceId: asset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ parserStatus: "pending" });
  });

  it("builds retry derivatives from the canonical artifact returned by reindexing", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-07-13T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Retry.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6e01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Retry.md",
      sha256: "f".repeat(64),
      sizeBytes: 7,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Retry"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const canonicalArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6e02";
    const retryArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f6e03";
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 2 });
    await artifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: "1".repeat(64),
        contentType: "text",
        createdAt: "2026-07-13T10:00:00.000Z",
        documentAssetId: asset.id,
        elements: [
          {
            id: "heading-1",
            metadata: {},
            sectionPath: ["Retry"],
            text: "First attempt",
            type: "heading",
          },
        ],
        id: canonicalArtifactId,
        metadata: {},
        parser: "native-markdown",
        version: asset.version,
      }),
    );
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-canonical-retry-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 2 });
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 2,
    });
    const reindexInputArtifactIds: string[] = [];
    const semanticArtifactIds: string[] = [];
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests,
      objectStorage: adapter.objectStorage,
      outlineBuilder: createDocumentOutlineBuilder({
        generateId: sequenceIds([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f6e04",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f6e05",
        ]),
        maxElements: 10,
        maxNodes: 10,
        maxSummaryChars: 200,
        now: () => "2026-07-13T10:00:00.000Z",
      }),
      outlines,
      parser: {
        kind: "native-markdown",
        parse: async (input) =>
          ParseArtifactSchema.parse({
            artifactHash: "2".repeat(64),
            contentType: "text",
            createdAt: "2026-07-13T10:01:00.000Z",
            documentAssetId: input.documentAssetId,
            elements: [
              {
                id: "heading-1",
                metadata: {},
                sectionPath: ["Retry"],
                text: "Retry attempt",
                type: "heading",
              },
            ],
            id: retryArtifactId,
            metadata: {},
            parser: "native-markdown",
            version: input.version,
          }),
      },
      reindexer: {
        canonicalizeArtifact: async (input) => artifacts.create(input),
        reindex: async (input) => {
          reindexInputArtifactIds.push(input.parseArtifact.id);
          const canonicalArtifact = await artifacts.create(input.parseArtifact);
          return {
            artifact: canonicalArtifact,
            nodesCreated: 1,
            projectionIds: [],
            projectionsCreated: 0,
            status: "rebuilt",
          };
        },
      },
      semanticPostProcessor: {
        process: async ({ parseArtifact }) => {
          semanticArtifactIds.push(parseArtifact.id);
          return {
            entitiesExtracted: 0,
            graphEntityIds: [],
            graphEntitiesIndexed: 0,
            graphRelationIds: [],
            graphRelationsIndexed: 0,
            nodesScanned: 0,
            nodesUpdated: 0,
            parseArtifactId: parseArtifact.id,
            semanticCommunitiesMaterialized: 0,
          };
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).resolves.toMatchObject({ stage: "published" });
    expect(reindexInputArtifactIds).toEqual([canonicalArtifactId]);
    expect(semanticArtifactIds).toEqual([canonicalArtifactId]);
    await expect(
      artifacts.getByDocumentVersion({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toMatchObject({ id: canonicalArtifactId });
    await expect(artifacts.getById({ id: retryArtifactId })).resolves.toBeNull();
    await expect(
      outlines.getByDocumentVersion({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toMatchObject({ parseArtifactId: canonicalArtifactId });
    await expect(
      multimodalManifests.getByDocumentVersion({
        documentAssetId: asset.id,
        version: asset.version,
      }),
    ).resolves.toMatchObject({ parseArtifactId: canonicalArtifactId });
  });

  it("does not expose legacy ready projections when outline construction fails", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-07-13T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Outline-failure.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6f01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Outline-failure.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Failure"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-outline-failure-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    let reindexCalls = 0;
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 1,
      }),
      objectStorage: adapter.objectStorage,
      outlineBuilder: {
        build: () => {
          throw new Error("outline failed");
        },
      },
      outlines: createInMemoryDocumentOutlineRepository({ maxOutlines: 1 }),
      parser: parser(),
      reindexer: {
        canonicalizeArtifact: async (input) => input,
        reindex: async (input) => {
          reindexCalls += 1;
          return {
            artifact: input.parseArtifact,
            nodesCreated: 1,
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toThrow("outline failed");
    expect(reindexCalls).toBe(0);
  });

  it("wraps durable document compilation work in a publish lease", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 4,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Worker.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Worker.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Worker"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-lease-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 4 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 10,
    });
    const knowledgePaths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    const semanticCalls: unknown[] = [];
    const reindexCalls: unknown[] = [];
    const projectionLifecycle: string[] = [];
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 4 });
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 4,
    });
    const frozenEmbeddingProfile = {
      dimension: 768,
      model: "frozen-space-model",
      pluginId: "frozen-space/plugin",
      provider: "frozen-space-provider",
      revision: 5,
      vectorSpaceId: `embedding-space-sha256:${"e".repeat(64)}`,
    } as const;
    const frozenRetrievalProfile = {
      defaultMode: "research" as const,
      reasoningModel: {
        model: "frozen-reasoning-model",
        pluginId: "frozen-reasoning/plugin",
        provider: "frozen-reasoning-provider",
      },
      rerank: { enabled: false },
      revision: 7,
      scoreThreshold: { enabled: false, stage: "mode-final" as const },
      topK: 12,
    };
    let mutableEmbeddingReads = 0;
    let frozenRetrievalObserved = false;
    const summaryEnhancer = createDocumentOutlineSummaryEnhancer({
      maxInputChars: 200,
      maxSummaryChars: 80,
      model: "outline-summary-model",
      promptVersion: "document-outline-summary-v1",
      provider: {
        summarize: async (input) => ({
          summary: `provider summary for ${input.title}`,
        }),
      },
    });
    const worker = createDocumentCompilationWorker({
      assets,
      embeddingResolver: {
        resolve: async () => {
          mutableEmbeddingReads += 1;
          throw new Error("mutable embedding profile must not be read");
        },
      },
      frozenEmbeddingProfile,
      frozenRetrievalProfile,
      generateKnowledgePathId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a05",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a06",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a07",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a08",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a09",
      ]),
      jobs: compilationJobs,
      knowledgePaths,
      multimodalManifests,
      objectStorage: adapter.objectStorage,
      operationLeases: createKnowledgeFsOperationLeaseCoordinator({
        generateLeaseId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f5c01",
        leaseTtlMs: 60_000,
        leases,
        now: () => "2026-05-27T10:00:00.000Z",
        sessionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      }),
      parser: parser(),
      outlineBuilder: createDocumentOutlineBuilder({
        generateId: sequenceIds([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f6a03",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f6a04",
        ]),
        maxElements: 20,
        maxNodes: 10,
        maxSummaryChars: 200,
        now: () => "2026-05-27T10:00:00.000Z",
      }),
      outlineSummaryEnhancer: {
        enhance: async (input) => {
          frozenRetrievalObserved = input.retrievalProfile === frozenRetrievalProfile;
          return summaryEnhancer.enhance(input);
        },
      },
      outlines,
      reindexer: {
        failProjections: async (input) => {
          projectionLifecycle.push("fail");
          return input.projectionIds.length;
        },
        publishProjections: async (input) => {
          projectionLifecycle.push("publish");
          return input.projectionIds.length;
        },
        reindex: async (input) => {
          projectionLifecycle.push("reindex");
          reindexCalls.push(input);
          return {
            artifact: input.parseArtifact,
            nodesCreated: 1,
            projectionIds: ["projection-worker-1"],
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
      semanticPostProcessor: {
        process: async (input) => {
          semanticCalls.push(input);

          return {
            entitiesExtracted: 2,
            graphEntityIds: [],
            graphEntitiesIndexed: 2,
            graphRelationIds: [],
            graphRelationsIndexed: 0,
            nodesScanned: 1,
            nodesUpdated: 1,
            parseArtifactId: input.parseArtifact.id,
            semanticCommunitiesMaterialized: 1,
          };
        },
      },
      smokeEvaluation: {
        evaluate: async () => {
          projectionLifecycle.push("smoke");
          return {
            decision: "passed",
            evaluation: {
              items: [],
              metrics: {
                citationHitRate: 1,
                noAnswerRate: 0,
                recallAtK: 1,
                totalQuestions: 1,
              },
            },
          };
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).resolves.toMatchObject({ stage: "published" });
    await expect(
      outlines.getByDocumentVersion({ documentAssetId: asset.id, version: 1 }),
    ).resolves.toMatchObject({
      documentAssetId: asset.id,
      metadata: {
        summary: {
          model: "outline-summary-model",
          promptVersion: "document-outline-summary-v1",
          source: "provider",
        },
      },
      nodes: [
        { summary: "provider summary for Worker", title: "Worker", tocSource: "parser-heading" },
      ],
    });
    await expect(
      multimodalManifests.getByDocumentVersion({ documentAssetId: asset.id, version: 1 }),
    ).resolves.toMatchObject({
      documentAssetId: asset.id,
      items: [expect.objectContaining({ parseElementId: "figure-1" })],
      version: 1,
    });
    await expect(
      knowledgePaths.get({
        knowledgeSpaceId: asset.knowledgeSpaceId,
        virtualPath: "/knowledge/docs/Worker.md--018f0d60/outline.json",
      }),
    ).resolves.toMatchObject({
      metadata: { contentKind: "document-outline" },
      targetId: asset.id,
    });
    await expect(
      knowledgePaths.get({
        knowledgeSpaceId: asset.knowledgeSpaceId,
        virtualPath: "/knowledge/docs/Worker.md--018f0d60/multimodal.json",
      }),
    ).resolves.toMatchObject({
      metadata: { contentKind: "document-multimodal-manifest" },
      targetId: asset.id,
    });
    const assetPaths = await knowledgePaths.listPhysicalDescendants({
      knowledgeSpaceId: asset.knowledgeSpaceId,
      limit: 10,
      parentPath: "/knowledge/docs/Worker.md--018f0d60/assets",
      viewName: "docs",
    });
    expect(assetPaths.items).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentKind: "document-multimodal-asset",
          itemId: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a02:1:figure-1",
          modality: "image",
          objectKey: expect.stringMatching(
            /^tenant-1\/spaces\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42\/documents\/018f0d60-7a49-7cc2-9c1b-5b36f18f6a01\/assets\/figure-1-[a-f0-9]{12}\.png$/u,
          ),
        }),
        targetId: asset.id,
        virtualPath:
          "/knowledge/docs/Worker.md--018f0d60/assets/image-Worker-diagram--018f0d60.json",
      }),
    ]);
    await expect(
      adapter.objectStorage.getObject(String(assetPaths.items[0]?.metadata.objectKey)),
    ).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    const sectionPaths = await knowledgePaths.listPhysicalDescendants({
      knowledgeSpaceId: asset.knowledgeSpaceId,
      limit: 10,
      parentPath: "/knowledge/docs/Worker.md--018f0d60/sections",
      viewName: "docs",
    });
    expect(sectionPaths.items).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentKind: "document-section",
          sectionPath: ["Worker"],
        }),
        targetId: asset.id,
      }),
    ]);
    expect(semanticCalls).toEqual([
      {
        knowledgeSpaceId: asset.knowledgeSpaceId,
        parseArtifact: expect.objectContaining({ documentAssetId: asset.id }),
        tenantId: "tenant-1",
      },
    ]);
    expect(reindexCalls).toEqual([
      expect.objectContaining({
        denseModel: frozenEmbeddingProfile.vectorSpaceId,
        embeddingProfile: frozenEmbeddingProfile,
        projectionStatus: "building",
        tenantId: "tenant-1",
      }),
    ]);
    expect(mutableEmbeddingReads).toBe(0);
    expect(frozenRetrievalObserved).toBe(true);
    expect(projectionLifecycle).toEqual(["reindex", "smoke", "publish"]);
    await expect(
      leases.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f5c01",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      leaseType: "publish",
      status: "released",
      targetId: asset.id,
      targetVersion: 1,
      virtualPath: `/sources/documents/${asset.id}`,
    });
  });

  it("fails staged projections without publishing when smoke evaluation rejects them", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 4,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Rejected.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6c01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Rejected.md",
      sha256: "d".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Rejected"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-rejected-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 4 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const projectionLifecycle: string[] = [];
    const failedProjectionInputs: unknown[] = [];
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 4,
      }),
      objectStorage: adapter.objectStorage,
      parser: parser(),
      reindexer: {
        failProjections: async (input) => {
          projectionLifecycle.push("fail");
          failedProjectionInputs.push(input);
          return input.projectionIds.length;
        },
        publishProjections: async () => {
          projectionLifecycle.push("publish");
          return 1;
        },
        reindex: async (input) => {
          projectionLifecycle.push(`reindex:${input.projectionStatus}`);
          return {
            artifact: input.parseArtifact,
            nodesCreated: 1,
            projectionIds: ["projection-rejected-1"],
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
      smokeEvaluation: {
        evaluate: async () => {
          projectionLifecycle.push("smoke");
          return {
            decision: "failed",
            evaluation: {
              items: [],
              metrics: {
                citationHitRate: 0,
                noAnswerRate: 1,
                recallAtK: 0,
                totalQuestions: 1,
              },
            },
            rejectedReason: "candidate recall below threshold",
          };
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toThrow(
      "Document compilation smoke evaluation failed: candidate recall below threshold",
    );
    expect(projectionLifecycle).toEqual(["reindex:building", "smoke", "fail"]);
    expect(failedProjectionInputs).toEqual([
      {
        knowledgeSpaceId: asset.knowledgeSpaceId,
        projectionIds: ["projection-rejected-1"],
      },
    ]);
    await expect(
      assets.get({ id: asset.id, knowledgeSpaceId: asset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ parserStatus: "failed" });
    await expect(compilationJobs.get(compilationJob.id)).resolves.toMatchObject({
      stage: "failed",
    });
  });

  it("fails every staged projection when publication only updates part of the candidate", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 4,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Partial.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6d01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Partial.md",
      sha256: "e".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Partial"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-partial-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 4 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const projectionLifecycle: string[] = [];
    const failedProjectionInputs: unknown[] = [];
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 4,
      }),
      objectStorage: adapter.objectStorage,
      parser: parser(),
      reindexer: {
        failProjections: async (input) => {
          projectionLifecycle.push("fail");
          failedProjectionInputs.push(input);
          return input.projectionIds.length;
        },
        publishProjections: async (input) => {
          projectionLifecycle.push(`publish:${input.projectionIds.length}`);
          return 1;
        },
        reindex: async (input) => {
          projectionLifecycle.push(`reindex:${input.projectionStatus}`);
          return {
            artifact: input.parseArtifact,
            nodesCreated: 1,
            projectionIds: ["projection-partial-1", "projection-partial-2"],
            projectionsCreated: 2,
            status: "rebuilt",
          };
        },
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toThrow("Document compilation published 1 of 2 staged projections");
    expect(projectionLifecycle).toEqual(["reindex:building", "publish:2", "fail"]);
    expect(failedProjectionInputs).toEqual([
      {
        knowledgeSpaceId: asset.knowledgeSpaceId,
        projectionIds: ["projection-partial-1", "projection-partial-2"],
      },
    ]);
    await expect(
      assets.get({ id: asset.id, knowledgeSpaceId: asset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ parserStatus: "failed" });
  });

  it("rasterizes PDF multimodal candidates before async asset extraction", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 4,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Paper.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/asset/Paper.pdf",
      sha256: "c".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("%PDF-1.7"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-pdf-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 4 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const knowledgePaths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    const worker = createDocumentCompilationWorker({
      assets,
      generateKnowledgePathId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b05",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b06",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b07",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b08",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b09",
      ]),
      jobs: compilationJobs,
      knowledgePaths,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 4,
      }),
      objectStorage: adapter.objectStorage,
      parser: pdfParser(),
      pdfRasterizer: {
        render: async (input) => {
          expect(input).toMatchObject({
            boundingBox: { height: 40, width: 30, x: 10, y: 20 },
            elementId: "figure-1",
            pageNumber: 2,
          });

          return {
            body: new Uint8Array([9, 8, 7, 6]),
            contentType: "image/png",
          };
        },
      },
      outlineBuilder: createDocumentOutlineBuilder({
        generateId: sequenceIds([
          "018f0d60-7a49-7cc2-9c1b-5b36f18f6b03",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f6b04",
        ]),
        maxElements: 20,
        maxNodes: 10,
        maxSummaryChars: 200,
        now: () => "2026-05-27T10:00:00.000Z",
      }),
      outlines: createInMemoryDocumentOutlineRepository({ maxOutlines: 4 }),
      reindexer: {
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 1,
          projectionsCreated: 1,
          status: "rebuilt",
        }),
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).resolves.toMatchObject({ stage: "published" });

    const assetPaths = await knowledgePaths.listPhysicalDescendants({
      knowledgeSpaceId: asset.knowledgeSpaceId,
      limit: 10,
      parentPath: "/knowledge/docs/Paper.pdf--018f0d60/assets",
      viewName: "docs",
    });
    expect(assetPaths.items).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentKind: "document-multimodal-asset",
          modality: "image",
          objectKey: expect.stringMatching(/figure-1-[a-f0-9]{12}\.png$/u),
        }),
      }),
    ]);
    await expect(
      adapter.objectStorage.getObject(String(assetPaths.items[0]?.metadata.objectKey)),
    ).resolves.toEqual(new Uint8Array([9, 8, 7, 6]));
  });
});

function parser(): ParserAdapter {
  return {
    kind: "native-markdown",
    parse: async (input) =>
      ParseArtifactSchema.parse({
        artifactHash: "b".repeat(64),
        contentType: "mixed",
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: input.documentAssetId,
        elements: [
          {
            id: "element-1",
            metadata: {},
            sectionPath: ["Worker"],
            text: "Worker",
            type: "heading",
          },
          {
            id: "figure-1",
            metadata: {
              assetRef: {
                contentType: "image/png",
                uri: "data:image/png;base64,AQIDBA==",
              },
              caption: "Worker diagram",
            },
            sectionPath: ["Worker"],
            text: "Worker diagram",
            type: "image",
          },
        ],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a02",
        metadata: {},
        parser: "native-markdown",
        version: input.version,
      }),
  };
}

function pdfParser(): ParserAdapter {
  return {
    kind: "unstructured",
    parse: async (input) =>
      ParseArtifactSchema.parse({
        artifactHash: "d".repeat(64),
        contentType: "mixed",
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: input.documentAssetId,
        elements: [
          {
            id: "element-1",
            metadata: {},
            pageNumber: 1,
            sectionPath: ["Paper"],
            text: "Paper",
            type: "heading",
          },
          {
            id: "figure-1",
            metadata: {
              boundingBox: { height: 40, width: 30, x: 10, y: 20 },
              caption: "PDF figure",
            },
            pageNumber: 2,
            sectionPath: ["Paper"],
            text: "PDF figure",
            type: "image",
          },
        ],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b02",
        metadata: {},
        parser: "unstructured",
        version: input.version,
      }),
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
