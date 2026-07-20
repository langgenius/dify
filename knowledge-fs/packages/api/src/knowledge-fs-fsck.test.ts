import type { PlatformAdapter } from "@knowledge/core";
import {
  ArtifactSegmentSchema,
  IndexProjectionSchema,
  KnowledgeNodeSchema,
  KnowledgePathSchema,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryArtifactSegmentRepository } from "./artifact-segment-repository";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { sha256Hex } from "./document-upload-utils";
import { createInMemoryIndexProjectionRepository } from "./index-projection-repository";
import {
  createKnowledgeFsArtifactSegmentFsckChecker,
  createKnowledgeFsRawObjectFsckChecker,
  createKnowledgeFsReferenceFsckChecker,
} from "./knowledge-fs-fsck";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createInMemoryKnowledgePathRepository } from "./knowledge-path-repository";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";

describe("createKnowledgeFsRawObjectFsckChecker", () => {
  it("checks raw object existence, checksum, and size through bounded HEAD calls", async () => {
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const ok = await assets.create({
      filename: "Ok.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/ok.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const missing = await assets.create({
      filename: "Missing.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02",
      knowledgeSpaceId: ok.knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/missing.md",
      sha256: "b".repeat(64),
      sizeBytes: 8,
    });
    const corrupt = await assets.create({
      filename: "Corrupt.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a03",
      knowledgeSpaceId: ok.knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/corrupt.md",
      sha256: "c".repeat(64),
      sizeBytes: 10,
    });
    const calls: string[] = [];
    const objectStorage = objectStorageHeadOnly(
      {
        [ok.objectKey]: { metadata: { sha256: ok.sha256 }, sizeBytes: ok.sizeBytes },
        [corrupt.objectKey]: { metadata: { sha256: "d".repeat(64) }, sizeBytes: 11 },
      },
      calls,
    );
    const checker = createKnowledgeFsRawObjectFsckChecker({
      assets,
      maxAssetsPerRun: 10,
      objectStorage,
    });

    const report = await checker.check({
      knowledgeSpaceId: ok.knowledgeSpaceId,
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([ok.objectKey, missing.objectKey, corrupt.objectKey]);
    expect(report.summary).toMatchObject({
      critical: 1,
      error: 1,
      scanned: 3,
      warning: 1,
    });
    expect(report.issues.map((issue) => issue.type)).toEqual([
      "missing-raw-object",
      "checksum-mismatch",
      "size-mismatch",
    ]);
    expect(report.issues[0]?.target).toMatchObject({
      documentAssetId: missing.id,
      objectKey: missing.objectKey,
      type: "raw-object",
    });
  });

  it("rejects invalid raw-object cursor and bounds", async () => {
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    expect(() =>
      createKnowledgeFsRawObjectFsckChecker({
        assets,
        maxAssetsPerRun: 0,
        objectStorage: objectStorageHeadOnly({}, []),
      }),
    ).toThrow("KnowledgeFS raw object fsck maxAssetsPerRun must be at least 1");

    const checker = createKnowledgeFsRawObjectFsckChecker({
      assets,
      maxAssetsPerRun: 1,
      objectStorage: objectStorageHeadOnly({}, []),
    });

    await expect(
      checker.check({
        cursor: "not-base64-json",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("KnowledgeFS raw object fsck cursor is invalid");
    await expect(
      checker.check({
        cursor: Buffer.from(JSON.stringify({ id: 123 })).toString("base64url"),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("KnowledgeFS raw object fsck cursor is invalid");
  });

  it("returns raw-object cursors and resumes clean scans", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const first = await assets.create({
      filename: "First.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d01",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/first.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const second = await assets.create({
      filename: "Second.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d02",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/second.md",
      sha256: "b".repeat(64),
      sizeBytes: 14,
    });
    const calls: string[] = [];
    const checker = createKnowledgeFsRawObjectFsckChecker({
      assets,
      maxAssetsPerRun: 1,
      objectStorage: objectStorageHeadOnly(
        {
          [first.objectKey]: { metadata: {}, sizeBytes: first.sizeBytes },
          [second.objectKey]: { metadata: { sha256: second.sha256 }, sizeBytes: second.sizeBytes },
        },
        calls,
      ),
    });

    const firstPage = await checker.check({ knowledgeSpaceId, tenantId: "tenant-1" });
    const secondPage = await checker.check({
      cursor: firstPage.cursor,
      knowledgeSpaceId,
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([first.objectKey, second.objectKey]);
    expect(firstPage.summary).toMatchObject({ error: 0, scanned: 1 });
    expect(firstPage.cursor).toEqual(
      Buffer.from(JSON.stringify({ id: first.id })).toString("base64url"),
    );
    expect(secondPage.cursor).toBeUndefined();
    expect(secondPage.issues).toEqual([]);
  });
});

describe("createKnowledgeFsArtifactSegmentFsckChecker", () => {
  it("checks artifact segments with bounded segment pages and object HEAD calls", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    });
    const asset = await assets.create({
      filename: "Artifact.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b01",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/artifact.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const artifact = await parseArtifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: "b".repeat(64),
        contentType: "text",
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: asset.id,
        elements: [],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b02",
        metadata: {},
        parser: "native-markdown",
        version: asset.version,
      }),
    );
    await artifactSegments.createMany({
      segments: [
        ArtifactSegmentSchema.parse({
          artifactHash: artifact.artifactHash,
          checksum: "c".repeat(64),
          contentEncoding: "utf-8",
          createdAt: "2026-05-27T10:00:00.000Z",
          documentAssetId: asset.id,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b03",
          inlineText: "wrong checksum",
          knowledgeSpaceId,
          parseArtifactId: artifact.id,
          segmentIndex: 0,
          segmentType: "text",
          sourceLocation: {},
        }),
        ArtifactSegmentSchema.parse({
          artifactHash: "d".repeat(64),
          checksum: "e".repeat(64),
          contentEncoding: "utf-8",
          createdAt: "2026-05-27T10:00:00.000Z",
          documentAssetId: asset.id,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8b04",
          knowledgeSpaceId,
          objectKey: "tenant-1/artifacts/missing-segment.json",
          parseArtifactId: artifact.id,
          segmentIndex: 1,
          segmentType: "table",
          sizeBytes: 42,
          sourceLocation: {},
        }),
      ],
    });
    const calls: string[] = [];
    const checker = createKnowledgeFsArtifactSegmentFsckChecker({
      artifactSegments,
      assets,
      maxAssetsPerRun: 10,
      maxSegmentsPerArtifact: 10,
      objectStorage: objectStorageHeadOnly({}, calls),
      parseArtifacts,
    });

    const report = await checker.check({
      knowledgeSpaceId,
      tenantId: "tenant-1",
    });

    expect(calls).toEqual(["tenant-1/artifacts/missing-segment.json"]);
    expect(report.summary).toMatchObject({
      critical: 0,
      error: 3,
      scanned: 2,
    });
    expect(report.issues.map((issue) => issue.type)).toEqual([
      "segment-hash-mismatch",
      "segment-hash-mismatch",
      "missing-artifact-object",
    ]);
    expect(report.issues[2]?.target).toMatchObject({
      documentAssetId: asset.id,
      objectKey: "tenant-1/artifacts/missing-segment.json",
      parseArtifactId: artifact.id,
      type: "artifact-segment",
    });
  });

  it("rejects invalid artifact segment cursor and bounds", async () => {
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxSegments: 1,
    });

    expect(() =>
      createKnowledgeFsArtifactSegmentFsckChecker({
        artifactSegments,
        assets,
        maxAssetsPerRun: 0,
        maxSegmentsPerArtifact: 1,
        objectStorage: objectStorageHeadOnly({}, []),
        parseArtifacts,
      }),
    ).toThrow("KnowledgeFS artifact segment fsck maxAssetsPerRun must be at least 1");
    expect(() =>
      createKnowledgeFsArtifactSegmentFsckChecker({
        artifactSegments,
        assets,
        maxAssetsPerRun: 1,
        maxSegmentsPerArtifact: 0,
        objectStorage: objectStorageHeadOnly({}, []),
        parseArtifacts,
      }),
    ).toThrow("KnowledgeFS artifact segment fsck maxSegmentsPerArtifact must be at least 1");

    const checker = createKnowledgeFsArtifactSegmentFsckChecker({
      artifactSegments,
      assets,
      maxAssetsPerRun: 1,
      maxSegmentsPerArtifact: 1,
      objectStorage: objectStorageHeadOnly({}, []),
      parseArtifacts,
    });

    await expect(
      checker.check({
        cursor: "not-base64-json",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("KnowledgeFS artifact segment fsck cursor is invalid");

    await expect(
      checker.check({
        cursor: Buffer.from(
          JSON.stringify({
            activeAssetId: 123,
            activeSegmentCursor: "0",
            assetCursor: { id: 123 },
          }),
        ).toString("base64url"),
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      issues: [],
      summary: {
        scanned: 0,
      },
    });
  });

  it("paginates artifact segments and validates existing segment objects", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    });
    const asset = await assets.create({
      filename: "Paged.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d11",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/paged.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const artifact = await parseArtifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: "b".repeat(64),
        contentType: "text",
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: asset.id,
        elements: [],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d12",
        metadata: {},
        parser: "native-markdown",
        version: asset.version,
      }),
    );
    const inlineText = "stable segment";
    await artifactSegments.createMany({
      segments: [
        ArtifactSegmentSchema.parse({
          artifactHash: artifact.artifactHash,
          checksum: await sha256Hex(new TextEncoder().encode(inlineText)),
          contentEncoding: "utf-8",
          createdAt: "2026-05-27T10:00:00.000Z",
          documentAssetId: asset.id,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d13",
          inlineText,
          knowledgeSpaceId,
          parseArtifactId: artifact.id,
          segmentIndex: 0,
          segmentType: "text",
          sourceLocation: {},
        }),
        ArtifactSegmentSchema.parse({
          artifactHash: artifact.artifactHash,
          checksum: "c".repeat(64),
          contentEncoding: "utf-8",
          createdAt: "2026-05-27T10:00:00.000Z",
          documentAssetId: asset.id,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d14",
          knowledgeSpaceId,
          objectKey: "tenant-1/artifacts/paged.json",
          parseArtifactId: artifact.id,
          segmentIndex: 1,
          segmentType: "table",
          sizeBytes: 42,
          sourceLocation: {},
        }),
      ],
    });
    const checker = createKnowledgeFsArtifactSegmentFsckChecker({
      artifactSegments,
      assets,
      maxAssetsPerRun: 10,
      maxSegmentsPerArtifact: 1,
      objectStorage: objectStorageHeadOnly(
        {
          "tenant-1/artifacts/paged.json": {
            metadata: { sha256: "d".repeat(64) },
            sizeBytes: 43,
          },
        },
        [],
      ),
      parseArtifacts,
    });

    const firstPage = await checker.check({ knowledgeSpaceId, tenantId: "tenant-1" });
    const secondPage = await checker.check({
      cursor: firstPage.cursor,
      knowledgeSpaceId,
      tenantId: "tenant-1",
    });

    expect(firstPage.cursor).toEqual(
      Buffer.from(
        JSON.stringify({
          activeAssetId: asset.id,
          activeSegmentCursor: 0,
        }),
      ).toString("base64url"),
    );
    expect(firstPage.issues).toEqual([]);
    expect(secondPage.issues.map((issue) => issue.type)).toEqual([
      "segment-hash-mismatch",
      "size-mismatch",
    ]);
    expect(secondPage.cursor).toEqual(
      Buffer.from(JSON.stringify({ assetCursor: { id: asset.id } })).toString("base64url"),
    );
  });
});

describe("createKnowledgeFsReferenceFsckChecker", () => {
  it("checks path, node, and projection target references with bounded repository scans", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 10,
    });
    const asset = await assets.create({
      filename: "Refs.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c01",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/refs.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const artifact = await parseArtifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: "b".repeat(64),
        contentType: "text",
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: asset.id,
        elements: [],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c02",
        metadata: {},
        parser: "native-markdown",
        version: 1,
      }),
    );
    await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: artifact.artifactHash,
        documentAssetId: asset.id,
        endOffset: 10,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c03",
        kind: "chunk",
        knowledgeSpaceId,
        parseArtifactId: artifact.id,
        permissionScope: [],
        sourceLocation: {},
        startOffset: 0,
        text: "ok",
      }),
      KnowledgeNodeSchema.parse({
        artifactHash: "c".repeat(64),
        documentAssetId: asset.id,
        endOffset: 10,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c04",
        kind: "chunk",
        knowledgeSpaceId,
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c99",
        permissionScope: [],
        sourceLocation: {},
        startOffset: 0,
        text: "broken artifact",
      }),
    ]);
    await paths.upsertMany([
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c05",
        knowledgeSpaceId,
        metadata: {},
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c98",
        viewName: "raw",
        viewType: "physical",
        virtualPath: "/sources/missing.md",
      }),
    ]);
    await projections.createMany([
      IndexProjectionSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c06",
        knowledgeSpaceId,
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8c97",
        projectionVersion: 1,
        status: "ready",
        type: "fts",
      }),
    ]);
    const checker = createKnowledgeFsReferenceFsckChecker({
      assets,
      maxNodesPerRun: 10,
      maxPathsPerView: 10,
      maxProjectionsPerType: 10,
      nodes,
      parseArtifacts,
      pathViewNames: ["raw"],
      paths,
      projectionTypes: ["fts"],
      projections,
    });

    const report = await checker.check({
      knowledgeSpaceId,
      tenantId: "tenant-1",
    });

    expect(report.summary).toMatchObject({
      error: 3,
      scanned: 4,
    });
    expect(report.issues.map((issue) => issue.type)).toEqual([
      "broken-path-target",
      "missing-node-target",
      "stale-projection",
    ]);
    expect(report.issues[0]?.target).toMatchObject({
      type: "knowledge-path",
      virtualPath: "/sources/missing.md",
    });
  });

  it("skips healthy document, node, artifact, and projection references", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 10,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 10,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 10,
    });
    const asset = await assets.create({
      filename: "Healthy.md",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d21",
      knowledgeSpaceId,
      mimeType: "text/markdown",
      objectKey: "tenant-1/raw/healthy.md",
      sha256: "a".repeat(64),
      sizeBytes: 12,
    });
    const artifact = await parseArtifacts.create(
      ParseArtifactSchema.parse({
        artifactHash: "b".repeat(64),
        contentType: "text",
        createdAt: "2026-05-27T10:00:00.000Z",
        documentAssetId: asset.id,
        elements: [],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d22",
        metadata: {},
        parser: "native-markdown",
        version: asset.version,
      }),
    );
    const [node] = await nodes.createMany([
      KnowledgeNodeSchema.parse({
        artifactHash: artifact.artifactHash,
        documentAssetId: asset.id,
        endOffset: 10,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d23",
        kind: "chunk",
        knowledgeSpaceId,
        parseArtifactId: artifact.id,
        permissionScope: [],
        sourceLocation: {},
        startOffset: 0,
        text: "healthy",
      }),
    ]);
    if (!node) {
      throw new Error("expected healthy node fixture");
    }
    await paths.upsertMany([
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d24",
        knowledgeSpaceId,
        metadata: {},
        resourceType: "document",
        targetId: asset.id,
        viewName: "raw",
        viewType: "physical",
        virtualPath: "/sources/healthy.md",
      }),
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d25",
        knowledgeSpaceId,
        metadata: {},
        resourceType: "node",
        targetId: node.id,
        viewName: "raw",
        viewType: "physical",
        virtualPath: "/sources/healthy-node.md",
      }),
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d26",
        knowledgeSpaceId,
        metadata: {},
        resourceType: "artifact",
        targetId: artifact.id,
        viewName: "raw",
        viewType: "physical",
        virtualPath: "/sources/healthy-artifact.md",
      }),
    ]);
    await projections.createMany([
      IndexProjectionSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8d27",
        knowledgeSpaceId,
        metadata: {},
        nodeId: node.id,
        projectionVersion: 1,
        status: "ready",
        type: "fts",
      }),
    ]);
    const checker = createKnowledgeFsReferenceFsckChecker({
      assets,
      maxNodesPerRun: 10,
      maxPathsPerView: 10,
      maxProjectionsPerType: 10,
      nodes,
      parseArtifacts,
      pathViewNames: ["raw"],
      paths,
      projectionTypes: ["fts"],
      projections,
    });

    const report = await checker.check({ knowledgeSpaceId, tenantId: "tenant-1" });

    expect(report.issues).toEqual([]);
    expect(report.summary).toMatchObject({
      error: 0,
      scanned: 5,
    });
  });

  it("rejects invalid reference fsck bounds", () => {
    const assets = createInMemoryDocumentAssetRepository({
      maxAssets: 1,
      now: () => "2026-05-27T10:00:00.000Z",
    });
    const parseArtifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 1,
      maxPaths: 1,
    });
    const projections = createInMemoryIndexProjectionRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxProjections: 1,
    });

    expect(() =>
      createKnowledgeFsReferenceFsckChecker({
        assets,
        maxNodesPerRun: 0,
        maxPathsPerView: 1,
        maxProjectionsPerType: 1,
        nodes,
        parseArtifacts,
        pathViewNames: ["raw"],
        paths,
        projectionTypes: ["fts"],
        projections,
      }),
    ).toThrow("KnowledgeFS reference fsck maxNodesPerRun must be at least 1");
    expect(() =>
      createKnowledgeFsReferenceFsckChecker({
        assets,
        maxNodesPerRun: 1,
        maxPathsPerView: 0,
        maxProjectionsPerType: 1,
        nodes,
        parseArtifacts,
        pathViewNames: ["raw"],
        paths,
        projectionTypes: ["fts"],
        projections,
      }),
    ).toThrow("KnowledgeFS reference fsck maxPathsPerView must be at least 1");
    expect(() =>
      createKnowledgeFsReferenceFsckChecker({
        assets,
        maxNodesPerRun: 1,
        maxPathsPerView: 1,
        maxProjectionsPerType: 0,
        nodes,
        parseArtifacts,
        pathViewNames: ["raw"],
        paths,
        projectionTypes: ["fts"],
        projections,
      }),
    ).toThrow("KnowledgeFS reference fsck maxProjectionsPerType must be at least 1");
  });
});

function objectStorageHeadOnly(
  objects: Record<
    string,
    { readonly metadata: Record<string, string>; readonly sizeBytes: number }
  >,
  calls: string[],
): PlatformAdapter["objectStorage"] {
  return {
    kind: "memory",
    close: async () => undefined,
    deleteObject: async () => undefined,
    getObject: async () => {
      throw new Error("fsck should not read raw object bodies");
    },
    getObjectStream: async () => {
      throw new Error("fsck should not stream raw object bodies");
    },
    health: async () => true,
    headObject: async (key) => {
      calls.push(key);
      const object = objects[key];

      return object
        ? {
            key,
            metadata: object.metadata,
            sizeBytes: object.sizeBytes,
          }
        : null;
    },
    listObjects: async () => ({ objects: [] }),
    putObject: async () => {
      throw new Error("fsck should not write raw objects");
    },
  };
}
