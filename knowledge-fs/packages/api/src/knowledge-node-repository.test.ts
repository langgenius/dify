import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult, KnowledgeNode } from "@knowledge/core";
import { KnowledgeNodeSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeNodeCapacityExceededError,
  KnowledgeNodeLogicalConflictError,
  KnowledgeNodeOwnershipConflictError,
  createDatabaseKnowledgeNodeRepository,
  createInMemoryKnowledgeNodeRepository,
} from "./knowledge-node-repository";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const DOCUMENT_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const PARSE_ARTIFACT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const GENERATION_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca1";
const GENERATION_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f2ca2";

function knowledgeNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId: DOCUMENT_ASSET_ID,
    endOffset: 12,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a00",
    kind: "chunk",
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    metadata: { chunkIndex: 0 },
    parseArtifactId: PARSE_ARTIFACT_ID,
    permissionScope: ["tenant:tenant-1"],
    sourceLocation: { sectionPath: ["Intro"], startOffset: 0, endOffset: 12 },
    startOffset: 0,
    text: "hello world",
    ...overrides,
  });
}

function knowledgeNodeRow(node: KnowledgeNode): Record<string, unknown> {
  return {
    artifact_hash: node.artifactHash,
    document_asset_id: node.documentAssetId,
    end_offset: node.endOffset,
    id: node.id,
    kind: node.kind,
    knowledge_space_id: node.knowledgeSpaceId,
    metadata: node.metadata,
    parse_artifact_id: node.parseArtifactId,
    permission_scope: node.permissionScope,
    publication_generation_id: node.publicationGenerationId ?? null,
    source_location: node.sourceLocation,
    start_offset: node.startOffset,
    text: node.text,
    updated_at: node.updatedAt ?? null,
  };
}

function createFakeKnowledgeNodeExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });

    if (input.operation === "insert") {
      const inserted: Record<string, unknown>[] = [];

      for (let offset = 0; offset < input.params.length; offset += 14) {
        const [
          id,
          knowledgeSpaceId,
          publicationGenerationId,
          documentAssetId,
          parseArtifactId,
          kind,
          text,
          startOffset,
          endOffset,
          sourceLocation,
          permissionScope,
          artifactHash,
          metadata,
          updatedAt,
        ] = input.params.slice(offset, offset + 14);
        const row = {
          artifact_hash: artifactHash,
          document_asset_id: documentAssetId,
          end_offset: endOffset,
          id,
          kind,
          knowledge_space_id: knowledgeSpaceId,
          metadata:
            typeof metadata === "string" ? (JSON.parse(metadata) as Record<string, unknown>) : {},
          parse_artifact_id: parseArtifactId,
          permission_scope:
            typeof permissionScope === "string" ? (JSON.parse(permissionScope) as string[]) : [],
          publication_generation_id: publicationGenerationId,
          source_location:
            typeof sourceLocation === "string"
              ? (JSON.parse(sourceLocation) as Record<string, unknown>)
              : {},
          start_offset: startOffset,
          text,
          updated_at: updatedAt,
        };

        rows.set(String(id), row);
        inserted.push({ ...row });
      }

      return { rows: inserted, rowsAffected: inserted.length };
    }

    if (input.operation === "update") {
      const [knowledgeSpaceId] = input.params;
      const metadataIndex = input.params.findIndex(
        (value, index) => index > 0 && typeof value === "string" && value.startsWith("{"),
      );
      const id = input.params[metadataIndex - 1];
      const metadata = input.params[metadataIndex];
      const row = rows.get(String(id));

      if (row && row.knowledge_space_id === knowledgeSpaceId) {
        row.metadata =
          typeof metadata === "string" ? (JSON.parse(metadata) as Record<string, unknown>) : {};
      }

      return { rows: [], rowsAffected: row ? 1 : 0 };
    }

    if (input.operation === "delete") {
      const [, ...ids] = input.params;
      for (const id of ids) {
        rows.delete(String(id));
      }

      return { rows: [], rowsAffected: ids.length };
    }

    if (input.sql.includes("document_asset_id")) {
      const [, documentAssetId] = input.params;
      const selected = Array.from(rows.values())
        .filter((row) => row.document_asset_id === documentAssetId)
        .map((row) => ({ id: row.id }));

      return { rows: selected, rowsAffected: selected.length };
    }

    if (input.sql.includes("ORDER BY")) {
      const [knowledgeSpaceId, parseArtifactId, limit] = input.params;
      const selected = Array.from(rows.values())
        .filter((row) => row.knowledge_space_id === knowledgeSpaceId)
        .filter((row) => row.parse_artifact_id === parseArtifactId)
        .sort((left, right) => Number(left.start_offset) - Number(right.start_offset))
        .slice(0, Number(limit))
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    if (input.operation === "select" && input.sql.includes("parse_artifact_id")) {
      const [knowledgeSpaceId, parseArtifactId, kind, startOffset, endOffset, generationId] =
        input.params;
      const selected = Array.from(rows.values()).filter(
        (row) =>
          row.knowledge_space_id === knowledgeSpaceId &&
          row.parse_artifact_id === parseArtifactId &&
          row.kind === kind &&
          row.start_offset === startOffset &&
          row.end_offset === endOffset &&
          row.publication_generation_id === generationId,
      );
      return { rows: selected, rowsAffected: selected.length };
    }

    const [knowledgeSpaceId, id] = input.params;
    const row = rows.get(String(id));
    const selected = row && row.knowledge_space_id === knowledgeSpaceId ? [{ ...row }] : [];

    return { rows: selected, rowsAffected: selected.length };
  };

  return { calls, executor };
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

describe("KnowledgeNode repositories", () => {
  it("stores bounded in-memory nodes with clone isolation, pagination, updates, and deletes", async () => {
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 1,
      maxNodes: 2,
    });
    const first = knowledgeNode();
    const second = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      startOffset: 13,
      endOffset: 25,
      sourceLocation: { sectionPath: ["Intro"], startOffset: 13, endOffset: 25 },
      text: "second chunk",
    });

    const created = (await repository.createMany([first]))[0];
    expect(created).toBeDefined();
    if (!created) {
      throw new Error("expected created node");
    }
    created.metadata.chunkIndex = 999;
    await repository.upsertMany([second]);

    await expect(
      repository.get({ id: first.id, knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).resolves.toEqual(expect.objectContaining({ metadata: { chunkIndex: 0 } }));
    await expect(
      repository.listByArtifact({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 1,
        parseArtifactId: PARSE_ARTIFACT_ID,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: first.id })],
      nextCursor: { id: first.id, startOffset: 0 },
    });
    await expect(
      repository.updateMetadataMany({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        patches: [{ id: first.id, metadata: { reviewed: true } }],
      }),
    ).resolves.toEqual([expect.objectContaining({ metadata: { reviewed: true } })]);
    await expect(
      repository.listIdsByDocumentAsset({
        documentAssetId: DOCUMENT_ASSET_ID,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        maxNodes: 2,
      }),
    ).resolves.toEqual([first.id, second.id]);
    await expect(
      repository.createMany([
        knowledgeNode({
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02",
          startOffset: 26,
          endOffset: 31,
          sourceLocation: { sectionPath: ["Intro"], startOffset: 26, endOffset: 31 },
          text: "third",
        }),
      ]),
    ).rejects.toBeInstanceOf(KnowledgeNodeCapacityExceededError);
    await expect(
      repository.deleteByDocumentAsset({
        documentAssetId: DOCUMENT_ASSET_ID,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        maxNodes: 2,
      }),
    ).resolves.toEqual({ deleted: 2, nodeIds: [first.id, second.id] });
  });

  it("uses parameterized bounded SQL for database writes, reads, updates, and deletes", async () => {
    const fake = createFakeKnowledgeNodeExecutor();
    const repository = createDatabaseKnowledgeNodeRepository({
      database: transactionalDatabase("postgres", fake.executor),
      maxBatchSize: 2,
      maxListLimit: 2,
    });
    const node = knowledgeNode();

    await expect(repository.createMany([node])).resolves.toEqual([node]);
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "knowledge_nodes",
      }),
    );
    expect(fake.calls[0]?.params).toContain(node.text);
    expect(fake.calls[0]?.params).toContain(JSON.stringify(node.sourceLocation));
    expect(fake.calls[0]?.params).toContain(JSON.stringify(node.permissionScope));
    expect(fake.calls[0]?.sql).not.toContain(node.text);

    await expect(
      repository.get({ id: node.id, knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).resolves.toEqual(node);
    expect(fake.calls[1]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [KNOWLEDGE_SPACE_ID, node.id],
      }),
    );

    await expect(
      repository.updateMetadataMany({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        patches: [{ id: node.id, metadata: { reviewed: true } }],
      }),
    ).resolves.toEqual([expect.objectContaining({ metadata: { reviewed: true } })]);
    await expect(
      repository.listIdsByDocumentAsset({
        documentAssetId: DOCUMENT_ASSET_ID,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        maxNodes: 1,
      }),
    ).resolves.toEqual([node.id]);
    await expect(
      repository.deleteByDocumentAsset({
        documentAssetId: DOCUMENT_ASSET_ID,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        maxNodes: 1,
      }),
    ).resolves.toEqual({ deleted: 1, nodeIds: [node.id] });
  });

  it.each(["postgres", "tidb"] as const)(
    "uses bounded, space-scoped %s SQL to inventory document node ids",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const node = knowledgeNode();
      const repository = createDatabaseKnowledgeNodeRepository({
        database: transactionalDatabase(kind, async (input) => {
          calls.push(input);
          return { rows: [{ id: node.id }], rowsAffected: 1 };
        }),
        maxBatchSize: 2,
        maxListLimit: 2,
      });

      await expect(
        repository.listIdsByDocumentAsset({
          documentAssetId: DOCUMENT_ASSET_ID,
          knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
          maxNodes: 1,
        }),
      ).resolves.toEqual([node.id]);
      expect(calls[0]).toEqual(
        expect.objectContaining({
          maxRows: 2,
          operation: "select",
          params: [KNOWLEDGE_SPACE_ID, DOCUMENT_ASSET_ID],
        }),
      );
      expect(calls[0]?.sql).toContain(
        kind === "postgres"
          ? 'WHERE "knowledge_space_id" = $1 AND "document_asset_id" = $2'
          : "WHERE `knowledge_space_id` = ? AND `document_asset_id` = ?",
      );
    },
  );

  it("rejects unbounded in-memory operations and handles empty database reads", async () => {
    for (const [options, message] of [
      [{ maxBatchSize: 0, maxListLimit: 1, maxNodes: 1 }, "maxBatchSize"],
      [{ maxBatchSize: 1, maxListLimit: 0, maxNodes: 1 }, "maxListLimit"],
    ] as const) {
      expect(() => createInMemoryKnowledgeNodeRepository(options)).toThrow(
        `Knowledge node repository ${message} must be at least 1`,
      );
    }
    expect(() =>
      createInMemoryKnowledgeNodeRepository({
        maxBatchSize: 1,
        maxListLimit: 1,
        maxNodes: 0,
      }),
    ).toThrow("Knowledge node repository maxNodes must be at least 1");

    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxNodes: 1,
    });
    await repository.createMany([knowledgeNode()]);

    await expect(
      repository.getMany({ ids: ["a", "b"], knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).rejects.toThrow("Knowledge node batch size exceeds maxBatchSize=1");
    await expect(
      repository.listByArtifact({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 0,
        parseArtifactId: PARSE_ARTIFACT_ID,
      }),
    ).rejects.toThrow("Knowledge node list limit must be at least 1");
    await expect(
      repository.updateMetadataMany({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, patches: [] }),
    ).rejects.toThrow("Knowledge node metadata update batch must contain at least 1 patch");
    await expect(
      repository.updateMetadataMany({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        patches: [{ id: " ", metadata: {} }],
      }),
    ).rejects.toThrow("Knowledge node metadata update id is required");

    const fake = createFakeKnowledgeNodeExecutor();
    const databaseRepository = createDatabaseKnowledgeNodeRepository({
      database: transactionalDatabase("postgres", fake.executor),
      maxBatchSize: 2,
      maxListLimit: 2,
    });

    await expect(
      databaseRepository.getMany({ ids: [], knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).resolves.toEqual([]);
    await expect(
      databaseRepository.deleteByDocumentAsset({
        documentAssetId: DOCUMENT_ASSET_ID,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        maxNodes: 1,
      }),
    ).resolves.toEqual({ deleted: 0, nodeIds: [] });
  });

  it("isolates legacy and immutable node generations across every ordinary memory operation", async () => {
    const repository = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 8,
      maxListLimit: 8,
      maxNodes: 8,
    });
    const legacy = knowledgeNode();
    const candidateA = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a11",
      publicationGenerationId: GENERATION_A,
    });
    const candidateB = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a12",
      publicationGenerationId: GENERATION_B,
    });
    const foreignSpaceLegacy = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a15",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8aff",
    });
    await repository.createMany([legacy, candidateA, candidateB, foreignSpaceLegacy]);

    await expect(
      repository.get({ id: candidateA.id, knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).resolves.toBeNull();
    await expect(
      repository.get({
        id: candidateA.id,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        publicationGenerationId: GENERATION_A,
      }),
    ).resolves.toEqual(candidateA);
    await expect(
      repository.getMany({
        ids: [legacy.id, candidateA.id, candidateB.id],
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      }),
    ).resolves.toEqual([legacy]);
    await expect(
      repository.listByArtifact({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 8,
        parseArtifactId: PARSE_ARTIFACT_ID,
      }),
    ).resolves.toEqual({ items: [legacy] });
    await expect(
      repository.listBySpace({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 8,
        publicationGenerationId: GENERATION_A,
      }),
    ).resolves.toEqual({ items: [candidateA] });

    await expect(
      repository.updateMetadataMany({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        patches: [{ id: candidateA.id, metadata: { candidate: true } }],
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.updateMetadataMany({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        patches: [{ id: candidateA.id, metadata: { candidate: true } }],
        publicationGenerationId: GENERATION_A,
      }),
    ).resolves.toEqual([expect.objectContaining({ metadata: { candidate: true } })]);

    const retryId = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a13";
    await expect(
      repository.upsertMany([
        knowledgeNode({
          id: retryId,
          metadata: { retried: true },
          publicationGenerationId: GENERATION_A,
        }),
      ]),
    ).rejects.toMatchObject({ code: "GENERATION_SCOPED_COMPONENT_CONFLICT" });
    await expect(
      repository.upsertMany([{ ...candidateA, metadata: { candidate: true } }]),
    ).resolves.toEqual([{ ...candidateA, metadata: { candidate: true } }]);
    await expect(
      repository.upsertMany([
        knowledgeNode({
          ...candidateA,
          endOffset: 13,
          sourceLocation: { sectionPath: ["Intro"], startOffset: 0, endOffset: 13 },
        }),
      ]),
    ).rejects.toBeInstanceOf(KnowledgeNodeLogicalConflictError);
    await expect(
      repository.upsertMany([
        knowledgeNode({ ...candidateA, publicationGenerationId: GENERATION_B }),
      ]),
    ).rejects.toBeInstanceOf(KnowledgeNodeOwnershipConflictError);
    await expect(
      repository.upsertMany([
        candidateB,
        knowledgeNode({
          ...candidateB,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a14",
        }),
      ]),
    ).rejects.toBeInstanceOf(KnowledgeNodeLogicalConflictError);
    await expect(
      repository.get({
        id: candidateA.id,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        publicationGenerationId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow("Publication generation ID must be a non-zero UUID");

    await expect(
      repository.deleteByDocumentAsset({
        documentAssetId: DOCUMENT_ASSET_ID,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        maxNodes: 3,
      }),
    ).resolves.toEqual({
      deleted: 3,
      nodeIds: [legacy.id, candidateA.id, candidateB.id],
    });
  });

  it("adds generation predicates and generation-aware logical upserts to database SQL", async () => {
    const fake = createFakeKnowledgeNodeExecutor();
    const repository = createDatabaseKnowledgeNodeRepository({
      database: transactionalDatabase("postgres", fake.executor),
      maxBatchSize: 4,
      maxListLimit: 4,
    });
    const candidate = knowledgeNode({ publicationGenerationId: GENERATION_A });

    await repository.upsertMany([candidate]);
    expect(fake.calls[0]?.sql).toContain("ON CONFLICT DO NOTHING");
    expect(fake.calls[0]?.sql).not.toContain("vector(1536)");
    expect(fake.calls[0]?.params).toContain(GENERATION_A);

    await repository.get({ id: candidate.id, knowledgeSpaceId: KNOWLEDGE_SPACE_ID });
    const legacyGet = fake.calls.find(
      (call) => call.params.length === 2 && call.params[1] === candidate.id,
    );
    expect(legacyGet?.sql).toContain('"publication_generation_id" IS NULL');
    await repository.get({
      id: candidate.id,
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      publicationGenerationId: GENERATION_A,
    });
    const generationGet = fake.calls.find(
      (call) => call.params.length === 3 && call.params[1] === candidate.id,
    );
    expect(generationGet?.sql).toContain('"publication_generation_id" = $3');
    expect(generationGet?.params).toEqual([KNOWLEDGE_SPACE_ID, candidate.id, GENERATION_A]);

    await repository.listByArtifact({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      parseArtifactId: PARSE_ARTIFACT_ID,
      publicationGenerationId: GENERATION_A,
    });
    const artifactList = fake.calls.find(
      (call) => call.sql.includes("ORDER BY") && call.sql.includes("parse_artifact_id"),
    );
    expect(artifactList?.sql).toContain('"publication_generation_id" = $3');
    expect(artifactList?.sql).toContain('"knowledge_space_id" = $1');
    expect(artifactList?.params.slice(0, 3)).toEqual([
      KNOWLEDGE_SPACE_ID,
      PARSE_ARTIFACT_ID,
      GENERATION_A,
    ]);
    await repository.updateMetadataMany({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      patches: [{ id: candidate.id, metadata: { candidate: true } }],
      publicationGenerationId: GENERATION_A,
    });
    const metadataUpdate = fake.calls.find((call) => call.operation === "update");
    expect(metadataUpdate?.sql).toContain('"publication_generation_id" = $2');

    await repository.deleteByDocumentAsset({
      documentAssetId: DOCUMENT_ASSET_ID,
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      maxNodes: 2,
    });
    const deleteSelection = fake.calls.find(
      (call) => call.operation === "select" && call.sql.includes("document_asset_id"),
    );
    expect(deleteSelection?.sql).toContain('SELECT "id", "publication_generation_id"');
    expect(deleteSelection?.params).toEqual([KNOWLEDGE_SPACE_ID, DOCUMENT_ASSET_ID]);
  });

  it("fails closed when a TiDB primary-key collision cannot be read back in the intended scope", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const repository = createDatabaseKnowledgeNodeRepository({
      database: transactionalDatabase("tidb", async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: input.operation === "insert" ? 0 : 0 };
      }),
      maxBatchSize: 2,
      maxListLimit: 2,
    });

    await expect(
      repository.upsertMany([knowledgeNode({ publicationGenerationId: GENERATION_A })]),
    ).rejects.toBeInstanceOf(KnowledgeNodeOwnershipConflictError);
    expect(calls[0]?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(calls[0]?.sql).toContain("`id` = `id`");
    expect(calls[0]?.sql).not.toContain("= IF(");
    expect(calls[1]?.sql).toContain("`publication_generation_id` = ?");
  });

  it("rejects a PostgreSQL logical conflict whose persisted document ownership differs", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const requested = knowledgeNode({ publicationGenerationId: GENERATION_A });
    const wrongOwner = knowledgeNode({
      ...requested,
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8aff",
    });
    const repository = createDatabaseKnowledgeNodeRepository({
      database: transactionalDatabase("postgres", async (input) => {
        calls.push(input);
        return { rows: [knowledgeNodeRow(wrongOwner)], rowsAffected: 1 };
      }),
      maxBatchSize: 2,
      maxListLimit: 2,
    });

    await expect(repository.upsertMany([requested])).rejects.toBeInstanceOf(
      KnowledgeNodeOwnershipConflictError,
    );
    expect(calls[0]?.sql).toContain("ON CONFLICT DO NOTHING");
  });

  it("fails closed when PostgreSQL returns no row for an ownership-guarded upsert", async () => {
    const repository = createDatabaseKnowledgeNodeRepository({
      database: transactionalDatabase("postgres", async () => ({ rows: [], rowsAffected: 0 })),
      maxBatchSize: 2,
      maxListLimit: 2,
    });

    await expect(
      repository.upsertMany([knowledgeNode({ publicationGenerationId: GENERATION_A })]),
    ).rejects.toBeInstanceOf(KnowledgeNodeOwnershipConflictError);
  });
});
