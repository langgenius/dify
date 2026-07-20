import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
  IndexProjection,
} from "@knowledge/core";
import { IndexProjectionSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  GenerationScopedFtsPostingConflictError,
  IndexProjectionCapacityExceededError,
  createDatabaseIndexProjectionRepository,
  createInMemoryIndexProjectionRepository,
} from "./index-projection-repository";
import { createTidbFtsProjectionPostingPlans } from "./tidb-fts-postings";

function projection(index: number, overrides: Partial<IndexProjection> = {}): IndexProjection {
  const suffix = index.toString(16).padStart(12, "0");
  return IndexProjectionSchema.parse({
    id: `00000000-0000-4000-8000-${suffix}`,
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata: { denseVector: [0.1, 0.2], ftsText: "Policy renewal" },
    nodeId: `20000000-0000-4000-8000-${suffix}`,
    projectionVersion: 1,
    status: "ready",
    type: "dense-vector",
    ...overrides,
  });
}

function projectionRow(value: IndexProjection): DatabaseRow {
  return {
    id: value.id,
    knowledge_space_id: value.knowledgeSpaceId,
    metadata: JSON.stringify(value.metadata),
    model: value.model ?? null,
    node_id: value.nodeId,
    projection_version: value.projectionVersion,
    publication_generation_id: value.publicationGenerationId ?? null,
    status: value.status,
    type: value.type,
  };
}

describe("index projection repositories", () => {
  it("keeps identical logical projections isolated by publication generation", async () => {
    const repository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxProjections: 2,
    });
    const firstGeneration = "30000000-0000-4000-8000-000000000001";
    const secondGeneration = "30000000-0000-4000-8000-000000000002";
    const first = projection(1, {
      publicationGenerationId: firstGeneration,
      status: "building",
    });
    const second = projection(2, {
      nodeId: first.nodeId,
      publicationGenerationId: secondGeneration,
      status: "building",
    });

    await repository.createMany([first, second]);
    if (!repository.getMany) {
      throw new Error("expected getMany capability");
    }

    await expect(
      repository.getMany({
        ids: [first.id, second.id],
        knowledgeSpaceId: first.knowledgeSpaceId,
      }),
    ).resolves.toEqual([first, second]);
    await expect(
      repository.listReadyBySpace({
        knowledgeSpaceId: first.knowledgeSpaceId,
        limit: 2,
        publicationGenerationId: firstGeneration,
        type: first.type,
      }),
    ).resolves.toEqual({ items: [] });
    await expect(
      repository.listReadyBySpace({
        knowledgeSpaceId: first.knowledgeSpaceId,
        limit: 2,
        type: first.type,
      }),
    ).resolves.toEqual({ items: [] });
  });

  it("keeps the in-memory repository bounded, paginated, and clone isolated", async () => {
    const repository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 4,
      maxListLimit: 2,
      maxProjections: 3,
    });
    const created = await repository.createMany([
      projection(1),
      projection(2),
      projection(3, { status: "building" }),
    ]);
    const firstCreated = created[0];
    expect(firstCreated).toBeDefined();
    if (!firstCreated) {
      throw new Error("expected first projection");
    }
    firstCreated.metadata.denseVector = [9];

    const page = await repository.listReadyBySpace({
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
      limit: 1,
      type: "dense-vector",
    });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000001",
        metadata: { denseVector: [0.1, 0.2], ftsText: "Policy renewal" },
      }),
    ]);
    expect(page.nextCursor).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      nodeId: "20000000-0000-4000-8000-000000000001",
    });
    await expect(repository.createMany([projection(4)])).rejects.toBeInstanceOf(
      IndexProjectionCapacityExceededError,
    );
  });

  it("gets an exact bounded in-memory projection id set without crossing spaces", async () => {
    const repository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 3,
      maxListLimit: 3,
      maxProjections: 3,
    });
    const first = projection(1);
    const second = projection(2);
    const otherSpace = projection(3, {
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000002",
    });
    await repository.createMany([first, second, otherSpace]);
    if (!repository.getMany) {
      throw new Error("expected getMany capability");
    }

    await expect(
      repository.getMany({
        ids: [second.id, otherSpace.id, second.id],
        knowledgeSpaceId: first.knowledgeSpaceId,
      }),
    ).resolves.toEqual([second]);
    await expect(
      repository.getMany({
        ids: [first.id, second.id, otherSpace.id, projection(4).id],
        knowledgeSpaceId: first.knowledgeSpaceId,
      }),
    ).rejects.toThrow("maxBatchSize=3");
  });

  it("accepts only an exact replay of a generation-scoped logical projection", async () => {
    const repository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 2,
      maxListLimit: 2,
      maxProjections: 1,
    });
    const publicationGenerationId = "30000000-0000-4000-8000-000000000001";
    const original = projection(1, {
      model: "dense@1",
      publicationGenerationId,
      status: "building",
    });
    const retried = projection(2, {
      id: "00000000-0000-4000-8000-000000000002",
      metadata: { denseVector: [0.9, 0.8] },
      model: "dense@1",
      nodeId: original.nodeId,
      publicationGenerationId,
      status: "building",
    });

    await repository.createMany([original]);
    await expect(repository.createMany([original])).resolves.toEqual([original]);
    await expect(repository.createMany([retried])).rejects.toMatchObject({
      code: "GENERATION_SCOPED_COMPONENT_CONFLICT",
    });
    if (!repository.getMany) {
      throw new Error("expected getMany capability");
    }
    await expect(
      repository.getMany({ ids: [original.id], knowledgeSpaceId: original.knowledgeSpaceId }),
    ).resolves.toEqual([original]);
  });

  it.each(["postgres", "tidb"] as const)(
    "preserves immutable database identity during %s generation replay",
    async (kind) => {
      const fake = createIdentityPreservingIndexProjectionExecutor(kind === "postgres");
      const repository = createDatabaseIndexProjectionRepository({
        database: createSchemaDatabaseAdapter({
          executor: fake.executor,
          kind,
          transaction: async (callback) => callback({ execute: fake.executor }),
        }),
        maxBatchSize: 2,
        maxListLimit: 2,
      });
      const publicationGenerationId = "30000000-0000-4000-8000-000000000001";
      const original = projection(1, {
        model: "dense@1",
        publicationGenerationId,
        status: "building",
      });
      const retried = projection(2, {
        metadata: { denseVector: [0.9, 0.8] },
        model: "dense@1",
        nodeId: original.nodeId,
        publicationGenerationId,
        status: "building",
      });

      await repository.createMany([original]);
      await expect(repository.createMany([original])).resolves.toEqual([original]);
      await expect(repository.createMany([retried])).rejects.toMatchObject({
        code: "GENERATION_SCOPED_COMPONENT_CONFLICT",
      });

      const upsertSql = fake.calls.filter((call) => call.operation === "insert").at(-1)?.sql ?? "";
      const immutableColumns = [
        "id",
        "knowledge_space_id",
        "publication_generation_id",
        "node_id",
        "type",
        "model",
        "projection_version",
      ];
      for (const column of immutableColumns) {
        expect(upsertSql).not.toContain(`"${column}" = EXCLUDED."${column}"`);
        expect(upsertSql).not.toContain(`\`${column}\` = VALUES(\`${column}\`)`);
      }
      expect(upsertSql).toContain(
        kind === "postgres" ? "ON CONFLICT DO NOTHING" : "ON DUPLICATE KEY UPDATE `id` = `id`",
      );
    },
  );

  it("uses parameterized SQL and explicit read bounds for database pagination", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              knowledge_space_id: "10000000-0000-4000-8000-000000000001",
              metadata: { denseVector: [0.1] },
              model: null,
              node_id: "20000000-0000-4000-8000-000000000001",
              projection_version: 1,
              status: "ready",
              type: "dense-vector",
            },
          ],
          rowsAffected: 0,
        };
      },
      kind: "postgres",
    });
    const repository = createDatabaseIndexProjectionRepository({
      database,
      maxBatchSize: 3,
      maxListLimit: 2,
    });

    await repository.listReadyBySpace({
      cursor: { id: "cursor-id", nodeId: "node-cursor" },
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
      limit: 1,
      type: "dense-vector",
    });

    const call = calls[0];
    expect(call).toBeDefined();
    expect(call).toMatchObject({
      maxRows: 2,
      operation: "select",
      params: [
        "10000000-0000-4000-8000-000000000001",
        "dense-vector",
        "ready",
        "node-cursor",
        "cursor-id",
        2,
      ],
      tableName: "index_projections",
    });
    if (!call) {
      throw new Error("expected database call");
    }
    expect(call.sql).toContain("$1");
    expect(call.sql).not.toContain("10000000-0000-4000-8000-000000000001");
  });

  it.each(["postgres", "tidb"] as const)(
    "gets projection ids with a bounded %s query",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const expected = projection(1);
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return { rows: [projectionRow(expected)], rowsAffected: 1 };
        },
        kind,
      });
      const repository = createDatabaseIndexProjectionRepository({
        database,
        maxBatchSize: 2,
        maxListLimit: 2,
      });
      if (!repository.getMany) {
        throw new Error("expected getMany capability");
      }

      await expect(
        repository.getMany({
          ids: [expected.id, projection(2).id],
          knowledgeSpaceId: expected.knowledgeSpaceId,
        }),
      ).resolves.toEqual([expected]);
      expect(calls[0]).toMatchObject({
        maxRows: 2,
        operation: "select",
        params: [expected.knowledgeSpaceId, expected.id, projection(2).id],
        tableName: "index_projections",
      });
      expect(calls[0]?.sql).toContain(" IN (");
      expect(calls[0]?.sql).toContain("LIMIT 2");
    },
  );

  it("handles in-memory version lifecycle, pruning, and bounded deletes", async () => {
    const repository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 8,
      maxListLimit: 4,
      maxProjections: 8,
    });
    await repository.createMany([
      projection(1, { projectionVersion: 1, status: "ready" }),
      projection(2, { projectionVersion: 2, status: "building" }),
      projection(3, { projectionVersion: 3, status: "building" }),
      projection(4, { projectionVersion: 1, status: "failed" }),
    ]);

    await expect(
      repository.deleteByNodeIds({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        maxProjections: 0,
        nodeIds: ["20000000-0000-4000-8000-000000000001"],
      }),
    ).rejects.toThrow("maxProjections must be at least 1");
    expect(
      await repository.publishVersion({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        projectionVersion: 2,
        type: "dense-vector",
      }),
    ).toEqual({ published: 1, staled: 1 });
    expect(
      await repository.rollbackVersion({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        projectionVersion: 3,
        type: "dense-vector",
      }),
    ).toEqual({ failed: 1 });
    expect(
      await repository.summarizeVersion({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        projectionVersion: 2,
        type: "dense-vector",
      }),
    ).toEqual({ building: 0, failed: 0, ready: 1, stale: 0, total: 1 });
    expect(
      await repository.pruneInactiveVersions({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        maxProjections: 2,
        retainVersions: 1,
        type: "dense-vector",
      }),
    ).toBe(2);
    expect(
      await repository.deleteByNodeIds({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        maxProjections: 1,
        nodeIds: ["20000000-0000-4000-8000-000000000002"],
      }),
    ).toBe(1);
  });

  it("scopes in-memory maintenance to legacy or the requested publication generation", async () => {
    const repository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 16,
      maxListLimit: 4,
      maxProjections: 16,
    });
    const generationA = "30000000-0000-4000-8000-000000000001";
    const generationB = "30000000-0000-4000-8000-000000000002";
    await repository.createMany([
      projection(1, { projectionVersion: 1, status: "ready" }),
      projection(2, { projectionVersion: 2, status: "building" }),
      projection(3, { projectionVersion: 3, status: "building" }),
      projection(4, { projectionVersion: 1, status: "failed" }),
      projection(5, {
        projectionVersion: 1,
        publicationGenerationId: generationA,
        status: "building",
      }),
      projection(6, {
        projectionVersion: 2,
        publicationGenerationId: generationA,
        status: "building",
      }),
      projection(7, {
        projectionVersion: 3,
        publicationGenerationId: generationA,
        status: "building",
      }),
      projection(8, {
        projectionVersion: 1,
        publicationGenerationId: generationB,
        status: "building",
      }),
      projection(9, {
        projectionVersion: 2,
        publicationGenerationId: generationB,
        status: "building",
      }),
      projection(10, {
        projectionVersion: 3,
        publicationGenerationId: generationB,
        status: "building",
      }),
    ]);
    const baseVersionInput = {
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
      projectionVersion: 2,
      type: "dense-vector" as const,
    };

    await expect(repository.publishVersion(baseVersionInput)).resolves.toEqual({
      published: 1,
      staled: 1,
    });
    await expect(
      repository.publishVersion({ ...baseVersionInput, publicationGenerationId: generationA }),
    ).rejects.toMatchObject({
      code: "GENERATION_SCOPED_INDEX_PROJECTION_LIFECYCLE_CONFLICT",
    });
    await expect(
      repository.summarizeVersion({
        ...baseVersionInput,
        publicationGenerationId: generationB,
      }),
    ).resolves.toEqual({ building: 1, failed: 0, ready: 0, stale: 0, total: 1 });

    await expect(
      repository.rollbackVersion({ ...baseVersionInput, projectionVersion: 3 }),
    ).resolves.toEqual({ failed: 1 });
    await expect(
      repository.rollbackVersion({
        ...baseVersionInput,
        projectionVersion: 3,
        publicationGenerationId: generationA,
      }),
    ).resolves.toEqual({ failed: 1 });
    await expect(
      repository.rollbackVersion({
        ...baseVersionInput,
        projectionVersion: 1,
        publicationGenerationId: generationA,
      }),
    ).resolves.toEqual({ failed: 1 });
    await expect(
      repository.summarizeVersion({
        ...baseVersionInput,
        projectionVersion: 3,
        publicationGenerationId: generationB,
      }),
    ).resolves.toEqual({ building: 1, failed: 0, ready: 0, stale: 0, total: 1 });

    const basePruneInput = {
      knowledgeSpaceId: baseVersionInput.knowledgeSpaceId,
      maxProjections: 2,
      retainVersions: 1,
      type: baseVersionInput.type,
    };
    await expect(repository.pruneInactiveVersions(basePruneInput)).resolves.toBe(2);
    await expect(
      repository.pruneInactiveVersions({
        ...basePruneInput,
        publicationGenerationId: generationA,
      }),
    ).resolves.toBe(1);
    await expect(
      repository.summarizeVersion({
        ...baseVersionInput,
        projectionVersion: 1,
        publicationGenerationId: generationA,
      }),
    ).resolves.toEqual({ building: 0, failed: 0, ready: 0, stale: 0, total: 0 });
    await expect(
      repository.summarizeVersion({
        ...baseVersionInput,
        projectionVersion: 1,
        publicationGenerationId: generationB,
      }),
    ).resolves.toEqual({ building: 1, failed: 0, ready: 0, stale: 0, total: 1 });
  });

  it("deletes a removed node across every publication generation", async () => {
    const repository = createInMemoryIndexProjectionRepository({
      maxBatchSize: 3,
      maxListLimit: 3,
      maxProjections: 3,
    });
    const nodeId = "20000000-0000-4000-8000-000000000099";
    const generationA = "30000000-0000-4000-8000-000000000001";
    const generationB = "30000000-0000-4000-8000-000000000002";
    await repository.createMany([
      projection(1, { nodeId }),
      projection(2, { nodeId, publicationGenerationId: generationA, status: "building" }),
      projection(3, { nodeId, publicationGenerationId: generationB, status: "building" }),
    ]);
    await repository.rollbackVersion({
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
      projectionVersion: 1,
      publicationGenerationId: generationA,
      type: "dense-vector",
    });
    await repository.rollbackVersion({
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
      projectionVersion: 1,
      publicationGenerationId: generationB,
      type: "dense-vector",
    });

    await expect(
      repository.deleteByNodeIds({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        maxProjections: 3,
        nodeIds: [nodeId],
      }),
    ).resolves.toBe(3);

    for (const publicationGenerationId of [undefined, generationA, generationB]) {
      await expect(
        repository.listReadyBySpace({
          knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
          limit: 3,
          publicationGenerationId,
          type: "dense-vector",
        }),
      ).resolves.toEqual({ items: [] });
    }
  });

  it("writes database projection batches with dense and FTS parameters", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 2 };
      },
      kind: "postgres",
    });
    const repository = createDatabaseIndexProjectionRepository({
      database,
      maxBatchSize: 3,
      maxListLimit: 2,
    });

    const created = await repository.createMany([
      projection(1),
      projection(2, {
        metadata: { ftsText: "合同ABC-123续约 terms" },
        type: "fts",
      }),
    ]);

    expect(created).toHaveLength(2);
    const call = calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("expected database insert call");
    }
    expect(call.operation).toBe("insert");
    expect(call.maxRows).toBe(2);
    expect(call.params).toContain(JSON.stringify([0.1, 0.2]));
    expect(call.params).toContain("合 同 abc 123 续 约 terms");
  });

  it("atomically replaces legacy TiDB FTS postings after the mutable projection upsert", async () => {
    const calls: DatabaseExecuteInput[] = [];
    let transactions = 0;
    const fts = projection(1, {
      metadata: { ftsText: "Policy policy renewal" },
      type: "fts",
    });
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.operation === "select" && input.tableName === "index_projections") {
        return { rows: [projectionRow(fts)], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 1 };
    };
    const repository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({
        executor,
        kind: "tidb",
        transaction: async (callback) => {
          transactions += 1;
          return callback({ execute: executor });
        },
      }),
      maxBatchSize: 2,
      maxListLimit: 2,
    });

    await expect(repository.createMany([fts])).resolves.toEqual([fts]);

    expect(transactions).toBe(1);
    expect(calls.map((call) => [call.tableName, call.operation])).toEqual([
      ["index_projections", "insert"],
      ["index_projections", "select"],
      ["index_projection_fts_postings", "delete"],
      ["index_projection_fts_postings", "insert"],
    ]);
    const postingInsert = calls.at(-1);
    expect(postingInsert?.params).toContain("policy");
    expect(postingInsert?.params).toContain(2);
    expect(postingInsert?.params).toContain(3);
  });

  it("validates rather than repairs generation-scoped TiDB FTS postings on replay", async () => {
    const generationFts = projection(1, {
      metadata: { ftsText: "Policy policy renewal" },
      publicationGenerationId: "30000000-0000-4000-8000-000000000001",
      status: "building",
      type: "fts",
    });
    const plan = createTidbFtsProjectionPostingPlans([generationFts])[0];
    if (!plan) {
      throw new Error("expected FTS posting plan");
    }
    let returnPersistedPostings = true;
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.operation === "select" && input.tableName === "index_projections") {
        return { rows: [projectionRow(generationFts)], rowsAffected: 1 };
      }
      if (input.operation === "select" && input.tableName === "index_projection_fts_postings") {
        return {
          rows: returnPersistedPostings
            ? plan.postings.map((posting) => ({
                document_token_count: posting.documentTokenCount,
                knowledge_space_id: generationFts.knowledgeSpaceId,
                projection_id: generationFts.id,
                term: posting.term,
                term_frequency: posting.termFrequency,
                term_hash: posting.termHash,
                tokenizer_version: posting.tokenizerVersion,
              }))
            : [],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 0 };
    };
    const repository = createDatabaseIndexProjectionRepository({
      database: createSchemaDatabaseAdapter({
        executor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: executor }),
      }),
      maxBatchSize: 2,
      maxListLimit: 2,
    });

    await expect(repository.createMany([generationFts])).resolves.toEqual([generationFts]);
    expect(
      calls.filter(
        (call) => call.tableName === "index_projection_fts_postings" && call.operation !== "select",
      ),
    ).toEqual([]);

    returnPersistedPostings = false;
    await expect(repository.createMany([generationFts])).rejects.toBeInstanceOf(
      GenerationScopedFtsPostingConflictError,
    );
    expect(
      calls.filter(
        (call) => call.tableName === "index_projection_fts_postings" && call.operation !== "select",
      ),
    ).toEqual([]);
  });

  it("routes image-byte visual vectors to visual_vector and text vectors to dense_vector", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 2 };
      },
      kind: "postgres",
    });
    const repository = createDatabaseIndexProjectionRepository({
      database,
      maxBatchSize: 3,
      maxListLimit: 2,
    });

    await repository.createMany([
      // Text (or text-surrogate) dense projection → dense_vector column.
      projection(1, { metadata: { denseVector: [0.1, 0.2] } }),
      // Image-byte visual projection (separate vector space) → visual_vector column.
      projection(2, {
        metadata: { denseVector: [0.3, 0.4], multimodal: { vectorSpace: "visual" } },
      }),
    ]);

    // Columns per row: ..., dense_vector (index 8), visual_vector (index 9), fts_document, metadata.
    const params = calls[0]?.params ?? [];
    const columnsPerRow = 12;
    expect(params[8]).toBe(JSON.stringify([0.1, 0.2])); // text → dense_vector
    expect(params[9]).toBeNull(); // text → visual_vector null
    expect(params[8 + columnsPerRow]).toBeNull(); // visual → dense_vector null
    expect(params[9 + columnsPerRow]).toBe(JSON.stringify([0.3, 0.4])); // visual → visual_vector
  });

  it("uses bounded database delete/update/summarize commands", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const firstDeleted = projection(1);
    const secondDeleted = projection(2, { nodeId: firstDeleted.nodeId });
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.operation === "select" && input.sql.includes("FOR UPDATE")) {
        return {
          rows: [projectionRow(firstDeleted), projectionRow(secondDeleted)],
          rowsAffected: 0,
        };
      }
      if (input.operation === "select") {
        return {
          rows: [
            { count: "2", status: "ready" },
            { count: 1, status: "ignored" },
          ],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 2 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: executor }),
    });
    const repository = createDatabaseIndexProjectionRepository({
      database,
      maxBatchSize: 3,
      maxListLimit: 2,
    });

    expect(
      await repository.deleteByNodeIds({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        maxProjections: 5,
        nodeIds: ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"],
      }),
    ).toBe(2);
    expect(
      await repository.publishVersion({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        projectionVersion: 2,
        type: "dense-vector",
      }),
    ).toEqual({ published: 2, staled: 2 });
    expect(
      await repository.rollbackVersion({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        projectionVersion: 2,
        type: "dense-vector",
      }),
    ).toEqual({ failed: 2 });
    expect(
      await repository.summarizeVersion({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        projectionVersion: 2,
        type: "dense-vector",
      }),
    ).toEqual({ building: 0, failed: 0, ready: 2, stale: 0, total: 2 });
    expect(
      await repository.pruneInactiveVersions({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        maxProjections: 5,
        retainVersions: 1,
        type: "dense-vector",
      }),
    ).toBe(2);

    const deleteCalls = calls.filter((call) => call.operation === "delete");
    const deleteCall = deleteCalls[0];
    expect(deleteCall).toMatchObject({
      maxRows: 2,
      params: [firstDeleted.id, secondDeleted.id],
    });
    expect(deleteCall?.sql).not.toContain("publication_generation_id");
    expect(deleteCalls[1]).toMatchObject({
      maxRows: 5,
      params: ["10000000-0000-4000-8000-000000000001", "dense-vector", 1, 5],
    });
    expect(deleteCalls[1]?.sql).toContain('"publication_generation_id" IS NULL');
    const updateCalls = calls.filter((call) => call.operation === "update");
    expect(updateCalls).toHaveLength(3);
    for (const call of updateCalls) {
      expect(call.sql).toContain('"publication_generation_id" IS NULL');
    }
    const selectCall = calls.find(
      (call) => call.operation === "select" && call.sql.includes("GROUP BY"),
    );
    expect(selectCall).toMatchObject({ maxRows: 4 });
    expect(selectCall?.sql).toContain('"publication_generation_id" IS NULL');
  });

  it.each(["postgres", "tidb"] as const)(
    "scopes %s database maintenance to the requested publication generation",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (
          input.operation === "select" &&
          input.tableName === "projection_set_publication_members"
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        return input.operation === "select"
          ? { rows: [{ count: 1, status: "ready" }], rowsAffected: 0 }
          : { rows: [], rowsAffected: 1 };
      };
      const database = createSchemaDatabaseAdapter({
        executor,
        kind,
        transaction: async (callback) => callback({ execute: executor }),
      });
      const repository = createDatabaseIndexProjectionRepository({
        database,
        maxBatchSize: 3,
        maxListLimit: 2,
      });
      const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
      const publicationGenerationId = "30000000-0000-4000-8000-000000000001";
      const versionInput = {
        knowledgeSpaceId,
        projectionVersion: 2,
        publicationGenerationId,
        type: "dense-vector" as const,
      };

      await expect(repository.publishVersion(versionInput)).rejects.toMatchObject({
        code: "GENERATION_SCOPED_INDEX_PROJECTION_LIFECYCLE_CONFLICT",
      });
      await expect(repository.rollbackVersion(versionInput)).resolves.toEqual({ failed: 1 });
      await expect(repository.summarizeVersion(versionInput)).resolves.toEqual({
        building: 0,
        failed: 0,
        ready: 1,
        stale: 0,
        total: 1,
      });
      await expect(
        repository.pruneInactiveVersions({
          knowledgeSpaceId,
          maxProjections: 5,
          publicationGenerationId,
          retainVersions: 1,
          type: "dense-vector",
        }),
      ).resolves.toBe(1);

      const updateCalls = calls.filter((call) => call.operation === "update");
      expect(updateCalls).toHaveLength(1);
      for (const call of updateCalls) {
        expect(call.params.at(-1)).toBe(publicationGenerationId);
        expect(call.sql).toContain(
          kind === "postgres"
            ? '"publication_generation_id" = $6'
            : "`publication_generation_id` = ?",
        );
      }
      const selectCall = calls.find(
        (call) => call.operation === "select" && call.sql.includes("GROUP BY"),
      );
      expect(selectCall?.params).toEqual([
        knowledgeSpaceId,
        "dense-vector",
        2,
        publicationGenerationId,
      ]);
      expect(selectCall?.sql).toContain(
        kind === "postgres"
          ? '"publication_generation_id" = $4'
          : "`publication_generation_id` = ?",
      );
      const pruneCall = calls.find((call) => call.operation === "delete");
      expect(pruneCall?.params).toEqual([
        knowledgeSpaceId,
        "dense-vector",
        publicationGenerationId,
        1,
        5,
      ]);
      expect(pruneCall?.sql).toContain(
        kind === "postgres"
          ? '"publication_generation_id" = $3'
          : "`publication_generation_id` = ?",
      );
    },
  );
});

function createIdentityPreservingIndexProjectionExecutor(returnInsertRows: boolean): {
  readonly calls: DatabaseExecuteInput[];
  readonly executor: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>;
} {
  const calls: DatabaseExecuteInput[] = [];
  let stored: DatabaseRow | null = null;

  return {
    calls,
    executor: async (input) => {
      calls.push(input);

      if (input.operation === "insert") {
        const incoming = indexProjectionRowFromParams(input.params);
        const immutable =
          input.sql.includes("ON CONFLICT DO NOTHING") ||
          input.sql.includes("ON DUPLICATE KEY UPDATE `id` = `id`");
        stored = stored && immutable ? stored : stored ? { ...incoming, id: stored.id } : incoming;

        return {
          rows: returnInsertRows ? [stored] : [],
          rowsAffected: 1,
        };
      }

      if (input.operation === "select") {
        return {
          rows: stored ? [stored] : [],
          rowsAffected: stored ? 1 : 0,
        };
      }

      return { rows: [], rowsAffected: 0 };
    },
  };
}

function indexProjectionRowFromParams(params: readonly unknown[]): DatabaseRow {
  return {
    id: params[0],
    knowledge_space_id: params[1],
    metadata: params[11],
    model: params[6],
    node_id: params[3],
    projection_version: params[7],
    publication_generation_id: params[2],
    status: params[5],
    type: params[4],
  };
}
