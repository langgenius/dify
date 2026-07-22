import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  type CreateDocumentRevisionChunkInput,
  type DocumentChunkStateChange,
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
const secondChunkId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d22";
const changeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d23";
const secondChangeId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d24";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d25";
const publicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d26";
const fingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const now = "2026-07-14T12:00:00.000Z";

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

  it("enforces memory chunk identity, hierarchy, pagination, and state-change fences", async () => {
    expect(() => createInMemoryDocumentChunkRepository({ maxChunks: 0 })).toThrow(
      "maxChunks must be positive",
    );
    const chunks = createInMemoryDocumentChunkRepository({ maxChunks: 3 });
    const parentInput = documentChunkInput();
    const childInput = documentChunkInput({
      id: secondChunkId,
      ordinal: 1,
      parentChunkId: chunkId,
      text: "Child searchable text",
    });
    const created = await chunks.createMany([parentInput, childInput]);
    const firstCreated = created[0];
    if (!firstCreated) throw new Error("Expected the parent chunk to be created");
    const returnedSystemMetadata = firstCreated.systemMetadata as Record<string, unknown>;
    returnedSystemMetadata.nested = "mutated";
    await expect(
      chunks.get({ chunkId, documentId, documentRevision: 1, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ systemMetadata: { nested: "original" } });
    await expect(
      chunks.list({
        candidateGrants: [],
        documentId,
        documentRevision: 1,
        knowledgeSpaceId,
        limit: 1,
        tenantId,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: chunkId })],
      nextCursor: { id: chunkId },
    });
    await expect(
      chunks.list({
        candidateGrants: [],
        cursor: { id: chunkId },
        documentId,
        documentRevision: 1,
        knowledgeSpaceId,
        limit: 1,
        query: " SEARCHABLE ",
        tenantId,
      }),
    ).resolves.toEqual({ items: [expect.objectContaining({ id: secondChunkId })] });

    const validation = createInMemoryDocumentChunkRepository({ maxChunks: 10 });
    await expect(
      validation.createMany([
        documentChunkInput(),
        documentChunkInput({ id: secondChunkId, ordinal: 0 }),
      ]),
    ).rejects.toThrow("Document chunk batch contains duplicate ids or ordinals");
    await expect(
      validation.createMany([
        documentChunkInput({ parentChunkId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99" }),
      ]),
    ).rejects.toThrow("Document chunk parent does not exist");
    await validation.createMany([documentChunkInput()]);
    await expect(validation.createMany([documentChunkInput()])).rejects.toThrow(
      "Document chunk already exists",
    );
    await expect(
      validation.createMany([documentChunkInput({ id: secondChunkId, documentRevision: 0 })]),
    ).rejects.toThrow("documentRevision must be positive");
    await expect(
      validation.createMany([documentChunkInput({ id: secondChunkId, ordinal: -1 })]),
    ).rejects.toThrow("ordinal must be non-negative");
    await expect(
      validation.createMany([documentChunkInput({ id: secondChunkId, tokenCount: -1 })]),
    ).rejects.toThrow("tokenCount must be non-negative");
    const generatedChunkId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d29";
    const generated = createInMemoryDocumentChunkRepository({
      generateChunkId: () => generatedChunkId,
      maxChunks: 1,
    });
    await expect(
      generated.createMany([documentChunkInput({ id: undefined, userMetadata: undefined })]),
    ).resolves.toEqual([expect.objectContaining({ id: generatedChunkId, userMetadata: {} })]);
    await expect(
      chunks.createMany([
        documentChunkInput({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d27", ordinal: 2 }),
        documentChunkInput({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d28", ordinal: 3 }),
      ]),
    ).rejects.toThrow("Document chunks maxChunks=3 exceeded");
    await expect(
      chunks.list({
        candidateGrants: [],
        documentId,
        documentRevision: 1,
        knowledgeSpaceId,
        limit: 0,
        tenantId,
      }),
    ).rejects.toThrow("Chunk list limit must be between 1 and 100");
    await expect(
      chunks.list({
        candidateGrants: [],
        documentId,
        documentRevision: 1,
        knowledgeSpaceId,
        limit: 1,
        query: " ",
        tenantId,
      }),
    ).rejects.toThrow("Chunk search query must be between 1 and 512 characters");

    const candidateInput = {
      changeId,
      chunkId,
      compilationAttemptId: attemptId,
      documentId,
      documentRevision: 1,
      enabled: false,
      knowledgeSpaceId,
      now,
      tenantId,
    };
    await expect(chunks.stageStateChange(candidateInput)).resolves.toMatchObject({
      id: changeId,
      state: "candidate",
    });
    await expect(chunks.stageStateChange(candidateInput)).resolves.toMatchObject({ id: changeId });
    await expect(chunks.stageStateChange({ ...candidateInput, enabled: true })).rejects.toThrow(
      "Chunk state change idempotency conflict",
    );
    await expect(
      chunks.stageStateChange({ ...candidateInput, changeId: secondChangeId, chunkId: "missing" }),
    ).rejects.toThrow("Document chunk not found");
    await expect(
      chunks.stageStateChange({
        ...candidateInput,
        candidateFingerprint: fingerprint,
        candidatePublicationId: publicationId,
        changeId: secondChangeId,
        chunkId: secondChunkId,
      }),
    ).resolves.toMatchObject({
      candidateFingerprint: fingerprint,
      candidatePublicationId: publicationId,
    });
    await expect(
      chunks.failStateChange({ changeId, documentId, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ state: "failed" });
    await expect(
      chunks.failStateChange({ changeId, documentId, knowledgeSpaceId, tenantId }),
    ).rejects.toThrow("Chunk state candidate not found");
    await expect(
      chunks.activateStateChange({
        candidateFingerprint: fingerprint,
        candidatePublicationId: publicationId,
        changeId,
        documentId,
        knowledgeSpaceId,
        now,
        tenantId,
      }),
    ).rejects.toThrow("Chunk state candidate not found");
  });

  it("cancels compilation when chunk state staging fails and preserves caller provenance", async () => {
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: () => true,
      canReadRevision: () => true,
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
      now,
      sizeBytes: 12,
      systemMetadata: {},
      tenantId,
      title: "Chunk staging failure",
    });
    await logicalDocuments.activateRevision({
      documentId,
      expectedActiveRevision: null,
      expectedRowVersion: 0,
      knowledgeSpaceId,
      now,
      revision: created.revision.revision,
      tenantId,
    });
    const chunks = createInMemoryDocumentChunkRepository({ maxChunks: 2 });
    await chunks.createMany([documentChunkInput()]);
    const cancel = vi.fn(async () => {
      throw new Error("cancel unavailable");
    });
    const start = vi.fn(async () => ({ id: attemptId }));
    const service = createDocumentChunkStateService({
      chunks: {
        ...chunks,
        stageStateChange: async () => {
          throw new Error("state storage unavailable");
        },
      },
      compilationJobs: { cancel, start } as never,
      logicalDocuments,
    });

    await expect(
      service.request({
        chunkId,
        documentId,
        documentRevision: 1,
        enabled: false,
        knowledgeSpaceId,
        now,
        permissionSnapshot: { accessChannel: "interactive", id: publicationId, revision: 1 },
        requestedBySubjectId: "user-1",
        tenantId,
        trustedInternal: true,
      }),
    ).rejects.toThrow("state storage unavailable");
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionSnapshot: expect.objectContaining({ id: publicationId }),
        requestedBySubjectId: "user-1",
      }),
    );
    expect(cancel).toHaveBeenCalledWith(attemptId, "Chunk state candidate staging failed");

    await expect(
      service.request({
        chunkId: "missing",
        documentId,
        documentRevision: 1,
        enabled: false,
        knowledgeSpaceId,
        now,
        tenantId,
      }),
    ).rejects.toThrow("Document chunk not found");
    await expect(
      service.request({
        chunkId,
        documentId,
        documentRevision: 1,
        enabled: true,
        knowledgeSpaceId,
        now,
        tenantId,
      }),
    ).rejects.toThrow("Document chunk already has the requested state");
    await chunks.createMany([
      documentChunkInput({ id: secondChunkId, documentRevision: 2, ordinal: 0 }),
    ]);
    await expect(
      service.request({
        chunkId: secondChunkId,
        documentId,
        documentRevision: 2,
        enabled: false,
        knowledgeSpaceId,
        now,
        tenantId,
      }),
    ).rejects.toThrow("Logical document CAS conflict");
  });

  it("persists and transitions database chunks behind admission and CAS fences", async () => {
    const fixture = createDocumentChunkDatabaseFixture();
    const repository = createDatabaseDocumentChunkRepository({
      database: fixture.database,
      generateChangeId: (() => {
        const ids = [changeId, secondChangeId];
        return () => ids.shift() ?? secondChangeId;
      })(),
      maxBatchSize: 2,
      maxListLimit: 2,
    });

    await expect(
      repository.createMany([
        documentChunkInput({ text: "100%_\\ searchable parent" }),
        documentChunkInput({
          id: secondChunkId,
          ordinal: 1,
          parentChunkId: chunkId,
          text: "100%_\\ searchable child",
        }),
      ]),
    ).resolves.toHaveLength(2);
    await expect(
      repository.get({ chunkId, documentId, documentRevision: 1, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ enabled: true, id: chunkId });
    await expect(
      repository.list({
        candidateGrants: ["document:read"],
        cursor: { id: "00000000-0000-0000-0000-000000000000" },
        documentId,
        documentRevision: 1,
        knowledgeSpaceId,
        limit: 1,
        query: "100%_\\",
        tenantId,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: chunkId })],
      nextCursor: { id: chunkId },
    });
    const listCall = fixture.calls.find(
      (call) =>
        call.operation === "select" &&
        call.tableName === "document_revision_chunks" &&
        call.params.length > 5,
    );
    expect(listCall?.sql).toContain("LIKE");
    expect(listCall?.params).toContain("%100\\%\\_\\\\%");

    const disabled = await repository.stageStateChange({
      chunkId,
      compilationAttemptId: attemptId,
      documentId,
      documentRevision: 1,
      enabled: false,
      knowledgeSpaceId,
      now,
      tenantId,
      trustedInternal: true,
    });
    await expect(
      repository.activateStateChange({
        candidateFingerprint: fingerprint,
        candidatePublicationId: publicationId,
        changeId: disabled.id,
        documentId,
        knowledgeSpaceId,
        now,
        tenantId,
      }),
    ).resolves.toMatchObject({ state: "active" });
    await expect(
      repository.get({ chunkId, documentId, documentRevision: 1, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ enabled: false });

    const failed = await repository.stageStateChange({
      chunkId: secondChunkId,
      compilationAttemptId: attemptId,
      documentId,
      documentRevision: 1,
      enabled: false,
      knowledgeSpaceId,
      now,
      tenantId,
      trustedInternal: true,
    });
    await expect(
      repository.failStateChange({
        changeId: failed.id,
        documentId,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ state: "failed" });
    await expect(
      repository.get({
        chunkId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99",
        documentId,
        documentRevision: 1,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBeNull();
    await expect(repository.createMany([])).resolves.toEqual([]);
    await expect(
      repository.createMany([
        documentChunkInput(),
        documentChunkInput({ id: secondChunkId, ordinal: 1 }),
        documentChunkInput({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d29", ordinal: 2 }),
      ]),
    ).rejects.toThrow("Document chunk maxBatchSize=2 exceeded");
    await expect(
      repository.activateStateChange({
        candidateFingerprint: fingerprint,
        candidatePublicationId: publicationId,
        changeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99",
        documentId,
        knowledgeSpaceId,
        now,
        tenantId,
      }),
    ).rejects.toThrow("Chunk state candidate not found");
    await expect(
      repository.failStateChange({
        changeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99",
        documentId,
        knowledgeSpaceId,
        tenantId,
      }),
    ).rejects.toThrow("Chunk state candidate not found");
    await expect(
      repository.stageStateChange({
        chunkId: secondChunkId,
        compilationAttemptId: attemptId,
        documentId,
        documentRevision: 1,
        enabled: true,
        knowledgeSpaceId,
        now,
        tenantId,
        trustedInternal: true,
      }),
    ).rejects.toThrow("Document chunk already has the requested state");
  });

  it("maps database admission denial and generates optional chunk fields safely", async () => {
    const deniedExecute = async (): Promise<DatabaseExecuteResult> => ({
      rows: [],
      rowsAffected: 0,
    });
    const deniedDatabase = createSchemaDatabaseAdapter({
      executor: deniedExecute,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: deniedExecute }),
    });
    const denied = createDatabaseDocumentChunkRepository({
      database: deniedDatabase,
      maxBatchSize: 1,
      maxListLimit: 1,
    });
    await expect(
      denied.stageStateChange({
        chunkId,
        compilationAttemptId: attemptId,
        documentId,
        documentRevision: 1,
        enabled: false,
        knowledgeSpaceId,
        now,
        tenantId,
        trustedInternal: true,
      }),
    ).rejects.toThrow("Document chunk candidate admission denied");

    const fixture = createDocumentChunkDatabaseFixture();
    const generatedChunkId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d30";
    const generated = createDatabaseDocumentChunkRepository({
      database: fixture.database,
      generateChunkId: () => generatedChunkId,
      maxBatchSize: 1,
      maxListLimit: 1,
    });
    await expect(
      generated.createMany([documentChunkInput({ id: undefined, userMetadata: undefined })]),
    ).resolves.toEqual([expect.objectContaining({ id: generatedChunkId, userMetadata: {} })]);
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

type StoredChunk = CreateDocumentRevisionChunkInput & { readonly id: string };

function documentChunkInput(
  overrides: Partial<CreateDocumentRevisionChunkInput> = {},
): CreateDocumentRevisionChunkInput {
  return {
    createdAt: now,
    documentId,
    documentRevision: 1,
    id: chunkId,
    knowledgeSpaceId,
    ordinal: 0,
    systemMetadata: { nested: "original" },
    tenantId,
    text: "Parent text",
    tokenCount: 2,
    userMetadata: { reviewed: false },
    ...overrides,
  };
}

function createDocumentChunkDatabaseFixture() {
  const calls: DatabaseExecuteInput[] = [];
  const chunks = new Map<string, StoredChunk>();
  const changes = new Map<string, DocumentChunkStateChange>();

  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });

    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (input.tableName === "document_compilation_attempts") {
      return {
        rows: [
          {
            access_channel: null,
            document_asset_id: assetId,
            document_version: 1,
            permission_snapshot_id: null,
            permission_snapshot_revision: null,
            requested_by_subject_id: null,
          },
        ],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "document_assets") {
      return { rows: [{ metadata: {}, source_id: null }], rowsAffected: 1 };
    }
    if (input.tableName === "logical_documents") {
      return { rows: [{ id: documentId }], rowsAffected: 1 };
    }
    if (input.tableName === "document_revisions") {
      return { rows: [{ revision: 1 }], rowsAffected: 1 };
    }
    if (input.tableName === "document_revision_chunks") {
      if (input.operation === "insert") {
        const [
          id,
          rowTenantId,
          rowKnowledgeSpaceId,
          rowDocumentId,
          documentRevision,
          parentChunkId,
          ordinal,
          tokenCount,
          text,
          systemMetadata,
          userMetadata,
          createdAt,
        ] = input.params;
        chunks.set(String(id), {
          createdAt: String(createdAt),
          documentId: String(rowDocumentId),
          documentRevision: Number(documentRevision),
          id: String(id),
          knowledgeSpaceId: String(rowKnowledgeSpaceId),
          ordinal: Number(ordinal),
          ...(parentChunkId ? { parentChunkId: String(parentChunkId) } : {}),
          systemMetadata: jsonParameter(systemMetadata),
          tenantId: String(rowTenantId),
          text: String(text),
          tokenCount: Number(tokenCount),
          userMetadata: jsonParameter(userMetadata),
        });
        return { rows: [], rowsAffected: 1 };
      }

      const selected =
        input.params.length === 5
          ? [chunks.get(String(input.params[4]))].filter(
              (chunk): chunk is StoredChunk => chunk !== undefined,
            )
          : [...chunks.values()].sort((left, right) => left.id.localeCompare(right.id));
      return {
        rows: selected.map((chunk) =>
          documentChunkRow(chunk, effectiveChunkEnabled(chunk.id, changes)),
        ),
        rowsAffected: selected.length,
      };
    }
    if (input.tableName === "document_chunk_state_changes") {
      if (input.operation === "insert") {
        const [
          id,
          rowTenantId,
          rowKnowledgeSpaceId,
          rowDocumentId,
          documentRevision,
          rowChunkId,
          enabled,
          compilationAttemptId,
          candidatePublicationId,
          candidateFingerprint,
          createdAt,
        ] = input.params;
        changes.set(String(id), {
          ...(candidateFingerprint ? { candidateFingerprint: String(candidateFingerprint) } : {}),
          ...(candidatePublicationId
            ? { candidatePublicationId: String(candidatePublicationId) }
            : {}),
          chunkId: String(rowChunkId),
          compilationAttemptId: String(compilationAttemptId),
          createdAt: String(createdAt),
          documentId: String(rowDocumentId),
          documentRevision: Number(documentRevision),
          enabled: Boolean(enabled),
          id: String(id),
          knowledgeSpaceId: String(rowKnowledgeSpaceId),
          state: "candidate",
          tenantId: String(rowTenantId),
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (input.operation === "select") {
        const change = changes.get(String(input.params[3]));
        return {
          rows: change ? [documentChunkChangeRow(change)] : [],
          rowsAffected: change ? 1 : 0,
        };
      }
      if (input.sql.includes("'superseded'")) {
        const rowChunkId = String(input.params[3]);
        for (const [id, change] of changes) {
          if (change.chunkId === rowChunkId && change.state === "active") {
            changes.set(id, { ...change, state: "superseded" });
          }
        }
        return { rows: [], rowsAffected: 1 };
      }
      if (input.sql.includes("'active'")) {
        const id = String(input.params[6]);
        const change = changes.get(id);
        if (!change || change.state !== "candidate") return { rows: [], rowsAffected: 0 };
        changes.set(id, {
          ...change,
          activatedAt: String(input.params[0]),
          candidatePublicationId: String(input.params[1]),
          candidateFingerprint: String(input.params[2]),
          state: "active",
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (input.sql.includes("'failed'")) {
        const id = String(input.params[3]);
        const change = changes.get(id);
        if (!change || change.state !== "candidate") return { rows: [], rowsAffected: 0 };
        changes.set(id, { ...change, state: "failed" });
        return { rows: [], rowsAffected: 1 };
      }
    }

    throw new Error(`Unexpected document chunk database operation: ${input.tableName}`);
  };

  return {
    calls,
    database: createSchemaDatabaseAdapter({
      executor: execute,
      kind: "postgres",
      transaction: async (callback) => callback({ execute }),
    }),
  };
}

function effectiveChunkEnabled(
  selectedChunkId: string,
  changes: ReadonlyMap<string, DocumentChunkStateChange>,
): boolean {
  const active = [...changes.values()]
    .filter((change) => change.chunkId === selectedChunkId && change.state === "active")
    .sort(
      (left, right) =>
        (right.activatedAt ?? "").localeCompare(left.activatedAt ?? "") ||
        right.id.localeCompare(left.id),
    )[0];
  return active?.enabled ?? true;
}

function documentChunkRow(chunk: StoredChunk, enabled: boolean): Record<string, unknown> {
  return {
    created_at: chunk.createdAt,
    document_id: chunk.documentId,
    document_revision: chunk.documentRevision,
    effective_enabled: enabled,
    id: chunk.id,
    knowledge_space_id: chunk.knowledgeSpaceId,
    ordinal: chunk.ordinal,
    parent_chunk_id: chunk.parentChunkId ?? null,
    system_metadata: chunk.systemMetadata,
    tenant_id: chunk.tenantId,
    text: chunk.text,
    token_count: chunk.tokenCount,
    user_metadata: chunk.userMetadata ?? {},
  };
}

function documentChunkChangeRow(change: DocumentChunkStateChange): Record<string, unknown> {
  return {
    activated_at: change.activatedAt ?? null,
    candidate_fingerprint: change.candidateFingerprint ?? null,
    candidate_publication_id: change.candidatePublicationId ?? null,
    chunk_id: change.chunkId,
    compilation_attempt_id: change.compilationAttemptId,
    created_at: change.createdAt,
    document_id: change.documentId,
    document_revision: change.documentRevision,
    enabled: change.enabled,
    id: change.id,
    knowledge_space_id: change.knowledgeSpaceId,
    state: change.state,
    tenant_id: change.tenantId,
  };
}

function jsonParameter(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") return {};
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : {};
}

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
