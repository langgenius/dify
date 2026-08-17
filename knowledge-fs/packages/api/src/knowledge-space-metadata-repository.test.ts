import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeSpaceMetadataNotFoundError,
  KnowledgeSpaceMetadataValidationError,
  createDatabaseKnowledgeSpaceMetadataRepository,
} from "./knowledge-space-metadata-repository";

const tenantId = "tenant-metadata";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const fieldId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e42";
const now = "2026-08-10T12:00:00.000Z";

describe.each(["postgres", "tidb"] as const)(
  "database knowledge-space metadata repository (%s)",
  (dialect) => {
    it("admits metadata writes through the canonical knowledge-space deletion gate", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let inserted = false;
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [
              {
                deletion_job_id: null,
                id: knowledgeSpaceId,
                lifecycle_state: "active",
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "insert") {
          inserted = true;
          return { rows: [], rowsAffected: 1 };
        }
        if (input.sql.includes("COUNT(*)")) {
          return { rows: [{ field_count: 0 }], rowsAffected: 1 };
        }
        if (input.sql.includes("name") && input.sql.includes("LIMIT 1")) {
          return { rows: [], rowsAffected: 0 };
        }
        return {
          rows: inserted ? [fieldRow({ binding_count: 0 })] : [],
          rowsAffected: inserted ? 1 : 0,
        };
      });
      const repository = createDatabaseKnowledgeSpaceMetadataRepository({
        database,
        generateFieldId: () => fieldId,
        maxListLimit: 100,
      });

      await expect(
        repository.create({
          knowledgeSpaceId,
          name: "priority",
          now,
          subjectId: "account:1",
          tenantId,
          type: "string",
        }),
      ).resolves.toMatchObject({ id: fieldId });

      const spaceAdmission = calls.find((call) => call.tableName === "knowledge_spaces");
      expect(spaceAdmission?.sql).toContain("lifecycle_state");
      expect(spaceAdmission?.sql).toContain("deletion_job_id");
      expect(spaceAdmission?.sql).not.toMatch(/["`]state["`]/u);
      expect(calls.some((call) => call.tableName === "deletion_jobs")).toBe(true);
    });

    it("rejects metadata writes while a durable deletion job is active", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [
              {
                deletion_job_id: null,
                id: knowledgeSpaceId,
                lifecycle_state: "active",
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [{ id: "active-deletion-job" }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseKnowledgeSpaceMetadataRepository({
        database,
        generateFieldId: () => fieldId,
        maxListLimit: 100,
      });

      await expect(
        repository.create({
          knowledgeSpaceId,
          name: "priority",
          now,
          subjectId: "account:1",
          tenantId,
          type: "string",
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceMetadataNotFoundError);
      expect(calls.some((call) => call.operation === "insert")).toBe(false);
    });

    it("lists a bounded field catalog with binding counts and tenant-space keyset scope", async () => {
      let select: DatabaseExecuteInput | undefined;
      const database = testDatabase(dialect, async (input) => {
        select = input;
        return { rows: [fieldRow({ binding_count: "7" })], rowsAffected: 1 };
      });
      const repository = createDatabaseKnowledgeSpaceMetadataRepository({
        database,
        maxListLimit: 100,
      });

      const result = await repository.list({
        cursor: { id: fieldId, name: "department" },
        knowledgeSpaceId,
        limit: 20,
        tenantId,
      });

      expect(result.items).toEqual([
        expect.objectContaining({ count: 7, id: fieldId, name: "priority", type: "string" }),
      ]);
      expect(select?.params.slice(0, 5)).toEqual([
        tenantId,
        knowledgeSpaceId,
        "department",
        "department",
        fieldId,
      ]);
      expect(select?.sql).toContain("logical_document_metadata_bindings");
      expect(select?.sql).toContain("GROUP BY");
      expect(select?.sql).toContain("ORDER BY");
    });

    it("creates a typed field without writing defaults to every document", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let inserted = false;
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [activeSpaceRow()], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "insert") {
          inserted = true;
          return { rows: [], rowsAffected: 1 };
        }
        if (input.sql.includes("COUNT(*)")) {
          return { rows: [{ field_count: 0 }], rowsAffected: 1 };
        }
        if (input.sql.includes("name") && input.sql.includes("LIMIT 1")) {
          return { rows: [], rowsAffected: 0 };
        }
        return {
          rows: inserted ? [fieldRow({ binding_count: 0 })] : [],
          rowsAffected: inserted ? 1 : 0,
        };
      });
      const repository = createDatabaseKnowledgeSpaceMetadataRepository({
        database,
        generateFieldId: () => fieldId,
        maxListLimit: 100,
      });

      await expect(
        repository.create({
          knowledgeSpaceId,
          name: "priority",
          now,
          subjectId: "account:1",
          tenantId,
          type: "string",
        }),
      ).resolves.toMatchObject({ count: 0, id: fieldId, name: "priority" });
      expect(calls.filter((call) => call.operation === "insert")).toHaveLength(1);
      expect(calls.some((call) => call.tableName === "logical_documents")).toBe(false);
    });

    it("validates assigned values against the durable field type", async () => {
      const database = testDatabase(dialect, async () => ({
        rows: [fieldRow({ binding_count: 0, type: "number" })],
        rowsAffected: 1,
      }));
      const repository = createDatabaseKnowledgeSpaceMetadataRepository({
        database,
        maxListLimit: 100,
      });

      await expect(
        repository.validatePatch({
          knowledgeSpaceId,
          patch: { priority: "high" },
          tenantId,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceMetadataValidationError);
      await expect(
        repository.validatePatch({
          knowledgeSpaceId,
          patch: { displayName: "system value", priority: 3 },
          tenantId,
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects reserved field names and impossible ISO timestamps", async () => {
      const database = testDatabase(dialect, async () => ({
        rows: [fieldRow({ binding_count: 0, name: "published_at", type: "time" })],
        rowsAffected: 1,
      }));
      const repository = createDatabaseKnowledgeSpaceMetadataRepository({
        database,
        maxListLimit: 100,
      });

      await expect(
        repository.create({
          knowledgeSpaceId,
          name: "system",
          now,
          subjectId: "account:1",
          tenantId,
          type: "string",
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceMetadataValidationError);
      await expect(
        repository.validatePatch({
          knowledgeSpaceId,
          patch: { published_at: "2026-99-99T12:00:00.000Z" },
          tenantId,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceMetadataValidationError);
    });

    it("reconciles bindings in one bounded insert and syncs active asset metadata", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.operation === "select") {
          return { rows: [fieldRow({ binding_count: 0 })], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseKnowledgeSpaceMetadataRepository({
        database,
        maxListLimit: 100,
      });

      await repository.reconcileDocument({
        documentId,
        knowledgeSpaceId,
        now,
        subjectId: "account:1",
        tenantId,
        userMetadata: { displayName: "Invoice", priority: "high" },
      });

      const bindingCalls = calls.filter(
        (call) => call.tableName === "logical_document_metadata_bindings",
      );
      expect(bindingCalls.map((call) => call.operation)).toEqual(["delete", "insert"]);
      expect(bindingCalls[1]?.params).toEqual([
        tenantId,
        knowledgeSpaceId,
        documentId,
        fieldId,
        "account:1",
        now,
      ]);
      const assetUpdate = calls.find((call) => call.tableName === "document_assets");
      expect(assetUpdate?.operation).toBe("update");
      expect(assetUpdate?.params[0]).toBe(
        JSON.stringify({ displayName: "Invoice", priority: "high" }),
      );
    });

    it("renames and deletes bound values with row-version fencing and asset synchronization", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let renamed = false;
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [activeSpaceRow()], rowsAffected: 1 };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_metadata_fields" && input.operation === "select") {
          if (input.sql.includes("LIMIT 1")) return { rows: [], rowsAffected: 0 };
          return {
            rows: [
              fieldRow({
                binding_count: 2,
                name: renamed ? "topic" : "priority",
                row_version: renamed ? 1 : 0,
              }),
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "knowledge_space_metadata_fields" && input.operation === "update") {
          renamed = true;
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_metadata_fields" && input.operation === "delete") {
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 2 };
      });
      const repository = createDatabaseKnowledgeSpaceMetadataRepository({
        database,
        maxListLimit: 100,
      });

      await expect(
        repository.updateName({
          expectedRowVersion: 0,
          fieldId,
          knowledgeSpaceId,
          name: "topic",
          now,
          subjectId: "account:1",
          tenantId,
        }),
      ).resolves.toMatchObject({ name: "topic", rowVersion: 1 });

      const documentRename = calls.find(
        (call) => call.tableName === "logical_documents" && call.operation === "update",
      );
      expect(documentRename?.sql).toContain("logical_document_metadata_bindings");
      expect(documentRename?.params.slice(0, 2)).toEqual(["priority", "topic"]);
      expect(calls.some((call) => call.tableName === "document_assets")).toBe(true);

      calls.length = 0;
      await expect(
        repository.delete({
          expectedRowVersion: 1,
          fieldId,
          knowledgeSpaceId,
          now,
          tenantId,
        }),
      ).resolves.toBeUndefined();
      expect(
        calls.some((call) => call.tableName === "logical_documents" && call.operation === "update"),
      ).toBe(true);
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_metadata_fields" && call.operation === "delete",
        ),
      ).toBe(true);
      expect(calls.some((call) => call.tableName === "document_assets")).toBe(true);
    });
  },
);

function fieldRow(overrides: DatabaseRow = {}): DatabaseRow {
  return {
    binding_count: 0,
    created_at: now,
    created_by_subject_id: "account:1",
    id: fieldId,
    knowledge_space_id: knowledgeSpaceId,
    name: "priority",
    row_version: 0,
    tenant_id: tenantId,
    type: "string",
    updated_at: now,
    updated_by_subject_id: null,
    ...overrides,
  };
}

function activeSpaceRow(): DatabaseRow {
  return {
    deletion_job_id: null,
    id: knowledgeSpaceId,
    lifecycle_state: "active",
  };
}

function testDatabase(
  dialect: DatabaseAdapter["dialect"],
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
): DatabaseAdapter {
  const schemaAdapter = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { ...schemaAdapter, execute, transaction: async (callback) => callback({ execute }) };
}
