import assert from "node:assert/strict";
import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecutor } from "@knowledge/core";
import { describe, expect, it } from "vitest";
import {
  createDatabaseGraphQueryRepository,
  graphLexicalTerms,
} from "./graph-query-database-repository";
import { graphEmbeddingProfile, graphId, graphPlan, graphScope } from "./graph-query.fixtures";

describe.each(["postgres", "tidb"] as const)("graph semantic repository (%s)", (kind) => {
  it("scopes and bounds all three matching legs before ranking, counts actual index coverage", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor: DatabaseExecutor["execute"] = async (input) => {
      calls.push(input);
      if (input.operation === "schema") return { rows: [], rowsAffected: 0 };
      return {
        rows: [
          {
            id: graphId(10),
            name: "Service A",
            type: "product",
            leg: "exact",
            semantic_text: "A",
            total: 10,
            indexed: 5,
          },
          {
            id: graphId(11),
            name: "Service B",
            type: "product",
            leg: "vector",
            semantic_text: "B",
            total: 10,
            indexed: 5,
          },
        ],
        rowsAffected: 2,
      };
    };
    const database = createSchemaDatabaseAdapter({
      kind,
      executor,
      transaction: (callback) => callback({ execute: executor }),
    });
    const result = await createDatabaseGraphQueryRepository(database).search({
      ...graphScope,
      query: "谁依赖 Service A？",
      queryVector: [1, 0],
      vectorSpaceId: graphEmbeddingProfile.vectorSpaceId,
      limit: 10,
      filters: { nodeIds: [graphId(110)] },
    });
    expect(result.semanticCoverage).toBe("partial");
    expect(result.entities[0]?.matchedBy).toEqual(["exact"]);
    expect(result.entities[1]?.matchedBy).toEqual(["vector"]);
    const reads = calls.filter((call) => call.operation === "select");
    expect(reads).toHaveLength(2);
    for (const call of reads) {
      expect(call.params.slice(0, 4)).toEqual([
        graphScope.snapshot.tenantId,
        graphScope.snapshot.knowledgeSpaceId,
        graphScope.snapshot.publicationId,
        graphScope.snapshot.fingerprint,
      ]);
      expect(call.params).toContain(graphEmbeddingProfile.vectorSpaceId);
      expect(call.params).toContain(graphId(110));
      for (const part of [
        "authorized_nodes",
        "visible_generations",
        "document_semantic_enrichment_jobs",
        "source_node_ids",
        "logical_documents",
        "deletion_job_id",
        "representation_version",
        "dimension",
        "coverage",
        "ROW_NUMBER()",
      ])
        expect(call.sql).toContain(part);
      expect(call.sql.indexOf("authorized_nodes")).toBeLessThan(call.sql.indexOf("ranked AS"));
      if (call.sql.includes("graph_relation_semantic_projections")) {
        expect(call.sql).toContain("predicate_rank = 1");
        expect(call.sql.indexOf("predicate_rank = 1")).toBeLessThan(
          call.sql.indexOf(" AS vector_score"),
        );
      }
      if (kind === "postgres")
        expect(
          Math.max(...[...call.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))),
        ).toBe(call.params.length);
      else expect(call.sql.match(/\?/g)).toHaveLength(call.params.length);
    }
    if (kind === "postgres")
      expect(calls.some((call) => call.sql.includes("statement_timeout"))).toBe(true);
    else expect(reads[0]?.sql).toContain("MAX_EXECUTION_TIME(5000)");
  });
  it("bounds reverse fanout with one overflow row and cannot load arbitrary unbounded batches", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor: DatabaseExecutor["execute"] = async (input) => {
      calls.push(input);
      return { rows: [], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({
      kind,
      executor,
      transaction: (callback) => callback({ execute: executor }),
    });
    const repository = createDatabaseGraphQueryRepository(database);
    const step = graphPlan.steps[0];
    assert(step);
    await repository.loadEdges({
      ...graphScope,
      frontier: [graphId(10)],
      fanout: 4,
      step: { ...step, direction: "incoming" },
    });
    const read = calls.find((call) => call.operation === "select");
    assert(read);
    expect(read.sql).toMatch(/object_entity_id["`] IN/);
    expect(read.sql).toMatch(/subject_entity_id["`] AS to_entity_id/);
    expect(read.params.slice(-3)).toEqual([graphId(10), "depends_on", 5]);
    await expect(
      repository.loadEntities({
        ...graphScope,
        ids: Array.from({ length: 129 }, (_, n) => graphId(n)),
      }),
    ).rejects.toThrow("128");
  });
  it("rejects invalid vectors and bounds multilingual lexical work", async () => {
    const repository = createDatabaseGraphQueryRepository(createSchemaDatabaseAdapter({ kind }));
    await expect(
      repository.search({
        ...graphScope,
        query: "A",
        queryVector: [0, 0],
        vectorSpaceId: "v",
        limit: 1,
      }),
    ).rejects.toThrow("vector");
    expect(graphLexicalTerms("上下游服务依赖 Service A")).toContain("依赖");
    expect(graphLexicalTerms("超长查询".repeat(100)).length).toBeLessThanOrEqual(24);
  });
});
