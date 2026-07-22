import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type DatabaseRow,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseParseArtifactRepository,
  createInMemoryParseArtifactRepository,
} from "./parse-artifact-repository";

const artifact = ParseArtifactSchema.parse({
  artifactHash: "d".repeat(64),
  contentType: "text",
  createdAt: "2026-05-09T11:00:01.000Z",
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
  elements: [
    {
      id: "element-1",
      metadata: { level: 1 },
      sectionPath: ["Intro"],
      text: "Hello",
      type: "paragraph",
    },
  ],
  id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
  metadata: { filename: "hello.md" },
  parser: "native-markdown",
  version: 1,
}) satisfies ParseArtifact;

describe("parse artifact repositories", () => {
  it("stores clone-isolated artifacts and bounds in-memory capacity", async () => {
    const repository = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });

    await expect(repository.create(artifact)).resolves.toEqual(artifact);
    const stored = await repository.getByDocumentVersion({
      documentAssetId: artifact.documentAssetId,
      version: artifact.version,
    });

    if (!stored) {
      throw new Error("Expected stored parse artifact");
    }

    stored.metadata.filename = "mutated.md";
    stored.elements[0]?.sectionPath.push("Mutation");

    await expect(
      repository.getByDocumentVersion({
        documentAssetId: artifact.documentAssetId,
        version: artifact.version,
      }),
    ).resolves.toMatchObject({
      elements: [{ sectionPath: ["Intro"] }],
      metadata: { filename: "hello.md" },
    });
    await expect(repository.getById({ id: artifact.id })).resolves.toMatchObject({
      id: artifact.id,
      metadata: { filename: "hello.md" },
    });
    await expect(
      repository.create({
        ...artifact,
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
      }),
    ).rejects.toThrow("Parse artifact repository maxArtifacts=1 exceeded");
    expect(() => createInMemoryParseArtifactRepository({ maxArtifacts: 0 })).toThrow(
      "Parse artifact repository maxArtifacts must be at least 1",
    );
  });

  it("uses parameterized database writes and bounded deletes", async () => {
    const fake = createFakeParseArtifactExecutor();
    const repository = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
    });

    await expect(repository.create(artifact)).resolves.toEqual(artifact);
    await expect(
      repository.getByDocumentVersion({
        documentAssetId: artifact.documentAssetId,
        version: artifact.version,
      }),
    ).resolves.toEqual(artifact);
    await expect(repository.getById({ id: artifact.id })).resolves.toEqual(artifact);
    await expect(
      repository.pruneDocumentVersions({
        documentAssetId: artifact.documentAssetId,
        keepVersions: 1,
        maxArtifacts: 2,
      }),
    ).resolves.toBe(0);

    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "parse_artifacts",
      }),
    );
    expect(fake.calls[0]?.sql).not.toContain("hello.md");
    expect(fake.calls[0]?.params).toContain(JSON.stringify(artifact.elements));
    expect(fake.calls[0]?.params).toContain(JSON.stringify(artifact.metadata));
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [artifact.documentAssetId, artifact.version],
        tableName: "parse_artifacts",
      }),
    );
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "delete",
        params: [artifact.documentAssetId, 1],
        tableName: "parse_artifacts",
      }),
    );
    expect(fake.calls.at(-1)?.sql).not.toContain(artifact.documentAssetId);
  });

  it("fails closed when an upsert cannot resolve exactly one canonical artifact", async () => {
    const row = parseArtifactRow(artifact);
    const repositoryForRows = (rows: readonly DatabaseRow[]) =>
      createDatabaseParseArtifactRepository({
        database: createSchemaDatabaseAdapter({
          executor: async (input) => ({
            rows: input.operation === "select" ? [...rows] : [],
            rowsAffected: input.operation === "insert" ? 1 : 0,
          }),
          kind: "tidb",
        }),
      });

    await expect(repositoryForRows([]).create(artifact)).rejects.toThrow(
      "Parse artifact upsert did not persist its logical row",
    );
    await expect(repositoryForRows([row, { ...row }]).create(artifact)).rejects.toThrow(
      "Parse artifact upsert resolved multiple persisted logical rows",
    );
    await expect(
      repositoryForRows([
        {
          ...row,
          document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
        },
      ]).create(artifact),
    ).rejects.toThrow("Parse artifact upsert resolved a mismatched persisted logical row");
  });

  it("guards memory prune overflow and database document deletes", async () => {
    const memory = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });

    await memory.create({ ...artifact, id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01", version: 1 });
    await memory.create({ ...artifact, id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02", version: 2 });
    await memory.create({ ...artifact, id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03", version: 3 });

    await expect(
      memory.pruneDocumentVersions({
        documentAssetId: artifact.documentAssetId,
        keepVersions: 1,
        maxArtifacts: 1,
      }),
    ).rejects.toThrow("Parse artifact prune maxArtifacts=1 exceeded");
    await expect(
      memory.deleteByDocumentAsset({
        documentAssetId: artifact.documentAssetId,
        maxArtifacts: 1,
      }),
    ).rejects.toThrow("Parse artifact delete maxArtifacts=1 exceeded");

    const fake = createFakeParseArtifactExecutor();
    const database = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
    });

    await expect(
      database.deleteByDocumentAsset({
        documentAssetId: artifact.documentAssetId,
        maxArtifacts: 0,
      }),
    ).rejects.toThrow("Parse artifact delete maxArtifacts must be at least 1");
    await expect(
      database.deleteByDocumentAsset({
        documentAssetId: artifact.documentAssetId,
        maxArtifacts: 3,
      }),
    ).resolves.toBe(0);
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 3,
        operation: "delete",
        params: [artifact.documentAssetId],
        tableName: "parse_artifacts",
      }),
    );
    expect(fake.calls.at(-1)?.sql).not.toContain(artifact.documentAssetId);
  });
});

function createFakeParseArtifactExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, DatabaseRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      const [
        id,
        documentAssetId,
        version,
        parser,
        contentType,
        artifactHash,
        elements,
        metadata,
        createdAt,
      ] = input.params;
      const row = {
        artifact_hash: String(artifactHash),
        content_type: String(contentType),
        created_at: String(createdAt),
        document_asset_id: String(documentAssetId),
        elements: typeof elements === "string" ? JSON.parse(elements) : elements,
        id: String(id),
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
        parser: String(parser),
        version: Number(version),
      } satisfies DatabaseRow;

      rows.set(`${row.document_asset_id}:${row.version}`, row);

      return { rows: [{ ...row }], rowsAffected: 1 };
    }

    if (input.operation === "select") {
      const [first, version] = input.params;
      const row =
        input.params.length === 1
          ? Array.from(rows.values()).find((candidate) => candidate.id === String(first))
          : rows.get(`${String(first)}:${Number(version)}`);

      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return { calls, executor };
}

function parseArtifactRow(input: ParseArtifact): DatabaseRow {
  return {
    artifact_hash: input.artifactHash,
    content_type: input.contentType,
    created_at: input.createdAt,
    document_asset_id: input.documentAssetId,
    elements: input.elements,
    id: input.id,
    metadata: input.metadata,
    parser: input.parser,
    version: input.version,
  };
}
