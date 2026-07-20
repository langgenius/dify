import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type KnowledgeNode,
  KnowledgeNodeSchema,
  KnowledgePathSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type SemanticTopicClusterer,
  createDatabaseKnowledgePathRepository,
  createInMemoryKnowledgeNodeRepository,
  createInMemoryKnowledgePathRepository,
  createKnowledgeFsTopicViewMaterializer,
} from "./index";

function knowledgeNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    artifactHash: "b".repeat(64),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    endOffset: 24,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    kind: "summary",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: { summaryLevel: "document" },
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    permissionScope: ["tenant-1"],
    sourceLocation: { endOffset: 24, sectionPath: ["Guide"], startOffset: 0 },
    startOffset: 0,
    text: "Renewal risk summary.",
    ...overrides,
  });
}

class FakeJobQueue {
  readonly enqueued: unknown[] = [];

  async enqueue(input: unknown) {
    this.enqueued.push(input);

    return {
      attempts: 0,
      createdAt: 1_778_584_400_000,
      id: `topic-job-${this.enqueued.length}`,
      payload: {},
      runAfter: 1_778_584_400_000,
      status: "queued" as const,
      type: "knowledgefs.topic-view.materialize",
    };
  }
}

function createRecordingClusterer(): SemanticTopicClusterer & {
  readonly calls: Parameters<SemanticTopicClusterer["cluster"]>[0][];
} {
  const calls: Parameters<SemanticTopicClusterer["cluster"]>[0][] = [];

  return {
    calls,
    cluster: async (input) => {
      calls.push(input);

      return {
        topics: [
          {
            documentAssetIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f2c43"],
            metadata: { confidence: 0.91 },
            name: "Renewal Risk",
            slug: "renewal-risk",
          },
        ],
      };
    },
  };
}

describe("semantic view materialization", () => {
  it("enqueues and materializes by-topic semantic paths with bounded batched work", async () => {
    const jobs = new FakeJobQueue();
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxPaths: 4,
    });
    const clusterer = createRecordingClusterer();
    const summary = knowledgeNode();
    await nodes.createMany([summary]);
    const materializer = createKnowledgeFsTopicViewMaterializer({
      clusterer,
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
      jobs,
      maxDocumentsPerTopic: 2,
      maxSummaryNodes: 4,
      maxTopics: 2,
      nodes,
      now: () => "2026-05-12T12:00:00.000Z",
      paths,
    });

    await expect(
      materializer.enqueue({
        generatedVersion: "topic-view-v1",
        knowledgeSpaceId: summary.knowledgeSpaceId,
        summaryNodeIds: [summary.id],
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ id: "topic-job-1" });
    expect(jobs.enqueued).toEqual([
      {
        idempotencyKey: `knowledgefs.topic-view:${summary.knowledgeSpaceId}:topic-view-v1`,
        payload: {
          generatedVersion: "topic-view-v1",
          knowledgeSpaceId: summary.knowledgeSpaceId,
          summaryNodeIds: [summary.id],
          tenantId: "tenant-1",
        },
        type: "knowledgefs.topic-view.materialize",
      },
    ]);

    const result = await materializer.process({
      generatedVersion: "topic-view-v1",
      knowledgeSpaceId: summary.knowledgeSpaceId,
      summaryNodeIds: [summary.id],
      tenantId: "tenant-1",
    });

    expect(clusterer.calls).toHaveLength(1);
    expect(clusterer.calls[0]).toMatchObject({
      knowledgeSpaceId: summary.knowledgeSpaceId,
      maxDocumentsPerTopic: 2,
      maxTopics: 2,
      summaryNodes: [summary],
    });
    expect(result).toMatchObject({
      pathCount: 1,
      topics: [{ name: "Renewal Risk", slug: "renewal-risk" }],
    });
    await expect(
      paths.listSemanticDescendants({
        knowledgeSpaceId: summary.knowledgeSpaceId,
        limit: 2,
        parentPath: "/knowledge/by-topic",
        viewName: "by-topic",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          metadata: {
            confidence: 0.91,
            semanticView: {
              buildStatus: "ready",
              generatedAt: "2026-05-12T12:00:00.000Z",
              generatedVersion: "topic-view-v1",
              staleStatus: "fresh",
            },
            sourceSummaryNodeIds: [summary.id],
            topicName: "Renewal Risk",
            topicSlug: "renewal-risk",
          },
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          viewType: "semantic",
          virtualPath: "/knowledge/by-topic/renewal-risk/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        },
      ],
    });
  });

  it("rejects unbounded or invalid topic materialization work", async () => {
    const materializer = createKnowledgeFsTopicViewMaterializer({
      clusterer: createRecordingClusterer(),
      jobs: new FakeJobQueue(),
      maxDocumentsPerTopic: 1,
      maxSummaryNodes: 1,
      maxTopics: 1,
      nodes: createInMemoryKnowledgeNodeRepository({
        maxBatchSize: 2,
        maxListLimit: 2,
        maxNodes: 2,
      }),
      paths: createInMemoryKnowledgePathRepository({
        maxBatchSize: 2,
        maxListLimit: 2,
        maxPaths: 2,
      }),
    });

    await expect(
      materializer.enqueue({
        generatedVersion: " ",
        knowledgeSpaceId: "space-1",
        summaryNodeIds: ["node-1"],
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Topic view generatedVersion is required");
    await expect(
      materializer.process({
        generatedVersion: "topic-view-v1",
        knowledgeSpaceId: "space-1",
        summaryNodeIds: ["node-1", "node-2"],
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Topic view summaryNodeIds exceeds maxSummaryNodes=1");
    expect(() =>
      createKnowledgeFsTopicViewMaterializer({
        clusterer: createRecordingClusterer(),
        jobs: new FakeJobQueue(),
        maxDocumentsPerTopic: 1,
        maxSummaryNodes: 0,
        maxTopics: 1,
        nodes: createInMemoryKnowledgeNodeRepository({
          maxBatchSize: 1,
          maxListLimit: 1,
          maxNodes: 1,
        }),
        paths: createInMemoryKnowledgePathRepository({
          maxBatchSize: 1,
          maxListLimit: 1,
          maxPaths: 1,
        }),
      }),
    ).toThrow("Topic view maxSummaryNodes must be at least 1");
  });

  it("rejects missing nodes and invalid clusterer output before writing semantic paths", async () => {
    const summary = knowledgeNode();
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxNodes: 4,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxBatchSize: 4,
      maxListLimit: 4,
      maxPaths: 4,
    });

    const materializer = createKnowledgeFsTopicViewMaterializer({
      clusterer: {
        cluster: async () => ({
          topics: [
            {
              documentAssetIds: ["doc-1"],
              name: "Invalid Slug",
              slug: "Invalid Slug",
            },
          ],
        }),
      },
      jobs: new FakeJobQueue(),
      maxDocumentsPerTopic: 1,
      maxSummaryNodes: 2,
      maxTopics: 1,
      nodes,
      paths,
    });

    await expect(
      materializer.process({
        generatedVersion: "topic-view-v1",
        knowledgeSpaceId: summary.knowledgeSpaceId,
        summaryNodeIds: [summary.id],
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Topic view summary nodes are missing");

    await nodes.createMany([summary]);
    await expect(
      materializer.process({
        generatedVersion: "topic-view-v1",
        knowledgeSpaceId: summary.knowledgeSpaceId,
        summaryNodeIds: [summary.id],
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Topic view cluster name and slug are required");
    await expect(
      paths.listSemanticDescendants({
        knowledgeSpaceId: summary.knowledgeSpaceId,
        limit: 1,
        parentPath: "/knowledge/by-topic",
        viewName: "by-topic",
      }),
    ).resolves.toEqual({ items: [] });
  });

  it("rejects cluster output that exceeds topic and document bounds", async () => {
    const summary = knowledgeNode();
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    await nodes.createMany([summary]);
    const createMaterializer = (clusterer: SemanticTopicClusterer) =>
      createKnowledgeFsTopicViewMaterializer({
        clusterer,
        jobs: new FakeJobQueue(),
        maxDocumentsPerTopic: 1,
        maxSummaryNodes: 1,
        maxTopics: 1,
        nodes,
        paths: createInMemoryKnowledgePathRepository({
          maxBatchSize: 2,
          maxListLimit: 2,
          maxPaths: 2,
        }),
      });
    const input = {
      generatedVersion: "topic-view-v1",
      knowledgeSpaceId: summary.knowledgeSpaceId,
      summaryNodeIds: [summary.id],
      tenantId: "tenant-1",
    };

    await expect(
      createMaterializer({
        cluster: async () => ({
          topics: [
            { documentAssetIds: ["doc-1"], name: "A", slug: "a" },
            { documentAssetIds: ["doc-2"], name: "B", slug: "b" },
          ],
        }),
      }).process(input),
    ).rejects.toThrow("Topic view cluster count exceeds maxTopics=1");
    await expect(
      createMaterializer({
        cluster: async () => ({
          topics: [{ documentAssetIds: ["doc-1", "doc-2"], name: "A", slug: "a" }],
        }),
      }).process(input),
    ).rejects.toThrow("Topic view cluster documents exceed maxDocumentsPerTopic=1");
    await expect(
      createMaterializer({
        cluster: async () => ({
          topics: [{ documentAssetIds: ["bad/doc"], name: "A", slug: "a" }],
        }),
      }).process(input),
    ).rejects.toThrow("Topic view document asset ids must be path-safe strings");
  });

  it("allows empty bounded topic output without writing paths", async () => {
    const summary = knowledgeNode();
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    await nodes.createMany([summary]);
    const materializer = createKnowledgeFsTopicViewMaterializer({
      clusterer: { cluster: async () => ({ topics: [] }) },
      jobs: new FakeJobQueue(),
      maxDocumentsPerTopic: 1,
      maxSummaryNodes: 1,
      maxTopics: 1,
      nodes,
      paths: createInMemoryKnowledgePathRepository({
        maxBatchSize: 1,
        maxListLimit: 1,
        maxPaths: 1,
      }),
    });

    await expect(
      materializer.process({
        generatedVersion: "topic-view-v1",
        knowledgeSpaceId: summary.knowledgeSpaceId,
        summaryNodeIds: [summary.id],
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({ pathCount: 0, paths: [], topics: [] });
  });

  it("uses bounded knowledge path upsert semantics for replacements and capacity checks", async () => {
    const repository = createInMemoryKnowledgePathRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxPaths: 1,
    });
    const path = KnowledgePathSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { topicName: "Renewal Risk" },
      resourceType: "document",
      targetId: "doc-1",
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/renewal-risk/doc-1",
    });
    const replacement = KnowledgePathSchema.parse({
      ...path,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02",
      metadata: { topicName: "Renewal Risk", updated: true },
    });
    const persistedReplacement = KnowledgePathSchema.parse({ ...replacement, id: path.id });
    const extra = KnowledgePathSchema.parse({
      ...path,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03",
      virtualPath: "/knowledge/by-topic/renewal-risk/doc-2",
    });

    await expect(repository.upsertMany([path])).resolves.toEqual([path]);
    await expect(repository.upsertMany([replacement])).resolves.toEqual([persistedReplacement]);
    await expect(
      repository.get({
        knowledgeSpaceId: path.knowledgeSpaceId,
        virtualPath: path.virtualPath,
      }),
    ).resolves.toEqual(persistedReplacement);
    await expect(repository.upsertMany([extra])).rejects.toThrow(
      "Knowledge path repository maxPaths=1 exceeded",
    );
    await expect(repository.upsertMany([])).rejects.toThrow(
      "Knowledge path batch must contain at least 1 path",
    );
    expect(() =>
      createInMemoryKnowledgePathRepository({
        maxBatchSize: 0,
        maxListLimit: 1,
        maxPaths: 1,
      }),
    ).toThrow("Knowledge path repository maxBatchSize must be at least 1");
  });

  it("upserts semantic path batches with parameterized PostgreSQL and TiDB SQL", async () => {
    const path = KnowledgePathSchema.parse({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { semanticView: { buildStatus: "ready" } },
      resourceType: "document",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      viewName: "by-topic",
      viewType: "semantic",
      virtualPath: "/knowledge/by-topic/renewal-risk/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    });
    const postgresCalls: DatabaseExecuteInput[] = [];
    const tidbCalls: DatabaseExecuteInput[] = [];
    const executor =
      (calls: DatabaseExecuteInput[]) =>
      async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push({ ...input, params: [...input.params] });

        if (input.operation === "select") {
          return {
            rows: [
              {
                id: path.id,
                knowledge_space_id: path.knowledgeSpaceId,
                metadata: path.metadata,
                publication_generation_id: null,
                resource_type: path.resourceType,
                target_id: path.targetId,
                version: null,
                view_name: path.viewName,
                view_type: path.viewType,
                virtual_path: path.virtualPath,
              },
            ],
            rowsAffected: 1,
          };
        }

        return { rows: [], rowsAffected: 1 };
      };

    const postgresRepository = createDatabaseKnowledgePathRepository({
      database: createSchemaDatabaseAdapter({
        executor: executor(postgresCalls),
        kind: "postgres",
      }),
      maxBatchSize: 2,
      maxListLimit: 2,
    });
    const tidbRepository = createDatabaseKnowledgePathRepository({
      database: createSchemaDatabaseAdapter({ executor: executor(tidbCalls), kind: "tidb" }),
      maxBatchSize: 2,
      maxListLimit: 2,
    });

    await expect(postgresRepository.upsertMany([path])).resolves.toEqual([path]);
    await expect(tidbRepository.upsertMany([path])).resolves.toEqual([path]);
    expect(postgresCalls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        params: expect.arrayContaining([
          path.knowledgeSpaceId,
          path.virtualPath,
          JSON.stringify(path.metadata),
        ]),
        tableName: "knowledge_paths",
      }),
    );
    expect(postgresCalls[0]?.sql).toContain("ON CONFLICT");
    expect(postgresCalls[0]?.sql).not.toContain(path.virtualPath);
    expect(tidbCalls[0]?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(tidbCalls[0]?.sql).toContain("CAST(? AS JSON)");
  });
});
