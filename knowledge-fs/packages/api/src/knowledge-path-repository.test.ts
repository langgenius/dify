import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult, KnowledgePath } from "@knowledge/core";
import { KnowledgePathSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  DuplicateKnowledgePathError,
  KnowledgePathCapacityExceededError,
  KnowledgePathListLimitExceededError,
  createDatabaseKnowledgePathRepository,
  createInMemoryKnowledgePathRepository,
} from "./knowledge-path-repository";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";

function knowledgePath(overrides: Partial<KnowledgePath> = {}): KnowledgePath {
  return KnowledgePathSchema.parse({
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a00",
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    metadata: { label: "Readme" },
    resourceType: "document",
    targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
    version: 1,
    viewName: "source",
    viewType: "physical",
    virtualPath: "/sources/documents/readme.md",
    ...overrides,
  });
}

function createFakeKnowledgePathExecutor(returnInsertRows = true) {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });

    if (input.operation === "insert") {
      const isBatch = input.params.length > 10;
      const inserted: Record<string, unknown>[] = [];

      for (let offset = 0; offset < input.params.length; offset += 10) {
        const [
          id,
          knowledgeSpaceId,
          publicationGenerationId,
          virtualPath,
          resourceType,
          targetId,
          version,
          viewType,
          viewName,
          metadata,
        ] = input.params.slice(offset, offset + 10);
        const row = {
          id,
          knowledge_space_id: knowledgeSpaceId,
          metadata:
            typeof metadata === "string" ? (JSON.parse(metadata) as Record<string, unknown>) : {},
          publication_generation_id: publicationGenerationId,
          resource_type: resourceType,
          target_id: targetId,
          version,
          view_name: viewName,
          view_type: viewType,
          virtual_path: virtualPath,
        };

        const key = `${knowledgeSpaceId}:${publicationGenerationId ?? "legacy"}:${virtualPath}`;
        const existing = rows.get(key);
        const stored = existing
          ? {
              ...row,
              id: existing.id,
              knowledge_space_id: existing.knowledge_space_id,
              publication_generation_id: existing.publication_generation_id,
              virtual_path: existing.virtual_path,
            }
          : row;
        rows.set(key, stored);
        inserted.push({ ...stored });
      }

      return {
        rows: returnInsertRows ? (isBatch ? inserted : inserted.slice(0, 1)) : [],
        rowsAffected: inserted.length,
      };
    }

    const [knowledgeSpaceId, viewTypeOrVirtualPath, maybeViewName] = input.params;

    if (input.sql.includes("ORDER BY")) {
      const viewType = String(viewTypeOrVirtualPath);
      const viewName = String(maybeViewName);
      const limit = Number(input.params.at(-1));
      const selected = Array.from(rows.values())
        .filter((row) => row.knowledge_space_id === knowledgeSpaceId)
        .filter((row) => row.view_type === viewType)
        .filter((row) => row.view_name === viewName)
        .sort((left, right) => String(left.virtual_path).localeCompare(String(right.virtual_path)))
        .slice(0, limit)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    const publicationGenerationId = input.params.length === 3 ? input.params[2] : undefined;
    const found = rows.get(
      `${knowledgeSpaceId}:${publicationGenerationId ?? "legacy"}:${viewTypeOrVirtualPath}`,
    );

    return { rows: found ? [{ ...found }] : [], rowsAffected: found ? 1 : 0 };
  };

  return { calls, executor };
}

describe("KnowledgePath repositories", () => {
  it("keeps the same virtual path isolated across publication generations", async () => {
    const repository = createInMemoryKnowledgePathRepository({
      maxListLimit: 2,
      maxPaths: 2,
    });
    const firstGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10";
    const secondGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a11";
    const first = knowledgePath({ publicationGenerationId: firstGeneration });
    const second = knowledgePath({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a12",
      publicationGenerationId: secondGeneration,
    });

    await repository.create(first);
    await repository.create(second);

    await expect(
      repository.get({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        publicationGenerationId: firstGeneration,
        virtualPath: first.virtualPath,
      }),
    ).resolves.toEqual(first);
    await expect(
      repository.get({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        publicationGenerationId: secondGeneration,
        virtualPath: second.virtualPath,
      }),
    ).resolves.toEqual(second);
    await expect(
      repository.get({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        virtualPath: first.virtualPath,
      }),
    ).resolves.toBeNull();
  });

  it("stores bounded in-memory paths with clone isolation and stable cursor pagination", async () => {
    const repository = createInMemoryKnowledgePathRepository({
      maxListLimit: 1,
      maxPaths: 3,
    });

    const first = await repository.create(knowledgePath());
    const second = await repository.create(
      knowledgePath({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
        metadata: { label: "Guide" },
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        virtualPath: "/sources/documents/guide.md",
      }),
    );

    first.metadata.label = "mutated";

    await expect(
      repository.get({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, virtualPath: first.virtualPath }),
    ).resolves.toEqual(expect.objectContaining({ metadata: { label: "Readme" } }));
    await expect(
      repository.listPhysicalView({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 1,
        viewName: "source",
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: second.id })],
      nextCursor: { id: second.id, virtualPath: second.virtualPath },
    });
    await expect(
      repository.create(
        knowledgePath({
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a02",
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateKnowledgePathError);
    await expect(
      repository.listPhysicalView({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 2,
        viewName: "source",
      }),
    ).rejects.toBeInstanceOf(KnowledgePathListLimitExceededError);
    await repository.create(
      knowledgePath({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a03",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        virtualPath: "/sources/documents/third.md",
      }),
    );
    await expect(
      repository.create(
        knowledgePath({
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a04",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          virtualPath: "/sources/documents/fourth.md",
        }),
      ),
    ).rejects.toBeInstanceOf(KnowledgePathCapacityExceededError);
  });

  it("deletes only bounded document-target paths in the requested knowledge space", async () => {
    const repository = createInMemoryKnowledgePathRepository({
      maxListLimit: 4,
      maxPaths: 4,
    });
    const target = knowledgePath();
    const targetSemantic = knowledgePath({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
      viewName: "topic",
      viewType: "semantic",
      virtualPath: "/knowledge/topics/readme.md",
    });
    const retained = knowledgePath({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a02",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
      virtualPath: "/sources/documents/retained.md",
    });
    await repository.upsertMany([target, targetSemantic, retained]);

    await expect(
      repository.deleteByDocumentAsset({
        documentAssetId: target.targetId,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        maxPaths: 2,
      }),
    ).resolves.toBe(2);
    await expect(
      repository.get({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        virtualPath: retained.virtualPath,
      }),
    ).resolves.toEqual(retained);
  });

  it.each(["postgres", "tidb"] as const)(
    "uses bounded and exact %s document path deletion SQL",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const path = knowledgePath();
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return input.operation === "select"
          ? { rows: [{ id: path.id, publication_generation_id: null }], rowsAffected: 1 }
          : { rows: [], rowsAffected: 1 };
      };
      const repository = createDatabaseKnowledgePathRepository({
        database: createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => callback({ execute: executor }),
        }),
        maxListLimit: 2,
      });

      await expect(
        repository.deleteByDocumentAsset({
          documentAssetId: path.targetId,
          knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
          maxPaths: 1,
        }),
      ).resolves.toBe(1);
      expect(calls[0]).toEqual(
        expect.objectContaining({
          maxRows: 2,
          operation: "select",
          params: [KNOWLEDGE_SPACE_ID, "document", path.targetId],
        }),
      );
      expect(calls[0]?.sql).toContain(
        kind === "postgres"
          ? '"knowledge_space_id" = $1 AND "resource_type" = $2 AND "target_id" = $3'
          : "`knowledge_space_id` = ? AND `resource_type` = ? AND `target_id` = ?",
      );
      expect(calls[1]).toEqual(
        expect.objectContaining({
          operation: "delete",
          params: [KNOWLEDGE_SPACE_ID, path.id],
        }),
      );
    },
  );

  it("accepts only exact replay for a generation-scoped path", async () => {
    const repository = createInMemoryKnowledgePathRepository({
      maxListLimit: 2,
      maxPaths: 1,
    });
    const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10";
    const original = knowledgePath({ publicationGenerationId });
    const retried = knowledgePath({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7aff",
      metadata: { label: "Retried" },
      publicationGenerationId,
    });

    await repository.upsertMany([original]);
    await expect(repository.upsertMany([original])).resolves.toEqual([original]);
    await expect(repository.upsertMany([retried])).rejects.toMatchObject({
      code: "GENERATION_SCOPED_COMPONENT_CONFLICT",
    });
    await expect(
      repository.get({
        knowledgeSpaceId: original.knowledgeSpaceId,
        publicationGenerationId,
        virtualPath: original.virtualPath,
      }),
    ).resolves.toEqual(original);
  });

  it.each(["postgres", "tidb"] as const)(
    "accepts exact database path replay and rejects differing %s replay",
    async (kind) => {
      const fake = createFakeKnowledgePathExecutor(kind === "postgres");
      const repository = createDatabaseKnowledgePathRepository({
        database: createSchemaDatabaseAdapter({
          executor: fake.executor,
          kind,
          transaction: async (callback) => callback({ execute: fake.executor }),
        }),
        maxListLimit: 2,
      });
      const publicationGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10";
      const original = knowledgePath({ publicationGenerationId });
      const retried = knowledgePath({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7aff",
        metadata: { label: "Retried" },
        publicationGenerationId,
      });

      await repository.upsertMany([original]);
      await expect(repository.upsertMany([original])).resolves.toEqual([original]);
      await expect(repository.upsertMany([retried])).rejects.toMatchObject({
        code: "GENERATION_SCOPED_COMPONENT_CONFLICT",
      });

      const upsertSql = fake.calls.filter((call) => call.operation === "insert").at(-1)?.sql ?? "";
      for (const column of [
        "id",
        "knowledge_space_id",
        "publication_generation_id",
        "virtual_path",
      ]) {
        expect(upsertSql).not.toContain(`"${column}" = EXCLUDED."${column}"`);
        expect(upsertSql).not.toContain(`\`${column}\` = VALUES(\`${column}\`)`);
      }
    },
  );

  it("uses parameterized bounded SQL for database path writes and reads", async () => {
    const fake = createFakeKnowledgePathExecutor();
    const repository = createDatabaseKnowledgePathRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      maxListLimit: 2,
    });
    const path = knowledgePath();

    await expect(repository.create(path)).resolves.toEqual(path);
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "knowledge_paths",
      }),
    );
    expect(fake.calls[0]?.params).toContain(path.virtualPath);
    expect(fake.calls[0]?.sql).not.toContain(path.virtualPath);

    await expect(
      repository.get({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, virtualPath: path.virtualPath }),
    ).resolves.toEqual(path);
    expect(fake.calls[1]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [KNOWLEDGE_SPACE_ID, path.virtualPath],
      }),
    );

    await expect(
      repository.listPhysicalView({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 1,
        viewName: "source",
      }),
    ).resolves.toEqual({
      items: [path],
    });
    expect(fake.calls[2]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: [KNOWLEDGE_SPACE_ID, "physical", "source", 2],
      }),
    );
  });
});
