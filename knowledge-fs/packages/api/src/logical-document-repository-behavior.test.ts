import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type CreateDocumentRevisionInput,
  LogicalDocumentConflictError,
  LogicalDocumentNotFoundError,
  type LogicalDocumentRepository,
  LogicalDocumentValidationError,
  applyUserMetadataPatch,
  createDatabaseDocumentRevisionPublicationFenceResolver,
  createDatabaseLogicalDocumentRepository,
  createInMemoryDocumentRevisionPublicationFenceResolver,
  createInMemoryLogicalDocumentRepository,
} from "./logical-document-repository";
import { SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY } from "./source-document-workflow-ownership";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentIds = [
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03",
] as const;
const assetIds = [
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f2d13",
] as const;
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01";
const now = "2026-07-14T12:00:00.000Z";

describe("logical document repository behavior coverage", () => {
  it("rejects malformed revisions and invalid repository bounds before mutating state", async () => {
    expect(() => memoryRepository({ maxDocuments: 0 })).toThrow("maxDocuments must be at least 1");
    expect(() => memoryRepository({ maxRevisionsPerDocument: 0 })).toThrow(
      "maxRevisionsPerDocument must be at least 1",
    );

    const cases: ReadonlyArray<readonly [Partial<CreateDocumentRevisionInput>, string]> = [
      [{ contentHash: "A".repeat(64) }, "contentHash"],
      [{ documentAssetVersion: 0 }, "asset version"],
      [{ sizeBytes: -1 }, "sizeBytes"],
      [{ sourceId }, "provided together"],
      [{ providerItemId: "provider-a" }, "provided together"],
      [{ permissionSnapshot: permissionSnapshot() }, "permission and requester"],
      [{ requestedBySubjectId: "editor-a" }, "permission and requester"],
      [
        {
          permissionSnapshot: permissionSnapshot(),
          requestedBySubjectId: "editor-a",
          sourceId,
          providerItemId: "provider-a",
          trustedInternalAdmission: true,
        },
        "cannot carry caller permission",
      ],
      [{ trustedInternalAdmission: true }, "requires an explicit Source identity"],
      [
        {
          permissionSnapshot: { ...permissionSnapshot(), permissionScopes: [""] },
          requestedBySubjectId: "editor-a",
        },
        "permission scopes are invalid",
      ],
      [
        { permissionSnapshot: permissionSnapshot(), requestedBySubjectId: " editor-a" },
        "requester is invalid",
      ],
      [{ documentId: documentIds[0], rollbackOfRevision: 0 }, "rollbackOfRevision"],
      [{ rollbackOfRevision: 1 }, "requires an explicit documentId"],
      [{ expectedActiveRevision: null }, "CAS requires an explicit documentId"],
      [{ documentId: documentIds[0], expectedActiveRevision: null }, "row version together"],
      [
        {
          documentId: documentIds[0],
          expectedActiveRevision: 0,
          expectedDocumentRowVersion: 0,
        },
        "Expected active revision",
      ],
      [
        {
          documentId: documentIds[0],
          expectedActiveRevision: null,
          expectedDocumentRowVersion: -1,
        },
        "row version must be non-negative",
      ],
      [{ title: "  " }, "title and MIME type"],
      [{ mimeType: "" }, "title and MIME type"],
    ];

    for (const [overrides, message] of cases) {
      await expect(
        memoryRepository().createCandidateRevision(revisionInput(overrides)),
      ).rejects.toThrow(message);
    }
  });

  it("binds, fails, inspects, and compensates immutable in-memory revisions", async () => {
    const ownership = {
      contentHash: "a".repeat(64),
      itemKey: "provider-a",
      runId: "run-a",
    };
    const repository = memoryRepository();
    const created = await repository.createCandidateRevision(
      revisionInput({
        providerItemId: "provider-a",
        sourceId,
        systemMetadata: { [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: ownership },
      }),
    );

    await expect(
      repository.isAssetReferenced({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.isAssetReferenced({
        documentAssetId: assetIds[2],
        documentAssetVersion: 1,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBe(false);

    const bound = await repository.bindCompilationAttempt({
      attemptId,
      documentId: created.document.id,
      knowledgeSpaceId,
      revision: 1,
      tenantId,
    });
    expect(bound.compilationAttemptId).toBe(attemptId);
    await expect(
      repository.bindCompilationAttempt({
        attemptId,
        documentId: created.document.id,
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toEqual(bound);
    await expect(
      repository.bindCompilationAttempt({
        attemptId: `${attemptId}-other`,
        documentId: created.document.id,
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).rejects.toThrow("another compilation attempt");

    await repository.failCandidate({
      documentId: created.document.id,
      knowledgeSpaceId,
      now,
      revision: 1,
      tenantId,
    });
    await expect(
      repository.isFailedSourceRevisionCleanupEligible({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        documentId: created.document.id,
        knowledgeSpaceId,
        ownership,
        revision: 1,
        sourceId,
        tenantId,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.isFailedSourceRevisionCleanupEligible({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        documentId: created.document.id,
        knowledgeSpaceId,
        ownership: { ...ownership, runId: "wrong-run" },
        revision: 1,
        sourceId,
        tenantId,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.discardUnboundCandidate({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        documentId: created.document.id,
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toBe(false);
  });

  it("removes only an exact unbound candidate and releases its provider identity", async () => {
    let nextDocument = 0;
    const repository = memoryRepository({
      generateDocumentId: () => documentIds[nextDocument++] ?? "unexpected-document",
    });
    const first = await repository.createCandidateRevision(
      revisionInput({ providerItemId: "provider-a", sourceId }),
    );

    await expect(
      repository.discardUnboundCandidate({
        documentAssetId: assetIds[1],
        documentAssetVersion: 1,
        documentId: first.document.id,
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toBe(false);
    await repository.failCandidate({
      documentId: first.document.id,
      knowledgeSpaceId,
      now,
      revision: 1,
      tenantId,
    });
    await expect(
      repository.discardUnboundCandidate({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        documentId: first.document.id,
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.get({ documentId: first.document.id, knowledgeSpaceId, tenantId }),
    ).resolves.toBeNull();

    const recreated = await repository.createCandidateRevision(
      revisionInput({
        documentAssetId: assetIds[1],
        providerItemId: "provider-a",
        sourceId,
      }),
    );
    expect(recreated.document.id).toBe(documentIds[1]);
  });

  it("enforces retry immutability, provider identity, CAS, and configured capacity", async () => {
    let nextDocument = 0;
    const repository = memoryRepository({
      generateDocumentId: () => documentIds[nextDocument++] ?? "unexpected-document",
      maxDocuments: 1,
      maxRevisionsPerDocument: 2,
    });
    const first = await repository.createCandidateRevision(revisionInput());
    await expect(repository.createCandidateRevision(revisionInput())).resolves.toEqual(first);
    await expect(
      repository.createCandidateRevision(revisionInput({ contentHash: "b".repeat(64) })),
    ).rejects.toThrow("changed immutable content");
    await expect(
      repository.createCandidateRevision(
        revisionInput({ documentAssetId: assetIds[1], documentId: "missing" }),
      ),
    ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
    await expect(
      repository.createCandidateRevision(
        revisionInput({
          documentAssetId: assetIds[1],
          documentId: documentIds[0],
          expectedActiveRevision: null,
          expectedDocumentRowVersion: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(LogicalDocumentConflictError);

    const second = await repository.createCandidateRevision(
      revisionInput({
        documentAssetId: assetIds[1],
        documentId: documentIds[0],
        expectedActiveRevision: null,
        expectedDocumentRowVersion: 0,
      }),
    );
    expect(second.revision.revision).toBe(2);
    await expect(
      repository.createCandidateRevision(
        revisionInput({
          documentAssetId: assetIds[2],
          documentId: documentIds[0],
          expectedActiveRevision: null,
          expectedDocumentRowVersion: 0,
        }),
      ),
    ).rejects.toThrow("maxRevisionsPerDocument=2");
    await expect(
      repository.createCandidateRevision(
        revisionInput({ documentAssetId: assetIds[2], title: "another" }),
      ),
    ).rejects.toThrow("maxDocuments=1");
  });

  it("paginates readable documents and revisions after applying asynchronous ACL checks", async () => {
    let nextDocument = 0;
    const repository = memoryRepository({
      canReadDocument: async ({ candidateGrants, document }) =>
        candidateGrants.includes(document.title),
      canReadRevision: async ({ candidateGrants, revision }) =>
        candidateGrants.includes(revision.contentHash),
      generateDocumentId: () => documentIds[nextDocument++] ?? "unexpected-document",
    });
    for (const [index, title] of ["hidden", "visible-a", "visible-b"].entries()) {
      await repository.createCandidateRevision(
        revisionInput({
          contentHash: String(index + 1).repeat(64),
          documentAssetId: assetIds[index] ?? assetIds[0],
          now: `2026-07-14T12:0${index}:00.000Z`,
          title,
        }),
      );
    }

    const page = await repository.list({
      candidateGrants: ["visible-a", "visible-b"],
      knowledgeSpaceId,
      limit: 1,
      tenantId,
    });
    expect(page.items.map((item) => item.title)).toEqual(["visible-a"]);
    expect(page.nextCursor).toEqual({
      createdAt: "2026-07-14T12:01:00.000Z",
      id: documentIds[1],
    });
    await expect(
      repository.list({
        candidateGrants: ["visible-b"],
        cursor: page.nextCursor,
        knowledgeSpaceId,
        limit: 1,
        tenantId,
      }),
    ).resolves.toMatchObject({ items: [{ title: "visible-b" }] });

    const revisionRepository = memoryRepository();
    const first = await revisionRepository.createCandidateRevision(revisionInput());
    await revisionRepository.createCandidateRevision(
      revisionInput({
        contentHash: "b".repeat(64),
        documentAssetId: assetIds[1],
        documentId: first.document.id,
        expectedActiveRevision: null,
        expectedDocumentRowVersion: 0,
      }),
    );
    const revisions = await revisionRepository.listRevisions({
      candidateGrants: ["document:read"],
      documentId: first.document.id,
      knowledgeSpaceId,
      limit: 1,
      tenantId,
    });
    expect(revisions.items[0]?.revision).toBe(2);
    expect(revisions.nextCursor).toEqual({ revision: 2 });
    await expect(
      revisionRepository.listRevisions({
        candidateGrants: ["document:read"],
        cursor: revisions.nextCursor,
        documentId: first.document.id,
        knowledgeSpaceId,
        limit: 1,
        tenantId,
      }),
    ).resolves.toMatchObject({ items: [{ revision: 1 }] });
  });

  it("paginates active Source inventory by provider identity and preserves optional etags", async () => {
    let nextDocument = 0;
    const repository = memoryRepository({
      generateDocumentId: () => documentIds[nextDocument++] ?? "unexpected-document",
    });
    for (const [index, providerItemId] of ["provider-b", "provider-a", "provider-c"].entries()) {
      const created = await repository.createCandidateRevision(
        revisionInput({
          contentHash: String(index + 1).repeat(64),
          documentAssetId: assetIds[index] ?? assetIds[0],
          providerItemId,
          sourceId,
          systemMetadata: index === 1 ? { etag: "etag-a" } : {},
        }),
      );
      await repository.activateRevision({
        documentId: created.document.id,
        expectedActiveRevision: null,
        expectedRowVersion: 0,
        knowledgeSpaceId,
        now,
        revision: 1,
        tenantId,
      });
    }

    const firstPage = await repository.listActiveBySource({
      knowledgeSpaceId,
      limit: 1,
      sourceId,
      tenantId,
    });
    expect(firstPage.items).toMatchObject([{ etag: "etag-a", providerItemId: "provider-a" }]);
    expect(firstPage.nextCursor).toEqual({
      documentId: documentIds[1],
      providerItemId: "provider-a",
    });
    const remaining = await repository.listActiveBySource({
      cursor: firstPage.nextCursor,
      knowledgeSpaceId,
      limit: 2,
      sourceId,
      tenantId,
    });
    expect(remaining.items.map((item) => item.providerItemId)).toEqual([
      "provider-b",
      "provider-c",
    ]);
    expect(remaining.items[0]).not.toHaveProperty("etag");
  });

  it("resolves in-memory publication fences only for the matching bound candidate", async () => {
    const repository = memoryRepository();
    const created = await repository.createCandidateRevision(revisionInput());
    await repository.bindCompilationAttempt({
      attemptId,
      documentId: created.document.id,
      knowledgeSpaceId,
      revision: 1,
      tenantId,
    });
    const resolver = createInMemoryDocumentRevisionPublicationFenceResolver(
      repository,
      async (input) =>
        input.documentAssetId === assetIds[0]
          ? { documentId: created.document.id, revision: 1 }
          : null,
    );
    await expect(
      resolver.resolve({
        attemptId,
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toEqual({
      documentId: created.document.id,
      expectedActiveRevision: null,
      expectedDocumentRowVersion: 0,
      revision: 1,
    });
    await expect(
      resolver.resolve({
        attemptId,
        documentAssetId: assetIds[1],
        documentAssetVersion: 1,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBeNull();
    await repository.failCandidate({
      documentId: created.document.id,
      knowledgeSpaceId,
      now,
      revision: 1,
      tenantId,
    });
    await expect(
      resolver.resolve({
        attemptId,
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBeNull();
  });

  it("maps database publication fences and preserves exact lookup scoping", async () => {
    let present = true;
    const fixture = databaseFixture(async (input) => ({
      rows: present
        ? [
            {
              document_id: documentIds[0],
              expected_active_revision: null,
              expected_document_row_version: 3,
              revision: 4,
            },
          ]
        : [],
      rowsAffected: 0,
    }));
    const resolver = createDatabaseDocumentRevisionPublicationFenceResolver(fixture.database);
    const lookup = {
      attemptId,
      documentAssetId: assetIds[0],
      documentAssetVersion: 1,
      knowledgeSpaceId,
      tenantId,
    };
    await expect(resolver.resolve(lookup)).resolves.toEqual({
      documentId: documentIds[0],
      expectedActiveRevision: null,
      expectedDocumentRowVersion: 3,
      revision: 4,
    });
    expect(fixture.calls[0]?.params).toEqual([
      tenantId,
      knowledgeSpaceId,
      attemptId,
      assetIds[0],
      1,
    ]);
    present = false;
    await expect(resolver.resolve(lookup)).resolves.toBeNull();
  });

  it("maps database documents, revisions, asset references, and Source inventory pages", async () => {
    const fixture = databaseFixture(async (input) => {
      if (input.tableName === "logical_documents" && input.sql.includes("content_hash")) {
        return {
          rows: [
            inventoryRow({ providerItemId: "provider-a" }),
            inventoryRow({ providerItemId: "provider-b" }),
          ],
          rowsAffected: 0,
        };
      }
      if (input.tableName === "logical_documents") {
        return { rows: [documentRow()], rowsAffected: 0 };
      }
      if (input.tableName === "document_revisions" && input.sql.includes("SELECT 1 AS")) {
        return { rows: [{ present: 1 }], rowsAffected: 0 };
      }
      if (input.tableName === "document_revisions") {
        return { rows: [revisionRow({ state: "active" })], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseLogicalDocumentRepository({
      database: fixture.database,
      maxListLimit: 10,
    });

    await expect(
      repository.get({ documentId: documentIds[0], knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ active: { revision: 1 }, activeRevision: 1 });
    await expect(
      repository.getRevision({
        documentId: documentIds[0],
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toMatchObject({ revision: 1, state: "active" });
    await expect(
      repository.isAssetReferenced({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBe(true);

    const page = await repository.listActiveBySource({
      cursor: { documentId: "cursor-document", providerItemId: "cursor-provider" },
      knowledgeSpaceId,
      limit: 1,
      sourceId,
      tenantId,
    });
    expect(page.items).toMatchObject([
      { etag: "etag-provider-a", providerItemId: "provider-a", revision: 1 },
    ]);
    expect(page.nextCursor).toEqual({
      documentId: documentIds[0],
      providerItemId: "provider-a",
    });
    const inventoryCall = fixture.calls.find(
      (call) => call.tableName === "logical_documents" && call.sql.includes("content_hash"),
    );
    expect(inventoryCall?.params).toEqual([
      tenantId,
      knowledgeSpaceId,
      sourceId,
      "cursor-provider",
      "cursor-document",
      2,
    ]);
  });

  it("binds a database candidate to its owning compilation attempt idempotently", async () => {
    const fixture = mutationFixture();
    await expect(
      fixture.repository.bindCompilationAttempt({
        attemptId,
        documentId: documentIds[0],
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toMatchObject({ compilationAttemptId: attemptId, revision: 1 });
    expect(
      fixture.calls.filter(
        (call) =>
          call.operation === "update" &&
          call.tableName === "document_revisions" &&
          call.sql.includes("compilation_attempt_id"),
      ),
    ).toHaveLength(1);

    const replay = mutationFixture({ targetCompilationAttemptId: attemptId });
    await expect(
      replay.repository.bindCompilationAttempt({
        attemptId,
        documentId: documentIds[0],
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toMatchObject({ compilationAttemptId: attemptId });
    expect(replay.calls.some((call) => call.operation === "update")).toBe(false);
  });

  it("fails closed when database compilation binding ownership or CAS is lost", async () => {
    for (const [options, message] of [
      [{ targetState: "failed" as const }, "not a candidate"],
      [{ targetCompilationAttemptId: "another-attempt" }, "another compilation attempt"],
      [{ attemptPresent: false }, "does not own"],
      [{ bindRowsAffected: 0 }, "lost its compare-and-set"],
    ] as const) {
      const fixture = mutationFixture(options);
      await expect(
        fixture.repository.bindCompilationAttempt({
          attemptId,
          documentId: documentIds[0],
          knowledgeSpaceId,
          revision: 1,
          tenantId,
        }),
      ).rejects.toThrow(message);
    }
  });

  it("publishes a first database revision and records its permission-scoped activity atomically", async () => {
    const fixture = mutationFixture();
    const published = await fixture.repository.activateRevision({
      documentId: documentIds[0],
      expectedActiveRevision: null,
      expectedRowVersion: 0,
      knowledgeSpaceId,
      now,
      revision: 1,
      tenantId,
    });
    expect(published).toMatchObject({
      active: { revision: 1, state: "active" },
      activeRevision: 1,
      rowVersion: 1,
      status: "ready",
    });
    const activityInsert = fixture.calls.find(
      (call) => call.operation === "insert" && call.tableName === "knowledge_space_activity_events",
    );
    expect(activityInsert?.params).toEqual(
      expect.arrayContaining([
        "document.published",
        documentIds[0],
        JSON.stringify(permissionScopes()),
      ]),
    );
  });

  it("supersedes the previous database revision before moving the document anchor", async () => {
    const fixture = mutationFixture({ activeRevision: 1 });
    const published = await fixture.repository.activateRevision({
      documentId: documentIds[0],
      expectedActiveRevision: 1,
      expectedRowVersion: 1,
      knowledgeSpaceId,
      now,
      revision: 2,
      tenantId,
    });
    expect(published).toMatchObject({ activeRevision: 2, rowVersion: 2 });
    const supersede = fixture.calls.findIndex(
      (call) => call.operation === "update" && call.sql.includes("'superseded'"),
    );
    const activate = fixture.calls.findIndex(
      (call) =>
        call.operation === "update" &&
        call.tableName === "document_revisions" &&
        call.params.length === 6,
    );
    const move = fixture.calls.findIndex(
      (call) => call.operation === "update" && call.tableName === "logical_documents",
    );
    expect(supersede).toBeGreaterThanOrEqual(0);
    expect(supersede).toBeLessThan(activate);
    expect(activate).toBeLessThan(move);
  });

  it("surfaces each database publication fence failure as a stable domain error", async () => {
    const cases: ReadonlyArray<
      readonly [
        MutationFixtureOptions,
        Partial<Parameters<LogicalDocumentRepository["activateRevision"]>[0]>,
        string,
      ]
    > = [
      [{}, { expectedRowVersion: 4 }, "CAS conflict"],
      [{ targetState: "failed" }, {}, "not activatable"],
      [
        { activeRevision: 1, supersedeRowsAffected: 0 },
        { expectedActiveRevision: 1, expectedRowVersion: 1, revision: 2 },
        "Active document revision is corrupt",
      ],
      [{ activateRowsAffected: 0 }, {}, "CAS conflict"],
      [{ moveRowsAffected: 0 }, {}, "CAS conflict"],
      [{ assetPresent: false }, {}, "revision asset disappeared"],
    ];
    for (const [options, overrides, message] of cases) {
      const fixture = mutationFixture(options);
      await expect(
        fixture.repository.activateRevision({
          documentId: documentIds[0],
          expectedActiveRevision: null,
          expectedRowVersion: 0,
          knowledgeSpaceId,
          now,
          revision: 1,
          tenantId,
          ...overrides,
        }),
      ).rejects.toThrow(message);
    }
  });

  it("fails database candidates without demoting an already published document", async () => {
    const pending = mutationFixture();
    await expect(
      pending.repository.failCandidate({
        documentId: documentIds[0],
        knowledgeSpaceId,
        now,
        revision: 1,
        tenantId,
      }),
    ).resolves.toMatchObject({ revision: 1, state: "failed" });
    expect(pending.state.document.status).toBe("failed");
    expect(
      pending.calls.some(
        (call) => call.operation === "insert" && call.params.includes("document.failed"),
      ),
    ).toBe(true);

    const published = mutationFixture({ activeRevision: 1 });
    await published.repository.failCandidate({
      documentId: documentIds[0],
      knowledgeSpaceId,
      now,
      revision: 2,
      tenantId,
    });
    expect(published.state.document.status).toBe("ready");
    expect(
      published.calls.some(
        (call) => call.operation === "update" && call.tableName === "logical_documents",
      ),
    ).toBe(false);
  });

  it("rejects database candidate failure when the target or its durable asset fence is gone", async () => {
    for (const [options, message] of [
      [{ documentPresent: false }, "Logical document not found"],
      [{ failRowsAffected: 0 }, "not a candidate"],
      [{ assetPresent: false }, "revision asset disappeared"],
    ] as const) {
      const fixture = mutationFixture(options);
      await expect(
        fixture.repository.failCandidate({
          documentId: documentIds[0],
          knowledgeSpaceId,
          now,
          revision: 1,
          tenantId,
        }),
      ).rejects.toThrow(message);
    }
  });

  it("discards exact unbound database candidates and removes an empty pending parent", async () => {
    const fixture = mutationFixture();
    await expect(
      fixture.repository.discardUnboundCandidate({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        documentId: documentIds[0],
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toBe(true);
    expect(fixture.state.documentPresent).toBe(false);
    expect(
      fixture.calls.some(
        (call) => call.operation === "delete" && call.tableName === "logical_documents",
      ),
    ).toBe(true);

    const published = mutationFixture({ activeRevision: 1 });
    await expect(
      published.repository.discardUnboundCandidate({
        documentAssetId: assetIds[1],
        documentAssetVersion: 1,
        documentId: documentIds[0],
        knowledgeSpaceId,
        revision: 2,
        tenantId,
      }),
    ).resolves.toBe(true);
    expect(published.state.documentPresent).toBe(true);
  });

  it("leaves database state intact when discard identity or delete CAS does not match", async () => {
    for (const options of [
      { documentPresent: false },
      { targetCompilationAttemptId: attemptId },
      { removeRowsAffected: 0 },
    ] as const) {
      const fixture = mutationFixture(options);
      await expect(
        fixture.repository.discardUnboundCandidate({
          documentAssetId: assetIds[0],
          documentAssetVersion: 1,
          documentId: documentIds[0],
          knowledgeSpaceId,
          revision: 1,
          tenantId,
        }),
      ).resolves.toBe(false);
      expect(fixture.state.documentPresent).toBe(options.documentPresent !== false);
    }
  });

  it("proves failed Source cleanup eligibility under an exact single-reference ownership fence", async () => {
    const ownership = {
      contentHash: "a".repeat(64),
      itemKey: "provider-a",
      runId: "run-a",
    };
    const fixture = mutationFixture({
      sourceId,
      targetCompilationAttemptId: attemptId,
      targetState: "failed",
      targetSystemMetadata: { [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: ownership },
    });
    const input = {
      documentAssetId: assetIds[0],
      documentAssetVersion: 1,
      documentId: documentIds[0],
      knowledgeSpaceId,
      ownership,
      revision: 1,
      sourceId,
      tenantId,
    };
    await expect(fixture.repository.isFailedSourceRevisionCleanupEligible(input)).resolves.toBe(
      true,
    );

    const shared = mutationFixture({
      referenceRows: [
        { document_asset_version: 1, document_id: documentIds[0], revision: 1 },
        { document_asset_version: 1, document_id: documentIds[1], revision: 1 },
      ],
      sourceId,
      targetCompilationAttemptId: attemptId,
      targetState: "failed",
      targetSystemMetadata: { [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: ownership },
    });
    await expect(shared.repository.isFailedSourceRevisionCleanupEligible(input)).resolves.toBe(
      false,
    );

    const wrongOwner = mutationFixture({
      sourceId,
      targetCompilationAttemptId: attemptId,
      targetState: "failed",
      targetSystemMetadata: {
        [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: { ...ownership, runId: "different-run" },
      },
    });
    await expect(wrongOwner.repository.isFailedSourceRevisionCleanupEligible(input)).resolves.toBe(
      false,
    );
  });

  it("creates a new trusted Source candidate in the database and replays the asset idempotently", async () => {
    const createdFixture = candidateCreationFixture({ mode: "new" });
    const input = revisionInput({
      providerItemId: "provider-a",
      sourceId,
      trustedInternalAdmission: true,
    });
    await expect(createdFixture.repository.createCandidateRevision(input)).resolves.toMatchObject({
      document: {
        id: documentIds[0],
        providerItemId: "provider-a",
        sourceId,
        status: "pending",
      },
      revision: { documentId: documentIds[0], revision: 1, state: "candidate" },
    });
    expect(
      createdFixture.calls.some(
        (call) => call.operation === "insert" && call.tableName === "logical_documents",
      ),
    ).toBe(true);
    expect(
      createdFixture.calls.some(
        (call) => call.operation === "insert" && call.tableName === "document_revisions",
      ),
    ).toBe(true);

    const replayFixture = candidateCreationFixture({ mode: "replay" });
    await expect(replayFixture.repository.createCandidateRevision(input)).resolves.toMatchObject({
      document: { id: documentIds[0] },
      revision: { documentAssetId: assetIds[0], revision: 1 },
    });
    expect(replayFixture.calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("rejects database asset replay drift and provider digest collisions without inserting", async () => {
    const input = revisionInput({
      providerItemId: "provider-a",
      sourceId,
      trustedInternalAdmission: true,
    });
    const changed = candidateCreationFixture({
      mode: "replay",
      replayContentHash: "b".repeat(64),
    });
    await expect(changed.repository.createCandidateRevision(input)).rejects.toThrow(
      "changed immutable content",
    );

    const collision = candidateCreationFixture({ mode: "collision" });
    await expect(collision.repository.createCandidateRevision(input)).rejects.toThrow(
      "identity digest collided",
    );
    expect(collision.calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("maps database list cursors after active revision validation", async () => {
    const fixture = databaseFixture(async (input) => {
      if (input.tableName === "logical_documents" && input.sql.includes(" JOIN ")) {
        return {
          rows: [
            documentRow({ id: documentIds[0] }),
            documentRow({ id: documentIds[1], provider_item_id: "provider-b" }),
          ],
          rowsAffected: 0,
        };
      }
      if (input.tableName === "document_revisions") {
        return {
          rows: [revisionRow({ document_id: input.params[2], state: "active" })],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseLogicalDocumentRepository({
      database: fixture.database,
      maxListLimit: 5,
    });
    const page = await repository.list({
      candidateGrants: ["document:read"],
      cursor: { createdAt: "2026-07-13T00:00:00.000Z", id: "prior-document" },
      knowledgeSpaceId,
      limit: 1,
      tenantId,
    });
    expect(page.items).toMatchObject([{ active: { state: "active" }, id: documentIds[0] }]);
    expect(page.nextCursor).toEqual({ createdAt: now, id: documentIds[0] });
    const listCall = fixture.calls.find(
      (call) => call.tableName === "logical_documents" && call.sql.includes(" JOIN "),
    );
    expect(listCall?.params).toEqual([
      tenantId,
      knowledgeSpaceId,
      JSON.stringify(["document:read"]),
      "2026-07-13T00:00:00.000Z",
      "prior-document",
      2,
    ]);
  });

  it("fails database lists closed when an advertised active revision is absent", async () => {
    const fixture = databaseFixture(async (input) => {
      if (input.tableName === "logical_documents") {
        return { rows: [documentRow()], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseLogicalDocumentRepository({
      database: fixture.database,
      maxListLimit: 5,
    });
    await expect(
      repository.list({
        candidateGrants: ["document:read"],
        knowledgeSpaceId,
        limit: 1,
        tenantId,
      }),
    ).rejects.toThrow("active revision is corrupt");
  });

  it("paginates database revision history and conceals a missing parent", async () => {
    let parentPresent = true;
    const fixture = databaseFixture(async (input) => {
      if (input.tableName === "logical_documents") {
        return { rows: parentPresent ? [documentRow()] : [], rowsAffected: 0 };
      }
      if (input.tableName === "document_revisions") {
        return {
          rows: [revisionRow({ revision: 3 }), revisionRow({ revision: 2, state: "superseded" })],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseLogicalDocumentRepository({
      database: fixture.database,
      maxListLimit: 5,
    });
    const page = await repository.listRevisions({
      candidateGrants: ["document:read"],
      cursor: { revision: 4 },
      documentId: documentIds[0],
      knowledgeSpaceId,
      limit: 1,
      tenantId,
    });
    expect(page.items).toMatchObject([{ revision: 3 }]);
    expect(page.nextCursor).toEqual({ revision: 3 });
    const historyCall = fixture.calls.find(
      (call) => call.tableName === "document_revisions" && call.sql.includes(" JOIN "),
    );
    expect(historyCall?.params).toEqual([
      tenantId,
      knowledgeSpaceId,
      documentIds[0],
      JSON.stringify(["document:read"]),
      4,
      2,
    ]);

    parentPresent = false;
    await expect(
      repository.listRevisions({
        candidateGrants: ["document:read"],
        documentId: documentIds[0],
        knowledgeSpaceId,
        limit: 1,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
  });

  it("enforces bounded list windows consistently across memory and database repositories", async () => {
    const databaseRepository = createDatabaseLogicalDocumentRepository({
      database: databaseFixture(async () => ({ rows: [], rowsAffected: 0 })).database,
      maxListLimit: 2,
    });
    const cases: ReadonlyArray<readonly [LogicalDocumentRepository, readonly number[]]> = [
      [memoryRepository(), [0, 1.5]],
      [databaseRepository, [0, 1.5, 3]],
    ];
    for (const [repository, limits] of cases) {
      for (const limit of limits) {
        await expect(
          repository.list({ candidateGrants: [], knowledgeSpaceId, limit, tenantId }),
        ).rejects.toBeInstanceOf(LogicalDocumentValidationError);
        await expect(
          repository.listActiveBySource({ knowledgeSpaceId, limit, sourceId, tenantId }),
        ).rejects.toBeInstanceOf(LogicalDocumentValidationError);
      }
    }
  });

  it("applies metadata deletion and rejects every reserved namespace", () => {
    expect(
      applyUserMetadataPatch(
        { keep: "yes", remove: "old" },
        { keep: { nested: true }, remove: null },
      ),
    ).toEqual({ keep: { nested: true } });
    for (const key of [
      "activeRevision",
      "__knowledgeFs",
      "__knowledgeFs.internal",
      "system",
      "system.internal",
      "provenance",
      "provenance.internal",
    ]) {
      expect(() => applyUserMetadataPatch({}, { [key]: "forged" })).toThrow("is reserved");
    }
    expect(() => applyUserMetadataPatch({}, { category: undefined })).toThrow(
      "cannot be undefined",
    );
  });

  it("fails closed for missing scopes and invalid in-memory lifecycle transitions", async () => {
    const repository = memoryRepository();
    const created = await repository.createCandidateRevision(revisionInput());
    await expect(
      repository.get({
        documentId: created.document.id,
        knowledgeSpaceId,
        tenantId: "another-tenant",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.getRevision({
        documentId: created.document.id,
        knowledgeSpaceId,
        revision: 99,
        tenantId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.activateRevision({
        documentId: created.document.id,
        expectedActiveRevision: null,
        expectedRowVersion: 0,
        knowledgeSpaceId,
        now,
        revision: 99,
        tenantId,
      }),
    ).rejects.toThrow("not activatable");
    await repository.failCandidate({
      documentId: created.document.id,
      knowledgeSpaceId,
      now,
      revision: 1,
      tenantId,
    });
    await expect(
      repository.bindCompilationAttempt({
        attemptId,
        documentId: created.document.id,
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).rejects.toThrow("not a candidate");
    await expect(
      repository.failCandidate({
        documentId: created.document.id,
        knowledgeSpaceId,
        now,
        revision: 1,
        tenantId,
      }),
    ).rejects.toThrow("not a candidate");
    await expect(
      repository.patchUserMetadata({
        documentId: created.document.id,
        expectedRowVersion: 0,
        knowledgeSpaceId,
        now,
        patch: {},
        permissionSnapshot: permissionSnapshot(),
        requestedBySubjectId: "",
        tenantId,
      }),
    ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
  });

  it("preserves the parent when discarding one of several in-memory candidates", async () => {
    const repository = memoryRepository();
    const first = await repository.createCandidateRevision(revisionInput());
    await repository.createCandidateRevision(
      revisionInput({
        documentAssetId: assetIds[1],
        documentId: first.document.id,
        expectedActiveRevision: null,
        expectedDocumentRowVersion: 0,
      }),
    );
    await expect(
      repository.discardUnboundCandidate({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        documentId: first.document.id,
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.get({ documentId: first.document.id, knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ id: first.document.id });
    await expect(
      repository.getRevision({
        documentId: first.document.id,
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toBeNull();
  });

  it("rejects in-memory document scope aliasing and provider identity rebinding", async () => {
    const aliased = memoryRepository({ generateDocumentId: () => documentIds[0] });
    await aliased.createCandidateRevision(revisionInput());
    await expect(
      aliased.createCandidateRevision(
        revisionInput({ documentAssetId: assetIds[1], tenantId: "another-tenant" }),
      ),
    ).rejects.toThrow("scope mismatch");

    let nextDocument = 0;
    const repository = memoryRepository({
      generateDocumentId: () => documentIds[nextDocument++] ?? "unexpected-document",
    });
    await repository.createCandidateRevision(
      revisionInput({ providerItemId: "provider-a", sourceId }),
    );
    const other = await repository.createCandidateRevision(
      revisionInput({ documentAssetId: assetIds[1] }),
    );
    await expect(
      repository.createCandidateRevision(
        revisionInput({
          documentAssetId: assetIds[2],
          documentId: other.document.id,
          expectedActiveRevision: null,
          expectedDocumentRowVersion: 0,
          providerItemId: "provider-a",
          sourceId,
        }),
      ),
    ).rejects.toThrow("belongs to another document");
  });

  it("maps database absence and rejects corrupt persisted enum and active-anchor state", async () => {
    const missing = createDatabaseLogicalDocumentRepository({
      database: databaseFixture(async () => ({ rows: [], rowsAffected: 0 })).database,
      maxListLimit: 5,
    });
    await expect(
      missing.get({ documentId: documentIds[0], knowledgeSpaceId, tenantId }),
    ).resolves.toBeNull();
    await expect(
      missing.getRevision({
        documentId: documentIds[0],
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).resolves.toBeNull();
    await expect(
      missing.isAssetReferenced({
        documentAssetId: assetIds[0],
        documentAssetVersion: 1,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBe(false);

    const invalidDocument = createDatabaseLogicalDocumentRepository({
      database: databaseFixture(async () => ({
        rows: [documentRow({ status: "corrupt" })],
        rowsAffected: 0,
      })).database,
      maxListLimit: 5,
    });
    await expect(
      invalidDocument.get({ documentId: documentIds[0], knowledgeSpaceId, tenantId }),
    ).rejects.toThrow("Invalid document status");

    const invalidRevision = createDatabaseLogicalDocumentRepository({
      database: databaseFixture(async (input) => ({
        rows:
          input.tableName === "document_revisions"
            ? [revisionRow({ state: "corrupt" })]
            : [documentRow()],
        rowsAffected: 0,
      })).database,
      maxListLimit: 5,
    });
    await expect(
      invalidRevision.getRevision({
        documentId: documentIds[0],
        knowledgeSpaceId,
        revision: 1,
        tenantId,
      }),
    ).rejects.toThrow("Invalid revision state");

    const corruptAnchor = createDatabaseLogicalDocumentRepository({
      database: databaseFixture(async (input) => ({
        rows:
          input.tableName === "logical_documents"
            ? [documentRow()]
            : [revisionRow({ state: "failed" })],
        rowsAffected: 0,
      })).database,
      maxListLimit: 5,
    });
    await expect(
      corruptAnchor.get({ documentId: documentIds[0], knowledgeSpaceId, tenantId }),
    ).rejects.toThrow("active revision is corrupt");
  });

  it("conceals database candidate admission when durable asset, parent, or provider anchors drift", async () => {
    const trusted = revisionInput({
      providerItemId: "provider-a",
      sourceId,
      trustedInternalAdmission: true,
    });
    await expect(
      candidateCreationFixture({
        mode: "new",
        assetPresent: false,
      }).repository.createCandidateRevision(trusted),
    ).rejects.toThrow("asset tuple does not exist");
    await expect(
      candidateCreationFixture({
        mode: "replay",
        parentPresent: false,
      }).repository.createCandidateRevision(trusted),
    ).rejects.toThrow("Revision parent is missing");
    await expect(
      candidateCreationFixture({ mode: "new" }).repository.createCandidateRevision(
        revisionInput({ documentId: documentIds[0] }),
      ),
    ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
    await expect(
      candidateCreationFixture({ mode: "replay" }).repository.createCandidateRevision(
        revisionInput({ documentId: documentIds[1] }),
      ),
    ).rejects.toThrow("already bound to another logical document");
    await expect(
      candidateCreationFixture({ mode: "replay" }).repository.createCandidateRevision(
        revisionInput({ documentId: documentIds[0] }),
      ),
    ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
    await expect(
      candidateCreationFixture({
        mode: "replay",
        replayStatus: "ready",
      }).repository.createCandidateRevision(trusted),
    ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
    await expect(
      candidateCreationFixture({
        anchorSourceId: "different-source",
        mode: "replay",
      }).repository.createCandidateRevision(trusted),
    ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
  });

  it("omits optional database Source inventory fields when there is no etag or next page", async () => {
    const fixture = databaseFixture(async (input) => ({
      rows:
        input.tableName === "logical_documents"
          ? [{ ...inventoryRow({ providerItemId: "provider-a" }), system_metadata: {} }]
          : [],
      rowsAffected: 0,
    }));
    const repository = createDatabaseLogicalDocumentRepository({
      database: fixture.database,
      maxListLimit: 5,
    });
    const result = await repository.listActiveBySource({
      knowledgeSpaceId,
      limit: 2,
      sourceId,
      tenantId,
    });
    expect(result).toEqual({
      items: [
        {
          contentHash: "a".repeat(64),
          documentId: documentIds[0],
          providerItemId: "provider-a",
          revision: 1,
          rowVersion: 1,
          systemMetadata: {},
        },
      ],
    });
  });

  it("covers multi-revision mapping, pending reads, and final fail-closed publication branches", async () => {
    const history = memoryRepository();
    const first = await history.createCandidateRevision(revisionInput());
    await history.createCandidateRevision(
      revisionInput({
        documentAssetId: assetIds[1],
        documentId: first.document.id,
        expectedActiveRevision: null,
        expectedDocumentRowVersion: 0,
      }),
    );
    await history.bindCompilationAttempt({
      attemptId,
      documentId: first.document.id,
      knowledgeSpaceId,
      revision: 2,
      tenantId,
    });
    await history.failCandidate({
      documentId: first.document.id,
      knowledgeSpaceId,
      now,
      revision: 2,
      tenantId,
    });

    let nextDocument = 0;
    const sortable = memoryRepository({
      generateDocumentId: () => documentIds[nextDocument++] ?? "unexpected-document",
    });
    await sortable.createCandidateRevision(revisionInput());
    await sortable.createCandidateRevision(
      revisionInput({ documentAssetId: assetIds[1], title: "second" }),
    );
    await expect(
      sortable.list({
        candidateGrants: ["document:read"],
        knowledgeSpaceId,
        limit: 2,
        tenantId,
      }),
    ).resolves.toMatchObject({ items: [{ id: documentIds[0] }, { id: documentIds[1] }] });

    const pending = createDatabaseLogicalDocumentRepository({
      database: databaseFixture(async (input) => ({
        rows:
          input.tableName === "logical_documents"
            ? [documentRow({ active_revision: null, status: "pending" })]
            : [],
        rowsAffected: 0,
      })).database,
      maxListLimit: 5,
    });
    await expect(
      pending.get({ documentId: documentIds[0], knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({ active: null, status: "pending" });

    const missing = mutationFixture({ documentPresent: false });
    await expect(
      missing.repository.activateRevision({
        documentId: documentIds[0],
        expectedActiveRevision: null,
        expectedRowVersion: 0,
        knowledgeSpaceId,
        now,
        revision: 1,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);

    const denyScoped = mutationFixture({ assetPermissionScope: "malformed" });
    await denyScoped.repository.activateRevision({
      documentId: documentIds[0],
      expectedActiveRevision: null,
      expectedRowVersion: 0,
      knowledgeSpaceId,
      now,
      revision: 1,
      tenantId,
    });
    const activity = denyScoped.calls.find(
      (call) => call.operation === "insert" && call.tableName === "knowledge_space_activity_events",
    );
    expect(activity?.params).toContain(JSON.stringify(["__deny__"]));
  });
});

function memoryRepository(
  overrides: Partial<Parameters<typeof createInMemoryLogicalDocumentRepository>[0]> = {},
): LogicalDocumentRepository {
  return createInMemoryLogicalDocumentRepository({
    canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
    canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
    generateDocumentId: () => documentIds[0],
    maxDocuments: 10,
    maxRevisionsPerDocument: 10,
    ...overrides,
  });
}

function revisionInput(
  overrides: Partial<CreateDocumentRevisionInput> = {},
): CreateDocumentRevisionInput {
  return {
    contentHash: "a".repeat(64),
    documentAssetId: assetIds[0],
    documentAssetVersion: 1,
    knowledgeSpaceId,
    mimeType: "text/plain",
    now,
    sizeBytes: 12,
    systemMetadata: {},
    tenantId,
    title: "Design notes",
    ...overrides,
  };
}

function permissionSnapshot() {
  return {
    accessChannel: "interactive" as const,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
    revision: 1,
  };
}

function documentRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    active_revision: 1,
    created_at: now,
    id: documentIds[0],
    knowledge_space_id: knowledgeSpaceId,
    provider_item_id: "provider-a",
    row_version: 1,
    source_id: sourceId,
    status: "ready",
    system_metadata: { origin: "test" },
    tenant_id: tenantId,
    title: "Design notes",
    updated_at: now,
    user_metadata: { category: "camera" },
    ...overrides,
  };
}

function revisionRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    activated_at: now,
    compilation_attempt_id: attemptId,
    content_hash: "a".repeat(64),
    created_at: now,
    document_asset_id: assetIds[0],
    document_asset_version: 1,
    document_id: documentIds[0],
    expected_active_revision: null,
    expected_document_row_version: 0,
    knowledge_space_id: knowledgeSpaceId,
    mime_type: "text/plain",
    revision: 1,
    size_bytes: 12,
    state: "candidate",
    system_metadata: {},
    tenant_id: tenantId,
    ...overrides,
  };
}

function inventoryRow(input: { readonly providerItemId: string }) {
  return {
    content_hash: "a".repeat(64),
    document_id: documentIds[0],
    provider_item_id: input.providerItemId,
    revision: 1,
    row_version: 1,
    system_metadata: { etag: `etag-${input.providerItemId}` },
  };
}

function databaseFixture(
  handler: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  kind: "postgres" | "tidb" = "postgres",
) {
  const calls: DatabaseExecuteInput[] = [];
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    return handler(input);
  };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind,
    transaction: async (callback) => callback({ execute }),
  });
  return { calls, database };
}

interface MutationFixtureOptions {
  readonly activateRowsAffected?: number | undefined;
  readonly activeRevision?: number | undefined;
  readonly assetPresent?: boolean | undefined;
  readonly assetPermissionScope?: unknown;
  readonly attemptPresent?: boolean | undefined;
  readonly bindRowsAffected?: number | undefined;
  readonly documentPresent?: boolean | undefined;
  readonly failRowsAffected?: number | undefined;
  readonly moveRowsAffected?: number | undefined;
  readonly referenceRows?: readonly Readonly<Record<string, unknown>>[] | undefined;
  readonly removeRowsAffected?: number | undefined;
  readonly sourceId?: string | undefined;
  readonly supersedeRowsAffected?: number | undefined;
  readonly targetCompilationAttemptId?: string | undefined;
  readonly targetState?: "active" | "candidate" | "failed" | "superseded" | undefined;
  readonly targetSystemMetadata?: Readonly<Record<string, unknown>> | undefined;
}

function mutationFixture(options: MutationFixtureOptions = {}) {
  const activeRevision = options.activeRevision;
  const targetRevision = activeRevision === undefined ? 1 : activeRevision + 1;
  const document = {
    ...documentRow({
      active_revision: activeRevision ?? null,
      provider_item_id: options.sourceId ? "provider-a" : null,
      row_version: activeRevision === undefined ? 0 : 1,
      source_id: options.sourceId ?? null,
      status: activeRevision === undefined ? "pending" : "ready",
    }),
  };
  const revisions = new Map<number, Record<string, unknown>>();
  if (activeRevision !== undefined) {
    revisions.set(activeRevision, {
      ...revisionRow({
        activated_at: now,
        compilation_attempt_id: attemptId,
        revision: activeRevision,
        state: "active",
      }),
    });
  }
  revisions.set(targetRevision, {
    ...revisionRow({
      activated_at: null,
      compilation_attempt_id: options.targetCompilationAttemptId ?? null,
      document_asset_id: activeRevision === undefined ? assetIds[0] : assetIds[1],
      expected_active_revision: activeRevision ?? null,
      expected_document_row_version: activeRevision === undefined ? 0 : 1,
      revision: targetRevision,
      state: options.targetState ?? "candidate",
      system_metadata: options.targetSystemMetadata ?? {},
    }),
  });
  const state = {
    activity: null as Record<string, unknown> | null,
    document,
    documentPresent: options.documentPresent !== false,
    revisions,
  };

  const fixture = databaseFixture(async (input) => {
    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (input.tableName === "document_compilation_attempts") {
      return {
        rows: options.attemptPresent === false ? [] : [{ id: attemptId }],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "document_assets") {
      return {
        rows:
          options.assetPresent === false
            ? []
            : [
                {
                  metadata:
                    options.assetPermissionScope === null
                      ? {}
                      : { permissionScope: options.assetPermissionScope ?? permissionScopes() },
                },
              ],
        rowsAffected: 0,
      };
    }
    if (input.tableName === "knowledge_space_activity_events") {
      if (input.operation === "insert") {
        state.activity = activityRowFromInsert(input);
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: state.activity ? [state.activity] : [], rowsAffected: 0 };
    }
    if (input.tableName === "logical_documents") {
      if (input.operation === "select") {
        return { rows: state.documentPresent ? [state.document] : [], rowsAffected: 0 };
      }
      if (input.operation === "delete") {
        state.documentPresent = false;
        return { rows: [], rowsAffected: 1 };
      }
      if (input.sql.includes("active_revision")) {
        const rowsAffected = options.moveRowsAffected ?? 1;
        if (rowsAffected === 1) {
          state.document.active_revision = Number(input.params[0]);
          state.document.row_version = Number(state.document.row_version) + 1;
          state.document.status = "ready";
          state.document.updated_at = String(input.params[1]);
        }
        return { rows: [], rowsAffected };
      }
      if (input.sql.includes("status") && input.sql.includes("'failed'")) {
        state.document.status = "failed";
        state.document.updated_at = String(input.params[0]);
        return { rows: [], rowsAffected: 1 };
      }
    }
    if (input.tableName === "document_revisions") {
      if (input.operation === "select" && input.sql.includes("SELECT 1 AS")) {
        return { rows: revisions.size > 0 ? [{ present: 1 }] : [], rowsAffected: 0 };
      }
      if (input.operation === "select" && input.sql.includes("LIMIT 2 FOR UPDATE")) {
        const target = revisions.get(targetRevision);
        return {
          rows:
            options.referenceRows ??
            (target
              ? [
                  {
                    document_asset_version: target.document_asset_version,
                    document_id: target.document_id,
                    revision: target.revision,
                  },
                ]
              : []),
          rowsAffected: 0,
        };
      }
      if (input.operation === "select") {
        const revision = Number(input.params[3]);
        const row = revisions.get(revision);
        return { rows: row ? [row] : [], rowsAffected: 0 };
      }
      if (input.operation === "delete") {
        const rowsAffected = options.removeRowsAffected ?? 1;
        if (rowsAffected === 1) revisions.delete(Number(input.params[3]));
        return { rows: [], rowsAffected };
      }
      if (input.sql.includes("compilation_attempt_id")) {
        const rowsAffected = options.bindRowsAffected ?? 1;
        const row = revisions.get(Number(input.params[4]));
        if (rowsAffected === 1 && row) row.compilation_attempt_id = input.params[0];
        return { rows: [], rowsAffected };
      }
      if (input.sql.includes("'superseded'")) {
        const rowsAffected = options.supersedeRowsAffected ?? 1;
        const row = revisions.get(Number(input.params[3]));
        if (rowsAffected === 1 && row) row.state = "superseded";
        return { rows: [], rowsAffected };
      }
      if (input.sql.includes("'active'")) {
        const rowsAffected = options.activateRowsAffected ?? 1;
        const row = revisions.get(Number(input.params[4]));
        if (rowsAffected === 1 && row) {
          row.activated_at = input.params[0];
          row.state = "active";
        }
        return { rows: [], rowsAffected };
      }
      if (input.sql.includes("'failed'")) {
        const rowsAffected = options.failRowsAffected ?? 1;
        const row = revisions.get(Number(input.params[3]));
        if (rowsAffected === 1 && row) row.state = "failed";
        return { rows: [], rowsAffected };
      }
    }
    return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
  });
  const repository = createDatabaseLogicalDocumentRepository({
    database: fixture.database,
    maxListLimit: 10,
  });
  return { ...fixture, repository, state };
}

function candidateCreationFixture(input: {
  readonly anchorSourceId?: string | undefined;
  readonly assetPresent?: boolean | undefined;
  readonly mode: "collision" | "new" | "replay";
  readonly parentPresent?: boolean | undefined;
  readonly replayContentHash?: string | undefined;
  readonly replayStatus?: "pending" | "ready" | undefined;
}) {
  let storedDocument: Record<string, unknown> | null =
    input.mode === "new"
      ? null
      : {
          ...documentRow({
            active_revision: null,
            source_id: input.mode === "collision" ? "different-source" : sourceId,
            status: input.replayStatus ?? "pending",
          }),
        };
  let storedRevision: Record<string, unknown> | null =
    input.mode === "replay"
      ? {
          ...revisionRow({
            activated_at: null,
            compilation_attempt_id: null,
            content_hash: input.replayContentHash ?? "a".repeat(64),
          }),
        }
      : null;
  const fixture = databaseFixture(async (query) => {
    if (query.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (query.tableName === "document_assets") {
      return {
        rows:
          input.assetPresent === false
            ? []
            : [
                {
                  id: assetIds[0],
                  metadata: { permissionScope: permissionScopes() },
                  source_id: sourceId,
                },
              ],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "sources") {
      return { rows: [{ id: sourceId }], rowsAffected: 0 };
    }
    if (query.tableName === "logical_documents") {
      if (query.operation === "insert") {
        storedDocument = {
          ...documentRow({
            active_revision: null,
            id: query.params[0],
            provider_item_id: query.params[4],
            row_version: 0,
            source_id: query.params[3],
            status: "pending",
            system_metadata: JSON.parse(String(query.params[7])) as unknown,
            title: query.params[6],
            user_metadata: JSON.parse(String(query.params[8])) as unknown,
          }),
        };
        return { rows: [], rowsAffected: 1 };
      }
      if (query.sql.includes("provider_item_digest")) {
        return {
          rows: input.mode === "collision" && storedDocument ? [storedDocument] : [],
          rowsAffected: 0,
        };
      }
      return {
        rows: input.parentPresent === false || !storedDocument ? [] : [storedDocument],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "document_revisions") {
      if (query.operation === "insert") {
        storedRevision = {
          ...revisionRow({
            activated_at: null,
            compilation_attempt_id: null,
            content_hash: query.params[9],
            document_asset_id: query.params[4],
            document_asset_version: query.params[5],
            document_id: query.params[2],
            expected_active_revision: query.params[7],
            expected_document_row_version: query.params[8],
            revision: query.params[3],
            system_metadata: JSON.parse(String(query.params[12])) as unknown,
          }),
        };
        return { rows: [], rowsAffected: 1 };
      }
      if (query.sql.includes(" JOIN ")) {
        return {
          rows: [
            {
              metadata: { permissionScope: permissionScopes() },
              source_id: input.anchorSourceId ?? sourceId,
            },
          ],
          rowsAffected: 0,
        };
      }
      if (query.sql.includes("COALESCE(MAX")) {
        return { rows: [{ max_revision: 0 }], rowsAffected: 0 };
      }
      if (query.sql.includes("document_asset_id")) {
        return {
          rows: input.mode === "replay" && storedRevision ? [storedRevision] : [],
          rowsAffected: 0,
        };
      }
      return { rows: storedRevision ? [storedRevision] : [], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: query.operation === "select" ? 0 : 1 };
  });
  return {
    ...fixture,
    repository: createDatabaseLogicalDocumentRepository({
      database: fixture.database,
      generateDocumentId: () => documentIds[0],
      maxListLimit: 10,
    }),
  };
}

function permissionScopes(): readonly string[] {
  return [`knowledge-space:${knowledgeSpaceId}`, `tenant:${tenantId}`].sort();
}

function activityRowFromInsert(input: DatabaseExecuteInput): Record<string, unknown> {
  return {
    action: input.params[5],
    actor_subject_id: input.params[4],
    actor_type: input.params[3],
    details: JSON.parse(String(input.params[10])) as unknown,
    id: input.params[0],
    knowledge_space_id: input.params[2],
    occurred_at: input.params[11],
    required_permission_scope: JSON.parse(String(input.params[9])) as unknown,
    resource_id: input.params[7],
    resource_type: input.params[6],
    result: input.params[8],
    tenant_id: input.params[1],
  };
}
