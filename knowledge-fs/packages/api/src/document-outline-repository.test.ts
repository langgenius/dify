import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type DatabaseRow,
  DocumentOutlineSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseDocumentOutlineRepository,
  createInMemoryDocumentOutlineRepository,
} from "./document-outline-repository";

const OUTLINE = DocumentOutlineSchema.parse({
  artifactHash: "a".repeat(64),
  createdAt: "2026-07-06T00:00:00.000Z",
  documentAssetId: "20000000-0000-4000-8000-000000000001",
  id: "30000000-0000-4000-8000-000000000001",
  knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
  metadata: {},
  nodes: [
    {
      id: "n1",
      level: 1,
      metadata: {},
      summary: "shipping costs vary by region",
      title: "Shipping",
      tocSource: "native-toc",
    },
  ],
  outlineVersion: "v1",
  parseArtifactId: "40000000-0000-4000-8000-000000000001",
  version: 1,
});

describe("createInMemoryDocumentOutlineRepository", () => {
  it("keeps the same document revision isolated across publication generations", async () => {
    const repository = createInMemoryDocumentOutlineRepository({ maxOutlines: 2 });
    const firstGeneration = "50000000-0000-4000-8000-000000000001";
    const secondGeneration = "50000000-0000-4000-8000-000000000002";
    const first = DocumentOutlineSchema.parse({
      ...OUTLINE,
      publicationGenerationId: firstGeneration,
    });
    const second = DocumentOutlineSchema.parse({
      ...OUTLINE,
      id: "30000000-0000-4000-8000-000000000002",
      publicationGenerationId: secondGeneration,
    });

    await repository.upsert(first);
    await repository.upsert(second);

    await expect(
      repository.getByDocumentVersion({
        documentAssetId: OUTLINE.documentAssetId,
        publicationGenerationId: firstGeneration,
        version: 1,
      }),
    ).resolves.toMatchObject({ id: first.id });
    await expect(
      repository.getByDocumentVersion({
        documentAssetId: OUTLINE.documentAssetId,
        publicationGenerationId: secondGeneration,
        version: 1,
      }),
    ).resolves.toMatchObject({ id: second.id });
    await expect(
      repository.getByDocumentVersion({ documentAssetId: OUTLINE.documentAssetId, version: 1 }),
    ).resolves.toBeNull();
  });

  it("upserts by (documentAssetId, version) and looks up by version and id", async () => {
    const repository = createInMemoryDocumentOutlineRepository({ maxOutlines: 10 });
    await repository.upsert(OUTLINE);

    await expect(
      repository.getByDocumentVersion({ documentAssetId: OUTLINE.documentAssetId, version: 1 }),
    ).resolves.toMatchObject({ id: OUTLINE.id });
    await expect(repository.getById({ id: OUTLINE.id })).resolves.toMatchObject({ id: OUTLINE.id });
  });

  it("accepts only exact replay for a generation-scoped outline", async () => {
    const repository = createInMemoryDocumentOutlineRepository({ maxOutlines: 1 });
    const publicationGenerationId = "50000000-0000-4000-8000-000000000001";
    const original = DocumentOutlineSchema.parse({ ...OUTLINE, publicationGenerationId });
    const retried = DocumentOutlineSchema.parse({
      ...original,
      artifactHash: "b".repeat(64),
      id: "30000000-0000-4000-8000-000000000099",
      publicationGenerationId,
    });

    await repository.create(original);
    await expect(repository.upsert(original)).resolves.toEqual(original);
    await expect(repository.upsert(retried)).rejects.toMatchObject({
      code: "GENERATION_SCOPED_COMPONENT_CONFLICT",
    });
    await expect(repository.getById({ id: retried.id })).resolves.toBeNull();
    await expect(repository.getById({ id: original.id })).resolves.toMatchObject({
      artifactHash: original.artifactHash,
      id: original.id,
    });
  });
});

describe("createDatabaseDocumentOutlineRepository", () => {
  it("atomically upserts an outline generation and casts the nodes tree to JSON", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 1 };
      },
      kind: "postgres",
    });
    const repository = createDatabaseDocumentOutlineRepository({ database });

    const created = await repository.upsert(OUTLINE);
    expect(created).toMatchObject({ id: OUTLINE.id, version: 1 });

    expect(calls[0]?.operation).toBe("insert");
    expect(calls[0]?.sql).toContain('INSERT INTO "document_outlines"');
    expect(calls[0]?.sql).toContain(
      'ON CONFLICT ("document_asset_id", "version", (COALESCE("publication_generation_id"',
    );
    expect(calls[0]?.sql).toContain('"nodes"');
    expect(calls[0]?.params).toContain(JSON.stringify(OUTLINE.nodes));
    expect(calls[0]?.sql).not.toContain('"id" = EXCLUDED."id"');
    expect(calls[0]?.sql).not.toContain('"knowledge_space_id" = EXCLUDED."knowledge_space_id"');
    expect(calls[0]?.sql).not.toContain(
      '"publication_generation_id" = EXCLUDED."publication_generation_id"',
    );
  });

  it.each(["postgres", "tidb"] as const)(
    "accepts exact database outline replay and rejects a differing %s replay",
    async (kind) => {
      const fake = createIdentityPreservingOutlineExecutor(kind === "postgres");
      const repository = createDatabaseDocumentOutlineRepository({
        database: createSchemaDatabaseAdapter({
          executor: fake.executor,
          kind,
          transaction: async (callback) => callback({ execute: fake.executor }),
        }),
      });
      const publicationGenerationId = "50000000-0000-4000-8000-000000000001";
      const original = DocumentOutlineSchema.parse({ ...OUTLINE, publicationGenerationId });
      const retried = DocumentOutlineSchema.parse({
        ...original,
        artifactHash: "b".repeat(64),
        id: "30000000-0000-4000-8000-000000000099",
      });

      await repository.upsert(original);
      await expect(repository.upsert(original)).resolves.toEqual(original);
      await expect(repository.upsert(retried)).rejects.toMatchObject({
        code: "GENERATION_SCOPED_COMPONENT_CONFLICT",
      });

      const upsertSql = fake.calls.filter((call) => call.operation === "insert").at(-1)?.sql ?? "";
      for (const column of [
        "id",
        "knowledge_space_id",
        "publication_generation_id",
        "document_asset_id",
        "version",
      ]) {
        expect(upsertSql).not.toContain(`"${column}" = EXCLUDED."${column}"`);
        expect(upsertSql).not.toContain(`\`${column}\` = VALUES(\`${column}\`)`);
      }
    },
  );

  it("maps a database row back to a DocumentOutline (nullable updated_at omitted)", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({
        rows: [
          {
            artifact_hash: OUTLINE.artifactHash,
            created_at: OUTLINE.createdAt,
            document_asset_id: OUTLINE.documentAssetId,
            id: OUTLINE.id,
            knowledge_space_id: OUTLINE.knowledgeSpaceId,
            metadata: JSON.stringify(OUTLINE.metadata),
            nodes: JSON.stringify(OUTLINE.nodes),
            outline_version: OUTLINE.outlineVersion,
            parse_artifact_id: OUTLINE.parseArtifactId,
            updated_at: null,
            version: 1,
          },
        ],
        rowsAffected: 1,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseDocumentOutlineRepository({ database });

    const outline = await repository.getByDocumentVersion({
      documentAssetId: OUTLINE.documentAssetId,
      version: 1,
    });
    expect(outline).toMatchObject({ id: OUTLINE.id, version: 1 });
    expect(outline?.nodes[0]).toMatchObject({
      summary: "shipping costs vary by region",
      title: "Shipping",
    });
    expect(outline?.updatedAt).toBeUndefined();
  });
});

function createIdentityPreservingOutlineExecutor(returnInsertRows: boolean): {
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
        const incoming = outlineRowFromParams(input.params);
        stored = stored ? { ...incoming, id: stored.id } : incoming;

        return { rows: returnInsertRows ? [stored] : [], rowsAffected: 1 };
      }

      if (input.operation === "select") {
        return { rows: stored ? [stored] : [], rowsAffected: stored ? 1 : 0 };
      }

      return { rows: [], rowsAffected: 0 };
    },
  };
}

function outlineRowFromParams(params: readonly unknown[]): DatabaseRow {
  return {
    artifact_hash: params[5],
    created_at: params[10],
    document_asset_id: params[3],
    id: params[0],
    knowledge_space_id: params[1],
    metadata: params[9],
    nodes: params[8],
    outline_version: params[6],
    parse_artifact_id: params[4],
    publication_generation_id: params[2],
    updated_at: params[11],
    version: params[7],
  };
}
