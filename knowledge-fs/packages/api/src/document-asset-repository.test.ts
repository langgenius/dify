import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  DocumentAssetCapacityExceededError,
  createDatabaseDocumentAssetRepository,
  createInMemoryDocumentAssetRepository,
} from "./document-asset-repository";

interface DocumentAssetRow {
  created_at: string;
  filename: string;
  id: string;
  knowledge_space_id: string;
  metadata: Record<string, unknown>;
  mime_type: string;
  object_key: string;
  parser_status: string;
  sha256: string;
  size_bytes: number;
  source_id?: null | string;
  version: number;
}

function createFakeDocumentAssetExecutor() {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, DocumentAssetRow>();
  let rejectNextDelete = false;
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert") {
      const [
        id,
        knowledgeSpaceId,
        sourceId,
        filename,
        mimeType,
        objectKey,
        sha256,
        sizeBytes,
        metadata,
        parserStatus,
        version,
        createdAt,
      ] = input.params;
      const row = {
        created_at: String(createdAt),
        filename: String(filename),
        id: String(id),
        knowledge_space_id: String(knowledgeSpaceId),
        metadata:
          typeof metadata === "string" ? (JSON.parse(metadata) as Record<string, unknown>) : {},
        mime_type: String(mimeType),
        object_key: String(objectKey),
        parser_status: String(parserStatus),
        sha256: String(sha256),
        size_bytes: Number(sizeBytes),
        source_id: sourceId === null ? null : String(sourceId),
        version: Number(version),
      };
      rows.set(row.id, row);

      return { rows: [{ ...row }], rowsAffected: 1 };
    }

    if (input.operation === "update") {
      const [parserStatus, id, knowledgeSpaceId] = input.params;
      const row = rows.get(String(id));

      if (!row || row.knowledge_space_id !== knowledgeSpaceId) {
        return { rows: [], rowsAffected: 0 };
      }

      const updated = { ...row, parser_status: String(parserStatus) };
      rows.set(updated.id, updated);

      return { rows: [{ ...updated }], rowsAffected: 1 };
    }

    if (input.operation === "delete") {
      const [id, knowledgeSpaceId] = input.params;
      const row = rows.get(String(id));

      if (rejectNextDelete || !row || row.knowledge_space_id !== knowledgeSpaceId) {
        rejectNextDelete = false;
        return { rows: [], rowsAffected: 0 };
      }

      rows.delete(row.id);

      return { rows: [], rowsAffected: 1 };
    }

    if (input.sql.includes("COUNT(*)")) {
      const [knowledgeSpaceId] = input.params;
      const selected = Array.from(rows.values()).filter(
        (row) => row.knowledge_space_id === knowledgeSpaceId,
      );

      return {
        rows: [
          {
            document_count: selected.length,
            raw_document_bytes: selected.reduce((sum, row) => sum + row.size_bytes, 0),
          },
        ],
        rowsAffected: 1,
      };
    }

    if (input.sql.includes("ORDER BY")) {
      const [knowledgeSpaceId, cursorOrLimit, maybeLimit] = input.params;
      const cursor = maybeLimit === undefined ? undefined : String(cursorOrLimit);
      const limit = Number(maybeLimit ?? cursorOrLimit);
      const selected = Array.from(rows.values())
        .filter((row) => row.knowledge_space_id === knowledgeSpaceId)
        .filter((row) => (cursor ? row.id > cursor : true))
        .sort((first, second) => first.id.localeCompare(second.id))
        .slice(0, limit)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    const [id, knowledgeSpaceId] = input.params;
    const row = rows.get(String(id));
    const selected = row && row.knowledge_space_id === knowledgeSpaceId ? [{ ...row }] : [];

    return { rows: selected, rowsAffected: selected.length };
  };

  return {
    calls,
    executor,
    rejectNextDelete: () => {
      rejectNextDelete = true;
    },
    rows,
  };
}

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const DOCUMENT_ASSET_ID_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const DOCUMENT_ASSET_ID_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const DOCUMENT_ASSET_ID_C = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const SOURCE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

function createDocumentAssetInput(id: string, knowledgeSpaceId = KNOWLEDGE_SPACE_ID) {
  return {
    filename: `${id}.md`,
    id,
    knowledgeSpaceId,
    metadata: { traceId: `trace-${id}` },
    mimeType: "text/markdown",
    objectKey: `tenant/spaces/${knowledgeSpaceId}/documents/${id}/${id}.md`,
    sha256: "a".repeat(64),
    sizeBytes: 12,
    sourceId: SOURCE_ID,
  };
}

describe("DocumentAsset repositories", () => {
  it("lists assets by source id, scoped to the knowledge space", async () => {
    const repository = createInMemoryDocumentAssetRepository({ maxAssets: 5 });
    const otherSource = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99";

    await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_A));
    await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_B));
    await repository.create({
      ...createDocumentAssetInput(DOCUMENT_ASSET_ID_C),
      sourceId: otherSource,
    });

    const forSource = await repository.listBySource({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 10,
      sourceId: SOURCE_ID,
    });
    expect(forSource.items.map((asset) => asset.id)).toEqual([
      DOCUMENT_ASSET_ID_A,
      DOCUMENT_ASSET_ID_B,
    ]);

    const forOther = await repository.listBySource({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 10,
      sourceId: otherSource,
    });
    expect(forOther.items.map((asset) => asset.id)).toEqual([DOCUMENT_ASSET_ID_C]);
  });

  it("stores bounded in-memory assets with clone isolation, pagination, and usage stats", async () => {
    const repository = createInMemoryDocumentAssetRepository({
      maxAssets: 2,
      now: () => "2026-05-11T13:00:00.000Z",
    });

    const first = await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_A));
    const second = await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_B));
    first.metadata.traceId = "mutated";

    await expect(
      repository.get({ id: first.id, knowledgeSpaceId: first.knowledgeSpaceId }),
    ).resolves.toEqual(
      expect.objectContaining({
        metadata: { traceId: `trace-${DOCUMENT_ASSET_ID_A}` },
        parserStatus: "pending",
        version: 1,
      }),
    );
    await expect(
      repository.getStorageUsage({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).resolves.toEqual({
      documentCount: 2,
      rawDocumentBytes: 24,
    });
    await expect(
      repository.list({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 1 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: first.id })],
      nextCursor: { id: first.id },
    });
    await expect(
      repository.list({ cursor: { id: first.id }, knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 1 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: second.id })],
    });
    await expect(
      repository.list({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 0 }),
    ).rejects.toThrow("Document asset list limit must be at least 1");
    await expect(
      repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_C)),
    ).rejects.toBeInstanceOf(DocumentAssetCapacityExceededError);
    expect(() => createInMemoryDocumentAssetRepository({ maxAssets: 0 })).toThrow(
      "Document asset repository maxAssets must be at least 1",
    );
  });

  it("hides a late active child as soon as its parent Source becomes unreadable", async () => {
    let parentSourceReadable = true;
    const repository = createInMemoryDocumentAssetRepository({
      isParentSourceReadable: ({ sourceId }) => sourceId !== SOURCE_ID || parentSourceReadable,
      maxAssets: 2,
    });
    const child = await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_A));
    const standalone = await repository.create({
      ...createDocumentAssetInput(DOCUMENT_ASSET_ID_B),
      sourceId: undefined,
    });

    parentSourceReadable = false;

    await expect(
      repository.get({ id: child.id, knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).resolves.toBeNull();
    await expect(
      repository.getForDeletion({ id: child.id, knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).resolves.toEqual(child);
    await expect(
      repository.list({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 10 }),
    ).resolves.toEqual({ items: [standalone] });
    await expect(
      repository.listBySource({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 10,
        sourceId: SOURCE_ID,
      }),
    ).resolves.toEqual({ items: [] });
    await expect(
      repository.getStorageUsage({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID }),
    ).resolves.toEqual({ documentCount: 1, rawDocumentBytes: standalone.sizeBytes });
  });

  it("only rolls back the exact in-memory asset write identified by version and object key", async () => {
    const repository = createInMemoryDocumentAssetRepository({ maxAssets: 1 });
    const created = await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_A));

    await expect(
      repository.rollbackStaleWrite({
        expectedObjectKey: `${created.objectKey}.wrong`,
        expectedVersion: created.version,
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.rollbackStaleWrite({
        expectedObjectKey: created.objectKey,
        expectedVersion: created.version + 1,
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.get({ id: created.id, knowledgeSpaceId: created.knowledgeSpaceId }),
    ).resolves.toEqual(created);
    await expect(
      repository.rollbackStaleWrite({
        expectedObjectKey: created.objectKey,
        expectedVersion: created.version,
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
      }),
    ).resolves.toEqual(created);
  });

  it("uses parameterized bounded SQL for database create, list, status update, and rollback", async () => {
    const fake = createFakeDocumentAssetExecutor();
    const repository = createDatabaseDocumentAssetRepository({
      database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: "postgres" }),
      now: () => "2026-05-11T13:00:00.000Z",
    });

    const created = await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_A));

    expect(created).toEqual(
      expect.objectContaining({
        id: DOCUMENT_ASSET_ID_A,
        metadata: { traceId: `trace-${DOCUMENT_ASSET_ID_A}` },
        parserStatus: "pending",
      }),
    );
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "document_assets",
      }),
    );
    expect(fake.calls[0]?.params).toContain(
      JSON.stringify({ traceId: `trace-${DOCUMENT_ASSET_ID_A}` }),
    );
    expect(fake.calls[0]?.sql).not.toContain(`${DOCUMENT_ASSET_ID_A}.md`);

    await expect(
      repository.get({ id: created.id, knowledgeSpaceId: created.knowledgeSpaceId }),
    ).resolves.toEqual(created);
    expect(fake.calls[1]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [created.id, created.knowledgeSpaceId],
        tableName: "document_assets",
      }),
    );
    expect(fake.calls[1]?.sql).not.toContain(created.id);
    expect(fake.calls[1]?.sql).toContain("\"lifecycle_state\" = 'active'");

    await expect(
      repository.list({ knowledgeSpaceId: created.knowledgeSpaceId, limit: 1 }),
    ).resolves.toEqual({
      items: [created],
    });
    expect(fake.calls[2]).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "select",
        params: [created.knowledgeSpaceId, 2],
      }),
    );
    expect(fake.calls[2]?.sql).toContain("\"lifecycle_state\" = 'active'");

    await expect(
      repository.updateParserStatus({
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
        parserStatus: "parsed",
      }),
    ).resolves.toEqual(expect.objectContaining({ parserStatus: "parsed" }));
    expect(fake.calls[3]).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "update",
        params: ["parsed", created.id, created.knowledgeSpaceId],
      }),
    );
    expect(fake.calls[3]?.sql).toContain("\"lifecycle_state\" = 'active'");
    expect(fake.calls[3]?.sql).toContain('"deletion_job_id" IS NULL');

    await expect(
      repository.rollbackStaleWrite({
        expectedObjectKey: created.objectKey,
        expectedVersion: created.version,
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: created.id, parserStatus: "parsed" }));
    expect(fake.calls.at(-1)).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "delete",
        params: [created.id, created.knowledgeSpaceId, created.version, created.objectKey],
      }),
    );
  });

  it.each(["postgres", "tidb"] as const)(
    "keeps ordinary reads active-only while deletion replay can read a fenced asset for %s",
    async (dialect) => {
      const fake = createFakeDocumentAssetExecutor();
      const repository = createDatabaseDocumentAssetRepository({
        database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
      });
      const created = await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_A));

      await repository.get({ id: created.id, knowledgeSpaceId: created.knowledgeSpaceId });
      await repository.getForDeletion({
        id: created.id,
        knowledgeSpaceId: created.knowledgeSpaceId,
      });

      expect(fake.calls[1]?.sql).toContain(
        dialect === "postgres" ? "\"lifecycle_state\" = 'active'" : "`lifecycle_state` = 'active'",
      );
      expect(fake.calls[2]?.params).toEqual([created.id, created.knowledgeSpaceId]);
      expect(fake.calls[2]?.sql).not.toContain("lifecycle_state");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "closes every active document read over a non-deleting parent Source for %s",
    async (dialect) => {
      const fake = createFakeDocumentAssetExecutor();
      const repository = createDatabaseDocumentAssetRepository({
        database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
      });
      const created = await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_A));

      await repository.get({ id: created.id, knowledgeSpaceId: created.knowledgeSpaceId });
      await repository.list({ knowledgeSpaceId: created.knowledgeSpaceId, limit: 1 });
      await repository.listBySource({
        knowledgeSpaceId: created.knowledgeSpaceId,
        limit: 1,
        sourceId: SOURCE_ID,
      });
      await repository.getStorageUsage({ knowledgeSpaceId: created.knowledgeSpaceId });

      const publicReads = fake.calls.slice(1);
      expect(publicReads).toHaveLength(4);
      for (const read of publicReads) {
        expect(read.sql).toContain("sources");
        expect(read.sql).toContain("source_id");
        expect(read.sql).toContain("IS NULL OR EXISTS");
        expect(read.sql).toContain("status");
        expect(read.sql).toContain("<> 'deleting'");
        expect(read.sql).toContain("deletion_job_id");
        expect(read.sql).toContain("IS NULL");
      }
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "does not roll back a stale write after its durable deletion fence wins for %s",
    async (dialect) => {
      const fake = createFakeDocumentAssetExecutor();
      const repository = createDatabaseDocumentAssetRepository({
        database: createSchemaDatabaseAdapter({ executor: fake.executor, kind: dialect }),
      });
      const created = await repository.create(createDocumentAssetInput(DOCUMENT_ASSET_ID_A));

      fake.rejectNextDelete();
      await expect(
        repository.rollbackStaleWrite({
          expectedObjectKey: created.objectKey,
          expectedVersion: created.version,
          id: created.id,
          knowledgeSpaceId: created.knowledgeSpaceId,
        }),
      ).resolves.toBeNull();

      const deletion = fake.calls.find((call) => call.operation === "delete");
      expect(deletion?.sql).toContain(
        dialect === "postgres" ? "\"lifecycle_state\" = 'active'" : "`lifecycle_state` = 'active'",
      );
      expect(deletion?.sql).toContain(
        dialect === "postgres" ? '"deletion_job_id" IS NULL' : "`deletion_job_id` IS NULL",
      );
      expect(deletion?.sql).toContain(dialect === "postgres" ? '"version" = $3' : "`version` = ?");
      expect(deletion?.sql).toContain(
        dialect === "postgres" ? '"object_key" = $4' : "`object_key` = ?",
      );
    },
  );
});
