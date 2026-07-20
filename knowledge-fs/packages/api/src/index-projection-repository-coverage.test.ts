import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, IndexProjection } from "@knowledge/core";
import { IndexProjectionSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseIndexProjectionRepository,
  createInMemoryIndexProjectionRepository,
} from "./index-projection-repository";

const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
const otherKnowledgeSpaceId = "10000000-0000-4000-8000-000000000002";

function projection(index: number, overrides: Partial<IndexProjection> = {}): IndexProjection {
  const suffix = index.toString(16).padStart(12, "0");
  return IndexProjectionSchema.parse({
    id: `00000000-0000-4000-8000-${suffix}`,
    knowledgeSpaceId,
    metadata: { denseVector: [0.1, 0.2], ftsText: "Policy renewal" },
    nodeId: `20000000-0000-4000-8000-${suffix}`,
    projectionVersion: 1,
    status: "ready",
    type: "dense-vector",
    ...overrides,
  });
}

function createRepository() {
  return createInMemoryIndexProjectionRepository({
    maxBatchSize: 10,
    maxListLimit: 10,
    maxProjections: 20,
  });
}

function createDatabaseRepository(
  executor: (
    input: DatabaseExecuteInput,
  ) => Promise<{ rows: Record<string, unknown>[]; rowsAffected: number }>,
) {
  const calls: DatabaseExecuteInput[] = [];
  const repository = createDatabaseIndexProjectionRepository({
    database: createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return executor(input);
      },
      kind: "postgres",
    }),
    maxBatchSize: 10,
    maxListLimit: 10,
  });

  return { calls, repository };
}

describe("in-memory index projection repository coverage", () => {
  it("rejects deletes that exceed the projection budget", async () => {
    const repository = createRepository();
    const sharedNodeId = "20000000-0000-4000-8000-00000000feed";
    await repository.createMany([
      projection(1, { model: "dense@1", nodeId: sharedNodeId }),
      projection(2, { model: "dense@2", nodeId: sharedNodeId }),
    ]);

    await expect(
      repository.deleteByNodeIds({
        knowledgeSpaceId,
        maxProjections: 1,
        nodeIds: [sharedNodeId],
      }),
    ).rejects.toThrow("Index projection delete maxProjections=1 exceeded");
  });

  it("scopes version publication to the requested space and type", async () => {
    const repository = createRepository();
    await repository.createMany([
      projection(1, { projectionVersion: 2, status: "building" }),
      projection(2, { knowledgeSpaceId: otherKnowledgeSpaceId, status: "ready" }),
      projection(3, { metadata: { ftsText: "renewal terms" }, status: "ready", type: "fts" }),
    ]);

    const published = await repository.publishVersion({
      knowledgeSpaceId,
      projectionVersion: 2,
      type: "dense-vector",
    });

    expect(published).toEqual({ published: 1, staled: 0 });
    const untouched = await repository.listReadyBySpace({
      knowledgeSpaceId: otherKnowledgeSpaceId,
      limit: 5,
      type: "dense-vector",
    });
    expect(untouched.items).toHaveLength(1);
  });

  it("validates list limits, version inputs, and prune inputs", async () => {
    const repository = createRepository();

    await expect(
      repository.listReadyBySpace({ knowledgeSpaceId, limit: 0, type: "dense-vector" }),
    ).rejects.toThrow("Index projection list limit must be at least 1");
    await expect(
      repository.summarizeVersion({ knowledgeSpaceId: "  ", projectionVersion: 1, type: "fts" }),
    ).rejects.toThrow("Index projection knowledgeSpaceId is required");
    await expect(
      repository.summarizeVersion({
        knowledgeSpaceId,
        projectionVersion: 1,
        type: "bogus" as IndexProjection["type"],
      }),
    ).rejects.toThrow("Index projection type is invalid");
    await expect(
      repository.summarizeVersion({ knowledgeSpaceId, projectionVersion: 0, type: "fts" }),
    ).rejects.toThrow("Index projection version must be a positive integer");
    await expect(
      repository.pruneInactiveVersions({
        knowledgeSpaceId: "  ",
        maxProjections: 1,
        retainVersions: 1,
        type: "fts",
      }),
    ).rejects.toThrow("Index projection knowledgeSpaceId is required");
    await expect(
      repository.pruneInactiveVersions({
        knowledgeSpaceId,
        maxProjections: 1,
        retainVersions: 1,
        type: "bogus" as IndexProjection["type"],
      }),
    ).rejects.toThrow("Index projection type is invalid");
    await expect(
      repository.pruneInactiveVersions({
        knowledgeSpaceId,
        maxProjections: 0,
        retainVersions: 1,
        type: "fts",
      }),
    ).rejects.toThrow("Index projection prune maxProjections must be at least 1");
  });

  it("orders same-node projections by id and honours cursors on ties", async () => {
    const repository = createRepository();
    const sharedNodeId = "20000000-0000-4000-8000-00000000cafe";
    await repository.createMany([
      projection(2, { model: "dense@2", nodeId: sharedNodeId }),
      projection(1, { model: "dense@1", nodeId: sharedNodeId }),
      projection(3),
    ]);

    const ordered = await repository.listReadyBySpace({
      knowledgeSpaceId,
      limit: 5,
      type: "dense-vector",
    });
    expect(ordered.items.map((item) => item.id)).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);

    const afterTie = await repository.listReadyBySpace({
      cursor: { id: "00000000-0000-4000-8000-000000000001", nodeId: sharedNodeId },
      knowledgeSpaceId,
      limit: 5,
      type: "dense-vector",
    });
    expect(afterTie.items.map((item) => item.id)).toEqual(["00000000-0000-4000-8000-000000000002"]);
  });
});

describe("database index projection repository coverage", () => {
  it("bounds delete budgets and skips empty node batches without touching the database", async () => {
    const { calls, repository } = createDatabaseRepository(async () => ({
      rows: [],
      rowsAffected: 0,
    }));

    await expect(
      repository.deleteByNodeIds({ knowledgeSpaceId, maxProjections: 0, nodeIds: ["node-1"] }),
    ).rejects.toThrow("Index projection delete maxProjections must be at least 1");
    await expect(
      repository.deleteByNodeIds({ knowledgeSpaceId, maxProjections: 5, nodeIds: [] }),
    ).resolves.toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("rejects summarize rows with unsafe counts", async () => {
    const { repository } = createDatabaseRepository(async () => ({
      rows: [{ count: "99999999999999999999", status: "ready" }],
      rowsAffected: 0,
    }));

    await expect(
      repository.summarizeVersion({ knowledgeSpaceId, projectionVersion: 1, type: "fts" }),
    ).rejects.toThrow("Database row column count must be a nonnegative integer count");
  });

  it("requires searchable FTS text before writing projection batches", async () => {
    const { calls, repository } = createDatabaseRepository(async () => ({
      rows: [],
      rowsAffected: 0,
    }));

    await expect(
      repository.createMany([projection(1, { metadata: {}, type: "fts" })]),
    ).rejects.toThrow("FTS projection metadata must include ftsText");
    await expect(
      repository.createMany([projection(1, { metadata: { ftsText: "!!! ---" }, type: "fts" })]),
    ).rejects.toThrow("FTS projection metadata must include searchable ftsText");
    expect(calls).toHaveLength(0);
  });
});
