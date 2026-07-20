import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  PUBLICATION_GENERATION_ID_SENTINEL,
} from "@knowledge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type GraphEntity,
  type GraphRelation,
  createDatabaseGraphIndexRepository,
  createInMemoryGraphIndexRepository,
} from "./graph-index-repository";

function graphEntity(overrides: Partial<GraphEntity> = {}): GraphEntity {
  return {
    aliases: ["Acme"],
    canonicalKey: "organization:acme",
    confidence: 0.9,
    createdAt: "2026-05-12T12:00:00.000Z",
    extractionVersion: 1,
    id: "entity-1",
    knowledgeSpaceId: "space-1",
    metadata: {},
    name: "Acme",
    permissionScope: ["tenant-1"],
    sourceNodeIds: ["node-1"],
    type: "organization",
    updatedAt: "2026-05-12T12:00:00.000Z",
    ...overrides,
  };
}

function graphRelation(overrides: Partial<GraphRelation> = {}): GraphRelation {
  return {
    confidence: 0.9,
    createdAt: "2026-05-12T12:00:00.000Z",
    extractionVersion: 1,
    id: "relation-1",
    knowledgeSpaceId: "space-1",
    metadata: {},
    objectEntityId: "entity-2",
    permissionScope: ["tenant-1"],
    sourceNodeIds: ["node-1"],
    subjectEntityId: "entity-1",
    type: "mentions",
    updatedAt: "2026-05-12T12:00:00.000Z",
    ...overrides,
  };
}

function transactionalDatabase(
  kind: "postgres" | "tidb",
  executor: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
) {
  return createSchemaDatabaseAdapter({
    executor,
    kind,
    transaction: async (callback) => callback({ execute: executor }),
  });
}

function graphEntityRow(entity: GraphEntity): Record<string, unknown> {
  return {
    aliases: [...entity.aliases],
    canonical_key: entity.canonicalKey,
    confidence: entity.confidence,
    created_at: entity.createdAt,
    extraction_version: entity.extractionVersion,
    id: entity.id,
    knowledge_space_id: entity.knowledgeSpaceId,
    metadata: { ...entity.metadata },
    name: entity.name,
    permission_scope: [...entity.permissionScope],
    publication_generation_id: entity.publicationGenerationId ?? null,
    source_node_ids: [...entity.sourceNodeIds],
    type: entity.type,
    updated_at: entity.updatedAt,
  };
}

function graphRelationRow(relation: GraphRelation): Record<string, unknown> {
  return {
    confidence: relation.confidence,
    created_at: relation.createdAt,
    extraction_version: relation.extractionVersion,
    id: relation.id,
    knowledge_space_id: relation.knowledgeSpaceId,
    metadata: { ...relation.metadata },
    object_entity_id: relation.objectEntityId,
    permission_scope: [...relation.permissionScope],
    publication_generation_id: relation.publicationGenerationId ?? null,
    source_node_ids: [...relation.sourceNodeIds],
    subject_entity_id: relation.subjectEntityId,
    type: relation.type,
    updated_at: relation.updatedAt,
  };
}

function createRepository() {
  return createInMemoryGraphIndexRepository({
    maxBatchSize: 10,
    maxEntities: 20,
    maxRelations: 20,
    now: () => "2026-05-12T13:00:00.000Z",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("in-memory graph index repository coverage", () => {
  it("leaves other knowledge spaces untouched when pruning source nodes", async () => {
    const graph = createRepository();
    await graph.upsertEntities([
      graphEntity({ canonicalKey: "org:one", id: "entity-1", sourceNodeIds: ["node-1"] }),
      graphEntity({
        canonicalKey: "org:two",
        id: "entity-other",
        knowledgeSpaceId: "space-2",
        sourceNodeIds: ["node-1"],
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({ id: "relation-1", sourceNodeIds: ["node-1"] }),
      graphRelation({
        id: "relation-other",
        knowledgeSpaceId: "space-2",
        sourceNodeIds: ["node-1"],
      }),
    ]);

    const result = await graph.pruneSourceNodes({
      knowledgeSpaceId: "space-1",
      maxSourceNodes: 5,
      sourceNodeIds: ["node-1"],
    });

    // A relation only keeps an otherwise orphaned entity when both records belong to the same
    // knowledge space and publication generation. The similarly keyed space-2 relation must not
    // keep the pruned space-1 entity alive.
    expect(result).toEqual({
      prunedEntities: 1,
      prunedRelations: 1,
      updatedEntities: 0,
      updatedRelations: 0,
    });
    const otherSpace = await graph.listEntities({ knowledgeSpaceId: "space-2", limit: 5 });
    expect(otherSpace.items[0]?.sourceNodeIds).toEqual(["node-1"]);
  });

  it("keeps the stable entity id when a canonical key is upserted with a new id", async () => {
    const graph = createRepository();
    await graph.upsertEntities([graphEntity({ id: "entity-old" })]);
    await graph.upsertEntities([graphEntity({ id: "entity-new" })]);

    const listed = await graph.listEntities({ knowledgeSpaceId: "space-1", limit: 5 });

    expect(listed.items.map((entity) => entity.id)).toEqual(["entity-old"]);
    const traversal = await graph.traverse({
      fanout: 2,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 5,
      permissionScope: ["tenant-1"],
      startEntityId: "entity-old",
      timeoutMs: 100,
    });
    expect(traversal.entities.map((entity) => entity.id)).toEqual(["entity-old"]);
  });

  it("validates entity and relation batches", async () => {
    const graph = createInMemoryGraphIndexRepository({
      maxBatchSize: 1,
      maxEntities: 5,
      maxRelations: 5,
    });

    await expect(graph.upsertEntities([graphEntity(), graphEntity()])).rejects.toThrow(
      "Graph entity batch size exceeds maxBatchSize=1",
    );
    await expect(graph.upsertEntities([graphEntity({ canonicalKey: "  " })])).rejects.toThrow(
      "Graph entity id, knowledgeSpaceId, and canonicalKey are required",
    );
    await expect(
      graph.upsertEntities([graphEntity({ canonicalKey: "k".repeat(513) })]),
    ).rejects.toThrow("Graph entity canonicalKey, name, or type exceeds database key bounds");
    await expect(graph.upsertRelations([graphRelation(), graphRelation()])).rejects.toThrow(
      "Graph relation batch size exceeds maxBatchSize=1",
    );
    await expect(graph.upsertRelations([graphRelation({ subjectEntityId: " " })])).rejects.toThrow(
      "Graph relation id, knowledgeSpaceId, subjectEntityId, and objectEntityId are required",
    );
    await expect(
      graph.traverse({
        fanout: 1,
        knowledgeSpaceId: "space-1",
        maxDepth: 1,
        maxNodes: 1,
        permissionScope: [" "],
        startEntityId: "entity-1",
        timeoutMs: 100,
      }),
    ).rejects.toThrow("Graph traversal permissionScope must contain non-empty strings");
  });

  it("validates list inputs and breaks name ties by id", async () => {
    const graph = createRepository();
    await graph.upsertEntities([
      graphEntity({ canonicalKey: "org:b", id: "entity-b", name: "Same Name" }),
      graphEntity({ canonicalKey: "org:a", id: "entity-a", name: "Same Name" }),
    ]);

    await expect(graph.listEntities({ knowledgeSpaceId: " ", limit: 1 })).rejects.toThrow(
      "Graph entity list knowledgeSpaceId is required",
    );
    await expect(graph.listEntities({ knowledgeSpaceId: "space-1", limit: 0 })).rejects.toThrow(
      "Graph entity list limit must be at least 1",
    );
    await expect(
      graph.listEntities({
        cursor: { id: " ", name: "Same Name" },
        knowledgeSpaceId: "space-1",
        limit: 1,
      }),
    ).rejects.toThrow("Graph entity list cursor is invalid");

    const listed = await graph.listEntities({ knowledgeSpaceId: "space-1", limit: 5 });
    expect(listed.items.map((entity) => entity.id)).toEqual(["entity-a", "entity-b"]);

    const afterCursor = await graph.listEntities({
      cursor: { id: "entity-a", name: "Same Name" },
      knowledgeSpaceId: "space-1",
      limit: 5,
    });
    expect(afterCursor.items.map((entity) => entity.id)).toEqual(["entity-b"]);
  });

  it("stops traversal when the deadline elapses", async () => {
    const graph = createRepository();
    await graph.upsertEntities([graphEntity({ id: "entity-root" })]);
    let tick = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      tick += 10_000;
      return tick;
    });

    const traversal = await graph.traverse({
      fanout: 2,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 5,
      permissionScope: ["tenant-1"],
      startEntityId: "entity-root",
      timeoutMs: 1,
    });

    expect(traversal.metrics.timedOut).toBe(true);
    expect(traversal.truncated).toBe(true);
    expect(traversal.entities.map((entity) => entity.id)).toEqual(["entity-root"]);
  });

  it("skips traversal edges whose targets are missing and orders siblings deterministically", async () => {
    const graph = createRepository();
    await graph.upsertEntities([
      graphEntity({ canonicalKey: "org:root", id: "entity-root", name: "Root" }),
      graphEntity({ canonicalKey: "org:child-a", id: "entity-child-a", name: "Child A" }),
      graphEntity({ canonicalKey: "org:child-b", id: "entity-child-b", name: "Child B" }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "relation-missing",
        objectEntityId: "entity-ghost",
        subjectEntityId: "entity-root",
      }),
      graphRelation({
        id: "relation-a-v1",
        objectEntityId: "entity-child-a",
        subjectEntityId: "entity-root",
      }),
      graphRelation({
        extractionVersion: 2,
        id: "relation-a-v2",
        objectEntityId: "entity-child-a",
        subjectEntityId: "entity-root",
      }),
      graphRelation({
        id: "relation-b",
        objectEntityId: "entity-child-b",
        subjectEntityId: "entity-root",
      }),
    ]);

    const traversal = await graph.traverse({
      fanout: 4,
      knowledgeSpaceId: "space-1",
      maxDepth: 2,
      maxNodes: 10,
      permissionScope: ["tenant-1"],
      startEntityId: "entity-root",
      timeoutMs: 1_000,
    });

    expect(traversal.entities.map((entity) => entity.id)).toEqual([
      "entity-root",
      "entity-child-a",
      "entity-child-b",
    ]);
    expect(traversal.relations.map((relation) => relation.id)).toEqual([
      "relation-a-v1",
      "relation-a-v2",
      "relation-b",
    ]);
  });

  it("filters the root, relations, and targets before fanout and node budgets", async () => {
    const graph = createRepository();
    await graph.upsertEntities([
      graphEntity({ canonicalKey: "org:root", id: "entity-root", name: "Root" }),
      graphEntity({
        canonicalKey: "policy:private-target",
        id: "entity-private-target",
        permissionScope: ["tenant-1", "secret"],
      }),
      graphEntity({ canonicalKey: "policy:private-edge", id: "entity-private-edge" }),
      graphEntity({ canonicalKey: "policy:allowed", id: "entity-allowed" }),
    ]);
    await graph.upsertRelations([
      graphRelation({
        id: "relation-private-target",
        objectEntityId: "entity-private-target",
        subjectEntityId: "entity-root",
        type: "contradicts",
      }),
      graphRelation({
        id: "relation-private-edge",
        objectEntityId: "entity-private-edge",
        permissionScope: ["tenant-1", "secret"],
        subjectEntityId: "entity-root",
        type: "defines",
      }),
      graphRelation({
        id: "relation-allowed",
        objectEntityId: "entity-allowed",
        subjectEntityId: "entity-root",
        type: "mentions",
      }),
    ]);

    const publicOnly = await graph.traverse({
      fanout: 1,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 2,
      startEntityId: "entity-root",
      timeoutMs: 100,
    });
    expect(publicOnly.entities).toEqual([]);

    const allowed = await graph.traverse({
      fanout: 1,
      knowledgeSpaceId: "space-1",
      maxDepth: 1,
      maxNodes: 2,
      permissionScope: ["tenant-1"],
      startEntityId: "entity-root",
      timeoutMs: 100,
    });
    expect(allowed.entities.map((entity) => entity.id)).toEqual(["entity-root", "entity-allowed"]);
    expect(allowed.relations.map((relation) => relation.id)).toEqual(["relation-allowed"]);
    expect(allowed.truncated).toBe(false);
  });

  it("merges entity and relation provenance and permission fields as stable sets", async () => {
    const graph = createRepository();
    await graph.upsertEntities([
      graphEntity({
        aliases: ["Acme", "ACME"],
        permissionScope: ["tenant-1"],
        sourceNodeIds: ["node-1"],
      }),
    ]);
    const [entity] = await graph.upsertEntities([
      graphEntity({
        aliases: ["ACME", "Acme Corp"],
        id: "entity-new-id",
        permissionScope: ["secret", "tenant-1"],
        sourceNodeIds: ["node-2", "node-1"],
      }),
    ]);
    await graph.upsertRelations([
      graphRelation({ permissionScope: ["tenant-1"], sourceNodeIds: ["node-1"] }),
    ]);
    const [relation] = await graph.upsertRelations([
      graphRelation({
        id: "relation-new-id",
        permissionScope: ["secret", "tenant-1"],
        sourceNodeIds: ["node-2", "node-1"],
      }),
    ]);

    expect(entity).toMatchObject({
      aliases: ["Acme", "ACME", "Acme Corp"],
      id: "entity-1",
      permissionScope: ["tenant-1", "secret"],
      sourceNodeIds: ["node-1", "node-2"],
    });
    expect(relation).toMatchObject({
      id: "relation-1",
      permissionScope: ["tenant-1", "secret"],
      sourceNodeIds: ["node-1", "node-2"],
    });
  });
});

describe("database graph index repository coverage", () => {
  it("rejects the reserved legacy generation sentinel returned by the database", async () => {
    const graph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({
        executor: async () => ({
          rows: [
            graphEntityRow(
              graphEntity({
                publicationGenerationId: PUBLICATION_GENERATION_ID_SENTINEL,
              }),
            ),
          ],
          rowsAffected: 0,
        }),
        kind: "postgres",
      }),
      maxBatchSize: 5,
    });

    await expect(graph.listEntities({ knowledgeSpaceId: "space-1", limit: 5 })).rejects.toThrow(
      "Publication generation ID must be a non-zero UUID",
    );
  });

  it("uses deduplicating set unions for PostgreSQL graph provenance upserts", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const graph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);

          return { rows: [], rowsAffected: 1 };
        },
        kind: "postgres",
      }),
      maxBatchSize: 5,
    });

    await graph.upsertEntities([graphEntity()]);
    await graph.upsertRelations([graphRelation()]);

    expect(calls[0]?.sql).toContain('"aliases" = (SELECT COALESCE(jsonb_agg');
    expect(calls[0]?.sql).toContain('"source_node_ids" = (SELECT COALESCE(jsonb_agg');
    expect(calls[0]?.sql).toContain('"permission_scope" = (SELECT COALESCE(jsonb_agg');
    expect(calls[0]?.sql).toContain("SELECT DISTINCT value");
    expect(calls[1]?.sql).toContain('"source_node_ids" = (SELECT COALESCE(jsonb_agg');
    expect(calls[1]?.sql).toContain('"permission_scope" = (SELECT COALESCE(jsonb_agg');
  });

  it.each(["postgres", "tidb"] as const)(
    "pushes permission filters into %s traversal SQL before fanout and limits",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const graph = createDatabaseGraphIndexRepository({
        database: createSchemaDatabaseAdapter({
          executor: async (input) => {
            calls.push(input);

            return { rows: [], rowsAffected: 0 };
          },
          kind,
        }),
        maxBatchSize: 5,
      });

      await graph.traverse({
        fanout: 1,
        knowledgeSpaceId: "space-1",
        maxDepth: 1,
        maxNodes: 2,
        permissionScope: ["tenant-1", "role:auditor"],
        startEntityId: "entity-root",
        timeoutMs: 100,
      });

      const [call] = calls;
      expect(call?.params).toContain('["tenant-1","role:auditor"]');
      expect(call?.params).toHaveLength(kind === "postgres" ? 6 : 10);
      expect(call?.sql).toContain("candidate_entity");
      expect(call?.sql).toContain("permission_scope");
      if (kind === "postgres") {
        expect(call?.sql).toContain("jsonb_array_length");
        expect(call?.sql).toContain("<@ $6::jsonb");
      } else {
        expect(call?.sql).toContain("JSON_CONTAINS(CAST(? AS JSON)");
      }
    },
  );

  it("fails closed when TiDB resolves duplicate graph logical rows", async () => {
    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80";
    const entity = graphEntity({ publicationGenerationId });
    const relation = graphRelation({ publicationGenerationId });
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      if (input.operation === "select") {
        const row =
          input.tableName === "graph_entities"
            ? graphEntityRow(entity)
            : graphRelationRow(relation);

        return { rows: [row, { ...row }], rowsAffected: 0 };
      }

      return { rows: [], rowsAffected: 1 };
    };
    const graph = createDatabaseGraphIndexRepository({
      database: transactionalDatabase("tidb", executor),
      maxBatchSize: 5,
    });

    await expect(graph.upsertEntities([entity])).rejects.toThrow(
      "Graph entity upsert resolved multiple persisted logical rows",
    );
    await expect(graph.upsertRelations([relation])).rejects.toThrow(
      "Graph relation upsert resolved multiple persisted logical rows",
    );
  });

  it("fails closed when TiDB returns a graph row from another space or generation", async () => {
    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c80";
    const otherGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81";
    const entity = graphEntity({ publicationGenerationId });
    const relation = graphRelation({ publicationGenerationId });
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      if (input.operation !== "select") {
        return { rows: [], rowsAffected: 1 };
      }

      return input.tableName === "graph_entities"
        ? {
            rows: [graphEntityRow({ ...entity, knowledgeSpaceId: "space-other" })],
            rowsAffected: 0,
          }
        : {
            rows: [
              graphRelationRow({
                ...relation,
                publicationGenerationId: otherGenerationId,
              }),
            ],
            rowsAffected: 0,
          };
    };
    const graph = createDatabaseGraphIndexRepository({
      database: transactionalDatabase("tidb", executor),
      maxBatchSize: 5,
    });

    await expect(graph.upsertEntities([entity])).rejects.toThrow(
      "Graph entity upsert resolved a mismatched persisted logical row",
    );
    await expect(graph.upsertRelations([relation])).rejects.toThrow(
      "Graph relation upsert resolved a mismatched persisted logical row",
    );
  });

  it("fails closed when TiDB cannot read an upserted logical row", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return { rows: [], rowsAffected: input.params.length };
    };
    const graph = createDatabaseGraphIndexRepository({
      database: createSchemaDatabaseAdapter({ executor, kind: "tidb" }),
      maxBatchSize: 5,
    });

    await expect(graph.upsertEntities([graphEntity()])).rejects.toThrow(
      "Graph entity upsert did not persist its logical row",
    );
    await expect(graph.upsertRelations([graphRelation()])).rejects.toThrow(
      "Graph relation upsert did not persist its logical row",
    );

    expect(calls.map((call) => call.operation)).toEqual(["insert", "select", "insert", "select"]);
    expect(calls[0]?.sql).toContain("JSON_TABLE");
    expect(calls[0]?.sql).toContain(" UNION SELECT ");
    expect(calls[0]?.sql).not.toContain("JSON_MERGE_PRESERVE");
    expect(calls[1]?.sql).toContain("`publication_generation_id` <=> ?");
    expect(calls[3]?.sql).toContain("`publication_generation_id` <=> ?");
  });
});
