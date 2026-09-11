import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput } from "@knowledge/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabaseSchema, renderCreateTableSql } from "../../database/src/schema";
import { createDatabaseGraphQueryRepository } from "./graph-query-database-repository";
import { executeGraphQueryPaths } from "./graph-query-executor";
import {
  graphEmbeddingProfile,
  graphEntity,
  graphId,
  graphPlan,
  graphRelation,
  graphScope,
} from "./graph-query.fixtures";
import { createDatabaseGraphSemanticProjectionRepository } from "./graph-semantic-index";

const migration = readFileSync(
  new URL(
    "../../database/migrations/0054_graph_semantic_projections.postgres.sql",
    import.meta.url,
  ),
  "utf8",
);
const tableNames = [
  "knowledge_spaces",
  "projection_set_publications",
  "projection_set_publication_members",
  "document_semantic_enrichment_jobs",
  "index_projections",
  "knowledge_nodes",
  "document_assets",
  "sources",
  "logical_documents",
  "document_revisions",
  "graph_entities",
  "graph_relations",
];
function adapter(pg: PGlite) {
  const executeWith = async (executor: Pick<PGlite, "query">, input: DatabaseExecuteInput) => {
    const result = await executor.query(input.sql, [...input.params]);
    return {
      rows: (result.rows as Record<string, unknown>[]).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            value instanceof Date ? value.toISOString() : value,
          ]),
        ),
      ),
      rowsAffected: result.affectedRows ?? result.rows.length,
    };
  };
  return createSchemaDatabaseAdapter({
    kind: "postgres",
    executor: (input) => executeWith(pg, input),
    transaction: (callback) =>
      pg.transaction((tx) => callback({ execute: (input) => executeWith(tx, input) })),
  });
}

describe("graph queries against PostgreSQL + pgvector (in-memory, no external database)", () => {
  let pg: PGlite;
  let repository: ReturnType<typeof createDatabaseGraphQueryRepository>;
  const input = {
    ...graphScope,
    query: "Who depends on Service 10?",
    queryVector: [1, 0],
    vectorSpaceId: graphEmbeddingProfile.vectorSpaceId,
    limit: 10,
  };
  const insert = async (table: string, row: Record<string, unknown>) => {
    const columns = Object.keys(row).map((key) =>
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
    );
    await pg.query(
      `INSERT INTO "${table}" (${columns.map((name) => `"${name}"`).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")});`,
      Object.values(row).map((value) =>
        typeof value === "object" && value !== null ? JSON.stringify(value) : value,
      ),
    );
  };
  beforeAll(async () => {
    pg = new PGlite({ extensions: { vector } });
    await pg.exec("CREATE EXTENSION vector;");
    // Keep the real column types. Relax unrelated domain constraints only in the synthetic fixture;
    // the projection migration itself, including owner-cascade constraints, runs unchanged.
    for (const name of tableNames) {
      const table = getDatabaseSchema().tables.find((table) => table.name === name);
      assert(table);
      await pg.exec(
        renderCreateTableSql("postgres", {
          ...table,
          columns: table.columns.map((column) => ({ ...column, nullable: true })),
          foreignKeys: [],
          checkConstraints: [],
        }),
      );
    }
    await pg.exec(migration);
    await pg.exec(migration);
    await insert("knowledge_spaces", {
      id: graphId(1),
      tenantId: "tenant-graph",
      lifecycleState: "active",
    });
    await insert("projection_set_publications", {
      id: graphId(2),
      tenantId: "tenant-graph",
      knowledgeSpaceId: graphId(1),
      fingerprint: graphScope.snapshot.fingerprint,
      status: "published",
    });
    await insert("document_assets", {
      id: graphId(1000),
      knowledgeSpaceId: graphId(1),
      parserStatus: "parsed",
      lifecycleState: "active",
      metadata: { permissionScope: ["team:read"] },
    });
    await insert("logical_documents", {
      id: graphId(1001),
      tenantId: "tenant-graph",
      knowledgeSpaceId: graphId(1),
      enabled: true,
      status: "ready",
      activeRevision: 1,
    });
    await insert("document_revisions", {
      tenantId: "tenant-graph",
      knowledgeSpaceId: graphId(1),
      documentId: graphId(1001),
      revision: 1,
      documentAssetId: graphId(1000),
    });
    await insert("projection_set_publication_members", {
      publicationId: graphId(2),
      tenantId: "tenant-graph",
      knowledgeSpaceId: graphId(1),
      componentType: "document-outline",
      componentKey: graphId(1003),
      generationId: graphId(3),
      documentAssetId: graphId(1000),
    });
    for (const n of [10, 11, 12]) {
      await insert("knowledge_nodes", {
        id: graphId(n + 100),
        knowledgeSpaceId: graphId(1),
        publicationGenerationId: graphId(3),
        documentAssetId: graphId(1000),
        permissionScope: ["team:read"],
        metadata: {},
        text: `Service ${n}`,
      });
      await insert("index_projections", {
        id: graphId(n + 200),
        knowledgeSpaceId: graphId(1),
        publicationGenerationId: graphId(3),
        nodeId: graphId(n + 100),
        status: "ready",
      });
      await insert("projection_set_publication_members", {
        publicationId: graphId(2),
        tenantId: "tenant-graph",
        knowledgeSpaceId: graphId(1),
        componentType: "index-projection",
        componentKey: graphId(n + 200),
        generationId: graphId(3),
        documentAssetId: graphId(1000),
      });
      await insert("graph_entities", { ...graphEntity(n) });
    }
    await insert("graph_relations", { ...graphRelation(20, 10, 11) });
    await insert("graph_relations", { ...graphRelation(21, 11, 12) });
    repository = createDatabaseGraphQueryRepository(adapter(pg));
  }, 30000);
  afterAll(async () => {
    await pg?.close();
  });

  it("compiles the queries against the relevant authoritative table definitions", async () => {
    const full = new PGlite({ extensions: { vector } });
    try {
      await full.exec("CREATE EXTENSION vector;");
      // Unrelated foreign keys can point forward in the snapshot catalog. The production migration
      // runner supplies their historical order; this syntax test needs the exact current columns.
      for (const table of getDatabaseSchema().tables.filter((table) =>
        tableNames.includes(table.name),
      )) {
        await full.exec(renderCreateTableSql("postgres", { ...table, foreignKeys: [] }));
      }
      await full.exec(migration);
      const empty = createDatabaseGraphQueryRepository(adapter(full));
      expect((await empty.search(input)).entities).toEqual([]);
      expect(await empty.loadEntities({ ...graphScope, ids: [graphId(10)] })).toEqual([]);
      const step = graphPlan.steps[0];
      assert(step);
      expect(
        (
          await empty.loadEdges({
            ...graphScope,
            frontier: [graphId(10)],
            step,
            fanout: 4,
          })
        ).edges,
      ).toEqual([]);
    } finally {
      await full.close();
    }
  }, 30000);
  it("finds lexical entities and directional Chinese predicate definitions before a backfill", async () => {
    const result = await repository.search({ ...input, query: "Service 10 依赖哪个服务" });
    expect(result.entities[0]?.id).toBe(graphId(10));
    expect(result.relations.map((relation) => relation.id)).toContain("depends_on");
    expect(result.semanticCoverage).toBe("missing");
    expect(
      (await executeGraphQueryPaths({ ...graphScope, repository, plan: graphPlan })).paths,
    ).toHaveLength(2);
  });
  it("writes vectors with a frozen profile, matches paraphrases, and excludes another vector space", async () => {
    const writer = createDatabaseGraphSemanticProjectionRepository(adapter(pg));
    await writer.put({
      tenantId: "tenant-graph",
      knowledgeSpaceId: graphId(1),
      publicationGenerationId: graphId(3),
      embeddingProfile: graphEmbeddingProfile,
      projections: [
        {
          kind: "entity",
          ownerId: graphId(12),
          vector: [1, 0],
          contentHash: "a".repeat(64),
          text: "Database backing service",
        },
        {
          kind: "relation",
          // The lowest-ID edge has no vector. Predicate deduplication must prefer a ready row.
          ownerId: graphId(21),
          vector: [1, 0],
          contentHash: "b".repeat(64),
          text: "A requires B",
        },
      ],
    });
    const result = await repository.search({ ...input, query: "backend dependency" });
    expect(result.entities[0]).toMatchObject({ id: graphId(12), matchedBy: ["vector"] });
    expect(result.relations[0]?.matchedBy).toContain("vector");
    expect(result.semanticCoverage).toBe("partial");
    const other = await repository.search({
      ...input,
      query: "unrelated",
      vectorSpaceId: `embedding-space-sha256:${"c".repeat(64)}`,
    });
    expect(other.entities).toEqual([]);
    expect(other.semanticCoverage).toBe("missing");
  });
  it("applies permissions, selected nodes, generation and deletion fences before candidates and paths", async () => {
    expect((await repository.search({ ...input, permissionScope: [] })).entities).toEqual([]);
    expect(
      (await repository.search({ ...input, snapshot: { ...input.snapshot, tenantId: "another" } }))
        .entities,
    ).toEqual([]);
    expect(
      (await repository.search({ ...input, filters: { nodeIds: [graphId(110)] } })).relations,
    ).toEqual([]);
    await pg.query("UPDATE graph_entities SET permission_scope = $1 WHERE id = $2", [
      JSON.stringify(["secret"]),
      graphId(11),
    ]);
    expect(
      (await executeGraphQueryPaths({ ...graphScope, repository, plan: graphPlan })).paths,
    ).toEqual([]);
    await pg.query("UPDATE graph_entities SET permission_scope = $1 WHERE id = $2", [
      JSON.stringify(["team:read"]),
      graphId(11),
    ]);
    await pg.query("UPDATE document_assets SET lifecycle_state = 'deleting'");
    expect((await repository.search(input)).entities).toEqual([]);
    await pg.query("UPDATE document_assets SET lifecycle_state = 'active'");
    await pg.query("UPDATE logical_documents SET enabled = false");
    expect((await repository.search(input)).entities).toEqual([]);
    await pg.query("UPDATE logical_documents SET enabled = true");
    await insert("sources", {
      id: graphId(1004),
      knowledgeSpaceId: graphId(1),
      status: "deleting",
    });
    await pg.query("UPDATE document_assets SET source_id = $1", [graphId(1004)]);
    expect((await repository.search(input)).entities).toEqual([]);
    await pg.query("UPDATE document_assets SET source_id = NULL");
    await insert("document_semantic_enrichment_jobs", {
      id: graphId(1005),
      tenantId: "tenant-graph",
      knowledgeSpaceId: graphId(1),
      documentAssetId: graphId(1000),
      publicationGenerationId: graphId(3),
      runState: "failed",
    });
    expect((await repository.search(input)).entities).toEqual([]);
    await pg.query("UPDATE document_semantic_enrichment_jobs SET run_state = 'succeeded'");
    await pg.query("UPDATE projection_set_publication_members SET generation_id = $1", [
      graphId(999),
    ]);
    expect((await repository.search(input)).entities).toEqual([]);
    await pg.query("UPDATE projection_set_publication_members SET generation_id = $1", [
      graphId(3),
    ]);
  });
  it("cascades projection deletion with the owner and rejects stale owner writes", async () => {
    await pg.query("DELETE FROM graph_entities WHERE id = $1", [graphId(12)]);
    expect((await pg.query("SELECT * FROM graph_entity_semantic_projections")).rows).toEqual([]);
    const writer = createDatabaseGraphSemanticProjectionRepository(adapter(pg));
    await expect(
      writer.put({
        tenantId: "tenant-graph",
        knowledgeSpaceId: graphId(1),
        publicationGenerationId: graphId(3),
        embeddingProfile: graphEmbeddingProfile,
        projections: [
          {
            kind: "entity",
            ownerId: graphId(12),
            vector: [1, 0],
            contentHash: "a".repeat(64),
            text: "stale",
          },
        ],
      }),
    ).rejects.toThrow("owner disappeared");
  });
});
