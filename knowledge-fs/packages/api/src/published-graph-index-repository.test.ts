import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseRow } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { GraphIndexRepository, GraphTraversalResult } from "./graph-index-repository";
import { createDatabaseHybridRetrievalRepository } from "./hybrid-retrieval";
import {
  type PublishedGraphIndexRepository,
  PublishedGraphSnapshotNotFoundError,
  createDatabasePublishedGraphIndexRepository,
} from "./published-graph-index-repository";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import { createGraphExpandedRetrievalPath } from "./retrieval-paths";
import type { HybridRetrievalResult, RetrieveHybridInput } from "./retrieval-types";

const TENANT_ID = "tenant-1";
const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const PUBLICATION_ID = "20000000-0000-4000-8000-000000000001";
const GENERATION_ID = "30000000-0000-4000-8000-000000000001";
const CHILD_GENERATION_ID = "30000000-0000-4000-8000-000000000002";
const ROOT_ID = "40000000-0000-4000-8000-000000000001";
const CHILD_ID = "40000000-0000-4000-8000-000000000002";
const RELATION_ID = "50000000-0000-4000-8000-000000000001";
const ROOT_NODE_ID = "60000000-0000-4000-8000-000000000001";
const CHILD_NODE_ID = "60000000-0000-4000-8000-000000000002";
const FINGERPRINT = `projection-set-sha256:${"a".repeat(64)}`;

const snapshot: PublishedProjectionReadSnapshot = {
  fingerprint: FINGERPRINT,
  headRevision: 7,
  knowledgeSpaceId: SPACE_ID,
  projectionVersion: 3,
  publicationId: PUBLICATION_ID,
  tenantId: TENANT_ID,
};

describe.each(["postgres", "tidb"] as const)(
  "database published graph repository (%s)",
  (dialect) => {
    it("resolves and traverses only exact immutable publication members with document closure", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let edgeReads = 0;
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push({ ...input, params: [...input.params] });
          if (input.tableName === "projection_set_publications") {
            return { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 };
          }
          if (input.sql.includes("fanout_rank")) {
            edgeReads += 1;
            return {
              rows: edgeReads === 1 ? [publishedEdgeRow()] : [],
              rowsAffected: edgeReads === 1 ? 1 : 0,
            };
          }
          if (input.sql.includes("SELECT e.*")) {
            return { rows: [graphEntityRow(ROOT_ID, "Root", ROOT_NODE_ID)], rowsAffected: 1 };
          }
          return { rows: [{ entity_id: ROOT_ID }], rowsAffected: 1 };
        },
        kind: dialect,
      });
      const graph = createDatabasePublishedGraphIndexRepository({
        database,
        maxSeedLookupSize: 100,
      });

      const seeds = await graph.findSeedEntityIds({
        candidateEntityIds: [ROOT_ID, "unpublished-entity"],
        limit: 5,
        permissionScope: ["team:camera"],
        snapshot,
        sourceNodeIds: [ROOT_NODE_ID],
      });
      const traversal = await graph.traverse({
        fanout: 3,
        maxDepth: 2,
        maxNodes: 10,
        permissionScope: ["team:camera"],
        snapshot,
        startEntityId: seeds[0] ?? "missing",
        timeoutMs: 1_000,
      });

      expect(seeds).toEqual([ROOT_ID]);
      expect(traversal.entities.map((entity) => entity.id)).toEqual([ROOT_ID, CHILD_ID]);
      expect(traversal.relations.map((relation) => relation.id)).toEqual([RELATION_ID]);
      expect(traversal.entities[1]?.publicationGenerationId).toBe(CHILD_GENERATION_ID);
      const memberSql = calls
        .filter((call) => call.tableName === "projection_set_publication_members")
        .map((call) => call.sql)
        .join("\n");
      expect(memberSql).toContain("graph-entity");
      expect(memberSql).toContain("graph-relation");
      expect(memberSql).toContain("generation_id");
      expect(memberSql).toContain("document_asset_id");
      expect(memberSql).toContain("source_node_ids");
      expect(memberSql).toContain("knowledge_nodes");
      expect(memberSql).toContain("closure_member");
      expect(memberSql).toContain("closure_projection");
      expect(memberSql).toContain("closure_document");
      expect(memberSql).toContain("lifecycle_state");
      expect(memberSql).toContain("'active'");
      expect(memberSql).toContain("closure_parent_source");
      expect(memberSql).toContain("<> 'deleting'");
      expect(memberSql).toContain("deletion_job_id");
      expect(memberSql).toContain("'index-projection'");
      expect(memberSql).toContain(
        dialect === "postgres"
          ? 'closure_projection."node_id" = closure_node."id"'
          : "closure_projection.`node_id` = closure_node.`id`",
      );
      expect(memberSql).toContain("superseded");
      expect(memberSql).not.toContain("projection_set_publication_heads");
      const quote = dialect === "postgres" ? '"' : "`";
      expect(memberSql).not.toContain(
        `sm.${quote}generation_id${quote} = rm.${quote}generation_id${quote}`,
      );
      expect(memberSql).not.toContain(
        `cm.${quote}document_asset_id${quote} = rm.${quote}document_asset_id${quote}`,
      );
      expect(calls.every((call) => call.params.includes(PUBLICATION_ID))).toBe(true);

      const firstEdgeCall = calls.find((call) => call.sql.includes("fanout_rank"));
      expect(firstEdgeCall?.params).toEqual(
        dialect === "postgres"
          ? [
              TENANT_ID,
              SPACE_ID,
              PUBLICATION_ID,
              FINGERPRINT,
              JSON.stringify(["team:camera"]),
              ROOT_ID,
              3,
              3,
            ]
          : [
              TENANT_ID,
              SPACE_ID,
              PUBLICATION_ID,
              FINGERPRINT,
              ROOT_ID,
              JSON.stringify(["team:camera"]),
              JSON.stringify(["team:camera"]),
              JSON.stringify(["team:camera"]),
              JSON.stringify(["team:camera"]),
              JSON.stringify(["team:camera"]),
              JSON.stringify(["team:camera"]),
              3,
              3,
            ],
      );
    });

    it("fails closed when the fixed publication no longer exists", async () => {
      const database = createSchemaDatabaseAdapter({
        executor: async () => ({ rows: [], rowsAffected: 0 }),
        kind: dialect,
      });
      const graph = createDatabasePublishedGraphIndexRepository({
        database,
        maxSeedLookupSize: 10,
      });

      await expect(
        graph.findSeedEntityIds({
          candidateEntityIds: [],
          limit: 1,
          permissionScope: [],
          snapshot,
          sourceNodeIds: [ROOT_NODE_ID],
        }),
      ).rejects.toBeInstanceOf(PublishedGraphSnapshotNotFoundError);
    });

    it("pushes published Graph source-node ids into the authoritative hybrid SQL", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const hybrid = createDatabaseHybridRetrievalRepository({
        database,
        maxTopK: 10,
        requirePublishedSnapshot: true,
      });

      await hybrid.searchFts({
        filters: { nodeIds: [CHILD_NODE_ID] },
        knowledgeSpaceId: SPACE_ID,
        permissionScope: ["team:camera"],
        projectionSetPublicationId: PUBLICATION_ID,
        query: "camera policy",
        tenantId: TENANT_ID,
        topK: 5,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.sql).toContain("projection_set_publication_members");
      expect(calls[0]?.sql).toContain("index-projection");
      expect(calls[0]?.sql).toContain(dialect === "postgres" ? 'n."id" IN' : "n.`id` IN");
      expect(calls[0]?.params).toContain(CHILD_NODE_ID);
    });
  },
);

describe("published graph retrieval path", () => {
  it("uses base node ids to seed fixed-snapshot traversal and scopes secondary candidates", async () => {
    const baseCalls: RetrieveHybridInput[] = [];
    const legacyTraverse = vi.fn(async () => emptyTraversal());
    const publishedSeed = vi.fn(async () => [ROOT_ID]);
    const publishedTraverse = vi.fn(async () => publishedTraversal());
    const retriever = createGraphExpandedRetrievalPath({
      fanout: 5,
      graph: { traverse: legacyTraverse } as unknown as GraphIndexRepository,
      graphBoost: 0.2,
      graphTopK: 5,
      maxDepth: 2,
      maxSeedEntities: 3,
      maxTraversalNodes: 20,
      publishedGraph: {
        findSeedEntityIds: publishedSeed,
        traverse: publishedTraverse,
      },
      retriever: {
        retrieve: async (input) => {
          baseCalls.push(input);
          return input.filters?.nodeIds
            ? retrievalResult(CHILD_NODE_ID, "graph-projection")
            : retrievalResult(ROOT_NODE_ID, "base-projection");
        },
      },
      strictPublishedReads: true,
      timeoutMs: 100,
    });

    const result = await retriever.retrieve(retrievalInput("deep"));

    expect(legacyTraverse).not.toHaveBeenCalled();
    expect(publishedSeed).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot, sourceNodeIds: [ROOT_NODE_ID] }),
    );
    expect(publishedTraverse).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot, startEntityId: ROOT_ID }),
    );
    expect(baseCalls).toHaveLength(2);
    expect(baseCalls[1]?.projectionSnapshot).toBe(snapshot);
    expect(baseCalls[1]?.filters?.nodeIds).toEqual([ROOT_NODE_ID, CHILD_NODE_ID]);
    expect(result.items.map((item) => item.nodeId)).toEqual([ROOT_NODE_ID, CHILD_NODE_ID]);
    expect(result.metrics).toMatchObject({ graphExpansionCandidates: 1 });
  });

  it("never touches Graph for Research and fails closed for Deep without a snapshot", async () => {
    const graph = {
      findSeedEntityIds: vi.fn(async () => [ROOT_ID]),
      traverse: vi.fn(async () => publishedTraversal()),
    } satisfies PublishedGraphIndexRepository;
    const retriever = createGraphExpandedRetrievalPath({
      fanout: 5,
      graph: { traverse: vi.fn(async () => emptyTraversal()) } as unknown as GraphIndexRepository,
      graphBoost: 0.2,
      graphTopK: 5,
      maxDepth: 2,
      maxSeedEntities: 3,
      maxTraversalNodes: 20,
      publishedGraph: graph,
      retriever: { retrieve: async () => retrievalResult(ROOT_NODE_ID, "base-projection") },
      strictPublishedReads: true,
      timeoutMs: 100,
    });

    await expect(retriever.retrieve(retrievalInput("research"))).resolves.toMatchObject({
      items: [{ nodeId: ROOT_NODE_ID }],
    });
    expect(graph.findSeedEntityIds).not.toHaveBeenCalled();
    expect(graph.traverse).not.toHaveBeenCalled();

    await expect(
      retriever.retrieve({ ...retrievalInput("deep"), projectionSnapshot: undefined }),
    ).rejects.toThrow("requires a published projection snapshot");
  });

  it("records a zero-seed Graph attempt instead of silently looking like ordinary hybrid", async () => {
    const retriever = createGraphExpandedRetrievalPath({
      fanout: 5,
      graph: { traverse: vi.fn(async () => emptyTraversal()) } as unknown as GraphIndexRepository,
      graphBoost: 0.2,
      graphTopK: 5,
      maxDepth: 2,
      maxSeedEntities: 3,
      maxTraversalNodes: 20,
      publishedGraph: {
        findSeedEntityIds: async () => [],
        traverse: vi.fn(async () => publishedTraversal()),
      },
      retriever: { retrieve: async () => retrievalResult(ROOT_NODE_ID, "base-projection") },
      strictPublishedReads: true,
      timeoutMs: 100,
    });

    const result = await retriever.retrieve(retrievalInput("deep"));

    expect(result.metrics).toMatchObject({
      graphExpansionCandidates: 0,
      graphExpansionSeeds: 0,
      graphExpansionTimedOut: false,
    });
  });
});

it("bounds published graph traversal by timeout before reading another frontier", async () => {
  const calls: DatabaseExecuteInput[] = [];
  const database = createSchemaDatabaseAdapter({
    executor: async (input) => {
      calls.push(input);
      return input.tableName === "projection_set_publications"
        ? { rows: [{ snapshot_exists: 1 }], rowsAffected: 1 }
        : { rows: [graphEntityRow(ROOT_ID, "Root", ROOT_NODE_ID)], rowsAffected: 1 };
    },
    kind: "postgres",
  });
  const timestamps = [0, 11, 12];
  const graph = createDatabasePublishedGraphIndexRepository({
    database,
    maxSeedLookupSize: 10,
    now: () => timestamps.shift() ?? 12,
  });

  const result = await graph.traverse({
    fanout: 3,
    maxDepth: 2,
    maxNodes: 10,
    permissionScope: ["team:camera"],
    snapshot,
    startEntityId: ROOT_ID,
    timeoutMs: 10,
  });

  expect(result.metrics).toMatchObject({ timedOut: true });
  expect(result.truncated).toBe(true);
  expect(calls.some((call) => call.sql.includes("fanout_rank"))).toBe(false);
});

function graphEntityRow(id: string, name: string, sourceNodeId: string): DatabaseRow {
  return {
    aliases: JSON.stringify([name]),
    canonical_key: `organization:${name.toLowerCase()}`,
    confidence: 0.9,
    created_at: "2026-07-14T00:00:00.000Z",
    extraction_version: 1,
    id,
    knowledge_space_id: SPACE_ID,
    metadata: JSON.stringify({}),
    name,
    permission_scope: JSON.stringify(["team:camera"]),
    publication_generation_id: GENERATION_ID,
    source_node_ids: JSON.stringify([sourceNodeId]),
    type: "organization",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function publishedEdgeRow(): DatabaseRow {
  const entity = {
    ...graphEntityRow(CHILD_ID, "Child", CHILD_NODE_ID),
    publication_generation_id: CHILD_GENERATION_ID,
  };
  return {
    ...Object.fromEntries(Object.entries(entity).map(([key, value]) => [`entity_${key}`, value])),
    relation_confidence: 0.8,
    relation_created_at: "2026-07-14T00:00:00.000Z",
    relation_extraction_version: 1,
    relation_id: RELATION_ID,
    relation_knowledge_space_id: SPACE_ID,
    relation_metadata: JSON.stringify({}),
    relation_object_entity_id: CHILD_ID,
    relation_permission_scope: JSON.stringify(["team:camera"]),
    relation_publication_generation_id: GENERATION_ID,
    relation_source_node_ids: JSON.stringify([ROOT_NODE_ID]),
    relation_subject_entity_id: ROOT_ID,
    relation_type: "mentions",
    relation_updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function retrievalInput(mode: "deep" | "research"): RetrieveHybridInput {
  return {
    knowledgeSpaceId: SPACE_ID,
    limit: 5,
    mode,
    permissionScope: ["team:camera"],
    projectionSnapshot: snapshot,
    query: "camera policy",
    queryVector: [0.1, 0.2],
    tenantId: TENANT_ID,
    topK: 5,
  };
}

function retrievalResult(nodeId: string, projectionId: string): HybridRetrievalResult {
  return {
    items: [
      {
        citation: {
          artifactHash: "b".repeat(64),
          documentAssetId: "70000000-0000-4000-8000-000000000001",
          documentVersion: 1,
          sectionPath: ["Policy"],
        },
        metadata: {},
        nodeId,
        permissionScope: ["team:camera"],
        projectionIds: [projectionId],
        score: 0.8,
        sources: ["dense"],
      },
    ],
    metrics: {
      denseCandidates: 1,
      denseMs: 1,
      ftsCandidates: 0,
      ftsMs: 1,
      fusedCandidates: 1,
      fusionMs: 1,
      totalMs: 3,
    },
    plan: {
      denseTopK: 5,
      ftsTopK: 5,
      fusionLimit: 5,
      queryLanguage: "latin",
      requestedMode: "deep",
      rerankCandidateLimit: 5,
      resolvedMode: "deep",
      strategyVersion: "retrieval-planner-v1",
      topK: 5,
    },
  };
}

function publishedTraversal(): GraphTraversalResult {
  return {
    entities: [
      traversalEntity(ROOT_ID, "Root", ROOT_NODE_ID, 0),
      traversalEntity(CHILD_ID, "Child", CHILD_NODE_ID, 1),
    ],
    metrics: {
      depthReached: 1,
      elapsedMs: 1,
      exploredRelations: 1,
      fanout: 5,
      maxDepth: 2,
      maxNodes: 20,
      timedOut: false,
    },
    relations: [],
    truncated: false,
  };
}

function emptyTraversal(): GraphTraversalResult {
  return {
    entities: [],
    metrics: {
      depthReached: 0,
      elapsedMs: 0,
      exploredRelations: 0,
      fanout: 5,
      maxDepth: 2,
      maxNodes: 20,
      timedOut: false,
    },
    relations: [],
    truncated: false,
  };
}

function traversalEntity(id: string, name: string, sourceNodeId: string, depth: number) {
  return {
    aliases: [name],
    canonicalKey: `organization:${name.toLowerCase()}`,
    confidence: 0.9,
    createdAt: "2026-07-14T00:00:00.000Z",
    depth,
    extractionVersion: 1,
    id,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    name,
    permissionScope: ["team:camera"],
    publicationGenerationId: GENERATION_ID,
    sourceNodeIds: [sourceNodeId],
    type: "organization" as const,
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}
