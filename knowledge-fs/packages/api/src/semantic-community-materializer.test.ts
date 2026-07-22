import { KnowledgeNodeSchema, KnowledgePathSchema } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { createInMemoryGraphIndexRepository } from "./graph-index-repository";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createInMemoryKnowledgePathRepository } from "./knowledge-path-repository";
import { createSemanticCommunityMaterializer } from "./semantic-community-materializer";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";

describe("createSemanticCommunityMaterializer", () => {
  it("materializes entity co-occurrence communities with summaries and document links", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
      now: () => "2026-05-29T00:00:00.000Z",
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxPaths: 20,
    });
    await nodes.createMany([
      semanticNode(
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        "Acme Corp ships Atlas Search for renewal risk review.",
      ),
    ]);
    await graph.upsertEntities([
      graphEntity({
        canonicalKey: "organization:acme-corp",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
        name: "Acme Corp",
        type: "organization",
      }),
      graphEntity({
        canonicalKey: "product:atlas-search",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
        name: "Atlas Search",
        type: "product",
      }),
    ]);
    const materializer = createSemanticCommunityMaterializer({
      graph,
      maxCommunitiesPerRun: 5,
      maxEntitiesPerRun: 10,
      maxSourceNodesPerRun: 10,
      nodes,
      now: () => "2026-05-29T00:00:00.000Z",
      paths,
      summaryProvider: {
        summarize: async (input) => ({
          metadata: { entityNames: input.entities.map((entity) => entity.name) },
          model: "community-summary-test",
          summary: "Acme and Atlas Search are discussed together for renewal risk.",
          title: "Acme renewal risk",
        }),
      },
    });

    const result = await materializer.materialize({
      knowledgeSpaceId,
      tenantId: "tenant-dev",
    });

    expect(result).toMatchObject({
      communityCount: 1,
      documentCount: 1,
      entityCount: 2,
      pathCount: 2,
    });
    const listed = await paths.listSemanticDescendants({
      knowledgeSpaceId,
      limit: 10,
      parentPath: "/knowledge/by-community",
      viewName: "by-community",
    });
    expect(listed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            documentCount: 1,
            entityCount: 2,
            summary: "Acme and Atlas Search are discussed together for renewal risk.",
            summaryModel: "community-summary-test",
            title: "Acme renewal risk",
          }),
          resourceType: "workspace",
          virtualPath: expect.stringMatching(/^\/knowledge\/by-community\/acme-corp-atlas-search-/),
        }),
        expect.objectContaining({
          resourceType: "document",
          targetId: documentAssetId,
          virtualPath: expect.stringMatching(
            /^\/knowledge\/by-community\/acme-corp-atlas-search-.*\/018f0d60-/,
          ),
        }),
      ]),
    );
  });

  it("does not replace a shared community path when any entity closure is hidden", async () => {
    const visibleAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d41";
    const hiddenAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42";
    const visibleNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d51";
    const hiddenNodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d52";
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 10,
      maxEntities: 10,
      maxRelations: 10,
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxNodes: 10,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxBatchSize: 10,
      maxListLimit: 10,
      maxPaths: 20,
    });
    for (const [id, filename, permissionScope] of [
      [visibleAssetId, "Visible.md", ["member:visible"]],
      [hiddenAssetId, "Hidden.md", ["member:hidden"]],
    ] as const) {
      await assets.create({
        filename,
        id,
        knowledgeSpaceId,
        metadata: { permissionScope },
        mimeType: "text/markdown",
        objectKey: `objects/${id}`,
        sha256: "f".repeat(64),
        sizeBytes: 1,
      });
    }
    await nodes.createMany([
      scopedSemanticNode({
        documentAssetId: visibleAssetId,
        id: visibleNodeId,
        permissionScope: ["member:visible"],
        text: "Visible project context",
      }),
      scopedSemanticNode({
        documentAssetId: hiddenAssetId,
        id: hiddenNodeId,
        permissionScope: ["member:hidden"],
        text: "Hidden acquisition context",
      }),
    ]);
    await graph.upsertEntities([
      graphEntity({
        canonicalKey: "organization:visible",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61",
        name: "Visible Corp",
        permissionScope: ["member:visible"],
        sourceNodeIds: [visibleNodeId],
        type: "organization",
      }),
      graphEntity({
        canonicalKey: "organization:hidden",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d62",
        name: "Hidden Corp",
        permissionScope: ["member:hidden"],
        sourceNodeIds: [hiddenNodeId],
        type: "organization",
      }),
    ]);
    const existingPath = KnowledgePathSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d71",
      knowledgeSpaceId,
      metadata: { hiddenAssociation: true, permissionScope: ["member:hidden"] },
      resourceType: "workspace",
      targetId: knowledgeSpaceId,
      viewName: "by-community",
      viewType: "semantic",
      virtualPath: "/knowledge/by-community/existing-hidden",
    });
    await paths.upsertMany([existingPath]);
    const summarize = vi.fn(async () => ({ summary: "must not run" }));
    const materializer = createSemanticCommunityMaterializer({
      assets,
      graph,
      maxCommunitiesPerRun: 5,
      maxEntitiesPerRun: 10,
      maxSourceNodesPerRun: 10,
      nodes,
      paths,
      summaryProvider: { summarize },
    });
    const graphBefore = await graph.listEntities({ knowledgeSpaceId, limit: 10 });

    await expect(
      materializer.materialize({
        candidateGrants: ["member:visible"],
        knowledgeSpaceId,
        tenantId: "tenant-dev",
      }),
    ).rejects.toThrow("Semantic mutation requires visibility over the complete candidate corpus");

    expect(summarize).not.toHaveBeenCalled();
    await expect(
      paths.get({ knowledgeSpaceId, virtualPath: existingPath.virtualPath }),
    ).resolves.toEqual(existingPath);
    await expect(graph.listEntities({ knowledgeSpaceId, limit: 10 })).resolves.toEqual(graphBefore);
  });
});

function graphEntity({
  canonicalKey,
  id,
  name,
  permissionScope = ["tenant-dev"],
  sourceNodeIds = ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c50"],
  type,
}: {
  readonly canonicalKey: string;
  readonly id: string;
  readonly name: string;
  readonly permissionScope?: readonly string[] | undefined;
  readonly sourceNodeIds?: readonly string[] | undefined;
  readonly type: "organization" | "product";
}) {
  return {
    aliases: [],
    canonicalKey,
    confidence: 0.95,
    createdAt: "2026-05-29T00:00:00.000Z",
    extractionVersion: 1,
    id,
    knowledgeSpaceId,
    metadata: {},
    name,
    permissionScope,
    sourceNodeIds,
    type,
    updatedAt: "2026-05-29T00:00:00.000Z",
  };
}

function semanticNode(id: string, text: string) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId,
    endOffset: text.length,
    id,
    kind: "chunk",
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    permissionScope: ["tenant-dev"],
    sourceLocation: { endOffset: text.length, sectionPath: ["Overview"], startOffset: 0 },
    startOffset: 0,
    text,
  });
}

function scopedSemanticNode({
  documentAssetId,
  id,
  permissionScope,
  text,
}: {
  readonly documentAssetId: string;
  readonly id: string;
  readonly permissionScope: readonly string[];
  readonly text: string;
}) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "b".repeat(64),
    documentAssetId,
    endOffset: text.length,
    id,
    kind: "chunk",
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    permissionScope,
    sourceLocation: { endOffset: text.length, sectionPath: ["Overview"], startOffset: 0 },
    startOffset: 0,
    text,
  });
}
