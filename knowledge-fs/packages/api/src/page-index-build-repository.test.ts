import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult, DocumentOutline } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  PageIndexBuildTermLengthExceededError,
  PageIndexEmptyBuildError,
  PageIndexGenerationBuildConflictError,
  PageIndexReadyBuildConflictError,
  createDatabasePublishedPageIndexBackfillService,
  createDatabasePublishedPageIndexBuildRepository,
  createInMemoryPublishedPageIndexBuildRepository,
} from "./page-index-build-repository";

const spaceId = "10000000-0000-4000-8000-000000000001";
const documentId = "20000000-0000-4000-8000-000000000001";
const outlineId = "30000000-0000-4000-8000-000000000001";
const artifactId = "40000000-0000-4000-8000-000000000001";
const generationId = "50000000-0000-4000-8000-000000000001";

describe("flattened PageIndex build repository", () => {
  it("keeps a ready generation immutable while allowing exact idempotent replay", async () => {
    const repository = createInMemoryPublishedPageIndexBuildRepository({
      maxNodesPerOutline: 10,
      maxTermRowsPerOutline: 100,
    });
    const source = outline();
    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: source,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ status: "building", tokenizerVersion: "pageindex-nfkc-exact-v1" });
    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: source,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ status: "building" });
    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: outline({ summary: "different building content" }),
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(PageIndexGenerationBuildConflictError);
    await repository.promotePublishedBuild({
      fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
      knowledgeSpaceId: spaceId,
      outlineId,
      publicationGenerationId: generationId,
      publicationId: "60000000-0000-4000-8000-000000000001",
      tenantId: "tenant-1",
      updatedAt: source.createdAt,
    });

    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: source,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: outline({ summary: "different immutable content" }),
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(PageIndexReadyBuildConflictError);
  });

  it("fails ingestion when an exact term cannot fit the bounded inverted key", async () => {
    const repository = createInMemoryPublishedPageIndexBuildRepository({
      maxNodesPerOutline: 10,
      maxTermRowsPerOutline: 100,
    });

    await expect(
      repository.materializeBuilding({
        builtAt: "2026-07-14T00:00:00.000Z",
        outline: outline({ title: "x".repeat(129) }),
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(PageIndexBuildTermLengthExceededError);

    await expect(
      repository.materializeBuilding({
        builtAt: "2026-07-14T00:00:00.000Z",
        outline: outline({ title: "𐐀".repeat(100) }),
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(PageIndexBuildTermLengthExceededError);
  });

  it("rejects an empty generation instead of publishing an unusable PageIndex", async () => {
    const repository = createInMemoryPublishedPageIndexBuildRepository({
      maxNodesPerOutline: 10,
      maxTermRowsPerOutline: 100,
    });
    const source = { ...outline(), nodes: [] };

    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: source,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(PageIndexEmptyBuildError);
  });

  it("retires the unsafe arbitrary published/superseded backfill scanner", () => {
    expect(() =>
      createDatabasePublishedPageIndexBackfillService({
        builds: {} as never,
        database: createSchemaDatabaseAdapter({ kind: "postgres" }),
        maxPageSize: 10,
      }),
    ).toThrow("durable frozen-head upgrade runtime");
  });

  it("locks a ready database manifest and never rewrites its child index", async () => {
    const calls: DatabaseExecuteInput[] = [];
    let manifestParams: readonly unknown[] | undefined;
    const nodeRows: Record<string, unknown>[] = [];
    const termRows: Record<string, unknown>[] = [];
    let ready = false;
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "document_outlines" && input.operation === "select") {
        if (input.params[0] !== "tenant-1") {
          return { rows: [], rowsAffected: 0 };
        }
        return {
          rows: [
            {
              outline_artifact_hash: source.artifactHash,
              outline_created_at: source.createdAt,
              outline_document_asset_id: source.documentAssetId,
              outline_id: source.id,
              outline_knowledge_space_id: source.knowledgeSpaceId,
              outline_metadata: JSON.stringify(source.metadata),
              outline_nodes: JSON.stringify(source.nodes),
              outline_outline_version: source.outlineVersion,
              outline_parse_artifact_id: source.parseArtifactId,
              outline_publication_generation_id: source.publicationGenerationId,
              outline_updated_at: null,
              outline_version: source.version,
            },
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "page_index_manifests" && input.operation === "select") {
        if (!manifestParams) {
          return { rows: [], rowsAffected: 0 };
        }
        return {
          rows: [
            {
              checksum: manifestParams[10],
              actual_node_count: nodeRows.length,
              actual_term_count: termRows.length,
              document_asset_id: manifestParams[3],
              document_outline_id: manifestParams[4],
              document_version: manifestParams[5],
              id: manifestParams[0],
              invalid_term_count: 0,
              knowledge_space_id: manifestParams[1],
              node_count: manifestParams[8],
              publication_generation_id: manifestParams[2],
              status: ready ? "ready" : "building",
              term_count: manifestParams[9],
              tokenizer_version: manifestParams[6],
            },
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "page_index_manifests" && input.operation === "insert") {
        manifestParams = [...input.params];
      }
      if (input.tableName === "page_index_nodes" && input.operation === "insert") {
        for (let index = 0; index < input.params.length; index += 12) {
          nodeRows.push({
            end_offset: input.params[index + 10],
            id: input.params[index],
            level: input.params[index + 8],
            outline_node_id: input.params[index + 2],
            parent_outline_node_id: input.params[index + 3],
            section_path: input.params[index + 6],
            start_offset: input.params[index + 9],
            summary: input.params[index + 5],
            title: input.params[index + 4],
            toc_source: input.params[index + 11],
            visited_node_ids: input.params[index + 7],
          });
        }
      }
      if (input.tableName === "page_index_nodes" && input.operation === "select") {
        return { rows: nodeRows, rowsAffected: nodeRows.length };
      }
      if (input.tableName === "page_index_terms" && input.operation === "insert") {
        for (let index = 0; index < input.params.length; index += 6) {
          termRows.push({
            field_mask: input.params[index + 5],
            id: input.params[index],
            knowledge_space_id: input.params[index + 1],
            page_index_node_id: input.params[index + 3],
            term: input.params[index + 4],
          });
        }
      }
      if (input.tableName === "page_index_terms" && input.operation === "select") {
        return { rows: termRows, rowsAffected: termRows.length };
      }
      return { rows: [], rowsAffected: 1 };
    };
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: "postgres",
      transaction: async (callback) => callback({ execute }),
    });
    const repository = createDatabasePublishedPageIndexBuildRepository({
      database,
      maxNodesPerOutline: 10,
      maxTermRowsPerOutline: 100,
      writeBatchSize: 10,
    });
    const source = outline();
    await repository.materializeBuilding({
      builtAt: source.createdAt,
      outline: source,
      tenantId: "tenant-1",
    });
    const beforeBuildingReplay = calls.length;
    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: source,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ status: "building" });
    expect(
      calls
        .slice(beforeBuildingReplay)
        .some((call) => call.operation === "delete" || call.operation === "insert"),
    ).toBe(false);
    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: outline({ summary: "tampered building" }),
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(PageIndexGenerationBuildConflictError);
    ready = true;
    const beforeReplay = calls.length;

    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: source,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ status: "ready" });
    expect(calls.slice(beforeReplay)).toHaveLength(2);
    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: outline({ summary: "tampered" }),
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(PageIndexGenerationBuildConflictError);
    await expect(
      repository.materializeBuilding({
        builtAt: source.createdAt,
        outline: source,
        tenantId: "tenant-other",
      }),
    ).rejects.toBeInstanceOf(PageIndexGenerationBuildConflictError);
    expect(
      calls
        .slice(beforeReplay)
        .some((call) => call.operation === "delete" || call.operation === "insert"),
    ).toBe(false);
  });
});

function outline(
  overrides: { readonly summary?: string; readonly title?: string } = {},
): DocumentOutline {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-07-14T00:00:00.000Z",
    documentAssetId: documentId,
    id: outlineId,
    knowledgeSpaceId: spaceId,
    metadata: {},
    nodes: [
      {
        childNodeIds: [],
        children: [],
        endOffset: 20,
        id: "section-1",
        level: 1,
        metadata: {},
        sectionPath: ["Camera"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: overrides.summary ?? "Camera warranty",
        title: overrides.title ?? "Camera",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "outline-v1",
    parseArtifactId: artifactId,
    publicationGenerationId: generationId,
    version: 1,
  };
}
