import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  createDatabaseDocumentChunkRepository,
  createDocumentChunkStateService,
  createInMemoryDocumentChunkRepository,
} from "./document-chunk-repository";
import { createInMemoryLogicalDocumentRepository } from "./logical-document-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
const chunkId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21";

describe("document chunk repository", () => {
  it("keeps enable/disable changes candidate-only until their publication is activated", async () => {
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      generateDocumentId: () => documentId,
      maxDocuments: 10,
      maxRevisionsPerDocument: 10,
    });
    const created = await logicalDocuments.createCandidateRevision({
      contentHash: "a".repeat(64),
      documentAssetId: assetId,
      documentAssetVersion: 1,
      knowledgeSpaceId,
      mimeType: "text/plain",
      now: "2026-07-14T12:00:00.000Z",
      sizeBytes: 12,
      systemMetadata: {},
      tenantId,
      title: "Chunk publication",
    });
    await logicalDocuments.activateRevision({
      documentId,
      expectedActiveRevision: null,
      expectedRowVersion: 0,
      knowledgeSpaceId,
      now: "2026-07-14T12:01:00.000Z",
      revision: created.revision.revision,
      tenantId,
    });
    let nextChange = 1;
    const chunks = createInMemoryDocumentChunkRepository({
      generateChangeId: () =>
        `018f0d60-7a49-7cc2-9c1b-${String(300 + nextChange++).padStart(12, "0")}`,
      maxChunks: 10,
    });
    await chunks.createMany([
      {
        createdAt: "2026-07-14T12:00:00.000Z",
        documentId,
        documentRevision: 1,
        id: chunkId,
        knowledgeSpaceId,
        ordinal: 0,
        systemMetadata: {},
        tenantId,
        text: "candidate state",
        tokenCount: 2,
      },
    ]);
    let nextCompilation = 1;
    const stagingOrder: string[] = [];
    const compilationJobs = {
      cancel: vi.fn(),
      releaseDispatch: vi.fn(async () => {
        stagingOrder.push("release");
      }),
      start: vi.fn(async () => {
        stagingOrder.push("start");
        return { id: `compilation-${nextCompilation++}` };
      }),
    };
    const service = createDocumentChunkStateService({
      chunks: {
        ...chunks,
        stageStateChange: async (input) => {
          stagingOrder.push("stage");
          return chunks.stageStateChange(input);
        },
      },
      compilationJobs: compilationJobs as never,
      logicalDocuments,
    });

    const disabledCandidate = await service.request({
      chunkId,
      documentId,
      documentRevision: 1,
      enabled: false,
      knowledgeSpaceId,
      now: "2026-07-14T12:02:00.000Z",
      tenantId,
    });
    expect(stagingOrder.slice(0, 3)).toEqual(["start", "stage", "release"]);
    expect(compilationJobs.start).toHaveBeenCalledWith(
      expect.objectContaining({ deferDispatch: true }),
    );
    await expect(
      chunks.get({ chunkId, documentId, documentRevision: 1, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ enabled: true });

    const disabled = await chunks.activateStateChange({
      candidateFingerprint: `projection-set-sha256:${"b".repeat(64)}`,
      candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
      changeId: disabledCandidate.id,
      documentId,
      knowledgeSpaceId,
      now: "2026-07-14T12:03:00.000Z",
      tenantId,
    });
    expect(disabled).toMatchObject({ enabled: false, state: "active" });
    await expect(
      chunks.get({ chunkId, documentId, documentRevision: 1, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ enabled: false });

    const enabledCandidate = await service.request({
      chunkId,
      documentId,
      documentRevision: 1,
      enabled: true,
      knowledgeSpaceId,
      now: "2026-07-14T12:04:00.000Z",
      tenantId,
    });
    await chunks.activateStateChange({
      candidateFingerprint: `projection-set-sha256:${"c".repeat(64)}`,
      candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d32",
      changeId: enabledCandidate.id,
      documentId,
      knowledgeSpaceId,
      now: "2026-07-14T12:05:00.000Z",
      tenantId,
    });
    await expect(
      chunks.get({ chunkId, documentId, documentRevision: 1, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ enabled: true });
  });

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`applies the revision asset ACL before chunk pagination (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          return { rows: [], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const repository = createDatabaseDocumentChunkRepository({
        database,
        maxBatchSize: 10,
        maxListLimit: 100,
      });

      await repository.list({
        candidateGrants: ["document:read"],
        documentId,
        documentRevision: 1,
        knowledgeSpaceId,
        limit: 2,
        tenantId,
      });

      const query = calls.at(-1);
      expect(query?.params).toEqual([
        tenantId,
        knowledgeSpaceId,
        documentId,
        1,
        JSON.stringify(["document:read"]),
        3,
      ]);
      expect(query?.sql).toContain("document_revisions");
      expect(query?.sql).toContain("document_assets");
      expect(query?.sql).toContain("permissionScope");
      expect(query?.sql.indexOf("permissionScope")).toBeLessThan(
        query?.sql.lastIndexOf("LIMIT") ?? -1,
      );
      expectAssetDeletionVisibilityBeforeLimit(query?.sql, dialect);
    });
  }
});

function expectAssetDeletionVisibilityBeforeLimit(
  sql: string | undefined,
  dialect: "postgres" | "tidb",
): void {
  expect(sql).toBeDefined();
  const identifier = (value: string) => (dialect === "postgres" ? `"${value}"` : `\`${value}\``);
  const limit = sql?.lastIndexOf("LIMIT") ?? -1;
  for (const predicate of [
    `asset.${identifier("lifecycle_state")} = 'active'`,
    `asset.${identifier("deletion_job_id")} IS NULL`,
    `chunk_list_parent_source.${identifier("status")} <> 'deleting'`,
    `chunk_list_parent_source.${identifier("deletion_job_id")} IS NULL`,
  ]) {
    expect(sql).toContain(predicate);
    expect(sql?.indexOf(predicate)).toBeLessThan(limit);
  }
}
