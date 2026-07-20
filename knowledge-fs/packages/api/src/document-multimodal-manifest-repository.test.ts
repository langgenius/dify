import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult, DatabaseRow } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseDocumentMultimodalManifestRepository,
  createInMemoryDocumentMultimodalManifestRepository,
} from "./document-multimodal-manifest-repository";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const manifestId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

describe("document multimodal manifest repository", () => {
  it("keeps the same document revision isolated across publication generations", async () => {
    const repository = createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 2 });
    const firstGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
    const secondGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49";

    await repository.upsert(multimodalManifest({ publicationGenerationId: firstGeneration }));
    await repository.upsert(
      multimodalManifest({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
        publicationGenerationId: secondGeneration,
      }),
    );

    await expect(
      repository.getByDocumentVersion({
        documentAssetId,
        publicationGenerationId: firstGeneration,
        version: 1,
      }),
    ).resolves.toMatchObject({ id: manifestId });
    await expect(
      repository.getByDocumentVersion({
        documentAssetId,
        publicationGenerationId: secondGeneration,
        version: 1,
      }),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47" });
    await expect(
      repository.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toBeNull();
  });

  it("upserts, clones, looks up, and deletes manifests by document version", async () => {
    const repository = createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 });
    const manifest = await repository.upsert(multimodalManifest());

    manifest.metadata.mutated = true;

    await expect(
      repository.getByDocumentVersion({
        documentAssetId,
        version: 1,
      }),
    ).resolves.toMatchObject({
      id: manifestId,
      metadata: { source: "test" },
      parseArtifactId,
    });
    await expect(repository.getById({ id: manifestId })).resolves.toMatchObject({
      documentAssetId,
      version: 1,
    });
    await expect(
      repository.listByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxManifests: 1,
      }),
    ).resolves.toMatchObject([{ id: manifestId }]);
    await expect(
      repository.deleteByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxManifests: 1,
      }),
    ).resolves.toBe(1);
    await expect(
      repository.getByDocumentVersion({
        documentAssetId,
        version: 1,
      }),
    ).resolves.toBeNull();
  });

  it("accepts only exact replay for a generation-scoped manifest", async () => {
    const repository = createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 });
    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
    const original = multimodalManifest({ publicationGenerationId });
    const retried = multimodalManifest({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
      metadata: { source: "retry" },
      publicationGenerationId,
    });

    await repository.upsert(original);
    await expect(repository.upsert(original)).resolves.toEqual(original);
    await expect(repository.upsert(retried)).rejects.toMatchObject({
      code: "GENERATION_SCOPED_COMPONENT_CONFLICT",
    });
    await expect(
      repository.getById({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff" }),
    ).resolves.toBeNull();
    await expect(repository.getById({ id: manifestId })).resolves.toMatchObject({
      metadata: { source: "test" },
    });
  });

  it("bounds repository capacity", async () => {
    const repository = createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 1 });
    await repository.upsert(multimodalManifest());

    await expect(
      repository.upsert(
        multimodalManifest({
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
        }),
      ),
    ).rejects.toThrow("Document multimodal manifest repository maxManifests=1 exceeded");
    expect(() => createInMemoryDocumentMultimodalManifestRepository({ maxManifests: 0 })).toThrow(
      "Document multimodal manifest repository maxManifests must be at least 1",
    );
  });

  it("persists manifests through parameterized database upserts", async () => {
    const fake = createFakeManifestExecutor();
    const repository = createDatabaseDocumentMultimodalManifestRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: async (callback) => callback({ execute: fake.executor }),
      }),
    });

    await expect(repository.upsert(multimodalManifest())).resolves.toMatchObject({
      id: manifestId,
      metadata: { source: "test" },
    });
    await expect(
      repository.getByDocumentVersion({ documentAssetId, version: 1 }),
    ).resolves.toMatchObject({
      id: manifestId,
      parseArtifactId,
    });
    await expect(repository.getById({ id: manifestId })).resolves.toMatchObject({
      documentAssetId,
      version: 1,
    });
    await expect(
      repository.listByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxManifests: 2,
      }),
    ).resolves.toMatchObject([{ id: manifestId }]);
    await expect(
      repository.deleteByDocumentAsset({ documentAssetId, knowledgeSpaceId, maxManifests: 2 }),
    ).resolves.toBe(1);

    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "document_multimodal_manifests",
      }),
    );
    expect(fake.calls[0]?.sql).toContain(
      'ON CONFLICT ("document_asset_id", "version", (COALESCE("publication_generation_id"',
    );
    expect(fake.calls[0]?.sql).not.toContain('"id" = EXCLUDED."id"');
    expect(fake.calls[0]?.sql).not.toContain(
      '"publication_generation_id" = EXCLUDED."publication_generation_id"',
    );
    expect(fake.calls[0]?.sql).not.toContain("document-multimodal-manifest-v1");
    expect(fake.calls[0]?.params).toContain(JSON.stringify([]));
    expect(fake.calls[0]?.params).toContain(JSON.stringify({ source: "test" }));
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        operation: "select",
        params: [documentAssetId, 1],
        tableName: "document_multimodal_manifests",
      }),
    );
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 3,
        operation: "select",
        params: [knowledgeSpaceId, documentAssetId],
      }),
    );
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "delete",
        params: [manifestId],
        tableName: "document_multimodal_manifests",
      }),
    );

    const tidbFake = createFakeManifestExecutor(false);
    const tidbRepository = createDatabaseDocumentMultimodalManifestRepository({
      database: createSchemaDatabaseAdapter({
        executor: tidbFake.executor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: tidbFake.executor }),
      }),
    });
    const original = multimodalManifest({
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
    });
    const retried = multimodalManifest({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
      metadata: { source: "retry" },
      publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
    });
    await tidbRepository.upsert(original);
    await expect(
      tidbRepository.listByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxManifests: 2,
      }),
    ).resolves.toHaveLength(1);
    await expect(tidbRepository.upsert(original)).resolves.toEqual(original);
    await expect(tidbRepository.upsert(retried)).rejects.toMatchObject({
      code: "GENERATION_SCOPED_COMPONENT_CONFLICT",
    });
    expect(tidbFake.calls[0]?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(tidbFake.calls[0]?.sql).not.toContain("ON CONFLICT");
    expect(tidbFake.calls[0]?.sql).not.toContain("`id` = VALUES(`id`)");
    expect(tidbFake.calls[0]?.sql).not.toContain(
      "`publication_generation_id` = VALUES(`publication_generation_id`)",
    );
    expect(tidbFake.calls.find((call) => call.sql.includes("ORDER BY `id` ASC"))?.sql).toContain(
      "WHERE `knowledge_space_id` = ? AND `document_asset_id` = ?",
    );
  });
});

function multimodalManifest(overrides: Record<string, unknown> = {}) {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-06-23T00:00:00.000Z",
    documentAssetId,
    id: manifestId,
    items: [],
    knowledgeSpaceId,
    manifestVersion: "document-multimodal-manifest-v1",
    metadata: { source: "test" },
    parseArtifactId,
    version: 1,
    ...overrides,
  };
}

function createFakeManifestExecutor(returnInsertRows = true): {
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
        const incoming = rowFromParams(input.params);
        stored = stored
          ? {
              ...incoming,
              document_asset_id: stored.document_asset_id,
              id: stored.id,
              knowledge_space_id: stored.knowledge_space_id,
              publication_generation_id: stored.publication_generation_id,
              version: stored.version,
            }
          : incoming;

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

      if (input.operation === "delete") {
        const rowsAffected = stored ? 1 : 0;
        stored = null;

        return {
          rows: [],
          rowsAffected,
        };
      }

      return {
        rows: [],
        rowsAffected: 0,
      };
    },
  };
}

function rowFromParams(params: readonly unknown[]): DatabaseRow {
  return {
    artifact_hash: params[6],
    created_at: params[10],
    document_asset_id: params[3],
    id: params[0],
    items: params[8],
    knowledge_space_id: params[1],
    manifest_version: params[7],
    metadata: params[9],
    parse_artifact_id: params[4],
    publication_generation_id: params[2],
    updated_at: params[11],
    version: params[5],
  };
}
