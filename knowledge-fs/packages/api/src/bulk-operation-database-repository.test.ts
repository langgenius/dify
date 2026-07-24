import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult, DatabaseRow } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseBulkOperationRepository } from "./bulk-operation-database-repository";

const TENANT_ID = "tenant-1";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const BULK_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
const COMPILATION_JOB_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-07-23T12:00:00.000Z";

describe.each(["postgres", "tidb"] as const)(
  "database bulk operation repository (%s)",
  (dialect) => {
    it("persists JSON items and capability-only provenance", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          return { rows: [], rowsAffected: 1 };
        },
        kind: dialect,
      });
      const repository = createDatabaseBulkOperationRepository({
        database,
        maxItems: 10,
        maxListLimit: 100,
      });

      await expect(
        repository.create({
          capabilityGrantId: GRANT_ID,
          id: BULK_ID,
          items: [
            {
              compilationJobId: COMPILATION_JOB_ID,
              documentId: "44444444-4444-4444-8444-444444444444",
              requiredPermissionScope: ["team:camera"],
              status: "queued",
            },
          ],
          knowledgeSpaceId: SPACE_ID,
          requestedBySubjectId: "editor-1",
          tenantId: TENANT_ID,
          type: "document_reindex",
        }),
      ).resolves.toMatchObject({
        capabilityGrantId: GRANT_ID,
        id: BULK_ID,
        type: "document_reindex",
      });

      expect(calls[0]?.params.slice(0, 8)).toEqual([
        BULK_ID,
        TENANT_ID,
        SPACE_ID,
        "document_reindex",
        expect.stringContaining("team:camera"),
        JSON.stringify(["team:camera"]),
        false,
        GRANT_ID,
      ]);
      expect(calls[0]?.params[11]).toBe("editor-1");
      expect(calls[0]?.sql).toContain(dialect === "postgres" ? "::jsonb" : " AS JSON");
      expect(calls[0]?.sql.toLowerCase()).not.toContain("bearer");
    });

    it("finds visible grouped jobs even when their bulk row is outside the current page", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          return { rows: [bulkRow()], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const repository = createDatabaseBulkOperationRepository({
        database,
        maxItems: 10,
        maxListLimit: 100,
      });

      await expect(
        repository.findGroupedCompilationJobIds({
          candidateGrants: ["team:camera"],
          compilationJobIds: [COMPILATION_JOB_ID],
          knowledgeSpaceId: SPACE_ID,
          requestedBySubjectId: "editor-1",
          tenantId: TENANT_ID,
        }),
      ).resolves.toEqual([COMPILATION_JOB_ID]);

      expect(calls[0]?.params).toEqual([
        TENANT_ID,
        SPACE_ID,
        JSON.stringify(["team:camera"]),
        "editor-1",
        JSON.stringify([{ compilationJobId: COMPILATION_JOB_ID }]),
        1,
      ]);
      const sql = calls[0]?.sql ?? "";
      expect(sql).toContain(
        dialect === "postgres" ? '"items" @> $5::jsonb' : "JSON_CONTAINS(`items`, CAST(? AS JSON))",
      );
      expect(sql.indexOf("items")).toBeLessThan(sql.indexOf("LIMIT"));
    });

    it("applies tenant, space, candidate ACL and requester predicates before LIMIT", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          return { rows: [bulkRow()], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const repository = createDatabaseBulkOperationRepository({
        database,
        maxItems: 10,
        maxListLimit: 100,
      });

      await expect(
        repository.list({
          candidateGrants: ["team:camera"],
          cursor: { createdAt: "2026-07-23T13:00:00.000Z", id: BULK_ID },
          knowledgeSpaceId: SPACE_ID,
          limit: 5,
          requestedBySubjectId: "editor-1",
          tenantId: TENANT_ID,
        }),
      ).resolves.toMatchObject({ items: [{ id: BULK_ID }] });

      expect(calls[0]?.params).toEqual([
        TENANT_ID,
        SPACE_ID,
        JSON.stringify(["team:camera"]),
        "editor-1",
        "2026-07-23T13:00:00.000Z",
        BULK_ID,
        6,
      ]);
      const sql = calls[0]?.sql ?? "";
      const acl = dialect === "postgres" ? "::jsonb @>" : "JSON_CONTAINS";
      for (const predicate of [
        "tenant_id",
        "knowledge_space_id",
        acl,
        "has_not_found_items",
        "requested_by_subject_id",
      ]) {
        expect(sql.indexOf(predicate), predicate).toBeGreaterThanOrEqual(0);
        expect(sql.indexOf(predicate), predicate).toBeLessThan(sql.indexOf("LIMIT"));
      }
      expect(sql).toContain(
        dialect === "postgres"
          ? 'ORDER BY "created_at" DESC, "id" DESC'
          : "ORDER BY `created_at` DESC, `id` DESC",
      );
    });

    it("maps durable legacy permission provenance on exact tenant reads", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          return {
            rows: [
              bulkRow({
                capability_grant_id: null,
                permission_access_channel: "interactive",
                permission_snapshot_id: "55555555-5555-4555-8555-555555555555",
                permission_snapshot_revision: 3,
                requested_by_subject_id: "editor-1",
              }),
            ],
            rowsAffected: 0,
          };
        },
        kind: dialect,
      });
      const repository = createDatabaseBulkOperationRepository({
        database,
        maxItems: 10,
        maxListLimit: 100,
      });

      await expect(repository.get({ id: BULK_ID, tenantId: TENANT_ID })).resolves.toMatchObject({
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "55555555-5555-4555-8555-555555555555",
          revision: 3,
        },
        requestedBySubjectId: "editor-1",
      });
      expect(calls[0]?.params).toEqual([TENANT_ID, BULK_ID]);
    });
  },
);

describe("database bulk operation repository validation", () => {
  it("rejects invalid configuration and bounded inputs before querying", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async (): Promise<DatabaseExecuteResult> => ({ rows: [], rowsAffected: 0 }),
      kind: "postgres",
    });
    expect(() =>
      createDatabaseBulkOperationRepository({ database, maxItems: 0, maxListLimit: 1 }),
    ).toThrow("maxItems must be positive");
    expect(() =>
      createDatabaseBulkOperationRepository({ database, maxItems: 1, maxListLimit: 0 }),
    ).toThrow("maxListLimit must be positive");

    const repository = createDatabaseBulkOperationRepository({
      database,
      maxItems: 1,
      maxListLimit: 1,
    });
    await expect(
      repository.create({
        capabilityGrantId: GRANT_ID,
        id: BULK_ID,
        items: [
          {
            documentId: "44444444-4444-4444-8444-444444444444",
            status: "queued",
          },
          {
            documentId: "55555555-5555-4555-8555-555555555555",
            status: "queued",
          },
        ],
        knowledgeSpaceId: SPACE_ID,
        tenantId: TENANT_ID,
        type: "document_reindex",
      }),
    ).rejects.toThrow("maxItems=1 exceeded");
    await expect(
      repository.findGroupedCompilationJobIds({
        candidateGrants: [],
        compilationJobIds: [],
        knowledgeSpaceId: SPACE_ID,
        requestedBySubjectId: "editor-1",
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.findGroupedCompilationJobIds({
        candidateGrants: [],
        compilationJobIds: [COMPILATION_JOB_ID, "66666666-6666-4666-8666-666666666666"],
        knowledgeSpaceId: SPACE_ID,
        requestedBySubjectId: "editor-1",
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("at most 1 ids");
    await expect(
      repository.list({
        candidateGrants: [],
        knowledgeSpaceId: SPACE_ID,
        limit: 0,
        requestedBySubjectId: "editor-1",
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("between 1 and 1");
    await expect(
      repository.list({
        candidateGrants: [],
        knowledgeSpaceId: SPACE_ID,
        limit: 2,
        requestedBySubjectId: "editor-1",
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("between 1 and 1");
    await expect(repository.get({ id: BULK_ID, tenantId: TENANT_ID })).resolves.toBeNull();
  });

  it("persists permission-snapshot provenance and absent optional item fields", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return { rows: [], rowsAffected: 1 };
      },
      kind: "postgres",
    });
    const repository = createDatabaseBulkOperationRepository({
      database,
      maxItems: 2,
      maxListLimit: 10,
    });

    await expect(
      repository.create({
        id: BULK_ID,
        items: [
          {
            documentId: "44444444-4444-4444-8444-444444444444",
            status: "not_found",
          },
        ],
        knowledgeSpaceId: SPACE_ID,
        permissionSnapshot: {
          accessChannel: "agent",
          id: "55555555-5555-4555-8555-555555555555",
          revision: 4,
        },
        tenantId: TENANT_ID,
        type: "document_upload",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        items: [
          {
            documentId: "44444444-4444-4444-8444-444444444444",
            status: "not_found",
          },
        ],
        permissionSnapshot: {
          accessChannel: "agent",
          id: "55555555-5555-4555-8555-555555555555",
          revision: 4,
        },
      }),
    );
    expect(calls[0]?.params.slice(6, 12)).toEqual([
      true,
      null,
      "agent",
      "55555555-5555-4555-8555-555555555555",
      4,
      null,
    ]);
  });

  it("returns a stable next cursor only when another row exists", async () => {
    const secondId = "77777777-7777-4777-8777-777777777777";
    const database = createSchemaDatabaseAdapter({
      executor: async (): Promise<DatabaseExecuteResult> => ({
        rows: [bulkRow(), bulkRow({ id: secondId })],
        rowsAffected: 0,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseBulkOperationRepository({
      database,
      maxItems: 10,
      maxListLimit: 10,
    });

    await expect(
      repository.list({
        candidateGrants: ["team:camera"],
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        requestedBySubjectId: "editor-1",
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: BULK_ID })],
      nextCursor: { createdAt: CREATED_AT, id: BULK_ID },
    });
  });

  it.each([
    ["operation type", { operation_type: "unknown" }, "type is invalid"],
    [
      "incomplete permission snapshot",
      { permission_access_channel: "interactive" },
      "permission snapshot is invalid",
    ],
    [
      "permission access channel",
      {
        permission_access_channel: "browser",
        permission_snapshot_id: "55555555-5555-4555-8555-555555555555",
        permission_snapshot_revision: 1,
      },
      "access channel is invalid",
    ],
    ["non-object item", { items: JSON.stringify([null]) }, "item is invalid"],
    [
      "empty document id",
      { items: JSON.stringify([{ documentId: "", status: "queued" }]) },
      "item is invalid",
    ],
    [
      "compilation job id",
      { items: JSON.stringify([{ compilationJobId: 1, documentId: "doc-1", status: "queued" }]) },
      "item is invalid",
    ],
    [
      "error message",
      { items: JSON.stringify([{ documentId: "doc-1", error: 1, status: "failed" }]) },
      "item is invalid",
    ],
    [
      "item status",
      { items: JSON.stringify([{ documentId: "doc-1", status: "running" }]) },
      "item is invalid",
    ],
    [
      "permission scope",
      {
        items: JSON.stringify([
          { documentId: "doc-1", requiredPermissionScope: [1], status: "queued" },
        ]),
      },
      "permission scope is invalid",
    ],
  ] as const)("rejects an invalid %s", async (_name, patch, message) => {
    const database = createSchemaDatabaseAdapter({
      executor: async (): Promise<DatabaseExecuteResult> => ({
        rows: [bulkRow(patch)],
        rowsAffected: 0,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseBulkOperationRepository({
      database,
      maxItems: 10,
      maxListLimit: 10,
    });

    await expect(repository.get({ id: BULK_ID, tenantId: TENANT_ID })).rejects.toThrow(message);
  });

  it.each(["service_api", "mcp", "agent"] as const)(
    "maps the %s permission access channel",
    async (accessChannel) => {
      const database = createSchemaDatabaseAdapter({
        executor: async (): Promise<DatabaseExecuteResult> => ({
          rows: [
            bulkRow({
              capability_grant_id: null,
              permission_access_channel: accessChannel,
              permission_snapshot_id: "55555555-5555-4555-8555-555555555555",
              permission_snapshot_revision: 2,
              requested_by_subject_id: "editor-1",
            }),
          ],
          rowsAffected: 0,
        }),
        kind: "postgres",
      });
      const repository = createDatabaseBulkOperationRepository({
        database,
        maxItems: 10,
        maxListLimit: 10,
      });

      await expect(repository.get({ id: BULK_ID, tenantId: TENANT_ID })).resolves.toMatchObject({
        permissionSnapshot: { accessChannel },
      });
    },
  );

  it("maps a delete item without optional fields", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async (): Promise<DatabaseExecuteResult> => ({
        rows: [
          bulkRow({
            capability_grant_id: null,
            items: JSON.stringify([{ documentId: "doc-1", status: "completed" }]),
            operation_type: "document_delete",
            requested_by_subject_id: null,
          }),
        ],
        rowsAffected: 0,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseBulkOperationRepository({
      database,
      maxItems: 10,
      maxListLimit: 10,
    });

    await expect(repository.get({ id: BULK_ID, tenantId: TENANT_ID })).resolves.toEqual(
      expect.objectContaining({
        items: [{ documentId: "doc-1", status: "completed" }],
        type: "document_delete",
      }),
    );
  });

  it("ignores rows that do not contain a requested compilation job", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async (): Promise<DatabaseExecuteResult> => ({
        rows: [
          bulkRow({
            items: JSON.stringify([
              { documentId: "doc-1", status: "queued" },
              { compilationJobId: "other-job", documentId: "doc-2", status: "queued" },
            ]),
          }),
        ],
        rowsAffected: 0,
      }),
      kind: "postgres",
    });
    const repository = createDatabaseBulkOperationRepository({
      database,
      maxItems: 10,
      maxListLimit: 10,
    });

    await expect(
      repository.findGroupedCompilationJobIds({
        candidateGrants: ["team:camera"],
        compilationJobIds: [COMPILATION_JOB_ID],
        knowledgeSpaceId: SPACE_ID,
        requestedBySubjectId: "editor-1",
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual([]);
  });
});

function bulkRow(patch: Partial<DatabaseRow> = {}): DatabaseRow {
  return {
    capability_grant_id: GRANT_ID,
    created_at: CREATED_AT,
    id: BULK_ID,
    items: JSON.stringify([
      {
        compilationJobId: COMPILATION_JOB_ID,
        documentId: "44444444-4444-4444-8444-444444444444",
        requiredPermissionScope: ["team:camera"],
        status: "queued",
      },
    ]),
    knowledge_space_id: SPACE_ID,
    operation_type: "document_reindex",
    permission_access_channel: null,
    permission_snapshot_id: null,
    permission_snapshot_revision: null,
    requested_by_subject_id: null,
    tenant_id: TENANT_ID,
    updated_at: CREATED_AT,
    ...patch,
  };
}
