import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  LogicalDocumentConflictError,
  LogicalDocumentNotFoundError,
  type LogicalDocumentRepository,
  LogicalDocumentValidationError,
  createDatabaseLogicalDocumentRepository,
  createInMemoryLogicalDocumentRepository,
} from "./logical-document-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const firstAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
const secondAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const otherSourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02";

describe("logical document repository", () => {
  it("keeps pending and failed aggregates visible when their candidate revision is readable", async () => {
    const repository = memoryRepository();
    const created = await repository.createCandidateRevision(
      createRevisionInput({ documentAssetId: firstAssetId }),
    );

    await expect(
      repository.list({
        candidateGrants: ["document:read"],
        knowledgeSpaceId,
        limit: 10,
        tenantId,
      }),
    ).resolves.toMatchObject({
      items: [{ active: null, id: documentId, status: "pending" }],
    });

    await repository.failCandidate({
      documentId,
      knowledgeSpaceId,
      now: "2026-07-14T12:01:00.000Z",
      revision: created.revision.revision,
      tenantId,
    });

    await expect(repository.get({ documentId, knowledgeSpaceId, tenantId })).resolves.toMatchObject(
      { active: null, status: "failed" },
    );
    await expect(
      repository.list({
        candidateGrants: ["document:read"],
        knowledgeSpaceId,
        limit: 10,
        tenantId,
      }),
    ).resolves.toMatchObject({
      items: [{ active: null, id: documentId, status: "failed" }],
    });
  });

  it("rolls back only by appending and publishing a new immutable candidate", async () => {
    const repository = memoryRepository();
    const first = await repository.createCandidateRevision(
      createRevisionInput({ documentAssetId: firstAssetId }),
    );
    const activeFirst = await repository.activateRevision({
      documentId,
      expectedActiveRevision: null,
      expectedRowVersion: 0,
      knowledgeSpaceId,
      now: "2026-07-14T12:01:00.000Z",
      revision: first.revision.revision,
      tenantId,
    });
    const second = await repository.createCandidateRevision(
      createRevisionInput({
        documentAssetId: secondAssetId,
        documentId,
        expectedActiveRevision: activeFirst.activeRevision ?? null,
        expectedDocumentRowVersion: activeFirst.rowVersion,
      }),
    );
    const activeSecond = await repository.activateRevision({
      documentId,
      expectedActiveRevision: activeFirst.activeRevision ?? null,
      expectedRowVersion: activeFirst.rowVersion,
      knowledgeSpaceId,
      now: "2026-07-14T12:02:00.000Z",
      revision: second.revision.revision,
      tenantId,
    });

    expect("rollback" in repository).toBe(false);
    await expect(
      repository.activateRevision({
        documentId,
        expectedActiveRevision: activeSecond.activeRevision ?? null,
        expectedRowVersion: activeSecond.rowVersion,
        knowledgeSpaceId,
        now: "2026-07-14T12:03:00.000Z",
        revision: first.revision.revision,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(LogicalDocumentValidationError);

    const rollbackCandidate = await repository.createCandidateRevision(
      createRevisionInput({
        documentAssetId: firstAssetId,
        documentId,
        expectedActiveRevision: activeSecond.activeRevision ?? null,
        expectedDocumentRowVersion: activeSecond.rowVersion,
        rollbackOfRevision: first.revision.revision,
      }),
    );
    expect(rollbackCandidate.revision).toMatchObject({
      documentAssetId: firstAssetId,
      revision: 3,
      state: "candidate",
    });
    const rolledBack = await repository.activateRevision({
      documentId,
      expectedActiveRevision: activeSecond.activeRevision ?? null,
      expectedRowVersion: activeSecond.rowVersion,
      knowledgeSpaceId,
      now: "2026-07-14T12:04:00.000Z",
      revision: rollbackCandidate.revision.revision,
      tenantId,
    });
    expect(rolledBack).toMatchObject({
      active: { documentAssetId: firstAssetId, revision: 3, state: "active" },
      activeRevision: 3,
      rowVersion: 3,
    });
    await expect(
      repository.listRevisions({
        candidateGrants: ["document:read"],
        documentId,
        knowledgeSpaceId,
        limit: 10,
        tenantId,
      }),
    ).resolves.toMatchObject({
      items: [
        { revision: 3, state: "active" },
        { revision: 2, state: "superseded" },
        { revision: 1, state: "superseded" },
      ],
    });
  });

  it("keeps user metadata isolated from reserved fields and enforces row-version CAS", async () => {
    const repository = memoryRepository();
    await repository.createCandidateRevision(
      createRevisionInput({ documentAssetId: firstAssetId }),
    );
    const permission = {
      accessChannel: "interactive" as const,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
      revision: 1,
    };

    await expect(
      repository.patchUserMetadata({
        documentId,
        expectedRowVersion: 0,
        knowledgeSpaceId,
        now: "2026-07-14T12:01:00.000Z",
        patch: { sourceId: "forged-source" },
        permissionSnapshot: permission,
        requestedBySubjectId: "editor-a",
        tenantId,
      }),
    ).rejects.toBeInstanceOf(LogicalDocumentValidationError);

    const updated = await repository.patchUserMetadata({
      documentId,
      expectedRowVersion: 0,
      knowledgeSpaceId,
      now: "2026-07-14T12:02:00.000Z",
      patch: { category: "camera" },
      permissionSnapshot: permission,
      requestedBySubjectId: "editor-a",
      tenantId,
    });
    expect(updated).toMatchObject({ rowVersion: 1, userMetadata: { category: "camera" } });

    await expect(
      repository.patchUserMetadata({
        documentId,
        expectedRowVersion: 0,
        knowledgeSpaceId,
        now: "2026-07-14T12:03:00.000Z",
        patch: { category: "stale" },
        permissionSnapshot: permission,
        requestedBySubjectId: "editor-a",
        tenantId,
      }),
    ).rejects.toBeInstanceOf(LogicalDocumentConflictError);
  });

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`applies candidate ACL before LIMIT while selecting active or latest pending/failed anchors (${dialect})`, async () => {
      const calls: DatabaseExecuteInput[] = [];
      const rows = [
        logicalDocumentRow({ id: documentId, status: "pending" }),
        logicalDocumentRow({
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
          status: "failed",
        }),
      ];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          return {
            rows: input.tableName === "logical_documents" ? rows.slice(0, input.maxRows) : [],
            rowsAffected: 0,
          };
        },
        kind: dialect,
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database,
        maxListLimit: 100,
      });

      const listed = await repository.list({
        candidateGrants: ["document:read"],
        knowledgeSpaceId,
        limit: 2,
        tenantId,
      });
      expect(listed.items.map((item) => [item.status, item.active])).toEqual([
        ["pending", null],
        ["failed", null],
      ]);

      const query = calls.find(
        (call) => call.operation === "select" && call.tableName === "logical_documents",
      );
      expect(query?.params).toEqual([
        tenantId,
        knowledgeSpaceId,
        JSON.stringify(["document:read"]),
        3,
      ]);
      expect(query?.sql).toContain("active_revision");
      expect(query?.sql).toContain("IS NULL");
      expect(query?.sql).toContain("MAX");
      expect(query?.sql).toContain("candidate");
      expect(query?.sql).toContain("failed");
      expect(query?.sql).toContain("permissionScope");
      expect(query?.sql.indexOf("permissionScope")).toBeLessThan(
        query?.sql.lastIndexOf("LIMIT") ?? -1,
      );
      expectAssetDeletionVisibilityBeforeLimit(query?.sql, dialect, "document_list_parent_source");

      await repository.listRevisions({
        candidateGrants: ["document:read"],
        documentId,
        knowledgeSpaceId,
        limit: 2,
        tenantId,
      });
      const revisionQuery = calls.find(
        (call) => call.operation === "select" && call.tableName === "document_revisions",
      );
      expectAssetDeletionVisibilityBeforeLimit(
        revisionQuery?.sql,
        dialect,
        "revision_list_parent_source",
      );
    });
  }

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`revalidates an explicit target and atomically inherits its active asset scope (${dialect})`, async () => {
      const fixture = targetedAppendDatabase(dialect, {
        targetPermissionScope: actorPermissionScopes(),
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(
        repository.createCandidateRevision(targetedRevisionInput()),
      ).resolves.toMatchObject({
        revision: { documentId, revision: 2, state: "candidate" },
      });
      const scopeUpdate = fixture.calls.find(
        (call) => call.operation === "update" && call.tableName === "document_assets",
      );
      expect(scopeUpdate).toBeDefined();
      expect(JSON.parse(String(scopeUpdate?.params[0]))).toMatchObject({
        permissionScope: actorPermissionScopes(),
      });
      expect(
        fixture.calls.some(
          (call) => call.operation === "insert" && call.tableName === "document_revisions",
        ),
      ).toBe(true);
    });

    it(`conceals an explicit target outside the partial member's candidate scope before CAS (${dialect})`, async () => {
      const fixture = targetedAppendDatabase(dialect, {
        targetPermissionScope: [`knowledge-space:${knowledgeSpaceId}:member:another-editor`],
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(
        repository.createCandidateRevision(
          targetedRevisionInput({ expectedDocumentRowVersion: 0 }),
        ),
      ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
      expect(
        fixture.calls.some(
          (call) =>
            call.operation === "update" ||
            (call.operation === "insert" && call.tableName === "document_revisions"),
        ),
      ).toBe(false);
    });

    it(`fails a targeted append when its permission is revoked before the final transaction (${dialect})`, async () => {
      const fixture = targetedAppendDatabase(dialect, {
        revokeAtFinalFence: true,
        targetPermissionScope: actorPermissionScopes(),
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(
        repository.createCandidateRevision(targetedRevisionInput()),
      ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
      expect(
        fixture.calls.some(
          (call) =>
            call.operation === "update" ||
            (call.operation === "insert" && call.tableName === "document_revisions"),
        ),
      ).toBe(false);
    });

    for (const failure of ["revoked", "deleting", "partial-member"] as const) {
      it(`leaves no rollback candidate after ${failure} admission failure (${dialect})`, async () => {
        const fixture = targetedAppendDatabase(dialect, {
          candidatePermissionScope:
            failure === "partial-member"
              ? [`knowledge-space:${knowledgeSpaceId}:member:another-editor`]
              : actorPermissionScopes(),
          deletingSpace: failure === "deleting",
          revokeAtFinalFence: failure === "revoked",
          targetPermissionScope: actorPermissionScopes(),
        });
        const repository = createDatabaseLogicalDocumentRepository({
          database: fixture.database,
          maxListLimit: 100,
        });

        await expect(
          repository.createCandidateRevision(
            targetedRevisionInput({
              documentAssetId: firstAssetId,
              rollbackOfRevision: 1,
            }),
          ),
        ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
        expect(
          fixture.calls.some(
            (call) => call.operation === "insert" && call.tableName === "document_revisions",
          ),
        ).toBe(false);
      });
    }

    it(`locks and revalidates the candidate asset parent Source before append (${dialect})`, async () => {
      const fixture = targetedAppendDatabase(dialect, {
        candidateSourceAvailable: false,
        candidateSourceId: sourceId,
        targetPermissionScope: actorPermissionScopes(),
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(
        repository.createCandidateRevision(targetedRevisionInput()),
      ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
      expect(
        fixture.calls.some(
          (call) => call.operation === "insert" && call.tableName === "document_revisions",
        ),
      ).toBe(false);
    });

    it(`rejects a Source identity that does not own the candidate asset (${dialect})`, async () => {
      const fixture = targetedAppendDatabase(dialect, {
        candidateSourceId: sourceId,
        targetPermissionScope: actorPermissionScopes(),
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(
        repository.createCandidateRevision(
          targetedRevisionInput({
            providerItemId: "provider-item-a",
            sourceId: otherSourceId,
          }),
        ),
      ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
      expect(
        fixture.calls.some(
          (call) => call.operation === "insert" && call.tableName === "document_revisions",
        ),
      ).toBe(false);
    });

    it(`revalidates an existing provider document and its current anchor before append (${dialect})`, async () => {
      const fixture = providerAppendDatabase(dialect, {
        targetPermissionScope: actorPermissionScopes(),
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(
        repository.createCandidateRevision(providerRevisionInput()),
      ).resolves.toMatchObject({
        document: { id: documentId, sourceId, status: "ready" },
        revision: { documentId, revision: 2, state: "candidate" },
      });
      const logicalFence = fixture.calls.findIndex(
        (call) =>
          call.tableName === "logical_documents" &&
          call.sql.includes("deletion_job_id") &&
          call.sql.includes("FOR UPDATE"),
      );
      const anchorFence = fixture.calls.findIndex(
        (call) => call.tableName === "document_revisions" && call.sql.includes(" JOIN "),
      );
      const insert = fixture.calls.findIndex(
        (call) => call.operation === "insert" && call.tableName === "document_revisions",
      );
      expect(logicalFence).toBeGreaterThanOrEqual(0);
      expect(anchorFence).toBeGreaterThanOrEqual(0);
      expect(logicalFence).toBeLessThan(insert);
      expect(anchorFence).toBeLessThan(insert);
    });

    for (const failure of ["current-scope", "deleting-document"] as const) {
      it(`leaves no provider revision after ${failure} admission failure (${dialect})`, async () => {
        const fixture = providerAppendDatabase(dialect, {
          deletingDocument: failure === "deleting-document",
          targetPermissionScope:
            failure === "current-scope"
              ? [`knowledge-space:${knowledgeSpaceId}:member:another-editor`]
              : actorPermissionScopes(),
        });
        const repository = createDatabaseLogicalDocumentRepository({
          database: fixture.database,
          maxListLimit: 100,
        });

        await expect(
          repository.createCandidateRevision(providerRevisionInput()),
        ).rejects.toBeInstanceOf(LogicalDocumentNotFoundError);
        expect(
          fixture.calls.some(
            (call) => call.operation === "insert" && call.tableName === "document_revisions",
          ),
        ).toBe(false);
      });
    }

    it(`restricts trusted internal admission to explicit Source candidates (${dialect})`, async () => {
      const fixture = targetedAppendDatabase(dialect, {
        targetPermissionScope: actorPermissionScopes(),
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(
        repository.createCandidateRevision(createRevisionInput({ trustedInternalAdmission: true })),
      ).rejects.toThrow("Trusted internal document admission requires an explicit Source identity");
      expect(fixture.calls).toEqual([]);
    });
  }

  for (const dialect of ["postgres", "tidb"] as const) {
    it(`revalidates metadata mutation permission and current document scope in the CAS transaction (${dialect})`, async () => {
      const fixture = metadataPatchDatabase(dialect, {
        targetPermissionScope: actorPermissionScopes(),
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(repository.patchUserMetadata(metadataPatchInput())).resolves.toMatchObject({
        rowVersion: 2,
        userMetadata: { category: "camera" },
      });
      expect(
        fixture.calls.some(
          (call) => call.operation === "update" && call.tableName === "logical_documents",
        ),
      ).toBe(true);
    });

    it(`conceals metadata mutation when permission is revoked at the final fence (${dialect})`, async () => {
      const fixture = metadataPatchDatabase(dialect, {
        revokeAtFinalFence: true,
        targetPermissionScope: actorPermissionScopes(),
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(repository.patchUserMetadata(metadataPatchInput())).rejects.toBeInstanceOf(
        LogicalDocumentNotFoundError,
      );
      expect(
        fixture.calls.some(
          (call) => call.operation === "update" && call.tableName === "logical_documents",
        ),
      ).toBe(false);
    });

    it(`conceals metadata mutation outside the current candidate scope (${dialect})`, async () => {
      const fixture = metadataPatchDatabase(dialect, {
        targetPermissionScope: [`knowledge-space:${knowledgeSpaceId}:member:another-editor`],
      });
      const repository = createDatabaseLogicalDocumentRepository({
        database: fixture.database,
        maxListLimit: 100,
      });

      await expect(repository.patchUserMetadata(metadataPatchInput())).rejects.toBeInstanceOf(
        LogicalDocumentNotFoundError,
      );
      expect(
        fixture.calls.some(
          (call) => call.operation === "update" && call.tableName === "logical_documents",
        ),
      ).toBe(false);
    });
  }
});

function expectAssetDeletionVisibilityBeforeLimit(
  sql: string | undefined,
  dialect: "postgres" | "tidb",
  sourceAlias: string,
): void {
  expect(sql).toBeDefined();
  const identifier = (value: string) => (dialect === "postgres" ? `"${value}"` : `\`${value}\``);
  const limit = sql?.lastIndexOf("LIMIT") ?? -1;
  for (const predicate of [
    `asset.${identifier("lifecycle_state")} = 'active'`,
    `asset.${identifier("deletion_job_id")} IS NULL`,
    `${sourceAlias}.${identifier("status")} <> 'deleting'`,
    `${sourceAlias}.${identifier("deletion_job_id")} IS NULL`,
  ]) {
    expect(sql).toContain(predicate);
    expect(sql?.indexOf(predicate)).toBeLessThan(limit);
  }
}

function memoryRepository() {
  return createInMemoryLogicalDocumentRepository({
    canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
    canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
    generateDocumentId: () => documentId,
    maxDocuments: 100,
    maxRevisionsPerDocument: 100,
  });
}

function createRevisionInput(
  overrides: Partial<
    Parameters<ReturnType<typeof memoryRepository>["createCandidateRevision"]>[0]
  > = {},
) {
  return {
    contentHash: "a".repeat(64),
    documentAssetId: firstAssetId,
    documentAssetVersion: 1,
    knowledgeSpaceId,
    mimeType: "text/plain",
    now: "2026-07-14T12:00:00.000Z",
    sizeBytes: 12,
    systemMetadata: {},
    tenantId,
    title: "Design notes",
    ...overrides,
  };
}

function logicalDocumentRow(input: { readonly id: string; readonly status: "failed" | "pending" }) {
  return {
    active_revision: null,
    created_at: "2026-07-14T12:00:00.000Z",
    id: input.id,
    knowledge_space_id: knowledgeSpaceId,
    provider_item_id: null,
    row_version: 0,
    source_id: null,
    status: input.status,
    system_metadata: {},
    tenant_id: tenantId,
    title: "Design notes",
    updated_at: "2026-07-14T12:00:00.000Z",
    user_metadata: {},
  };
}

function actorPermissionScopes(): readonly string[] {
  return [
    `knowledge-space:${knowledgeSpaceId}`,
    `knowledge-space:${knowledgeSpaceId}:member:editor-a`,
    `knowledge-space:${knowledgeSpaceId}:role:editor`,
    `knowledge-space:${knowledgeSpaceId}:visibility:partial_members:editor-a`,
    `tenant:${tenantId}`,
  ].sort();
}

function targetedRevisionInput(
  overrides: Partial<Parameters<LogicalDocumentRepository["createCandidateRevision"]>[0]> = {},
) {
  return createRevisionInput({
    documentAssetId: secondAssetId,
    documentId,
    expectedActiveRevision: 1,
    expectedDocumentRowVersion: 1,
    permissionSnapshot: {
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
      permissionScopes: actorPermissionScopes(),
      revision: 1,
    },
    requestedBySubjectId: "editor-a",
    ...overrides,
  });
}

function providerRevisionInput() {
  return createRevisionInput({
    documentAssetId: secondAssetId,
    permissionSnapshot: {
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
      permissionScopes: actorPermissionScopes(),
      revision: 1,
    },
    providerItemId: "provider-item-a",
    requestedBySubjectId: "editor-a",
    sourceId,
  });
}

function metadataPatchInput() {
  return {
    documentId,
    expectedRowVersion: 1,
    knowledgeSpaceId,
    now: "2026-07-14T12:05:00.000Z",
    patch: { category: "camera" },
    permissionSnapshot: {
      accessChannel: "interactive" as const,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
      revision: 1,
    },
    requestedBySubjectId: "editor-a",
    tenantId,
  };
}

function metadataPatchDatabase(
  dialect: "postgres" | "tidb",
  input: {
    readonly revokeAtFinalFence?: boolean;
    readonly targetPermissionScope: readonly string[];
  },
) {
  const calls: DatabaseExecuteInput[] = [];
  let permissionReads = 0;
  let rowVersion = 1;
  let userMetadata: Readonly<Record<string, unknown>> = {};
  const execute = async (query: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(query);
    if (query.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (query.tableName === "logical_documents" && query.operation === "select") {
      return {
        rows: [
          {
            active_revision: 1,
            created_at: "2026-07-14T12:00:00.000Z",
            deletion_job_id: null,
            id: documentId,
            knowledge_space_id: knowledgeSpaceId,
            provider_item_id: null,
            row_version: rowVersion,
            source_id: null,
            status: "ready",
            system_metadata: {},
            tenant_id: tenantId,
            title: "Design notes",
            updated_at: "2026-07-14T12:00:00.000Z",
            user_metadata: userMetadata,
          },
        ],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "logical_documents" && query.operation === "update") {
      userMetadata = JSON.parse(String(query.params[0])) as Readonly<Record<string, unknown>>;
      rowVersion += 1;
      return { rows: [], rowsAffected: 1 };
    }
    if (query.tableName === "knowledge_space_permission_snapshots") {
      permissionReads += 1;
      return {
        rows:
          input.revokeAtFinalFence && permissionReads > 1 ? [] : [permissionSnapshotDatabaseRow()],
        rowsAffected: 0,
      };
    }
    if (
      [
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
      ].includes(query.tableName)
    ) {
      return { rows: [{ id: `${query.tableName}-row` }], rowsAffected: 0 };
    }
    if (query.tableName === "document_revisions" && query.operation === "select") {
      return {
        rows: [
          {
            metadata: { permissionScope: [...input.targetPermissionScope] },
            source_id: null,
          },
        ],
        rowsAffected: 0,
      };
    }
    return { rows: [], rowsAffected: query.operation === "select" ? 0 : 1 };
  };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { calls, database };
}

function targetedAppendDatabase(
  dialect: "postgres" | "tidb",
  input: {
    readonly candidatePermissionScope?: readonly string[];
    readonly candidateSourceAvailable?: boolean;
    readonly candidateSourceId?: string;
    readonly deletingSpace?: boolean;
    readonly revokeAtFinalFence?: boolean;
    readonly targetPermissionScope: readonly string[];
  },
) {
  const calls: DatabaseExecuteInput[] = [];
  let permissionReads = 0;
  const execute = async (query: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(query);
    if (query.tableName === "knowledge_spaces") {
      return {
        rows: [
          {
            deletion_job_id: input.deletingSpace ? "deletion-1" : null,
            id: knowledgeSpaceId,
            lifecycle_state: input.deletingSpace ? "deleting" : "active",
          },
        ],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (query.tableName === "document_assets" && query.operation === "select") {
      return {
        rows: [
          {
            id: secondAssetId,
            metadata: {
              permissionScope: input.candidatePermissionScope ?? actorPermissionScopes(),
            },
            source_id: input.candidateSourceId ?? null,
          },
        ],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "sources") {
      return {
        rows: input.candidateSourceAvailable === false ? [] : [{ id: input.candidateSourceId }],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "logical_documents" && query.operation === "select") {
      return {
        rows: query.sql.includes("deletion_job_id")
          ? [{ id: documentId }]
          : [
              {
                active_revision: 1,
                created_at: "2026-07-14T12:00:00.000Z",
                deletion_job_id: null,
                id: documentId,
                knowledge_space_id: knowledgeSpaceId,
                provider_item_id: null,
                row_version: 1,
                source_id: null,
                status: "ready",
                system_metadata: {},
                tenant_id: tenantId,
                title: "Design notes",
                updated_at: "2026-07-14T12:00:00.000Z",
                user_metadata: {},
              },
            ],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "knowledge_space_permission_snapshots") {
      permissionReads += 1;
      return {
        rows:
          input.revokeAtFinalFence && permissionReads > 1 ? [] : [permissionSnapshotDatabaseRow()],
        rowsAffected: 0,
      };
    }
    if (
      [
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
      ].includes(query.tableName)
    ) {
      return { rows: [{ id: `${query.tableName}-row` }], rowsAffected: 0 };
    }
    if (query.sql.includes("MAX(")) {
      return { rows: [{ max_revision: 1 }], rowsAffected: 0 };
    }
    if (query.tableName === "document_revisions" && query.operation === "select") {
      if (query.sql.includes(" JOIN ")) {
        return {
          rows: [
            {
              metadata: { permissionScope: [...input.targetPermissionScope] },
              source_id: null,
            },
          ],
          rowsAffected: 0,
        };
      }
      if (query.sql.includes("document_asset_id")) return { rows: [], rowsAffected: 0 };
      return { rows: [candidateRevisionDatabaseRow()], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: query.operation === "select" ? 0 : 1 };
  };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { calls, database };
}

function providerAppendDatabase(
  dialect: "postgres" | "tidb",
  input: {
    readonly deletingDocument?: boolean;
    readonly targetPermissionScope: readonly string[];
  },
) {
  const calls: DatabaseExecuteInput[] = [];
  const execute = async (query: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(query);
    if (query.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (query.tableName === "document_assets" && query.operation === "select") {
      return {
        rows: [
          {
            id: secondAssetId,
            metadata: { permissionScope: actorPermissionScopes() },
            source_id: sourceId,
          },
        ],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "sources") {
      return { rows: [{ id: sourceId }], rowsAffected: 0 };
    }
    if (query.tableName === "knowledge_space_permission_snapshots") {
      return { rows: [permissionSnapshotDatabaseRow()], rowsAffected: 0 };
    }
    if (
      [
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
      ].includes(query.tableName)
    ) {
      return { rows: [{ id: `${query.tableName}-row` }], rowsAffected: 0 };
    }
    if (query.tableName === "logical_documents" && query.operation === "select") {
      const row = {
        active_revision: 1,
        created_at: "2026-07-14T12:00:00.000Z",
        deletion_job_id: input.deletingDocument ? "deletion-1" : null,
        id: documentId,
        knowledge_space_id: knowledgeSpaceId,
        provider_item_id: "provider-item-a",
        row_version: 1,
        source_id: sourceId,
        status: input.deletingDocument ? "deleting" : "ready",
        system_metadata: {},
        tenant_id: tenantId,
        title: "Provider document",
        updated_at: "2026-07-14T12:00:00.000Z",
        user_metadata: {},
      };
      if (query.sql.includes("provider_item_digest")) return { rows: [row], rowsAffected: 0 };
      return {
        rows: input.deletingDocument ? [] : [row],
        rowsAffected: 0,
      };
    }
    if (query.tableName === "document_revisions" && query.operation === "select") {
      if (query.sql.includes("COALESCE(MAX")) {
        return { rows: [{ max_revision: 1 }], rowsAffected: 0 };
      }
      if (query.sql.includes(" JOIN ")) {
        return {
          rows: [
            {
              metadata: { permissionScope: [...input.targetPermissionScope] },
              source_id: sourceId,
            },
          ],
          rowsAffected: 0,
        };
      }
      const assetPredicate =
        dialect === "postgres" ? '"document_asset_id" = ' : "`document_asset_id` = ";
      if (query.sql.includes(assetPredicate)) return { rows: [], rowsAffected: 0 };
      return { rows: [candidateRevisionDatabaseRow()], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: query.operation === "select" ? 0 : 1 };
  };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { calls, database };
}

function permissionSnapshotDatabaseRow() {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: "2026-07-14T12:00:00.000Z",
    expires_at: "2026-07-15T12:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: actorPermissionScopes(),
    revision: 1,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: "editor-a",
    tenant_id: tenantId,
    updated_at: "2026-07-14T12:00:00.000Z",
    visibility: "partial_members",
  };
}

function candidateRevisionDatabaseRow() {
  return {
    activated_at: null,
    compilation_attempt_id: null,
    content_hash: "a".repeat(64),
    created_at: "2026-07-14T12:00:00.000Z",
    document_asset_id: secondAssetId,
    document_asset_version: 1,
    document_id: documentId,
    expected_active_revision: 1,
    expected_document_row_version: 1,
    knowledge_space_id: knowledgeSpaceId,
    mime_type: "text/plain",
    revision: 2,
    size_bytes: 12,
    state: "candidate",
    system_metadata: {},
    tenant_id: tenantId,
  };
}
