import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput } from "@knowledge/core";
import type { RerankerProvider } from "@knowledge/embeddings";
import { describe, expect, it } from "vitest";

import {
  createBasicHybridRetriever,
  createDatabaseHybridRetrievalRepository,
} from "./hybrid-retrieval";
import type { HybridRetrievalRepository, RetrievalCandidate } from "./retrieval-candidates";
import { createRetrievalPlanner } from "./retrieval-planner";

const publishedFingerprint =
  "projection-set-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const candidateFingerprint =
  "projection-set-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const publicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const memberProjectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const nonMemberProjectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const tenantId = "tenant-1";

describe("createBasicHybridRetriever projection set filtering", () => {
  it("passes one fixed publication id to both legs and defense-filters leaked non-members", async () => {
    const denseInputs: Parameters<HybridRetrievalRepository["searchDense"]>[0][] = [];
    const ftsInputs: Parameters<HybridRetrievalRepository["searchFts"]>[0][] = [];
    const repository: HybridRetrievalRepository = {
      searchDense: async (input) => {
        denseInputs.push(input);
        return [
          candidate({ projectionId: memberProjectionId }),
          candidate({
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03",
            projectionId: nonMemberProjectionId,
          }),
        ];
      },
      searchFts: async (input) => {
        ftsInputs.push(input);
        return [
          candidate({
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04",
            projectionId: nonMemberProjectionId,
            source: "fts",
          }),
        ];
      },
    };
    const membershipInputs: unknown[] = [];
    const retriever = createBasicHybridRetriever({
      publishedProjectionMembership: {
        filterComponentKeys: async (input) => {
          membershipInputs.push(input);
          return [memberProjectionId];
        },
      },
      repository,
      strictPublishedReads: true,
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId,
      limit: 10,
      permissionScope: [],
      projectionSnapshot: {
        fingerprint: publishedFingerprint,
        headRevision: 7,
        knowledgeSpaceId,
        projectionVersion: 3,
        publicationId,
        tenantId,
      },
      query: "policy",
      queryVector: [0.1],
      tenantId,
      topK: 10,
    });

    expect(denseInputs[0]).toMatchObject({ projectionSetPublicationId: publicationId, tenantId });
    expect(ftsInputs[0]).toMatchObject({ projectionSetPublicationId: publicationId, tenantId });
    expect(membershipInputs).toEqual([
      {
        componentKeys: [memberProjectionId, nonMemberProjectionId],
        componentType: "index-projection",
        knowledgeSpaceId,
        publicationId,
        tenantId,
      },
    ]);
    expect(result.items.map((item) => item.projectionIds)).toEqual([[memberProjectionId]]);
    expect(result.metrics).toMatchObject({ projectionFilteredCandidates: 2 });
  });

  it("fails closed when a fixed snapshot has neither repository enforcement nor a checker", async () => {
    let searches = 0;
    const retriever = createBasicHybridRetriever({
      repository: {
        searchDense: async () => {
          searches += 1;
          return [];
        },
        searchFts: async () => {
          searches += 1;
          return [];
        },
      },
    });

    await expect(
      retriever.retrieve({
        knowledgeSpaceId,
        limit: 1,
        projectionSnapshot: {
          fingerprint: publishedFingerprint,
          headRevision: 1,
          knowledgeSpaceId,
          projectionVersion: 1,
          publicationId,
          tenantId,
        },
        query: "policy",
        queryVector: [0.1],
        tenantId,
        topK: 1,
      }),
    ).rejects.toThrow("requires authoritative repository filtering or a membership checker");
    expect(searches).toBe(0);

    await expect(
      createBasicHybridRetriever({
        repository: retrievalRepository([]),
        strictPublishedReads: true,
      }).retrieve({
        knowledgeSpaceId,
        limit: 1,
        query: "policy",
        queryVector: [0.1],
        tenantId,
        topK: 1,
      }),
    ).rejects.toThrow("requires a published projection snapshot");
  });

  it.each(["postgres", "tidb"] as const)(
    "joins every %s database leg to the fixed published index-projection members",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createDatabaseHybridRetrievalRepository({
        database: createSchemaDatabaseAdapter({
          executor: async (input) => {
            calls.push(input);
            return { rows: [], rowsAffected: 0 };
          },
          kind,
        }),
        maxTopK: 10,
        requirePublishedSnapshot: true,
      });
      const scope = {
        knowledgeSpaceId,
        permissionScope: [] as string[],
        projectionSetPublicationId: publicationId,
        tenantId,
        topK: 2,
      };

      await repository.searchDense({
        ...scope,
        denseProjectionModel: "space-model@1",
        // Published reads force ready even if an evaluation-only status leaks into the call.
        denseProjectionStatuses: ["building"],
        queryVector: [0.1, 0.2],
      });
      await repository.searchFts({ ...scope, query: "policy" });
      await repository.searchVisualDense?.({
        ...scope,
        denseProjectionModel: "visual-space@1",
        queryVector: [0.3, 0.4],
      });

      expect(calls).toHaveLength(3);
      for (const call of calls) {
        expect(call.sql).toContain("projection_set_publication_members");
        expect(call.sql).toContain("projection_set_publications");
        expect(call.sql).toContain("IN ('published', 'superseded')");
        expect(call.sql).toContain("component_type");
        expect(call.sql).toContain("'index-projection'");
        expect(call.sql).toContain("component_key");
        expect(call.sql).toContain("publication_generation_id");
        expect(call.sql).toContain("generation_id");
        expect(call.sql).toContain("lifecycle_state");
        expect(call.sql).toContain("'active'");
        expect(call.sql).toContain("parent_source");
        expect(call.sql).toContain("sources");
        expect(call.sql).toContain("<> 'deleting'");
        expect(call.sql).toContain("deletion_job_id");
        expect(call.sql).toContain(
          kind === "postgres"
            ? 'pm."document_asset_id" = n."document_asset_id"'
            : "pm.`document_asset_id` = n.`document_asset_id`",
        );
        expect(call.sql).toContain(
          kind === "postgres"
            ? 'n."publication_generation_id" IS NOT DISTINCT FROM p."publication_generation_id"'
            : "n.`publication_generation_id` <=> p.`publication_generation_id`",
        );
        expect(call.sql).not.toContain("projectionSetFingerprint");
        expect(call.params).toContain(tenantId);
        expect(call.params).toContain(publicationId);
      }
      expect(calls[0]?.sql).toContain(
        `${kind === "postgres" ? 'p."status"' : "p.`status`"} = 'ready'`,
      );
      expect(calls[0]?.params).not.toContain("building");
      if (kind === "tidb") {
        const ftsSql = calls[1]?.sql ?? "";
        expect(ftsSql).toContain("index_projection_fts_postings");
        expect(ftsSql).toContain("bounded_pub");
        expect(ftsSql).toContain("bounded_pm");
        expect(ftsSql.indexOf("bounded_pm")).toBeLessThan(ftsSql.indexOf("GROUP BY"));
        expect(ftsSql.indexOf("GROUP BY")).toBeLessThan(ftsSql.lastIndexOf("LIMIT"));
        expect(ftsSql).not.toContain("INSTR(");
        expect(ftsSql).not.toContain("LIKE");
        expect(calls[1]?.sql).not.toContain("FTS_MATCH_WORD");
        expect(ftsSql.match(/\?/gu)?.length).toBe(calls[1]?.params.length);
      }

      await expect(
        repository.searchFts({ knowledgeSpaceId, query: "policy", tenantId, topK: 1 }),
      ).rejects.toThrow("requires a published projection snapshot");

      await expect(
        repository.searchFts({
          knowledgeSpaceId,
          projectionSetPublicationId: publicationId,
          query: "policy",
          tenantId,
          topK: 1,
        }),
      ).rejects.toThrow("requires a server-issued permission scope");
    },
  );

  it("uses the published projection set fingerprint unless preview mode allows a candidate", async () => {
    const repository = retrievalRepository([
      candidate({
        metadata: { projectionSetFingerprint: publishedFingerprint },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
        projectionId: "published-projection",
      }),
      candidate({
        metadata: { projectionSetFingerprint: candidateFingerprint },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
        projectionId: "candidate-projection",
      }),
    ]);
    const retriever = createBasicHybridRetriever({ repository });

    const published = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 10,
      projectionSetCandidateFingerprint: candidateFingerprint,
      projectionSetFingerprint: publishedFingerprint,
      query: "policy",
      queryVector: [0.1],
      topK: 10,
    });

    expect(published.items.map((item) => item.projectionIds)).toEqual([["published-projection"]]);
    expect(published.metrics).toMatchObject({ projectionFilteredCandidates: 1 });

    const preview = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 10,
      projectionSetCandidateFingerprint: candidateFingerprint,
      projectionSetFingerprint: publishedFingerprint,
      projectionSetReadMode: "preview",
      query: "policy",
      queryVector: [0.1],
      topK: 10,
    });

    expect(preview.items.map((item) => item.projectionIds)).toEqual([
      ["published-projection"],
      ["candidate-projection"],
    ]);
    expect(preview.metrics?.projectionFilteredCandidates).toBeUndefined();
  });

  it("reports multimodal and visual embedding projection candidate counts", async () => {
    const repository = retrievalRepository([
      candidate({
        metadata: {
          multimodal: {
            modality: "image",
            projectionRole: "visual-asset",
            visualEmbeddingStatus: "provided",
          },
        },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03",
        projectionId: "visual-projection",
      }),
      candidate({
        metadata: {
          multimodal: {
            modality: "table",
            projectionRole: "textual-surrogate",
            visualEmbeddingStatus: "missing",
          },
        },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04",
        projectionId: "table-projection",
      }),
      candidate({
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d05",
        projectionId: "plain-projection",
      }),
    ]);
    const retriever = createBasicHybridRetriever({ repository });

    const result = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 10,
      query: "figure",
      queryVector: [0.1],
      topK: 10,
    });

    expect(result.items.map((item) => item.projectionIds)).toContainEqual(["visual-projection"]);
    expect(result.metrics).toMatchObject({
      multimodalCandidates: 2,
      visualEmbeddingCandidates: 1,
    });
  });

  it("keeps the planned Fast candidate pool for reranking without a fusion runtime", async () => {
    const candidates = [
      candidate({ nodeId: "node-1", projectionId: "projection-1" }),
      candidate({ nodeId: "node-2", projectionId: "projection-2" }),
      candidate({ nodeId: "node-3", projectionId: "projection-3" }),
    ];
    const rerankCalls: string[][] = [];
    const reranker: RerankerProvider = {
      kind: "static",
      models: async () => [],
      rerank: async (input) => {
        rerankCalls.push(input.documents.map((document) => document.id));
        return {
          items: input.documents.map((document, index) => ({
            document: {
              ...document,
              metadata: { ...(document.metadata ?? {}) },
            },
            index,
            score: 1 - index / 10,
          })),
          metadata: { model: input.model, provider: "static" },
          model: input.model,
        };
      },
    };
    const retriever = createBasicHybridRetriever({
      planner: createRetrievalPlanner({ maxTopK: 10 }),
      repository: retrievalRepository(candidates),
      reranker,
      rerankerModel: "rerank-model",
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 1,
      mode: "fast",
      query: "policy",
      queryVector: [0.1],
      topK: 3,
    });

    expect(rerankCalls).toEqual([["node-1", "node-2", "node-3"]]);
    expect(result.items).toHaveLength(1);
    expect(result.metrics).toMatchObject({ rerankCandidates: 3 });
  });

  it("binds candidate model, status, and version filters before evaluation topK", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const repository = createDatabaseHybridRetrievalRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return { rows: [], rowsAffected: 0 };
        },
        kind: "postgres",
      }),
      maxTopK: 10,
    });

    await repository.searchDense({
      denseProjectionModel: "candidate@2",
      denseProjectionStatuses: ["building"],
      denseProjectionVersion: 2,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      queryVector: [0.1, 0.2],
      topK: 1,
    });

    expect(calls[0]?.params).toEqual([
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      "[0.1,0.2]",
      2,
      "building",
      "candidate@2",
      2,
      1,
    ]);
    expect(calls[0]?.sql).toContain('vector_dims(p."dense_vector") = $3');
    expect(calls[0]?.sql).toContain('p."model" = $5');
    expect(calls[0]?.sql).toContain('p."projection_version" = $6');
  });
});

function retrievalRepository(candidates: readonly RetrievalCandidate[]): HybridRetrievalRepository {
  return {
    searchDense: async () => candidates.map((candidate) => ({ ...candidate, source: "dense" })),
    searchFts: async () => [],
  };
}

function candidate(overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      documentVersion: 1,
      sectionPath: ["Policy"],
    },
    metadata: {},
    nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    permissionScope: [],
    projectionId: "projection",
    score: 1,
    source: "dense",
    ...overrides,
  };
}
