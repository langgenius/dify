import { randomUUID } from "node:crypto";

import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import {
  type DocumentAsset,
  PUBLICATION_GENERATION_ID_SENTINEL,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryArtifactSegmentRepository } from "./artifact-segment-repository";
import {
  type CompileDocumentArtifactDeps,
  compileDocumentArtifact,
} from "./document-compilation-pipeline";
import { createInMemoryDocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import { createDocumentOutlineBuilder } from "./document-outline-builder";
import { createInMemoryDocumentOutlineRepository } from "./document-outline-repository";
import { createInMemoryKnowledgePathRepository } from "./knowledge-path-repository";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";
import { createNoopTraceRecorder } from "./tracing";

const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
const documentAssetId = "20000000-0000-4000-8000-000000000001";
const firstArtifactId = "30000000-0000-4000-8000-000000000001";
const retryArtifactId = "30000000-0000-4000-8000-000000000002";

describe("compileDocumentArtifact canonical artifact", () => {
  it("uses the first persisted artifact id for every derived write on parser retry", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const artifactSegments = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxSegments: 10,
    });
    const documentMultimodalManifests = createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 4,
    });
    const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 4 });
    const knowledgePaths = createInMemoryKnowledgePathRepository({
      maxListLimit: 20,
      maxPaths: 20,
    });
    const parserArtifactIds = [firstArtifactId, retryArtifactId];
    const reindexArtifactIds: string[] = [];
    const semanticArtifactIds: string[] = [];
    const asset = documentAsset();
    const deps: CompileDocumentArtifactDeps = {
      artifacts,
      artifactSegments,
      documentMultimodalManifests,
      documentParser: {
        kind: "native-markdown",
        parse: async (input) =>
          ParseArtifactSchema.parse({
            artifactHash: "a".repeat(64),
            contentType: "text",
            createdAt: "2026-07-13T00:00:00.000Z",
            documentAssetId: input.documentAssetId,
            elements: [
              {
                id: "heading-1",
                metadata: {},
                sectionPath: ["Canonical"],
                text: "Canonical content",
                type: "heading",
              },
            ],
            id: parserArtifactIds.shift(),
            metadata: {},
            parser: "native-markdown",
            version: input.version,
          }),
      },
      generateArtifactSegmentId: randomUUID,
      generateKnowledgePathId: randomUUID,
      knowledgePaths,
      now: () => "2026-07-13T00:00:00.000Z",
      objectStorage: adapter.objectStorage,
      outlineBuilder: createDocumentOutlineBuilder({
        generateId: randomUUID,
        maxElements: 10,
        maxNodes: 10,
        maxSummaryChars: 1_000,
        now: () => "2026-07-13T00:00:00.000Z",
      }),
      outlines,
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
      synchronousUploadReindexer: {
        reindex: async (input) => {
          reindexArtifactIds.push(input.parseArtifact.id);
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
      traces: createNoopTraceRecorder(),
    };

    const compile = () =>
      compileDocumentArtifact(
        {
          asset,
          body: new TextEncoder().encode("# Canonical"),
          knowledgeSpaceId,
          permissionScope: ["team:canonical"],
          tenantId: "tenant-1",
          traceId: randomUUID(),
        },
        deps,
      );

    await expect(compile()).resolves.toMatchObject({ id: firstArtifactId });
    await expect(compile()).resolves.toMatchObject({ id: firstArtifactId });
    await expect(
      artifacts.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toMatchObject({ id: firstArtifactId });
    await expect(artifacts.getById({ id: retryArtifactId })).resolves.toBeNull();
    expect(reindexArtifactIds).toEqual([firstArtifactId, firstArtifactId]);
    expect(semanticArtifactIds).toEqual([firstArtifactId, firstArtifactId]);
    await expect(
      outlines.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toMatchObject({ parseArtifactId: firstArtifactId });
    await expect(
      documentMultimodalManifests.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toMatchObject({ parseArtifactId: firstArtifactId });
    await expect(
      artifactSegments.listByArtifact({
        knowledgeSpaceId,
        limit: 10,
        parseArtifactId: firstArtifactId,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ parseArtifactId: firstArtifactId })],
    });
  });

  it.each(["", PUBLICATION_GENERATION_ID_SENTINEL])(
    "rejects invalid publication generation %j before parsing",
    async (publicationGenerationId) => {
      let parserCalls = 0;
      const deps = {
        documentParser: {
          parse: async () => {
            parserCalls += 1;
            throw new Error("parser must not run");
          },
        },
        synchronousUploadReindexer: null,
      } as unknown as CompileDocumentArtifactDeps;

      await expect(
        compileDocumentArtifact(
          {
            asset: documentAsset(),
            body: new Uint8Array(),
            knowledgeSpaceId,
            permissionScope: [],
            publicationGenerationId,
            tenantId: "tenant-1",
            traceId: randomUUID(),
          },
          deps,
        ),
      ).rejects.toThrow();
      expect(parserCalls).toBe(0);
    },
  );

  it("fails a valid generation before parsing until the publication coordinator is wired", async () => {
    let parserCalls = 0;
    const deps = {
      documentParser: {
        parse: async () => {
          parserCalls += 1;
          throw new Error("parser must not run");
        },
      },
      synchronousUploadReindexer: null,
    } as unknown as CompileDocumentArtifactDeps;

    await expect(
      compileDocumentArtifact(
        {
          asset: documentAsset(),
          body: new Uint8Array(),
          knowledgeSpaceId,
          permissionScope: [],
          publicationGenerationId: "40000000-0000-4000-8000-000000000001",
          tenantId: "tenant-1",
          traceId: randomUUID(),
        },
        deps,
      ),
    ).rejects.toThrow("Generation-scoped document compilation requires a publication coordinator");
    expect(parserCalls).toBe(0);
  });
});

function documentAsset(): DocumentAsset {
  return {
    createdAt: "2026-07-13T00:00:00.000Z",
    filename: "canonical.md",
    id: documentAssetId,
    knowledgeSpaceId,
    metadata: {},
    mimeType: "text/markdown",
    objectKey: "tenant-1/spaces/space/documents/canonical.md",
    parserStatus: "pending",
    sha256: "b".repeat(64),
    sizeBytes: 11,
    version: 1,
  };
}
