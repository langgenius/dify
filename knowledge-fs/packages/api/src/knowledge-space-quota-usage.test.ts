import {
  ArtifactSegmentSchema,
  IndexProjectionSchema,
  KnowledgeNodeSchema,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryArtifactSegmentRepository } from "./artifact-segment-repository";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { createInMemoryIndexProjectionRepository } from "./index-projection-repository";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createKnowledgeSpaceQuotaUsageReader } from "./knowledge-space-quota-usage";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18fb001";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18fb002";
const nodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18fb003";

describe("createKnowledgeSpaceQuotaUsageReader", () => {
  it("reads bounded usage across assets, artifacts, nodes, and projections", async () => {
    const repositories = createUsageRepositories();
    await seedUsageRepositories(repositories);
    const reader = createKnowledgeSpaceQuotaUsageReader({
      ...repositories,
      maxAssetsPerRead: 10,
      maxNodesPerRead: 10,
      maxSegmentsPerArtifact: 10,
    });

    await expect(reader.read({ knowledgeSpaceId, projectionVersion: 1 })).resolves.toEqual({
      artifactBytes: 16,
      artifactCount: 1,
      documentCount: 1,
      nodeCount: 1,
      projectionCount: 2,
      rawDocumentBytes: 12,
      segmentCount: 2,
      truncated: false,
    });
  });

  it("marks usage reads truncated when repository pages are capped", async () => {
    const repositories = createUsageRepositories();
    await seedUsageRepositories(repositories);
    const reader = createKnowledgeSpaceQuotaUsageReader({
      ...repositories,
      maxAssetsPerRead: 10,
      maxNodesPerRead: 10,
      maxSegmentsPerArtifact: 1,
    });

    await expect(reader.read({ knowledgeSpaceId, projectionVersion: 1 })).resolves.toMatchObject({
      artifactBytes: 6,
      segmentCount: 1,
      truncated: true,
    });
  });

  it("rejects invalid reader bounds and projection versions", async () => {
    const repositories = createUsageRepositories();

    expect(() =>
      createKnowledgeSpaceQuotaUsageReader({
        ...repositories,
        maxAssetsPerRead: 0,
        maxNodesPerRead: 10,
        maxSegmentsPerArtifact: 10,
      }),
    ).toThrow("KnowledgeSpace quota usage maxAssetsPerRead must be at least 1");

    const reader = createKnowledgeSpaceQuotaUsageReader({
      ...repositories,
      maxAssetsPerRead: 10,
      maxNodesPerRead: 10,
      maxSegmentsPerArtifact: 10,
    });
    await expect(reader.read({ knowledgeSpaceId, projectionVersion: 0 })).rejects.toThrow(
      "KnowledgeSpace quota usage projectionVersion must be at least 1",
    );
  });
});

function createUsageRepositories() {
  return {
    artifactSegments: createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    }),
    assets: createInMemoryDocumentAssetRepository({
      generateId: () => documentAssetId,
      maxAssets: 10,
      now: () => "2026-05-27T12:00:00.000Z",
    }),
    nodes: createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    }),
    parseArtifacts: createInMemoryParseArtifactRepository({ maxArtifacts: 10 }),
    projections: createInMemoryIndexProjectionRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxProjections: 10,
    }),
  };
}

async function seedUsageRepositories(repositories: ReturnType<typeof createUsageRepositories>) {
  await repositories.assets.create({
    filename: "Quota.md",
    knowledgeSpaceId,
    mimeType: "text/markdown",
    objectKey: "tenant-1/spaces/space/documents/quota.md",
    sha256: "a".repeat(64),
    sizeBytes: 12,
  });
  await repositories.parseArtifacts.create(
    ParseArtifactSchema.parse({
      artifactHash: "b".repeat(64),
      contentType: "text",
      createdAt: "2026-05-27T12:00:00.000Z",
      documentAssetId,
      elements: [],
      id: parseArtifactId,
      parser: "native-markdown",
      version: 1,
    }),
  );
  await repositories.artifactSegments.createMany({
    segments: [
      ArtifactSegmentSchema.parse({
        artifactHash: "b".repeat(64),
        checksum: "c".repeat(64),
        createdAt: "2026-05-27T12:00:00.000Z",
        documentAssetId,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18fb010",
        inlineText: "inline",
        knowledgeSpaceId,
        parseArtifactId,
        segmentIndex: 0,
        segmentType: "text",
        sourceLocation: {},
      }),
      ArtifactSegmentSchema.parse({
        artifactHash: "b".repeat(64),
        checksum: "d".repeat(64),
        createdAt: "2026-05-27T12:00:00.000Z",
        documentAssetId,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18fb011",
        knowledgeSpaceId,
        objectKey: "tenant-1/spaces/space/artifacts/segment.bin",
        parseArtifactId,
        segmentIndex: 1,
        segmentType: "binary",
        sizeBytes: 10,
        sourceLocation: {},
      }),
    ],
  });
  await repositories.nodes.createMany([
    KnowledgeNodeSchema.parse({
      artifactHash: "b".repeat(64),
      documentAssetId,
      endOffset: 6,
      id: nodeId,
      kind: "chunk",
      knowledgeSpaceId,
      parseArtifactId,
      sourceLocation: {},
      startOffset: 0,
      text: "inline",
    }),
  ]);
  await repositories.projections.createMany([
    IndexProjectionSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18fb020",
      knowledgeSpaceId,
      metadata: {},
      nodeId,
      projectionVersion: 1,
      status: "ready",
      type: "dense-vector",
    }),
    IndexProjectionSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18fb021",
      knowledgeSpaceId,
      metadata: {},
      nodeId,
      projectionVersion: 1,
      status: "ready",
      type: "fts",
    }),
  ]);
}
