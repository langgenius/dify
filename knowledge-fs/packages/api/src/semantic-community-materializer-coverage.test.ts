import { KnowledgeNodeSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { GraphEntity, GraphRelation } from "./graph-index-repository";
import { createInMemoryGraphIndexRepository } from "./graph-index-repository";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createInMemoryKnowledgePathRepository } from "./knowledge-path-repository";
import { createSemanticCommunityMaterializer } from "./semantic-community-materializer";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";

function createRepositories() {
  return {
    graph: createInMemoryGraphIndexRepository({
      maxBatchSize: 20,
      maxEntities: 20,
      maxRelations: 20,
      now: () => "2026-05-29T00:00:00.000Z",
    }),
    nodes: createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 20,
      maxListLimit: 20,
      maxNodes: 20,
    }),
    paths: createInMemoryKnowledgePathRepository({
      maxBatchSize: 40,
      maxListLimit: 40,
      maxPaths: 80,
    }),
  };
}

function createMaterializer(
  repositories: ReturnType<typeof createRepositories>,
  summaryProvider?: Parameters<typeof createSemanticCommunityMaterializer>[0]["summaryProvider"],
) {
  return createSemanticCommunityMaterializer({
    graph: repositories.graph,
    maxCommunitiesPerRun: 10,
    maxEntitiesPerRun: 20,
    maxSourceNodesPerRun: 20,
    nodes: repositories.nodes,
    now: () => "2026-05-29T00:00:00.000Z",
    paths: repositories.paths,
    ...(summaryProvider ? { summaryProvider } : {}),
  });
}

function graphEntity(overrides: Partial<GraphEntity> & { readonly id: string }): GraphEntity {
  return {
    aliases: [],
    canonicalKey: `entity:${overrides.id}`,
    confidence: 0.9,
    createdAt: "2026-05-29T00:00:00.000Z",
    extractionVersion: 1,
    knowledgeSpaceId,
    metadata: {},
    name: "Acme Corp",
    permissionScope: ["tenant-dev"],
    sourceNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c50"],
    type: "organization",
    updatedAt: "2026-05-29T00:00:00.000Z",
    ...overrides,
  };
}

function graphRelation(overrides: Partial<GraphRelation> & { readonly id: string }): GraphRelation {
  return {
    confidence: 0.9,
    createdAt: "2026-05-29T00:00:00.000Z",
    extractionVersion: 1,
    knowledgeSpaceId,
    metadata: {},
    objectEntityId: "entity-b",
    permissionScope: ["tenant-dev"],
    sourceNodeIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c50"],
    subjectEntityId: "entity-a",
    type: "mentions",
    updatedAt: "2026-05-29T00:00:00.000Z",
    ...overrides,
  };
}

function semanticNode(id: string, text: string) {
  const startOffset = Number.parseInt(id.slice(-2), 16);
  const endOffset = startOffset + text.length;

  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId,
    endOffset,
    id,
    kind: "chunk",
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    permissionScope: ["tenant-dev"],
    sourceLocation: { endOffset, sectionPath: ["Overview"], startOffset },
    startOffset,
    text,
  });
}

describe("createSemanticCommunityMaterializer coverage", () => {
  it("rejects non-positive run bounds", () => {
    const repositories = createRepositories();

    expect(() =>
      createSemanticCommunityMaterializer({
        graph: repositories.graph,
        maxCommunitiesPerRun: 0,
        maxEntitiesPerRun: 10,
        maxSourceNodesPerRun: 10,
        nodes: repositories.nodes,
        paths: repositories.paths,
      }),
    ).toThrow("Semantic community maxCommunitiesPerRun must be at least 1");
  });

  it("requires knowledgeSpaceId and tenantId", async () => {
    const materializer = createMaterializer(createRepositories());

    await expect(
      materializer.materialize({ knowledgeSpaceId: "  ", tenantId: "tenant-dev" }),
    ).rejects.toThrow("Semantic community knowledgeSpaceId is required");
    await expect(materializer.materialize({ knowledgeSpaceId, tenantId: "  " })).rejects.toThrow(
      "Semantic community tenantId is required",
    );
  });

  it("returns an empty result when the graph has no community candidates", async () => {
    const materializer = createMaterializer(createRepositories());

    const result = await materializer.materialize({ knowledgeSpaceId, tenantId: "tenant-dev" });

    expect(result).toMatchObject({
      communityCount: 0,
      documentCount: 0,
      entityCount: 0,
      pathCount: 0,
      paths: [],
    });
  });

  it("filters dates, metrics, bare numbers, uuid-like names, and short names", async () => {
    const repositories = createRepositories();
    await repositories.graph.upsertEntities([
      graphEntity({ id: "entity-date", name: "March 2026", type: "date" }),
      graphEntity({ id: "entity-metric", name: "Churn rate", type: "metric" }),
      graphEntity({ id: "entity-number", name: "42.5%" }),
      graphEntity({ id: "entity-uuid", name: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99" }),
      graphEntity({ id: "entity-short", name: "ab" }),
    ]);
    const materializer = createMaterializer(repositories);

    const result = await materializer.materialize({ knowledgeSpaceId, tenantId: "tenant-dev" });

    expect(result).toMatchObject({ communityCount: 0, entityCount: 0, pathCount: 0 });
  });

  it("skips communities whose source nodes cannot be resolved to documents", async () => {
    const repositories = createRepositories();
    await repositories.graph.upsertEntities([
      graphEntity({ id: "entity-orphan", sourceNodeIds: ["node-missing"] }),
    ]);
    const materializer = createMaterializer(repositories);

    const result = await materializer.materialize({ knowledgeSpaceId, tenantId: "tenant-dev" });

    expect(result).toMatchObject({
      communityCount: 0,
      documentCount: 0,
      entityCount: 1,
      pathCount: 0,
    });
  });

  it("merges relation-linked entities into a single community across a cycle", async () => {
    const repositories = createRepositories();
    const nodeA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d51";
    const nodeB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d52";
    const nodeC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d53";
    await repositories.nodes.createMany([
      semanticNode(nodeA, "Acme leads renewals."),
      semanticNode(nodeB, "Atlas powers retrieval."),
      semanticNode(nodeC, "Beacon reports risk."),
    ]);
    await repositories.graph.upsertEntities([
      graphEntity({ id: "entity-a", name: "Acme", sourceNodeIds: [nodeA] }),
      graphEntity({ id: "entity-b", name: "Atlas", sourceNodeIds: [nodeB], type: "product" }),
      graphEntity({ id: "entity-c", name: "Beacon", sourceNodeIds: [nodeC], type: "product" }),
    ]);
    await repositories.graph.upsertRelations([
      graphRelation({ id: "relation-ab", objectEntityId: "entity-b", subjectEntityId: "entity-a" }),
      graphRelation({ id: "relation-bc", objectEntityId: "entity-c", subjectEntityId: "entity-b" }),
      graphRelation({ id: "relation-ca", objectEntityId: "entity-a", subjectEntityId: "entity-c" }),
    ]);
    const materializer = createMaterializer(repositories);

    const result = await materializer.materialize({ knowledgeSpaceId, tenantId: "tenant-dev" });

    expect(result).toMatchObject({
      communityCount: 1,
      documentCount: 1,
      entityCount: 3,
      pathCount: 2,
    });
  });

  it("ignores traversed relations that touch non-candidate entities", async () => {
    const repositories = createRepositories();
    const nodeA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d81";
    await repositories.nodes.createMany([semanticNode(nodeA, "Acme signs in March.")]);
    await repositories.graph.upsertEntities([
      graphEntity({ id: "entity-acme", name: "Acme Corp", sourceNodeIds: [nodeA] }),
      graphEntity({
        id: "entity-march",
        name: "March 2026",
        sourceNodeIds: [nodeA],
        type: "date",
      }),
    ]);
    await repositories.graph.upsertRelations([
      graphRelation({
        id: "relation-date",
        objectEntityId: "entity-march",
        subjectEntityId: "entity-acme",
      }),
    ]);
    const materializer = createMaterializer(repositories);

    const result = await materializer.materialize({ knowledgeSpaceId, tenantId: "tenant-dev" });

    expect(result).toMatchObject({ communityCount: 1, entityCount: 1, pathCount: 2 });
    const communityPath = result.paths.find((path) => path.resourceType === "workspace");
    expect(communityPath?.metadata).toMatchObject({ entityIds: ["entity-acme"] });
  });

  it("falls back to the deterministic title when the provider omits one", async () => {
    const repositories = createRepositories();
    const nodeA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61";
    await repositories.nodes.createMany([semanticNode(nodeA, "Acme leads renewals.")]);
    await repositories.graph.upsertEntities([
      graphEntity({ id: "entity-a", name: "Acme Corp", sourceNodeIds: [nodeA] }),
    ]);
    const materializer = createMaterializer(repositories, {
      summarize: async () => ({ summary: "Provider summary.", title: "   " }),
    });

    const result = await materializer.materialize({ knowledgeSpaceId, tenantId: "tenant-dev" });

    const communityPath = result.paths.find((path) => path.resourceType === "workspace");
    expect(communityPath?.metadata).toMatchObject({
      summary: "Provider summary.",
      title: "Acme Corp",
    });
    expect(communityPath?.metadata).not.toHaveProperty("summaryModel");
  });

  it("uses a stable community slug when the title has no slug characters", async () => {
    const repositories = createRepositories();
    const nodeA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d71";
    await repositories.nodes.createMany([semanticNode(nodeA, "Symbols only.")]);
    await repositories.graph.upsertEntities([
      graphEntity({ id: "entity-symbols", name: "###", sourceNodeIds: [nodeA] }),
    ]);
    const materializer = createMaterializer(repositories);

    const result = await materializer.materialize({ knowledgeSpaceId, tenantId: "tenant-dev" });

    const communityPath = result.paths.find((path) => path.resourceType === "workspace");
    expect(communityPath?.virtualPath).toMatch(
      /^\/knowledge\/by-community\/community-[0-9a-f]{8}$/,
    );
  });
});
