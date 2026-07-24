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
