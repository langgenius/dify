import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type ArtifactSegment,
  ArtifactSegmentSchema,
  type DatabaseExecuteInput,
  type DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  ArtifactSegmentBatchSizeExceededError,
  ArtifactSegmentCapacityExceededError,
  ArtifactSegmentListLimitExceededError,
  createDatabaseArtifactSegmentRepository,
  createInMemoryArtifactSegmentRepository,
} from "./artifact-segment-repository";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const createdAt = "2026-05-27T10:00:00.000Z";

describe("artifact segment repository", () => {
  it("creates clone-isolated segment batches and lists by artifact index", async () => {
    const repository = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 3,
      maxListLimit: 2,
      maxSegments: 10,
    });

    const created = await repository.createMany({
      segments: [segment(0, "alpha"), segment(1, "bravo"), segment(2, "charlie")],
    });
    const firstCreated = created[0];
    if (!firstCreated) {
      throw new Error("Expected a created artifact segment");
    }
    firstCreated.metadata.mutated = true;

    const firstPage = await repository.listByArtifact({
      knowledgeSpaceId,
      limit: 2,
      parseArtifactId,
    });
    const firstPageItem = firstPage.items[0];
    if (!firstPageItem) {
      throw new Error("Expected a listed artifact segment");
    }
    firstPageItem.metadata.pageMutation = true;

    expect(firstPage).toMatchObject({
      items: [
        { inlineText: "alpha", segmentIndex: 0 },
        { inlineText: "bravo", segmentIndex: 1 },
      ],
      nextCursor: 1,
    });
    await expect(
      repository.listByArtifact({
        cursor: firstPage.nextCursor,
        knowledgeSpaceId,
        limit: 2,
        parseArtifactId,
      }),
    ).resolves.toMatchObject({
      items: [{ inlineText: "charlie", metadata: {}, segmentIndex: 2 }],
    });
  });

  it("finds segments by checksum within a knowledge space", async () => {
    const repository = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 5,
      maxListLimit: 5,
      maxSegments: 10,
    });
    const checksum = "b".repeat(64);

    await repository.createMany({
      segments: [
        segment(0, "alpha", { checksum }),
        segment(1, "bravo"),
        segment(0, "other-space", {
          checksum,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e00",
          knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
        }),
      ],
    });

    await expect(
      repository.listByChecksum({
        checksum,
        knowledgeSpaceId,
        limit: 5,
      }),
    ).resolves.toMatchObject({
      items: [{ inlineText: "alpha", segmentIndex: 0 }],
    });
  });

  it("lists and deletes a bounded exact document segment scope", async () => {
    const repository = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 5,
      maxListLimit: 5,
      maxSegments: 10,
    });
    await repository.createMany({
      segments: [
        segment(0, "target"),
        segment(1, "other-document", {
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
        }),
      ],
    });

    await expect(
      repository.listByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxSegments: 1,
      }),
    ).resolves.toMatchObject([{ inlineText: "target" }]);
    await expect(
      repository.deleteByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxSegments: 1,
      }),
    ).resolves.toBe(1);
    await expect(
      repository.listByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxSegments: 1,
      }),
    ).resolves.toEqual([]);
  });

  it("enforces batch, list, capacity, and duplicate artifact/index bounds", async () => {
    const repository = createInMemoryArtifactSegmentRepository({
      maxBatchSize: 1,
      maxListLimit: 1,
      maxSegments: 1,
    });

    await expect(
      repository.createMany({ segments: [segment(0, "alpha"), segment(1, "bravo")] }),
    ).rejects.toBeInstanceOf(ArtifactSegmentBatchSizeExceededError);
    await expect(repository.createMany({ segments: [segment(0, "alpha")] })).resolves.toHaveLength(
      1,
    );
    await expect(
      repository.createMany({ segments: [segment(0, "duplicate")] }),
    ).resolves.toMatchObject([{ inlineText: "duplicate", segmentIndex: 0 }]);
    await expect(repository.createMany({ segments: [segment(1, "bravo")] })).rejects.toBeInstanceOf(
      ArtifactSegmentCapacityExceededError,
    );
    await expect(
      repository.listByArtifact({
        knowledgeSpaceId,
        limit: 2,
        parseArtifactId,
      }),
    ).rejects.toBeInstanceOf(ArtifactSegmentListLimitExceededError);
  });

  it("persists and pages artifact segments through dialect-safe database queries", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const row = segmentRow(segment(0, "alpha"));
    const executor = async (input: DatabaseExecuteInput) => {
      calls.push(input);

      return {
        rows: input.operation === "delete" ? [] : [row],
        rowsAffected: 1,
      };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: executor }),
    });
    const repository = createDatabaseArtifactSegmentRepository({
      database,
      maxBatchSize: 10,
      maxListLimit: 10,
    });

    await expect(repository.createMany({ segments: [segment(0, "alpha")] })).resolves.toMatchObject(
      [{ inlineText: "alpha", segmentIndex: 0 }],
    );
    await expect(
      repository.listByArtifact({ knowledgeSpaceId, limit: 2, parseArtifactId }),
    ).resolves.toMatchObject({ items: [{ inlineText: "alpha", segmentIndex: 0 }] });
    await expect(
      repository.listByChecksum({
        checksum: "a".repeat(64),
        knowledgeSpaceId,
        limit: 2,
      }),
    ).resolves.toMatchObject({ items: [{ inlineText: "alpha", segmentIndex: 0 }] });

    expect(calls[0]).toMatchObject({
      maxRows: 1,
      operation: "insert",
      tableName: "artifact_segments",
    });
    expect(calls[0]?.sql).toContain('ON CONFLICT ("parse_artifact_id", "segment_index")');
    expect(calls[0]?.sql).toContain("$15::jsonb");
    expect(calls[1]?.sql).toContain('ORDER BY "segment_index" ASC, "id" ASC');
    expect(calls[2]?.sql).toContain('ORDER BY "id" ASC');

    await expect(
      repository.listByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxSegments: 2,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      repository.deleteByDocumentAsset({
        documentAssetId,
        knowledgeSpaceId,
        maxSegments: 2,
      }),
    ).resolves.toBe(1);
    expect(calls.at(-3)?.sql).toContain(
      'WHERE "knowledge_space_id" = $1 AND "document_asset_id" = $2',
    );
    expect(calls.at(-2)?.sql).toContain("FOR UPDATE");
    expect(calls.at(-1)).toEqual(
      expect.objectContaining({
        operation: "delete",
        params: [knowledgeSpaceId, documentAssetId, row.id],
      }),
    );

    const tidbCalls: DatabaseExecuteInput[] = [];
    const tidbExecutor = async (input: DatabaseExecuteInput) => {
      tidbCalls.push(input);

      return { rows: [], rowsAffected: 1 };
    };
    const tidbRepository = createDatabaseArtifactSegmentRepository({
      database: createSchemaDatabaseAdapter({
        executor: tidbExecutor,
        kind: "tidb",
        transaction: async (callback) => callback({ execute: tidbExecutor }),
      }),
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    await tidbRepository.createMany({ segments: [segment(0, "alpha")] });
    await tidbRepository.listByDocumentAsset({
      documentAssetId,
      knowledgeSpaceId,
      maxSegments: 2,
    });
    await tidbRepository.deleteByDocumentAsset({
      documentAssetId,
      knowledgeSpaceId,
      maxSegments: 2,
    });
    expect(tidbCalls[0]?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(tidbCalls[0]?.sql).toContain("CAST(? AS JSON)");
    expect(tidbCalls[1]?.sql).toContain(
      "WHERE `knowledge_space_id` = ? AND `document_asset_id` = ?",
    );
    expect(tidbCalls[2]?.sql).toContain("FOR UPDATE");
  });
});

function segmentRow(value: ArtifactSegment): DatabaseRow {
  return {
    artifact_hash: value.artifactHash,
    checksum: value.checksum,
    content_encoding: value.contentEncoding,
    created_at: value.createdAt,
    document_asset_id: value.documentAssetId,
    end_offset: value.endOffset ?? null,
    id: value.id,
    inline_text: value.inlineText ?? null,
    knowledge_space_id: value.knowledgeSpaceId,
    metadata: JSON.stringify(value.metadata),
    object_key: value.objectKey ?? null,
    parse_artifact_id: value.parseArtifactId,
    segment_index: value.segmentIndex,
    segment_type: value.segmentType,
    size_bytes: value.sizeBytes ?? null,
    source_location: JSON.stringify(value.sourceLocation),
    start_offset: value.startOffset ?? null,
    updated_at: value.updatedAt ?? null,
  };
}

function segment(
  segmentIndex: number,
  inlineText: string,
  overrides: Partial<ArtifactSegment> = {},
): ArtifactSegment {
  return ArtifactSegmentSchema.parse({
    artifactHash: "a".repeat(64),
    checksum: "a".repeat(64),
    createdAt,
    documentAssetId,
    id: `018f0d60-7a49-7cc2-9c1b-5b36f18f2d${String(segmentIndex).padStart(2, "0")}`,
    inlineText,
    knowledgeSpaceId,
    parseArtifactId,
    segmentIndex,
    segmentType: "text",
    sourceLocation: {
      startOffset: segmentIndex * 10,
    },
    startOffset: segmentIndex * 10,
    ...overrides,
  });
}
