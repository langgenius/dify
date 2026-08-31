import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { ParseArtifactSchema, type PlatformAdapter } from "@knowledge/core";
import {
  type ParserAdapter,
  type ParserRouteHints,
  classifyUnstructuredWorkload,
} from "@knowledge/parsers";
import { describe, expect, it } from "vitest";

import {
  DeletionLifecycleFenceActiveError,
  createDeletionLifecycleFenceGuard,
  createInMemoryDeletionLifecycleFenceReader,
} from "./deletion-lifecycle-fence";

import {
  createConcurrencyGate,
  createDocumentCompilationJobStateMachine,
  createDocumentCompilationWorker,
  createDocumentMultimodalManifestBuilder,
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
  it.each([
    {
      checkpointEligible: false,
      expectedCheckpointReads: 0,
      expectedCheckpointWrites: 0,
      expectedOperations: ["parse", "retention:acquire", "reindex", "retention:release"],
      label: "native",
    },
    {
      checkpointEligible: true,
      expectedCheckpointReads: 1,
      expectedCheckpointWrites: 1,
      expectedOperations: [
        "lease:30000",
        "parse",
        "lease:30000",
        "checkpoint",
        "lease:0",
        "retention:acquire",
        "reindex",
        "retention:release",
      ],
      label: "Unstructured",
    },
  ])(
    "persists raw parser output only for the $label route",
    async ({
      checkpointEligible,
      expectedCheckpointReads,
      expectedCheckpointWrites,
      expectedOperations,
    }) => {
      const adapter = createTestPlatformAdapter();
      const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
      const asset = await assets.create({
        filename: checkpointEligible ? "Expensive.pdf" : "Cheap.md",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a11",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mimeType: checkpointEligible ? "application/pdf" : "text/markdown",
        objectKey: "tenant-1/spaces/space/documents/asset/checkpoint-eligibility",
        sha256: "f".repeat(64),
        sizeBytes: 11,
      });
      await adapter.objectStorage.putObject({
        body: new TextEncoder().encode("# document"),
        contentType: asset.mimeType,
        key: asset.objectKey,
        metadata: {},
      });
      const jobs = createDocumentCompilationJobStateMachine({
        generateId: () => "document-compilation-job-checkpoint-eligibility-1",
        jobs: adapter.jobs,
        repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
      });
      const job = await jobs.start({
        documentAssetId: asset.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      });
      const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
      const baseParser = parser();
      let checkpointReads = 0;
      let checkpointWrites = 0;
      const operations: string[] = [];
      const worker = createDocumentCompilationWorker({
        assets,
        failureManagement: "caller",
        jobs,
        multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
          maxManifests: 1,
        }),
        objectStorage: adapter.objectStorage,
        parser: {
          ...baseParser,
          ...(checkpointEligible ? { checkpointEligible: () => true } : {}),
          kind: checkpointEligible ? "unstructured" : "native-markdown",
          ...(checkpointEligible ? { leaseMs: () => 30_000 } : {}),
          parse: async (input) => {
            operations.push("parse");
            return baseParser.parse(input);
          },
          policyFingerprint: () => "9".repeat(64),
        },
        retainedArtifactAdmission: {
          acquire: async () => {
            operations.push("retention:acquire");
            return {
              estimatedBytes: 1,
              release: () => {
                operations.push("retention:release");
              },
            };
          },
        },
        reindexer: {
          canonicalizeArtifact: (artifact) => artifacts.materialize(artifact),
          checkpointParseArtifact: (input) => {
            checkpointWrites += 1;
            operations.push("checkpoint");
            return artifacts.checkpoint(input);
          },
          deleteParseArtifactCheckpoint: (input) => artifacts.deleteCheckpoint(input),
          getCanonicalArtifact: (input) => artifacts.getByDocumentVersion(input),
          getParseArtifactCheckpoint: (input) => {
            checkpointReads += 1;
            return artifacts.getCheckpoint(input);
          },
          reindex: async (input) => {
            operations.push("reindex");
            return {
              artifact: input.parseArtifact,
              nodesCreated: 0,
              projectionIds: [],
              projectionsCreated: 0,
              status: "rebuilt",
            };
          },
        },
      });

      await expect(
        worker.process(
          {
            documentAssetId: asset.id,
            documentCompilationJobId: job.id,
            knowledgeSpaceId: asset.knowledgeSpaceId,
            tenantId: "tenant-1",
            version: asset.version,
          },
          {
            protectLease: async (minLeaseMs) => {
              operations.push(`lease:${minLeaseMs}`);
            },
          },
        ),
      ).resolves.toMatchObject({ stage: "published" });
      expect(checkpointReads).toBe(expectedCheckpointReads);
      expect(checkpointWrites).toBe(expectedCheckpointWrites);
      expect(operations).toEqual(expectedOperations);
    },
  );

  it("does not checkpoint parser output after the execution loses its protected lease", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Lease-loss.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a12",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/asset/lease-loss",
      sha256: "e".repeat(64),
      sizeBytes: 11,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("document"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const jobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-lease-loss-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const job = await jobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const baseParser = parser();
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    let checkpointWrites = 0;
    let protectionCalls = 0;
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      jobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: adapter.objectStorage,
      parser: {
        ...baseParser,
        checkpointEligible: () => true,
        kind: "unstructured",
        leaseMs: () => 30_000,
        policyFingerprint: () => "8".repeat(64),
      },
      reindexer: {
        checkpointParseArtifact: async (input) => {
          checkpointWrites += 1;
          return artifacts.checkpoint(input);
        },
        getParseArtifactCheckpoint: async () => null,
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 0,
          projectionIds: [],
          projectionsCreated: 0,
          status: "rebuilt",
        }),
      },
    });

    await expect(
      worker.process(
        {
          documentAssetId: asset.id,
          documentCompilationJobId: job.id,
          knowledgeSpaceId: asset.knowledgeSpaceId,
          tenantId: "tenant-1",
          version: asset.version,
        },
        {
          protectLease: async () => {
            protectionCalls += 1;
            if (protectionCalls === 2) throw new Error("execution lease lost");
          },
        },
      ),
    ).rejects.toThrow("execution lease lost");
    expect(protectionCalls).toBe(2);
    expect(checkpointWrites).toBe(0);
  });

  it("releases protection only when a failed provider request has a known outcome", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Provider-failure.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a13",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/asset/provider-failure",
      sha256: "d".repeat(64),
      sizeBytes: 11,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("document"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const jobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-provider-failure-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const job = await jobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const protectionCalls: number[] = [];
    const processWithOutcome = async (requestOutcomeAmbiguous: boolean) => {
      const worker = createDocumentCompilationWorker({
        assets,
        failureManagement: "caller",
        jobs,
        multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
          maxManifests: 1,
        }),
        objectStorage: adapter.objectStorage,
        parser: {
          checkpointEligible: () => true,
          kind: "unstructured",
          leaseMs: () => 30_000,
          parse: async () => {
            throw Object.assign(new Error("provider request failed"), {
              requestOutcomeAmbiguous,
            });
          },
          policyFingerprint: () => "7".repeat(64),
        },
        reindexer: {
          getParseArtifactCheckpoint: async () => null,
          reindex: async (input) => ({
            artifact: input.parseArtifact,
            nodesCreated: 0,
            projectionIds: [],
            projectionsCreated: 0,
            status: "rebuilt",
          }),
        },
      });
      return worker.process(
        {
          documentAssetId: asset.id,
          documentCompilationJobId: job.id,
          knowledgeSpaceId: asset.knowledgeSpaceId,
          tenantId: "tenant-1",
          version: asset.version,
        },
        {
          protectLease: async (minLeaseMs) => {
            protectionCalls.push(minLeaseMs);
          },
        },
      );
    };

    await expect(processWithOutcome(false)).rejects.toThrow("provider request failed");
    expect(protectionCalls).toEqual([30_000, 0]);
    await expect(processWithOutcome(true)).rejects.toThrow("provider request failed");
    expect(protectionCalls).toEqual([30_000, 0, 30_000]);
  });

  it("classifies a transient raw checkpoint write failure as retryable", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Retryable-checkpoint.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a71",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/asset/retryable-checkpoint",
      sha256: "6".repeat(64),
      sizeBytes: 11,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("document"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const jobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-retryable-checkpoint-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const job = await jobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const baseParser = parser();
    const protectionCalls: number[] = [];
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      jobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: adapter.objectStorage,
      parser: {
        ...baseParser,
        checkpointEligible: () => true,
        kind: "unstructured",
        leaseMs: () => 30_000,
        policyFingerprint: () => "5".repeat(64),
      },
      reindexer: {
        checkpointParseArtifact: async () => {
          throw new Error("checkpoint database temporarily unavailable");
        },
        getParseArtifactCheckpoint: async () => null,
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 0,
          projectionIds: [],
          projectionsCreated: 0,
          status: "rebuilt",
        }),
      },
    });

    await expect(
      worker.process(
        {
          documentAssetId: asset.id,
          documentCompilationJobId: job.id,
          knowledgeSpaceId: asset.knowledgeSpaceId,
          tenantId: "tenant-1",
          version: asset.version,
        },
        {
          protectLease: async (minLeaseMs) => {
            protectionCalls.push(minLeaseMs);
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "DOCUMENT_COMPILATION_RETRYABLE",
      retryable: true,
    });
    expect(protectionCalls).toEqual([30_000, 30_000, 0]);
    await expect(jobs.get(job.id)).resolves.toMatchObject({ stage: "queued" });
  });

  it("classifies a transient raw checkpoint read failure before parsing as retryable", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Checkpoint-read.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a72",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/asset/checkpoint-read",
      sha256: "5".repeat(64),
      sizeBytes: 11,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("document"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const jobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-checkpoint-read-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const job = await jobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const baseParser = parser();
    let parseCalls = 0;
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      jobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: adapter.objectStorage,
      parser: {
        ...baseParser,
        checkpointEligible: () => true,
        kind: "unstructured",
        parse: async (input) => {
          parseCalls += 1;
          return baseParser.parse(input);
        },
        policyFingerprint: () => "4".repeat(64),
      },
      reindexer: {
        getParseArtifactCheckpoint: async () => {
          throw new Error("checkpoint database temporarily unavailable");
        },
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 0,
          projectionIds: [],
          projectionsCreated: 0,
          status: "rebuilt",
        }),
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: job.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_COMPILATION_RETRYABLE",
      retryable: true,
    });
    expect(parseCalls).toBe(0);
    await expect(jobs.get(job.id)).resolves.toMatchObject({ stage: "queued" });
  });

  it("keeps parsed resume retryable when its raw checkpoint read fails", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Parsed-checkpoint-read.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a73",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/asset/parsed-checkpoint-read",
      sha256: "4".repeat(64),
      sizeBytes: 11,
    });
    const body = new TextEncoder().encode("document");
    await adapter.objectStorage.putObject({
      body,
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const jobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-parsed-checkpoint-read-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const job = await jobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    const baseParser = parser();
    await artifacts.create(
      await baseParser.parse({
        body,
        documentAssetId: asset.id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        version: asset.version,
      }),
    );
    await jobs.advance(job.id, "parsed");
    let parseCalls = 0;
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      jobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: adapter.objectStorage,
      parser: {
        ...baseParser,
        parse: async (input) => {
          parseCalls += 1;
          return baseParser.parse(input);
        },
      },
      reindexer: {
        getCanonicalArtifact: (input) => artifacts.getByDocumentVersion(input),
        getParseArtifactCheckpoint: async () => {
          throw new Error("checkpoint database temporarily unavailable");
        },
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 0,
          projectionIds: [],
          projectionsCreated: 0,
          status: "rebuilt",
        }),
      },
    });

    await expect(
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: job.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_COMPILATION_RETRYABLE",
      retryable: true,
    });
    expect(parseCalls).toBe(0);
    await expect(jobs.get(job.id)).resolves.toMatchObject({ stage: "parsed" });
  });

  it("reuses a raw parse checkpoint across attempts but misses after a parser policy upgrade", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Remote-image.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a21",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown; charset=utf-8",
      objectKey: "tenant-1/spaces/space/documents/asset/Remote-image.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Remote image"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-raw-checkpoint-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    let parseCalls = 0;
    let fetchCalls = 0;
    let currentParserVersion = "unstructured@checkpoint-test-v1";
    const checkpointingParser: ParserAdapter = {
      checkpointEligible: () => true,
      kind: "unstructured",
      parse: async (input) => {
        parseCalls += 1;
        return ParseArtifactSchema.parse({
          artifactHash: "c".repeat(64),
          contentType: "mixed",
          createdAt: "2026-05-27T10:00:00.000Z",
          documentAssetId: input.documentAssetId,
          elements: [
            {
              id: "remote-figure",
              metadata: {
                assetRef: {
                  contentType: "image/png",
                  uri: "https://example.test/figure.png",
                },
              },
              sectionPath: ["Remote"],
              text: "Remote figure",
              type: "image",
            },
          ],
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a22",
          metadata: { parserVersion: currentParserVersion },
          parser: "unstructured",
          version: input.version,
        });
      },
      policyFingerprint: () =>
        currentParserVersion.endsWith("-v1") ? "a".repeat(64) : "b".repeat(64),
    };
    const createWorker = (jobs: ReturnType<typeof createDocumentCompilationJobStateMachine>) =>
      createDocumentCompilationWorker({
        assets,
        failureManagement: "caller",
        jobs,
        multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
          maxManifests: 1,
        }),
        multimodalRemoteAssetFetcher: {
          fetch: async () => {
            fetchCalls += 1;
            if (fetchCalls <= 2) throw new Error("remote image temporarily unavailable");
            return { body: Uint8Array.from([1, 2, 3, 4]), contentType: "image/png" };
          },
        },
        objectStorage: adapter.objectStorage,
        parser: checkpointingParser,
        reindexer: {
          canonicalizeArtifact: (artifact) => artifacts.materialize(artifact),
          checkpointParseArtifact: (input) => artifacts.checkpoint(input),
          deleteParseArtifactCheckpoint: (input) => artifacts.deleteCheckpoint(input),
          getCanonicalArtifact: (input) => artifacts.getByDocumentVersion(input),
          getParseArtifactCheckpoint: (input) => artifacts.getCheckpoint(input),
          reindex: async (input) => ({
            artifact: input.parseArtifact,
            nodesCreated: 0,
            projectionIds: [],
            projectionsCreated: 0,
            status: "rebuilt",
          }),
        },
      });
    const worker = createWorker(compilationJobs);
    const payload = {
      documentAssetId: asset.id,
      documentCompilationJobId: compilationJob.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    } as const;

    await expect(worker.process(payload)).rejects.toThrow("remote image temporarily unavailable");
    expect(parseCalls).toBe(1);
    await expect(compilationJobs.get(compilationJob.id)).resolves.toMatchObject({
      stage: "queued",
    });
    await expect(
      artifacts.getByDocumentVersion({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toBeNull();
    await expect(
      artifacts.getCheckpoint({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toMatchObject({
      policyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });

    const retryJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-raw-checkpoint-2",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const retryJob = await retryJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const retryPayload = {
      ...payload,
      documentCompilationJobId: retryJob.id,
    };
    const retryWorker = createWorker(retryJobs);
    await expect(retryWorker.process(retryPayload)).rejects.toThrow(
      "remote image temporarily unavailable",
    );
    expect(parseCalls).toBe(1);
    currentParserVersion = "unstructured@checkpoint-test-v2";
    await expect(retryWorker.process(retryPayload)).resolves.toMatchObject({ stage: "published" });
    expect(parseCalls).toBe(2);
    expect(fetchCalls).toBe(3);
    await expect(
      artifacts.getByDocumentVersion({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toMatchObject({
      elements: [
        expect.objectContaining({
          metadata: expect.objectContaining({
            assetRef: expect.objectContaining({ objectKey: expect.any(String) }),
          }),
        }),
      ],
    });
    await expect(
      artifacts.getCheckpoint({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toBeNull();
  });

  it("retains the raw parse checkpoint while canonical materialization remains ambiguous", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Ambiguous-canonical.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a31",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Ambiguous-canonical.md",
      sha256: "d".repeat(64),
      sizeBytes: 21,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Ambiguous canonical"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-ambiguous-canonical-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    const baseParser = parser();
    let canonicalReads = 0;
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: adapter.objectStorage,
      parser: {
        ...baseParser,
        checkpointEligible: () => true,
        policyFingerprint: () => "c".repeat(64),
      },
      reindexer: {
        canonicalizeArtifact: async () => {
          throw new Error("canonical commit result unknown");
        },
        checkpointParseArtifact: (input) => artifacts.checkpoint(input),
        deleteParseArtifactCheckpoint: (input) => artifacts.deleteCheckpoint(input),
        getCanonicalArtifact: async () => {
          canonicalReads += 1;
          if (canonicalReads === 1) return null;
          throw new Error("canonical reconciliation unavailable");
        },
        getParseArtifactCheckpoint: (input) => artifacts.getCheckpoint(input),
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 0,
          projectionsCreated: 0,
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
    ).rejects.toThrow("Parse artifact materialization outcome is ambiguous");
    await expect(
      artifacts.getCheckpoint({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toMatchObject({ policyFingerprint: "c".repeat(64) });
    await expect(
      artifacts.getByDocumentVersion({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toBeNull();
  });

  it("keeps a raw parse checkpoint until the parsed stage is durable", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Parsed-stage-retry.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a41",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Parsed-stage-retry.md",
      sha256: "e".repeat(64),
      sizeBytes: 20,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Parsed stage retry"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-parsed-stage-retry-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    let failParsedAdvance = true;
    const flakyJobs: typeof compilationJobs = {
      ...compilationJobs,
      advance: async (id, stage) => {
        if (stage === "parsed" && failParsedAdvance) {
          failParsedAdvance = false;
          throw new Error("parsed stage persistence unavailable");
        }
        return compilationJobs.advance(id, stage);
      },
    };
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    const baseParser = parser();
    let parseCalls = 0;
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      jobs: flakyJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 2 }),
      objectStorage: adapter.objectStorage,
      parser: {
        ...baseParser,
        checkpointEligible: () => true,
        parse: async (input) => {
          parseCalls += 1;
          return baseParser.parse(input);
        },
        policyFingerprint: () => "d".repeat(64),
      },
      reindexer: {
        canonicalizeArtifact: (input) => artifacts.materialize(input),
        checkpointParseArtifact: (input) => artifacts.checkpoint(input),
        deleteParseArtifactCheckpoint: (input) => artifacts.deleteCheckpoint(input),
        getCanonicalArtifact: (input) => artifacts.getByDocumentVersion(input),
        getParseArtifactCheckpoint: (input) => artifacts.getCheckpoint(input),
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 0,
          projectionsCreated: 0,
          status: "rebuilt",
        }),
      },
    });
    const payload = {
      documentAssetId: asset.id,
      documentCompilationJobId: compilationJob.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    } as const;

    await expect(worker.process(payload)).rejects.toThrow("parsed stage persistence unavailable");
    expect(parseCalls).toBe(1);
    await expect(
      artifacts.getCheckpoint({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toMatchObject({ policyFingerprint: "d".repeat(64) });

    await expect(worker.process(payload)).resolves.toMatchObject({ stage: "published" });
    expect(parseCalls).toBe(1);
    await expect(
      artifacts.getCheckpoint({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toBeNull();
  });

  it("retries raw checkpoint cleanup from canonical parsed state without reparsing", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Checkpoint-cleanup-retry.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a51",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/asset/Checkpoint-cleanup-retry.pdf",
      sha256: "7".repeat(64),
      sizeBytes: 24,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("expensive provider input"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const jobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-checkpoint-cleanup-retry-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const job = await jobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    const baseParser = parser();
    let cleanupAttempts = 0;
    let parseCalls = 0;
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      jobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 2 }),
      objectStorage: adapter.objectStorage,
      parser: {
        ...baseParser,
        checkpointEligible: () => true,
        kind: "unstructured",
        parse: async (input) => {
          parseCalls += 1;
          return baseParser.parse(input);
        },
        policyFingerprint: () => "8".repeat(64),
      },
      reindexer: {
        canonicalizeArtifact: (input) => artifacts.materialize(input),
        checkpointParseArtifact: (input) => artifacts.checkpoint(input),
        deleteParseArtifactCheckpoint: async (input) => {
          cleanupAttempts += 1;
          if (cleanupAttempts === 1) throw new Error("checkpoint cleanup unavailable");
          return artifacts.deleteCheckpoint(input);
        },
        getCanonicalArtifact: (input) => artifacts.getByDocumentVersion(input),
        getParseArtifactCheckpoint: (input) => artifacts.getCheckpoint(input),
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 0,
          projectionIds: [],
          projectionsCreated: 0,
          status: "rebuilt",
        }),
      },
    });
    const payload = {
      documentAssetId: asset.id,
      documentCompilationJobId: job.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    } as const;

    await expect(worker.process(payload)).rejects.toMatchObject({
      code: "DOCUMENT_COMPILATION_RETRYABLE",
      retryable: true,
    });
    expect(parseCalls).toBe(1);
    await expect(jobs.get(job.id)).resolves.toMatchObject({ stage: "parsed" });
    await expect(
      artifacts.getCheckpoint({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toMatchObject({ policyFingerprint: "8".repeat(64) });

    await expect(worker.process(payload)).resolves.toMatchObject({ stage: "published" });
    expect(parseCalls).toBe(1);
    expect(cleanupAttempts).toBe(2);
    await expect(
      artifacts.getCheckpoint({ documentAssetId: asset.id, version: asset.version }),
    ).resolves.toBeNull();
  });

  it("fails closed instead of silently writing a generation payload as legacy", async () => {
    const adapter = createTestPlatformAdapter();
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
    const adapter = createTestPlatformAdapter();
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
    const adapter = createTestPlatformAdapter();
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
    const adapter = createTestPlatformAdapter();
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
    const adapter = createTestPlatformAdapter();
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
    let outlineSummaryCalls = 0;
    let pageIndexBuildCalls = 0;
    let publishCalls = 0;
    const semanticAdmissions: unknown[] = [];
    let semanticCalls = 0;
    let smokeCalls = 0;
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 2 });
    const knowledgePaths = createInMemoryKnowledgePathRepository({
      maxBatchSize: 2,
      maxListLimit: 10,
      maxPaths: 10,
    });
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
          enableGraph: true,
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
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a3b",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a3c",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6a3d",
      ]),
      jobs: compilationJobs,
      knowledgePaths,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 2,
      }),
      objectStorage: adapter.objectStorage,
      outlineBuilder: createDocumentOutlineBuilder({
        maxElements: 10,
        maxNodes: 10,
        maxSummaryChars: 200,
      }),
      outlineSummaryEnhancer: {
        enhance: async (input) => {
          outlineSummaryCalls += 1;
          return input.outline;
        },
      },
      outlines,
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
            outlineArtifact: ParseArtifactSchema.parse({
              ...input.parseArtifact,
              elements: [
                {
                  id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a39",
                  metadata: { semanticSectionSummary: "发票身份、购买方和金额信息。" },
                  sectionPath: ["电子发票", "购买方与金额"],
                  text: "发票号码、购买方与价税合计",
                  type: "paragraph",
                },
              ],
              metadata: { semanticCompilation: { source: "llm-semantic-v1" } },
            }),
            projectionIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f6a3a"],
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
      semanticEnrichmentAdmission: {
        enqueue: async (input) => {
          semanticAdmissions.push(input);
        },
      },
      jointSemanticGraph: {
        materialize: async () => {
          semanticCalls += 1;
          return {
            entitiesExtracted: 1,
            graphEntityIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f6a3b"],
            graphEntitiesIndexed: 1,
            graphRelationIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f6a3c"],
            graphRelationsIndexed: 1,
            nodesScanned: 1,
            semanticProviderCalls: 0,
            semanticProviderCallsMaximum: 0,
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
          graphEntities: [
            {
              componentKey: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a3b",
              generationId,
            },
          ],
          graphRelations: [
            {
              componentKey: "018f0d60-7a49-7cc2-9c1b-5b36f18f6a3c",
              generationId,
            },
          ],
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
    expect(outlineSummaryCalls).toBe(0);
    expect(pageIndexBuildCalls).toBe(0);
    expect(semanticAdmissions).toEqual([]);
    expect(semanticCalls).toBe(1);
    expect(reindexInputs[0]).toEqual(
      expect.objectContaining({
        enableGraph: true,
        language: "zh-CN",
        retrievalProfile: expect.objectContaining({ revision: 4 }),
        skipDense: true,
      }),
    );
    expect(reindexInputs[0]).not.toHaveProperty("denseModel");
    expect(reindexInputs[0]).not.toHaveProperty("embeddingProfile");
    await expect(
      outlines.getByDocumentVersion({
        documentAssetId: asset.id,
        publicationGenerationId: generationId,
        version: asset.version,
      }),
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({ builder: "semantic-knowledge-nodes" }),
      nodes: [
        expect.objectContaining({
          sectionPath: ["电子发票"],
          children: [expect.objectContaining({ sectionPath: ["电子发票", "购买方与金额"] })],
        }),
      ],
    });
    await expect(
      assets.get({ id: asset.id, knowledgeSpaceId: asset.knowledgeSpaceId }),
    ).resolves.toMatchObject({ parserStatus: "pending" });
  });

  it("leaves transient status transitions to a durable caller", async () => {
    const adapter = createTestPlatformAdapter();
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

  it("resumes an outline-built generation without reparsing or regenerating LLM summaries", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-07-30T15:16:20.000Z",
    });
    const asset = await assets.create({
      filename: "Retry.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7001",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Retry.md",
      sha256: "a".repeat(64),
      sizeBytes: 7,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Retry"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7002";
    const canonicalArtifact = ParseArtifactSchema.parse({
      artifactHash: "b".repeat(64),
      contentType: "text",
      createdAt: "2026-07-30T15:16:21.000Z",
      documentAssetId: asset.id,
      elements: [
        {
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7003:element-1",
          metadata: {},
          sectionPath: ["Retry"],
          text: "Retry content",
          type: "heading",
        },
      ],
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7003",
      metadata: {},
      parser: "native-markdown",
      version: asset.version,
    });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 2 });
    await artifacts.create(canonicalArtifact);
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 2 });
    const outlineBuilder = createDocumentOutlineBuilder({
      maxElements: 10,
      maxNodes: 10,
      maxSummaryChars: 200,
      now: () => "2026-07-30T15:16:22.000Z",
    });
    const persistedOutline = await outlines.upsert(
      outlineBuilder.build({
        knowledgeSpaceId: asset.knowledgeSpaceId,
        parseArtifact: canonicalArtifact,
        publicationGenerationId: generationId,
      }),
    );
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 2,
    });
    const persistedManifest = await multimodalManifests.upsert(
      createDocumentMultimodalManifestBuilder().build({
        artifact: canonicalArtifact,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        publicationGenerationId: generationId,
      }),
    );
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-outline-retry-1",
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
    await compilationJobs.advance(compilationJob.id, "parsed");
    await compilationJobs.advance(compilationJob.id, "outline_built");
    let parserCalls = 0;
    let summaryCalls = 0;
    let canonicalArtifactAvailable = false;
    let manifestCheckpoint: "invalid" | "missing" | "valid" = "missing";
    let retainedArtifactActive = 0;
    let retainedArtifactAdmissions = 0;
    const receipts: unknown[] = [];
    const resetFailedProjectionFlags: Array<boolean | undefined> = [];
    const checkpointManifests = {
      ...multimodalManifests,
      getByDocumentVersion: async (
        input: Parameters<typeof multimodalManifests.getByDocumentVersion>[0],
      ) => {
        const manifest = await multimodalManifests.getByDocumentVersion(input);
        if (manifestCheckpoint === "missing" || !manifest) {
          return null;
        }

        return manifestCheckpoint === "invalid"
          ? { ...manifest, artifactHash: "c".repeat(64) }
          : manifest;
      },
    };
    const workerWithoutCheckpointLoader = createDocumentCompilationWorker({
      assets,
      candidateComposer: { compose: async () => undefined },
      failureManagement: "caller",
      generateKnowledgePathId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7004",
      jobs: compilationJobs,
      knowledgePaths: createInMemoryKnowledgePathRepository({
        maxListLimit: 20,
        maxPaths: 20,
      }),
      multimodalManifests,
      objectStorage: adapter.objectStorage,
      outlineBuilder,
      outlines,
      pageIndexBuild: {
        materializeBuilding: async () => {
          throw new Error("PageIndex must not run without a checkpoint artifact loader");
        },
      },
      parser: parser(),
      reindexer: {
        reindex: async () => {
          throw new Error("reindex must not run without a checkpoint artifact loader");
        },
      },
    });
    const payload = {
      documentAssetId: asset.id,
      documentCompilationJobId: compilationJob.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      publicationGenerationId: generationId,
      tenantId: "tenant-1",
      version: asset.version,
    } as const;

    await expect(
      workerWithoutCheckpointLoader.process({
        ...payload,
        documentCompilationJobId: "missing-document-compilation-job",
      }),
    ).rejects.toThrow("Document compilation job not found");
    await expect(workerWithoutCheckpointLoader.process(payload)).rejects.toThrow(
      "cannot load its parse artifact",
    );

    const worker = createDocumentCompilationWorker({
      assets,
      candidateComposer: {
        compose: async (input) => {
          receipts.push(input);
        },
      },
      failureManagement: "caller",
      generateKnowledgePathId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7004",
      jobs: compilationJobs,
      knowledgePaths: createInMemoryKnowledgePathRepository({
        maxListLimit: 20,
        maxPaths: 20,
      }),
      multimodalManifests: checkpointManifests,
      objectStorage: adapter.objectStorage,
      outlineBuilder,
      outlineSummaryEnhancer: {
        enhance: async () => {
          summaryCalls += 1;
          throw new Error("outline summary must not be regenerated");
        },
      },
      outlines,
      pageIndexBuild: {
        materializeBuilding: async () => {
          throw new Error("PageIndex must not be regenerated");
        },
      },
      parser: {
        kind: "native-markdown",
        parse: async () => {
          parserCalls += 1;
          throw new Error("document must not be reparsed");
        },
      },
      retainedArtifactAdmission: {
        acquire: async (artifact) => {
          expect(artifact.id).toBe(canonicalArtifact.id);
          retainedArtifactAdmissions += 1;
          retainedArtifactActive += 1;
          let released = false;
          return {
            estimatedBytes: 1,
            release: () => {
              if (released) return;
              released = true;
              retainedArtifactActive -= 1;
            },
          };
        },
      },
      reindexer: {
        getCanonicalArtifact: async (input) =>
          canonicalArtifactAvailable ? artifacts.getByDocumentVersion(input) : null,
        reindex: async (input) => {
          expect(retainedArtifactActive).toBe(1);
          resetFailedProjectionFlags.push(input.resetFailedProjections);
          return {
            artifact: input.parseArtifact,
            nodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7005"],
            nodesCreated: 1,
            projectionIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f7006"],
            projectionsCreated: 1,
            status: "rebuilt",
          };
        },
      },
    });

    await expect(worker.process(payload)).rejects.toThrow("parse artifact is missing");
    canonicalArtifactAvailable = true;
    await expect(worker.process(payload)).rejects.toThrow("derived components are missing");
    manifestCheckpoint = "invalid";
    await expect(worker.process(payload)).rejects.toThrow("derived component lineage is invalid");
    manifestCheckpoint = "valid";
    await expect(worker.process(payload)).resolves.toMatchObject({ stage: "projection_built" });
    expect(parserCalls).toBe(0);
    expect(summaryCalls).toBe(0);
    expect(retainedArtifactAdmissions).toBe(3);
    expect(retainedArtifactActive).toBe(0);
    expect(resetFailedProjectionFlags).toEqual([true]);
    expect(receipts).toEqual([
      expect.objectContaining({
        componentReceipt: expect.objectContaining({
          documentOutlines: [{ componentKey: persistedOutline.id, generationId }],
          multimodalManifests: [{ componentKey: persistedManifest.id, generationId }],
        }),
      }),
    ]);
  });

  it("builds retry derivatives from the canonical artifact returned by reindexing", async () => {
    const adapter = createTestPlatformAdapter();
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
        canonicalizeArtifact: async (input) => artifacts.materialize(input),
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
    ).resolves.toMatchObject({ artifactHash: "2".repeat(64), id: canonicalArtifactId });
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
    const adapter = createTestPlatformAdapter();
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
        canonicalizeArtifact: async (input) => ({ artifact: input, disposition: "created" }),
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
    const adapter = createTestPlatformAdapter();
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
          itemId: expect.stringMatching(/^[0-9a-f-]{36}:1:figure-1$/u),
          modality: "image",
          objectKey: expect.stringMatching(
            /^tenant-1\/spaces\/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42\/documents\/018f0d60-7a49-7cc2-9c1b-5b36f18f6a01\/assets\/[a-f0-9-]+\/figure-1-[a-f0-9]{12}\.png$/u,
          ),
        }),
        targetId: asset.id,
        virtualPath: expect.stringMatching(
          /^\/knowledge\/docs\/Worker\.md--018f0d60\/assets\/image-Worker-diagram--[a-f0-9]{8}\.json$/u,
        ),
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
        retrievalProfile: frozenRetrievalProfile,
        tenantId: "tenant-1",
      },
    ]);
    expect(reindexCalls).toEqual([
      expect.objectContaining({
        denseModel: frozenEmbeddingProfile.vectorSpaceId,
        embeddingProfile: frozenEmbeddingProfile,
        enableGraph: true,
        projectionStatus: "building",
        retrievalProfile: frozenRetrievalProfile,
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
    const adapter = createTestPlatformAdapter();
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
    const adapter = createTestPlatformAdapter();
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
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 4,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const asset = await assets.create({
      filename: "Paper.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f6b01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf; charset=binary",
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
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 4,
    });
    const parserHints: (ParserRouteHints | undefined)[] = [];
    const basePdfParser = pdfParser();
    const worker = createDocumentCompilationWorker({
      assets,
      generateKnowledgePathId: sequenceIds([
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b05",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b06",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b07",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b08",
        "018f0d60-7a49-7cc2-9c1b-5b36f18f6b09",
      ]),
      generateMultimodalWriteOwnerId: () => "pdf-write-owner",
      jobs: compilationJobs,
      knowledgePaths,
      multimodalManifests,
      objectStorage: adapter.objectStorage,
      parser: {
        ...basePdfParser,
        parse: async (input) => {
          parserHints.push(input.parserHints);
          return basePdfParser.parse(input);
        },
      },
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
    expect(parserHints).toEqual([
      expect.objectContaining({ imagesHandledExternally: true, requiresImages: true }),
    ]);
    const manifest = await multimodalManifests.getByDocumentVersion({
      documentAssetId: asset.id,
      version: asset.version,
    });
    expect(manifest).toMatchObject({
      items: [
        expect.objectContaining({ id: expect.stringContaining(String(manifest?.parseArtifactId)) }),
      ],
      parseArtifactId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
    });
    expect(manifest?.artifactHash).not.toBe("d".repeat(64));

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
          objectKey: expect.stringMatching(/assets\/pdf-write-owner\/figure-1-[a-f0-9]{12}\.png$/u),
        }),
      }),
    ]);
    await expect(
      adapter.objectStorage.getObject(String(assetPaths.items[0]?.metadata.objectKey)),
    ).resolves.toEqual(new Uint8Array([9, 8, 7, 6]));
  });

  it("reuses canonical multimodal objects when the same PDF materialization is retried", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Stable.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf",
      objectKey: "tenant-1/spaces/space/documents/asset/Stable.pdf",
      sha256: "b".repeat(64),
      sizeBytes: 8,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("%PDF-1.7"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: sequenceIds(["stable-job-1", "stable-job-2"]),
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 2 }),
    });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 1,
    });
    let simulateCommitAcknowledgementFailure = true;
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      generateMultimodalWriteOwnerId: sequenceIds(["owner-a", "owner-b"]),
      jobs: compilationJobs,
      multimodalManifests,
      objectStorage: adapter.objectStorage,
      parser: pdfParser(),
      pdfRasterizer: {
        render: async () => ({
          body: new Uint8Array([9, 8, 7, 6]),
          contentType: "image/png",
        }),
      },
      reindexer: {
        canonicalizeArtifact: async (input) => {
          const materialized = await artifacts.materialize(input);
          if (simulateCommitAcknowledgementFailure) {
            simulateCommitAcknowledgementFailure = false;
            throw Object.assign(new Error("artifact commit acknowledgement was lost"), {
              retryable: true,
            });
          }
          return materialized;
        },
        getCanonicalArtifact: (input) => artifacts.getByDocumentVersion(input),
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 1,
          projectionsCreated: 1,
          status: "rebuilt",
        }),
      },
    });
    const process = async () => {
      const job = await compilationJobs.start({
        documentAssetId: asset.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      });
      return worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: job.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      });
    };

    await expect(process()).resolves.toMatchObject({ stage: "published" });
    await expect(process()).resolves.toMatchObject({ stage: "published" });

    const stored = await adapter.objectStorage.listObjects({ limit: 20, prefix: "tenant-1/" });
    const multimodalObjects = stored.objects.filter(({ key }) => key.includes("/assets/"));
    expect(multimodalObjects).toHaveLength(1);
    expect(multimodalObjects[0]?.key).toContain("/assets/owner-a/");
    const manifest = await multimodalManifests.getByDocumentVersion({
      documentAssetId: asset.id,
      version: asset.version,
    });
    expect(manifest?.items[0]?.assetRef?.objectKey).toBe(multimodalObjects[0]?.key);
  });

  it.each([
    [
      "a renderer error",
      async () => {
        throw new Error("pdftoppm is unavailable");
      },
    ],
    ["an unresolved renderer result", async () => null],
  ])("falls back to provider image payloads after %s", async (_scenario, render) => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Fallback.pdf",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "application/pdf; charset=binary",
      objectKey: "tenant-1/spaces/space/documents/asset/Fallback.pdf",
      sha256: "e".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("%PDF-1.7"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-pdf-fallback-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 1,
    });
    const parserHints: (ParserRouteHints | undefined)[] = [];
    const basePdfParser = pdfParser();
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests,
      objectStorage: adapter.objectStorage,
      parser: {
        ...basePdfParser,
        parse: async (input) => {
          parserHints.push(input.parserHints);
          const parsed = await basePdfParser.parse(input);

          if (input.parserHints?.imagesHandledExternally) {
            return parsed;
          }

          return ParseArtifactSchema.parse({
            ...parsed,
            elements: [
              ...parsed.elements.map((element) =>
                element.id === "figure-1"
                  ? {
                      ...element,
                      metadata: {
                        ...element.metadata,
                        assetRef: {
                          contentType: "image/png",
                          uri: "data:image/png;base64,AQIDBA==",
                        },
                      },
                    }
                  : element,
              ),
              {
                id: "table-1",
                metadata: {
                  assetRef: {
                    contentType: "image/png",
                    uri: "data:image/png;base64,BQYHCA==",
                  },
                  table: { html: "<table><tr><td>42</td></tr></table>" },
                },
                pageNumber: 2,
                sectionPath: ["Paper"],
                text: "42",
                type: "table",
              },
            ],
          });
        },
      },
      pdfRasterizer: {
        render,
      },
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
    expect(parserHints).toEqual([
      expect.objectContaining({ imagesHandledExternally: true, requiresImages: true }),
      expect.objectContaining({ imagesHandledExternally: false, requiresImages: true }),
    ]);
    const manifest = await multimodalManifests.getByDocumentVersion({
      documentAssetId: asset.id,
      version: asset.version,
    });
    expect(manifest?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetRef: expect.objectContaining({
            contentType: "image/png",
            objectKey: expect.stringMatching(/figure-1-[a-f0-9]{12}\.png$/u),
          }),
          enrichment: expect.objectContaining({ asset: "provided" }),
          parseElementId: "figure-1",
        }),
        expect.objectContaining({
          assetRef: expect.objectContaining({
            contentType: "image/png",
            objectKey: expect.stringMatching(/table-1-[a-f0-9]{12}\.png$/u),
          }),
          enrichment: expect.objectContaining({ asset: "provided" }),
          parseElementId: "table-1",
        }),
      ]),
    );
    const imageObjectKey = manifest?.items.find((item) => item.parseElementId === "figure-1")
      ?.assetRef?.objectKey;
    const tableObjectKey = manifest?.items.find((item) => item.parseElementId === "table-1")
      ?.assetRef?.objectKey;
    expect(imageObjectKey).toBeDefined();
    expect(tableObjectKey).toBeDefined();
    await expect(adapter.objectStorage.getObject(String(imageObjectKey))).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    await expect(adapter.objectStorage.getObject(String(tableObjectKey))).resolves.toEqual(
      new Uint8Array([5, 6, 7, 8]),
    );
  });

  it("compensates an execution-owned asset when object storage commits and then throws", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Ambiguous.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Ambiguous.md",
      sha256: "f".repeat(64),
      sizeBytes: 12,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Ambiguous"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-object-ambiguity-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const ambiguousStorage: PlatformAdapter["objectStorage"] = {
      ...adapter.objectStorage,
      putObject: async (input) => {
        const result = await adapter.objectStorage.putObject(input);
        if (input.key.includes("/assets/failed-write-owner/")) {
          throw new Error("object committed before transport failure");
        }
        return result;
      },
    };
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      generateMultimodalWriteOwnerId: () => "failed-write-owner",
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: ambiguousStorage,
      parser: parser(),
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
    ).rejects.toThrow("object committed before transport failure");
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${asset.knowledgeSpaceId}/documents/${asset.id}/assets/failed-write-owner/`,
      }),
    ).resolves.toMatchObject({ objects: [] });
  });

  it("keeps incomplete multimodal compensation retryable", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const asset = await assets.create({
      filename: "Retry-cleanup.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c02",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/spaces/space/documents/asset/Retry-cleanup.md",
      sha256: "e".repeat(64),
      sizeBytes: 15,
    });
    await adapter.objectStorage.putObject({
      body: new TextEncoder().encode("# Retry cleanup"),
      contentType: asset.mimeType,
      key: asset.objectKey,
      metadata: {},
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-cleanup-retry-1",
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 1 }),
    });
    const compilationJob = await compilationJobs.start({
      documentAssetId: asset.id,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      tenantId: "tenant-1",
      version: asset.version,
    });
    const unavailableStorage: PlatformAdapter["objectStorage"] = {
      ...adapter.objectStorage,
      deleteObject: async (key) => {
        if (key.includes("/assets/cleanup-retry-owner/")) {
          throw Object.assign(new Error("cleanup storage unavailable"), { retryable: true });
        }
        return adapter.objectStorage.deleteObject(key);
      },
      putObject: async (input) => {
        const result = await adapter.objectStorage.putObject(input);
        if (input.key.includes("/assets/cleanup-retry-owner/")) {
          throw Object.assign(new Error("object write acknowledgement was lost"), {
            retryable: true,
          });
        }
        return result;
      },
    };
    const worker = createDocumentCompilationWorker({
      assets,
      failureManagement: "caller",
      generateMultimodalWriteOwnerId: () => "cleanup-retry-owner",
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 }),
      objectStorage: unavailableStorage,
      parser: parser(),
      reindexer: {
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 1,
          projectionsCreated: 1,
          status: "rebuilt",
        }),
      },
    });

    const error = await worker
      .process({
        documentAssetId: asset.id,
        documentCompilationJobId: compilationJob.id,
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({
      code: "DOCUMENT_COMPILATION_RETRYABLE",
      retryable: true,
    });
    await expect(
      adapter.objectStorage.listObjects({
        limit: 10,
        prefix: `tenant-1/spaces/${asset.knowledgeSpaceId}/documents/${asset.id}/assets/cleanup-retry-owner/`,
      }),
    ).resolves.toMatchObject({ objects: [expect.any(Object)] });
  });

  it("releases global admission before a body-classified heavy archive waits or is cancelled", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 5 });
    const assetIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7d01",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7d02",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7d03",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7d04",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7d05",
    ] as const;
    const artifactIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7e01",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7e02",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7e03",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7e04",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7e05",
    ] as const;
    const documentTypes = [
      {
        filename: "Compact-structural-1.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      {
        filename: "Compact-structural-2.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      {
        filename: "Ordinary.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      { filename: "Cancelled.txt", mimeType: "text/plain" },
      { filename: "Known-heavy.pdf", mimeType: "application/pdf" },
    ] as const;
    const structuralWorkbook = zipWithDeclaredEntriesForWorkloadTest(
      Array.from({ length: 33 }, (_, index) => ({
        filename: `xl/worksheets/sheet${index + 1}.xml`,
        uncompressedBytes: 1,
      })),
    );
    const ordinaryDocument = zipWithDeclaredEntriesForWorkloadTest([
      { filename: "word/document.xml", uncompressedBytes: 1 },
    ]);
    const sourceBodies = [
      structuralWorkbook,
      structuralWorkbook,
      ordinaryDocument,
      new TextEncoder().encode("cancelled"),
      new TextEncoder().encode("%PDF-1.7"),
    ] as const;
    const createdAssets: Awaited<ReturnType<typeof assets.create>>[] = [];
    for (const [index, id] of assetIds.entries()) {
      const documentType = documentTypes[index];
      const sourceBody = sourceBodies[index];
      if (!documentType) throw new Error("Missing test document type");
      if (!sourceBody) throw new Error("Missing test source body");
      const asset = await assets.create({
        filename: documentType.filename,
        id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mimeType: documentType.mimeType,
        objectKey: `tenant-1/spaces/space/documents/${id}/source`,
        sha256: String(index + 1).repeat(64),
        sizeBytes: sourceBody.byteLength,
      });
      createdAssets.push(asset);
      await adapter.objectStorage.putObject({
        body: sourceBody,
        contentType: asset.mimeType,
        key: asset.objectKey,
        metadata: {},
      });
    }
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: sequenceIds([
        "materialization-job-1",
        "materialization-job-2",
        "materialization-job-3",
        "materialization-job-4",
        "materialization-job-5",
      ]),
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 5 }),
    });
    const jobs: Awaited<ReturnType<typeof compilationJobs.start>>[] = [];
    for (const asset of createdAssets) {
      jobs.push(
        await compilationJobs.start({
          documentAssetId: asset.id,
          knowledgeSpaceId: asset.knowledgeSpaceId,
          tenantId: "tenant-1",
          version: asset.version,
        }),
      );
    }
    let activeParses = 0;
    let enteredParses = 0;
    const enteredAssetIds: string[] = [];
    let maxActiveParses = 0;
    let releaseParses!: () => void;
    let resolveFirstHeavyEntered!: () => void;
    let resolveOrdinaryEntered!: () => void;
    const parseBarrier = new Promise<void>((resolve) => {
      releaseParses = resolve;
    });
    const firstHeavyEntered = new Promise<void>((resolve) => {
      resolveFirstHeavyEntered = resolve;
    });
    const ordinaryEntered = new Promise<void>((resolve) => {
      resolveOrdinaryEntered = resolve;
    });
    const materializationGate = createConcurrencyGate(2);
    const heavyMaterializationPreAdmission = createConcurrencyGate(1);
    const multimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 5,
    });
    let resolveSecondHeavyPreflightRead!: () => void;
    const secondHeavyPreflightRead = new Promise<void>((resolve) => {
      resolveSecondHeavyPreflightRead = resolve;
    });
    const sourceReadCounts = new Map<string, number>();
    const cancelledObjectKey = createdAssets[3]?.objectKey;
    let cancelledSourceReads = 0;
    const compilationObjectStorage: PlatformAdapter["objectStorage"] = {
      ...adapter.objectStorage,
      getObject: async (key) => {
        sourceReadCounts.set(key, (sourceReadCounts.get(key) ?? 0) + 1);
        if (key === createdAssets[1]?.objectKey) resolveSecondHeavyPreflightRead();
        if (key === cancelledObjectKey) cancelledSourceReads += 1;
        return adapter.objectStorage.getObject(key);
      },
    };
    const createWorker = () =>
      createDocumentCompilationWorker({
        assets,
        jobs: compilationJobs,
        heavyMaterializationPreAdmission,
        multimodalImageVariantGenerator: { generate: async () => [] },
        multimodalManifests,
        materializationGate,
        objectStorage: compilationObjectStorage,
        parser: {
          kind: "unstructured",
          workloadKind: (input) => classifyUnstructuredWorkload(input).kind,
          parse: async (input) => {
            expect(input.parserHints).toMatchObject({
              imagesHandledExternally: false,
              requiresImages: true,
            });
            activeParses += 1;
            enteredParses += 1;
            enteredAssetIds.push(input.documentAssetId);
            maxActiveParses = Math.max(maxActiveParses, activeParses);
            if (input.documentAssetId === assetIds[0]) resolveFirstHeavyEntered();
            if (input.documentAssetId === assetIds[2]) resolveOrdinaryEntered();
            await parseBarrier;
            activeParses -= 1;
            const artifactId =
              artifactIds[assetIds.indexOf(input.documentAssetId as (typeof assetIds)[number])];
            if (!artifactId) throw new Error("Missing test parse artifact id");
            return ParseArtifactSchema.parse({
              artifactHash: input.documentAssetId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
              contentType: "text",
              createdAt: "2026-08-18T12:00:00.000Z",
              documentAssetId: input.documentAssetId,
              elements: [],
              id: artifactId,
              metadata: {},
              parser: "unstructured",
              version: input.version,
            });
          },
        },
        reindexer: {
          reindex: async (input) => ({
            artifact: input.parseArtifact,
            nodesCreated: 0,
            projectionIds: [],
            projectionsCreated: 0,
            status: "rebuilt",
          }),
        },
      });

    const processAsset = (index: number, signal?: AbortSignal) => {
      const asset = createdAssets[index];
      if (!asset) throw new Error("Missing compilation asset fixture");
      return createWorker().process(
        {
          documentAssetId: asset.id,
          documentCompilationJobId: jobs[index]?.id ?? "missing-job",
          knowledgeSpaceId: asset.knowledgeSpaceId,
          tenantId: "tenant-1",
          version: asset.version,
        },
        signal ? { signal } : undefined,
      );
    };
    const firstHeavyProcess = processAsset(0);
    await firstHeavyEntered;
    const secondHeavyController = new AbortController();
    const secondHeavyProcess = processAsset(1, secondHeavyController.signal);
    await secondHeavyPreflightRead;
    const ordinaryProcess = processAsset(2);
    await ordinaryEntered;
    secondHeavyController.abort(new Error("body-classified heavy compilation cancelled"));
    await expect(secondHeavyProcess).rejects.toThrow("body-classified heavy compilation cancelled");
    expect(sourceReadCounts.get(createdAssets[0]?.objectKey ?? "missing")).toBe(2);
    expect(sourceReadCounts.get(createdAssets[1]?.objectKey ?? "missing")).toBe(1);
    expect(sourceReadCounts.get(createdAssets[2]?.objectKey ?? "missing")).toBe(1);
    const knownHeavyProcess = processAsset(4);
    await Promise.resolve();
    expect(sourceReadCounts.get(createdAssets[4]?.objectKey ?? "missing")).toBeUndefined();
    const processes = [firstHeavyProcess, ordinaryProcess, knownHeavyProcess];
    const cancelledAsset = createdAssets[3];
    const cancelledJob = jobs[3];
    if (!cancelledAsset || !cancelledJob) throw new Error("Missing cancelled compilation fixture");
    const controller = new AbortController();
    const cancelledProcess = createWorker().process(
      {
        documentAssetId: cancelledAsset.id,
        documentCompilationJobId: cancelledJob.id,
        knowledgeSpaceId: cancelledAsset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: cancelledAsset.version,
      },
      { signal: controller.signal },
    );
    expect(enteredAssetIds).toContain(assetIds[2]);
    expect(enteredAssetIds).toContain(assetIds[0]);
    expect(enteredAssetIds).not.toContain(assetIds[1]);
    controller.abort(new Error("queued compilation cancelled"));
    await expect(cancelledProcess).rejects.toThrow("queued compilation cancelled");
    expect(enteredParses).toBe(2);
    expect(cancelledSourceReads).toBe(0);
    expect(maxActiveParses).toBe(2);
    releaseParses();
    await expect(Promise.all(processes)).resolves.toEqual([
      expect.objectContaining({ stage: "published" }),
      expect.objectContaining({ stage: "published" }),
      expect.objectContaining({ stage: "published" }),
    ]);
    expect(sourceReadCounts.get(createdAssets[4]?.objectKey ?? "missing")).toBe(1);
    expect(maxActiveParses).toBe(2);
  });

  it("defaults a directly constructed worker to ordinary progress beside one heavy materialization", async () => {
    const adapter = createTestPlatformAdapter();
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 3 });
    const assetIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7f01",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7f02",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7f03",
    ] as const;
    const artifactIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f8001",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f8002",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f8003",
    ] as const;
    const createdAssets = [];
    for (const [index, id] of assetIds.entries()) {
      const asset = await assets.create({
        filename: index < 2 ? `Heavy-${index + 1}.pdf` : "Ordinary.txt",
        id,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mimeType: index < 2 ? "application/pdf" : "text/plain",
        objectKey: `tenant-1/spaces/space/documents/${id}/source.txt`,
        sha256: String(index + 5).repeat(64),
        sizeBytes: 7,
      });
      createdAssets.push(asset);
      await adapter.objectStorage.putObject({
        body: new TextEncoder().encode(`small-${index + 1}`),
        contentType: asset.mimeType,
        key: asset.objectKey,
        metadata: {},
      });
    }
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: sequenceIds([
        "default-materialization-job-1",
        "default-materialization-job-2",
        "default-materialization-job-3",
      ]),
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 3 }),
    });
    const jobs: Awaited<ReturnType<typeof compilationJobs.start>>[] = [];
    for (const asset of createdAssets) {
      jobs.push(
        await compilationJobs.start({
          documentAssetId: asset.id,
          knowledgeSpaceId: asset.knowledgeSpaceId,
          tenantId: "tenant-1",
          version: asset.version,
        }),
      );
    }
    let activeParses = 0;
    let enteredParses = 0;
    const enteredAssetIds: string[] = [];
    let maxActiveParses = 0;
    let releaseParses!: () => void;
    let resolveTwoEntered!: () => void;
    const parseBarrier = new Promise<void>((resolve) => {
      releaseParses = resolve;
    });
    const twoEntered = new Promise<void>((resolve) => {
      resolveTwoEntered = resolve;
    });
    const worker = createDocumentCompilationWorker({
      assets,
      jobs: compilationJobs,
      multimodalManifests: createInMemoryDocumentMultimodalManifestRepository({
        maxManifests: 3,
      }),
      objectStorage: adapter.objectStorage,
      parser: {
        kind: "unstructured",
        workloadKind: (input) => (input.documentAssetId === assetIds[2] ? "standard" : "heavy"),
        parse: async (input) => {
          activeParses += 1;
          enteredParses += 1;
          enteredAssetIds.push(input.documentAssetId);
          maxActiveParses = Math.max(maxActiveParses, activeParses);
          if (enteredParses === 2) resolveTwoEntered();
          await parseBarrier;
          activeParses -= 1;
          const artifactId =
            artifactIds[assetIds.indexOf(input.documentAssetId as (typeof assetIds)[number])];
          if (!artifactId) throw new Error("Missing default materialization artifact id");
          return ParseArtifactSchema.parse({
            artifactHash: input.documentAssetId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
            contentType: "text",
            createdAt: "2026-08-18T12:00:00.000Z",
            documentAssetId: input.documentAssetId,
            elements: [],
            id: artifactId,
            metadata: {},
            parser: "unstructured",
            version: input.version,
          });
        },
      },
      reindexer: {
        reindex: async (input) => ({
          artifact: input.parseArtifact,
          nodesCreated: 0,
          projectionIds: [],
          projectionsCreated: 0,
          status: "rebuilt",
        }),
      },
    });

    const processes = createdAssets.map((asset, index) =>
      worker.process({
        documentAssetId: asset.id,
        documentCompilationJobId: jobs[index]?.id ?? "missing-job",
        knowledgeSpaceId: asset.knowledgeSpaceId,
        tenantId: "tenant-1",
        version: asset.version,
      }),
    );

    await twoEntered;
    await Promise.resolve();
    expect(enteredParses).toBe(2);
    expect(enteredAssetIds).toContain(assetIds[0]);
    expect(enteredAssetIds).toContain(assetIds[2]);
    expect(enteredAssetIds).not.toContain(assetIds[1]);
    releaseParses();
    await expect(Promise.all(processes)).resolves.toHaveLength(3);
    expect(maxActiveParses).toBe(2);
  });
});

function createTestPlatformAdapter(): PlatformAdapter {
  const adapter = createNodePlatformAdapter({ env: {} });
  return {
    ...adapter,
    objectStorage: createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 64 * 1024 * 1024,
    }),
  };
}

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

function zipWithDeclaredEntriesForWorkloadTest(
  entries: readonly { readonly filename: string; readonly uncompressedBytes: number }[],
): Uint8Array {
  const encodedEntries = entries.map((entry) => ({
    ...entry,
    filenameBytes: new TextEncoder().encode(entry.filename),
  }));
  const localHeader = new Uint8Array(30);
  const centralDirectory = new Uint8Array(
    encodedEntries.reduce((total, entry) => total + 46 + entry.filenameBytes.byteLength, 0),
  );
  const endOfCentralDirectory = new Uint8Array(22);
  new DataView(localHeader.buffer).setUint32(0, 0x04034b50, true);
  let centralOffset = 0;
  for (const entry of encodedEntries) {
    const centralView = new DataView(
      centralDirectory.buffer,
      centralDirectory.byteOffset + centralOffset,
      46 + entry.filenameBytes.byteLength,
    );
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint32(20, 1, true);
    centralView.setUint32(24, entry.uncompressedBytes, true);
    centralView.setUint16(28, entry.filenameBytes.byteLength, true);
    centralDirectory.set(entry.filenameBytes, centralOffset + 46);
    centralOffset += 46 + entry.filenameBytes.byteLength;
  }
  const endView = new DataView(endOfCentralDirectory.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, localHeader.byteLength, true);

  const body = new Uint8Array(
    localHeader.byteLength + centralDirectory.byteLength + endOfCentralDirectory.byteLength,
  );
  body.set(localHeader);
  body.set(centralDirectory, localHeader.byteLength);
  body.set(endOfCentralDirectory, localHeader.byteLength + centralDirectory.byteLength);
  return body;
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
