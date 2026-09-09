import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecutor, KnowledgeNode } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";
import { createDocumentModelBudget } from "./document-model-budget";
import { graphEmbeddingProfile, graphEntity, graphId, graphRelation } from "./graph-query.fixtures";
import {
  type GraphSemanticProjectionRepository,
  createDatabaseGraphSemanticProjectionRepository,
  createGraphSemanticIndexer,
} from "./graph-semantic-index";

const scope = {
  tenantId: "tenant-graph",
  knowledgeSpaceId: graphId(1),
  publicationGenerationId: graphId(3),
  embeddingProfile: graphEmbeddingProfile,
};
function fixture() {
  const hashes = new Map<string, string>();
  const repository: GraphSemanticProjectionRepository = {
    hashes: async () => hashes,
    put: vi.fn(async (input) => {
      for (const projection of input.projections)
        hashes.set(projection.ownerId, projection.contentHash);
    }),
  };
  const embed = vi.fn(async (input: { texts: readonly string[] }) => ({
    model: "embed",
    dense: input.texts.map(() => [1, 0]),
    metadata: { provider: "static" as const, model: "embed" },
  }));
  const embeddings = {
    resolve: vi.fn(async () => ({
      ...graphEmbeddingProfile,
      providerInstance: { embed, kind: "static" as const, models: async () => [] },
    })),
  };
  return { repository, embed, embeddings };
}
describe("graph semantic projection indexing", () => {
  it("shares the document token admission budget and does not call a provider after exhaustion", async () => {
    const { repository, embed, embeddings } = fixture();
    const modelBudget = createDocumentModelBudget({ maxRequests: 1, maxEstimatedTokens: 10000 });
    modelBudget.reserve({ stage: "semantic-chunking", itemCount: 1 });
    await expect(
      createGraphSemanticIndexer({ repository, embeddings }).index({
        ...scope,
        modelBudget,
        entities: [graphEntity(10)],
        relations: [],
        nodes: [],
      }),
    ).rejects.toThrow("request budget");
    expect(embed).not.toHaveBeenCalled();
  });
  it("batches requests, embeds duplicate predicates once and reuses immutable cached projections", async () => {
    const { repository, embed, embeddings } = fixture();
    const indexer = createGraphSemanticIndexer({ repository, embeddings, batchSize: 1 });
    const input = {
      ...scope,
      entities: [graphEntity(10, { aliases: ["别名"] })],
      relations: [graphRelation(20, 10, 11), graphRelation(21, 11, 12)],
      nodes: [
        {
          id: graphId(110),
          knowledgeSpaceId: graphId(1),
          publicationGenerationId: graphId(3),
          text: "Service context",
        } as KnowledgeNode,
      ],
    };
    expect(await indexer.index(input)).toEqual({ indexed: 3, reused: 0 });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[0]?.[0].texts[0]).toContain("别名");
    expect(embed.mock.calls[0]?.[0].texts[0]).toContain("Service context");
    expect(embed.mock.calls[1]?.[0].texts[0]).toContain("A requires B");
    expect(embeddings.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ profile: graphEmbeddingProfile, tenantId: scope.tenantId }),
    );
    expect(await indexer.index(input)).toEqual({ indexed: 0, reused: 3 });
    expect(embed).toHaveBeenCalledTimes(2);
  });
  it("fails before writing for wrong scopes, invalid vectors or model dimensions", async () => {
    const { repository, embed, embeddings } = fixture();
    const metrics = { record: vi.fn() };
    const indexer = createGraphSemanticIndexer({ repository, embeddings, metrics });
    const input = { ...scope, entities: [graphEntity(10)], relations: [], nodes: [] };
    await expect(
      indexer.index({ ...input, tenantId: "tenant-graph", knowledgeSpaceId: "other" }),
    ).rejects.toThrow("owner scope");
    embed.mockResolvedValue({
      model: "embed",
      dense: [[1, 0, 0]],
      metadata: { provider: "static", model: "embed" },
    });
    await expect(indexer.index(input)).rejects.toThrow();
    expect(repository.put).not.toHaveBeenCalled();
    expect(metrics.record).toHaveBeenCalledTimes(1);
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "graph-embedding", outcome: "failed" }),
    );
    await expect(
      indexer.index({ ...input, signal: AbortSignal.abort(new Error("canceled")) }),
    ).rejects.toThrow("canceled");
  });
  it.each(["postgres", "tidb"] as const)(
    "writes one batch per kind, locks owners and tolerates an idempotent no-op (%s)",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor: DatabaseExecutor["execute"] = async (input) => {
        calls.push(input);
        return {
          rows:
            input.tableName === "knowledge_spaces"
              ? [{ lifecycle_state: "active", deletion_job_id: null }]
              : input.operation === "select"
                ? [{ id: graphId(10) }, { id: graphId(11) }]
                : [],
          rowsAffected: 0,
        };
      };
      const database = createSchemaDatabaseAdapter({
        kind,
        executor,
        transaction: (callback) => callback({ execute: executor }),
      });
      await createDatabaseGraphSemanticProjectionRepository(database).put({
        ...scope,
        projections: [10, 11].map((id) => ({
          kind: "entity",
          ownerId: graphId(id),
          text: "entity",
          contentHash: "a".repeat(64),
          vector: [1, 0],
        })),
      });
      const inserts = calls.filter((call) => call.operation === "insert");
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.params).toHaveLength(20);
      expect(calls.find((call) => call.tableName === "graph_entities")?.sql).toMatch(
        /FOR (SHARE|UPDATE)/,
      );
    },
  );
});
